# @birdcar/pi-write-for

`@birdcar/pi-write-for` is a Pi extension for drafting or rewriting text in a configured voice and
channel. Profiles remain plain Markdown/frontmatter; generation is exposed through a service,
`/write-for`, and the Full-scope rewrite event.

## Installation and baseline

Install the extension into Pi with Node `>=22.19.0` and a compatible Pi host:

```sh
npm install @birdcar/pi-services @birdcar/pi-write-for
```

Load `@birdcar/pi-write-for` as a Pi extension. It does not start an external RPC server, require an
application connector, automatically send drafts, or change the main session model. If no profile
metadata names a model, generation uses the active Pi model for that request; a profile `model:`
such as `openai-codex/gpt-5-codex` wins over the active model.

## Profiles

Project profiles live in the Pi project config directory under `write-for/` (normally
`.pi/write-for/`). Global profiles live in `${XDG_CONFIG_HOME:-$HOME/.config}/pi-write-for`.

Supported files:

- style file at the profile root
- per-register Markdown files under the registers directory
- per-channel Markdown files under the channels directory

Optional YAML frontmatter supports `model: provider/model-id`; channel files may also set
`defaultRegister`. Manual migration from earlier experiments is copying compatible Markdown into one
of these roots; the extension does not merge legacy directories automatically. Caller prose has
priority over profile guidance, while profile configuration owns channel/register/model execution.

## Commands

```text
/write-for <channel> [--register <name>] [topic]
/write-for <channel> [--register <name>] --rewrite <text>
/train-voice [--style|--register <name>|--channel <name>|--all] [--source <folder>] [--global|--project]
/retrain-voice [--style|--register <name>|--channel <name>|--all] [--source <folder>] [--global|--project]
```

If `/write-for` topic is omitted, the command summarizes visible user/assistant text from the
current Pi session branch. It does not inspect Git or include tool-call arguments/results.

`/train-voice` and `/retrain-voice` require Pi UI/RPC. They start a cooperative main-session
interview and expose writer-local tools (`write_for_interview`, `write_for_samples`, and
`write_for_profile`) so the host agent can reuse already-authorized local/MCP/CLI tools without the
writer extension installing connectors or switching the host model.

Training supports approved local folders or a custom channel/register selection containing UTF-8
`.txt`, `.md`/`.markdown`, text-based `.pdf`, and `.docx` files. PDF/DOCX extraction is native and
text-only: there is no OCR, rendering, legacy `.doc`, spreadsheet, image, audio, or video parser.
Source plans are shown before reading, hidden/build/dependency directories are excluded, symlink
escapes are rejected, and limits start at 50 files, 20 MiB per file, 50 MiB total source bytes, and
200,000 extracted characters.

Samples and profile destinations always require review. The extension persists reviewed Markdown
profile prose, examples, and source references; it does not keep a raw sample archive. Existing
frontmatter such as `model:` is preserved where practical and model selection remains metadata-only.
Stale proposals are rejected, partial I/O failures are reported, and rejecting approval leaves the
profile unchanged. Raw working samples and extension-owned temporary paths are released on normal
save, cancel, failure, replacement, and session shutdown. This does not promise cleanup of Pi
transcripts, provider retention, host-created exports, user originals, or forced process
termination.

## Service

Consumers discover the service on demand. Treat `undefined` as an absent-service fallback and
rediscover after Pi reloads or session replacement instead of retaining old methods:

```ts
import { discoverService } from "@birdcar/pi-services";
import { writeForContract } from "@birdcar/pi-write-for/contract";

const api = discoverService(pi.events, writeForContract);
if (!api) {
  // Optional integration path: keep composing without Pi Write For.
} else {
  const result = await api.draft({
    channel: "email",
    register: "professional",
    subject: "Launch notes",
  });
  console.log(result.text);
}
```

`WritingResult` returns draft text, channel/register, model identity, and normalized usage after the
ordinary promise resolves. Service discovery/disposal errors from `@birdcar/pi-services` propagate
unchanged; write-for validation/config/model failures are structural `WriteForError`s.

## Event ingress

Emit `birdcar.write-for:v1:rewrite` with `{ request, accept }`. The adapter calls
`accept(Promise<WritingResult>)` synchronously after service discovery; the sender owns
awaiting/reporting the promise. The envelope does not broadcast source content globally; prefer the
service API when the integration needs result-bearing control flow.

## Acceptance

Mechanical package and lifecycle checks prove portable loading, contracts, parsing, and release
planning. Voice quality is a human observation: train at least two registers on a user-approved
corpus, draft three held-out messages, and accept only when the user's facts and recognizable voice
need no substantial tone rewrite. If no live reviewer/corpus/model is available, report mechanical
checks passed with voice acceptance pending.
