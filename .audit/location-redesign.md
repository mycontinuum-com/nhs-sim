# Location interface implementation

The approved imagegen references are in output/imagegen/location-designs. The existing application owns API access and selection in WorldApp, passing typed patient/resource data and action callbacks to each workplace. Keep that boundary; replace the workplace compositions.

Architect exploration skipped: the user has approved four concrete visual directions and requested implementation. Retain existing contracts and callbacks rather than adding a competing application architecture.

## Throughput checkpoint

- Blocking first steps: inspect current working changes, component props and approved images before edits.
- Independent workstreams: implementation owner controls workplace components; root reviews integration, verifies browser journeys and deployment.
- Shared mutable state: preserve unrelated population work and gp-workflows changes. Only the implementation owner assigns UI file ownership. Root alone manages builds, Compose and git deployment.
- Smallest safe decomposition: split distinct workplace components while retaining common API/action ownership. No server schema changes are required for presentation.

## Verification

Run skills validation, typecheck, tests, build and Compose smoke/journey. Drive the hospital board, pharmacy queue, community visit and home trends through computer use. Push only owned changes after checks pass.

User scope correction: keep SystemTwo unchanged. Implement Millbank, pharmacy, community and home only.

## Observed results

Isolated release passes TypeScript, 49 tests, production build and all-sites smoke. Browser proof: hospital discharge reviewed then shared to GP; pharmacy dispensing reduces stock from 3 to 2; an Amira draft remains attached to Amira after selecting George and saves under Amira; community visit schedules, completes and remains in completed history; home period switches between 22 weekly and 4 daily readings. Phone-width home layout has document width390px at viewport390px. Existing SystemTwo body verified unchanged against HEAD.

Final refinements: service resources remain under All records; default hospital board focuses on patient care. Community handovers collapse by default; visit due dates determine agenda ordering. The phone layout places the agenda before the illustrative route. All four locations checked at390px without horizontal page overflow.
