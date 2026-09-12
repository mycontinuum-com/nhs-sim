import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { conversationSchema, patientReplyPresets, type MessagingCommand } from "../packages/contracts/src/messaging.ts";
import { patientConversation } from "../packages/engine/src/messaging.ts";
import type { Resource } from "../packages/contracts/src/index.ts";

function conversation(e: Engine, patientId = "SIM-000020", world = "default", allowReply = true) {
  const created = e.action(world, "gp", { type: "messaging_action", patientId, messagingCommand: { kind: "create", subject: "Administrative request", body: "Please confirm receipt", channel: "sms", allowReply } }, "Dr Rowan Page");
  const read = () => {
    const resource = e.require(world).resources.find(item => item.id === created.id);
    assert.ok(resource);
    return resource;
  };
  return {
    read,
    command(command: MessagingCommand, site: "patient" | "gp" = "gp", key?: string) {
      return e.action(world, site, { type: "messaging_action", patientId, resourceId: created.id, expectedVersion: read().version, messagingCommand: command }, site === "gp" ? "Dr Rowan Page" : "Patient participant", key);
    },
  };
}
function incoming(resource: Resource) {
  return conversationSchema.parse(resource.data).entries.filter(entry => entry.direction === "incoming").map(entry => entry.body);
}
function step(e: Engine, minutes: number, world = "default") {
  e.clock(world, { paused: true, advanceMinutes: minutes });
}

test("Patients start a conversation before any practice delivery and roles cannot impersonate each other", () => {
  const e = new Engine();
  const request = { type: "messaging_action", patientId: "SIM-000020", messagingCommand: { kind: "patient_create", subject: "Appointment availability", body: "Could I book an afternoon appointment?", channel: "email" } };
  const result = e.action("default", "patient", request, "Patient participant", "patient-start");
  assert.equal(result.owner, "gp");
  assert.deepEqual(incoming(patientConversation(result)), ["Could I book an afternoon appointment?"]);
  assert.equal(e.action("default", "patient", request, "Patient participant", "patient-start").id, result.id);
  assert.throws(() => e.action("default", "gp", request, "Practice"), /patient workspace/);
  assert.throws(() => e.action("default", "patient", { ...request, patientId: "does-not-exist" }, "Patient"), /Unknown patient/);
  const command = { type: "messaging_action", patientId: "SIM-000020", resourceId: result.id, expectedVersion: result.version, messagingCommand: { kind: "reply", body: "Pretend patient" } };
  assert.throws(() => e.action("default", "gp", command, "Practice"), /patient workspace/);
  assert.throws(() => e.action("default", "patient", { ...command, messagingCommand: { kind: "configure_auto_reply", steps: [] } }, "Patient"), /only reply/);
  const sent = e.action("default", "gp", { ...command, messagingCommand: { kind: "send", body: "We have your request", channel: "email" } }, "Dr Rowan Page");
  assert.equal(conversationSchema.parse(sent.data).entries.at(-1)?.body, "We have your request");
});

test("Scripted replies wait for delivery and simulation time, survive serialization, and record synthetic provenance", () => {
  const e = new Engine();
  const thread = conversation(e);
  const preset = patientReplyPresets.find(item => item.id === "acknowledgment");
  assert.ok(preset);
  thread.command({ kind: "configure_auto_reply", steps: preset.steps });
  step(e, 3);
  assert.deepEqual(incoming(thread.read()), []);
  thread.command({ kind: "delivery", entryId: `${thread.read().id}-1`, status: "delivered" });
  const deliveredAt = e.require("default").now;
  e.tick(5000);
  assert.equal(e.require("default").now, deliveredAt);
  step(e, 1);
  assert.deepEqual(incoming(thread.read()), []);
  const restored = new Engine();
  restored.state = JSON.parse(JSON.stringify(e.state));
  step(restored, 1);
  const reply = restored.require("default").resources.find(item => item.id === thread.read().id);
  assert.ok(reply);
  assert.deepEqual(incoming(reply), ["Thank you, I have received your message."]);
  const entry = conversationSchema.parse(reply.data).entries.at(-1);
  assert.equal(entry?.at, deliveredAt + 120000);
  assert.equal(entry?.actor.kind, "simulation");
  assert.equal(entry?.actor.name, restored.require("default").patients.find(item => item.id === "SIM-000020")?.name);
  assert.equal(reply.provenance?.changes.at(-1)?.action, "messaging.patient_auto_reply");
  assert.equal(reply.provenance?.changes.at(-1)?.actor.kind, "simulation");
  assert.equal(restored.events("default", "gp").filter(event => event.type === "messaging.patient_auto_reply" && event.resourceId === reply.id).length, 1);
  assert.equal("autoReply" in patientConversation(reply).data, false);
  assert.equal("provenance" in patientConversation(reply) && patientConversation(reply).provenance !== undefined, false);
  step(restored, 5);
  assert.deepEqual(incoming(restored.require("default").resources.find(item => item.id === reply.id) ?? reply), ["Thank you, I have received your message."]);
});

test("Failed delivery, retries, duplicate receipts and exhausted scripts never duplicate automatic responses", () => {
  const e = new Engine();
  const thread = conversation(e);
  thread.command({ kind: "configure_auto_reply", steps: [{ body: "First exact reply", delayMinutes: 0 }, { body: "Second exact reply", delayMinutes: 1 }] });
  const first = `${thread.read().id}-1`;
  thread.command({ kind: "delivery", entryId: first, status: "failed" });
  step(e, 2);
  assert.deepEqual(incoming(thread.read()), []);
  thread.command({ kind: "retry", entryId: first });
  const input = { type: "messaging_action", resourceId: thread.read().id, expectedVersion: thread.read().version, messagingCommand: { kind: "delivery", entryId: first, status: "delivered" } };
  e.action("default", "gp", input, "Practice", "delivery-once");
  e.action("default", "gp", input, "Practice", "delivery-once");
  assert.throws(() => thread.command({ kind: "delivery", entryId: first, status: "delivered" }), /Only queued/);
  step(e, 0);
  assert.deepEqual(incoming(thread.read()), ["First exact reply"]);
  thread.command({ kind: "send", body: "Second request", channel: "email" });
  const second = conversationSchema.parse(thread.read().data).entries.at(-1);
  assert.ok(second);
  thread.command({ kind: "delivery", entryId: second.id, status: "delivered" });
  step(e, 1);
  assert.deepEqual(incoming(thread.read()), ["First exact reply", "Second exact reply"]);
  const secondReply = conversationSchema.parse(thread.read().data).entries.at(-1);
  assert.equal(secondReply?.direction === "incoming" && secondReply.channel, "email");
  thread.command({ kind: "send", body: "No script steps remain", channel: "sms" });
  const third = conversationSchema.parse(thread.read().data).entries.at(-1);
  assert.ok(third);
  thread.command({ kind: "delivery", entryId: third.id, status: "delivered" });
  step(e, 5);
  assert.deepEqual(incoming(thread.read()), ["First exact reply", "Second exact reply"]);
});

for (const cancellation of ["manual reply", "completion", "disable", "replace"]) {
  test(`${cancellation} cancels pending scripts and future deliveries follow the remaining configuration`, () => {
    const e = new Engine();
    const thread = conversation(e);
    thread.command({ kind: "configure_auto_reply", steps: [{ body: "Cancelled response", delayMinutes: 2 }, { body: "Remaining response", delayMinutes: 1 }] });
    thread.command({ kind: "delivery", entryId: `${thread.read().id}-1`, status: "delivered" });
    if (cancellation === "manual reply") thread.command({ kind: "reply", body: "I replied manually" }, "patient");
    else if (cancellation === "completion") {
      thread.command({ kind: "complete" });
      thread.command({ kind: "reopen" });
    } else thread.command({ kind: "configure_auto_reply", steps: cancellation === "disable" ? [] : [{ body: "Replacement response", delayMinutes: 1 }] });
    step(e, 3);
    assert.deepEqual(incoming(thread.read()), cancellation === "manual reply" ? ["I replied manually"] : []);
    thread.command({ kind: "send", body: "Fresh request", channel: "sms" });
    const outgoing = conversationSchema.parse(thread.read().data).entries.at(-1);
    assert.ok(outgoing);
    thread.command({ kind: "delivery", entryId: outgoing.id, status: "delivered" });
    step(e, 2);
    assert.deepEqual(incoming(thread.read()), cancellation === "manual reply" ? ["I replied manually", "Remaining response"] : cancellation === "completion" ? ["Remaining response"] : cancellation === "replace" ? ["Replacement response"] : []);
  });
}

test("Scripts validate before writes and cannot cross patients, conversations or worlds", () => {
  const e = new Engine();
  e.create("other");
  const first = conversation(e);
  const second = conversation(e, "SIM-000021");
  const other = conversation(e, "SIM-000020", "other");
  const oneWay = conversation(e, "SIM-000020", "default", false);
  const config = { kind: "configure_auto_reply", steps: [{ body: "Only the first patient", delayMinutes: 1 }] } satisfies MessagingCommand;
  first.command(config);
  assert.throws(() => oneWay.command(config), /replies enabled/);
  second.command({ kind: "complete" });
  assert.throws(() => second.command(config), /open conversation/);
  const version = first.read().version;
  assert.throws(() => first.command({ kind: "configure_auto_reply", steps: [{ body: "", delayMinutes: -1 }] }));
  assert.equal(first.read().version, version);
  first.command({ kind: "delivery", entryId: `${first.read().id}-1`, status: "delivered" });
  other.command({ kind: "delivery", entryId: `${other.read().id}-1`, status: "delivered" });
  step(e, 2, "other");
  assert.deepEqual(incoming(first.read()), []);
  assert.deepEqual(incoming(other.read()), []);
  step(e, 2);
  assert.deepEqual(incoming(first.read()), ["Only the first patient"]);
  assert.deepEqual(incoming(second.read()), []);
});

test("Concurrent deliveries reserve distinct script steps and replayed scheduled jobs cannot repeat a reply", () => {
  const e = new Engine();
  const thread = conversation(e);
  const independent = conversation(e, "SIM-000021");
  thread.command({ kind: "configure_auto_reply", steps: [{ body: "First delivered request", delayMinutes: 1 }, { body: "Second delivered request", delayMinutes: 2 }] });
  independent.command({ kind: "configure_auto_reply", steps: [{ body: "Other conversation reply", delayMinutes: 1 }] });
  thread.command({ kind: "delivery", entryId: `${thread.read().id}-1`, status: "delivered" });
  thread.command({ kind: "send", body: "Another question", channel: "email" });
  thread.command({ kind: "delivery", entryId: `${thread.read().id}-2`, status: "delivered" });
  independent.command({ kind: "delivery", entryId: `${independent.read().id}-1`, status: "delivered" });
  independent.command({ kind: "reply", body: "Other patient manual reply" }, "patient");
  const queued = e.require("default").scheduled.find(job => job.type === "patient-auto-reply" && job.resourceId === thread.read().id);
  assert.ok(queued);
  e.transaction("default", world => { world.scheduled.push({ ...queued }); });
  step(e, 1);
  assert.deepEqual(incoming(thread.read()), ["First delivered request"]);
  step(e, 1);
  assert.deepEqual(incoming(thread.read()), ["First delivered request", "Second delivered request"]);
  assert.deepEqual(incoming(independent.read()), ["Other patient manual reply"]);
  assert.equal(e.events("default", "gp").filter(event => event.type === "messaging.patient_auto_reply" && event.resourceId === thread.read().id).length, 2);
});
