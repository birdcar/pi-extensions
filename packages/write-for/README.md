# @birdcar/pi-write-for

`@birdcar/pi-write-for` is the Pi extension foundation for writing in a selected voice and channel.
Phase 1 provides the package skeleton, public `./contract` subpath, static channel defaults, and
deterministic Markdown/frontmatter profile resolution; it does not yet call models or train a voice.

Install the package as a Pi extension and discover its service through `@birdcar/pi-services` once
the runtime adapter is available. Consumers should import `@birdcar/pi-write-for/contract`, not the
extension entrypoint.

Project profiles live in the Pi project config directory under `write-for/` (normally
`.pi/write-for/`). Global profiles live in `${XDG_CONFIG_HOME:-$HOME/.config}/pi-write-for`. Copy
compatible Markdown manually from older Bat Kol locations; `.bat-kol`, old XDG names, and
`BAT_KOL_CONFIG` are intentionally ignored.

Supported profile files are the top-level style Markdown file, per-register Markdown files, and
per-channel Markdown files. Optional YAML frontmatter supports only `model: provider/model-id`, plus
`defaultRegister` in channel files.
