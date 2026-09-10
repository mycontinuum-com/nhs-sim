# Hackathon experience pass

1. Ground: inspect current map, team access, EHR data/actions and wearable scheduler; run live doctor.
2. Sketch: compare dispensing bench against Kanban, visit ledger against route map, home chart against ring grid. Choose the first option in each pair because the data supports queues, scheduled visits and time-stamped observations.
3. Agree: proceed under the user's request to implement specialised systems.
4. Implement: keep each workspace on the same team world and service action boundary.
5. Scrap: revise any design that needs invented metrics or unsupported actions.

## Throughput checkpoint

- Blocking first steps: live doctor and existing resource/action inspection precede changes.
- Independent workstreams: care workspaces and consumer home own separate component/style files; root owns registry, seed data, shared access and browser QA.
- Shared mutable state: no concurrent writes to shared UI entry, registry or engine. Root integrates once components exist. Builds run serially.
- Smallest safe decomposition: two component owners and one integration/QA owner. No new service container or public port.

## Observed defects

- Escape did not close the team access dialog and opening it left focus behind it. Add focus entry, containment, restoration and Escape handling.
- New service-specific keys could not use the patient selector because it always requested the GP directory. Query the active service instead.
- Failed access looked like endless loading. Add an explicit recovery path to connect a different team.

## Acceptance journeys

- Map to dispensing bench, select Amira, dispense and collect the same shared prescription.
- Map to community visits, schedule a visit, advance time and observe completion.
- Map to Eleanor's home, inspect historical activity/sleep/heart-rate and observe a new reading after time advances.
- Verify keyboard access and a narrow viewport, run all required project checks and live smoke.
