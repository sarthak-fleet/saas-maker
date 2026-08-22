"""Shared helpers for name-domains skill scripts."""
from __future__ import annotations

import os
import re
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent.parent
REFERENCES = SKILL_ROOT / "references"

CATEGORIES = {
    "health": "competitor-seeds-health.txt",
    "saas": "competitor-seeds-saas.txt",
    "devtools": "competitor-seeds-devtools.txt",
    "consumer": "competitor-seeds-consumer.txt",
    "ai": "competitor-seeds-ai.txt",
    "general": "competitor-seeds-general.txt",
}


def skill_root() -> Path:
    env = os.environ.get("NAME_DOMAINS_SKILL_ROOT")
    if env:
        return Path(env)
    return SKILL_ROOT


def load_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    out: list[str] = []
    with path.open(encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if ln and not ln.startswith("#"):
                out.append(ln)
    return out


def seeds_for_category(category: str) -> Path:
    root = skill_root()
    fname = CATEGORIES.get(category.lower(), CATEGORIES["general"])
    return root / "references" / fname


def parse_sld_line(raw: str) -> tuple[str, str]:
    raw = raw.strip()
    if not raw or raw.startswith("#"):
        return "", ""
    if "\t" in raw:
        sld, style = raw.split("\t", 1)
    elif ":" in raw and not raw.startswith("http"):
        sld, style = raw.split(":", 1)
    else:
        sld, style = raw, ""
    sld = sld.lower().split(".")[0].strip()
    style = style.strip().lower()
    return sld, style


def levenshtein(a: str, b: str) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return 1 - levenshtein(a, b) / max(len(a), len(b))


def norm_name(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^www\.", "", s)
    s = re.sub(r"\.[a-z]{2,}$", "", s)
    return re.sub(r"[^a-z0-9]", "", s)