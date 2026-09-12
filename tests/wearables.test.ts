import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { wearablePage } from "../packages/engine/src/wearables.ts";
import { wearableDeviceDataSchema, wearableReadingDataSchema, wearableQuerySchema, wearableReadingsQuerySchema } from "../packages/contracts/src/wearables.ts";

test("wearable reads expose actual device metadata and paged patient history", () => {
  const engine = new Engine();
  const world = engine.require("default");
  const devices = wearablePage(world, "device", wearableQuerySchema.parse({ patient: "SIM-000006" }));
  assert.equal(devices.total, 1);
  assert.equal(devices.items[0]?.title, "Home activity watch");
  assert.deepEqual(wearableDeviceDataSchema.parse(devices.items[0]?.data), { battery: 76, quality: "good", lastSyncedAt: world.now, metric: "steps" });
  const history = (offset: number) => wearablePage(world, "observation", wearableReadingsQuerySchema.parse({ patient: "SIM-000006", metric: "sleep", offset, limit: 3 }));
  const first = history(0);
  assert.equal(first.total, 7);
  assert.equal(first.offset, 0);
  assert.equal(first.limit, 3);
  assert.equal(first.now, world.now);
  assert.deepEqual(first.items.map(item => item.data.value), [7.2, 7.5, 6.8]);
  assert.deepEqual(history(3).items.map(item => item.data.value), [7.1, 7.4, 6.9]);
  assert.deepEqual(history(6).items.map(item => item.data.value), [7.3]);
  assert.deepEqual(history(7).items, []);
  for (const item of first.items) {
    assert.equal(item.patientId, "SIM-000006");
    assert.equal(item.owner, "wearables");
    assert.equal(item.kind, "observation");
    const data = wearableReadingDataSchema.parse(item.data);
    assert.equal(data.unit, "h");
    assert.equal(data.quality, "good");
    assert.ok(data.observedAt < world.now);
  }
  const unknown = wearablePage(world, "observation", wearableReadingsQuerySchema.parse({ patient: "unknown" }));
  assert.equal(unknown.total, 0);
  assert.deepEqual(unknown.items, []);
  assert.equal(wearablePage(world, "observation", wearableReadingsQuerySchema.parse({ metric: "glucose" })).total, 0);
});

test("wearable reads exclude shared observations from other services and keep world changes isolated", () => {
  const engine = new Engine();
  engine.create("team-world");
  const base = engine.require("default");
  const reading = base.resources.find(resource => resource.kind === "observation" && resource.owner === "wearables");
  assert.ok(reading);
  base.resources.push({ ...reading, id: "shared-from-gp", owner: "gp", visibleTo: ["wearables"] });
  const all = wearablePage(base, "observation", wearableQuerySchema.parse({}));
  assert.equal(all.items.some(item => item.id === "shared-from-gp"), false);
  const query = wearableQuerySchema.parse({ patient: "SIM-000003" });
  assert.equal(wearablePage(base, "device", query).total, 0);
  engine.action("team-world", "wearables", { type: "connect_device", patientId: query.patient }, "Team");
  assert.equal(wearablePage(engine.require("team-world"), "device", query).total, 1);
  assert.equal(wearablePage(engine.require("default"), "device", query).total, 0);
  engine.clock("team-world", { advanceMinutes: 10 });
  const connected = wearablePage(engine.require("team-world"), "observation", query);
  assert.equal(connected.total, 1);
  assert.equal(connected.items[0]?.data.quality, "good");
  assert.equal(typeof connected.items[0]?.data.value, "number");
  engine.fault("team-world", "wearable-disconnect", true);
  engine.clock("team-world", { advanceMinutes: 60 });
  const disconnected = wearablePage(engine.require("team-world"), "observation", query);
  assert.equal(disconnected.total, 2);
  assert.equal(disconnected.items[1]?.data.quality, "missing");
  assert.equal(disconnected.items[1]?.data.value, null);
  wearableReadingDataSchema.parse(disconnected.items[1]?.data);
  assert.equal(wearablePage(engine.require("default"), "observation", query).total, 0);
});

test("wearable query bounds reject invalid pagination and preserve exact filters", () => {
  assert.deepEqual(wearableQuerySchema.parse({}), { offset: 0, limit: 100 });
  assert.deepEqual(wearableReadingsQuerySchema.parse({ offset: "3", limit: "2", patient: "SIM-000006", metric: "sleep" }), { offset: 3, limit: 2, patient: "SIM-000006", metric: "sleep" });
  for (const offset of ["-1", "1.5", "NaN", "Infinity", "9007199254740992"]) assert.equal(wearableQuerySchema.safeParse({ offset }).success, false);
  for (const limit of ["0", "501", "1.5", "NaN", "Infinity", ""]) assert.equal(wearableQuerySchema.safeParse({ limit }).success, false);
});
