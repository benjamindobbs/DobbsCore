# DobbsCore Gradebook Sync — Chrome Extension

A Chrome extension that bridges the [DobbsCore](https://classicaltech.org) teacher platform with PowerSchool. It lets teachers create PS assignments and push DobbsCore grades directly into the PS gradebook without leaving the browser — no API credentials or district IT involvement required.

---

## How it works

The extension injects buttons into PowerSchool gradebook pages and the DobbsCore teacher portal. Because the PS gradebook is a browser app that authenticates via session cookies, the extension can make PS API calls directly from the browser on the teacher's behalf — no server-side PS access needed.

DobbsCore API calls (fetching class rosters, activity grades, and Work-Based Learning sync progress) are proxied through the extension's background service worker to bypass CORS restrictions.

PS API calls originating from the DobbsCore portal are routed through an open PS tab via `chrome.scripting.executeScript`, so session cookies are included automatically without any extra login.

### Flows

**Import Roster to DobbsCore** — appears on a PS class page when that section hasn't been registered in DobbsCore yet. Pulls the live PS roster (including PS student DCIDs for later attendance matching) and creates a matching class in DobbsCore in one click.

**Re-sync Roster** — appears on a PS class page once the section is registered, alongside the other sync buttons. Pulls the live PS roster again and reconciles it against DobbsCore: students newly on the PS roster are added and date-stamped (with their PS section entry date when available, otherwise the sync date, which is what lets DobbsCore prorate their do-now requirement instead of expecting a full count from before they arrived); students no longer on the PS roster are withdrawn — not deleted, so their score history and WBL records are kept, and a later re-sync reactivates them if they return. Run this whenever a section's enrollment changes mid-year.

**Create DobbsCore Assignment** — appears on a PS class page once the section is registered. Creates a new PS assignment (name, due date, max points, marking period category) and immediately scores it using computed DobbsCore activity grades for a teacher-selected date range.

**Sync DobbsCore Grades** — appears on the PS score-entry page for an existing assignment. Scores the open assignment using DobbsCore activity grades for a selected date range without creating a new assignment.

**Sync Work-Based Learning** — appears on a PS class page once the section is registered and linked to a WBL program in DobbsCore. Syncs the three scored WBL lenses independently, each its own button:

- *Sync Skills (Formative)* — one 0/100 completion assignment per (credential, skill) pair: 100 if the student has satisfied that skill's required demonstrations toward that credential, 0 otherwise.
- *Sync Credentials (Summative)* — one 0/100 assignment per credential: 100 if earned in this class this term, 0 otherwise. A credential earned in a prior class or year is left unscored here — its grade already landed where it was earned.
- *Sync Selected Work Events* — one assignment per completed Work Event you check off, scored from its Holistic Call tier (blended with the student's attendance ratio for that job's window when attendance data has been pulled — see below).
- *Sync Transfer Skills* — one assignment per transfer kind (Application of Previous Knowledge, Extension of Knowledge), scored from the sum of verified transfer-claim scores.

QC Spot Checks and the dispositional Do Now / Exit Slip lens are formative by design and never sync to PS. PS assignment IDs are saved back to DobbsCore after each sync so re-syncing updates the same assignments instead of creating duplicates.

**Sync Attendance from PS** — lives in the DobbsCore teacher portal's WBL **Roster** tab, not on a PS page. Two-step flow that feeds the attendance blend used by *Sync Selected Work Events* above:

1. Open the PS **Attendance Grid** page for a section. The extension automatically reads the grid's embedded attendance data and caches it in browser storage (a toast confirms how many students/dates were captured).
2. Back in the DobbsCore portal's WBL Roster tab, click **Sync Attendance from PS**. It matches the selected program's linked classes to their cached PS sections (by student DCID overlap if the section IDs don't line up), and bulk-imports every cached date for each — no per-date review step. `UNV` (Unverified Absence) counts against a student's ratio unless a teacher has logged a "Called Out" override for that date on the WBL Roster; `UXT` (Unexcused Tardy) counts as half credit; everything else counts as present.

### Grade calculation

**Activity grades** are computed server-side by DobbsCore based on the teacher's gradebook settings:

- **Max Score** — point value of a full-credit submission
- **Completion %** — score awarded when the student meets or exceeds the required activity count
- **No Submission %** — score awarded when the student has zero qualifying submissions

Students who haven't linked their DobbsCore account receive the no-submission score. Students are matched between systems by their 6-digit PS Student Number.

A student who enrolled partway through the selected date range has their required activity count prorated by the fraction of the window they were actually on the roster for (based on the PS section entry date captured by **Re-sync Roster** below), rather than being scored as if they'd been enrolled the whole time. A student whose enrollment doesn't overlap the window at all is left unscored rather than given a zero.

**Work-Based Learning scores** are computed server-side by DobbsCore and are all completion or tier-based, never partial-credit fractions:

- *Skills* and *Credentials*: 100 if satisfied/earned, 0 otherwise (see Flows above).
- *Work Events*: the Holistic Call tier's configured point percentage, blended 80/20 with the student's attendance ratio for that job's window when attendance has been pulled for the relevant PS section — otherwise the raw tier percentage.
- *Transfer*: the sum of an instructor's verified transfer-claim scores, capped at the configured max.

Default max-points values for all flows are pre-filled from the teacher's DobbsCore gradebook settings.

---

## Installation

This extension is not published to the Chrome Web Store. Install it as an unpacked extension in Developer Mode.

**Prerequisites**
- Google Chrome (or any Chromium-based browser)
- Access to the PowerSchool teacher gradebook at `hartford.powerschool.com`
- A DobbsCore teacher account at `classicaltech.org`

**Steps**

1. Download or clone this repository to your computer.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the folder containing this repository.
5. The extension "DobbsCore Gradebook Sync" will appear in your extensions list.

---

## Configuration

After installation, click the extension icon in the Chrome toolbar to open **DobbsCore Settings**.

| Field | Value |
|---|---|
| DobbsCore Server URL | `https://classicaltech.org` (or `http://localhost:PORT` for local dev) |
| Teacher Token | Your Google OAuth access token — copy it from the **Chrome Extension** section on the DobbsCore teacher portal |

The token expires periodically (roughly every hour). Return to DobbsCore, copy a fresh token, and paste it into the extension settings when you see auth errors.

---

## Usage

### Importing a class roster

1. Navigate to a class in the PS gradebook (`#/?sectionId=...`).
2. Click **Import Roster to DobbsCore** (green button, bottom-right).
3. Enter a class name and click **Import**.

The class now appears in DobbsCore with all active students enrolled.

### Re-syncing a class roster

1. Navigate to the same class page in PS.
2. Click **Re-sync Roster** (amber button, bottom-right).
3. Click **Re-sync**.

The panel reports what changed — students added, reactivated, or withdrawn, plus a count left unchanged. Nothing is deleted: a withdrawn student's scores and WBL history stay intact, and they're picked back up automatically if a later re-sync finds them on the PS roster again.

### Creating an activity assignment and syncing grades

1. Navigate to the same class page in PS.
2. Click **Create DobbsCore Assignment** (blue button, bottom-right).
3. Fill in the assignment name, due date, max points, and category. The **Formative** category and your configured max score are selected by default.
4. Choose the DobbsCore class and the date range covering the activity window you want to grade.
5. Click **Create & Sync**.

The extension will create the PS assignment, fetch DobbsCore grades, and submit scores in one operation.

### Syncing grades to an existing assignment

1. Open the score-entry page for an existing PS assignment (`score_assignment?...`).
2. Click **Sync DobbsCore Grades** (blue button, bottom-right).
3. Select the DobbsCore class and date range.
4. Click **Sync Grades**.

### Syncing Work-Based Learning grades

1. Navigate to a registered class page in PS. This button only appears if the class is linked to a WBL program in DobbsCore.
2. Click **Sync Work-Based Learning** (orange button, bottom-right).
3. Choose the WBL program, formative and summative categories, due date, and Work Event / Transfer max points.
4. For Work Events, check off which completed jobs to sync (unsynced ones default to checked; already-synced ones default unchecked so you don't accidentally re-push everyone).
5. Click **Sync Skills (Formative)**, **Sync Credentials (Summative)**, **Sync Selected Work Events**, or **Sync Transfer Skills** — each runs independently, so you only need to click the ones you want to push this time.

On subsequent syncs the extension updates the same PS assignments rather than creating new ones.

### Pulling PS attendance for the Work-Based Learning attendance blend

1. In the PS gradebook, open the **Attendance Grid** page for each section you want to pull.
   - The extension automatically reads and caches that section's attendance data in the background. A brief toast notification confirms success.
2. In the DobbsCore teacher portal, navigate to the WBL program's **Roster** tab.
3. Click **Sync Attendance from PS**.
   - The extension matches every class linked to that program against its cached PS attendance and bulk-imports the whole cached date range for each — there's no per-date step. Attendance only affects grades through the Work Event blend described above; it plays no part in activity-grade or WBL Skills/Credentials/Transfer scoring.

---

## File overview

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3); declares permissions and host access for both PowerSchool and the DobbsCore portal |
| `content.js` | Injected into PS gradebook pages and the DobbsCore portal; renders buttons and panels, drives all sync and attendance logic |
| `background.js` | Service worker; proxies DobbsCore API calls (CORS bypass), reads PS attendance JS variables via `executeScript`, and relays PS fetches from the DobbsCore portal through an open PS tab |
| `popup.html` / `popup.js` | Settings UI for server URL and teacher token |

---

## Notes

- The extension relies on PS session cookies already present in the browser. The teacher must be logged into PowerSchool for any sync to work.
- For Sync Attendance from PS to have anything to import, the teacher must open each section's PS Attendance Grid page *before* clicking Sync Attendance from PS in the DobbsCore portal. The attendance data is cached per-section and is valid until the browser is restarted or the extension is reloaded.
- If a cached section doesn't match a class's stored `ps_section_id`, the extension falls back to matching by PS student DCID overlap (captured at roster import/re-sync time).
- If the extension button doesn't appear after install, reload the extension at `chrome://extensions` and hard-refresh the PS tab (`Ctrl+Shift+R`).
- Student matching is done by PS **Student Number** (the 6-digit district ID). DobbsCore student records must use this same ID.
- A skill required by two different credentials syncs as two separate PS assignments, one per credential — because each credential can set its own required-demonstrations threshold for the same skill, there's no single shared assignment for it.
