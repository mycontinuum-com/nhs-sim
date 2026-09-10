---
title: API reference
---

# Local API contracts

These are implemented **simulation contracts**, not assertions of NHS wire compatibility. Authentication headers, paths, FHIR profiles, mandatory identifiers, error payloads and signatures differ from production NHS APIs. Every FHIR-shaped resource is tagged as a simplified mock.

## Workplaces and supporting services

`GET /api/catalogue` lists the published workplaces and adapters. `/control/` is the map, `/gp/` is SystemTwo, and `/hospital/` is Millenni-ish EPR. API service IDs are `gp`, `hospital`, `community`, `pharmacy`, `diagnostics`, `referrals`, and `wearables`. Dedicated supporting workplaces are `/pharmacy/`, `/community/`, and `/wearables/`. `/browser/legacy` remains an HTML integration exercise.

## Stable team contract

Public POST /api/keys:

```json
{ "teamName": "Example builders", "site": "gp" }
```

Omit site to request all API-enabled services. Response contains apiKey, team, world, scopes. Repeated issuance creates another world, even for the same team name; retain and reuse the original key. No name-based world takeover.

All clinical API calls require Authorization: Bearer sim_.... A key's world is immutable. Operator calls can select ?world=team-... with the separately configured operator token.

GET /api/sites/{site}/view returns:

```json
{
  "id": "team-example",
  "now": 1789200000000,
  "speed": 60,
  "paused": true,
  "population": 500,
  "resources": [],
  "events": [],
  "counters": { "actions": 0, "completed": 0, "rejected": 0, "reviewMinutes": 0 },
  "staffing": { "doctors": 4, "nurses": 4, "staffedSpaces": 8, "waiting": 2 }
}
```

View is a bounded simulation projection, not a full EPR API. Resources contain id, patientId, kind, title, status, owner, visibleTo, priority, createdAt, dueAt, data and version. Resources do not reveal hidden scheduled events.

GET /api/sites/{site}/patients?q=...&offset=0 returns items and total. 30 items per page. All synthetic demographics in the team's world are discoverable.

POST /api/sites/{site}/actions supports:

| Action                              | Required input               | Effect                                                                                                                |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| connect_device                      | patientId, through wearables | Connect a synthetic activity watch; first reading after 10 simulation minutes, then hourly. Reuses an existing watch. |
| create_task                         | patientId, optional title    | New owning-service work item                                                                                          |
| create_referral                     | patientId                    | New referral visible to sender and referral service                                                                   |
| order_test                          | patientId                    | Reserve diagnostics slot; result due in 120 simulation minutes                                                        |
| draft_prescription                  | patientId                    | Draft pharmacy prescription, not automatically approved                                                               |
| book_appointment                    | patientId, optional target   | Reserve service capacity                                                                                              |
| schedule_visit                      | patientId                    | Reserve community slot; simulated completion after 90 minutes                                                         |
| review / accept / reject / complete | resourceId                   | Owner-checked state transition                                                                                        |
| dispense / collect                  | prescription resourceId      | Validated dispensing lifecycle                                                                                        |
| share_record                        | resourceId, target           | Explicit visibility transfer                                                                                          |

Pass expectedVersion for optimistic concurrency and Idempotency-Key for safe retries. Conflicting keys and stale versions return 409. Unavailable capacity also returns 409. Missing scopes/ownership return 403.

## NHS-shaped adapters

PDS and ODS also provide [typed patient and organisation endpoints](./fhir.mdx), including read, search, pagination and FHIR errors. Use `/api/nhs/pds/Patient` and `/api/nhs/ods/Organization` for those workflows.

GET /api/nhs/{adapter} returns a FHIR-shaped Bundle. Patient filtering for non-PDS adapters: ?patient=SIM-000001. PDS search: ?q=....

| Adapter      | Scope       | Implemented data                 | Important deviation                                                      |
| ------------ | ----------- | -------------------------------- | ------------------------------------------------------------------------ |
| pds          | gp          | Demographic search               | SIM identifiers, no NHS-number lookup or update                          |
| ods          | referrals   | Fictional organisation directory | Small static directory                                                   |
| dos          | referrals   | Fictional services               | No national DoS triage logic                                             |
| ers          | referrals   | Referral lifecycle               | No full e-RS FHIR profiles, shortlist/UBRN protocol or attachment upload |
| eps          | pharmacy    | Prescription lifecycle           | No digital prescribing signature or NHS transport                        |
| eps-tracker  | pharmacy    | Current prescription status      | Local read projection                                                    |
| gp-connect   | gp          | Primary-care tasks               | Not GP Connect Access Record or appointment wire format                  |
| mesh         | gp          | Communication projection         | No MESH mailbox acknowledgement/download protocol                        |
| scr          | gp          | Explicitly shared documents      | Not a real Summary Care Record                                           |
| pathology    | diagnostics | Delayed test results             | No HL7v2 or laboratory device feed                                       |
| radiology    | diagnostics | Report metadata                  | No DICOM/PACS image server                                               |
| appointments | gp          | Capacity-backed bookings         | Local slot abstraction                                                   |

POST /api/nhs/{adapter}/actions uses the same simulator action schema and service scope as its owning site. It is a convenience adapter, **not** the corresponding NHS endpoint syntax. Read-only-looking adapters should be used for GET; production-parity method restrictions are not represented.

## CIS2 staff identity emulator

Open `/cis2/` for the emulator. The staff flow offers simulated smartcard and security-key choices, followed by fictional GP, hospital, community nurse and pharmacy identities. Developer and operator controls are in expandable sections. Each identity has organisation and role assignments; the hospital identity has two assignments to exercise role selection.

| Endpoint                                     | Purpose                                                |
| -------------------------------------------- | ------------------------------------------------------ |
| `GET /cis2/.well-known/openid-configuration` | OIDC discovery                                         |
| `GET /cis2/jwks`                             | Public signing key                                     |
| `GET /cis2/authorize`                        | Start browser sign-in                                  |
| `POST /cis2/authorize`                       | Submit identity and assignment or cancel               |
| `POST /cis2/token`                           | Exchange a code, form encoded                          |
| `GET /cis2/userinfo`                         | Read claims with the issued access token               |
| `GET /cis2/callback`                         | Default demonstration callback                         |
| `GET /cis2/session`                          | Current browser identity or `null`; no team API access |

The default public client is `nhs-sim-client`, with exact callback `PUBLIC_ORIGIN/cis2/callback`. Use Authorization Code with PKCE S256, `state`, `nonce`, and `openid` scope. `profile` is also supported. The token request must repeat the registered client ID and exact redirect URI and provide the original PKCE verifier.

Browser interactions expire after five minutes. Codes expire after two minutes and are single-use, including after a failed exchange. Tokens default to an hour; operators can set their lifetime between 30 and 3,600 seconds. These durations use wall time, independent of the simulation clock.

ID tokens use RS256. Claims include the fictional subject, name, role, organisation and `nhs_sim: true`. Clients must validate issuer, audience, signature, expiry, state and nonce. OIDC tokens are separate from team API keys and do not grant access to patient APIs.

This is a local protocol exercise. It does not implement smartcards, real staff authentication or NHS assurance. Configuration, signing keys and sessions are process-local. Restarting the application restores defaults and invalidates issued sessions.

### Operator controls

Use the organiser token as a Bearer credential at `/api/operator/cis2`:

| Method   | Effect                                                                        |
| -------- | ----------------------------------------------------------------------------- |
| `GET`    | Read settings, fictional identities and active session counts                 |
| `PUT`    | Replace settings and revoke all current interactions, codes and access tokens |
| `DELETE` | Revoke current interactions, codes and access tokens                          |

The `PUT` body contains the complete configuration, including every registered client:

```json
{
  "scenario": "normal",
  "tokenLifetimeSeconds": 300,
  "clients": [
    {
      "id": "nhs-sim-client",
      "name": "NHS simulation explorer",
      "redirectUris": ["http://localhost:8080/cis2/callback"]
    }
  ]
}
```

Change the callback to your configured origin. Redirects must match exactly and use HTTPS or localhost HTTP. The scenario applies across the running application, independently of team worlds.

`deny` returns `access_denied`, `expired-session` returns `login_required`, and `unavailable` returns HTTP 503. Restore `normal` for successful sign-in. Cancellation also returns `access_denied`. Check these outcomes in your client as well as the successful token exchange.

## Legacy browser

1. Obtain a normal team key.
2. POST /api/session with its Bearer header.
3. Open /browser/legacy using the issued HttpOnly SameSite cookie.
4. Inspect the HTML table and submit the CSRF-protected “Send copy to GP” form.
5. Observe the document in the GP projection.

No JSON record API is published. /api/sites/legacy/view returns a vendor joke and HTTP 501. RPA operates through the real HTML form; it is not a static screenshot.

## Operator endpoints

- GET /api/control/worlds
- POST /api/control/incidents {id,enabled}
- POST /api/control/agents {id,enabled}
- GET /api/control/snapshot
- POST /api/control/model-propose

Each accepts ?world=... and requires OPERATOR_TOKEN. Team POST /api/clock only controls its own world.

## Source references used to define boundaries

- [NHS CIS2 Authentication](https://digital.nhs.uk/developer/api-catalogue/cis2-authentication)
- [CIS2 sign-in journey](https://digital.nhs.uk/services/care-identity-service/applications-and-services/cis2-authentication/integrate/design-and-build/sign-in-journey)
- [e-RS FHIR API](https://digital.nhs.uk/developer/api-catalogue/e-referral-service-fhir)
- [EPS FHIR API](https://digital.nhs.uk/developer/api-catalogue/electronic-prescription-service-fhir)
- [EPS Tracker](https://digital.nhs.uk/developer/api-catalogue/spine-electronic-prescription-service-tracker-rest)
- [NHS API catalogue](https://digital.nhs.uk/developer/api-catalogue)

No live NHS credentials or public sandbox calls are required at runtime.

## Read a bounded resource page

Add `?limit=200&offset=0` to `GET /api/sites/{site}/view` to read up to 200 visible resources. `limit` accepts 1 through 500. The response includes `resourceTotal`, `resourceOffset`, and `resourceLimit`. Without `limit`, the endpoint returns all visible resources.

Add `?patient=SIM-000001` to read that patient's visible records plus service resources without a patient. The portal uses this query when you select a patient.

## Hospital patient flow

`GET /api/sites/hospital/attendances` returns this team's hospital attendances, their patients and the current simulation time. It is independent of chart selection. Millenni-ish uses these records for A&E tracking, the medical take, the inpatient census and discharged attendances.

Send `register_attendance` to `/api/sites/hospital/actions` with `patientId`, `title` (presenting complaint), `acuity` (`"1"` through `"5"`) and `location`. `clinician` is optional at registration. A patient can have one active attendance and can return after discharge.

Send `update_attendance` with `resourceId`, `expectedVersion` and `hospitalCommand`. Commands are `assign`, `assess`, `refer`, `admit` and `discharge`. Assignment accepts `clinician`, `location` and `acuity`. Assessment requires a clinician; admission requires a location; discharge requires a `disposition`. The normal sequence is waiting → assessing → take → inpatient → discharged. Discharge is also available earlier for patients leaving A&E. Hospital locations are recorded destinations, not reservations against the separate bed-capacity adapter.

All updates carry team attribution and use simulation timestamps. Current mean wait covers patients still awaiting assessment. Mean assessment wait covers assessed patients who arrived on the current simulation date. Assessment wait stops increasing when assessment starts. The four-hour counter includes patients still in A&E or awaiting medical take. These are synthetic operational measures, not clinical guidance.

## Pharmacy workspace and purchasing

`GET /api/sites/pharmacy/pharmacy-workspace` returns this team's prescriptions, Pharmacy First referrals, product catalogue, supplier quotes, the shared `pharmacy-basket`, purchase orders, stock movements and relevant patients. Procurement resources do not require a `patientId`. See the [pharmacy workflow guide](/docs/pharmacy/).

Send actions to `POST /api/sites/pharmacy/actions`. All updates require `resourceId` and `expectedVersion`; use an `Idempotency-Key` on retries.

| Action                      | Additional fields                                                                     | Result                                                        |
| --------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `receive_pharmacy_referral` | `patientId`, `title`, `pharmacyPathway`, `referralSource`                             | Creates an attributed referral, shared with its source and GP |
| `update_pharmacy_referral`  | `pharmacyCommand`: `accept`, `consult`, or `complete`; `text` required for completion | Returns recorded outcome to referring service                 |
| `link_prescription_stock`   | `productId`, `quantity` in individual units                                           | Links supply without overwriting prescribed text              |
| `dispense`                  | Versioned approved prescription with linked product and quantity                      | Deducts stock atomically, records historical cost and revenue |
| `receive_stock`             | Product resource, `quantity` in units, unique `text` delivery reference               | Receives an external delivery at current catalogue cost       |
| `update_stock_price`        | Product resource, `costPence`, `pricePence`, `reorderLevel`                           | Changes simulated pack prices and reorder threshold           |
| `place_pharmacy_order`      | Supplier quote resource, `quantity` in packs                                          | Snapshots quote, total price and delivery due date            |
| `update_pharmacy_basket` | Basket resource, `quoteId`, `quoteVersion`, `quantity` in packs, `requiredUnits` | Adds or replaces a product line after minimum-order validation |
| `remove_pharmacy_basket_line` | Basket resource, `productId` | Removes the selected product from the shared basket |
| `checkout_pharmacy_basket` | Basket resource | Validates frozen offers, creates linked supplier orders, returns `data.orderIds` |
| `receive_pharmacy_order` | Outstanding order resource, `quantity` in packs, unique `text` receipt reference | Receives all or part of a due order and adds its acquisition cost |
| `cancel_pharmacy_order` | Outstanding order resource, `text` reason | Cancels unreceived packs without changing received stock |

Supplier quotes expose `productId`, `supplier`, `packSize`, `packCostPence`, `minimumPacks`, and `leadDays`, plus `available` and `deliveryFeePence`. Purchase orders add `packs`, `totalPence`, `orderedAt`, `dueAt`, `receivedPacks`, `cancelledPacks`, and `receivedCostPence`. Orders from one basket share a `batchId`. Receipt sets `receivedAt`. Advance simulation time before receiving a future delivery. All suppliers and prices are fictional.

A changed supplier offer causes checkout to return a conflict. Refresh the workspace and update the affected basket line before retrying. Use the same idempotency key for retries of one logical checkout or receipt. Omitted receipt quantity preserves the full-delivery action.

Products expose `stock` in units and `stockCostPence` as total weighted acquisition value. Dispensing movements snapshot `costPence` and `revenuePence` for the dispensed quantity; received deliveries snapshot `acquisitionPence`. Later prices do not rewrite these values. Purchase cost, stock value and gross margin are separate measures; this is not a net-profit model.
