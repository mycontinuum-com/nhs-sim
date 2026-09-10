import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const base = process.env.TEST_ORIGIN ?? "http://localhost:8080";
const call = async (path, options = {}) => {
  const r = await fetch(base + path, options);
  return { status: r.status, data: await r.json() };
};
assert.equal((await call("/healthz")).status, 200);
if (process.env.SMOKE_RESTORE === "1") {
  const previous = JSON.parse(readFileSync(".data/smoke-state.json", "utf8"));
  const restored = await call("/api/sites/diagnostics/view?patient=SIM-000001", {
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
  assert.equal(notes.data.resources.find((r) => r.id === previous.problemId)?.status, "resolved");
  assert.equal(notes.data.resources.find((r) => r.id === previous.allergyId)?.status, "active");
  console.log("PASS: team key, world clock and resource state survive application restart");
  process.exit(0);
}
const { data: catalogue } = await call("/api/catalogue");
const specification = await fetch(base + "/api/openapi.json");
assert.equal(specification.status, 200);
assert.match(specification.headers.get("content-type"), /application\/json/);
const openapi = await specification.json();
assert.equal(openapi.openapi, "3.1.0");
assert.ok(openapi.paths["/api/keys"].post.requestBody);
assert.ok(openapi.paths["/api/sites/{site}/actions"].post.requestBody);
assert.deepEqual((await call("/openapi.json")).data, openapi);
assert.equal(catalogue.documentation.openapi, "/api/openapi.json");
const handbook = await call("/docs/handbook.json");
assert.equal(handbook.status, 200);
assert.ok(handbook.data.pages.length >= 18);
for (const page of handbook.data.pages) {
  assert.ok(page.content.length > 100, page.url);
  assert.equal((await fetch(base + page.url)).status, 200, page.url);
}
const retiredChallengePage = await fetch(base + "/control/?challenges=1", { redirect: "manual" });
assert.equal(retiredChallengePage.status, 302);
assert.equal(retiredChallengePage.headers.get("location"), "/control/");
assert.deepEqual(catalogue.sites.map((site) => site.id), ["control", "gp", "hospital", "pharmacy", "community", "wearables"]);
for (const path of ["/icb/", "/messaging/"])
  assert.equal((await fetch(base + path)).status, 404, path + " is retired");
assert.equal((await fetch(base + "/control/world/neighbourhood-v2.png")).status, 200);
assert.equal((await fetch(base + "/cis2/")).status, 200);
assert.equal((await fetch(base + "/gp/documents/")).status, 200, "standalone document workspace");
assert.equal((await fetch(base + "/gp/messages/")).status, 200, "practice messaging workspace");
assert.equal((await fetch(base + "/wearables/messages/")).status, 200, "patient messages app");
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
for (const path of ["/docs/", "/docs/quickstart/", "/docs/api/", "/docs/data/", "/docs/explorer/", "/docs/explorer"]) {
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
const [issued, otherTeam] = await Promise.all([call("/api/keys", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ teamName: "Smoke test" }),
}), call("/api/keys", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ teamName: "Clock isolation", site: "gp" }),
})]);
assert.equal(issued.status, 201, issued.data.error);
assert.equal(otherTeam.status, 201, "simultaneous teams sharing an IP can sign up without throttling");
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
const problem = await call("/api/sites/gp/actions", { method: "POST", headers,
  body: JSON.stringify({ type: "save_problem", patientId: "SIM-000003", title: "Workflow QA problem", problemStatus: "active" }) });
assert.equal(problem.status, 200);
const activePatient = await call("/api/sites/gp/patients?q=SIM-000003", { headers });
assert.ok(activePatient.data.items.find((patient) => patient.id === "SIM-000003").conditions.includes("Workflow QA problem"));
const resolved = await call("/api/sites/gp/actions", { method: "POST", headers,
  body: JSON.stringify({ type: "save_problem", patientId: "SIM-000003", resourceId: problem.data.id,
    expectedVersion: 1, title: "Workflow QA problem", problemStatus: "resolved" }) });
assert.equal(resolved.status, 200);
const resolvedPatient = await call("/api/sites/gp/patients?q=SIM-000003", { headers });
assert.ok(!resolvedPatient.data.items.find((patient) => patient.id === "SIM-000003").conditions.includes("Workflow QA problem"));
const allergy = await call("/api/sites/gp/actions", { method: "POST", headers,
  body: JSON.stringify({ type: "save_allergy", patientId: "SIM-000003", title: "QA synthetic allergen",
    allergyStatus: "active", reaction: "Fictional test reaction" }) });
assert.equal(allergy.status, 200);
const sharedClinical = await call("/api/sites/hospital/view?patient=SIM-000003", { headers });
assert.equal(sharedClinical.data.resources.find((record) => record.id === problem.data.id)?.status, "resolved");
assert.equal(sharedClinical.data.resources.find((record) => record.id === allergy.data.id)?.status, "active");
const referral = await call("/api/sites/gp/actions", { method: "POST", headers,
  body: JSON.stringify({ type: "create_referral", patientId: "SIM-000003", title: "QA hospital referral", target: "hospital" }) });
assert.equal(referral.status, 200);
assert.equal(referral.data.owner, "hospital");
for (const type of ["review", "accept"]) {
  const received = await call("/api/sites/hospital/actions", { method: "POST", headers,
    body: JSON.stringify({ type, resourceId: referral.data.id }) });
  assert.equal(received.status, 200, "hospital can process the GP referral");
}
assert.equal((await call("/api/plan-lab")).status, 410);
const beforeRetiredAction = await call("/api/clock", { headers });
assert.equal((await call("/api/plan-lab", {
  method: "POST", headers, body: JSON.stringify({challenge: "digital", action: "start"}),
})).status, 410);
assert.deepEqual((await call("/api/clock", { headers })).data, beforeRetiredAction.data,
  "retired challenges cannot change team records or time");
assert.equal((await call("/api/sites/control/view", { headers })).status, 403);
assert.equal((await call("/api/sites/legacy/view", { headers })).status, 501);
assert.equal((await call("/api/sites/gp/view")).status, 401);
for (const api of catalogue.apis)
  assert.equal((await call("/api/nhs/" + api.id, { headers })).status, 200, api.id);
const anonymousPds = await call("/api/nhs/pds/Patient/SIM-000001");
assert.equal(anonymousPds.status, 401);
assert.equal(anonymousPds.data.resourceType, "OperationOutcome");
const demographics = await fetch(base + "/api/nhs/pds/Patient/SIM-000001", { headers });
assert.equal(demographics.status, 200);
assert.ok(demographics.headers.get("content-type").includes("application/fhir+json"));
const demographicPatient = await demographics.json();
assert.equal(demographicPatient.resourceType, "Patient");
assert.equal(demographicPatient.id, "SIM-000001");
const patientPage = await call("/api/nhs/pds/Patient?_count=2", { headers });
assert.equal(patientPage.status, 200);
assert.equal(patientPage.data.entry.length, 2);
assert.ok(patientPage.data.link.some((link) => link.relation === "next"));
const missingPatient = await call("/api/nhs/pds/Patient/SIM-999999", { headers });
assert.equal(missingPatient.status, 404);
assert.equal(missingPatient.data.resourceType, "OperationOutcome");
assert.equal((await call("/api/nhs/pds/Patient?birthdate=2025-02-30", { headers })).status, 400);
assert.equal((await call("/api/nhs/pds/Patient", { method: "POST", headers, body: "{}" })).status, 405);
const organisation = await call("/api/nhs/ods/Organization/SIM-RIVERSIDE", { headers });
assert.equal(organisation.status, 200);
assert.equal(organisation.data.resourceType, "Organization");
assert.equal(organisation.data.name, "Riverside Practice");
assert.equal((await call("/api/nhs/ods/metadata", { headers })).data.resourceType, "CapabilityStatement");
const order = await call("/api/sites/gp/actions", {
  method: "POST",
  headers,
  body: JSON.stringify({ type: "order_test", patientId: "SIM-000001", title: "Smoke test order" }),
});
assert.equal(order.status, 200);
assert.equal((await call("/api/clock")).status, 401);
const connectedWatch = await call("/api/sites/wearables/actions", {
  method: "POST", headers, body: JSON.stringify({ type: "connect_device", patientId: "SIM-000003" }),
});
assert.equal(connectedWatch.status, 200);
assert.equal(connectedWatch.data.patientId, "SIM-000003");
const initialClock = await call("/api/clock", { headers });
assert.equal(initialClock.status, 200);
assert.ok(initialClock.data.events.some((event) => event.resourceId === order.data.id));
assert.equal((await call("/api/clock", {
  method: "POST", headers, body: JSON.stringify({ paused: false }),
})).status, 200);
const step = await call("/api/clock", {
  method: "POST",
  headers,
  body: JSON.stringify({ paused: true, advanceMinutes: 121 }),
});
assert.equal(step.status, 200);
const homeReadings = await call("/api/sites/wearables/view?patient=SIM-000003", { headers });
assert.ok(homeReadings.data.resources.some((item) => item.kind === "observation" && item.owner === "wearables" && item.patientId === "SIM-000003"), "newly connected patient's watch emits a reading");
assert.equal(step.data.paused, true, "one click pauses and advances a running clock");
assert.ok(step.data.events.some((event) => event.actor === "Smoke test" && event.type.startsWith("clock.")),
  "team clock actions appear in the activity trail");
const otherClock = await call("/api/clock", { headers: { Authorization: "Bearer " + otherTeam.data.apiKey } });
assert.equal(otherClock.status, 200);
const scopedDirectory = await call("/api/nhs/ods/Organization", { headers: { Authorization: "Bearer " + otherTeam.data.apiKey } });
assert.equal(scopedDirectory.status, 403);
assert.equal(scopedDirectory.data.resourceType, "OperationOutcome");
assert.ok(!otherClock.data.events.some((event) => event.resourceId === order.data.id || event.actor === "Smoke test"),
  "the activity trail stays inside its team world");
const view = await call("/api/sites/diagnostics/view?patient=SIM-000001", { headers });
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
    problemId: problem.data.id,
    allergyId: allergy.data.id,
  }),
);
console.log(
  "PASS: all sites and assets, all NHS namespaces, authorization, legacy boundary and delayed result workflow",
);
