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
// Paste the approved roster between the brackets and republish — the
// fields turn into pick-lists automatically. Left empty, they stay free
// text but still suggest names already used on the same device, so at
// least spellings converge within an enumerator's own work.
//
// Use the agreed coding, one string per person, code first:
//
//     enumerators: "EN-RR-NN — Surname, First M."
//     supervisors: "SV-RR-N — Surname, First M."
//
// RR is the two-digit region of the enumerator's home cluster (02 for
// Region II, 06 for Region VI; NCR = 00, CAR = 14, BARMM = 15). NN is
// their number inside that region, 01 upward, assigned once and never
// reused — a code stays with the person even if they help in another
// cluster, so the audit trail does not break on reassignment.
//
// The em dash and the spaces around it matter: the roster string is
// stored verbatim in one column, and splitting it back into code and
// name during analysis relies on that separator being identical in
// every row. Copy the pattern below rather than retyping it.
//
// Printable card for the field teams: reference/AGRISENSO_Coding_Reference.pdf
// ---------------------------------------------------------------------
var STAFF_LISTS = {
  enumerators: [
    // "EN-02-01 — Dela Cruz, Juan M.",
    // "EN-02-02 — Reyes, Ana P.",
    // "EN-06-01 — Bautista, Mark L.",
  ],
  supervisors: [
    // "SV-02-1 — Santos, Maria L.",
    // "SV-06-1 — Villanueva, Ramon T.",
  ]
};
