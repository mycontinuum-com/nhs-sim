import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const base = process.env.TEST_ORIGIN ?? "http://localhost:8080";
const call = async (path, options = {}) => {
  const r = await fetch(base + path, options);
  return { status: r.status, data: await r.json() };
};
assert.equal((await call("/healthz")).status, 200);
if (process.env.SMOKE_RESTORE === "1") {
  const previous = JSON.parse(readFileSync(".data/smoke-state.json", "utf8"));
  const restored = await call("/api/sites/diagnostics/view", {
    headers: { Authorization: "Bearer " + previous.key },
  });
  assert.equal(restored.status, 200, "key persists across process restart");
  assert.equal(restored.data.id, previous.world);
  assert.equal(restored.data.now, previous.now);
  assert.equal(
    restored.data.resources.find((r) => r.id === previous.resourceId)?.status,
    "available",
  );
  console.log("PASS: team key, world clock and resource state survive application restart");
  process.exit(0);
}
const { data: catalogue } = await call("/api/catalogue");
assert.deepEqual(catalogue.sites.map((site) => site.id), ["control", "gp", "hospital"]);
for (const path of ["/icb/", "/messaging/", "/community/", "/pharmacy/"])
  assert.equal((await fetch(base + path)).status, 404, path + " is retired");
assert.equal((await fetch(base + "/control/world/neighbourhood-v2.png")).status, 200);
assert.equal((await fetch(base + "/cis2/")).status, 200);
assert.equal((await call("/api/operator/cis2")).status, 401);
for (const site of catalogue.sites) {
  const response = await fetch(base + "/" + site.id + "/");
  assert.equal(response.status, 200, site.id);
  const html = await response.text();
  assert.ok(html.includes("root"));
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)];
  assert.ok(assets.length > 0);
  for (const [, asset] of assets) assert.equal((await fetch(base + asset)).status, 200, asset);
}
for (const path of ["/docs/", "/docs/quickstart/", "/docs/api/", "/docs/data/"]) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  const html = await response.text();
  assert.ok(html.includes("NHS-SIM"), path);
  const assets = [...html.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)];
  assert.ok(assets.length > 0, path + " has built assets");
  for (const [, asset] of assets)
    assert.equal((await fetch(new URL(asset, base + path))).status, 200, asset);
}
assert.equal((await fetch(base + "/docs/missing-page/")).status, 404);
const issued = await call("/api/keys", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ teamName: "Smoke test" }),
});
assert.equal(issued.status, 201);
const headers = {
  Authorization: "Bearer " + issued.data.apiKey,
  "Content-Type": "application/json",
};
assert.equal((await call("/api/sites/gp/view", { headers })).status, 200);
assert.equal((await call("/api/sites/control/view", { headers })).status, 403);
assert.equal((await call("/api/sites/legacy/view", { headers })).status, 501);
assert.equal((await call("/api/sites/gp/view")).status, 401);
for (const api of catalogue.apis)
  assert.equal((await call("/api/nhs/" + api.id, { headers })).status, 200, api.id);
const order = await call("/api/sites/gp/actions", {
  method: "POST",
  headers,
  body: JSON.stringify({ type: "order_test", patientId: "SIM-000001", title: "Smoke test order" }),
});
assert.equal(order.status, 200);
const step = await call("/api/clock", {
  method: "POST",
  headers,
  body: JSON.stringify({ advanceMinutes: 121 }),
});
assert.equal(step.status, 200);
const view = await call("/api/sites/diagnostics/view", { headers });
assert.equal(view.data.resources.find((r) => r.id === order.data.id).status, "available");
const session = await fetch(base + "/api/session", { method: "POST", headers, body: "{}" });
assert.equal(session.status, 200);
const cookie = session.headers.get("set-cookie").split(";")[0];
const browser = await fetch(base + "/browser/legacy", { headers: { Cookie: cookie } });
const html = await browser.text();
assert.equal(browser.status, 200);
const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
const resourceId = html.match(/name="resourceId" value="([^"]+)"/)[1];
const shared = await fetch(base + "/browser/legacy", {
  method: "POST",
  headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ csrf, resourceId }),
  redirect: "manual",
});
assert.equal(shared.status, 303);
const gp = await call("/api/sites/gp/view", { headers });
assert.ok(
  gp.data.resources.some((r) => r.id === resourceId),
  "legacy form transfers document to GP",
);
mkdirSync(".data", { recursive: true });
writeFileSync(
  ".data/smoke-state.json",
  JSON.stringify({
    key: issued.data.apiKey,
    world: view.data.id,
    now: view.data.now,
    resourceId: order.data.id,
  }),
);
console.log(
  "PASS: all sites and assets, all NHS namespaces, authorization, legacy boundary and delayed result workflow",
);
