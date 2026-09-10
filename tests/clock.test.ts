import test from "node:test";
import assert from "node:assert/strict";
import { freeze } from "immer";
import { Engine } from "../packages/engine/src/index.ts";
import { generatePopulationBatch } from "../packages/engine/src/population-batch.ts";

test("manual advance atomically pauses a running world and records the team", () => {
  const engine = new Engine();
  engine.clock("default", { paused: false }, "Orchid");
  const before = engine.require("default").now;
  const result = engine.clock("default", { paused: true, advanceMinutes: 60 }, "Orchid");
  assert.deepEqual(result, { now: before + 60 * 60_000, paused: true, speed: 60 });
  const latest = engine.events("default", "control")[0];
  assert.equal(latest.actor, "Orchid");
  assert.equal(latest.type, "clock.changed");
  assert.equal(latest.detail, "Advanced simulation by 60 minutes; clock paused");
  assert.ok(engine.events("default", "control").some((event) => event.type === "observation.received"));
  const state = engine.state;
  assert.throws(() => engine.clock("default", { advanceMinutes: -1 }, "Other team"));
  assert.equal(engine.state, state);
});

test("one long clock step processes active queues exactly like consecutive short steps", () => {
  const prepare = () => {
    const engine = new Engine();
    const world = engine.require("default");
    const batch = generatePopulationBatch({ seed: 42, start: 501, count: 1000, now: world.now });
    world.patients.push(...batch.patients);
    world.resources.push(...batch.resources);
    for (const record of world.resources) freeze(record, true);
    engine.action("default", "gp", { type: "order_test", patientId: "SIM-000001", title: "Clock test result" }, "Orchid");
    return engine;
  };
  const long = prepare(), short = prepare();
  long.transaction("default", (world) => long.advance(world, 180 * 60_000));
  for (let i = 0; i < 12; i++) short.transaction("default", (world) => short.advance(world, 15 * 60_000));
  assert.deepEqual(long.state, short.state);
});
