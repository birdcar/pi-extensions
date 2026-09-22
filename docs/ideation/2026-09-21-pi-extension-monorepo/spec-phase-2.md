# Implementation Spec: Pi Extension Monorepo Foundation — Phase 2

**Contract**: [contract.md](./contract.md)
**Phase**: Service discovery and Pi lifecycle proof
**Approved scope**: Full
**Prerequisite**: Portable workspace foundation
**Architectural input**: [discovery-protocol.md](./discovery-protocol.md)
**Estimated effort**: L

## Technical Approach

Implement a small in-process discovery convention on the `pi.events` bus injected by Pi. Export implementation-free contract types, synchronous discovery, provider registration with lifecycle revocation, and structurally identifiable errors from `@birdcar/pi-services`. Do not load extensions, initialize a provider through a contract import, create a bus or global registry, or add asynchronous discovery.

Use ordinary direct promises for service execution. Providers own method input validation, configuration/readiness, cancellation of their resources, and concurrency policy. The helper owns discovery validation, subscription disposal, and rejection through stale service handles. Private fixtures demonstrate those responsibilities without shipping a production service.

The package runtime uses only Node-compatible JavaScript and narrow structural host interfaces. Root-only development dependencies pin `@earendil-works/pi-coding-agent` to the inspected `0.87.0` baseline and compatible accompanying Pi packages where the test harness imports them. Verify current public SDK signatures against the installed package's complete `docs/extensions.md`, `docs/packages.md`, `docs/sdk.md`, and relevant examples before implementation. Do not use unexported `dist/core/...` imports to make tests pass. Node 22.19.0 is the minimum test baseline; Node 24 is also covered by later CI.

## Decisions Considered and Rejected

- **Synchronous callback discovery on Pi's injected bus** — rejected: custom loading, global registries, async discovery, return-value collection, and cross-process RPC. Pi stays the host.
- **Await methods for required results** — rejected: broadcast completion events or event-driven implicit pipelines. Observations are optional.
- **One small helper and private fixtures now** — rejected: a real voice rewriter or other user-facing extension.
- **Preserve the source protocol in the project** — rejected: depend on a chat-only appendix. Fresh execution sessions must have the exact protocol.
- **Separate responsibility modules, not a central catalog** — rejected: a registry/union that must change for every new service or consumer.
- **Exact service-major matching, independent of npm package semver** — rejected: inferred cross-major compatibility or coupling package bumps to API majors.
- **Structural error codes** — rejected: consumer correctness depending on class identity across separately installed helper copies.
- **Discover on demand and revoke retained method wrappers** — rejected: assuming Pi automatically revokes arbitrary function references when subscriptions disappear.
- **Node runtime with compiled ESM/declarations** — rejected: Bun-only APIs, a required Bun runtime, bundled host packages, or dependence on a TS loader for the shared library.
- **Real Pi and packed-artifact verification** — rejected: unit-only success as evidence of runtime compatibility.
- **Authoritative `docs/service-discovery.md` referenced by AGENTS.md** — rejected: architectural requirements available only through an optional skill.
- **All verifiers participate in the final aggregate** — rejected: omission of a required check from `bun run check`.

## Feedback Strategy

**Inner-loop command**: `bun run test:services`

**Playground**: Bun unit tests using a small injected bus, plus a separate compiled Node harness running the actual Pi SDK for lifecycle behavior.

**Why this approach**: Cheap unit tests cover the protocol's combinatorial cases; actual host integration catches assumptions a fake bus or manually emitted shutdown cannot prove. Artifact checks separately prove the distributed package works outside workspace resolution.

## File Changes

### New Files

| File Path | Purpose |
| --- | --- |
| `packages/services/src/contracts.ts` | Structural bus/host, service contract/descriptor, and registration types |
| `packages/services/src/errors.ts` | Stable discovery/disposal error codes and structural guard |
| `packages/services/src/discovery.ts` | Channel validation, synchronous collection, post-dispatch selection |
| `packages/services/src/provider.ts` | Safe offer subscription, guarded API wrappers, idempotent disposal |
| `packages/services/test/discovery.test.ts` | Discovery selection and malformed envelope cases |
| `packages/services/test/execution.test.ts` | Results, failures, revocation, lifecycle cleanup, concurrency/cancellation |
| `tests/fixtures/services/contract.ts` | Private fixture service contract and request/result validators |
| `tests/fixtures/services/provider.ts` | Private factory providing the fixture service |
| `tests/fixtures/services/consumer-a.ts` | Independent consumer with explicit missing-service fallback |
| `tests/fixtures/services/consumer-b.ts` | Second independent consumer with no provider-specific integration |
| `tests/pi/lifecycle.ts` | Node-only public SDK lifecycle assertion harness |
| `tsconfig.pi-tests.json` | Strict Node-only compilation of Pi harness and fixtures |
| `scripts/check-package.ts` | Build/pack/temporary-install/Node/types verification of the real artifact |
| `docs/service-discovery.md` | Maintained normative protocol and provider/consumer responsibilities |

### Modified Files

| File Path | Changes |
| --- | --- |
| `packages/services/src/index.ts` | Replace Phase 1 shell with public exports |
| `packages/services/package.json` | Finalize public exports and shipped files as needed |
| `package.json` | Root dev-only Pi dependencies and service/execution/Pi/package check scripts |
| `bun.lock` | Pinned dependency resolution |
| `tsconfig.tooling.json` | Include new Bun tests and tooling without leaking Bun into Node harness |
| `eslint.config.js` | Apply Node-only restrictions to Pi harness/fixtures as well as production |
| `AGENTS.md` | Require the existing normative protocol before inter-extension work |

No files are deleted. Do not place the private fixtures in public package `files` or a `pi` manifest. They are test modules, not packages that a user installs.

## Implementation Details

### 1. Public types and errors

Use the following surface as the implementation target; validate against Pi's real structural types during compilation:

```ts
export interface EventBus {
  emit(channel: string, payload: unknown): void;
  on(channel: string, handler: (payload: unknown) => void): () => void;
}

export interface ServiceHost {
  events: EventBus;
  on(event: "session_shutdown", handler: () => void | Promise<void>): void;
}

export interface ServiceContract<TApi extends object> {
  id: string;
  apiMajor: number;
  isApi(value: unknown): value is TApi;
}

export interface ServiceDescriptor<TApi extends object> {
  id: string;
  apiMajor: number;
  api: TApi;
}

export interface ServiceRegistration {
  dispose(): Promise<void>;
}

export function discoverService<TApi extends object>(
  events: EventBus,
  contract: ServiceContract<TApi>,
): TApi | undefined;

export function provideService<TApi extends object>(
  host: ServiceHost,
  descriptor: ServiceDescriptor<TApi>,
  options?: { onDispose?: () => void | Promise<void> },
): ServiceRegistration;
```

Descriptors expose a flat object of callable service methods for this POC. Type the intended promise-returning methods without requiring every consumer interface to declare an unrelated string index signature. Do not build a recursive object proxy or RPC marshaler. Enumerate and wrap actual own methods at registration; reject unsupported accessors/nested method surfaces instead of accidentally offering an unguarded reference. Document that explicit POC boundary.

Runtime validation requires a nonempty namespaced ID, a positive safe-integer `apiMajor`, an object API, and callable method properties. Choose and document a conservative ID syntax that admits `example.search` and fixture names; use the same validator on contracts/descriptors/providers. TypeScript types alone do not validate event payloads.

Provide error codes `SERVICE_CONTRACT`, `SERVICE_INCOMPATIBLE`, `SERVICE_AMBIGUOUS`, and `SERVICE_DISPOSED`, with useful ID/requested-major context. `isServiceError` uses structure/code rather than `instanceof`; test errors from a separately loaded copy. Do not convert ordinary invocation failures into discovery errors. Missing service remains `undefined`, not a fabricated success or timeout.

Types, constants, and re-exports need compiler checks, not separate feedback machinery.

### 2. Synchronous discovery and deterministic selection

Use exactly `plugin-services:v1:discover:<service-id>`. Emit an object containing `offer: (descriptor: unknown) => void`.

1. Validate the requested contract before dispatch.
2. Collect raw offers only while synchronous `emit` is running. Use `try/finally` to close the accepting window even if an injected bus throws.
3. Ignore every late callback; do not schedule a timeout or await providers.
4. After dispatch, validate basic shape, matching service ID, and major metadata for all collected descriptors. A malformed offer produces `SERVICE_CONTRACT`, even alongside an otherwise valid offer.
5. A well-formed offer for a different major is not checked against this major's method schema. Check the requested contract's `isApi` on matching-major offers; normalize validator throws into a contract failure.
6. No offers → `undefined`; well-formed offers with no matching major → `SERVICE_INCOMPATIBLE`; multiple valid matching-major offers → `SERVICE_AMBIGUOUS`; exactly one → its guarded API.

This order defines deterministic precedence: malformed envelope/requested-major API beats ambiguity; incompatible majors may legitimately have different methods. Never choose by load order. Pi's bus catches listener errors and does not collect return values, so throwing validation inside a listener is not a reliable way to notify the discovering caller.

**Feedback loop**:
- **Playground**: create the missing-provider test before implementing discovery.
- **Experiment**: 0/1/2 compatible offers; only wrong majors; one good plus one malformed; malformed wrong-major envelope; well-formed alternate-major API; a thrown validator; microtask/timer offers after dispatch; reversed registration order; a throwing injected bus.
- **Check command**: `bun run test:services`.

### 3. Provider registration and lifecycle revocation

Register during the extension factory, once per provided service. Validate the provider descriptor before subscribing. The bus listener accepts only a request object whose `offer` is callable; invalid requests do not invoke anything. Offering is synchronous and has no initialization, UI, model, network, or service-operation side effects.

Offer a new guarded API object, never the raw implementation. Each method wrapper must check a shared disposed flag when invoked, including after the consumer destructures and stores the method. Preserve the underlying implementation receiver when calling its method. Convert synchronous implementation throws into promise rejections and otherwise preserve the method's result/failure.

`dispose()` marks the provider unavailable immediately, unsubscribes before awaiting cleanup, and calls optional `onDispose` at most once. It is idempotent, including concurrent calls, and reports cleanup failure instead of silently hiding it. Register `session_shutdown` to return/await this disposal promise. Pi's tracked bus teardown remains an additional safety net, not the mechanism for revoking function references.

The helper must not invent method-specific cancellation or readiness behavior. The fixture provider's `onDispose` aborts its own lifetime controller and settles its owned operations. Existing in-flight operations follow that cooperative policy; the disposed guard prevents new calls, not arbitrary forced interruption of already executing JavaScript. A cleanup failure must not make the provider callable again.

**Feedback loop**:
- **Playground**: provider registration plus an instrumented fake host recording subscriptions and shutdown callbacks.
- **Experiment**: discovery before readiness; ordinary result; rejection and synchronous throw; method requiring its receiver; dispose twice and concurrently; retained object and destructured function; cleanup throwing; shutdown with active work; unknown discovery requests.
- **Check command**: `bun run test:execution`.

### 4. Private fixture contract and consumers

Use a namespaced fixture service, such as `birdcar.test.echo`, at API major 1. Its async method accepts validated text and an `AbortSignal` and returns a small deterministic result. No model, real filesystem modification, network access, or UI is needed. Document that the fixture has no external side effects and requires no approval.

The provider supports concurrent independent calls. Combine request cancellation with a provider-lifetime signal, clean up abort listeners, and ensure cancelling one request does not cancel another. Use controllable deferred promises/barriers rather than sleep-based success assumptions. Explicitly reject not-ready/not-configured work if the fixture exercises those states. The helper does not become a queue or scheduler.

Both consumers import the contract and helper only, discover at call time, and receive their results from promises. The absent-provider branch returns an explicit unavailable outcome. Invocation failures must propagate; they must not silently take the absence fallback. Adding consumer B requires no edits or identity registrations in the provider. Observational notifications may be emitted but no test subscribes to them as a prerequisite for completion.

**Feedback loop**:
- **Playground**: one provider and two independent fixture consumers.
- **Experiment**: both succeed concurrently; only A is cancelled; provider shutdown cancels both active operations; neither requires a notification listener; both receive unavailable when the provider is omitted.
- **Check command**: `bun run test:execution`.

### 5. Actual Pi runtime integration under Node

`bun run test:pi` builds the helper, compiles the Node-only harness/fixtures using `tsconfig.pi-tests.json`, and explicitly launches `node` against emitted JavaScript. Bun may orchestrate this command but must not execute the runtime being certified.

Use public `DefaultResourceLoader`, `createEventBus`, session/service creation APIs, `SessionManager`, and `createAgentSessionRuntime` supported by the pinned Pi SDK. Read its SDK examples before wiring startup/bind calls. Isolate cwd, agentDir, settings, credentials, model catalog, and discovered resources in temporary directories; explicitly restrict resources to the fixtures. Merely setting one cwd is not sufficient if defaults can still discover global/ancestor skills or extensions. Use in-memory settings/credentials and offline model configuration; do not issue prompts or model calls. Preserve a narrowly scoped probe outside a replaced session when needed to retain old handles for assertions.

Test both provider-first and consumer-first factory arrays, but call consumers only after normal startup. Then:

- Retain old APIs and destructured methods.
- Call the real session reload API, not just a handcrafted shutdown event.
- Assert a single new discovery response and rejected old handles; duplicate cleanup must not be masked by selecting the first offer.
- Replace the session using the real runtime new-session operation, rebind as the public SDK requires, and assert old revocation plus successful newly discovered handles.
- Repeat the cycle to expose accumulating listeners; complete the test even when a provider owns in-flight work.
- Dispose all resources and remove temporary directories in `finally`.

Observable behavior is the assertion surface. If useful, wrap the injected bus to count offers/subscriptions while still delegating to the real Pi bus; do not assert private EventEmitter internals or pretend a fake host proves actual teardown.

**Feedback loop**:
- **Playground**: Node lifecycle harness with two factory orders and isolated local state.
- **Experiment**: reload and new session repeated at least twice; stale and fresh calls; omitted provider; active cancellable work; initial listeners equal final listeners after teardown.
- **Check command**: `bun run test:pi` (slower integration loop after scoped unit tests).

### 6. Distributed artifact verification

`scripts/check-package.ts` must build and pack the actual package into a temporary directory, inspect the tarball, install that tarball into a fresh temporary consumer, and execute imports and a minimal discovery interaction under Node. Using npm to pack/install is an intentional check of Pi's distribution ecosystem; Bun remains the development tool.

Do not link source, borrow root module resolution, or install helper dev dependencies in that consumer. Assert only intended JS/declarations/README/license/package metadata ship: no fixtures, tests, TypeScript source entrypoints, credentials, or bundled host Pi packages. The README arrives in Phase 3; do not permanently excuse its absence in final checks.

Also compile a temporary TypeScript consumer using the package's exported declarations. The compiler may be invoked from the repository's dev tools, but resolution of the tested package must be from the isolated installed artifact. Assert there are no public `workspace:`/`file:` references and that the helper needs no runtime host or Bun dependency. Exercise error classification across independently imported copies without depending on module identity.

Expose the validated tarball path/metadata so Phase 3 can publish the same artifact without an unchecked rebuild. Packing/checking never invokes a real publish. Clean temporary data on success/failure; retain useful diagnostics.

**Feedback loop**:
- **Playground**: isolated packed consumer and actual tarball inspection.
- **Experiment**: clean import/result; omit an export target or declaration; introduce a forbidden bundled dependency/source file; verify each defect fails the checker. Keep destructive mutations in temporary copies only.
- **Check command**: `bun run check:package`.

### 7. Normative documentation

Create `docs/service-discovery.md` from the preserved architectural input, incorporating the precise public signatures, validation precedence, flat-method POC boundary, error codes, and ownership rules above. Clearly distinguish protocol version `v1`, service API major 1, and package semver. Include the trust/side-effect limitations and exact acceptance criteria; do not imply namespace authentication.

Examples should use the implemented public API. Prefer links to type-checked fixture modules over duplicated unchecked code. Link this document from AGENTS.md and require agents to read it before changing service contracts/providers/consumers. Phase 3 supplies the human README and link/example checks.

## Testing Requirements

| Test file or harness | Coverage |
| --- | --- |
| `packages/services/test/discovery.test.ts` | All offer/request validation, deterministic selection, synchronous acceptance window |
| `packages/services/test/execution.test.ts` | Returned promises, failures, revocation, cancellation, concurrency, cleanup, consumer independence |
| `tests/pi/lifecycle.ts` | Actual pinned Pi reload and session replacement running under Node |
| `scripts/check-package.ts` | Real packed library and declaration consumption without workspace/Bun dependence |

Map every acceptance bullet in the preserved protocol to a named test. Include valid controls for all negative tests. Do not label manual shutdown simulation as real Pi integration.

## Failure Modes

| Component | Failure | Trigger | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| Discovery | Lost error | Validation throws inside Pi's safe listener | Caller sees absence instead of failure | Collect raw offers and validate after dispatch |
| Discovery | Load-order selection | Two compatible providers respond | Nondeterministic implementation choice | Fail with ambiguous-provider code |
| Discovery | Late mutation | Provider awaits before offering | Result changes after caller proceeds | Close accepting window in finally; ignore late offers |
| Provider | Stale callable handle | Consumer retains API across reload | Calls resources belonging to old session | Guard each method closure and dispose at shutdown |
| Provider | In-flight work survives teardown | Only subscription removed | Resource leak or stale side effects | Provider lifetime abort and awaited cleanup; test actual shutdown |
| Consumer | Failure counted as fallback success | Catch-all treats errors as absence | Required operation silently lost | Fallback only on undefined; propagate invocation failures |
| Integration | Tests load user extensions/auth | Default resource discovery leaks | Flakiness, side effects, credential access | Explicit temporary config/resource isolation and no model requests |
| Artifact checker | Workspace shadows missing package files | Test runs in repository resolution context | Published package fails for real consumers | Temporary install and Node/types checks outside workspace |

## Validation Commands

```bash
bun install --frozen-lockfile
bun run build
bun run test:services
bun run test:execution
bun run test:pi
bun run check:package
bun run typecheck
bun run lint
bun run check
```

The final aggregate receives release and documentation checks in Phase 3. Keep source/test feedback fast; the public SDK and packed-artifact checks are integration gates, not replacements for unit cases.

## Rollout and Handoff

No external resources are provisioned or published. Commit locally after verification. Phase 3 consumes the real artifact validator, stable public API, private fixtures, and service document. Wider Pi/platform compatibility remains unsupported until tested; do not infer it from this baseline.
