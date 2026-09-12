import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import WebSocket from "ws";

const origins = (process.env.TEST_ORIGINS ?? "http://localhost:8080").split(",").map(value => new URL(value.trim()).origin);
const run = randomUUID().slice(0, 8);
const hostile = "https://untrusted-origin.invalid";
const request = (origin, path, options = {}) => fetch(origin + path, { ...options, signal: AbortSignal.timeout(30000), redirect: "manual" });
async function json(origin, path, status, options) {
  const response = await request(origin, path, options);
  assert.equal(response.status, status, `${origin}${path} HTTP status`);
  return response.json();
}
async function websocket(origin, apiKey, denied = false) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(origin.replace(/^http/, "ws") + "/api/telephony/live", { origin: denied ? hostile : origin, handshakeTimeout: 15000 });
    let settled = false;
    const timer = setTimeout(() => finish(new Error("WebSocket probe timed out")), 20000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.terminate();
      error ? reject(error) : resolve();
    }
    socket.once("error", error => {
      if (denied && /403/.test(error.message)) finish();
      else finish(new Error("WebSocket connection failed"));
    });
    socket.once("close", (code, reason) => finish(new Error(`WebSocket closed before probe completed (${code}): ${reason.toString()}`)));
    socket.once("open", () => {
      if (denied) return finish(new Error("Untrusted WebSocket Origin was accepted"));
      socket.send(JSON.stringify({ kind: "authenticate", apiKey, name: "Origin verification" }));
    });
    socket.once("message", bytes => {
      try {
        const message = JSON.parse(bytes.toString());
        assert.equal(message.kind, "snapshot");
        assert.ok(Array.isArray(message.calls));
        assert.ok(message.members.some(member => member.id === message.memberId && member.name === "Origin verification"));
        finish();
      } catch {
        finish(new Error("WebSocket authentication did not return a valid snapshot"));
      }
    });
  });
}

for (const [index, origin] of origins.entries()) {
  const catalogue = await json(origin, "/api/catalogue", 200);
  assert.equal(catalogue.identity.issuer, origin + "/cis2");
  const discovery = await json(origin, "/cis2/.well-known/openid-configuration", 200);
  assert.equal(discovery.issuer, origin + "/cis2");
  for (const field of ["authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri"])
    assert.equal(new URL(discovery[field]).origin, origin, field);
  console.log(`PASS ${origin} catalogue and identity discovery stay on this origin`);

  const teamName = `Origin verification ${run} ${index}`;
  const team = await json(origin, "/api/keys", 201, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ teamName, site: "gp" }),
  });
  assert.equal(typeof team.apiKey, "string");
  const session = await request(origin, "/api/session", {
    method: "POST", headers: { Origin: origin, Authorization: "Bearer " + team.apiKey },
  });
  assert.equal(session.status, 200);
  const sessionCookie = session.headers.get("set-cookie") ?? "";
  assert.ok(sessionCookie.includes("sim_session="));
  if (origin.startsWith("https:")) assert.ok(sessionCookie.includes("Secure"));
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const callback = origin + "/cis2/callback";
  const params = new URLSearchParams({ client_id: "nhs-sim-client", redirect_uri: callback, response_type: "code", scope: "openid profile", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), state, nonce });
  const start = await request(origin, "/cis2/authorize?" + params, { headers: { Accept: "text/html" } });
  assert.equal(start.status, 200);
  const html = await start.text();
  const interaction = html.match(/name="interaction" value="([^"]+)"/)?.[1];
  const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(interaction && csrf, "Consent form contains a browser interaction");
  const cookie = start.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "Consent flow sets an interaction cookie");
  const consent = await json(origin, "/cis2/authorize", 200, {
    method: "POST", headers: { Origin: origin, Accept: "application/json", Cookie: cookie },
    body: new URLSearchParams({ interaction, csrf, identity: "SIM-STAFF-1", assignment: "gp", action: "continue" }),
  });
  const redirect = new URL(consent.redirect);
  assert.equal(redirect.origin, origin);
  assert.equal(redirect.pathname, "/cis2/callback");
  assert.ok(redirect.searchParams.get("state") === state, "Consent preserves browser state");
  assert.ok(redirect.searchParams.has("code"), "Consent issues an authorization code");
  const tokens = await json(origin, "/cis2/token", 200, {
    method: "POST", headers: { Origin: origin },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: "nhs-sim-client", redirect_uri: callback, code: redirect.searchParams.get("code"), code_verifier: verifier }),
  });
  const jwks = await json(origin, "/cis2/jwks", 200);
  const { payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), { issuer: origin + "/cis2", audience: "nhs-sim-client" });
  assert.equal(payload.sub, "SIM-STAFF-1");
  assert.ok(payload.nonce === nonce, "Signed identity preserves browser nonce");
  const identity = await json(origin, "/cis2/userinfo", 200, { headers: { Authorization: "Bearer " + tokens.access_token } });
  assert.equal(identity.name, "Dr Maya Bennett");
  console.log(`PASS ${origin} CIS2 browser consent, callback, signed issuer and staff identity`);

  await websocket(origin, team.apiKey);
  console.log(`PASS ${origin} browser signup, session and authenticated telephony snapshot, team ${teamName}`);

  assert.equal((await request(origin, "/api/keys", {
    method: "POST", headers: { Origin: hostile, "Content-Type": "application/json" },
    body: JSON.stringify({ teamName: `Rejected ${run}` }),
  })).status, 403);
  await websocket(origin, "", true);
  console.log(`PASS ${origin} rejects untrusted HTTP and WebSocket origins`);

}
console.log(`PASS all ${origins.length} configured origins`);
