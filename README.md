# DobbsCore Gradebook Sync — Chrome Extension

A Chrome extension that bridges the [DobbsCore](https://classicaltech.org) teacher platform with PowerSchool. It lets teachers create PS assignments and push DobbsCore grades directly into the PS gradebook without leaving the browser — no API credentials or district IT involvement required.

---

## How it works

The extension injects buttons into PowerSchool gradebook pages and the DobbsCore teacher portal. Because the PS gradebook is a browser app that authenticates via session cookies, the extension can make PS API calls directly from the browser on the teacher's behalf — no server-side PS access needed.

DobbsCore API calls (fetching class rosters, grades, microcredential progress, and rubric totals) are proxied through the extension's background service worker to bypass CORS restrictions.

PS API calls originating from the DobbsCore portal are routed through an open PS tab via `chrome.scripting.executeScript`, so session cookies are included automatically without any extra login.

### Flows

**Import Roster to DobbsCore** — appears on a PS class page when that section hasn't been registered in DobbsCore yet. Pulls the live PS roster (including PS student DCIDs for later attendance matching) and creates a matching class in DobbsCore in one click.

**Create DobbsCore Assignment** — appears on a PS class page once the section is registered. Creates a new PS assignment (name, due date, max points, marking period category) and immediately scores it using computed DobbsCore activity grades for a teacher-selected date range.

**Sync DobbsCore Grades** — appears on the PS score-entry page for an existing assignment. Scores the open assignment using DobbsCore activity grades for a selected date range without creating a new assignment.

**Sync Microcredentials** — appears on a PS class page when the registered class has one or more microcredentials defined in DobbsCore. Offers two operations:

- *Sync Checkpoints* — creates or updates one PS assignment per checkpoint (formative). Each student's score is proportional to the number of subtasks completed. Assignments excluded from sync in the teacher portal are skipped.
- *Sync Credential* — creates or updates a single summative PS assignment for the whole credential. Score is the percentage of all subtasks completed across all checkpoints (or percentage of fully-completed checkpoints if subtask tracking is disabled in gradebook settings). PS assignment IDs are saved back to DobbsCore so re-syncing updates the same assignments rather than creating new ones.

**Sync Daily Rubric** — appears on a PS class page for all registered classes. Creates a new PS assignment scored from DobbsCore daily rubric totals for a selected date range. Each student's score is scaled as `(total_rubric_points / (days × per_day_max)) × assignment_max`.

**PS Attendance → DobbsCore Rubric** — a two-step flow that pre-fills timeliness values in the DobbsCore rubric UI from PS attendance data:

1. When the teacher opens the PS attendance grid page, the extension automatically reads the attendance data embedded in the page and caches it in browser storage.
2. On the DobbsCore portal rubric tab, a **Pull from PS Attendance** button appears. Clicking it looks up the cached attendance for the selected class and date, and sets each student's timeliness field: `UXT` (Unexcused Tardy) → 3, `UNV` (Unverified Absence) → 0, all other codes → 5 (On Time).

### Grade calculation

**Activity grades** are computed server-side by DobbsCore based on the teacher's gradebook settings:

- **Max Score** — point value of a full-credit submission
- **Completion %** — score awarded when the student meets or exceeds the required activity count
- **No Submission %** — score awarded when the student has zero qualifying submissions

Students who haven't linked their DobbsCore account receive the no-submission score. Students are matched between systems by their 6-digit PS Student Number.

**Microcredential scores** are computed client-side by the extension:

- *Checkpoint (formative)*: `(subtasks_completed / total_subtasks) × max_points`, or full/zero points for checkpoints with no subtasks.
- *Credential (summative)*: `(all_subtasks_completed / total_subtasks) × max_points` when subtask tracking is enabled; `(checkpoints_completed / total_checkpoints) × max_points` otherwise.

**Rubric scores** are computed client-side: `(student_total / (days × per_day_max)) × assignment_max`, rounded to 2 decimal places.

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

### Syncing microcredential checkpoints and credentials

1. Navigate to a registered class page in PS.
2. Click **Sync Microcredentials** (purple button, bottom-right). This button only appears if the class has microcredentials defined in DobbsCore.
3. Select the microcredential, category, due date, and max points.
4. Click **Sync Checkpoints** to create/update one PS assignment per checkpoint, or **Sync Credential** to create/update a single summative assignment for the full credential.

On subsequent syncs the extension updates the same PS assignments rather than creating new ones.

### Syncing daily rubric grades

1. Navigate to a registered class page in PS.
2. Click **Sync Rubric** (teal button, bottom-right).
3. Fill in the assignment name, due date, max points, category, and the date range to include.
4. Click **Create & Sync**.

Scores are scaled to the assignment's max points based on each student's total rubric points relative to the maximum possible over the selected period.

### Pulling PS attendance into the DobbsCore rubric

1. In the PS gradebook, open the **Attendance Grid** page for the class you want to grade.
   - The extension automatically reads and caches the attendance data in the background. A brief toast notification confirms success.
2. In the DobbsCore teacher portal, navigate to the **Daily Rubric** tab, select the class and date.
3. Click **Pull from PS Attendance** (appears in the rubric tab actions area).
   - Timeliness fields are filled for each matched student: Unexcused Tardy → 3, Unverified Absence → 0, all other codes → 5.

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
- For the PS Attendance pull to work, the teacher must open the PS Attendance Grid page for the relevant class *before* using Pull from PS Attendance in the DobbsCore portal. The attendance data is cached per-section and is valid until the browser is restarted or the extension is reloaded.
- If the same date appears in attendance caches for multiple sections, the extension matches the correct section using the PS student DCIDs stored at import time.
- If the extension button doesn't appear after install, reload the extension at `chrome://extensions` and hard-refresh the PS tab (`Ctrl+Shift+R`).
- Student matching is done by PS **Student Number** (the 6-digit district ID). DobbsCore student records must use this same ID.
- Microcredential checkpoints marked as excluded from sync in the teacher portal are skipped during the Sync Checkpoints flow.
