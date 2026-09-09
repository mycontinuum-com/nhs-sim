import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ZodError, z } from "zod";
import { Store } from "./store.ts";
import { sites, scenarios, type SiteId } from "../../../packages/contracts/src/index.ts";
import { SimError } from "../../../packages/engine/src/index.ts";
import {
  catalogue,
  bundle,
  matchAdapterPath,
  MockOIDC,
} from "../../../packages/nhs-mocks/src/index.ts";
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
  res.end(type === "application/json" ? JSON.stringify(value) : String(value));
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
            "Interoperability is on our roadmap. Please fax your innovation to the account manager. In the meantime: /legacy/ (browser automation only).",
        });
      if (store.keys.length >= 200)
        throw new SimError("Team limit reached; ask the organiser", 429);
      const ip = req.socket.remoteAddress ?? "local";
      if ((issuance.get(ip) ?? 0) > Date.now() - 2000)
        throw new SimError("Please wait two seconds before creating another key", 429);
      issuance.set(ip, Date.now());
      const allowed = sites.filter((s) => !["control", "legacy"].includes(s.id)).map((s) => s.id);
      if (input.site && !allowed.includes(input.site as SiteId))
        throw new SimError("Unknown API site");
      return send(res, 201, await store.issue(input.teamName, input.site ? [input.site] : allowed));
    }
    if (path.startsWith("/cis2/")) {
      try {
        if (path === "/cis2/.well-known/openid-configuration")
          return send(res, 200, oidc.discovery());
        if (path === "/cis2/jwks") return send(res, 200, await oidc.jwks());
        if (path === "/cis2/token" && method === "POST")
          return send(res, 200, await oidc.token(new URLSearchParams(await body(req))));
        if (path === "/cis2/userinfo")
          return send(
            res,
            200,
            oidc.userinfo((req.headers.authorization ?? "").replace(/^Bearer /, "")),
          );
        if (path === "/cis2/authorize") {
          if (method === "POST") {
            const redirect = oidc.authorize(new URLSearchParams(await body(req)));
            res.writeHead(303, { Location: redirect });
            return res.end();
          }
          return send(
            res,
            200,
            '<!doctype html><title>CIS-too · mock identity</title><h1>CIS-too: synthetic staff sign-in</h1><p>This does not authenticate a real person. Fixed fictional identity: Dr Demo Clinician.</p><form method="post">' +
              [...url.searchParams]
                .map(
                  ([k, v]) =>
                    '<input type="hidden" name="' + escape(k) + '" value="' + escape(v) + '">',
                )
                .join("") +
              "<button>Continue as mock clinician</button></form>",
            "text/html",
          );
        }
        if (path === "/cis2/callback")
          return send(res, 200, {
            message: "Exchange this one-time mock code at /cis2/token using your PKCE verifier",
            code: url.searchParams.get("code"),
            state: url.searchParams.get("state"),
          });
      } catch (e) {
        return send(res, 400, { error: "invalid_request", message: (e as Error).message });
      }
      throw new SimError("Unknown identity endpoint", 404);
    }
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const cookie = req.headers.cookie
      ?.split("; ")
      .find((v) => v.startsWith("sim_session="))
      ?.slice(12);
    const session = cookie ? sessions.get(cookie) : undefined;
    const sessionKey = session && session.expires > Date.now() ? session.key : "";
    const admin = equal(bearer || sessionKey, adminToken!);
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
            key?.team ?? "operator",
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
    if (path === "/api/clock" && method === "POST") {
      const id = authenticated();
      const input = z
        .object({
          paused: z.boolean().optional(),
          speed: z.number().min(0).max(3600).optional(),
          advanceMinutes: z.number().min(0).max(10080).optional(),
        })
        .parse(await json(req));
      return send(res, 200, await store.run(() => store.engine.clock(id, input)));
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
        await store.run(() => {
          const agent = store.engine.require(id).agents.find((a) => a.id === input.id);
          if (!agent) throw new SimError("Unknown agent", 404);
          agent.enabled = input.enabled;
          return agent;
        }),
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
              key?.team ?? "operator",
              req.headers["idempotency-key"] as string | undefined,
            ),
          ),
        );
      }
      throw new SimError("Unsupported mock operation", 405);
    }
    const match = path.match(/^\/api\/sites\/([a-z-]+)\/(view|patients|actions)$/);
    if (match) {
      const id = authenticated(),
        site = match[1] as SiteId;
      if (!sites.some((s) => s.id === site)) throw new SimError("Unknown site", 404);
      if (site === "legacy")
        return send(res, 501, {
          error: "Our API is available in the next procurement cycle. Try /legacy/.",
        });
      if (site === "control" && !admin) throw new SimError("Operator only", 403);
      if (!admin && !key!.scopes.includes(site)) throw new SimError("Key lacks service scope", 403);
      if (match[2] === "view")
        return send(res, 200, {
          ...store.engine.view(id, site, url.searchParams.get("patient") ?? undefined),
          staffing: store.engine.staffing(store.engine.require(id)),
        });
      if (match[2] === "patients") {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (!Number.isInteger(offset) || offset < 0) throw new SimError("Invalid offset");
        return send(res, 200, store.engine.patients(id, url.searchParams.get("q") ?? "", offset));
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
              key?.team ?? "operator",
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
    if (!sites.some((s) => s.id === site)) throw new SimError("Unknown site", 404);
    const relative = decodeURIComponent(path).slice(1);
    let file = resolve(staticRoot, relative);
    if (!file.startsWith(staticRoot + "/")) throw new SimError("Invalid path", 400);
    if (!extname(file)) file = resolve(staticRoot, site, "index.html");
    let contents: Buffer;
    try {
      contents = await readFile(file);
    } catch {
      throw new SimError("Asset not found", 404);
    }
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".json": "application/json",
    };
    res.writeHead(200, {
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
