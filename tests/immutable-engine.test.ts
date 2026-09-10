import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { runPlanLab } from "../packages/engine/src/plan-lab.ts";

test("throwing a transaction restores its original state without leaked records or events", () => {
  const engine = new Engine();
  const before = engine.state;
  const content = JSON.stringify(before);
  assert.throws(() => engine.transaction("default", (world) => {
    world.paused = false;
    engine.action("default", "gp", {
      type: "create_task", patientId: "SIM-000001", title: "Rolled back task",
    }, "test", "rolled-back");
    throw new Error("Abort this operation");
  }), /Abort this operation/);
  assert.equal(engine.state, before);
  assert.equal(JSON.stringify(engine.state), content);
  assert.equal(engine.require("default").resources.some((r) => r.title === "Rolled back task"), false);
});

test("editing one consultation retains unrelated rows and leaves earlier snapshots unchanged", () => {
  const engine = new Engine();
  engine.create("other-team");
  const draft = engine.action("default", "gp", {
    type: "save_consultation", patientId: "SIM-000003", title: "Synthetic note",
    text: "First fictional note", consultationStatus: "draft", mode: "telephone",
  }, "test");
  const before = engine.state;
  const content = JSON.stringify(before);
  const world = engine.require("default");
  const patient = world.patients[0];
  const unchanged = world.resources.find((r) => r.id === "capacity-gp");
  assert.ok(patient);
  assert.ok(unchanged);
  const saved = engine.action("default", "gp", {
    type: "save_consultation", patientId: "SIM-000003", resourceId: draft.id,
    expectedVersion: 1, title: "Synthetic note", text: "Edited fictional note", consultationStatus: "saved", mode: "telephone",
  }, "test");
  assert.equal(saved.status, "saved");
  assert.equal(saved.data.text, "Edited fictional note");
  assert.equal(engine.require("other-team"), before.worlds["other-team"]);
  assert.equal(engine.require("default").patients[0], patient);
  assert.equal(engine.require("default").resources.find((r) => r.id === unchanged.id), unchanged);
  assert.equal(JSON.stringify(before), content);
  assert.equal(before.worlds.default.resources.find((r) => r.id === draft.id)?.status, "draft");
});

test("nested plan-lab completion commits together and rolls back with its outer transaction", () => {
  const engine = new Engine();
  runPlanLab(engine, "default", { challenge: "discharge", action: "start" });
  runPlanLab(engine, "default", { challenge: "discharge", action: "agree-support" });
  const visit = () => engine.require("default").resources.find(
    (r) => r.data.planLab === "discharge" && r.data.labRole === "visit",
  );
  assert.equal(visit()?.status, "scheduled");
  const before = engine.state;
  const content = JSON.stringify(before);
  assert.throws(() => engine.transaction("default", () => {
    runPlanLab(engine, "default", { challenge: "discharge", action: "complete-visit" });
    assert.equal(visit()?.status, "completed");
    throw new Error("Abort nested completion");
  }), /Abort nested completion/);
  assert.equal(engine.state, before);
  assert.equal(JSON.stringify(engine.state), content);
  assert.equal(visit()?.status, "scheduled");
  runPlanLab(engine, "default", { challenge: "discharge", action: "complete-visit" });
  assert.equal(visit()?.status, "completed");
  assert.equal(before.worlds.default.resources.find((r) => r.id === visit()?.id)?.status, "scheduled");
});
