# World and EHR design targets

Generated with the built-in imagegen tool. The map is a production raster asset. The EHR mockups guide layout and visual identity; implementation reads simulation records instead of copying image text or invented contact details.

- `../../apps/control/public/world/neighbourhood-v2.png`: an illustrated English neighbourhood with clickable service locations implemented as accessible HTML controls.
- `systemtwo-mockup.png`: dense steelblue primary-care journal, patient banner and contextual summary.
- `millbank-mockup.png`: charcoal and plum hospital worklist with a focused discharge chart.

The published world contains two specialised tools. Community and pharmacy operate through labelled coordination views in those tools. The map disappears on entry; the return control and simulation controls remain small.

Verification must include entering each EHR from the map, selecting a patient, creating a test or handover, advancing time and observing the result. CIS2 must complete a real local authorization-code flow and expose controlled failure outcomes.

## Live review — 10 September 2026

At 1280 × 720, the map opens a place description before entering a full-width workspace. SystemTwo uses a blue journal and patient summary; Millbank uses a plum worklist and discharge chart. Neither has a global left sidebar.

Verified in the local browser:

- Created a team from the map and entered SystemTwo, then selected Amira Khan.
- Created a GP referral and found the same titled referral in Millbank's discharge chart.
- Dispensed the seeded pharmacy prescription; its state changed from approved to dispensed and exposed collection.
- Scheduled a community visit from Millbank; advancing 121 simulation minutes changed the shared visit from scheduled to completed.
- Completed the CIS2 PKCE sign-in as Dr Maya Bennett. Operator controls switched to consent denial, revoked the active token, and returned `access_denied` on the next sign-in. Restored normal mode afterwards.

The browser review caught and fixed an action schema that confused visible portals with supporting services. A regression test now covers community destinations and hospital referral visibility. Consent submission also has inline error reporting and an explicit redirect response, while retaining native form support.

CIS2 identities and settings are process-local. These checks do not establish production NHS conformance or concurrent hackathon load capacity.
