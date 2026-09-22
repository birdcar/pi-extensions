# Pi Extension Monorepo Foundation Contract

**Created**: 2026-09-21
**Readiness**: All 5 gates ready
**Status**: Approved
**Approval**: Express — single consolidated confirmation, no per-artifact review
**Supersedes**: None

## Problem Statement

Birdcar is preparing a suite of independently installable Pi extensions. Without shared repository conventions, each new extension would require bespoke packaging, releases, runtime guidance, and optional-integration behavior, increasing maintenance work and making combinations brittle for users.

The current directory contains a private Bun workspace root, an empty packages directory, Bun-specific AGENTS.md guidance, and a tsconfig exposing Bun globals. It has no source packages, tests, README, CI, or Git repository. Shipped extension code must work in Pi without requiring users to install Bun.

The user-supplied Optional Service Discovery for Pi Extensions appendix is preserved in docs/ideation/2026-09-21-pi-extension-monorepo/discovery-protocol.md as the architectural source for in-process cooperation. It must become a maintained document and a tested small helper, not a new extension loader, RPC system, or orchestration framework.

## Goals

1. Provide a private workspace root and one publishable @birdcar/pi-services library, initially 0.1.0, with strict TypeScript, MIT licensing, Node-compatible ESM and declarations, explicit package exports, and Bun development commands.
2. Implement synchronous, per-service discovery on the injected pi.events bus with deterministic absence, incompatibility, ambiguity, malformed-offer, and late-offer behavior; prove one provider serves two independent consumers in either factory order.
3. Prove returned results, failures, cooperative cancellation, provider-owned concurrency policy, disposal, reload, and session replacement using private fixtures and the actual Pi SDK, without model requests or user configuration access.
4. Configure Release Please manifest releases with independent versions, changelogs, component tags, and per-package release PRs; merging a release PR enables publication of only the released public package after validation using npm OIDC trusted publishing, without registry tokens or a token fallback and with no live publication during this project.
5. Document contributor rules, individual extension installation conventions, the normative discovery protocol, independent dependency updates, and the exact deferred GitHub/npm activation steps.

## Success Criteria

- [ ] Workspace metadata distinguishes the private root and private fixtures from public libraries/extensions; exports, files, version fields, MIT license packaging, and release allowlists are consistent and invalid fixture manifests are rejected. — check: `bun run check:workspace` → Exits 0 after positive and negative metadata checks; only packages/services is initially releasable and no phantom root entrypoint remains.
- [ ] Production TypeScript and lint boundaries disallow Bun globals and bun: imports while allowing them in tests/tooling; representative forbidden source fixtures fail the intended checks. — check: `bun run test:boundaries` → Exits 0; valid Node-compatible code passes and injected Bun-only production code fails, without relying solely on developer instructions.
- [ ] All shipped code and development tooling pass their separate strict type checks and configured lint/format checks. — check: `bun run typecheck && bun run lint` → Both commands exit 0 with no production ambient Bun types; shipped-artifact bundling is checked separately by check:package.
- [ ] Discovery covers missing, one compatible, incompatible-only, duplicate-compatible, malformed, mixed-major, invalid-request, and late asynchronous offers; consumers need no provider changes and observations are not required for completion. — check: `bun run test:services` → Exits 0 using contract fixtures; absence returns synchronously without a timeout, selection is independent of listener order, and late offers cannot mutate an already returned result.
- [ ] Service execution preserves method results and failures, rejects old and destructured handles after disposal, and demonstrates cancellation, shutdown cleanup, and a declared concurrent-call policy in the private provider fixture. — check: `bun run test:execution` → Exits 0; cancellation is cooperative rather than timeout-only, invocation failure is not absence, and provider cleanup settles fixture-owned in-flight work.
- [ ] Actual Pi 0.87.0 runtime integration proves factory-order independence after startup, reload subscription cleanup, and session replacement with revoked old handles and usable newly discovered handles. — check: `bun run test:pi` → Exits 0; a Node child process uses the public Pi SDK and temporary isolated configuration, performs real reload and new-session replacement, and makes no model calls or changes to the user's Pi settings.
- [ ] A cleanly built tarball works outside the workspace under Node without Bun, development dependencies, source-path aliases, or workspace links. — check: `bun run check:package` → Exits 0 after building and packing, inspecting tarball contents (including absence of bundled host Pi packages), installing the artifact in a temporary consumer, importing public ESM/types, and exercising discovery with a Node-compatible injected bus.
- [ ] Release fixtures execute the pinned upstream Release Please implementation and prove patch/minor/breaking classification, independent package versions, omission of private packages, and no automatic dependent bump for compatible helper changes. — check: `bun run test:release` → Exits 0 with mocked GitHub input fixtures, including two candidate public packages; explicit consumer dependency-range changes represented by fix(deps) commits release that consumer without lockstep versioning.
- [ ] A generated release candidate's manifest edits can be followed by the same Bun lockfile refresh used in automation and then a successful frozen install; repeated refreshes are idempotent. — check: `bun run test:release-lock` → Exits 0 in temporary workspace copies using actual Bun commands; the original workspace and user credentials remain untouched.
- [ ] Publication planning accepts only allowlisted released public package paths and exact released versions, publishes the validated artifact rather than all workspaces using npm OIDC trusted publishing only, and supports safe recovery after a partial publication failure. — check: `bun run test:publish` → Exits 0 with mocked registry/process boundaries: empty releases are a no-op; private, unknown, traversal, and version-mismatch inputs fail; a published exact version is skipped; only a real not-found response permits publication; authentication/network errors fail. No real registry writes occur.
- [ ] CI and release configuration validate ordinary PRs and release PRs, grant id-token: write only to the npm trusted-publishing job, prohibit NPM_TOKEN/NODE_AUTH_TOKEN and registry-token fallbacks in publication, keep GitHub release-PR credentials separate, pin tool/action versions, and test the supported Node baseline and Node 24 on Linux and macOS under the approved Full scope. — check: `bun run test:ci` → Exits 0 after directly parsing the actual workflow/config files with a standard YAML library and asserting script wiring, pinned versions, permissions, token requirements, same-workflow publication, and the selected platform matrix. Use small in-memory negative cases to prove assertions fail, not a custom workflow simulator or fixture framework. Hosted workflow execution is not claimed.
- [ ] Document links resolve and the provider/consumer examples use the public helper API and compile without importing provider implementations. — check: `bun run check:docs` → Exits 0 after checking local links and type-checking actual example snippets or their referenced source fixtures, rather than grepping for required prose headings.
- [ ] A fresh locked dependency installation can execute the aggregate local verification command successfully. — check: `bun install --frozen-lockfile && bun run check` → Exits 0; check runs check:workspace, test:boundaries, typecheck, lint, test:services, test:execution, test:pi, check:package, test:release, test:release-lock, test:publish, test:ci, and check:docs without GitHub or npm credentials. Dependency installation may use the registry; tests do not publish or call models.
- [ ] The README and referenced guidance let a human distinguish the shared library from an installable extension, understand optional integrations and compatibility limits, and follow the complete deferred release-activation checklist. — judgment call: Birdcar reviews README.md, AGENTS.md, docs/service-discovery.md, and docs/releasing.md for usability and accuracy. The review must confirm there is no claim that GitHub CI or npm publication has already run.

## Scope Boundaries

### In Scope

- Local Git bootstrap on main before execution, preserving existing files and approved planning artifacts; no remote creation or push. — There is currently no Git repository, and phase commits/branch isolation require an initialized, reviewed baseline before an execution engine starts.
- Private Bun workspace, a packageManager Bun pin shared by local setup and CI, pinned development tools, NodeNext/ES2022 strict production configuration, separate Bun tooling types, enforceable runtime boundaries, lint/format checks, and MIT license. — Stops the current starter guidance from producing extensions that fail in Pi.
- One ordinary shared npm library at packages/services named @birdcar/pi-services, with implementation-free contract types, discovery/provider helpers, stable error codes, compiled ESM and declarations. — Shares the convention without initializing providers or registering another Pi extension. Concrete production service contracts are added only when a real service exists.
- Private provider and two independent consumer fixtures, unit tests, cross-copy structural error handling, real Node/Pi lifecycle tests, and packed-artifact verification. — Makes every discovery claim executable while keeping fake services out of the public suite.
- Release Please manifest configuration with per-package release PRs, versions, changelogs, component tags, explicit semver dependencies, release-PR Bun lock refresh, and isolated release-behavior fixtures. — Delivers the requested release-PR-merge model without silently introducing automatic dependent releases.
- Linux CI for the Node 22.19+ baseline and Node 24, release-scoped npm OIDC trusted publication with an exact-tag recovery path, and documented separate GitHub release-automation credentials plus the correct package/repository/release.yml binding in the maintainer's existing npm trusted-publishing setup. Verify direct-publish permission and package repository metadata before later activation. No registry token, migration, or fallback is configured. — Ready-to-connect means the workflow is usable and recoverable after account setup, not merely a version-bumping configuration.
- Root README, helper README, updated AGENTS.md, normative docs/service-discovery.md, and docs/releasing.md covering authoring, local development, package installation conventions, checks, and release activation. — Humans and coding agents need the same authoritative boundaries and practical setup path.
- Add macOS CI jobs for the same Node/Pi lifecycle and packed-artifact smoke checks. — Adds coverage for the maintainer's desktop platform without changing the runtime architecture or feature scope.

### Out of Scope

- A real user-facing extension, voice rewriter, or production service-specific contract. — The user selected helper plus test fixtures, not a first-plugin build.
- Creating a GitHub repository, pushing code, configuring account credentials, or publishing any package. — The user chose ready-to-connect setup; live activation is a separate task.
- Custom extension loading, process-global service registries, and a global catalog. — Pi remains the host and discovery uses only its injected event bus.
- Cross-process RPC, Bun executables/sidecars, and compiled Bun workers. — No requirement justifies another runtime or transport.
- Asynchronous discovery, provider ranking, replay, and generic middleware or workflow pipelines. — The supplied protocol deliberately excludes them.
- Lockstep versions, automatic dependent bumps, and bundled copies of the helper inside every extension. — The user selected independent versions with ordinary semver ranges and explicit consumer updates.
- A dedicated scaffolding CLI, custom project skill, Nx/Turborepo, or Lerna orchestration. — Workspace scripts and authoritative documentation suffice for the first shared package.
- Compatibility claims for earlier Pi releases, arbitrary Pi forks, Windows, or every future Node/Pi version. — The initial verified target is Pi 0.87.0 with the specified Node lines; wider support requires its own evidence.

### Future Considerations

- Create/connect the remote repository, enable protected-branch checks and release-PR credentials, verify package ownership and the release.yml binding in the existing npm trusted-publishing setup, and perform the first real release.
- Add real extensions and service-specific contracts incrementally, using the private fixtures and authoring guidance as examples.
- Expand the tested Pi/platform matrix or introduce scaffolding only after a concrete maintenance need appears.

## Decisions Considered and Rejected

- **Reuse the maintainer's existing npm trusted-publishing approach and document only this package/repository/workflow binding.** — rejected: Treat trusted publishing as a new migration or introduce token-based account bootstrap.. The user clarified that they already use npm trusted publishing; the remaining repository-specific requirement is the correct authorized workflow and package metadata.
- **Use direct npm publish through the trusted publisher after release-PR approval.** — rejected: Silently switch to npm staged publishing with a second approval boundary.. The agreed behavior is automatic publication after the generated release PR merges; its trusted-publisher binding must permit that operation.
- **Use npm OIDC trusted publishing exclusively; grant id-token: write to the publish job and never configure NPM_TOKEN, NODE_AUTH_TOKEN, or a registry-token fallback.** — rejected: Token-authenticated npm publication, including reusing a GitHub token as registry authentication.. The user explicitly requires trusted-publisher setup. GitHub credentials may manage release PRs and tags but must not authenticate npm publication; any account-side first-package bootstrap is deferred rather than bypassed with a token fallback.
- **Preserve the user-supplied discovery appendix in discovery-protocol.md before execution and require Phase 2 to consume it.** — rejected: Refer only to an appendix that exists in conversation context.. The hidden-dependency critic identified that fresh execution sessions would otherwise lack exact channels, payloads, selection rules, and lifecycle constraints.
- **Make bun run check explicitly invoke every no-credential local verifier, including test:release-lock and test:publish.** — rejected: Use an aggregate description that omits two required release checks.. The success-criteria critic identified a path to reporting aggregate success with broken lockfile synchronization or publication planning.
- **Pin Bun through packageManager, CI setup, and contributor documentation; initially use the inspected Bun 1.3.14 baseline.** — rejected: Assume an arbitrary globally installed Bun version behaves identically.. Lockfile generation and frozen-install checks must use the same tool version.
- **Validate actual workflows with standard YAML parsing and small assertions, without a custom workflow fixture framework.** — rejected: Build a separate workflow simulator or extensive synthetic workflow fixture hierarchy.. The over-engineering critic correctly distinguished useful configuration validation from speculative meta-test infrastructure.
- **Retain a minimal exact-tag publication recovery path and its mocked error cases.** — rejected: Defer all retry safeguards until after the first failed release.. npm versions are immutable; allowlist/version checks and distinguishing not-found from auth/network errors prevent unsafe or misleading retries. This is not a generalized release-state engine.
- **Prefix ideation directory names and matching slugs with their creation date in YYYY-MM-DD format.** — rejected: Undated ideation directories.. The user wants ideation documents to sort chronologically; preserve this convention in contributor guidance.
- **Publish automatically after a generated release PR merges.** — rejected: Publish on every releasable feature PR merge.. The user explicitly selected release-PR merge as the release trigger.
- **Use Release Please manifest mode and independent per-package release PRs/tags.** — rejected: Changesets or lockstep suite versions.. Release Please supports the preferred approval flow and independent versions without requiring authors to maintain changeset files.
- **Use Bun for development and portable Node-compatible code at runtime.** — rejected: Bun-only extension APIs or compiled Bun sidecars as a default.. Users should not need a second runtime to install the suite in Pi.
- **Implement the small discovery helper with private provider/consumer fixtures now.** — rejected: Documentation only, or building a real extension in this project.. The user selected helper plus tests to validate the convention without expanding product scope.
- **Initialize local Git and deliver ready-to-connect release files and activation guidance.** — rejected: Create the remote repository or perform a live npm release during this project.. The user selected the local readiness boundary after learning no Git repository exists.
- **Name the shared library @birdcar/pi-services and future extensions @birdcar/pi-<name>.** — rejected: Unscoped names or provisional naming.. The user selected the @birdcar/pi-* convention; ownership remains part of deferred activation.
- **Use ordinary semver dependency ranges and explicit fix(deps) consumer updates; disable node-workspace/linked-versions release plugins.** — rejected: Propagate every helper update or bundle the helper into each extension.. The user selected independent dependency releases; the upstream node-workspace plugin automatically bumps dependents.
- **Keep package semver and per-service API majors separate; match service majors exactly.** — rejected: Tie every package release to a protocol major or infer compatibility across service majors.. The supplied architecture contract requires independent, explicit service compatibility.
- **Put the normative protocol in docs/service-discovery.md and require it from AGENTS.md.** — rejected: Store architectural requirements only in an optionally invoked skill.. The convention must be discoverable to humans and applied consistently by coding agents.
- **Require actual Pi lifecycle tests and Node packed-artifact checks in addition to Bun unit tests.** — rejected: A lighter unit-only verification bar.. The user selected full checks; Bun-only success cannot prove Pi portability or teardown behavior.
- **Use MIT licensing for the repository and public packages.** — rejected: Apache-2.0 or deferred licensing.. The user explicitly selected MIT.
- **Publish compiled ESM plus declarations for the shared library, without bundling Pi or loading providers on import.** — rejected: Depend on a consumer's TS loader or a process-global singleton for shared-library operation.. Ordinary Node/npm consumers and independently installed helper copies must work consistently.

## Execution Plan

_Added during Phase 5 handoff. Pick up this contract cold and know exactly how to execute._

### Dependency Graph

```
Portable workspace foundation
  └── Service discovery and Pi lifecycle proof  (blocked by Portable workspace foundation)
        └── Independent releases and contributor handoff  (blocked by Service discovery and Pi lifecycle proof)
```

### Execution Steps

**Run the project** (recommended) — autopilot reads this contract, plans dependency waves, runs independent phases in parallel, and gates on failure:

```bash
/ideation:autopilot docs/ideation/2026-09-21-pi-extension-monorepo/contract.md
```

**Or run it unattended** — a `/goal` is a durability wrapper around the same autopilot run: Claude re-checks the condition before it is allowed to stop, so failures get repaired and re-run. Generated by `contract-gen --print-goal`; this is the only copy of that string:

```
/goal Drive the Pi Extension Monorepo Foundation contract (2026-09-21-pi-extension-monorepo) to completion with /ideation:autopilot.

1. Run `/ideation:autopilot docs/ideation/2026-09-21-pi-extension-monorepo/contract.md`. All commits belong on branch ideation/2026-09-21-pi-extension-monorepo — switch to it before any run.
2. It dispatches a BACKGROUND workflow. Wait for the completion notification — never start a second autopilot run while one is in flight.
3. Then run the ideation plugin's `scripts/verify.mjs` against `docs/ideation/2026-09-21-pi-extension-monorepo/contract-data.json` and leave its VERIFY line in the conversation. Resolve the plugin's install directory first — `${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs` is a placeholder, not a shell variable, and bash will not expand it. That line is the only evidence this goal is judged on.
4. If anything failed, fix the spec or the implementation and go back to step 1. Autopilot skips phases that already have commits.

Done when the most recent VERIFY line reads fail=0 and commits=3/3 — or when two consecutive VERIFY lines are identical and still failing, in which case name the failing checks and stop, because a contract whose checks have rotted must not trap the run.
```

**Or run phases manually** in dependency order:

**Strategy**: Approved scope: Full (MVP plus macOS CI). Sequential: establish portable workspace boundaries, implement and validate services, then configure releases and finish documentation. Before any engine or isolation-branch operation, initialize local Git on main and make a reviewed baseline commit; this local-only bootstrap is an execution prerequisite, not permission to push or publish.

1. **Phase 1** — Portable workspace foundation _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/2026-09-21-pi-extension-monorepo/spec-phase-1.md
   ```

2. **Phase 2** — Service discovery and Pi lifecycle proof _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/2026-09-21-pi-extension-monorepo/spec-phase-2.md
   ```

3. **Phase 3** — Independent releases and contributor handoff _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/2026-09-21-pi-extension-monorepo/spec-phase-3.md
   ```

---

_This contract was generated from brain dump input. Review and approve before proceeding to specification._
