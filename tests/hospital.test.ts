import test from "node:test";
import assert from "node:assert/strict";
import { Engine, SimError } from "../packages/engine/src/index.ts";
import { hospitalAttendanceSchema, hospitalMetrics } from "../packages/contracts/src/hospital.ts";
import { seedHospitalAttendances, upgradeHospitalWorld } from "../packages/engine/src/hospital-seed.ts";
const actor = { kind: "team", name: "Hospital team" } as const;
const registration = { type: "register_attendance", patientId: "SIM-000020", title: "Synthetic fall", acuity: "3", location: "Waiting room" };
const conflict = (error: unknown) => error instanceof SimError && error.status === 409;
test("hospital attendance follows a persistent attributed lifecycle and wait freezes at assessment", () => {
  const engine = new Engine();
  const arrived = engine.action("default", "hospital", registration, actor, "arrival");
  assert.equal(engine.action("default", "hospital", registration, actor, "arrival").id, arrived.id);
  const arrivalAt = engine.require("default").now;
  engine.clock("default", { advanceMinutes: 60 });
  assert.equal(hospitalMetrics([arrived], engine.require("default").now).averageWait, 60);
  const assessed = engine.action("default", "hospital", { type: "update_attendance", resourceId: arrived.id, expectedVersion: 1, hospitalCommand: "assess", clinician: "Dr Demo", location: "Majors 4" }, actor);
  assert.equal(assessed.status, "assessing");
  assert.equal(assessed.data.assessmentAt, arrivalAt + 60 * 60000);
  engine.clock("default", { advanceMinutes: 60 });
  assert.equal(hospitalMetrics([assessed], engine.require("default").now).assessedAverage, 60);
  const take = engine.action("default", "hospital", { type: "update_attendance", resourceId: arrived.id, expectedVersion: 2, hospitalCommand: "refer" }, actor);
  assert.equal(take.status, "take");
  const admitted = engine.action("default", "hospital", { type: "update_attendance", resourceId: arrived.id, expectedVersion: 3, hospitalCommand: "admit", location: "AMU 4" }, actor);
  assert.equal(admitted.status, "inpatient");
  const discharged = engine.action("default", "hospital", { type: "update_attendance", resourceId: arrived.id, expectedVersion: 4, hospitalCommand: "discharge", disposition: "Home with fictional follow-up" }, actor);
  const data = hospitalAttendanceSchema.parse(discharged.data);
  assert.equal(data.stage, "discharged");
  assert.equal(discharged.data.admittedAt, admitted.data.admittedAt);
  assert.equal(discharged.data.referredAt, take.data.referredAt);
  assert.deepEqual(discharged.provenance?.created?.actor, actor);
  assert.equal(discharged.provenance?.changes.length, 5);
  const restored = new Engine(); restored.state = JSON.parse(JSON.stringify(engine.state));
  assert.deepEqual(restored.view("default", "hospital").resources.find((r) => r.id === arrived.id), discharged);
  assert.equal(restored.action("default", "hospital", registration, actor).status, "waiting");
});
test("hospital transition guards reject duplicates, stale updates, skipped states and other services", () => {
  const engine = new Engine(); const arrived = engine.action("default", "hospital", registration, actor);
  assert.throws(() => engine.action("default", "hospital", registration, actor), conflict);
  for (const hospitalCommand of ["refer", "admit"]) assert.throws(() => engine.action("default", "hospital", { type: "update_attendance", resourceId: arrived.id, expectedVersion: 1, hospitalCommand, location: "AMU 2" }, actor), conflict);
  assert.throws(() => engine.action("default", "hospital", { type: "update_attendance", resourceId: arrived.id, expectedVersion: 9, hospitalCommand: "assign", clinician: "Dr Demo" }, actor), conflict);
  assert.throws(() => engine.action("default", "gp", registration, actor), (e: unknown) => e instanceof SimError && e.status === 403);
  engine.create("other");
  assert.equal(engine.view("other", "hospital").resources.some((r) => r.id === arrived.id), false);
  assert.throws(() => engine.action("other", "hospital", { type: "update_attendance", resourceId: arrived.id, expectedVersion: 1, hospitalCommand: "assign", clinician: "Dr Demo" }, actor));
});
test("hospital seed upgrade is additive and idempotent, and empty means are absent", () => {
  const engine = new Engine(); const world = engine.require("default");
  const originalCount = world.resources.length; seedHospitalAttendances(world); assert.equal(world.resources.length, originalCount);
  delete world.counters.hospitalAttendanceVersion; seedHospitalAttendances(world); assert.equal(world.resources.length, originalCount);
  assert.equal(hospitalMetrics([], world.now).averageWait, null);
  assert.equal(hospitalMetrics([], world.now).assessedAverage, null);
});

test("hospital startup upgrade preserves immutable historical rows and original world", () => {
  const engine = new Engine();
  const world = engine.require("default");
  delete world.counters.hospitalAttendanceVersion;
  world.resources = world.resources.filter((r) => r.kind !== "hospital-attendance");
  const before = JSON.stringify(world);
  Object.freeze(world.resources); Object.freeze(world.counters); Object.freeze(world);
  const upgraded = upgradeHospitalWorld(world);
  assert.equal(JSON.stringify(world), before);
  assert.equal(upgraded.patients, world.patients);
  assert.equal(upgraded.resources[0], world.resources[0]);
  assert.equal(upgraded.resources.length, world.resources.length + 8);
  assert.equal(upgradeHospitalWorld(upgraded), upgraded);
});

test("hospital upgrade repairs a team whose old baseline attachment discarded attendance seeds", () => {
  const engine = new Engine();
  const world = engine.require("default");
  world.counters.hospitalAttendanceVersion = 1;
  world.resources = world.resources.filter((r) => r.kind !== "hospital-attendance");
  const upgraded = upgradeHospitalWorld(world);
  assert.equal(upgraded.resources.filter((r) => r.kind === "hospital-attendance").length, 8);
  assert.equal(upgraded.counters.hospitalAttendanceVersion, 2);
  assert.equal(upgradeHospitalWorld(upgraded), upgraded);
});
