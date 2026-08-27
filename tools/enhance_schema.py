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
_REQUIRED_COMMON = {
    "Consent_to_Participa_1",
    "Consent_for_Possible_1",
    "Consent_Confirmation_1",  # enumerator attestation checkbox
    "A1_1",   # Region
    "A2_1",   # Borrower / respondent type
    "B2_1",   # Age (individual branch)
    "QUESTIONNAIR_intro_10",  # Language
    "QUESTIONNAIR_intro_11",  # Interview mode
}
# The eligibility chain uses DIFFERENT item numbers in each instrument, so
# a single shared set silently gated the wrong questions: in Instrument B,
# A7 is Application Status, A8 is INDIVIDUAL eligibility and A9 is
# ORGANIZATIONAL eligibility, so the shared "A7_1..A8_2" list left B's
# organizational respondents with no eligibility gate at all while marking
# individual-only fields required for everyone. Curated per instrument.
REQUIRED_FIELD_IDS_BY_INSTRUMENT = {
    "A": _REQUIRED_COMMON | {
        "A5_1",   # Loan agreement verification
        "A6_1",   # Status of loan release
        "A7_1", "A7_2", "A7_3",  # individual eligibility
        "A8_1", "A8_2",          # organizational eligibility
    },
    "B": _REQUIRED_COMMON | {
        "A5_1",   # Current AGRISENSO Plus loan agreement (must be No)
        "A6_1",   # Previous AGRISENSO Plus loan agreement
        "A7_1",   # Application status
        "A8_1", "A8_2",  # individual eligibility (age / involvement)
        "A9_1", "A9_2",  # organizational eligibility (role / authorized)
    },
}

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
# Keyed by instrument: the item numbers differ between A and B (B has no
# loan-utilisation section, and its financing-need pair is E3 rather than
# F6), so one shared table silently wired the wrong fields in B.
AMOUNT_FALLBACK_GROUPS_BY_INSTRUMENT = {
    "A": {
        "B8_1": ("B8_2", "B8_3"),
        "C13_1": ("C13_2", "C13_3"),
        "C14_1": ("C14_2", "C14_3"),
        "C15_1": ("C15_2", None),
        "F6_1": ("F6_2", None),
        "E12_1": ("E12_2", None),
        "E13_1": ("E13_2", None),
    },
    "B": {
        "B8_1": ("B8_2", "B8_3"),
        "C13_1": ("C13_2", None),
        "C14_1": ("C14_2", None),
        "C15_1": ("C15_2", None),
        "E3_1": ("E3_2", None),
    },
}
# Two numeric fields sharing one fallback (fallback only applies once BOTH
# numerics are empty).
DUAL_AMOUNT_FALLBACK_GROUPS_BY_INSTRUMENT = {
    "A": {"E14_3": ("E14_1", "E14_2")},
    "B": {},
}


def apply_amount_fallback_conditions(schema, instrument_key):
    """Exact amount vs. "can't give one" are alternate routes to the same
    answer, so answering either one should retire the other — but the
    first implementation expressed that as a hard condition that DISABLED
    the losing side. A radio button cannot be un-clicked, so an enumerator
    who mis-clicked "Unable to provide exact amount" was permanently
    locked out of the amount box with no way back (reported for B8 in the
    verification sheet and again for gross sales / net income in the
    field). These are now soft `exclusiveWith` links: nothing is ever
    disabled, and answering one side simply clears the other."""
    count = 0
    groups = AMOUNT_FALLBACK_GROUPS_BY_INSTRUMENT.get(instrument_key, {})
    dual_groups = DUAL_AMOUNT_FALLBACK_GROUPS_BY_INSTRUMENT.get(instrument_key, {})
    for numeric_id, (fallback_id, tier_id) in groups.items():
        numeric_f = find_field(schema, numeric_id)
        fallback_f = find_field(schema, fallback_id)
        if not numeric_f or not fallback_f:
            continue
        peers = [i for i in ([fallback_id] + ([tier_id] if tier_id else []))
                 if find_field(schema, i)]
        numeric_f.setdefault("exclusiveWith", []).extend(peers)
        fallback_f.setdefault("exclusiveWith", []).append(numeric_id)
        count += 2
        if tier_id:
            tier_f = find_field(schema, tier_id)
            if tier_f:
                # The bracket question genuinely only exists once a
                # fallback reason has been given — and the fallback is
                # now clearable, so this gate is always escapable.
                add_condition(tier_f, fallback_id, None, not_empty=True)
                tier_f.setdefault("exclusiveWith", []).append(numeric_id)
                count += 1
    for fallback_id, (num1_id, num2_id) in dual_groups.items():
        fallback_f = find_field(schema, fallback_id)
        f1, f2 = find_field(schema, num1_id), find_field(schema, num2_id)
        if fallback_f and f1 and f2:
            fallback_f.setdefault("exclusiveWith", []).extend([num1_id, num2_id])
            f1.setdefault("exclusiveWith", []).append(fallback_id)
            f2.setdefault("exclusiveWith", []).append(fallback_id)
            count += 1
    return count


def find_field(schema, field_id):
    for s in schema["sections"]:
        for q in s["questions"]:
            for f in q["fields"]:
                if f["field_id"] == field_id:
                    return f
    return None


def find_question(schema, qid):
    for s in schema["sections"]:
        for q in s["questions"]:
            if q["qid"] == qid:
                return s, q
    return None, None


def iter_fields(schema):
    for s in schema["sections"]:
        for q in s["questions"]:
            for f in q["fields"]:
                yield s, q, f


# ---------------------------------------------------------------------
# Option display text
#
# The client strips the "____________" fill-in rules and trailing colons
# off an option before storing it (optionDisplay() in docs/app.js), so
# the value that actually lands in state.answers for
# "Other: ____________________" is just "Other". Any condition written
# against the RAW option string therefore never matches at runtime — a
# silent, invisible failure. display_option() mirrors the client exactly,
# and normalise_condition_values() runs it over every condition value as
# the last step of the pipeline so the two can't drift.
# ---------------------------------------------------------------------
def display_option(opt):
    text = re.sub(r"_{3,}", "", str(opt)).strip()
    text = re.sub(r":$", "", text).strip()
    return text or "Other"


def normalise_condition_values(schema):
    fixed = 0
    for _s, _q, f in iter_fields(schema):
        for cond in f.get("conditions", []) or []:
            for key in ("in", "containsAny"):
                if key in cond:
                    before = list(cond[key])
                    cond[key] = [display_option(v) for v in before]
                    if cond[key] != before:
                        fixed += 1
    return fixed


def options_of(schema, field_id, exclude=()):
    """Display-text option list of another field, minus `exclude`."""
    f = find_field(schema, field_id)
    if not f:
        return []
    drop = {str(x).lower() for x in exclude}
    return [display_option(o) for o in f.get("options", [])
            if display_option(o).lower() not in drop]


def add_contains_condition(field, trigger_field_id, values):
    """Condition satisfied when a MULTI-select trigger has any of `values`
    checked. A plain `in` clause compares against the whole stored answer
    ("Flood; Drought"), so it only ever matched single-selection cases —
    the reason C21a ("which shock had the greatest effect?") stayed grayed
    out for any respondent who reported more than one shock."""
    field.setdefault("conditions", [])
    field["conditions"].append({"field": trigger_field_id, "containsAny": list(values)})


def set_numeric(field, minimum=None, maximum=None, integer=False, hint=None,
                max_of=None, unit=None):
    field["type"] = "number"
    if minimum is not None:
        field["min"] = minimum
    if maximum is not None:
        field["max"] = maximum
    if integer:
        field["integer"] = True
    if hint:
        field["hint"] = hint
    if max_of:
        field["maxOf"] = max_of
    if unit:
        field["unit"] = unit


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
# Section C is item-for-item identical across the two instruments; the
# later sections are not (Instrument B's financial-capability block is
# F1-F17 where A's is G1-G17), so the reclassification list is split.
_MULTI_CHOICE_SECTION_C = {
    "C1_1",    # Current agricultural / enterprise activities
    "C5_1",    # Land tenure / access arrangements
    "C11_1",   # Major production inputs used
    "C12_3",   # Extension/technical support provider
    "C16_2",   # Record-keeping methods
    "C19_1",   # Main buyers / market outlets
    "C20_1",   # Value-chain participation stages
    "C21_1",   # Major shocks experienced
    "C22_1",   # Risk-management practices used
    "C23_2",   # Insurance type
    "C23_3",   # Insurance provider
}
MULTI_CHOICE_FIELD_IDS_BY_INSTRUMENT = {
    "A": _MULTI_CHOICE_SECTION_C | {
        "D5_1",    # Difficulties during application
        "E5_1",    # Stated purpose of loan
        "G12_2",   # Digital-service difficulties experienced
        "G13_1",   # Training/advisory support received
        "G14_1",   # Training provider
        "H5_1",    # Challenges after receiving financing
        "H11_1",   # Additional support needed
    },
    "B": _MULTI_CHOICE_SECTION_C | {
        "E4_1",    # Current financing sources used
        "F12_2",   # Digital-service difficulties experienced
        "F13_1",   # Training/advisory support received
        "F14_1",   # Training provider
        "H2_1",    # What would encourage an application
        "H3_1",    # Preferred information channels
        "H6_1",    # Additional support needed
    },
}




# =====================================================================
# Round-6 refinements (ACPC/DRVN batches 3-5 + field-test reports)
#
# Everything below is driven by written reviewer comments; each block
# names the comment it answers so the next person can trace a rule back
# to the review that asked for it.
# =====================================================================

# Activities from C1 that involve actually producing something. Batch 5,
# comment 1: "A crop farmer, fisherfolk, livestock producer, processor,
# trader, BMBE and SME should not all be shown exactly the same
# questions... a trader should not have to go through farm area,
# irrigation, crop yield and production-cycle fields just to select N/A
# repeatedly."
PRODUCTION_ACTIVITIES = [
    "Crop production", "Capture fisheries", "Aquaculture", "Livestock", "Poultry",
]
LAND_BASED_ACTIVITIES = ["Crop production", "Aquaculture", "Livestock", "Poultry"]
IRRIGATED_ACTIVITIES = ["Crop production", "Aquaculture"]

# question id -> the C1 activities that make it applicable
ACTIVITY_ROUTED_QUESTIONS = {
    "C4": LAND_BASED_ACTIVITIES,    # Farm / production area
    "C5": LAND_BASED_ACTIVITIES,    # Land tenure
    "C6": PRODUCTION_ACTIVITIES,    # Production scale
    "C7": PRODUCTION_ACTIVITIES,    # Production during most recent cycle
    "C8": PRODUCTION_ACTIVITIES,    # Number of production cycles
    "C9": IRRIGATED_ACTIVITIES,     # Irrigation / water source
    "C10": PRODUCTION_ACTIVITIES,   # Mechanization
    "C11": PRODUCTION_ACTIVITIES,   # Major production inputs
    "C17": PRODUCTION_ACTIVITIES,   # Output disposition
    "C18": PRODUCTION_ACTIVITIES,   # Production / post-harvest losses
    "C23": PRODUCTION_ACTIVITIES,   # Agricultural / enterprise insurance
}

# Multi-selects whose "None"/"Not applicable" answer contradicts every
# other answer. Batch 5, final comment: "where 'None/Not applicable'
# exists in a multi-select question, the programming should make it
# mutually exclusive with substantive answers."
EXCLUSIVE_OPTION_WORDS = ("none", "not applicable", "no significant difficulty",
                          "no significant issue", "prefer not to answer",
                          "do not know", "don't know")

# Numeric bounds. Batch 5, comment 4: "Numeric fields should never
# default to zero... Appropriate range validation is also needed:
# percentages 0-100; years non-negative; monetary amounts non-negative;
# number of cycles as a sensible numeric value." Batch 4, comments 2 and
# 4: age must be >= 18, household size >= 1, and the economically-active
# and dependent counts must not exceed household size.
_NUMERIC_RULES_COMMON = {
    "B2_1":  dict(minimum=18, maximum=120, integer=True, unit="years",
                  hint="Age in completed years (18 or older)"),
    "B5_1":  dict(minimum=1, maximum=50, integer=True, unit="persons",
                  hint="Total persons in the household (including the respondent)"),
    "B6_1":  dict(minimum=0, maximum=50, integer=True, unit="persons", max_of="B5_1"),
    "B7_1":  dict(minimum=0, maximum=50, integer=True, unit="persons", max_of="B5_1"),
    "B8_1":  dict(minimum=0, unit="PHP per month", hint="Amount in PHP"),
    "C3_1":  dict(minimum=0, maximum=100, unit="years"),
    "C4_1":  dict(minimum=0, unit="area", hint="Total area (numbers only)"),
    "C4_3":  dict(minimum=0, unit="area", max_of="C4_1",
                  hint="Area actually used (cannot exceed the total area)"),
    "C7_2":  dict(minimum=0, hint="Volume produced (numbers only)"),
    "C7_4":  dict(minimum=0, hint="Yield per hectare"),
    "C8_1":  dict(minimum=0, maximum=24, unit="cycles"),
    "C13_1": dict(minimum=0, unit="PHP", hint="Amount in PHP"),
    "C14_1": dict(minimum=0, unit="PHP", hint="Amount in PHP"),
    "C15_1": dict(unit="PHP", hint="Amount in PHP (may be negative for a net loss)"),
    "C18_2": dict(minimum=0, maximum=100, unit="%", hint="Percentage lost (0-100)"),
}
NUMERIC_RULES_BY_INSTRUMENT = {
    "A": dict(_NUMERIC_RULES_COMMON, **{
        "E4_1":  dict(minimum=0, unit="PHP", hint="Amount applied for, in PHP"),
        "E4_2":  dict(minimum=0, unit="PHP", hint="Amount approved, in PHP"),
        "E4_3":  dict(minimum=0, unit="PHP", max_of="E4_2",
                      hint="Amount released so far (cannot exceed the approved amount)"),
        "E6_1":  dict(minimum=0, maximum=100, unit="%", hint="Interest rate in percent"),
        "E7_1":  dict(minimum=0, maximum=50, unit="years"),
        "E12_1": dict(minimum=0, maximum=100, integer=True, unit="documents"),
        "E13_1": dict(minimum=0, maximum=100, integer=True, unit="visits"),
        "E14_1": dict(minimum=0, unit="PHP", hint="Amount in PHP"),
        "E14_2": dict(minimum=0, unit="PHP", hint="Amount in PHP"),
        "F6_1":  dict(minimum=0, unit="PHP", hint="Amount in PHP"),
    }),
    "B": dict(_NUMERIC_RULES_COMMON, **{
        "E3_1":  dict(minimum=0, unit="PHP", hint="Amount in PHP"),
    }),
}

# Follow-ups that the source wording never marked "If Yes", so the
# general detector could not find them and they stayed permanently
# visible. Batch 5, comment 8: "Mechanization details and mode of access
# should appear only if Mechanization = Yes. Insurance type/provider/
# claims should appear only if Insurance = Yes. Claim disposition should
# appear only if a claim was filed. Post-harvest loss percentage and
# reason should appear only if losses = Yes."
# field_id -> (trigger_field_id, [display option values])
_ROUND6_CONDITIONS_SECTION_C = {
    "C10_3": ("C10_1", ["Yes"]),                 # mechanization: mode of access
    "C18_3": ("C18_1", ["Yes"]),                 # loss: main reason
    "C23_3": ("C23_1", ["Yes"]),                 # insurance provider
    "C23_4": ("C23_1", ["Yes"]),                 # ever filed a claim
    "C7_5":  ("C7_4", None),                     # yield unit
}
ROUND6_CONDITIONS_BY_INSTRUMENT = {
    "A": dict(_ROUND6_CONDITIONS_SECTION_C, **{
        "G11_2": ("G11_1", ["Regularly", "Occasionally"]),  # savings: purpose
        "G14_1": ("G13_1", None),                # training provider
        "G15_1": ("G13_1", None),                # usefulness of training
        "G15_2": ("G13_1", None),                # applied anything learned
        "D7_3":  ("D7_1", ["Yes"]),              # type of assistance received
    }),
    "B": dict(_ROUND6_CONDITIONS_SECTION_C, **{
        "F11_2": ("F11_1", ["Regularly", "Occasionally"]),  # savings: purpose
        "F14_1": ("F13_1", None),                # training provider
        "F15_1": ("F13_1", None),                # usefulness of training
        "F15_2": ("F13_1", None),                # applied anything learned
        "D5_2":  ("D5_1", ["Yes"]),              # what happened to the application
        "D6_1":  ("D5_2", ["Application declined/disapproved"]),
        "D6_2":  ("D6_1", ["Yes"]),              # reason given for the decline
    }),
}
# Trigger fields that are multi-select and whose condition means "any
# substantive option chosen" rather than a fixed list. Value is the option
# to treat as "nothing selected".
ROUND6_MULTI_TRIGGERS = {"G13_1": "None", "F13_1": "None"}


def make_exclusive_options(schema):
    """Flag the 'None'/'Not applicable' style option in every multi-select
    so the client can uncheck everything else when it is chosen (and vice
    versa) instead of storing 'Flood; None'."""
    n = 0
    for _s, _q, f in iter_fields(schema):
        if f.get("type") != "multi_choice":
            continue
        excl = [display_option(o) for o in f.get("options", [])
                if display_option(o).lower() in EXCLUSIVE_OPTION_WORDS]
        if excl:
            f["exclusiveOptions"] = excl
            n += 1
    return n


def apply_numeric_rules(schema, instrument_key):
    n = 0
    rules = NUMERIC_RULES_BY_INSTRUMENT.get(
        instrument_key, NUMERIC_RULES_BY_INSTRUMENT["A"])
    for fid, kwargs in rules.items():
        f = find_field(schema, fid)
        if f:
            set_numeric(f, **kwargs)
            n += 1
    return n


def apply_round6_conditions(schema, instrument_key):
    n = 0
    table = ROUND6_CONDITIONS_BY_INSTRUMENT.get(
        instrument_key, ROUND6_CONDITIONS_BY_INSTRUMENT["A"])
    for fid, (trigger_id, values) in table.items():
        f = find_field(schema, fid)
        trig = find_field(schema, trigger_id)
        if not f or not trig:
            continue
        if any(c.get("field") == trigger_id for c in f.get("conditions", []) or []):
            continue
        if trigger_id in ROUND6_MULTI_TRIGGERS or trig.get("type") == "multi_choice":
            skip = ROUND6_MULTI_TRIGGERS.get(trigger_id, "None")
            opts = options_of(schema, trigger_id, exclude=[skip])
            add_contains_condition(f, trigger_id, opts)
        elif values:
            add_condition(f, trigger_id, values)
        else:
            add_condition(f, trigger_id, None, not_empty=True)
        n += 1
    return n


def apply_activity_routing(schema):
    """Gate whole Section C question groups on the activities picked in
    C1, so a trader/processor never walks through farm-area, irrigation
    and yield questions just to answer 'not applicable' to each."""
    c1 = find_field(schema, "C1_1")
    if not c1:
        return 0
    n = 0
    for qid, activities in ACTIVITY_ROUTED_QUESTIONS.items():
        _s, q = find_question(schema, qid)
        if not q:
            continue
        for f in q["fields"]:
            if any(c.get("field") == "C1_1" for c in f.get("conditions", []) or []):
                continue
            add_contains_condition(f, "C1_1", activities)
            n += 1
    return n


# "Which of these was the MOST significant?" questions, whose options
# should be exactly what the respondent ticked in the preceding
# multi-select. Field report on D6: "Can we have options for this based
# on the response from D.5?" Instrument B has the same shape at E9/E8.
# instrument -> (target_field, source_field, keep-anyway option)
MOST_SIGNIFICANT_PAIRS = {
    "A": ("D6_1", "D5_1", "No significant difficulty"),
    "B": ("E9_1", "E8_1", "No significant barrier"),
}


def apply_dynamic_options(schema, instrument_key):
    """Populate a question's options from what was already answered
    earlier, instead of asking the enumerator to retype it.

    Batch 5, comment 3 (principal activity should be chosen from the C1
    activities) and the field report on D6 ("Can we have options for this
    based on the response from D.5?")."""
    n = 0

    # "Most significant X" mirrors whatever was ticked in the preceding
    # multi-select, instead of shipping a one-option dropdown.
    pair = MOST_SIGNIFICANT_PAIRS.get(instrument_key)
    if pair:
        target_id, source_id, keep = pair
        target, source = find_field(schema, target_id), find_field(schema, source_id)
        if target and source:
            source_qid = source_id.split("_")[0]
            target["type"] = "single_choice"
            target["optionsFrom"] = {
                "field": source_id,
                "exclude": ["None"],
                "extra": [keep],
                "emptyText": ("Answer " + source_qid + " first \u2014 whatever you tick "
                              "there appears here."),
            }
            target["options"] = [keep]
            add_contains_condition(target, source_id,
                                   options_of(schema, source_id, exclude=["None"]))
            n += 1

    # C2 - principal activity: only the activities ticked in C1.
    c2 = find_field(schema, "C2_1")
    if c2:
        c2["type"] = "single_choice"
        c2["label"] = "Which of the activities you selected is your principal activity?"
        c2["optionsFrom"] = {
            "field": "C1_1",
            "emptyText": "Answer C1 first \u2014 the activities you tick there appear here.",
        }
        c2["options"] = []
        n += 1

    # C7 - commodity carries forward from the principal commodity in C2.
    c7 = find_field(schema, "C7_1")
    if c7:
        c7["copyFrom"] = "C2_2"
        c7["hint"] = "Carried forward from the principal commodity in C2 \u2014 edit if this cycle differs."
        n += 1

    return n


def add_gross_sales_bracket(schema):
    """Field report: "gross sales are in bracket similar with the
    production cost" \u2014 C13 had a bracket fallback (C13_3), C14 did not."""
    _s, q = find_question(schema, "C14")
    c13_3 = find_field(schema, "C13_3")
    if not q or not c13_3 or find_field(schema, "C14_3"):
        return 0
    bracket = {
        "field_id": "C14_3",
        "label": "If exact amount cannot be provided:",
        "type": "single_choice",
        "options": list(c13_3["options"]),
        "required": False,
    }
    add_condition(bracket, "C14_2", None, not_empty=True)
    bracket["exclusiveWith"] = ["C14_1"]
    c14_1 = find_field(schema, "C14_1")
    c14_2 = find_field(schema, "C14_2")
    if c14_1:
        c14_1.setdefault("exclusiveWith", []).append("C14_3")
    if c14_2:
        c14_2.setdefault("exclusiveWith", [])
    q["fields"].append(bracket)
    return 1


# ---------------------------------------------------------------------
# Post-interview / quality-control fields
#
# Batch 1, comments 9-11: interview outcome and the verification fields
# "appear too early ... they belong to post-interview quality control",
# the outcome list is missing "Callback required", and "Random Phone
# Back-check" should become a broader "Back-check Status".
# ---------------------------------------------------------------------
ADMIN_FIELDS_TO_MOVE = [
    "QUESTIONNAIR_intro_12",  # Interview Outcome
    "QUESTIONNAIR_intro_13",  # Supervisor Verification
    "QUESTIONNAIR_intro_14",  # Data Verification Status
    "QUESTIONNAIR_intro_15",  # Back-check
]

INTERVIEW_OUTCOME_OPTIONS = [
    "Completed",
    "Partially completed",
    "Callback required",
    "Respondent refused",
    "Respondent unavailable",
    "Respondent ineligible",
    "Other: ____________________",
]
BACKCHECK_OPTIONS = [
    "Not yet selected",
    "Selected for back-check",
    "Completed",
    "Unable to complete",
    "Not selected",
]


def rework_admin_quality_control(schema):
    """Relabel the QC fields, give them their reviewer-approved option
    lists and 'Pending' defaults, add the callback capture, and move the
    whole block out of Section 2 and down into the Enumerator Final
    Review section at the end of the interview."""
    changed = 0

    outcome = find_field(schema, "QUESTIONNAIR_intro_12")
    if outcome:
        outcome["label"] = "Interview Outcome"
        outcome["options"] = list(INTERVIEW_OUTCOME_OPTIONS)
        changed += 1

    sup = find_field(schema, "QUESTIONNAIR_intro_13")
    if sup:
        sup["label"] = "Supervisor Verification"
        sup["options"] = ["Pending", "Completed"]
        sup["default"] = "Pending"
        sup["adminOnly"] = True
        changed += 1

    dv = find_field(schema, "QUESTIONNAIR_intro_14")
    if dv:
        dv["label"] = "Data Verification Status"
        dv["options"] = ["Pending verification", "Verified"]
        dv["default"] = "Pending verification"
        dv["adminOnly"] = True
        changed += 1

    bc = find_field(schema, "QUESTIONNAIR_intro_15")
    if bc:
        bc["label"] = "Back-check Status"
        bc["options"] = list(BACKCHECK_OPTIONS)
        bc["default"] = "Not yet selected"
        bc["adminOnly"] = True
        changed += 1

    # Callback capture, requested in batch 1 comment 9.
    src_section, src_q = None, None
    for s in schema["sections"]:
        for q in s["questions"]:
            if any(f["field_id"] == "QUESTIONNAIR_intro_12" for f in q["fields"]):
                src_section, src_q = s, q
    if not src_q:
        return changed

    callbacks = []
    if not find_field(schema, "CALLBACK_date"):
        cb_date = {"field_id": "CALLBACK_date", "label": "Callback date",
                   "type": "date", "options": [], "required": False}
        cb_time = {"field_id": "CALLBACK_time", "label": "Callback time",
                   "type": "time", "options": [], "required": False}
        cb_note = {"field_id": "CALLBACK_note", "label": "Callback arrangement / reason",
                   "type": "text", "options": [], "required": False}
        for f in (cb_date, cb_time, cb_note):
            add_condition(f, "QUESTIONNAIR_intro_12",
                          ["Callback required", "Respondent unavailable"])
            callbacks.append(f)
        changed += 3

    moving = [f for f in src_q["fields"] if f["field_id"] in ADMIN_FIELDS_TO_MOVE]
    if not moving:
        return changed
    src_q["fields"] = [f for f in src_q["fields"] if f["field_id"] not in ADMIN_FIELDS_TO_MOVE]

    # Insert an ordered outcome/QC block into the Enumerator Final Review
    # section (second-to-last group of questions), where it belongs.
    target_section = None
    for s in schema["sections"]:
        if "final review" in s["title"].lower():
            target_section = s
    if target_section is None:
        target_section = schema["sections"][-2]

    by_id = {f["field_id"]: f for f in moving}
    ordered = [by_id[i] for i in ADMIN_FIELDS_TO_MOVE if i in by_id]
    outcome_fields = [f for f in ordered if f["field_id"] == "QUESTIONNAIR_intro_12"] + callbacks
    qc_fields = [f for f in ordered if f["field_id"] != "QUESTIONNAIR_intro_12"]

    if outcome_fields:
        target_section["questions"].append({
            "qid": "QC1",
            "heading": "Interview Outcome",
            "instructions": "Record how this interview actually ended. "
                            "Complete this only after the respondent interview is finished.",
            "fields": outcome_fields,
        })
    if qc_fields:
        target_section["questions"].append({
            "qid": "QC2",
            "heading": "Post-Interview Quality Control",
            "instructions": "These fields are maintained by the field supervisor and the "
                            "data manager after submission. Leave them at their default "
                            "values — the enumerator does not verify their own interview.",
            "fields": qc_fields,
        })
    changed += 1
    return changed


# ---------------------------------------------------------------------
# System-controlled questionnaire metadata
#
# Batch 1, comments 3-4: version, date of version and the control number
# "should not be manually encoded for every interview" / "should be
# system-generated", otherwise the export fills up with "V1", "v1.0",
# "Version 1", "N/A" and blank dates.
# ---------------------------------------------------------------------
QUESTIONNAIRE_VERSION = "1.0"
QUESTIONNAIRE_VERSION_DATE = "2026-08-27"


def apply_system_controlled_metadata(schema, instrument_key):
    n = 0
    version = find_field(schema, "QUESTIONNAIR_intro_1")
    if version:
        version["type"] = "text"
        version["autoValue"] = "Version " + QUESTIONNAIRE_VERSION
        version["readOnly"] = True
        version["note"] = "Set by the application — not typed for each interview."
        n += 1
    vdate = find_field(schema, "QUESTIONNAIR_intro_2")
    if vdate:
        vdate["type"] = "date"
        vdate["autoValue"] = QUESTIONNAIRE_VERSION_DATE
        vdate["readOnly"] = True
        vdate["note"] = "Set by the application — not typed for each interview."
        n += 1
    control = find_field(schema, "QUESTIONNAIR_intro_3")
    if control:
        control["type"] = "text"
        control["autoValue"] = "generated"
        control["generator"] = "controlNumber"
        control["readOnly"] = True
        control["note"] = ("Generated automatically for this interview "
                           "(instrument, date, device and sequence).")
        n += 1
    frame = find_field(schema, "QUESTIONNAIR_intro_4")
    if frame:
        frame["hint"] = "Sampling-frame ID exactly as printed on the approved list"
        frame["pattern"] = "^[A-Za-z0-9][A-Za-z0-9._/-]{2,}$"
        frame["patternMessage"] = ("Enter the ID as printed on the approved sampling frame "
                                   "(letters/numbers, at least 3 characters). If it cannot be "
                                   "verified, leave it blank and flag the case for the supervisor.")
        n += 1
    for fid, listname in (("QUESTIONNAIR_intro_5", "enumerators"),
                          ("QUESTIONNAIR_intro_6", "supervisors")):
        f = find_field(schema, fid)
        if f:
            # Real lists are supplied by the client in docs/config.js; until
            # LANDBANK/DRVN provide them the field stays free text with a
            # datalist so at least spellings converge.
            f["suggestFrom"] = listname
            f["hint"] = "Start typing, then pick your name from the list"
            n += 1
    return n


# ---------------------------------------------------------------------
# Final Eligibility Determination, derived rather than chosen
#
# Batch 3, comment 12: "by this point the software already has all the
# answers necessary to derive this status ... otherwise the form could
# contain contradictory data such as Loan Agreement Verification = No and
# Final Eligibility = Eligible Borrower."
#
# Rules are data, not code, so both client copies evaluate the same list
# and the pipeline stays the single source of truth. First match wins.
# ---------------------------------------------------------------------
ELIGIBILITY_RULES = {
    "A": {
        "field": "A10_1",
        "rules": [
            {"when": [{"field": "A5_1", "in": ["No"]}],
             "value": "Record does not meet borrower definition"},
            {"when": [{"field": "A5_1", "in": ["Unable to verify"]}],
             "value": "Borrower status requires supervisor verification"},
            {"when": [{"field": "A7_1", "in": ["No"]}],
             "value": "Borrower status requires supervisor verification"},
            {"when": [{"field": "A7_2", "in": ["No"]}],
             "value": "Replacement borrower respondent required"},
            {"when": [{"field": "A7_3", "in": ["No"]}],
             "value": "Respondent is not an eligible/authorized representative"},
            {"when": [{"field": "A8_2", "in": ["No"]}],
             "value": "Respondent is not an eligible/authorized representative"},
            {"when": [{"field": "A5_1", "in": ["Yes – Continue"]},
                      {"field": "A2_1", "in": ["Individual borrower"]},
                      {"field": "A7_1", "in": ["Yes"]},
                      {"field": "A7_2", "in": ["Yes"]},
                      {"field": "A7_3", "in": ["Yes"]}],
             "value": "Eligible AGRISENSO Plus Borrower – Proceed to Section B"},
            {"when": [{"field": "A5_1", "in": ["Yes – Continue"]},
                      {"field": "A2_1", "in": ["Organizational / enterprise borrower"]},
                      {"field": "A8_2", "in": ["Yes – Continue"]}],
             "value": "Eligible AGRISENSO Plus Borrower – Proceed to Section B"},
        ],
    },
    "B": {
        "field": "A10_1",
        "rules": [
            {"when": [{"field": "A5_1", "in": ["Yes"]}],
             "value": "Current AGRISENSO Plus borrower – Ineligible"},
            {"when": [{"field": "A5_1", "in": ["Unable to verify"]}],
             "value": "Requires supervisor verification"},
            {"when": [{"field": "A6_1", "in": ["Yes"]}],
             "value": "Previous AGRISENSO Plus borrower – Ineligible"},
            {"when": [{"field": "A6_1", "in": ["Do not know / Unable to verify"]}],
             "value": "Requires supervisor verification"},
            {"when": [{"field": "A8_1", "in": ["No"]}],
             "value": "Replacement comparison respondent required"},
            {"when": [{"field": "A8_2", "in": ["No"]}],
             "value": "Respondent is not an eligible/knowledgeable representative"},
            {"when": [{"field": "A9_2", "in": ["No"]}],
             "value": "Respondent is not an eligible/knowledgeable representative"},
            {"when": [{"field": "A5_1", "in": ["No – Continue"]},
                      {"field": "A6_1", "in": ["No – Continue"]},
                      {"field": "A2_1", "in": ["Individual respondent"]},
                      {"field": "A8_1", "in": ["Yes"]},
                      {"field": "A8_2", "in": ["Yes"]}],
             "value": "Eligible Non-Borrower Comparison Respondent – Proceed to Section B"},
            {"when": [{"field": "A5_1", "in": ["No – Continue"]},
                      {"field": "A6_1", "in": ["No – Continue"]},
                      {"field": "A2_1", "in": ["Organizational / enterprise respondent"]},
                      {"field": "A9_2", "in": ["Yes – Continue"]}],
             "value": "Eligible Non-Borrower Comparison Respondent – Proceed to Section B"},
        ],
    },
}


def apply_derived_eligibility(schema, instrument_key):
    spec = ELIGIBILITY_RULES.get(instrument_key)
    if not spec:
        return 0
    f = find_field(schema, spec["field"])
    if not f:
        return 0
    f["derived"] = True
    f["deriveRules"] = spec["rules"]
    f["derivePending"] = ("Not yet determined — complete the screening questions above.")
    f["note"] = ("Determined automatically from the screening answers above so the record "
                 "can never say, for example, that loan verification failed but the "
                 "respondent is eligible.")
    return 1


# ---------------------------------------------------------------------
# Hard routing gates
#
# Batch 3, comment 6: "The enumerator should not be able to click Next
# and continue into Sections B-H after No/Unable to Verify." Each rule
# stops forward navigation and offers an explicit end-the-interview path
# instead of silently letting the interview run on.
# ---------------------------------------------------------------------
TERMINATION_RULES = {
    "A": [
        {"when": [{"field": "Consent_to_Participa_1",
                   "in": ["No – End interview and thank respondent"]}],
         "title": "Interview ends here — consent was not given",
         "message": "Thank the respondent and close the interview. Submit this record so the "
                    "refusal is counted in the sample disposition.",
         "outcome": "Respondent refused"},
        {"when": [{"field": "A5_1", "in": ["No"]}],
         "title": "Do not proceed — no AGRISENSO Plus loan agreement on record",
         "message": "The approved borrower list does not confirm an AGRISENSO Plus loan "
                    "agreement. Do not ask the substantive questions. Refer the case to your "
                    "field supervisor and submit this record.",
         "outcome": "Respondent ineligible"},
        {"when": [{"field": "A5_1", "in": ["Unable to verify"]}],
         "title": "Stop — refer to the field supervisor for validation",
         "message": "Loan agreement verification is inconclusive. Do not continue with the "
                    "substantive questions until the supervisor validates the record.",
         "outcome": "Partially completed"},
        {"when": [{"field": "A7_2", "in": ["No"]}],
         "title": "Interview ends here — respondent is under 18",
         "message": "A respondent under 18 cannot be interviewed. Thank the respondent, end the "
                    "interview, and arrange a replacement respondent with your supervisor.",
         "outcome": "Respondent ineligible"},
        {"when": [{"field": "A8_2", "in": ["No"]}],
         "title": "Stop — an authorised representative is needed",
         "message": "Identify an authorised or sufficiently knowledgeable representative of the "
                    "organisation before proceeding, or schedule a callback.",
         "outcome": "Callback required"},
    ],
    "B": [
        {"when": [{"field": "Consent_to_Participa_1",
                   "in": ["No – End interview and thank respondent"]}],
         "title": "Interview ends here — consent was not given",
         "message": "Thank the respondent and close the interview. Submit this record so the "
                    "refusal is counted in the sample disposition.",
         "outcome": "Respondent refused"},
        {"when": [{"field": "A5_1", "in": ["Yes"]}],
         "title": "Not eligible for the comparison group",
         "message": "This respondent currently has an AGRISENSO Plus loan agreement and belongs "
                    "in the borrower sample, not the comparison group. End the interview and "
                    "refer the case to your supervisor.",
         "outcome": "Respondent ineligible"},
        {"when": [{"field": "A6_1", "in": ["Yes"]}],
         "title": "Not eligible for the comparison group",
         "message": "This respondent previously had an AGRISENSO Plus loan agreement. End the "
                    "interview and arrange a replacement respondent with your supervisor.",
         "outcome": "Respondent ineligible"},
        {"when": [{"field": "A8_1", "in": ["No"]}],
         "title": "Interview ends here — respondent is under 18",
         "message": "A respondent under 18 cannot be interviewed. Thank the respondent, end the "
                    "interview, and arrange a replacement respondent with your supervisor.",
         "outcome": "Respondent ineligible"},
        {"when": [{"field": "A9_2", "in": ["No"]}],
         "title": "Stop — an authorised representative is needed",
         "message": "Identify an authorised or sufficiently knowledgeable representative of the "
                    "organisation before proceeding, or schedule a callback.",
         "outcome": "Callback required"},
    ],
}


def apply_termination_rules(schema, instrument_key):
    rules = TERMINATION_RULES.get(instrument_key, [])
    kept = []
    for r in rules:
        if all(find_field(schema, c["field"]) for c in r["when"]):
            kept.append(r)
    schema["terminationRules"] = kept
    schema["outcomeField"] = "QUESTIONNAIR_intro_12"
    return len(kept)


# ---------------------------------------------------------------------
# Remaining targeted Section C / Section G corrections
# ---------------------------------------------------------------------
# Instrument A numbers the financial-capability block G1-G17; Instrument
# B numbers the same block F1-F17.
CAPABILITY_FIELD_IDS = {
    "A": {"savings_purpose": "G11_2", "digital_difficulty": "G12_2"},
    "B": {"savings_purpose": "F11_2", "digital_difficulty": "F12_2"},
}


def apply_section_fixes(schema, instrument_key):
    n = 0
    cap = CAPABILITY_FIELD_IDS.get(instrument_key, CAPABILITY_FIELD_IDS["A"])

    # Batch 5, comment 5: the farm area boxes were free text; they must be
    # numeric with one shared unit, and "Not applicable" must HIDE them
    # rather than sit alongside a typed area.
    c4_1, c4_2, c4_3, c4_4 = (find_field(schema, i) for i in ("C4_1", "C4_2", "C4_3", "C4_4"))
    if c4_1:
        c4_1["label"] = "Total area used for the principal activity"
    if c4_3:
        c4_3["label"] = "Area actually cultivated / utilised during the most recent cycle"
    if c4_2:
        c4_2["label"] = "Unit (applies to both areas above)"
    if c4_4:
        c4_4["label"] = "No land or production area applies to this activity"
        c4_4["options"] = ["Not applicable"]
        for f in (c4_1, c4_2, c4_3):
            if f:
                f.setdefault("exclusiveWith", []).append("C4_4")
        c4_4["exclusiveWith"] = [i for i in ("C4_1", "C4_2", "C4_3") if find_field(schema, i)]
        n += 1

    # Same "typed value vs. escape hatch" shape elsewhere in Section C.
    for numeric_id, escape_id in (("C3_1", "C3_2"), ("C7_2", "C7_6"), ("C8_1", "C8_2")):
        a, b = find_field(schema, numeric_id), find_field(schema, escape_id)
        if a and b:
            a.setdefault("exclusiveWith", []).append(escape_id)
            b.setdefault("exclusiveWith", []).append(numeric_id)
            n += 1

    # Batch 5, comment 11: major inputs is a "which did you use" list —
    # several apply at once.
    c11 = find_field(schema, "C11_1")
    if c11 and c11.get("type") == "single_choice":
        c11["type"] = "multi_choice"
        c11["label"] = c11["label"].rstrip("?") + "? Select all that apply."
        n += 1

    # Batch 5, comment 12: C21a must key off ANY of the shocks ticked in
    # C21 (a plain `in` clause only ever matched a single selection), and
    # "C21b." is an internal code that should not be on screen.
    c21_2 = find_field(schema, "C21_2")
    if c21_2:
        c21_2["conditions"] = [c for c in c21_2.get("conditions", [])
                               if c.get("field") != "C21_1"]
        add_contains_condition(c21_2, "C21_1", options_of(schema, "C21_1", exclude=["None"]))
        c21_2["optionsFrom"] = {
            "field": "C21_1",
            "exclude": ["None"],
            "emptyText": "Tick the shocks experienced in C21 first.",
        }
        n += 1
    c21_3 = find_field(schema, "C21_3")
    if c21_3:
        c21_3["label"] = "Main effect of the most significant shock"
        if not any(c.get("field") == "C21_2" for c in c21_3.get("conditions", []) or []):
            add_condition(c21_3, "C21_2", None, not_empty=True)
        n += 1

    # Batch 4, comment 9: the mobile-phone question is asked inside the
    # individual branch, so it should be worded for a person.
    b12_1 = find_field(schema, "B12_1")
    if b12_1:
        b12_1["label"] = ("Do you have regular access to a mobile phone used for "
                          "communication or financial transactions?")
        n += 1
    b12_2 = find_field(schema, "B12_2")
    if b12_2:
        b12_2["label"] = "Is the phone:"
        n += 1

    # Field report on G11: "I selected no, but still can select from the
    # options." The purpose list is only meaningful once savings are set
    # aside; the label also still carried its routing clause.
    g11_2 = find_field(schema, cap["savings_purpose"])
    if g11_2:
        g11_2["label"] = "Savings are set aside mainly for:"
        g11_2["type"] = "multi_choice"
        n += 1

    # G12's difficulty list only applies once a digital service was used.
    g12_2 = find_field(schema, cap["digital_difficulty"])
    if g12_2:
        g12_2["label"] = "Difficulties experienced with digital financial services"
        n += 1

    # Batch 5, comment 13: record keeping and insurance type allow more
    # than one method (already multi-select); make sure the labels say so.
    for fid in ("C16_2", "C23_2", "C23_3"):
        f = find_field(schema, fid)
        if f and f.get("type") == "multi_choice" and "select all" not in f["label"].lower():
            f["label"] = f["label"].rstrip(":") + " — select all that apply"
            n += 1

    return n


def apply_percent_matrix_bounds(schema):
    """Batch 5, comment 10: every percentage cell accepts 0-100 and the
    Total is computed, never typed."""
    n = 0
    for _s, _q, f in iter_fields(schema):
        if f.get("type") != "matrix":
            continue
        cols = f.get("columns", [])
        if any("%" in c for c in cols):
            f["cellMin"] = 0
            f["cellMax"] = 100
            f["cellNumeric"] = True
            n += 1
    return n


def patch(path, instrument_key):
    with open(path, encoding="utf-8") as f:
        schema = json.load(f)

    multi_choice_ids = MULTI_CHOICE_FIELD_IDS_BY_INSTRUMENT.get(
        instrument_key, MULTI_CHOICE_FIELD_IDS_BY_INSTRUMENT["A"])
    required_ids = REQUIRED_FIELD_IDS_BY_INSTRUMENT.get(
        instrument_key, REQUIRED_FIELD_IDS_BY_INSTRUMENT["A"])
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

                if fid in multi_choice_ids and f["type"] == "single_choice":
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

                f["required"] = fid in required_ids

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

    amount_fallback_count = apply_amount_fallback_conditions(schema, instrument_key)

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

    # ------------------------------------------------------------
    # Round-6 refinements (see the block above for the reviewer comment
    # each one answers). Order matters: dynamic options and the extra
    # gross-sales bracket add fields/conditions that the normalisation
    # pass at the end still has to see.
    # ------------------------------------------------------------
    round6 = {
        "numeric_rules": apply_numeric_rules(schema, instrument_key),
        "followup_conditions_round6": apply_round6_conditions(schema, instrument_key),
        "activity_routing": apply_activity_routing(schema),
        "dynamic_options": apply_dynamic_options(schema, instrument_key),
        "gross_sales_bracket": add_gross_sales_bracket(schema),
        "exclusive_options": make_exclusive_options(schema),
        "section_fixes": apply_section_fixes(schema, instrument_key),
        "percent_matrices": apply_percent_matrix_bounds(schema),
        "admin_qc_reworked": rework_admin_quality_control(schema),
        "system_metadata": apply_system_controlled_metadata(schema, instrument_key),
        "derived_eligibility": apply_derived_eligibility(schema, instrument_key),
        "termination_rules": apply_termination_rules(schema, instrument_key),
    }

    # Must run last: rewrites every condition value into the same display
    # text the client stores, so no condition can silently never match.
    round6["conditions_normalised"] = normalise_condition_values(schema)

    schema["meta"] = {
        "version": QUESTIONNAIRE_VERSION,
        "versionDate": QUESTIONNAIRE_VERSION_DATE,
        "instrument": instrument_key,
    }

    with open(path, "w", encoding="utf-8") as out:
        json.dump(schema, out, indent=2, ensure_ascii=False)

    stats = {
        "numeric": numeric_count,
        "branch_conditions": branch_condition_count,
        "followup_conditions": followup_condition_count,
        "multi_choice_fixed": multi_count,
        "amount_fallback_conditions": amount_fallback_count,
    }
    stats.update(round6)
    return stats


if __name__ == "__main__":
    for key, p in [("A", "questions_A.json"), ("B", "questions_B.json")]:
        stats = patch(p, key)
        print(p, stats)
