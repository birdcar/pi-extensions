import { readFileSync } from "node:fs";
import { normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface ReleasePackageConfig {
  component: string;
  packageName: string;
  version: string;
  private: boolean;
}

export interface ReleaseSelectionInput {
  path: string;
  version: string;
  tag: string;
  sha: string;
}

export interface ReleaseSelection extends ReleaseSelectionInput, ReleasePackageConfig {
  packageJson: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function loadReleasePackages(rootDir = process.cwd()): Map<string, ReleasePackageConfig> {
  const config = readJson(resolve(rootDir, "release-please-config.json"));
  const packages = asObject(config.packages) ?? {};
  const result = new Map<string, ReleasePackageConfig>();
  for (const [path, entry] of Object.entries(packages)) {
    const packageConfig = asObject(entry) ?? {};
    const packageJsonPath = resolve(rootDir, path, "package.json");
    const manifest = readJson(packageJsonPath);
    result.set(path, {
      component: asString(packageConfig.component) ?? "",
      packageName: asString(manifest.name) ?? "",
      version: asString(manifest.version) ?? "",
      private: manifest.private === true,
    });
  }
  return result;
}

export function parsePathsReleased(value: string | undefined): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("paths_released must be a JSON string array");
  }
  return parsed;
}

export function selectReleasedPaths(
  pathsReleasedJson: string | undefined,
  releaseOutputsJson: string | undefined,
): ReleaseSelectionInput[] {
  const paths = parsePathsReleased(pathsReleasedJson);
  const outputs = asObject(JSON.parse(releaseOutputsJson ?? "{}")) ?? {};
  return paths.map((path) => {
    const output = asObject(outputs[path]);
    if (!output) throw new Error(`${path}: missing release output metadata`);
    const version = asString(output.version);
    const tag = asString(output.tag);
    const sha = asString(output.sha);
    if (!version || !tag || !sha) {
      throw new Error(`${path}: release output metadata must include version, tag, and sha`);
    }
    return { path, version, tag, sha };
  });
}

export function validateReleaseSelections(
  releases: ReleaseSelectionInput[],
  options: { rootDir?: string; sourceSha?: string } = {},
): ValidationResult<ReleaseSelection[]> {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const packages = loadReleasePackages(rootDir);
  const errors: string[] = [];
  const selections: ReleaseSelection[] = [];

  for (const release of releases) {
    const normalized = normalize(release.path).replaceAll("\\\\", "/");
    if (
      normalized.startsWith("..") ||
      normalized.includes("/../") ||
      resolve(rootDir, normalized) === rootDir
    ) {
      errors.push(
        `${release.path}: release path must stay inside the repository package allowlist`,
      );
      continue;
    }
    const config = packages.get(normalized);
    if (!config) {
      errors.push(`${release.path}: release path is not configured for publication`);
      continue;
    }
    if (config.private) {
      errors.push(`${normalized}: private packages may not be published`);
    }
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(release.version)) {
      errors.push(`${normalized}: release version is invalid`);
    }
    if (release.version !== config.version) {
      errors.push(
        `${normalized}: package.json version ${config.version} does not match release ${release.version}`,
      );
    }
    if (release.tag !== `${config.component}-v${release.version}`) {
      errors.push(
        `${normalized}: release tag ${release.tag} does not match ${config.component}-v${release.version}`,
      );
    }
    if (!/^[0-9a-f]{40}$/i.test(release.sha))
      errors.push(`${normalized}: release sha must be a full commit sha`);
    if (options.sourceSha && release.sha !== options.sourceSha) {
      errors.push(
        `${normalized}: release sha ${release.sha} does not match workflow sha ${options.sourceSha}`,
      );
    }
    selections.push({
      ...release,
      path: normalized,
      ...config,
      packageJson: resolve(rootDir, normalized, "package.json"),
    });
  }

  return { ok: errors.length === 0, value: errors.length === 0 ? selections : undefined, errors };
}

export function assertOnlyLockfileChanged(paths: string[]): ValidationResult<string[]> {
  const unexpected = paths.filter((path) => path !== "bun.lock");
  return {
    ok: unexpected.length === 0,
    value: unexpected.length === 0 ? paths : undefined,
    errors: unexpected.map((path) => `unexpected release PR refresh change: ${path}`),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [command, raw, metadata] = process.argv.slice(2);
  if (command === "select-releases") {
    try {
      console.log(JSON.stringify(selectReleasedPaths(raw, metadata)));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  } else if (command === "validate-releases") {
    const releases = JSON.parse(raw ?? "[]") as ReleaseSelectionInput[];
    const result = validateReleaseSelections(releases, { sourceSha: process.env.GITHUB_SHA });
    if (!result.ok) {
      console.error(result.errors.join("\n"));
      process.exit(1);
    }
    console.log(JSON.stringify(result.value));
  } else if (command === "check-lock-diff") {
    const result = assertOnlyLockfileChanged(process.argv.slice(3));
    if (!result.ok) {
      console.error(result.errors.join("\n"));
      process.exit(1);
    }
  } else {
    console.error(
      "usage: bun scripts/release.ts select-releases <paths-json> <metadata-json> | validate-releases <json> | check-lock-diff <paths...>",
    );
    process.exit(1);
  }
}
