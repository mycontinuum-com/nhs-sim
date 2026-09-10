---
title: The data in your world
---

# The data in your world

Every person in NHS-SIM is fictional. Patient identifiers start with `SIM-`. The repository does not contain real patient records or production NHS credentials.

## Patient and record shapes

A patient has an `id`, `name`, `birthDate`, service-specific `localIds`, `conditions`, `needs`, `goals`, and `synthetic: true`.

A resource has an `id`, optional `patientId`, `kind`, `title`, `status`, `owner`, `visibleTo`, `priority`, timestamps, `data`, and `version`. The owning service controls its transitions. Other services see it only when visibility permits.

`GET /api/sites/{site}/patients` returns a paginated demographic directory. `GET /api/sites/{site}/view` returns the service's visible records and current operational state. The view does not expose hidden scheduled events.

## Separate team worlds

Issuing a team key creates a world. Portal activity and API actions using that key affect the same world. Another team's key sees another world. Team names do not grant access to an existing world.

The simulation clock controls delayed events. A test order schedules a result. A dispatch schedules a delivery. Read the resulting resource after advancing time to check whether it completed.

## Provenance and coverage

The generator combines independently sampled collection-size bands with authored fictional content. Its size profile comes from 50 bounded JSON objects in a production EHR export. The profiler retains counts only, rounds counts down to multiples of five, and suppresses cells below five.

Problems, medications, allergies, and miscellaneous-code collections are sampled independently. Names, identifiers, dates, codes, and text are fictional. The generator does not copy a patient's source bundle.

The sample is selection-biased and may contain repeated patients. It does not establish demographic or disease prevalence, clinical validity, or a formal privacy guarantee.

The checked-in aggregate profile is `packages/engine/src/ehr-profile.json`. Organisers can regenerate it with `scripts/profile-ehr.py`, which reads source objects in memory and emits the aggregate profile. Production credentials are not needed to run the simulator.

Missing records do not establish that a condition is absent. Message delivery does not establish treatment, and prescription collection does not establish adherence.

See the [API reference](./api.md) for each adapter's implemented data and deviations from the corresponding NHS service.
