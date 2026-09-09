# Architecture and extension points

## One origin

Traefik → app:8080 → static site directories, namespaced API modules, legacy HTML forms and mock identity routes. The app connects to PostgreSQL on the private Compose network. Nothing routes to an NHS production service.

The Sites frontend guidance informed the working-surface layout; deployment is ordinary Node/Docker, not a hosted Sites/Cloudflare project.

## State and time

Each team gets a deterministic world with 500 synthetic people, eight authored seed archetypes and shared operational resources. The engine supports 8–50,000 patients through `Engine.create`; there is currently no public bulk-population endpoint. A 50,000-person run needs performance testing before event use.

Virtual time starts at 2026-09-12 08:00 UTC, paused, at 60×. Speeds 0–3600 are accepted. Manual stepping requires pause and is limited to seven days per request. Only forward time is supported. Start a new seeded world for a clean replay; no rewind or snapshot import UI is implemented.

Scheduled events are processed in time order before advancing the final clock. Rule agents use persisted pseudo-random state, not model sampling. Deterministic replay means repeating the same seed and action sequence; external model outputs are not reproducible unless retained and replayed as actions.

API reads do not expose future scheduled events. The operator snapshot is explicitly privileged. Record sharing controls visibility, not physical storage: one authoritative world can represent different silos.

## PostgreSQL durability

`simulation_state` holds the complete version-1 engine state as JSONB; `team_keys` stores hashed bearer keys and world/scope mapping. Writes are serialised and awaited before successful HTTP responses. An advisory lock prevents two app processes from independently owning the same database.

This is a scaffold, not a throughput-optimised event store: whole-state copies and JSONB writes become expensive as worlds, queues and history grow. Before a large event, normalise worlds/resources/events, persist deltas transactionally, index world/patient/owner/due-time queries, add migrations and benchmark expected concurrency. Do not horizontally scale the current process.

The persisted schema version is checked at startup. No silent reseed occurs over an existing database. Take PostgreSQL backups before schema changes.

## Resource semantics

Patient needs, medication states, visits, referrals, reports, devices, staff and robot jobs are explicit resources. Actions validate patient existence, record visibility, ownership, version and transition. Idempotency keys bind to actor, site and payload.

Prescription flow: draft → reviewed → approved → dispensed → collected. Collection does not establish adherence. Test requests consume slots and produce delayed reports. Review/completion is separate. Visits consume slots and complete through a logistics agent. Robot jobs reserve a robot until completed.

Staff absence and roster allocation determine a simplified A&E staffing capacity from doctor/nurse counts. If no staffed space exists, emergency encounter/handover completion is rejected. This is an operational scaffold, not a validated staffing model.

The acute-flow agent adds three synthetic arrivals every twenty simulation minutes and processes older work at a rate derived from staffed spaces. A separate service-demand agent adds mental-health, maternity, dental, social-care, referral and pharmacy work every thirty minutes. Bed-flow and prevention agents add operational alerts and recalls. Removing staff therefore increases waiting work over time. These rates are explicit game parameters, not clinical evidence.

## Boundaries still to deepen

- Independent frontends share accessible workbench primitives and use distinct interface families. They evoke system categories, but are not pixel replicas of proprietary vendor screens.
- Legacy access is an HTML-only workflow without a published JSON endpoint, not a cryptographic guarantee against scraping its HTTP traffic.
- Patient portal is a team simulation view, not patient-authenticated access.
- No real DICOM server, physiological model, pharmacological dosing, robotic physics or device connectivity.
- No autonomous diagnosis/treatment. Model adapter only proposes administrative tasks.
- No full NHS/FHIR conformance, production authentication, network assurance or real prescription signing.
- No automatic cross-organisation data synchronisation beyond the explicit actions/event rules implemented.
- Population health, genomics, maternity, mental health, dentistry and social care have seeded records and live work queues, but not validated clinical or long-horizon outcome models.
- No attachment upload, real telephone/SMS delivery, HL7v2 listener or outbound webhook infrastructure yet.
- Team key revocation/expiry, quotas per team and robust public abuse controls are future hardening.

## Add a system

1. Add a site ID and capability entry in contracts.
2. Copy one app's package, HTML entry and Vite config; choose a unique base path.
3. Seed resources with explicit owner and visibility.
4. Implement typed actions and transitions in the engine.
5. Add an API adapter if the fictional vendor supports one.
6. Test valid flow, denied access, exhausted capacity, duplicate submission and time advancement.
7. The build loops over the registry automatically; no new production port is needed.
