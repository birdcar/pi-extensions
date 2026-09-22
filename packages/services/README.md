# @birdcar/pi-services

Portable TypeScript helpers for optional Pi extension services.

## API

The package exports `discoverService`, `provideService`, `createServiceError`, `isServiceError`, and
the related `ServiceContract`, `ServiceDescriptor`, `ServiceHost`, and `ServiceRegistration` types.

Consumers call `discoverService(events, contract)` synchronously against Pi's injected event bus.
Providers call `provideService(host, descriptor, { onDispose })` during extension setup. The helper
does not create a global registry, load extensions, or provide RPC.

Structural contract errors use `ServiceError` codes such as `SERVICE_CONTRACT`,
`SERVICE_INCOMPATIBLE`, `SERVICE_AMBIGUOUS`, and `SERVICE_DISPOSED`. Missing services return
`undefined`; failures from invoked service methods are not converted into discovery errors.

Providers own readiness, input validation, cleanup, cancellation, side-effect approvals, and
disposal. Consumers should discover on demand and implement fallback only for the missing-service
case.

Package semver and service `apiMajor` values are distinct: a package patch can contain multiple
service contracts, and a service major can change without implying a package major naming scheme.

See [../../docs/service-discovery.md](../../docs/service-discovery.md) and the type-checked examples
`../../tests/fixtures/services/contract.ts`, `../../tests/fixtures/services/provider.ts`,
`../../tests/fixtures/services/consumer-a.ts`, and `../../tests/fixtures/services/consumer-b.ts`.
