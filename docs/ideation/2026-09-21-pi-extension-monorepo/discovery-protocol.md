# Optional Service Discovery for Pi Extensions

This is the user-supplied architectural contract, preserved as an implementation input. Phase 2 must implement it and publish the maintained version at `docs/service-discovery.md`. Examples below describe proposed monorepo APIs, not built-in Pi APIs.

## Purpose and motivation

Independent Pi extensions should be able to use capabilities supplied by other installed extensions without importing their implementations, requiring their installation, or adding consumer-specific listeners to the provider.

Pi remains the plugin host. Build a small, in-process service-discovery convention on `pi.events`, not another plugin loader or a general-purpose RPC framework.

## Goals

- Let consumers discover optional, versioned services at runtime.
- Let providers serve future consumers without modification or registration of those consumers.
- Give callers explicit, awaitable methods with results, errors, and cancellation.
- Keep availability discovery separate from service execution.
- Keep contracts independent of provider implementations.
- Work across extension reloads and session replacement without stale subscriptions or service handles.

## Choose the right mechanism

- **Direct function calls/imports:** required collaboration between modules in one extension, or an ordinary shared library with no runtime provider discovery requirement.
- **Events:** optional notifications that something happened. The publisher does not need a result or need to wait for observers.
- **Discovered services:** an optional installed extension owns a capability that the caller needs to invoke and await.
- **External transport:** communication between processes or machines. This convention does not provide that.

A service may emit observational events, but callers must receive required results through the method's returned promise, not through a broadcast completion event.

## Monorepo boundaries

Keep three responsibilities separate:

1. **Discovery helper:** a small shared module that accepts the injected `pi.events` bus. It does not create its own bus, load extensions, or keep a process-global registry.
2. **Service contracts:** stable service IDs, API-major versions, request/result types, error semantics, and runtime shape checks. Importing a contract must not initialize its provider.
3. **Providers and consumers:** independently installable Pi extensions. Providers own implementation and configuration; consumers own their calling workflow and explicit fallback policy.

Adding a service should require a contract and a provider, not edits to a central union or registry of every possible service. Adding a consumer should require no provider changes.

## Discovery protocol

Use a service-specific channel:

`plugin-services:v1:discover:<service-id>`

Service IDs are stable and namespaced, such as `example.search`. The channel's `v1` versions the discovery protocol; each service separately declares its API-major version.

1. The provider registers one discovery listener per service during its extension factory.
2. The consumer emits a discovery request containing an `offer` callback.
3. The provider synchronously calls `offer` with a descriptor: service ID, API-major version, and an object exposing the service's methods.
4. After `emit` returns, the helper validates collected descriptors and selects a compatible service.
5. The consumer invokes methods directly and awaits their promises.

Discovery is synchronous, cheap, and side-effect-free. It must not await initialization, make model/network calls, show UI, or perform the requested operation. The offer callback is explicitly part of this convention: Pi does not collect listener return values.

Selection rules:

- No offer: return `undefined`.
- Offers exist, but none match the requested API major: report an incompatible-service error.
- More than one compatible offer: report an ambiguous-provider error. Never silently choose by extension load order.
- Malformed offers: report a contract error rather than treating them as successful discovery.
- Offers arriving after synchronous dispatch completes: ignore them; asynchronous discovery is unsupported.

No offer means only “no provider responded.” It does not prove that an extension is uninstalled; a broken provider can also fail to respond.

## Minimal pseudocode

These helpers are proposed monorepo APIs, not built-in Pi APIs. Validation and lifecycle guards are abbreviated.

```ts
provideService(pi, {
  id: "example.search",
  apiMajor: 1,
  api: {
    search: ({ query, signal }) => searchIndex(query, { signal }),
  },
});

const search = discoverService(pi.events, searchV1Contract);
if (!search) return handleSearchUnavailable();
const results = await search.search({ query, signal });
```

The discovery helper's essential behavior:

```ts
function discoverService(events, contract) {
  const offers = [];
  let accepting = true;
  events.emit(channelFor(contract.id), {
    offer: (descriptor) => {
      if (accepting) offers.push(descriptor);
    },
  });
  accepting = false;
  return validateAndSelect(offers, contract);
}
```

The provider helper subscribes to that channel and synchronously offers its descriptor. Validate the request before calling its callback. Collect offers first and validate afterward: throwing inside a bus listener can be caught and logged by Pi rather than reaching the discovering caller.

## Lifecycle and execution constraints

- Register discovery listeners in factories, not repeatedly per command or turn. Providers must be discoverable before consumers perform normal runtime work.
- Discovering a service does not mean its resources are ready. Initialize session-scoped resources in `session_start` or on demand; methods must explicitly handle not-ready/not-configured states. Avoid startup handlers that await work dependent on later startup handlers.
- Discover on demand rather than caching handles across reloads or session replacement. The provider helper must guard method calls so old handles reject after disposal; Pi does not automatically revoke arbitrary function references.
- Subscription cleanup must follow the extension runtime. Pi currently tracks bus subscriptions for teardown; preserve unsubscribe handles for any earlier/manual disposal. Also stop provider-owned resources and in-flight work on shutdown.
- Pass an `AbortSignal` for cancellable work. Declare whether concurrent calls are supported; serialize internally if required. A timeout alone does not stop work unless the implementation cooperates with cancellation.
- Return results and failures through the service method. Do not use discovery or notification events as an implicit async execution pipeline.
- Define absent-service fallback separately from invocation failure. An optional service being missing may permit a fallback; a failed required operation must not silently count as success.

## Contract and trust constraints

- Pi event payloads are `unknown`. Shared TypeScript types do not replace runtime validation of discovery envelopes, descriptors, and method inputs where needed.
- Match service API majors exactly in the POC. Breaking changes require a new major; document optional additive capabilities rather than guessing compatibility.
- Service descriptors contain live functions. They are in-process references, not serializable RPC messages or persistent session data.
- All participating extensions share a trust boundary. Namespaced channels prevent accidental collisions; they do not authenticate providers or isolate secrets.
- Discovering a service does not authorize external side effects. Each service contract must declare its side effects and approval responsibilities.
- Use namespaced, per-service channels to avoid one global channel accumulating every provider. Pi currently uses Node's `EventEmitter`, which normally warns above ten listeners on the same channel; this is not a delivery limit.

## POC acceptance criteria

- A missing provider produces an explicit unavailable result without waiting for a timeout.
- One compatible provider can serve multiple independent consumers without knowing their identities.
- A newly added consumer requires no provider changes.
- Factory load order does not affect discovery performed after startup.
- Incompatible, malformed, and duplicate compatible offers are handled deterministically.
- Method results, failures, cancellation, and the declared concurrency policy are testable.
- Reload/session replacement does not leave duplicate listeners or usable stale service handles.
- Notifications remain optional and are never required to complete a service call.

## Explicitly out of scope

Custom plugin loading, cross-process RPC, persistent event replay, asynchronous discovery, automatic provider ranking, general middleware pipelines, and a global service catalog. Add these only when a concrete requirement justifies them.
