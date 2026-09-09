---
name: verify-nhs-sim
description: Drive and verify the NHS-SIM web portals, single-origin API, PostgreSQL persistence, agents, mock NHS adapters, and legacy browser workflow. Use after changing routes, simulation behavior, APIs, UI, Docker, or storage, and when investigating CI failures.
---

# Verify NHS-SIM

Use the bundled control program instead of ad hoc curl scripts. It returns a final JSON record and writes proof under `.verification/evidence/`.

## Launch

Run `pnpm verify -- launch`. This builds and starts the application plus PostgreSQL through Compose and waits for `/healthz`. It must report 27 sites and all catalogue adapters. Teardown with `pnpm verify -- cleanup`; preview that operation with `pnpm verify -- cleanup --dry-run`.

Do not launch a second instance when `pnpm verify -- doctor` reports a healthy application. Compose uses the repository project and port 8080, so parallel local instances are not isolated. Team worlds inside one instance are isolated.

## Doctor

Run `pnpm verify -- doctor` first. It checks the live health endpoint and catalogue, confirms the expected single-origin surface, and also reports local Node and pstack readiness. Use `--origin http://host:port` for another deployment. Use `doctor --static` only to diagnose a checkout before an instance can launch; it is not runtime proof.

## Drive

- `pnpm verify -- journey` creates a self-service team world, orders a test through the GP site, advances simulation time, and reads the available result from diagnostics.
- `pnpm verify -- smoke` checks every site asset, every advertised NHS adapter including numeric names such as `111`, authorization boundaries, the legacy HTML form, delayed results, and persistence setup.
- `pnpm verify -- snapshot` records health plus current site/API/scenario counts without mutation.

Set `NHS_SIM_ORIGIN` or pass `--origin` to target a non-default origin. Never place API keys in command arguments; the journey obtains an ephemeral team key internally and excludes it from evidence.

## Evidence

Evidence is JSON in `.verification/evidence/`. A valid proof records the command, origin, time, action identifiers, and observed result. For changes to a user workflow, capture both the submitted action and the resulting resource state. A unit test or build by itself is not evidence that the live single-origin workflow works.

## Cleanup

`pnpm verify -- cleanup` stops only this repository's Compose services and preserves the PostgreSQL volume. It never deletes `.verification/evidence`. Do not use `docker compose down -v` in verification.

## Helpers

The executable helper is `control-nhs-sim.mjs`. Run `pnpm verify -- help` for its JSON command catalogue. Its errors state the missing dependency or the next command to run.

Read the maintained [feature map](features/README.md) before verifying a changed user surface.
