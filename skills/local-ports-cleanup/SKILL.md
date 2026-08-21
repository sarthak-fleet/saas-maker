---
name: local-ports-cleanup
description: Inspect, diagnose, and safely clean local listening ports and development-server processes with the installed `ports` CLI. Use when a local port is occupied, stale or orphaned dev processes should be stopped, a project's ports need clearing before restart, or an operator asks what is listening locally. Preserve healthy Docker, database, system, and unrelated project listeners unless explicitly named.
---

# Local Ports Cleanup

Use `ports` as the process authority. Inventory first, stop the narrowest
verified target, then re-scan. Do not replace it with ad hoc `lsof`, `kill`, or
`pkill` pipelines.

## 1. Preflight

Verify the installed command and inspect its current surface:

```bash
rtk command -v ports
rtk ports --version
rtk ports --help
```

If `ports` is missing or the required command is unavailable, stop and report
the prerequisite. Do not install a replacement or fall back to raw process
kills.

## 2. Inventory

Start with the filtered development inventory:

```bash
rtk ports json
```

Inspect each candidate's `port`, `pid`, `project`, `health`, `cwd`,
`docker_container`, `docker_image`, and `command`. Do not paste credential-like
command arguments into chat or retained output.

Use the wider inventory only when an operator-named target is absent or the
request explicitly includes normally hidden listeners:

```bash
rtk ports json --all
```

When scans are slow, unexpectedly empty, or untrustworthy, diagnose without
mutating:

```bash
rtk ports doctor
```

Surface its guidance. Do not quit apps, reboot, or change tunnel/network state
unless the operator separately requests that action.

## 3. Select the narrowest cleanup

Treat a general "clean stale ports" request as authorization for unhealthy
listeners only. Treat exact port, PID, project, force, or all-server cleanup as
authorized only when that scope is explicit and ownership has been shown.

| Intent | Command | Gate |
|---|---|---|
| Remove orphaned or zombie dev listeners | `rtk ports clean` | Review its candidate list and retain the built-in confirmation |
| Free named ports | `rtk ports free <port...>` | Verify each port's owner first; this command does not confirm |
| Stop one project | `rtk ports kill-project <exact-project>` | Copy the exact `project` value from inventory; this command does not confirm |
| Stop named PIDs | `rtk ports kill <pid...>` | Verify every PID and its current owner immediately before running |
| Restart the current project | `rtk ports run <cmd...>` | Use only when restart was requested and the current project root is correct |

Prefer the default graceful SIGTERM path. Do not pass `--force` unless graceful
termination failed and the operator explicitly authorizes force.

Do not use `ports killall` for broad runtime names such as `node`, `python`, or
`cargo`. Do not use `ports nuke` unless the operator explicitly asks to stop
every displayed development server after reviewing the full candidate list.
Never automate a confirmation for an unreviewed list.

## 4. Preserve healthy dependencies

Keep a listener running when it is healthy and any of these apply:

- it belongs to an unrelated project;
- it is a Docker or OrbStack service;
- it is a database, queue, cache, tunnel, or system app;
- its ownership is empty or ambiguous;
- age or memory use is the only evidence that it is stale.

If no unhealthy or explicitly named target exists, report that no safe cleanup
candidate was found. Do not turn a vague cleanup request into a healthy-process
kill.

## 5. Verify and report

Re-run the filtered inventory after every mutation, and use `json --all` for an
explicit target that is normally hidden:

```bash
rtk ports json
```

Confirm each requested port, PID, or exact project is absent. If a supervisor
rebinds a port, report the new PID and listener instead of calling it free. If
the scan fails or `ports doctor` reports an unhealthy scanner state, mark the
cleanup unverified.

Return:

- stopped ports, PIDs, and projects;
- targets still listening or rebound;
- healthy or unrelated listeners deliberately preserved;
- failed, skipped, or unverified actions.

Do not claim that loading or inspecting this skill performed cleanup; only
report process changes actually observed in the post-cleanup inventory.
