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
    s = re.sub(r"<[^>]+>", "", s)  # strip stray HTML (e.g. pandoc anchor spans)
    s = re.sub(r"\s+", " ", s).strip()
    return s


INSTRUCTIONAL_PREFIXES = (
    "enumerator note", "enumerator instruction", "target respondents",
    "operational definition", "instructions to enumerator",
    "instructions to the enumerator", "administer only if",
    "ask only if", "enumerator: read the following",
)
MAX_STANDALONE_FIELD_LEN = 260


def looks_instructional(text: str) -> bool:
    """True for leftover paragraph text that is guidance for the enumerator
    (or pure front-matter) rather than something with an actual answer to
    record — this should never become a required fillable field."""
    low = text.lower().strip()
    if any(low.startswith(p) for p in INSTRUCTIONAL_PREFIXES):
        return True
    # A routing note phrased as "If <answer> -> <action the enumerator should
    # take>" (e.g. "If No or Unable to Verify -> Do not proceed with
    # substantive questions.") is an instruction, not a question — it never
    # has an answer of its own to record. Contrast with "If Yes, from whom?"
    # or "If Yes: <options...>", which introduce a real follow-up question
    # and are handled separately (see enhance_schema.py's conditional-field
    # detection) rather than being swept into instructions here.
    if re.match(r"^if\s+.+(\u2192|->)", low):
        return True
    # "If <condition> Proceed to H7..." / "...Skip to Section G." — a
    # routing note with no arrow character but still pure navigation
    # instruction, no answer of its own.
    if low.startswith("if ") and re.search(r"\b(proceed to|skip to)\b", low):
        return True
    if len(text) > MAX_STANDALONE_FIELD_LEN:
        return True
    return False


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
    # Also handles the case where a real question accumulated across prior
    # lines (fallback_label) is followed by a line with its own short inline
    # label and the blank itself (e.g. "How many...?" then "Number: ____
    # persons") — the accumulated question is the real label; a generic
    # inline filler word like "Number:"/"Amount:" is dropped as redundant.
    before = BLANK_RE.split(line)[0]
    after_parts = BLANK_RE.split(line)
    suffix = after_parts[-1].strip() if len(after_parts) > 1 else ""
    label_from_line = clean(before).rstrip(":").strip()
    label_from_pending = clean(fallback_label).rstrip(":").strip()
    GENERIC_FILLERS = {"number", "amount", "total", "response", "value"}
    overflow_instruction = None

    if label_from_pending and label_from_line:
        if label_from_line.lower() in GENERIC_FILLERS:
            label = label_from_pending
        elif len(label_from_pending) > MAX_STANDALONE_FIELD_LEN:
            # The accumulated text is a whole paragraph of narration (e.g.
            # a closing statement) with a short real field name tacked on
            # at the end ("...interview. End Time") — the narration is
            # instructional, only the short inline label is the field.
            overflow_instruction = label_from_pending
            label = label_from_line
        else:
            label = label_from_pending + " " + label_from_line
    elif label_from_pending:
        label = label_from_pending
    elif label_from_line:
        label = label_from_line
    else:
        label = "Response"

    if suffix and len(suffix) < 20 and not re.search(r"[☐]", suffix):
        label = f"{label} ({suffix.strip()})" if suffix.strip() else label
    return {
        "field_id": f"{qid}_{idx}",
        "label": label,
        "overflow_instruction": overflow_instruction,
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
        if re.match(r"^\**(response:?)?\**\s*1\s*2\s*3\s*4\s*5\s*$", clean(line), re.I):
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
            new_field = parse_blank_line(qid, group_idx, clean(line), pending_label)
            overflow = new_field.pop("overflow_instruction", None)
            if overflow:
                intro_text.append(overflow)
            fields.append(new_field)
            pending_label = ""
            i += 1
            continue

        # Sub-heading (### ...) inside a question block: flush whatever
        # question text had already accumulated (otherwise a run of
        # consecutive ### sub-headings silently discards everything but
        # the last one — e.g. "### C21a. Greatest Effect / Which shock
        # had the greatest effect?" followed immediately by "### C21b.
        # Main Effect" was losing the C21a question entirely), then start
        # a fresh label for the new sub-heading.
        h3 = re.match(r"^###\s+(.+)$", line.strip())
        if h3:
            if pending_label.strip():
                final_label = pending_label.strip()
                if not looks_instructional(final_label):
                    group_idx += 1
                    fields.append({
                        "field_id": f"{qid}_{group_idx}",
                        "label": final_label,
                        "type": "text",
                    })
                else:
                    intro_text.append(final_label)
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
        final_label = pending_label.strip()
        if looks_instructional(final_label):
            intro_text.append(final_label)
        else:
            group_idx += 1
            fields.append({
                "field_id": f"{qid}_{group_idx}",
                "label": final_label,
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

    # Fallback: an open-ended question with no explicit blank/checkbox line
    # still needs a data field IF it's actually a question. Pure front
    # matter / enumerator guidance with no real question is left with zero
    # fields on purpose — it renders as read-only instructional text.
    for s in sections:
        for q in s["questions"]:
            if not q["fields"] and q["instructions"] and not looks_instructional(q["instructions"]):
                q["fields"].append({
                    "field_id": f"{q['qid']}_1",
                    "label": q["instructions"],
                    "type": "text",
                })
                q["instructions"] = ""

    # Drop trailing/boundary-bleed sections that ended up with zero
    # questions (e.g. the markdown slice for one instrument catching the
    # first heading line of the next instrument in the source document).
    sections = [s for s in sections if s["questions"]]

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
