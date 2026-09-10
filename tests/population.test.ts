import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine, seedWorld } from "../packages/engine/src/index.ts";

test("resource pages retain visibility and selected patient boundaries", () => {
  const engine = new Engine();
  const all = engine.view("default", "gp");
  const page = engine.view("default", "gp", undefined, { offset: 10, limit: 20 });
  assert.equal(page.resources.length, 20);
  assert.equal(page.resourceTotal, all.resources.length);
  assert.deepEqual(page.resources, all.resources.slice(10, 30));
  const patient = engine.view("default", "gp", "SIM-000010", { offset: 0, limit: 200 });
  assert.ok(
    patient.resources.every(
      (record) =>
        record.visibleTo.includes("gp") && (!record.patientId || record.patientId === "SIM-000010"),
    ),
  );
});

test("synthetic population is reproducible and changes with the seed", () => {
  const first = seedWorld("sample", 42, 100);
  assert.deepEqual(first, seedWorld("sample", 42, 100));
  assert.notDeepEqual(first.patients.slice(8), seedWorld("sample", 43, 100).patients.slice(8));
  assert.equal(first.patients[0].name, "Amira Khan");
  assert.ok(new Set(first.patients.map((patient) => patient.birthDate)).size > 80);
});

test("every patient has fictional EHR collections and dated history", () => {
  const world = seedWorld("sample", 42, 500);
  for (const patient of world.patients) {
    const records = world.resources.filter((resource) => resource.patientId === patient.id);
    const ehr = records.find((resource) => resource.kind === "ehr-record");
    assert.ok(ehr);
    assert.equal(ehr.data.provenance, "ehr-collection-shape-v1");
    assert.equal(ehr.data.synthetic, true);
    assert.deepEqual(ehr.visibleTo, ["gp"]);
    assert.ok(
      records.some((resource) => resource.kind === "encounter" && resource.createdAt < world.now),
    );
    const medications = ehr.data.medications;
    assert.ok(Array.isArray(medications));
    for (const medication of medications) {
      assert.doesNotMatch(medication.term, /SYNTHETIC-MED/);
      assert.ok(medication.indication);
      assert.equal("dosage" in medication, false);
    }
    assert.match(patient.id, /^SIM-\d{6}$/);
    assert.ok(Date.parse(patient.birthDate) < world.now);
    for (const record of records) {
      assert.ok(record.createdAt >= Date.parse(patient.birthDate));
    }
  }
  const signatures = world.resources
    .filter((resource) => resource.kind === "ehr-record")
    .map((resource) =>
      JSON.stringify([resource.data.problems, resource.data.medications, resource.data.allergies]),
    );
  assert.ok(new Set(signatures).size > 50);
});
