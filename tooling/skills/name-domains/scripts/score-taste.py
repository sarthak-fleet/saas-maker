#!/usr/bin/env python3
"""Mechanical taste score for domain SLDs. Start 50, apply fixed bands."""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.common import load_lines, parse_sld_line, skill_root

VOWELS = set("aeiou")
CHEAP_SUFFIXES = ("hub", "ly", "ify", "ware", "app")


def load_misleading(root: Path) -> list[tuple[str, str, str]]:
    path = root / "references" / "misleading-patterns.txt"
    rules: list[tuple[str, str, str]] = []
    for ln in load_lines(path):
        parts = ln.split("\t")
        if len(parts) >= 3:
            rules.append((parts[0], parts[1], parts[2]))
    return rules


def misleading_penalty(sld: str, rules: list[tuple[str, str, str]]) -> tuple[int, list[str]]:
    penalty = 0
    notes: list[str] = []
    for kind, pattern, reason in rules:
        if kind == "exact" and sld == pattern:
            penalty += 25
            notes.append(f"misleading:{reason}-25")
        elif kind == "endswith" and sld.endswith(pattern) and len(sld) > len(pattern) + 2:
            penalty += 15
            notes.append(f"misleading_{pattern}-15")
        elif kind == "contains" and pattern in sld:
            penalty += 12
            notes.append(f"misleading_{pattern}-12")
    return penalty, notes


def score_sld(
    sld: str,
    style: str = "",
    vibe: str = "",
    idea: str = "",
    avoid: list[str] | None = None,
    misleading_rules: list[tuple[str, str, str]] | None = None,
    blocked: set[str] | None = None,
) -> tuple[int, list[str], bool]:
    s = sld.lower().strip()
    notes: list[str] = []
    total = 50
    reject = False

    if blocked and s in blocked:
        return 0, ["blocked_sld"], True

    if avoid:
        for a in avoid:
            if a and a in s:
                return 0, [f"avoid:{a}"], True

    n = len(s)
    if n < 3:
        return 0, ["too_short"], True
    if 5 <= n <= 10:
        total += 15
        notes.append("length_sweet_spot+15")
    elif n in (4, 11, 12):
        total += 5
        notes.append("length_ok+5")
    elif n > 12:
        total -= 10
        notes.append("length_long-10")

    if re.search(r"[^aeiouy]{4,}", s):
        total -= 12
        notes.append("consonant_cluster-12")
    if re.search(r"(.)\1{2,}", s):
        total -= 8
        notes.append("triple_repeat-8")
    if "-" in s or any(c.isdigit() for c in s):
        total -= 8
        notes.append("hyphen_digit-8")

    vowel_ratio = sum(1 for c in s if c in VOWELS) / max(len(s), 1)
    if 0.22 <= vowel_ratio <= 0.58:
        total += 10
        notes.append("pronounceable+10")

    cues = [w for w in re.split(r"[\s,/+-]+", f"{vibe} {idea}".lower()) if len(w) >= 4]
    hits = sum(1 for w in cues if w[:4] in s)
    fit = min(15, hits * 5)
    if fit:
        total += fit
        notes.append(f"idea_vibe_fit+{fit}")

    premium_styles = {"abstract", "metaphor", "portmanteau"}
    classy_vibes = ("premium", "classy", "minimal", "warm", "trust", "educational")
    if style in premium_styles and any(v in vibe.lower() for v in classy_vibes):
        total += 5
        notes.append("style_vibe_match+5")

    if s in CHEAP_SUFFIXES or (n <= 5 and s.endswith(CHEAP_SUFFIXES)):
        total -= 15
        notes.append("cheap_suffix-15")

    if misleading_rules:
        pen, mnotes = misleading_penalty(s, misleading_rules)
        total -= pen
        notes.extend(mnotes)
        if pen >= 25:
            reject = True

    return max(0, min(100, total)), notes, reject


def main() -> None:
    p = argparse.ArgumentParser(description="Score domain SLD taste 0-100")
    p.add_argument("slds", nargs="*")
    p.add_argument("--style", default="")
    p.add_argument("--vibe", default="")
    p.add_argument("--idea", default="")
    p.add_argument("--avoid", default="", help="comma-separated substrings")
    p.add_argument("--header", action="store_true")
    p.add_argument("--reject-reasons", action="store_true", help="print rejected SLDs")
    args = p.parse_args()

    root = skill_root()
    blocked = set(load_lines(root / "references" / "blocked-slds.txt"))
    misleading = load_misleading(root)
    avoid = [a.strip().lower() for a in args.avoid.split(",") if a.strip()]

    rows_in: list[str] = list(args.slds)
    if not rows_in and not sys.stdin.isatty():
        rows_in = [ln for ln in sys.stdin if ln.strip() and not ln.strip().startswith("#")]

    if args.header:
        print("sld\tstyle\tscore\treject\tnotes")

    scored: list[tuple[int, str, str, bool, list[str]]] = []
    for raw in rows_in:
        sld, style = parse_sld_line(raw)
        if not sld:
            continue
        use_style = style or args.style
        sc, notes, reject = score_sld(sld, use_style, args.vibe, args.idea, avoid, misleading, blocked)
        if reject and not args.reject_reasons:
            continue
        scored.append((sc, sld, use_style, reject, notes))

    for sc, sld, style, reject, notes in sorted(scored, reverse=True):
        print(f"{sld}\t{style}\t{sc}\t{int(reject)}\t{','.join(notes)}")


if __name__ == "__main__":
    main()