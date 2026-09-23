# Changesets Release Pipeline Contract

**Created**: 2026-09-23
**Readiness**: All 5 gates ready
**Status**: Approved
**Approval**: Express — single consolidated confirmation, no per-artifact review
**Supersedes**: None

## Problem Statement

The maintainer (birdcar) cannot publish @birdcar/pi-services or @birdcar/pi-write-for today. The Release Please pipeline built on 2026-09-22 (release-please-config.json, a manifest, scripts/release.ts and scripts/publish.ts, four release test files, and a GitHub App-driven release.yml, about 2,300 lines in total) has never run: RELEASE_ENABLED is unset, no GitHub App or secrets exist, the manifest is {}, and GitHub Actions has recorded zero runs on the repository.

Switching that pipeline on would mean creating and maintaining a GitHub App plus bespoke publish-planning code whose guards (tag and SHA validation, exact-tag recovery, tarball-integrity planning) a solo-maintainer, primarily personal set of extensions does not need. The maintainer wants releases to be as straightforward and painless as possible, using the Changesets plus npm trusted publishing system nicknisi runs at scale across 30+ packages in nicknisi/pi-extensions.

Intake and critic review surfaced four blockers the current plan never handled: npm cannot attach a trusted publisher to a package that does not exist yet (npm/cli#8544), so the first version must be published interactively; the repository setting that lets GitHub Actions create pull requests is off, so a Changesets version PR could not be opened; neither package declares the repository metadata npm provenance requires; and every bun.lock tarball URL points at the maintainer's authenticated corporate registry proxy (HTTP 401 to anonymous requests), so no GitHub-hosted runner could install dependencies.

## Goals

1. Go live: @birdcar/pi-services and @birdcar/pi-write-for exist on npm, every version after the bootstrap's 0.1.0 is published by release.yml over OIDC with a provenance attestation (the repository is public, which provenance requires), and no npm token exists in the repository or its GitHub secrets.
2. Hands-off releases: merging a PR that carries a changeset opens or updates a 'chore: version packages' PR, and merging that PR publishes exactly the bumped packages and creates their git tags and GitHub Releases with no manual step.
3. One-command setup: scripts/setup-trusted-publishing.sh publishes any package missing from npm, attaches the release.yml trusted publisher with direct-publish permission, and lets GitHub Actions create pull requests; a second run changes nothing.
4. Release Please is gone: its config, manifest, scripts, tests, and devDependency are deleted, and no file outside docs/ideation/ mentions it.
5. Safety rails hold: CI fails a PR that changes packages/* without a changeset, release.yml cannot publish unless bun run check passes in the same job, and tests/release/workflows.test.ts fails if an npm token, a publish-before-check ordering, or an unpinned action is introduced.

## Success Criteria

- [ ] The repository's full local verification suite passes with Release Please removed and Changesets in place. — check: `bun run check` → exits 0 (about 46 s on the current tree)
- [ ] No Release Please file or reference remains outside the ideation archive. — check: `test -z "$(git grep -il -e release-please -e 'release please' -- ':!docs/ideation')" && for f in release-please-config.json .release-please-manifest.json scripts/release.ts scripts/publish.ts tests/release/manifest.test.ts tests/release/lockfile.test.ts tests/release/publish.test.ts; do test ! -e "$f" || exit 1; done` → exits 0
- [ ] bun.lock is registry-neutral, and the postinstall hook keeps it neutral when a dependency is added locally. — check: `test "$(grep -c 'socket-firewall.workos.dev' bun.lock)" = 0 && d=$(mktemp -d) && git worktree add -q --detach "$d" HEAD && (cd "$d" && bun install --frozen-lockfile >/dev/null 2>&1 && bun add -d is-number@7.0.0 >/dev/null 2>&1 && test "$(grep -c 'socket-firewall.workos.dev' bun.lock)" = 0); s=$?; git worktree remove --force "$d"; exit $s` → exits 0
- [ ] The workflow test enforces the three release rules: it passes on the real files and fails after each of three mutations (an injected npm token in release.yml, changesets/action unpinned to a tag, and changeset publish moved ahead of bun run check in the release script). — check: `d=$(mktemp -d) && git worktree add -q --detach "$d" HEAD && (cd "$d" && bun install --frozen-lockfile >/dev/null 2>&1 && t() { bun test tests/release/workflows.test.ts >/dev/null 2>&1; } && t && perl -pi -e 's/^(\s*)(NPM_CONFIG_PROVENANCE:.*)/$1$2\n$1NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}/' .github/workflows/release.yml && ! t && git checkout -q . && perl -pi -e 's#changesets/action\@[0-9a-f]{40}#changesets/action\@v2#' .github/workflows/release.yml && ! t && git checkout -q . && perl -pi -e 's/bun run check && changeset publish/changeset publish && bun run check/' package.json && ! t); s=$?; git worktree remove --force "$d"; exit $s` → exits 0
- [ ] ci.yml runs changeset status --since=origin/main in a job whose checkout fetches full history. — check: `node -e 'const Y=require("yaml"),f=require("node:fs");const ok=Object.values(Y.parse(f.readFileSync(".github/workflows/ci.yml","utf8")).jobs).some(j=>(j.steps??[]).some(s=>/changeset status --since=origin\/main/.test(s.run??""))&&(j.steps??[]).some(s=>/^actions\/checkout@/.test(s.uses??"")&&s.with?.["fetch-depth"]===0));process.exit(ok?0:1)'` → exits 0
- [ ] An out-of-range helper bump keeps installs green: a major pi-services changeset plus changeset version moves pi-write-for's range to the new pi-services version, and the frozen install still passes. — check: `d=$(mktemp -d) && git worktree add -q --detach "$d" HEAD && (cd "$d" && bun install --frozen-lockfile >/dev/null 2>&1 && printf -- '---\n"@birdcar/pi-services": major\n---\n\nprobe\n' > .changeset/zz-probe-major.md && bunx changeset version >/dev/null 2>&1 && v=$(node -p 'require("./packages/services/package.json").version') && grep -qF "\"@birdcar/pi-services\": \"^$v\"" packages/write-for/package.json && bun install --frozen-lockfile >/dev/null 2>&1); s=$?; git worktree remove --force "$d"; exit $s` → exits 0
- [ ] Under this repo's Changesets config, an uncovered package change fails changeset status, and adding a changeset makes it pass. — check: `d=$(mktemp -d) && git worktree add -q --detach "$d" HEAD && (cd "$d" && bun install --frozen-lockfile >/dev/null 2>&1 && g() { git -c user.name=probe -c user.email=probe@example.invalid -c commit.gpgsign=false "$@"; } && find .changeset -name '*.md' ! -name README.md -exec git rm -q {} + && g commit -q --allow-empty -m probe-base && echo '// probe' >> packages/services/src/index.ts && g commit -qam probe-change && ! bunx changeset status --since=HEAD~1 >/dev/null 2>&1 && printf -- '---\n"@birdcar/pi-services": patch\n---\n\nprobe\n' > .changeset/zz-probe-patch.md && git add .changeset/zz-probe-patch.md && g commit -qm probe-changeset && bunx changeset status --since=HEAD~2 >/dev/null 2>&1); s=$?; git worktree remove --force "$d"; exit $s` → exits 0
- [ ] The bootstrap script passes shellcheck. — check: `shellcheck scripts/setup-trusted-publishing.sh` → exits 0
- [ ] After go-live: the latest version of each package on npm carries a provenance attestation. — check: `for p in pi-services pi-write-for; do npm view "@birdcar/$p" dist.attestations.provenance.predicateType --registry=https://registry.npmjs.org | grep -q 'slsa.dev/provenance' || exit 1; done` → exits 0
- [ ] After go-live: a release.yml run succeeded, each package has a Changesets GitHub Release, and a merged version PR is titled 'chore: version packages'. — check: `gh run list -R birdcar/pi-extensions --workflow release.yml --status success --limit 20 --json databaseId --jq length | grep -qv '^0$' && for p in pi-services pi-write-for; do gh release list -R birdcar/pi-extensions --limit 50 --json tagName --jq '.[].tagName' | grep -q "^@birdcar/$p@" || exit 1; done && gh pr list -R birdcar/pi-extensions --state merged --head changeset-release/main --json title --jq '.[].title' | grep -qx 'chore: version packages'` → exits 0
- [ ] After go-live: GitHub Actions may create pull requests, no npm-related secret exists on the repository, and ci.yml has run on a pull request. — check: `test "$(gh api repos/birdcar/pi-extensions/actions/permissions/workflow --jq .can_approve_pull_request_reviews)" = true && test "$(gh api repos/birdcar/pi-extensions/actions/secrets --jq '[.secrets[].name | select(test("npm|node_auth";"i"))] | length')" = 0 && gh run list -R birdcar/pi-extensions --workflow ci.yml --event pull_request --limit 5 --json databaseId --jq length | grep -qv '^0$'` → exits 0
- [ ] Re-running the bootstrap after go-live changes nothing. — judgment call: The maintainer records `npm view @birdcar/<pkg> versions --registry=https://registry.npmjs.org` and each package's trusted-publisher list, re-runs scripts/setup-trusted-publishing.sh after go-live, and confirms both are unchanged.

## Scope Boundaries

### In Scope

- Changesets 3.x setup: pinned @changesets/cli devDependency; .changeset/config.json with nicknisi's settings on the v3 schema (public access, baseBranch main, updateInternalDependencies patch, no auto-commit); root scripts changeset, version (changeset version), and release (exactly bun run check && changeset publish). — Goals 2 and 5: the version/publish commands the action calls, with the check-before-publish rail built into release.
- Rewrite .github/workflows/release.yml on changesets/action v2: push to main; SHA-pinned actions; GITHUB_TOKEN opening a version PR titled 'chore: version packages'; contents and pull-requests write plus id-token write; pinned Node 24 with npm >= 11.5.1; bun install --frozen-lockfile; publish via bun run release with NPM_CONFIG_PROVENANCE set in the step env; no npm token. — Goals 1, 2, and 5.
- Add a changeset status --since=origin/main step to ci.yml for pull requests (full-history checkout), skipped on the changeset-release/main branch. — Goal 5: a package change without a changeset fails CI.
- Make bun.lock registry-neutral: blank the WorkOS Socket Firewall tarball URLs and add a root postinstall hook that re-blanks them after every local install, add, or remove; local installs keep routing through the firewall and the machine's registry config is untouched. — Goals 1 and 2: the proxy returns 401 to anonymous requests, so GitHub-hosted runners cannot install from today's bun.lock.
- Remove Release Please: release-please-config.json, .release-please-manifest.json, scripts/release.ts, scripts/publish.ts, tests/release/{manifest,lockfile,publish}.test.ts, the release-please devDependency, the test:release, test:release-lock, and test:publish scripts and their entries in check, check-workspace's release-registration cross-check and its fixture, and the README paragraph. — Goal 4.
- Rewrite tests/release/workflows.test.ts: keep the ci.yml and check-aggregate assertions (minus the removed scripts) and replace the release.yml assertions with the three rules, checked across the whole release.yml and the release script, plus negative controls. — Goal 5.
- Add repository metadata (url and directory) to both package.json files. — Goal 1: npm provenance requires repository.url to match the source repository, and both packages lack it.
- Add scripts/setup-trusted-publishing.sh adapted from nicknisi's script: every npm call passes --registry=https://registry.npmjs.org/ (npm login when not logged in); npm trust always runs through a pinned npx npm@11.15+; bun run check; publish each package that does not exist on npm yet, pi-services then pi-write-for, with public access; npm trust github --allow-publish unless already attached; allow Actions to create pull requests via gh api; idempotent. — Goal 3.
- Rewrite docs/releasing.md in nicknisi's short style, linking the bootstrap script with a markdown link. — Goal 4: the current text names Release Please, which criterion 2 rejects; the markdown link lets check:docs verify the script path.
- Add nicknisi's changeset rule to AGENTS.md. — Goal 2: agent-authored PRs need a changeset to release and to pass the CI gate.
- Include a patch changeset for both packages in the implementation PR. — It becomes the pipeline's first CI release (0.1.1), the go-live vehicle.
- Go-live gate (maintainer): confirm CI runs on the implementation PR, run the bootstrap from that branch, merge, then merge the version PR. — Goals 1-3 can only be proven by a real release.
- Add nicknisi's keywords (pi, pi-coding-agent, pi-package) to pi-write-for's package.json. — A deliberate one-line add-on riding the go-live patch changeset: matches his package convention and makes the extension discoverable through Pi's pi-package search.

### Out of Scope

- A GitHub App or PAT so version PRs trigger CI. — The release job runs bun run check before publishing instead.
- The manual exact-tag recovery workflow_dispatch path. — changeset publish republishes any version missing from npm on the next push to main.
- The RELEASE_ENABLED gate and the npm-publish environment. — nicknisi has neither, and running the bootstrap before merge leaves the first release run nothing to fail on.
- A bun.lock refresh step in the version PR. — A lockstep bump leaves bun.lock byte-identical and the frozen install passes (tested in a scratch copy).
- Branch protection, required status checks, and merge-method settings. — Repository policy outside release tooling; required checks would block the version PR, which never gets CI.
- nicknisi's smoke job and separate lint-pr-title workflow. — The existing test:pi/check:package matrix legs and ci.yml's validate-pr-title job already cover them.
- Provenance for the bootstrap's 0.1.0 release. — npm cannot attach a trusted publisher before a package exists (npm/cli#8544), so the first version is published interactively.
- npm's 'Require two-factor authentication and disallow tokens' package setting. — Not part of nicknisi's setup; kept as a future consideration.
- @changesets/changelog-github or a custom tag format. — nicknisi uses the default changelog, and Changesets' tag format is not configurable.
- A line budget for the replacement tooling. — The user chose removal of Release Please over a size target.

### Future Considerations

- Enable npm's 'Require two-factor authentication and disallow tokens' on both packages once OIDC publishing is proven.
- Revisit required status checks only if version PRs start receiving CI (for example via a GitHub App token).

## Decisions Considered and Rejected

- **Replace the unactivated Release Please pipeline with nicknisi's Changesets plus npm trusted publishing model.** — rejected: Activate the existing Release Please pipeline (create the GitHub App, set RELEASE_ENABLED).. It would keep about 2,300 lines of release code and a GitHub App to maintain for guards a solo-maintainer, primarily personal repo does not need.
- **Adopt nicknisi's model nearly verbatim and delete the custom publish tooling.** — rejected: Changesets wrapped in the existing custom publish guards (tag/SHA validation, exact-tag recovery, tarball-integrity planning).. Keeping the guards keeps the maintenance burden that motivated the switch.
- **Keep publishing to npm.** — rejected: Git-only installs with no npm publishing.. The user wants npm distribution.
- **The contract ends at a maintainer go-live gate: both packages live on npm with provenance and one real version-PR-to-publish cycle observed.** — rejected: Stop at the merged pipeline PR.. Only a real release proves the pipeline works, and GitHub Actions has never run on this repository.
- **release.yml runs bun run check in the same job before changeset publish.** — rejected: Accept that version PRs get no CI (publish after build only, as nicknisi does), or store a fine-grained PAT so version PRs trigger CI.. Version PRs opened with GITHUB_TOKEN never trigger CI; gating the publish keeps unverified trees from shipping without a long-lived secret, and a failed publish retries on the next push to main because changeset publish publishes any version missing from npm.
- **Measure the tooling reduction as removal of Release Please and its custom scripts, with no size cap on the replacement.** — rejected: A 300-line budget for release-specific files, or matching nicknisi's roughly 150-line footprint with no tests.. The user wants removal, not a size target.
- **Accept per-PR changeset files and one combined 'chore: version packages' PR, reversing the 2026-09-21 monorepo contract's rejection of Changesets.** — rejected: Switch but skip CI's changeset status enforcement, or keep Release Please for the earlier reasons.. Less tooling outweighs the authoring cost; versions stay independent inside the combined PR, and the CI gate catches forgotten changesets that would otherwise never release.
- **Use Changesets' default dependent handling (updateInternalDependencies: patch): a helper bump that leaves pi-write-for's range updates the range and patch-bumps pi-write-for, while in-range helper bumps leave it alone.** — rejected: The 2026-09-21 contract's explicit fix(deps) consumer updates with no automatic dependent bumps.. Tested in a scratch copy: with pi-services at 0.2.0 and pi-write-for still on ^0.1.0, both bun install --frozen-lockfile and --lockfile-only fail with a registry 404.
- **The version script is plain changeset version, with no bun.lock refresh.** — rejected: changeset version && bun install --lockfile-only, or the old release-PR lock-refresh step.. Tested: a lockstep bump of both packages leaves bun.lock byte-identical and the frozen install passes, so there is nothing to refresh.
- **tests/release/workflows.test.ts keeps its ci.yml assertions and asserts three release.yml rules: no npm tokens, bun run check before changeset publish, every action SHA-pinned.** — rejected: Keep only the ci.yml assertions, or also add a fixture test that runs changeset version.. Keeps the OIDC-only and check-before-publish decisions from silently regressing; the Changesets and Bun interplay is covered by acceptance probes and again at go-live.
- **Delete check-workspace's release-registration cross-check and its release-please-config fixture.** — rejected: Port the check to read .changeset/config.json.. Under Changesets every non-private workspace package is releasable, so there is nothing to register.
- **Accept Changesets' tag format (@birdcar/<pkg>@<version>) and its GitHub Releases.** — rejected: Keep the <component>-v<version> tags from release-please-config.json.. Changesets' tag format is not configurable, and no tags exist yet, so nothing migrates.
- **nicknisi's choices win by default; deviate only where this repo forces it or the user explicitly chooses otherwise.** — rejected: Bespoke hardening beyond nicknisi's setup.. The user's stated priority: his system is tested at scale, these extensions are primarily for the user, and maintenance must stay painless.
- **Remove the RELEASE_ENABLED gate and the npm-publish environment.** — rejected: Keep them as an activation guard.. nicknisi has neither, and running the bootstrap before merge leaves the first release run nothing to fail on.
- **Use the current Changesets majors: @changesets/cli 3.x and changesets/action v2.** — rejected: nicknisi's exact pins, @changesets/cli 2.31.1 and changesets/action v1.. Avoids a forced major migration later; this is the one deliberate version deviation from his setup.
- **Go-live order: the implementation PR carries a patch changeset for both packages, the bootstrap runs from that branch before merge, merging opens the version PR, and merging that publishes 0.1.1 from CI.** — rejected: Merge first and bootstrap afterward (the first release run fails to open the version PR and must be re-run), or an empty changeset (go-live waits for another real change).. Fewest manual steps, which is the user's criterion.
- **The bootstrap handles its own prerequisites: it passes --registry=https://registry.npmjs.org/ on every npm call, runs npm login when not logged in, and always runs npm trust through a pinned npx npm@11.15+.** — rejected: nicknisi's preflight, which exits with instructions, or a version-compare branch that uses the local npm when new enough.. Fewest manual steps: the local npm is 11.11.0 and points at a corporate registry proxy, and a bash version comparison would be an untested branch with no current user.
- **Set NPM_CONFIG_PROVENANCE=true on the publish step.** — rejected: Rely on trusted publishing's documented automatic provenance.. A 2026 report found provenance had to be forced, and a version published without it cannot be republished.
- **Make bun.lock registry-neutral and keep it that way with a root postinstall hook that blanks WorkOS Socket Firewall tarball URLs (critic blocker fix; previously the plan assumed the committed lockfile would install on GitHub runners).** — rejected: Keep the proxy URLs (the proxy returns 401 to anonymous requests), give CI a proxy credential, or pin this repo's registry to npmjs (bypasses the machine's managed firewall).. Tested in a scratch clone with an empty cache: the neutral lockfile frozen-installs, every local download still goes through the firewall (416 of 416 registry fetches), and the hook keeps the lockfile neutral through bun add and bun remove, which otherwise rewrite all 466 entries to proxy URLs.
- **Prove the three workflow rules with a mutation probe that edits release.yml and package.json in a temp worktree and requires the workflow test to fail after each edit (critic blocker fix; previously the criterion was bun test exiting 0).** — rejected: Accept bun test tests/release/workflows.test.ts exiting 0.. verify.mjs reads only exit codes and the current test already passes, so a rewrite that dropped the release.yml assertions would still pass; the existing helpers also miss changesets/action and any job not named publish.
- **Check the ci.yml changeset step with an acceptance-time parse of ci.yml, keeping the rewritten workflow test to the three release.yml rules (critic blocker fix; previously only a direct changeset status probe covered the gate).** — rejected: Rely on the direct changeset status probe alone, or add a fourth assertion to workflows.test.ts.. The direct probe passes even with ci.yml untouched, and the user limited the rewritten test to the three release.yml rules.

## Execution Plan

_Added during Phase 5 handoff. Pick up this contract cold and know exactly how to execute._

### Dependency Graph

```
Trusted-publishing bootstrap script
  └── Swap Release Please for Changesets  (blocked by Trusted-publishing bootstrap script)
        └── Go-live  (blocked by Swap Release Please for Changesets)
```

### Execution Steps

**Run the project** (recommended) — autopilot reads this contract, plans dependency waves, runs independent phases in parallel, and gates on failure:

```bash
/ideation:autopilot docs/ideation/2026-09-23-changesets-release/contract.md
```

**Or run it unattended** — a `/goal` is a durability wrapper around the same autopilot run: Claude re-checks the condition before it is allowed to stop, so failures get repaired and re-run. Generated by `contract-gen --print-goal`; this is the only copy of that string:

```
/goal Drive the Changesets Release Pipeline contract (2026-09-23-changesets-release) to completion with /ideation:autopilot.

1. Run `/ideation:autopilot docs/ideation/2026-09-23-changesets-release/contract.md`. All commits belong on branch ideation/2026-09-23-changesets-release — switch to it before any run.
2. It dispatches a BACKGROUND workflow. Wait for the completion notification — never start a second autopilot run while one is in flight.
3. Then run the ideation plugin's `scripts/verify.mjs` against `docs/ideation/2026-09-23-changesets-release/contract-data.json` and leave its VERIFY line in the conversation. Resolve the plugin's install directory first — `${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs` is a placeholder, not a shell variable, and bash will not expand it. That line is the only evidence this goal is judged on.
4. If anything failed, fix the spec or the implementation and go back to step 1. Autopilot skips phases that already have commits.

Done when the most recent VERIFY line reads fail=0 and commits=2/2 — or when two consecutive VERIFY lines are identical and still failing, in which case name the failing checks and stop, because a contract whose checks have rotted must not trap the run.
```

**Or run phases manually** in dependency order:

**Strategy**: Sequential on one branch: the bootstrap script first, then the pipeline swap (docs/releasing.md links the script with a markdown link, which check:docs resolves), then the maintainer go-live gate. Run this contract in watch mode: the after-go-live criteria cannot pass until the gate completes. Reference implementation: nicknisi/pi-extensions@20391a18b2c87bb0510ea1f0cd1ac0b33192f0c1.

1. **Phase 1** — Trusted-publishing bootstrap script _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/2026-09-23-changesets-release/spec-phase-1.md
   ```

2. **Phase 2** — Swap Release Please for Changesets _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/2026-09-23-changesets-release/spec-phase-2.md
   ```

3. **Phase 3** — Go-live _(blocking)_

   ```bash
   # Review: Go-live
   ```

---

_This contract was generated from brain dump input. Review and approve before proceeding to specification._
