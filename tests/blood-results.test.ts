import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { bloodResultSchema } from "../packages/contracts/src/blood-results.ts";
import { seedBloodResults, seedPatientBloodResults, upgradeBloodResultWorld } from "../packages/engine/src/blood-results.ts";

function unseededWorld() {
  const initial = new Engine().require("default");
  return { ...initial, resources: initial.resources.filter(resource => !resource.id.startsWith("blood-v1-")), counters: { ...initial.counters, bloodResultVersion: 0 } };
}

test("Every patient has six dated synthetic reports for each common blood panel", () => {
  const initial = unseededWorld();
  const world = upgradeBloodResultWorld(initial);
  const reports = world.resources.filter(resource => resource.id.startsWith("blood-v1-"));
  assert.equal(reports.length, world.patients.length * 36);
  for (const patient of world.patients) {
    const patientReports = reports.filter(report => report.patientId === patient.id);
    assert.equal(patientReports.length, 36);
    for (const panelId of ["fbc", "ue", "hba1c", "lft", "crp", "lipids"]) {
      const history = patientReports.map(report => bloodResultSchema.parse(report.data)).filter(result => result.panel.id === panelId);
      assert.equal(history.length, 6);
      assert.equal(new Set(history.map(result => result.collectedAt)).size, 6);
      const historySpan = Math.min(365 * 86400000, world.now - Date.parse(patient.birthDate));
      assert.equal(Math.max(...history.map(result => result.collectedAt)), world.now - historySpan / 365);
      assert.equal(Math.min(...history.map(result => result.collectedAt)), world.now - historySpan);
      assert.ok(history.every(result => result.collectedAt >= Date.parse(patient.birthDate) && result.collectedAt <= world.now));
      assert.ok(history.every(result => result.synthetic && result.analytes.every(analyte => Number.isFinite(analyte.value) && analyte.unit && analyte.referenceLow <= analyte.referenceHigh)));
      assert.ok(new Set(history.flatMap(result => result.analytes.map(analyte => analyte.value))).size > 1);
    }
  }
  for (const report of reports) {
    const data = bloodResultSchema.parse(report.data);
    const whiteCells = data.analytes.find(analyte => analyte.id === "white-cell-count");
    const neutrophils = data.analytes.find(analyte => analyte.id === "neutrophils");
    if (whiteCells && neutrophils) assert.ok(neutrophils.value <= whiteCells.value);
    assert.equal(report.kind, "report");
    assert.equal(report.owner, "diagnostics");
    assert.equal(report.status, "available");
    assert.deepEqual(report.visibleTo, ["gp", "hospital", "diagnostics"]);
    assert.ok(report.createdAt <= world.now);
    assert.equal(report.provenance?.created?.actor.name, "Dr Robin Vial");
  }
});

test("Blood seed is deterministic, idempotent and preserves edits during partial upgrades", () => {
  const initial = unseededWorld();
  const first = upgradeBloodResultWorld(initial);
  const second = upgradeBloodResultWorld(initial);
  assert.deepEqual(first, second);
  assert.equal(initial.counters.bloodResultVersion, 0);
  assert.equal(upgradeBloodResultWorld(first), first);
  const report = first.resources.find(resource => resource.id.startsWith("blood-v1-"));
  assert.ok(report);
  const edited = { ...report, title: "Team-reviewed laboratory report", version: 3 };
  const partial = { ...initial, resources: [...initial.resources, edited] };
  const upgraded = upgradeBloodResultWorld(partial);
  assert.equal(upgraded.resources.find(resource => resource.id === edited.id), edited);
  assert.equal(upgraded.resources.length, first.resources.length);
  seedBloodResults(upgraded);
  assert.equal(upgraded.resources.length, first.resources.length);
  const future = { ...first, counters: { ...first.counters, bloodResultVersion: 2 } };
  assert.equal(upgradeBloodResultWorld(future), future);
});

test("Empty cohorts do not receive blood reports", () => {
  const initial = unseededWorld();
  const world = upgradeBloodResultWorld({ ...initial, patients: [], resources: [] });
  assert.deepEqual(world.resources, []);
  assert.equal(world.counters.bloodResultVersion, 1);
});


test("Infant histories stay within their lifetime and portal results respect visibility", () => {
  const initial = unseededWorld();
  const patient = initial.patients[0];
  assert.ok(patient);
  const birthDate = new Date(initial.now - 14 * 86400000).toISOString().slice(0, 10);
  const infant = upgradeBloodResultWorld({ ...initial, patients: [{ ...patient, birthDate }], resources: [] });
  assert.equal(infant.resources.length, 36);
  for (const resource of infant.resources) {
    const result = bloodResultSchema.parse(resource.data);
    assert.ok(result.collectedAt >= Date.parse(birthDate));
    assert.ok(resource.createdAt >= result.collectedAt && resource.createdAt <= infant.now);
  }
  assert.equal(new Set(infant.resources.map(resource => bloodResultSchema.parse(resource.data).collectedAt)).size, 6);
  const engine = new Engine();
  for (const site of ["gp", "hospital"] satisfies ("gp" | "hospital")[]) {
    const labs = engine.view("default", site, patient.id).resources.filter(resource => bloodResultSchema.safeParse(resource.data).success);
    assert.equal(labs.length, 36);
    assert.ok(labs.every(resource => resource.patientId === patient.id));
  }
  assert.equal(engine.view("default", "wearables", patient.id).resources.filter(resource => bloodResultSchema.safeParse(resource.data).success).length, 0);
});

test("Existing large cohorts seed only the opened patient and preserve that history", async () => {
  const { seedPatientBloodResults } = await import("../packages/engine/src/blood-results.ts");
  const world = unseededWorld();
  const patient = world.patients[5];
  assert.ok(patient);
  const before = world.resources.length;
  seedPatientBloodResults(world, patient.id);
  assert.equal(world.resources.length, before + 36);
  assert.ok(world.resources.slice(before).every(resource => resource.patientId === patient.id));
  world.now += 86400000;
  seedPatientBloodResults(world, patient.id);
  assert.equal(world.resources.length, before + 36);
  seedPatientBloodResults(world, "missing-patient");
  assert.equal(world.resources.length, before + 36);
});

test("A patient added after cohort seeding still receives their own blood history", async () => {
  const { seedPatientBloodResults } = await import("../packages/engine/src/blood-results.ts");
  const world = new Engine().require("default");
  const template = world.patients[0];
  assert.ok(template);
  world.patients.push({ ...template, id: "SIM-NEW-PATIENT" });
  seedPatientBloodResults(world, "SIM-NEW-PATIENT");
  assert.equal(world.resources.filter(resource => resource.patientId === "SIM-NEW-PATIENT").length, 36);
});

test("Patient blood seeding sees additions and edited reports in the same transaction", () => {
  const engine = new Engine();
  const patient = { ...engine.require("default").patients[0], id: "SIM-DRAFT-PATIENT" };
  const sample: ReturnType<Engine["require"]> = { ...engine.require("default"), patients: [patient], resources: [], counters: {} };
  seedBloodResults(sample);
  const report = sample.resources[0];
  assert.ok(report);
  engine.transaction("default", world => {
    world.patients.push(patient);
    world.resources.push(report);
    const pending = world.resources[world.resources.length - 1];
    pending.title = "Reviewed during this transaction";
    pending.data.reviewed = true;
    seedPatientBloodResults(world, patient.id);
    seedPatientBloodResults(world, patient.id);
  });
  const reports = engine.require("default").resources.filter(resource => resource.patientId === patient.id);
  assert.equal(reports.length, 36);
  assert.equal(new Set(reports.map(resource => resource.id)).size, 36);
  assert.equal(reports.find(resource => resource.id === report.id)?.title, "Reviewed during this transaction");
  assert.equal(reports.find(resource => resource.id === report.id)?.data.reviewed, true);
  assert.equal(engine.require("default").counters[`bloodPatient:${patient.id}`], 1);
});
