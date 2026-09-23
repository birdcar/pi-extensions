# Pi extension monorepo

This repository is the foundation for independently released Pi extension packages.

`@birdcar/pi-services` is a shared helper library for optional in-process services between Pi
extensions. It is not itself a Pi extension to install for tools or commands.
`@birdcar/pi-write-for` is a Pi extension for drafting, rewriting, and training user-reviewed
writing profiles through that service contract; it is installed independently once the maintainer
publishes it.

## Development

Use Bun `1.3.14` from the root `packageManager` field:

```sh
bun install --frozen-lockfile
bun run check
```

Portable package code targets Node/Pi consumers and the repository validates Node `22.19.0` plus
Node 24 smoke checks. Bun is the development tool, not a runtime requirement for published helpers.

Private examples and fixtures live under `tests/fixtures/services/`; use them for local extension
experiments instead of installing the monorepo root.

## Services

The optional service protocol lets extensions integrate when a provider is present while keeping
fallback behavior explicit. Missing services return `undefined`; invocation failures from a
discovered API propagate as ordinary failures. See
[docs/service-discovery.md](docs/service-discovery.md) and the typed fixtures
`tests/fixtures/services/provider.ts`, `tests/fixtures/services/consumer-a.ts`, and
`tests/fixtures/services/consumer-b.ts`.

## Packages and releases

Add packages under `packages/*`. Public packages use `@birdcar/pi-*`, include their own README and
LICENSE, declare service contracts without a central registry, and opt into independent releases
through `release-please-config.json` plus `.release-please-manifest.json` policy. Root-only
maintenance does not release every package automatically.

Release setup and activation are documented in [docs/releasing.md](docs/releasing.md). The release
workflow is guarded by `RELEASE_ENABLED=true` until the maintainer connects the real GitHub
repository and npm trusted-publisher binding.
