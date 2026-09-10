# SystemTwo depth

- Ground: reproduced missing consultation editor and appointment book in the live GP workspace. Existing population is 500 but most histories are shallow.
- Design: compare generic task titles with explicit consultation/appointment records. Choose the existing action transaction and resource persistence, with consultation draft/saved states and booked/arrived/completed/cancelled appointments. This retains service ownership, versions and idempotency.
- Patient design: retain population count and deepen 32 coherent anchor lives, with additive upgrade for existing worlds.
- Blocking first steps: inspect current contracts, persistence and reproduce in UI before edits.
- Independent workstreams: population/stories and action contracts/engine each have one owner; root owns UI, server read route and migration integration.
- Shared mutable state: one Store.run queue, no second persistence system; builds run serially after workers finish.
- Smallest safe decomposition: two bounded backend owners and root integration/browser QA.
- Verify: save/reopen/edit consultation, book/view/arrive/complete/cancel appointments, reject overlaps, preserve synthetic story enrichment across restart.

Verified 10 September 2026:
- Skills validation, typecheck, 49 tests and production build pass. Docusaurus link checking caught an app-relative link; changed it to an explicit app anchor and rebuilt successfully.
- Live doctor, journey and full smoke pass, including authenticated appointment reads and consultation retrieval. PostgreSQL restart restore check passes.
- Computer use in the existing team world found Nina Brooks at SIM-000501 with three earlier contacts and her own eczema, parent-contact and after-school needs. Existing patient IDs remained available.
- Saved a draft named School support follow-up, saved it as a consultation, reloaded, searched Nina and expanded the saved entry. Full narrative and version2 were retrieved.
- Opened the practice-wide book before selecting a patient. Booked School support review at14:00 with Dr Maya Shah; verified clinician filter, arrival and completion. After app restart, the row remained completed.
- Inspected desktop appointment layout and used the narrow viewport for consultation entry. Reset the viewport and left the appointment book open.
