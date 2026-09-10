import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";

test("retiring the workbook retains sharing restrictions on previously saved records", () => {
  const engine = new Engine();
  const record = engine.transaction("default", (world) => engine.add(world, "document", "Historical restricted handover", "gp", "SIM-000001", { planLab: "digital" }));
  const before = engine.state;
  assert.throws(() => engine.action("default", "gp", {
    type: "share_record", resourceId: record.id, target: "community",
  }, "Team"), /Sharing is restricted/);
  assert.equal(engine.state, before);
  assert.ok(!engine.view("default", "community").resources.some((item) => item.id === record.id));
});
