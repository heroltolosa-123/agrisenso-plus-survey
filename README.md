# AGRISENSO Plus Baseline Survey — Standalone Web Site + Google Sheets Backend

A real, shareable website (not a `script.google.com` link) for the
DRVN/ACPC AGRISENSO Plus Baseline Study questionnaires, backed by Google
Sheets as the database.

- **Instrument A** — AGRISENSO Plus Borrowers (122 questions / 226 data fields)
- **Instrument B** — Non-Borrower Comparison Group (103 questions / 173 data fields)

**Architecture:**
- `docs/` — a plain static website (HTML/CSS/JS, no build step) that renders
  the whole survey. You publish this with GitHub Pages (or Render, Netlify,
  any static host) and get a normal URL to share with enumerators.
- `src/` — a small Google Apps Script project, bound to your Google Sheet,
  that exposes the questionnaire and accepts submissions as a JSON API.
  This is the *only* part that touches Google's infrastructure — the site
  your users see is entirely yours.

The site talks to the Apps Script backend over `fetch()`, the same way any
website talks to any API. Everything else (offline queueing, section
navigation, all field types) works exactly as before.

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

1. Open `docs/config.js`.
2. Replace the placeholder with the URL from Step 1:
   ```js
   var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycb.../exec";
   ```
3. Save.

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

## 7. Required fields — no more blank submissions

Every question in the form is now mandatory. **Next** and **Submit** both
check that every question on the relevant page(s) has an answer, and will
not proceed otherwise — the unanswered question(s) get a red outline and a
message tells you how many are still missing. **Submit** re-checks the
*entire* questionnaire (not just the last page) and jumps back to the
first incomplete section if anything was missed earlier.

For questions that genuinely don't apply to a given respondent (skip
logic, e.g. "Ask only if Individual Borrower"), every choice-type question
automatically gets an **"N/A — Not applicable"** option, and text
questions accept a typed `N/A` — so "required" never forces an enumerator
to invent an answer, it only prevents *accidental* blanks. This is what
was happening in your pilot test for Instrument B: the submission went
through with everything empty except the timestamp, precisely because
nothing enforced completion before.

See `guide/AGRISENSO_Plus_Survey_Enumerator_Guide.docx` for the
enumerator-facing explanation of how this works — share that file (or a
printed copy) with your field team before their first interview.

---

## 8. Updating the questionnaire later

1. Re-export the revised Word doc to Markdown and isolate each instrument's
   section (see `tools/parse_questionnaire.py`'s docstring for the pandoc
   command).
2. Run `tools/parse_questionnaire.py` to produce updated
   `tools/questions_A.json` / `questions_B.json`.
3. Run `tools/generate_gs_schema.py` to regenerate `src/Schema_A.gs` /
   `src/Schema_B.gs`.
4. Paste the updated `Schema_*.gs` into the Apps Script editor and
   redeploy (Deploy → Manage deployments → New version).
5. `docs/` needs no changes — it renders whatever schema the backend
   serves.

---

## 9. How this was verified

Everything below was tested with Node.js (including a real DOM via jsdom
simulating an actual browser) before being handed to you, since this
environment can't reach Google's or GitHub's live servers directly:

- All `.gs` files and `docs/app.js` pass JavaScript syntax checks.
- **Every one of the 226 (Instrument A) / 173 (Instrument B) field IDs the
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
- **Required-field validation**: confirmed `Next` blocks and highlights a
  blank field; confirmed `Submit` re-validates every section and jumps to
  the first incomplete one; confirmed every choice/scale/matrix field
  automatically gains a working N/A option that satisfies the requirement;
  confirmed the identical behavior for the `google.script.run` variant used
  on the direct Apps Script page.
- **The strongest check**: a jsdom run that completed and submitted the
  entire real Instrument A questionnaire — all 14 sections, 280 fields —
  end to end, then confirmed zero blank values among the 280 submitted
  answers.

**What's still untested** (can't be done from this environment): an actual
live deployment on `script.google.com`, real GitHub Pages/Render hosting,
and Apps Script's real CORS behavior in a live browser. The `text/plain`
Content-Type trick used in `docs/app.js`'s POST request is a
well-established pattern for calling Apps Script cross-origin without
triggering a CORS preflight it can't answer — but do the pilot-run test
below before real fieldwork regardless.

**Pilot test before real fieldwork:** open your published site, submit 2–3
test responses (try leaving something blank on purpose to confirm it's
blocked, and try the N/A option once), confirm the good ones appear
correctly in the Sheet with sequential `response_no` values, then delete
those test rows and any stray tabs per Section 6.
