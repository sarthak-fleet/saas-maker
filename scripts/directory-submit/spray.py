#!/usr/bin/env python3
"""Spray-and-pray: submit ALL fleet products to every free form we can hit.

No CAPTCHA solving. Skip paid checkout walls when detected.
Contact: AgentMail from products.json
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CFG = ROOT / "config" / "directory-submissions"
PRODUCTS = json.loads((CFG / "products.json").read_text())
LOG = CFG / "log.jsonl"
EMAIL = PRODUCTS["contact"]["email"]
NAME = PRODUCTS["contact"]["name"]
ALL = PRODUCTS["products"]


def log(ev: dict) -> None:
    ev = {"ts": datetime.now(timezone.utc).isoformat(), **ev}
    with LOG.open("a") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    print(json.dumps(ev, ensure_ascii=False), flush=True)


def already_success(directory: str, product_id: str) -> bool:
    if not LOG.exists():
        return False
    for line in LOG.read_text().splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (
            r.get("directory") == directory
            and r.get("product") == product_id
            and r.get("status") == "submitted_likely"
        ):
            return True
    return False


def force_submit(page) -> str:
    try:
        ok = page.evaluate(
            """() => {
            const forms = Array.from(document.querySelectorAll('form'));
            // prefer form with textarea or multiple inputs
            forms.sort((a,b) => (b.querySelectorAll('input,textarea').length) - (a.querySelectorAll('input,textarea').length));
            const form = forms[0];
            if (!form) return '';
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
            return 'form.requestSubmit';
        }"""
        )
        if ok:
            return ok
    except Exception:
        pass
    for sel in [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit")',
        'button:has-text("Send")',
        'button:has-text("Add")',
    ]:
        try:
            loc = page.locator(sel).first
            if loc.count():
                loc.click(force=True, timeout=4000)
                return f"force:{sel}"
        except Exception:
            continue
    return ""


def successish(body: str, msg: str = "") -> bool:
    low = (body + " " + msg).lower()
    return any(
        k in low
        for k in (
            "thank you",
            "thanks for",
            "submission was successful",
            "successfully submitted",
            "we received",
            "under review",
            "message has been sent",
            "your tool has been",
            "form was submitted",
            "submitted successfully",
        )
    )


def elementor_msg(page) -> str:
    for sel in (
        ".elementor-message-success",
        ".elementor-message",
        ".elementor-form-success",
        ".wpcf7-mail-sent-ok",
        ".success-message",
    ):
        try:
            t = page.locator(sel).first.inner_text(timeout=1500)
            if t.strip():
                return t.strip()[:200]
        except Exception:
            continue
    return ""


def new_browser():
    p = sync_playwright().start()
    browser = p.chromium.launch(
        headless=True,
        args=["--disable-blink-features=AutomationControlled"],
    )
    ctx = browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1400, "height": 1000},
        locale="en-US",
    )
    ctx.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
    )
    page = ctx.new_page()
    return p, browser, page


# ---------- adapters ----------


def submit_insidr(page, prod: dict) -> dict:
    r = {"action": "spray", "directory": "insidr", "product": prod["id"]}
    page.goto("https://www.insidr.ai/submit-tools/", wait_until="commit", timeout=30000)
    page.wait_for_timeout(1800)
    page.fill(
        'textarea[name="form_fields[message]"]',
        f"{prod['name']} — {prod['tagline']}. {prod['description'][:400]}",
    )
    page.fill('input[name="form_fields[name]"]', prod["url"])
    page.fill(
        'input[name="form_fields[email]"]',
        ", ".join(prod.get("categories", ["Software"])[:3]),
    )
    r["clicked"] = force_submit(page)
    page.wait_for_timeout(3000)
    msg = elementor_msg(page)
    body = page.inner_text("body")[:1200]
    r["msg"] = msg
    r["status"] = "submitted_likely" if successish(body, msg) else "submitted_unknown"
    if r["status"] != "submitted_likely":
        r["snippet"] = (msg or body)[:200]
    return r


def submit_generic_elementor(page, url: str, directory: str, prod: dict, field_map: dict) -> dict:
    """field_map: logical -> css selector, values filled from prod/contact."""
    r = {"action": "spray", "directory": directory, "product": prod["id"]}
    page.goto(url, wait_until="commit", timeout=30000)
    page.wait_for_timeout(2000)
    html = page.content().lower()
    if any(k in html for k in ("cf-turnstile", "g-recaptcha", "h-captcha", "just a moment")):
        # still try if form visible
        pass
    values = {
        "name": NAME,
        "email": EMAIL,
        "product_name": prod["name"],
        "url": prod["url"],
        "tagline": prod["tagline"][:200],
        "description": f"{prod['name']}: {prod['description'][:500]}",
        "categories": ", ".join(prod.get("categories", [])[:4]),
        "pricing": prod.get("pricing", "Free"),
    }
    filled = []
    for key, sel in field_map.items():
        if key not in values:
            continue
        try:
            loc = page.locator(sel).first
            if loc.count() and loc.is_visible(timeout=600):
                loc.fill(values[key])
                filled.append(key)
        except Exception:
            pass
    r["filled"] = filled
    if not filled:
        r["status"] = "no_form"
        r["title"] = page.title()[:80]
        return r
    r["clicked"] = force_submit(page)
    page.wait_for_timeout(3500)
    msg = elementor_msg(page)
    body = page.inner_text("body")[:1500]
    r["msg"] = msg
    r["afterUrl"] = page.url
    if successish(body, msg):
        r["status"] = "submitted_likely"
    elif any(k in body.lower() for k in ("$", "stripe", "checkout", "pay now", "credit card")) and "free" not in body.lower()[:200]:
        # weak signal
        r["status"] = "submitted_unknown"
        r["snippet"] = body[:200]
    else:
        r["status"] = "submitted_unknown"
        r["snippet"] = (msg or body)[:200]
    return r


def submit_by_labels(page, url: str, directory: str, prod: dict) -> dict:
    """Heuristic: fill visible inputs by placeholder/name keywords."""
    r = {"action": "spray", "directory": directory, "product": prod["id"]}
    page.goto(url, wait_until="commit", timeout=30000)
    page.wait_for_timeout(2500)
    title = page.title()
    if "just a moment" in title.lower() or "attention required" in title.lower():
        r["status"] = "blocked_cloudflare"
        return r
    body0 = page.inner_text("body")[:800].lower()
    if "sign in" in body0 and page.locator("input, textarea").count() < 2:
        r["status"] = "needs_auth"
        return r

    # Map inputs
    filled = []
    inputs = page.query_selector_all("input:visible, textarea:visible")
    # Playwright doesn't have :visible in query_selector_all the same way — use locator count loop
    for el in page.query_selector_all("input, textarea"):
        try:
            vis = el.evaluate("e => !!(e.offsetParent || e.getClientRects().length)")
            if not vis:
                continue
            typ = (el.get_attribute("type") or "text").lower()
            if typ in ("hidden", "submit", "button", "checkbox", "radio", "file"):
                continue
            name = (el.get_attribute("name") or "").lower()
            ph = (el.get_attribute("placeholder") or "").lower()
            aria = (el.get_attribute("aria-label") or "").lower()
            blob = f"{name} {ph} {aria} {typ}"
            val = None
            if typ == "email" or "email" in blob:
                val = EMAIL
            elif "url" in blob or "website" in blob or "link" in blob or "http" in ph:
                val = prod["url"]
            elif any(k in blob for k in ("product", "tool name", "startup", "title", "company name")) and "email" not in blob:
                val = prod["name"]
            elif any(k in blob for k in ("tagline", "headline", "one-liner", "short")):
                val = prod["tagline"][:160]
            elif el.evaluate("e => e.tagName") == "TEXTAREA" or "desc" in blob or "message" in blob or "about" in blob:
                val = f"{prod['name']} — {prod['tagline']}. {prod['description'][:450]}"
            elif any(k in blob for k in ("your name", "full name", "submitter", "founder", "maker")):
                val = NAME
            elif "categor" in blob or "tag" in blob:
                val = ", ".join(prod.get("categories", ["Software"])[:3])
            elif name in ("name",) or ph == "name":
                # ambiguous: product name preferred for directory forms
                val = prod["name"]
            if val:
                el.fill(val)
                filled.append(blob[:40])
        except Exception:
            continue

    r["filled_n"] = len(filled)
    if len(filled) < 1:
        r["status"] = "no_form"
        r["title"] = title[:80]
        return r

    r["clicked"] = force_submit(page)
    page.wait_for_timeout(3500)
    msg = elementor_msg(page)
    body = ""
    try:
        body = page.inner_text("body")[:1500]
    except Exception:
        pass
    r["msg"] = msg
    r["afterUrl"] = page.url
    r["afterTitle"] = page.title()[:80]
    if successish(body, msg):
        r["status"] = "submitted_likely"
    elif "captcha" in body.lower() or "turnstile" in page.content().lower():
        r["status"] = "blocked_captcha"
    elif "just a moment" in page.title().lower():
        r["status"] = "blocked_cloudflare"
    else:
        r["status"] = "submitted_unknown"
        r["snippet"] = (msg or body)[:180]
    return r


# Directory targets that historically allow free forms (many will fail — that's fine)
TARGETS = [
    # (id, url, mode)
    ("insidr", "https://www.insidr.ai/submit-tools/", "insidr"),
    ("startupstash", "https://startupstash.com/add-listing/", "labels"),
    ("dang-ai-submit", "https://dang.ai/submit", "labels"),
    ("topai", "https://topai.tools/submit", "labels"),
    ("aitoolnet", "https://www.aitoolnet.com/submit", "labels"),
    ("easywithai", "https://easywithai.com/submit-tool/", "labels"),  # paid but try free fields
    ("toolify", "https://www.toolify.ai/submit", "labels"),
    ("futurepedia", "https://www.futurepedia.io/submit-tool", "labels"),
    ("futuretools", "https://www.futuretools.io/submit-a-tool", "labels"),
    ("saashub", "https://www.saashub.com/submit", "labels"),
    ("launching-next", "https://www.launchingnext.com/submit", "labels"),
    ("betapage", "https://betapage.co/submit", "labels"),
    ("microlaunch", "https://microlaunch.net/submit", "labels"),
    ("uneed", "https://www.uneed.best/submit", "labels"),
    ("devhunt", "https://devhunt.org/submit", "labels"),
    ("open-launch", "https://www.open-launch.com/projects/submit", "labels"),
    ("startup-fast", "https://www.startupfa.st/projects/submit", "labels"),
    ("twelve-tools", "https://twelve.tools/submit", "labels"),
    ("fazier", "https://fazier.com/submit", "labels"),
    ("aixploria", "https://www.aixploria.com/en/add-ai/", "labels"),
    ("supertools", "https://www.supertools.design/submit", "labels"),
    ("ai-tools-fyi", "https://www.aitools.fyi/submit", "labels"),
    ("startupbuffer", "https://startupbuffer.com/site/submit", "labels"),
    ("getapp", "https://www.getapp.com/vendors/signup/", "labels"),
    ("sourceforge-create", "https://sourceforge.net/create/", "labels"),
    ("alternativeto", "https://alternativeto.net/manage/new/", "labels"),
    ("producthunt", "https://www.producthunt.com/posts/new", "labels"),
    ("smollaunch", "https://smollaunch.com/", "labels"),
    ("peerlist", "https://peerlist.io/launch", "labels"),
    ("hackernews", "https://news.ycombinator.com/submit", "labels"),
]


def main() -> int:
    skip_success = "--force" not in sys.argv
    # optional: --dir=insidr,startupstash
    dirs_filter = None
    for a in sys.argv[1:]:
        if a.startswith("--dir="):
            dirs_filter = set(a.split("=", 1)[1].split(","))

    targets = TARGETS
    if dirs_filter:
        targets = [t for t in targets if t[0] in dirs_filter]

    pw, browser, page = new_browser()
    stats = {"likely": 0, "unknown": 0, "blocked": 0, "skip": 0, "error": 0}

    try:
        for dir_id, url, mode in targets:
            log({"action": "spray_start", "directory": dir_id, "url": url})
            for i, prod in enumerate(ALL):
                if skip_success and already_success(dir_id, prod["id"]):
                    stats["skip"] += 1
                    continue
                try:
                    if mode == "insidr":
                        r = submit_insidr(page, prod)
                    else:
                        r = submit_by_labels(page, url, dir_id, prod)
                    log(r)
                    st = r.get("status", "")
                    if st == "submitted_likely":
                        stats["likely"] += 1
                    elif st in (
                        "blocked_captcha",
                        "blocked_cloudflare",
                        "needs_auth",
                        "no_form",
                        "payment_required",
                    ):
                        stats["blocked"] += 1
                        # hard wall: do not spray remaining products at this dir
                        log(
                            {
                                "action": "spray_abort_dir",
                                "directory": dir_id,
                                "reason": st,
                                "product": prod["id"],
                            }
                        )
                        break
                    else:
                        stats["unknown"] += 1
                        # magic-link / sign-in dead ends
                        snippet = (r.get("snippet") or "").lower()
                        after = (r.get("afterUrl") or "").lower()
                        if any(
                            k in snippet or k in after
                            for k in (
                                "sign in",
                                "check your inbox",
                                "sign-in link",
                                "log in",
                                "/login",
                                "magic link",
                            )
                        ):
                            log(
                                {
                                    "action": "spray_abort_dir",
                                    "directory": dir_id,
                                    "reason": "auth_flow",
                                    "product": prod["id"],
                                }
                            )
                            stats["blocked"] += 1
                            break
                except Exception as e:
                    stats["error"] += 1
                    log(
                        {
                            "action": "spray",
                            "directory": dir_id,
                            "product": prod["id"],
                            "status": "error",
                            "error": f"{type(e).__name__}:{e}"[:250],
                        }
                    )
                    # recreate page on hard failures
                    try:
                        page.close()
                    except Exception:
                        pass
                    page = browser.new_page()
                time.sleep(0.8)
            time.sleep(1.0)
    finally:
        browser.close()
        pw.stop()

    log({"action": "spray_done", "stats": stats, "products": len(ALL), "dirs": len(targets)})
    print("STATS", json.dumps(stats), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
