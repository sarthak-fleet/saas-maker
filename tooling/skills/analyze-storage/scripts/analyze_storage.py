#!/usr/bin/env python3
"""Generate a read-only Fleet storage report inside the Fleet workspace.

Concepts adapted from KKKKhazix/khazix-skills storage-analyzer (MIT):
read-only size collection, conservative cleanup-risk tiers, and an HTML report.
This implementation intentionally has no deletion, Trash, or action-server code.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import html
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import time
from typing import Any


SCHEMA_SCAN = "fleet.storage-scan.v1"
SCHEMA_REPORT = "fleet.storage-report.v1"
RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
TIER_ORDER = ("safe-cache", "review-required", "protected", "unreadable")
TIER_LABELS = {
    "safe-cache": "Safe cache",
    "review-required": "Review required",
    "protected": "Protected",
    "unreadable": "Unreadable",
}
TIER_COLORS = {
    "safe-cache": "#22c55e",
    "review-required": "#f59e0b",
    "protected": "#ef4444",
    "unreadable": "#64748b",
}
KNOWN_CACHE_NAMES = {
    ".cache",
    ".gradle",
    ".npm",
    ".pnpm-store",
    "deriveddata",
    "node-gyp",
    "pip",
    "uv",
}
PROTECTED_GROUPS = {"app-support", "containers"}
PROTECTED_COMPONENTS = {"application support", "containers", "group containers", "system"}
USER_DATA_COMPONENTS = {
    "desktop",
    "documents",
    "downloads",
    "movies",
    "music",
    "pictures",
    "projects",
    "workspace",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workspace-root",
        type=Path,
        default=Path(__file__).resolve().parents[5],
        help="Fleet workspace root; artifacts remain below this directory.",
    )
    parser.add_argument(
        "--scan-root",
        type=Path,
        default=Path.home(),
        help="Directory whose storage usage should be inspected.",
    )
    parser.add_argument(
        "--run-id",
        default=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        help="Safe directory name for this run.",
    )
    parser.add_argument(
        "--min-mb",
        type=int,
        default=100,
        help="Minimum readable entry size retained in the report.",
    )
    parser.add_argument(
        "--scan-file",
        type=Path,
        help=argparse.SUPPRESS,
    )
    return parser.parse_args()


def contained_path(child: Path, parent: Path) -> Path:
    resolved_child = child.expanduser().resolve()
    resolved_parent = parent.expanduser().resolve()
    try:
        resolved_child.relative_to(resolved_parent)
    except ValueError as error:
        raise ValueError(f"path escapes workspace-local report root: {child}") from error
    return resolved_child


def output_directory(workspace_root: Path, run_id: str) -> Path:
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise ValueError("run id must use 1-80 letters, numbers, dots, underscores, or hyphens")
    workspace = workspace_root.expanduser().resolve()
    if not workspace.is_dir():
        raise ValueError(f"workspace root does not exist: {workspace}")
    reports_root = (workspace / ".fleet-local" / "reports" / "storage").resolve()
    return contained_path(reports_root / run_id, reports_root)


def human_bytes(value: int | None) -> str:
    if value is None:
        return "unknown"
    amount = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if amount < 1024 or unit == "TB":
            return f"{amount:.1f} {unit}" if unit != "B" else f"{int(amount)} B"
        amount /= 1024
    return f"{amount:.1f} TB"


def immediate_children(root: Path, skip_names: set[str] | None = None) -> tuple[list[Path], list[str]]:
    children: list[Path] = []
    skipped_symlinks: list[str] = []
    skip = skip_names or set()
    try:
        entries = sorted(root.iterdir(), key=lambda item: item.name.casefold())
    except OSError:
        return children, skipped_symlinks
    for entry in entries:
        if entry.name in skip:
            continue
        try:
            if entry.is_symlink():
                skipped_symlinks.append(str(entry))
                continue
        except OSError:
            continue
        children.append(entry)
    return children, skipped_symlinks


def scan_targets(scan_root: Path) -> tuple[list[tuple[str, Path]], list[str]]:
    targets: list[tuple[str, Path]] = []
    skipped_symlinks: list[str] = []
    seen: set[Path] = set()

    def add_children(group: str, root: Path, skip: set[str] | None = None) -> None:
        if not root.is_dir():
            return
        children, skipped = immediate_children(root, skip)
        skipped_symlinks.extend(skipped)
        for child in children:
            resolved = child.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            targets.append((group, child))

    scan_root = scan_root.expanduser().resolve()
    library = scan_root / "Library"
    add_children("home", scan_root, {"Library", "Downloads"} if library.is_dir() else set())
    add_children("downloads", scan_root / "Downloads")
    add_children("caches", library / "Caches")
    add_children("app-support", library / "Application Support")
    add_children("containers", library / "Containers")
    add_children("containers", library / "Group Containers")
    return targets, sorted(set(skipped_symlinks), key=str.casefold)


def measure_path(path: Path) -> tuple[int | None, str | None]:
    if path.is_symlink():
        return None, "symlink skipped"
    if os.name != "nt":
        try:
            result = subprocess.run(
                ["du", "-sk", "-x", str(path)],
                capture_output=True,
                check=False,
                text=True,
                timeout=180,
            )
        except (OSError, subprocess.SubprocessError):
            result = None
        if result is not None and result.returncode == 0:
            match = re.match(r"\s*(\d+)", result.stdout)
            if match:
                return int(match.group(1)) * 1024, None
        if result is not None and result.returncode != 0:
            return None, "size unavailable"

    total = 0
    try:
        if path.is_file():
            return path.stat().st_size, None
        for current, directories, files in os.walk(path, followlinks=False):
            directories[:] = sorted(
                directory
                for directory in directories
                if not (Path(current) / directory).is_symlink()
            )
            for filename in files:
                candidate = Path(current) / filename
                if candidate.is_symlink():
                    continue
                try:
                    total += candidate.stat().st_size
                except OSError:
                    continue
    except OSError:
        return None, "size unavailable"
    return total, None


def scan_storage(scan_root: Path, min_bytes: int) -> dict[str, Any]:
    started = time.monotonic()
    root = scan_root.expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"scan root does not exist: {root}")
    targets, skipped_symlinks = scan_targets(root)
    entries: list[dict[str, Any]] = []
    for group, path in targets:
        size_bytes, error = measure_path(path)
        if size_bytes is not None and size_bytes < min_bytes:
            continue
        entries.append(
            {
                "error": error,
                "group": group,
                "name": path.name,
                "path": str(path),
                "readable": size_bytes is not None,
                "sizeBytes": size_bytes,
            }
        )
    entries.sort(key=lambda entry: (-(entry["sizeBytes"] or -1), entry["path"].casefold()))
    disk = shutil.disk_usage(root)
    return {
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "entries": entries,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scanRoot": str(root),
        "schema": SCHEMA_SCAN,
        "skippedSymlinks": skipped_symlinks,
        "system": {
            "diskFreeBytes": disk.free,
            "diskTotalBytes": disk.total,
            "diskUsedBytes": disk.used,
            "machine": platform.machine(),
            "platform": platform.platform(),
        },
    }


def validate_scan(scan: dict[str, Any]) -> dict[str, Any]:
    if scan.get("schema") != SCHEMA_SCAN:
        raise ValueError(f"unsupported scan schema: {scan.get('schema')}")
    if not isinstance(scan.get("entries"), list):
        raise ValueError("scan entries must be a list")
    for entry in scan["entries"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise ValueError("each scan entry requires a path")
        if entry.get("sizeBytes") is not None and not isinstance(entry["sizeBytes"], int):
            raise ValueError("entry sizeBytes must be an integer or null")
    return scan


def classify_entry(entry: dict[str, Any]) -> dict[str, Any]:
    result = dict(entry)
    path = Path(entry["path"])
    components = {component.casefold() for component in path.parts}
    name = str(entry.get("name") or path.name).casefold()
    group = str(entry.get("group") or "unknown").casefold()

    if not entry.get("readable", entry.get("sizeBytes") is not None):
        result.update(
            tier="unreadable",
            evidence="The size could not be read; no cleanup estimate is possible.",
            recommendation="Review macOS privacy or filesystem access separately.",
        )
    elif group == "caches" or name in KNOWN_CACHE_NAMES or "caches" in components:
        result.update(
            tier="safe-cache",
            evidence="The path is inside a recognized cache or reproducible developer-cache root.",
            recommendation="Review the owning app or tool before a separately authorized cleanup.",
        )
    elif group in PROTECTED_GROUPS or components.intersection(PROTECTED_COMPONENTS):
        result.update(
            tier="protected",
            evidence="The path can contain application state, containers, or system-managed data.",
            recommendation="Do not remove it manually; use the owning application's supported controls.",
        )
    elif group == "downloads" or components.intersection(USER_DATA_COMPONENTS) or (path / ".git").is_dir():
        result.update(
            tier="review-required",
            evidence="The path can contain user downloads, media, documents, or source code.",
            recommendation="Inspect contents and ownership manually; no automated cleanup is provided.",
        )
    else:
        result.update(
            tier="review-required",
            evidence="The path is not on the narrow reproducible-cache allowlist.",
            recommendation="Inspect contents and ownership manually; unknown data is never treated as safe cache.",
        )
    return result


def build_report(scan: dict[str, Any]) -> dict[str, Any]:
    findings = [classify_entry(entry) for entry in scan["entries"]]
    findings.sort(
        key=lambda finding: (
            TIER_ORDER.index(finding["tier"]),
            -(finding.get("sizeBytes") or -1),
            finding["path"].casefold(),
        )
    )
    by_tier = {
        tier: sum(
            finding.get("sizeBytes") or 0
            for finding in findings
            if finding["tier"] == tier and finding.get("sizeBytes") is not None
        )
        for tier in TIER_ORDER
    }
    return {
        "estimatedReleasableBytes": by_tier["safe-cache"],
        "findings": findings,
        "generatedAt": scan.get("generatedAt"),
        "identifiedBytes": sum(finding.get("sizeBytes") or 0 for finding in findings),
        "scanRoot": scan.get("scanRoot"),
        "schema": SCHEMA_REPORT,
        "skippedSymlinks": scan.get("skippedSymlinks", []),
        "system": scan.get("system", {}),
        "tierBytes": by_tier,
    }


def render_report_html(report: dict[str, Any]) -> str:
    cards = []
    for tier in TIER_ORDER:
        cards.append(
            '<article class="metric">'
            f'<span class="dot" style="background:{TIER_COLORS[tier]}"></span>'
            f'<strong>{html.escape(TIER_LABELS[tier])}</strong>'
            f'<b>{human_bytes(report["tierBytes"][tier])}</b>'
            "</article>"
        )

    sections = []
    for tier in TIER_ORDER:
        findings = [finding for finding in report["findings"] if finding["tier"] == tier]
        rows = []
        for finding in findings:
            rows.append(
                "<details><summary>"
                f'<span>{html.escape(finding.get("name") or finding["path"])}</span>'
                f'<b>{human_bytes(finding.get("sizeBytes"))}</b>'
                "</summary>"
                f'<code>{html.escape(finding["path"])}</code>'
                f'<p>{html.escape(finding["evidence"])}</p>'
                f'<p class="recommendation">{html.escape(finding["recommendation"])}</p>'
                "</details>"
            )
        sections.append(
            '<section class="tier">'
            f'<h2><span class="dot" style="background:{TIER_COLORS[tier]}"></span>'
            f'{html.escape(TIER_LABELS[tier])} <small>{len(findings)}</small></h2>'
            + ("".join(rows) if rows else '<p class="empty">No findings.</p>')
            + "</section>"
        )

    disk_total = report.get("system", {}).get("diskTotalBytes")
    disk_used = report.get("system", {}).get("diskUsedBytes")
    disk_free = report.get("system", {}).get("diskFreeBytes")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fleet storage analysis</title>
<style>
:root {{ color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background:#08111f; color:#e5edf7; }}
* {{ box-sizing:border-box; }} body {{ margin:0; }} main {{ width:min(1080px, calc(100% - 32px)); margin:40px auto 80px; }}
h1 {{ margin:0 0 8px; font-size:clamp(2rem, 5vw, 3.6rem); letter-spacing:-.04em; }}
.lede {{ color:#9fb0c5; max-width:72ch; line-height:1.6; }} .warning {{ padding:14px 16px; border:1px solid #334155; border-radius:12px; background:#111c2d; }}
.metrics {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin:24px 0; }}
.metric {{ display:grid; grid-template-columns:auto 1fr; gap:8px 10px; align-items:center; padding:16px; background:#101a2a; border:1px solid #22304a; border-radius:14px; }}
.metric b {{ grid-column:2; font-size:1.35rem; }} .dot {{ width:10px; height:10px; border-radius:999px; display:inline-block; margin-right:8px; }}
.disk {{ display:flex; gap:18px; flex-wrap:wrap; color:#b6c5d8; margin:16px 0 28px; }}
.tier {{ margin-top:28px; }} h2 {{ display:flex; align-items:center; }} h2 small {{ color:#7f91a9; margin-left:8px; }}
details {{ background:#101a2a; border:1px solid #22304a; border-radius:12px; margin:10px 0; padding:0 16px; }}
summary {{ display:flex; justify-content:space-between; gap:16px; cursor:pointer; padding:16px 0; }}
code {{ display:block; overflow-wrap:anywhere; color:#93c5fd; }} p {{ line-height:1.55; }} .recommendation,.empty {{ color:#9fb0c5; }}
</style>
</head>
<body><main>
<h1>Storage analysis</h1>
<p class="lede">Generated {html.escape(str(report.get("generatedAt") or "unknown"))}. This is a timestamped estimate, not transactional disk accounting.</p>
<p class="warning"><strong>Read-only report.</strong> It contains no cleanup execution, deletion, Trash, uninstall, permission, or system-setting controls.</p>
<div class="disk"><span>Total {human_bytes(disk_total)}</span><span>Used {human_bytes(disk_used)}</span><span>Free {human_bytes(disk_free)}</span><span>Identified {human_bytes(report["identifiedBytes"])}</span></div>
<div class="metrics">{''.join(cards)}</div>
{''.join(sections)}
</main></body></html>
"""


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    if args.min_mb < 0:
        raise ValueError("min-mb must be zero or greater")
    destination = output_directory(args.workspace_root, args.run_id)
    if args.scan_file:
        scan = validate_scan(json.loads(args.scan_file.read_text(encoding="utf-8")))
    else:
        scan = scan_storage(args.scan_root, args.min_mb * 1024 * 1024)
    report = build_report(scan)
    rendered = render_report_html(report)

    destination.mkdir(parents=True, exist_ok=True)
    write_json(destination / "scan.json", scan)
    write_json(destination / "report.json", report)
    (destination / "report.html").write_text(rendered, encoding="utf-8")

    print(
        json.dumps(
            {
                "estimatedReleasable": human_bytes(report["estimatedReleasableBytes"]),
                "findingCount": len(report["findings"]),
                "report": str(destination / "report.html"),
                "runDirectory": str(destination),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"storage analysis failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
