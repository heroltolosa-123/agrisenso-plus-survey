// ---------------------------------------------------------------------
// AGRISENSO Plus Survey — site configuration
//
// This is already pointed at your deployed Apps Script backend, so you
// don't need to touch this file on every push. If you ever create a
// brand-new Apps Script deployment (rather than "New version" on the
// existing one), you'll get a different /exec URL and will need to
// paste it in here again — see README.md, "Deploy the backend".
// ---------------------------------------------------------------------
var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxE-lSBrz-mAhWin3-Er9rVco7FvAc5zZVWOwSKPijD-_kHaIi-PTC1b3kcFfz-QALM/exec";

// ---------------------------------------------------------------------
// Enumerator / supervisor rosters
//
// Reviewers asked for these to be controlled lists rather than free text
// ("Hero Tolosa" / "H. Tolosa" / "HT" all landing in the same column).
// With names here, the two name fields become pick-lists. Left empty,
// they fall back to free text that only suggests names already used on
// the same device.
//
// The agreed coding, one string per person, code first:
//
//     enumerators: "EN-RR-NN — Surname, First M."
//     supervisors: "SV-RR-N — Surname, First M."
//
// RR is the PSGC region code of the person's home cluster (01 Ilocos,
// 13 NCR, 14 CAR, 17 MIMAROPA — full table on the printable card).
// The number after it is their number inside that region, 01 upward.
//
// Assigned once, never reused, never reordered. Someone covering a
// second province keeps the one code they were issued, so the audit
// trail does not break on reassignment — which is why this list is
// people, not assignments, and why a person working two provinces
// appears once. New names are appended with the next free number; the
// first batch happens to be alphabetical, later ones will not be.
//
// The em dash and the spaces around it matter: the whole string is
// stored verbatim in one column and split back into code and name on
// that separator during analysis. Copy an existing line and edit it
// rather than retyping the dash.
//
// After editing, run: node tools/simulate/check_coding.js
// Printable card for the field teams: reference/AGRISENSO_Coding_Reference.pdf
// ---------------------------------------------------------------------
var STAFF_LISTS = {
  enumerators: [
    // Region I — Ilocos (La Union, Ilocos Sur)
    "EN-01-01 — Alipda, Marvin",              // Ilocos Sur
    "EN-01-02 — Balio-an, Elmer G.",          // Ilocos Sur
    "EN-01-03 — Daproza, Lea T.",             // Ilocos Sur
    "EN-01-04 — Lacasandile, Maybelline L.",  // La Union + Ilocos Sur
    "EN-01-05 — Rivera, Jaynifer",            // La Union
    "EN-01-06 — Sibayan, Grace",              // La Union + Ilocos Sur

    // MIMAROPA (Occidental Mindoro)
    "EN-17-01 — Fabrigas Jr., Greg S.",
    "EN-17-02 — Gundran, Jhon Lester",
    "EN-17-03 — Lutap, Aldrick Jetrix B.",
    "EN-17-04 — Paz, Maui",                   // role unconfirmed — see note below
    "EN-17-05 — Roldan, Marc Jaime",
  ],
  supervisors: [
    "SV-01-1 — Bay-od, Ferlina",              // La Union + Benguet (CAR)
  ]
};

// Unconfirmed, pending the rest of the roster:
//
//   - Maui Paz is shaded as a heading rather than a name on the source
//     sheet. Listed above as EN-17-04 for now. If she is in fact the
//     MIMAROPA team supervisor, move the line to `supervisors` as
//     "SV-17-1 — Paz, Maui" and leave EN-17-04 vacant — numbers are
//     retired, not reused, so nothing below it shifts.
//   - Lacasandile and Sibayan appear under both La Union and Ilocos Sur.
//     Coded as one person each, which is correct either way; only the
//     EN/SV prefix would change if they turn out to be team leads.
//   - Benguet is named as Bay-od's second province but has no enumerator
//     list yet. Its codes will be EN-14-NN (CAR).
//   - ALL-CAPS names on the source sheet were title-cased here. Confirm
//     the spellings, in particular "Balio-an" and "Fabrigas Jr.".
