# Implementation Spec: Pi Extension Monorepo Foundation — Phase 1

**Contract**: [contract.md](./contract.md)
**Phase**: Portable workspace foundation
**Approved scope**: Full
**Prerequisite**: Local Git bootstrap described below, before any execution engine or branch-isolation operation
**Estimated effort**: M

## Technical Approach

Keep the existing Bun workspace rather than introducing a monorepo orchestrator. Produce a private root and a single public ordinary npm library, `@birdcar/pi-services`, under `packages/services`. Use Bun 1.3.14 for development and lockfile operations, strict TypeScript with NodeNext modules and ES2022 output for production, and separate tooling/test types. Build the library with TypeScript to unbundled ESM and declarations. The library must not depend on Bun or initialize any Pi extension when imported.

This phase establishes enforceable runtime boundaries, package metadata validation, and a buildable library shell. Phase 2 implements the actual discovery API; Phase 3 adds releases and completes human documentation. Do not introduce a fake production service or declare unfinished future checks as successful no-ops.

The repository currently has `package.json`, `bun.lock`, `tsconfig.json`, `.gitignore`, a Bun-only `AGENTS.md`, and an empty `packages/`. There is no existing implementation pattern to reuse beyond the workspace layout. The current root `module: index.ts` points at a nonexistent file and must be removed.

## Decisions Considered and Rejected

- **Bun tooling, Node-compatible production** — rejected: Bun-only extension APIs, sidecars, or compiled Bun workers. Pi users must not need Bun.
- **One small shared library with private fixtures later** — rejected: documentation-only discovery or a real extension in this project. A tested reusable helper is the agreed deliverable.
- **Independent `@birdcar/pi-*` packages** — rejected: unscoped names, provisional names, or lockstep suite releases. The initial library is `@birdcar/pi-services` at version `0.1.0`.
- **Compiled ESM and declarations, without bundled Pi** — rejected: relying on consumers' TypeScript loaders or shared process-global singletons.
- **Ordinary semver ranges in public dependencies** — rejected: automatic dependent release propagation and helper bundling. Private development links may use workspace protocols; published manifests must not.
- **Pin Bun using `packageManager`, CI, and documentation** — rejected: arbitrary global versions for lockfile-sensitive automation. Initial baseline is Bun 1.3.14.
- **MIT** — rejected: Apache-2.0 or deferred licensing, as explicitly selected by the user.
- **Local-only Git bootstrap** — rejected: remote creation, pushing, account setup, or publication during this project.
- **Date-prefixed ideation directories** — rejected: undated slugs. Use `docs/ideation/YYYY-MM-DD-<slug>/` and matching internal paths.
- **Authoritative AGENTS.md and referenced architecture docs** — rejected: hiding mandatory requirements in an optionally invoked skill or adding a scaffolding framework.

## Execution Bootstrap

This is a prerequisite for execution, not work to perform while generating specs.

1. Inspect the current directory and preserve all existing files. Confirm that Git is still absent; do not reinitialize or overwrite an existing repository if one has since appeared.
2. Initialize local Git on `main` when absent. Inspect intended baseline files and ignore rules; never blindly stage secrets, `node_modules`, or unrelated additions.
3. Run the checks available in that baseline, then use the user's `/commit` skill to create the reviewed baseline commit. If the commit skill is unavailable, pause for the user rather than silently substituting a different commit workflow. Do not claim that the future test suite passed before it exists.
4. For an express execution, create/switch to `ideation/2026-09-21-pi-extension-monorepo` only after the baseline exists. Existing execution branches with prior phase commits require resume/fresh-run handling; never delete them automatically.
5. Only then start the phase engine. No remote, push, or npm publication is authorized.

The artifact-only planning session intentionally does none of these operations.

## Feedback Strategy

**Inner-loop command**: `bun test tests/tooling/workspace.test.ts tests/tooling/boundaries.test.ts`

**Playground**: Bun tests that create temporary manifest/source fixtures and invoke the actual configured validators, compiler, and linter.

**Why this approach**: Metadata and environment boundaries need positive and negative examples, not prose assertions. Keep fixture sizes small so this scoped loop runs in seconds. Configuration files and re-exports need no separate experimentation loop.

## File Changes

All paths are relative to the repository root. Build outputs are generated and ignored.

### New Files

| File Path | Purpose |
| --- | --- |
| `LICENSE` | MIT license with the maintainer's identity; no invented organization |
| `tsconfig.tooling.json` | Bun-enabled strict config for scripts and ordinary Bun tests |
| `eslint.config.js` | Production/runtime restrictions and separate tooling/test lint scope |
| `.prettierrc.json` | Formatting configuration |
| `.prettierignore` | Ignore generated output, lockfile formatting, dependencies, generated ideation artifacts |
| `packages/services/package.json` | Public ESM library manifest, exports, files, build script, version, license |
| `packages/services/LICENSE` | Exact copy of the canonical MIT license for reliable workspace packaging |
| `packages/services/tsconfig.json` | Production build configuration, `src` to `dist`, declarations |
| `packages/services/src/index.ts` | Buildable entrypoint; Phase 2 replaces the empty module with real exports |
| `scripts/check-workspace.ts` | Reusable actual-manifest validator and CLI |
| `tests/tooling/workspace.test.ts` | Positive/negative package metadata tests |
| `tests/tooling/boundaries.test.ts` | Actual compiler/linter boundary checks |

### Modified Files

| File Path | Changes |
| --- | --- |
| `package.json` | Private workspace scripts and pinned dev dependencies; remove phantom module entrypoint and TypeScript peer dependency |
| `bun.lock` | Re-resolve using the pinned Bun version |
| `tsconfig.json` | Strict NodeNext/ES2022 production base without ambient Bun types |
| `.gitignore` | Confirm dependency/build/cache/temp-artifact exclusions without ignoring source fixtures |
| `AGENTS.md` | Replace runtime-incompatible Bun guidance with portable extension rules |

### Deleted Files

None. Remove obsolete fields/instructions rather than retaining unused aliases or comments.

## Implementation Details

### 1. Workspace and package surface

- Root remains `private: true`, `type: module`, and `workspaces: ["packages/*"]`.
- Set `packageManager: "bun@1.3.14"`. Pin exact development dependency versions selected during implementation; remove `latest` ranges. TypeScript belongs in root `devDependencies`, not root `peerDependencies`.
- Use TypeScript, `@types/node`, `@types/bun` for tooling only, ESLint with appropriate TypeScript support, and Prettier. Do not add bundlers, task schedulers, or release tooling before Phase 3.
- Root scripts initially include `build`, `typecheck`, `lint`, `format`, `test`, `check:workspace`, `test:boundaries`, and a truthful phase-local `check`. Later phases extend that same aggregate. `lint` includes a nonmutating format check; `format` is the explicit write operation.
- `packages/services` begins at `0.1.0`, has `license: MIT`, `type: module`, explicit `exports` with ESM and declaration paths, and a tight `files` allowlist. Set public npm access in package publish metadata. Do not invent a remote repository URL before one exists.
- Include the MIT text in package contents through an explicit `packages/services/LICENSE` copy of the canonical root license. Validate equality so the copy cannot silently drift; verify the actual tarball contains it.
- The helper is an ordinary library: no `pi` resource manifest and no `pi-package` keyword implying a user-installable extension. Future real extensions will need explicit `pi` manifests and host peer dependencies where imported.
- No runtime dependencies are required for the initial helper shell. Do not install the Pi host into the helper merely to provide types: Phase 2 uses narrow structural interfaces and root-only dev dependencies for real-host integration.
- Private root development links may use `workspace:*`; public dependencies must use publishable semver ranges. Do not make root Git installation appear to install the whole extension suite.

### 2. Production/tooling boundaries

- Base production settings: strict, NodeNext module and resolution modes, target/lib ES2022, `types: ["node"]`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, and appropriate unused checks. NodeNext output imports use `.js` relative specifiers.
- Package compilation emits declarations and ESM to `dist`; no Bun-specific globals or imports, no TS-only path aliases, no unresolved source entrypoints. Use a clean build to prevent stale output from entering tarballs.
- Tooling config extends the strict base, uses `noEmit`, permits Bun/Node types, and covers scripts plus ordinary tests only. Phase 2 adds a separate Node-only compilation for Pi smoke fixtures; do not accidentally widen that runtime to Bun.
- ESLint scopes production rules to `packages/*/src/**`: reject the `Bun` global and Bun module imports/re-exports, including `bun` and `bun:*`. Cover dynamic imports/require forms rather than assuming removing ambient types prevents explicitly importing Bun.
- Scripts and `bun:test` files may use Bun. Node/Pi smoke files may not. Ignore generated files rather than weakening source rules globally.

**Feedback loop**:
- **Playground**: temporary source trees using the actual repository compiler/linter configuration.
- **Experiment**: Node built-ins pass; `Bun.file`, `import ... from "bun:sqlite"`, re-export, and dynamic Bun import fail in production; legitimate `bun:test` tooling passes. Assert diagnostics identify the intended violation, not an unrelated missing-module error.
- **Check command**: `bun run test:boundaries`.

### 3. Workspace validation

Keep `scripts/check-workspace.ts` small. Expose a pure manifest-validation function and a CLI that loads actual workspace manifests. Check private/public classification, unique names, exports resolving after build, version syntax, license metadata, files allowlists, and absence of root runtime entrypoints. Do not hardcode that this repository must forever contain exactly one public package. The initial allowlist is one package; later additions must be supported by explicit metadata.

Phase 3 extends this validator with release configuration/manifest consistency. Do not require nonexistent release files in Phase 1 or add permanent `if missing, pass` behavior for the completed repository.

**Feedback loop**:
- **Playground**: valid root/library/private-fixture manifest objects and temporary output directories.
- **Experiment**: duplicate names, public `workspace:`/`file:` dependencies, missing exported files, public root, missing license, valid declaration paths, and a newly added valid second package.
- **Check command**: `bun test tests/tooling/workspace.test.ts`.

### 4. Maintainer guidance

Replace AGENTS.md's instructions to use `Bun.serve`, `Bun.file`, `bun:sqlite`, `Bun.$`, and HTML/Bun frontend scaffolding in extension runtime code. Preserve Bun as the preferred development runner/package manager.

State Node built-ins and Web APIs supported by the declared Node baseline are the runtime vocabulary. Explicit Node invocations and npm artifact-consumer tests are intentional compatibility checks, not a switch away from Bun development. Require strict TypeScript, tests/type checks/lint before commits, the user's commit skill, and no unrequested co-author trailer.

Record date-prefixed ideation folders. State that service contracts must not import/init providers. Phase 2 adds the actual normative protocol link once its destination exists; Phase 3 adds release guidance. Do not introduce a project skill or stale links to files not produced yet.

## Testing Requirements

| Test File | Coverage |
| --- | --- |
| `tests/tooling/workspace.test.ts` | Actual metadata validator plus invalid and extensible package cases |
| `tests/tooling/boundaries.test.ts` | Production rejects Bun while tooling remains usable |

Required observations:
- Clean builds produce only intended ESM and declarations.
- Root `bun install --frozen-lockfile` succeeds after updating the committed lockfile once with the pinned tool.
- Type/lint/format commands do not mutate files.
- The public helper shell has no side effects, registry, global bus, or fake service implementation.

## Failure Modes

| Component | Failure | Trigger | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| Boundary verifier | False-positive rejection | An invalid fixture fails for missing setup rather than a Bun API | Runtime restriction appears tested but is not | Assert specific relevant diagnostics and include valid controls |
| Workspace validator | Fixed package count | A second public package is added | Monorepo cannot grow without rewriting validation | Validate metadata and registration relationships, not a permanent name/count snapshot |
| Build | Stale emitted files | Removed source remains in dist | Obsolete code ships | Clean dist before building; later tarball check inspects actual contents |
| Bootstrap | User files accidentally committed | Blind staging before a baseline exists | Unintended history or sensitive files | Review/stage explicit baseline paths using the commit skill; no automatic broad add |

## Validation Commands

Run from the repository root after dependency installation:

```bash
bun install --frozen-lockfile
bun run build
bun run check:workspace
bun run test:boundaries
bun run typecheck
bun run lint
bun run check
```

At this phase boundary `check` covers only implemented checks. Phase 3 must expand it to every verifier enumerated in the contract; no placeholder-success scripts are permitted.

## Rollout and Handoff

Commit locally only after checks pass. No remote creation, pushes, credentials, or publication. Phase 2 consumes the built package surface and tooling boundaries. The initial buildable empty module is a phase boundary, not the final public API.
