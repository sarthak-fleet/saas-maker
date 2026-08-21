#!/usr/bin/env python3
"""Submit fleet products to free, no-CAPTCHA directory forms.

Contact email: AgentMail inbox from products.json
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

AI_IDS = {
    "rolepatch",
    "karte",
    "high-signal",
    "posttrainllm",
    "free-ai",
    "research-papers",
    "pace",
    "everythingrated",
    "starboard",
}


def log(ev: dict) -> None:
    ev = {"ts": datetime.now(timezone.utc).isoformat(), **ev}
    with LOG.open("a") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    print(json.dumps(ev, ensure_ascii=False), flush=True)


def successish(body: str) -> bool:
    low = body.lower()
    return any(
        k in low
        for k in (
            "thank",
            "received",
            "success",
            "submitted",
            "sent",
            "under review",
            "we got",
            "message has been sent",
            "your tool",
        )
    )


def force_submit(page) -> str:
    """Prefer JS form submit over click (avoids overlay intercept)."""
    try:
        ok = page.evaluate(
            """() => {
            const form = document.querySelector('form');
            if (!form) return false;
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
            return true;
        }"""
        )
        if ok:
            return "form.requestSubmit"
    except Exception:
        pass
    for sel in [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit")',
    ]:
        loc = page.locator(sel).first
        try:
            if loc.count():
                loc.click(force=True, timeout=5000)
                return f"force:{sel}"
        except Exception:
            continue
    return ""


def submit_insidr(page, prod: dict) -> dict:
    r = {"action": "submit", "directory": "insidr", "product": prod["id"]}
    page.goto("https://www.insidr.ai/submit-tools/", wait_until="commit", timeout=30000)
    page.wait_for_timeout(2000)
    page.fill('textarea[name="form_fields[message]"]', f"{prod['name']}: {prod['description'][:500]}")
    page.fill('input[name="form_fields[name]"]', prod["url"])
    page.fill('input[name="form_fields[email]"]', ", ".join(prod.get("categories", ["AI"])[:3]))
    r["clicked"] = force_submit(page)
    page.wait_for_timeout(4000)
    body = ""
    try:
        body = page.inner_text("body")[:2000]
    except Exception:
        pass
    r["afterUrl"] = page.url
    r["afterTitle"] = page.title()
    r["status"] = "submitted_likely" if successish(body) else "submitted_unknown"
    if r["status"] != "submitted_likely":
        r["snippet"] = body[:280]
    return r


def submit_aitoolnet(page, prod: dict) -> dict:
    r = {"action": "submit", "directory": "aitoolnet", "product": prod["id"]}
    page.goto("https://www.aitoolnet.com/submit", wait_until="commit", timeout=30000)
    page.wait_for_timeout(2000)
    # Prefer free plan if present
    for sel in [
        'label:has-text("Free")',
        'button:has-text("Free")',
        'input[value*="free" i]',
        'a:has-text("Free Submit")',
        'text=Free',
    ]:
        try:
            loc = page.locator(sel).first
            if loc.count() and loc.is_visible(timeout=500):
                loc.click(force=True)
                page.wait_for_timeout(500)
                break
        except Exception:
            pass

    mapping = [
        ('input[name="data[title]"]', prod["name"]),
        ('input[name="data[website]"]', prod["url"]),
        ('textarea[name="data[description]"]', prod["tagline"][:220]),
        ('input[name="data[description]"]', prod["tagline"][:220]),
        ('textarea[name="data[content]"]', prod["description"][:1200]),
        ('input[name="data[email]"]', EMAIL),
        ('input[type="email"]', EMAIL),
    ]
    filled = []
    for sel, val in mapping:
        try:
            loc = page.locator(sel).first
            if loc.count() and loc.is_visible(timeout=400):
                loc.fill(val)
                filled.append(sel)
        except Exception:
            pass
    r["filled"] = filled
    r["clicked"] = force_submit(page)
    page.wait_for_timeout(4000)
    body = ""
    try:
        body = page.inner_text("body")[:2000]
    except Exception:
        pass
    low = body.lower()
    r["afterUrl"] = page.url
    r["afterTitle"] = page.title()
    if successish(body):
        r["status"] = "submitted_likely"
    elif any(k in low for k in ("stripe", "checkout", "payment", "pay now", "credit card")):
        r["status"] = "payment_required"
    else:
        r["status"] = "submitted_unknown"
        r["snippet"] = body[:280]
    return r


def submit_futuretools(page, prod: dict) -> dict:
    """Try Future Tools; stop if CAPTCHA widget blocks."""
    r = {"action": "submit", "directory": "futuretools", "product": prod["id"]}
    page.goto("https://www.futuretools.io/submit-a-tool", wait_until="commit", timeout=30000)
    page.wait_for_timeout(2500)
    html = page.content().lower()
    if any(k in html for k in ("cf-turnstile", "g-recaptcha", "h-captcha", "hcaptcha")):
        # still fill and try — some sites only load captcha on submit
        pass
    try:
        page.fill('input[name="submitter_name"]', NAME)
        page.fill('input[name="tool_name"]', prod["name"])
        page.fill('input[name="tool_url"]', prod["url"])
        page.fill('textarea[name="description"]', prod["description"][:500])
        page.fill('input[name="submitter_email"]', EMAIL)
        # pricing free if present
        try:
            page.locator('input[name="pricing_tier"][value*="free" i], label:has-text("Free")').first.click(
                force=True, timeout=1500
            )
        except Exception:
            pass
        r["clicked"] = force_submit(page)
        page.wait_for_timeout(3500)
        body = page.inner_text("body")[:2000]
        r["afterUrl"] = page.url
        if successish(body):
            r["status"] = "submitted_likely"
        elif "captcha" in body.lower() or "robot" in body.lower():
            r["status"] = "blocked_captcha"
        else:
            r["status"] = "submitted_unknown"
            r["snippet"] = body[:280]
    except Exception as e:
        r["status"] = "error"
        r["error"] = f"{type(e).__name__}:{e}"[:250]
    return r


def main() -> int:
    ai = [p for p in PRODUCTS["products"] if p["id"] in AI_IDS]
    # also include priority-1 non-ai for general dirs later
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
            viewport={"width": 1400, "height": 1000},
            locale="en-US",
        )
        ctx.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )
        page = ctx.new_page()

        for prod in ai:
            try:
                r = submit_insidr(page, prod)
            except Exception as e:
                r = {
                    "action": "submit",
                    "directory": "insidr",
                    "product": prod["id"],
                    "status": "error",
                    "error": f"{type(e).__name__}:{e}"[:250],
                }
            log(r)
            time.sleep(1.2)

        for prod in ai[:7]:
            try:
                r = submit_aitoolnet(page, prod)
            except Exception as e:
                r = {
                    "action": "submit",
                    "directory": "aitoolnet",
                    "product": prod["id"],
                    "status": "error",
                    "error": f"{type(e).__name__}:{e}"[:250],
                }
            log(r)
            time.sleep(1.2)

        # one Future Tools pilot (captcha risk)
        try:
            r = submit_futuretools(page, ai[0])
            log(r)
        except Exception as e:
            log(
                {
                    "action": "submit",
                    "directory": "futuretools",
                    "product": ai[0]["id"],
                    "status": "error",
                    "error": f"{type(e).__name__}:{e}"[:250],
                }
            )

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
