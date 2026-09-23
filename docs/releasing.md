# Releasing

Every public package under `packages/*` is versioned and published independently with
[Changesets](https://changesets.dev). Publishing happens in GitHub Actions through npm trusted
publishing (OIDC), so every version after a package's first carries a provenance attestation and no
npm token exists anywhere.

## With every change

Add a changeset for any user-facing change to a package: run `bun changeset`, pick the packages and
the bump, and commit the generated file with your change. The prompts need an interactive terminal;
from a script or an agent, pass the bump and summary as flags instead, for example
`bun changeset --patch @birdcar/pi-write-for -m "Fix the summary"`. Docs, config, and CI-only
changes don't need one.

CI fails a pull request that changes any file in a package directory without a changeset, including
a package README or test. For a change inside a package that should not release, commit an empty
changeset from `bun changeset --empty`.

## What happens on merge

[release.yml](../.github/workflows/release.yml) runs on every push to `main`:

- While changesets are pending, it opens or updates the `chore: version packages` pull request,
  which bumps versions, writes each package's changelog, and removes the consumed changesets.
- Merging that pull request runs `bun run release`: `bun run check`, then `changeset publish`. Every
  version npm does not have yet is published with provenance, tagged `@birdcar/<package>@<version>`,
  and given a GitHub Release.

GitHub does not run CI on the version pull request because it is opened with the workflow token, so
the release job runs the full check suite itself before publishing. If a publish fails, fix the
cause and merge to `main` again: `changeset publish` retries any version missing from npm.

## First-time setup and new packages

npm can only attach a trusted publisher to a package that already exists. Run
[scripts/setup-trusted-publishing.sh](../scripts/setup-trusted-publishing.sh) once before the first
release. It logs in to npmjs.org if needed, publishes any package that is not on npm yet after
`bun run check` passes, attaches the release workflow as each package's trusted publisher, and lets
GitHub Actions open pull requests. It is safe to re-run.

To add a package, list its directory in the script's `PACKAGES` array, after the packages it depends
on, and run the script again before the package's first release.

## Rules

- npm authentication in workflows is OIDC only: never add an npm token, `NODE_AUTH_TOKEN`, or a
  token-bearing `.npmrc` to CI.
- Pin every action to a full commit SHA.
- Keep `bun.lock` registry-neutral: the root `postinstall` hook blanks the tarball URLs a local
  registry proxy records, so GitHub-hosted runners install from the public registry. Don't install
  with `--ignore-scripts`.
