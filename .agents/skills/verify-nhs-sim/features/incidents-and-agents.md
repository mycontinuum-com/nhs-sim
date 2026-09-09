# Incidents and autonomous agents

Simulation-time agents create demand and complete bounded work while operator incidents alter causal behavior.

## Sub-features

- Acute flow, service demand, home monitoring, laboratory, logistics, bed flow, and prevention
- Pathology outage, staffing shortage, winter pressure, medicine shortage, wearable disconnection, robot failure, and cyber read-only mode
- Operator-only switches
- Visible activity trail

## How to get to it (user POV)

Open `/control/` with the operator token. Use World agents & incidents to toggle one condition, then inspect affected service portals.

## Driving it with control-nhs-sim

Use `pnpm verify -- journey` for the normal delayed-result path. For an incident change, drive the control UI, capture the action, and then run `pnpm verify -- snapshot`; the affected service state is the required proof.

## Gotchas

- Team keys cannot mutate operator controls.
- Pausing the world pauses scheduled agent effects.
- A visible incident badge is not proof; verify the expected write rejection, queue growth, or visibility change.
