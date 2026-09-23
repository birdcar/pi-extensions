# Context Map: 2026-09-22-pi-write-for

**Phase**: 4
**Gates**: 5/5 ready
**Verdict**: GO

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Scope clarity | ready | Phase 4 spec names three new files and specific modified files; current tree contains the named additions and root/package/release/docs changes, e.g. `tests/pi/write-for.ts`, `tests/fixtures/write-for/provider.ts`, `tests/tooling/write-for-package.test.ts`, `package.json:16-27`, and `tsconfig.pi-tests.json:10`. |
| Pattern familiarity | ready | Read required patterns and current implementations: `tests/pi/lifecycle.ts`, `tests/fixtures/services/provider.ts`, `docs/service-discovery.md`, `scripts/check-package.ts`, `scripts/check-workspace.ts`, release scripts/tests, package docs, and `AGENTS.md`. |
| Dependency awareness | ready | Grep mapped consumers of changed APIs/scripts: `validatePackageArtifact` is consumed by `scripts/publish.ts:6,126` and `tests/tooling/write-for-package.test.ts:4-12`; workspace validation by `tests/tooling/workspace.test.ts:7-163`; writer package paths by Pi/release/tooling/docs tests. |
| Edge case coverage | ready | Concrete edge cases are identified in code/spec: load order, reload/new-session stale handles, cancellation, command/listener accumulation, host model fallback vs explicit model, rejected training approval, installed worker/PDF/DOCX extraction, local services+writer tarballs, publish dependency ordering, auth/network fail-closed, docs/example drift, and human voice pending state. |
| Test strategy | ready | Specific commands are available from spec and scripts: `bun run test:pi`, `bun run check:package`, `bun run test:release`, `bun run test:release-lock`, `bun run test:publish`, `bun run test:ci`, `bun run check:docs`, and aggregate `bun run check` from `package.json:18,26-27`. |

## Key Patterns

- `tests/pi/lifecycle.ts` — real Pi runtime proof uses `createAgentSessionServices`, `createAgentSessionFromServices`, `createAgentSessionRuntime`, in-memory settings, injected event bus, extension factories, `session.bindExtensions({})`, reload/new-session cycles, stale handle rejection, and temp-dir cleanup.
- `tests/fixtures/services/provider.ts` — fixture provider pattern exposes a registration plus controlled waiters, validates requests, uses a lifetime `AbortController`, and returns deterministic data without network calls.
- `docs/service-discovery.md` — consumers discover through injected `pi.events`, do not import provider runtimes, treat absent service as `undefined`, rediscover after reload/session replacement, and expect disposed methods to reject with `SERVICE_DISPOSED`.
- `tests/pi/write-for.ts` — compiled writer lifecycle proof loads `../../packages/write-for/dist/index.js`, uses real Pi runtime/session setup, fake model runtime injection, consumer-before/after load order, rewrite event, `/write-for`, reload/new-session, cancellation, model precedence, and registered training tools.
- `tests/fixtures/write-for/provider.ts` — fake writer model runtime implements model lookup/auth/complete APIs, records calls, supports controlled hanging/abort behavior, and avoids live inference.
- `scripts/check-package.ts` — package artifact validation builds/packs, rejects source/test/TS leakage, requires dist JS/types/readme/license/manifest, installs in clean npm consumers, validates writer `pi.extensions`, local services+writer tarballs, contract imports, extension entrypoint, and private document worker extraction.
- `scripts/check-workspace.ts` and `tests/tooling/workspace.test.ts` — workspace validation is pure manifest validation plus actual workspace test; writer-specific checks include `./contract` export and allowed Pi peer while preserving no-Pi-dependency policy for services.
- `scripts/release.ts`, `scripts/publish.ts`, and release tests — release selection validates package path/version/tag/SHA/source SHA; publish planning orders dependencies first, validates artifact identity/repository/integrity, and treats auth/network/malformed registry states as hard errors.
- `.github/workflows/release.yml` and `tests/release/workflows.test.ts` — workflow assertions guard writer and services release outputs, exact-tag recovery for both tag families, pinned actions, and OIDC-only npm publish.
- `scripts/check-docs.ts` and `tests/tooling/docs.test.ts` — maintained docs include root docs plus `packages/write-for/README.md`; referenced fixture examples are type-compiled so docs are not prose-only proof.
- `packages/write-for/README.md` — final user guidance covers installation/baseline, commands, config/profile locations, model precedence, training formats/limits/consent, service discovery, event ingress, privacy caveats, and human acceptance.

## Dependencies

- `package.json:16-27` — consumed by developer/CI checks; `test:write-for` runs all `packages/write-for/test`, `test:pi` builds/copies services and writer artifacts then runs both lifecycle programs, `test:ci` includes `tests/tooling/write-for-package.test.ts`, and `check` routes the aggregate suite.
- `tsconfig.pi-tests.json:10` — consumed by `package.json:test:pi`; includes `tests/pi/**/*.ts` and writer fixture provider for compiled Node Pi tests.
- `tests/pi/lifecycle.ts` — consumed by root `test:pi`; original services lifecycle proof must remain intact while writer lifecycle runs separately.
- `tests/pi/write-for.ts:16-21,224-226,273-417` — consumed by root `test:pi`; depends on compiled services/writer dist artifacts and `tests/fixtures/write-for/provider.ts`.
- `tests/fixtures/write-for/provider.ts:8` — consumed by `tests/pi/write-for.ts`; implements fake model runtime only for tests.
- `tests/fixtures/write-for/consumer-a.ts` and `tests/fixtures/write-for/consumer-b.ts` — referenced by docs validation and package tests; prove contract-only consumers can import `@birdcar/pi-write-for/contract` without loading runtime.
- `scripts/check-package.ts:35-275` — consumed by CLI `bun run check:package`, `tests/tooling/write-for-package.test.ts:4-12`, and `scripts/publish.ts:6,126`; must keep `validatePackageArtifact({ packagePath, dependencyTarballs, keepTemp })` usable by publish tooling.
- `scripts/check-workspace.ts:54-294` — consumed by CLI `check:workspace` and `tests/tooling/workspace.test.ts`; validates manifests, dependency policy, release registration, exports, README/LICENSE, and packed contents.
- `tests/tooling/workspace.test.ts:147-163` — guards writer `./contract` export and services no-Pi-dependency policy.
- `tests/tooling/boundaries.test.ts:1-114` — consumes ESLint config; protects no Bun globals/imports in production packages and pure contract-module isolation.
- `scripts/release.ts:35-147` — consumed by `.github/workflows/release.yml` and `scripts/publish.ts`; tests assert exact path/version/tag/SHA release selection.
- `scripts/publish.ts:54-190` — consumed by release workflow publish step and `tests/release/publish.test.ts`; implements dependency-first ordering, helper availability checks, artifact validation, integrity/repository validation, and fail-closed registry classification.
- `.github/workflows/release.yml:34-36,136,144` — consumed by workflow tests; wires writer outputs and exact-tag recovery alongside services while preserving publish policy.
- `.github/workflows/ci.yml` — consumed by workflow tests; protects declared Node baseline and smoke/full check routing.
- `scripts/check-docs.ts:12-18,46-92,103-119` — consumed by CLI `check:docs` and `tests/tooling/docs.test.ts`; maintained docs include writer README and referenced fixtures are compiled.
- `packages/write-for/package.json` — consumed by workspace/package validators, clean npm consumers, Pi extension loader through `pi.extensions`, and artifact tests; exports `.` and `./contract`, includes `dist`, parser deps, services dep, and Pi peer.
- `packages/write-for/README.md`, root `README.md`, `docs/releasing.md`, `docs/service-discovery.md` — consumed by docs validator and user-facing contract; current docs describe writer package, release identity, dependency-first publication, and service discovery example.

## Conventions

- **Naming**: Public packages use `@birdcar/pi-*`; release components are `pi-services` and `pi-write-for`; writer tools use snake_case `write_for_*`; slash commands are `write-for`, `train-voice`, and `retrain-voice`.
- **Imports**: Production packages use portable NodeNext ESM with explicit `.js` relative imports; tests may import source `.ts`; Pi lifecycle tests compile to `.pi-tests` and run with Node against built/copied dist artifacts.
- **Error handling**: Services helper errors remain structural and stale APIs reject with `SERVICE_DISPOSED`; writer failures use `WriteForError`; release/publish tooling accumulates string errors and fails closed for auth/network/malformed registry responses.
- **Types**: Public contracts stay side-effect-free and flat; workspace/release/publish tool APIs export pure functions for fixture tests; strict TypeScript and no Bun globals in production code.
- **Testing**: Bun unit/tooling tests; Node subprocesses for package/Pi artifact compatibility; fixture runtimes use temp dirs and deterministic fake providers; docs examples are compiled by `scripts/check-docs.ts`.
- **Packaging**: `npm pack` allowlist should include only `dist`, `LICENSE`, `README.md`, `package.json`; writer private worker and parser dependencies must be present and loadable from the installed artifact.

## Risks

- `scripts/publish.ts:176-185` checks writer-only helper availability by passing the semver range string to the registry hook; tests expect that behavior, but a live `npm view @birdcar/pi-services@^0.1.0` must be acceptable for range checks.
- `tests/pi/write-for.ts` uses internal runtime/session details such as `_extensionRunner` for command counts; this is valuable coverage but could be brittle across Pi SDK upgrades.
- `scripts/check-package.ts:217-220` private-imports installed `dist/documents.js` to test PDF/DOCX extraction; keep it test-only and do not promote parser internals to public exports unnecessarily.
- Real Pi lifecycle tests rely on compiled package artifacts and fake model/runtime behavior; they prove loader/session boundaries but cannot certify human voice quality.
- Human voice acceptance is not automatable; final handoff must report mechanical checks separately from user-recorded voice acceptance.

## Prior Phase 3 Context Retained

### Prior Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Scope clarity | ready | Phase 3 spec named training/source/document/store files, six tests, fixtures, and related package/root/docs manifests. |
| Pattern familiarity | ready | Read `commands.ts`, `model.ts`, training/source/document/store files, package tests, `AGENTS.md`, and Pi extension docs. |
| Dependency awareness | ready | Mapped consumers of training manager/tools/prompts/store, document extraction, package metadata and root scripts. |
| Edge case coverage | ready | Covered no UI, replacement, untrusted project, declined samples, invalid UTF-8, symlink escape, unsupported/textless/encrypted docs, worker abort/deadline, wrong model, oversized corpus, stale proposal, frontmatter preservation, partial save failure, retention cleanup. |
| Test strategy | ready | Phase 3 commands included package build plus source/document/training/store/retention tests and aggregate checks. |

### Prior Key Patterns

- `packages/write-for/src/commands.ts` — command handlers parse args then delegate to engine/training and notify through Pi UI.
- `packages/write-for/src/model.ts` — `runText` selects configured or active model, checks auth, normalizes usage, handles aborts, rejects tool calls/empty text.
- `packages/write-for/src/training-tools.ts` — TypeBox schemas, plain string enums/objects, bounded tool results with IDs/diagnostics.
- `packages/write-for/src/sources.ts` — deterministic traversal, strict UTF-8, excluded dirs, symlink containment, per-file/total/character limits.
- `packages/write-for/src/documents.ts` / `document-worker.ts` — worker facade with deadline/resource limits; worker uses `unpdf` and `mammoth` and returns structured text/warnings.
- `packages/write-for/src/training-store.ts` — snapshots target hashes, preserves frontmatter, strips generated frontmatter, reviews exact proposed body, stale checks under mutation queue, atomic per-file writes.

### Prior Dependencies

- `packages/write-for/src/index.ts` — consumed by package entry, `entrypoints.test.ts`; registers service, training tools, commands, events, and shutdown disposal.
- `packages/write-for/src/commands.ts` — consumed by index and command/training tests.
- `packages/write-for/src/model.ts` — consumed by engine/training and model/training-model tests.
- `packages/write-for/src/training.ts` — consumed by commands, index, tools, and training tests.
- `packages/write-for/src/training-tools.ts` — consumed by index and asserted by training-flow tests.
- `packages/write-for/src/sources.ts` — consumed by training and source tests; imports `extractDocumentText`.
- `packages/write-for/src/documents.ts` — consumed by sources and document tests; emits worker URL.
- `packages/write-for/src/document-worker.ts` — consumed at runtime by emitted `dist/documents.js`.

### Prior Risks

- `documents.test.ts` and `sources.test.ts` need package build before importing `../dist` worker-resolving modules.
- Native parser behavior depends on pinned `unpdf` and `mammoth` versions.
- Training cleanup must not broaden source access or retain raw corpus.
- Character-count context guarding is approximate and model context failures must stay explicit.
- Batch saves are per-file atomic, not cross-file transactional.

## Prior Phase 1 Context Retained

- Public packages follow `packages/services/package.json` and `tsconfig.json`: module ESM, exports to `dist`, declarations, files allowlist, MIT license, `sideEffects:false`.
- Service contracts follow `packages/services/src/contracts.ts` and `tests/fixtures/services/contract.ts`: side-effect-free interfaces/constants/validators and no runtime/provider imports.
- Release/workspace/package/docs tooling is part of the blast radius for package metadata changes.
- `docs/releasing.md` requires independent path-scoped releases, disabled hosted activation, OIDC-only npm publishing, exact-tag recovery, and lockfile-only release PR refresh.
