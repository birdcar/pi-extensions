# Implementation Spec: Pi Extension Monorepo Foundation — Phase 3

**Contract**: [contract.md](./contract.md)
**Phase**: Independent releases and contributor handoff
**Approved scope**: Full, including macOS CI
**Prerequisite**: Service discovery and Pi lifecycle proof
**Estimated effort**: L

## Technical Approach

Use Release Please manifest mode for independent package releases. Configure separate release PRs, component-prefixed tags, per-package changelogs, and versions inferred from conventional commits affecting the package. The root and test fixtures remain private. Start with only `packages/services`; tests use additional synthetic packages to prove the monorepo behavior without shipping fake extensions.

Use the maintainer's existing **npm trusted publishing** approach exclusively. The actual `npm publish` operation authenticates through GitHub Actions OIDC, not an npm token, GitHub token, or fallback registry credential. GitHub credentials used by Release Please to manage PRs, commits, and tags are a separate repository-automation concern and are never passed to npm as authentication. This project configures and locally validates the workflow; it does not modify accounts, create a remote, push, or publish.

Prefer two workflow files and a few small scripts over a release framework: `ci.yml` for ordinary checks and `release.yml` for release PR management, lockfile refresh, validated artifact publication, and exact-tag recovery. Publish only the verified artifact for paths reported released, not every workspace or every unpublished registry version. Keep recovery limited to rerunning a known release tag.

## Decisions Considered and Rejected

- **Generated release-PR merge triggers publication** — rejected: publication after every feature merge. The release PR is the user-selected approval boundary.
- **Release Please manifest mode with independent package PRs/tags** — rejected: Changesets and lockstep versions. Independent semver is supported without another release-intent file format.
- **Ordinary semver ranges and explicit consumer `fix(deps)` updates** — rejected: `node-workspace`/`linked-versions` automatic propagation and bundling the helper into extensions.
- **npm OIDC trusted publishing only** — rejected: `NPM_TOKEN`, `NODE_AUTH_TOKEN`, reusing GitHub credentials for registry authentication, or a token fallback when OIDC fails. The user already uses trusted publishing; no token migration is needed.
- **Direct npm publication after the release PR** — rejected: silently adding a second approval through npm staged publishing. Confirm the package's trusted-publisher binding permits direct `npm publish`.
- **Ready-to-connect files and local tests** — rejected: account setup, remote creation, pushes, or a real first release in this project.
- **Minimal exact-tag recovery** — rejected: both a general release-state engine and deferring all recovery safeguards. npm versions are immutable and retry behavior must distinguish already-published from authentication/network failure.
- **Direct workflow assertions with standard YAML parsing** — rejected: a custom workflow simulator or extensive synthetic-workflow fixture framework.
- **Pinned Bun and explicit release-PR lock refresh** — rejected: assuming Release Please updates `bun.lock`. Its Node strategy manages npm lockfiles, not the Bun lockfile.
- **One aggregate containing every verifier** — rejected: excluding `test:release-lock` or `test:publish` while claiming complete validation.
- **Artifact inspection proves no bundled Pi** — rejected: treating type/lint success as a packaging assertion.
- **Human docs and mandatory architectural references** — rejected: a dedicated scaffolding CLI/skill or undocumented setup assumptions.
- **Date-prefixed ideation directories and MIT licensing** — rejected: undated planning paths and alternative/deferred licenses.

## Feedback Strategy

**Inner-loop command**: `bun test tests/release/publish.test.ts tests/release/workflows.test.ts`

**Playground**: Pure release/publication planning tests, real pinned Release Please against mocked GitHub data, and temporary Bun workspaces for lockfile behavior.

**Why this approach**: Release behavior is testable without publication credentials. Small assertions and mocked process boundaries give fast feedback; real upstream manifest generation and real frozen installs prevent tests from merely verifying a homegrown imitation.

## File Changes

### New Files

| File Path | Purpose |
| --- | --- |
| `release-please-config.json` | Independent per-package releases, tags, initial-version policy |
| `.release-please-manifest.json` | Release Please version tracking; bootstrap according to the tested upstream behavior |
| `.github/workflows/ci.yml` | Read-only checks on PRs and main; Linux/macOS and Node compatibility coverage |
| `.github/workflows/release.yml` | Release Please, lock refresh, OIDC-only publication and exact-tag recovery |
| `scripts/release.ts` | Small release-output validation and lock-refresh entrypoints |
| `scripts/publish.ts` | Exact release selection, dry-run/execute boundary, registry state handling |
| `scripts/check-docs.ts` | Local-link validation and verification of referenced compiled examples |
| `tests/release/manifest.test.ts` | Pinned upstream Release Please behavior with local GitHub fixtures |
| `tests/release/lockfile.test.ts` | Actual Bun lock refresh and frozen-install/idempotency proof |
| `tests/release/publish.test.ts` | Publication plan, path/version rejection, retry/error boundaries |
| `tests/release/workflows.test.ts` | Actual workflow/config assertions and small negative controls |
| `tests/tooling/docs.test.ts` | Broken-link and invalid-example controls for documentation validation |
| `README.md` | Human overview, package distinctions, development, installation conventions |
| `packages/services/README.md` | Public helper API and examples, runtime/compatibility boundaries |
| `docs/releasing.md` | Release policy, existing trusted-publisher binding checklist, exact-tag recovery |

### Modified Files

| File Path | Changes |
| --- | --- |
| `package.json` | Pinned release/test tooling and final scripts/aggregate checks |
| `bun.lock` | Reproducible dev dependencies |
| `scripts/check-workspace.ts` | Release allowlist/manifest consistency and final package-documentation checks |
| `tests/tooling/workspace.test.ts` | Release registration, private exclusion, extensible package cases |
| `scripts/check-package.ts` | Reuse validated artifact metadata for publication; require final README/license |
| `AGENTS.md` | Required protocol/release references, authoring/release rules, dated ideation convention |
| `docs/service-discovery.md` | Ensure public examples reference implemented and compiled fixtures |
| `.prettierignore` | Exclude generated changelogs/manifests only where necessary, not source checks |

Release Please generates future `packages/<name>/CHANGELOG.md` files; do not fabricate a release history. No implementation files are deleted.

## Implementation Details

### 1. Independent versioning and release fixtures

Use a pinned `googleapis/release-please-action` revision and a root dev dependency on the corresponding Release Please implementation/version for fixture tests. Resolve and record compatible exact versions during implementation; inspect the action's dependency/lock metadata rather than guessing that an arbitrary current library release matches its bundled code.

Configuration requirements:

- Manifest package path initially `packages/services`, component `pi-services`, release type `node`.
- Separate release PRs and component-prefixed tags, such as `pi-services-v0.1.0`.
- No root release entry and no private fixture entry. The public-package validator and release allowlist must agree.
- Initial target is `0.1.0`. Test the combination of `initial-version`, initial package version, and an empty/new manifest with the pinned upstream implementation. Do not seed the manifest in a way that falsely claims `0.1.0` was already released and accidentally skips the intended first version.
- For post-1.0 fixtures, `fix` means patch, `feat` means minor, and a breaking conventional commit means major. For pre-1.0 packages, explicitly enable/document breaking-change minor bumps and test the configured behavior. Service API-major versioning remains separate.
- No `node-workspace` or `linked-versions` plugin. Updating a compatible helper release alone does not rewrite consumer ranges or release consumers. An explicit consumer range change is delivered as a releasable `fix(deps)` commit in that consumer's path.
- Document that routing is based on affected paths, not just commit scope. Root-only maintenance does not automatically release every package; a root tooling change affecting shipped output must include an intentional package-level release change.
- Future packages are added through documented manifest/metadata edits, not a code-generated global service catalog.

Test the actual upstream manifest/release construction with mocked GitHub file/commit/PR/release responses. Avoid creating a local clone of Release Please's semver algorithm and asserting it agrees with itself. Keep synthetic manifests in the test source or temporary fixtures; do not register fictional publishable packages in the real repository.

**Feedback loop**:
- **Playground**: two public fixture packages plus a private fixture and path-scoped commit history.
- **Experiment**: fix/feat/breaking changes; root-only change; A-only change leaving B unchanged; helper patch without a consumer bump; explicit consumer dependency update; first release; configured 0.x behavior; component tags.
- **Check command**: `bun run test:release`.

### 2. Release PR authentication and Bun lock synchronization

Repository API authentication is separate from npm publication. Prefer a short-lived GitHub App installation token with only repository contents/issues/pull-request permissions needed by Release Please and its bot branch updates. Configure explicit App ID/private-key inputs in the release-management job and document them as GitHub-only credentials. Do not expose them to the publish job. If the maintainer substitutes existing GitHub release automation, preserve the same permission and event-trigger properties; this is not permission to switch npm authentication.

A default `GITHUB_TOKEN` creating a PR or tag does not normally trigger subsequent GitHub Actions runs. Therefore do not silently default to it while assuming a `pull_request` CI run will follow. Use App-created release PRs/branch updates to trigger normal CI. Publish in the same top-level `release.yml` workflow using Release Please outputs, not by assuming a token-created release event starts another workflow. Ordinary read-only checkout/API access can use the job-scoped GitHub token; none of these credentials authenticate npm.

When Release Please creates or updates a release PR:

1. Read only the PRs returned by the action and verify their expected repository, base, bot head branch, and ownership before checkout. Never check out arbitrary fork/PR input with a write credential.
2. Run the pinned Bun's lockfile-only update with package lifecycle scripts disabled on that release branch.
3. Verify the diff is limited to `bun.lock`. If anything else changes, stop with diagnostics rather than broad staging.
4. Commit/push the lockfile only if changed, using the bot identity and installation token; the resulting ordinary PR checks must pass frozen install.
5. Process per-package PRs serially within this step to avoid workspace/checkout races. Disallow overlapping release-management runs; do not cancel an active publication halfway through.

The implementation project does not execute this against GitHub. Local tests apply generated candidate edits to temporary workspaces, run the same lockfile command, and verify `bun install --frozen-lockfile` and a second no-diff refresh. Use public or local fixture dependencies; never borrow authentication or mutate the real workspace. Do not permanently relax frozen-install CI for release PRs.

**Feedback loop**:
- **Playground**: temporary workspace copied from minimal manifests, with actual Bun-generated locks.
- **Experiment**: version-only changes, explicit semver dependency changes, repeated refresh, no-op update, and an unexpected non-lockfile diff.
- **Check command**: `bun run test:release-lock`.

### 3. Release-scoped artifacts and publication plan

Keep release-output parsing separate from execution, but within the small script modules listed above. Import pure functions in tests and invoke the CLI only behind its main-entry guard. Default publication commands to plan/dry-run; real publishing requires an explicit execute flag in the trusted CI job.

Read official Release Please `paths_released` and per-path version/tag/SHA outputs. JSON passed from Actions is data, not shell source. Validate against the actual release configuration and package manifest before invoking any subprocess. Reject unknown/private paths, traversal, missing/invalid version/tag/SHA, a tag for another component, and a manifest version different from the intended release. Do not shell-interpolate PR titles, tag names, paths, or arbitrary action output; use subprocess argument arrays.

Build and validate the exact release commit, not the moving main tip. Reuse Phase 2's tarball checker and retain its artifact/metadata through the publish step; no unchecked repack or rebuild after verification. For a normal main-triggered run, assert the released SHA matches the workflow's source SHA before publishing. If delayed release processing identifies a different SHA, stop and use the exact-tag recovery route so source identity/provenance is not misrepresented.

Only selected released public packages may be published. Never run a recursive `publish` across all workspaces or scan npm for arbitrary unpublished versions. When future consumers adopt a newly released internal dependency range, document publishing/availability of the helper before merging/releasing the consumer; do not introduce a general dependency release scheduler.

Registry behavior:

- Anonymous reads of public package metadata are sufficient for existence checks. Do not use `npm whoami` as an OIDC preflight; OIDC authentication occurs during `npm publish`.
- An already published exact version is a documented no-op for retry. If artifact integrity is available and differs from the validated tarball, fail as an immutable-version conflict instead of claiming the new artifact was published.
- Only an actual package/version-not-found response permits publication. Authentication, authorization, network, and malformed-response errors fail closed.
- Never overwrite tags or versions to repair a failed attempt. No generic retries, state database, or persistent coordinator.

**Feedback loop**:
- **Playground**: pure plans with mocked registry results and captured process arguments.
- **Experiment**: no releases, one valid release, two independent releases, private/unknown/traversal path, version/tag/SHA mismatch, already-published, not-found, auth error, network error, and a failure after one of two packages succeeds.
- **Check command**: `bun run test:publish`.

### 4. npm trusted publishing — mandatory authentication policy

The maintainer already uses trusted publishing. Do not add an npm token secret, a GitHub-token registry configuration, an npm-login step, a migration procedure, or a fallback when OIDC is unavailable.

Use a GitHub-hosted Ubuntu publish job with job-local permissions:

```yaml
permissions:
  contents: read
  id-token: write
```

The release-management job has its separate write permissions but no npm publishing responsibility. Ordinary CI jobs have read permissions and no OIDC publishing grant. Do not use `pull_request_target` to run untrusted branch code with write or OIDC privileges.

Pin a currently supported exact npm CLI version at implementation time, at least `11.5.1`, and use Node 24 for publication. The verified npm documentation requires npm >=11.5.1 and Node >=22.14.0; the project's Node >=22.19 baseline meets the runtime floor. Bun remains pinned to 1.3.14 for install/build/lock operations. Use the npm CLI for `npm publish <validated-tarball> --access public` so its supported OIDC exchange is exercised; do not replace it with `bun publish` and assume authentication parity.

Publishing requirements:

- The job has the normal GitHub OIDC request environment and the configured package trusts the exact GitHub owner, repository, and workflow filename `release.yml`, plus environment name if one is used.
- The binding permits **direct `npm publish`**. Do not quietly switch to `npm stage publish`, which adds another approval boundary and changes the agreed autopublish behavior.
- `repository.url` in the released package exactly matches the eventual GitHub repository. Do not invent that repository now; making this metadata accurate is an activation prerequisite and execution-time publishing validation.
- Do not set `NPM_TOKEN`, `NODE_AUTH_TOKEN`, token-bearing `.npmrc`, or registry-auth fallback configuration. Use clean runner configuration and never read the maintainer's local npm credentials in tests.
- Do not add `npm whoami` as a gate. Public `view` reads and the actual OIDC publish are different operations.
- Do not disable provenance. npm automatically generates provenance for trusted publishing from a public GitHub repository to a public package; explain the repository-visibility limitation rather than claiming all publishes automatically have it.
- Do not restore dependency/build caches in the publish job. Build from the verified release source with frozen dependencies. Regular CI may use suitably keyed dependency caching.
- On missing OIDC identity or a mismatched trusted-publisher binding, fail with an actionable message. Never fall back to a registry token.

The current authoritative reference is https://docs.npmjs.com/trusted-publishers/ (consulted during planning). Verify version-specific details when implementing, but preserve the user's OIDC-only policy.

**Feedback loop**:
- **Playground**: parsed publish-job configuration and captured publish process environment.
- **Experiment**: valid OIDC-only setup; removal of `id-token: write`; introduction of `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `_authToken`, a fallback branch, or GitHub credentials passed as npm auth; unsupported runner or npm version. Each invalid case must fail before an actual publish could be attempted.
- **Check command**: `bun run test:ci`.

### 5. Exact-tag recovery in the same workflow

Declare `workflow_dispatch` in `release.yml` with an explicit release tag input. The normal release-management job does not run during recovery.

Dispatch the workflow **at that release tag**, not at a newer main commit. Resolve and validate that the event's Git ref/SHA, peeled tag commit, component, and packaged version agree. The same source must be built, checked, and published. For example, after activation only:

```bash
gh workflow run release.yml --ref pi-services-v0.1.0 -f release_tag=pi-services-v0.1.0
```

Keep the same top-level workflow identity used by trusted publishing. Do not hide publication behind a differently registered reusable workflow. Use the same OIDC-only publish job and registry-state rules as automatic releases. Existing versions are skipped, immutable conflicts fail, and only missing selected versions are published. If the workflow/tag is absent or the SHA does not agree, fail; never create/move a tag as a recovery side effect.

This is documented and locally tested only. No dispatch, real registry reads requiring credentials, or publication occurs while implementing this project.

### 6. CI and final aggregate

`ci.yml` runs on PRs and main without publication permissions. Validate the PR title against the conventional-commit convention if squash merges are the documented release path; treat the title as data. Validate via existing tooling or a small expression rather than adding a broad commit-policy framework. Require release-PR CI after App-created lock updates.

Full scope includes:

- Full local check suite on Linux at the Node 22.19.0 minimum baseline.
- Node/Pi and packed-artifact smoke checks on Linux Node 24 and macOS on both supported Node lines.
- Same Bun version from root `packageManager` throughout.
- Actions pinned to verified commit SHAs and language/package tools pinned explicitly.
- Workflow concurrency preventing overlapping release-management updates and duplicate simultaneous publication for the same release.

The matrix configuration is an implementation deliverable; hosted success is not a completion claim in this local-only project.

Implement `test:ci` as direct parsing of the real YAML/JSON with a standard YAML library and assertions for commands, versions, permissions, event paths, authenticating principals, source checkout, matrix, and artifact handoff. Add small mutated in-memory negative controls, not a workflow simulation engine. Workflow/static checks complement executable release and artifact tests; they do not prove GitHub authentication works before activation.

Final `bun run check` must run **every** verifier below, propagating nonzero exit statuses:

```text
check:workspace
test:boundaries
typecheck
lint
test:services
test:execution
test:pi
check:package
test:release
test:release-lock
test:publish
test:ci
check:docs
```

Provide each contract command as a real package script, with no placeholder-success branch. Keep `bun test` as the ordinary test runner; Node smoke scripts intentionally run Node. Never hide failed tests with `|| true` or broad registry-error catches.

**Feedback loop**:
- **Playground**: actual workflow files plus in-memory edits to required fields.
- **Experiment**: remove one aggregate verifier, grant publishing permission to PR CI, change Bun version, omit a supported smoke target, publish without checking the artifact, or configure token auth. Each case must fail its scoped assertion.
- **Check command**: `bun run test:ci`.

### 7. Human documentation and activation boundary

Write useful short documents, not a separate design-system/site project.

**Root README.md** must state:
- What the repository is and that no user-facing extension has shipped yet.
- `@birdcar/pi-services` is a shared library dependency, not a Pi extension to install for tools/commands.
- Future extensions are independently installed with `pi install npm:@birdcar/pi-<name>`; label placeholders clearly. Do not present installing the monorepo root from Git as an install-all solution.
- Bun development prerequisites, the Node/Pi compatibility baseline, local checks, and local extension development with private examples.
- Optional integration benefits, missing-service versus invocation-failure semantics, and links to the authoritative protocol and release guide.
- How to add a package, declare a service contract without a central registry, and opt into independent releases.

**Helper README.md** covers the real exported API, structural errors, synchronous discovery, cleanup/cancellation responsibilities, and links to typed examples. State that package semver and service majors are distinct.

**AGENTS.md** requires portable production code, the correct production/tooling boundary, reading `docs/service-discovery.md` for inter-extension work, reading `docs/releasing.md` for release changes, tests/type/lint before commits, the commit skill, and `YYYY-MM-DD-<slug>` ideation directories. Do not restore obsolete Bun runtime scaffolding advice or add a separate skill.

**docs/releasing.md** documents the release PR model, squash/commit policy, actual command/script names, independent ranges, helper-before-consumer release ordering where needed, Bun lock refresh, exact-tag recovery, and a focused ready-to-connect checklist:
1. Connect the intended GitHub repository later; update each package's repository metadata to its actual URL/directory.
2. Bind GitHub release automation and enable required PR checks and write permissions for its App. These credentials are for GitHub only.
3. Verify package ownership and the correct entry in the maintainer's **existing npm trusted-publishing setup**, matching `release.yml`, repository, optional environment, and direct-publish permission.
4. If npm requires an account-side prerequisite for a new package, leave that for the maintainer; do not introduce token-based CI bootstrap or claim it is already satisfied.
5. After activation, observe a real release PR, CI, package publication, and provenance where supported. This validation is intentionally outside the project completion claim.

Keep automation disabled until explicitly activated, using a documented repository variable such as `RELEASE_ENABLED=true` for the release workflow. It is an account-activation guard, not an alternate publication/authentication mode. Before enabling, the checklist must be satisfied; OIDC failure remains a failure.

`check:docs` validates local links in maintained documentation and compiles the actual referenced provider/consumer example modules. Avoid heading-text assertions and avoid compiling the preserved pseudocode appendix as if it were production code. Generated ideation documents are not product API examples. Use valid/broken links and actual invalid TypeScript in temporary copies to prove failures are detected.

**Feedback loop**:
- **Playground**: maintained README/protocol/release docs and typed fixture references.
- **Experiment**: valid links, a broken relative link, a missing referenced example, and an example with a real type error; all failures produce a nonzero result with the source location.
- **Check command**: `bun run check:docs`.

## Testing Requirements

| Test file | Coverage |
| --- | --- |
| `tests/release/manifest.test.ts` | Actual upstream versioning, independent paths, private exclusion, bootstrapping, range-change policy |
| `tests/release/lockfile.test.ts` | Real pinned Bun refresh, frozen install, repeatability, unexpected-diff rejection |
| `tests/release/publish.test.ts` | Allowlisted exact artifacts, stale source rejection, registry state, partial-failure recovery |
| `tests/release/workflows.test.ts` | Actual configs, least privilege, OIDC-only npm auth, source/artifact wiring, complete matrix and aggregate |
| `tests/tooling/workspace.test.ts` | Public package/release configuration agreement without hardcoding a permanent package count |
| `tests/tooling/docs.test.ts` | Link and real typed-example verification |

All normal verification is credential-free and does not publish. Registry/GitHub responses in release tests are mocked; the lockfile test uses temporary local fixtures or public dependencies. Package installation may use the public registry but must not access private account state.

## Failure Modes

| Component | Failure | Trigger | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| Release Please | Unrelated packages bump | Automatic workspace plugin enabled | Independent release policy violated | Disable cascade plugins; upstream-backed multi-package fixtures |
| Release PR | Required checks never run | Bot uses default token and assumes new workflows trigger | Unmergeable or unchecked release | App-created PR/lock updates; same-workflow publication |
| Lock refresh | Lock no longer matches manifest | Version/range edits are generated without Bun refresh | Frozen CI fails | Same pinned Bun refresh on PR and actual frozen-install tests |
| Publication | Wrong source or artifact ships | Checkout main tip or repack after validation | Version/tag/provenance mismatch | Exact SHA, event/source agreement, validated tarball handoff |
| Publication | Wrong package ships | Publish all workspaces or trust arbitrary paths | Private/unintended package exposure | Config allowlist and exact public manifest/version checks |
| Publication | Registry error treated as missing | Catch-all npm view failure | Unsafe retry or misleading status | Distinguish genuine not-found from auth/network failures |
| OIDC | Trust binding does not match | Wrong workflow/repository/environment/action permission | Publication fails | Focused existing-binding checklist; fail closed, never add token fallback |
| Recovery | Provenance points at another commit | Dispatch newer main while building an old tag | Misleading build origin | Dispatch at exact release tag; verify event/tag/SHA before build |
| Workflow | Credentials leak to wrong job | Global publish permissions or token environment | Expanded write authority | Job-local permissions, separate App credentials, negative config tests |
| Documentation | Claims activation already happened | Local checks are confused with hosted proof | Maintainer trusts untested account setup | Explicit ready-to-connect state and deferred live verification |

## Validation Commands

```bash
bun install --frozen-lockfile
bun run test:release
bun run test:release-lock
bun run test:publish
bun run test:ci
bun run check:docs
bun run check:package
bun run check
```

Run the aggregate after all individual checks have succeeded, and verify its wiring includes every required script. Format/type/lint checks must pass before the local phase commit.

## Rollout and Handoff

Deliver locally validated files and documentation only. Do not configure npm/GitHub accounts, create a repository, push, dispatch workflows, or publish. Leave the release activation guard off until the maintainer completes the focused binding checklist. Report that hosted CI, registry publication, and live provenance have not been exercised.

The human documentation review remains the one judgment criterion. Do not report it as mechanically passed; show the final README and guides for the maintainer to inspect.
