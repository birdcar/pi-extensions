import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { satisfies, valid } from "semver";
import { validatePackageArtifact, type PackageArtifact } from "./check-package.ts";
import { validateReleaseSelections, type ReleaseSelectionInput } from "./release.ts";

export type RegistryState =
  | { status: "missing" }
  | { status: "published"; integrity?: string }
  | { status: "auth-error" | "network-error" | "malformed"; message: string };

export interface PublishPlanItem {
  path: string;
  packageName: string;
  version: string;
  tag: string;
  sha: string;
  tarball: string;
  integrity: string;
  action: "publish" | "skip";
}

export interface PublishPlanResult {
  ok: boolean;
  items: PublishPlanItem[];
  errors: string[];
}

export interface PublishOptions {
  rootDir?: string;
  sourceSha?: string;
  expectedRepositoryUrl?: string;
  registry?: (name: string, version: string) => RegistryState;
  artifactFactory?: (path: string) => PackageArtifact;
}

function sha512(path: string): string {
  return `sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}`;
}

function normalizeRepositoryUrl(value: string): string {
  return value.replace(/^git\+/, "").replace(/\.git$/, "");
}

function readManifestDependencies(packageJson: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(packageJson, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return manifest.dependencies ?? {};
}

function orderSelectionsForDependencies<
  T extends { path: string; packageName: string; packageJson: string },
>(selections: T[]): T[] {
  return [...selections].sort((a, b) => {
    const aDeps = readManifestDependencies(a.packageJson);
    const bDeps = readManifestDependencies(b.packageJson);
    if (aDeps[b.packageName] && !bDeps[a.packageName]) return 1;
    if (bDeps[a.packageName] && !aDeps[b.packageName]) return -1;
    return 0;
  });
}

export function githubRepositoryUrl(repository: string | undefined): string | undefined {
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return undefined;
  return `https://github.com/${repository}`;
}

export function classifyNpmViewError(error: unknown): RegistryState {
  const message = String(error);
  if (message.includes("E404") || message.includes("404 Not Found")) return { status: "missing" };
  if (message.includes("E401") || message.includes("E403"))
    return { status: "auth-error", message };
  if (message.includes("ETIMEDOUT") || message.includes("ECONN") || message.includes("ENOTFOUND")) {
    return { status: "network-error", message };
  }
  return { status: "malformed", message };
}

export function npmRegistryState(name: string, version: string): RegistryState {
  try {
    const output = execFileSync("npm", ["view", `${name}@${version}`, "dist.integrity", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!output) return { status: "malformed", message: "empty npm view response" };
    const parsed = JSON.parse(output) as unknown;
    return { status: "published", integrity: typeof parsed === "string" ? parsed : undefined };
  } catch (error) {
    return classifyNpmViewError(error);
  }
}

export function createPublishPlan(
  releases: ReleaseSelectionInput[],
  options: PublishOptions = {},
): PublishPlanResult {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const selected = validateReleaseSelections(releases, { rootDir, sourceSha: options.sourceSha });
  if (!selected.ok || !selected.value) return { ok: false, items: [], errors: selected.errors };
  const registry = options.registry ?? npmRegistryState;
  const artifactFactory = options.artifactFactory;
  const errors: string[] = [];
  const items: PublishPlanItem[] = [];

  const ordered = orderSelectionsForDependencies(selected.value);
  const selectedNames = new Set(ordered.map((release) => release.packageName));

  if (!artifactFactory) {
    execFileSync("bun", ["run", "build"], { cwd: rootDir, stdio: "inherit" });
  }

  const artifactCache = new Map<string, PackageArtifact>();
  const artifactFor = (release: (typeof ordered)[number]): PackageArtifact => {
    const cached = artifactCache.get(release.path);
    if (cached) return cached;
    const dependencyTarballs: string[] = [];
    if (!artifactFactory) {
      const dependencies = readManifestDependencies(release.packageJson);
      for (const dependency of ordered) {
        if (dependency.path === release.path) continue;
        if (!dependencies[dependency.packageName]) continue;
        dependencyTarballs.push(artifactFor(dependency).tarball);
      }
    }
    const artifact = artifactFactory
      ? artifactFactory(release.path)
      : validatePackageArtifact({
          rootDir,
          packagePath: release.path,
          keepTemp: true,
          dependencyTarballs,
          skipBuild: true,
        });
    artifactCache.set(release.path, artifact);
    return artifact;
  };

  for (const release of ordered) {
    const artifact = artifactFor(release);
    if (!existsSync(artifact.tarball)) {
      errors.push(`${release.path}: validated tarball is missing at ${artifact.tarball}`);
      continue;
    }
    if (artifact.name !== release.packageName || artifact.version !== release.version) {
      errors.push(
        `${release.path}: artifact ${artifact.name}@${artifact.version} does not match release ${release.packageName}@${release.version}`,
      );
      continue;
    }
    if (options.expectedRepositoryUrl) {
      if (!artifact.repositoryUrl) {
        errors.push(`${release.path}: package repository.url is required before publishing`);
        continue;
      }
      if (
        normalizeRepositoryUrl(artifact.repositoryUrl) !==
        normalizeRepositoryUrl(options.expectedRepositoryUrl)
      ) {
        errors.push(
          `${release.path}: package repository.url ${artifact.repositoryUrl} does not match ${options.expectedRepositoryUrl}`,
        );
        continue;
      }
    }
    const dependencies = readManifestDependencies(release.packageJson);
    for (const [dependencyName, range] of Object.entries(dependencies)) {
      if (!selectedNames.has(dependencyName) || dependencyName === release.packageName) continue;
      const dependencyRelease = ordered.find((item) => item.packageName === dependencyName);
      if (!dependencyRelease) continue;
      const dependencyState = registry(dependencyName, dependencyRelease.version);
      if (dependencyState.status !== "published" && dependencyState.status !== "missing") {
        errors.push(
          `${release.packageName}@${release.version}: dependency ${dependencyName}@${range} registry ${dependencyState.status}: ${dependencyState.message}`,
        );
      }
    }
    if (release.packageName === "@birdcar/pi-write-for" && dependencies["@birdcar/pi-services"]) {
      const required = dependencies["@birdcar/pi-services"]!;
      const selectedHelper = ordered.find((item) => item.packageName === "@birdcar/pi-services");
      if (selectedHelper) {
        if (!valid(selectedHelper.version) || !satisfies(selectedHelper.version, required)) {
          errors.push(
            `${release.packageName}@${release.version}: selected helper @birdcar/pi-services@${selectedHelper.version} does not satisfy declared range ${required}`,
          );
        }
      } else {
        const helperState = registry("@birdcar/pi-services", required);
        if (helperState.status === "missing") {
          errors.push(
            `${release.packageName}@${release.version}: required helper @birdcar/pi-services@${required} is not published`,
          );
        } else if (helperState.status !== "published") {
          errors.push(
            `${release.packageName}@${release.version}: helper registry ${helperState.status}: ${helperState.message}`,
          );
        }
      }
    }
    const integrity = artifact.integrity ?? sha512(artifact.tarball);
    const state = registry(release.packageName, release.version);
    if (state.status === "published") {
      if (state.integrity && state.integrity !== integrity) {
        errors.push(
          `${release.packageName}@${release.version}: already published with different integrity`,
        );
      } else {
        items.push({ ...release, tarball: artifact.tarball, integrity, action: "skip" });
      }
    } else if (state.status === "missing") {
      items.push({ ...release, tarball: artifact.tarball, integrity, action: "publish" });
    } else {
      errors.push(
        `${release.packageName}@${release.version}: registry ${state.status}: ${state.message}`,
      );
    }
  }

  return { ok: errors.length === 0, items, errors };
}

export function publishPlannedItems(items: PublishPlanItem[], execute = false): string[][] {
  const commands = items
    .filter((item) => item.action === "publish")
    .map((item) => ["npm", "publish", item.tarball, "--access", "public"]);
  if (execute) {
    for (const [, ...args] of commands)
      execFileSync("npm", args, { stdio: "inherit", env: process.env });
  }
  return commands;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const execute = process.argv.includes("--execute");
  const raw =
    process.argv.find((arg) => arg.startsWith("--releases="))?.slice("--releases=".length) ?? "[]";
  const expectedRepositoryUrl = execute
    ? githubRepositoryUrl(process.env.GITHUB_REPOSITORY)
    : undefined;
  if (execute && !expectedRepositoryUrl) {
    console.error(
      "GITHUB_REPOSITORY must identify the trusted publishing repository before --execute",
    );
    process.exit(1);
  }
  const plan = createPublishPlan(JSON.parse(raw) as ReleaseSelectionInput[], {
    sourceSha: process.env.GITHUB_SHA,
    expectedRepositoryUrl,
  });
  if (!plan.ok) {
    console.error(plan.errors.join("\n"));
    process.exit(1);
  }
  const commands = publishPlannedItems(plan.items, execute);
  for (const command of commands)
    console.log(
      command.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" "),
    );
  if (commands.length === 0) console.log(`no packages to publish (${basename(process.cwd())})`);
}
