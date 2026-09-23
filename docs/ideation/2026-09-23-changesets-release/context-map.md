# Context Map: Changesets Release Pipeline

**Phase**: 2
**Gates**: 5/5 ready
**Verdict**: GO

_This map extends the phase 1 map, which is kept in full under "Phase 1 (retained)" at the end. Explored 2026-09-23 on `ideation/2026-09-23-changesets-release` at `a76d4a7`. Phase 1 is committed: `scripts/setup-trusted-publishing.sh` is 100755 and passes shellcheck (criterion 8 exits 0). `main`, `origin/main`, and the merge base are all `0f8cd37`, and the branch differs from main only by that script. `docs/ideation/2026-09-23-changesets-release/` is untracked. Exploration was read-only: no builds, installs, or file writes. Prettier, actionlint, and the rule checks ran on stdin or in memory._

## Gates

| Gate                 | Status | Evidence |
| -------------------- | ------ | -------- |
| Scope clarity        | ready  | The spec names 3 new files (`.changeset/config.json`, `.changeset/README.md`, `.changeset/publish-from-ci.md`), 12 modified, and 7 deleted, each with a concrete change. Its line references are correct: `scripts/check-workspace.ts:84` (the call), `:120-133` and `:135-160` (the two functions), `tests/tooling/workspace.test.ts:34-48`, and `README.md:35-44`. The target `check` string (spec L479) is exactly the current `check` minus the three removed scripts (compared as strings). `contract-data.json` execution.phases[1].files lists 21 of the 22 files. It leaves out only `publish-from-ci.md`, which the contract still covers ("Include a patch changeset"). |
| Pattern familiarity  | ready  | Read nicknisi at `20391a18…`: `.changeset/config.json`, `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `AGENTS.md`, `package.json`. Read changesets/action at `ae32849…`: `action.yml`, `src/index.ts`, `src/run.ts`, `src/utils.ts`, README. Read the `@changesets/cli@3.0.3` source at `c9269c0`: `getPublishTool.ts`, `lib/npm.ts`, `cli.ts`, `commands/status`, `versionablePackages.ts`, `@changesets/config` defaults and schema, `@changesets/git`, `@changesets/read`. Also read this repo's workflow test, both workflows, `check-workspace.ts`, its test, `check-docs.ts`, and `check-package.ts`. |
| Dependency awareness | ready  | `rg` and `git grep` show that only files being deleted or rewritten import `scripts/release.ts` and `scripts/publish.ts` (release.yml L84 and L145-148, workflows.test.ts L102 and L201, lockfile.test.ts L5, publish.test.ts L10-12, publish.ts L8). Outside docs/ideation, Release Please appears only in files the spec lists. `semver` stays because check-workspace.ts L5 imports it, and `check-package.ts` exports are still used. Workflow consumers are mapped: the bootstrap's `WORKFLOW="release.yml"`, the criterion probes, and the npm trusted-publisher filename binding. |
| Edge case coverage   | ready  | 20 concrete cases below, most checked read-only here. Examples: the perl dry run changes exactly 466 lines and is idempotent. Prettier rewraps 4 spec doc blocks and expands `keywords`. The token value the old negative controls inject is not discriminating. `status --since` does not see untracked changesets. Edits to a package README or tests trip the gate. The v2 action creates tags only through `CHANGESETS_OUTPUT`. The workspace versions in bun.lock go stale after a bump. |
| Test strategy        | ready  | Baseline: `bun test tests/release/workflows.test.ts` passes 4 tests (249 expects) in 48 ms. actionlint 1.7.12 is clean on both current workflows and on the spec's target release.yml and ci.yml (linted from stdin). Run in memory, the spec's three rules pass on the targets and catch each of the contract's three mutations. Criteria 5 and 2 both exit 1 on today's tree. Criterion 5's predicate passes on the composed ci.yml and fails with `fetch-depth: 1`. Probes 3, 4, 6, and 7 (the spec's `snap`/`probe`) cover lockfile neutrality, the mutations, the dependents bump, and the gate. |

### Phase 1 gate statuses (reference)

All five phase 1 gates were `ready`, for a GO verdict. The evidence is under "Phase 1 (retained) > Gates".

## Key Patterns

- **nicknisi `.changeset/config.json`**
  - His settings: `$schema` `@changesets/config@3.1.4` (the v2 CLI), `access: public`, `baseBranch: main`, `updateInternalDependencies: patch`, `commit: false`, `changelog: @changesets/cli/changelog`, and empty `ignore`, `fixed`, and `linked`. He also sets `privatePackages {version: true, tag: true}`, which the spec drops.
  - v3's own init default (`packages/config/src/defaults.ts` at c9269c0) has the same keys. It uses `access: "restricted"` and adds `format: "auto"`. Its `$schema` is `https://unpkg.com/@changesets/config@4.0.1/schema.json`, which returns HTTP 200.
  - The spec's config omits `format`, so the default applies, and the literal is already prettier-clean.
- **nicknisi `.github/workflows/release.yml`**
  - It uses unpinned `@v4`/`@v1` actions, top-level `contents`/`pull-requests`/`id-token: write`, pnpm, the v1 inputs `version`/`publish`/`title`/`commit`, and `env: GITHUB_TOKEN`.
  - Do not copy the v1 input names: v2's `throwOnRenamedInputs` throws on them (`src/index.ts:23-31`).
  - Do not copy the `GITHUB_TOKEN` env: v2 throws if that env differs from the `github-token` input (`index.ts:35-41`).
  - Do not copy his comments, because they name `NPM_TOKEN`.
- **nicknisi `.github/workflows/ci.yml` L50-55**
  - The `Changeset Status` step lives inside `check`, with `if: github.event_name == 'pull_request' && github.head_ref != 'changeset-release/main'` and a checkout using `fetch-depth: 0`.
  - The spec moves it into its own `changeset-status` job.
- **nicknisi `AGENTS.md` L8**
  - "Add a changeset for any user-facing change to a package: run `pnpm changeset`, pick the packages + bump, and commit the generated file with your change. No changeset = no release. (Docs/config/CI-only changes don't need one.)"
  - The spec's rule is this text with `bun changeset`.
- **nicknisi `package.json` scripts**
  - `"changeset": "changeset"`, `"version": "changeset version"`, and `"release": "pnpm typecheck && pnpm build && changeset publish"`.
  - The spec's `release` is `bun run check && changeset publish`.
- **changesets/action at `ae32849d5ba541f9ae29e40e22a623bc13562f51` (v2.1.2)**
  - Verified pin: the annotated tag `66d7d1dd…` peels to this commit. It is the latest release (2026-09-07). No moving `v2` tag exists (the ref returns 404).
  - `action.yml` runs on node24. Inputs: `github-token` (default `${{ github.token }}`), `publish-script`, `version-script`, `commit-message`, `pr-title`, `create-github-releases` and `push-git-tags` (both default true), and `push-with-git-cli` (default false: commits and tags go through the GitHub API).
  - CLI check: `validateChangesetsCliVersion` (`utils.ts:189-229`) throws when the declared or installed `@changesets/cli` is 2.x. v2 of the action requires CLI 3.
  - Nothing in `src` handles `.npmrc`, `NPM_TOKEN`, or `_authToken`.
  - Publish mode (`run.ts:158-258`) runs `publish-script` with `CHANGESETS_OUTPUT=<RUNNER_TEMP>/changesets-output-<uuid>.ndjson`. It creates tags and GitHub Releases **only** from that file. If the file is missing, it logs a warning and creates nothing. A non-zero exit throws (`index.ts:103-113`).
  - The version PR branch is `changeset-release/${branch}` (`run.ts:359`), which is `changeset-release/main` here.
  - Job permissions per the README (L25-28): `contents: write`, `pull-requests: write`, and `id-token: write`.
- **`@changesets/cli@3.0.3`** (published 2026-09-14; `@changesets/config` 4.0.1 was published the same day)
  - Engines are `node ^22.11 || ^24 || >=26` and `npm >=10.9.0`. The package is ESM, and the `changeset` bin is `bin.js`.
  - `cli.ts:67-70`: when `--output` is absent, the env var `CHANGESETS_OUTPUT` fills it.
  - `getPublishTool.ts`: only pnpm and yarn get special handling. A Bun workspace falls back to **npm**.
  - `lib/npm.ts:368` runs `npm publish --json --access <access> --tag <tag>` in `pkg.dir`, with `nodePath: false` (so it uses the npm on PATH). It passes `sanitizeEnv` (L53-59), which strips only the OTP variables. `NPM_CONFIG_PROVENANCE` and the OIDC env reach npm.
  - `commands/status/index.ts` fails only when changed packages exist **and** no changeset was added in the range. Any changeset satisfies it. The range is `--since`, or `config.baseBranch` when that is absent.
  - `@changesets/read` ignores `.changeset/README.md` (plus AGENTS.md, CLAUDE.md, and GEMINI.md) in both modes.
  - `add` has non-interactive flags: `--patch`, `--minor`, and `--major <pkg>`, `-m <text>`, and `--empty` (`cli.ts:82-96`).
  - The `@manypkg/tools` BunTool detects the monorepo root from `bun.lock` plus `workspaces`. The action pins the same `@manypkg/get-packages ^3.1.0`.
  - For shallow clones, `@changesets/git` deepens history by 50 commits when the default changelog (`@changesets/changelog-git`) needs commit info.
- **This repo's `.github/workflows/release.yml`: pins to reuse**
  - checkout `11bd71901bbe5b1630ceea73d27597364c9af683` (L44, L106) and setup-node `49933ea5288caeca8642d1e84afbd3f7d6820020` (L56, L110).
  - Node `"24.8.0"` (L112) and the `Pin npm 11.6.0` step (L113-114).
  - The Bun install steps (L115-118). The spec adds `shell: bash`, as ci.yml L56 already has.
  - `bun install --frozen-lockfile` (L119-120).
- **This repo's `.github/workflows/ci.yml`**
  - The `check` job steps at L50-61 are the template for the new job.
  - `validate-pr-title` (L17-30) and `check` (L32-63) must stay byte-identical.
- **`tests/release/workflows.test.ts` (274 lines), the rewrite target**
  - Keep:
    - the `Step` interface (L5-12)
    - `workflow()` (L32-34), `step()` (L42-46), and `assertConventionalPrTitleGate` (L53-58)
    - the describe fixtures (L137-143)
    - the CI test (L145-171), with its L168-170 loop replaced by `assertPinnedUses(ci)`
    - the PR-title control (L245-248)
    - the aggregate test (L251-272), minus L263-265
  - Delete:
    - `Job.needs`, `Job.permissions`, and `Job.outputs` (L16-18), and `Workflow.on.workflow_dispatch` (L27)
    - `assertSupportedNpm` (L60-69), `assertReleasePublicationWiring` (L71-112), and `assertReleaseLockRefreshWiring` (L114-135)
    - the release test (L173-186) and the release negative controls (L189-243)
  - Replace:
    - `assertPinnedUses(value)` (L36-40). It only matches `actions/`, so it misses `changesets/action`.
    - `assertNoNpmTokenAuth` (L48-51). It only scans the publish job.
  - Style to keep: `test("...spec sentence...")`, `structuredClone` negative controls, and `expect(() => ...).toThrow()`.
- **`scripts/check-docs.ts:28`**
  - It checks markdown links `[text](target)` and backticked paths ending in .ts, .md, .json, .yml, or .yaml, resolved relative to the doc.
  - It skips `http(s):`, `mailto:`, `npm:`, and `#` targets (L31). The maintained-docs list is at L12-19.

## Dependencies

- **`package.json`**
  - Scripts are run by:
    - the ci.yml matrix (L40-49: `bun run check`, `bun run test:pi`, `bun run check:package`)
    - the new release.yml (`bun run version`, `bun run release`) and the new `changeset-status` job (`bun run changeset status ...`)
    - the bootstrap (`scripts/setup-trusted-publishing.sh:64`, `bun run check`) and criterion 1
  - Tests and probes that read the scripts:
    - `workflows.test.ts` reads `scripts.check` and `scripts.release` (L140-143, L252).
    - Criterion 4 rewrites the exact string `bun run check && changeset publish` in `release`.
  - The action reads `devDependencies["@changesets/cli"]`, which must not be a 2.x range.
  - `workspaces: ["packages/*"]` together with bun.lock drives manypkg discovery in both the CLI and the action.
- **`bun.lock`**
  - Every `bun install --frozen-lockfile` reads it:
    - ci.yml L60-61, in 4 matrix legs on Ubuntu and macOS
    - the new `changeset-status` job and release.yml
    - the criteria 3, 4, 6, and 7 worktrees
  - `.prettierignore:5` ignores it, and manypkg's BunTool needs it present to detect the monorepo.
  - Its workspaces section (L27-44) records `version: "0.1.0"` for both packages and write-for's `"@birdcar/pi-services": "^0.1.0"`. `changeset version` does not update these.
- **`.github/workflows/release.yml`**
  - Read by `workflows.test.ts` L139.
  - Its filename is bound by `scripts/setup-trusted-publishing.sh:9` (`WORKFLOW="release.yml"`) and by each package's npm trusted publisher, so it must keep its name.
  - The trusted publisher was created without `--environment` (bootstrap L127), so removing `environment: npm-publish` matches it.
  - Criterion 4 edits it by exact pattern: a line matching `^\s*NPM_CONFIG_PROVENANCE:`, and `changesets/action@` followed by 40 hex characters.
  - Criterion 10 queries runs by this name. The new docs/releasing.md links it as `../.github/workflows/release.yml`.
- **`.github/workflows/ci.yml`**
  - Read by `workflows.test.ts` L138. Criterion 5 parses it, and criterion 11 queries its pull-request runs.
  - Today's docs/releasing.md L36 links it. The new text drops that link, which is fine.
- **`tests/release/workflows.test.ts`**: run by `test:ci` (package.json L26), by `bun test`, and directly by criterion 4.
- **`scripts/check-workspace.ts`**
  - Runs as the `check:workspace` script (package.json L19).
  - `tests/tooling/workspace.test.ts` L6-10 imports `validateCurrentWorkspace`, `validateWorkspaceManifests`, and `type WorkspaceManifest`. None of these change, and the deleted functions are module-private.
  - Helpers still used after the deletion: `objectValue` (L164, L185, L196, L207), `existsSync` (L38, L43, L219, L228, L233, L246), `readJson` (L34, L46), and `rootDir` in `validateWorkspaceManifests` (L111-114).
- **`tests/tooling/workspace.test.ts`**: run by `test:ci`. After L34-48 are deleted, `fixtureRoot` still writes LICENSE (L33) and the package fixtures (L49-62).
- **`packages/services/package.json` and `packages/write-for/package.json`**
  - Read by `check-workspace` (the manifests, plus `npm pack --dry-run` at L270).
  - Read by `check-package`, which reads `repository` only passively (L88-94), so the new field breaks nothing.
  - `test:pi` copies them into `.pi-tests`. The bootstrap reads their names with `node -p`.
  - `changeset version` bumps both versions and write-for's range.
  - npm provenance matches their `repository.url`.
  - Editing them counts as a package change for `changeset status`.
- **`docs/releasing.md`**: in the maintained-docs list (check-docs.ts:16). It is referenced from AGENTS.md:12 (a backticked path that resolves), from the README link, and from the bootstrap's L2 comment.
- **`README.md` and `AGENTS.md`**
  - Both are in the maintained-docs list (check-docs.ts:13-14).
  - `tests/tooling/docs.test.ts` copies the repo with the filter `!source.includes(".git")`, which also drops `.github/`. That behavior predates this phase, and the test only asserts `ok === false`, so it is harmless.
- **Deleted files**
  - They import only each other or files being rewritten, and nothing else requires `release-please`.
  - After `publish.ts` is gone, nothing reads `check-package.ts`'s `PackageArtifactOptions.rootDir` or the returned `integrity` and `repositoryUrl` (see Risks).

## Conventions

- **Naming**: most root scripts follow `name:qualifier` (`test:ci`, `check:docs`). The new ones are bare (`changeset`, `version`, `release`, `postinstall`), as in nicknisi's repo. Changeset files are kebab-case `.md` files in `.changeset/`.
- **Imports**: tests import `node:` built-ins, `bun:test`, `import YAML from "yaml"`, and `../../scripts/*.ts` with the explicit `.ts` extension (`allowImportingTsExtensions` in tsconfig.tooling.json).
- **Error handling**: tooling collects `errors: string[]` and exits 1 with the joined list. Tests check failures with `expect(() => ...).toThrow()`.
- **Types**
  - Parsed YAML shapes are `interface`s.
  - `tsconfig.json` enables `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax`.
  - tsc ignores unused interface fields, but the user's rules say to delete unused code.
- **Testing**
  - `bun:test` `describe`/`test` with specification-style names, and `structuredClone` negative controls.
  - ESLint uses `tseslint.configs.recommended`, which allows the non-null `!` (already used at L190).
- **Formatting**
  - Prettier 3.6.2: `printWidth` 100, `proseWrap: always`.
  - `package.json` files use prettier's json-stringify parser, which expands every array.
  - `.changeset/*` is **not** prettier-ignored. `packages/*/CHANGELOG.md` is (`.prettierignore:12`).
  - `bun run lint` runs `prettier --check .`.
- **Workflows**
  - Every `uses:` is pinned to a 40-hex SHA. An optional `# vX` comment is allowed, since the YAML parse drops comments.
  - `runs-on: ubuntu-24.04`.
  - Top-level `permissions: contents: read`, with any elevation at job level.
- **Commits**: conventional (for example `chore(release): switch to changesets`), no Co-Authored-By trailer, and `git rm` for the 7 deletions.

## Edge Cases

1. **Keywords formatting.** The spec's inline `"keywords": ["pi", "pi-coding-agent", "pi-package"]` fails `prettier --check`, because the json-stringify parser expands it to one item per line (confirmed on stdin). Write it expanded, or run `bun run format`.
2. **Spec doc blocks over 100 columns.** Prettier rewraps these as written:
   - two lines in docs/releasing.md (the version-PR bullet and the "If a publish fails" line)
   - the AGENTS.md bullet
   - the README "Releases publish..." line
   - `.changeset/README.md`, which is otherwise byte-identical to upstream `packages/cli/default-files/README.md` at 3.0.3

   The `config.json` and `publish-from-ci.md` literals are already clean. Run `bun run format` before `lint`.
3. **Negative controls that can't discriminate.** Today's token controls (L229-238) inject the value `"${{ secrets.NPM_TOKEN }}"` for every key, and that value alone matches the rule's regex (tested). The `NODE_AUTH_TOKEN` and `_authToken` controls would still pass even if those regex branches were deleted. Use a neutral value such as `"redacted"`, so each key proves its own branch. With a neutral value, each key is caught (tested).
4. **Comments are invisible to the token rule.** `YAML.stringify(YAML.parse(...))` drops comments, so comment text can never trip the rule. Keep token names out of comments anyway, as the spec says.
5. **Pin regex details.** The new `/@[0-9a-f]{40}$/` drops the old `/i` flag, which is fine because every pin is lowercase. Parsed `uses` values do not include the `# v2.1.2` comment. The `./` local-action skip has nothing to match today.
6. **Unused fields beyond the spec's list.** After the rewrite, `Job.if` and `Step.if` are also unused. The spec lists only `needs`, `Job.permissions`, `outputs`, and `workflow_dispatch`, but the user's rules say to delete the rest too. Keep `Workflow.permissions` (the CI test uses it at L146) and `Step.name` (used by `step()`).
7. **Postinstall hook.**
   - The spec's JSON value decodes, via JSON.parse, to exactly `perl -pi -e 's#"https://socket-firewall\.workos\.dev/[^"]*"#""#g' bun.lock`.
   - A dry run without `-i` changes 466 lines, leaves 0 proxy references, and is idempotent.
   - `perl -pi` on a missing bun.lock prints a warning, exits 0, and creates nothing.
   - The hook belongs in the **root** package.json only. Never put it in `packages/*/package.json`, where it would ship to consumers.
8. **`--ignore-scripts` skips the hook.** Any `bun add` or `bun remove` run that way rewrites every entry back to a proxy URL. Re-run the grep after every dependency command.
9. **`--since` doesn't see untracked files.**
   - `changeset status --since=<ref>` takes its file list from `git diff --name-only <merge-base>` (`@changesets/git` L208-236 and L242-260). That diff includes tracked working-tree edits but not untracked files.
   - A new `.changeset/*.md` is therefore invisible to `--since` until it is staged.
   - Without `--since`, `readChangesets` reads the folder directly and compares against the local `main` (up to date at 0f8cd37).
10. **Status check ordering.** The spec's step "`bun run changeset status` exits 0" must run before the package metadata edits. After those edits, status passes only once `publish-from-ci.md` exists, and it must be staged when using `--since`.
11. **Scope of the status gate.**
    - Every file under `packages/<pkg>/` counts as a package change, because the default `changedFilePatterns` is `**`. That includes package READMEs and `packages/*/test/**`.
    - Any changeset added in the range satisfies the gate, even one for a different package.
    - So a "docs-only" PR that edits `packages/write-for/README.md` fails unless it adds a changeset or runs `bun changeset add --empty`.
    - The spec lets the releasing.md wording change freely. Its sentence "Docs, config, and CI-only changes don't need one" should mention `--empty` for edits inside package directories.
12. **Changesets without a TTY.** v3's interactive `changeset` (`add`) needs a TTY. Agents can run `bun changeset add --patch @birdcar/pi-write-for -m "..."` or write the file by hand. The spec fixes the AGENTS.md text, so mentioning this there is optional.
13. **Bootstrap wording.** The spec's releasing.md says the bootstrap "runs `bun run check`" and should be re-run "whenever a package is added". The actual script (`scripts/setup-trusted-publishing.sh:11-12` and `:62-64`) uses a fixed `PACKAGES` array, commented "new packages must be added here", and runs the check only when a package is missing. Reword to match. This carries over from phase 1.
14. **Mid-phase breakage.** Running `bun remove release-please` before the 7 deletions leaves `tests/release/manifest.test.ts` requiring a module that no longer exists at runtime. Don't run the full `bun run check` until the deletions are done. The inner-loop workflow test isn't affected.
15. **Criterion 2's grep.** It is case-insensitive across all tracked files outside docs/ideation, so it also catches changeset bodies and code comments. The two `github` hits in bun.lock today (L677 `parse-github-repo-url`, L721 `release-please`) are release-please dependencies and go away with `bun remove`.
16. **What criterion 4's mutations need.**
    - `NPM_CONFIG_PROVENANCE:` on its own line in the changesets step's `env`
    - an unquoted `changesets/action@<sha>`
    - the exact `release` string

    The spec's target has all three (tested in memory).
17. **`fetch-depth` must be a number.** Criterion 5 compares with `=== 0`, so write `fetch-depth: 0`, not the string `"0"`. With `fetch-depth: 1` the predicate is false (tested).
18. **Tags depend on `CHANGESETS_OUTPUT`.** `bun run release` must pass that env var through to `changeset publish`, and plain `&&` chaining under bun does. Wrapping the command in something that clears the environment (for example `env -i`) would publish to npm but create no tags or Releases, which fails criterion 10.
19. **The `head_ref` guard.** v2 always uses `changeset-release/main` for the version PR, and the guard skips it. It matters only if version PRs ever get CI, since PRs opened with GITHUB_TOKEN trigger none.
20. **`.pi-tests/` and `git add -A`.** `bun run check` leaves an untracked `.pi-tests/` (with symlinks) that is **not gitignored**. `snap` runs `git add -A`, so that directory lands in probe snapshots and could get committed. Run `rm -rf .pi-tests` before `snap` and before staging, or stage paths explicitly.

## Verification

- **Inner loop**
  - `bun test tests/release/workflows.test.ts`. Baseline: 4 pass, 249 expects, 48 ms (0.2 s wall).
  - `actionlint .github/workflows/ci.yml .github/workflows/release.yml` (1.7.12 at /opt/homebrew/bin, with shellcheck 0.11.0 present). It is clean on the current files and on the spec's targets. `actionlint -stdin-filename <path> -` lints a draft without writing it.
  - `bun test tests/tooling/workspace.test.ts && bun run check:workspace`. The test's `beforeAll` runs `bun run build`.
- **Formatting**: run `bun run format`, then `bunx prettier --check README.md AGENTS.md docs/releasing.md .changeset package.json packages/*/package.json`.
- **Docs**: run `bun run check:docs`.
  - The target links all resolve: `https://changesets.dev`, `../.github/workflows/release.yml`, `../scripts/setup-trusted-publishing.sh`, and `docs/releasing.md`.
  - No checkable backticked path appears in the target text.
- **Lockfile**: `grep -c 'socket-firewall.workos.dev' bun.lock` prints 466 today. It must print 0 after every dependency command.
- **Contract probes**
  - Define `snap` and `probe` from spec L126-140 first.
  - `probe 2` and `probe 5` exit 1 today.
  - `probe 3`, `probe 4`, `probe 6`, and `probe 7` run in worktrees built from the snapshot. If a probe dies mid-run, run `git worktree prune`.
- **Full suite**: `bun run check` (about 46 s). Criterion 8 (`shellcheck scripts/setup-trusted-publishing.sh`) must still exit 0.
- **Recommended go-live dry run** (not a contract criterion)
  - In a worktree of the snapshot with only `publish-from-ci.md`, run `bunx changeset version`, then `bun install --frozen-lockfile && bun run check`.
  - Expect 0.1.1 for both packages and a `^0.1.1` range. This is the exact tree the release job sees after the version PR merges.

## Risks

- **Decision-log premise is wrong: "github.com entries" in bun.lock.**
  - The lockfile key decision says bun.lock "also has two legitimate `https://github.com/` entries that must keep their URL". Today there are **zero** `https://github.com/` URLs.
  - The only two `github` matches are the package `parse-github-repo-url` (L677) and release-please's dependency list (L721). Both leave with release-please.
  - The host-specific regex is still the right design, since it guards future git dependencies, but its stated reason is inaccurate. The 466 count is correct.
- **Not re-verifiable here: frozen install after `changeset version`.**
  - Two claims depend on Bun 1.3.14 tolerating stale workspace metadata under `--frozen-lockfile`: the decision "The version script is plain changeset version, with no bun.lock refresh" and criterion 6.
  - The stale metadata is bun.lock L27-44 (`version: "0.1.0"` and `^0.1.0`) versus the bumped package.json files.
  - The spec says this was tested in a scratch clone, but I couldn't re-check it without writing files.
  - If probe 6 or the go-live dry run fails, the release job would fail at "Install dependencies" after the version PR merges.
  - The only fallback is the rejected alternative `changeset version && bun install --lockfile-only`. Escalate rather than switching quietly.
  - Also expect the workspaces section to drift until someone runs a local `bun install`, which then rewrites those lines inside an unrelated diff.
- **Tags and Releases depend on `CHANGESETS_OUTPUT`** (confirmed in the source).
  - This doesn't contradict "Accept Changesets' tag format and its GitHub Releases".
  - v2 creates them only from the ndjson file the CLI writes. If the env var doesn't reach `changeset publish`, npm still publishes, but criterion 10 fails with only a warning in the log.
- **Upstream permission advice (informational).**
  - The changesets/action README (L20) recommends splitting into the `select-mode`, `version`, and `publish` sub-actions when using trusted publishing, to tighten publish permissions.
  - The spec's single job grants `contents: write`, `pull-requests: write`, and `id-token: write` to a job that also runs the full dev-dependency suite (`bun run check`).
  - This follows the decision "nicknisi's choices win by default" (no bespoke hardening), so it isn't a blocker.
- **Spec text that doesn't match reality.**
  - The bootstrap wording (edge case 13, carried over from phase 1).
  - The error-table row "`changeset status` fails on a docs-only PR: should not happen" is wrong for package READMEs and tests (edge case 11).
  - `packages/write-for/README.md:417-418` says mechanical checks prove "release planning", which was `publish.test.ts` and is being deleted. It isn't a Release Please mention, so criterion 2 is unaffected. The file is outside the spec's list, so flag it to the maintainer rather than widening scope (the change would ride the go-live patch).
- **Packaging fields with no reader.**
  - After `publish.ts` is deleted, nothing reads `scripts/check-package.ts`'s `PackageArtifactOptions.rootDir` (L18, L37), or the `integrity` and `repositoryUrl` it returns (L13-14, L88-94, L279-280).
  - The spec says to leave generic packaging untouched, which conflicts with the user rule "Delete unused code completely".
  - Follow the spec in this phase and note it for a follow-up.
- **Snapshot and commit hygiene.**
  - A stray `.pi-tests/` or a stale probe worktree can pollute snapshots and commits (edge case 20).
  - The untracked ideation directory also goes into `snap` snapshots, which is harmless.
- **Registry policy.**
  - `NPM_CONFIG_REGISTRY`, `BUN_CONFIG_REGISTRY`, and the `registry=` line in `~/.npmrc` all point at `https://socket-firewall.workos.dev/`. Never change them, and never override the registry to fix an install. The fix is only to blank the committed bun.lock URLs.
  - `@changesets/cli@3.0.3` is 9 days old (2026-09-14). The spec reports that it installs through the firewall.
- **Risks that only show up at go-live.**
  - The first CI publish needs the phase 1 bootstrap to have attached trusted publishers for `release.yml` and enabled PR creation by Actions.
  - Changesets' tag format `@birdcar/<pkg>@<version>` can't be changed.
  - The pinned npm 11.6.0 meets OIDC's requirement of 11.5.1 or later.
  - Provenance requires `repository.url` to be exactly `git+https://github.com/birdcar/pi-extensions.git`, with the right `directory`.

---

## Phase 1 (retained)

**Phase**: 1
**Gates**: 5/5 ready
**Verdict**: GO

_No earlier context map existed, so this one starts fresh. Explored 2026-09-23 on branch `ideation/2026-09-23-changesets-release`._

### Gates

| Gate                 | Status | Evidence |
| -------------------- | ------ | -------- |
| Scope clarity        | ready  | One new file, `scripts/setup-trusted-publishing.sh` (mode 100755), with no modified or deleted files. This matches `contract-data.json` execution.phases[0].files. The spec gives the constants, the four steps in order, the error table, and a target structure. |
| Pattern familiarity  | ready  | Read the full 81-line reference `nicknisi/pi-extensions@20391a18…:scripts/setup-trusted-publishing.sh` (fetched with `gh api`). Also read npm v11.20.0 `lib/trust-cmd.js`, `lib/commands/trust/{list,github}.js`, and `docs/lib/content/commands/npm-trust.md`. The repo has no committed bash script; bash style exists only in `release.yml` run blocks (L70, L134). |
| Dependency awareness | ready  | Nothing consumes the script in phase 1 (`rg setup-trusted-publishing` outside docs/ideation finds nothing). The repo tooling ignores it: prettier infers no parser, eslint covers `**/*.ts,**/*.js`, tsc covers `scripts/**/*.ts`, check-docs only checks links in its maintained docs, check-workspace only reads manifests, and boundaries.test uses its own fixture. The script's inputs are the package names, the `release.yml` filename, `bun run check`, and the GitHub workflow-permissions API. |
| Edge case coverage   | ready  | 16 concrete cases below, each checked on this machine. Examples: `curl -f` exits 56 on a 404 (not 22), bash 3.2 aborts on empty arrays under `set -u`, there is no /dev/tty, `set -e` skips the custom error messages, `npm login` strips comments from ~/.npmrc, the `--registry` flag must stay after the npx package spec, and npm@11.20.0 is one day old behind the firewall. |
| Test strategy        | ready  | shellcheck 0.11.0 is installed with no shellcheckrc anywhere (default severity; SC2001 notes fail). `bash -n` also applies. The stubbed-PATH playground should run under both `/bin/bash` 3.2 and PATH bash 5.3. `expect` can drive the /dev/tty prompt (tested here). `bun run lint` and `bun run check:docs` stay green. `git ls-files -s` should show 100755. |

### Key Patterns

- `nicknisi/pi-extensions@20391a18b2c87bb0510ea1f0cd1ac0b33192f0c1:scripts/setup-trusted-publishing.sh` (fetch with `gh api "repos/nicknisi/pi-extensions/contents/scripts/setup-trusted-publishing.sh?ref=20391a18b2c87bb0510ea1f0cd1ac0b33192f0c1" --jq .content | base64 -d`):
  - L11 `set -euo pipefail`. L13-15 set REGISTRY, REPO, and WORKFLOW. His REGISTRY has no trailing slash. The spec's has one, and it must stay, because the curl URL is built by concatenation.
  - L16 resolves ROOT from BASH_SOURCE; the spec replaces this with `git rev-parse --show-toplevel`. L18-21 is a whoami preflight that exits with instructions; the spec replaces it with login-if-needed.
  - L25-47 `publish_pkg`:
    - L29-32 comment: `npm view` (the package document) can 404 on a lagging read replica minutes after a publish, while the exact version endpoint "reads authoritatively".
    - L33/L38 `curl -sf "$REGISTRY/$(echo "$name" | sed 's|/|%2f|')/$version"`. These lines fail shellcheck (SC2001, exit 1 at default severity); use `${name/\//%2f}`.
    - L37 uses pnpm publish (drop it). L39 is the replica-lag "continuing" message, L41 is `!! publish of $name failed for real`, and L45 is `sleep 2`.
  - L49-55 publish "shared" first, then glob `packages/*/`. Drop this for the fixed PACKAGES array.
  - L58-79 trust loop:
    - L61 `npm trust list … 2>/dev/null | grep -q "$WORKFLOW"`.
    - L65-67 comment: `trust list` can need 2FA and fail silently, and "npm allows exactly one trusted publisher per package".
    - L69 `npm trust github "$name" --file "$WORKFLOW" --repo "$REPO" --allow-publish --yes --registry=… 2>&1 | tee /tmp/npm-trust-$$.log | grep -q "E409\|409 Conflict"`. L70 prints the 409 message, L71 checks PIPESTATUS, L72 prints `!! trust failed for $name`, and L78 is `sleep 2`.
  - Output convention: `== ` decision lines go to stdout and `!! ` failure lines go to stderr.
- npm v11.20.0 `lib/trust-cmd.js` (npm/cli tag v11.20.0, commit d12b9434):
  - `createConfigCommand` throws unless `--allow-publish` or `--allow-stage-publish` is given.
  - `--yes` skips the `Do you want to proceed? (y/N)` prompt.
  - It warns "Registry … may not support trusted publishing" when the registry isn't npm's default, `https://registry.npmjs.org/`.
  - `displayResponseBody`: an empty list prints `No trust configurations found for package (<name>)` to stdout and exits 0. Otherwise each config prints `type: github`, `id: …`, `file: release.yml`, `repository: birdcar/pi-extensions`, and `permissions: publish` (colors only on a TTY; `--json` is available).
  - `list.js` and `createConfig` wrap their requests in `otplease`, so `trust list` can also ask for 2FA.
  - `lib/commands/trust/github.js`: `--file` must be a bare file name ending in .yml or .yaml, and `--repo` must be `owner/repo`. Without `--repo`, npm infers it from package.json `repository`, which neither package has in phase 1, so always pass `--repo`.
- `docs/lib/content/commands/npm-trust.md` in npm v11.20.0 (same text in v12.1.0):
  - Prerequisites: npm ≥ 11.15.0, 2FA on the account, the package must already exist, and granular tokens with bypass-2FA are not supported.
  - "Currently, the registry only supports one configuration per package … it will result in an error."
  - Bulk usage: the first call needs 2FA, the website offers "skip for 5 minutes", and the docs "recommend adding a 2-second sleep between each call to avoid rate limiting".
- Repo bash style (workflow YAML only): `.github/workflows/release.yml:70-85` and `:134-139` use inline `set -euo pipefail`, `case` blocks, `test` assertions, and `echo … >&2; exit 1`.

### Dependencies

- `scripts/setup-trusted-publishing.sh` (new) has no consumers in phase 1. Phase 2 (`spec-phase-2.md:555-559`) links it from `docs/releasing.md` with a markdown link. From then on, `scripts/check-docs.ts:28` requires that exact path to exist; its backtick pattern only covers .ts/.md/.json/.yml/.yaml, which is why phase 2 uses a markdown link.
- Inputs the script reads, which must stay in sync:
  - `packages/services/package.json:2` and `packages/write-for/package.json:2` hold the names read with `node -p`. Tested: this returns `@birdcar/pi-services` and `@birdcar/pi-write-for` from the repo root under `"type": "module"` on Node v24.12.0.
  - `files` includes `dist` (services L13, write-for L17), but `.gitignore:6` ignores `dist`. Neither package has a `prepack` or `prepublishOnly` script, so `npm publish` ships whatever `dist/` holds right then. `package.json:10` builds each package with `rm -rf dist && tsc` (services L23, write-for L30), and `package.json:27` (`check`) starts with `bun run build`.
  - `packages/write-for/package.json:34` depends on `"@birdcar/pi-services": "^0.1.0"`. That is plain semver, not `workspace:`, so `npm publish` needs no range rewriting (nicknisi used pnpm for that). Publish services first.
  - Both packages set `publishConfig.access: public` (services L19-20, write-for L23-24).
  - Nothing overrides the `--registry` flag for @birdcar packages: no `publishConfig.registry`, no repo- or package-level `.npmrc`, no `bunfig.toml`, and no `@birdcar:registry` scope line in `~/.npmrc`.
  - `.github/workflows/release.yml`: `WORKFLOW="release.yml"` must match this file name. Phase 2 rewrites the file but keeps the name.
  - The `origin` remote is `https://github.com/birdcar/pi-extensions.git`, so `REPO="birdcar/pi-extensions"`.
  - GitHub `repos/birdcar/pi-extensions/actions/permissions/workflow` currently returns `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}`. The repo is public and user-owned, the maintainer is admin, and gh is logged in as birdcar with `repo` and `workflow` scopes.
- Tooling checked and confirmed not to read the new file:
  - `prettier --check .`: `prettier --file-info` reports inferredParser null for `.sh`.
  - `eslint.config.js:22` only matches `**/*.ts` and `**/*.js`.
  - `tsconfig.tooling.json:8` only includes `scripts/**/*.ts`.
  - `scripts/check-docs.ts:12` only reads its maintainedDocs list.
  - `scripts/check-workspace.ts` only reads manifests (L270 runs `npm pack --dry-run` per package).
  - `tests/tooling/boundaries.test.ts` uses its own `packages/boundary-fixture`.
  - `tests/release/workflows.test.ts:102,201` only match `scripts/publish.ts` and `scripts/release.ts` strings.

### Conventions

- **Naming**: kebab-case script in `scripts/` (its neighbors are `.ts` Bun tooling). Constants in UPPER_SNAKE (REGISTRY, REPO, WORKFLOW, NPM_TRUST, PACKAGES); lowercase locals.
- **Imports**: n/a (bash). Use `node -p` for JSON (no jq), `curl`, `gh api`, `npx --yes npm@11.20.0 trust …`, the local `npm` (11.11.0 behind the Volta shim at `/Users/birdcar/.volta/bin/npm`) for whoami, login, and publish, and `bun run check`.
- **Error handling**: `set -euo pipefail`. `== ` decision lines on stdout, `!! ` failure lines on stderr. Check prerequisites with `command -v` (plus `gh auth status`) before any side effect; exit 1 on failure.
- **Types**: n/a.
- **Testing**: no committed tests, per the spec. The throwaway playground lives in `$(mktemp -d)` outside the repo. shellcheck runs at default severity (no `.shellcheckrc` in the repo, `~/.shellcheckrc`, or `~/.config/shellcheckrc`).
- **Commits**: conventional `chore(release): …`, no Co-Authored-By trailer (spec and user instructions). `core.fileMode=true`, so `chmod +x` records 100755. This will be the repo's only 100755 file (the only other non-100644 entry is the `.cursor/rules` symlink). The ideation directory is currently untracked.
- **Registry policy**: `~/.npmrc` contains an Iru-managed "WorkOS Socket Firewall" block (`registry=https://socket-firewall.workos.dev/`) with an explicit notice telling AI agents not to reset the registry to the public default. `NPM_CONFIG_REGISTRY` and `BUN_CONFIG_REGISTRY` point at the same proxy. Override the registry only with per-call flags.

### Edge Cases

1. **curl exit codes.** With this machine's curl 8.7.1, `curl -sf` on a 404 exits **56** over HTTP/2, which is the default for registry.npmjs.org. It exits 22 only with `--http1.1`. A DNS failure exits 6 and a 200 exits 0 (all tested). Never branch on `$? -eq 22`.
   - More robust: `code=$(curl -s -o /dev/null -w '%{http_code}' "$url")`, then 200 means present, 404 means missing, and anything else is `!!` plus exit 1.
   - If you keep `-sf`, treat any non-zero exit as missing and accept that a network error falls through to the publish path.
   - The playground's curl stub must model whichever you choose.
2. **Bash 3.2.** `/bin/bash` is 3.2.57; bash on PATH is Homebrew 5.3.20. Under `set -u`, bash 3.2 aborts on `"${arr[@]}"` when the array is empty (tested). That is exactly the re-run path, where nothing is missing. Bash 3.2 also lacks `mapfile`, `declare -A`, and `${v,,}`. Use `${arr[@]+"${arr[@]}"}` or `${arr[*]:-none}` (both tested on 3.2 and 5.3), or plain strings.
3. **No /dev/tty.** In agent and CI shells, `read </dev/tty` fails with "Device not configured", which exits 1 under `set -e` (tested). `[ -r /dev/tty ]` still returns true, so it can't be used as a check. Treat a failed open as "N" with a `!!` message, e.g. `if ! read -r answer </dev/tty 2>/dev/null; then answer=; fi`.
4. **`set -e` swallows custom messages.** A bare `ROOT="$(git rev-parse --show-toplevel)"` exits before `!! run this from inside birdcar/pi-extensions` can print. Write `ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "!! …" >&2; exit 1; }`. Use the same `if out=$(… 2>&1); then …; else …; fi` shape for `trust list`, `trust github`, `gh api`, and `npm publish`.
5. **pipefail with `grep -q`.** nicknisi's `npm … | tee /tmp/… | grep -q` (L69) risks SIGPIPE and writes to /tmp. Capture the output in a variable and match against it, e.g. `[[ $out == *"$REPO"* && $out == *"$WORKFLOW"* ]]` and `grep -qE 'E409|409 Conflict' <<<"$out"`.
6. **Empty trust list.** `trust list` prints `No trust configurations found for package (<name>)` and exits 0, so the script should go on to create one. The package names contain `birdcar/pi-services` and `birdcar/pi-write-for`, never `birdcar/pi-extensions`, so matching on REPO and WORKFLOW can't produce a false positive.
7. **Existing staged-only publisher.** A publisher created in the npm website that names the right repo and workflow but only has `permissions: stage publish` would pass a REPO+WORKFLOW check and be skipped. Optionally also require a `permissions:` line that grants publish. This is unlikely: both packages are 404 today, so the script creates their publishers with `--allow-publish`.
8. **Registry trailing slash.** REGISTRY must stay `https://registry.npmjs.org/`, because the URL is `${REGISTRY}${name/\//%2f}` → `https://registry.npmjs.org/@birdcar%2fpi-services`. Lowercase `%2f` works (tested: `@changesets%2fcli` returns 200).
9. **Where `--registry` goes on npx.** In `npx --yes npm@11.20.0 trust <sub> … --registry=https://registry.npmjs.org/`, everything after the package spec goes to the inner npm, and its command-line flag wins over the `npm_config_registry` env var that npx sets. npx itself still downloads npm@11.20.0 through the firewall registry. Do not move `--registry` in front of `npm@…` to get around the firewall.
10. **Rate limits and the 2FA window.** npm's docs recommend `sleep 2` between trust calls, and nicknisi also sleeps after each publish (L45/L78). If you keep the sleeps, stub `sleep` in the playground or the under-2-second loop target breaks. Print the "skip for 5 minutes" note once, before the first call that can prompt for 2FA (the first publish, or the first trust call when nothing needs publishing).
11. **The login step may never run.** `~/.npmrc` already has a `//registry.npmjs.org/:_authToken`, so `npm whoami --registry=…` may succeed on the real run. If that token is a granular token with bypass-2FA, whoami passes but the trust calls fail (per npm's docs). The trust-failure `!!` message should suggest `npm login --registry=https://registry.npmjs.org/`.
12. **Never pass `--scope` to npm login.** npm 11.11.0 (`/Users/birdcar/.volta/tools/image/npm/11.11.0/lib/commands/login.js`) writes a `<scope>:registry=` line to ~/.npmrc only when `--scope` is set, and that line would change the machine's registry config for @birdcar.
13. **409 from `trust github`.** When the output contains `E409` or `409 Conflict`, print `== <name> already has a trusted publisher (409); verify it names birdcar/pi-extensions release.yml` and continue. On any other failure, print the output with `!! trust failed for <name>` and exit 1.
14. **Booleans in the gh PUT.** Use `-F can_approve_pull_request_reviews=true`, which sends a real boolean; `-f` would send the string "true". The PUT returns 204 with no body. The GET with `--jq .can_approve_pull_request_reviews` prints `false` or `true` (live value today: `false`).
15. **Summary line.** `published=` should list what was published in this run, and `trusted=` what was created in this run, so a re-run prints `none`. Decide explicitly whether a 409 counts as trusted. The last field is `actions-prs=enabled|already enabled`.
16. **Fixed PACKAGES list.** `tests/tooling/boundaries.test.ts` briefly creates `packages/boundary-fixture/` during `bun run check`; a hardcoded list can't pick it up. The cost is that new packages must be added to the list by hand (see Risks).

### Verification

- `shellcheck scripts/setup-trusted-publishing.sh` (0.11.0 at /opt/homebrew/bin, default severity; SC2001 notes fail it, as they do on nicknisi's L33/L38) and `bash -n scripts/setup-trusted-publishing.sh`.
- Playground: `export PLAYGROUND="$(mktemp -d)/bootstrap-playground"`. Put stubs in `$PLAYGROUND/bin/{npm,npx,curl,gh,bun}`, plus `sleep` if the script sleeps; `git` and `node` stay real. Run every experiment from the repo root with `</dev/null` under both shells:
  - `PATH="$PLAYGROUND/bin:$PATH" bash scripts/setup-trusted-publishing.sh` (bash 5.3)
  - `PATH="$PLAYGROUND/bin:$PATH" /bin/bash scripts/setup-trusted-publishing.sh` (bash 3.2)
- Experiment 6 (the /dev/tty prompt): drive it with `expect`. Tested here: `expect -c 'spawn bash -c {…}; send "n\r"; expect eof'` delivers the answer to /dev/tty. macOS `script -q /dev/null` with piped stdin did not work in this environment; python3's `pty` module is a fallback.
- Experiment 7 caveat: the stubs can't see writes to `~/.npmrc`. Add a static check (`! grep -nE 'npm config|\.npmrc|--scope' scripts/setup-trusted-publishing.sh`) alongside the call-log check that every `npm` and `npx` line carries `--registry=https://registry.npmjs.org/`.
- After `git add`, `git ls-files -s scripts/setup-trusted-publishing.sh` should show `100755`.
- Repo checks stay green: `bun run lint` and `bun run check:docs` (nothing references the script until phase 2). A full `bun run check` (about 46 s) is optional.
- Real state on 2026-09-23, for reference:
  - `@birdcar/pi-services` and `@birdcar/pi-write-for` both return 404 on registry.npmjs.org, so the real starting state matches playground experiment 1.
  - `npm/11.20.0` returns 200.
  - The Actions setting is false, with default permissions `read`.

### Risks

- **A spec rationale is contradicted by npm's docs.** The spec says "npm now allows several trusted-publisher configurations per package, so creating blindly could add duplicates", and its "Duplicate trusted publisher" failure-mode row rests on that. npm's own docs at the pinned v11.20.0 and the latest v12.1.0 say "Currently, the registry only supports one configuration per package. If you attempt to create a new trust relationship when one already exists, it will result in an error." nicknisi's L66-67 says the same.
  - This affects the decision-log entry "nicknisi's choices win by default; deviate only where this repo forces it or the user explicitly chooses otherwise". The y/N prompt is a deviation from nicknisi that rests on a premise the evidence doesn't support.
  - The prompt only fires in the failure path and does no harm. Implement it as specified, and expect that a blind create would most likely just return 409.
- **The spec's playground assumes the wrong curl exit code.** "curl exits 22 (as curl -f does on a 404)" is not true for the real curl here, which exits 56 over HTTP/2 (Edge Case 1). The script must not depend on 22.
- **The replica-lag re-check uses the endpoint nicknisi says lags.** The spec keeps nicknisi's replica-lag handling but re-checks the package document, which his L29-32 identifies as the endpoint that lags ("query the exact version endpoint instead — it reads authoritatively").
  - Keep the package document for the skip decision, so no second version is ever published from a laptop (goal 1).
  - For the re-check after a failed publish, consider `${REGISTRY}${enc}/${version}`, so a publish that actually succeeded isn't reported as failed. Otherwise a false `!! publish … failed` is fixed by re-running.
- **npm@11.20.0 is one day old.** It was published 2026-09-22T21:29Z; the latest npm overall is 12.1.0. npx downloads it through the Socket Firewall, whose managed notice says it screens newly published packages. If it's blocked at go-live, change the pin to an older release ≥ 11.15 (e.g. 11.19.1 or 11.15.0; the contract only requires 11.15+). Never change the registry config.
- **`npm login` rewrites `~/.npmrc` and drops its comments.**
  - npm 11.11.0 `login` calls `@npmcli/config` `save('user')` (`/Users/birdcar/.volta/tools/image/npm/11.11.0/node_modules/@npmcli/config/lib/index.js:766`), which re-serializes the file with `ini.stringify`.
  - That drops every comment (tested with the bundled ini 6.0.0), including the Iru-managed Socket Firewall block markers and notice. The `registry=` value survives.
  - Any `npm login` does this, including the manual one nicknisi's preflight would ask for, and experiment 7 can't detect it.
  - The script itself must never back up, restore, or edit `~/.npmrc`.
- **Phase 2's docs don't match phase 1's script.**
  - Phase 2's releasing.md text (`spec-phase-2.md:555-559`) says to re-run the script "whenever a package is added", but phase 1 hardcodes `PACKAGES=(packages/services packages/write-for)`. A new package is silently skipped until someone edits the array.
  - The same text says the script "runs `bun run check`" unconditionally, but phase 1 runs it only when a package is missing.
  - Phase 2's wording, or a note next to PACKAGES, should reconcile both.
- **Risks that only show up at go-live.** Publishing needs 2FA on the npm account, and the `@birdcar` scope must belong to the logged-in npm user; the script prints the whoami name so the maintainer can check. A published 0.1.0 can't be replaced, so the `bun run check` gate before the first publish is the real safeguard and must not be skippable.
- **No committed test coverage.** Mistakes in the decision logic are caught only by the throwaway playground and by the maintainer's real run and re-run (criterion 12).
