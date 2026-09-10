import { freeze, original } from "immer";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ZodError, z } from "zod";
import { Store } from "./store.ts";
import {
  sites,
  activeServices,
  scenarios,
  type SiteId,
} from "../../../packages/contracts/src/index.ts";
import {
  generatePopulationBatch,
  POPULATION_BATCH_VERSION,
} from "../../../packages/engine/src/population-batch.ts";
import { SimError } from "../../../packages/engine/src/index.ts";
import {
  catalogue,
  bundle,
  matchAdapterPath,
  MockOIDC,
} from "../../../packages/nhs-mocks/src/index.ts";
import { handleCis2 } from "./cis2.ts";
import { handleFhir, operationOutcome } from "../../../packages/nhs-mocks/src/fhir.ts";
import { ModelAgent } from "../../../packages/agents/src/index.ts";

const port = Number(process.env.PORT ?? 8080);
const origin = process.env.PUBLIC_ORIGIN ?? "http://localhost:" + port;
const adminToken = process.env.OPERATOR_TOKEN;
if (!adminToken || adminToken.length < 16)
  throw new Error("Set OPERATOR_TOKEN to at least 16 characters");
const store = new Store(
  process.env.DATABASE_URL ?? "postgres://nhssim:nhssim@localhost:5432/nhssim",
);
await store.init();
const oidc = new MockOIDC(origin);
await oidc.init();
const staticRoot = resolve("dist/sites");
const sessions = new Map<string, { key: string; csrf: string; expires: number }>();
const issuance = new Map<string, number>();
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const escape = (s: unknown) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
function send(res: ServerResponse, status: number, value: unknown, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type + "; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(type === "application/json" || type === "application/fhir+json" ? JSON.stringify(value) : String(value));
}
async function body(req: IncomingMessage) {
  let text = "";
  for await (const part of req) {
    text += part;
    if (text.length > 65536) throw new SimError("Body too large", 413);
  }
  return text;
}
async function json(req: IncomingMessage) {
  try {
    return JSON.parse((await body(req)) || "{}");
  } catch (e) {
    if (e instanceof SimError) throw e;
    throw new SimError("Malformed JSON");
  }
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", origin),
      path = url.pathname,
      method = req.method ?? "GET";
    if (path === "/control/" && url.searchParams.has("challenges") && (method === "GET" || method === "HEAD")) {
      url.searchParams.delete("challenges");
      res.writeHead(302, { Location: url.pathname + url.search, "Cache-Control": "no-store" });
      return res.end();
    }
    if (
      method !== "GET" &&
      method !== "HEAD" &&
      req.headers.origin &&
      req.headers.origin !== origin
    )
      throw new SimError("Origin not allowed", 403);
    if (path === "/healthz") {
      await store.pool.query("SELECT 1");
      return send(res, 200, { ok: true, database: "postgresql", mode: "synthetic" });
    }
    if (path === "/api/catalogue")
      return send(res, 200, {
        sites,
        apis: catalogue,
        scenarios,
        identity: { issuer: origin + "/cis2", clientId: "nhs-sim-client" },
        notice: "Local approximations, not NHS-certified implementations. No real patient data.",
      });
    if (path === "/api/keys" && method === "POST") {
      const input = z
        .object({ teamName: z.string().trim().min(2).max(80), site: z.string().optional() })
        .parse(await json(req));
      if (input.site === "legacy")
        return send(res, 501, {
          error: "API_NOT_AVAILABLE",
          message:
            "This legacy service supports browser integration only. Create a session at POST /api/session and use /browser/legacy.",
        });
      if (store.keys.length >= 200)
        throw new SimError("Team limit reached; ask the organiser", 429);
      const ip = req.socket.remoteAddress ?? "local";
      if ((issuance.get(ip) ?? 0) > Date.now() - 2000)
        throw new SimError("Please wait two seconds before creating another key", 429);
      issuance.set(ip, Date.now());
      const allowed = activeServices.filter((id) => !["control", "legacy"].includes(id));
      if (input.site && !allowed.includes(input.site as SiteId))
        throw new SimError("Unknown API site");
      return send(res, 201, await store.issue(input.teamName, input.site ? [input.site] : allowed));
    }
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const cookie = req.headers.cookie
      ?.split("; ")
      .find((v) => v.startsWith("sim_session="))
      ?.slice(12);
    const session = cookie ? sessions.get(cookie) : undefined;
    const sessionKey = session && session.expires > Date.now() ? session.key : "";
    const admin = equal(bearer || sessionKey, adminToken!);
    if (await handleCis2({ req, res, url, admin, oidc })) return;
    const key = store.authenticate(bearer || sessionKey);
    const world = admin ? (url.searchParams.get("world") ?? "default") : key?.world;
    const authenticated = () => {
      if (!admin && !key) throw new SimError("Get a team API key at POST /api/keys", 401);
      if (!world) throw new SimError("Missing world", 400);
      return world;
    };
    const operator = () => {
      if (!admin) throw new SimError("Operator token required", 403);
      return authenticated();
    };
    if (path === "/api/control/population" && method === "POST") {
      const id = operator();
      const input = z
        .object({
          target: z.number().int().min(8).max(50000),
          batchSize: z.number().int().min(1).max(1000).default(500),
        })
        .parse(await json(req));
      return send(
        res,
        200,
        await store.run(
          () =>
            store.engine.transaction(id, (w) => {
              let manifest = w.resources.find((r) => r.id === "population-import");
              if (!manifest) {
                manifest = {
                  id: "population-import",
                  kind: "population-import",
                  title: "Synthetic population import",
                  owner: "control",
                  visibleTo: ["control"],
                  status: "in-progress",
                  priority: "routine",
                  createdAt: w.now,
                  version: 1,
                  data: { generator: POPULATION_BATCH_VERSION, seed: w.seed, now: w.now },
                };
                w.resources.push(manifest);
              }
              if (manifest.data.generator !== POPULATION_BATCH_VERSION)
                throw new SimError("Import generator version differs", 409);
              const remaining = Math.max(0, input.target - w.patients.length);
              if (remaining) {
                const start =
                  (original(w)?.patients ?? w.patients).reduce(
                    (maximum, p) => Math.max(maximum, Number(p.id.slice(4)) || 0),
                    0,
                  ) + 1;
                const batch = generatePopulationBatch({
                  seed: Number(manifest.data.seed),
                  now: Number(manifest.data.now),
                  start,
                  count: Math.min(input.batchSize, remaining),
                });
                for (const row of [...batch.patients, ...batch.resources]) freeze(row, true);
                w.patients.push(...batch.patients);
                w.resources.push(...batch.resources);
                manifest.version++;
              }
              manifest.status = w.patients.length >= input.target ? "completed" : "in-progress";
              manifest.data.target = input.target;
              return {
                world: id,
                population: w.patients.length,
                resources: w.resources.length,
                target: input.target,
                complete: w.patients.length >= input.target,
                generator: POPULATION_BATCH_VERSION,
              };
            }),
          id,
        ),
      );
    }
    if (path === "/api/control/population/publish" && method === "POST") {
      const id = operator();
      await store.publishPopulation(id);
      return send(res, 200, { world: id, published: true });
    }
    if (path === "/api/control/population/attach" && method === "POST") {
      const id = operator();
      const input = z.object({ source: z.string().default("default") }).parse(await json(req));
      await store.run(() => store.attachPopulation(id, input.source), id);
      return send(res, 200, { world: id, population: store.engine.require(id).patients.length });
    }
    if (path === "/api/session" && method === "POST") {
      authenticated();
      const id = randomBytes(24).toString("hex"),
        csrf = randomBytes(24).toString("hex");
      sessions.set(id, { key: bearer, csrf, expires: Date.now() + 3600000 });
      res.setHeader(
        "Set-Cookie",
        "sim_session=" +
          id +
          "; HttpOnly; SameSite=Strict; Path=/" +
          (origin.startsWith("https:") ? "; Secure" : ""),
      );
      return send(res, 200, { ok: true });
    }
    if (path.startsWith("/browser/legacy")) {
      const id = authenticated();
      if (method === "POST") {
        if (!session || session.expires < Date.now())
          throw new SimError("Browser session required", 401);
        const form = new URLSearchParams(await body(req));
        if (form.get("csrf") !== session.csrf) throw new SimError("Invalid form token", 403);
        await store.run(() =>
          store.engine.action(
            id,
            "legacy",
            { type: "share_record", resourceId: form.get("resourceId"), target: "gp" },
            key ? { kind: "team", name: key.team } : { kind: "operator", name: "Operator" },
          ),
        );
        res.writeHead(303, { Location: "/browser/legacy" });
        return res.end();
      }
      const rows = store.engine
        .view(id, "legacy")
        .resources.map(
          (r) =>
            "<tr><td>" +
            escape(r.id) +
            "</td><td>" +
            escape(r.title) +
            "</td><td>" +
            escape(r.data.text ?? "") +
            '</td><td><form method="post"><input type="hidden" name="csrf" value="' +
            escape(session?.csrf ?? "") +
            '"><input type="hidden" name="resourceId" value="' +
            escape(r.id) +
            '"><button>Send copy to GP</button></form></td></tr>',
        )
        .join("");
      return send(
        res,
        200,
        "<!doctype html><title>Westhaven Legacy</title><style>body{font:16px monospace;background:#e5e0cf;padding:24px}td{border:1px solid #777;padding:16px}button{padding:12px}</style><h1>Cerner? I Hardly Know Her</h1><p>All records fictional. Integration module sold separately. And then separately again.</p><table><caption>Outgoing correspondence</caption>" +
          rows +
          "</table>",
        "text/html",
      );
    }
    if (path === "/api/team") {
      authenticated();
      return send(
        res,
        200,
        admin
          ? { team: "Operator", world, scopes: sites.map((s) => s.id) }
          : { team: key!.team, world: key!.world, scopes: key!.scopes },
      );
    }
    if (path === "/api/plan-lab") {
      return send(res, 410, { error: "The challenge workbook has been retired. Explore the neighbourhood and use the service APIs.", href: "/control/" });
    }
    if (path === "/api/clock" && (method === "GET" || method === "POST")) {
      const id = authenticated();
      const snapshot = () => {
        const world = store.engine.require(id);
        const events = store.engine.events(id, "control", 500)
          .filter((event) => admin || event.type === "clock.changed" ||
            event.visibleTo.some((site) => key!.scopes.includes(site)))
          .slice(0, 100);
        return { now: world.now, paused: world.paused, speed: world.speed, events };
      };
      if (method === "GET") return send(res, 200, snapshot());
      const input = z
        .object({
          paused: z.boolean().optional(),
          speed: z.number().min(0).max(3600).optional(),
          advanceMinutes: z.number().min(0).max(10080).optional(),
        })
        .parse(await json(req));
      await store.run(() => store.engine.clock(id, input, key?.team ?? "operator"), id);
      return send(res, 200, snapshot());
    }
    if (path === "/api/control/worlds") {
      operator();
      return send(res, 200, store.engine.worlds());
    }
    if (path === "/api/control/incidents" && method === "POST") {
      const id = operator();
      const input = z
        .object({
          id: z.enum(scenarios.map((s) => s.id) as [string, ...string[]]),
          enabled: z.boolean(),
        })
        .parse(await json(req));
      return send(res, 200, await store.run(() => store.engine.fault(id, input.id, input.enabled)));
    }
    if (path === "/api/control/agents" && method === "POST") {
      const id = operator();
      const input = z.object({ id: z.string(), enabled: z.boolean() }).parse(await json(req));
      return send(
        res,
        200,
        await store.run(() =>
          store.engine.transaction(id, (w) => {
            const agent = w.agents.find((a) => a.id === input.id);
            if (!agent) throw new SimError("Unknown agent", 404);
            agent.enabled = input.enabled;
            return agent;
          }),
        ),
      );
    }
    if (path === "/api/control/model-propose" && method === "POST") {
      const id = operator();
      const proposals = await new ModelAgent().propose({
        world: id,
        site: "gp",
        observations: store.engine.view(id, "gp"),
      });
      return send(res, 200, {
        proposals,
        note: "Not executed. Review and submit through the normal action API.",
      });
    }
    if (path === "/api/control/snapshot") {
      const id = operator();
      return send(res, 200, {
        world: store.engine.require(id),
        events: store.engine.state.events[id] ?? [],
      });
    }
    const fhirPath = path.match(/^\/api\/nhs\/(pds|ods)\/(?!actions(?:$|\/))(.+)$/);
    if (fhirPath) {
      try {
        const world = authenticated();
        const scope = fhirPath[1] === "pds" ? "gp" : "referrals";
        if (!admin && !key!.scopes.includes(scope)) throw new SimError("Key lacks service scope", 403);
        const result = handleFhir({ engine: store.engine, world, url, method });
        if (!result) throw new SimError("Unknown FHIR endpoint", 404);
        for (const [name, value] of Object.entries(result.headers ?? {})) res.setHeader(name, value);
        return send(res, result.status, result.body, "application/fhir+json");
      } catch (error) {
        if (!(error instanceof SimError)) throw error;
        const result = operationOutcome(error.status, error.status === 401 || error.status === 403 ? "security" : "not-found", error.message);
        return send(res, result.status, result.body, "application/fhir+json");
      }
    }
    const apiMatch = matchAdapterPath(path);
    if (apiMatch) {
      const id = authenticated(),
        api = catalogue.find((a) => a.id === apiMatch[1]);
      if (!api) throw new SimError("Unknown NHS mock", 404);
      if (!admin && !key!.scopes.includes(api.site))
        throw new SimError("Key lacks service scope", 403);
      if (method === "GET") {
        const result = bundle(
          store.engine,
          id,
          api.id,
          url.searchParams.get("patient") ?? url.searchParams.get("q") ?? "",
        );
        return send(res, 200, result);
      }
      if (method === "POST" && apiMatch[2] === "actions") {
        const action = await json(req);
        return send(
          res,
          200,
          await store.run(() =>
            store.engine.action(
              id,
              api.site as SiteId,
              action,
              key ? { kind: "team", name: key.team } : { kind: "operator", name: "Operator" },
              req.headers["idempotency-key"] as string | undefined,
            ),
          ),
        );
      }
      throw new SimError("Unsupported mock operation", 405);
    }
    const match = path.match(/^\/api\/sites\/([a-z-]+)\/(view|patients|actions|appointments|attendances|pharmacy-workspace|documents)$/);
    if (match) {
      const id = authenticated(),
        site = match[1] as SiteId;
      if (!activeServices.includes(site)) throw new SimError("Unknown site", 404);
      if (site === "legacy")
        return send(res, 501, {
          error: "Use /browser/legacy after creating a team browser session.",
        });
      if (site === "control" && !admin) throw new SimError("Operator only", 403);
      if (!admin && !key!.scopes.includes(site)) throw new SimError("Key lacks service scope", 403);
      if (match[2] === "documents") {
        if (method !== "GET") throw new SimError("Method not allowed", 405);
        if (site !== "gp" && site !== "hospital") throw new SimError("Clinical document workspace required", 404);
        const world = store.engine.require(id);
        const resources = world.resources.filter(r => r.kind === "discharge-summary" && r.visibleTo.includes(site));
        const patientIds = new Set(resources.map(r => r.patientId));
        return send(res, 200, { resources, patients: world.patients.filter(p => patientIds.has(p.id)) });
      }
      if (match[2] === "pharmacy-workspace") {
        if (method !== "GET") throw new SimError("Method not allowed", 405);
        if (site !== "pharmacy") throw new SimError("Pharmacy workspace required", 404);
        const world = store.engine.require(id);
        const resources = world.resources.filter(r => r.visibleTo.includes("pharmacy") && ["prescription", "pharmacy-referral", "pharmacy-product", "pharmacy-movement", "pharmacy-quote", "pharmacy-order", "pharmacy-basket"].includes(r.kind));
        const patientIds = new Set(resources.map(r => r.patientId));
        return send(res, 200, { resources, patients: world.patients.filter(p => patientIds.has(p.id)), now: world.now });
      }
      if (match[2] === "attendances") {
        if (method !== "GET") throw new SimError("Method not allowed", 405);
        if (site !== "hospital") throw new SimError("Hospital list required", 404);
        const world = store.engine.require(id);
        const resources = world.resources.filter((r) => r.kind === "hospital-attendance");
        const patientIds = new Set(resources.map((r) => r.patientId));
        const patients = world.patients.filter((p) => patientIds.has(p.id));
        return send(res, 200, { resources, patients, now: world.now });
      }
      if (match[2] === "appointments") {
        if (method !== "GET") throw new SimError("Method not allowed", 405);
        const date = url.searchParams.get("date");
        if (
          !date ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date + "T00:00:00Z"))
        )
          throw new SimError("A valid date is required");
        const start = Date.parse(date + "T00:00:00Z");
        if (new Date(start).toISOString().slice(0, 10) !== date)
          throw new SimError("A valid date is required");
        const world = store.engine.require(id);
        const appointments = (
          await store.readResources(id, site, undefined, 0, 500, "appointment", date)
        ).resources
          .filter((r) => r.owner === site)
          .sort((a, b) => Number(a.data.startsAt) - Number(b.data.startsAt));
        const patients = world.patients
          .filter((p) => appointments.some((r) => r.patientId === p.id))
          .map(({ id, name }) => ({ id, name }));
        const sessions = world.resources.filter(r => r.kind === "appointment-session" && r.owner === site && r.visibleTo.includes(site) && Number(r.data.startsAt) < start + 86400000 && Number(r.data.endsAt) > start);
        return send(res, 200, { appointments, patients, sessions });
      }
      if (match[2] === "view") {
        const limit = url.searchParams.has("limit")
          ? Number(url.searchParams.get("limit"))
          : undefined;
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (
          !Number.isInteger(offset) ||
          offset < 0 ||
          (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500))
        )
          throw new SimError("Invalid resource page; limit must be 1–500 and offset nonnegative");
        const w = store.engine.require(id);
        return send(res, 200, {
          id: w.id,
          now: w.now,
          speed: w.speed,
          paused: w.paused,
          population: w.patients.length,
          counters: w.counters,
          ...(await store.readResources(
            id,
            site,
            url.searchParams.get("patient") ?? undefined,
            offset,
            limit ?? 500,
          )),
          staffing: store.engine.staffing(w),
          faults: w.faults,
          events: store.engine.events(id, site),
          ...(site === "control" ? { agents: w.agents } : {}),
        });
      }
      if (match[2] === "patients") {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (!Number.isInteger(offset) || offset < 0) throw new SimError("Invalid offset");
        return send(
          res,
          200,
          await store.readPatients(id, url.searchParams.get("q") ?? "", offset),
        );
      }
      if (match[2] === "actions" && method === "POST") {
        const action = await json(req);
        return send(
          res,
          200,
          await store.run(() =>
            store.engine.action(
              id,
              site,
              action,
              key ? { kind: "team", name: key.team } : { kind: "operator", name: "Operator" },
              req.headers["idempotency-key"] as string | undefined,
            ),
          ),
        );
      }
      throw new SimError("Method not allowed", 405);
    }
    if (path.startsWith("/api/")) throw new SimError("Unknown API endpoint", 404);
    if (method !== "GET" && method !== "HEAD") throw new SimError("Method not allowed", 405);
    if (path === "/") {
      res.writeHead(302, { Location: "/control/" });
      return res.end();
    }
    const site = path.split("/")[1];
    const isDocs = site === "docs";
    if (!isDocs && !sites.some((s) => s.id === site)) throw new SimError("Unknown site", 404);
    if (path === "/docs") {
      res.writeHead(302, { Location: "/docs/" });
      return res.end();
    }
    const root = isDocs ? resolve("dist/docs") : staticRoot;
    const relative = decodeURIComponent(path).slice(isDocs ? "/docs/".length : 1);
    let file = resolve(root, relative);
    if (file !== root && !file.startsWith(root + "/")) throw new SimError("Invalid path", 400);
    if (!extname(file))
      file = isDocs ? resolve(file, "index.html") : resolve(root, site, "index.html");
    let contents: Buffer;
    let status = 200;
    try {
      contents = await readFile(file);
    } catch {
      if (!isDocs) throw new SimError("Asset not found", 404);
      file = resolve(root, "404.html");
      contents = await readFile(file);
      status = 404;
    }
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".json": "application/json",
    };
    res.writeHead(status, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    });
    res.end(method === "HEAD" ? undefined : contents);
  } catch (error) {
    const status = error instanceof SimError ? error.status : error instanceof ZodError ? 400 : 500;
    send(res, status, {
      error: status === 500 ? "Internal simulation error" : (error as Error).message,
    });
    if (status === 500) console.error((error as Error).message);
  }
});
let last = Date.now(),
  ticking = false;
const timer = setInterval(() => {
  const now = Date.now(),
    elapsed = now - last;
  last = now;
  if (ticking || !store.engine.worlds().some((id) => !store.engine.require(id).paused)) return;
  ticking = true;
  store
    .run(() => store.engine.tick(elapsed))
    .catch((e) => console.error("Tick failed:", e.message))
    .finally(() => {
      ticking = false;
    });
}, 1000);
server.listen(port, "0.0.0.0", () =>
  console.log(
    "NHS-SIM ready on port " + port + "; " + sites.length + " sites; PostgreSQL backing store",
  ),
);
async function shutdown() {
  clearInterval(timer);
  server.close();
  await store.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
