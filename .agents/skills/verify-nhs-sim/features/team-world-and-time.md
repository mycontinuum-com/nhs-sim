# Team world and simulation time

Self-service access creates an isolated seeded world. Its clock starts paused and governs agent work.

## Sub-features

- Team-name key issuance
- Isolated world selection
- Pause, run, speed, and manual time step
- Delayed work completion

## How to get to it (user POV)

Open `/gp/`, enter a team name, then use the clock shown above the practice workspace. The same session key works across service portals.

## Driving it with control-nhs-sim

Run `pnpm verify -- journey`. It issues a key, orders a test, steps 121 minutes, and observes the result in diagnostics.

## Gotchas

- Manual stepping requires the world to be paused.
- The key is returned once and is deliberately excluded from evidence.
- A submitted order is not proof of a result; observe the diagnostics record.
