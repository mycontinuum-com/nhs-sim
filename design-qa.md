# Pharmacy procurement design QA

Source visual truth: `docs/design/pharmacy-purchasing/option-1.png`.
Selected option: 1.
Implementation: `https://sim.animahacks.com/pharmacy/`, Stock & buying, release `bc6ed92`.
Target viewport: 1487 × 1058 CSS pixels. The implementation capture is 1487 × 1058 JPEG at the browser's default density. The source is 1487 × 1058 PNG. No density conversion was needed.
State: Atorvastatin 20mg, 112 required units, Northstar offer selected, saved basket.

## Findings and resolution

- Inventory editing opens an immediately focused dialog. Verified in the live browser.
- Stock activity sorts by recorded time and includes reconstructed opening balances.
- Selecting Eleanor in Patient care leaves all 30 stock movements and the saved basket available in Stock & buying. There are no patient controls in procurement.
- At 390 × 844, the basket ends at y=762.5 and the footer begins at y=767.5. Document scroll width equals viewport width, 390 pixels.
- [P2, resolved] At 390 pixels, the basket quantity field shrank enough to hide its value. The basket table now retains an 800-pixel minimum width inside its scrolling container and the quantity label retains 96 pixels. `mobile-basket-fixed.jpg` verifies the visible value. Changing four packs to five updated the basket total from £4.16 to £5.20. Document width remained 390 pixels.

## Intentional corrections to the generated mockup

The implementation uses the existing pharmacy brand asset under the new NoobScript name and tagline. Supplier delivery dates come from simulation time. Generated weekday errors and unsupported tax labels are removed. Offer rows show the actual minimum order, excess units and price per unit. Decorative icons are omitted where no source asset exists.

## Comparison evidence

The source and `docs/design/pharmacy-purchasing/live-desktop.jpg` were opened together in the same comparison input at 1487 × 1058 pixels. This is the post-fix capture. `implementation-2.jpg` is the earlier capture with small type and a low-contrast selected tab; it is not the final evidence. The final design has the source's cream canvas, two-area switch, centred buying navigation, supplier comparison, persistent basket and fixed simulation footer. The dark green header uses the existing pharmacy brand treatment, intentionally retained rather than copying the mockup's invented wordmark.

The supplier table and basket strip are readable in the full-resolution desktop comparison, so separate crops were unnecessary. Mobile evidence is in `live-mobile.jpg` and `live-mobile-basket.jpg`, both 390 × 844. The latter records the quantity-field finding before its fix. It was compared in the same input with `mobile-basket-fixed.jpg`, captured at the same viewport and state on the rebuilt local app. The local app also contains the next release's Desktop footer link; that is an intentional unrelated addition.

## Required fidelity surfaces

- Typography: Georgia headings and Arial controls retained; table body increased to 15 pixels, key figures to 17 pixels and secondary values to 13 pixels. Labels and values are legible in the desktop capture.
- Spacing: full-width comparison with three distinct supplier rows; both purchase action and basket remain above the footer at the reference viewport. Mobile tables scroll inside their own container.
- Colors: cream canvas, green selected offer and dark green actions. Selected navigation remains readable on hover after the specificity fix.
- Assets: the existing raster prescription mark remains sharp and correctly proportioned. No invented replacement artwork was added. The requested NoobScript name replaces ProScrip-ish.
- Copy: real simulation-derived dates and costs replace the mockup's incorrect dates and tax assumptions. Offers are sorted by total for the requested quantity; catalogue headlines compare unit prices.

## Scope

Team basket, catalogue comparison, linked supplier orders, partial receipts, cancellation of outstanding packs, global inventory/activity, and costs/contribution. The simulator does not model reservations, batches, expiry, tax, overheads or an autonomous ordering optimizer.

## Comparison history

The first pass (`implementation-2.jpg`) found low-contrast selected navigation and small table text. The live desktop capture verifies dark green selected controls, larger type, centred navigation and readable supplier labels. The mobile pass found the compressed basket quantity field described above; the final comparison verifies the readable 96-pixel field. No browser console errors were recorded during the live pass. No actionable P0/P1/P2 findings remain.

The live API acceptance journey passed catalogue/quote discovery, patient-free basket persistence, minimum orders, idempotent checkout and receipt, partial delivery, cancellation, ledger reconciliation and team isolation. The earlier local browser journey also completed ordering, four-day time advancement, partial receipt and cancellation.

final result: passed
