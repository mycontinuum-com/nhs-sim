# World and EHR design targets

Generated with the built-in imagegen tool. The map is a production raster asset. The EHR mockups guide layout and visual identity; implementation reads simulation records instead of copying image text or invented contact details.

- `../../apps/control/public/world/neighbourhood-v2.png`: an illustrated English neighbourhood with clickable service locations implemented as accessible HTML controls.
- `systemtwo-mockup.png`: dense steelblue primary-care journal, patient banner and contextual summary.
- `millbank-mockup.png`: charcoal and plum hospital worklist with a focused discharge chart.

The published world contains two EHRs plus dedicated pharmacy, community and consumer home workspaces. Shared coordination views remain inside the EHRs. The map disappears on entry; the return control and simulation controls remain small.

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


## Participant experience review

The next pass adds separate settings with shared simulation data:

- High Street Pharmacy uses a green dispensing bench, a prescription queue and explicit review, approval, dispensing and collection steps.
- Neighbourhood Care uses a warm visit ledger and incoming support-plan cards. A handover can open a visit draft for its patient.
- Daylight at home uses a consumer dashboard with stored activity, heart-rate and sleep observations, period controls, devices and expandable reading history.

Computer-use checks passed for fresh team creation, pharmacy approved-to-collected, community scheduled-to-completed after advancing 121 minutes, and a new home activity reading after advancing another hour. The 390px home view stacks charts without horizontal page overflow. Team dialogs now accept Escape, move focus inside and return it to the opener. A phone map explains panning and offers a Places menu.

The home seed is authored fictional data. It adds seven historical daily samples per metric for Eleanor; the existing home monitor produces subsequent activity observations. Older team worlds retain their old seed and key scopes. Create a new team for the complete expanded scenario.

The narrow-screen review also found map labels covering the Places menu. The footer now has an explicit stacking order. The community handover review found that changing patients could remount the workspace and discard its draft; patient queries now retain the previous view while loading, and new visit drafts receive focus.
