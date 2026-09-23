# Ideation Learnings

Generalizable spec-gap and interview patterns captured from completed
ideation projects. Intake reads this file so recurring gaps inform future
questioning and spec generation. Each entry is dated and cites its
evidence; treat entries as hints, never as a substitute for gate evidence.

## 2026-09-23 — Changesets Release Pipeline

- **Pattern**: Specs executed by the autopilot engine must never instruct `git rm` or `git add`; the
  engine's reviewer reads `git diff HEAD` of unstaged work, so builders delete with plain `rm` (and
  `git add -N` new files) while the commit stage stages every path by name.
  **Evidence**: Phase 2 note "Release Please removal — deletions left unstaged": the spec said to
  `git rm` seven files, which would have staged them and hidden them from the review diff.
  **Spec/interview implication**: Phrase deletions in specs as "delete these files" and list them in
  the Deleted Files table; never prescribe staging commands.

- **Pattern**: The Changesets gate (`changeset status --since=origin/main`) counts any file under a
  package directory, including READMEs and tests, as a package change.
  **Evidence**: Phase 2 note "docs/releasing.md — bootstrap and gate wording checked against real
  behavior": the spec claimed docs-only package edits would pass the gate; they fail without a
  changeset.
  **Spec/interview implication**: Any spec whose File Changes touch `packages/*` must also list a
  `.changeset/*.md` file (a real bump, or `bun changeset --empty` for edits that shouldn't release).

- **Pattern**: When a spec deletes a module, fields, parameters, and return values that only that
  module consumed become dead code elsewhere, and "leave generic code untouched" then collides with
  the maintainer's delete-unused-code rule.
  **Evidence**: Phase 2 note "Out-of-scope leftovers flagged, not changed": after `scripts/publish.ts`
  was deleted, `scripts/check-package.ts`'s `rootDir` option and returned `integrity` and
  `repositoryUrl` had no readers.
  **Spec/interview implication**: Before finalizing a deletion spec, grep for what the deleted module
  read from other files and add those now-dead members to Modified Files.
