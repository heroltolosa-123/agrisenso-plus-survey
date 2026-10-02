# Printable reference and paper questionnaire

Everything here is A4 and built to be printed. All of it is generated
from the live schema (`tools/questions_*.json`), so no printed page can
disagree with what the app asks.

| File | Contents |
| --- | --- |
| `AGRISENSO_Enumerator_Reference_A.pdf` | Instrument A — borrowers, 119 items, 34 pages |
| `AGRISENSO_Enumerator_Reference_B.pdf` | Instrument B — comparison group, 101 items, 28 pages |
| `AGRISENSO_Coding_Reference.pdf` | Enumerator, supervisor and respondent codes — 4 pages, hand out with the assignment sheet |
| `AGRISENSO_Questionnaire_A.pdf` / `.docx` | **Instrument A, the paper form** — 44 pages, tick boxes and ruled answer space |
| `AGRISENSO_Questionnaire_B.pdf` / `.docx` | **Instrument B, the paper form** — 37 pages |
| `reference_A.html` / `reference_B.html` | Source pages the PDFs are rendered from |
| `build_reference.py` | Generator |
| `guidance.py` | The per-item training notes |
| `coding_reference.html` | Source page for the coding card — hand-written, not generated |
| `build_questionnaire.py` | Generator for the paper form |
| `questionnaire_A.html` / `_B.html` | Source pages the questionnaire PDFs are rendered from |

## Every entry gives

- The item code and heading, with **required** and **filled by the app** flags
- The question text and its options, **verbatim from the live questionnaire**
- A shaded line with the routing and any limits the app enforces
- **What it measures** — why the question is in the instrument
- **How to ask it** — wording, order, what to prompt for
- **Watch for** — the mistake that is actually made on that item

## Regenerating

The question text, options, routing and limits are read from the live
schema, so the reference cannot drift from the app. After any
questionnaire change:

```bash
cd reference
python3 build_reference.py
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --no-pdf-header-footer --print-to-pdf=AGRISENSO_Enumerator_Reference_A.pdf \
  file://$PWD/reference_A.html
```

Repeat for B. Only `guidance.py` is hand-written; edit the notes there,
never in the HTML.

`coding_reference.html` is the exception: it is written by hand, because
the codes are a field-procedure decision rather than anything the schema
knows. It is rendered the same way:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --no-pdf-header-footer --print-to-pdf=AGRISENSO_Coding_Reference.pdf \
  coding_reference.html
```

The card, the on-screen hints (`tools/enhance_schema.py`, the
`STAFF_CODE_*` and `RESPONDENT_CODE_*` tables) and the roster
(`docs/config.js`) describe one scheme in three places. Change one and
change all three, then run `node tools/simulate/check_coding.js`, which
fails if a code stops round-tripping through a submission.

## The paper questionnaire

The form itself, as opposed to the training reference: every item with
tick boxes, ruled answer space, and the routing written out, because
paper has none of the app's logic. Fieldwork is done in the webapp —
this is for review, for briefings, and as the fallback when a device
fails.

```bash
cd reference
python3 build_questionnaire.py --demo     # self-check, run it first
python3 build_questionnaire.py            # 4 HTML files

for k in A B; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
    --no-pdf-header-footer --print-to-pdf=AGRISENSO_Questionnaire_$k.pdf \
    questionnaire_$k.html
  pandoc questionnaire_${k}_word.html -f html -t docx \
    -o AGRISENSO_Questionnaire_$k.docx
done
```

The `_word.html` files exist only because Word drops CSS: a border-bottom
is not a line you can write on, and a tick box leading a list item gets
swallowed. That rendering uses literal `☐` characters and underscore
rules instead. It is pandoc's input, nothing else, and is gitignored.

The self-check fails if an item loses its answer space, if an option the
app offers is missing from either rendering, if a routing condition stops
producing a readable instruction, or if a termination rule stops printing
its STOP box.

## Printing

A4 portrait, single-sided reads best. Each section starts on a new page
and no item is split across a page break, so an enumerator can flip
straight to an item mid-interview. Double-sided saves paper but breaks
that flow.
