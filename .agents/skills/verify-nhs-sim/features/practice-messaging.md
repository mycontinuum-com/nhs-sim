# Practice and patient messaging

Open the GP building, then InaccuRx. It is an app inside the practice launcher, not a separate map location. Home offers Messages and Witherings.

## Browser proof

1. Connect a synthetic team and open `/gp/messages/`.
2. Create a message for a selected patient. Confirm it is queued and attributed to the team.
3. Open Delivery simulator, fail the message, retry, then deliver. Check the preserved delivery history.
4. Open that patient's Messages app. Reply and return to the practice inbox; confirm the reply appears after reload.
5. Add an internal note. Confirm it is absent from the patient app.
6. Save a template and apply it to a new editable message.
7. Switch patients in Messages; confirm conversations and the Health link follow the selected patient.
8. At a narrow viewport, open a conversation from the inbox and return with Back to messages. Confirm the reply bar remains reachable above the simulator controls.

## API proof

Use the team key only in the Authorization header. Read `/api/sites/gp/messaging-workspace` or `/api/sites/patient/messaging-workspace?patientId=SIM-000006`. Commands use the existing actions endpoint with `type: messaging_action`; see the handbook's messaging contract. Mutations of existing conversations require `expectedVersion`.

Check stale writes, cross-world isolation, mismatched patient replies, completed or one-way conversations, and redaction of internal notes and undelivered entries. `tests/messaging.test.ts` exercises these Engine boundaries and idempotent seeding. The API and UI never contact external SMS or email providers.
