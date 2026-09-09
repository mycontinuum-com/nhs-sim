# NHS-shaped adapters and CIS-too

Simplified local adapters make integration-shaped workflows available without NHS credentials or real data.

## Sub-features

- PDS-ish, e-RS, EPS, GP Connect, MESH, 111, and specialty projections
- Adapter-scoped keys
- FHIR-shaped synthetic bundles
- CIS-too Authorization Code with PKCE

## How to get to it (user POV)

Open any portal, choose Developer desk, and inspect the public catalogue. CIS-too discovery is at `/cis2/.well-known/openid-configuration`.

## Driving it with control-nhs-sim

Run `pnpm verify -- smoke`. The catalogue drives the adapter loop, so every advertised adapter—including `/api/nhs/111`—must return successfully.

## Gotchas

- These mocks are not NHS conformance implementations.
- CIS-too tokens and team API keys are intentionally separate.
- Numeric adapter IDs must be accepted by the server route grammar.
