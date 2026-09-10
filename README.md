# nhs-sim

A synthetic, time-controlled healthcare ecosystem for hackathons. **One application container, one port, one origin; PostgreSQL in a second container.** Traefik points to port 8080 on the application. No subdomains, port-per-site configuration or public database port.

All people, records, organisations and vendor parodies are fictional. Not an NHS service, not a clinical product, and not an API conformance suite. Never import real patient data.

## Run locally

```bash
cp .env.example .env
docker compose up -d --build --wait
# Open http://localhost:8080
```

The world starts paused. Open any clinical site, enter a team name, and receive a key and isolated world. Run the clock or step an hour to generate work. The default operator token in the example configuration is **local development only**; enter it using “existing team key or operator token” on the control site.

PostgreSQL persists through container restarts in the named `postgres-data` volume. `docker compose down` preserves it. Do not add `-v` unless deliberately deleting your simulation database.

## Behind your existing Traefik

Set in `.env`:

```dotenv
PUBLIC_ORIGIN=https://sim.your-domain.example
SIM_HOST=sim.your-domain.example
OPERATOR_TOKEN=replace-with-a-long-random-secret
POSTGRES_PASSWORD=replace-with-a-url-safe-random-secret
TRAEFIK_CERTRESOLVER=letsencrypt
```

```bash
docker compose -f compose.yaml -f compose.traefik.yaml up -d --build --wait
```

Your Traefik must already be on the external Docker network `traefik`, with a `websecure` entrypoint and the named certificate resolver. The override removes host port publishing and routes the entire host to `app:8080`. Requires modern Docker Compose supporting `!reset` (2.24.4+). Do **not** strip path prefixes. For another proxy, simply forward the whole origin to port 8080.

Only the application joins the Traefik network. PostgreSQL remains on the internal Compose network. `PUBLIC_ORIGIN` must match the browser origin exactly: it determines mock OIDC URLs, CSRF origin validation and secure cookies.

## Explore the neighbourhood

Open `/control/` to enter the map, then choose a workplace. The map leaves the screen when you enter a clinical system. Return to it to change workplaces.

| Path | Workplace |
| --- | --- |
| `/control/` | Neighbourhood map and simulation controls |
| `/gp/` | SystemTwo at Riverside Practice, a fictional primary-care EPR |
| `/hospital/` | Millbank EPR at Northbank General, a fictional secondary-care EPR |
| `/docs/` | Participant handbook, API contracts and organiser guide |
| `/cis2/` | Staff identity emulator |

SystemTwo and Millbank demonstrate two different ways of working with the same synthetic population. Community, pharmacy, diagnostics and referrals are supporting services in their journeys, with scoped APIs and owned records. They do not have separate portals. The browser-only letter transfer remains at `/browser/legacy` as an integration exercise.

The interfaces are fictional interpretations of EPR categories. They do not reproduce vendor branding or claim compatibility with SystmOne or Cerner.

## APIs and self-service keys

```bash
curl -s http://localhost:8080/api/keys \
  -H 'Content-Type: application/json' \
  -d '{"teamName":"The Loop Closers"}'
```

Returns `apiKey`, `world`, `team` and `scopes`. Save the key: it is returned once; only its SHA-256 hash is stored in PostgreSQL. Use `Authorization: Bearer YOUR_KEY`.

Omit `site` for all available clinical APIs, or pass a site ID for a narrower key. Each issuance creates a new isolated world; reuse the same key across teammates and sites. Keys cannot select another team's world. A request for `site: "legacy"` returns HTTP 501 and vendor satire. The legacy browser still works with a normal team session.

- `GET /api/catalogue`: public directory.
- `GET /api/sites/gp/view`: visible records, clock and audit events.
- `GET /api/sites/gp/patients?q=SIM-000001&offset=0`: patient search (30 per page).
- `POST /api/sites/gp/actions`: typed actions; accepts `Idempotency-Key`.
- `POST /api/clock`: pause/speed/manual step, limited to the key's world.
- `GET /api/nhs/pds`, `/ers`, `/eps`: see [API contracts](docs/api-contracts.md).
- `GET /cis2/.well-known/openid-configuration`: mock staff identity discovery.

```bash
curl http://localhost:8080/api/sites/gp/actions \
  -H 'Authorization: Bearer YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: first-monitoring-order' \
  -d '{"type":"order_test","patientId":"SIM-000001","title":"Post-discharge monitoring"}'
```

Stepping 121 minutes produces a result. Injecting the pathology outage holds its visibility in diagnostics until restored. Referrals, prescriptions and community visits also affect the shared world.

## Architecture

- `apps/*`: independent static React frontends and one Node server.
- `packages/contracts`: typed entities, action validation, site/scenario registry.
- `packages/engine`: deterministic clock, seed, lifecycle validation and agent events.
- `packages/nhs-mocks`: lightweight NHS-shaped API adapters and mock OIDC.
- `packages/agents`: optional model proposal adapter.
- `packages/ui`: TanStack working surfaces.
- `apps/server/src/store.ts`: PostgreSQL persistence, hashed keys, single-writer lock.

The server composes the API modules in one process and serves all static builds. This is a modular monolith, deliberately deployable as one app container, not a distributed microservice installation.

The initial PostgreSQL schema stores versioned simulation snapshots in JSONB and keys in a separate table. Every successful mutation is persisted before responding. Failed mutations roll back in-memory state. This intentionally prioritises simple reproducibility over high-volume analytics. See [architecture and limits](docs/architecture.md) before scaling.

## Development

Node 24+, pnpm 11.19.0:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
# Set DATABASE_URL, OPERATOR_TOKEN, PUBLIC_ORIGIN:
pnpm start
```

Use Docker Compose for the complete local ecosystem. For frontend HMR, run `pnpm --filter @nhs-sim/gp dev` against a running server on localhost:8080; this development-only mode uses an extra port. Production always uses one.

## Agent workflow

The repository vendors pstack from the canonical `cursor/plugins` source. `.agents/skills` is the single skill tree used by Codex; `.cursor/skills` is a symlink to the same tree for Cursor, so the two installations cannot drift. Start substantial work with `$poteto-mode` in Codex or `/poteto-mode` in Cursor.

NHS-SIM also has a project-specific verification skill and control program:

```bash
pnpm verify -- doctor --static # checkout and skill health
pnpm verify -- launch         # app + PostgreSQL through Compose
pnpm verify -- journey        # GP order -> virtual time -> diagnostics result
pnpm verify -- smoke          # every portal/API and the legacy HTML workflow
pnpm verify -- cleanup --dry-run
```

Proof is written to the ignored `.verification/evidence/` directory. See `AGENTS.md` and `.agents/skills/verify-nhs-sim/features/` for the maintained feature map.

## Hackathon scope

Start with discharge follow-up, a rejected referral, or a community visit. Use SystemTwo and Millbank to inspect the patient and confirm the records your integration changes. Supporting services retain their own ownership and visibility rules.

Rule agents run without internet or credentials. Their actions use simulation time, so pausing pauses their effects. Optional LLM proposals require `OPENAI_API_KEY` and `OPENAI_MODEL`, and an explicit operator request. They are not automatically executed and may only propose tasks.

Read [hackathon projects and coverage](docs/hackathon.md), [API contracts](docs/api-contracts.md), and [security](SECURITY.md).

CI builds the image, starts PostgreSQL and the app, runs all single-origin smoke checks and restarts the app. Container testing requires Docker; local unit tests do not.
