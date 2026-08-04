#!/usr/bin/env python3
"""
Regenerates src/Schema_A.gs and src/Schema_B.gs from questions_A.json /
questions_B.json. Run this after re-running parse_questionnaire.py on an
updated questionnaire export, then `clasp push` (or copy-paste) the two
.gs files into your Apps Script project.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src")

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
