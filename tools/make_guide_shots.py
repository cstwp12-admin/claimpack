#!/usr/bin/env python3
"""Make the GUIDE.md screenshots (guide/*.png) from a sample claim.

The printed claim form page and the in-app form sections are blurred, and so is any text that names
the form or the person in its note line, so the public guide shows neither.

    python3 tools/make_samples.py          # sample receipts in samples/ (fictional names)
    python3 -m http.server 8765 &
    python3 tools/make_guide_shots.py

Everything in the pictures is made up: the claimant, project, merchants and amounts.
"""
import base64, subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw, ImageFont
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
S = ROOT / "samples"; OUT = ROOT / "guide"; OUT.mkdir(exist_ok=True)
TMP = Path(tempfile.mkdtemp())
URL = "http://localhost:8765/index.html"
B64 = "const buf=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=8192)s+=String.fromCharCode(...buf.subarray(i,i+8192));return btoa(s);"
HIDE = ".toast{display:none!important}.dock,.top{position:static!important}"
CUR = {"id": None}

SENSITIVE = r"admin\s*27|a27/|lily\s*lian"
RECTS_JS = """([root, extra, pat]) => {
  const re = new RegExp(pat, "i"), out = [], scope = root ? document.querySelector(root) : document.body;
  if (!scope) return out;
  const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (re.test(n.textContent)) { const r = document.createRange(); r.selectNodeContents(n.parentElement); for (const q of r.getClientRects()) out.push([q.x, q.y, q.width, q.height]); }
  document.querySelectorAll("input,select,textarea").forEach(i => { const v = i.value || (i.selectedOptions && i.selectedOptions[0] && i.selectedOptions[0].text) || i.placeholder || ""; if (re.test(v) && (!root || i.closest(root))) { const q = i.getBoundingClientRect(); out.push([q.x, q.y, q.width, q.height]); } });
  if (extra) document.querySelectorAll(extra).forEach(e => {   // clipped to the visible part of its scroll box
    let q = e.getBoundingClientRect(), x0 = q.left, y0 = q.top, x1 = q.right, y1 = q.bottom;
    for (let p = e.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY)) { const b = p.getBoundingClientRect(); x0 = Math.max(x0, b.left); y0 = Math.max(y0, b.top); x1 = Math.min(x1, b.right); y1 = Math.min(y1, b.bottom); break; } }
    if (x1 > x0 && y1 > y0) out.push([x0, y0, x1 - x0, y1 - y0]); });
  return out;
}"""

def blur_boxes(path, boxes, label=None):
    if not boxes: return
    im = Image.open(path).convert("RGB")
    for (x0, y0, x1, y1) in boxes:
        x0, y0, x1, y1 = [int(round(v)) for v in (max(0, x0), max(0, y0), min(im.width, x1), min(im.height, y1))]
        if x1 - x0 < 2 or y1 - y0 < 2: continue
        reg = im.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(max(6, (y1 - y0) // 6 if label else 8)))
        im.paste(reg, (x0, y0))
    if label:
        d = ImageDraw.Draw(im); f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", max(18, im.width // 28))
        tw = d.textlength(label, font=f); x = (im.width - tw) / 2; y = im.height * .42
        d.rounded_rectangle((x - 18, y - 12, x + tw + 18, y + f.size + 14), 10, fill=(20, 33, 43)); d.text((x, y), label, font=f, fill=(255, 255, 255))
    im.save(path)

def shrink(path, width=720):
    im = Image.open(path)
    if im.width > width: im.thumbnail((width, 6000))
    im.save(path, optimize=True); print("guide/" + path.name, im.size)

def shot(pg, name, el=None, clip=None, blur=None):
    """blur: extra CSS selector whose boxes are blurred (besides any text naming the form or the checker)."""
    path = OUT / f"{name}.png"
    rects = pg.evaluate(RECTS_JS, [None, blur, SENSITIVE])
    if el:
        box = pg.locator(el).first.bounding_box(); pg.locator(el).first.screenshot(path=str(path)); ox, oy = box["x"], box["y"]
    else:
        pg.screenshot(path=str(path), clip=clip); ox, oy = (clip["x"], clip["y"]) if clip else (0, 0)
    k = 2  # device scale factor
    blur_boxes(path, [((x - ox) * k, (y - oy) * k, (x - ox + w) * k, (y - oy + h) * k) for x, y, w, h in rects])
    shrink(path)

def card(pg): return pg.locator(f'.item[data-id="{CUR["id"]}"]')

def add(pg, typ, date, station, inv, desc, qty=None, rate=None, amount=None, files={}, col=None):
    if pg.locator("#addtype-wrap").is_visible(): pg.click(f'[data-addtype="{typ}"]')
    pg.click("#btn-add"); pg.wait_for_timeout(120)
    CUR["id"] = pg.evaluate("()=>cur().items[cur().items.length-1].id")
    c = card(pg); c.locator('[data-field="date"]').fill(date); c.locator('[data-field="date"]').dispatch_event("change")
    for f, v in [("station", station), ("invoiceNo", inv), ("desc", desc)]: card(pg).locator(f'[data-field="{f}"]').fill(v)
    if col: card(pg).locator('[data-field="osCol"]').select_option(col); pg.wait_for_timeout(120)
    if qty: card(pg).locator('[data-field="qty"]').fill(qty)
    if rate: card(pg).locator('[data-field="rate"]').fill(rate)
    if amount: card(pg).locator('[data-field="amount"]').fill(amount)
    card(pg).locator('[data-field="amount"]').dispatch_event("change")
    for kind, fn in files.items():
        if fn.endswith(".jpg") and kind == "receipt":   # photos go through the receipt scanner, as on a phone
            scan(pg, card(pg).locator(f'[data-cam="{kind}"]'), S / fn)
        else:
            card(pg).locator(f'input[data-file="{kind}"]').set_input_files(str(S / fn)); pg.wait_for_timeout(200)
    card(pg).locator("[data-confirm]").check(); pg.wait_for_timeout(100)

SCAN_SHOTS = {"done": False}
def scan(pg, button, path):
    """Camera button → (no live camera here: the photo picker) → corners → B&W → Use photo."""
    with pg.expect_file_chooser() as fc: button.click()
    fc.value.set_files(str(path)); pg.wait_for_selector("#sc-next", timeout=15000); pg.wait_for_timeout(300)
    if not SCAN_SHOTS["done"]: shot(pg, "12_scan_corners")
    pg.click("#sc-next"); pg.wait_for_selector("#sc-keep", timeout=30000); pg.wait_for_timeout(900)
    if not SCAN_SHOTS["done"]: shot(pg, "13_scan_review"); SCAN_SHOTS["done"] = True
    pg.click("#sc-keep"); pg.wait_for_timeout(500)

def pdf_words(pdf, n):
    """word boxes (points) on page n, from pdftotext -bbox"""
    xml = subprocess.run(["pdftotext", "-bbox", "-f", str(n), "-l", str(n), str(pdf), "-"], capture_output=True, text=True).stdout
    return [(float(a), float(b), float(c), float(d), w) for a, b, c, d, w in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', xml)]

def pdf_page(pdf, n, name, crop=None, blur_all=None):
    dpi = 90
    subprocess.run(["pdftoppm", "-r", str(dpi), "-png", "-f", str(n), "-l", str(n), str(pdf), str(TMP / name)], check=True)
    src = next(TMP.glob(f"{name}*.png")); p = OUT / f"{name}.png"; Image.open(src).save(p)
    k = dpi / 72
    if blur_all:
        im = Image.open(p); blur_boxes(p, [(0, 0, im.width, im.height)], label=blur_all)
    else:  # blur any word that names the form or the checker (with its neighbours on the line)
        words = pdf_words(pdf, n); boxes = []
        for i, (x0, y0, x1, y1, w) in enumerate(words):
            pair = " ".join(t[4] for t in words[i:i + 2])
            if re.search(SENSITIVE, w, re.I) or re.search(SENSITIVE, pair, re.I): boxes.append(((x0 - 2) * k, (y0 - 2) * k, (words[min(i + 1, len(words) - 1)][2] + 2) * k, (y1 + 2) * k))
        blur_boxes(p, boxes)
    if crop:
        im = Image.open(p); im.crop((0, 0, im.width, int(im.height * crop))).save(p)
    im = Image.open(p); im.save(p, optimize=True); shrink(p)

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    pg = ctx.new_page(); pg.on("dialog", lambda d: d.accept())
    pg.goto(URL); pg.evaluate("()=>{localStorage.clear();indexedDB.deleteDatabase('claimpack-local-v1')}"); pg.reload(); pg.wait_for_timeout(600)
    pg.add_style_tag(content=HIDE)
    pg.evaluate("()=>{cur().details.period='2026-09';save();render();}")
    pg.fill("#d-claimant", "Aiman Hakim bin Roslan"); pg.fill("#d-designation", "Resident Engineer")
    pg.fill("#d-project", "Coastal Road Upgrading, Package 3"); pg.fill("#d-code", "P0326")
    pg.fill("#d-vehicle", "QAA 1234"); pg.click('[data-own="Company"]'); pg.fill("#d-subdate", "2026-09-30")
    for t in ["parking", "telco", "misc", "outstation"]: pg.click(f'#seg-type [data-type="{t}"]')
    shot(pg, "01_details", "#sec-details")
    fuel = [("2026-09-02", "Sinar Fuel KM25 Jln Tuaran", "12456312", "31.779", "4.72"), ("2026-09-07", "PS Bukit Indah (Contoh Trading)", "F10272-202609-IV-dd9973", "21.413", "4.67"),
            ("2026-09-12", "Sinar Fuel KM25 Jln Tuaran", "21136520", "32.520", "4.92"), ("2026-09-16", "Sinar Fuel KM25 Jln Tuaran", "12467090", "32.520", "4.92"),
            ("2026-09-25", "Sinar Fuel KM25 Jln Tuaran", "12474515", "22.770", "5.27"), ("2026-09-30", "Sinar Fuel KM25 Jln Tuaran", "12480486", "22.140", "5.42")]
    for i, (d, s, inv, q, r) in enumerate(fuel, 1):
        add(pg, "fuel", d, s, inv, "Diesel Euro 5", q, r, files={"receipt": f"fuel_{i:02d}_receipt.jpg", "invoice": f"fuel_{i:02d}_einvoice.pdf"})
        if i == 1:
            pg.evaluate("id=>document.querySelector(`.item[data-id='${id}']`).scrollIntoView({block:'start'})", CUR["id"]); pg.evaluate("()=>window.scrollBy(0,-70)")
            shot(pg, "02_fuel_item", f'.item[data-id="{CUR["id"]}"]')
    add(pg, "parking", "2026-09-18", "Parking KK City", "7781203", "Site office carpark", amount="12.00", files={"receipt": "toll_01_receipt.jpg"})
    add(pg, "telco", "2026-09-28", "Contoh Mobile Berhad", "BILL-0926-88123", "Mobile bill, Sep 2026", amount="98.00", files={"receipt": "telco_01_bill.pdf"})
    add(pg, "misc", "2026-09-22", "Cetak Pantas Sdn Bhd", "CP-55120", "Printing of drawings", amount="45.00", files={"receipt": "misc_01_receipt.jpg"})
    add(pg, "outstation", "2026-09-24", "Hotel Teluk Contoh", "HTC-26-04471", "2 nights, coordination meeting", "2", "165.00", col="hotel",
        files={"receipt": "hotel_01_invoice.pdf", "other": "hotel_01_approval.jpg"})
    pg.evaluate("()=>{openItems.clear();renderItems();}")
    pg.locator("#h-items").scroll_into_view_if_needed(); pg.evaluate("()=>document.querySelector('#h-items').scrollIntoView({block:'start'})"); pg.evaluate("()=>window.scrollBy(0,-64)")
    shot(pg, "03_items", clip={"x": 0, "y": 56, "width": 390, "height": 700})
    shot(pg, "04_checks", "#sec-sum")
    pg.evaluate("()=>{const z=document.querySelector('#dropzone');z.hidden=false;}"); shot(pg, "14_drop"); pg.evaluate("()=>{document.querySelector('#dropzone').hidden=true}")
    shot(pg, "05_pack", "#sec-export")
    pg.click("#btn-sumopts"); pg.locator('[data-sum="cap"]').check(); pg.fill('[data-sumv="remarks"]', "All fuel was bought at unsubsidised retail pump prices."); pg.wait_for_timeout(150)
    shot(pg, "06_summary_contents"); pg.click("#sh-sumopts [data-close]")
    pg.click("#btn-attopts"); pg.wait_for_timeout(150); shot(pg, "07_receipt_layout", "#sh-attopts .box"); pg.click("#sh-attopts [data-close]")
    pg.click("#btn-a27"); pg.wait_for_timeout(200)
    pg.click('[data-osseg="0"][data-osk="claimable"][data-v="Yes"]'); pg.click('[data-osseg="0"][data-osk="travelBy"][data-v="Land"]'); pg.click('[data-osseg="0"][data-osk="meeting"][data-v="Co-ordination"]')
    pg.fill('[data-os="0"][data-osk="travelDate"]', "23-25/09/2026"); pg.fill('[data-os="0"][data-osk="fromTo"]', "Site office / Regional office, Sandakan"); pg.fill('[data-os="0"][data-osk="jobNo"]', "P0326")
    pg.evaluate("()=>document.querySelector('#a27-body').scrollTop=0"); shot(pg, "08_form_sheet", blur="#a27-body .a27sec")
    pg.evaluate("()=>{const b=document.querySelector('#a27-body');b.querySelector('details[open]').scrollIntoView({block:'start'})}"); shot(pg, "09_form_trip", blur="#a27-body .a27sec")
    pg.click("#a27-done")
    pg.click("#btn-export"); pg.wait_for_selector("#sh-pdf:not([hidden])", timeout=60000); pg.wait_for_timeout(1500)
    shot(pg, "10_pdf_preview")
    data = pg.evaluate("async()=>{const b=latestPdf;" + B64 + "}"); pdf = TMP / "pack.pdf"; pdf.write_bytes(base64.b64decode(data))
    pg.click("#sh-pdf [data-close]")
    pg.click("#btn-help"); pg.click("#btn-shareapp"); pg.wait_for_timeout(200); pg.evaluate("()=>document.querySelector('#qr-url').textContent='https://your-name.github.io/claimpack/'")
    shot(pg, "11_share_qr", "#sh-share .box")
    br.close()
def find_page(pdf, text):
    n = int(subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout.split("Pages:")[1].split()[0])
    for i in range(1, n + 1):
        if text in subprocess.run(["pdftotext", "-f", str(i), "-l", str(i), str(pdf), "-"], capture_output=True, text=True).stdout: return i, n
    return n, n
einv, total = find_page(pdf, "E-INVOICE")
for n, name, crop, blur in [(1, "pack_1_cover", None, None), (2, "pack_2_form", None, "Claim form — blurred in this guide"), (3, "pack_3_summary", None, None), (4, "pack_4_summary_fuel", .72, None), (5, "pack_5_index", .62, None), (6, "pack_6_receipts", None, None), (einv, "pack_7_einvoice", .45, None), (total, "pack_8_appendix", .62, None)]:
    pdf_page(pdf, n, name, crop, blur)
(OUT / "pack.pdf").unlink(missing_ok=True)
import shutil; shutil.copy(pdf, ROOT / "tools" / "_last_sample_pack.pdf")
