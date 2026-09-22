# Implementation Spec: Pi Write For — Phase 4

**Contract**: ./contract.md

**Prerequisite**: Hybrid voice learning and document ingestion (phase 3).

**Scope**: Full; this phase verifies the complete product without publishing it.

**Estimated Effort**: M

## Technical Approach

Complete portable distribution and end-to-end acceptance using the repository's existing Pi
lifecycle and npm artifact-consumer patterns. This is proof of the real compiled package, not a
second mock-only implementation or a new test platform. Verify that contract-only consumers, the
compiled extension, its parser worker, and the complete training flow work through their intended
boundaries.

Finish the second-package release/tooling support introduced in phase 1. The writer depends on the
services helper, so local artifact tests must install both local tarballs rather than require an
unpublished version on npm. Keep hosted release activation and actual publication outside this work.
Preserve OIDC-only credentials, exact-tag recovery and integrity checking.

Separate mechanical implementation completion from human voice acceptance. The four implementation
phases are executable; the live voice review is a named user observation after those checks, not a
fake implementation phase and not a judgment an unattended engine can certify.

## Decisions Considered and Rejected

- **Node/Pi portability** — rejected Bun-only published runtime behavior, source-only extension
  entrypoints and undeclared global document converters.
- **Independent consumer and real lifecycle proof** — rejected requiring a production Slack/email
  integration to establish composability.
- **Local dependent tarballs** — rejected relying on an unpublished services version being available
  from the registry.
- **Package-specific dependency policy** — rejected weakening the helper's no-Pi-dependency rule
  just because the extension uses Pi.
- **Existing independent release model** — rejected token-based publication, automatic hosted
  activation or unrequested npm release.
- **Tests plus voice review** — rejected CI-only voice claims and a larger evaluation framework in
  this release.
- **Four executable phases plus a separate human judgment** — rejected passing a spec-less human
  checkpoint into an engine that expects executable specs.
- **Draft spec paths become real only after contract approval** — execution depends on all generated
  specs passing the express self-review gate.
- **No raw corpus retention** — acceptance checks inspect writer-managed persistence, not make false
  promises about Pi/provider history.
- **Full scope** — event ingress and built-in PDF/DOCX ingestion are required, not deferred optional
  work.

## Feedback Strategy

**Inner-loop command**: `bun run test:pi`

**Playground**: Real Pi session/runtime lifecycle with an in-memory fake provider and isolated
directories. Secondary loops use clean npm/Node consumers and release-plan fixtures.

**Why this approach**: The remaining risks are loader/lifecycle/package boundaries that unit doubles
alone cannot expose. Use the existing test harness instead of adding a standalone application.

## File Changes

### New Files

| File Path                                 | Purpose                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `tests/pi/write-for.ts`                   | Compiled writer lifecycle and command/tool integration proof                  |
| `tests/fixtures/write-for/provider.ts`    | Test-only fake Pi model provider with controlled streaming, no live inference |
| `tests/tooling/write-for-package.test.ts` | Multi-artifact consumer/package-policy regression tests                       |

### Modified Files

| File Path                          | Changes                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                     | Build/copy/run the writer lifecycle test; ensure aggregate check includes all writer tests and route `tests/tooling/write-for-package.test.ts` through `test:ci` |
| `tsconfig.pi-tests.json`           | Include writer fixtures/tests and their compiled import paths                                                                                                    |
| `tests/pi/lifecycle.ts`            | Extract only small shared test setup if genuinely needed; preserve original proof                                                                                |
| `scripts/check-package.ts`         | Validate all public package artifacts and exercise clean services+writer consumers                                                                               |
| `scripts/check-workspace.ts`       | Validate Pi entrypoint/resource targets if not already covered in phase 1                                                                                        |
| `tests/tooling/workspace.test.ts`  | Positive/negative extension-manifest and contract-boundary cases                                                                                                 |
| `tests/tooling/boundaries.test.ts` | Assert contract isolation and portable worker/runtime imports                                                                                                    |
| `scripts/release.ts`               | Writer-aware identity/tag selection if existing metadata-driven logic needs adjustment                                                                           |
| `scripts/publish.ts`               | Dependency-first writer/services ordering and validation without live execution                                                                                  |
| `tests/release/manifest.test.ts`   | Both package registrations and independent release expectations                                                                                                  |
| `tests/release/publish.test.ts`    | Dependent release ordering, local validated artifacts and failure classifications                                                                                |
| `tests/release/workflows.test.ts`  | Both normal release outputs and exact-tag recovery cases                                                                                                         |
| `.github/workflows/release.yml`    | Complete writer output/tag/path metadata plumbing and preserve OIDC policy                                                                                       |
| `.github/workflows/ci.yml`         | Ensure the complete check path runs on the declared Node baseline and existing supported matrix                                                                  |
| `scripts/check-docs.ts`            | Validate maintained writer examples and package references                                                                                                       |
| `tests/tooling/docs.test.ts`       | Protect the expanded maintained-doc set and accurate commands                                                                                                    |
| `packages/write-for/README.md`     | Final command, consumer, config, training, format, privacy and acceptance guidance                                                                               |
| `README.md`                        | Add the writer package to the existing package overview                                                                                                          |
| `docs/releasing.md`                | Document second-package identity and dependency-first publication requirement                                                                                    |
| `docs/service-discovery.md`        | Add a concise writer-contract example without changing the generic protocol                                                                                      |
| `packages/write-for/package.json`  | Final shipped-resource/peer/engine checks as needed                                                                                                              |
| `bun.lock`                         | Synchronize only if metadata/dependencies actually change                                                                                                        |

### Deleted Files

None. Do not remove existing compatibility or release tests to make the new package pass.

## Implementation Details

### 1. Real Pi lifecycle and host integration

**Patterns to follow**: `tests/pi/lifecycle.ts`, `tests/fixtures/services/provider.ts`,
`docs/service-discovery.md`, and the installed Pi SDK/extension documentation.

Use actual `createAgentSessionServices`, `createAgentSessionFromServices`/runtime setup, injected
event bus, session manager and extension loader as the existing test does. Load the built writer's
default factory, not a substitute reimplementation. Temporary settings disable real user
packages/context/resources and use trusted isolated project directories. Never read the user's
normal auth/config/corpus.

Register a test-only provider/model that produces controlled output and usage through the installed
Pi provider API without network requests. If a direct Pi AI package import is needed by the test
provider, declare/pin it at the root rather than relying on transitive hoisting. Fake auth values
must remain fixture-only and must never contact a real endpoint.

Scenarios:

1. Two independent contract consumers work when loaded before and after the writer factory. They do
   not import the writer's runtime to discover it.
2. Registry-backed draft/rewrite calls return expected text/model/usage and preserve the active
   main-session model.
3. `/write-for` and the rewrite event hit the same provider path. Test the actual registered
   handler/event, not only lower-level parsing helpers.
4. Reload twice and replace the session. Previous APIs and destructured methods reject with the
   normal services error; new discovery works; listener/tool/command registrations do not
   accumulate.
5. Shutdown during generation and during a pending training operation settles requests and releases
   owned resources without touching stale context.
6. Model changes in the host affect the fallback for later requests, while explicit profile model
   metadata continues to win.
7. Run a synthetic local-folder training flow through the registered writer tools, with scripted
   built-in UI approvals and a controlled model proposal. No named question-tool extension or
   connector may be required. Rejecting approval must result in zero profile writes.

Adapt the root `test:pi` command to compile/copy both package artifacts and execute both original
and new lifecycle programs. Preserve portable Node invocations: these are compatibility checks, not
a switch away from Bun development.

**Feedback loop**:

- Playground: isolated real Pi runtime with fake provider and scripted UI.
- Experiment: both load orders, reload/new-session cycles, overlapping generation, one cancellation,
  model change, approval versus rejection.
- Check: `bun run test:pi`.

### 2. Package artifact consumers

**Pattern to follow**: `scripts/check-package.ts` and its existing clean npm service-consumer proof.

Keep `validatePackageArtifact({ packagePath, ... })` usable by publication tooling. Generalize the
CLI entrypoint to validate all public workspace packages, not only services. Avoid turning each
validation into recursive all-package validation or rebuilding repeatedly inside a dependency loop.

Build and pack services and writer once for a consumer run. Install both tarballs into a clean
temporary npm project in the same operation, using ordinary public package names/ranges. Do not
rewrite manifests to `workspace:`/`file:` for publication, hide missing dependencies, or assume
services is already published. Existing source integrity/version checks still apply to the exact
tarball later eligible for publishing.

Positive checks:

- Both packages have the expected JS/declaration exports and allowed README/license/manifest files.
- Writer `pi.extensions` points to shipped `dist/index.js`; any compiled worker/resources are
  present and loadable.
- A Node ESM program imports `@birdcar/pi-write-for/contract` and uses `@birdcar/pi-services`
  without loading the extension or opening a model/provider.
- A NodeNext TypeScript consumer compiles the public API with strict checking and uses draft/rewrite
  result types.
- Load the installed extension entrypoint in an appropriate controlled host.
- Exercise actual text-based PDF and DOCX extraction through the installed package's compiled
  private modules/worker using temporary synthetic fixtures. This test-only private-path import must
  not become an unnecessary public export.
- Run with no Bun global, no system converter binaries, and no user auth/corpus.

Negative checks must still reject missing exports/resources, absent license/readme, runtime
`.ts`/test-source leakage, Bun runtime usage, nonpublishable dependency ranges and services helper
Pi dependencies. The writer may have a documented compatible Pi peer; that does not relax the helper
policy or permit undeclared dependencies.

Clean temporary consumers/tarballs unless a caller explicitly requests retention for the existing
publication plan. Never remove paths outside the harness-owned temporary directory.

**Feedback loop**:

- Playground: clean npm temp consumers plus manifest/packing mutations in fixture workspaces.
- Experiment: actual successful installed imports/extraction; removed worker; broken export; missing
  runtime parser dependency; forbidden helper peer; services not available remotely.
- Check: `bun run check:package`.

### 3. Complete release integration without releasing

Read `docs/releasing.md` before touching release configuration. Extend existing metadata-driven
selectors where possible, not a new release manager. The two identities are `packages/services` /
`pi-services` and `packages/write-for` / `pi-write-for`.

The current workflow has services-specific outputs, metadata construction and a `pi-services-v*`
recovery case. Support the writer equivalent and preserve strict path/version/tag/SHA validation.
Normal jobs publish only Release Please-selected artifacts. Recovery must use an existing exact tag,
never create/move it.

Preserve independent releases: changing services does not silently bump/rewrite the writer's
declared dependency. When a future writer release requires a new helper version, the helper must be
available before that writer is published. For a release batch containing both, validate/order
services before writer. For writer-only publication, validate that its required helper release/range
is available; fail explicitly if not. Keep this logic limited to declared workspace dependencies and
current release planning, not a new package orchestration platform.

Test the publication plan with registry/artifact fakes. Preserve distinctions among missing,
already-published identical, immutable conflict, auth failure, network failure and malformed
registry responses. Never interpret an auth/network failure as permission to publish. OIDC trusted
publishing remains the only hosted npm authentication path. Do not add `NPM_TOKEN`,
`NODE_AUTH_TOKEN`, token-bearing `.npmrc`, login probes or fallback credentials.

Hosted repository metadata/account prerequisites remain documented maintainer tasks. Do not enable
`RELEASE_ENABLED`, update trusted-publishing settings, push tags, or invoke live `npm publish`
during this implementation.

**Feedback loop**:

- Playground: existing release fixtures with both package identities and controllable registry
  state.
- Experiment: helper-only, writer-only, both in reversed input order, missing required helper, wrong
  tag/path/SHA, existing integrity mismatch, failed registry auth/network and exact-tag writer
  recovery.
- Check: `bun run test:release && bun run test:publish && bun run test:ci`.

### 4. Aggregate verification and documentation

Root `bun run check` must run the entire `packages/write-for/test` suite as well as existing checks.
Include the new `tests/tooling/write-for-package.test.ts` in `test:ci` (already reached by `check`)
so its policy regression tests are not orphaned. Merely creating test files is insufficient because
the original aggregate script enumerates existing services tests. Keep `bun run build`, workspace,
boundary, type, lint, package, docs and release checks intact.

Provide concise working examples in the package README:

- Installation, Node/Pi baseline, `/write-for`, `/train-voice`, `/retrain-voice` and custom-channel
  training.
- Independent service discovery with the public contract, ordinary promise completion,
  absent-service fallback and explicit failures.
- Event acceptance envelope with a caller-owned promise, no shared content broadcast, and guidance
  to prefer the service for result-bearing integrations.
- New config locations/manual migration; metadata-only body inheritance; exact model precedence;
  example `openai-codex/...` reference without hardcoding a runtime default.
- Caller prose priority versus configuration-owned execution; active-model fallback only when no
  explicit model exists.
- Hybrid source discovery/consent, four native input formats, textless/encrypted diagnostics, no OCR
  and bounded source selection.
- Reviewed persistence, preserved manual/model choices, stale proposal handling, partial I/O
  reporting, no retained raw corpus and host/provider-history caveats.
- No automatic sending, no mandatory application connectors, no external RPC server.

Do not add unrelated architecture documents. Update existing overview/service/release documentation
only where it becomes incomplete or misleading. Validate command examples against implemented names
and compile the service example as a fixture so prose does not become the only proof.

**Feedback loop**:

- Playground: maintained-doc validator and compiled consumer example.
- Experiment: correct examples and deliberate stale package/command/export references in fixture
  docs.
- Check: `bun run check:docs && bun run typecheck`.

### 5. Human voice acceptance checklist

This is a required user observation, not an automatic build step. Do not select or read the user's
private writing without their explicit approval during the real training interview. Do not claim
voice acceptance from mocked model output.

After mechanical validation, give the user this procedure:

1. Install/load the compiled package in Pi with a working configured model. Confirm current session
   model before testing.
2. Choose their own representative local corpus and identify author/exclusions. Train at least two
   registers (for example internal and professional), review proposed rules/examples and approve
   save destinations.
3. Use three fresh prompts not used as training examples. Suggested coverage: an internal Slack
   update, a professional email, and a professional GitHub note. The user supplies facts, names and
   links to preserve; do not invent an evaluation corpus from their private files.
4. Inspect each draft for supplied-fact preservation and recognizable voice. Pass only when each
   needs no substantial tone/voice rewriting. Minor mechanical edits can be noted; significant
   rewriting is a failure to address.
5. Confirm the main session model did not change and there is no writer-managed raw corpus left in
   config/temp storage after normal completion.
6. Exercise a small retraining update, inspect that manual preferences/model metadata survive, and
   decline a proposal to verify no unwanted write.

The criterion passes only after the user records acceptance of all three drafts. If no live
model/corpus/reviewer is available, report **mechanical checks passed; voice acceptance pending**,
not overall product acceptance. If voice review fails, keep the specific failures for a scoped
correction; do not add an automatic benchmark platform or weaken the criterion.

## Testing Requirements

| Test/command                                                        | Coverage                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `tests/pi/write-for.ts` / `bun run test:pi`                         | Actual compiled extension, independent consumers, host tools/UI, model and session lifecycle |
| `tests/tooling/write-for-package.test.ts` / `bun run check:package` | Clean installed JS/types/worker/parser behavior and negative package policies                |
| Release test suites                                                 | Both identities, dependent ordering, recovery and existing auth/integrity boundaries         |
| `bun run check`                                                     | Every writer test plus the existing repository regression suite                              |
| Human checklist                                                     | Three held-out drafts across two registers using a real configured model                     |

No test should require a production connector, user's auth files, network inference, or an enabled
publishing workflow. Package installation may use the package registry for declared dependencies,
but local workspace dependencies must be supplied as validated tarballs.

## Failure Modes

| Component         | Failure                                 | Trigger                                       | Impact                                  | Mitigation                                              |
| ----------------- | --------------------------------------- | --------------------------------------------- | --------------------------------------- | ------------------------------------------------------- |
| Pi lifecycle      | Unit tests pass but real loader fails   | Wrong factory/export, stale context           | Installed extension unusable            | Real compiled runtime load/reload/new-session tests     |
| Artifact          | Worker/parser missing from tarball      | Allowlist/build mismatch                      | Native training fails for consumers     | Node extraction against installed artifact              |
| Artifact consumer | Hidden unpublished dependency           | Writer install fetches services from registry | False packaging failure or wrong helper | Install validated local dependency tarballs together    |
| Publication       | Writer released before required helper  | Independent/batched releases                  | Broken install for users                | Dependency availability/order checks with fixture proof |
| Aggregate tests   | New tests never run in CI               | Existing script enumerates only old tests     | False green                             | Add writer suite to root check and assert routing       |
| Acceptance        | Mechanical pass mistaken for good voice | Automated run cannot judge prose              | User receives unsuitable output         | Explicit pending human criterion and concrete checklist |

## Validation Commands

```sh
bun run build
bun run check:workspace
bun run test:boundaries
bun run typecheck
bun run lint
bun test packages/write-for/test
bun run test:pi
bun run check:package
bun run test:release
bun run test:release-lock
bun run test:publish
bun run test:ci
bun run check:docs
bun run check
```

Run the contract verifier only after the code/spec phase work exists:

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs docs/ideation/2026-09-22-pi-write-for/contract-data.json
```

Resolve `CLAUDE_PLUGIN_ROOT` to the installed ideation plugin when invoking that command. Report its
exact `VERIFY` line and separately report the human judgment state; a zero command failure count
does not certify voice quality.

## Rollout Considerations

Leave release activation and live publication to the maintainer. Manual migration is moving/copying
compatible Markdown into the new roots, not silently merging legacy directories. Consumers should
rediscover on demand after reload/session replacement. The extension does not send drafts or change
host model settings. Releasing an initial writer before the helper is available is blocked by
dependency validation, not repaired by token-based bootstrap publication.
