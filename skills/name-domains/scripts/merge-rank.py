#!/usr/bin/env python3
"""Merge taste, collision, availability into ranked final TSV."""
from __future__ import annotations

import os
from pathlib import Path

WORKDIR = Path(os.environ["WORKDIR"])
FINAL_LIMIT = int(os.environ.get("FINAL_LIMIT", "25"))
TLDS_PRIMARY = os.environ.get("TLDS_PRIMARY", "com")


def read_tsv(path: Path) -> list[list[str]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    rows = []
    with path.open(encoding="utf-8") as f:
        for i, ln in enumerate(f):
            ln = ln.rstrip("\n")
            if not ln or (i == 0 and ln.startswith("sld\t")) or ln.startswith("domain\t"):
                continue
            rows.append(ln.split("\t"))
    return rows


def main() -> None:
    taste: dict[str, dict[str, str]] = {}
    for row in read_tsv(WORKDIR / "01-taste-all.tsv"):
        if len(row) >= 3 and row[2].isdigit():
            taste[row[0]] = {"style": row[1], "score": row[2]}

    collision: dict[str, tuple[str, str]] = {}
    for row in read_tsv(WORKDIR / "02-collision.tsv"):
        if len(row) >= 2:
            collision[row[0]] = (row[1], row[2] if len(row) > 2 else "")

    avail: dict[str, dict[str, str]] = {}
    for label, fname in (("pass_a", "03-pass-a.tsv"), ("pass_b", "04-pass-b.tsv")):
        for row in read_tsv(WORKDIR / fname):
            if len(row) >= 2:
                domain, status = row[0], row[1]
                sld = domain.split(".")[0]
                avail.setdefault(sld, {})[domain] = status

    ranked: list[tuple[int, str]] = []
    for sld, t in taste.items():
        base = int(t["score"])
        col, _ = collision.get(sld, ("low", ""))
        best_domain = ""
        best_status = "likely_taken"
        note = ""

        domains = avail.get(sld, {})
        primary = f"{sld}.{TLDS_PRIMARY}"
        if primary in domains:
            best_domain = primary
            best_status = domains[primary]
        else:
            for d, st in sorted(domains.items()):
                if st == "likely_available":
                    best_domain = d
                    best_status = st
                    break
            if not best_domain and domains:
                best_domain, best_status = next(iter(sorted(domains.items())))

        final = base
        if best_status == "likely_available":
            final += 12
        elif best_status == "likely_taken":
            final -= 20
        elif best_status == "unknown":
            final -= 2

        if col == "medium":
            final -= 3
        if col == "high":
            final -= 15

        if best_status == "likely_taken":
            continue
        if final < 70:
            continue

        ranked.append((final, sld))

    for final, sld in sorted(ranked, reverse=True)[:FINAL_LIMIT]:
        t = taste[sld]
        col, closest = collision.get(sld, ("low", ""))
        domains = avail.get(sld, {})
        primary = f"{sld}.{TLDS_PRIMARY}"
        if primary in domains:
            best_domain, best_status = primary, domains[primary]
        else:
            best_domain, best_status = "", "unknown"
            for d, st in domains.items():
                if st == "likely_available":
                    best_domain, best_status = d, st
                    break
        note = ""
        if best_status == "unknown":
            note = "verify_manually"
        print(
            f"{sld}\t{t['style']}\t{t['score']}\t{final}\t{col}\t{best_domain}\t{best_status}\t{note}"
        )


if __name__ == "__main__":
    main()