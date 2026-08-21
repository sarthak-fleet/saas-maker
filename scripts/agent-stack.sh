#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_OPS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FLEET_ROOT="${FLEET_WORKSPACE_ROOT:-$(cd "$FLEET_OPS_DIR/.." && pwd)}"
LEGACY_FLEET_OPS_DIR="$FLEET_ROOT/fleet-ops"
EXPOSED_FLEET_SKILLS=(
  analyze-storage
  daily-learning
  design-engineering
  design-workflow
  fleet-deploy-parity
  fleet-ops
  ian-xiaohei-illustrations
  code-cleanup
  local-ports-cleanup
  mobile-task-control
  name-domains
  site-health
  spec-driven
  token-budget
)

usage() {
  cat <<'EOF'
usage: agent-stack.sh <command>

Commands:
  install-skills  Link Fleet Ops skills into local agent runtimes.
  install-agents  Register Fleet support projects as OpenClaw agents.
  mobile          Show or configure mobile control surfaces.
  notify          Send or inspect a durable Fleet notification.
  check           Validate local OpenClaw, optional Hermes, Telegram, and security state.
  start           Start OpenClaw and notifications.
  pause           Stop OpenClaw and notifications.
  resume          Start OpenClaw and notifications.
  restart         Restart OpenClaw and notifications.
  status          Show gateway, cron, mobile, and paired-device status.
EOF
}

install_impeccable() {
  local skill_file="$FLEET_ROOT/.agents/skills/impeccable/SKILL.md"
  local policy_file="$FLEET_OPS_DIR/config/design-workflow.json"
  local expected_version
  local package_version
  local installed_version

  # Impeccable is external and its version policy is not published with this
  # credential-free repository. Preserve an existing installation when the
  # workspace does not provide that optional policy file.
  [[ -f "$policy_file" ]] || return 0

  read -r package_version expected_version <<<"$(
    node -e '
      const policy = require(process.argv[1]);
      const valid = (value) => /^\d+\.\d+\.\d+$/.test(value ?? "");
      if (!valid(policy.impeccablePackageVersion) || !valid(policy.impeccableVersion)) process.exit(1);
      process.stdout.write(`${policy.impeccablePackageVersion} ${policy.impeccableVersion}`);
    ' "$policy_file"
  )" || {
    printf 'Invalid Impeccable version policy: %s\n' "$policy_file" >&2
    return 1
  }
  installed_version="$(
    sed -nE 's/^version:[[:space:]]*["'\'']?([^"'\'']+[[:alnum:]])["'\'']?[[:space:]]*$/\1/p' \
      "$skill_file" 2>/dev/null | head -n 1
  )"

  if [[ "$installed_version" == "$expected_version" ]]; then
    return 0
  fi

  if ! command -v npx >/dev/null 2>&1; then
    printf 'npx is required to install the Impeccable design skill.\n' >&2
    return 1
  fi

  (
    cd "$FLEET_ROOT"
    npx --yes "impeccable@$package_version" install \
      --providers=codex,claude \
      --scope=project
  )

  installed_version="$(
    sed -nE 's/^version:[[:space:]]*["'\'']?([^"'\'']+[[:alnum:]])["'\'']?[[:space:]]*$/\1/p' \
      "$skill_file" 2>/dev/null | head -n 1
  )"
  if [[ "$installed_version" != "$expected_version" ]]; then
    printf 'Impeccable install drift: expected %s, found %s\n' \
      "$expected_version" "${installed_version:-missing}" >&2
    return 1
  fi
}

is_exposed_fleet_skill() {
  local candidate="$1"
  local exposed

  for exposed in "${EXPOSED_FLEET_SKILLS[@]}"; do
    [[ "$candidate" == "$exposed" ]] && return 0
  done
  return 1
}

link_fleet_skills() {
  local destination="$1"
  local managed
  local source
  local name

  mkdir -p "$destination"

  for managed in "$destination"/*; do
    [[ -L "$managed" ]] || continue
    case "$(readlink "$managed")" in
      "$FLEET_OPS_DIR"/skills/*|"$LEGACY_FLEET_OPS_DIR"/skills/*|"$LEGACY_FLEET_OPS_DIR"/psi-swarm)
        name="$(basename "$managed")"
        if ! is_exposed_fleet_skill "$name"; then
          rm "$managed"
        fi
        ;;
    esac
  done

  for name in "${EXPOSED_FLEET_SKILLS[@]}"; do
    source="$FLEET_OPS_DIR/skills/$name"
    [[ -d "$source" ]] || {
      printf 'Missing exposed Fleet skill: %s\n' "$source" >&2
      return 1
    }
    ln -sfn "$source" "$destination/$name"
  done
}

link_teammate_parent() {
  local destination="$1"
  local managed

  mkdir -p "$destination"
  for managed in "$destination"/call-*; do
    [[ -L "$managed" ]] || continue
    case "$(readlink "$managed")" in
      "$FLEET_OPS_DIR"/skills/*|"$LEGACY_FLEET_OPS_DIR"/teammates/skills/*)
        [[ "$(basename "$managed")" == "call-teammate" ]] || rm "$managed"
        ;;
    esac
  done
  ln -sfn "$FLEET_OPS_DIR/skills/call-teammate" "$destination/call-teammate"
}

install_skill_run_command() {
  local destination="$HOME/.local/bin"
  local source="$FLEET_OPS_DIR/scripts/agent-bin/fleet-skill-run.mjs"

  [[ -f "$source" ]] || {
    printf 'Missing Fleet skill-run command: %s\n' "$source" >&2
    return 1
  }
  mkdir -p "$destination"
  ln -sfn "$source" "$destination/fleet-skill-run"
}

install_skills() {
  local dir

  # Impeccable is a machine-installed third-party skill. Its generated files
  # stay untracked; child projects receive local links below.
  install_impeccable
  install_skill_run_command
  node "$FLEET_OPS_DIR/scripts/install-skill-run-hook.mjs"

  # Keep Codex skills local to Fleet instead of loading them in every repo.
  dir="$FLEET_ROOT/.agents/skills"
  link_fleet_skills "$dir"
  link_teammate_parent "$dir"
  "$FLEET_OPS_DIR/scripts/link-project-agent-assets.sh" --skills-only

  # Gateway runtimes are not repository-scoped, so keep user-level links.
  for dir in "$HOME/.openclaw/skills"; do
    link_fleet_skills "$dir"
    link_teammate_parent "$dir"
  done
  if [ -d "$HOME/.hermes/skills" ]; then
    dir="$HOME/.hermes/skills"
    link_fleet_skills "$dir"
    link_teammate_parent "$dir"
  fi
}

case "${1:-}" in
  install-skills) install_skills ;;
  install-agents) "$FLEET_OPS_DIR/scripts/agent-bin/setup-openclaw-support-agents" "${@:2}" ;;
  mobile) "$FLEET_OPS_DIR/scripts/agent-bin/mobile-control" "${@:2}" ;;
  notify) "$FLEET_OPS_DIR/scripts/agent-bin/fleet-notify" "${@:2}" ;;
  check)
    openclaw config validate
    openclaw plugins doctor
    openclaw channels status --deep || true
    openclaw security audit
    if command -v hermes >/dev/null 2>&1; then
      hermes doctor || true
      hermes status --deep || true
    fi
    "$FLEET_OPS_DIR/scripts/agent-bin/mobile-control" status
    ;;
  start|resume)
    "$FLEET_OPS_DIR/scripts/agent-stack.sh" install-skills
    openclaw plugins enable telegram >/dev/null 2>&1 || true
    openclaw gateway start
    "$FLEET_OPS_DIR/scripts/agent-bin/fleet-notification-service" start
    ;;
  pause)
    openclaw gateway stop
    "$FLEET_OPS_DIR/scripts/agent-bin/fleet-notification-service" stop
    ;;
  restart)
    openclaw gateway restart
    "$FLEET_OPS_DIR/scripts/agent-bin/fleet-notification-service" restart
    ;;
  status)
    openclaw status --all
    openclaw channels list --all | sed -n '/Telegram/p' || true
    if command -v hermes >/dev/null 2>&1; then
      hermes gateway status || true
      hermes status | sed -n '1,120p' || true
    fi
    openclaw nodes status
    "$FLEET_OPS_DIR/scripts/agent-bin/fleet-notification-service" status
    "$FLEET_OPS_DIR/scripts/agent-bin/fleet-notify" status
    "$FLEET_OPS_DIR/scripts/agent-bin/mobile-control" status
    crontab -l 2>/dev/null | sed -n '/BEGIN FLEET OPS CODEX CRON/,/END FLEET OPS CODEX CRON/p' || true
    ;;
  -h|--help|help|"") usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac
