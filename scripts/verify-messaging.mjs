import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";

const origin = process.env.TEST_ORIGIN ?? process.env.NHS_SIM_ORIGIN ?? "http://localhost:8080";
const issue = async (site) => {
  const response = await fetch(origin + "/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamName: `Messaging proof ${site} ${randomUUID()}`, site }) });
  assert.equal(response.status, 201);
  return response.json();
};
const [team, other, restricted] = await Promise.all([issue("gp"), issue("gp"), issue("wearables")]);
const headers = { Authorization: `Bearer ${team.apiKey}`, "Content-Type": "application/json" };
const call = async (path, options = {}) => {
  const response = await fetch(origin + path, { headers, ...options });
  return { status: response.status, data: await response.json() };
};
const post = (site, input, extra = {}) => call(`/api/sites/${site}/messages`, { method: "POST", body: JSON.stringify(input), ...extra });
const patientId = "SIM-000003";
const entry = resource => resource.data.entries.at(-1);
const presetResponse = await call("/api/messaging/reply-presets", { headers: {} });
assert.equal(presetResponse.status, 200);
assert.ok(presetResponse.data.presets.length >= 3);
const preset = presetResponse.data.presets[0];
const expectedReply = preset.steps[0].body;
const listPath = `/api/sites/patient/messages?patientId=${patientId}`;
assert.equal((await call(listPath, { headers: {} })).status, 401);
assert.equal((await call(listPath, { headers: { Authorization: `Bearer ${restricted.apiKey}` } })).status, 403);
assert.equal((await call("/api/sites/patient/messages")).status, 400);
assert.equal((await call("/api/sites/gp/messages?limit=501")).status, 400);
const specification = await call("/api/openapi.json", { headers: {} });
for (const site of ["gp", "patient"]) for (const method of ["get", "post"]) {
  assert.deepEqual(specification.data.paths[`/api/sites/${site}/messages`][method].tags, ["Messaging"]);
}
const created = await post("patient", { patientId, command: { kind: "patient_create", subject: "Patient-initiated API proof", body: "Could I arrange an afternoon appointment?", channel: "sms" } });
assert.equal(created.status, 200, JSON.stringify(created.data));
let conversation = created.data;
assert.equal(entry(conversation).direction, "incoming");
assert.equal(entry(conversation).body, "Could I arrange an afternoon appointment?");
const conversationId = conversation.id;
const practiceRead = async () => {
  const response = await call(`/api/sites/gp/messages?patientId=${patientId}`);
  assert.equal(response.status, 200);
  const resource = response.data.items.find(item => item.id === conversationId);
  assert.ok(resource);
  return resource;
};
const command = async (site, value, extra = {}) => {
  const response = await post(site, { patientId, resourceId: conversation.id, expectedVersion: conversation.version, command: value }, extra);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  conversation = response.data;
  return response;
};
assert.equal((await post("gp", { patientId, resourceId: conversation.id, expectedVersion: conversation.version, command: { kind: "reply", body: "Forbidden impersonation" } })).status, 400);
assert.equal((await post("patient", { patientId, command: { kind: "note", body: "Forbidden private note" } })).status, 400);
await command("gp", { kind: "note", body: "Private practice note for the API proof" });
await command("gp", { kind: "configure_auto_reply", steps: preset.steps });
const sendInput = { patientId, resourceId: conversation.id, expectedVersion: conversation.version, command: { kind: "send", body: "Would an afternoon appointment suit you?", channel: "sms" } };
const retryHeaders = { ...headers, "Idempotency-Key": "messaging-proof-send" };
const sent = await post("gp", sendInput, { headers: retryHeaders });
assert.equal(sent.status, 200);
conversation = sent.data;
assert.deepEqual((await post("gp", sendInput, { headers: retryHeaders })).data, conversation);
const queuedEntryId = entry(conversation).id;
const patientBeforeDelivery = await call(listPath);
const before = patientBeforeDelivery.data.items.find(item => item.id === conversationId);
assert.ok(before);
assert.equal(JSON.stringify(before).includes("Private practice note"), false);
assert.equal("autoReply" in before.data, false);
assert.equal(before.data.entries.some(item => item.id === queuedEntryId), false);
await command("gp", { kind: "delivery", entryId: queuedEntryId, status: "delivered" });
const afterDeliveryVersion = conversation.version;
if (process.argv.includes("--restart")) {
  assert.ok(["http://localhost:8080", "http://127.0.0.1:8080"].includes(origin), "restart proof targets the local Compose instance");
  await promisify(execFile)("docker", ["compose", "restart", "app"]);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { ready = (await fetch(origin + "/healthz")).ok; } catch {}
    if (ready) break;
    await setTimeout(500);
  }
  assert.ok(ready, "application restarts with PostgreSQL");
  conversation = await practiceRead();
  assert.equal(conversation.version, afterDeliveryVersion);
  assert.equal(conversation.data.autoReply.pending.length, 1, "pending scripted reply survives restart");
}
const advance = await call("/api/clock", { method: "POST", body: JSON.stringify({ paused: true, advanceMinutes: preset.steps[0].delayMinutes }) });
assert.equal(advance.status, 200);
conversation = await practiceRead();
assert.ok(conversation.version > afterDeliveryVersion);
assert.equal(entry(conversation).direction, "incoming");
assert.equal(entry(conversation).body, expectedReply);
assert.equal(entry(conversation).actor.kind, "simulation");
const automaticEntry = entry(conversation);
assert.equal((await post("gp", { resourceId: conversation.id, expectedVersion: afterDeliveryVersion, command: { kind: "complete" } })).status, 409);
const otherRead = await call(`/api/sites/gp/messages?patientId=${patientId}`, { headers: { Authorization: `Bearer ${other.apiKey}` } });
assert.equal(otherRead.data.items.some(item => item.id === conversationId), false);
assert.equal((await post("patient", { patientId: "SIM-000004", resourceId: conversation.id, expectedVersion: conversation.version, command: { kind: "reply", body: "Wrong patient" } })).status, 403);
await command("gp", { kind: "configure_auto_reply", steps: [{ body: "This canceled response must never appear.", delayMinutes: 2 }] });
await command("gp", { kind: "send", body: "Please confirm Tuesday.", channel: "sms" });
await command("gp", { kind: "delivery", entryId: entry(conversation).id, status: "delivered" });
await command("patient", { kind: "reply", body: "Tuesday afternoon works for me." });
assert.equal(entry(conversation).body, "Tuesday afternoon works for me.");
await call("/api/clock", { method: "POST", body: JSON.stringify({ paused: true, advanceMinutes: 3 }) });
conversation = await practiceRead();
assert.equal(conversation.data.entries.some(item => item.body === "This canceled response must never appear."), false);
const patientAfter = await call(listPath);
const visible = patientAfter.data.items.find(item => item.id === conversationId);
assert.ok(visible.data.entries.some(item => item.id === automaticEntry.id));
assert.equal("autoReply" in visible.data, false);
assert.equal(JSON.stringify(visible).includes("Private practice note"), false);
const page = await call(`/api/sites/gp/messages?patientId=${patientId}&limit=1`);
assert.equal(page.data.items.length, 1);
assert.ok(page.data.total >= 1);
mkdirSync(".verification/evidence", { recursive: true });
writeFileSync(`.verification/evidence/messaging${process.argv.includes("--restart") ? "-restart" : ""}.json`, JSON.stringify({
  origin, at: new Date().toISOString(), world: team.world, conversationId,
  patientInitiated: created.data.data.entries[0].body,
  automaticReply: automaticEntry, manualReply: entry(conversation).body,
  restartedWithPendingReply: process.argv.includes("--restart"),
  checks: ["published operations", "role restrictions", "service scope", "patient initiation", "practice delivery", "scripted reply", "idempotency", "stale versions", "world isolation", "patient ownership", "private data redaction", "manual reply cancels automation"],
}, null, 2) + "\n");
console.log("PASS: patient and practice messaging APIs, scripted replies, private data redaction and team isolation");
