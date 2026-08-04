#!/usr/bin/env python3
"""
Applies all post-parse enhancements to the raw parsed schema:
  - Region -> predetermined dropdown (18 current PH regions)
  - Date / time / month-year fields -> native pickers
  - Numeric-only fields -> type 'number' (with unit hint where useful)
  - Conditional logic: fields that only apply to Individual OR
    Organizational/Enterprise respondents are auto-grayed + auto-N/A'd
    when the condition isn't met, based on the explicit "Ask only
    if.../For individual.../Individual...only" wording already present
    in the source questionnaire.
  - Location field hints (Province/Municipality/Barangay/Questionnaire
    Version) so the expected format is unambiguous.
  - Two field-specific label splits (Consent Confirmation, A4 org/ind
    name) where a real fillable field was bundled with instructional text.

Run after parse_questionnaire.py, before generate_gs_schema.py.
"""
import json
import re

PH_REGIONS = [
    "National Capital Region (NCR)",
    "Cordillera Administrative Region (CAR)",
    "Region I \u2013 Ilocos Region",
    "Region II \u2013 Cagayan Valley",
    "Region III \u2013 Central Luzon",
    "Region IV-A \u2013 CALABARZON",
    "MIMAROPA Region",
    "Region V \u2013 Bicol Region",
    "Region VI \u2013 Western Visayas",
    "Region VII \u2013 Central Visayas",
    "Region VIII \u2013 Eastern Visayas",
    "Region IX \u2013 Zamboanga Peninsula",
    "Region X \u2013 Northern Mindanao",
    "Region XI \u2013 Davao Region",
    "Region XII \u2013 SOCCSKSARGEN",
    "Region XIII \u2013 Caraga",
    "Negros Island Region (NIR)",
    "Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)",
]

DATE_FIELDS = {"QUESTIONNAIR_intro_2", "QUESTIONNAIR_intro_7", "Consent_Confirmation_3"}
TIME_FIELDS = {"QUESTIONNAIR_intro_8", "QUESTIONNAIR_intro_9", "CLOSING_STAT_intro_1"}
MONTH_FIELDS = {"E2_1", "E2_2", "E2_3"}

LOCATION_HINTS = {
    "A1_2": "e.g. Nueva Ecija",
    "A1_3": "e.g. Mu\u00f1oz City, or the specific municipality",
    "A1_4": "e.g. Malasin (as recorded on the sampling frame)",
    "QUESTIONNAIR_intro_1": "e.g. v1.0",
}

# Numeric field detection: label patterns strongly implying a numeric answer.
NUMERIC_PATTERNS = [
    r"\bage\b", r"\bhow many\b", r"\bhow much\b", r"\bnumber of\b",
    r"\bamount\b", r"\bPHP\b", r"\byears?\)", r"\bin completed years\b",
    r"\bpercent\b", r"%", r"\bhectares?\b", r"\bsq\.?\s*m\b",
    r"\bmembers?\s*\(persons\)", r"\bincome\b", r"\brevenue\b", r"\bsales\b",
    r"\(persons\)", r"\(documents\)", r"\(visits", r"\byield per hectare\b",
    r"\btotal number\b", r"interest rate", r"\bproduction cycles\b",
]
NUMERIC_RE = re.compile("|".join(NUMERIC_PATTERNS), re.I)
# Exclude fields that only *mention* a number-ish word but aren't literally
# numeric answers (open qualitative follow-ups, month/year, already-handled
# date/time fields, or scale/likert-style "years" that's really a duration
# category rather than free entry).
NUMERIC_EXCLUDE_IDS = set(MONTH_FIELDS) | DATE_FIELDS | TIME_FIELDS

CONDITION_RE = re.compile(
    r"^(ask only if a2\s*=\s*|for\s+)?(individual|organizational)"
    r"[\w\s/\u2013-]{0,40}?(borrowers?|respondents?)\b",
    re.I,
)


def detect_branch(label):
    """Returns 'individual', 'organizational', or None."""
    m = CONDITION_RE.match(label.strip())
    if not m:
        return None
    return "individual" if m.group(2).lower() == "individual" else "organizational"


def a2_field_and_values(schema):
    """Find the Borrower/Respondent Type field and its two option strings."""
    for s in schema["sections"]:
        for q in s["questions"]:
            for f in q["fields"]:
                if f["field_id"] == "A2_1":
                    ind = next((o for o in f["options"] if "individual" in o.lower()), None)
                    org = next((o for o in f["options"] if "organizational" in o.lower()), None)
                    return f["field_id"], ind, org
    return None, None, None


def strip_branch_prefix(label, branch, heading=""):
    """Remove the leading routing phrase now that it's encoded as a real
    condition, leaving a clean question label. Falls back to the question
    heading if nothing meaningful remains (e.g. the whole original label
    was just "For Individual Borrowers only.")."""
    cleaned = CONDITION_RE.sub("", label.strip(), count=1)
    cleaned = re.sub(r"^\s*only\b[:.\s]*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"^[:.\s]+", "", cleaned).strip()
    if len(cleaned) >= 4:
        return cleaned
    # Nothing substantive left — fall back to the question heading, minus
    # its leading item code (e.g. "B3. Highest Educational Attainment").
    fallback = re.sub(r"^[A-Za-z0-9]+\.\s*", "", heading).strip()
    return fallback or label


def patch(path):
    with open(path, encoding="utf-8") as f:
        schema = json.load(f)

    a2_id, ind_val, org_val = a2_field_and_values(schema)

    numeric_count = 0
    condition_count = 0

    for s in schema["sections"]:
        for q in s["questions"]:
            for f in q["fields"]:
                fid = f["field_id"]

                # --- Region dropdown ---
                if fid == "A1_1":
                    f["type"] = "single_choice"
                    f["options"] = list(PH_REGIONS)

                # --- Date / time / month pickers ---
                elif fid in DATE_FIELDS:
                    f["type"] = "date"
                elif fid in TIME_FIELDS:
                    f["type"] = "time"
                elif fid in MONTH_FIELDS:
                    f["type"] = "month"

                # --- Location / version hints ---
                if fid in LOCATION_HINTS:
                    f["hint"] = LOCATION_HINTS[fid]

                # --- Numeric fields (only plain text fields, and not ones
                #     already converted to date/time/month above) ---
                if (f["type"] == "text" and fid not in NUMERIC_EXCLUDE_IDS
                        and NUMERIC_RE.search(f["label"])):
                    f["type"] = "number"
                    numeric_count += 1

                # --- Conditional logic: Individual-only / Org-only fields ---
                if a2_id and fid != a2_id:
                    branch = detect_branch(f["label"])
                    if branch == "individual" and ind_val:
                        f["condition"] = {"field": a2_id, "equals": ind_val}
                        f["label"] = strip_branch_prefix(f["label"], branch, q["heading"])
                        condition_count += 1
                    elif branch == "organizational" and org_val:
                        f["condition"] = {"field": a2_id, "equals": org_val}
                        f["label"] = strip_branch_prefix(f["label"], branch, q["heading"])
                        condition_count += 1

    # --- Two label splits: real fillable field bundled with instructional text ---
    for s in schema["sections"]:
        for q in s["questions"]:
            new_fields = []
            for f in q["fields"]:
                if f["field_id"] == "Consent_Confirmation_1":
                    q["instructions"] = (q["instructions"] + " " if q["instructions"] else "") + (
                        "I confirm that I explained the study purpose, voluntary participation, "
                        "confidentiality and data-privacy provisions, and the respondent\u2019s right "
                        "to decline questions or stop the interview."
                    )
                    f = dict(f)
                    f["label"] = "Enumerator Name"
                elif f["field_id"] == "A4_2":
                    note = f["label"].split("Enumerator", 1)
                    if len(note) > 1:
                        q["instructions"] = (q["instructions"] + " " if q["instructions"] else "") + "Enumerator" + note[1]
                    f = dict(f)
                    f["label"] = ("Name of borrowing organization / enterprise"
                                   if "borrowing organization" in f["label"] else "Name of organization / enterprise")
                new_fields.append(f)
            q["fields"] = new_fields

    with open(path, "w", encoding="utf-8") as out:
        json.dump(schema, out, indent=2, ensure_ascii=False)

    return numeric_count, condition_count


if __name__ == "__main__":
    for p in ["questions_A.json", "questions_B.json"]:
        n_num, n_cond = patch(p)
        print(f"{p}: {n_num} numeric fields, {n_cond} conditional fields")
