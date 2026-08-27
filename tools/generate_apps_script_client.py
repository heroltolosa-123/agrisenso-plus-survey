#!/usr/bin/env python3
"""
Regenerates the Apps Script copies of the client from the docs/ originals.

docs/app.js + docs/style.css are the single source of truth. The Apps
Script project needs the same code with two mechanical substitutions:

  * transport   — fetch() against APPS_SCRIPT_URL  ->  google.script.run
  * asset URLs  — url("assets/x.jpg")              ->  var(--x-image)
                  (Assets.html base64-embeds the two brand images)

Doing this by hand is how the two copies drift, so it lives in the
pipeline instead. Run it after every docs/app.js or docs/style.css
change, before pasting src/* into the live Apps Script project.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

JS_HEADER = """// =====================================================================
// AGRISENSO Plus Baseline Survey — client script
// This copy runs on the Apps Script /exec page itself (google.script.run).
// The standalone site (docs/app.js) is the same logic talking to this
// same backend over fetch() instead.
//
// GENERATED FILE — do not edit by hand. Regenerate with:
//     python3 tools/generate_apps_script_client.py
// =====================================================================
"""

BACKEND_CONFIGURED_SRC = """  function backendConfigured() {
    return typeof APPS_SCRIPT_URL === 'string' &&
      APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === -1 &&
      APPS_SCRIPT_URL.indexOf('http') === 0;
  }
"""
BACKEND_CONFIGURED_GS = """  // Apps Script fallback page: the backend is always this same script,
  // so it's always "configured" — and calls go through google.script.run
  // instead of fetch().
  function backendConfigured() {
    return true;
  }
"""


def replace_function(source, signature, replacement):
    """Swap out one brace-balanced top-level function by its signature."""
    start = source.index(signature)
    i = source.index("{", start)
    depth, j = 0, i
    while True:
        if source[j] == "{":
            depth += 1
        elif source[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return source[:start] + replacement + source[j + 1:]


def build_javascript_html(app_js):
    body = app_js

    # Header comment (everything up to the opening IIFE).
    iife = "(function () {\n"
    if iife not in body:
        raise SystemExit("docs/app.js: expected an opening '(function () {' IIFE wrapper")
    body = JS_HEADER + body[body.index(iife) + len(iife):]

    # Closing IIFE.
    tail = "})();"
    if not body.rstrip().endswith(tail):
        raise SystemExit("docs/app.js: expected a closing '})();'")
    body = body.rstrip()[: -len(tail)].rstrip("\n")

    # Transport.
    body = body.replace(BACKEND_CONFIGURED_SRC, BACKEND_CONFIGURED_GS)
    if BACKEND_CONFIGURED_GS not in body:
        raise SystemExit("docs/app.js: backendConfigured() no longer matches the expected text")

    body = replace_function(body, "  function apiGetSchema(key) {", """  function apiGetSchema(key) {
    return new Promise(function (resolve, reject) {
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getSchema(key);
    });
  }""")
    body = replace_function(body, "  function apiSubmit(instrumentKey, values) {", """  function apiSubmit(instrumentKey, values) {
    return new Promise(function (resolve, reject) {
      google.script.run.withSuccessHandler(function (res) {
        if (res && res.ok === false) { reject(new Error(res.error || 'Unknown server error')); return; }
        resolve(res);
      }).withFailureHandler(reject).submitResponse(instrumentKey, values);
    });
  }""")

    # The API-calls banner comment refers to fetch(); drop it.
    body = body.replace("""  // ---------------------------------------------------------------
  // API calls
  // ---------------------------------------------------------------
""", "")

    return "<script>\n" + body + "\n</script>\n"


def build_stylesheet_html(style_css):
    css = style_css
    css = css.replace('url("assets/background.jpg")', "var(--bg-image)")
    css = css.replace('var(--banner-image, url("assets/banner.jpg"))', "var(--banner-image)")
    if 'url("assets/' in css:
        leftover = re.findall(r'url\("assets/[^"]+"\)', css)
        raise SystemExit("docs/style.css: unmapped asset reference(s): " + ", ".join(leftover))
    header = ("/* GENERATED FILE — do not edit by hand.\n"
              "   Regenerate with: python3 tools/generate_apps_script_client.py */\n")
    return "<style>\n" + header + css.rstrip("\n") + "\n</style>\n"


def main():
    app_js = (ROOT / "docs" / "app.js").read_text(encoding="utf-8")
    style_css = (ROOT / "docs" / "style.css").read_text(encoding="utf-8")

    (ROOT / "src" / "JavaScript.html").write_text(build_javascript_html(app_js), encoding="utf-8")
    (ROOT / "src" / "Stylesheet.html").write_text(build_stylesheet_html(style_css), encoding="utf-8")
    print("regenerated src/JavaScript.html and src/Stylesheet.html from docs/")


if __name__ == "__main__":
    sys.exit(main())
