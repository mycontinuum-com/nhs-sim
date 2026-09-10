# Public appointment calibration

The checked-in `packages/engine/src/public-data-profile.json` records four measured distributions from NHS England's [Appointments in General Practice, May 2025](https://digital.nhs.uk/data-and-information/publications/statistical/appointments-in-general-practice/may-2025), published on 26 June 2025.

## Source and denominator

The source is the publication's [National Overview CSV](https://files.digital.nhs.uk/74/89E3D3/National_Overview.csv). Select `APPOINTMENT_MONTH == MAY2025`, then sum `APPOINTMENTS` by each source column. The selected 1,755 aggregate cells contain 29,114,064 recorded appointments in England during 1–31 May 2025.

These are GP practice appointment-system records, not unique people. Separately published PCN appointment-book and NIMS vaccination counts are outside this CSV denominator. The publication's rounded headline total therefore differs. The source does not capture all primary-care work.

## Measured counts

Every distribution below has denominator **29,114,064**. Unknown values remain separate.

| Dimension | Category | Count |
|---|---|---:|
| Mode | Face-to-Face | 18,488,598 |
| Mode | Home Visit | 344,458 |
| Mode | Telephone | 7,326,425 |
| Mode | Unknown | 680,361 |
| Mode | Video Conference/Online | 2,274,222 |
| Status | Attended | 26,196,644 |
| Status | DNA | 1,204,897 |
| Status | Unknown | 1,712,523 |
| Professional type | GP | 13,154,741 |
| Professional type | Other Practice staff | 15,311,061 |
| Professional type | Unknown | 648,262 |
| Service setting | Extended Access Provision | 338,923 |
| Service setting | General Practice | 26,312,368 |
| Service setting | Other | 396,081 |
| Service setting | Primary Care Network | 1,614,645 |
| Service setting | Unmapped | 452,047 |

`Primary Care Network` in the service-setting column describes appointments within this extract. It does not add the separately published PCN appointment-book dataset.

## Use in synthetic generation

Sample categories with weights proportional to their counts. These are measured marginal distributions. Sampling each dimension independently does not reproduce observed associations between appointment mode, professional, status, and setting.

The number of encounters per synthetic patient, their clinical content, their dates, and their assignment to simulator services remain authored choices. Appointment shares must not become disease prevalence or probabilities that a person needs care. `DNA` is the source category for did not attend. It must not include `Unknown`.

The profile contains source URLs, the source file's SHA-256, filter, exact denominator, source columns, and attribution. Retain those fields in exported dataset provenance. This fixed historical calibration supports repeatable simulation, not a claim about current NHS activity.

## Licence

Contains information from NHS England, licenced under the current version of the Open Government Licence.

The website's [content terms](https://digital.nhs.uk/about-nhs-digital/terms-and-conditions) release applicable content under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). No patient-level records or NHS branding are included in this profile.

## Medication and allergy fixtures

Medication histories use a separate, versioned condition-linked catalogue. Generic names, formulations and broad indications are checked against [NHS Medicines A to Z](https://www.nhs.uk/medicines/). The catalogue retains its source links in `packages/engine/src/medication-history.ts`.

Prescription history, collection status, review dates, contact preferences and allergy reactions are authored fiction. They are not inferred from the GP appointment statistics or copied from patient records. Entries have no prescribing instructions. A broad diagnosis such as diabetes does not establish its type, and complex conditions do not automatically generate a treatment regimen.

The startup migration replaces only the old placeholder medicines and allergens. Existing named entries, user-written records, team changes and patient identities remain intact. A migration marker makes the update run once per database.
