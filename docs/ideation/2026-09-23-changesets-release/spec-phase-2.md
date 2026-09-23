# Implementation Spec: Changesets Release Pipeline - Phase 2

**Contract**: ./contract.md
**Estimated Effort**: M

## Technical Approach

Replace Release Please with nicknisi's Changesets pipeline (reference:
`nicknisi/pi-extensions@20391a18b2c87bb0510ea1f0cd1ac0b33192f0c1`: `.github/workflows/release.yml`,
`.github/workflows/ci.yml`'s `Changeset Status` step, `.changeset/config.json`, and the changeset rule
in `AGENTS.md`), adapted to this repo: Bun instead of pnpm, `@changesets/cli` 3.x and
`changesets/action` v2 instead of his 2.x/v1 pins, the full `bun run check` before publishing, and
SHA-pinned actions. Delete Release Please and every script, test, fixture, and doc sentence that
exists only for it. Keep all generic packaging, portability, and docs validation untouched.

Work in this order, because each step protects the next:

1. **Registry-neutral lockfile first.** Every tarball URL in `bun.lock` currently points at the
   maintainer's authenticated corporate proxy (`https://socket-firewall.workos.dev/…`, 466 entries),
   which returns 401 to anonymous requests, so no GitHub-hosted runner can install. Blank those URL
   fields (`""` means "use the configured registry": the proxy on the maintainer's machine, npmjs on
   runners) and add a root `postinstall` hook that re-blanks them after every `bun install`, `bun add`,
   or `bun remove`, which would otherwise rewrite all entries back to proxy URLs. Doing this before
   any dependency change keeps the Changesets install neutral. Never modify the machine's registry
   configuration (`~/.npmrc`, `NPM_CONFIG_REGISTRY`, `BUN_CONFIG_REGISTRY`); it is a managed
   supply-chain firewall.
2. **Dependencies and Changesets setup:** remove `release-please`, add `@changesets/cli@3.0.3`
   (exact), write `.changeset/` by hand (`changeset init` is interactive in v3 and exits 13 without a
   TTY), and add the root scripts.
3. **Workflows and the workflow test** (release.yml, the ci.yml changeset job, the three-rule test).
4. **Release Please removal, package metadata, docs, and the go-live changeset.**

All of the Changesets behavior this spec relies on was verified on 2026-09-23 in a scratch clone
with Bun 1.3.14 and `@changesets/cli` 3.0.3: `changeset status --since=origin/main` works in this Bun
workspace; a major pi-services changeset bumps pi-write-for's range to the new version and the frozen
install still passes; the go-live changeset produces 0.1.1 for both packages with pi-write-for's
range at `^0.1.1`; and the generated changelogs pass `prettier --check`.

## Decisions Considered and Rejected

_Carried from the contract; consult before making gap decisions._

- **Replace the unactivated Release Please pipeline with nicknisi's Changesets plus npm trusted
  publishing model** — rejected: activate the existing Release Please pipeline (create the GitHub
  App, set RELEASE_ENABLED). It would keep about 2,300 lines of release code and a GitHub App to
  maintain for guards a solo-maintainer, primarily personal repo does not need.
- **Adopt nicknisi's model nearly verbatim and delete the custom publish tooling** — rejected:
  Changesets wrapped in the existing custom publish guards (tag/SHA validation, exact-tag recovery,
  tarball-integrity planning). Keeping the guards keeps the maintenance burden that motivated the
  switch.
- **Keep publishing to npm** — rejected: git-only installs with no npm publishing. The user wants npm
  distribution.
- **The contract ends at a maintainer go-live gate** — rejected: stop at the merged pipeline PR. Only
  a real release proves the pipeline works, and GitHub Actions has never run on this repository.
- **release.yml runs bun run check in the same job before changeset publish** — rejected: accept that
  version PRs get no CI (publish after build only, as nicknisi does), or store a fine-grained PAT so
  version PRs trigger CI. Version PRs opened with GITHUB_TOKEN never trigger CI; gating the publish
  keeps unverified trees from shipping without a long-lived secret, and a failed publish retries on
  the next push to main because changeset publish publishes any version missing from npm.
- **Measure the tooling reduction as removal of Release Please and its custom scripts, with no size
  cap on the replacement** — rejected: a 300-line budget, or matching nicknisi's roughly 150-line
  footprint with no tests. The user wants removal, not a size target.
- **Accept per-PR changeset files and one combined 'chore: version packages' PR, reversing the
  2026-09-21 monorepo contract's rejection of Changesets** — rejected: switch but skip CI's changeset
  status enforcement, or keep Release Please for the earlier reasons. Less tooling outweighs the
  authoring cost; versions stay independent inside the combined PR, and the CI gate catches
  forgotten changesets that would otherwise never release.
- **Use Changesets' default dependent handling (updateInternalDependencies: patch)** — rejected: the
  2026-09-21 contract's explicit fix(deps) consumer updates with no automatic dependent bumps. Tested:
  with pi-services at 0.2.0 and pi-write-for still on ^0.1.0, both bun install --frozen-lockfile and
  --lockfile-only fail with a registry 404.
- **The version script is plain changeset version, with no bun.lock refresh** — rejected:
  changeset version && bun install --lockfile-only, or the old release-PR lock-refresh step. Tested: a
  lockstep bump leaves bun.lock byte-identical and the frozen install passes.
- **tests/release/workflows.test.ts keeps its ci.yml assertions and asserts three release.yml rules:
  no npm tokens, bun run check before changeset publish, every action SHA-pinned** — rejected: keep
  only the ci.yml assertions, or also add a fixture test that runs changeset version. Keeps the
  OIDC-only and check-before-publish decisions from silently regressing; the Changesets and Bun
  interplay is covered by acceptance probes and again at go-live.
- **Delete check-workspace's release-registration cross-check and its release-please-config
  fixture** — rejected: port the check to read .changeset/config.json. Under Changesets every
  non-private workspace package is releasable, so there is nothing to register.
- **Accept Changesets' tag format (@birdcar/<pkg>@<version>) and its GitHub Releases** — rejected:
  keep the <component>-v<version> tags. The format is not configurable, and no tags exist yet.
- **nicknisi's choices win by default** — rejected: bespoke hardening beyond nicknisi's setup. The
  user's stated priority: tested at scale, primarily personal, painless maintenance.
- **Remove the RELEASE_ENABLED gate and the npm-publish environment** — rejected: keep them as an
  activation guard. nicknisi has neither, and the bootstrap runs before merge.
- **Use @changesets/cli 3.x and changesets/action v2** — rejected: nicknisi's exact pins (2.31.1 and
  v1). Avoids a forced major migration later; the one deliberate version deviation.
- **Go-live order: the implementation PR carries a patch changeset for both packages, the bootstrap
  runs from that branch before merge** — rejected: merge first and bootstrap afterward, or an empty
  changeset. Fewest manual steps.
- **The bootstrap handles its own prerequisites** — rejected: nicknisi's preflight or a
  version-compare branch. (Phase 1; this phase only links the script from the docs.)
- **Set NPM_CONFIG_PROVENANCE=true on the publish step** — rejected: rely on trusted publishing's
  documented automatic provenance. A 2026 report found provenance had to be forced, and a version
  published without it cannot be republished.
- **Make bun.lock registry-neutral and keep it that way with a root postinstall hook that blanks WorkOS
  Socket Firewall tarball URLs** — rejected: keep the proxy URLs (401 to anonymous requests), give CI
  a proxy credential, or pin this repo's registry to npmjs (bypasses the machine's managed firewall).
  Tested: the neutral lockfile frozen-installs, every local download still goes through the firewall
  (416 of 416 registry fetches), and the hook keeps the lockfile neutral through bun add and bun
  remove.
- **Prove the three workflow rules with a mutation probe that edits release.yml and package.json and
  requires the workflow test to fail after each edit** — rejected: accept bun test exiting 0. The
  current test already passes, and its old helpers miss changesets/action and any job not named
  publish.
- **Check the ci.yml changeset step with an acceptance-time parse of ci.yml, keeping the rewritten
  workflow test to the three release.yml rules** — rejected: rely on a direct changeset status probe
  alone, or add a fourth assertion to workflows.test.ts. The direct probe passes with ci.yml
  untouched, and the user limited the test to the three rules.

## Feedback Strategy

**Inner-loop command**: `bun test tests/release/workflows.test.ts` (under a second) while editing
workflows, scripts, or the test; `bun run check:workspace` after the check-workspace edit.

**Playground**: the test suite plus the contract's own acceptance commands, run against a snapshot of
the working tree. Several acceptance checks (criteria 3, 4, 6, 7) run `git worktree add … HEAD`, so
they only see committed state. Define these two shell functions in the implementation shell; they
build a throwaway commit object from the working tree (tracked changes and untracked, non-ignored
files) without moving HEAD, touching the index, or signing, and run a criterion against it:

```bash
CONTRACT=docs/ideation/2026-09-23-changesets-release/contract-data.json
snap() {
  idx="$(mktemp)"
  cp "$(git rev-parse --git-path index)" "$idx"
  GIT_INDEX_FILE="$idx" git add -A
  tree="$(GIT_INDEX_FILE="$idx" git write-tree)"
  rm -f "$idx"
  git -c user.name=probe -c user.email=probe@example.invalid commit-tree --no-gpg-sign -p HEAD -m wip "$tree"
}
probe() { # probe <criterion number, 1-based>
  sha="$(snap)"
  jq -r ".successCriteria[$(($1 - 1))].check.cmd" "$CONTRACT" | sed "s/\"\$d\" HEAD/\"\$d\" $sha/" | sh
  echo "criterion $1 exit=$?"
}
```

(Verified in a scratch clone: HEAD, the index, and `git status` are unchanged after `snap`, and the
worktree checks out the snapshot.)

**Why this approach**: nearly every component here is configuration whose correctness only shows up
as test or check behavior, so the fast workflow test is the tight loop and the contract's probes are
the ground truth for the behaviors that matter (lockfile neutrality, the three rules, the ci.yml gate,
dependent bumps, and the changeset gate).

## File Changes

### New Files

| File Path                         | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `.changeset/config.json`          | Changesets v3 config with nicknisi's settings.                           |
| `.changeset/README.md`            | Changesets' default folder README (verbatim template, prettier-wrapped). |
| `.changeset/publish-from-ci.md`   | The go-live patch changeset for both packages (becomes 0.1.1).           |

### Modified Files

| File Path                          | Changes                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun.lock`                         | Proxy tarball URLs blanked; `release-please` and its transitive entries removed; `@changesets/cli` 3.0.3 entries added (all registry-neutral).      |
| `package.json`                     | Scripts `changeset`, `version`, `release`, `postinstall` added; `test:release`, `test:release-lock`, `test:publish` removed from scripts and `check`; devDependency swap. |
| `.github/workflows/release.yml`    | Full rewrite on changesets/action v2.                                                                                                              |
| `.github/workflows/ci.yml`         | New `changeset-status` job for pull requests.                                                                                                      |
| `tests/release/workflows.test.ts`  | ci.yml and aggregate assertions kept; release.yml assertions replaced by the three rules plus negative controls.                                   |
| `scripts/check-workspace.ts`       | Delete `readReleasePackagePaths`, `validateReleaseRegistration`, and the call at line 84.                                                          |
| `tests/tooling/workspace.test.ts`  | Delete the `release-please-config.json` fixture block in `fixtureRoot` (lines 34-48).                                                             |
| `packages/services/package.json`   | Add `repository` (url + directory).                                                                                                                |
| `packages/write-for/package.json`  | Add `repository` (url + directory) and `keywords` (Full tier).                                                                                     |
| `docs/releasing.md`                | Full rewrite in nicknisi's short style; links the bootstrap script with a markdown link.                                                           |
| `README.md`                        | Rewrite the "Packages and releases" section (lines 35-45) without Release Please or RELEASE_ENABLED.                                               |
| `AGENTS.md`                        | Add nicknisi's changeset rule to "Development workflow".                                                                                          |

### Deleted Files

| File Path                         | Reason                                                                 |
| --------------------------------- | ---------------------------------------------------------------------- |
| `release-please-config.json`      | Release Please config.                                                 |
| `.release-please-manifest.json`   | Release Please manifest (`{}`).                                        |
| `scripts/release.ts`              | Parses Release Please outputs and polices the old lock refresh.        |
| `scripts/publish.ts`              | Custom publish planner, replaced by `changeset publish`.               |
| `tests/release/manifest.test.ts`  | Conformance test of the `release-please` library.                      |
| `tests/release/lockfile.test.ts`  | Tests the deleted lock-refresh helper.                                 |
| `tests/release/publish.test.ts`   | Tests the deleted publish planner.                                     |

Only these files import `scripts/release.ts` or `scripts/publish.ts` (checked with `grep`), so the
deletions break nothing that stays.

## Implementation Details

### Registry-neutral lockfile and postinstall hook

**Overview**: blank the proxy URL field in every `bun.lock` package entry and keep it blank
automatically.

The root `package.json` script (JSON-escaped exactly like this):

```json
"postinstall": "perl -pi -e 's#\"https://socket-firewall\\.workos\\.dev/[^\"]*\"#\"\"#g' bun.lock"
```

**Key decisions**:

- Blank only this host's URLs: the lockfile also has two legitimate `https://github.com/` entries that
  must keep their URL.
- `perl -pi` rather than `sed -i`: identical on macOS and the Ubuntu/macOS runners (BSD and GNU sed
  disagree on `-i`).
- The hook runs on CI installs too, where it is a no-op.

**Implementation steps**:

1. Add the `postinstall` script to the root `package.json`.
2. Run it once: `perl -pi -e 's#"https://socket-firewall\.workos\.dev/[^"]*"#""#g' bun.lock`.
3. `bun install --frozen-lockfile` must still exit 0; then `grep -c 'socket-firewall.workos.dev' bun.lock`
   must print `0`.

**Feedback loop**:

- **Playground**: the repository itself; the hook is idempotent.
- **Experiment**: after each later dependency command in this phase (`bun remove`, `bun add`), re-run
  the grep; it must stay `0`. At the end, `probe 3` must exit 0.
- **Check command**: `grep -c 'socket-firewall.workos.dev' bun.lock`

### Dependencies and Changesets setup

**Pattern to follow**: nicknisi's `.changeset/config.json` at the reference commit (his `access`,
`baseBranch`, `updateInternalDependencies`, and `commit` settings; his `privatePackages` setting is
omitted because this repo has no private workspace packages).

**Overview**: swap the devDependency and write the `.changeset/` folder by hand.

`.changeset/config.json` (verified with 3.0.3; the schema URL returns 200):

```json
{
  "$schema": "https://unpkg.com/@changesets/config@4.0.1/schema.json",
  "baseBranch": "main",
  "access": "public",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "ignore": [],
  "fixed": [],
  "linked": [],
  "updateInternalDependencies": "patch"
}
```

`.changeset/README.md`: the default template from `changesets/changesets`
`packages/cli/default-files/README.md`, verbatim:

```markdown
# Changesets

Hello and welcome! This folder has been automatically generated by `@changesets/cli`, a tool to manage versioning and changelogs. Read the full documentation at https://changesets.dev.

We also have a quick list of common questions to get you started engaging with this project in our [FAQ](https://changesets.dev/faq).
```

(`bun run format` wraps it to the repo's 100-column prose width.)

Root `package.json` scripts to add (alongside `postinstall`):

```json
"changeset": "changeset",
"version": "changeset version",
"release": "bun run check && changeset publish"
```

`release` must be exactly `bun run check && changeset publish`: the workflow test asserts it, and
the contract's mutation probe rewrites that exact string.

**Implementation steps**:

1. `bun remove release-please`, then `bun add -d -E @changesets/cli@3.0.3` (both re-run the hook).
2. Write `.changeset/config.json` and `.changeset/README.md`; do not run `changeset init` (interactive
   in v3; it exits 13 without a TTY).
3. Add the three scripts.
4. `bun run changeset status` must exit 0 on a tree with no package changes.

### release.yml

**Pattern to follow**: nicknisi's `.github/workflows/release.yml` at the reference commit, plus this
repo's existing pins (checkout, setup-node, the npm 11.6.0 pin step, and the Bun install steps from the
current `release.yml`).

**Overview**: one job that opens or updates the version PR, or publishes after the full check.

Target file:

```yaml
name: release

on:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: release-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-24.04
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: "24.8.0"
      - name: Pin npm 11.6.0
        run: npm install -g npm@11.6.0
      - name: Install Bun 1.3.14
        shell: bash
        run: curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.14
      - name: Add Bun to PATH
        run: echo "$HOME/.bun/bin" >> "$GITHUB_PATH"
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Open the version PR or publish
        uses: changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2
        with:
          version-script: bun run version
          publish-script: bun run release
          pr-title: "chore: version packages"
          commit-message: "chore: version packages"
        env:
          NPM_CONFIG_PROVENANCE: "true"
```

**Key decisions**:

- `ae32849d5ba541f9ae29e40e22a623bc13562f51` is the commit behind the annotated `v2.1.2` tag (the tag
  object itself is `66d7d1dd…`; pin the commit).
- v2 input names (`version-script`, `publish-script`, `pr-title`, `commit-message`); v2's
  `github-token` input already defaults to the workflow token, so no `GITHUB_TOKEN` env is needed,
  and v2 never writes `.npmrc`.
- `NPM_CONFIG_PROVENANCE: "true"` must stay a line in this step's `env` block: the contract's
  mutation probe injects a token line next to it.
- Do not mention npm tokens anywhere in the file, including comments: the test scans the whole
  workflow for `NPM_TOKEN`, `NODE_AUTH_TOKEN`, and `_authToken`.
- `create-github-releases` and `push-git-tags` default to true, which produces the
  `@birdcar/<pkg>@<version>` tags and Releases the contract checks.

**Feedback loop**:

- **Playground**: the workflow test plus `actionlint` (installed locally at `/opt/homebrew/bin`; not a
  repo dependency, so it is an implementation-time aid only).
- **Experiment**: after writing the file, `actionlint` reports nothing, `bun test
  tests/release/workflows.test.ts` passes, and `probe 4` passes (it mutates this exact file).
- **Check command**: `actionlint .github/workflows/release.yml && bun test tests/release/workflows.test.ts`

### ci.yml changeset gate

**Pattern to follow**: nicknisi's `Changeset Status` step (it skips `changeset-release/main`, whose
version PR deletes the changesets it consumed) and this file's existing `check` job steps.

**Overview**: a new job; the existing `validate-pr-title` and `check` jobs stay unchanged.

```yaml
  changeset-status:
    if: github.event_name == 'pull_request' && github.head_ref != 'changeset-release/main'
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          fetch-depth: 0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: "24.8.0"
      - name: Install Bun 1.3.14
        shell: bash
        run: curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.14
      - name: Add Bun to PATH
        run: echo "$HOME/.bun/bin" >> "$GITHUB_PATH"
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Require a changeset for package changes
        run: bun run changeset status --since=origin/main
```

`fetch-depth: 0` is required: `--since=origin/main` needs the base branch's history (and it is what
contract criterion 5 checks).

**Feedback loop**:

- **Playground**: the contract's ci.yml parse (criterion 5) and the workflow test's CI case.
- **Experiment**: `probe 5` fails before the job exists (verified: exit 1 on today's tree) and passes
  after; removing `fetch-depth: 0` makes it fail again; `bun test tests/release/workflows.test.ts`
  still passes (the new job's actions are pinned).
- **Check command**: `actionlint .github/workflows/ci.yml && probe 5`

### Workflow test rewrite

**Pattern to follow**: the current `tests/release/workflows.test.ts` (YAML parse, small assert
functions, `structuredClone` negative controls); the prior contract chose "standard YAML parsing and
small assertions" over a workflow simulator.

**Overview**: keep `workflow`, `step`, `assertConventionalPrTitleGate`, the CI test, the PR-title
negative control, and the aggregate-check test (minus `test:release`, `test:release-lock`,
`test:publish`). Delete everything tied to the old shape (`assertSupportedNpm`,
`assertReleasePublicationWiring`, `assertReleaseLockRefreshWiring`, the release-management and
publish-job assertions, and their negative controls) and the now-unused interface fields (`needs`,
`permissions` on `Job`, `outputs`, `workflow_dispatch`). Replace the helpers with three rules that
cover the whole workflow:

```typescript
function assertPinnedUses(candidate: Workflow): void {
  for (const job of Object.values(candidate.jobs)) {
    for (const { uses } of job.steps ?? []) {
      if (uses === undefined || uses.startsWith("./")) continue;
      expect(uses).toMatch(/@[0-9a-f]{40}$/);
    }
  }
}

function assertNoNpmTokenAuth(candidate: Workflow): void {
  expect(YAML.stringify(candidate)).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
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
```

Tests (keep the existing `test(...)` style and names that read as specifications):

1. `CI is read-only, pinned, and covers Linux/macOS Node smoke targets`: unchanged body except
   `assertPinnedUses(ci)` replaces the per-step loop (so the new `changeset-status` job is covered).
2. `release publishes over OIDC only, after the full check, with pinned actions`:
   `assertNoNpmTokenAuth(release)`, `assertCheckBeforePublish(release, root.scripts)`,
   `assertPinnedUses(release)`.
3. `negative controls catch token auth, publish-before-check, unpinned actions, and PR-title
   regressions`:
   - for each of `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `_authToken`: a clone whose changesets step `env`
     gains that key → `assertNoNpmTokenAuth` throws;
   - `root.scripts` with `release` set to `changeset publish && bun run check` →
     `assertCheckBeforePublish` throws;
   - a clone whose changesets step has `publish-script: changeset publish` → throws;
   - a clone whose changesets step `uses` is `changesets/action@v2` → `assertPinnedUses` throws;
   - the existing PR-title control.
4. `aggregate check includes every required verifier`: the existing list without the three removed
   scripts; still rejects `|| true`.

**Feedback loop**:

- **Playground**: `tests/release/workflows.test.ts` itself.
- **Experiment**: after the rewrite, run `probe 4`: it passes on the real files and must fail after
  each of the three mutations (token line injected after `NPM_CONFIG_PROVENANCE:`, changesets/action
  unpinned to `@v2`, release script reversed). Also flip each rule by hand once (for example, drop the
  SHA from `actions/setup-node` in ci.yml) and watch test 1 or 2 fail, then revert.
- **Check command**: `bun test tests/release/workflows.test.ts`

### Release Please removal

**Overview**: delete the seven files, the devDependency (done above), the three scripts and their
`check` entries, the registration check, its fixture, and the README paragraph.

`check` must become exactly:

```text
bun run build && bun run check:workspace && bun run test:boundaries && bun run typecheck && bun run lint && bun run test:services && bun run test:write-for && bun run test:execution && bun run test:pi && bun run check:package && bun run test:ci && bun run check:docs
```

**Implementation steps**:

1. `git rm` the seven files in the Deleted Files table.
2. In `scripts/check-workspace.ts`, delete the `validateReleaseRegistration(manifests, rootDir, errors);`
   call (line 84) and the `readReleasePackagePaths` and `validateReleaseRegistration` functions
   (lines 120-160). `objectValue` and `existsSync` stay (still used elsewhere).
3. In `tests/tooling/workspace.test.ts` `fixtureRoot`, delete the `releasePackages` loop and the
   `release-please-config.json` write (lines 34-48); every test case stays.
4. Remove the three scripts from `package.json` and update `check`.
5. `bun run check:workspace` and `bun test tests/tooling/workspace.test.ts` must pass.

**Feedback loop**:

- **Playground**: `bun test tests/tooling/workspace.test.ts`
- **Experiment**: the "accepts the actual workspace after build" case passes with no
  `release-please-config.json` present, and the duplicate-name, range, exports, and license rejection
  cases still fail as expected.
- **Check command**: `bun test tests/tooling/workspace.test.ts && bun run check:workspace`

### Package metadata

**Overview**: provenance requires `repository.url` to match the source repository.

`packages/services/package.json` (after `license`):

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/birdcar/pi-extensions.git",
  "directory": "packages/services"
},
```

`packages/write-for/package.json`: the same `repository` with `"directory": "packages/write-for"`,
plus (Full tier) `"keywords": ["pi", "pi-coding-agent", "pi-package"]`. pi-services gets no keywords:
it is a library, not a Pi package (no `pi` manifest, by design).

### Docs, AGENTS.md, and the go-live changeset

**Overview**: nicknisi-style short docs that explain the flow, the bootstrap, and the rules.

`docs/releasing.md` target content (adjust wording freely; keep every fact):

```markdown
# Releasing

Every public package under `packages/*` is versioned and published independently with
[Changesets](https://changesets.dev). Publishing happens in GitHub Actions through npm trusted
publishing (OIDC), so every version after a package's first carries a provenance attestation and no
npm token exists anywhere.

## With every change

Add a changeset for any user-facing change to a package: run `bun changeset`, pick the packages and
the bump, and commit the generated file with your change. Docs, config, and CI-only changes don't
need one. CI fails a pull request that changes a package without a changeset.

## What happens on merge

[release.yml](../.github/workflows/release.yml) runs on every push to `main`:

- While changesets are pending, it opens or updates the `chore: version packages` pull request, which
  bumps versions, writes each package's changelog, and removes the consumed changesets.
- Merging that pull request runs `bun run release`: `bun run check`, then `changeset publish`. Every
  version npm does not have yet is published with provenance, tagged `@birdcar/<package>@<version>`,
  and given a GitHub Release.

GitHub does not run CI on the version pull request because it is opened with the workflow token, so
the release job runs the full check suite itself before publishing. If a publish fails, fix the cause
and merge to `main` again: `changeset publish` retries any version missing from npm.

## First-time setup and new packages

npm can only attach a trusted publisher to a package that already exists. Run
[scripts/setup-trusted-publishing.sh](../scripts/setup-trusted-publishing.sh) once before the first
release and again whenever a package is added. It logs in to npmjs.org if needed, runs
`bun run check`, publishes any package that is not on npm yet, attaches the release workflow as each
package's trusted publisher, and lets GitHub Actions open pull requests. It is safe to re-run.

## Rules

- npm authentication in workflows is OIDC only: never add an npm token, `NODE_AUTH_TOKEN`, or a
  token-bearing `.npmrc` to CI.
- Pin every action to a full commit SHA.
- Keep `bun.lock` registry-neutral: the root `postinstall` hook blanks the tarball URLs a local
  registry proxy records, so GitHub-hosted runners install from the public registry. Don't install
  with `--ignore-scripts`.
```

`AGENTS.md`, "Development workflow", after the `bun.lock` bullet:

```markdown
- Add a changeset for any user-facing change to a package: run `bun changeset`, pick the packages and
  bump, and commit the generated file with your change. No changeset means no release; docs, config,
  and CI-only changes don't need one.
```

`README.md`, replace the "Packages and releases" section body with:

```markdown
Add packages under `packages/*`. Public packages use `@birdcar/pi-*`, include their own README and
LICENSE, and declare service contracts without a central registry. Each public package is versioned
and published independently with Changesets: add a changeset (`bun changeset`) with any user-facing
package change; root-only maintenance releases nothing.

Releases publish to npm from GitHub Actions with provenance. See [docs/releasing.md](docs/releasing.md)
for the flow and the one-time trusted-publishing setup.
```

`.changeset/publish-from-ci.md`:

```markdown
---
"@birdcar/pi-services": patch
"@birdcar/pi-write-for": patch
---

Publish from GitHub Actions with npm provenance and add repository metadata.
```

**Key decisions**:

- `scripts/check-docs.ts` resolves markdown links and any backticked path ending in `.ts`, `.md`,
  `.json`, `.yml`, or `.yaml` relative to the doc. Link files instead of backticking them, and never
  backtick a non-existent path such as a package changelog, `package.json` from inside `docs/`, or a
  bare workflow filename. The bootstrap script must be a markdown link: backticked `.sh` paths are
  not checked.
- No doc, changeset, or code comment may contain "release-please" or "release please" (contract
  criterion 2), including "replaces Release Please" phrasing.

**Feedback loop**:

- **Playground**: `scripts/check-docs.ts` and prettier.
- **Experiment**: after writing each doc, run the check; then temporarily backtick a missing path
  (for example a package changelog) in `docs/releasing.md`, confirm `check:docs` reports it, and
  revert. After all edits, `probe 2` finds no Release Please mention.
- **Check command**: `bun run check:docs && bunx prettier --check README.md AGENTS.md docs/releasing.md .changeset`

## Testing Requirements

### Unit Tests

| Test File                          | Coverage                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `tests/release/workflows.test.ts`  | CI policy, the three release rules with negative controls, the aggregate check. |
| `tests/tooling/workspace.test.ts`  | Unchanged cases on a fixture without Release Please config.              |

**Key test cases**:

- The real release.yml and root scripts satisfy all three rules.
- Each of the three token names injected into the changesets step fails the token rule.
- A reversed release script, or a changesets step that bypasses `bun run release`, fails the order
  rule.
- An unpinned changesets/action fails the pin rule (not only `actions/*`).
- The new `changeset-status` job's actions are pinned.
- The aggregate `check` lists every remaining verifier and never `|| true`.

### Integration Tests

The contract's probes, run with `probe <n>` during implementation and unchanged at acceptance:
criterion 3 (lockfile neutrality with a real `bun add`), 4 (mutation probe), 5 (ci.yml parse),
6 (major-bump dependent range), and 7 (changeset gate negative and positive).

### Manual Testing

- [ ] None in this phase; the go-live gate exercises the real pipeline.

## Error Handling

| Error Scenario                                           | Handling Strategy                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `bun add`/`bun remove` rewrites proxy URLs               | The postinstall hook re-blanks them; criterion 3 fails loudly if it ever does not.                            |
| `bun run check` fails in the release job                 | changesets/action stops before `changeset publish`; fix on main, and the next push retries the publish.       |
| changesets/action cannot open the version PR             | The Actions pull-request setting is off; the phase 1 bootstrap enables it (go-live gate).                     |
| `npm publish` rejected by OIDC in CI                     | Trusted publisher missing or filename mismatch; re-run the bootstrap, then re-run the failed release job.     |
| Provenance rejected (E422 repository mismatch)           | `repository.url` must be exactly `git+https://github.com/birdcar/pi-extensions.git` with the right `directory`. |
| `changeset status` fails on a docs-only PR               | Should not happen (only package files count); if it does, check the job's `fetch-depth: 0`.                   |

## Failure Modes

| Component             | Failure Mode                       | Trigger                                                                   | Impact                                                            | Mitigation                                                                                   |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Lockfile hook         | Hook skipped                       | Someone installs with `--ignore-scripts`                                  | Proxy URLs committed; every runner install 401s                   | docs/releasing.md rule; criterion 3 fails locally.                                            |
| Lockfile hook         | Legitimate URL blanked             | A future hook generalized to all hosts                                    | GitHub-hosted tarball deps break                                  | Hook matches only the proxy host.                                                            |
| Lockfile hook         | Machine firewall bypassed          | Someone "fixes" install errors by editing `~/.npmrc` or registry env vars | Managed supply-chain protection disabled, possible policy breach  | Never touch registry config; the neutral lockfile keeps local installs on the firewall (verified). |
| release.yml           | Unverified publish                 | `publish-script` or `release` reordered or bypassed                       | Broken package published, immutable                               | Rule 2 plus its negative controls; the mutation probe.                                       |
| release.yml           | Token creeps in                    | An `NPM_TOKEN` env or `.npmrc` step added "to fix" an OIDC error          | Long-lived credential, provenance bypass                          | Rule 1 scans the whole workflow.                                                             |
| release.yml           | Empty tarball                      | `dist/` missing at publish time                                           | Package with no code                                              | `bun run check` builds and validates tarballs right before `changeset publish`.              |
| release.yml           | Version PR without CI merged broken | GITHUB_TOKEN PRs trigger no workflows                                    | Main holds a bad bump until the publish check fails               | Publish gated on `bun run check`; the next push retries.                                     |
| ci.yml gate           | Gate never runs                    | Wrong `if:` or missing `fetch-depth: 0`                                   | Forgotten changesets never release                                | Criterion 5 parses ci.yml; nicknisi's `head_ref` guard only skips the version PR.            |
| Changesets config     | Scoped packages published private  | `access` left at the v3 default `restricted`                              | First CI publish fails or publishes restricted                    | `"access": "public"` (packages also carry `publishConfig.access: public`).                   |
| Changesets dependents | Out-of-range helper bump           | pi-services minor/major bump pre-1.0                                      | Without range updates bun 404s                                    | `updateInternalDependencies: patch` (criterion 6).                                           |
| Docs                  | check:docs failure                 | A backticked non-existent `.md`/`.json`/`.yml` path                       | `bun run check` red                                               | Link or reword (see Key decisions above).                                                    |
| Workflow test         | Stale aggregate list               | `check` edited without updating the test                                  | Test red                                                          | Update both together; the test is the guard.                                                  |

## Validation Commands

```bash
# Fast loop
bun test tests/release/workflows.test.ts
bun test tests/tooling/workspace.test.ts
actionlint .github/workflows/ci.yml .github/workflows/release.yml

# Formatting (run after writing docs, .changeset files, and JSON)
bun run format

# Full suite (about 46 s)
bun run check

# Contract probes against the working tree (define snap/probe from the Feedback Strategy first)
probe 2; probe 3; probe 4; probe 5; probe 6; probe 7

# Criterion list for reference (runs nothing)
node "$(find ~/.claude/plugins -path '*ideation*/scripts/verify.mjs' | head -1)" docs/ideation/2026-09-23-changesets-release/contract-data.json --list
```

## Rollout Considerations

- **Feature flag**: none. The pipeline activates when this branch merges; the go-live gate orders the
  bootstrap before that merge so the first release run opens the version PR cleanly.
- **Monitoring**: the `release` workflow's runs and the npm package pages (provenance badge).
- **Alerting**: none beyond GitHub's failed-run notifications.
- **Rollback plan**: before go-live, revert the merge. After go-live, npm versions are immutable:
  fix forward with a new changeset.
- **Commits**: conventional commits (for example `chore(release): switch to changesets`); no
  Co-Authored-By trailer.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
