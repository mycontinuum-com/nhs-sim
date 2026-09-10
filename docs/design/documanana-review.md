# DocuMañana layout review

The supplied screenshot shows the document office embedded beneath the GP patient banner. The document header is clipped, the assignment and review forms are below a long letter, and the queue contains only one example.

## Changes

1. Give the GP building two entrances: SystemTwo for the clinical record and DocuMañana for correspondence. Launch DocuMañana at `/gp/documents/`, with its own navigation and the existing team session.
2. Use three desktop panes: searchable inbox, readable letter, and processing panel. Each pane scrolls independently so a long letter does not push review controls off the page. On narrow screens, open a letter from the queue and provide a return control.
3. Put patient identity, processing status and priority near the letter. Keep the full authorship trail behind a disclosure. Keep required review and filing steps explicit.
4. Populate existing and new worlds with 61 fictional letters across patients and specialties: 37 awaiting review, 12 reviewed, 8 filed and 4 hospital-only drafts. Preserve existing letters, changes and processing history.

## Verification targets

- Map and GP shortcuts reach the standalone office without GP menus or a patient-record sidebar.
- Search and queue filters find seeded correspondence across patients.
- Assignment, review and filing retain the original letter and team attribution.
- Desktop panes and narrow-screen navigation keep every control reachable without horizontal page overflow.
- Seed upgrades are additive and idempotent; hospital drafts do not appear in the GP inbox.
