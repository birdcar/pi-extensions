import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";

interface Step {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

interface Job {
  if?: string;
  needs?: string[];
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps?: Step[];
  strategy?: { matrix: { include: Array<Record<string, string>> } };
}

interface Workflow {
  permissions?: Record<string, string>;
  on: {
    pull_request?: unknown;
    workflow_dispatch?: { inputs: { release_tag: { required: boolean } } };
  };
  jobs: Record<string, Job>;
}

function workflow(path: string): Workflow {
  return YAML.parse(readFileSync(path, "utf8")) as Workflow;
}

function assertPinnedUses(value: unknown): void {
  if (typeof value === "string" && value.includes("actions/")) {
    expect(value).toMatch(/@[0-9a-f]{40}$/i);
  }
}

function step(job: Job | undefined, name: string): Step {
  const found = job?.steps?.find((candidate) => candidate.name === name);
  expect(found).toBeTruthy();
  return found as Step;
}

function assertNoNpmTokenAuth(candidate: Workflow): void {
  const publishText = JSON.stringify(candidate.jobs.publish ?? {});
  expect(publishText).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
}

function assertConventionalPrTitleGate(candidate: Workflow): void {
  const validate = step(candidate.jobs["validate-pr-title"], "Validate conventional PR title");
  const run = validate.run ?? "";
  expect(run).toContain("=~ ^(feat|fix|docs|chore|refactor|test)");
  expect(run).toContain("(\\([A-Za-z0-9._/-]+\\))?!?:\\ .+");
}

function assertSupportedNpm(candidate: Workflow): void {
  const pin = step(candidate.jobs.publish, "Pin npm 11.6.0");
  const version = pin.run
    ?.match(/npm@(\d+)\.(\d+)\.(\d+)/)
    ?.slice(1)
    .map(Number);
  expect(version).toBeTruthy();
  const [major = 0, minor = 0, patch = 0] = version ?? [];
  expect(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)))).toBe(true);
}

function assertReleasePublicationWiring(candidate: Workflow): void {
  const publish = candidate.jobs.publish;
  expect(publish?.needs).toContain("release-management");
  expect(publish?.if).toContain("always()");
  expect(publish?.if).toContain("workflow_dispatch");
  expect(publish?.permissions).toEqual({ contents: "read", "id-token": "write" });

  const releaseManagement = candidate.jobs["release-management"];
  expect(releaseManagement?.outputs?.services_version).toContain("packages/services--version");
  expect(releaseManagement?.outputs?.services_tag).toContain("packages/services--tag_name");
  expect(releaseManagement?.outputs?.services_sha).toContain("packages/services--sha");
  expect(releaseManagement?.outputs?.write_for_version).toContain("packages/write-for--version");
  expect(releaseManagement?.outputs?.write_for_tag).toContain("packages/write-for--tag_name");
  expect(releaseManagement?.outputs?.write_for_sha).toContain("packages/write-for--sha");

  const checkout = publish?.steps?.find((candidateStep) =>
    candidateStep.uses?.startsWith("actions/checkout"),
  );
  expect(String(checkout?.with?.ref)).toContain("inputs.release_tag");

  const validate = step(publish, "Validate release source and publish selected artifacts");
  const run = validate.run ?? "";
  expect(run).toContain("select-releases");
  expect(run).toContain("validate-releases");
  expect(run).toContain('git show-ref --verify --quiet "refs/tags/$RELEASE_TAG"');
  expect(run).toContain('git rev-parse "refs/tags/$RELEASE_TAG^{commit}"');
  expect(run).toContain('test "$GITHUB_REF" = "refs/tags/$RELEASE_TAG"');
  expect(run).toContain('test "$GITHUB_SHA" = "$sha"');
  expect(run).toContain("git rev-parse HEAD");
  expect(run).toContain("jq -nc --arg path");
  expect(run).not.toContain('[{\\"path\\":\\"$path');
  expect(run).toContain('bun scripts/publish.ts --execute --releases="$releases"');
  expect(JSON.stringify(validate.env)).toContain("services_version");
  expect(JSON.stringify(validate.env)).toContain("services_tag");
  expect(JSON.stringify(validate.env)).toContain("services_sha");
  expect(JSON.stringify(validate.env)).toContain("write_for_version");
  expect(JSON.stringify(validate.env)).toContain("write_for_tag");
  expect(JSON.stringify(validate.env)).toContain("write_for_sha");
  expect(validate.env?.GITHUB_REF).toBe("${{ github.ref }}");
  assertNoNpmTokenAuth(candidate);
  assertSupportedNpm(candidate);
}

function assertReleaseLockRefreshWiring(candidate: Workflow): void {
  const releaseManagement = candidate.jobs["release-management"];
  const managementCheckout = releaseManagement?.steps?.find((candidateStep) =>
    candidateStep.uses?.startsWith("actions/checkout"),
  );
  expect(String(managementCheckout?.with?.token)).toContain("steps.app-token.outputs.token");
  const refresh = step(
    releaseManagement,
    "Refresh Bun lockfile only on trusted release PR branches",
  );
  const run = refresh.run ?? "";
  expect(refresh.if).toContain("steps.release.outputs.prs");
  expect(run).toContain("gh pr view");
  expect(run).toContain("baseRefName");
  expect(run).toContain("headRepositoryOwner.login");
  expect(run).toContain("headRepository.name");
  expect(run).toContain('git fetch origin "$head"');
  expect(run).toContain("bun install --lockfile-only --ignore-scripts");
  expect(run).toContain("check-lock-diff");
  expect(run).toContain("x-access-token:${GH_TOKEN}");
  expect(run).toContain('"HEAD:$head"');
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
    for (const job of Object.values(ci.jobs)) {
      for (const candidateStep of job.steps ?? []) assertPinnedUses(candidateStep.uses);
    }
  });

  test("release separates GitHub automation from OIDC-only npm publishing", () => {
    expect(release.permissions).toEqual({ contents: "read" });
    expect(release.on.workflow_dispatch?.inputs.release_tag.required).toBe(true);
    expect(release.jobs["release-management"]?.permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
      issues: "write",
    });
    assertReleasePublicationWiring(release);
    assertReleaseLockRefreshWiring(release);
    const publishText = JSON.stringify(release.jobs.publish);
    assertNoNpmTokenAuth(release);
    expect(publishText).not.toContain("npm whoami");
  });

  test("workflow negative controls catch recovery, source, lock, auth, oidc, and tool regressions", () => {
    const withoutAlways = structuredClone(release);
    withoutAlways.jobs.publish!.if = withoutAlways.jobs.publish!.if?.replace("always() && ", "");
    expect(() => assertReleasePublicationWiring(withoutAlways)).toThrow();

    const withoutSourceOutputs = structuredClone(release);
    delete withoutSourceOutputs.jobs["release-management"]!.outputs?.services_sha;
    expect(() => assertReleasePublicationWiring(withoutSourceOutputs)).toThrow();

    const withoutArtifactSelection = structuredClone(release);
    step(
      withoutArtifactSelection.jobs.publish,
      "Validate release source and publish selected artifacts",
    ).run = 'releases="$(bun scripts/release.ts validate-releases "$PATHS_RELEASED")"';
    expect(() => assertReleasePublicationWiring(withoutArtifactSelection)).toThrow();

    const withoutRecoveryRefAgreement = structuredClone(release);
    step(
      withoutRecoveryRefAgreement.jobs.publish,
      "Validate release source and publish selected artifacts",
    ).run = step(
      withoutRecoveryRefAgreement.jobs.publish,
      "Validate release source and publish selected artifacts",
    ).run?.replace('test "$GITHUB_REF" = "refs/tags/$RELEASE_TAG"', "echo non-tag ref allowed");
    expect(() => assertReleasePublicationWiring(withoutRecoveryRefAgreement)).toThrow();

    const withoutTrustedCheckout = structuredClone(release);
    const managementCheckout = withoutTrustedCheckout.jobs["release-management"]?.steps?.find(
      (candidateStep) => candidateStep.uses?.startsWith("actions/checkout"),
    );
    if (managementCheckout?.with) delete managementCheckout.with.token;
    step(
      withoutTrustedCheckout.jobs["release-management"],
      "Refresh Bun lockfile only on trusted release PR branches",
    ).run = "bun install --lockfile-only --ignore-scripts\ngit push";
    expect(() => assertReleaseLockRefreshWiring(withoutTrustedCheckout)).toThrow();

    const withoutOidc = structuredClone(release);
    delete withoutOidc.jobs.publish!.permissions?.["id-token"];
    expect(() => assertReleasePublicationWiring(withoutOidc)).toThrow();

    for (const tokenName of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "_authToken"] as const) {
      const withTokenAuth = structuredClone(release);
      step(
        withTokenAuth.jobs.publish,
        "Validate release source and publish selected artifacts",
      ).env = {
        [tokenName]: "${{ secrets.NPM_TOKEN }}",
      };
      expect(() => assertReleasePublicationWiring(withTokenAuth)).toThrow();
    }

    const unsupportedNpm = structuredClone(release);
    const pinNpm = step(unsupportedNpm.jobs.publish, "Pin npm 11.6.0");
    pinNpm.run = "npm install -g npm@11.4.0";
    expect(() => assertReleasePublicationWiring(unsupportedNpm)).toThrow();

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
      "test:release",
      "test:release-lock",
      "test:publish",
      "test:ci",
      "check:docs",
    ]) {
      expect(check).toContain(`bun run ${script}`);
    }
    expect(check).not.toContain("|| true");
  });
});
