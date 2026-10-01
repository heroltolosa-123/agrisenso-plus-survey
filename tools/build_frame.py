#!/usr/bin/env python3
"""Stamps respondent codes onto an approved sampling frame.

The respondent code is the Sampling Frame ID the enumerator transcribes
into the app, and it is deliberately not something composed in the field:

    I-RR-PPP-NNNN       e.g. A-01-LUN-0147

    I     instrument, A (borrower) or B (comparison group)
    RR    PSGC region code
    PPP   three-letter province abbreviation (PROVINCES below)
    NNNN  the row's position in the approved frame for that
          instrument and province, four digits, zero-padded

Numbering by row position is what makes the code verifiable: it is a
transcription, and it reconciles one-to-one with the list. So this runs
ONCE per approved frame. Re-running on a frame that is already stamped
keeps every existing code (see --restamp if a frame must truly be
renumbered, which should not happen after fieldwork starts).

    python3 build_frame.py raw_list.csv -o frame_2026.csv
    python3 build_frame.py --template          # writes an empty input CSV
    python3 build_frame.py --demo              # self-check

The borrower type and segment columns are validated against the live
questionnaire, so a frame cannot carry a segment the app will not offer
the enumerator at A3.
"""
import argparse
import csv
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))

# Province abbreviations for the sampled clusters. Add a row as each
# cluster is confirmed; reference/coding_reference.html carries the same
# table for the field teams and tools/simulate/check_coding.js fails if
# the two disagree.
PROVINCES = {
    "LUN": ("La Union", "01"),
    "ILS": ("Ilocos Sur", "01"),
    "OCM": ("Occidental Mindoro", "17"),
    "BEN": ("Benguet", "14"),
}

COLUMNS = ["instrument", "province", "municipality", "barangay", "name",
           "organization", "respondent_type", "segment", "lending_centre",
           "account_ref", "status"]
CODE_COLUMN = "RESPONDENT_CODE"
CODE_RE = re.compile(r"^([AB])-(\d{2})-([A-Z]{3})-(\d{4})(-R\d+)?$")
STATUSES = ("sample", "reserve")


def die(msg):
    sys.stderr.write("error: %s\n" % msg)
    raise SystemExit(1)


def schema_options(instrument, field_id):
    """Option list for one field, straight from the live questionnaire."""
    path = os.path.join(HERE, "questions_%s.json" % instrument)
    with open(path, encoding="utf-8") as fh:
        schema = json.load(fh)
    for section in schema["sections"]:
        for question in section.get("questions", []):
            for field in question.get("fields", []):
                if field["field_id"] == field_id:
                    return field.get("options") or []
    die("field %s not found in instrument %s" % (field_id, instrument))


def option_key(option):
    """'Small Farmer / Fisherfolk (SFF)' -> 'small farmer / fisherfolk'.

    Frames arrive written by hand, so match on the stem and let the
    bracketed acronym, a trailing '(specify): ___' and casing vary.
    """
    text = re.sub(r"_{3,}", "", str(option))
    text = re.sub(r"\(specify\)\s*:?", "", text, flags=re.I)
    text = re.sub(r"\(([A-Z]{2,6})\)", "", text)
    return re.sub(r"\s+", " ", text).strip(" :").lower()


def build_matcher(instrument, field_id):
    """Accepts the full option text, its acronym, or a close stem."""
    table = {}
    for option in schema_options(instrument, field_id):
        table[option_key(option)] = option
        for acronym in re.findall(r"\(([A-Z]{2,6})\)", str(option)):
            table[acronym.lower()] = option
        # 'Individual borrower' / 'Individual respondent' -> 'individual'
        first = option_key(option).split()[0]
        table.setdefault(first, option)

    def match(value):
        key = option_key(value)
        if key in table:
            return table[key]
        for known, option in table.items():
            if known and (key.startswith(known) or known.startswith(key)):
                return option
        return None

    return match


def read_rows(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        die("%s has no data rows" % path)
    missing = [c for c in COLUMNS if c not in rows[0]]
    if missing:
        die("%s is missing column(s): %s\n       run --template for the "
            "expected header" % (path, ", ".join(missing)))
    return rows


def stamp(rows, restamp=False):
    """Returns (rows, problems). Existing codes are kept unless restamp."""
    problems = []
    matchers = {}
    counters = Counter()
    seen_codes = {}

    # Existing codes first, so a re-run never hands out a number that is
    # already in the field.
    for row in rows:
        existing = (row.get(CODE_COLUMN) or "").strip()
        if existing and not restamp:
            hit = CODE_RE.match(existing)
            if not hit:
                problems.append("row %s: existing code %r is malformed"
                                % (row["_line"], existing))
                continue
            counters[(hit.group(1), hit.group(3))] = max(
                counters[(hit.group(1), hit.group(3))], int(hit.group(4)))

    for row in rows:
        line = row["_line"]
        instrument = (row.get("instrument") or "").strip().upper()
        if instrument not in ("A", "B"):
            problems.append("row %s: instrument must be A or B, got %r"
                            % (line, row.get("instrument")))
            continue

        province = (row.get("province") or "").strip()
        ppp = next((k for k, (name, _) in PROVINCES.items()
                    if name.lower() == province.lower() or k == province.upper()), None)
        if not ppp:
            problems.append("row %s: province %r is not in PROVINCES — add it "
                            "to build_frame.py and to the coding card"
                            % (line, province))
            continue
        region = PROVINCES[ppp][1]

        if not (row.get("name") or "").strip() and not (row.get("organization") or "").strip():
            problems.append("row %s: needs a name or an organization" % line)

        status = (row.get("status") or "sample").strip().lower()
        if status not in STATUSES:
            problems.append("row %s: status must be one of %s, got %r"
                            % (line, "/".join(STATUSES), row.get("status")))

        for column, field_id in (("respondent_type", "A2_1"), ("segment", "A3_1")):
            value = (row.get(column) or "").strip()
            if not value:
                problems.append("row %s: %s is blank" % (line, column))
                continue
            key = (instrument, field_id)
            if key not in matchers:
                matchers[key] = build_matcher(instrument, field_id)
            matched = matchers[key](value)
            if matched is None:
                problems.append("row %s: %s %r is not an option the app offers at %s"
                                % (line, column, value, field_id))
            else:
                # Write back the app's own wording, so the frame and the
                # questionnaire cannot disagree about a category.
                row[column] = matched

        code = (row.get(CODE_COLUMN) or "").strip()
        if not code or restamp:
            counters[(instrument, ppp)] += 1
            code = "%s-%s-%s-%04d" % (instrument, region, ppp, counters[(instrument, ppp)])
            row[CODE_COLUMN] = code
        if code in seen_codes:
            problems.append("row %s: code %s already used on row %s"
                            % (line, code, seen_codes[code]))
        seen_codes[code] = line

    return rows, problems


def write_rows(rows, path):
    header = [CODE_COLUMN] + COLUMNS
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=header, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def template(path):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(COLUMNS)
        writer.writerow(["A", "La Union", "Agoo", "San Roque", "Dela Cruz, Pedro S.",
                         "", "Individual", "SFF", "Agoo Lending Center", "", "sample"])
        writer.writerow(["A", "La Union", "Agoo", "San Roque", "",
                         "Agoo Farmers MPC", "Organizational", "FFCA",
                         "Agoo Lending Center", "", "reserve"])
        writer.writerow(["B", "Ilocos Sur", "Narvacan", "Bulanos", "Reyes, Ana M.",
                         "", "Individual", "SFF", "", "", "sample"])
    print("wrote %s — fill it from the approved list, one row per respondent" % path)


def demo():
    """Self-check: the properties the field procedure depends on."""
    rows = [
        {"_line": 2, "instrument": "A", "province": "La Union", "municipality": "Agoo",
         "barangay": "San Roque", "name": "Dela Cruz, Pedro S.", "organization": "",
         "respondent_type": "Individual", "segment": "SFF", "lending_centre": "",
         "account_ref": "", "status": "sample"},
        {"_line": 3, "instrument": "A", "province": "La Union", "municipality": "Agoo",
         "barangay": "San Roque", "name": "", "organization": "Agoo Farmers MPC",
         "respondent_type": "Organizational / enterprise borrower", "segment": "FFCA",
         "lending_centre": "", "account_ref": "", "status": "reserve"},
        {"_line": 4, "instrument": "A", "province": "Ilocos Sur", "municipality": "Narvacan",
         "barangay": "Bulanos", "name": "Reyes, Ana M.", "organization": "",
         "respondent_type": "Individual", "segment": "ARB", "lending_centre": "",
         "account_ref": "", "status": "sample"},
        {"_line": 5, "instrument": "B", "province": "La Union", "municipality": "Agoo",
         "barangay": "San Roque", "name": "Santos, Jose P.", "organization": "",
         "respondent_type": "Individual", "segment": "SFF", "lending_centre": "",
         "account_ref": "", "status": "sample"},
    ]
    rows, problems = stamp([dict(r) for r in rows])
    assert not problems, problems
    codes = [r[CODE_COLUMN] for r in rows]
    # Numbering restarts per instrument and per province, and a reserve
    # row takes a number like any other.
    assert codes == ["A-01-LUN-0001", "A-01-LUN-0002",
                     "A-01-ILS-0001", "B-01-LUN-0001"], codes
    assert all(CODE_RE.match(c) for c in codes)
    # Segments are rewritten into the app's own wording.
    assert rows[0]["segment"] == "Small Farmer / Fisherfolk (SFF)", rows[0]["segment"]
    assert rows[1]["respondent_type"] == "Organizational / enterprise borrower"
    assert rows[3]["segment"] == "Small Farmer / Fisherfolk (SFF)"

    # A second pass must not renumber anyone: codes already issued are in
    # the field on paper.
    again, problems = stamp(rows)
    assert not problems, problems
    assert [r[CODE_COLUMN] for r in again] == codes, [r[CODE_COLUMN] for r in again]

    # A row added later continues the sequence rather than colliding.
    added = rows + [{"_line": 6, "instrument": "A", "province": "La Union",
                     "municipality": "Agoo", "barangay": "Santa Rita",
                     "name": "Bautista, Luz R.", "organization": "",
                     "respondent_type": "Individual", "segment": "SFF",
                     "lending_centre": "", "account_ref": "", "status": "sample"}]
    added, problems = stamp(added)
    assert not problems, problems
    assert added[-1][CODE_COLUMN] == "A-01-LUN-0003", added[-1][CODE_COLUMN]

    # Rejections the frame must not survive.
    bad = [
        {"_line": 2, "instrument": "C", "province": "La Union", "name": "X",
         "organization": "", "respondent_type": "Individual", "segment": "SFF",
         "status": "sample"},
        {"_line": 3, "instrument": "A", "province": "Bulacan", "name": "X",
         "organization": "", "respondent_type": "Individual", "segment": "SFF",
         "status": "sample"},
        {"_line": 4, "instrument": "A", "province": "La Union", "name": "",
         "organization": "", "respondent_type": "Individual", "segment": "SFF",
         "status": "sample"},
        {"_line": 5, "instrument": "A", "province": "La Union", "name": "X",
         "organization": "", "respondent_type": "Individual",
         "segment": "Rice farmer", "status": "sample"},
        {"_line": 6, "instrument": "A", "province": "La Union", "name": "X",
         "organization": "", "respondent_type": "Individual", "segment": "SFF",
         "status": "maybe"},
    ]
    _, problems = stamp(bad)
    assert len(problems) == 5, problems
    assert "instrument must be A or B" in problems[0]
    assert "not in PROVINCES" in problems[1]
    assert "needs a name or an organization" in problems[2]
    assert "not an option the app offers" in problems[3]
    assert "status must be" in problems[4]

    # A malformed code already in the file is reported, not silently fixed.
    _, problems = stamp([{"_line": 2, "instrument": "A", "province": "La Union",
                          "name": "X", "organization": "",
                          "respondent_type": "Individual", "segment": "SFF",
                          "status": "sample", CODE_COLUMN: "A-1-LUN-147"}])
    assert any("malformed" in p for p in problems), problems

    # Every province in the table is a real PSGC region.
    for ppp, (name, region) in PROVINCES.items():
        assert re.match(r"^[A-Z]{3}$", ppp), ppp
        assert region in ["%02d" % n for n in range(1, 19)], (ppp, region)

    print("build_frame self-check passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", nargs="?", help="CSV of the approved list")
    parser.add_argument("-o", "--out", help="where to write the stamped frame")
    parser.add_argument("--template", metavar="PATH", nargs="?", const="frame_template.csv",
                        help="write an empty input CSV and exit")
    parser.add_argument("--restamp", action="store_true",
                        help="renumber everything, discarding existing codes")
    parser.add_argument("--demo", action="store_true", help="run the self-check and exit")
    args = parser.parse_args()

    if args.demo:
        return demo()
    if args.template:
        return template(args.template)
    if not args.source:
        parser.error("give a source CSV, or --template to start one")

    rows = read_rows(args.source)
    for n, row in enumerate(rows, start=2):
        row["_line"] = n
    rows, problems = stamp(rows, restamp=args.restamp)
    if problems:
        sys.stderr.write("\n".join(problems) + "\n")
        die("%d problem(s) — nothing written" % len(problems))

    out = args.out or os.path.splitext(args.source)[0] + "_frame.csv"
    write_rows(rows, out)
    counts = Counter(r[CODE_COLUMN][:8] for r in rows)
    print("wrote %s (%d rows)" % (out, len(rows)))
    for prefix in sorted(counts):
        print("   %s  %d" % (prefix, counts[prefix]))


if __name__ == "__main__":
    main()
