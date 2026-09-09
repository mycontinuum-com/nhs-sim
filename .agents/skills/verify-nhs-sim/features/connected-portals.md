# Connected service portals

Twenty-seven independently built portals expose different projections of one synthetic world on one origin.

## Sub-features

- Grouped system navigation
- Site-specific worklists and visual families
- Patient-context links between systems
- Developer desk and self-service keys

## How to get to it (user POV)

Open `/control/`, then select systems from Operate, Access, Acute, Beyond hospital, or Life course in the side navigation.

## Driving it with control-nhs-sim

Run `pnpm verify -- smoke`. It fetches every advertised site and every JavaScript/CSS asset. Run `pnpm verify -- snapshot` to record catalogue counts.

## Gotchas

- `/legacy/` intentionally exposes no normal site API.
- Visual families are fictional category cues, not proprietary UI replicas.
- A route returning HTML is insufficient if its referenced assets fail.
