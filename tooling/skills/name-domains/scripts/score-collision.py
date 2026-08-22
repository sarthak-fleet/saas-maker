#!/usr/bin/env python3
"""Collision scan vs competitor corpus (heuristic, not trademark)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.common import load_lines, norm_name, parse_sld_line, seeds_for_category, similarity, skill_root


def collision_level(sld: str, corpus: list[str]) -> tuple[str, str, float]:
    t = norm_name(sld)
    best_name = ""
    best_sim = 0.0
    substring = False

    for comp in corpus:
        c = norm_name(comp)
        if not c or len(c) < 3:
            continue
        if t == c:
            return "high", c, 1.0
        if len(c) >= 4 and (t in c or c in t):
            substring = True
        sim = similarity(t, c)
        if sim > best_sim:
            best_sim = sim
            best_name = c

    if best_sim >= 0.82 or substring:
        return "high", best_name, best_sim
    if best_sim >= 0.60:
        return "medium", best_name, best_sim
    return "low", best_name, best_sim


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("slds", nargs="*")
    p.add_argument("--competitors", default="", help="comma-separated")
    p.add_argument("--seeds-file", default="", help="path to seed list")
    p.add_argument("--category", default="general", help="health|saas|devtools|consumer|ai|general")
    p.add_argument("--header", action="store_true")
    args = p.parse_args()

    corpus: list[str] = []
    if args.competitors:
        corpus.extend(x.strip() for x in args.competitors.split(",") if x.strip())
    seeds_path = Path(args.seeds_file) if args.seeds_file else seeds_for_category(args.category)
    corpus.extend(load_lines(seeds_path))

    rows_in: list[str] = list(args.slds)
    if not rows_in and not sys.stdin.isatty():
        rows_in = [ln for ln in sys.stdin if ln.strip()]

    if args.header:
        print("sld\tcollision\tclosest\tsimilarity")

    for raw in rows_in:
        sld, _ = parse_sld_line(raw)
        if not sld:
            continue
        level, closest, sim = collision_level(sld, corpus)
        print(f"{sld}\t{level}\t{closest}\t{sim:.2f}")


if __name__ == "__main__":
    main()