import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";

test("any patient can connect a watch and receive their own readings without duplicate schedules", () => {
  const engine = new Engine();
  const action = { type: "connect_device", patientId: "SIM-000003" };
  const device = engine.action("default", "wearables", action, "Watch team", "watch-connect");
  assert.equal(device.patientId, "SIM-000003");
  assert.equal(device.status, "active");
  assert.equal(device.provenance?.created?.actor.name, "Watch team");
  assert.equal(engine.action("default", "wearables", action, "Watch team", "watch-connect").id, device.id);
  assert.equal(engine.action("default", "wearables", action, "Watch team").id, device.id);
  assert.equal(engine.require("default").scheduled.filter((job) => job.type === "observation" && job.patientId === "SIM-000003").length, 1);
  const readings = () => engine.view("default", "wearables").resources.filter((r) => r.kind === "observation" && r.owner === "wearables" && r.patientId === "SIM-000003");
  const before = readings().length;
  engine.clock("default", { advanceMinutes: 9 });
  assert.equal(readings().length, before);
  engine.clock("default", { advanceMinutes: 1 });
  assert.equal(readings().length, before + 1);
  assert.equal(readings().at(-1)?.data.unit, "steps/day");
  assert.ok(engine.view("default", "community").resources.some((r) => r.id === readings().at(-1)?.id));
  engine.clock("default", { advanceMinutes: 60 });
  assert.equal(readings().length, before + 2);
  assert.equal(engine.require("default").resources.find((r) => r.id === device.id)?.data.quality, "good");
});

test("watch connections validate patient and service and preserve Eleanor's existing schedule", () => {
  const engine = new Engine();
  for (const input of [{ type: "connect_device" }, { type: "connect_device", patientId: "absent" }])
    assert.throws(() => engine.action("default", "wearables", input, "Team"));
  assert.throws(() => engine.action("default", "gp", { type: "connect_device", patientId: "SIM-000003" }, "Team"), /home workspace/);
  const before = engine.require("default").scheduled.length;
  engine.action("default", "wearables", { type: "connect_device", patientId: "SIM-000006" }, "Team");
  assert.equal(engine.require("default").scheduled.length, before);
});
