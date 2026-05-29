# DobbsCore Gradebook Sync — Chrome Extension

A Chrome extension that bridges the [DobbsCore](https://classicaltech.org) teacher platform with PowerSchool. It lets teachers create PS assignments and push DobbsCore activity grades directly into the PS gradebook without leaving the browser — no API credentials or district IT involvement required.

---

## How it works

The extension injects a button into the PowerSchool teacher gradebook page. Because the PS gradebook is a browser app that authenticates via session cookies, the extension can make PS API calls directly from the browser on the teacher's behalf — no server-side PS access needed.

DobbsCore API calls (fetching class rosters and computed grades) are proxied through the extension's background service worker to bypass CORS restrictions.

### Flows

**Import Roster to DobbsCore** — appears on a PS class page when that section hasn't been registered in DobbsCore yet. Pulls the live PS roster and creates a matching class in DobbsCore in one click.

**Create DobbsCore Assignment** — appears on a PS class page once the section is registered. Creates a new PS assignment (name, due date, max points, marking period category) and immediately scores it using computed DobbsCore grades for a teacher-selected date range.

**Sync DobbsCore Grades** — appears on the PS score-entry page for an existing assignment. Scores the open assignment using DobbsCore grades for a selected date range without creating a new assignment.

### Grade calculation

Grades are computed server-side by DobbsCore based on the teacher's gradebook settings:

- **Max Score** — point value of a full-credit submission
- **Completion %** — score awarded when the student meets or exceeds the required activity count
- **No Submission %** — score awarded when the student has zero qualifying submissions

Students who haven't linked their DobbsCore account receive the no-submission score. Students are matched between systems by their 6-digit PS Student Number.

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

### Creating an assignment and syncing grades

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

---

## File overview

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3); declares permissions and host access |
| `content.js` | Injected into the PS gradebook page; renders buttons and panels, drives all sync logic |
| `background.js` | Service worker; proxies DobbsCore API calls to bypass CORS |
| `popup.html` / `popup.js` | Settings UI for server URL and teacher token |

---

## Notes

- The extension relies on PS session cookies already present in the browser. The teacher must be logged into PowerSchool for any sync to work.
- If the extension button doesn't appear after install, reload the extension at `chrome://extensions` and hard-refresh the PS tab (`Ctrl+Shift+R`).
- Student matching is done by PS **Student Number** (the 6-digit district ID). DobbsCore student records must use this same ID.
