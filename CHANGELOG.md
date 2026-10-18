# Changelog

## 0.5.0 (2026-10-18)

**Printing**
- The pack is print-friendly: black text and thin lines on white, light grey table headings, no dark or coloured blocks. The cover no longer has a coloured band.
- Colour is kept only for the document references, so they are easy to find: **01-R** receipt (orange), **01-E** e-invoice (blue), **01-S** other support (green) — in the app, on every attached page, in the index and the appendix.
- The cover's *Prepared … with ClaimPack* line is at the bottom right, with an optional small QR code to the app (*Receipt layout → Cover page*).

**Summary**
- No signature block on the summary (it is generated). Sign the claim form after printing. The declaration now says so.

**Appendix A — original receipts**
- New last section (on by default): a cover sheet listing every receipt and other support with its reference, date, merchant, amount, the page of its copy, and a tick box. Staple the originals behind it. The index and cover point to it.

**Receipt photos**
- **Scan receipt** (and each **Camera** button) opens a scanner: live camera finds the receipt, drag the four corners, straighten, choose B&W / Grey / Colour / Original, rotate. Without a live camera the phone's camera app is used.
- **Crop** on an attached photo straightens and cleans it later.
- Photos keep their own length: each goes into the shortest column (2 or 3 columns, or one per page), so short and long receipts share the page sensibly.

**Computer**
- Drag and drop: drop files on the page for new items, on an item to attach them, or on its Receipt / E-invoice / Other box.

**Other**
- **Send feedback** on WhatsApp (Help, Setup, and the bottom of the page) with the app version and device filled in.
- The claim form's note line names the usual checker by default (change in Setup).
- Licence: `LICENSE.md` now says the claim form's layout and wording are not covered by the app's licence; new `THIRD-PARTY-NOTICES.md` lists the libraries and fonts and their licences.
- *Read* (was *Scan*) suggests values from a document, to tell it apart from the scanner.
- Website theme for GitHub Pages: the README, guide, changelog and roadmap become pages in the app's look (navy bar, orange accent), with an *Open the app* button, a contents sidebar on the guide, and light / dark mode. The app's Help links open these pages.

## 0.4.0 (2026-10-18)

**Claim form**
- Redrawn from the original form's own measurements — lines, boxes, tick boxes and icons — with matching fonts, so the printed page looks like the original form rather than a scanned copy.
- Fills itself from the claim items: each claim type goes to its line (fuel 1a, car wash 1b, maintenance 1c, parking / toll 1d, other transport 1e, medical 2, telecommunication 3, utilities 4, misc. 5a–5c by description, outstation 6a–6c by trip and column). Amount and Total columns are filled as on the original. *Key in myself* switches to manual figures.
- Name with project code, month and year in capitals; vehicle and Own / Company tick; Submitted by and date (optional); the note line's checker is set in Setup.
- Outstation trips: claimable, travel date, travel by (air / land / others), from / to, job no., type of meeting; the new **Fares** column. **Preview the form** shows the page in the sheet.

**Several claim types in one submission**
- Pick any number of claim types; each item has its own type. A *New item type* switch picks the type for the next item.

**Fuel**
- Amount = litres × price per litre, worked out as you type. A typed amount is kept and a note shows if it differs; *Fill litres* works litres out from the amount and price.

**Cover, summary and index**
- New cover: month, claimant, total, items, documents, claim details and contents with page numbers.
- Summary: claim details, numbered item table, breakdown by claim type, fuel statistics, fuel allowance comparison (cap and subsidised price), remarks, declaration, signature block — each switched on or off in **Summary contents**, and the item table's columns too.
- Supporting document index with every document's reference and pages. Every page except the claim form has a footer with *Page x of y*.

**Receipts and documents**
- Items are numbered by date (01, 02 …); documents are referenced 01-R (receipt), 01-E (e-invoice), 01-S (other support — new third attachment).
- Every attached page is marked with its reference, date, merchant and amount, and says where its partner documents are (e.g. *With 01-E (p.11)*).
- **Receipt layout**: receipts first then e-invoices, or item by item; 1, 2, 4 or 6 photos per page. Photos are reduced to print quality, so the PDF stays small enough for WhatsApp and e-mail.

**Easier to use**
- Item cards fold up to one line (number, merchant, amount, status); a new item opens on its own. *Duplicate*, *View* and *Remove attachment* on each item.
- Warnings: receipts outside the claim month, duplicate invoice numbers, amount ≠ quantity × price, claim form total ≠ items, outstation items without trip details.
- **Next month's claim** in Records copies your details and claim types.
- PDF preview with jump buttons for each section; file size shown.
- **Share this app**: QR code and link (Help, Setup or the bottom of the page). Developer credit *WPN* in the app and the PDF.

**Fixes**
- The claim month no longer jumps to the previous month between midnight and 8 a.m. (time-zone bug).
- Editing an item no longer redraws the card under your finger, which could lose typing.
- Updates arrive straight away: the app page is fetched fresh when online, and *Update now* clears the old cache.
- Backups are about a third the size (base64 instead of number lists) and ask before replacing the claims on the phone. Older backups still restore.
- Claims from v0.3 and earlier are converted automatically.

## 0.3.0 (2026-10-18)
- Claim form as a native in-app form for every claim type, optional cover page, CSV export, batch import, optional Gemini AI scanning, Appearance setting.

## 0.2.0 (2026-10-18)
- Rebuilt on the timesheet app's design: top bar, Records, Help, Setup, flow steps, dock, camera capture, document index, multi-claim backup.

## 0.1.3 (earlier)
- First prototype for fuel claims.
