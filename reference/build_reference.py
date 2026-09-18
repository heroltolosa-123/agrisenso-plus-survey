#!/usr/bin/env python3
"""Builds the printable item-by-item enumerator reference.

Every item, its question text, options, routing and validation come from
the live schema (tools/questions_*.json), so the reference cannot drift
from what the app actually does. guidance.py adds the training notes.

    python3 build_reference.py          # writes reference_A.html / _B.html
"""
import html
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import guidance  # noqa: E402

REPO = os.path.join(os.path.dirname(HERE), "webapp")
TITLES = {
    "A": "Instrument A — AGRISENSO Plus Borrowers",
    "B": "Instrument B — Non-Borrower Comparison Group",
}
ITEM_CODE = lambda q: q["qid"] if len(q["qid"]) <= 6 and any(c.isdigit() for c in q["qid"]) else ""


def e(s):
    return html.escape(str(s))


def opt_text(o):
    import re
    t = re.sub(r"_{3,}", "", str(o)).strip()
    return re.sub(r":$", "", t).strip() or "Other"


def routing(f, idx, owner=None, qid=None):
    """Plain-language routing note for one field."""
    out = []
    for c in f.get("conditions", []) or []:
        ref = c["field"]
        label = idx.get(ref, ref)
        if "in" in c:
            out.append("Only when %s = %s" % (label, " or ".join(c["in"])))
        elif "containsAny" in c:
            n = len(c["containsAny"])
            if ref == "C1_1":
                out.append("Only for production activities ticked in C1")
            else:
                out.append("Only when %s includes a listed answer" % label)
        elif c.get("notEmpty"):
            out.append("Appears once %s is answered" % label)
        elif c.get("empty"):
            out.append("Alternative to %s" % label)
    if f.get("exclusiveWith"):
        # Peers inside the same item all resolve to the same heading, so
        # naming each one produced "clears C4, C4, C4". Collapse those.
        peers, same_item = [], False
        for pid in f["exclusiveWith"]:
            if owner and qid and owner.get(pid) == qid:
                same_item = True
                continue
            lbl = idx.get(pid, pid)
            if lbl not in peers:
                peers.append(lbl)
        if same_item:
            out.append("Answering this clears the other answers in this item")
        if peers:
            out.append("Answering this clears %s" % ", ".join(peers))
    return out


def limits(f):
    out = []
    if f.get("type") == "number":
        if f.get("min") is not None and f.get("max") is not None:
            out.append("between %s and %s" % (f["min"], f["max"]))
        elif f.get("min") is not None:
            out.append("%s or more" % f["min"])
        elif f.get("max") is not None:
            out.append("%s or less" % f["max"])
        if f.get("integer"):
            out.append("whole number")
        unit = f.get("unit")
        if unit and unit not in ("area",):
            out.append("in %s" % unit)
        if f.get("maxOf"):
            out.append("cannot exceed the answer above")
    return out


def build(key):
    schema = json.load(open(os.path.join(REPO, "tools", "questions_%s.json" % key), encoding="utf-8"))
    idx, owner = {}, {}
    for s in schema["sections"]:
        for q in s["questions"]:
            for f in q["fields"]:
                idx[f["field_id"]] = (q["qid"] + " " + q["heading"])[:42]
                owner[f["field_id"]] = q["qid"]

    parts = []
    for s in schema["sections"]:
        qs = [q for q in s["questions"] if q["fields"]]
        if not qs:
            continue
        parts.append('<section class="sec"><h2>%s</h2>' % e(s["title"]))
        for q in qs:
            note = guidance.lookup(key, q["qid"])
            code = ITEM_CODE(q)
            flags = []
            if any(f.get("required") for f in q["fields"]):
                flags.append('<span class="flag req">required</span>')
            if any(f.get("derived") or f.get("readOnly") or f.get("generator") for f in q["fields"]):
                flags.append('<span class="flag auto">filled by the app</span>')
            parts.append('<article class="item">')
            parts.append('<h3><span class="code">%s</span>%s %s</h3>'
                         % (e(code), e(q["heading"]), "".join(flags)))
            if q.get("instructions"):
                parts.append('<p class="instr">%s</p>' % e(q["instructions"]))

            for f in q["fields"]:
                if f.get("derived") or f.get("readOnly") or f.get("generator"):
                    continue
                parts.append('<div class="fld">')
                parts.append('<p class="q">%s</p>' % e(f["label"]))
                if f.get("options"):
                    parts.append('<p class="opts">%s</p>'
                                 % " &nbsp;·&nbsp; ".join(e(opt_text(o)) for o in f["options"]))
                if f.get("rows"):
                    parts.append('<p class="opts"><b>Rows:</b> %s<br><b>Columns:</b> %s</p>'
                                 % (" · ".join(e(r) for r in f["rows"]),
                                    " · ".join(e(c) for c in f.get("columns", []))))
                meta = routing(f, idx, owner, q["qid"]) + limits(f)
                if meta:
                    # Only the first character: .capitalize() would lowercase the
                    # rest and turn "A2 Borrower Type" into "a2 borrower type".
                    line = "; ".join(meta)
                    line = line[:1].upper() + line[1:]
                    parts.append('<p class="meta">%s</p>' % e(line))
                parts.append("</div>")

            if note:
                purpose, ask, watch = note
                if purpose:
                    parts.append('<p class="g"><b>What it measures.</b> %s</p>' % e(purpose))
                if ask:
                    parts.append('<p class="g"><b>How to ask it.</b> %s</p>' % e(ask))
                if watch:
                    parts.append('<p class="g watch"><b>Watch for.</b> %s</p>' % e(watch))
            parts.append("</article>")
        parts.append("</section>")
    return "\n".join(parts)


CSS = """
@page { size: A4; margin: 16mm 14mm 18mm 14mm;
        @bottom-center { content: counter(page); } }
* { box-sizing: border-box; }
body { font-family: "Charter","Georgia",serif; font-size: 9.6pt; line-height: 1.42;
       color: #1a1a1a; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 2mm; line-height: 1.15; }
.sub { font-size: 10pt; color: #555; margin: 0 0 6mm; }
h2 { font-size: 12.5pt; background: #14342b; color: #fff; padding: 2.2mm 3mm;
     margin: 0 0 3mm; border-radius: 1mm; page-break-after: avoid; }
.sec { page-break-before: always; }
.sec:first-of-type { page-break-before: avoid; }
.item { page-break-inside: avoid; margin: 0 0 3.4mm; padding: 0 0 2.6mm;
        border-bottom: 0.3pt solid #d8ddd8; }
h3 { font-size: 10.6pt; margin: 0 0 1.2mm; page-break-after: avoid; }
.code { display: inline-block; min-width: 13mm; font-weight: 700; color: #14342b; }
.flag { font-family: "Helvetica Neue",Arial,sans-serif; font-size: 6.6pt; text-transform: uppercase;
        letter-spacing: 0.4pt; padding: 0.5mm 1.4mm; border-radius: 0.8mm; margin-left: 2mm;
        vertical-align: 1.2pt; font-weight: 600; }
.req  { background: #fdecec; color: #8f2020; border: 0.3pt solid #e8b4b4; }
.auto { background: #eef3ee; color: #41614d; border: 0.3pt solid #bcd0c2; }
.instr { font-size: 8.6pt; color: #5a6a5f; font-style: italic; margin: 0 0 1.4mm; }
.fld { margin: 0 0 1.4mm 13mm; }
.q { margin: 0; }
.opts { font-size: 8.4pt; color: #3d4a41; margin: 0.6mm 0 0; }
.meta { font-family: "Helvetica Neue",Arial,sans-serif; font-size: 7.6pt; color: #7a5a1a;
        background: #fdf6e6; border-left: 1.2pt solid #d9a441; padding: 0.8mm 2mm;
        margin: 0.8mm 0 0; border-radius: 0.6mm; }
.g { margin: 1mm 0 0 13mm; font-size: 9pt; }
.g b { color: #14342b; }
.watch b { color: #8f2020; }
.legend { border: 0.4pt solid #cfd6d0; border-radius: 1.4mm; padding: 3mm 4mm; margin: 0 0 6mm;
          font-size: 8.8pt; background: #fafbfa; }
.legend p { margin: 0 0 1.4mm; }
.legend p:last-child { margin: 0; }
"""

HEAD = """<!doctype html><html><head><meta charset="utf-8">
<title>%s</title><style>%s</style></head><body>
<h1>%s</h1>
<p class="sub">AGRISENSO Plus Baseline Study &mdash; item-by-item enumerator reference</p>
<div class="legend">
<p><b>How to use this.</b> Find the item code on screen, find it here. Question text, options,
routing and limits are taken directly from the live questionnaire, so this sheet always matches
what the app does.</p>
<p><b>required</b> &mdash; the page will not advance until it is answered.
<b>filled by the app</b> &mdash; do not type over it.</p>
<p>The shaded line under a question gives its routing and any limits the app enforces.</p>
<p><b>Three rules everywhere.</b> Read the question as written; never suggest an answer;
blank is valid for everything except the required items &mdash; never enter a filler to move on.</p>
</div>
%s
</body></html>"""


def main():
    for key in ("A", "B"):
        body = build(key)
        out = os.path.join(HERE, "reference_%s.html" % key)
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(HEAD % (TITLES[key], CSS, TITLES[key], body))
        print("wrote", os.path.basename(out), "%d KB" % (os.path.getsize(out) // 1024))


if __name__ == "__main__":
    main()
