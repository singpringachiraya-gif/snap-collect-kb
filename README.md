# Snap&Collect Knowledge Base — Handoff Notes

## What this is

A searchable/filterable web knowledge base for the ONESIAM "Snap & Collect"
receipt-scanning loyalty program. Operations staff (back-office, desktop)
need to look up, per store, what receipt field to key in and what notes/
exceptions apply when approving a customer's submitted receipt for points.

Source data is a master Excel workbook maintained by an admin
(`รวมข้อมูลการสะสมใบเสร็จ Snap&Collect.xlsx`), which has several sheets —
most are old/working sheets, but two are the ones that matter:

- **อัพเดท Y2026** — the current master store list: store name, which
  receipt field to use, format notes, and category
  (`Spending Only` / `JoinONESIAMCoin` / `Luxury` / `ShopClosed` / etc.)
- **ข้อมูล - ร้านค้าออกในนามบริษัท** — a secondary lookup mapping the legal
  entity name printed on a receipt header to the actual storefront/brand
  name used in the CRM portal (e.g. "คอมเซเว่น" → "Banana ICON Fl. 4")

## What's built (this folder)

| File | What it is |
|---|---|
| `index.html` | Standalone static site — search box, category filter chips, two tabs (store rules / name mapping). No build step, no framework. Uses [Fuse.js](https://www.fusejs.io/) (loaded from CDN) for fuzzy, typo-tolerant search across Thai + English text. |
| `snap-collect-data.json` | The data the site reads, extracted from the master workbook. Loaded via `fetch()` at page load. |
| `extract_data.py` | Regenerates `snap-collect-data.json` from a fresh copy of the master `.xlsx`. Run this any time the admin sends an updated file. |

### How to run it locally

Browsers block local `fetch()` over `file://`, so it needs a tiny HTTP server:

```
cd snap-collect-kb
python -m http.server 8000
```

Then open `http://localhost:8000/index.html`.

### How to refresh the data

1. Drop the latest master `.xlsx` into this folder (same filename, or update
   `SRC` at the top of `extract_data.py`).
2. `pip install openpyxl` (one-time)
3. `python extract_data.py`
4. Reload the page (or redeploy, if hosted).

This was built and tested (headless Playwright — search, category filters,
both tabs all confirmed working with no console errors) as a prototype.
It has **not** been deployed anywhere live yet.

## What's NOT done yet — open decisions for whoever continues this

1. **Where the live master file lives.** Still undecided between:
   - Keep it on SharePoint/OneDrive Excel (where it already lives today,
     per links in the workbook's "ETC" sheet) — but pulling data from
     SharePoint programmatically needs an Azure AD app registration, which
     may need IT/admin approval depending on the tenant.
   - Move it to Google Sheets — much lighter to integrate: a sheet can be
     "published to web" as a public CSV URL with zero auth, or read via
     the Sheets API with a service account if it needs to stay private.
   This decision determines how "auto-update" gets built in step 2 below.

2. **Live data sync (no manual redeploy).** Right now, refreshing data means
   re-running `extract_data.py` and redeploying by hand. The better version:
   a small serverless function (or scheduled job) that pulls the published
   sheet on each page load or on a schedule, so admin edits show up on the
   site automatically. This is the natural next step once (1) is decided.

3. **Hosting/deployment.** Intended to deploy as a static site on Vercel
   (`npx vercel` from this folder — no build config needed, it's plain
   static files). Not yet deployed. Public access is fine (no auth wall
   needed) — confirmed there's no need to gate this behind a login, though
   the receipt-validation rules and a small "blocked stores" list inside
   the source workbook are mildly internal, so don't index it on search
   engines (a `robots.txt` disallow-all would be a cheap safeguard).

4. **Two source sheets weren't carried over as live tools:** the workbook
   has two "live search" helper sheets (น้องอื่นๆ, ห้ามเข้า) that use
   spreadsheet formulas to do lookups — those aren't data, they're the
   old version of what this website now replaces. No need to migrate them;
   the website's search/filter is the replacement.

## Quick architecture summary for an AI assistant picking this up

- It's intentionally framework-free: one HTML file, one JSON file, no
  build step. Keep it that way unless there's a strong reason to add
  tooling (e.g. needing server-side rendering for SEO, which isn't a goal
  here since this is an internal ops tool).
- `Fuse.js` keys currently searched: `name`, `receipt_format`, `notes` for
  the store-rules tab; `header_name`, `portal_name` for the mapping tab.
  Adjust `threshold` in the `Fuse()` constructors in `index.html` if search
  feels too loose/strict.
- Categories are derived dynamically from whatever values exist in the
  data (`DATA.categories` in the JSON) — no hardcoded category list, so
  new categories the admin adds will just show up as new filter chips.
