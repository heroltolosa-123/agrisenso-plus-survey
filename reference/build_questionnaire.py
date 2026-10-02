#!/usr/bin/env python3
"""Builds the printable paper questionnaire for both instruments.

This is the form itself, not the training reference: every item with tick
boxes, ruled answer space and the routing spelled out in words, because
paper has none of the app's logic. Everything is read from the live
schema (tools/questions_*.json), so the printed form cannot drift from
what the app asks.

    python3 build_questionnaire.py            # questionnaire_A/B.html
    python3 build_questionnaire.py --demo     # self-check

PDF and Word are produced from the HTML; see README in this folder.
"""
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
TITLES = {
    "A": "Instrument A — AGRISENSO Plus Borrowers",
    "B": "Instrument B — Non-Borrower Comparison Group",
}
BOX = "☐"


def e(s):
    return html.escape(str(s))


def item_code(qid):
    """'A2' from a question id, '' for the prose sections."""
    return qid if len(qid) <= 6 and any(c.isdigit() for c in qid) else ""


def clean(text):
    """Strips the fill-in rules the Word original used for paper."""
    t = re.sub(r"_{3,}", "", str(text)).strip()
    return re.sub(r":$", "", t).strip()


def printable(option):
    """What an option reads as on paper: no fill-in rules, and no
    '(specify)' where a ruled line already says to write something."""
    text = clean(option)
    return re.sub(r"\s*\(specify\)\s*:?$", "", text).rstrip(" :")


def load(key):
    with open(os.path.join(REPO, "tools", "questions_%s.json" % key), encoding="utf-8") as fh:
        return json.load(fh)


def code_index(schema):
    """field_id -> the item code a human can look up, e.g. 'A5'."""
    idx = {}
    for section in schema["sections"]:
        for question in section["questions"]:
            code = item_code(question["qid"]) or question["heading"][:28]
            for field in question["fields"]:
                idx[field["field_id"]] = code
    return idx


def routing_note(field, idx):
    """The app's conditions, as an instruction someone can follow on paper."""
    out = []
    for cond in field.get("conditions", []) or []:
        where = idx.get(cond["field"], cond["field"])
        if cond.get("in"):
            values = " or ".join(clean(v) for v in cond["in"])
            out.append("Ask only if %s = %s" % (where, values))
        elif cond.get("containsAny"):
            values = cond["containsAny"]
            if cond["field"] == "C1_1":
                # The activity list: naming all nine reads as noise when
                # "the ones ticked at C1" is the actual instruction.
                out.append("Ask only for the production activities ticked at C1")
            elif len(values) > 4:
                out.append("Ask only for the answers ticked at %s" % where)
            else:
                out.append("Ask only if %s includes %s"
                           % (where, " or ".join(clean(v) for v in values)))
        elif cond.get("notEmpty"):
            out.append("Ask once %s is answered" % where)
        elif cond.get("empty"):
            out.append("Ask only if %s was left blank" % where)
    if field.get("optionsFrom"):
        src = idx.get(field["optionsFrom"]["field"], field["optionsFrom"]["field"])
        out.append("Choose from what was ticked at %s" % src)
    if field.get("maxOf"):
        out.append("Cannot exceed the answer above")
    # The same clause can arrive from two conditions on one field.
    seen, unique = set(), []
    for note in out:
        if note not in seen:
            seen.add(note)
            unique.append(note)
    return "; ".join(unique)


def limit_note(field):
    out = []
    if field.get("type") == "number":
        lo, hi = field.get("min"), field.get("max")
        if lo is not None and hi is not None:
            out.append("%s–%s" % (lo, hi))
        elif lo is not None:
            out.append("%s or more" % lo)
        elif hi is not None:
            out.append("%s or less" % hi)
        if field.get("integer"):
            out.append("whole number")
    return ", ".join(out)


RULE = "_" * 34          # a line to write on, for Word
LONG_RULE = "_" * 72


def writein(lines, word):
    if word:
        return "".join('<p class="wline">%s</p>' % LONG_RULE for _ in range(lines))
    return '<div class="writein">%s</div>' % ("<span></span>" * lines)


def rulerow(unit, word):
    if word:
        return '<p class="wline">%s &nbsp; %s</p>' % (RULE, unit)
    return ('<p class="rulerow"><span class="boxline">&nbsp;</span> '
            '<span class="unit">%s</span></p>' % unit)


def answer_space(field, word=False):
    """The part the respondent's answer actually goes into.

    `word` emits a plain-text form of the same thing: Word loses CSS
    borders and swallows a leading tick box inside a list item, so the
    boxes become literal characters and the ruled lines underscores."""
    kind = field.get("type")
    parts = []

    if field.get("derived") or field.get("readOnly") or field.get("generator"):
        parts.append('<p class="office">Completed by the app — '
                     'leave blank on paper, for office use only.</p>')
        return "\n".join(parts)

    if kind in ("single_choice", "multi_choice"):
        options = [clean(o) for o in (field.get("options") or [])]
        if not options and field.get("optionsFrom"):
            parts.append(writein(3, word))
            return "\n".join(parts)
        if kind == "multi_choice":
            parts.append('<p class="pick">Tick all that apply.</p>')
        wide = max([len(o) for o in options] or [0]) > 34 or len(options) < 6
        row = (lambda text: '<p class="wopt">%s</p>' % text) if word else \
              (lambda text: "<li>%s</li>" % text)
        if not word:
            parts.append('<ul class="opts%s">' % ("" if wide else " two"))
        has_other = False
        for opt in options:
            if re.match(r"^(other|others)\b", opt, re.I) or "specify" in opt.lower():
                has_other = True
                tail = RULE if word else '<span class="rule short"></span>'
                parts.append(row("%s %s: %s" % (BOX, e(printable(opt)), tail)))
            else:
                parts.append(row("%s %s" % (BOX, e(opt))))
        # allow_other duplicates an "Other" the list already carries.
        if field.get("allow_other") and not has_other:
            tail = RULE if word else '<span class="rule short"></span>'
            parts.append(row("%s Other: %s" % (BOX, tail)))
        if not word:
            parts.append("</ul>")
        return "\n".join(parts)

    if kind == "scale_1_5":
        parts.append('<p class="scale">1 = not at all confident &nbsp;·&nbsp; '
                     '5 = very confident</p>')
        parts.append('<p class="scale boxes">%s</p>'
                     % " &nbsp;&nbsp; ".join("%s&nbsp;%d" % (BOX, n) for n in range(1, 6)))
        return "\n".join(parts)

    if kind == "matrix":
        columns = field.get("columns") or []
        rows = field.get("raw_rows") or [[r] for r in (field.get("rows") or [])]
        parts.append('<table class="grid"><tr>')
        for col in columns:
            parts.append("<th>%s</th>" % e(clean(col)))
        parts.append("</tr>")
        for row in rows:
            parts.append("<tr>")
            cells = list(row) + [""] * (len(columns) - len(row))
            for i, cell in enumerate(cells):
                text = str(cell)
                if i == 0:
                    parts.append("<td>%s</td>" % e(clean(text) or "&nbsp;"))
                elif text.strip() in (BOX, "☐"):
                    parts.append('<td class="tick">%s</td>' % BOX)
                else:
                    parts.append('<td class="blank">%s</td>'
                                 % e(re.sub(r"_{3,}", "", text).strip()))
            parts.append("</tr>")
        parts.append("</table>")
        return "\n".join(parts)

    if kind in ("date", "month"):
        parts.append(rulerow("YYYY-MM" if kind == "month" else "YYYY-MM-DD", word))
        return "\n".join(parts)

    if kind == "time":
        parts.append(rulerow("HH:MM, 24-hour", word))
        return "\n".join(parts)

    if kind == "number":
        unit = field.get("unit") or ""
        note = limit_note(field)
        tail = " &nbsp;".join(x for x in (e(unit), ("(%s)" % e(note)) if note else "") if x)
        parts.append(rulerow(tail, word))
        return "\n".join(parts)

    # text
    long = len(field["label"]) > 70 or re.match(r"^(why|reason|brief)", field["label"], re.I)
    parts.append(writein(3 if long else 1, word))
    return "\n".join(parts)


def stop_boxes(schema, idx):
    """field_id -> the STOP instruction printed after that item."""
    out = {}
    for rule in schema.get("terminationRules", []) or []:
        for cond in rule.get("when", []):
            values = " or ".join(clean(v) for v in cond.get("in", []))
            out.setdefault(cond["field"], []).append(
                '<div class="stop"><b>STOP if %s = %s — %s.</b> %s</div>'
                % (e(idx.get(cond["field"], cond["field"])), e(values),
                   e(clean(rule["title"])), e(rule["message"])))
    return out


def build_body(key, word=False):
    schema = load(key)
    idx = code_index(schema)
    stops = stop_boxes(schema, idx)
    parts = []

    for section in schema["sections"]:
        questions = [q for q in section["questions"] if q["fields"]]
        if not questions:
            continue
        parts.append('<section class="sec"><h2>%s</h2>' % e(section["title"]))
        for question in questions:
            code = item_code(question["qid"])
            parts.append('<article class="item">')
            if code or question["heading"].strip() != section["title"].strip():
                parts.append('<h3><span class="code">%s</span>%s</h3>'
                             % (e(code), e(question["heading"])))
            if question.get("instructions"):
                parts.append('<p class="instr">%s</p>' % e(question["instructions"]))
            for field in question["fields"]:
                parts.append('<div class="fld">')
                label = clean(field["label"])
                if label and label != question["heading"]:
                    parts.append('<p class="q">%s</p>' % e(label))
                note = routing_note(field, idx)
                if note:
                    parts.append('<p class="route">%s</p>' % e(note))
                parts.append(answer_space(field, word))
                parts.append("</div>")
                for box in stops.get(field["field_id"], []):
                    parts.append(box)
            parts.append("</article>")
        parts.append("</section>")
    return "\n".join(parts), schema


CSS = """
@page { size: A4; margin: 15mm 13mm 16mm 13mm; }
* { box-sizing: border-box; }
body { font-family: "Charter","Georgia",serif; font-size: 9.8pt; line-height: 1.4;
       color: #111; margin: 0; }
h1 { font-size: 19pt; margin: 0 0 1.5mm; line-height: 1.15; }
.sub { font-size: 10pt; color: #555; margin: 0 0 5mm; }
h2 { font-size: 12.5pt; background: #14342b; color: #fff; padding: 2.2mm 3mm;
     margin: 0 0 3mm; border-radius: 1mm; page-break-after: avoid; }
.sec { page-break-before: always; }
.sec:first-of-type { page-break-before: avoid; }
.item { page-break-inside: avoid; margin: 0 0 3.6mm; padding: 0 0 2.4mm;
        border-bottom: 0.3pt solid #d5dad5; }
h3 { font-size: 10.6pt; margin: 0 0 1.4mm; page-break-after: avoid; }
.code { display: inline-block; min-width: 12mm; font-weight: 700; color: #14342b; }
.instr { font-size: 8.8pt; color: #4e5c52; font-style: italic; margin: 0 0 1.6mm 12mm; }
.fld { margin: 0 0 2.2mm 12mm; }
.q { margin: 0 0 1mm; }
.pick { font-size: 8.4pt; color: #4e5c52; font-style: italic; margin: 0 0 0.8mm; }
.route { font-family: "Helvetica Neue",Arial,sans-serif; font-size: 7.8pt; color: #7a5a1a;
         background: #fdf6e6; border-left: 1.2pt solid #d9a441; padding: 0.9mm 2mm;
         margin: 0 0 1.2mm; border-radius: 0.6mm; }
.office { font-family: "Helvetica Neue",Arial,sans-serif; font-size: 7.8pt; color: #41614d;
          background: #eef3ee; padding: 0.9mm 2mm; margin: 0; border-radius: 0.6mm; }
ul.opts { list-style: none; margin: 0; padding: 0; font-size: 9.4pt; }
ul.opts li { margin: 0 0 0.9mm; padding: 0; }
ul.opts.two { column-count: 2; column-gap: 6mm; }
ul.opts.two li { break-inside: avoid; }
.scale { font-size: 8.6pt; color: #4e5c52; margin: 0 0 1mm; font-style: italic; }
.scale.boxes { font-size: 11pt; font-style: normal; color: #111; margin: 0; }
.writein { margin: 1mm 0 0; }
.writein span { display: block; border-bottom: 0.4pt solid #9aa49c; height: 6mm; }
.rulerow { margin: 0.5mm 0 0; }
.boxline { display: inline-block; width: 46mm; border-bottom: 0.4pt solid #9aa49c; }
.rule.short { display: inline-block; width: 52mm; border-bottom: 0.4pt solid #9aa49c; }
.unit { font-size: 8.4pt; color: #4e5c52; margin-left: 2mm; }
table.grid { border-collapse: collapse; width: 100%; font-size: 8.8pt; margin: 1mm 0 0;
             page-break-inside: avoid; }
table.grid th { background: #eef3ee; color: #14342b; text-align: left; padding: 1.2mm 1.8mm;
                border: 0.3pt solid #bcd0c2; font-family: "Helvetica Neue",Arial,sans-serif;
                font-size: 7.8pt; text-transform: uppercase; letter-spacing: 0.3pt; }
table.grid td { padding: 1.6mm 1.8mm; border: 0.3pt solid #c9d1ca; }
table.grid td.tick { text-align: center; font-size: 10pt; width: 16mm; }
table.grid td.blank { min-width: 22mm; color: #4e5c52; font-size: 8.4pt; }
.stop { font-family: "Helvetica Neue",Arial,sans-serif; font-size: 8.2pt; color: #8f2020;
        background: #fdecec; border-left: 1.6pt solid #c86a6a; padding: 1.6mm 2.6mm;
        margin: 0 0 2.4mm 12mm; border-radius: 0.6mm; page-break-inside: avoid; }
.legend { page-break-inside: avoid; border: 0.4pt solid #cfd6d0; border-radius: 1.4mm; padding: 3mm 4mm; margin: 0 0 5mm;
          font-size: 8.8pt; background: #fafbfa; }
.legend p { margin: 0 0 1.6mm; }
.legend p:last-child { margin: 0; }
.wopt { margin: 0 0 0.6mm; }
.wline { margin: 0.6mm 0; font-family: "Courier New",monospace; }
"""

HEAD = """<!doctype html><html><head><meta charset="utf-8">
<title>%(title)s</title><style>%(css)s</style></head><body>
<h1>%(title)s</h1>
<p class="sub">AGRISENSO Plus Baseline Study &mdash; paper questionnaire, version %(version)s
(%(vdate)s)</p>
<div class="legend">
<p><b>This is the paper form.</b> Fieldwork is done in the webapp; print this for review,
for briefings, and as the fallback when a device fails. Every item, option and rule here is
generated from the live questionnaire, so the two cannot drift.</p>
<p><b>Paper has no routing.</b> The app skips what does not apply. On paper the shaded line
above an item tells you when to ask it &mdash; <i>Ask only if A5 = Yes</i> &mdash; and a red box
tells you when to stop. Follow them, or the form collects answers the dataset will reject.</p>
<p><b>Blank is a valid answer</b> for everything except the eligibility and consent items.
Never write a filler to fill a space.</p>
<p>%(boxes)s one answer &nbsp;&middot;&nbsp; <i>Tick all that apply</i> above a list means more
than one may be ticked &nbsp;&middot;&nbsp; items marked for office use are completed by the app,
not by hand.</p>
</div>
"""


def build(key, word=False):
    body, schema = build_body(key, word)
    meta = schema.get("meta", {})
    head = HEAD % {
        "title": TITLES[key],
        "css": CSS,
        "version": e(meta.get("version", "—")),
        "vdate": e(meta.get("versionDate", "—")),
        "boxes": BOX,
    }
    return head + body + "\n</body></html>"


def demo():
    """Self-check: the properties a printed form has to have."""
    for key in ("A", "B"):
        schema = load(key)
        idx = code_index(schema)
        page = build(key)
        word_page = build(key, word=True)

        # Every non-derived field must offer somewhere to write.
        fields = [f for s in schema["sections"] for q in s["questions"] for f in q["fields"]]
        for field in fields:
            space = answer_space(field)
            assert space.strip(), "no answer space for %s" % field["field_id"]
            # Word loses CSS rules, so its copy must carry visible ones.
            wspace = answer_space(field, word=True)
            assert wspace.strip(), "no Word answer space for %s" % field["field_id"]
            if field["type"] in ("text", "number", "date", "month", "time") \
                    and not (field.get("derived") or field.get("readOnly")
                             or field.get("generator")):
                assert "____" in wspace, "no line to write on: %s" % field["field_id"]
            if field.get("derived") or field.get("readOnly") or field.get("generator"):
                assert "office use" in space, field["field_id"]
            elif field["type"] in ("single_choice", "multi_choice") and field.get("options"):
                assert BOX in space, field["field_id"]

        # Every option the app offers must be printed, except on the
        # fields the app fills in itself.
        for field in fields:
            if field.get("derived") or field.get("readOnly") or field.get("generator"):
                continue
            for opt in field.get("options") or []:
                text = printable(opt)
                if text:
                    assert e(text) in page, "%s missing option %r" % (field["field_id"], text)
                    assert e(text) in word_page, \
                        "%s missing option %r in the Word copy" % (field["field_id"], text)

        # Every routing condition must become a readable instruction, and
        # must name an item code rather than a raw field id.
        conditional = [f for f in fields if f.get("conditions")]
        assert conditional, "no conditional fields found in %s" % key
        for field in conditional:
            note = routing_note(field, idx)
            assert note, "no routing note for %s" % field["field_id"]
            assert "_" not in note.split(" = ")[0], note

        # Every termination rule must print a STOP box.
        assert schema.get("terminationRules"), key
        for rule in schema["terminationRules"]:
            assert e(clean(rule["title"])) in page, rule["title"]
        assert page.count('class="stop"') >= len(schema["terminationRules"]), key

        # Matrices keep their grid, scales their anchors.
        assert "table class=\"grid\"" in page.replace("'", '"')
        assert "not at all confident" in page

        # Word swallows a tick box that leads a list item, so the Word
        # copy must not use lists for options.
        assert "<li>" not in word_page, "the Word copy still uses list items"
        assert word_page.count(BOX) >= page.count(BOX), key

        print("%s ok  %d items, %d fields, %d stop boxes"
              % (key, sum(len([q for q in s["questions"] if q["fields"]])
                          for s in schema["sections"]),
                 len(fields), page.count('class="stop"')))
    print("build_questionnaire self-check passed")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
    else:
        for key in ("A", "B"):
            for suffix, word in (("", False), ("_word", True)):
                path = os.path.join(HERE, "questionnaire_%s%s.html" % (key, suffix))
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(build(key, word))
                print("wrote %s (%d bytes)" % (path, os.path.getsize(path)))
