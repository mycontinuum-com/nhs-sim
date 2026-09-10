# Pharmacy procurement design QA

Source visual truth: `docs/design/pharmacy-purchasing/option-1.png`.
Selected option: 1.
Implementation: `http://localhost:8080/pharmacy/`, Stock & buying.
Target viewport: 1487 × 1058 CSS pixels. The implementation capture is 1487 × 1058 JPEG at the browser's default density. The source is 1487 × 1058 PNG. No density conversion was needed.
State: Atorvastatin 20mg, 112 required units, Northstar offer selected, saved basket.

## Findings under verification

- Inventory price and reorder editors must open beside the selected product, not below the whole catalogue.
- Stock activity must sort by recorded time, including reconstructed opening balances.
- Procurement must remain independent of patient selection.
- The basket must stay above the measured simulation footer at desktop and narrow widths.

## Intentional corrections to the generated mockup

The implementation uses the existing pharmacy brand asset under the new NoobScript name and tagline. Supplier delivery dates come from simulation time. Generated weekday errors and unsupported tax labels are removed. Offer rows show the actual minimum order, excess units and price per unit. Decorative icons are omitted where no source asset exists.

## Comparison evidence

The source and implementation were opened together and compared at the same 1487 × 1058 viewport. The implementation preserves the source's cream canvas, green brand header, two-area Patient care / Stock & buying switch, centred buying navigation, comparison table, persistent basket strip and fixed simulation footer. A second browser pass verified the basket after reload, checkout, delivery timing, partial receipt and cancellation. The final capture is `docs/design/pharmacy-purchasing/implementation-2.jpg`; the corrected typography and interaction pass was also built and loaded into the local container.

Focused evidence covered the supplier table and basket strip. The table shows pack size, pack price, unit price, minimum quantity, excess units, delivery date and total. The basket remains above the measured footer. The source's generated capsule and unsupported tax copy were intentionally omitted in favour of the existing brand asset and simulation-derived values.

## Required fidelity surfaces

Fonts and typography, spacing and layout rhythm, colors and tokens, image quality and asset fidelity, and app copy will be evaluated against the combined images.

## Scope

Team basket, catalogue comparison, linked supplier orders, partial receipts, cancellation of outstanding packs, global inventory/activity, and costs/contribution. The simulator does not model reservations, batches, expiry, tax, overheads or an autonomous ordering optimizer.

## Comparison history

The first pass found a low-contrast selected navigation state and small table text. The procurement CSS was corrected to make selected controls dark green with white text, increase table typography, centre the local navigation, and remove technical quote-version labels from user-facing supplier names. The second capture shows the corrected comparison and basket state. No P0, P1 or P2 findings remain.

final result: passed
