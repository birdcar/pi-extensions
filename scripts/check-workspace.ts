import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { valid, validRange } from "semver";

export interface WorkspaceManifest {
  path: string;
  data: Record<string, unknown>;
}

export interface WorkspaceValidationResult {
  ok: boolean;
  errors: string[];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function loadWorkspaceManifests(rootDir = process.cwd()): WorkspaceManifest[] {
  const root = resolve(rootDir);
  const manifests: WorkspaceManifest[] = [
    { path: "package.json", data: readJson(join(root, "package.json")) },
  ];
  const packagesDir = join(root, "packages");

  if (!existsSync(packagesDir)) return manifests;

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageJson = join(packagesDir, entry.name, "package.json");
    if (existsSync(packageJson)) {
      manifests.push({
        path: `packages/${entry.name}/package.json`,
        data: readJson(packageJson),
      });
    }
  }

  return manifests;
}

export function validateWorkspaceManifests(
  manifests: WorkspaceManifest[],
  rootDir = process.cwd(),
): WorkspaceValidationResult {
  const errors: string[] = [];
  const names = new Map<string, string>();
  const root = manifests.find((manifest) => manifest.path === "package.json");

  if (!root) errors.push("root package.json is required");

  for (const manifest of manifests) {
    const name = stringValue(manifest.data.name);
    if (!name) {
      errors.push(`${manifest.path}: name is required`);
      continue;
    }
    const previous = names.get(name);
    if (previous)
      errors.push(`${manifest.path}: duplicate package name ${name} also used by ${previous}`);
    names.set(name, manifest.path);
  }

  if (root) {
    if (root.data.private !== true) errors.push("package.json: root package must be private");
    for (const field of ["main", "module", "exports", "types"] as const) {
      if (field in root.data)
        errors.push(`package.json: root must not declare runtime entrypoint field ${field}`);
    }
  }

  validateReleaseRegistration(manifests, rootDir, errors);

  for (const manifest of manifests.filter((item) => item.path !== "package.json")) {
    const isPrivate = manifest.data.private === true;
    if (isPrivate) continue;

    const name = stringValue(manifest.data.name) ?? "<unknown>";
    if (!name.startsWith("@birdcar/"))
      errors.push(`${manifest.path}: public package name must use @birdcar scope`);
    if (!valid(stringValue(manifest.data.version) ?? "")) {
      errors.push(`${manifest.path}: public package version must be valid semver`);
    }
    if (manifest.data.license !== "MIT")
      errors.push(`${manifest.path}: public package license must be MIT`);

    const files = manifest.data.files;
    if (!Array.isArray(files) || !files.every((value) => typeof value === "string")) {
      errors.push(`${manifest.path}: public package must declare a string files allowlist`);
    } else {
      for (const required of ["dist", "LICENSE", "README.md", "package.json"]) {
        if (!files.includes(required))
          errors.push(`${manifest.path}: files allowlist must include ${required}`);
      }
    }

    validatePublicDependencies(manifest, errors);
    validateExports(manifest, rootDir, errors);
    validateLicenseCopy(manifest, rootDir, errors);
    validatePackageReadme(manifest, rootDir, errors);
    validatePackedContents(manifest, rootDir, errors);
  }

  return { ok: errors.length === 0, errors };
}

function readReleasePackagePaths(rootDir: string, errors: string[]): Set<string> {
  const configPath = join(rootDir, "release-please-config.json");
  if (!existsSync(configPath)) {
    errors.push("release-please-config.json: release configuration is required");
    return new Set();
  }
  const config = readJson(configPath);
  const packages = objectValue(config.packages);
  if (!packages) {
    errors.push("release-please-config.json: packages map is required");
    return new Set();
  }
  return new Set(Object.keys(packages).map((path) => `${path}/package.json`));
}

function validateReleaseRegistration(
  manifests: WorkspaceManifest[],
  rootDir: string,
  errors: string[],
): void {
  const releasePaths = readReleasePackagePaths(rootDir, errors);
  for (const path of releasePaths) {
    const manifest = manifests.find((item) => item.path === path);
    if (!manifest) {
      errors.push(`release-please-config.json: configured package ${path} is missing`);
      continue;
    }
    if (manifest.data.private === true) {
      errors.push(`${path}: private package must not be registered for release`);
    }
  }

  for (const manifest of manifests.filter((item) => item.path !== "package.json")) {
    if (manifest.data.private === true) continue;
    if (!releasePaths.has(manifest.path)) {
      errors.push(
        `${manifest.path}: public package must be registered in release-please-config.json`,
      );
    }
  }
}

function validatePublicDependencies(manifest: WorkspaceManifest, errors: string[]): void {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const deps = objectValue(manifest.data[field]);
    if (!deps) continue;
    for (const [depName, range] of Object.entries(deps)) {
      const version = stringValue(range) ?? "";
      if (version.startsWith("workspace:") || version.startsWith("file:")) {
        errors.push(
          `${manifest.path}: public dependency ${depName} uses non-publishable range ${version}`,
        );
      } else if (!validRange(version)) {
        errors.push(
          `${manifest.path}: public dependency ${depName} must use a publishable semver range`,
        );
      }
    }
  }
}

function validateExports(manifest: WorkspaceManifest, rootDir: string, errors: string[]): void {
  const exportsField = objectValue(manifest.data.exports);
  if (!exportsField) {
    errors.push(`${manifest.path}: public package must declare exports`);
    return;
  }

  for (const [key, value] of Object.entries(exportsField)) {
    const exportObject = objectValue(value);
    if (!exportObject) {
      errors.push(`${manifest.path}: export ${key} must map to an object`);
      continue;
    }
    for (const condition of ["import", "types"] as const) {
      const target = stringValue(exportObject[condition]);
      if (!target) {
        errors.push(`${manifest.path}: export ${key} is missing ${condition}`);
        continue;
      }
      const absolute = resolve(rootDir, manifest.path, "..", target);
      if (!existsSync(absolute))
        errors.push(`${manifest.path}: export ${key} ${condition} target is missing: ${target}`);
    }
  }
}

function validateLicenseCopy(manifest: WorkspaceManifest, rootDir: string, errors: string[]): void {
  const rootLicense = join(rootDir, "LICENSE");
  const packageLicense = resolve(rootDir, manifest.path, "..", "LICENSE");
  if (!existsSync(packageLicense)) {
    errors.push(`${manifest.path}: LICENSE file is required`);
    return;
  }
  if (
    existsSync(rootLicense) &&
    readFileSync(rootLicense, "utf8") !== readFileSync(packageLicense, "utf8")
  ) {
    errors.push(`${manifest.path}: LICENSE must match the root LICENSE exactly`);
  }
}

function validatePackageReadme(
  manifest: WorkspaceManifest,
  rootDir: string,
  errors: string[],
): void {
  const readme = join(rootDir, dirname(manifest.path), "README.md");
  if (!existsSync(readme)) {
    errors.push(`${manifest.path}: README.md file is required`);
    return;
  }
  const text = readFileSync(readme, "utf8");
  const name = stringValue(manifest.data.name);
  if (name && !text.includes(name)) errors.push(`${manifest.path}: README.md must name ${name}`);
}

interface PackedFile {
  path?: unknown;
}

interface PackDryRunResult {
  files?: PackedFile[];
}

function validatePackedContents(
  manifest: WorkspaceManifest,
  rootDir: string,
  errors: string[],
): void {
  const packageDir = resolve(rootDir, manifest.path, "..");
  try {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: packageDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [packed] = JSON.parse(output) as PackDryRunResult[];
    const paths = new Set(
      packed?.files
        ?.map((file) => stringValue(file.path))
        .filter((path): path is string => path !== undefined),
    );
    if (!paths.has("LICENSE")) {
      errors.push(`${manifest.path}: packed tarball must include LICENSE`);
    }
  } catch (error) {
    errors.push(`${manifest.path}: npm pack dry-run failed: ${String(error)}`);
  }
}

export function validateCurrentWorkspace(rootDir = process.cwd()): WorkspaceValidationResult {
  return validateWorkspaceManifests(loadWorkspaceManifests(rootDir), rootDir);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = validateCurrentWorkspace();
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("workspace manifests are valid");
}
