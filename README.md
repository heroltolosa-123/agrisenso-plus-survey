# AGRISENSO Plus Baseline Survey — Standalone Web Site + Google Sheets Backend

A real, shareable website (not a `script.google.com` link) for the
DRVN/ACPC AGRISENSO Plus Baseline Study questionnaires, backed by Google
Sheets as the database.

- **Instrument A** — AGRISENSO Plus Borrowers (122 questions / 267 data columns)
- **Instrument B** — Non-Borrower Comparison Group (103 questions / 200 data columns)

**Architecture:**
- `docs/` — a plain static website (HTML/CSS/JS, no build step) that renders
  the whole survey. You publish this with GitHub Pages (or Render, Netlify,
  any static host) and get a normal URL to share with enumerators.
  `docs/config.js` already points at your live backend — see Section 1.
- `src/` — a small Google Apps Script project, bound to your Google Sheet,
  that exposes the questionnaire and accepts submissions as a JSON API.
  This is the *only* part that touches Google's infrastructure — the site
  your users see is entirely yours.

The site talks to the Apps Script backend over `fetch()`, the same way any
website talks to any API. Everything else (offline queueing, section
navigation, all field types) works exactly as before.

**Design:** bigger type scale and wider layout for readability in the
field, a "planted rows" segmented progress bar, smooth section transitions
and button feedback (motion is disabled automatically if the visitor's
device has "reduce motion" turned on), and dropdown selectors for any
question with more than 6 choices (borrower segment, livelihood type,
educational attainment, etc.) instead of a long wall of radio buttons.

---

## 1. Deploy the backend (Apps Script + Google Sheet)

1. Create a new Google Sheet (this is your survey database).
2. **Extensions → Apps Script**. This opens a script project bound to your
   Sheet (no API keys needed).
3. Create these files in the Apps Script editor and paste in the matching
   contents from `src/` in this project:
   - `Code.gs`, `Schema_A.gs`, `Schema_B.gs` (Script files)
   - `Index.html`, `JavaScript.html`, `Stylesheet.html`, `Assets.html` (HTML files)
   - Replace the manifest (gear icon → Project Settings → show
     `appsscript.json`) with `src/appsscript.json`.

   *(`Index.html`/`JavaScript.html`/`Stylesheet.html`/`Assets.html` are only
   needed if you also want the survey reachable directly at the Apps Script
   URL as a fallback — the standalone site in `docs/` doesn't need them to
   function, but `Code.gs` does need `Index.html` to exist or `doGet()`'s
   HTML fallback will error. Simplest: include all seven files as above.)*

4. Run `setupSheetsManually` once from the function dropdown to pre-create
   both data tabs (approve the authorization prompt — this is your script
   acting on your own Sheet).
5. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy**, authorize, and copy the **Web app URL**
   (`https://script.google.com/macros/s/AKfycb.../exec`). This is your
   backend URL — you'll paste it into the site next.

**Test it's alive:** open `<that URL>?action=ping` in a browser — you
should see `{"ok":true,"message":"AGRISENSO Plus survey backend is reachable."}`.

---

## 2. Point the site at your backend

`docs/config.js` is already pointed at your deployed backend, so there's
nothing to do here for normal use — this is only relevant if you ever
create a **brand-new** Apps Script deployment (rather than "New version"
on the existing one), which gets a different `/exec` URL:

1. Open `docs/config.js`.
2. Replace the URL:
   ```js
   var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycb.../exec";
   ```
3. Save, commit, push.

---

## 3. Publish the site

### Option A — GitHub Pages (recommended, free, works with the git repo you already have)
1. Push this project to GitHub (see Section 5 below if you haven't).
2. On GitHub: **Settings → Pages**.
3. Under "Build and deployment", set **Source: Deploy from a branch**,
   **Branch: main**, **Folder: /docs**. Save.
4. GitHub gives you a URL like `https://heroltolosa-123.github.io/agrisenso-plus-survey/`
   within a minute or two. That's your shareable survey link.
5. Whenever you push changes to `docs/`, the site updates automatically
   (usually within a minute).

### Option B — Render (static site)
1. In Render: **New → Static Site**, connect your GitHub repo.
2. **Root directory:** leave blank (repo root). **Publish directory:** `docs`.
3. No build command needed (it's plain HTML/CSS/JS).
4. Deploy — Render gives you a `.onrender.com` URL (or attach your own domain).

### Option C — Netlify / any static host
Point it at the `docs/` folder the same way; no build step required.

---

## 4. Using the app in the field

Same as before — open the site URL, pick an instrument, work through
sections with Previous/Next, Submit at the end. Responses are saved to a
local backup in the browser and posted to your Google Sheet; if there's no
signal, the response queues locally and **Sync Pending Now** retries later.
See Section 6 for where the data lands in the Sheet.

**Caveats specific to this hosting split:**
- The site and the backend are two different addresses now. If you ever
  redeploy the Apps Script backend and get a *new* `/exec` URL (this can
  happen if you create a brand-new deployment instead of updating an
  existing one), update `docs/config.js` and republish the site, or every
  submission will fail.
- Prefer **Deploy → Manage deployments → pencil icon → New version** over
  creating a brand-new deployment when you update `Code.gs`/`Schema_*.gs` —
  that keeps the same `/exec` URL so you never have to touch `config.js`
  again after the first setup.

---

## 5. Push to GitHub (if not already)

```bash
cd webapp
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

If `git push` asks for a password, GitHub requires a Personal Access
Token instead (Settings → Developer settings → Personal access tokens →
generate one with the `repo` scope, paste it in as the password).

---

## 6. Where the data ends up

In your Google Sheet:
- `Instrument_A_Borrowers` / `Instrument_B_NonBorrowers` — one row per
  response. Row 1 = stable field IDs, row 2 = full question text (frozen).
- `Instrument_A_Borrowers_Dictionary` / `..._Dictionary` — a two-column
  `field_id → question text` lookup for analysis later.
- Column B on every response is **`response_no`** — an auto-generated,
  human-readable primary key like `AGRISENSO-A-00017`, sequential per
  instrument. `submission_id` (column A, a UUID) also stays as a
  guaranteed-unique internal key; use `response_no` for anything you'd
  reference by hand (tracking sheets, field logs, data cleaning notes).

### One-time cleanup before going live
If you already ran pilot tests (as recommended), your sheet likely has a
few stray tabs from that testing — safe to delete:
- **`Sheet1`** — Google's empty default tab, unused.
- **`Sheet2`** / **`undefined_Dictionary`** (or any tab literally named
  `undefined`) — created by an early test submission where the instrument
  wasn't correctly identified. Harmless, just clutter — delete both.
- Any **test data rows** already in `Instrument_A_Borrowers` /
  `Instrument_B_NonBorrowers` — delete the row(s), keeping the 2 header rows.

Do this cleanup *before* your first real interview, since `response_no`
numbering counts existing rows — leftover test rows would make your first
real response start at `-00002` instead of `-00001`.

---

## 7. Required fields — a curated list, not a blanket rule

**This reverses the original design after ACPC/DRVN reviewer feedback.**
The first version made every question required and auto-added an "N/A"
option everywhere — reviewers correctly flagged this as both wrong
(informed consent means a respondent can decline any question, so nothing
should force an answer) and actively broken (a field already answered
"Yes" would still show a red "needs an answer" error on its own follow-up
box, because the box was *also* marked required regardless of context).

**Now:** only a short, curated set of ~26 structural/eligibility "hard
gate" fields are required — consent, eligibility screening, region,
borrower type, age, language, interview mode. These are marked with a red
`*` next to the label. Every other question can be left blank if the
respondent declines to answer; where the source questionnaire already
offers a specific decline option ("Prefer not to answer," "Don't know,"
"Unable to estimate"), that's what shows — not a generic N/A. **Next**
and **Submit** only check the required fields on the relevant page(s);
**Submit** re-checks all of them across the whole response and jumps back
to the first incomplete one if something was missed.

See `guide/AGRISENSO_Plus_Survey_Enumerator_Guide.docx` for the
enumerator-facing explanation — note that guide was written for the
*previous* everything-required design and should be re-issued to match
this section before your next fieldwork briefing.

---

## 7a. Fixed: front-matter and routing-instruction text no longer shows as a fillable question

Across several rounds of review, reviewers kept finding the same root
cause in different places: text that is clearly *instructions for the
enumerator* (front matter, "If No → do not proceed with substantive
questions," "ADMINISTER ONLY IF A6 = FULLY OR PARTIALLY RELEASED," the
closing "thank you" script) was being parsed as if it were a fillable
question. `tools/parse_questionnaire.py` now recognizes this pattern
specifically — including the case where a real short question ("Is the
respondent at least 18 years old?", "End Time") had gotten glued onto the
end of a routing instruction or narration paragraph — and separates the
two: the instruction becomes read-only guidance text, the real question
(if any) keeps its own short, sensible label. A consecutive-sub-heading
bug that was silently dropping questions entirely (this is why "C21a.
Which shock had the greatest effect?" was missing from the first version)
is also fixed.

If you regenerate the schema from a revised questionnaire later (Section 8),
these fixes carry forward automatically — no per-question manual work needed.

---

## 7b. Item numbers and clean section titles

Internal codes like "Section SURVEY_INSTR" no longer appear on screen —
section headers show the clean title only. Question headings now show
the questionnaire's own item number where the source document has one
(e.g. "A5. AGRISENSO Plus Loan Agreement Verification," "C21a. Which
shock had the greatest effect?"), so enumerators and reviewers can
cross-reference against the printed instrument.

---

## 7c. Automatic gray-out — expanded beyond the Individual/Organizational branch

The original conditional-logic engine only handled the "Ask only if A2 =
Individual/Organizational" branch. It's now generalized to catch the
questionnaire's own "If Yes, ..." / "If No, ..." / "If unclear, ..."
wording anywhere it appears, tied to whichever choice question
immediately precedes it — 20+ additional conditional fields per
instrument now gray out and auto-fill N/A the same way, including cases
that need **two** conditions at once (e.g. the phone-type follow-up only
applies to Individual respondents *and* only once Mobile Access = Yes).

**New: mutual exclusivity for "exact amount vs. can't provide it" pairs.**
Several questions (household income, production/operating cost, gross
sales, net income, financing gap, application-related costs) ask for a
precise PHP figure, then separately offer a fallback reason and sometimes
a bracket/tier question. These now gray each other out automatically:
type an exact number and the fallback question disables itself; pick a
fallback reason instead and the numeric field disables itself. This is
exactly the "already answered 'prefer not to answer' but the box still
demanded a number" contradiction reviewers found in the first version.

**New: percentage matrices auto-sum.** The Output Disposition table (and
the loan-use-of-proceeds table) compute their "Total" row live from
what's typed in the rows above it — it's no longer a manually-typed cell
that could disagree with the real total — and the total turns red if it
exceeds 100%.

**New: Age Group and Island Group are auto-derived**, not asked twice.
Enter Age once and Age Group locks to the matching bracket automatically;
pick a Region and Island Group locks to Luzon/Visayas/Mindanao
automatically. Both still show as read-only-but-visible fields (not
hidden) so the enumerator can see what was inferred.

**New: several fields converted from single-select to multi-select**
where more than one answer legitimately applies: Major Shocks,
Difficulties During Application, Insurance type/provider, Record-Keeping
methods, Value-Chain Participation stages, Risk-Management Practices,
Training type/provider, Extension/technical-support provider, Stated
Purpose of Loan.

**New: numeric fields no longer default to a misleading "0."** A grey "0"
placeholder looked like an answer was already there, which is exactly
why one reviewer's test showed a household-dependents field that looked
"already answered" — it now shows a neutral "Enter a number" prompt (or
the field's unit hint) instead.

**New: interview timestamps are auto-captured**, not manually typed.
Date of Interview and Interview Start Time are recorded automatically the
moment Section 2 (Questionnaire Administration) is opened; Interview End
Time is recorded automatically on reaching the Closing Statement section.
Both show as a grayed, disabled field with "Recorded automatically by the
app" so the enumerator can still see (but not accidentally mistype) them.

---

## 7d. Dates, times, numeric fields, and unit consistency

- **Dates** use the browser's native date picker (`mm/dd/yyyy`); **times**
  use a native time picker; **loan application/agreement/release dates**
  use a month picker (`mm/yyyy`) — no more "8/4/26" vs "04-08-2026"
  ambiguity, and no separate N/A affordance needed since almost none of
  these are in the required set (the few that are — see 7 above — must
  have a real answer, same as any other required field).
- **Numeric fields** — ages, PHP amounts, percentages, hectares, counts of
  people/documents/visits (35 fields across both instruments) — use a
  native numeric input with a numeric mobile keypad, rejecting
  non-numeric keystrokes, and show the expected unit as a placeholder
  instead of leaving the format open to interpretation.
- **Questionnaire Version** and other free-text admin fields show an
  example placeholder ("e.g. v1.0") so the expected format is clear.

Any single-choice question with more than 6 options (Borrower Segment,
livelihood type, educational attainment, etc. — about 35 questions per
instrument) renders as a dropdown rather than a long list of radio
buttons.

---

## 7e. Region, Province, City/Municipality, Barangay — cascading dropdowns

**Region** is a dropdown of the Philippines' 18 official regions —
including Negros Island Region, re-established in 2024 (confirmed against
the PSA's Philippine Standard Geographic Code) — instead of free text.

**Province, City/Municipality, and Barangay cascade automatically** from
the selected Region, using the free [PSGC API](https://psgc.gitlab.io/api/):
picking a Region fetches its provinces and turns the Province field into a
dropdown; picking a Province fetches its cities/municipalities; picking a
city/municipality fetches its barangays. Nothing to configure — this runs
automatically the moment the enumerator opens Section A.

**Why not just bundle the full list?** The Philippines has 1,600+
municipalities and 42,000+ barangays. Bundling a static copy risks
shipping stale or wrong data with no way for me to verify it; a live,
actively-maintained government-linked source is more trustworthy — for
Region specifically, though, I verified the current 18-region list against
official sources directly, since it's small and stable enough to be
confident in.

**Built to fail safely.** If the PSGC API is slow, down, blocked, or
returns something unexpected at any step, that field simply **stays a
plain text box with its example hint** (e.g. "e.g. Nueva Ecija") — exactly
as it worked before this feature existed. The enumerator is never blocked;
they just type it in instead of picking from a list. This fallback is
tested and confirmed working, including in a real browser with the PSGC
requests deliberately blocked.

**What I could not verify from this environment:** whether
`psgc.gitlab.io` actually permits cross-origin requests from your
published site's domain in practice — I can't make live network calls to
that specific host from this sandbox. The matching logic, the cascade, and
—most importantly— the fallback are all tested and solid; what's untested
is simply "does the live API respond as expected when your real site
calls it." **Please check this specifically during your pilot test**: open
Section A on the live site and confirm Province/City/Barangay turn into
dropdowns after picking a Region. If they don't, the form still works
perfectly fine as plain text — you've just lost the convenience, not any
functionality.

**Regions/clusters outside your actual study areas:** reviewers noted the
dropdown should ideally be limited to only ACPC's actual study
regions/clusters rather than all 18. I don't have that list — if you send
it, `tools/enhance_schema.py`'s `PH_REGIONS` list is a one-line change to
restrict it (or the questionnaire can stay open to all 18 if the sampling
frame is expected to cover more areas than initially listed).

---

## 8. Updating the questionnaire later

1. Re-export the revised Word doc to Markdown and isolate each instrument's
   section (see `tools/parse_questionnaire.py`'s docstring for the pandoc
   command).
2. Run `tools/parse_questionnaire.py` to produce updated
   `tools/questions_A.json` / `questions_B.json`.
3. Run `tools/enhance_schema.py` to reapply the Region dropdown, date/
   time/month/numeric field types, hints, conditional-logic detection, the
   required-field list, and the multi-choice/mutual-exclusivity fixes on
   top of the freshly parsed schema.
4. Run `tools/generate_gs_schema.py` to regenerate `src/Schema_A.gs` /
   `src/Schema_B.gs`.
5. Paste the updated `Schema_*.gs` into the Apps Script editor and
   redeploy (Deploy → Manage deployments → New version).
6. `docs/` needs no changes — it renders whatever schema the backend
   serves.

---

## 8a. Known limitations / explicitly deferred

Raised in review but not implemented in this pass — flagged here rather
than silently skipped:

- **No cross-section "terminate on No"**: if Consent to Participate or the
  Loan Agreement Verification comes back No/Unable, the questionnaire
  doesn't automatically end the interview or skip the remaining sections
  — the routing note is shown, but the enumerator still needs to
  recognize it and use "\u2190 Menu" to end the interview manually. Building
  a real early-termination flow (a short "interview ended" screen, a
  partial-response submission path) is a bigger feature than a same-pass
  extension could responsibly cover.
- **Final Eligibility Determination (A10) is still a manual selection**,
  not computed from A5/A6/A7/A8's answers, even though reviewers asked
  for it to be automatic. The decision tree has enough edge cases
  (verification-required states, replacement-respondent states) that I'd
  rather build and test it deliberately than guess at the logic.
- **No dynamic option population** — e.g. "Most Significant Difficulty"
  (D6) still shows the full difficulty list rather than being filtered to
  only what was checked in D5; "Principal Commodity/Activity" doesn't
  pull its options from the enterprise-activities list in C1.
- **No Loan Agreement/Account Reference Number input** — A9 still only
  offers the two fallback options ("not collected"/"maintained
  separately"), matching the reviewer's own suggested resolution (keep
  identifiable loan-account numbers out of the survey dataset entirely,
  tracked in a separate protected file instead) rather than adding a
  field that would need to be treated as sensitive data.
- **Interview Outcome / Data Verification / Random Phone Back-check**
  still appear in Section 2 near the top, not moved to the end of the
  survey as suggested — this is a schema-section-restructuring change
  I haven't done yet.
- **LANDBANK lending-center dropdown and enumerator/supervisor-name
  dropdowns** need an actual list from LANDBANK/your team to populate —
  they stay free text until you can supply that list.
- **Region dropdown lists all 18 Philippine regions**, not narrowed to
  ACPC's actual study areas/clusters — see Section 7e.

---

## 9. How this was verified

Everything below was tested with Node.js (including a real DOM via jsdom
simulating an actual browser) before being handed to you, since this
environment can't reach Google's or GitHub's live servers directly:

- All `.gs` files and `docs/app.js` pass JavaScript syntax checks.
- **Every one of the 267 (Instrument A) / 200 (Instrument B) field IDs the
  static site generates matches exactly, in the same order,** the columns
  the Apps Script backend expects — so no answer lands in the wrong column
  or gets silently dropped.
- A mocked `Code.gs` backend (fake `SpreadsheetApp`) confirmed
  `doGet(?action=schema)`, `doGet(?action=ping)`, and
  `doPost({action:'submit'})` all behave correctly, including invalid-input
  and malformed-JSON error handling.
- A full jsdom run: loaded `docs/index.html` and `docs/app.js` in a real
  DOM, clicked through the instrument picker, filled in fields, submitted,
  and confirmed the posted data reaches a mock backend correctly shaped —
  then separately confirmed that when the network fails mid-submission,
  the response is correctly queued to `localStorage` for later sync.
- **Sequential `response_no` generation** confirmed correct and gap-free
  across multiple submissions against a mock sheet.
- **Required-field validation (revised policy)**: confirmed `Next`/`Submit`
  only block on the curated ~26 required fields, not every field; confirmed
  a required field with no answer still blocks and highlights correctly;
  confirmed non-required fields can be left entirely blank without
  triggering any warning; confirmed no field anywhere auto-gains an N/A
  option any more (choice fields show exactly their own source options);
  confirmed the identical behavior for the `google.script.run` variant.
- **The strongest check**: a jsdom run that completed and submitted the
  entire real Instrument A questionnaire — all 14 sections, 267 columns —
  end to end, then confirmed zero blank values among the submitted answers
  (a mix of genuine answers and legitimate conditional auto-N/A values).
- **New dropdown fields**: confirmed the >6-option threshold correctly
  renders a `<select>` instead of radio buttons, that it shows exactly its
  own options (no auto-added N/A), that choosing an "Other: specify" entry
  shows a companion text box and submits the combined value correctly.
- **The front-matter parsing fix**: confirmed the previously-buggy intro
  section now has zero fields and renders as plain instructional text,
  both in the parsed schema and in an actual rendered screenshot.
- **Date/time pickers and the Region dropdown**: confirmed native
  `<input type="date">`/`<input type="time">` render correctly; confirmed
  the 18-option Region dropdown renders, submits the exact selected value,
  and — since it's a single_choice field with more than 6 options —
  automatically gets the same dropdown treatment as any other long list.
  Verified visually with a rendered screenshot showing all 18 regions.
- **Real rendered screenshots** (Chromium via Playwright, not just jsdom):
  desktop and mobile views of the chooser screen, the front-matter fix
  showing clean instructional text, the auto-captured timestamp fields,
  required asterisks appearing only on the curated field list, item
  numbers (A1, A5, A10, etc.) on question headings, and a full 14-section
  click-through with zero browser console errors.
- **Four more parser bugs found and fixed during this review pass**:
  confidence-scale questions with a lead-in phrase other than the literal
  word "Response" were silently becoming free-text fields instead of 1–5
  scales; a real question immediately followed by a short filler line like
  "Number: ____ persons" was losing its actual question text; consecutive
  `###` sub-headings were silently discarding the first one's question
  entirely (this is why "C21a. Which shock had the greatest effect?" was
  missing); and routing instructions merged with a real trailing question
  ("If No → do not continue... Is the respondent at least 18 years old?")
  were leaving the routing clause stuck on the front of the label. All
  four confirmed fixed against the real questionnaire text.
- **Numeric fields**: confirmed native numeric input renders for all 35
  identified fields, rejects non-numeric characters, and no longer shows
  a misleading "0" placeholder.
- **Conditional / skip logic (generalized)**: confirmed fields on both
  sides of an Individual/Organizational branch start grayed with auto-N/A
  before the branching question is answered; confirmed the correct side
  un-grays and the other stays grayed the moment an answer is picked;
  confirmed flipping the answer back clears the newly-inapplicable field
  and resets the newly-applicable one to blank (not a stale leftover
  value); confirmed this extends correctly to matrix-table fields;
  confirmed the general "If Yes/If No" detector correctly attaches
  conditions to fields the source wording didn't use the Individual/
  Organizational phrasing for, including a case needing two AND-combined
  conditions at once (phone type: Individual branch AND Mobile Access =
  Yes). Verified visually with before/after screenshots.
- **New: exact-amount vs. fallback mutual exclusivity**: confirmed typing
  a real PHP figure grays out the fallback reason question, confirmed
  choosing a fallback reason instead grays out the numeric field, and
  confirmed both directions correctly toggle back when cleared — tested
  as a full round-trip, not just one direction.
- **New: Output Disposition / loan-use auto-sum**: confirmed the Total row
  computes live from the rows above it, confirmed it's disabled from
  manual entry, confirmed it correctly flags in red once the sum exceeds
  100%, and confirmed the computed total is stored under the same field ID
  the schema's own validation logic expects (a real bug was caught and
  fixed here during testing — the first draft computed it under a
  different ID than what would have been validated).
- **PSGC cascading location dropdowns**: confirmed the full Region→
  Province→City/Municipality→Barangay cascade against a mocked API,
  including the region-name matching logic (which has to tolerate the
  live API formatting region names differently than my own dropdown
  text). Just as important, confirmed the failure path: with the PSGC API
  entirely unreachable, Province/City/Barangay silently remain the
  original plain-text fields with their example hints and the form stays
  fully completable — verified both in jsdom and in a real Chromium
  browser with the PSGC requests deliberately blocked.

**What's still untested** (can't be done from this environment): an actual
live deployment on `script.google.com`, real GitHub Pages/Render hosting,
Apps Script's real CORS behavior in a live browser, and — the one piece
that matters most to flag — **whether `psgc.gitlab.io` actually responds
to cross-origin requests from your published site's real domain**. I
can't make live calls to that specific host from this sandbox, so while
the cascade logic and its fallback are both thoroughly tested, the "does
the live API actually answer" part is not. If it doesn't, the location
fields simply stay as plain text — no functionality is lost, only the
dropdown convenience. The `text/plain` Content-Type trick used in
`docs/app.js`'s POST request to your own backend is a well-established
pattern for calling Apps Script cross-origin without triggering a CORS
preflight it can't answer — but do the pilot-run test below before real
fieldwork regardless.

**Pilot test before real fieldwork:** open your published site, submit 2–3
test responses — try leaving something blank on purpose to confirm it's
blocked, try the N/A checkboxes on a date/time/number field, try picking a
Region and confirm Province turns into a dropdown (or note if it doesn't —
see above), and test the Individual/Organizational branch in Section A to
confirm the right fields gray out. Confirm the good responses appear
correctly in the Sheet with sequential `response_no` values, then delete
those test rows and any stray tabs per Section 6.
