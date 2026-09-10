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
  const notes = await call("/api/sites/gp/view?patient=SIM-000003", {
    headers: { Authorization: "Bearer " + previous.key },
  });
  assert.deepEqual(notes.data.resources.find((r) => r.id === previous.noteId)?.provenance,
    previous.provenance, "consultation attribution survives process restart");
  console.log("PASS: team key, world clock and resource state survive application restart");
  process.exit(0);
}
const { data: catalogue } = await call("/api/catalogue");
assert.deepEqual(catalogue.sites.map((site) => site.id), ["control", "gp", "hospital", "pharmacy", "community", "wearables"]);
for (const path of ["/icb/", "/messaging/"])
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
const gpView = await call("/api/sites/gp/view", {headers});
const bookDate = new Date(gpView.data.now).toISOString().slice(0, 10);
const appointmentBook = await call("/api/sites/gp/appointments?date=" + bookDate, {headers});
assert.equal(appointmentBook.status, 200);
assert.ok(appointmentBook.data.appointments.length >= 12);
assert.equal((await call("/api/sites/gp/appointments?date=2026-02-31", {headers})).status, 400);
assert.equal((await call("/api/sites/gp/appointments?date=" + bookDate)).status, 401);
const consultation = await call("/api/sites/gp/actions", {method:"POST", headers,
  body:JSON.stringify({type:"save_consultation",patientId:"SIM-000001",title:"Smoke consultation",text:"Fictional person requested an accessible follow-up time.",consultationStatus:"saved",mode:"telephone"})});
assert.equal(consultation.status, 200);
const consultationView = await call("/api/sites/gp/view?patient=SIM-000001", {headers});
assert.equal(consultationView.data.resources.find(r => r.id === consultation.data.id)?.data.text,
  "Fictional person requested an accessible follow-up time.");
assert.equal((await call("/api/plan-lab")).status, 401);
assert.equal((await call("/api/plan-lab", { headers })).data.challenges.length, 3);
for (const action of ["start", "permit"]) {
  assert.equal((await call("/api/plan-lab", {
    method: "POST", headers, body: JSON.stringify({challenge: "digital", action}),
  })).status, 200);
}
const sharedLab = await call("/api/sites/community/view?patient=SIM-000002", {headers});
assert.ok(sharedLab.data.resources.some(resource => resource.data.planLab === "digital"));
assert.equal((await call("/api/plan-lab", {
  method: "POST", headers, body: JSON.stringify({challenge: "digital", action: "revoke"}),
})).status, 200);
const revokedLab = await call("/api/sites/community/view?patient=SIM-000002", {headers});
assert.ok(!revokedLab.data.resources.some(resource => resource.data.planLab === "digital"));
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
const note = { type: "save_consultation", patientId: "SIM-000003", title: "Attribution smoke proof",
  text: "Fictional test note", consultationStatus: "saved", author: "Forged team",
  provenance: { created: { actor: { kind: "team", name: "Forged team" } } } };
const created = await call("/api/sites/gp/actions", {
  method: "POST", headers, body: JSON.stringify(note),
});
assert.equal(created.status, 200);
assert.deepEqual(created.data.provenance.created.actor, { kind: "team", name: "Smoke test" });
const edit = { ...note, resourceId: created.data.id, expectedVersion: 1, text: "Updated fictional note" };
const edited = await call("/api/sites/gp/actions", {
  method: "POST", headers: { ...headers, "Idempotency-Key": "attribution-edit" }, body: JSON.stringify(edit),
});
assert.equal(edited.status, 200);
assert.equal(edited.data.provenance.changes.length, 2);
assert.deepEqual(edited.data.provenance.created, created.data.provenance.created);
const retry = await call("/api/sites/gp/actions", {
  method: "POST", headers: { ...headers, "Idempotency-Key": "attribution-edit" }, body: JSON.stringify(edit),
});
assert.deepEqual(retry.data.provenance, edited.data.provenance);
writeFileSync(
  ".data/smoke-state.json",
  JSON.stringify({
    key: issued.data.apiKey,
    world: view.data.id,
    now: view.data.now,
    resourceId: order.data.id,
    noteId: created.data.id,
    provenance: edited.data.provenance,
  }),
);
console.log(
  "PASS: all sites and assets, all NHS namespaces, authorization, legacy boundary and delayed result workflow",
);
