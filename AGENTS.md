# Contributor Guidance

This repository is a portable Pi extension monorepo. Bun is the development package manager and test
runner, but published runtime packages must work for ordinary Node/Pi consumers without Bun.

## Development workflow

- Use `bun install`, `bun run <script>`, and `bun test` for local development.
- Keep dependencies pinned at the root and keep `bun.lock` in sync with `package.json`.
- Add a changeset for any user-facing change to a package: run `bun changeset`, pick the packages
  and bump, and commit the generated file with your change. No changeset means no release; docs,
  config, and CI-only changes don't need one.
- Run type checks, tests, lint, workspace, release, package, and docs validation before requesting a
  commit.
- Read `docs/releasing.md` before changing release configuration, workflow files, package metadata,
  or publication scripts.
- Use the user's commit skill when asked to commit. Do not add an unrequested co-author trailer.
- Store ideation artifacts in date-prefixed directories such as `docs/ideation/YYYY-MM-DD-<slug>/`.

## Runtime portability rules

Production package code under `packages/*/src/**` must use portable NodeNext ESM TypeScript.

- Use Node built-ins (`node:fs`, `node:path`, etc.) and Web APIs supported by the declared Node
  baseline.
- Do not use the `Bun` global, `bun`/`bun:*` imports, `Bun.file`, `Bun.$`, `Bun.serve`,
  `bun:sqlite`, or other Bun runtime APIs in production packages.
- Use explicit `.js` extensions for relative imports that will be emitted to JavaScript.
- Do not add TS-only path aliases to production packages.
- Service contracts must not import or initialize providers, registries, extension hosts, or
  process-global buses.
- Read `docs/service-discovery.md` before changing service contracts, providers, or consumers.

## Checks

Bun-based tooling and `bun:test` tests may use Bun APIs. Explicit Node invocations and npm
artifact-consumer tests are intentional compatibility checks, not a switch away from Bun
development.

Run the relevant commands before handoff:

```sh
bun run build
bun run check:workspace
bun run test:boundaries
bun run typecheck
bun run lint
bun run check:package
bun run check:docs
bun run check
```
