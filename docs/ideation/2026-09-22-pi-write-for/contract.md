# Pi Write For Contract

**Created**: 2026-09-22
**Readiness**: All 5 gates ready
**Status**: Approved
**Approval**: Express — single consolidated confirmation, no per-artifact review
**Supersedes**: None

## Problem Statement

The user has an existing bat-kol Claude plugin that resolves Markdown writing style, register, and channel rules, trains voice profiles, and drafts destination-specific messages. Pi extensions integrating applications need the same behavior without importing another extension's runtime or reimplementing its voice configuration and drafting workflow.

A reusable writer must work for unknown third-party consumers, return drafts without taking over their interaction or sending messages, and let callers supply request-specific writing rules. The user also needs project-, register-, and channel-specific model choices that do not alter the main Pi conversation's model.

Voice learning is part of the product, not a setup prerequisite delegated to Claude. Users may have different MCP integrations and CLI tools or only a folder of their own writing. Training must discover usable sources interactively, support local text/Markdown/PDF/DOCX without external conversion tools, and produce reviewable Markdown profiles. This contract plans a new package in the current monorepo; the original bat-kol repository is reference material, not a runtime dependency.

## Goals

1. Provide a side-effect-free public service contract that two independently authored fixture consumers can discover through pi-services and use for isolated drafting and rewriting without importing the provider entrypoint.
2. Resolve configuration and model selection deterministically across global and project scopes and style/register/channel layers, while applying caller writing rules at the highest prose priority and leaving the main session model unchanged.
3. Expose /write-for and, in the intended Full release, an explicit event request adapter that execute the same headless writing engine and return the same result and failure semantics.
4. Support training and retraining through a host-conversation interview and approved source collection followed by configured-model distillation and reviewed persistence; a local folder alone must be a complete training path, including text-based PDF and DOCX in Full scope.
5. Ship an installable portable Node/Pi package with automated config, engine, training, extraction, lifecycle, and artifact checks integrated into the repository's release and validation conventions, without requiring live application credentials or publishing during development.
6. Demonstrate learned voice with three held-out drafts across at least two registers that the user accepts for factual fidelity and voice without substantial tone rewriting.

## Success Criteria

- [ ] The contract subpath imports without initializing a provider, host, registry, or event bus; validates the flat async API; and permits third-party TypeScript consumers to use only the contract and pi-services. — check: `bun test packages/write-for/test/contract.test.ts` → Exits 0; positive consumer/type fixtures and negative malformed-contract cases pass, and contract import has no provider side effects.
- [ ] Configuration uses PI_WRITE_FOR_CONFIG or the nearest trusted project .pi/write-for directory with per-file XDG pi-write-for fallback; invalid explicit roots fail, old bat-kol paths are ignored, and unrelated ancestor configurations are not cumulatively merged. — check: `bun test packages/write-for/test/config.test.ts` → Exits 0 across explicit-root, nearest-project, global-only, missing-root, untrusted-project, and manual-migration fixtures.
- [ ] Metadata inherits field-by-field and metadata-only overrides retain inherited prose, while nonempty project prose replaces its corresponding global body; model precedence is active Pi model, global style/register/channel, then selected local style/register/channel, with only explicit values overriding. — check: `bun test packages/write-for/test/config.test.ts packages/write-for/test/model.test.ts` → Exits 0 for the complete precedence matrix, including a project style model beating a global channel model, a project channel beating its register, and legacy Markdown without frontmatter.
- [ ] Draft and rewrite requests compose anti-slop defaults below style/register/channel prose and injected writing rules, keep source material distinct from instructions, reject model/provider overrides in request execution fields, and return text plus resolved channel/register/model and usage metadata without writing config or invoking delivery. — check: `bun test packages/write-for/test/engine.test.ts` → Exits 0; captured model requests establish prompt precedence and data separation, controlled results establish return behavior, and write/delivery/session-model mutation spies remain untouched.
- [ ] Configured model lookup and authentication failures, missing required voice profiles, and invalid requests are explicit failures rather than silent fallbacks or interactive prompts; configured provider-neutral calls use the host registry and never pi.setModel. — check: `bun test packages/write-for/test/model.test.ts packages/write-for/test/engine.test.ts` → Exits 0; unavailable/unauthenticated selections, absent profiles, and invalid input fail predictably with no substitute model call and no UI interaction.
- [ ] Concurrent consumers have isolated source/rule/model state, cancellation settles the affected request, and provider shutdown cancels in-flight work and invalidates retained APIs without hanging promises or leaking listeners. — check: `bun test packages/write-for/test/service.test.ts` → Exits 0 with two independent consumers, overlapping requests, cancellation, shutdown, rediscovery, unavailable-provider, and stale-handle cases.
- [ ] The /write-for command handles explicit topics, source rewrites, register selection, and omitted-topic current Pi session-branch context (not Git/VCS inspection); built-in Slack/email/Bluesky/GitHub channel defaults and arbitrary custom channel rules reach the common engine. Service calls never implicitly copy the main session transcript. — check: `bun test packages/write-for/test/entrypoints.test.ts` → Exits 0; registered command handlers call the same engine with explicit context, an unknown fixture-app channel works with a trained register and supplied format rules, and headless requests receive no implicit session history.
- [ ] Full scope: a namespaced rewrite-request event delegates to the same service execution path, settles its request-local completion callback with a result or error, forwards cancellation, and never broadcasts draft content on a shared result channel. — check: `bun test packages/write-for/test/events.test.ts` → Exits 0 for successful and failed rewrites, malformed payloads, cancellation, shutdown cleanup, and independent concurrent request callbacks; service results do not depend on observational events.
- [ ] Training and retraining start only through explicit training entrypoints, guide source selection/author/register/exclusions using host interaction, and can use arbitrary available tool metadata without a hard dependency on a named MCP connector, CLI, or question-tool extension. — check: `bun test packages/write-for/test/training-flow.test.ts` → Exits 0 for local-only and unknown-host-tool fixtures, missing capabilities, user-declined collection, and no-UI mode; only approved sources enter distillation and headless drafting never starts an interview.
- [ ] Folder ingestion accepts selected UTF-8 text and Markdown samples with reproducible ordering, explicit exclusions and limits, and per-file diagnostics; Full scope adds actual text-based PDF and DOCX extraction without system conversion binaries, rendering, macros, or fetching document-linked resources. — check: `bun test packages/write-for/test/sources.test.ts packages/write-for/test/documents.test.ts` → Exits 0 using real small text/Markdown/PDF/DOCX fixtures with expected extracted passages; corrupt, encrypted, textless, unsupported, and excluded files are diagnosed, and an empty accepted corpus cannot be reported as successful training.
- [ ] Training distills bounded accepted samples through the configured model for the target scope, falling back to the active model only when no override exists; analysis is separated from host collection and cannot modify model frontmatter or the main session model. — check: `bun test packages/write-for/test/training-model.test.ts` → Exits 0 for first-time setup, style/register/channel scopes, multi-profile training, unavailable explicit selections, and generated attempts to change execution metadata.
- [ ] Training proposes Markdown profile changes and saves only after explicit review/approval of the exact destinations and contents; retraining starts from existing profiles, preserves manual preferences and model metadata, surfaces conflicts, and rejects stale proposals before overwriting changed files. — check: `bun test packages/write-for/test/training-store.test.ts` → Exits 0 for approve/edit/reject/cancel, global versus explicitly selected project destination, manual-rule preservation, model-frontmatter preservation, stale-file conflicts, and failed writes without false success reports.
- [ ] The writer persists only approved profiles, illustrative excerpts, and source references, not a raw training corpus; extension-owned temporary samples are removed on success, failure, cancellation, and normal session shutdown, and original user files are never deleted. — check: `bun test packages/write-for/test/retention.test.ts` → Exits 0 for all managed cleanup paths, with positive persisted-profile checks and filesystem assertions proving source originals remain unchanged and raw copies are not saved in config.
- [ ] The compiled extension loads in real Pi, supports service discovery independent of extension load order, and reestablishes service/command/tool state after reload and session replacement without retaining stale session context. — check: `bun run test:pi` → Exits 0 including new writer lifecycle cases against compiled package artifacts and existing services regression cases.
- [ ] Packed services and writer artifacts install together in a clean npm consumer; Node ESM and NodeNext TypeScript can consume the public contract and the extension manifest points to shipped JavaScript and training resources, including working native extraction dependencies in Full scope. — check: `bun run check:package` → Exits 0 for both packages; the clean consumer exercises the writer contract and document extraction under Node without Bun or globally installed converter tools.
- [ ] The monorepo's aggregate checks cover every new writer test plus existing boundaries, type checks, lint, docs, release routing, lockfile, publication, and lifecycle/artifact checks; adding the writer does not weaken the services helper's dependency rules. — check: `bun run check` → Exits 0; writer test files are explicitly included by the aggregate check and package/release tests cover both package identities with no live publication.
- [ ] After training from a user-approved local corpus, the user accepts three held-out drafts across at least two registers for preservation of supplied facts and recognizable voice without substantial tone rewriting. — judgment call: The user runs the installed training/drafting experience with a real configured model and samples they own, then reviews three new prompts not used as training examples. Each draft must preserve supplied facts and need no substantial voice/tone rewrite. The user records acceptance or specific failures; automated verification alone cannot certify this criterion.

## Scope Boundaries

### In Scope

- A new @birdcar/pi-write-for package with a side-effect-free ./contract export, guarded async draft/rewrite service using @birdcar/pi-services, and independent consumer fixtures. — Unknown third-party extensions must compose without depending on the provider runtime or registering application identities.
- Renamed Markdown configuration at .pi/write-for/, ${XDG_CONFIG_HOME:-~/.config}/pi-write-for/, or PI_WRITE_FOR_CONFIG; nearest-root selection, global per-file fallback, metadata-only inheritance, optional model frontmatter at style/register/channel scope, and manual migration only. — The user explicitly chose new names with manual migration and requires project/register/channel model control while retaining human-editable profiles.
- A single headless draft/rewrite engine with explicit source/context, request-scoped injected prose, model/usage provenance, request cancellation, lifecycle cleanup, and deterministic error semantics. Injected prose wins over user writing preferences but cannot change execution configuration. — Callers need returned drafts and failures, not UI takeover, configuration mutation, or a second model-selection authority.
- /write-for <channel> [topic], register selection and rewrite support; omitted topics use explicit current Pi session-branch text supplied by the command, preserving bat-kol's session-summary behavior without adding Git/VCS inspection. Include Slack/email/Bluesky/GitHub format defaults and arbitrary custom channels through saved Markdown or request format rules. Results are draft text, not delivery API payloads. — This preserves the interactive writing entrypoint while ensuring new application destinations do not require dedicated drafter implementations.
- Required /train-voice and /retrain-voice entrypoints supporting style, register, channel, and full-profile scopes. The host conversation interviews and collects approved samples using actual available tools; isolated registry-backed calls distill using resolved models. Concrete writer-local tools/functions backed by Pi's built-in UI provide the interview and review, avoiding both a mandatory third-party question tool and a reusable interaction framework. — The user says the system is incomplete without adaptive training/retraining and explicitly selected the hybrid execution flow.
- A complete local UTF-8 text/Markdown folder-training path, source/author/register/exclusion review, bounded ingestion with clear diagnostics, reviewed proposal persistence, retraining conflict handling, and no retained raw corpus. Default save target is global; project writes require explicit target selection and approval. — Users must be able to learn a voice without a connector, and source retention and destination changes must be deliberate.
- Portable NodeNext ESM packaging, compiled Pi entrypoint and any shipped training resources, root-pinned dependencies, offline behavioral fixtures, real Pi lifecycle checks, npm artifact-consumer tests, writer-aware release routing, and maintained package usage documentation. — The requested extension must be installable by ordinary Node/Pi consumers and fit the existing monorepo's independent-package validation and release model.
- The explicit human voice-quality acceptance checkpoint after implementation. — The user chose real-model voice review in addition to mechanical tests; passing CI alone is insufficient to declare the learned voice accepted.
- Namespaced event request ingress that delegates to the existing async writer path, with request-local result/error completion and cancellation rather than a second event RPC subsystem. — Required for the user's intended complete release, but separable from the directly callable service and command core.
- Built-in text-based PDF and DOCX extraction for local training, preserving useful paragraph/page boundaries and reporting corrupt/encrypted/textless inputs; use portable packaged JavaScript parsers with no mandatory system converters. — The user explicitly rejected text-only native ingestion and requires PDF/DOCX in the first complete release. This adds independently testable extraction and packaging work beyond the usable core.

### Out of Scope

- Automatic sending, application delivery connectors, and delivery-specific API payloads inside the writer. — Callers own presentation, revisions, approval, and delivery; this service returns draft text.
- Cross-process RPC or an external-application server. — pi-services is in-process discovery; an external bridge is a separate project.
- Legacy bat-kol path fallback or an automatic importer. — The user selected new names with manual migration.
- A fixed MCP/CLI connector catalog, bundled connector implementations, automatic installations, or background source monitoring. — Training discovers the user's actual tools on demand and must work from a local folder; a connector ecosystem is not required.
- OCR, scanned-document recognition, legacy .doc conversion, native parsers for additional office formats, document rendering, and layout-faithful conversion. — The user fixed native scope at UTF-8 text/Markdown, text-based PDF, and DOCX with no OCR; the task is extracting writing samples, not reproducing documents.
- Persisting raw training corpora or automatically changing profiles during ordinary drafting. — The user rejected retained raw copies; approved profiles/excerpts/source references are sufficient, and retraining is an explicit reviewed action.
- Caller-supplied model selection, model-routing heuristics, automatic fallback chains, or provider credentials/endpoint definitions in writing frontmatter. — Model execution is user-configuration-owned and references providers already configured in Pi. Explicit failures must not silently change execution.
- Reproducing Claude's channel-specific agent graph or building a general agent/tool execution framework. — One writing engine plus existing Pi host capabilities meet the stated composition and training goals.
- Mandatory production application integration, live npm publication, enabling hosted release automation, or a benchmark/evaluation platform. — The user accepted independent consumer fixtures, existing repository verification, and a bounded human voice review as the completion boundary.
- A guarantee that source samples never appear in Pi's own transcript, approved host-tool exports, or provider retention. — The no-raw-corpus promise concerns writer-managed persistence and normal cleanup; host sessions, external tools, and selected model providers retain their own data semantics.

### Future Considerations

- External application bridges and delivery integrations can independently consume the public writing contract.
- Additional document formats or OCR require a separate scope decision rather than silent tool installation.
- A larger held-out voice evaluation corpus can follow if the initial human review exposes quality issues that need systematic measurement.

## Decisions Considered and Rejected

- **Extract a headless writing service with /write-for as an interactive consumer; callers receive drafts and own their interaction.** — rejected: Have the writing extension take over every caller's interactive approval/revision flow or support two handoff modes immediately.. The user selected Return a draft; a UI-independent result is the required composition boundary.
- **Use the existing pi-services direct async API as the result-bearing interface and implement event ingress as a thin adapter.** — rejected: Build a separate event request/response execution system.. The existing discovery protocol already returns guarded APIs and normal promise results; duplicating execution semantics would create inconsistent failure and lifecycle behavior.
- **Keep source material separate from injected writing rules; conflicting injected prose wins for that request, with no persistence.** — rejected: Always prioritize saved user writing preferences over caller instructions, or mutate profiles to apply caller rules.. The user explicitly requires integrations to override existing writing preferences where conflicts exist.
- **Allow optional model frontmatter in style, register, and channel files, with scope-first precedence and channel over register over style within a scope.** — rejected: Limit selection to one project model or let a global channel preference defeat an explicit project-wide model.. The user requested register/channel overrides as well as project control; only explicit values override, and absent selections inherit the active Pi model.
- **Resolve model metadata independently from prose, retaining inherited body text for metadata-only overrides.** — rejected: Replace the global writing body with an empty body when a project only changes its model.. This deliberate extension of bat-kol's file-level fallback avoids copying voice rules merely to choose a model.
- **Configuration owns model selection, with explicit unavailable-model errors and request-local calls through the Pi registry.** — rejected: Let request parameters or injected prose select models, silently substitute models, or change the main session with pi.setModel.. The user selected Configuration wins; unknown integrations must respect the user's configured execution choices.
- **Use write-for-specific configuration names with manual profile migration.** — rejected: Reuse .bat-kol/XDG bat-kol/BAT_KOL_CONFIG or provide a one-time importer.. The user explicitly selected New names, manual migration during ideation.
- **Use hybrid training: main-session interview and approved source collection, then isolated configured-model distillation and reviewed saves.** — rejected: Perform all analysis with the main session model or build a self-contained wizard that cannot naturally reuse arbitrary host tools.. The user selected Hybrid training; Pi tool metadata is discoverable but isolated model calls do not automatically inherit installed tool execution.
- **Make training and retraining required, capability-aware features with a complete local-folder path.** — rejected: Depend on Claude connectors, a fixed scraper list, or pre-trained profiles created elsewhere.. The user stated that training/retraining are necessary for the system to work and that source acquisition belongs in the interview.
- **Persist approved profiles, illustrative excerpts, and provenance references only; clean writer-owned temporary samples during normal completion and teardown.** — rejected: Retain a second raw sample corpus or promise that Pi/provider history has no sample data.. The user selected No raw copies with the explicit caveat that Pi's own history remains governed by Pi.
- **Treat anti-slop guidance as the lowest-priority writing defaults.** — rejected: Preserve bat-kol's non-overridable word/pattern bans or remove all built-in style guidance.. The user selected Overridable defaults so learned voice and caller requirements can win without affecting execution controls.
- **Provide built-in PDF and DOCX extraction in the intended Full release, in addition to native text/Markdown.** — rejected: Require host tools or manual conversion for every rich document.. The user chose Built-in document parsing when asked what belongs in the first release.
- **Extract text from text-based PDFs and DOCX without OCR or layout-faithful document reproduction.** — rejected: Include scanned-PDF OCR in the first release.. The user explicitly selected PDF + DOCX, no OCR; textless inputs must be diagnosed rather than silently used as empty samples.
- **Verify mechanics offline and require a separate real-model, three-draft voice review across two registers.** — rejected: Rely only on mocked tests, build a larger evaluation platform now, or require a production application connector to prove completion.. The user selected Tests plus voice review and approved the concrete acceptance boundary. Human voice judgment is not replaced by a successful command-only verify run.
- **Keep the original bat-kol source as prior art rather than a dependency, and implement one portable writer rather than dedicated channel agents.** — rejected: Port the Claude agent hierarchy and hardcoded connector assumptions into Pi.. The reusable unit is voice/configuration-driven writing, not the old orchestration mechanism.
- **Phase spec paths were planned Draft outputs; all four are now generated after contract approval and passed the express quality gate. The user chose artifacts only plus a Git commit, not implementation execution.** — rejected: Treat the Draft contract's phase paths as already runnable artifacts or generate implementation specs before contract approval.. The hidden-dependency critic flagged absent specs. The ideation process intentionally generates specs after approval, so the contract now states that dependency and execution gate explicitly rather than implying the files already exist.
- **Keep interview and review code private and concrete to the writer rather than building reusable UI infrastructure.** — rejected: Introduce a general structured-interview helper framework for the single voice-learning workflow.. The over-engineering critic correctly identified an ambiguous abstraction boundary; built-in Pi UI plus small local functions and tools are enough.
- **Preserve bat-kol's omitted-topic session summary and four built-in format defaults as core command behavior, while explicitly excluding implicit Git/VCS inspection.** — rejected: Require explicit source/topic for every command or remove all built-in destination defaults from the core.. The scope critic read current-branch as VCS behavior; it means the current Pi session branch. The named format defaults and session-summary behavior are existing bat-kol capabilities, not a new integration system.
- **Keep human voice acceptance outside the engine's executable phase list and report it separately from mechanical implementation completion.** — rejected: Dispatch a human-only checkpoint with no executable spec as an implementation phase.. The current autopilot path expects executable specPath entries. The named judgment criterion and final implementation spec's manual checklist retain the human gate without pretending the engine can certify voice quality.
- **Add basic second-package workspace, artifact-rule scoping, and release-identity support when the package is introduced; finish end-to-end distribution proof in the final phase.** — rejected: Leave services-only package/release assertions unchanged until the final phase.. A new package must not make required intermediate workspace and release validation impossible. Final artifact-consumer and lifecycle proof still follows the implemented writer.

## Execution Plan

_Added during Phase 5 handoff. Pick up this contract cold and know exactly how to execute._

### Dependency Graph

```
Package, contract, and layered configuration
  └── Headless writing and composition entrypoints  (blocked by Package, contract, and layered configuration)
        └── Hybrid voice learning and document ingestion  (blocked by Headless writing and composition entrypoints)
              └── Portable distribution and acceptance integration  (blocked by Hybrid voice learning and document ingestion)
```

### Execution Steps

**Run the project** (recommended) — autopilot reads this contract, plans dependency waves, runs independent phases in parallel, and gates on failure:

```bash
/ideation:autopilot docs/ideation/2026-09-22-pi-write-for/contract.md
```

**Or run it unattended** — a `/goal` is a durability wrapper around the same autopilot run: Claude re-checks the condition before it is allowed to stop, so failures get repaired and re-run. Generated by `contract-gen --print-goal`; this is the only copy of that string:

```
/goal Drive the Pi Write For contract (2026-09-22-pi-write-for) to completion with /ideation:autopilot.

1. Run `/ideation:autopilot docs/ideation/2026-09-22-pi-write-for/contract.md`. All commits belong on branch ideation/2026-09-22-pi-write-for — switch to it before any run.
2. It dispatches a BACKGROUND workflow. Wait for the completion notification — never start a second autopilot run while one is in flight.
3. Then run the ideation plugin's `scripts/verify.mjs` against `docs/ideation/2026-09-22-pi-write-for/contract-data.json` and leave its VERIFY line in the conversation. Resolve the plugin's install directory first — `${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs` is a placeholder, not a shell variable, and bash will not expand it. That line is the only evidence this goal is judged on.
4. If anything failed, fix the spec or the implementation and go back to step 1. Autopilot skips phases that already have commits.

Done when the most recent VERIFY line reads fail=0 and commits=4/4 — or when two consecutive VERIFY lines are identical and still failing, in which case name the failing checks and stop, because a contract whose checks have rotted must not trap the run.
```

**Or run phases manually** in dependency order:

**Strategy**: Four sequential implementation phases; Full is the intended first-release target. All four post-approval specs have been generated and passed the express feedback-quality self-review. The user selected artifacts-only generation plus an artifact commit; no implementation is authorized by that run-mode choice. A later explicit execution request can use the recorded isolation branch. Human voice acceptance is a separate required judgment checkpoint after mechanical implementation, not a phase dispatched to the engine.

1. **Phase 1** — Package, contract, and layered configuration _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/2026-09-22-pi-write-for/spec-phase-1.md
   ```

2. **Phase 2** — Headless writing and composition entrypoints _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/2026-09-22-pi-write-for/spec-phase-2.md
   ```

3. **Phase 3** — Hybrid voice learning and document ingestion _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/2026-09-22-pi-write-for/spec-phase-3.md
   ```

4. **Phase 4** — Portable distribution and acceptance integration _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/2026-09-22-pi-write-for/spec-phase-4.md
   ```

---

_This contract was generated from brain dump input. Review and approve before proceeding to specification._
