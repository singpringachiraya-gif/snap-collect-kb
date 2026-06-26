"""
Extracts the Snap&Collect master data from the source xlsx into clean JSON
for the searchable knowledge-base site (index.html).

Place the admin's master workbook in this same folder, then re-run:
    pip install openpyxl
    python extract_data.py
"""
import json
import openpyxl

SRC = r"รวมข้อมูลการสะสมใบเสร็จ Snap&Collect.xlsx"
OUT = r"snap-collect-data.json"

wb = openpyxl.load_workbook(SRC, data_only=True)

# --- Sheet 1: master store list (current year) ---------------------------
ws = wb["อัพเดท Y2026"]
stores = []
for row in ws.iter_rows(min_row=2, values_only=True):
    no, name, receipt_format, notes, category, extra, *_ = list(row) + [None] * 7
    if not name:
        continue
    stores.append({
        "no": no,
        "name": str(name).strip(),
        "receipt_format": str(receipt_format).strip() if receipt_format else "",
        "notes": str(notes).strip() if notes else "",
        "category": str(category).strip() if category else "",
        "extra": str(extra).strip() if extra else "",
    })

# --- Sheet 2: receipt-header-name -> CRM portal store name mapping -------
ws2 = wb["ข้อมูล - ร้านค้าออกในนามบริษัท"]
name_map = []
for row in ws2.iter_rows(min_row=2, values_only=True):
    header_name, portal_name, note, *_ = list(row) + [None] * 4
    if not header_name and not portal_name:
        continue
    name_map.append({
        "header_name": str(header_name).strip() if header_name else "",
        "portal_name": str(portal_name).strip() if portal_name else "",
        "note": str(note).strip() if note else "",
    })

categories = sorted({s["category"] for s in stores if s["category"]})

with open(OUT, "w", encoding="utf-8") as f:
    json.dump({
        "stores": stores,
        "name_map": name_map,
        "categories": categories,
    }, f, ensure_ascii=False, indent=1)

print(f"Wrote {len(stores)} stores, {len(name_map)} name-mapping rows, "
      f"{len(categories)} categories -> {OUT}")
