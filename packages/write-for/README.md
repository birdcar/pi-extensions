# @birdcar/pi-write-for

`@birdcar/pi-write-for` is a Pi extension for drafting or rewriting text in a configured voice and
channel. Profiles remain plain Markdown/frontmatter; generation is exposed through a service,
`/write-for`, and the Full-scope rewrite event.

## Profiles

Project profiles live in the Pi project config directory under `write-for/` (normally
`.pi/write-for/`). Global profiles live in `${XDG_CONFIG_HOME:-$HOME/.config}/pi-write-for`.

Supported files:

- style file at the profile root
- per-register Markdown files under the registers directory
- per-channel Markdown files under the channels directory

Optional YAML frontmatter supports `model: provider/model-id`; channel files may also set
`defaultRegister`.

## Command

```text
/write-for <channel> [--register <name>] [topic]
/write-for <channel> [--register <name>] --rewrite <text>
```

If topic is omitted, the command summarizes visible user/assistant text from the current Pi session
branch. It does not inspect Git or include tool-call arguments/results.

## Service

Consumers discover the service on demand:

```ts
import { discoverService } from "@birdcar/pi-services";
import { writeForContract } from "@birdcar/pi-write-for/contract";

const api = discoverService(pi.events, writeForContract);
const result = await api?.draft({
  channel: "email",
  register: "professional",
  subject: "Launch notes",
});
```

`WritingResult` returns draft text, channel/register, model identity, and normalized usage. Service
discovery/disposal errors from `@birdcar/pi-services` propagate unchanged; write-for
validation/config/model failures are structural `WriteForError`s.

## Event ingress

Emit `birdcar.write-for:v1:rewrite` with `{ request, accept }`. The adapter calls
`accept(Promise<WritingResult>)` synchronously after service discovery; the sender owns
awaiting/reporting the promise.
