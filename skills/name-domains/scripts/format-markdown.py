#!/usr/bin/env python3
"""Render final TSV from run-pipeline.sh into markdown shortlist skeleton."""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict


def live_links(domain: str) -> str:
    if not domain:
        return "—"
    enc = domain
    cf = f"https://domains.cloudflare.com/?domain={enc}"
    nc = f"https://www.namecheap.com/domains/registration/results/?domain={enc}"
    pb = f"https://porkbun.com/checkout/search?q={enc}"
    return f"[CF]({cf}) · [NC]({nc}) · [PB]({pb})"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--idea", required=True)
    p.add_argument("--vibe", default="")
    p.add_argument("--existing-summary", default="")
    p.add_argument("tsv", nargs="?", default="-")
    args = p.parse_args()

    lines = sys.stdin.readlines() if args.tsv == "-" else open(args.tsv, encoding="utf-8").readlines()
    rows = []
    for i, ln in enumerate(lines):
        ln = ln.strip()
        if not ln or (i == 0 and ln.startswith("sld\t")):
            continue
        parts = ln.split("\t")
        if len(parts) >= 7:
            rows.append(parts)

    vibe = f" ({args.vibe} vibe)" if args.vibe else ""
    print(f"# Domain shortlist — {args.idea}{vibe}\n")
    print("> Collision scan is heuristic only — not legal trademark clearance.\n")
    if args.existing_summary:
        print(f"## Existing name\n{args.existing_summary}\n")
    print(f"**{len(rows)}** finalists (verify before buying).\n")

    by_style: dict[str, list] = defaultdict(list)
    for r in rows:
        by_style[r[1] or "abstract"].append(r)

    for style in sorted(by_style.keys()):
        print(f"## {style.title()}\n")
        print("| Domain | Taste | Avail | Collision | Why | Check |")
        print("| --- | ---: | --- | --- | --- | --- |")
        for r in by_style[style]:
            sld, _, _base, final, col, domain, avail, _note = r[:8]
            print(f"| {domain or sld} | {final} | {avail} | {col} | — | {live_links(domain)} |")
        print()

    print("## Top picks\n")
    for i, r in enumerate(sorted(rows, key=lambda x: int(x[3]), reverse=True)[:5], 1):
        print(f"{i}. **{r[5] or r[0]}** — taste {r[3]}; collision {r[4]}")
    print("\n## Not included\nRegistrar checkout · trademark · social handles")


if __name__ == "__main__":
    main()