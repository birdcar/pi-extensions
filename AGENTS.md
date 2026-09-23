# Contributor Guidance

This repository is a portable Pi extension monorepo. Bun is the development package manager and test
runner, but published runtime packages must work for ordinary Node/Pi consumers without Bun.

## Development workflow

- Use `bun install`, `bun run <script>`, and `bun test` for local development.
- Keep dependencies pinned at the root and keep `bun.lock` in sync with `package.json`. `bun.lock`
  must stay registry-neutral so GitHub-hosted runners can install: the root `postinstall` hook
  blanks registry-proxy tarball URLs after every install. Never install with `--ignore-scripts`, and
  never change the machine's npm or Bun registry configuration to get past an install error.
- Every pull request that changes a file under `packages/*`, including a package README or test,
  needs a changeset; CI fails without one, and no changeset means no release. `bun changeset` is
  interactive, and agents and scripts can't answer its prompts, so pass flags instead:
  `bun changeset --patch @birdcar/pi-write-for -m "Fix the summary"` (`--minor` and `--major` work
  the same way, and packages can be comma-separated). Use `bun changeset --empty` for a package
  change that shouldn't release. Root-level docs, config, and CI changes need none.
- Pull request titles must start with a type CI accepts: `feat`, `fix`, `docs`, `chore`, `refactor`,
  or `test`, optionally scoped (`fix(write-for): …`). Other types such as `ci:` or `build:` fail the
  title check.
- Run type checks, tests, lint, workspace, release, package, and docs validation before requesting a
  commit.
- Read `docs/releasing.md` before changing release configuration, workflow files, package metadata,
  or publication scripts, and before adding a package.
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

`bun:test` hooks run under the default 5-second timeout, which a build can exceed on GitHub-hosted
runners. Keep builds and other slow setup inside the test that needs them, with an explicit timeout,
as `tests/tooling/write-for-package.test.ts` does.

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
