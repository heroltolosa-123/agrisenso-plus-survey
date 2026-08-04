# AGRISENSO Plus Baseline Survey — Google Apps Script Web App

A Google Sheets–native survey app for the DRVN/ACPC AGRISENSO Plus
Baseline Study questionnaires. No server, no hosting bill, no separate
database — Google Sheets *is* the database, and Google hosts the app for
you at a `script.google.com` URL.

- **Instrument A** — AGRISENSO Plus Borrowers (122 questions / 226 data fields)
- **Instrument B** — Non-Borrower Comparison Group (103 questions / 173 data fields)

Every checkbox, fill-in blank, 1–5 confidence scale, and matrix/grid
question from the questionnaire is reproduced as a form field. This was
tested end-to-end against a mocked Sheets backend (header creation, row
appends, duplicate-header prevention, and exact column-ID matching between
the browser form and the sheet) before being handed to you — see
"How this was verified" at the bottom.

It works offline mid-interview: if the connection drops after the page has
loaded, the browser queues the response (via `localStorage`) and a **Sync
Pending Now** button retries later.

---

## 1. Set up the Google Sheet + Apps Script project

1. Create a new Google Sheet (this will be your survey database) — e.g.
   "AGRISENSO Plus Baseline Data".
2. In the Sheet, go to **Extensions → Apps Script**. This opens a script
   project already *bound* to your Sheet (so it can read/write it with no
   API keys or credentials at all).
3. Delete the default empty `Code.gs` content, then create each file in
   this project matching the ones in `src/` here:
   - `Code.gs`
   - `Schema_A.gs`
   - `Schema_B.gs`
   - `Index.html` (File → New → HTML file)
   - `JavaScript.html` (File → New → HTML file)
   - `Stylesheet.html` (File → New → HTML file)
   - Open **Project Settings → appsscript.json** (or the manifest file) and
     replace its contents with `src/appsscript.json` here.
4. Copy-paste each file's contents from this project into the matching file
   in the Apps Script editor, then **Save** (Ctrl/Cmd+S).

   *(Prefer not to copy-paste six files by hand? See Section 4 — `clasp` can
   push the whole `src/` folder in one command, and lets you keep the
   project in GitHub too.)*

5. (Optional but recommended) In the Apps Script editor, select the
   `setupSheetsManually` function from the function dropdown and click
   **Run** once. This pre-creates both data tabs and their `_Dictionary`
   reference tabs before your first live interview. The first authorization
   prompt will ask you to approve the script's access to the Sheet — that's
   expected and safe (it's your own script acting on your own Sheet).

---

## 2. Deploy it as a web app

1. In the Apps Script editor: **Deploy → New deployment**.
2. Click the gear icon next to "Select type" → **Web app**.
3. Settings:
   - **Execute as:** *Me (your account)* — this lets the form write to the
     Sheet even for people who don't have a Google account themselves.
   - **Who has access:** *Anyone* (or *Anyone within [your org]* if you want
     to restrict it to people signed into your organization's Google
     Workspace).
4. Click **Deploy**, then **Authorize access** and approve the permissions
   (this is your own script; the warning screen is normal for
   self-deployed Apps Script projects — click "Advanced" → "Go to
   [project name] (unsafe)" if prompted, then Allow).
5. Copy the **Web app URL** it gives you — that's the survey link. Share it
   with your enumerators (as a bookmark, QR code, etc.).

**Updating later:** whenever you change any file, use **Deploy → Manage
deployments → (pencil icon) → New version → Deploy** so the live URL picks
up the change. Just saving the file in the editor does *not* update the
public link.

---

## 3. Using the app in the field

1. Open the Web app URL → choose **Instrument A** or **Instrument B**.
2. Work through the sections with **Previous / Next** (in the questionnaire's
   own order: Survey Instrument info → Questionnaire Administration →
   Introduction & Consent → Sections A–H → Enumerator Final Review →
   Interview Notes → Closing Statement).
3. Click **Submit Response**. The app saves a permanent local copy in the
   browser and tries to write it to the Sheet immediately; if there's no
   signal, it queues the response and tells you so — nothing is lost.
4. **Sync Pending Now** retries any queued responses on that device/browser.
   The instrument-picker screen shows how many are still waiting.
5. Answers auto-save to that browser as you go, so an accidental tab close
   mid-interview can be resumed (you'll be asked "Resume in-progress
   response?" next time that instrument is opened on the same device).

### Where the data ends up
In your Google Sheet:
- `Instrument_A_Borrowers` / `Instrument_B_NonBorrowers` — one row per
  response. Row 1 = stable field IDs, row 2 = full question text (frozen).
- `Instrument_A_Borrowers_Dictionary` / `..._Dictionary` — a two-column
  `field_id → question text` lookup, handy when analyzing the data later
  (e.g. in R or Excel, join on `field_id`).

### Important caveats
- The device needs internet to **load** the survey page the first time;
  after that, brief connection drops during the interview are tolerated
  (see above), but the browser tab must not be closed before syncing if
  you're offline.
- Because this uses `localStorage`, "resume" and "pending" only work on the
  *same device and browser* the interview started on — it isn't shared
  across devices until it syncs to the Sheet.
- Skip/routing logic (e.g. "ask only if A2 = Individual Borrower") is shown
  as an on-screen instruction under the question, not auto-hidden —
  enumerators should still follow the printed routing notes.
- Do a **pilot run** before real fieldwork: submit a couple of test
  responses, confirm they land correctly in the Sheet, then delete those
  test rows.

---

## 4. Optional: manage the project with `clasp` + GitHub

Since you mentioned Git — Apps Script itself is hosted by Google (there's
no separate server to put on Render for this path), but you can absolutely
keep the *source* in GitHub and push it to Apps Script from your Mac with
Google's official CLI, `clasp`.

```bash
npm install -g @google/clasp
clasp login                     # opens a browser to authorize your Google account

# Link to the Apps Script project created in Section 1:
# (Apps Script editor -> Project Settings -> Script ID -> copy it)
cp .clasp.json.example .clasp.json
# edit .clasp.json and paste your Script ID into "scriptId"

clasp push                      # uploads everything in src/ to Apps Script
clasp deploy                    # creates/updates a deployment (or use the editor's Deploy UI)
clasp open                      # opens the project in the browser
```

From then on: edit files under `src/`, `git commit` / `git push` to GitHub
as normal for version history, and run `clasp push` (then re-deploy) to
publish changes to the live survey.

---

## 5. Updating the questionnaire later

If ACPC revises the instrument:
1. Export the updated Word doc to Markdown (`pandoc -t gfm file.docx -o out.md`)
   and isolate each instrument's section.
2. Run `tools/parse_questionnaire.py` on it to produce updated
   `questions_A.json` / `questions_B.json`.
3. Run `tools/generate_gs_schema.py` to regenerate `src/Schema_A.gs` /
   `src/Schema_B.gs`.
4. Push/copy the updated files to Apps Script and redeploy (Section 2).

The app rebuilds every screen from these two files — no other code changes
needed for question wording/option changes. Structural changes (new field
types) would need updates to `Code.gs` and `JavaScript.html`.

---

## 6. How this was verified

Since this project can't be deployed to Google's servers from this
environment, before handing it to you it was tested with Node.js against a
mock of the Apps Script/Sheets API to check the parts most likely to break
silently:
- **All 226 (Instrument A) / 173 (Instrument B) field IDs the browser form
  generates match exactly, in the same order,** the columns the server
  expects — including every matrix/grid cell — so no answer silently gets
  dropped or lands in the wrong column.
- A full mock submission round-trip: header row created correctly (282 /
  210 columns including `submission_id`/`submitted_at`), frozen, a real
  `submitResponse` call places each answer in the right column, a second
  submission does **not** duplicate/rewrite the header, and the
  `_Dictionary` tab is populated correctly.
- All `.gs` and embedded `.html` script files pass Node's JavaScript syntax
  checker.

What wasn't (and can't be, from here) tested: an actual deployment on
`script.google.com`, real Google authorization prompts, and the live
mobile/desktop browser rendering — hence the pilot-run recommendation in
Section 3.
