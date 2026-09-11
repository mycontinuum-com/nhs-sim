import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const origin = process.env.TEST_ORIGIN ?? "http://localhost:8080";
const operatorToken = process.env.OPERATOR_TOKEN;
assert.ok(operatorToken, "Set OPERATOR_TOKEN for this deployment");
async function call(path, credential, data) {
  const response = await fetch(origin + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(credential ? { Authorization: "Bearer " + credential } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: response.status, data: await response.json() };
}
const name = "Operator verification " + Date.now().toString(36);
const team = await call("/api/keys", undefined, { teamName: name, site: "gp" });
assert.equal(team.status, 201);
const key = team.data.apiKey;
assert.equal((await call("/api/control/teams", key)).status, 403);
assert.equal((await call("/api/control/teams", "invalid-operator")).status, 403);
assert.equal((await call("/api/sites/gp/view?patient=SIM-000003&secret=must-not-appear", key)).status, 200);
const note = await call("/api/sites/gp/actions", key, {
  type: "save_consultation", patientId: "SIM-000003", title: "Organiser workflow verification",
  text: "Fictional note to verify organiser visibility.", consultationStatus: "saved",
});
assert.equal(note.status, 200);
assert.equal((await call("/api/sites/hospital/view", key)).status, 403);
const directory = await call("/api/control/teams", operatorToken);
assert.equal(directory.status, 200);
assert.ok(directory.data.teams.some(entry => entry.world === team.data.world));
assert.ok(!JSON.stringify(directory.data).includes(key), "team list excludes credentials");
const activityPath = "/api/control/teams/" + encodeURIComponent(team.data.world) + "/activity";
assert.equal((await call(activityPath, key)).status, 403);
let activity;
for (let attempt = 0; attempt < 30; attempt++) {
  activity = await call(activityPath, operatorToken);
  if (activity.data.requests?.some(entry => entry.path === "/api/sites/hospital/view" && entry.status === 403)) break;
  await setTimeout(100);
}
assert.equal(activity.status, 200);
assert.ok(activity.data.requests.some(entry => entry.method === "GET" && entry.path === "/api/sites/gp/view" && entry.patientIds.includes("SIM-000003")));
assert.ok(activity.data.requests.some(entry => entry.method === "POST" && entry.path === "/api/sites/gp/actions" && entry.status === 200));
assert.ok(activity.data.requests.some(entry => entry.path === "/api/sites/hospital/view" && entry.status === 403));
assert.equal(activity.data.patients.find(patient => patient.id === "SIM-000003")?.changeCount, 1);
assert.ok(activity.data.changes.some(change => change.resourceId === note.data.id && change.actor.name === team.data.team));
assert.ok(!JSON.stringify(activity.data.requests).includes("must-not-appear"));
assert.ok(!JSON.stringify(activity.data).includes(key));
const sessionPath = "/api/control/teams/" + encodeURIComponent(team.data.world) + "/session";
assert.equal((await call(sessionPath, key, {})).status, 403);
const session = await call(sessionPath, operatorToken, {});
assert.equal(session.status, 200);
assert.equal(session.data.world, team.data.world);
assert.deepEqual(session.data.scopes, ["gp"]);
assert.equal((await call("/api/team", session.data.apiKey)).data.world, team.data.world);
assert.equal((await call("/api/sites/hospital/view", session.data.apiKey)).status, 403);
assert.equal((await call("/api/operator/cis2", operatorToken)).status, 200);
assert.equal((await call("/api/operator/cis2", key)).status, 401);
console.log(JSON.stringify({ ok: true, team: team.data.team, world: team.data.world, checks: ["team directory", "request log including failures", "affected patient and attribution", "credential redaction", "exploration preserves scopes", "CIS2 operator access"] }));
