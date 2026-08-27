# Wi-Fi Watch

Local macOS network-health monitor used by the Fleet operator host. It checks
link state, usable bandwidth, captive-portal behavior, and Apple
`networkQuality`, then serves a local dashboard on `127.0.0.1:7088`.

```bash
node server.mjs
```

Use `../../scripts/agent-bin/wifi-watch` to manage the launchd service and its
optional Cloudflare quick tunnel.

Runtime observations are written to `data/*.json`. Those files can contain
local network details and are intentionally excluded from Git.
