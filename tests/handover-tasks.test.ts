import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";

test("hospital follow-up task belongs to the GP while remaining visible to its hospital author", () => {
  const engine = new Engine();
  engine.create("other-team", 42, 8);
  const other = JSON.stringify(engine.require("other-team"));
  const action = { type: "create_task", patientId: "SIM-000006", title: "Confirm synthetic discharge letter received", target: "gp" };
  const task = engine.action("default", "hospital", action, "Discharge team", "handover-task");
  assert.equal(task.owner, "gp");
  assert.deepEqual(task.visibleTo, ["gp", "hospital", "patient"]);
  assert.deepEqual(task.provenance?.created, {
    actor: { kind: "team", name: "Discharge team" }, source: "hospital", action: "create_task",
    time: engine.require("default").now, version: 1,
  });
  for (const service of ["hospital", "gp"] as const) {
    assert.equal(engine.view("default", service).resources.find((record) => record.id === task.id)?.title, action.title);
  }
  assert.deepEqual(engine.action("default", "hospital", action, "Discharge team", "handover-task"), task);
  assert.equal(engine.require("default").resources.filter((record) => record.id === task.id).length, 1);
  assert.equal(JSON.stringify(engine.require("other-team")), other);
  assert.throws(() => engine.action("default", "hospital", { type: "complete", resourceId: task.id }, "Discharge team"), /Only owning service/);
  const completed = engine.action("default", "gp", { type: "complete", resourceId: task.id, expectedVersion: 1 }, "GP team");
  assert.equal(completed.status, "completed");
  assert.equal(engine.view("default", "hospital").resources.find((record) => record.id === task.id)?.status, "completed");
  assert.equal(completed.provenance?.created?.source, "hospital");
  assert.equal(completed.provenance?.changes.at(-1)?.source, "gp");
});

test("tasks without a destination stay with the creating service; community tasks retain both services", () => {
  const engine = new Engine();
  const local = engine.action("default", "hospital", { type: "create_task", patientId: "SIM-000006", title: "Local hospital task" }, "Hospital team");
  assert.equal(local.owner, "hospital");
  assert.deepEqual(local.visibleTo, ["hospital", "patient"]);
  const community = engine.action("default", "hospital", { type: "create_task", patientId: "SIM-000006", title: "Community follow-up", target: "community" }, "Hospital team");
  assert.equal(community.owner, "community");
  assert.deepEqual(community.visibleTo, ["community", "hospital", "patient"]);
  const before = JSON.stringify(engine.state);
  assert.throws(() => engine.action("default", "hospital", { type: "create_task", patientId: "SIM-000006", title: "Invalid destination", target: "imaginary-service" }, "Hospital team"));
  assert.equal(JSON.stringify(engine.state), before);
});
