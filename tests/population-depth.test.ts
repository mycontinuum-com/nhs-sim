import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorld } from "../packages/engine/src/index.ts";
import { enrichPatientStories } from "../packages/engine/src/population.ts";

test("authored cohort offers distinct life histories and retains the challenge identities", () => {
  const world = seedWorld("stories", 42, 40);
  assert.deepEqual(
    world.patients.slice(0, 8).map((patient) => patient.name),
    [
      "Amira Khan",
      "George Evans",
      "Aisha Patel",
      "Thomas Reed",
      "Grace Okafor",
      "Eleanor Chen",
      "Mohammed Ali",
      "Sofia Williams",
    ],
  );
  assert.equal(world.patients[8].name, "Nina Brooks");
  assert.equal(world.patients[8].birthDate, "2018-02-09");
  assert.deepEqual(world.patients[8].conditions, ["Eczema"]);
  const contacts = world.resources.filter(
    (resource) =>
      resource.kind === "encounter" && resource.data.storyVersion === "patient-stories-v1",
  );
  assert.equal(contacts.length, 96);
  assert.equal(new Set(contacts.map((record) => record.data.text)).size, 96);
  assert.ok(contacts.some((record) => String(record.data.text).includes("school support form")));
  for (const patient of world.patients.slice(0, 32)) {
    assert.equal(contacts.filter((record) => record.patientId === patient.id).length, 3);
    assert.ok(
      contacts
        .filter((record) => record.patientId === patient.id)
        .every(
          (record) =>
            record.createdAt >= Date.parse(patient.birthDate) && record.createdAt < world.now,
        ),
    );
  }
  const before = structuredClone(world);
  enrichPatientStories(world);
  assert.deepEqual(world, before);
});

test("seeded appointment book has actual times and no clinician overlaps", () => {
  const world = seedWorld("appointments", 42, 40);
  const appointments = world.resources.filter(
    (resource) =>
      resource.kind === "appointment" && resource.data.storyVersion === "patient-stories-v1",
  );
  assert.equal(appointments.length, 12);
  assert.equal(
    new Set(appointments.map((record) => `${record.data.clinician}:${record.data.startsAt}`)).size,
    12,
  );
  for (const record of appointments) {
    assert.equal(record.status, "booked");
    assert.equal(record.data.durationMinutes, 15);
    assert.equal(record.data.capacityReserved, false);
    assert.ok(Number(record.data.startsAt) > world.now);
  }
});

test("enrichment preserves existing demographics and user records", () => {
  const world = seedWorld("legacy", 42, 40);
  world.resources = world.resources.filter(
    (record) => record.data.storyVersion !== "patient-stories-v1",
  );
  world.patients[8].name = "Edited patient name";
  world.patients[8].birthDate = "1940-01-01";
  const before = structuredClone(world.resources);
  enrichPatientStories(world);
  assert.equal(world.patients[8].name, "Edited patient name");
  assert.equal(world.patients[8].birthDate, "1940-01-01");
  assert.deepEqual(world.resources.slice(0, before.length), before);
  assert.equal(
    world.resources.some(
      (record) =>
        record.patientId === "SIM-000009" && record.data.storyVersion === "patient-stories-v1",
    ),
    false,
  );
  assert.equal(world.patients[40].name, "Nina Brooks");
  assert.equal(world.patients[40].birthDate, "2018-02-09");
  assert.equal(new Set(world.resources.map((record) => record.id)).size, world.resources.length);
  assert.equal(new Set(world.patients.map((patient) => patient.id)).size, world.patients.length);
  assert.ok(
    world.resources
      .filter((record) => /^r-\d+$/.test(record.id))
      .every((record) => Number(record.id.slice(2)) < world.nextId),
  );
  const after = structuredClone(world);
  enrichPatientStories(world);
  assert.deepEqual(world, after);
});
