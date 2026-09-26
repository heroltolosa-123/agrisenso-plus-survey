#!/usr/bin/env python3
"""
Regenerates the two copies of the questionnaire schema:

  src/Schema_A.gs / Schema_B.gs   for the Apps Script backend
  docs/schema_A.json / _B.json    served as static files by the website

The static copies exist for speed. Fetching the schema from Apps Script
costs 1.3-1.6s on a good connection and far more on rural mobile, and the
client cache-busted it, so every enumerator paid that on every page load
before they could touch anything. Served from the same CDN as app.js it
is a fraction of that, and starting an interview no longer depends on
Apps Script answering at all.

Both copies come from the same questions_*.json, so they cannot disagree
-- but the site and the Apps Script project must be redeployed together,
or the column ids the client sends stop matching the ones the backend
writes. See README section 8.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src")
DOCS = os.path.join(HERE, "..", "docs")

for key in ("A", "B"):
    with open(os.path.join(HERE, f"questions_{key}.json"), encoding="utf-8") as f:
        data = json.load(f)
    js = json.dumps(data, ensure_ascii=False, indent=2)
    out_path = os.path.join(SRC, f"Schema_{key}.gs")
    with open(out_path, "w", encoding="utf-8") as out:
        out.write("// Auto-generated from the DRVN Inception Report questionnaire.\n")
        out.write("// Do not hand-edit; regenerate with parse_questionnaire.py + this script.\n")
        out.write(f"var QUESTIONS_{key} = " + js + ";\n")
    print(f"Wrote {out_path} ({len(js)} bytes)")

    # Static copy for the website. Minified: it is machine-read, and the
    # indentation is a third of the payload an enumerator waits for.
    json_path = os.path.join(DOCS, f"schema_{key}.json")
    compact = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(json_path, "w", encoding="utf-8") as out:
        out.write(compact)
    print(f"Wrote {json_path} ({len(compact)} bytes, {100 - 100 * len(compact) // len(js)}% smaller)")
