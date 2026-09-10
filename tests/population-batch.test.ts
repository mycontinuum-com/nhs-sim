import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generatePopulationBatch,
  populationBatchManifest,
} from "../packages/engine/src/population-batch.ts";
const input = { seed: 42, start: 501, count: 100, now: Date.parse("2026-09-12T08:00:00Z") };

test("population batches are deterministic independent of chunk boundaries", () => {
  const whole = generatePopulationBatch(input);
  const first = generatePopulationBatch({ ...input, count: 37 });
  const second = generatePopulationBatch({ ...input, start: 538, count: 63 });
  assert.deepEqual(whole.patients, [...first.patients, ...second.patients]);
  assert.deepEqual(whole.resources, [...first.resources, ...second.resources]);
  assert.deepEqual(whole, generatePopulationBatch(input));
  assert.notDeepEqual(whole.patients, generatePopulationBatch({ ...input, seed: 43 }).patients);
  assert.deepEqual(input, {
    seed: 42,
    start: 501,
    count: 100,
    now: Date.parse("2026-09-12T08:00:00Z"),
  });
  assert.equal(populationBatchManifest(input).endExclusive, 601);
  assert.equal(whole.patients[0].id, "SIM-000501");
  assert.equal(whole.patients.at(-1)?.id, "SIM-000600");
});

test("life courses have bounded, chronological records and consistent active conditions", () => {
  const batch = generatePopulationBatch({ ...input, count: 1000 });
  assert.equal(batch.patients.length, 1000);
  assert.equal(new Set(batch.resources.map((record) => record.id)).size, batch.resources.length);
  assert.ok(batch.resources.length <= 10000);
  for (const patient of batch.patients) {
    const records = batch.resources.filter((record) => record.patientId === patient.id);
    const contacts = records.filter((record) => record.kind === "encounter");
    assert.ok(contacts.length >= 3 && contacts.length <= 8);
    assert.deepEqual(
      contacts.map((record) => record.createdAt),
      contacts.map((record) => record.createdAt).sort((a, b) => a - b),
    );
    assert.ok(
      records.every(
        (record) =>
          record.createdAt >= Date.parse(patient.birthDate) && record.createdAt <= input.now,
      ),
    );
    const ehr = records.find((record) => record.kind === "ehr-record");
    assert.ok(ehr);
    assert.ok(Array.isArray(ehr.data.problems));
    assert.deepEqual(
      ehr.data.problems
        .filter((problem) => problem.status === "active")
        .map((problem) => problem.term),
      patient.conditions,
    );
    const sizes = [ehr.data.problems, ehr.data.medications, ehr.data.allergies, ehr.data.miscCodes];
    assert.ok(sizes.every(Array.isArray));
    assert.ok(
      sizes.reduce(
        (total, collection) => total + (Array.isArray(collection) ? collection.length : 0),
        0,
      ) <= 28,
    );
    assert.ok(
      contacts.every(
        (record) =>
          record.data.synthetic === true &&
          typeof record.data.text === "string" &&
          record.data.text.length > 100,
      ),
    );
    if (input.now - Date.parse(patient.birthDate) < 5 * 365.25 * 86_400_000) {
      assert.equal(patient.needs[0], "Parent contact");
      assert.equal(String(ehr.data.context).includes("Works "), false);
      assert.equal(patient.conditions.includes("Osteoarthritis"), false);
    }
  }
});

test("batch validation prevents invalid sizes and snapshots do not share mutable state", () => {
  assert.throws(() => generatePopulationBatch({ ...input, count: 1001 }));
  assert.throws(() => generatePopulationBatch({ ...input, start: 0 }));
  assert.throws(() => generatePopulationBatch({ ...input, now: NaN }));
  assert.deepEqual(generatePopulationBatch({ ...input, count: 0 }).patients, []);
  const batch = generatePopulationBatch({ ...input, count: 2 });
  batch.patients[0].name = "Edited";
  batch.resources[0].data.context = "Edited";
  assert.notEqual(generatePopulationBatch({ ...input, count: 2 }).patients[0].name, "Edited");
  assert.notEqual(batch.resources[1].data.context, "Edited");
});

test("public appointment marginals retain unknown outcomes without fabricated consultations", () => {
  const batch = generatePopulationBatch({ ...input, count: 1000 });
  const appointments = batch.resources.filter((record) => record.kind === "appointment");
  assert.equal(appointments.length, 1000);
  assert.ok(appointments.some((record) => record.status === "unknown"));
  assert.ok(appointments.some((record) => record.status === "missed"));
  assert.ok(appointments.some((record) => record.status === "completed"));
  assert.ok(new Set(appointments.map((record) => record.data.sourceMode)).size >= 4);
  for (const appointment of appointments) {
    assert.equal(appointment.data.calibrationPeriod, "2025-05");
    assert.equal(appointment.data.capacityReserved, false);
    assert.ok(Number(appointment.data.startsAt) < input.now);
    assert.equal(
      appointment.status,
      appointment.data.sourceStatus === "Attended"
        ? "completed"
        : appointment.data.sourceStatus === "DNA"
          ? "missed"
          : "unknown",
    );
    assert.equal("text" in appointment.data, false);
  }
});
