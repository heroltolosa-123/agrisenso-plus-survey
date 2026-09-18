# Simulated responses — AGRISENSO Plus Baseline Survey

Sixteen complete simulated interviews: 8 for Instrument A (borrowers) and
8 for Instrument B (non-borrower comparison group).

**Nothing here came from a real respondent, and nothing was written to the
live Google Sheet.** Every record was produced by driving the real survey
client (`docs/app.js`) through a full interview, then passing the result
through the real backend (`src/Code.gs`) with a mocked Spreadsheet. The
files are therefore laid out exactly as the live Sheet tabs will be.

## Files

| File | Contents |
| --- | --- |
| `Instrument_A_Borrowers.csv` | 13 records × 277 columns |
| `Instrument_B_NonBorrowers.csv` | 13 records × 209 columns |
| `Instrument_A_Borrowers_Dictionary.csv` | field_id → question text |
| `Instrument_B_NonBorrowers_Dictionary.csv` | field_id → question text |

Row 1 is column ids, row 2 is question text, row 3 onward is data — the
same two frozen header rows the backend writes.

## Profiles covered

**Instrument A** — individual rice, corn, aquaculture, swine and poultry
producers; a cooperative (FFCA); a BMBE trader with the loan not yet
released; an ARBO awaiting verification. Covers fully released, partially
released, not yet released, and does-not-know release states.

**Instrument B** — never applied, inquired only, application declined,
application withdrawn, application in process, started but not completed;
crop, capture fisheries, aquaculture, livestock, trading and processing;
individual and organisational respondents.

## What was checked

Every record was audited before release, and all 16 pass:

- Final Eligibility (A10) derives to an eligible status
- Percentage matrices: rows sum to 100 and the computed Total agrees
- No record answers both an exact amount and its "cannot provide" fallback
- Every numeric value within its schema min/max
- Cross-field caps respected — active members and dependants ≤ household
  size, cultivated ≤ total area, released ≤ approved
- Every required field answered
- Net income reconciles with gross sales minus production cost
- Commodity matches the reported activity

Two records carry a genuine net loss (A-00003 aquaculture, B-00007
processing), which exercises the negative-amount path.

## What this is not

This is generated data. Distributions, correlations and response patterns
are **not** representative of the real population and must never be used
for analysis, pretesting of estimates, or anything reported as findings.

Use it for: checking the Sheet layout and column order, building and
testing analysis scripts before fieldwork, training the data manager, and
showing enumerators at the workshop what their work produces.

To regenerate or change the profiles, the generator is not in the repo —
ask and it can be added under `tools/`.
