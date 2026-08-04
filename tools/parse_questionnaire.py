#!/usr/bin/env python3
"""
Parses the AGRISENSO Plus questionnaire (GFM markdown export of the DRVN
Inception Report) into a structured JSON schema that the survey app can
render generically.

Usage: python parse_questionnaire.py <input.md> <instrument_label> <output.json>
"""
import sys
import json
import re

CHECKBOX_RE = re.compile(r"^\s*☐\s*(.+?)\s*$")
BLANK_RE = re.compile(r"_{3,}")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")


def clean(s: str) -> str:
    s = s.replace("\\_", "_")
    s = s.replace("\\", "")
    s = re.sub(r"\*\*", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def slugify(text: str, maxlen=40) -> str:
    text = re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")
    return text[:maxlen] if text else "field"


def parse_pipe_table(lines):
    """Parse a block of pipe-table lines into (headers, rows)."""
    rows = []
    headers = []
    for i, ln in enumerate(lines):
        cells = [clean(c) for c in ln.strip().strip("|").split("|")]
        if i == 0:
            headers = cells
        elif re.match(r"^:?-+:?$", ln.strip().strip("|").replace("|", "").replace(" ", "")) or set(ln.strip()) <= set("|-: "):
            continue
        else:
            rows.append(cells)
    return headers, rows


def make_field_from_checkboxes(qid, idx, label, options):
    allow_other = False
    clean_opts = []
    for o in options:
        clean_opts.append(o)
        if re.search(r"other|specify", o, re.I):
            allow_other = True
    multi = bool(re.search(r"select all|all that apply|confirm:|which of the following|did any of the following|select all applicable", label, re.I))
    return {
        "field_id": f"{qid}_{idx}" if idx else qid,
        "label": label or "Select one",
        "type": "multi_choice" if multi else "single_choice",
        "options": clean_opts,
        "allow_other": allow_other,
    }


def parse_blank_line(qid, idx, line, fallback_label=""):
    # e.g. "Age in completed years: ____" or "**Total household members:** ____ persons"
    before = BLANK_RE.split(line)[0]
    after_parts = BLANK_RE.split(line)
    suffix = after_parts[-1].strip() if len(after_parts) > 1 else ""
    label = clean(before).rstrip(":").strip()
    if not label:
        label = clean(fallback_label).rstrip(":").strip() or "Response"
    if suffix and len(suffix) < 20 and not re.search(r"[☐]", suffix):
        label = f"{label} ({suffix.strip()})" if suffix.strip() else label
    return {
        "field_id": f"{qid}_{idx}",
        "label": label,
        "type": "text",
    }


def parse_section_block(section_id, section_title, qid, heading, body_lines):
    """Turn the raw lines under one ## heading into a list of field dicts,
    plus leading instructional/paragraph text."""
    fields = []
    intro_text = []
    i = 0
    n = len(body_lines)
    group_idx = 0
    pending_label = ""

    while i < n:
        line = body_lines[i].rstrip().replace("\\", "")

        if not line.strip():
            i += 1
            continue

        # Pipe table block
        if line.strip().startswith("|"):
            table_lines = []
            while i < n and body_lines[i].strip().startswith("|"):
                table_lines.append(body_lines[i])
                i += 1
            headers, rows = parse_pipe_table(table_lines)
            group_idx += 1
            fields.append({
                "field_id": f"{qid}_table{group_idx}",
                "label": pending_label or heading,
                "type": "matrix",
                "columns": headers,
                "rows": [r[0] if r else "" for r in rows],
                "raw_rows": rows,
            })
            pending_label = ""
            continue

        # Checkbox group
        if CHECKBOX_RE.match(line):
            opts = []
            while i < n:
                raw_ln = body_lines[i].rstrip().replace("\\", "")
                m = CHECKBOX_RE.match(raw_ln)
                if m:
                    opt_text = clean(m.group(1))
                    opt_text = re.split(r"\s*(?:→|-- End interview|-- Continue|-- Proceed).*$", opt_text)[0].strip()
                    if opt_text:
                        opts.append(opt_text)
                    i += 1
                elif raw_ln.strip() and opts and not raw_ln.strip().startswith("#") and len(clean(raw_ln)) < 80:
                    # wrapped continuation text belonging to the previous option
                    opts[-1] = (opts[-1] + " " + clean(raw_ln)).strip()
                    i += 1
                else:
                    break
            group_idx += 1
            label = pending_label or heading
            fields.append(make_field_from_checkboxes(qid, group_idx, clean(label), opts))
            pending_label = ""
            continue

        # Likert "Response: 1 2 3 4 5"
        if re.match(r"^\**Response:?\**\s*1\s*2\s*3\s*4\s*5", clean(line), re.I):
            group_idx += 1
            fields.append({
                "field_id": f"{qid}_likert{group_idx}",
                "label": pending_label or heading,
                "type": "scale_1_5",
            })
            pending_label = ""
            i += 1
            continue

        # Blank fill-in line
        if BLANK_RE.search(line):
            group_idx += 1
            fields.append(parse_blank_line(qid, group_idx, clean(line), pending_label))
            pending_label = ""
            i += 1
            continue

        # Sub-heading (### ...) inside a question block: starts a fresh label
        h3 = re.match(r"^###\s+(.+)$", line.strip())
        if h3:
            pending_label = clean(h3.group(1))
            i += 1
            continue

        # Plain text: could be a question prompt/label or an instruction.
        c = clean(line)
        if c:
            if c.endswith("?") or c.endswith(":") or len(c) < 140:
                pending_label = (pending_label + " " + c).strip() if pending_label else c
            else:
                intro_text.append(c)
        i += 1

    if pending_label.strip():
        group_idx += 1
        fields.append({
            "field_id": f"{qid}_{group_idx}",
            "label": pending_label.strip(),
            "type": "text",
        })

    return fields, " ".join(intro_text)


def parse_instrument(md_text, instrument_label):
    lines = md_text.split("\n")
    sections = []
    cur_section = None
    cur_heading = None
    cur_qid = None
    buf = []

    def flush_question():
        nonlocal buf, cur_heading, cur_qid
        if cur_section is None or cur_heading is None:
            buf = []
            return
        if not any(b.strip() for b in buf):
            buf = []
            return
        fields, intro = parse_section_block(
            cur_section["section_id"], cur_section["title"], cur_qid, cur_heading, buf
        )
        cur_section["questions"].append({
            "qid": cur_qid,
            "heading": cur_heading,
            "instructions": intro,
            "fields": fields,
        })
        buf = []

    started = False
    for raw in lines:
        line = raw.rstrip("\n")
        h1 = re.match(r"^#\s+(.+)$", line)
        h2 = re.match(r"^##\s+([A-Za-z0-9]+)\.\s*(.+)$", line)
        h2_generic = re.match(r"^##\s+(.+)$", line) if not h2 else None
        if h1:
            flush_question()
            cur_heading = None
            cur_qid = None
            title_raw = clean(h1.group(1))
            m = re.match(r"^Section\s+([A-Z])\.\s*(.+)$", title_raw)
            if m:
                sec_id, title = m.group(1), m.group(2)
            else:
                sec_id, title = slugify(title_raw, 12).upper(), title_raw
            cur_section = {"section_id": sec_id, "title": title, "questions": []}
            sections.append(cur_section)
            started = True
            # Capture any content that appears directly under the H1,
            # before the first H2 sub-heading (e.g. consent text, admin
            # metadata fields, enumerator checklists).
            cur_qid = f"{sec_id}_intro"
            cur_heading = title
            buf = []
            continue
        if h2 and started:
            flush_question()
            cur_qid = h2.group(1)
            cur_heading = clean(h2.group(2))
            buf = []
            continue
        if h2_generic and started:
            flush_question()
            title = clean(h2_generic.group(1))
            cur_qid = slugify(title, 20)
            cur_heading = title
            buf = []
            continue
        if started and cur_heading is not None:
            buf.append(line)

    flush_question()

    # Fallback: open-ended questions with no explicit blank/checkbox line
    # still need a data field.
    for s in sections:
        for q in s["questions"]:
            if not q["fields"]:
                q["fields"].append({
                    "field_id": f"{q['qid']}_1",
                    "label": q["instructions"] or q["heading"],
                    "type": "text",
                })
                q["instructions"] = ""

    return {"instrument": instrument_label, "sections": sections}


if __name__ == "__main__":
    src, label, out = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(src, "r", encoding="utf-8") as f:
        text = f.read()
    schema = parse_instrument(text, label)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, ensure_ascii=False)
    nq = sum(len(s["questions"]) for s in schema["sections"])
    nf = sum(len(q["fields"]) for s in schema["sections"] for q in s["questions"])
    print(f"Parsed {len(schema['sections'])} sections, {nq} questions, {nf} fields -> {out}")
