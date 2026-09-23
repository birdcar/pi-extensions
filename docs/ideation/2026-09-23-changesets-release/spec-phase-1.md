# Implementation Spec: Changesets Release Pipeline - Phase 1

**Contract**: ./contract.md
**Estimated Effort**: S

## Technical Approach

Add one maintainer-run bash script, `scripts/setup-trusted-publishing.sh`, adapted from nicknisi's
`scripts/setup-trusted-publishing.sh` at `nicknisi/pi-extensions@20391a18b2c87bb0510ea1f0cd1ac0b33192f0c1`.
It performs the one-time account and repository setup that CI cannot do: npm refuses to attach a
trusted publisher to a package that has never been published (npm/cli#8544), and changesets/action
can only open its version PR once the repository lets GitHub Actions create pull requests. The script
runs interactively on the maintainer's machine (npm login and 2FA prompts are expected) and is safe to
re-run: every step checks current state first and does nothing when the state is already right.

Keep nicknisi's shape (a flat `set -euo pipefail` script with a publish phase and a trust phase) and
apply this repo's adaptations:

- **Registry pinning.** The maintainer's global npm config points at an authenticated corporate proxy
  (`registry=https://socket-firewall.workos.dev/` in `~/.npmrc`, plus `NPM_CONFIG_REGISTRY` and
  `BUN_CONFIG_REGISTRY` set in the environment). Every `npm` and `npx npm@…` call in the script passes
  `--registry=https://registry.npmjs.org/`, and the existence check uses `curl` against that URL
  directly. Never modify, unset, or override the machine's registry configuration; the flags scope
  the override to these calls only.
- **npm trust version.** The local npm is 11.11.0; `npm trust github` with `--allow-publish` needs npm
  ≥ 11.15. Always run trust commands through `npx --yes npm@11.20.0 …` (no version-compare branch).
- **Order and scope.** Two packages in a fixed order: `packages/services` then `packages/write-for`
  (the writer depends on the helper). Publish only packages that do not exist on npm at all, never a
  new version of an existing package; later versions come from CI with provenance.
- **Verification before publishing.** When at least one package is missing from npm, run
  `bun run check` before the first publish (it builds `dist/`, which is git-ignored and which
  `npm publish` would otherwise silently omit). Re-runs with nothing to publish skip it.
- **Actions setting.** Enable "Allow GitHub Actions to create and approve pull requests" with `gh api`
  when it is off, leaving the default workflow permissions at `read`.

This phase adds only the script. Nothing else references it until phase 2 links it from
`docs/releasing.md`, so `bun run check` stays green.

## Decisions Considered and Rejected

_Carried from the contract; consult before making gap decisions._

- **The bootstrap handles its own prerequisites: it passes --registry=https://registry.npmjs.org/ on
  every npm call, runs npm login when not logged in, and always runs npm trust through a pinned npx
  npm@11.15+** — rejected: nicknisi's preflight, which exits with instructions, or a version-compare
  branch that uses the local npm when new enough. Fewest manual steps: the local npm is 11.11.0 and
  points at a corporate registry proxy, and a bash version comparison would be an untested branch
  with no current user.
- **Go-live order: the implementation PR carries a patch changeset for both packages, the bootstrap
  runs from that branch before merge, merging opens the version PR, and merging that publishes 0.1.1
  from CI** — rejected: merge first and bootstrap afterward (the first release run fails to open the
  version PR and must be re-run), or an empty changeset (go-live waits for another real change).
  Fewest manual steps, which is the user's criterion.
- **nicknisi's choices win by default; deviate only where this repo forces it or the user explicitly
  chooses otherwise** — rejected: bespoke hardening beyond nicknisi's setup. The user's stated
  priority: his system is tested at scale, these extensions are primarily for the user, and
  maintenance must stay painless.
- **Remove the RELEASE_ENABLED gate and the npm-publish environment** — rejected: keep them as an
  activation guard. nicknisi has neither, and running the bootstrap before merge leaves the first
  release run nothing to fail on. (The trusted publisher is therefore attached without an
  environment.)
- **Replace the unactivated Release Please pipeline with nicknisi's Changesets plus npm trusted
  publishing model** — rejected: activate the existing Release Please pipeline (create the GitHub
  App, set RELEASE_ENABLED). It would keep about 2,300 lines of release code and a GitHub App to
  maintain for guards a solo-maintainer, primarily personal repo does not need.
- **Keep publishing to npm** — rejected: git-only installs with no npm publishing. The user wants npm
  distribution.
- **The contract ends at a maintainer go-live gate** — rejected: stop at the merged pipeline PR. Only
  a real release proves the pipeline works, and GitHub Actions has never run on this repository.
- **Make bun.lock registry-neutral and keep it that way with a root postinstall hook** — rejected:
  keep the proxy URLs, give CI a proxy credential, or pin this repo's registry to npmjs (bypasses the
  machine's managed firewall). The same rule applies here: the script scopes the public registry to
  its own npm calls with flags and never changes machine-level registry configuration.

## Feedback Strategy

**Inner-loop command**:
`shellcheck scripts/setup-trusted-publishing.sh && bash "$PLAYGROUND/run.sh"`

**Playground**: a stubbed-PATH script harness in a scratch directory outside the repository (for
example `$(mktemp -d)/bootstrap-playground`, exported as `$PLAYGROUND`), never committed. It puts
fake `npm`, `npx`, `curl`, `gh`, and `bun` executables first on `PATH`, keeps simulated registry and
repository state as marker files, logs every invocation with its arguments, and runs the real script
against them.

**Why this approach**: the script's value is its decision logic (what it skips, what it calls, with
which flags, in which order), and the real side effects (npm publish, npm trust, repo settings)
cannot be exercised without the maintainer's credentials; a call-log harness verifies that logic in
under two seconds.

## File Changes

### New Files

| File Path                            | Purpose                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `scripts/setup-trusted-publishing.sh` | One-time, idempotent npm first-publish + trusted-publisher + Actions-setting bootstrap. |

Make the script executable (`chmod +x scripts/setup-trusted-publishing.sh`) so git records mode
`100755`.

### Modified Files

None.

### Deleted Files

None.

## Implementation Details

### Bootstrap script

**Pattern to follow**: nicknisi's script (excerpt below, from
`nicknisi/pi-extensions@20391a18b2c87bb0510ea1f0cd1ac0b33192f0c1:scripts/setup-trusted-publishing.sh`).
Keep its replica-lag handling and its skip-if-already-trusted structure; drop its pnpm-specific
publish and its "shared first" loop in favor of the fixed two-package list.

```bash
# nicknisi excerpt (reference only)
REGISTRY="https://registry.npmjs.org"
REPO="nicknisi/pi-extensions"
WORKFLOW="release.yml"
npm whoami --registry="$REGISTRY" >/dev/null 2>&1 || { echo "not logged in: run  npm login --registry=$REGISTRY" >&2; exit 1; }
# publish phase: curl -sf "$REGISTRY/<name with / encoded as %2f>/$version" decides whether to publish;
# a failed publish is treated as success if the version shows up afterwards (read-replica lag).
# trust phase: skip when `npm trust list <pkg>` output mentions the workflow; otherwise
# `npm trust github "$name" --file "$WORKFLOW" --repo "$REPO" --allow-publish --yes`,
# treating E409/409 Conflict as "already configured".
```

**Overview**: a flat bash script run from anywhere inside the repository. It resolves the repository
root, checks prerequisites, then walks four steps (login, publish missing packages, attach trust,
enable the Actions setting) and prints one line per decision plus a final summary.

Target structure:

```bash
#!/usr/bin/env bash
# One-time setup for npm trusted publishing (see docs/releasing.md).
# Publishes packages that do not exist on npm yet, attaches the release.yml trusted
# publisher to each package, and lets GitHub Actions create pull requests. Safe to re-run.
set -euo pipefail

REGISTRY="https://registry.npmjs.org/"
REPO="birdcar/pi-extensions"
WORKFLOW="release.yml"
NPM_TRUST=(npx --yes npm@11.20.0 trust)
PACKAGES=(packages/services packages/write-for)

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Prerequisites: node, npm, npx, bun, gh, curl on PATH; `gh auth status` succeeds.
# Login: npm whoami --registry="$REGISTRY" || npm login --registry="$REGISTRY"; then whoami again
#        and print the npm username it reports.
# Missing packages: for each dir in PACKAGES, name=$(node -p "require('./$dir/package.json').name");
#        curl -sf -o /dev/null "${REGISTRY}${name/\//%2f}" (package document, not a version).
# Publish: if any package is missing -> bun run check once, then for each missing package in PACKAGES
#        order: (cd "$dir" && npm publish --access public --registry="$REGISTRY"); on failure re-check
#        existence (replica lag) and only exit non-zero when it is still missing.
# Trust:  for each package: out=$("${NPM_TRUST[@]}" list "$name" --registry="$REGISTRY") ; if it
#        mentions both "$REPO" and "$WORKFLOW" -> skip; else
#        "${NPM_TRUST[@]}" github "$name" --file "$WORKFLOW" --repo "$REPO" --allow-publish --yes \
#          --registry="$REGISTRY"  (E409 / "409 Conflict" in the output counts as already configured).
# Actions: gh api "repos/$REPO/actions/permissions/workflow" --jq .can_approve_pull_request_reviews;
#        when not "true": gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
#          -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
# Summary: published=<names|none>; trusted=<names|none>; actions-prs=<enabled|already enabled>.
```

**Key decisions**:

- Existence is checked against the package document (`https://registry.npmjs.org/@birdcar%2fpi-services`),
  not a version URL: the script must never publish a second version from a laptop, because that
  version would carry no provenance (the contract's goal 1).
- `npm trust list` failing (non-zero exit, for example an auth challenge that did not complete) is
  not treated as "not configured". Print its output, then ask on `/dev/tty`:
  `Could not read trusted publishers for <name>. Create one anyway? [y/N]`, and exit 1 on anything
  but `y`. npm now allows several trusted-publisher configurations per package, so creating blindly
  could add duplicates; the prompt only appears in the failure path.
- Tell the maintainer, before the first npm 2FA prompt, that choosing npm's "skip for 5 minutes"
  option lets the remaining trust calls run without further prompts (nicknisi's note).
- No `--provenance` on the local publish: provenance only exists for CI publishes.
- Use `node -p` (not `jq`) to read package names; node is already a prerequisite of the repo.
- Keep all output on stdout except errors (stderr); every decision line starts with `==`, every
  failure line with `!!`, matching nicknisi's convention.

**Implementation steps**:

1. Build the playground first (see Feedback loop below), with the fresh-state experiment expected to
   fail because the script does not exist.
2. Write the script skeleton: constants, root resolution, prerequisite checks, the login step.
3. Add the missing-package detection and the publish step, including the `bun run check` gate and the
   replica-lag re-check.
4. Add the trust step with the list-then-create logic, the 409 handling, and the `/dev/tty` prompt
   for an unreadable list.
5. Add the Actions-setting step and the summary line.
6. Run `shellcheck`, then every playground experiment, until all pass.

**Feedback loop**:

- **Playground**: `$PLAYGROUND/bin/{npm,npx,curl,gh,bun}` are small bash stubs. Each appends
  `"<tool> $*"` (plus `cwd=$PWD` for `npm publish`) to `$PLAYGROUND/calls.log` and reads state from
  `$PLAYGROUND/state/`: `logged-in`, `published-<pkg>`, `trusted-<pkg>`, `actions-prs-on`, and
  failure switches such as `fail-check`, `fail-trust-list`, `publish-fails-but-appears`,
  `publish-fails`. Successful `npm publish`, `npx … trust github`, and `gh api -X PUT` calls create the
  matching marker. `curl` exits 22 (as `curl -f` does on a 404) when `published-<pkg>` is absent.
  `npx … trust list <pkg>` prints `birdcar/pi-extensions release.yml` only when `trusted-<pkg>`
  exists. `$PLAYGROUND/run.sh` resets state per experiment, runs
  `PATH="$PLAYGROUND/bin:$PATH" bash scripts/setup-trusted-publishing.sh` from the repo root with
  stdin from `/dev/null` (and a stubbed answer for the prompt case), then asserts on `calls.log`,
  printing `PASS`/`FAIL` per experiment and exiting non-zero on any `FAIL`.
- **Experiment**:
  1. Fresh state (not logged in, nothing published, nothing trusted, setting off): the log shows
     `npm login`, one `bun run check`, `npm publish` for services before write-for (with `cwd` in
     each package directory), `trust list` then `trust github` for both, then the PUT; the script
     exits 0.
  2. Re-run on experiment 1's end state: no `npm login`, `bun run check`, `npm publish`,
     `trust github`, or PUT calls; exit 0.
  3. Partial state (services published and trusted, write-for neither): publishes and trusts only
     write-for; exactly one `bun run check`.
  4. `fail-check` with a missing package: exits non-zero with no `npm publish` call.
  5. `publish-fails-but-appears`: continues and exits 0; `publish-fails`: exits non-zero.
  6. `fail-trust-list` with answer `n`: exits 1 with no `trust github` call; with answer `y`: calls
     `trust github` and exits 0.
  7. In every experiment, every `npm …` and `npx …` line in the log contains
     `--registry=https://registry.npmjs.org/`, and no call writes to `~/.npmrc` or runs
     `npm config set`.
- **Check command**: `bash "$PLAYGROUND/run.sh"`

## Testing Requirements

### Unit Tests

No committed tests. nicknisi's script has none, the script only runs by hand, and its logic is
covered during implementation by the throwaway playground above. The contract checks it with
`shellcheck` (criterion 8) and with the maintainer's real run and re-run at the go-live gate
(criterion 12).

**Key test cases** (playground only):

- Fresh run publishes both packages in order, attaches trust to both, and enables the setting.
- Re-run changes nothing.
- Partial state touches only what is missing.
- A failed `bun run check` blocks every publish.
- Replica lag after a publish does not fail the run.
- An unreadable trust list never creates a trust entry without explicit confirmation.
- Every npm call targets the public registry explicitly.

### Integration Tests

None in this phase; the real integration is the go-live gate.

### Manual Testing

- [ ] Deferred to the go-live gate: the maintainer runs `scripts/setup-trusted-publishing.sh` from the
      implementation branch, then re-runs it once after go-live and compares registry state (see the
      contract's criterion 12).

## Error Handling

| Error Scenario                                    | Handling Strategy                                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Not inside the repository                         | `git rev-parse --show-toplevel` fails under `set -e`; print `!! run this from inside birdcar/pi-extensions`.    |
| Missing tool (node, npm, npx, bun, gh, curl)      | Check with `command -v` up front; print `!! <tool> is required` and exit 1 before any side effect.              |
| `gh` not authenticated                            | `gh auth status` fails → print `!! run gh auth login first` and exit 1.                                         |
| npm login cancelled or failing                    | The second `npm whoami --registry=…` fails → print `!! npm login did not complete` and exit 1.                  |
| `bun run check` fails                             | Exit non-zero before any publish; the check's own output explains the failure.                                  |
| `npm publish` fails (2FA declined, network)       | Re-check the package document; if still absent, print `!! publish of <name> failed` and exit 1.                 |
| `npm trust github` returns 409 / E409             | Print `== <name> already has a trusted publisher (409); verify it names birdcar/pi-extensions release.yml` and continue. |
| `npm trust github` fails otherwise                | Print its output with `!! trust failed for <name>` and exit 1.                                                  |
| `gh api -X PUT` fails (not an admin, network)     | Print `!! could not enable Actions pull-request creation` with the API error and exit 1.                        |

## Failure Modes

| Component       | Failure Mode                              | Trigger                                                                 | Impact                                                              | Mitigation                                                                                       |
| --------------- | ----------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Publish step    | Proxy-bound publish                       | An npm call without `--registry=https://registry.npmjs.org/`             | Publish or view hits the corporate proxy and fails auth or misleads | Flag on every call; playground experiment 7 asserts it.                                          |
| Publish step    | Empty tarball shipped                     | `dist/` missing because the build never ran                             | A 0.1.0 with no runtime code, immutable on npm                      | `bun run check` (which builds) runs before the first publish; it cannot be skipped when publishing. |
| Publish step    | Second laptop version                     | Existence checked per version instead of per package                    | A later version published without provenance                        | Check the package document URL only.                                                             |
| Publish step    | Replica lag                               | The registry read replica 404s right after a successful publish          | Script reports a false failure or republishes                       | Re-check after a failed publish (nicknisi's pattern); the second publish attempt would 403 anyway. |
| Trust step      | Duplicate trusted publisher               | `trust list` silently fails, then `trust github` creates another entry    | Extra trust configs to clean up in the npm UI                       | Non-zero `trust list` triggers the explicit y/N prompt instead of creating.                       |
| Trust step      | Staged-only publisher                     | `--allow-publish` omitted (publishers created after 2026-09-03 default to staged publish only) | CI publishes fail with a permission error                            | Always pass `--allow-publish`.                                                                   |
| Trust step      | Wrong workflow filename                   | `--file` not exactly `release.yml`                                      | OIDC exchange fails at publish time                                 | Constant `WORKFLOW="release.yml"`, matching `.github/workflows/release.yml`.                     |
| Actions step    | Setting stays off                         | The PUT is skipped or fails silently                                    | changesets/action cannot open the version PR after merge             | GET first, PUT when not `true`, fail loudly on API errors; criterion 11 re-checks after go-live. |
| Whole script    | Machine registry altered                  | Someone "fixes" registry errors by editing `~/.npmrc` or `npm config set` | Disables the managed supply-chain firewall, may violate policy      | Never touch registry config; scope with flags only; playground experiment 7 asserts no config writes. |

## Validation Commands

```bash
# Static analysis
shellcheck scripts/setup-trusted-publishing.sh
bash -n scripts/setup-trusted-publishing.sh

# Playground (throwaway harness, outside the repo)
bash "$PLAYGROUND/run.sh"

# Repository checks stay green (the script is not referenced yet)
bun run lint
bun run check:docs
```

## Rollout Considerations

- **Feature flag**: none; the script only runs when the maintainer invokes it.
- **Monitoring**: none; its output is the record.
- **Alerting**: none.
- **Rollback plan**: the script's side effects are account settings. A trusted publisher can be
  revoked with `npm trust revoke` or in the npm UI; the Actions setting can be switched off in
  repository settings. A published 0.1.0 cannot be unpublished after 72 hours, so the
  `bun run check` gate before publishing is the real safeguard.
- **Commits**: conventional commit (`chore(release): …`); no Co-Authored-By trailer.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
