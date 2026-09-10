# Ten-year plan functionality

1. Ground: the 2025 ten-year plan for England names hospital to community, analogue to digital, and sickness to prevention. Read the official executive summary and trace current resources/actions, visibility, clock and persistence.
2. Sketch: compare a passive policy checklist with interactive persisted challenges. Choose challenges because a participant can make a decision, hit a constraint and show the receiving record.
3. Implement: engine owner handles additive challenge records and action validation; root handles authenticated routes, UI and source-grounded guidance.
4. Verify: tests prove prerequisites, revocation, offline outreach and capacity. Computer use proves initiation and feedback. Run normal project checks and live smoke.

Throughput checkpoint:
- Blocking: inspect policy/source and current action ownership before implementation.
- Independent workstreams: new engine module/tests separate from root server/UI/docs edits.
- Shared state: root alone integrates routes; one build at a time. Every mutation uses Store.run.
- Smallest safe decomposition: one backend owner plus root integration/QA, no new containers or public ports.

AWS deployment remains unapproved. Do not provision, enable deployment, or publish DNS during this task.

Verified 10 September 2026:
- Skills validation, typecheck, all 40 tests and production build pass. Compose rebuilt successfully.
- Live doctor reports PostgreSQL, 6 sites and 12 adapters. Journey produced an available diagnostics result; full smoke passed, including ordinary community-view visibility before and after sharing withdrawal.
- Computer use: premature readiness was rejected; all four handover prerequisites completed. The sharing document opened in the community inbox after permission and disappeared after withdrawal. The withdrawn state survived the local container rebuild.
- Computer use: app outreach reached 1/3, phone 2/3, letters 3/3. Two bookings exhausted the round. Aisha's completed review incremented attendance without opening a third place; Sofia's booking remained blocked with an explanation.
- Inspected narrow and desktop layouts; fixed a global hover rule overriding dark action buttons. Opened the Docusaurus guide and inspected generated API examples.
- Local writes can take several seconds while the shared PostgreSQL snapshot is persisted, especially during concurrent smoke/build activity. The UI disables actions and shows pending feedback during the write. This pass is functional verification, not a hackathon load test.
