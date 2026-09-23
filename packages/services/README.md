# @birdcar/pi-services

`@birdcar/pi-services` lets Pi extensions offer and find each other's services at runtime over Pi's
event bus. It is a library, not a Pi extension: extensions depend on it and call it, and Pi never
loads it directly. `@birdcar/pi-write-for`, for example, provides its writing service through it.

## Installation and baseline

Add it to the extension that provides or consumes a service:

```sh
npm install @birdcar/pi-services
```

It is ESM-only, has no dependencies, and runs on ordinary Node without Bun. It never imports Pi:
consumers pass it Pi's injected `pi.events` bus, and providers pass the extension API. Anyone who
installs an extension built on it, for example with `pi install npm:@birdcar/pi-write-for`, gets it
automatically as that extension's dependency.

It does not create a global registry, load extensions, or provide RPC: services are in-process calls
between extensions loaded in the same Pi session.

## Contracts

A provider and its consumers agree on a side-effect-free contract: a namespaced service ID, an API
major, a TypeScript interface, and an `isApi` validator. Export it from a module both sides can
import without loading the provider's extension, as `@birdcar/pi-write-for/contract` does:

```ts
import { type ServiceContract } from "@birdcar/pi-services";

export interface EchoApi {
  echo(request: { text: string; signal?: AbortSignal }): Promise<{ text: string }>;
}

export const echoContract: ServiceContract<EchoApi> = {
  id: "example.echo",
  apiMajor: 1,
  isApi(value): value is EchoApi {
    return !!value && typeof value === "object" && typeof (value as EchoApi).echo === "function";
  },
};
```

## Providing a service

Call `provideService` from the extension factory, passing Pi's extension API as the host:

```ts
import { provideService } from "@birdcar/pi-services";

const lifetime = new AbortController();
const registration = provideService(
  pi,
  { id: echoContract.id, apiMajor: echoContract.apiMajor, api },
  { onDispose: () => lifetime.abort() },
);
```

The registration answers discovery with a guarded copy of `api`, never the object itself. Disposal
runs once, through `registration.dispose()` or automatically on `session_shutdown`; afterwards every
method rejects with `SERVICE_DISPOSED`, including functions a consumer kept. Providers own
readiness, input validation, cleanup, cancellation, side-effect approvals, and disposal.

## Consuming a service

Discover when you need the service, not while your extension loads, since its provider may load
later:

```ts
import { discoverService } from "@birdcar/pi-services";

const echo = discoverService(pi.events, echoContract);
const result = echo ? await echo.echo({ text: "hello" }) : undefined;
```

Discovery is synchronous. A missing service returns `undefined`, and that is the only case to fall
back on; errors thrown by the service's own methods reach you unchanged.

## Errors

Structural failures surface as a `ServiceError`, which `isServiceError` recognizes. Discovery throws
the first three codes, and a disposed provider's methods reject with the last:

- `SERVICE_CONTRACT`: a malformed offer, or an API that fails the contract's `isApi` check.
- `SERVICE_INCOMPATIBLE`: providers exist, but only for other API majors.
- `SERVICE_AMBIGUOUS`: more than one provider matches.
- `SERVICE_DISPOSED`: a method was called after its provider was disposed.

## Versioning

Package semver and a service's `apiMajor` are independent: a package patch can ship several service
contracts, and a service major can change without a package major. Consumers ask for an exact
`apiMajor`; when only other majors are offered, discovery throws `SERVICE_INCOMPATIBLE`.

## Acceptance

[../../docs/service-discovery.md](../../docs/service-discovery.md) specifies the protocol, selection
rules, and provider responsibilities. The type-checked fixtures
`../../tests/fixtures/services/contract.ts`, `../../tests/fixtures/services/provider.ts`,
`../../tests/fixtures/services/consumer-a.ts`, and `../../tests/fixtures/services/consumer-b.ts`
implement an echo service with cancellation and two independent consumers. Package checks install
the packed tarball twice, side by side, and prove discovery and structural errors work across the
two copies.
