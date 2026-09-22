# Implementation Spec: Pi Write For — Phase 3

**Contract**: ./contract.md

**Prerequisite**: Headless writing and composition entrypoints (phase 2).

**Scope**: Full, including native text-based PDF and DOCX ingestion.

**Estimated Effort**: L

## Technical Approach

Implement hybrid voice learning, not a self-contained agent framework. `/train-voice` and
`/retrain-voice` start an explicit main-session conversation that discovers usable sources and asks
focused questions. The host agent can use whatever local/MCP/CLI tools the user actually has.
Writer-local tools backed by Pi's built-in UI approve sample admission and profile changes. Separate
registry-backed calls distill admitted samples using the configured model for the target scope.

Make local-folder training a complete built-in path: UTF-8 text/Markdown, text-based PDF and DOCX.
No MCP server, `gh`, LibreOffice, Python, Pandoc, or external conversion command is required for
that path. Native extraction is text-only, not document rendering or OCR. Unknown connectors remain
host-agent capabilities, not a hardcoded provider catalog.

Keep raw samples in a session-lifetime in-memory working set where practical. Persist only
user-approved profile prose, illustrative excerpts, and source references. If extraction/collection
needs temporary files, track only files owned by this extension and remove them on normal
success/failure/cancel/shutdown. Do not delete user originals or claim that Pi transcripts,
host-tool exports, provider retention, or forced process termination have the same cleanup
guarantee.

## Decisions Considered and Rejected

- **Required training and retraining** — rejected treating external pre-training as a prerequisite
  for a usable product.
- **Hybrid execution** — rejected doing all distillation with the active host model or building a
  separate wizard unable to reuse arbitrary host tools.
- **Adaptive source interview** — rejected a fixed Claude/MCP/CLI connector catalog and automatic
  tool installation.
- **Native PDF/DOCX in Full** — rejected relying solely on host conversions for rich documents.
- **No OCR** — rejected scanned-PDF recognition, legacy `.doc`, rendering, and additional office
  parsers in this release.
- **No raw corpus retention** — rejected keeping duplicate sample archives; approved excerpts and
  references remain permitted.
- **Reviewed incremental updates** — rejected silent profile saves, append-only accumulation of
  contradictory rules, or overwriting manual preferences during retraining.
- **Configuration-owned models** — rejected analysis-generated model frontmatter and main-session
  model switching.
- **Concrete local interaction code** — rejected a reusable interview framework; build only the
  tools/functions this learning flow needs.
- **Structured errors in headless drafting** — rejected unexpectedly interviewing callers when
  profiles are missing.
- **New paths and manual migration** — do not look for old bat-kol paths during training or
  retraining.
- **Human voice review remains required** — fixture-driven tests cannot establish that learned prose
  sounds like the user.

## Feedback Strategy

**Inner-loop command**:
`bun run --filter '@birdcar/pi-write-for' build && bun test packages/write-for/test/sources.test.ts packages/write-for/test/documents.test.ts packages/write-for/test/training-flow.test.ts packages/write-for/test/training-model.test.ts packages/write-for/test/training-store.test.ts packages/write-for/test/retention.test.ts`

**Playground**: Small native source fixtures, recorded host conversation/tool/UI interactions,
deterministic model responses, and temporary config roots. Build the worker's emitted JavaScript
before native-parser tests.

**Why this approach**: Most risk is in approval, extraction, inheritance and lifetime boundaries.
These can be reproduced offline while one final real-model session verifies voice quality.

## File Changes

### New Files

| File Path                                        | Purpose                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `packages/write-for/src/training.ts`             | Concrete training state, scope selection, model distillation and orchestration |
| `packages/write-for/src/training-tools.ts`       | Writer-local interview, sample admission, proposal/review tools                |
| `packages/write-for/src/training-prompts.ts`     | Host interview guidance and isolated distillation instructions                 |
| `packages/write-for/src/training-store.ts`       | Read/snapshot/propose/approve/persist profile changes                          |
| `packages/write-for/src/sources.ts`              | Selected folder traversal, text decoding, corpus limits and diagnostics        |
| `packages/write-for/src/documents.ts`            | PDF/DOCX extraction facade and cancellation                                    |
| `packages/write-for/src/document-worker.ts`      | Single-purpose Node worker for bounded/cancellable native document extraction  |
| `packages/write-for/test/sources.test.ts`        | Local selection, exclusions, author/source metadata and limits                 |
| `packages/write-for/test/documents.test.ts`      | Real PDF/DOCX fixture extraction and failure diagnostics                       |
| `packages/write-for/test/training-flow.test.ts`  | Registered commands and host-tool/UI orchestration                             |
| `packages/write-for/test/training-model.test.ts` | Configured target models, bootstrap and output validation                      |
| `packages/write-for/test/training-store.test.ts` | Approval, edits, conflicts, stale proposals and writes                         |
| `packages/write-for/test/retention.test.ts`      | In-memory/temp cleanup and original-file preservation                          |
| `packages/write-for/test/fixtures/voice.txt`     | Synthetic author sample, no personal data                                      |
| `packages/write-for/test/fixtures/voice.md`      | Markdown source with known paragraphs                                          |
| `packages/write-for/test/fixtures/voice.pdf`     | Small text-bearing multi-page PDF with known text                              |
| `packages/write-for/test/fixtures/voice.docx`    | Small DOCX with split runs/paragraphs and known text                           |
| `packages/write-for/test/fixtures/textless.pdf`  | Valid PDF with no extractable writing                                          |
| `packages/write-for/test/fixtures/encrypted.pdf` | Synthetic password-protected PDF for explicit failure diagnostics              |

Corrupt inputs can be generated directly in tests; do not add a large fixture corpus or downloads to
the test suite.

### Modified Files

| File Path                            | Changes                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `packages/write-for/src/index.ts`    | Register training commands/tools and session cleanup                                                 |
| `packages/write-for/src/commands.ts` | Add /train-voice and /retrain-voice parsing and kickoff                                              |
| `packages/write-for/src/model.ts`    | Reuse/refine text runner for bounded training prompts without coupling it to draft-profile readiness |
| `packages/write-for/src/errors.ts`   | Source, training, UI and proposal error mappings                                                     |
| `packages/write-for/package.json`    | Native parsers, any required schema dependency, compiled worker/resource allowlist                   |
| `packages/write-for/README.md`       | Training flows, formats, approval, limits, retention and no-OCR behavior                             |
| `package.json`                       | Pin new runtime/test dependencies centrally                                                          |
| `bun.lock`                           | Bun-generated dependency synchronization                                                             |

### Deleted Files

None. Source documents and existing user profiles are never test fixtures to overwrite.

## Implementation Details

### 1. Entry and concrete state

**Patterns to follow**: `packages/write-for/src/commands.ts`, `packages/write-for/src/model.ts`,
installed Pi `docs/extensions.md` command/UI/tool APIs. bat-kol's old train/retrain commands are
prior art, not files a runtime must import.

Support `/train-voice` and `/retrain-voice` with `--style`, `--register <name>`, `--channel <name>`,
or `--all`. Without a scope, ask. Accept an optional source folder through a documented flag or the
interview; specifying it authorizes presenting the source plan, not bypassing sample/destination
review. Default save target is global. An explicit project target selects the trusted project's new
config root and is shown before saving. Respect a valid explicit `PI_WRITE_FOR_CONFIG` root as the
chosen target and display it; never secretly write to a different directory.

If no active UI is available, fail `NO_UI` with actionable guidance. This phase does not add
unattended profile training. Guard TUI-only APIs with `ctx.mode`; built-in
input/select/editor/confirm methods can also work through Pi RPC when `ctx.hasUI` is true.

Keep one active training session per Pi session. A second training command asks whether to
replace/cancel the first rather than blending source sets. Ordinary drafting can continue
independently. Session state needs only scope/targets, collected answers, approved source
descriptors and admitted samples, pending proposals, cancellation ownership and temporary paths. Do
not introduce a persistent job store or resume framework. Persist no raw working set in
`pi.appendEntry`.

Kick off host conversation guidance with the documented Pi user-message API. Do not replace the
whole system prompt or force the host model to the writing model. Explain the available writer-local
tools, the already supplied scope/path, the interview questions still needed, and the prohibition on
bypassing review with generic filesystem tools. This is a cooperative workflow, not a sandbox
against arbitrary installed extensions.

### 2. Interview and host capability use

The interview establishes:

- Which style/register/channel is being trained or refreshed.
- Whose writing the source contains, how to identify it in mixed material, and which
  quotations/other authors to exclude.
- Relevant audience, tone and register differences rather than blending all files into one generic
  voice.
- Which local paths, host tools or CLIs the user wants used and what data range is permitted.
- Save destination and any existing manual rules that must remain authoritative.

Use `pi.getAllTools()`/`getActiveTools()` metadata to inform the host agent. These APIs do not
provide a general callable implementation registry. The main agent invokes its existing tools; do
not build a mechanism to execute arbitrary tool descriptors inside the writer. Do not activate
tools, probe credentials, scan unrelated folders, or install dependencies simply because a tool name
resembles a connector. Availability and authorization are different.

For CLI sources, let the host check only a relevant proposed command and ask before collection. No
connector is mandatory and no hardcoded names determine whether training can continue. If a source
cannot be accessed, offer local files, pasted samples, or a manual export. Provider-native source
auth remains with the host tool, not the writer.

Implement a few concrete local tools/functions, not a shared UI framework. A suitable small surface
is:

- `write_for_interview`: ask one structured question using built-in Pi UI and return/store the
  answer.
- `write_for_samples`: present a proposed local/text source set, obtain approval, ingest native
  formats or admit supplied host-collected text, and return sample IDs plus diagnostics rather than
  repeating the full corpus into tool output.
- `write_for_profile`: propose/distill, review/save, or cancel the active learning session. The save
  path always invokes built-in approval; an LLM-provided `approved: true` is never accepted.

Keep parameters plain and provider-compatible. If using TypeBox, declare/pin it directly rather than
relying on a transitive installation (the current Pi version uses `typebox` 1.3.27). Use JSON string
enums rather than unsupported literal-union schemas. Validate action-specific parameters after
schema validation. Tools return `TRAINING_NOT_ACTIVE` outside explicit training mode. Do not add
these actions to the public headless writing service contract.

Tool results can include nested model usage where supported by Pi. Do not copy credentials or full
raw corpora to result details or logs. Bound progress output and expose clear cancellation.

**Feedback loop**:

- Playground: invoke actual registered training handlers/tools against a fake Pi host and scripted
  UI responses.
- Experiment: no connector, arbitrary fixture tool name, declined source, mixed authors, missing
  capability, no UI, second training session, cancellation and session replacement.
- Check: `bun test packages/write-for/test/training-flow.test.ts`.

### 3. Source admission and local folder path

Native formats are `.txt`, `.md`/`.markdown`, `.pdf`, and `.docx`. Legacy `.doc`, spreadsheets,
images, audio/video, and textless/scanned PDFs are unsupported natively. The host may supply a
user-approved converted text export; that is not native support.

For a selected folder, enumerate deterministically, show candidate counts/types and exclusions, and
request approval before reading sample contents. Default-exclude `.git`, dependency/build
directories and hidden configuration; do not recursively follow symlinks outside the explicitly
selected root. A separately selected external path needs separate approval. Enforce realpath
containment and do not treat file contents or embedded links as instructions to expand the source
set.

Use simple named limits, not a general ingestion configuration subsystem. Start with at most 50
admitted files, 20 MiB per source file, 50 MiB total source bytes, and 200,000 extracted characters
across the working corpus. These are safety ceilings, not targets. Reject/report exceeded limits and
ask for a smaller selection; never silently drop files or truncate samples while claiming to have
analyzed everything. The actual model context check can require a smaller admitted subset later.
Decode text with strict UTF-8 handling and reject binary/null-containing data masquerading as text.

Represent an admitted sample with a generated ID, logical source reference, approved author/register
association, extracted text, and warnings. Retain source text only in the active in-memory training
set. Host-collected text goes through the same admission/selection review; a source label alone is
not a waiver of consent. The model receives only admitted sample IDs/text relevant to its training
scope.

Per-file errors must be visible and skippable after user review. If all files fail or no usable
author writing remains, fail rather than saving a trained profile. Report
unsupported/corrupt/encrypted/textless files separately so users can supply an appropriate export.

**Feedback loop**:

- Playground: temporary folders and the small synthetic fixture corpus.
- Experiment: 0/1/many samples, mixed types/authors, nested exclusions, symlink escape, invalid
  UTF-8, rejected selection, exceeded count/bytes/characters and all-files-failed.
- Check: `bun test packages/write-for/test/sources.test.ts`.

### 4. Native PDF and DOCX extraction

Research during ideation found `unpdf` 1.8.1 (Node >=22) and `mammoth` 1.12.3 viable. Use these
exact root-pinned versions initially unless an implementation test exposes a concrete
incompatibility; document and test any replacement. The package's Node baseline is >=22.19.0. Do not
make Python, LibreOffice, `pdftotext`, or an OCR binary a production requirement.

Use `unpdf`'s bundled PDF.js text extraction on bytes, not URL input or page rendering. Preserve
useful paragraph/page boundaries. Disable evaluation and external document-resource loading; do not
fetch linked content or silently open files referenced by documents. Destroy parser resources in
`finally`.

Use `mammoth.extractRawText` with a buffer. Preserve paragraph separation and return parser
warnings. Do not convert to HTML, render hyperlinks, run macros, or enable external file access.
Text extraction is not layout-faithful conversion. Split XML runs must still produce the expected
sentence text; verify with a real DOCX fixture.

Run binary extraction in a small dedicated Node `worker_threads` worker so cancellation, normal
shutdown, and pathological documents can terminate extraction without hanging Pi. This is a
single-purpose worker, not a pool or job system. Load emitted `document-worker.js` through
`new URL(..., import.meta.url)`; production must not refer to source `.ts`. Use a per-file
extraction deadline (initially 15 seconds), a worker old-generation heap limit (initially 256 MiB),
and the source/text ceilings above. A worker heap limit is not an OS sandbox or a guarantee about
all native allocations. Transfer only an owned byte buffer covering the selected document, not the
unsliced backing buffer of a pooled Node Buffer. Parent cancellation terminates the worker, rejects
promptly, and removes listeners. A crashed worker returns a source diagnostic; it never yields a
successful empty sample.

Native parser tests build first and exercise emitted worker JavaScript. Do not mock parser output in
every test: assert actual known passages and paragraph boundaries from real PDF/DOCX fixtures. Add
mocked-worker cancellation/deadline tests for reliable fast failure-path coverage. Test fixture
preparation may use development-only tooling; fixture generation tools must not become runtime
dependencies.

**Feedback loop**:

- Playground: actual small binary fixtures and controllable worker failure tests.
- Experiment: expected text, split DOCX runs, multi-page PDF, textless PDF, damaged files,
  password-protected file diagnostics, worker exit, abort and size/deadline limits.
- Check:
  `bun run --filter '@birdcar/pi-write-for' build && bun test packages/write-for/test/documents.test.ts`.

### 5. Configured-model distillation

Reuse phase 2's model lookup/text runner and phase 1's permissive layer loader, not the draft
engine's requirement that a register already exist. Model selection uses the current Pi cwd's
resolved configuration; the separately reviewed save destination does not bypass project model
choices. Resolve model metadata for the target style/register/channel scope before each generation:

- Style: applicable global/local style metadata, then active model only if no override exists.
- Register: style plus selected-register metadata, respecting global-before-local scope ordering.
- Channel: style, its approved default/selected register, and selected-channel metadata in the
  established order.
- Full training: generate explicit scoped proposals rather than invent one model for the whole
  corpus; each target uses its applicable existing metadata. New files without model overrides
  inherit established lower layers/active model.

Do not use unapproved proposed frontmatter to select the next generation's provider. Explicit
invalid/unavailable model selections fail. Snapshot active fallback/model metadata for each call and
report actual model/usage in the proposal's transient details.

The isolated model receives interview answers, existing target prose for retraining, applicable
style guidance, and admitted sample text. It has no tools. Ask it to distinguish evidence from
inferred patterns, preserve facts, produce concrete voice rules/examples and source references, and
avoid imposing an arbitrary 150–300-line target. It must not emit credentials, executable connector
commands, or execution metadata.

Bound each prompt against the selected model's context capacity, reserving output room and using a
conservative estimate. If the admitted corpus is too large, return an actionable selection error and
ask the user to narrow samples. Do not introduce a multi-agent summarization pipeline or silently
truncate evidence. The context estimate is not an exact tokenizer guarantee; model context-limit
failures must remain explicit.

Request a strictly validated data envelope of proposed bodies keyed by the already approved logical
profile targets, or an equivalently constrained single-target body. Do not execute arbitrary paths
or accept additional targets from model output. Strip/reject attempts to inject frontmatter;
generation owns prose, while code preserves existing execution metadata. Unsupported model output
fails for revision/retry chosen by the user, not a hidden fallback model.

**Feedback loop**:

- Playground: captured registry requests and deterministic proposal responses.
- Experiment: new profile with active fallback, existing register/channel overrides, project style
  beating global channel, multi-scope models, model metadata injection, unapproved sample ID,
  oversized context and malformed output.
- Check: `bun test packages/write-for/test/training-model.test.ts`.

### 6. Reviewed persistence and retraining

Read and snapshot existing destinations before generating proposals. Capture original bytes/hash and
whether each destination existed. Targets are code-derived from approved scope/root/names, not
arbitrary model paths.

For retraining, include current profile contents and relevant source references. Ask only about
missing information or identified conflicts, not the entire original interview. Source references
are hints to propose recollection, not standing permission to rerun a tool or scrape an account.
Existing manual rules must not disappear silently; present edits/deletions as explicit conflicts for
the user to accept or reject. The model may propose revised prose, but approval is based on the
actual new body shown.

Review shows destination, additions/removals, inferred rules/examples and warnings. Use built-in
editor/confirmation APIs; no browser or standalone UI app is required. Let the user edit/reject
proposed bodies and then confirm exact final contents/destinations. Preserve existing `model` and
other execution frontmatter byte-for-byte where practical; write new channel `defaultRegister` only
from an explicit validated interview answer. Frontmatter changes remain a manual configuration
operation, not something the distillation response controls.

Before writing, compare all reviewed destination snapshots against disk. If a file changed while the
interview was running, reject `PROPOSAL_STALE` and require fresh review; do not overwrite the user's
edit. Save with per-file atomic temp-write/rename in the destination directory, using the
repository's file-mutation coordination API where appropriate. Re-check snapshots inside the
coordinated mutation window. Do not claim a cross-file transaction: if an I/O failure interrupts
several approved writes, report exactly which files were saved and which were not, clean temporary
files, and never report total success.

Write provenance and approved illustrative excerpts into the profile's Markdown `Sources`/examples
sections, not a raw `samples/` archive. Avoid reusing full source documents as examples. Return a
concise saved-path summary and clear pending failures. Never store provider credentials or
unreviewed source text.

**Feedback loop**:

- Playground: temporary config roots, scripted UI edits/declines and controllable write failures.
- Experiment: first save; model frontmatter preservation; retraining conflicts; reject all; edit
  body; stale file; non-existent target created externally; partially failed batch; explicit
  project/global targets.
- Check: `bun test packages/write-for/test/training-store.test.ts`.

### 7. Retention and lifecycle

Keep ownership explicit: original files belong to the user, host-created exports belong to the
host/user, and only extension-created temporary paths belong to this flow. Clean the latter and
release in-memory samples on success, cancellation, failure, replacement training session, and
normal `session_shutdown`. Dispose parser workers and abort configured-model calls before releasing
their state.

No requirement promises cleanup after SIGKILL, machine loss, or a host tool's independent retention.
Prefer not writing raw temporary data at all. If a normal-path cleanup fails, report the exact owned
path needing removal without dumping its contents. Do not use broad directory deletion on
user-supplied paths.

**Feedback loop**:

- Playground: filesystem snapshots and tracked fake temp ownership.
- Experiment: each normal terminal path, accepted excerpts persisted, raw sentinel absent from
  managed config/temp destinations, original files unchanged, cleanup failure reported, shutdown
  during worker/model activity.
- Check: `bun test packages/write-for/test/retention.test.ts`.

## Testing Requirements

| Test File                | Mandatory coverage                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `training-flow.test.ts`  | Actual command/tool registration, hybrid host reuse, consent and no-UI behavior          |
| `sources.test.ts`        | Complete local path without connectors, deterministic selection, exclusions/limits       |
| `documents.test.ts`      | Actual native extraction plus error/cancellation/worker paths                            |
| `training-model.test.ts` | Scope-aware configured model calls and strict proposed-body validation                   |
| `training-store.test.ts` | Exact-content approval, manual rules/frontmatter, stale checks and partial I/O reporting |
| `retention.test.ts`      | No raw archive and normal-path cleanup without deleting originals                        |

Use synthetic text rather than the user's private corpus in checked-in tests. Integration tests must
exercise the registered tool flow through approval into persistence, not only isolated helper
functions. A fixture arbitrary host tool should work without its name being in production code.

## Failure Modes

| Component    | Failure                             | Trigger                          | Impact                                 | Mitigation                                                           |
| ------------ | ----------------------------------- | -------------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| Interview    | Unapproved source enters model call | Host tool returns extra material | Unexpected data processing             | Explicit sample admission and target association                     |
| Extraction   | Main Pi process hangs               | Pathological PDF/DOCX            | Unresponsive training/session          | Bounded worker, termination, diagnostics                             |
| Ingestion    | Mixed authors distort voice         | Quotes/team documents            | Wrong learned profile                  | Author/exclusion interview and reviewed candidate samples            |
| Distillation | Wrong model on first setup          | No saved register yet            | Setup cannot run or changes host model | Metadata-only target resolution and active fallback only when absent |
| Distillation | Oversized prompt                    | Large selected folder            | Provider failure or hidden truncation  | Explicit corpus/context limits and reselection                       |
| Persistence  | Manual rules silently erased        | Retraining proposes replacement  | User loses deliberate preferences      | Visible conflicts/edits and exact-content approval                   |
| Persistence  | Stale proposal overwrites edit      | User modifies file mid-interview | Data loss                              | Snapshot comparison inside write coordination                        |
| Retention    | Raw files accidentally kept/deleted | Confused path ownership          | Privacy leak or source loss            | Track only extension-owned temps; no broad cleanup                   |

## Validation Commands

```sh
bun run build
bun test packages/write-for/test/sources.test.ts packages/write-for/test/documents.test.ts packages/write-for/test/training-flow.test.ts packages/write-for/test/training-model.test.ts packages/write-for/test/training-store.test.ts packages/write-for/test/retention.test.ts
bun run typecheck
bun run lint
bun run test:boundaries
bun run check:workspace
bun run check:package
bun run check:docs
bun run check
```

## Rollout Considerations

Do not train on the user's real samples during unattended implementation. The final phase contains
the deliberate live voice-review checklist. Keep native-parser dependencies packaged and test their
compiled worker resolution under Node in phase 4. Documentation must distinguish text extraction
from OCR, metadata-only overrides from body replacement, and writer-managed retention from
host/provider history.
