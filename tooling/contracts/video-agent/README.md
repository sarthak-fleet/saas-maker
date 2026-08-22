# Video agent operation contract

All Fleet video products accept one JSON request and emit one JSON result using
`fleet.video-agent-operation.v1`. The CLI is the canonical transport; MCP or
other agent tools must remain thin adapters over the same product service.

Lifecycle ownership is intentionally split:

- Studio plans, validates, edits, estimates, renders, selects, and exports one source video.
- Mashup ingests creator-owned archives and produces approved editorial media receipts.
- Reel Pipeline executes registered video recipes, packages finished media,
  and is the only product allowed to publish through Fleet-owned adapters for
  configured channels.

No request accepts shell commands, source code, executable paths, or arbitrary
plugins. Publication additionally requires a channel entry whose mode is
`draft_only`, `approval_required`, or `autonomous`.

Discover live capabilities before operating a product:

```sh
npm run agent -- --request request.json          # Reel Pipeline
uv run mashup agent --request request.json       # Mashup
swift run studio-agent --request request.json    # Local Video Studio
```

`manifest` is always read-only. Use `validateOnly: true` before render, write,
or external operations. A completed envelope includes a normalized request
hash and artifact paths; failures contain a stable error code and never execute
an unknown capability.
