# snap-collect-kb — Claude Instructions

## Before Making Any Changes

**Always clarify and plan before touching any file.**

1. **Interview first** — ask questions until the requirement is unambiguous:
   - What exactly should change? (be specific about field, tab, behavior)
   - What should it look like after? (expected result)
   - Are there edge cases or exceptions?
   - Does this affect the auto-sync pipeline or watcher?

2. **Propose a plan** — list every file that will change and exactly what will change in each one. Get explicit approval before proceeding.

3. **Never assume** — if the request is vague ("fix the search", "update the data"), ask what specifically is wrong or what the desired outcome is.

---

## Project Overview

Static web knowledge base for ONESIAM Snap&Collect receipt-scanning loyalty program.
Staff use it to look up store receipt formats and special rejection cases.

**Stack:** Plain HTML/CSS/JS — no framework, no build step. Fuse.js (CDN) for fuzzy search.

**Key files:**

| File | Purpose |
|------|---------|
| `index.html` | Entire frontend — all HTML, CSS, JS in one file |
| `snap-collect-data.json` | Data file loaded by the browser at page load |
| `extract_data.py` | Reads master Excel → regenerates JSON |
| `snap_watcher.py` | Background service — detects Excel changes → auto push |

---

## Data Flow (Auto-Sync Pipeline)

```
Admin edits Excel on SharePoint
    ↓ OneDrive syncs to local PC (~1-5 min)
snap_watcher.py detects file change (on_modified / on_created / on_moved)
    ↓ waits 30s for sync to finish
extract_data.py reads Excel → writes snap-collect-data.json
    ↓ git add + commit + push
Vercel deploys automatically (~30s)
    ↓
Web reflects new data
```

**Master Excel path (local):**
`D:\SPWG\Contact Center Onesiam - General\รวมข้อมูลการสะสมใบเสร็จ Snap&Collect.xlsx`

**SharePoint source:**
`siampiwat1.sharepoint.com/sites/ContactCenterOnesiam` (doc ID: 4100ce07-c4da-494a-8770-767e59b975d9)

---

## extract_data.py — Critical Rules

- **Never hardcode Thai sheet names** — use English keyword lookup via `find_sheet("Y2026")` / `find_sheet("Reject")` to avoid subprocess encoding issues
- Sheet lookup uses `wb.worksheets[0]` for name_map (first sheet, optional)
- Always set `sys.stdout.reconfigure(encoding="utf-8")` at top
- Output must use `ensure_ascii=False` to preserve Thai characters

---

## index.html — Critical Rules

- Do NOT add frameworks, bundlers, or npm dependencies — keep it plain static
- Fuse.js threshold is `0.35` for stores, `0.4` for rejects — adjust carefully, too low = misses results, too high = too many false positives
- Two tabs: **Format ใบเสร็จ** (stores) and **Reject พิเศษ** (reject cases)
- Category color classes: `cat-spending`, `cat-join`, `cat-closed`, `cat-external`, `cat-popup`, `cat-another`, `cat-tna`, `cat-other`

---

## snap_watcher.py — Critical Rules

- Must listen to `on_modified`, `on_created`, AND `on_moved` — OneDrive uses all three
- Debounce: 60 seconds between triggers
- Sync wait: 30 seconds after detection before extracting
- Registered in Windows Task Scheduler as "SnapCollect Excel Watcher" (runs at logon)
- Git binary: `C:\Users\Achirayas\AppData\Local\Programs\Git\cmd\git.exe`
- Python binary: `sys.executable`

---

## GitHub & Deployment

- **Repo:** https://github.com/singpringachiraya-gif/snap-collect-kb
- **Branch:** `main` — Vercel deploys on every push
- **Vercel project:** biblesnap1
- Do NOT commit `*.xlsx` files (covered by `.gitignore`)
- After manual pushes, pull before pushing if watcher may have auto-committed in between
