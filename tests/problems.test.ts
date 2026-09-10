import test from "node:test";
import assert from "node:assert/strict";
import { Engine, SimError } from "../packages/engine/src/index.ts";
import { patientProblems } from "../packages/contracts/src/problems.ts";
const patientId = "SIM-000003";
const action = { type: "save_problem", patientId, title: "Fictional knee problem", problemStatus: "active", problemCode: "SIM-TEST", onsetDate: "2026-09-01" };
const conflict = (error: unknown) => error instanceof SimError && error.status === 409;
function problems(engine: Engine) {
  const world = engine.require("default");
  return patientProblems(world.resources, world.patients.find((patient) => patient.id === patientId)!);
}
test("GP problems add, edit, resolve and reactivate with persistent team attribution", () => {
  const engine = new Engine();
  const baseline = engine.require("default");
  const before = baseline.patients.find((patient) => patient.id === patientId)!.conditions.slice();
  const added = engine.action("default", "gp", action, "Orchard", "add-once");
  assert.equal(added.kind, "problem");
  assert.deepEqual(added.data, { code: "SIM-TEST", onsetDate: "2026-09-01" });
  assert.equal(engine.action("default", "gp", action, "Orchard", "add-once").id, added.id);
  assert.deepEqual(baseline.patients.find((patient) => patient.id === patientId)!.conditions, before);
  const changed = engine.action("default", "gp", { ...action, title: "Fictional knee symptoms", resourceId: added.id, expectedVersion: 1 }, "Meadow");
  assert.equal(changed.provenance?.created?.actor.name, "Orchard");
  assert.equal(changed.provenance?.changes.at(-1)?.actor.name, "Meadow");
  assert.equal(changed.version, 2);
  assert.throws(() => engine.action("default", "gp", { ...action, resourceId: added.id, expectedVersion: 1 }, "Meadow"), conflict);
  const resolved = engine.action("default", "gp", { ...action, title: changed.title, problemStatus: "resolved", resourceId: added.id, expectedVersion: 2 }, "Meadow");
  assert.equal(problems(engine).find((problem) => problem.key === added.id)?.status, "resolved");
  assert.ok(!engine.require("default").patients.find((patient) => patient.id === patientId)!.conditions.includes(changed.title));
  const restored = new Engine(); restored.state = JSON.parse(JSON.stringify(engine.state));
  const reopened = restored.action("default", "gp", { ...action, title: changed.title, resourceId: added.id, expectedVersion: resolved.version }, "Orchard");
  assert.equal(reopened.provenance?.changes.length, 4);
  assert.ok(restored.require("default").patients.find((patient) => patient.id === patientId)!.conditions.includes(changed.title));
});
test("historical problems can be resolved once without inventing the original author", () => {
  const engine = new Engine();
  const historical = problems(engine).find((problem) => problem.status === "active")!;
  const edit = { ...action, title: historical.term, problemStatus: "resolved", sourceProblemKey: historical.key };
  const resolved = engine.action("default", "gp", edit, "Orchard");
  assert.equal(resolved.provenance?.created, null);
  assert.equal(resolved.provenance?.changes.length, 1);
  assert.equal(problems(engine).filter((problem) => problem.term === historical.term).length, 1);
  assert.equal(problems(engine).find((problem) => problem.term === historical.term)?.status, "resolved");
  assert.throws(() => engine.action("default", "gp", edit, "Orchard"), conflict);
});
test("problem writes reject other services, mismatched patients, duplicates and invalid dates", () => {
  const engine = new Engine();
  assert.throws(() => engine.action("default", "pharmacy", action, "Orchard"), /Only primary care/);
  assert.throws(() => engine.action("default", "gp", { ...action, onsetDate: "2026-02-30" }, "Orchard"));
  const added = engine.action("default", "gp", action, "Orchard");
  assert.throws(() => engine.action("default", "gp", action, "Orchard"), conflict);
  assert.throws(() => engine.action("default", "gp", { ...action, patientId: "SIM-000002", resourceId: added.id, expectedVersion: 1 }, "Orchard"), conflict);
  assert.throws(() => engine.action("default", "gp", { type: "complete", resourceId: added.id }, "Orchard"), /problem editor/);
  assert.equal(problems(engine).filter((problem) => problem.key === added.id).length, 1);
  assert.equal(problems(engine).find((problem) => problem.key === added.id)?.record?.provenance?.changes.length, 1);
});
test("GP may review a visible available diagnostic test but cannot manage hidden or pending tests", () => {
  const engine = new Engine();
  const pending = engine.action("default", "gp", { type: "order_test", patientId, title: "Synthetic blood test" }, "Orchard");
  assert.throws(() => engine.action("default", "gp", { type: "review", resourceId: pending.id }, "Orchard"), /Only owning service/);
  engine.clock("default", { advanceMinutes: 121 });
  const available = engine.require("default").resources.find((resource) => resource.id === pending.id)!;
  assert.equal(available.status, "available");
  const reviewed = engine.action("default", "gp", { type: "review", resourceId: available.id, expectedVersion: available.version }, "Orchard");
  assert.equal(reviewed.status, "reviewed");
  assert.equal(reviewed.provenance?.changes.at(-1)?.actor.name, "Orchard");
  assert.throws(() => engine.action("default", "gp", { type: "complete", resourceId: reviewed.id }, "Orchard"), /Only owning service/);
  engine.transaction("default", (world) => {
    const resource = world.resources.find((item) => item.id === pending.id)!;
    resource.status = "available"; resource.visibleTo = ["diagnostics"];
  });
  assert.throws(() => engine.action("default", "gp", { type: "review", resourceId: pending.id }, "Orchard"), /not visible/);
});
test("shared historical problem resolution reaches other care teams", () => {
  const engine = new Engine();
  const world = engine.require("default");
  const historicalRecord = world.resources.find((resource) => resource.kind === "ehr-record" && Array.isArray(resource.data.problems) && resource.data.problems.length)!;
  const historyPatient = historicalRecord.patientId!;
  const patient = world.patients.find((item) => item.id === historyPatient)!;
  const historical = patientProblems(world.resources, patient).find((problem) => problem.key.startsWith(historicalRecord.id + ":"))!;
  for (const site of ["hospital", "pharmacy"] as const) engine.action("default", "gp", { type: "share_record", resourceId: historicalRecord.id, target: site }, "Orchard");
  const resolved = engine.action("default", "gp", { ...action, patientId: historyPatient, title: historical.term, sourceProblemKey: historical.key, problemStatus: "resolved" }, "Orchard");
  const updatedPatient = engine.require("default").patients.find((item) => item.id === historyPatient)!;
  for (const site of ["hospital", "pharmacy"] as const) {
    const visible = patientProblems(engine.view("default", site, historyPatient).resources, updatedPatient).filter((problem) => problem.term === historical.term);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.status, "resolved");
    assert.throws(() => engine.action("default", site, { ...action, patientId: historyPatient, resourceId: resolved.id, expectedVersion: 1 }, "Orchard"), /Only primary care/);
  }
});
