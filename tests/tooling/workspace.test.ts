import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import {
  validateCurrentWorkspace,
  validateWorkspaceManifests,
  type WorkspaceManifest,
} from "../../scripts/check-workspace.ts";

const rootManifest: WorkspaceManifest = {
  path: "package.json",
  data: { name: "root", private: true, workspaces: ["packages/*"] },
};

function publicPackage(name = "@birdcar/pi-services"): WorkspaceManifest {
  return {
    path: `packages/${name.split("/").at(-1) ?? "pkg"}/package.json`,
    data: {
      name,
      version: "0.1.0",
      license: "MIT",
      type: "module",
      exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
      files: ["dist", "LICENSE", "README.md", "package.json"],
    },
  };
}

async function fixtureRoot(manifests: WorkspaceManifest[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-workspace-"));
  writeFileSync(join(dir, "LICENSE"), "license\n");
  const releasePackages: Record<string, Record<string, string>> = {};
  for (const manifest of manifests) {
    if (manifest.path !== "package.json" && manifest.data.private !== true) {
      releasePackages[manifest.path.replace(/\/package\.json$/, "")] = {
        component: String(manifest.data.name).replace("@birdcar/", ""),
        "package-name": String(manifest.data.name),
        "release-type": "node",
        "initial-version": String(manifest.data.version),
      };
    }
  }
  writeFileSync(
    join(dir, "release-please-config.json"),
    JSON.stringify({ "separate-pull-requests": true, packages: releasePackages }, null, 2),
  );
  for (const manifest of manifests) {
    const packageDir = join(dir, manifest.path, "..");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(dir, manifest.path), JSON.stringify(manifest.data, null, 2));
    if (manifest.path !== "package.json") {
      mkdirSync(join(packageDir, "dist"), { recursive: true });
      writeFileSync(join(packageDir, "dist/index.js"), "export {};\n");
      writeFileSync(join(packageDir, "dist/index.d.ts"), "export {};\n");
      writeFileSync(join(packageDir, "LICENSE"), "license\n");
      writeFileSync(join(packageDir, "README.md"), `# ${manifest.data.name}\n`);
    }
  }
  return dir;
}

describe("workspace manifest validation", () => {
  beforeAll(() => {
    const build = Bun.spawnSync(["bun", "run", "build"], {
      cwd: join(import.meta.dir, "../.."),
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.exitCode, build.stderr.toString()).toBe(0);
  });

  test("accepts the actual workspace after build", () => {
    const result = validateCurrentWorkspace();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("rejects duplicate names", async () => {
    const first = publicPackage("@birdcar/one");
    const second = publicPackage("@birdcar/one");
    second.path = "packages/two/package.json";
    const root = await fixtureRoot([rootManifest, first, second]);
    const result = validateWorkspaceManifests([rootManifest, first, second], root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("duplicate package name @birdcar/one");
  });

  test("rejects public workspace and file dependency ranges", async () => {
    const pkg = publicPackage();
    pkg.data.dependencies = {
      "@birdcar/other": "workspace:*",
      local: "file:../local",
      publishable: ">=1.0.0 <2.0.0 || ^3.0.0",
    };
    const root = await fixtureRoot([rootManifest, pkg]);
    const result = validateWorkspaceManifests([rootManifest, pkg], root);
    expect(result.errors.join("\n")).toContain(
      "public dependency @birdcar/other uses non-publishable range workspace:*",
    );
    expect(result.errors.join("\n")).toContain(
      "public dependency local uses non-publishable range file:../local",
    );
  });

  test("rejects missing exported files and missing license metadata", async () => {
    const pkg = publicPackage();
    delete pkg.data.license;
    pkg.data.exports = { ".": { import: "./dist/missing.js", types: "./dist/index.d.ts" } };
    const root = await fixtureRoot([rootManifest, pkg]);
    const result = validateWorkspaceManifests([rootManifest, pkg], root);
    expect(result.errors.join("\n")).toContain("public package license must be MIT");
    expect(result.errors.join("\n")).toContain("import target is missing: ./dist/missing.js");
  });

  test("rejects public root runtime entrypoints", async () => {
    const invalidRoot: WorkspaceManifest = {
      path: "package.json",
      data: { name: "root", private: false, module: "index.ts" },
    };
    const root = await fixtureRoot([invalidRoot]);
    const result = validateWorkspaceManifests([invalidRoot], root);
    expect(result.errors.join("\n")).toContain("root package must be private");
    expect(result.errors.join("\n")).toContain(
      "root must not declare runtime entrypoint field module",
    );
  });

  test("accepts an explicitly valid second public package", async () => {
    const service = publicPackage("@birdcar/pi-services");
    const extra = publicPackage("@birdcar/pi-extra");
    const root = await fixtureRoot([rootManifest, service, extra]);
    const result = validateWorkspaceManifests([rootManifest, service, extra], root);
    expect(result.errors).toEqual([]);
  });
});
