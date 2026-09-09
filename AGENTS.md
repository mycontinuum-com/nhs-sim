# NHS-SIM agent guide

This repository is a synthetic healthcare simulation. Never introduce real patient data, clinical advice, production NHS credentials, or deceptive copies of proprietary products.

## Work in this repository

- Use the project-local pstack skills in `.agents/skills`. For non-trivial engineering work, start with `poteto-mode` and apply the smallest relevant playbook.
- Use `verify-nhs-sim` to drive the built application. Run `pnpm verify -- doctor` before interacting with an existing instance and `pnpm verify -- journey` for an end-to-end workflow proof.
- Preserve the architecture: one application container and public port, with PostgreSQL as the separate backing container.
- Add systems through `packages/contracts`; the build derives frontend packages from that registry.
- Treat the API catalogue as executable truth. Every advertised site and adapter must pass `scripts/smoke.mjs`.

## pstack on Codex

- Invoke a pstack skill as `$skill-name`; `/skill-name` is the Cursor spelling.
- Resolve all pstack references from `.agents/skills`. The `.cursor/skills` symlink exists only for Cursor compatibility.
- Translate pstack's `AskQuestion` to Codex structured user input when a genuine product decision is required.
- Translate pstack's `Task` or cloud-agent steps to Codex subagents only when that capability is available and authorized; otherwise perform the same bounded playbook serially.
- Ignore hard-coded Cursor model defaults that are unavailable. Inherit the active Codex model unless the user selected another one.
- Use `verify-nhs-sim` for runtime proof in place of Cursor-specific control-ui instructions.

## Definition of done

Run `pnpm verify:skills`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. For server, routing, database, identity, API, or UI changes, also launch Compose and run `pnpm smoke` or the equivalent `pnpm verify` journey. Report the observable workflow result, not only a passing build.
