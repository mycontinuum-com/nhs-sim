import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Engine } from "../packages/engine/src/index.ts";
import { mortalityFixtures, seedMortality, syntheticDeath } from "../packages/engine/src/mortality.ts";
import { conversationSchema, patientReplyPresets, type MessagingCommand } from "../packages/contracts/src/messaging.ts";
import { patientDeathSchema } from "../packages/contracts/src/mortality.ts";
import { generatePopulationBatch } from "../packages/engine/src/population-batch.ts";
import { replenishCalls } from "../packages/engine/src/telephony.ts";
import { handleFhir } from "../packages/nhs-mocks/src/fhir.ts";
import { bundle } from "../packages/nhs-mocks/src/index.ts";

test("authored deceased fixtures preserve demographics, differ in age and cause, and serialize through both FHIR adapters", () => {
  const engine = new Engine();
  const world = engine.require("default");
  const deceased = world.patients.filter(patient => patient.death);
  assert.deepEqual(deceased.map(patient => patient.id), [...mortalityFixtures.keys()]);
  assert.deepEqual(deceased.map(patient => patient.death?.cause), ["Road traffic collision", "Pneumonia", "Sepsis", "Cancer", "Stroke"]);
  assert.ok(new Set(deceased.map(patient => patient.birthDate.slice(0, 4))).size >= 4);
  for (const patient of deceased) {
    const death = patientDeathSchema.parse(patient.death);
    assert.ok(patient.birthDate <= death.date);
    assert.ok(Date.parse(death.date) <= world.now);
    const response = handleFhir({ engine, world: world.id, method: "GET", url: new URL(`http://localhost/api/nhs/pds/Patient/${patient.id}`) });
    assert.equal(response?.status, 200);
    const fhir = z.object({ deceasedDateTime: z.string(), active: z.boolean() }).parse(response?.body);
    assert.equal(fhir.deceasedDateTime, death.date);
    assert.equal(fhir.active, true);
    const legacy = z.object({ entry: z.array(z.object({ resource: z.object({ deceasedDateTime: z.string() }) })) }).parse(bundle(engine, world.id, "pds", patient.id));
    assert.equal(legacy.entry[0].resource.deceasedDateTime, death.date);
  }
  const living = world.patients.find(patient => patient.id === "SIM-000001")!;
  assert.equal(living.death, undefined);
  const response = handleFhir({ engine, world: world.id, method: "GET", url: new URL(`http://localhost/api/nhs/pds/Patient/${living.id}`) });
  assert.equal(Object.hasOwn(response!.body, "deceasedDateTime"), false);
});

test("mortality generation is deterministic and does not mutate shared patient arrays or change existing deaths", () => {
  const engine = new Engine();
  const patients = engine.require("default").patients.map(({ death, ...patient }) => patient);
  const original = structuredClone(patients);
  const now = Date.parse("2026-09-12T08:00:00Z");
  const updated = seedMortality(patients, now);
  assert.deepEqual(patients, original);
  assert.notEqual(updated, patients);
  assert.equal(updated[0], patients[0]);
  assert.equal(seedMortality(updated, now + 86400000), updated);
  assert.equal(syntheticDeath({id: "SIM-000009", birthDate: "2030-01-01"}, now), undefined);
  assert.equal(syntheticDeath({id: "SIM-000009", birthDate: "2026-09-11"}, now)?.date, "2026-09-11");
  const generated = generatePopulationBatch({ seed: 42, start: 1, count: 25, now });
  assert.deepEqual(generated.patients.filter(patient => patient.death).map(patient => patient.id), [...mortalityFixtures.keys()]);
});

test("future demand and telephony avoid deceased patients while retained histories remain readable", () => {
  const engine = new Engine();
  const before = engine.require("default");
  const retained = before.resources.filter(resource => mortalityFixtures.has(resource.patientId ?? "")).map(resource => resource.id);
  const previous = new Set(before.resources.map(resource => resource.id));
  engine.clock("default", { advanceMinutes: 1500 });
  engine.fault("default", "demand-surge", true);
  engine.fault("default", "winter-pressure", true);
  const world = engine.require("default");
  replenishCalls(world, world.now);
  assert.ok(retained.every(id => world.resources.some(resource => resource.id === id)));
  assert.equal(world.resources.filter(resource => !previous.has(resource.id) && mortalityFixtures.has(resource.patientId ?? "")).length, 0);
  world.patients = world.patients.filter(patient => patient.death);
  world.resources = [];
  replenishCalls(world, world.now);
  engine.clock("default", { advanceMinutes: 60 });
  assert.equal(engine.require("default").resources.filter(resource => resource.patientId).length, 0);
});


test("deceased patients do not send scheduled scripted replies after message delivery", () => {
  const engine = new Engine();
  const patientId = "SIM-000009";
  assert.ok(engine.require("default").patients.find(patient => patient.id === patientId)?.death);
  const created = engine.action("default", "gp", {
    type: "messaging_action", patientId,
    messagingCommand: { kind: "create", subject: "Administrative message", body: "Please confirm receipt", channel: "sms", allowReply: true },
  }, "Dr Rowan Page");
  const read = () => {
    const resource = engine.require("default").resources.find(resource => resource.id === created.id);
    assert.ok(resource);
    return resource;
  };
  const command = (messagingCommand: MessagingCommand) => engine.action("default", "gp", {
    type: "messaging_action", patientId, resourceId: created.id, expectedVersion: read().version, messagingCommand,
  }, "Dr Rowan Page");
  const preset = patientReplyPresets.find(item => item.id === "acknowledgment");
  assert.ok(preset);
  command({ kind: "configure_auto_reply", steps: preset.steps });
  command({ kind: "delivery", entryId: `${created.id}-1`, status: "delivered" });
  assert.ok(engine.require("default").scheduled.some(job => job.type === "patient-auto-reply" && job.resourceId === created.id));
  engine.clock("default", { paused: true, advanceMinutes: 5 });
  const entries = conversationSchema.parse(read().data).entries;
  assert.deepEqual(entries.filter(entry => entry.direction === "incoming"), []);
  assert.equal(entries[0].body, "Please confirm receipt");
  assert.equal(engine.events("default", "gp").filter(event => event.type === "messaging.patient_auto_reply" && event.resourceId === created.id).length, 0);
});
