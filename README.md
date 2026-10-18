# ClaimPack · Monthly Claims

**Turn a month of receipts into one tidy claim submission — on your phone, in about ten minutes.**

ClaimPack is a free web app for site and office staff who claim fuel, parking, phone bills, outstation trips and other expenses every month. You key in each receipt once (or snap it with the camera), attach the receipt and its e-invoice, and the app builds a single PDF ready to print or send:

| Page | What it is |
|---|---|
| **Cover** | Month, claimant, total claimed, number of items and documents, and a contents list with page numbers |
| **Claim form** | The monthly claim form, printed like the original and **filled in for you** — every item lands on the right line (fuel → 1a, parking / toll → 1d, telecommunication → 3, outstation → 6a–6c …) |
| **Claim summary** | A numbered table of every item, a breakdown by claim type, fuel statistics and an optional comparison with your monthly fuel cap — you choose what to show |
| **Document index** | Every receipt, e-invoice and supporting document with its reference and page number |
| **Supporting documents** | Receipt copies tiled at their own length, e-invoices one to a page; each one marked with a colour-coded reference — **01-R** receipt (orange), **01-E** e-invoice (blue), **01-S** other (green) — and pointing to its partner documents |
| **Appendix A** | A cover sheet at the end: staple the original receipts behind it and tick each one off |

<p><img src="guide/02_fuel_item.png" alt="A fuel item: litres × price works out the amount; receipt 01-R and e-invoice 01-E attached" width="230">&nbsp;<img src="guide/pack_2_form.png" alt="The claim form, filled in from the items" width="280">&nbsp;<img src="guide/pack_6_receipts.png" alt="Scanned receipts, each with its colour-coded reference" width="280"></p>

The pack is designed for printing: black on white, thin lines, no large coloured areas — colour is used only for the small document references.

## Why use it

- **No retyping.** Enter each receipt once; the summary, the form and the index all come from the same entries.
- **Fewer mistakes.** Litres × price fills in the fuel amount. The app warns about receipts dated outside the claim month, duplicate invoice numbers, amounts that don't match quantity × price, and a form total that doesn't match the items.
- **Easy to check.** The person checking your claim can find any receipt from the index, and every page says which item it belongs to.
- **Clean receipt copies.** The built-in scanner finds the receipt, lets you drag the corners, straightens it and turns it into a crisp black-and-white copy. Long and short receipts keep their own length on the page.
- **Fast on a computer too.** Drag photos and PDFs onto the page — onto an item to attach them, anywhere else to add new items.
- **Several claim types in one go.** Fuel, parking / toll, car wash, maintenance, other transport, medical, telecommunication, utilities, misc. expenses and outstation travel.
- **Private.** No login, no server. Claims and photos stay in the phone's browser until you share the PDF. Works offline once opened.

## Open the app

Open the link on your phone and add it to the home screen (iPhone: Share → *Add to Home Screen*; Android: ⋮ → *Install app*). A colleague can scan the QR code from **Help → Share this app** — or the small QR at the bottom of any ClaimPack cover page.

To host your own copy, put this folder on GitHub Pages (or any HTTPS host) — there is nothing to build.

**User guide:** [GUIDE.md](GUIDE.md) — every screen, with pictures.

## What's in this folder

| | |
|---|---|
| `index.html`, `app.js`, `scanner.js` | The app (scanner: crop, straighten and clean receipt photos) |
| `fonts/` | Form fonts (TeX Gyre Adventor and Pagella, close matches of the original form's typefaces) so the claim form prints like the original |
| `lib/` | PDF, OCR and QR libraries, kept locally so the app works offline |
| `sw.js`, `manifest.webmanifest`, `version.json`, `icon.svg` | Offline support, home-screen install and the "new version" notice |
| `guide/`, `GUIDE.md` | User guide and its screenshots |
| `_config.yml`, `_layouts/`, `_includes/`, `assets/` | The website theme: GitHub Pages turns this README, the guide and the changelog into pages styled like the app |
| `samples/` | Made-up receipts, e-invoices and bills to try the app with |
| `tools/` | Scripts that make the samples and the guide screenshots |

## Good to know

- ClaimPack prepares the claim; it does not submit it or decide what is claimable. Follow your company's claim policy and hand in the originals it asks for.
- Back up from **Setup → Backup** before clearing the browser or changing phones.
- Scan text (OCR) and the optional Gemini AI scan only *suggest* values — always check them against the document.

Problems or ideas: **Help → Send feedback** (WhatsApp).

Developed by **WPN** · see [LICENSE.md](LICENSE.md) · [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) · [CHANGELOG.md](CHANGELOG.md) · [ROADMAP.md](ROADMAP.md)
