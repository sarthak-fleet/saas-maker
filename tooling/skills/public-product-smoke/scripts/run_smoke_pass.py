#!/usr/bin/env python3
"""Bounded live browser smoke pass for public-product-smoke.

Reads the manifest produced by build-audit-manifest.mjs and, for each
included product, drives a real headless Chromium session against its
canonical origin: records load status, console errors, blank-page and
rate-limit evidence, and attempts one safe interaction (search box or a
non-mutating nav link). Emits one JSON object per line to stdout so a
partial run is still usable if interrupted.

Read-only. Never signs in, submits forms, or repeats a rate-limited request.
"""
import glob
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

NAV_TIMEOUT_MS = 20000
HYDRATION_WAIT_MS = 3000
BLANK_TEXT_THRESHOLD = 40
RATE_LIMIT_MARKERS = [
    "checking your browser",
    "just a moment",
    "cf-browser-verification",
    "attention required",
    "access denied",
    "rate limit",
    "too many requests",
]
MUTATING_HREF_MARKERS = [
    "signup", "sign-up", "register", "login", "sign-in", "signin",
    "checkout", "buy", "purchase", "subscribe", "unsubscribe", "logout",
    "delete", "cart", "billing", "upgrade", "pay",
]


def is_mutating(href):
    if not href:
        return True
    h = href.lower()
    return any(marker in h for marker in MUTATING_HREF_MARKERS)


def find_second_surface(page, origin):
    try:
        links = page.eval_on_selector_all(
            "a[href]",
            "els => els.map(e => ({href: e.href, text: (e.innerText||'').trim()}))"
                " .filter(l => l.text && l.text.length < 60)",
        )
    except Exception:
        return None
    seen = set()
    for link in links:
        href = link.get("href", "")
        text = link.get("text", "")
        if not href.startswith(origin):
            continue
        if href.rstrip("/") == origin.rstrip("/"):
            continue
        if is_mutating(href):
            continue
        if href in seen:
            continue
        seen.add(href)
        return {"href": href, "text": text}
    return None


def try_interaction(page):
    """Attempt one safe interaction: a search box, else a safe nav click."""
    try:
        search = page.query_selector(
            "input[type=search], input[role=searchbox], "
            "input[aria-label*=earch i], input[placeholder*=earch i]"
        )
        if search:
            search.click(timeout=3000)
            search.fill("test")
            page.keyboard.press("Enter")
            page.wait_for_timeout(2000)
            return {"kind": "search", "detail": "typed 'test' into search field, pressed Enter"}
    except Exception as exc:
        return {"kind": "search", "error": str(exc)}

    try:
        origin = page.url.split("/", 3)
        origin = "/".join(origin[:3])
        candidates = page.query_selector_all("button, a[href]")
        for el in candidates[:60]:
            text = (el.inner_text() or "").strip().lower()
            if not text or len(text) > 40 or "\n" in text:
                continue
            href = el.get_attribute("href") or ""
            if is_mutating(href) or is_mutating(text):
                continue
            if text in ("home", "menu", "skip to content"):
                continue
            if href and href.rstrip("/") in (origin, origin + "/"):
                continue
            el.click(timeout=3000)
            page.wait_for_timeout(1500)
            return {"kind": "click", "detail": f"clicked control labeled '{text}'"}
    except Exception as exc:
        return {"kind": "click", "error": str(exc)}
    return {"kind": "none", "detail": "no safe interaction candidate found"}


def audit_product(browser, product):
    url = product["urls"][0]
    result = {
        "project": product["id"],
        "repo": product.get("repo"),
        "authModel": product["authModel"],
        "url": url,
        "guestState": "unknown",
        "httpStatus": None,
        "finalUrl": None,
        "title": None,
        "bodyTextLength": None,
        "blank": None,
        "consoleErrors": [],
        "rateLimitEvidence": [],
        "secondSurface": None,
        "interaction": None,
        "loadMs": None,
        "error": None,
    }
    context = browser.new_context(ignore_https_errors=False)
    page = context.new_page()
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: console_errors.append(f"pageerror: {exc}"))

    start = time.time()
    try:
        response = page.goto(url, timeout=NAV_TIMEOUT_MS, wait_until="domcontentloaded")
        page.wait_for_timeout(HYDRATION_WAIT_MS)
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        result["loadMs"] = int((time.time() - start) * 1000)
        result["httpStatus"] = response.status if response else None
        result["finalUrl"] = page.url
        result["title"] = page.title()
        body_text = page.inner_text("body") if page.query_selector("body") else ""
        result["bodyTextLength"] = len(body_text.strip())
        result["blank"] = result["bodyTextLength"] < BLANK_TEXT_THRESHOLD
        result["guestState"] = "guest"

        lowered = (body_text + " " + (result["title"] or "")).lower()
        for marker in RATE_LIMIT_MARKERS:
            if marker in lowered:
                result["rateLimitEvidence"].append(marker)

        if result["httpStatus"] == 429:
            result["rateLimitEvidence"].append("http-429")

        if not result["rateLimitEvidence"] and not result["blank"]:
            second = find_second_surface(page, url)
            result["secondSurface"] = second
            if second:
                try:
                    page.goto(second["href"], timeout=NAV_TIMEOUT_MS, wait_until="domcontentloaded")
                    page.wait_for_timeout(1500)
                    second["status_ok"] = True
                    second["title"] = page.title()
                except Exception as exc:
                    second["status_ok"] = False
                    second["error"] = str(exc)

            result["interaction"] = try_interaction(page)

    except Exception as exc:
        result["error"] = str(exc)
    finally:
        result["consoleErrors"] = console_errors[:10]
        context.close()

    return result


def find_chrome_executable():
    """The playwright pip package's expected browser revision can drift from
    what's actually cached on disk. Prefer an already-installed full Chromium
    build over triggering a network download."""
    pattern = os.path.expanduser(
        "~/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/"
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    )
    matches = sorted(glob.glob(pattern))
    return matches[-1] if matches else None


def main():
    manifest = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else json.load(sys.stdin)
    only_ids = set(sys.argv[2].split(",")) if len(sys.argv) > 2 and sys.argv[2] else None

    launch_kwargs = {"headless": True}
    chrome_path = find_chrome_executable()
    if chrome_path:
        launch_kwargs["executable_path"] = chrome_path

    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch_kwargs)
        for product in manifest["products"]:
            if only_ids and product["id"] not in only_ids:
                continue
            res = audit_product(browser, product)
            print(json.dumps(res), flush=True)
        browser.close()


if __name__ == "__main__":
    main()
