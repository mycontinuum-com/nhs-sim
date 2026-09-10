import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { jwtVerify, createLocalJWKSet } from "jose";
import { MockOIDC } from "../packages/nhs-mocks/src/cis2.ts";
const origin = "http://localhost:8080";
const verifier = "a".repeat(43);
const request = () =>
  new URLSearchParams({
    client_id: "nhs-sim-client",
    redirect_uri: origin + "/cis2/callback",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: "browser-state",
    nonce: "browser-nonce",
    scope: "openid profile",
  });
function complete(oidc: MockOIDC, identity = "SIM-STAFF-2", assignment = "consultant") {
  const interaction = oidc.begin(request());
  return new URL(
    oidc.complete(
      new URLSearchParams({
        interaction: interaction.interaction,
        csrf: interaction.csrf,
        identity,
        assignment,
        action: "continue",
      }),
      interaction.csrf,
    ),
  );
}
const exchange = (url: URL) =>
  new URLSearchParams({
    grant_type: "authorization_code",
    client_id: "nhs-sim-client",
    redirect_uri: origin + "/cis2/callback",
    code: url.searchParams.get("code") ?? "",
    code_verifier: verifier,
  });
const settings = (scenario: "normal" | "deny" | "unavailable" | "expired-session" = "normal") => ({
  scenario,
  tokenLifetimeSeconds: 60,
  clients: [
    { id: "nhs-sim-client", name: "Test client", redirectUris: [origin + "/cis2/callback"] },
  ],
});
test("interactive CIS2 signs the selected assignment and binds PKCE, state, nonce and audience", async () => {
  const oidc = new MockOIDC(origin);
  await oidc.init();
  const redirect = complete(oidc, "SIM-STAFF-2", "acute");
  assert.equal(redirect.searchParams.get("state"), "browser-state");
  const tokens = await oidc.token(exchange(redirect));
  const { payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(await oidc.jwks()), {
    issuer: origin + "/cis2",
    audience: "nhs-sim-client",
  });
  assert.equal(payload.sub, "SIM-STAFF-2");
  assert.equal(payload.role, "Acute medicine registrar");
  assert.equal(payload.nonce, "browser-nonce");
  assert.equal(payload.org, "SIM-NORTHBANK");
  assert.equal(oidc.userinfo(tokens.access_token).name, "Dr Oliver Chen");
  await assert.rejects(() => oidc.token(exchange(redirect)), /Invalid or expired/);
});
test("CIS2 requires the browser interaction and rejects identity-role substitution", () => {
  const oidc = new MockOIDC(origin),
    interaction = oidc.begin(request());
  const form = new URLSearchParams({
    interaction: interaction.interaction,
    csrf: interaction.csrf,
    identity: "SIM-STAFF-1",
    assignment: "gp",
  });
  assert.throws(() => oidc.complete(form, "wrong-browser"), /browser verification/);
  form.set("assignment", "consultant");
  assert.throws(() => oidc.complete(form, interaction.csrf), /belonging/);
  assert.throws(() => oidc.complete(form, interaction.csrf), /expired/);
  assert.throws(() => oidc.complete(request(), ""), /browser verification/);
});
test("CIS2 operator scenarios return protocol errors and configuration revokes credentials", async () => {
  const oidc = new MockOIDC(origin);
  await oidc.init();
  for (const scenario of ["deny", "expired-session"] as const) {
    oidc.configure(settings(scenario));
    const redirect = complete(oidc);
    assert.equal(
      redirect.searchParams.get("error"),
      scenario === "deny" ? "access_denied" : "login_required",
    );
    assert.equal(redirect.searchParams.has("code"), false);
  }
  oidc.configure(settings("unavailable"));
  assert.throws(() => oidc.begin(request()), /unavailable/);
  oidc.configure(settings());
  const tokens = await oidc.token(exchange(complete(oidc)));
  oidc.revoke();
  assert.throws(() => oidc.userinfo(tokens.access_token), /Invalid/);
  assert.throws(() =>
    oidc.configure({
      ...settings(),
      clients: [
        { id: "evil", name: "Invalid", redirectUris: ["https://example.test/callback#fragment"] },
      ],
    }),
  );
});
test("CIS2 enforces code, interaction and token expiry", async () => {
  let now = Date.now();
  const oidc = new MockOIDC(origin, () => now);
  await oidc.init();
  oidc.configure(settings());
  const old = complete(oidc);
  now += 120001;
  await assert.rejects(() => oidc.token(exchange(old)), /expired/);
  const interaction = oidc.begin(request());
  now += 300001;
  assert.throws(
    () =>
      oidc.complete(
        new URLSearchParams({
          interaction: interaction.interaction,
          csrf: interaction.csrf,
          identity: "SIM-STAFF-1",
          assignment: "gp",
        }),
        interaction.csrf,
      ),
    /expired/,
  );
  const tokens = await oidc.token(exchange(complete(oidc)));
  now += 60001;
  assert.throws(() => oidc.userinfo(tokens.access_token), /expired/);
});
test("CIS2 rejects changed clients, redirects and wrong PKCE", async () => {
  const oidc = new MockOIDC(origin);
  await oidc.init();
  const invalid = request();
  invalid.set("redirect_uri", "https://evil.example/");
  assert.throws(() => oidc.begin(invalid), /unregistered/);
  const wrong = exchange(complete(oidc));
  wrong.set("code_verifier", "b".repeat(43));
  await assert.rejects(() => oidc.token(wrong), /PKCE/);
  const changed = exchange(complete(oidc));
  changed.set("client_id", "other-client");
  await assert.rejects(() => oidc.token(changed), /Invalid/);
});

test("CIS2 HTTP workbench requires operator auth and browser consent, then supplies staff context", async () => {
  const { createServer } = await import("node:http");
  const { handleCis2 } = await import("../apps/server/src/cis2.ts");
  const oidc = new MockOIDC(origin);
  await oidc.init();
  const server = createServer(async (req, res) => {
    try {
      await handleCis2({
        req,
        res,
        url: new URL(req.url ?? "/", origin),
        admin: req.headers.authorization === "Bearer operator-test-token",
        oidc,
      });
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/api/operator/cis2")).status, 401);
    const configuration = await fetch(base + "/api/operator/cis2", {
      headers: { Authorization: "Bearer operator-test-token" },
    });
    assert.equal(configuration.status, 200);
    const start = await fetch(base + "/cis2/authorize?" + request());
    const html = await start.text();
    assert.equal(start.status, 200);
    assert.match(html, /Who are you working as/);
    const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1],
      interaction = html.match(/name="interaction" value="([^"]+)"/)?.[1];
    assert.ok(csrf && interaction);
    const form = new URLSearchParams({
      csrf,
      interaction,
      identity: "SIM-STAFF-2",
      assignment: "acute",
      action: "continue",
    });
    const rejected = await fetch(base + "/cis2/authorize", {
      method: "POST",
      body: form,
      redirect: "manual",
    });
    assert.equal(rejected.status, 400);
    const consent = await fetch(base + "/cis2/authorize", {
      method: "POST",
      body: form,
      headers: { Cookie: `cis2_interaction=${csrf}` },
      redirect: "manual",
    });
    assert.equal(consent.status, 303);
    const location = consent.headers.get("location");
    assert.ok(location);
    const response = await fetch(base + "/cis2/token", {
      method: "POST",
      body: exchange(new URL(location)),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const session = await fetch(base + "/cis2/session", { headers: { Cookie: cookie } });
    assert.equal((await session.json()).identity.role, "Acute medicine registrar");
    await fetch(base + "/api/operator/cis2", {
      method: "DELETE",
      headers: { Authorization: "Bearer operator-test-token" },
    });
    const revoked = await fetch(base + "/cis2/session", { headers: { Cookie: cookie } });
    assert.deepEqual(await revoked.json(), { identity: null });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("CIS2 revocation also cancels a token exchange already signing", async () => {
  const oidc = new MockOIDC(origin);
  await oidc.init();
  const exchangeInFlight = oidc.token(exchange(complete(oidc)));
  oidc.revoke();
  await assert.rejects(() => exchangeInFlight, /revoked during token exchange/);
  assert.equal(oidc.configuration().active.tokens, 0);
});
