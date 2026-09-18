# Simulated response generator

Produces realistic-looking survey data by driving the **real** client
(`docs/app.js`) through complete interviews in a headless DOM, then
passing each result through the **real** backend (`src/Code.gs`) with a
mocked Spreadsheet. Because it uses the shipped code rather than
reimplementing it, the output exercises the actual routing, skip logic,
derived eligibility, mutual exclusivity and computed matrix totals.

Nothing here touches the live Google Sheet.

## Use

```bash
cd tools/simulate
npm install            # jsdom only
node run.js            # 8 completed interviews per instrument
node terminate.js      # 5 disposition cases per instrument
node build.js          # writes Sheet-shaped CSVs to ./out
python3 audit.py       # data-quality check; must report 0 problems
```

`OUT_DIR=/some/path node build.js` writes the CSVs elsewhere.

## Files

| File | Purpose |
| --- | --- |
| `drive.js` | Loads the real client in jsdom and exposes click/type helpers |
| `values.js` | Realistic Philippine value pools, seeded RNG |
| `generate.js` | Fills every applicable field on each page, respecting routing |
| `run.js` | Profiles for the completed interviews |
| `terminate.js` | Profiles that trip each routing gate |
| `build.js` | Runs `Code.gs` and writes the CSVs + data dictionaries |
| `audit.py` | Verifies the generated data is internally consistent |

## What the audit checks

Run it after any change — it has caught real generator faults more than
once:

- Final Eligibility derives to an eligible status
- Percentage matrices: rows sum to 100 and the computed Total agrees
- No record answers both an exact amount and its "cannot provide" fallback
- Numeric values within schema min/max
- Cross-field caps (`maxOf`): members and dependants within household size,
  cultivated within total area, released within approved
- Every required field answered

## Cautions

**The data is not representative.** Distributions and correlations are
invented. Use it for checking the Sheet layout, developing analysis
scripts before fieldwork, training the data manager, and showing
enumerators what their work produces — never for anything reported as a
finding.

**Regenerate after any schema change.** The generator reads the committed
`tools/questions_*.json`, so output tracks the instrument automatically,
but the per-field value rules in `values.js` are keyed by field id and
will need updating if item numbers change.

**`out/` and `node_modules/` are gitignored.** The CSVs are build
artefacts; regenerate them rather than committing them.
