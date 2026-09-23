import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  createPublishPlan,
  githubRepositoryUrl,
  publishPlannedItems,
  type RegistryState,
} from "../../scripts/publish.ts";
import type { PackageArtifact } from "../../scripts/check-package.ts";
import { selectReleasedPaths } from "../../scripts/release.ts";

const sha = "a".repeat(40);

function artifact(
  root: string,
  packageName: string,
  version: string,
  filename: string,
  repositoryUrl = "https://github.com/birdcar/pi-extensions",
): PackageArtifact {
  const tarball = join(root, filename);
  writeFileSync(tarball, `${packageName}@${version}`);
  return {
    name: packageName,
    version,
    tarball,
    filename,
    files: [],
    integrity: `sha512-${filename}`,
    repositoryUrl,
  };
}

function fixture(): { root: string; artifacts: Record<string, PackageArtifact> } {
  const root = mkdtempSync(join(tmpdir(), "pi-publish-"));
  writeFileSync(
    join(root, "release-please-config.json"),
    JSON.stringify({
      packages: {
        "packages/services": { component: "pi-services" },
        "packages/write-for": { component: "pi-write-for" },
        "packages/alpha": { component: "pi-alpha" },
        "packages/private": { component: "pi-private" },
      },
    }),
  );
  const packages = {
    "packages/services": { name: "@birdcar/pi-services", version: "0.1.0" },
    "packages/alpha": { name: "@birdcar/pi-alpha", version: "2.0.0" },
    "packages/write-for": {
      name: "@birdcar/pi-write-for",
      version: "0.1.0",
      dependencies: { "@birdcar/pi-services": "^0.1.0" },
    },
    "packages/private": { name: "@birdcar/pi-private", version: "1.0.0", private: true },
  };
  for (const [path, manifest] of Object.entries(packages)) {
    const pkg = join(root, path);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest));
  }
  return {
    root,
    artifacts: {
      "packages/services": artifact(root, "@birdcar/pi-services", "0.1.0", "services.tgz"),
      "packages/alpha": artifact(root, "@birdcar/pi-alpha", "2.0.0", "alpha.tgz"),
      "packages/write-for": artifact(root, "@birdcar/pi-write-for", "0.1.0", "write-for.tgz"),
      "packages/private": artifact(root, "@birdcar/pi-private", "1.0.0", "private.tgz"),
    },
  };
}

function release(overrides = {}) {
  return {
    path: "packages/services",
    version: "0.1.0",
    tag: "pi-services-v0.1.0",
    sha,
    ...overrides,
  };
}

function writerRelease(overrides = {}) {
  return {
    path: "packages/write-for",
    version: "0.1.0",
    tag: "pi-write-for-v0.1.0",
    sha,
    ...overrides,
  };
}

function alphaRelease(overrides = {}) {
  return {
    path: "packages/alpha",
    version: "2.0.0",
    tag: "pi-alpha-v2.0.0",
    sha,
    ...overrides,
  };
}

describe("publication planning", () => {
  test("constructs release selections from Release Please paths and per-path outputs", () => {
    expect(
      selectReleasedPaths(
        JSON.stringify(["packages/services"]),
        JSON.stringify({
          "packages/services": { version: "0.1.0", tag: "pi-services-v0.1.0", sha },
        }),
      ),
    ).toEqual([release()]);
    expect(() => selectReleasedPaths(JSON.stringify(["packages/services"]), "{}")).toThrow(
      "missing release output metadata",
    );
  });

  test("plans an exact missing public release", () => {
    const { root, artifacts } = fixture();
    const plan = createPublishPlan([release()], {
      rootDir: root,
      sourceSha: sha,
      registry: () => ({ status: "missing" }),
      artifactFactory: (path) => artifacts[path]!,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.items).toEqual([
      expect.objectContaining({
        ...release(),
        packageName: "@birdcar/pi-services",
        tarball: artifacts["packages/services"]!.tarball,
        integrity: "sha512-services.tgz",
        action: "publish",
      }),
    ]);
    expect(publishPlannedItems(plan.items)).toEqual([
      ["npm", "publish", artifacts["packages/services"]!.tarball, "--access", "public"],
    ]);
  });

  test("plans two independent selected package releases", () => {
    const { root, artifacts } = fixture();
    const plan = createPublishPlan([release(), alphaRelease()], {
      rootDir: root,
      sourceSha: sha,
      registry: () => ({ status: "missing" }),
      artifactFactory: (path) => artifacts[path]!,
    });
    expect(plan.ok).toBe(true);
    expect(plan.items.map((item) => [item.path, item.packageName, item.action])).toEqual([
      ["packages/services", "@birdcar/pi-services", "publish"],
      ["packages/alpha", "@birdcar/pi-alpha", "publish"],
    ]);
    expect(publishPlannedItems(plan.items)).toEqual([
      ["npm", "publish", artifacts["packages/services"]!.tarball, "--access", "public"],
      ["npm", "publish", artifacts["packages/alpha"]!.tarball, "--access", "public"],
    ]);
  });

  test("rejects unknown, private, traversal, version, tag, and stale sha inputs", () => {
    const { root, artifacts } = fixture();
    const plan = createPublishPlan(
      [
        release({ path: "../secret" }),
        release({ path: "packages/unknown" }),
        {
          path: "packages/private",
          version: "1.0.0",
          tag: "pi-private-v1.0.0",
          sha,
        },
        release({ version: "0.2.0" }),
        release({ tag: "other-v0.1.0" }),
        release({ sha: "b".repeat(40) }),
      ],
      {
        rootDir: root,
        sourceSha: sha,
        registry: () => ({ status: "missing" }),
        artifactFactory: (path) => artifacts[path]!,
      },
    );
    expect(plan.ok).toBe(false);
    expect(plan.errors.join("\n")).toContain("release path");
    expect(plan.errors.join("\n")).toContain("not configured for publication");
    expect(plan.errors.join("\n")).toContain("private packages may not be published");
    expect(plan.errors.join("\n")).toContain("does not match workflow sha");
    expect(plan.errors.join("\n")).toContain("release tag");
  });

  test("already-published exact integrity is a skip and conflicts fail", () => {
    const { root, artifacts } = fixture();
    const states: RegistryState[] = [
      { status: "published", integrity: "sha512-services.tgz" },
      { status: "published", integrity: "sha512-other" },
    ];
    const first = createPublishPlan([release()], {
      rootDir: root,
      registry: () => states[0]!,
      artifactFactory: (path) => artifacts[path]!,
    });
    expect(first.items[0]?.action).toBe("skip");
    const second = createPublishPlan([release()], {
      rootDir: root,
      registry: () => states[1]!,
      artifactFactory: (path) => artifacts[path]!,
    });
    expect(second.ok).toBe(false);
    expect(second.errors.join("\n")).toContain("different integrity");
  });

  test("orders a batched writer release after the services helper", () => {
    const { root, artifacts } = fixture();
    const plan = createPublishPlan([writerRelease(), release()], {
      rootDir: root,
      sourceSha: sha,
      registry: () => ({ status: "missing" }),
      artifactFactory: (path) => artifacts[path]!,
    });
    expect(plan.ok).toBe(true);
    expect(plan.items.map((item) => item.packageName)).toEqual([
      "@birdcar/pi-services",
      "@birdcar/pi-write-for",
    ]);
  });

  test("rejects a batched writer release when the selected helper version does not satisfy its declared range", () => {
    const { root, artifacts } = fixture();
    writeFileSync(
      join(root, "packages/write-for/package.json"),
      JSON.stringify({
        name: "@birdcar/pi-write-for",
        version: "0.1.0",
        dependencies: { "@birdcar/pi-services": "^9.0.0" },
      }),
    );
    const plan = createPublishPlan([writerRelease(), release()], {
      rootDir: root,
      sourceSha: sha,
      registry: () => ({ status: "missing" }),
      artifactFactory: (path) => artifacts[path]!,
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join("\n")).toContain(
      "selected helper @birdcar/pi-services@0.1.0 does not satisfy declared range ^9.0.0",
    );
  });

  test("fails writer-only publication when the required helper is unavailable", () => {
    const { root, artifacts } = fixture();
    const queried: string[] = [];
    writeFileSync(
      join(root, "packages/services/package.json"),
      JSON.stringify({ name: "@birdcar/pi-services", version: "9.9.9" }),
    );
    const plan = createPublishPlan([writerRelease()], {
      rootDir: root,
      sourceSha: sha,
      registry: (name, version) => {
        if (name === "@birdcar/pi-services") queried.push(version);
        return { status: "missing" };
      },
      artifactFactory: (path) => artifacts[path]!,
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join("\n")).toContain("required helper @birdcar/pi-services@^0.1.0");
    expect(queried).toContain("^0.1.0");
    expect(queried).not.toContain("9.9.9");
  });

  test("retry after one of two publishes succeeded skips it and publishes the missing package", () => {
    const { root, artifacts } = fixture();
    const plan = createPublishPlan([release(), alphaRelease()], {
      rootDir: root,
      sourceSha: sha,
      registry: (name) =>
        name === "@birdcar/pi-services"
          ? { status: "published", integrity: "sha512-services.tgz" }
          : { status: "missing" },
      artifactFactory: (path) => artifacts[path]!,
    });
    expect(plan.ok).toBe(true);
    expect(plan.items.map((item) => [item.packageName, item.action])).toEqual([
      ["@birdcar/pi-services", "skip"],
      ["@birdcar/pi-alpha", "publish"],
    ]);
    expect(publishPlannedItems(plan.items)).toEqual([
      ["npm", "publish", artifacts["packages/alpha"]!.tarball, "--access", "public"],
    ]);
  });

  test("execution repository metadata must match the expected GitHub context", () => {
    expect(githubRepositoryUrl("birdcar/pi-extensions")).toBe(
      "https://github.com/birdcar/pi-extensions",
    );
    expect(githubRepositoryUrl("not a repo")).toBeUndefined();
    const { root, artifacts } = fixture();
    const missingRepository = createPublishPlan([release()], {
      rootDir: root,
      expectedRepositoryUrl: "https://github.com/birdcar/pi-extensions",
      registry: () => ({ status: "missing" }),
      artifactFactory: (path) => ({ ...artifacts[path]!, repositoryUrl: undefined }),
    });
    expect(missingRepository.ok).toBe(false);
    expect(missingRepository.errors.join("\n")).toContain("repository.url is required");

    const mismatch = createPublishPlan([release()], {
      rootDir: root,
      expectedRepositoryUrl: "https://github.com/birdcar/pi-extensions",
      registry: () => ({ status: "missing" }),
      artifactFactory: (path) => ({
        ...artifacts[path]!,
        repositoryUrl: "https://github.com/other/repo",
      }),
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.errors.join("\n")).toContain("does not match");

    const match = createPublishPlan([release()], {
      rootDir: root,
      expectedRepositoryUrl: "https://github.com/birdcar/pi-extensions",
      registry: () => ({ status: "missing" }),
      artifactFactory: (path) => ({
        ...artifacts[path]!,
        repositoryUrl: "git+https://github.com/birdcar/pi-extensions.git",
      }),
    });
    expect(match.ok).toBe(true);
  });

  test("auth, network, and malformed registry responses fail closed", () => {
    const { root, artifacts } = fixture();
    for (const state of ["auth-error", "network-error", "malformed"] as const) {
      const plan = createPublishPlan([release()], {
        rootDir: root,
        registry: () => ({ status: state, message: "nope" }),
        artifactFactory: (path) => artifacts[path]!,
      });
      expect(plan.ok).toBe(false);
      expect(plan.errors.join("\n")).toContain(state);
    }
  });
});
