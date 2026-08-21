#!/usr/bin/env python3
"""Probe directory submit pages and attempt no-CAPTCHA form fills.

Uses Playwright + AgentMail contact email. Does not solve CAPTCHA/OAuth.
Writes results to config/directory-submissions/log.jsonl
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CFG = ROOT / "config" / "directory-submissions"
PRODUCTS = json.loads((CFG / "products.json").read_text())
DIRECTORIES = json.loads((CFG / "directories.json").read_text())
LOG = CFG / "log.jsonl"
AGENT_EMAIL = PRODUCTS["contact"]["email"]
MAKER_NAME = PRODUCTS["contact"]["name"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_event(event: dict) -> None:
    event = {"ts": utc_now(), **event}
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
    print(json.dumps(event, ensure_ascii=False))


def product_list(priority_max: int = 2):
    return [p for p in PRODUCTS["products"] if p.get("priority", 9) <= priority_max]


def detect_walls(page) -> dict:
    html = page.content().lower()
    text = page.inner_text("body")[:4000].lower() if page.query_selector("body") else ""
    return {
        "captcha": any(
            k in html
            for k in (
                "g-recaptcha",
                "h-captcha",
                "hcaptcha",
                "cf-turnstile",
                "turnstile",
                "recaptcha",
            )
        ),
        "cloudflare": any(
            k in text or k in html
            for k in ("just a moment", "checking your browser", "cf-browser-verification", "attention required")
        ),
        "signin": any(
            k in text
            for k in (
                "sign in with",
                "continue with google",
                "log in to continue",
                "sign in to submit",
                "create an account",
            )
        )
        or bool(page.query_selector('a[href*="login"], a[href*="signin"], button:has-text("Sign in")')),
        "title": page.title(),
        "url": page.url,
    }


def find_fields(page) -> dict:
    """Best-effort map of common form fields."""
    mapping = {}
    candidates = {
        "email": [
            'input[type="email"]',
            'input[name*="email" i]',
            'input[placeholder*="email" i]',
            'input[autocomplete="email"]',
        ],
        "name": [
            'input[name*="name" i]:not([name*="user"]):not([name*="company"])',
            'input[placeholder*="your name" i]',
            'input[name="full_name"]',
            'input[name="maker"]',
            'input[name="founder"]',
        ],
        "product_name": [
            'input[name*="product" i]',
            'input[name*="title" i]',
            'input[placeholder*="product name" i]',
            'input[placeholder*="startup name" i]',
            'input[name="name"]',
        ],
        "url": [
            'input[type="url"]',
            'input[name*="url" i]',
            'input[name*="website" i]',
            'input[name*="link" i]',
            'input[placeholder*="https" i]',
            'input[placeholder*="website" i]',
        ],
        "tagline": [
            'input[name*="tagline" i]',
            'input[name*="headline" i]',
            'input[placeholder*="tagline" i]',
            'input[placeholder*="one-liner" i]',
            'input[placeholder*="short description" i]',
        ],
        "description": [
            'textarea[name*="desc" i]',
            'textarea[name*="about" i]',
            'textarea[placeholder*="description" i]',
            "textarea",
        ],
    }
    for key, sels in candidates.items():
        for sel in sels:
            loc = page.locator(sel).first
            try:
                if loc.count() and loc.is_visible(timeout=300):
                    mapping[key] = sel
                    break
            except Exception:
                continue
    return mapping


def try_fill(page, product: dict, fields: dict) -> list[str]:
    filled = []
    values = {
        "email": AGENT_EMAIL,
        "name": MAKER_NAME,
        "product_name": product["name"],
        "url": product["url"],
        "tagline": product["tagline"][:120],
        "description": product["description"][:1500],
    }
    for key, sel in fields.items():
        if key not in values:
            continue
        try:
            loc = page.locator(sel).first
            loc.click(timeout=1500)
            loc.fill(values[key], timeout=2000)
            filled.append(key)
        except Exception as e:
            filled.append(f"{key}:error:{type(e).__name__}")
    return filled


def try_submit_click(page) -> str:
    for sel in [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit")',
        'button:has-text("Launch")',
        'button:has-text("Add")',
        'button:has-text("Send")',
        'button:has-text("Publish")',
        'button:has-text("Continue")',
    ]:
        loc = page.locator(sel).first
        try:
            if loc.count() and loc.is_visible(timeout=500):
                loc.click(timeout=3000)
                return sel
        except Exception:
            continue
    return ""


def probe_directory(page, directory: dict) -> dict:
    url = directory["submitUrl"]
    result = {
        "directory": directory["id"],
        "submitUrl": url,
        "status": "probed",
    }
    try:
        page.goto(url, wait_until="commit", timeout=30000)
        page.wait_for_timeout(4000)
        walls = detect_walls(page)
        fields = find_fields(page)
        result.update(
            {
                "finalUrl": page.url,
                "title": walls["title"],
                "walls": {k: walls[k] for k in ("captcha", "cloudflare", "signin")},
                "fields": list(fields.keys()),
                "field_selectors": fields,
            }
        )
        if walls["cloudflare"] or walls["captcha"]:
            result["status"] = "blocked"
            result["reason"] = "captcha_or_cloudflare"
        elif walls["signin"] and not fields:
            result["status"] = "needs_auth"
            result["reason"] = "signin_required"
        elif fields:
            result["status"] = "form_visible"
        else:
            result["status"] = "no_form"
            result["reason"] = "no_fillable_fields"
    except Exception as e:
        result["status"] = "error"
        result["error"] = f"{type(e).__name__}: {e}"
    return result


def submit_product(page, directory: dict, product: dict, dry_run: bool) -> dict:
    url = directory["submitUrl"]
    result = {
        "action": "submit",
        "directory": directory["id"],
        "product": product["id"],
        "dry_run": dry_run,
    }
    try:
        page.goto(url, wait_until="commit", timeout=30000)
        page.wait_for_timeout(4000)
        walls = detect_walls(page)
        if walls["cloudflare"] or walls["captcha"]:
            result["status"] = "blocked"
            result["reason"] = "captcha_or_cloudflare"
            result["walls"] = walls
            return result
        if walls["signin"]:
            # still try if fields exist
            pass
        fields = find_fields(page)
        if not fields:
            result["status"] = "no_form"
            result["title"] = walls["title"]
            result["walls"] = {k: walls[k] for k in ("captcha", "cloudflare", "signin")}
            return result
        filled = try_fill(page, product, fields)
        result["filled"] = filled
        result["fields"] = list(fields.keys())
        if dry_run:
            result["status"] = "dry_run_filled"
            return result
        clicked = try_submit_click(page)
        page.wait_for_timeout(3000)
        result["clicked"] = clicked
        walls_after = detect_walls(page)
        result["afterUrl"] = page.url
        result["afterTitle"] = walls_after["title"]
        # Heuristic success
        body = ""
        try:
            body = page.inner_text("body")[:2000].lower()
        except Exception:
            pass
        if any(
            k in body
            for k in (
                "thank you",
                "thanks for",
                "submitted",
                "under review",
                "we received",
                "success",
                "check your email",
                "verify your email",
                "confirmation",
            )
        ):
            result["status"] = "submitted_likely"
        elif walls_after["captcha"]:
            result["status"] = "blocked_on_submit"
            result["reason"] = "captcha_after_fill"
        elif not clicked:
            result["status"] = "filled_no_submit_button"
        else:
            result["status"] = "submitted_unknown"
            result["body_snippet"] = body[:300]
    except Exception as e:
        result["status"] = "error"
        result["error"] = f"{type(e).__name__}: {e}"
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["probe", "submit"], default="probe")
    ap.add_argument("--priority-max", type=int, default=1, help="Max product priority (1=flagship)")
    ap.add_argument("--dirs", default="", help="Comma-separated directory ids; empty=all try/auto")
    ap.add_argument("--products", default="", help="Comma-separated product ids")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--limit", type=int, default=50)
    args = ap.parse_args()

    dirs = DIRECTORIES["directories"]
    if args.dirs:
        want = set(args.dirs.split(","))
        dirs = [d for d in dirs if d["id"] in want]
    elif args.mode == "submit":
        dirs = [d for d in dirs if d.get("automation") in ("try", "auto")]

    products = product_list(args.priority_max)
    if args.products:
        wantp = set(args.products.split(","))
        products = [p for p in PRODUCTS["products"] if p["id"] in wantp]

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=not args.headed,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )
        page = context.new_page()
        count = 0
        if args.mode == "probe":
            for d in dirs:
                if count >= args.limit:
                    break
                r = probe_directory(page, d)
                log_event(r)
                count += 1
                time.sleep(1.2)
        else:
            for d in dirs:
                for product in products:
                    if count >= args.limit:
                        break
                    r = submit_product(page, d, product, dry_run=args.dry_run)
                    log_event(r)
                    count += 1
                    time.sleep(2.0)
                if count >= args.limit:
                    break
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
