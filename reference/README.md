# Printable enumerator reference

Item-by-item reference for both instruments, sized for A4 and built to be
printed and carried.

| File | Contents |
| --- | --- |
| `AGRISENSO_Enumerator_Reference_A.pdf` | Instrument A — borrowers, 119 items, 34 pages |
| `AGRISENSO_Enumerator_Reference_B.pdf` | Instrument B — comparison group, 101 items, 28 pages |
| `reference_A.html` / `reference_B.html` | Source pages the PDFs are rendered from |
| `build_reference.py` | Generator |
| `guidance.py` | The per-item training notes |

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

## Printing

A4 portrait, single-sided reads best. Each section starts on a new page
and no item is split across a page break, so an enumerator can flip
straight to an item mid-interview. Double-sided saves paper but breaks
that flow.
