import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const require = createRequire(import.meta.url);
const { Manifest } = require("release-please") as { Manifest: new (...args: unknown[]) => unknown };
const { Version } = require("release-please/build/src/version.js") as {
  Version: { parse(version: string): unknown };
};

interface FixtureCommit {
  message: string;
  files: string[];
}

interface FixturePackage {
  path: string;
  private?: boolean;
  manifestVersion?: string;
  packageVersion: string;
}

interface FixtureRelease {
  path: string;
  version: string;
  tag: string;
}

const config = JSON.parse(readFileSync("release-please-config.json", "utf8")) as {
  packages: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};
const manifest = JSON.parse(readFileSync(".release-please-manifest.json", "utf8")) as Record<
  string,
  string
>;
const releasePlease = JSON.parse(
  readFileSync("node_modules/release-please/package.json", "utf8"),
) as { version: string };

async function upstreamManifestReleases(
  packages: FixturePackage[],
  commits: FixtureCommit[],
): Promise<FixtureRelease[]> {
  async function* emptyIterator(): AsyncGenerator<never> {}
  async function* commitIterator(): AsyncGenerator<{
    sha: string;
    message: string;
    files: string[];
  }> {
    for (const [index, commit] of commits.entries()) yield { sha: `sha-${index}`, ...commit };
  }
  const repositoryConfig = Object.fromEntries(
    packages
      .filter((pkg) => !pkg.private)
      .map((pkg) => [
        pkg.path,
        {
          releaseType: "node",
          component:
            pkg.path === "packages/services"
              ? "pi-services"
              : pkg.path === "packages/write-for"
                ? "pi-write-for"
                : pkg.path.split("/").at(-1),
          packageName: `@fixture/${pkg.path.split("/").at(-1)}`,
          initialVersion: "0.1.0",
          tagSeparator: "-",
          bumpMinorPreMajor: true,
          bumpPatchForMinorPreMajor: false,
        },
      ]),
  );
  const releasedVersions = Object.fromEntries(
    packages
      .filter((pkg) => !pkg.private && pkg.manifestVersion)
      .map((pkg) => [pkg.path, Version.parse(pkg.manifestVersion!)]),
  );
  const github = {
    repository: { owner: "fixture", repo: "repo" },
    releaseIterator: emptyIterator,
    tagIterator: emptyIterator,
    mergeCommitIterator: commitIterator,
    pullRequestIterator: emptyIterator,
    getFileContents: async (path: string) => {
      const pkg = packages.find((candidate) => path === `${candidate.path}/package.json`);
      return {
        parsedContent: {
          name: `@fixture/${pkg?.path.split("/").at(-1) ?? "unknown"}`,
          version: pkg?.packageVersion ?? "0.0.0",
        },
        content: "e30=",
        sha: "file-sha",
      };
    },
  };
  const manifest = new Manifest(github, "main", repositoryConfig, releasedVersions, {
    bootstrapSha: "bootstrap",
    separatePullRequests: true,
  }) as {
    buildPullRequests(): Promise<Array<{ version: { toString(): string }; headRefName: string }>>;
  };
  const prs = await manifest.buildPullRequests();
  return prs.map((pr) => {
    const component = pr.headRefName.split("--components--").at(-1) ?? "";
    const path = Object.entries(repositoryConfig).find(
      ([, releaseConfig]) => releaseConfig.component === component,
    )?.[0];
    const version = pr.version.toString();
    return { path: path ?? "", version, tag: `${component}-v${version}` };
  });
}

describe("release manifest configuration", () => {
  test("configures independent public packages without workspace cascade plugins", () => {
    expect(releasePlease.version).toBe("17.1.1");
    expect(Object.keys(config.packages)).toEqual(["packages/services", "packages/write-for"]);
    expect(config["separate-pull-requests"]).toBe(true);
    expect(config["tag-separator"]).toBe("-");
    expect(JSON.stringify(config)).not.toContain("node-workspace");
    expect(JSON.stringify(config)).not.toContain("linked-versions");
  });

  test("bootstraps packages for first 0.1.0 releases", async () => {
    const service = config.packages["packages/services"];
    const writer = config.packages["packages/write-for"];
    expect(service).toMatchObject({
      component: "pi-services",
      "package-name": "@birdcar/pi-services",
      "release-type": "node",
      "initial-version": "0.1.0",
    });
    expect(writer).toMatchObject({
      component: "pi-write-for",
      "package-name": "@birdcar/pi-write-for",
      "release-type": "node",
      "initial-version": "0.1.0",
    });
    expect(manifest).toEqual({});
    expect(
      await upstreamManifestReleases(
        [
          { path: "packages/services", packageVersion: "0.0.0" },
          { path: "packages/write-for", packageVersion: "0.0.0" },
        ],
        [
          { message: "feat: publish helper", files: ["packages/services/src/index.ts"] },
          { message: "feat: publish writer", files: ["packages/write-for/src/index.ts"] },
        ],
      ),
    ).toEqual([
      { path: "packages/services", version: "0.1.0", tag: "pi-services-v0.1.0" },
      { path: "packages/write-for", version: "0.1.0", tag: "pi-write-for-v0.1.0" },
    ]);
  });

  test("uses path-scoped independent releases and excludes private or root-only changes", async () => {
    const releases = await upstreamManifestReleases(
      [
        { path: "packages/services", manifestVersion: "1.2.3", packageVersion: "1.2.4" },
        { path: "packages/consumer", manifestVersion: "2.0.0", packageVersion: "2.0.0" },
        { path: "packages/private-fixture", private: true, packageVersion: "0.0.0" },
      ],
      [
        { message: "fix: service bug", files: ["packages/services/src/index.ts"] },
        { message: "feat: private experiment", files: ["packages/private-fixture/index.ts"] },
        { message: "chore: root tooling", files: ["eslint.config.js"] },
      ],
    );
    expect(releases).toEqual([
      { path: "packages/services", version: "1.2.4", tag: "pi-services-v1.2.4" },
    ]);
  });

  test("uses upstream post-1.0 patch, minor, and major conventional-commit bumps", async () => {
    expect(
      await upstreamManifestReleases(
        [{ path: "packages/services", manifestVersion: "1.2.3", packageVersion: "1.2.4" }],
        [{ message: "fix: service bug", files: ["packages/services/src/index.ts"] }],
      ),
    ).toEqual([{ path: "packages/services", version: "1.2.4", tag: "pi-services-v1.2.4" }]);
    expect(
      await upstreamManifestReleases(
        [{ path: "packages/services", manifestVersion: "1.2.3", packageVersion: "1.3.0" }],
        [{ message: "feat: add service helper", files: ["packages/services/src/index.ts"] }],
      ),
    ).toEqual([{ path: "packages/services", version: "1.3.0", tag: "pi-services-v1.3.0" }]);
    expect(
      await upstreamManifestReleases(
        [{ path: "packages/services", manifestVersion: "1.2.3", packageVersion: "2.0.0" }],
        [
          {
            message: "feat!: change service contract\n\nBREAKING CHANGE: changed discovery shape",
            files: ["packages/services/src/index.ts"],
          },
        ],
      ),
    ).toEqual([{ path: "packages/services", version: "2.0.0", tag: "pi-services-v2.0.0" }]);
  });

  test("documents configured 0.x breaking-change behavior", async () => {
    expect(config["bump-minor-pre-major"]).toBe(true);
    expect(config["bump-patch-for-minor-pre-major"]).toBe(false);
    expect(
      await upstreamManifestReleases(
        [{ path: "packages/services", manifestVersion: "0.2.3", packageVersion: "0.3.0" }],
        [
          {
            message: "feat!: change service contract\n\nBREAKING CHANGE: changed discovery shape",
            files: ["packages/services/src/index.ts"],
          },
        ],
      ),
    ).toEqual([{ path: "packages/services", version: "0.3.0", tag: "pi-services-v0.3.0" }]);
  });

  test("does not release consumers for helper-only patches without explicit range changes", async () => {
    const helperOnly = await upstreamManifestReleases(
      [
        { path: "packages/services", manifestVersion: "1.0.0", packageVersion: "1.0.1" },
        { path: "packages/consumer", manifestVersion: "1.0.0", packageVersion: "1.0.0" },
      ],
      [{ message: "fix: helper patch", files: ["packages/services/src/index.ts"] }],
    );
    expect(helperOnly.map((release) => release.path)).toEqual(["packages/services"]);

    const explicitConsumerBump = await upstreamManifestReleases(
      [
        { path: "packages/services", manifestVersion: "1.0.0", packageVersion: "1.0.0" },
        { path: "packages/consumer", manifestVersion: "1.0.0", packageVersion: "1.0.1" },
      ],
      [{ message: "fix(deps): adopt helper range", files: ["packages/consumer/package.json"] }],
    );
    expect(explicitConsumerBump).toEqual([
      { path: "packages/consumer", version: "1.0.1", tag: "consumer-v1.0.1" },
    ]);
  });
});
