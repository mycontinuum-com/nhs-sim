import test from "node:test";
import assert from "node:assert/strict";
import { Engine, SimError } from "../packages/engine/src/index.ts";
import { patientAllergies } from "../packages/contracts/src/allergies.ts";
const patientId = "SIM-000003";
const action = { type: "save_allergy", patientId, title: "Synthetic allergen", allergyStatus: "active", reaction: "Fictional rash" };
const conflict = (error: unknown) => error instanceof SimError && error.status === 409;
test("allergies record reaction, preserve author on edit, deactivate and restore across persistence", () => {
  const engine = new Engine();
  const conditions = engine.require("default").patients.find((patient) => patient.id === patientId)!.conditions.slice();
  const added = engine.action("default", "gp", action, "Orchard", "allergy-once");
  assert.equal(added.kind, "allergy");
  assert.equal(added.data.reaction, "Fictional rash");
  assert.equal(engine.action("default", "gp", action, "Orchard", "allergy-once").id, added.id);
  const edited = engine.action("default", "gp", { ...action, resourceId: added.id, expectedVersion: 1, reaction: "Updated fictional reaction" }, "Meadow");
  assert.equal(edited.provenance?.created?.actor.name, "Orchard");
  assert.equal(edited.provenance?.changes.at(-1)?.actor.name, "Meadow");
  const inactive = engine.action("default", "gp", { ...action, resourceId: added.id, expectedVersion: 2, allergyStatus: "inactive" }, "Meadow");
  const restored = new Engine(); restored.state = JSON.parse(JSON.stringify(engine.state));
  const allergy = patientAllergies(restored.require("default").resources, patientId).find((entry) => entry.key === added.id);
  assert.equal(allergy?.status, "inactive");
  assert.equal(allergy?.record?.provenance?.changes.length, 3);
  const reactivated = restored.action("default", "gp", { ...action, resourceId: added.id, expectedVersion: inactive.version }, "Orchard");
  assert.equal(reactivated.status, "active");
  assert.deepEqual(restored.require("default").patients.find((patient) => patient.id === patientId)!.conditions, conditions);
});
test("historical allergy edits keep unknown original author and do not mutate seed resources", () => {
  const engine = new Engine();
  const historicalRecord = engine.require("default").resources.find((resource) => resource.kind === "ehr-record" && Array.isArray(resource.data.allergies) && resource.data.allergies.length)!;
  assert.ok(historicalRecord);
  const historyPatient = historicalRecord.patientId!;
  const historical = patientAllergies(engine.require("default").resources, historyPatient)[0]!;
  const before = JSON.stringify(historicalRecord);
  const update = { ...action, patientId: historyPatient, title: historical.term, sourceAllergyKey: historical.key, allergyStatus: "inactive" };
  const edited = engine.action("default", "gp", update, "Orchard");
  assert.equal(edited.provenance?.created, null);
  assert.equal(edited.provenance?.changes[0]?.actor.name, "Orchard");
  assert.equal(patientAllergies(engine.require("default").resources, historyPatient).filter((entry) => entry.term === historical.term).length, 1);
  assert.equal(JSON.stringify(historicalRecord), before);
  assert.throws(() => engine.action("default", "gp", update, "Orchard"), conflict);
});
test("allergy editor rejects duplicates, stale edits, cross-patient edits and unauthorised services", () => {
  const engine = new Engine();
  assert.throws(() => engine.action("default", "pharmacy", action, "Orchard"), /Only primary care/);
  assert.throws(() => engine.action("default", "gp", { ...action, title: " " }, "Orchard"));
  const added = engine.action("default", "gp", action, "Orchard");
  assert.throws(() => engine.action("default", "gp", action, "Meadow"), conflict);
  assert.throws(() => engine.action("default", "gp", { ...action, patientId: "SIM-000002", resourceId: added.id, expectedVersion: 1 }, "Meadow"), conflict);
  assert.throws(() => engine.action("default", "gp", { ...action, resourceId: added.id, expectedVersion: 9 }, "Meadow"), conflict);
  assert.throws(() => engine.action("default", "gp", { type: "complete", resourceId: added.id }, "Meadow"), /allergy editor/);
  assert.equal(patientAllergies(engine.require("default").resources, patientId).find((entry) => entry.key === added.id)?.record?.provenance?.changes.length, 1);
});
test("care teams see allergy updates and historical deactivation without gaining write access", () => {
  const engine = new Engine();
  const added = engine.action("default", "gp", action, "Orchard");
  for (const site of ["hospital", "pharmacy", "community", "patient"] as const) {
    const visible = engine.view("default", site, patientId).resources;
    assert.equal(patientAllergies(visible, patientId).find((allergy) => allergy.key === added.id)?.status, "active");
    assert.throws(() => engine.action("default", site, { ...action, resourceId: added.id, expectedVersion: 1 }, "Orchard"), /Only primary care/);
  }
  const historicalRecord = engine.require("default").resources.find((resource) => resource.kind === "ehr-record" && Array.isArray(resource.data.allergies) && resource.data.allergies.length)!;
  const historyPatient = historicalRecord.patientId!;
  engine.action("default", "gp", { type: "share_record", resourceId: historicalRecord.id, target: "hospital" }, "Orchard");
  engine.action("default", "gp", { type: "share_record", resourceId: historicalRecord.id, target: "pharmacy" }, "Orchard");
  const historical = patientAllergies(engine.require("default").resources, historyPatient)[0]!;
  engine.action("default", "gp", { ...action, patientId: historyPatient, title: historical.term, sourceAllergyKey: historical.key, allergyStatus: "inactive" }, "Orchard");
  for (const site of ["hospital", "pharmacy"] as const) {
    const visible = patientAllergies(engine.view("default", site, historyPatient).resources, historyPatient).filter((allergy) => allergy.term === historical.term);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.status, "inactive");
  }
});

test("migrated allergy keys preserve reactions and clinician overrides after reordering", () => {
  const engine = new Engine();
  let sourceKey = "";
  engine.transaction("default", (world) => {
    const record = world.resources.find((row) => row.kind === "ehr-record" && row.patientId === patientId)!;
    sourceKey = `${record.id}:7`;
    record.data.allergies = [{ key: sourceKey, term: "Latex", reaction: "Contact rash", status: "active" }];
  });
  const before = patientAllergies(engine.require("default").resources, patientId);
  assert.equal(before.find((row) => row.key === sourceKey)?.reaction, "Contact rash");
  engine.action("default", "gp", { ...action, title: "Latex", sourceAllergyKey: sourceKey, allergyStatus: "inactive", reaction: "History reviewed" }, "Orchard");
  const after = patientAllergies(engine.require("default").resources, patientId).filter((row) => row.term === "Latex");
  assert.equal(after.length, 1);
  assert.equal(after[0].status, "inactive");
});
