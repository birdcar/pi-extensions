import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

interface Job {
  steps?: Step[];
  strategy?: { matrix: { include: Array<Record<string, string>> } };
}

interface Workflow {
  permissions?: Record<string, string>;
  on: {
    pull_request?: unknown;
  };
  jobs: Record<string, Job>;
}

function workflow(path: string): Workflow {
  return YAML.parse(readFileSync(path, "utf8")) as Workflow;
}

function assertPinnedUses(candidate: Workflow): void {
  for (const job of Object.values(candidate.jobs)) {
    for (const { uses } of job.steps ?? []) {
      if (uses === undefined || uses.startsWith("./")) continue;
      expect(uses).toMatch(/@[0-9a-f]{40}$/);
    }
  }
}

function step(job: Job | undefined, name: string): Step {
  const found = job?.steps?.find((candidate) => candidate.name === name);
  expect(found).toBeTruthy();
  return found as Step;
}

function assertNoNpmTokenAuth(candidate: Workflow): void {
  expect(YAML.stringify(candidate)).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
}

function assertConventionalPrTitleGate(candidate: Workflow): void {
  const validate = step(candidate.jobs["validate-pr-title"], "Validate conventional PR title");
  const run = validate.run ?? "";
  expect(run).toContain("=~ ^(feat|fix|docs|chore|refactor|test)");
  expect(run).toContain("(\\([A-Za-z0-9._/-]+\\))?!?:\\ .+");
}

function changesetsStep(candidate: Workflow): Step {
  const found = Object.values(candidate.jobs)
    .flatMap((job) => job.steps ?? [])
    .find((candidateStep) => candidateStep.uses?.startsWith("changesets/action@"));
  expect(found).toBeTruthy();
  return found as Step;
}

function assertCheckBeforePublish(candidate: Workflow, scripts: Record<string, string>): void {
  expect(changesetsStep(candidate).with?.["publish-script"]).toBe("bun run release");
  expect(scripts.release).toBe("bun run check && changeset publish");
}

describe("workflow policy", () => {
  const ci = workflow(".github/workflows/ci.yml");
  const release = workflow(".github/workflows/release.yml");
  const root = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
    packageManager: string;
  };

  test("CI is read-only, pinned, and covers Linux/macOS Node smoke targets", () => {
    expect(ci.permissions).toEqual({ contents: "read" });
    expect(ci.on.pull_request).toBeTruthy();
    expect(JSON.stringify(ci)).not.toContain("pull_request_target");
    assertConventionalPrTitleGate(ci);
    const matrix = ci.jobs.check?.strategy?.matrix.include;
    expect(matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ os: "ubuntu-24.04", node: "22.19.0", command: "bun run check" }),
        expect.objectContaining({ os: "ubuntu-24.04", node: "24.8.0" }),
        expect.objectContaining({ os: "macos-15", node: "22.19.0" }),
        expect.objectContaining({ os: "macos-15", node: "24.8.0" }),
      ]),
    );
    const smokeTargets = matrix?.filter(
      (entry) =>
        (entry.os === "ubuntu-24.04" && entry.node === "24.8.0") || entry.os === "macos-15",
    );
    expect(smokeTargets).toHaveLength(3);
    for (const target of smokeTargets ?? []) {
      expect(target.command).toContain("bun run test:pi");
      expect(target.command).toContain("bun run check:package");
    }
    assertPinnedUses(ci);
  });

  test("release publishes over OIDC only, after the full check, with pinned actions", () => {
    assertNoNpmTokenAuth(release);
    assertCheckBeforePublish(release, root.scripts);
    assertPinnedUses(release);
  });

  test("negative controls catch token auth, publish-before-check, unpinned actions, and PR-title regressions", () => {
    for (const tokenName of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "_authToken"] as const) {
      const withTokenAuth = structuredClone(release);
      const tokenStep = changesetsStep(withTokenAuth);
      tokenStep.env = { ...tokenStep.env, [tokenName]: "redacted" };
      expect(() => assertNoNpmTokenAuth(withTokenAuth)).toThrow();
    }

    const publishBeforeCheck = structuredClone(root.scripts);
    publishBeforeCheck.release = "changeset publish && bun run check";
    expect(() => assertCheckBeforePublish(release, publishBeforeCheck)).toThrow();

    const bypassesRelease = structuredClone(release);
    const bypassStep = changesetsStep(bypassesRelease);
    bypassStep.with = { ...bypassStep.with, "publish-script": "changeset publish" };
    expect(() => assertCheckBeforePublish(bypassesRelease, root.scripts)).toThrow();

    const unpinnedChangesets = structuredClone(release);
    changesetsStep(unpinnedChangesets).uses = "changesets/action@v2";
    expect(() => assertPinnedUses(unpinnedChangesets)).toThrow();

    const withoutBreakingTitles = structuredClone(ci);
    step(withoutBreakingTitles.jobs["validate-pr-title"], "Validate conventional PR title").run =
      'case "$PR_TITLE" in feat:*|fix:*) exit 0 ;; *) exit 1 ;; esac';
    expect(() => assertConventionalPrTitleGate(withoutBreakingTitles)).toThrow();
  });

  test("aggregate check includes every required verifier", () => {
    const check = root.scripts.check ?? "";
    for (const script of [
      "check:workspace",
      "test:boundaries",
      "typecheck",
      "lint",
      "test:services",
      "test:write-for",
      "test:execution",
      "test:pi",
      "check:package",
      "test:ci",
      "check:docs",
    ]) {
      expect(check).toContain(`bun run ${script}`);
    }
    expect(check).not.toContain("|| true");
  });
});
