# InaccuRx and patient Messages

InaccuRx is a fictional practice messaging office. Clicking the GP building offers SystemTwo, DocuMañana and InaccuRx. It does not add another map location. Clicking the home offers Witherings and Messages; both apps retain the selected resident when moving between them.

The practice has an inbox, completed conversations, editable templates, patient search, assignment and private internal notes. Outgoing SMS and email stay within the simulation. Delivery controls support queued, failed, retried and delivered messages. Patients see delivered messages and can reply when the practice permits it. Patient responses and delivery changes preserve the conversation history.

The patient projection excludes internal notes, staff assignment and undelivered messages. Patient replies identify the selected patient and require a matching conversation. Generic resource mutations cannot bypass the messaging commands.

## Design choice

Reuse the standalone DocuMañana route pattern rather than add a new service or a panel inside the EHR. A mint and navy inbox and conversation layout distinguishes the practice app from SystemTwo. The patient app uses an iPhone Messages-inspired layout: a separate conversation list, grey received bubbles, blue sent bubbles, a compact reply bar, and a back-to-inbox action on narrow screens. Patient selection is disclosed from the top bar. The fictional bird-and-envelope mark was generated with built-in imagegen; its prompt and saved paths are in `inaccurx-logo.json`.

Accurx's public [inbox guide](https://support.accurx.com/en/articles/768591-accurx-desktop-inbox-how-to-navigate-the-new-look-inbox) and [patient messaging guide](https://support.accurx.com/en/articles/768503-accurx-web-how-to-send-a-message-to-a-patient) informed the familiar conversation, template and completed-queue workflow. This implementation uses its own branding and simulation behaviour.

## Work ownership

- Blocking steps: inspect existing authenticated routes, preserve team-world isolation, and wait for concurrent pharmacy changes to release shared bridge files.
- Independent work: one implementation owner builds the coupled messaging contract, engine, UI and tests; the root owns product assets, map and home navigation, integration review and browser verification.
- Shared state: separate new messaging modules from existing document and pharmacy modules. Apply narrow bridge patches only after the current owner releases them. Serialize Compose restarts and git publication.
- Smallest decomposition: one owner keeps the conversation lifecycle and patient projection consistent across backend and UI. Verification covers the patient–practice round trip, failed delivery and retry, private-note exclusion, stale writes, persistence and patient/world isolation.

## Verification

Local browser QA on 10 September 2026 created a practice message for Eleanor Chen, delivered it, replied through her Messages app, and confirmed the reply in the practice inbox after navigation. A saved practice template populated the new-message composer. Switching to Amira Khan replaced Eleanor's conversations and preserved Amira in the Home & health link.

The running PostgreSQL API journey exercised queued → failed → retried → delivered, patient reply, assignment, completion/reopening, and exclusion of private notes and other patients' conversations. Smoke and the standard delayed-result journey passed. The messaging Engine tests cover stale versions, identity, world isolation, templates and idempotent seeding.

The revised patient app passed browser QA at 390 × 844: conversation-list navigation, blue/grey message bubbles, send-arrow reply submission, back navigation, and a composer positioned above the measured simulator footer. No page-width overflow was visible. Practice UI and API workflows remain separate from this patient presentation.
