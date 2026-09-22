# Releasing

The repository uses Release Please manifest mode for independent package releases.
`packages/services` is configured as component `pi-services`, producing tags such as
`pi-services-v0.1.0` and a per-package changelog when releases begin.

Release routing is path based. Root-only maintenance does not automatically release every package; a
tooling change that affects shipped output needs an intentional package-level change. Compatible
helper updates do not rewrite consumers automatically. If a future consumer must adopt a newly
released helper range, release and publish the helper first, then land an explicit consumer
`fix(deps)` change.

## Local commands

Use these before handoff:

```sh
bun run test:release
bun run test:release-lock
bun run test:publish
bun run test:ci
bun run check:docs
bun run check:package
bun run check
```

`bun run check` includes workspace validation, package artifact validation, release tests,
publishing tests, CI/workflow assertions, docs checks, typecheck, lint, service tests, execution
tests, and Pi lifecycle tests.

## Workflow model

[`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs read-only checks for pull requests
and main. [`../.github/workflows/release.yml`](../.github/workflows/release.yml) is disabled until
`RELEASE_ENABLED=true` is set. Release management uses GitHub App credentials only for repository
automation; those credentials are not npm authentication.

Release PRs refresh `bun.lock` with the pinned Bun version and reject any non-lockfile diff.
Publication is scoped to Release Please outputs and validates package path, version, tag, SHA,
package metadata, and the previously checked tarball before calling
`npm publish <tarball> --access public`.

npm authentication is trusted publishing through GitHub Actions OIDC only. Do not add `NPM_TOKEN`,
`NODE_AUTH_TOKEN`, token-bearing `.npmrc` configuration, `npm whoami` preflights, or a fallback
registry credential. The publish job uses Node 24 and npm 11.6.0, with job-local `id-token: write`.

## Exact-tag recovery

If publication must be retried for an existing release tag after activation, dispatch the same
workflow at the exact tag:

```sh
gh workflow run release.yml --ref pi-services-v0.1.0 -f release_tag=pi-services-v0.1.0
```

Recovery builds the tagged source, checks the peeled tag commit and package version, skips an exact
already-published version, and fails immutable conflicts or registry/auth/network errors. Never
create, move, or overwrite tags as a recovery side effect.

## Ready-to-connect checklist

1. Connect the intended GitHub repository later and update each package's `repository` metadata to
   the actual URL and directory.
2. Bind GitHub release automation, enable required PR checks, and grant the App only the
   contents/issues/pull-request permissions required for Release Please and lock refreshes.
3. Verify package ownership and the existing npm trusted-publishing entry for
   [`../.github/workflows/release.yml`](../.github/workflows/release.yml), repository, optional
   environment, and direct `npm publish` permission.
4. If npm requires account-side setup for a new package, leave that to the maintainer; do not
   bootstrap token-based CI.
5. After activation, observe a real release PR, CI run, package publication, and provenance where
   supported. Hosted CI, registry publication, and live provenance are intentionally outside this
   local foundation phase.
