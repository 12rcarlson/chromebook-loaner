# Chromebook Loaner System
**Bureau Valley School District**

A lightweight, browser-based Chromebook loaner tracking system inspired by TDT Asset Manager. Runs entirely from a single HTML file — no server required. Optionally syncs to Google Sheets via Apps Script.

---

## Features

| Feature | Details |
|---|---|
| **Check Out** | Log loaners by student name, ID, grade, building, asset tag, serial, and incident type |
| **Incident Types** | Forgot Device · Needs Repair · Lost · Daily Loaner |
| **Return Tracking** | One-click return marks device available again |
| **Inventory Panel** | Add/remove loaner devices; see availability at a glance |
| **Dashboard** | Live stats — active loaners, forgot device count, repair count, available devices |
| **Incident Log** | Searchable, filterable table of all transactions |
| **CSV Export** | Export all records with one click |
| **Google Sheets Sync** | Auto-push checkouts and returns to a Sheet via Apps Script |
| **Local Storage** | All data persists in the browser even without Sheets |

---

## Quick Start (no Sheets)

1. Open `src/index.html` in any modern browser
2. Start checking out devices — data saves automatically to browser local storage
3. Use **Export CSV** to back up records anytime

---

## Full Setup with Google Sheets

### Step 1 — Create the Spreadsheet

1. Go to [sheets.new](https://sheets.new) and create a new spreadsheet
2. Copy the Spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID_HERE/edit
   ```

### Step 2 — Set Up Apps Script

1. In your spreadsheet, go to **Extensions → Apps Script**
2. Delete the default `myFunction()` code
3. Paste the entire contents of `scripts/Code.gs`
4. Replace `YOUR_SPREADSHEET_ID_HERE` with your actual Spreadsheet ID
5. Click **Save** (💾)
6. Run `setupSpreadsheet` once (select it from the function dropdown → Run) to create the sheet tabs and headers
7. Grant permissions when prompted

### Step 3 — Deploy as Web App

1. Click **Deploy → New deployment**
2. Type: **Web app**
3. Description: `Chromebook Loaner API`
4. Execute as: **Me**
5. Who has access: **Anyone** *(or "Anyone within Bureau Valley" if using Google Workspace)*
6. Click **Deploy** and copy the **Web App URL**

### Step 4 — Connect the Web App

1. Open `src/index.html` in a text editor
2. Find this line near the top of the `<script>` section:
   ```javascript
   const SHEET_URL = 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
   ```
3. Replace the placeholder with your Web App URL:
   ```javascript
   const SHEET_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
   ```
4. Save the file — checkouts and returns will now sync to Sheets automatically

---

## Google Sheet Structure

### Checkouts Tab
| Column | Field |
|---|---|
| A | ID |
| B | Student Name |
| C | Student ID |
| D | Grade |
| E | Building |
| F | Asset Tag |
| G | Serial Number |
| H | Incident Type |
| I | Date Checked Out |
| J | Due Back |
| K | Status (Active / Returned) |
| L | Return Date |
| M | Notes |

Active rows are highlighted green; returned rows are gray via conditional formatting applied automatically.

### Inventory Tab
Tracks the loaner pool: Asset Tag, Serial Number, Model, Status, Notes.

---

## Repository Structure

```
chromebook-loaner/
├── src/
│   └── index.html          ← The full app (open this in a browser)
├── scripts/
│   └── Code.gs             ← Google Apps Script (paste into Apps Script editor)
├── docs/
│   └── setup-screenshots/  ← (Add your own screenshots here)
└── README.md
```

---

## Hosting Options

| Option | How |
|---|---|
| **Local file** | Just open `index.html` — works offline |
| **Google Sites** | Embed via iframe on a Google Site for staff access |
| **GitHub Pages** | Push this repo and enable Pages → `src/index.html` is the entry point |
| **Shared Drive** | Put `index.html` in a shared Google Drive folder |

---

## Deployment to GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit — Chromebook Loaner System"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/chromebook-loaner.git
git push -u origin main
```

Then in GitHub → Settings → Pages → Source: `main` branch, `/src` folder.

---

## Updating the Apps Script

After making changes to `Code.gs`:
1. Paste the updated code into the Apps Script editor
2. Go to **Deploy → Manage deployments**
3. Edit your existing deployment → Version: **New version**
4. Click **Deploy** (the URL stays the same)

---

## Notes & Tips

- **No login required** — this is intentional for quick front-desk use; data lives in the browser
- **Multiple staff** — if multiple people need shared data, use the Google Sheets as the source of truth and export/import as needed, or host on GitHub Pages with Sheets as the backend
- **Privacy** — student names and IDs are stored in browser local storage and optionally in your district's Google Sheets; treat accordingly per your district's data policy
- **Backup** — use the Export CSV button regularly, or rely on Google Sheets as the persistent record

---

*Built for Bureau Valley School District · April 2026*
