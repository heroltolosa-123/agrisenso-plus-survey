#!/usr/bin/env python3
"""
Applies all post-parse enhancements to the raw parsed schema. Run after
parse_questionnaire.py, before generate_gs_schema.py.

Design principles (revised after the ACPC/DRVN review of the first
electronic version):
  - Required is opt-in, not a blanket rule. Only a small, curated set of
    structural/eligibility "hard gate" fields are required; everything
    else can legitimately be left blank if a respondent declines, same
    as informed consent allows.
  - N/A is never auto-added as a selectable option. It only exists where
    the source questionnaire itself listed "N/A"/"Not applicable" as one
    of its own options (genuine routing-based non-applicability), or as
    the auto-filled value for a field that's conditionally grayed out
    because it doesn't apply to this respondent's branch/answer.
  - Conditional fields ("If Yes, ...", "Ask only if...") are detected
    from the questionnaire's own explicit wording and turned into real
    show/hide + auto-N/A logic, not just printed as static instructions.
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
# Used client-side to auto-derive Island Group from Region so the
# enumerator is never asked to answer something derivable from Region.
REGION_TO_ISLAND = {
    "National Capital Region (NCR)": "Luzon",
    "Cordillera Administrative Region (CAR)": "Luzon",
    "Region I \u2013 Ilocos Region": "Luzon",
    "Region II \u2013 Cagayan Valley": "Luzon",
    "Region III \u2013 Central Luzon": "Luzon",
    "Region IV-A \u2013 CALABARZON": "Luzon",
    "MIMAROPA Region": "Luzon",
    "Region V \u2013 Bicol Region": "Luzon",
    "Region VI \u2013 Western Visayas": "Visayas",
    "Region VII \u2013 Central Visayas": "Visayas",
    "Region VIII \u2013 Eastern Visayas": "Visayas",
    "Negros Island Region (NIR)": "Visayas",
    "Region IX \u2013 Zamboanga Peninsula": "Mindanao",
    "Region X \u2013 Northern Mindanao": "Mindanao",
    "Region XI \u2013 Davao Region": "Mindanao",
    "Region XII \u2013 SOCCSKSARGEN": "Mindanao",
    "Region XIII \u2013 Caraga": "Mindanao",
    "Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)": "Mindanao",
}

DATE_FIELDS = {"QUESTIONNAIR_intro_2", "Consent_Confirmation_3"}
# Interview date/start/end time are auto-captured by the app itself
# (see docs/app.js) rather than manually typed, per reviewer feedback
# that manual entry invites avoidable timestamp errors.
AUTO_TIMESTAMP_FIELDS = {"QUESTIONNAIR_intro_7", "QUESTIONNAIR_intro_8", "QUESTIONNAIR_intro_9", "CLOSING_STAT_intro_1"}
MONTH_FIELDS = {"E2_1", "E2_2", "E2_3"}

LOCATION_HINTS = {
    "A1_2": "e.g. Nueva Ecija",
    "A1_3": "e.g. Mu\u00f1oz City, or the specific municipality",
    "A1_4": "e.g. Malasin (as recorded on the sampling frame)",
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
NUMERIC_EXCLUDE_IDS = set(MONTH_FIELDS) | DATE_FIELDS | AUTO_TIMESTAMP_FIELDS

# Percent-of-total fields: bounded 0-100, and (for the Output Disposition
# style matrices) auto-summed client-side. Detected by column/row context
# instead of listed individually since they're all matrix cells.
PERCENT_HINT_WORDS = ("%", "percent", "proportion")

# ---------------------------------------------------------------------
# Hard-gate fields: the ONLY fields required to proceed. Curated from the
# ACPC/DRVN review: consent, eligibility screening, and the handful of
# structural facts (region, borrower type, language, interview mode) that
# must exist for every genuine interview. Deliberately short — everything
# else may be left blank if a respondent declines, per informed consent.
# ---------------------------------------------------------------------
REQUIRED_FIELD_IDS = {
    "Consent_to_Participa_1",
    "Consent_for_Possible_1",
    "Consent_Confirmation_1",  # enumerator attestation checkbox
    "A1_1",   # Region
    "A2_1",   # Borrower type
    "A5_1",   # Loan agreement verification
    "A6_1",   # Status of loan release
    "A7_1", "A7_2", "A7_3",  # individual eligibility (named borrower / age / involvement)
    "A8_1", "A8_2",  # organizational eligibility (role / authorized)
    "B2_1",   # Age (individual branch)
    "QUESTIONNAIR_intro_10",  # Language
    "QUESTIONNAIR_intro_11",  # Interview mode
}
# Also apply per-instrument below for B's equivalents (A5/A6 don't exist
# in B; B's own screening fields are picked up by id where they match).

CONDITION_RE = re.compile(
    r"^(ask only if a2\s*=\s*|for\s+)?(individual|organizational)"
    r"[\w\s/\u2013-]{0,40}?(borrowers?|respondents?)\b",
    re.I,
)

# General "If <value>[,:]" follow-up-question detector. Captures the
# trigger value(s) mentioned (may be a single word like "Yes"/"No"/
# "repeat", or a short phrase like "unclear") and the remaining question
# text once the routing clause is stripped.
IF_FOLLOWUP_RE = re.compile(r"^if\s+([^,:.]+)[,:]?\s*(.*)$", re.I)

# A leading "If <condition> \u2192 <instruction sentence>." clause glued onto
# the front of what is otherwise a real, separate question (e.g. "If No
# \u2192 Do not continue unless the approved field protocol specifically
# permits another qualified respondent. Refer to supervisor. Is the
# respondent at least 18 years old?"). Strips the routing clause, keeps
# the real question that follows.
LEADING_ARROW_CLAUSE_RE = re.compile(
    r"^if\s+[^.]+?(?:\u2192|->)[^.]*\.(?:\s*[^.?]+\.)*\s*", re.I
)


def detect_branch(label):
    m = CONDITION_RE.match(label.strip())
    if not m:
        return None
    return "individual" if m.group(2).lower() == "individual" else "organizational"


def a2_field_and_values(schema):
    for s in schema["sections"]:
        for q in s["questions"]:
            for f in q["fields"]:
                if f["field_id"] == "A2_1":
                    ind = next((o for o in f["options"] if "individual" in o.lower()), None)
                    org = next((o for o in f["options"] if "organizational" in o.lower()), None)
                    return f["field_id"], ind, org
    return None, None, None


def strip_branch_prefix(label, heading=""):
    cleaned = CONDITION_RE.sub("", label.strip(), count=1)
    cleaned = re.sub(r"^\s*only\b[:.\s]*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"^[:.\s]+", "", cleaned).strip()
    if len(cleaned) >= 4:
        return cleaned
    fallback = re.sub(r"^[A-Za-z0-9]+\.\s*", "", heading).strip()
    return fallback or label


def find_matching_options(trigger_field, phrase):
    """Given a trigger phrase like 'yes' or 'very unclear or unclear' or
    'repeat', return the list of the trigger field's actual option strings
    that it refers to (fuzzy, case-insensitive substring match in both
    directions so 'Yes' matches 'Yes, regularly' AND 'Yes - Continue')."""
    if not trigger_field or trigger_field.get("type") not in ("single_choice", "multi_choice"):
        return []
    words = [w.strip() for w in re.split(r"\bor\b|,|/", phrase.lower()) if w.strip()]
    matches = []
    for opt in trigger_field.get("options", []):
        opt_low = opt.lower()
        for w in words:
            if w in opt_low or opt_low.startswith(w):
                matches.append(opt)
                break
    return matches


def add_condition(field, trigger_field_id, values, empty=False, not_empty=False):
    """Attach one AND-clause to field['conditions'] (a field can depend on
    more than one prior answer, e.g. Own/Shared phone needs BOTH the
    Individual branch AND Mobile Access = Yes). `values` is a list for an
    'in' clause; use empty=True / not_empty=True instead for presence-based
    clauses (e.g. "only show this fallback if the numeric field is blank")."""
    if empty:
        clause = {"field": trigger_field_id, "empty": True}
    elif not_empty:
        clause = {"field": trigger_field_id, "notEmpty": True}
    elif values:
        clause = {"field": trigger_field_id, "in": values}
    else:
        return False
    field.setdefault("conditions", [])
    field["conditions"].append(clause)
    return True


def apply_if_followup_detection(question):
    """Walk a question's fields in order; whenever a field's label starts
    with 'If <value>...', attach a condition on the most recent preceding
    choice-type field in the same question, matching the referenced
    value(s), and strip the routing clause from the label."""
    prev_choice = None
    for f in question["fields"]:
        label = f["label"].strip()
        m = re.match(r"^if\s+(.+)$", label, re.I)
        if m and prev_choice and prev_choice["field_id"] != f["field_id"]:
            rest_all = m.group(1)
            parts = re.split(r"[,:]", rest_all, maxsplit=1)
            if len(parts) == 2:
                phrase, rest = parts[0], parts[1].strip()
            else:
                words = rest_all.split(None, 1)
                phrase = words[0] if words else rest_all
                rest = words[1].strip() if len(words) > 1 else ""
            rest = re.sub(r"^and\s+", "", rest, flags=re.I).strip()
            matched_opts = find_matching_options(prev_choice, phrase)
            if matched_opts:
                added = add_condition(f, prev_choice["field_id"], matched_opts)
                if added:
                    new_label = rest if len(rest) >= 4 else question["heading"]
                    new_label = re.sub(r"^[A-Za-z0-9]+\.\s*", "", new_label).strip()
                    new_label = new_label[0].upper() + new_label[1:] if new_label else f["label"]
                    f["label"] = new_label or f["label"]
        if f["type"] in ("single_choice", "multi_choice", "scale_1_5"):
            prev_choice = f


# Exact-amount vs. "can't provide it" mutual exclusivity: several
# questions ask for a precise PHP figure, then separately offer a
# fallback ("Unable to estimate"/"Prefer not to answer") and sometimes a
# further bracket/tier question once a fallback reason is picked. These
# are meant to be alternate paths to the SAME answer, not three
# independently-required questions — giving an exact figure should gray
# out the fallback (and its tier), and picking a fallback reason should
# gray out the numeric field. Maps: numeric_field_id -> (fallback_field_id,
# optional tier_field_id).
AMOUNT_FALLBACK_GROUPS = {
    "B8_1": ("B8_2", "B8_3"),
    "C13_1": ("C13_2", "C13_3"),
    "C14_1": ("C14_2", None),
    "C15_1": ("C15_2", None),
    "F6_1": ("F6_2", None),
}
# Two numeric fields sharing one fallback (fallback only applies once BOTH
# numerics are empty).
DUAL_AMOUNT_FALLBACK_GROUPS = {
    "E14_3": ("E14_1", "E14_2"),
}


def apply_amount_fallback_conditions(schema):
    count = 0
    for numeric_id, (fallback_id, tier_id) in AMOUNT_FALLBACK_GROUPS.items():
        numeric_f = find_field(schema, numeric_id)
        fallback_f = find_field(schema, fallback_id)
        if not numeric_f or not fallback_f:
            continue
        add_condition(numeric_f, fallback_id, None, empty=True)
        add_condition(fallback_f, numeric_id, None, empty=True)
        count += 2
        if tier_id:
            tier_f = find_field(schema, tier_id)
            if tier_f:
                add_condition(tier_f, fallback_id, None, not_empty=True)
                count += 1
    for fallback_id, (num1_id, num2_id) in DUAL_AMOUNT_FALLBACK_GROUPS.items():
        fallback_f = find_field(schema, fallback_id)
        f1, f2 = find_field(schema, num1_id), find_field(schema, num2_id)
        if fallback_f and f1 and f2:
            add_condition(fallback_f, num1_id, None, empty=True)
            add_condition(fallback_f, num2_id, None, empty=True)
            count += 1
    return count


def find_field(schema, field_id):
    for s in schema["sections"]:
        for q in s["questions"]:
            for f in q["fields"]:
                if f["field_id"] == field_id:
                    return f
    return None


# One-off fields that depend on a prior Yes/No answer but the source
# wording doesn't use the "If Yes/If No" phrasing the general detector
# looks for (e.g. "For individual borrower:" introducing the phone-type
# follow-up, which only makes sense once B12_1 = Yes). Maps field_id ->
# (trigger_field_id, trigger_option_substring).
EXTRA_CONDITIONS = {
    "B12_2": ("B12_1", "yes"),
}


# ---------------------------------------------------------------------
# Multi-choice reclassification: these were parsed as single_choice
# (radio/dropdown) but the questionnaire's own intent (confirmed in
# review) allows more than one answer.
# ---------------------------------------------------------------------
MULTI_CHOICE_FIELD_IDS = {
    "C12_3",   # Extension/technical support provider
    "C16_2",   # Record-keeping methods
    "C20_1",   # Value-chain participation stages
    "C21_1",   # Major shocks experienced
    "C22_1",   # Risk-management practices used
    "C23_2",   # Insurance type
    "C23_3",   # Insurance provider
    "D5_1",    # Difficulties during application
    "E5_1",    # Stated purpose of loan
    "G12_2",   # Digital-service difficulties experienced
    "G13_1",   # Training/advisory support received
    "G14_1",   # Training provider
}


def patch(path, instrument_key):
    with open(path, encoding="utf-8") as f:
        schema = json.load(f)

    a2_id, ind_val, org_val = a2_field_and_values(schema)
    numeric_count = 0
    branch_condition_count = 0
    followup_condition_count = 0
    multi_count = 0

    for s in schema["sections"]:
        for q in s["questions"]:
            for f in q["fields"]:
                fid = f["field_id"]

                # Strip a leading "If X -> instruction." clause that got
                # glued onto a real trailing question by the parser.
                stripped = LEADING_ARROW_CLAUSE_RE.sub("", f["label"], count=1).strip()
                if stripped and stripped != f["label"] and len(stripped) >= 4:
                    f["label"] = stripped

                if fid == "A1_1":
                    f["type"] = "single_choice"
                    f["options"] = list(PH_REGIONS)
                elif fid in DATE_FIELDS:
                    f["type"] = "date"
                elif fid in MONTH_FIELDS:
                    f["type"] = "month"

                if fid in LOCATION_HINTS:
                    f["hint"] = LOCATION_HINTS[fid]

                if (f["type"] == "text" and fid not in NUMERIC_EXCLUDE_IDS
                        and NUMERIC_RE.search(f["label"])):
                    f["type"] = "number"
                    numeric_count += 1

                # Confidence-scale questions that spelled out "1 = Not at
                # all confident 2 = Slightly confident..." in the label
                # text are redundant once the UI already shows numbered
                # 1-5 choices — trim to just the question itself.
                if f["type"] == "scale_1_5":
                    trimmed = re.sub(r"\s*1\s*=\s*.+$", "", f["label"]).strip()
                    if len(trimmed) >= 10:
                        f["label"] = trimmed

                if fid in MULTI_CHOICE_FIELD_IDS and f["type"] == "single_choice":
                    f["type"] = "multi_choice"
                    multi_count += 1

                if a2_id and fid != a2_id:
                    branch = detect_branch(f["label"])
                    if branch == "individual" and ind_val:
                        add_condition(f, a2_id, [ind_val])
                        f["label"] = strip_branch_prefix(f["label"], q["heading"])
                        branch_condition_count += 1
                    elif branch == "organizational" and org_val:
                        add_condition(f, a2_id, [org_val])
                        f["label"] = strip_branch_prefix(f["label"], q["heading"])
                        branch_condition_count += 1

                f["required"] = fid in REQUIRED_FIELD_IDS

                if fid in EXTRA_CONDITIONS:
                    trig_id, trig_substr = EXTRA_CONDITIONS[fid]
                    trig_field = next((fl for s2 in schema["sections"] for q2 in s2["questions"]
                                        for fl in q2["fields"] if fl["field_id"] == trig_id), None)
                    if trig_field:
                        matches = find_matching_options(trig_field, trig_substr)
                        if matches:
                            add_condition(f, trig_id, matches)
                            followup_condition_count += 1

            # A branch condition detected on one field in a question (e.g.
            # from its explicit "Ask only if A2 = Individual..." wording)
            # applies to the whole question group — sibling fields without
            # their own explicit wording (like a follow-up "is respondent
            # 18+?") are still part of the same individual/organizational
            # eligibility flow and must be gated the same way.
            branch_conds = [c for fl in q["fields"] for c in fl.get("conditions", [])
                             if c["field"] == a2_id]
            if branch_conds:
                inherited = branch_conds[0]
                for fl in q["fields"]:
                    if fl["field_id"] == a2_id:
                        continue
                    already = any(c["field"] == a2_id for c in fl.get("conditions", []))
                    if not already:
                        add_condition(fl, inherited["field"], inherited["in"])
                        branch_condition_count += 1

            before = sum(1 for fl in q["fields"] if "conditions" in fl)
            apply_if_followup_detection(q)
            after = sum(1 for fl in q["fields"] if "conditions" in fl)
            followup_condition_count += (after - before)

    amount_fallback_count = apply_amount_fallback_conditions(schema)

    # ------------------------------------------------------------
    # Targeted, one-off fixes identified in review
    # ------------------------------------------------------------
    for s in schema["sections"]:
        for q in s["questions"]:
            new_fields = []
            for f in q["fields"]:
                fid = f["field_id"]

                # Consent script: the opening line got split into a fake
                # field; restore it as part of the instructions and drop
                # the field entirely.
                if fid == "INTRODUCTION_intro_1":
                    q["instructions"] = (
                        "Enumerator: read the following statement to the respondent, "
                        "inserting your own name where indicated. \u201cGood day. My name is "
                        "[enumerator name], and I am " + q["instructions"]
                    )
                    continue  # drop the field

                # Explanatory note wrongly became a response box.
                if fid == "Consent_for_Possible_2":
                    q["instructions"] = (q["instructions"] + " " if q["instructions"] else "") + f["label"].strip("*")
                    continue

                # Consent Confirmation redesign: one attestation checkbox
                # instead of typed "signature"/duplicate name/manual date.
                if fid == "Consent_Confirmation_1":
                    f = dict(f)
                    f["type"] = "multi_choice"
                    f["options"] = ["I certify that I read/explained the informed consent "
                                     "and that the respondent voluntarily agreed to participate."]
                    f["label"] = "Enumerator Attestation"
                    f["required"] = True
                elif fid == "Consent_Confirmation_2":
                    continue  # "Enumerator Signature" text box — redundant with attestation
                elif fid == "Consent_Confirmation_3":
                    continue  # Date — redundant with the automatic submission timestamp
                elif fid == "Consent_Confirmation_4":
                    f = dict(f)
                    f["label"] = "Respondent Signature (optional)"
                    f["required"] = False

                # A4 org/individual name split (kept from earlier pass).
                elif fid == "A4_2":
                    note = f["label"].split("Enumerator", 1)
                    if len(note) > 1:
                        q["instructions"] = (q["instructions"] + " " if q["instructions"] else "") + "Enumerator" + note[1]
                    f = dict(f)
                    f["label"] = ("Name of borrowing organization / enterprise"
                                   if "borrowing organization" in f["label"] else "Name of organization / enterprise")

                # C21a "greatest effect" — mirror C21's shock list (minus
                # "None") instead of leaving it free text.
                elif fid == "C21_2":
                    c21_1 = next((ff for ff in q["fields"] if ff["field_id"] == "C21_1"), None)
                    if c21_1:
                        f = dict(f)
                        f["type"] = "single_choice"
                        f["label"] = "Which shock had the greatest effect?"
                        f["options"] = [o for o in c21_1["options"] if o.lower() != "none"]
                        add_condition(f, "C21_1", [o for o in c21_1["options"] if o.lower() != "none"])

                new_fields.append(f)
            q["fields"] = new_fields

    with open(path, "w", encoding="utf-8") as out:
        json.dump(schema, out, indent=2, ensure_ascii=False)

    return {
        "numeric": numeric_count,
        "branch_conditions": branch_condition_count,
        "followup_conditions": followup_condition_count,
        "multi_choice_fixed": multi_count,
        "amount_fallback_conditions": amount_fallback_count,
    }


if __name__ == "__main__":
    for key, p in [("A", "questions_A.json"), ("B", "questions_B.json")]:
        stats = patch(p, key)
        print(p, stats)
