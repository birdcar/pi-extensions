# Implementation Spec: Pi Write For — Phase 2

**Contract**: ./contract.md

**Prerequisite**: Package, contract, and layered configuration (phase 1).

**Scope**: Full, including event ingress.

**Estimated Effort**: M

## Technical Approach

Build one request-local writing engine and expose it through the public `WriteForApi`, `/write-for`,
and the Full-scope rewrite event. Keep generation independent of interactive UI, delivery, profile
writes, and implicit access to session history. A caller supplies its content/context and receives
draft text plus model/usage provenance.

Use `ctx.modelRegistry.find`, `hasConfiguredAuth`, and `streamSimple(...).result()` from the
installed Pi API. Registry-backed calls honor configured and extension-registered providers. Do not
switch the main session model, create a new agent session, import a global provider registry, or use
compatibility streaming helpers that cannot see host registrations. Model lookup/generation code
from this phase is reused by training in phase 3.

Register the service during extension factory setup using `provideService`. Capture the active
session context at `session_start`, and reject premature calls with `NOT_READY`. The installed Pi
context uses guarded live getters for model, cwd, registry and UI; retain the context object only
for its lifetime, and read/snapshot needed values at the start of each call. Do not destructure it
once at startup and freeze the active model. Disposal makes retained APIs stale and aborts in-flight
calls before old context is used again.

## Decisions Considered and Rejected

- **One engine, three entrypoints** — rejected separate command, event, and service implementations.
- **Direct promise results through pi-services** — rejected result-bearing observational events or a
  new event RPC subsystem.
- **Return a draft** — rejected caller UI takeover, delivery, and profile mutation.
- **Injected prose wins conflicts** — rejected prioritizing saved prose over an integration's
  task-specific requirements; the override is request-scoped.
- **Configuration owns models** — rejected request model/provider fields, instructions interpreted
  as metadata, silent fallback, and `pi.setModel`.
- **Per-register/per-channel model metadata** — rejected one fixed model; preserve the phase-1
  scope-first precedence.
- **Anti-slop defaults are overridable** — rejected absolute bans that conflict with learned
  preferences.
- **Preserve useful bat-kol command behavior** — rejected mandatory explicit topic for interactive
  commands; omitted topics mean the current Pi session branch, not Git inspection.
- **No per-application registry** — rejected dedicated channel agents; arbitrary channel rules plus
  a trained register are sufficient.
- **Explicit cancellation and teardown** — reuse the service provider's lifetime rather than
  introducing a global task queue or routing framework.

## Feedback Strategy

**Inner-loop command**:
`bun test packages/write-for/test/model.test.ts packages/write-for/test/engine.test.ts packages/write-for/test/service.test.ts packages/write-for/test/entrypoints.test.ts packages/write-for/test/events.test.ts`

**Playground**: Controlled registry streams, in-memory event bus, two independently authored
consumers, and a recorded Pi command-registration/UI harness.

**Why this approach**: The behaviors under test are request composition and isolation, not
stochastic prose quality. Real model voice quality is a separate user acceptance check.

## File Changes

### New Files

| File Path                                     | Purpose                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/write-for/src/model.ts`             | Registry-backed model resolution and cancellable text calls             |
| `packages/write-for/src/prompts.ts`           | Writing defaults and deterministic instruction/source composition       |
| `packages/write-for/src/engine.ts`            | Draft/rewrite request processing and result mapping                     |
| `packages/write-for/src/service.ts`           | Guarded provider registration, readiness and lifetime                   |
| `packages/write-for/src/commands.ts`          | /write-for parsing, explicit session context and presentation           |
| `packages/write-for/src/events.ts`            | Thin Full-scope rewrite event adapter                                   |
| `packages/write-for/test/model.test.ts`       | Model selection/auth/response validation                                |
| `packages/write-for/test/engine.test.ts`      | Prompt precedence, result mapping, invalid requests and no side effects |
| `packages/write-for/test/service.test.ts`     | Two consumers, concurrent calls, cancellation and disposal              |
| `packages/write-for/test/entrypoints.test.ts` | Registered command handlers, context isolation and defaults             |
| `packages/write-for/test/events.test.ts`      | Synchronous acceptance and ordinary async completion                    |
| `packages/write-for/test/fixtures.ts`         | Small test-only event/registry/Pi recorders; no production framework    |

### Modified Files

| File Path                                | Changes                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `packages/write-for/src/index.ts`        | Wire commands, provider and event adapter during factory setup              |
| `packages/write-for/src/contract.ts`     | Only compatibility-preserving refinements needed for implemented validation |
| `packages/write-for/src/errors.ts`       | Complete error mapping without altering services errors                     |
| `packages/write-for/README.md`           | Working command/service/event examples, result and error semantics          |
| `tests/fixtures/write-for/consumer-a.ts` | Exercise actual discovered drafting API                                     |
| `tests/fixtures/write-for/consumer-b.ts` | Exercise actual discovered rewriting API                                    |

### Deleted Files

None.

## Implementation Details

### 1. Preserve the public boundary

**Patterns to follow**: `docs/service-discovery.md`, `tests/fixtures/services/provider.ts`,
`tests/fixtures/services/consumer-a.ts`, `packages/services/src/provider.ts`.

The existing phase-1 contract is:

```ts
interface WritingOptions {
  channel: string;
  register?: string;
  rules?: string[];
  context?: string;
  signal?: AbortSignal;
}
interface DraftRequest extends WritingOptions {
  subject: string;
}
interface RewriteRequest extends WritingOptions {
  text: string;
  instruction?: string;
}
interface WriteForApi {
  draft(request: DraftRequest): Promise<WritingResult>;
  rewrite(request: RewriteRequest): Promise<WritingResult>;
}
```

`WritingResult` contains `text`, `channel`, `register`, `{provider,id}` model identity, and usage
`{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,costUsd?}`. Preserve those names.
Service ID is `birdcar.write-for`, API major is 1. Validate public inputs at runtime, including safe
identifiers, nonempty source/subject, arrays of strings, optional context/instruction and signal
shape. Unknown execution keys fail `INVALID_REQUEST`; fields never flow unchecked into provider
options.

An explicit request register selects a configured voice, which can indirectly select its configured
model. That is intended. The prohibited capability is supplying a model/provider independently of
the user's configuration.

### 2. Model selection and reusable text runner

**Pattern to follow**: installed Pi `docs/extensions.md` model-registry section and
`examples/extensions/summarize.ts`. Verify exact installed types before implementing; do not copy
the example's hardcoded model or API-specific reasoning setting.

`model.ts` accepts the active `ExtensionContext`/registry facade and a resolved optional
`provider/model-id` reference. Resolve a configured reference exactly; only the absence of a
configured reference uses `ctx.model`. If the active model is also absent, fail clearly. Use the
real selected provider identity in output, not a fuzzy name match.

Check configured auth presence and preserve useful errors from request-time authentication. Do not
prompt for login in headless code. The registry performs actual provider auth resolution; never copy
credentials into config, prompts, tool results, or logs. A configured provider object is not proof
of working auth.

Expose a small private `runText` function that receives model, instructions/messages, and an abort
signal, and returns text plus normalized usage. It must:

1. Call the host registry's provider-neutral stream API.
2. Await the stream's final result and explicitly inspect error/aborted stop reasons; some setup
   failures are returned as error messages rather than thrown.
3. Reject tool-call responses, empty text, and incomplete/error responses rather than return
   misleading successful drafts.
4. Preserve ordinary content and useful whitespace; combine text blocks without including reasoning.
5. Map usage numbers from the response; do not fabricate a dollar amount if cost is unavailable.
6. Remove abort listeners in `finally` and settle callers promptly on cancellation even if a
   provider fails to cooperate. Retain rejection handling for the underlying promise to avoid
   unhandled failures.

Avoid a configurable model fallback list, automatic retries, temperature UI, or a generic provider
abstraction. Pass only the scoped prompt/source, not the entire host system prompt or tool set.
Training reuses this text runner and resolver; it does not reuse drafting's required-register check
during initial profile creation.

**Feedback loop**:

- Playground: a fake host registry records selected model and messages and exposes controllable
  completion/error/abort outcomes.
- Experiment: active-model fallback; every config model layer; missing model; configured-auth
  absent; request-time auth failure; streamed error; empty/tool-call output; cancellation before and
  during a call.
- Check: `bun test packages/write-for/test/model.test.ts`.

### 3. Prompt composition and engine

Use the phase-1 resolver at request start. Do not store request-specific rules, source text, or
resolved models in shared mutable state.

Instruction precedence, lowest first:

1. Built-in anti-slop/style defaults.
2. Effective user style body.
3. Effective selected-register body.
4. Effective channel formatting body/defaults.
5. Injected caller writing rules, plus the explicit rewriting instruction for a rewrite.

State the conflict policy explicitly to the model. Preserve supplied facts/links/names and do not
invent missing factual context. Keep source/context in separate clearly identified message
fields/sections and tell the model to treat them as source data, not configuration or instructions
to execute tools. The model has no tools in this call. Source text cannot choose a provider or
mutate a profile because code resolves execution separately before inference.

Prefer a system instruction message for the writing policy and user content for
subject/source/context, using the message shape supported by installed Pi. Do not claim that
delimiter text creates a security boundary or that unit tests prove universal LLM instruction
compliance. Unit tests assert what is sent; the voice acceptance exercise checks real output.

A draft uses the supplied subject and optional context. A rewrite uses supplied text and optional
instruction/context. Return only the model's draft text in `text`; do not generate Slack API blocks,
email objects, posting commands, or delivery callbacks. Thread-like output can remain text, with
channel formatting guidance; structured delivery payloads are out of scope.

Missing/empty required register fails `PROFILE_NOT_CONFIGURED`; unknown channel without a
register/default fails `REGISTER_REQUIRED`. An unknown channel with an explicit trained register may
use caller rules and generic plain text without creating channel files. Never write or silently
start training.

**Feedback loop**:

- Playground: engine tests inject a deterministic text runner and temporary profile trees.
- Experiment: conflicting profile/caller rules; instructions embedded in source; custom channel;
  draft versus rewrite; missing profiles; unexpected model field; result text/usage identity.
- Check: `bun test packages/write-for/test/engine.test.ts`.

### 4. Provider lifecycle

Register flat own `draft` and `rewrite` methods using `provideService` in factory setup. Store
session context at `session_start`; before that, methods fail `NOT_READY`. The provider's disposal
hook aborts its lifetime controller, detaches writer subscriptions and cleans in-flight request
bookkeeping. Do not duplicate or modify the services package's guarded proxy behavior.

Combine provider lifetime and per-request signals using portable Node/Web APIs. Each request
snapshots needed current values before awaiting work and never accesses an old context after
disposal. Read the captured context's live model getter at each new request so `/model` changes
affect requests with no model override. Do not cache model/auth state permanently.

Consumers discover on demand, fall back only for `undefined`, and propagate incompatibility,
ambiguity, invocation and disposal errors. Multiple consumers may run concurrently. No consumer
registration, global queue, singleton cross-session bus, or load-order coordination is needed.

**Feedback loop**:

- Playground: use the independent consumer fixtures against an in-memory bus and controlled
  registry.
- Experiment: consumer-first/provider-first setup, premature request, overlapping calls with
  different rules, one cancellation, shutdown during both calls, retained/destructured APIs,
  rediscovery after new provider setup.
- Check: `bun test packages/write-for/test/service.test.ts`.

### 5. Interactive command

Register `/write-for <channel> [topic]` with optional `--register <name>` and `--rewrite <text>`.
Put selection flags before content; `--rewrite` consumes the remaining text and is mutually
exclusive with a draft topic. Parse flags without shell execution; document `--` for topics
beginning with flags and reject missing flag values. Avoid general shell tokenization or evaluating
text. If no channel is given, use a small built-in Pi selection/input flow when UI exists; otherwise
fail actionably.

For omitted topic and no rewrite text, read the active Pi session branch, extract relevant
user/assistant text, and pass it explicitly as the engine's source/context for a summary. Exclude
tool-call arguments/results and hidden extension state by default. Empty history requires a topic
instead of a fabricated summary. This is not Git branch inspection and does not run Git commands.
Service and event inputs never read history implicitly.

The command may render or place the resulting draft in Pi's editor using the existing UI API, with
clear model provenance. Support edit/regenerate through a small command-local flow if needed for
usability, without taking ownership of third-party consumer UI or adding platform-specific clipboard
commands. In non-UI modes, deliver a normal command result/message without opening prompts.
Rendering and presentation stay outside `engine.ts`.

**Feedback loop**:

- Playground: invoke the actual registered command handler in a Pi API recorder, not just a parsing
  helper.
- Experiment: explicit topic, register flag, rewrite input, omitted-topic session text, empty
  history, unknown channel, no UI, cancellation, generation failure.
- Check: `bun test packages/write-for/test/entrypoints.test.ts`.

### 6. Full-scope event adapter

Subscribe to `birdcar.write-for:v1:rewrite`. Payload is
`{ request: RewriteRequest, accept(completion: Promise<WritingResult>): void }` from the public
contract. Call `accept` synchronously with the normal async rewriting promise; the caller owns
awaiting/reporting that result. Validate payload shape before invoking callback properties and
ensure callback exceptions cannot become unhandled rejections or trigger duplicate generation.

Delegate through on-demand discovery of the same guarded service API so ambiguity/disposal failures
match service behavior. Discover before scheduling generation: ambiguous providers must start zero
model calls. Each adapter invokes the envelope callback at most once; the documented sender callback
must be idempotent (for example, settle one caller-owned promise) because duplicate extension
listeners can each report the same discovery failure. Do not compare raw implementation identity
with the services package's guarded API or add a global request registry. If the callback throws,
abort any scheduled request before generation begins and handle its rejection. Invalid envelopes
without a callable acceptance function must not start work; report through the extension diagnostic
path without logging source text.

Do not publish a result to a shared event topic, require observational events for direct API
completion, retry event delivery, or build an RPC broker. Unsubscribe on normal teardown.

**Feedback loop**:

- Playground: synchronous event bus with acceptance spies and controlled request completions.
- Experiment: absent listener, normal acceptance before emit returns, malformed request, failed
  model call, concurrent different payloads, duplicate providers, callback throws, cancellation and
  shutdown.
- Check: `bun test packages/write-for/test/events.test.ts`.

## Testing Requirements

| Test File             | Coverage                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| `model.test.ts`       | Registry integration, auth/stop reasons, model inheritance and cancellation           |
| `engine.test.ts`      | Instruction priority, source separation, no config/delivery/UI side effects, metadata |
| `service.test.ts`     | Two independent consumers, request isolation, readiness, teardown and rediscovery     |
| `entrypoints.test.ts` | Real registered command handlers, flags, session-context opt-in and format defaults   |
| `events.test.ts`      | Immediate acceptance, ordinary promise completion, duplicates/errors and privacy      |

Tests do not use personal credentials, installed application connectors, or live provider requests.
They must assert positive calls as well as absence of forbidden calls. Keep the original services
tests passing.

## Failure Modes

| Component     | Failure                          | Trigger                               | Impact                                        | Mitigation                                                           |
| ------------- | -------------------------------- | ------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| Model runner  | Error result treated as success  | Provider stream returns error message | Empty/partial draft falsely reported complete | Inspect final stop reason/content explicitly                         |
| Provider      | Frozen or stale model context    | Startup destructuring or reload       | Wrong model or stale-instance exceptions      | Per-request live reads, lifetime abort, rediscovery                  |
| Engine        | Cross-request rule contamination | Shared prompt buffer                  | Another app's rules/source leak               | Immutable request-local composition                                  |
| Command       | Hidden context leakage           | Copying every branch entry            | Tool secrets/state included in draft          | Explicit visible-text extraction; service never reads history        |
| Event adapter | Duplicate generation             | Multiple providers/listeners          | Duplicate spend or callbacks                  | Unique service discovery before execution and local acceptance guard |
| Cancellation  | Hanging public promise           | Uncooperative stream                  | Caller never completes on teardown            | Abort-aware settlement and underlying rejection handling             |

## Validation Commands

```sh
bun test packages/write-for/test/model.test.ts packages/write-for/test/engine.test.ts packages/write-for/test/service.test.ts packages/write-for/test/entrypoints.test.ts packages/write-for/test/events.test.ts
bun run build
bun run typecheck
bun run lint
bun run test:services
bun run test:execution
bun run check:workspace
bun run check:package
bun run check:docs
bun run check
```

## Rollout Considerations

Drafting is now usable with manually supplied profiles in the new locations. Training remains
phase-3 work. Keep source material out of diagnostic logs. Do not deliver messages, touch the user's
real profiles in tests, or change the active model to demonstrate functionality.
