#!/usr/bin/env python3
"""Parallel directory spray: one worker process per directory.

Workers share only append-only log.jsonl (file lock). Each worker owns a
Chromium instance and submits all products to its directory, aborting early
on auth/CAPTCHA walls.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CFG = ROOT / "config" / "directory-submissions"
PRODUCTS_PATH = CFG / "products.json"
LOG = CFG / "log.jsonl"

# Hardcoded free-leaning targets + research-probe.json merge at runtime
DEFAULT_TARGETS = [
    ("dynamite", "https://www.dynamite-ai.com/submit"),
    ("submissionweb", "https://www.submissionwebdirectory.com/submit.php"),
    ("ninesites", "https://9sites.net/addurl.php"),
    ("business-software", "https://www.business-software.com/add-your-product/"),
    ("thestartupinc", "https://www.thestartupinc.com/submit"),
    ("marsx", "https://www.marsx.dev/ai-startups"),
    ("tiny_startups", "https://tally.so/r/wMzP8X"),
    ("startups_fyi", "https://tally.so/r/3lOGLk"),
    ("microlaunch_tally", "https://tally.so/r/mYaR6N"),
    ("fivetaco", "https://fivetaco.com/submit"),
    ("saasaitools", "https://saasaitools.com/join/"),
    ("cipinet", "https://cipinet.com/suggest.php"),
    ("betabound", "https://betabound.com/announce/"),
    ("startupbase", "https://startupbase.io/submit"),
    ("getworm", "https://getworm.com/submit-startup"),
    ("feedough", "https://www.feedough.com/submit-your-startup/"),
    ("techpluto", "https://www.techpluto.com/submit-a-startup/"),
    ("openfuture", "https://openfuture.ai/submit-tool"),
    ("aivalley", "https://aivalley.ai/submit"),
    ("venture_radar", "https://www.ventureradar.com/add_company"),
    ("exactseek", "https://www.exactseek.com/add.html"),
    ("somuch", "https://www.somuch.com/add-url/"),
    ("ezweb", "https://www.ezwebdirectory.com/submit.php"),
    ("alternative_me", "https://alternative.me/how-to/submit-software"),
    ("spotsaas", "https://spotsaas.com/get-listed"),
    ("uneed", "https://www.uneed.best/submit-a-tool"),
    ("fazier", "https://fazier.com/submit"),
    ("killerstartups", "https://www.killerstartups.com/submit/"),
    ("springwise", "https://www.springwise.com/spotted/"),
    ("webrazzi", "https://webrazzi.com/en/startup-form/"),
    ("inc42", "https://inc42.com/startup-submission/"),
    ("americaninno", "https://www.americaninno.com/post-a-startup/"),
    ("paggu", "https://www.paggu.com/submit-your-startup/"),
    ("insidr", "https://www.insidr.ai/submit-tools/"),
    ("promoteproject", "https://promoteproject.com/submit"),
    ("profithunt", "https://profithunt.co/submit"),
    ("poweredbyai", "https://poweredbyai.app/submit"),
    ("topai", "https://topai.tools/submit"),
    ("saasworthy", "https://www.saasworthy.com/offerings"),
    ("growthjunkie", "https://growthjunkie.com/submit"),
    ("thestartupinc2", "https://www.thestartupinc.com/submit"),
    ("benbites", "https://news.bensbites.com/submit"),
    ("crozdesk", "https://vendor.softwareselect.com/user/signup"),
    ("softwaresuggest", "https://www.softwaresuggest.com/vendors/register"),
    ("super_new", "https://linusekenstam.typeform.com/super-new"),
    ("sideprojectors", "https://www.sideprojectors.com/project/new"),
    ("startupinspire", "https://startupinspire.com/dashboard/startup/create"),
    ("taalk", "https://taalk.com/submit-startup/"),
    ("beingguru", "https://beingguru.com/submit-startup/"),
    ("startupwizz", "https://startupwizz.com/submit-a-startup/"),
    ("10words", "https://portal.10words.io/submissions/submit"),
    ("postmake", "https://postmake.io/submit"),
    ("devhunt", "https://devhunt.org/submit"),
    ("smollaunch", "https://smollaunch.com/submit"),
    ("launchingnext", "https://www.launchingnext.com/submit"),
    ("saashub", "https://www.saashub.com/submit"),
    ("alternativeto", "https://alternativeto.net/software/new/"),
    ("peerlist", "https://peerlist.io/launch"),
    ("open-launch", "https://www.open-launch.com/projects/submit"),
    ("startupfa_st", "https://www.startupfa.st/projects/submit"),
    ("toolify", "https://www.toolify.ai/submit"),
    ("futurepedia", "https://www.futurepedia.io/submit-tool"),
    ("futuretools", "https://www.futuretools.io/submit-a-tool"),
    ("startupstash", "https://startupstash.com/add-listing/"),
    ("dang", "https://dang.ai/pricing"),
    ("landbook", "https://land-book.com/submit"),
    ("nocodedevs", "https://www.nocodedevs.com/submit"),
    ("bigstartups", "https://bigstartups.co/submit"),
    ("startuptracker", "https://startuptracker.io/submit"),
    ("startuplister", "https://www.startuplister.com/submit-startup"),
    ("victrays", "https://victrays.com/submit"),
    ("appagg", "https://appagg.com/submit/"),
    ("webapprater", "https://webapprater.com/submit-your-web-application-for-review-html"),
    ("comparasoftware", "https://comparasoftware.com/en/submit"),
    ("projecthatch", "https://projecthatch.co/your-story/"),
    ("thepopularapps", "https://thepopularapps.com/submit-app/"),
]


def load_all_targets() -> list[tuple[str, str]]:
    """Merge DEFAULT_TARGETS with research-probe.json (dedupe by id)."""
    seen: dict[str, str] = {}
    for did, url in DEFAULT_TARGETS:
        seen[did] = url
    probe_path = CFG / "research-probe.json"
    if probe_path.exists():
        try:
            probe = json.loads(probe_path.read_text())
            for r in probe.get("all") or []:
                did = r.get("id")
                url = r.get("url")
                if not did or not url or r.get("cf"):
                    continue
                if did not in seen:
                    seen[did] = url
        except Exception:
            pass
    return list(seen.items())


def log_locked(ev: dict) -> None:
    ev = {"ts": datetime.now(timezone.utc).isoformat(), **ev}
    LOG.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(ev, ensure_ascii=False) + "\n"
    with open(LOG, "a") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            f.write(line)
            f.flush()
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    print(line, end="", flush=True)


def load_success_set() -> set[tuple[str, str]]:
    done: set[tuple[str, str]] = set()
    if not LOG.exists():
        return done
    for line in LOG.read_text().splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (
            r.get("action") == "spray"
            and r.get("status") == "submitted_likely"
            and r.get("directory")
            and r.get("product")
            and r.get("directory") != "techpluto"  # false positives
        ):
            done.add((r["directory"], r["product"]))
    return done


def is_success(body: str, msg: str, after_url: str, filled: int) -> bool:
    low = (body + " " + msg).lower()
    if any(
        k in low
        for k in (
            "thank you",
            "thanks for",
            "submission was successful",
            "successfully submitted",
            "we received",
            "has been sent",
            "pending approval",
            "we'll review",
            "we will review",
            "got your submission",
            "appreciate your",
            "message has been sent",
        )
    ):
        return True
    if "unapproved=" in after_url or "moderation-hash" in after_url:
        return True
    if any(k in after_url.lower() for k in ("thank", "success", "submitted", "done")):
        return True
    return False


def wall_status(page, body: str) -> str | None:
    title = page.title().lower()
    html = page.content().lower()
    if "just a moment" in title or "checking your browser" in body[:400]:
        return "blocked_cloudflare"
    if any(k in html for k in ("cf-turnstile", "g-recaptcha", "h-captcha", "hcaptcha")):
        # soft: still try fill
        return "has_captcha_widget"
    if any(k in body for k in ("sign in", "log in", "continue with google")):
        # only hard wall if almost no form
        try:
            n = page.locator("textarea, input[type=url], input[type=text]").count()
        except Exception:
            n = 0
        if n < 2:
            return "needs_auth"
    return None


def fill_smart(page, prod: dict, email: str, name: str) -> int:
    parts = (name.split() + ["", ""])[:2]
    first, last = parts[0] or "Sarthak", parts[1] or "Agrawal"
    filled = 0
    for el in page.query_selector_all("input, textarea, select"):
        try:
            if not el.evaluate("e => !!(e.offsetParent || e.getClientRects().length)"):
                continue
            tag = el.evaluate("e => e.tagName")
            typ = (el.get_attribute("type") or "text").lower()
            if typ in ("hidden", "submit", "button", "file", "image", "checkbox", "radio", "password"):
                continue
            blob = " ".join(
                [
                    (el.get_attribute("name") or "").lower(),
                    (el.get_attribute("placeholder") or "").lower(),
                    (el.get_attribute("aria-label") or "").lower(),
                    (el.get_attribute("id") or "").lower(),
                    typ,
                ]
            )
            val = None
            if typ == "email" or "email" in blob:
                val = email
            elif typ == "url" or any(k in blob for k in ("website", "url", "link", "http", "homepage", "domain")):
                val = prod["url"]
            elif any(k in blob for k in ("first name", "firstname", "fname")):
                val = first
            elif any(k in blob for k in ("last name", "lastname", "lname", "surname")):
                val = last
            elif any(k in blob for k in ("your name", "full name", "contact", "founder", "maker", "submitter", "author")):
                val = name
            elif any(
                k in blob
                for k in (
                    "company",
                    "startup",
                    "product",
                    "tool",
                    "project",
                    "title",
                    "app name",
                    "business",
                    "site name",
                )
            ):
                val = prod["name"]
            elif any(k in blob for k in ("tagline", "headline", "one line", "short")):
                val = prod["tagline"][:160]
            elif tag == "TEXTAREA" or any(
                k in blob for k in ("desc", "about", "message", "detail", "overview", "pitch", "summary", "comment", "content")
            ):
                val = f"{prod['name']} — {prod['tagline']}. {prod['description'][:500]}"
            elif any(k in blob for k in ("categor", "industry", "niche", "type")):
                val = ", ".join(prod.get("categories", ["Software"])[:3])
            elif any(k in blob for k in ("price", "pricing")):
                val = prod.get("pricing", "Free")
            elif any(k in blob for k in ("keyword", "tags")):
                val = ", ".join(prod.get("categories", [])[:5])
            elif "country" in blob:
                val = "United States"
            elif "name" in blob and "user" not in blob:
                val = prod["name"]
            if not val:
                continue
            if tag == "SELECT":
                try:
                    el.select_option(index=1)
                except Exception:
                    pass
            else:
                el.fill(val)
            filled += 1
        except Exception:
            continue
    try:
        for lab in ("Free", "I agree", "agree", "accept"):
            loc = page.locator(f"label:has-text('{lab}')").first
            if loc.count() and loc.is_visible(timeout=200):
                loc.click(force=True)
    except Exception:
        pass
    return filled


def force_submit(page) -> str:
    try:
        return page.evaluate(
            """() => {
            const forms = [...document.querySelectorAll('form')].sort((a,b) =>
              b.querySelectorAll('input,textarea,select').length -
              a.querySelectorAll('input,textarea,select').length);
            const f = forms[0];
            if (!f) return '';
            const btn = f.querySelector('button[type=submit],input[type=submit]');
            if (btn) { btn.click(); return 'btn'; }
            if (f.requestSubmit) f.requestSubmit(); else f.submit();
            return 'form';
        }"""
        ) or ""
    except Exception:
        return ""


def worker_dir(args: tuple) -> dict:
    """Process one directory: submit all products. Runs in child process."""
    did, url, products, email, name, done_pairs, force = args
    from playwright.sync_api import sync_playwright

    stats = {"likely": 0, "unknown": 0, "blocked": 0, "skip": 0, "error": 0}
    log_locked({"action": "research_spray_start", "directory": did, "url": url, "worker": os.getpid()})

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"],
            )
            ctx = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1360, "height": 1000},
                locale="en-US",
            )
            ctx.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
            )
            page = ctx.new_page()

            for i, prod in enumerate(products):
                if not force and (did, prod["id"]) in done_pairs:
                    stats["skip"] += 1
                    continue
                try:
                    page.goto(url, wait_until="commit", timeout=22000)
                    page.wait_for_timeout(1500)
                    body0 = ""
                    try:
                        body0 = page.inner_text("body")[:1500].lower()
                    except Exception:
                        pass
                    w = wall_status(page, body0)
                    if w in ("blocked_cloudflare", "needs_auth") and i == 0:
                        log_locked(
                            {
                                "action": "spray",
                                "directory": did,
                                "product": prod["id"],
                                "status": w,
                                "worker": os.getpid(),
                            }
                        )
                        log_locked(
                            {
                                "action": "spray_abort_dir",
                                "directory": did,
                                "reason": w,
                                "worker": os.getpid(),
                            }
                        )
                        stats["blocked"] += 1
                        break

                    n = fill_smart(page, prod, email, name)
                    # multi-step (Tally etc.)
                    for _ in range(8):
                        advanced = False
                        for label in ("Next", "Continue", "Submit", "Done"):
                            try:
                                btn = page.locator(f"button:has-text('{label}')").first
                                if btn.count() and btn.is_visible(timeout=250):
                                    fill_smart(page, prod, email, name)
                                    btn.click(force=True)
                                    page.wait_for_timeout(900)
                                    advanced = True
                                    break
                            except Exception:
                                continue
                        if not advanced:
                            break

                    clicked = force_submit(page)
                    page.wait_for_timeout(2200)
                    body = ""
                    try:
                        body = page.inner_text("body")[:2000]
                    except Exception:
                        pass
                    after = page.url
                    msg = ""
                    for sel in (
                        ".elementor-message-success",
                        ".elementor-message",
                        ".wpcf7-mail-sent-ok",
                        ".alert-success",
                        "[role=alert]",
                    ):
                        try:
                            msg = page.locator(sel).first.inner_text(timeout=600)
                            if msg.strip():
                                break
                        except Exception:
                            continue

                    w2 = wall_status(page, body.lower())
                    if is_success(body, msg, after, n):
                        st = "submitted_likely"
                        stats["likely"] += 1
                    elif w2 in ("blocked_cloudflare", "needs_auth") and i == 0:
                        st = w2
                        stats["blocked"] += 1
                        log_locked(
                            {
                                "action": "spray",
                                "directory": did,
                                "product": prod["id"],
                                "filled": n,
                                "status": st,
                                "worker": os.getpid(),
                            }
                        )
                        log_locked(
                            {
                                "action": "spray_abort_dir",
                                "directory": did,
                                "reason": w2,
                                "worker": os.getpid(),
                            }
                        )
                        break
                    elif n == 0 and i == 0:
                        st = "no_form"
                        stats["blocked"] += 1
                        log_locked(
                            {
                                "action": "spray",
                                "directory": did,
                                "product": prod["id"],
                                "status": st,
                                "worker": os.getpid(),
                            }
                        )
                        log_locked(
                            {
                                "action": "spray_abort_dir",
                                "directory": did,
                                "reason": st,
                                "worker": os.getpid(),
                            }
                        )
                        break
                    else:
                        st = "submitted_unknown"
                        stats["unknown"] += 1

                    log_locked(
                        {
                            "action": "spray",
                            "directory": did,
                            "product": prod["id"],
                            "filled": n,
                            "clicked": clicked,
                            "msg": (msg or "")[:120],
                            "status": st,
                            "afterUrl": after[:140],
                            "snippet": ((msg or body)[:160]),
                            "worker": os.getpid(),
                        }
                    )
                except Exception as e:
                    stats["error"] += 1
                    log_locked(
                        {
                            "action": "spray",
                            "directory": did,
                            "product": prod["id"],
                            "status": "error",
                            "error": f"{type(e).__name__}:{e}"[:220],
                            "worker": os.getpid(),
                        }
                    )
                    try:
                        page.close()
                    except Exception:
                        pass
                    page = ctx.new_page()
                time.sleep(0.25)

            browser.close()
    except Exception as e:
        stats["error"] += 1
        log_locked(
            {
                "action": "worker_crash",
                "directory": did,
                "error": f"{type(e).__name__}:{e}"[:250],
                "worker": os.getpid(),
            }
        )

    log_locked(
        {
            "action": "worker_done",
            "directory": did,
            "stats": stats,
            "worker": os.getpid(),
        }
    )
    return {"directory": did, "stats": stats}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=min(8, (os.cpu_count() or 4)))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dirs", default="", help="comma ids; empty=all DEFAULT_TARGETS")
    ap.add_argument("--skip-done-dirs", action="store_true", default=True,
                    help="skip directories already 23/23 confirmed")
    args = ap.parse_args()

    data = json.loads(PRODUCTS_PATH.read_text())
    products = data["products"]
    email = data["contact"]["email"]
    name = data["contact"]["name"]
    done = load_success_set()

    targets = load_all_targets()
    if args.dirs:
        want = set(args.dirs.split(","))
        targets = [t for t in targets if t[0] in want]

    # skip dirs that already have full product set
    if args.skip_done_dirs and not args.force:
        full = set()
        counts: dict[str, set[str]] = {}
        for d, p in done:
            counts.setdefault(d, set()).add(p)
        for d, s in counts.items():
            if len(s) >= len(products):
                full.add(d)
        targets = [t for t in targets if t[0] not in full]
        if full:
            log_locked({"action": "parallel_skip_full_dirs", "dirs": sorted(full)})

    log_locked(
        {
            "action": "parallel_spray_start",
            "workers": args.workers,
            "dirs": [t[0] for t in targets],
            "products": len(products),
            "done_pairs": len(done),
        }
    )

    work = [
        (did, url, products, email, name, done, args.force) for did, url in targets
    ]
    if not work:
        log_locked({"action": "parallel_spray_done", "note": "nothing to do"})
        return 0

    results = []
    # ProcessPoolExecutor: one browser per process
    with ProcessPoolExecutor(max_workers=min(args.workers, len(work))) as ex:
        futs = {ex.submit(worker_dir, w): w[0] for w in work}
        for fut in as_completed(futs):
            did = futs[fut]
            try:
                r = fut.result()
                results.append(r)
                print(f"WORKER_OK {did} {r.get('stats')}", flush=True)
            except Exception as e:
                log_locked(
                    {
                        "action": "worker_future_error",
                        "directory": did,
                        "error": f"{type(e).__name__}:{e}"[:250],
                    }
                )
                print(f"WORKER_ERR {did} {e}", flush=True)

    log_locked(
        {
            "action": "parallel_spray_done",
            "results": results,
            "workers": args.workers,
        }
    )
    return 0


if __name__ == "__main__":
    # Required for macOS spawn safety when using ProcessPoolExecutor
    sys.exit(main())
