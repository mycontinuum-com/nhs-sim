# Local API contracts

These are implemented **simulation contracts**, not assertions of NHS wire compatibility. Authentication headers, paths, FHIR profiles, mandatory identifiers, error payloads and signatures differ from production NHS APIs. Every FHIR-shaped resource is tagged as a simplified mock.

## Stable team contract

Public POST /api/keys:

```json
{"teamName":"Example builders","site":"gp"}
```

Omit site to request all API-enabled services. Response contains apiKey, team, world, scopes. Repeated issuance creates another world, even for the same team name; retain and reuse the original key. No name-based world takeover.

All clinical API calls require Authorization: Bearer sim_.... A key's world is immutable. Operator calls can select ?world=team-... with the separately configured operator token.

GET /api/sites/{site}/view returns:

```json
{
  "id":"team-example",
  "now":1789200000000,
  "speed":60,
  "paused":true,
  "population":500,
  "resources":[],
  "events":[],
  "counters":{"actions":0,"completed":0,"rejected":0,"reviewMinutes":0},
  "staffing":{"doctors":4,"nurses":4,"staffedSpaces":8,"waiting":2}
}
```

View is a bounded simulation projection, not a full EPR API. Resources contain id, patientId, kind, title, status, owner, visibleTo, priority, createdAt, dueAt, data and version. Resources do not reveal hidden scheduled events.

GET /api/sites/{site}/patients?q=...&offset=0 returns items and total. 30 items per page. All synthetic demographics in the team's world are discoverable.

POST /api/sites/{site}/actions supports:

| Action | Required input | Effect |
|---|---|---|
| create_task | patientId, optional title | New owning-service work item |
| create_referral | patientId | New referral visible to sender and referral service |
| order_test | patientId | Reserve diagnostics slot; result due in 120 simulation minutes |
| draft_prescription | patientId | Draft pharmacy prescription, not automatically approved |
| book_appointment | patientId, optional target | Reserve service capacity |
| send_message | patientId, optional title | Synthetic patient message |
| schedule_visit | patientId | Reserve community slot; simulated completion after 90 minutes |
| dispatch_robot | patientId | Reserve courier robot; completion after 30 minutes |
| review / accept / reject / complete | resourceId | Owner-checked state transition |
| dispense / collect | prescription resourceId | Validated dispensing lifecycle |
| share_record | resourceId, target | Explicit visibility transfer |
| report_absence / restore_staff | staff resourceId | HR/roster changes to available workforce |
| allocate_shift | staff resourceId | Toggle allocation to the current roster |

Pass expectedVersion for optimistic concurrency and Idempotency-Key for safe retries. Conflicting keys and stale versions return 409. Unavailable capacity also returns 409. Missing scopes/ownership return 403.

## NHS-shaped adapters

GET /api/nhs/{adapter} returns a FHIR-shaped Bundle. Patient filtering for non-PDS adapters: ?patient=SIM-000001. PDS search: ?q=....

| Adapter | Scope | Implemented data | Important deviation |
|---|---|---|---|
| pds | gp | Demographic search | SIM identifiers, no NHS-number lookup or update |
| ods | referrals | Fictional organisation directory | Small static directory |
| dos | referrals | Fictional services | No national DoS triage logic |
| ers | referrals | Referral lifecycle | No full e-RS FHIR profiles, shortlist/UBRN protocol or attachment upload |
| eps | pharmacy | Prescription lifecycle | No digital prescribing signature or NHS transport |
| eps-tracker | pharmacy | Current prescription status | Local read projection |
| gp-connect | gp | Primary-care tasks | Not GP Connect Access Record or appointment wire format |
| mesh | gp | Communication projection | No MESH mailbox acknowledgement/download protocol |
| scr | gp | Explicitly shared documents | Not a real Summary Care Record |
| immunisations | population | Vaccination records | No national writeback |
| screening | population | Screening follow-up | Local eligibility fixtures |
| pathology | diagnostics | Delayed test results | No HL7v2 or laboratory device feed |
| radiology | diagnostics | Report metadata | No DICOM/PACS image server |
| appointments | gp | Capacity-backed bookings | Local slot abstraction |
| nhs-login | nhsapp | Synthetic patient identity | Fixture only; no real NHS login or assurance |
| nrl | nhsapp | Visible record pointers | Local references, not National Record Locator semantics |
| personal-demographics | nhsapp | Citizen demographic projection | Read-only synthetic identities |
| 111 | urgent | Urgent-care dispositions | No clinical decision support or Pathways content |
| uec-booking | urgent | Urgent appointment projection | Local capacity abstraction |
| mental-health | mental | Crisis and care plans | Simplified local CarePlan resources |
| maternity | maternity | Maternity episodes | No national maternity record profile |
| dental | dental | Recall and access requests | No FP17 or payments workflow |
| social-care | social | Care packages and allocation | No local-authority integration |
| genomics | genomics | Consent-aware test records | No GMS test directory or genomic file formats |
| beds | beds | Bed state and discharge barriers | Operational game model only |
| theatres | theatre | Theatre lists and constraints | No device control or clinical scheduling engine |
| workforce | hr | Staff status | No ESR interface or real staff data |
| rostering | roster | Allocation and skill mix | Simplified schedule projection |
| ambulance | ambulance | Handover queue | No real CAD messages or dispatch control |
| provider-metrics | icb | Provider measures | Synthetic performance signals |
| research | research | Trial candidates | No recruitment, contact or consent writeback |

POST /api/nhs/{adapter}/actions uses the same simulator action schema and service scope as its owning site. It is a convenience adapter, **not** the corresponding NHS endpoint syntax. Read-only-looking adapters should be used for GET; production-parity method restrictions are not represented.

## CIS-too mock

- GET /cis2/.well-known/openid-configuration
- GET /cis2/jwks
- GET/POST /cis2/authorize
- POST /cis2/token (form encoded)
- GET /cis2/userinfo (mock access token)
- GET /cis2/callback

Registered public client: nhs-sim-client. Exact callback: PUBLIC_ORIGIN/cis2/callback. Authorization Code + PKCE S256, state and nonce are required. The explicit mock login selects a fixed synthetic clinician. Codes expire after two minutes and are single-use; tokens expire after an hour. ID tokens are RS256 signed with an ephemeral key. No smartcard, real staff authentication, NHS roles or national assurance.

OIDC tokens are **not** team API keys. Sign-in is a separate integration exercise.

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
