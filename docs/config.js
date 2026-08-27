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
// Paste the approved names from DRVN/LANDBANK between the brackets and
// republish — the fields turn into pick-lists automatically. Left empty,
// they stay free text but still suggest names already used on the same
// device, so at least spellings converge within an enumerator's own work.
// ---------------------------------------------------------------------
var STAFF_LISTS = {
  enumerators: [
    // "Dela Cruz, Juan M.",
  ],
  supervisors: [
    // "Santos, Maria L.",
  ]
};
