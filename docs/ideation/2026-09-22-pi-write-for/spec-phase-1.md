# Implementation Spec: Pi Write For — Phase 1

**Contract**: ./contract.md

**Scope**: Full (approved); phases 1–4 are sequential.

**Estimated Effort**: M

## Technical Approach

Introduce `@birdcar/pi-write-for` under `packages/write-for`. It is a portable NodeNext ESM Pi
extension, not a Claude plugin port. Publish the extension entrypoint separately from a
side-effect-free `./contract` subpath. Consumers use that subpath and `@birdcar/pi-services`; they
never import the extension factory to discover the service.

This phase establishes the public request/result contract, package skeleton, deterministic
Markdown/frontmatter resolution, and the minimum second-package tooling changes needed to keep
existing checks valid. Do not implement model generation, training, a new discovery protocol, or a
general configuration framework here. Runtime calls arrive in phase 2; learning arrives in phase 3.

Use the installed Pi baseline (`@earendil-works/pi-coding-agent` 0.87.0, Node >=22.19.0) and the
existing strict ES2022/NodeNext settings. Pin added development/runtime dependencies at the root and
synchronize `bun.lock` with Bun. Published package dependencies must use publishable
versions/ranges, never `workspace:` or `file:`. Keep `@birdcar/pi-services` free of Pi dependencies.

## Decisions Considered and Rejected

- **Headless service with interactive consumers** — rejected UI takeover or multiple handoff modes;
  callers own presentation, approval, revision, and delivery.
- **Existing pi-services protocol** — rejected a writer-specific registry or event RPC system.
- **New configuration names, manual migration** — rejected legacy bat-kol discovery and automatic
  import.
- **Scope-first model precedence** — rejected project-only selection and global channel metadata
  defeating a project style override.
- **Independent metadata/body inheritance** — rejected erasing inherited prose when an override
  contains only frontmatter.
- **Configuration-owned models** — rejected caller-selected models and silent provider/model
  fallback.
- **Unknown channels without a registration catalog** — rejected one dedicated agent or adapter per
  application.
- **Overridable anti-slop defaults** — rejected hard word bans that defeat learned voice or injected
  writing requirements.
- **Second-package validation from introduction** — rejected leaving services-only package/release
  assertions broken until phase 4.
- **No implementation before approved specs** — these specs are post-approval artifacts; follow the
  phase dependencies before executing.

## Feedback Strategy

**Inner-loop command**:
`bun test packages/write-for/test/contract.test.ts packages/write-for/test/config.test.ts`

**Playground**: Bun tests using temporary config roots, explicit resolver inputs, and independently
authored consumer fixtures.

**Why this approach**: Deterministic file selection and precedence need a small truth-table suite,
not live models or interactive sessions. Pure type declarations and manifest edits need type/build
checks, not a separate experiment loop.

## File Changes

### New Files

| File Path                                  | Purpose                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `packages/write-for/package.json`          | Public package, exports, compiled Pi entrypoint, dependency metadata          |
| `packages/write-for/tsconfig.json`         | Strict portable declaration-emitting build                                    |
| `packages/write-for/LICENSE`               | Exact root license copy                                                       |
| `packages/write-for/README.md`             | Install/config/contract boundary and manual migration guidance                |
| `packages/write-for/src/index.ts`          | Minimal default extension factory; extended by later phases                   |
| `packages/write-for/src/contract.ts`       | Public types, service descriptor, structural validators, event envelope types |
| `packages/write-for/src/errors.ts`         | Internal creation of structurally identifiable writer failures                |
| `packages/write-for/src/config.ts`         | Root discovery and effective Markdown/frontmatter resolution                  |
| `packages/write-for/src/channels.ts`       | Four built-in channel definitions and generic text fallback                   |
| `packages/write-for/test/contract.test.ts` | Contract-only import, shape validation and fixture checks                     |
| `packages/write-for/test/config.test.ts`   | Roots, trust, body/metadata/default-register precedence                       |
| `tests/fixtures/write-for/consumer-a.ts`   | Independent draft consumer using only contract + services                     |
| `tests/fixtures/write-for/consumer-b.ts`   | Independent rewrite consumer using only contract + services                   |

### Modified Files

| File Path                          | Changes                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `package.json`                     | Root pins and targeted `test:write-for`; wire current writer tests into aggregate checking                           |
| `bun.lock`                         | Bun-generated dependency/workspace synchronization                                                                   |
| `release-please-config.json`       | Register writer identity/component without changing existing service identity                                        |
| `scripts/check-package.ts`         | Scope helper-only dependency restrictions to services; permit writer Pi peer and prepare multi-artifact installation |
| `tests/release/manifest.test.ts`   | Account for both registered packages without weakening validation                                                    |
| `tests/tooling/workspace.test.ts`  | Verify writer-style exports/dependency policy and reject invalid variants                                            |
| `tests/tooling/boundaries.test.ts` | Protect pure contract modules and portable writer runtime                                                            |
| `scripts/check-docs.ts`            | Include writer README in maintained documentation validation                                                         |
| `.github/workflows/release.yml`    | Add writer release outputs/identity routing required by registration; preserve disabled-by-default/OIDC policy       |
| `tests/release/workflows.test.ts`  | Cover the additional release identity and existing security invariants                                               |

### Deleted Files

None. Do not edit the original bat-kol repository or change service discovery semantics.

## Implementation Details

### 1. Package and pure contract

**Patterns to follow**: `packages/services/package.json`, `packages/services/tsconfig.json`,
`packages/services/src/contracts.ts`, `tests/fixtures/services/contract.ts`,
`docs/service-discovery.md`.

Publish `.` to `dist/index.js`/`dist/index.d.ts`, `./contract` to
`dist/contract.js`/`dist/contract.d.ts`, and declare the Pi extension as `./dist/index.js`. Keep
production imports explicit `.js`. The contract may have a type-only services import; it must not
import the runtime entrypoint, filesystem, model registry, Pi initialization, providers, or a
process-global bus. `index.ts` is a function declaration, not top-level provider registration.

Use the following cross-phase vocabulary consistently:

```ts
export interface WritingOptions {
  channel: string;
  register?: string;
  rules?: string[];
  context?: string;
  signal?: AbortSignal;
}

export interface DraftRequest extends WritingOptions {
  subject: string;
}

export interface RewriteRequest extends WritingOptions {
  text: string;
  instruction?: string;
}

export interface WritingResult {
  text: string;
  channel: string;
  register: string;
  model: { provider: string; id: string };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd?: number;
  };
}

export interface WriteForApi {
  draft(request: DraftRequest): Promise<WritingResult>;
  rewrite(request: RewriteRequest): Promise<WritingResult>;
}
```

Export `WRITE_FOR_SERVICE_ID = "birdcar.write-for"`, `WRITE_FOR_API_MAJOR = 1`, and
`writeForContract`. Its `isApi` checks the two own callable data properties without invoking
accessors. Let pi-services enforce its existing descriptor and lifecycle rules. The request
validator rejects unexpected execution fields such as `model`, `provider`, or `baseUrl`; the prose
in `rules` never gets parsed as execution metadata.

The public writer error shape uses `name: "WriteForError"`, a stable `code`, and a useful `message`.
Export structural `isWriteForError`, not an `instanceof`-only contract. Codes needed across the
project are `INVALID_REQUEST`, `CONFIG_INVALID`, `PROFILE_NOT_CONFIGURED`, `REGISTER_REQUIRED`,
`MODEL_UNAVAILABLE`, `MODEL_AUTH`, `GENERATION_FAILED`, `NOT_READY`, `NO_UI`, `TRAINING_NOT_ACTIVE`,
`SOURCE_INVALID`, `SOURCE_LIMIT`, and `PROPOSAL_STALE`. Use `AbortError` for cancellations and
preserve pi-services errors such as `SERVICE_DISPOSED` instead of relabeling them. Avoid inventing
retry policy.

The Full event contract is a request-local completion envelope, not a result broadcast:

```ts
export const WRITE_FOR_REWRITE_EVENT = "birdcar.write-for:v1:rewrite";

export interface RewriteEventRequest {
  request: RewriteRequest;
  accept(completion: Promise<WritingResult>): void;
}
```

Define it now without subscribing. In phase 2 the adapter calls `accept` synchronously once with the
ordinary async completion. The sender can detect lack of synchronous acceptance;
durable/result-bearing clients should prefer service discovery. No event timeout or polling
framework is needed.

### 2. Configuration roots and profile naming

**Pattern to follow**: the semantics verified in bat-kol's `resolve-config.sh`, not its shell
implementation. The baseline behavior is fully specified here; the other repository is not needed to
build this phase.

Pass resolver inputs explicitly: cwd, home/XDG root, environment override, project-trust boolean,
and Pi config-directory name. The extension adapter supplies `CONFIG_DIR_NAME` from Pi rather than
embedding a distribution-specific directory name in the core resolver. For ordinary Pi, project
profiles live at `.pi/write-for/`.

Root selection:

1. If `PI_WRITE_FOR_CONFIG` is set, require that directory and select it instead of project
   traversal. Treat a selected root inside an untrusted project as project-local and do not honor it
   without trust.
2. Otherwise, for a trusted project, walk cwd and ancestors to the nearest
   `<Pi config directory>/write-for/`, including filesystem root if applicable. Do not combine
   several ancestor roots.
3. Always use `${XDG_CONFIG_HOME:-$HOME/.config}/pi-write-for` as global fallback where present. If
   it is also the selected root, do not read or merge it twice.
4. Ignore `.bat-kol`, old XDG names, and `BAT_KOL_CONFIG` entirely. Manual migration is copying
   compatible Markdown to the new names.

Project trust controls project-local config, not whether the user can have global profiles. Fail
with actionable diagnostics for an invalid explicit root, malformed selected file, or missing
required voice; do not silently replace a broken override with another root.

Accept safe lowercase channel/register identifiers (`a-z`, digits, internal `.`, `_`, `-`),
rejecting separators, traversal components, empty names, and absolute paths before joining
filenames. Validate resolved file containment, including symlink targets. Do not add aliases or a
registration service.

### 3. Markdown and frontmatter resolution

Read `style.md`, `registers/<name>.md`, and `channels/<name>.md`. Parse optional YAML using
root-pinned `yaml` (the repo currently pins 2.8.1); use ordinary data schemas, reject unsafe/custom
tags and malformed types, and do not evaluate commands. Normalize only frontmatter boundaries and
surrounding body whitespace, not the user's prose.

Supported execution metadata is deliberately small:

```yaml
---
model: openai-codex/gpt-5.4
---
```

Channel frontmatter additionally supports `defaultRegister`. A model is one atomic
`provider/model-id` string; split only on its first slash so provider model IDs containing further
slashes survive. Empty strings and null values are errors, not hidden reset syntax. Missing metadata
inherits. Unknown metadata must not become provider options; preserve unrelated author data if
tolerated, while validating every recognized field. Do not add temperature, credentials, endpoints,
fallback chains, or arbitrary sampling options.

Separate permissive layer loading from writing-readiness validation. A small private
`loadConfigLayers` function can return missing bodies/roots so first-time training can inspect
whatever metadata exists; `resolveWritingProfile` uses it and requires a usable selected register
for drafting. Invalid explicit roots and malformed existing files still fail in either path.
Training must not need an already-trained register just to choose its initial model.

Resolve default register before loading the register profile: explicit request register wins, then
the effective channel's `defaultRegister`, then the built-in channel default. Unknown channels
without a default require the caller/user to choose a register. Built-ins are Slack/internal,
email/professional, Bluesky/social, and GitHub/professional. Built-in channel rules are format
defaults, not a trained voice.

Resolve prose per logical file: nonempty selected-local body replaces that global body; local
frontmatter-only or empty body retains the global body. Then compose effective style, register and
channel bodies in that order. A nonempty effective register body is the minimum trained voice; style
is optional and channel formatting can come from defaults. Do not auto-invent a register because a
directory exists. Return `PROFILE_NOT_CONFIGURED` for a missing/empty required register.

Resolve model values in this distinct order, with the last defined value winning:

```text
active Pi model (runtime fallback, resolved in phase 2)
global style → global selected register → global selected channel
selected-local style → selected-local register → selected-local channel
```

Do not implement this by first collapsing each global/local file pair: that would let a global
channel defeat an explicit local style model. Return the selected model reference and its source,
plus effective prose and register/channel identifiers. Strip metadata from prose sent to a model.
Resolve each request against an immutable snapshot; avoid a global mutable configuration cache.

**Feedback loop**:

- Playground: create `config.test.ts` with temporary trees before implementing the resolver.
- Experiment: global only; nearest project; two ancestors; invalid env root; same global/local root;
  missing register; empty project body; malformed frontmatter; unsafe name/symlink; custom channel;
  trust denied; every global/local model pair conflict.
- Check: `bun test packages/write-for/test/config.test.ts`.

### 4. Baseline format definitions

Keep four static definitions in `channels.ts`, not four agents. Slack uses mrkdwn guidance; email
uses subject/greeting/body/closing; Bluesky uses its short-post/thread formatting instructions;
GitHub uses GFM. Generic channels default to plain text unless supplied rules say otherwise. These
are prompt instructions, not application-specific delivery schemas or guaranteed model-output
validators.

A saved channel body overrides the corresponding built-in format guidance. User/caller writing rules
can override anti-slop and other style preferences. Factual preservation remains a task instruction;
these text priorities are not a security sandbox against arbitrary installed code.

### 5. Keep intermediate repository validation usable

Read `docs/releasing.md` before metadata/workflow edits. Register the new component `pi-write-for`,
with tags `pi-write-for-v<version>`. Keep the current disabled-by-default release flag, exact-tag
validation and OIDC-only publication. Never publish or change hosted settings in this project.

Update hardcoded services-only expected package lists and dependency restrictions when adding the
writer. Restrict the helper's no-Pi-dependency assertion to `@birdcar/pi-services`; the extension
can declare a Pi peer compatible with the pinned host. Add `test:write-for` to root aggregate
validation now so each later phase's tests are included automatically.

A local writer dependency on the as-yet-unpublished services package must be tested through local
tarballs, not assumed to be on npm. If the early artifact scaffold installs the writer, install its
services tarball in the same clean consumer operation. Phase 4 completes functional consumers and
dependency-first publishing proof.

Do not manually seed `.release-please-manifest.json` merely to add the package; follow the
repository's existing bootstrap/version conventions and tests.

**Feedback loop**:

- Playground: existing workspace/release fixture projects and artifact validation tests.
- Experiment: valid second package, missing export or release identity, a forbidden Pi dependency on
  services, an allowed writer Pi peer, and local writer installation without a remotely published
  helper.
- Check: `bun run test:release && bun run test:ci`.

## Testing Requirements

| Test                             | Required assertions                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract.test.ts`               | No initialization on contract import; own callable API properties; structural errors across independent copies; strict request execution fields |
| `config.test.ts`                 | Complete root/body/metadata/model precedence matrix and safe path/trust handling                                                                |
| Independent consumer fixtures    | Compile against public types without importing index/provider code; one drafts, one rewrites                                                    |
| Workspace/boundary/release tests | Both package identities accepted; broken exports, impure contracts, runtime Bun usage, and nonpublishable dependency ranges still rejected      |

Type-check the consumer fixtures explicitly through a writer test/tooling tsconfig or the existing
tooling inclusion; a file merely present on disk is not a passing type test. Add any necessary
inclusion to the appropriate existing tsconfig and list that change in implementation notes.

## Failure Modes

| Component | Failure                           | Trigger                                       | Impact                                      | Mitigation                                                        |
| --------- | --------------------------------- | --------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Resolver  | Wrong scope wins                  | Collapsing pairs before model resolution      | Project model control lost                  | Separate metadata traversal from prose selection; conflict matrix |
| Resolver  | Empty voice                       | Metadata-only local override                  | Generic output masquerades as learned voice | Inherit global body; require actual register prose                |
| Resolver  | Unexpected project config         | Untrusted checkout or ancestor/symlink escape | Wrong settings/data destination             | Trust check, nearest root, containment validation                 |
| Contract  | Provider initialization on import | Barrel re-export from runtime                 | Consumer load-order coupling                | Dedicated contract module and side-effect test                    |
| Packaging | Writer unusable before phase 4    | Services-only validation or npm lookup        | Intermediate phase cannot pass checks       | Introduce basic second-package handling immediately               |

## Validation Commands

```sh
bun run build
bun test packages/write-for/test/contract.test.ts packages/write-for/test/config.test.ts
bun run check:workspace
bun run test:boundaries
bun run typecheck
bun run lint
bun run test:release
bun run test:ci
bun run check:package
bun run check:docs
bun run check
```

## Rollout Considerations

This phase creates a buildable package foundation, not a working writer. Document that distinction
until phase 2. Do not advertise implemented training before phase 3. No feature-flag framework,
connector installation, npm release, or change to the user's real configuration is part of
execution.
