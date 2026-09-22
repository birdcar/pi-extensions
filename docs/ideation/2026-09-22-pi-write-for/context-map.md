# Context Map: 2026-09-22-pi-write-for

**Phase**: 1
**Gates**: 5/5 ready
**Verdict**: GO

## Gates

| Gate                 | Status | Evidence |
| -------------------- | ------ | -------- |
| Scope clarity        | ready | `docs/ideation/2026-09-22-pi-write-for/spec-phase-1.md` names every new file under `packages/write-for/`, fixtures under `tests/fixtures/write-for/`, and every modified root/tooling/release file. |
| Pattern familiarity  | ready | Read all spec pattern files: `packages/services/package.json`, `packages/services/tsconfig.json`, `packages/services/src/contracts.ts`, `tests/fixtures/services/contract.ts`, `docs/service-discovery.md`, plus `docs/releasing.md` and Pi extension/package docs. |
| Dependency awareness | ready | Grep mapped consumers of modified tooling/release files: `scripts/check-package.ts` is imported by `scripts/publish.ts:6`; `release-please-config.json` is read by `scripts/release.ts:43`, `scripts/check-workspace.ts:120`, and `tests/release/manifest.test.ts:29`; package/check scripts are asserted by `tests/release/workflows.test.ts:248`. |
| Edge case coverage   | ready | Spec and existing tests identify concrete edge cases: strict contract imports, accessors, cross-copy errors, unsafe names/symlinks, untrusted project config, env roots, malformed YAML, frontmatter-only overrides, model precedence conflicts, nonpublishable deps, and multi-package release routing. |
| Test strategy        | ready | Specific verification commands are in the spec and repo scripts: `bun test packages/write-for/test/contract.test.ts packages/write-for/test/config.test.ts`, `bun run check:workspace`, `bun run test:boundaries`, `bun run test:release`, `bun run test:ci`, `bun run check`. |

## Key Patterns

- `packages/services/package.json` — public package manifest pattern: `type: module`, `exports` to `dist`, `files` allowlist with `dist`, `LICENSE`, `README.md`, `package.json`, `publishConfig.access`, `build`/`typecheck` scripts, and `sideEffects: false`. Writer should add `.` and `./contract` exports and Pi `pi.extensions` metadata while keeping publishable dependency ranges.
- `packages/services/tsconfig.json` — package build extends root strict NodeNext config, sets `rootDir: src`, `outDir: dist`, `declaration: true`, and includes only `src/**/*.ts`.
- `packages/services/src/contracts.ts` — side-effect-free public contract module with exported interfaces, constants, and simple pure helpers; writer `contract.ts` should follow explicit exports and avoid runtime provider/Pi/filesystem imports.
- `tests/fixtures/services/contract.ts` — independent fixture imports only service types from source, declares request/result/API interfaces, structural `ServiceContract`, and simple validators; writer fixtures should likewise import only `@birdcar/pi-write-for/contract` plus services types, not `src/index.ts`.
- `docs/service-discovery.md` — documents service contract separation, synchronous event-bus discovery, flat own callable API descriptors, exact `apiMajor`, and provider/consumer responsibilities; writer should expose a service descriptor contract and let `@birdcar/pi-services` enforce lifecycle/discovery rules.
- `docs/releasing.md` — release manifest mode uses independent path-scoped components, disabled-by-default release workflow, OIDC npm publishing only, exact tag recovery, and lockfile-only release PR refresh.
- Pi docs `docs/extensions.md` and `docs/packages.md` — Pi extension packages export a default factory receiving `ExtensionAPI`; package metadata uses `pi.extensions`; Pi core packages imported by extensions should be peer dependencies with `*`; use `CONFIG_DIR_NAME` from Pi instead of hardcoding `.pi`.
- Pi examples `examples/extensions/event-bus.ts`, `model-status.ts`, `hello.ts` — extension factories are plain `export default function (pi: ExtensionAPI)`, register events/tools in factory, and import Pi types with `import type`.

## Dependencies

- `package.json` — consumed by → root scripts invoked by `.github/workflows/ci.yml`, `tests/release/workflows.test.ts:248` aggregate script assertions, workspace filtering via Bun workspaces, root dependency pins in `bun.lock`.
- `bun.lock` — consumed by → `bun install --frozen-lockfile`, release workflow lock refresh in `.github/workflows/release.yml`, `tests/release/lockfile.test.ts` (not read in detail; identified from scripts).
- `release-please-config.json` — consumed by → `tests/release/manifest.test.ts:29`, `scripts/release.ts:43`, `scripts/check-workspace.ts:120`, `tests/release/publish.test.ts:39` fixture conventions, `.github/workflows/release.yml:43` Release Please action.
- `scripts/check-package.ts:34` — consumed by → CLI `bun run check:package`, `scripts/publish.ts:6` import, `scripts/publish.ts:87` artifact factory, package artifact validation during `tests/release/publish.test.ts` by mocked factories.
- `tests/release/manifest.test.ts:29` — consumed by → `bun run test:release`; validates Release Please config and upstream release behavior.
- `tests/tooling/workspace.test.ts:7` — consumed by → `bun run test:ci`; imports `validateCurrentWorkspace`/`validateWorkspaceManifests` from `scripts/check-workspace.ts`.
- `tests/tooling/boundaries.test.ts:9` — consumed by → `bun run test:boundaries`; writes a temporary `packages/boundary-fixture/src/index.ts` and invokes ESLint policy from `eslint.config.js`.
- `scripts/check-docs.ts:12` — consumed by → CLI `bun run check:docs`, `tests/tooling/docs.test.ts:6`; `maintainedDocs` currently lists service docs only and must include writer README.
- `.github/workflows/release.yml:31` — consumed by → `tests/release/workflows.test.ts:79` release output assertions and publication wiring assertions.
- `tests/release/workflows.test.ts:79` — consumed by → `bun run test:ci`; validates release workflow outputs/env/security and root aggregate check contents.
- New `packages/write-for/src/contract.ts` — expected consumers → `packages/write-for/test/contract.test.ts`, `tests/fixtures/write-for/consumer-a.ts`, `tests/fixtures/write-for/consumer-b.ts`, eventual external consumers; must not import writer runtime.
- New `packages/write-for/src/config.ts` — expected consumers → `packages/write-for/test/config.test.ts` and later runtime adapter; keep resolver inputs explicit and no global mutable cache.
- New `packages/write-for/src/index.ts` — expected consumers → Pi package loader via `pi.extensions`; should be minimal default factory with no top-level provider/model registration for phase 1.

## Conventions

- **Naming**: Packages use `@birdcar/pi-*`; release components use `pi-*`; tests are `*.test.ts` under package `test/` or `tests/tooling`/`tests/release`; constants are uppercase (`DISCOVERY_PROTOCOL`, `SERVICE_ERROR_CODES`).
- **Imports**: Production package code uses NodeNext ESM and explicit `.js` extensions for relative imports (`packages/services/src/index.ts`); tests/tooling may import `.ts` source with `allowImportingTsExtensions`; type-only imports are used for contracts.
- **Error handling**: Structural errors are plain `Error` objects with stable `name`/`code` and structural predicates (`packages/services/src/errors.ts`); service disposal errors are preserved by services and writer should not relabel them.
- **Types**: Root `tsconfig.json` is strict ES2022/NodeNext with `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noUnusedLocals`, and declarations emitted per package; public contracts use interfaces for request/result/API shapes.
- **Testing**: Bun is the test runner; package tests import source directly; tooling tests may use Bun globals; production package code must avoid Bun APIs and is linted by `eslint.config.js` for `packages/*/src/**/*.ts`.
- **Packaging/release**: Public packages must have exact root LICENSE copy, README naming package, dist exports that exist after build, publishable semver dependency ranges, and release registration in `release-please-config.json`.
- **Pi extension**: Default export should be a function declaration/factory accepting `ExtensionAPI`; use Pi `CONFIG_DIR_NAME` for project config name; Pi packages should declare resources under `pi.extensions` and list Pi packages as peers rather than bundled runtime deps.

## Risks

- Multi-package release wiring is currently services-specific: `.github/workflows/release.yml:31-33`, `tests/release/workflows.test.ts:79-81`, and recovery tag parsing at `.github/workflows/release.yml:130` all hardcode services outputs/tags.
- `scripts/check-package.ts:72-80` currently rejects any `@earendil-works/*` dependency for all packages; this must be narrowed to `@birdcar/pi-services` so writer can declare a Pi peer.
- `scripts/check-docs.ts:12-18` only maintains service docs; adding writer README without updating this will leave docs validation blind or failing depending links.
- `eslint.config.js:22` restricts Bun APIs in `packages/*/src/**/*.ts` and service fixtures only; writer fixtures may need inclusion if they are intended to be portable examples.
- Contract validator must avoid invoking accessors even though the services fixture uses direct `(value as EchoApi).echo`; builder should use own property descriptors for `draft`/`rewrite` per spec.
- Resolver has several precedence footguns: model metadata order must not collapse global/local file pairs before applying last-wins order; frontmatter-only local prose must inherit global prose; unknown channels without default register must require caller/user register.
- YAML dependency `yaml@2.8.1` is pinned at root; writer config parsing must use safe ordinary schemas and reject unsafe/custom tags without evaluating anything.
