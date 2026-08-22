#!/usr/bin/env bash
set -u

target="${1:-$(pwd)}"
codex_home="${CODEX_HOME:-$HOME/.codex}"
fleet_root="/Users/sarthak/Desktop/fleet"

bytes() {
  [ -e "$1" ] && wc -c < "$1" | tr -d ' ' || printf '0'
}

lines() {
  [ -e "$1" ] && wc -l < "$1" | tr -d ' ' || printf '0'
}

status_for_bytes() {
  size="$1"
  high="$2"
  med="$3"
  if [ "$size" -ge "$high" ]; then
    printf 'HIGH'
  elif [ "$size" -ge "$med" ]; then
    printf 'MED'
  else
    printf 'OK'
  fi
}

row() {
  label="$1"
  path="$2"
  high="${3:-32768}"
  med="${4:-8192}"
  size="$(bytes "$path")"
  count="$(lines "$path")"
  state="$(status_for_bytes "$size" "$high" "$med")"
  printf '%-7s %8s B %5s lines  %s\n' "$state" "$size" "$count" "$label"
}

echo "Token Budget Audit"
echo "Target: $target"
echo "Codex home: $codex_home"
echo

echo "Always-loaded / frequently loaded surfaces"
row "global AGENTS" "$codex_home/AGENTS.md" 12000 6000
row "target AGENTS" "$target/AGENTS.md" 12000 6000
row "fleet AGENTS" "$fleet_root/AGENTS.md" 12000 6000
row "memory summary" "$codex_home/memories/memory_summary.md" 20000 10000
row "memory index" "$codex_home/memories/MEMORY.md" 200000 100000
row "config.toml" "$codex_home/config.toml" 20000 10000
echo

echo "Skill footprint"
CODEX_HOME="$codex_home" FLEET_ROOT="$fleet_root" AUDIT_TARGET="$target" python3 <<'PY'
import os
import re
from collections import defaultdict
from pathlib import Path

home = Path.home()
codex_home = Path(os.environ["CODEX_HOME"])
fleet_root = Path(os.environ["FLEET_ROOT"])
target = Path(os.environ["AUDIT_TARGET"])
roots = [
    ("Codex user", codex_home / "skills"),
    ("Agent user", home / ".agents" / "skills"),
    ("Fleet exposed", fleet_root / ".agents" / "skills"),
    ("Target OpenSpec", target / ".codex" / "skills"),
    ("Plugin disk cache (not startup)", codex_home / "plugins" / "cache"),
    ("Fleet catalog", fleet_root / "foundry" / "ops" / "skills"),
    ("Fleet teammates", fleet_root / "foundry" / "ops" / "teammates" / "skills"),
]

def skill_files(root):
    found = []
    if not root.is_dir():
        return found
    for current, dirs, files in os.walk(root, followlinks=True):
        dirs[:] = [name for name in dirs if name not in {".git", "node_modules"}]
        if "SKILL.md" in files:
            found.append(Path(current) / "SKILL.md")
    return sorted(set(found))

def description(text):
    match = re.search(r"(?ms)^---\s*$.*?^description:\s*(.*?)(?=^[A-Za-z_-]+:\s|^---\s*$)", text)
    if not match:
        return ""
    value = re.sub(r"^[>|]\s*", "", match.group(1).strip())
    return " ".join(line.strip().strip("\"'") for line in value.splitlines())

records = []
for label, root in roots:
    files = skill_files(root)
    broken = []
    if root.is_dir():
        broken = [path for path in root.iterdir() if path.is_symlink() and not path.exists()]
    descriptions = 0
    total_bytes = 0
    for path in files:
        try:
            text = path.read_text(errors="replace")
            resolved = path.resolve()
        except OSError:
            continue
        desc = description(text)
        descriptions += len(desc)
        total_bytes += len(text.encode())
        name_match = re.search(r"(?m)^name:\s*[\"']?([^\"'\n]+)", text)
        name = name_match.group(1).strip() if name_match else path.parent.name
        records.append((name, label, str(path), str(resolved), len(desc)))
    print(f"{label:31} {len(files):3} skills  {descriptions:6} description chars  {total_bytes:8} B  {len(broken):2} broken links")
    for path in broken:
        print(f"  BROKEN {path} -> {os.readlink(path)}")

by_name = defaultdict(list)
for record in records:
    by_name[record[0]].append(record)
duplicates = {
    name: values for name, values in by_name.items()
    if len({value[1] for value in values}) > 1
    and len({value[3] for value in values}) > 1
}
print(f"Duplicate names exposed by multiple roots: {len(duplicates)}")
for name, values in sorted(duplicates.items()):
    locations = ", ".join(sorted({value[1] for value in values}))
    print(f"  DUPLICATE {name}: {locations}")

print("Largest descriptions:")
for name, label, path, _, chars in sorted(records, key=lambda item: item[4], reverse=True)[:8]:
    print(f"  {chars:5} chars  {name} ({label})")
PY
echo

echo "Enabled plugins / MCP hints"
if [ -f "$codex_home/config.toml" ]; then
  awk '
    /^\[plugins\./ { plugin=$0 }
    /^enabled = true/ && plugin { print plugin " " $0 }
    /^\[mcp_servers\./ { print $0 }
    /^model = / || /^model_reasoning_effort = / || /^service_tier = / { print }
  ' "$codex_home/config.toml"
fi
echo

echo "Hook footprint"
CODEX_HOME="$codex_home" FLEET_ROOT="$fleet_root" AUDIT_TARGET="$target" python3 <<'PY'
import json
import os
from pathlib import Path

codex_home = Path(os.environ["CODEX_HOME"])
fleet_root = Path(os.environ["FLEET_ROOT"])
target = Path(os.environ["AUDIT_TARGET"])
manifests = {
    codex_home / "hooks.json",
    fleet_root / ".codex" / "hooks.json",
    target / ".codex" / "hooks.json",
}

try:
    import tomllib
    with (codex_home / "config.toml").open("rb") as handle:
        config = tomllib.load(handle)
    for plugin_id, details in config.get("plugins", {}).items():
        if not isinstance(details, dict) or not details.get("enabled"):
            continue
        plugin, _, marketplace = plugin_id.partition("@")
        cache_root = codex_home / "plugins" / "cache" / marketplace / plugin
        candidates = sorted(cache_root.glob("*/hooks/hooks.json"))
        if candidates:
            manifests.add(candidates[-1])
except (FileNotFoundError, OSError, ValueError):
    pass

total_events = 0
total_commands = 0
for path in sorted(manifests):
    if not path.is_file():
        continue
    try:
        payload = json.loads(path.read_text())
    except (OSError, ValueError):
        print(f"WARN    unreadable hook manifest {path}")
        continue
    hooks = payload.get("hooks", {})
    events = len(hooks) if isinstance(hooks, dict) else 0
    commands = 0
    stack = [hooks]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            commands += int("command" in value)
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    total_events += events
    total_commands += commands
    print(f"{events:3} events  {commands:3} commands  {path}")
print(f"Active hook manifests: {sum(path.is_file() for path in manifests)}; events: {total_events}; commands: {total_commands}")
PY
echo

echo "Local cost tools"
for tool in rtk headroom ast-grep sg semgrep repomix gh jq tokei hyperfine; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf 'OK      %s -> %s\n' "$tool" "$(command -v "$tool")"
  else
    printf 'MISSING %s\n' "$tool"
  fi
done
echo

if command -v rtk >/dev/null 2>&1; then
  echo "RTK savings"
  rtk gain 2>/dev/null | sed -n '1,16p'
fi
