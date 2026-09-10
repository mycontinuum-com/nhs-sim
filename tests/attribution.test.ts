import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";

const note = {
  type: "save_consultation", patientId: "SIM-000003", title: "Synthetic review",
  text: "Fictional consultation", consultationStatus: "saved",
};
test("trusted attribution preserves creator, records each editor and survives persistence", () => {
  const engine = new Engine();
  const first = engine.action("default", "gp", {
    ...note, author: "Spoof", provenance: { created: { actor: { name: "Spoof" } } },
  }, { kind: "team", name: "Orchard" }, "create");
  assert.deepEqual(first.provenance?.created, {
    actor: { kind: "team", name: "Orchard" }, source: "gp", action: "save_consultation",
    time: engine.require("default").now, version: 1,
  });
  const edit = { ...note, resourceId: first.id, expectedVersion: 1, text: "Updated fiction" };
  const updated = engine.action("default", "gp", edit, { kind: "team", name: "River" }, "edit");
  assert.equal(updated.data.author, "Orchard");
  assert.deepEqual(updated.provenance?.created, first.provenance?.created);
  assert.deepEqual(updated.provenance?.changes.map((change) => [change.actor.name, change.version]),
    [["Orchard", 1], ["River", 2]]);
  const retried = engine.action("default", "gp", edit, { kind: "team", name: "River" }, "edit");
  assert.deepEqual(retried, updated);
  assert.equal(engine.require("default").resources.find((r) => r.id === first.id)?.provenance?.changes.length, 2);
  const before = JSON.stringify(engine.state);
  assert.throws(() => engine.action("default", "gp", edit, "Late team"), /Stale/);
  assert.throws(() => engine.action("default", "hospital", { ...edit, expectedVersion: 2 }, "Wrong service"));
  assert.equal(JSON.stringify(engine.state), before);
  const restored = new Engine();
  restored.state = JSON.parse(before);
  assert.deepEqual(restored.view("default", "gp").resources.find((r) => r.id === first.id)?.provenance, updated.provenance);
});
test("legacy records keep an unknown creator and generated seeds identify the simulator", () => {
  const engine = new Engine();
  const seed = engine.require("default").resources.find((r) => r.kind === "task" && r.owner === "gp")!;
  assert.equal(seed.provenance?.created?.actor.kind, "simulation");
  assert.equal(seed.provenance?.created?.actor.name, "Synthetic seed");
  delete seed.provenance;
  const updated = engine.action("default", "gp", { type: "review", resourceId: seed.id }, "Reviewers");
  assert.equal(updated.provenance?.created, null);
  assert.equal(updated.provenance?.changes[0].actor.name, "Reviewers");
});
test("attribution changes do not mutate prior snapshots or another team's world", () => {
  const engine = new Engine();
  engine.create("other-team", 42, 8);
  const first = engine.action("default", "gp", note, "First");
  const before = engine.state;
  const other = JSON.stringify(engine.require("other-team"));
  engine.action("default", "gp", { ...note, resourceId: first.id, expectedVersion: 1 }, "Second");
  assert.equal(before.worlds.default.resources.find((r) => r.id === first.id)?.provenance?.changes.length, 1);
  assert.equal(JSON.stringify(engine.require("other-team")), other);
});
test("automated records and subsequent events name the simulator rather than a team", () => {
  const engine = new Engine();
  engine.transaction("default", (world) => {
    const record = engine.add(world, "observation", "Synthetic steps", "wearables", "SIM-000003");
    engine.event(world, "observation.received", "home-monitor", record.title, record);
  });
  const record = engine.require("default").resources.at(-1)!;
  assert.equal(record.provenance?.created?.actor.kind, "simulation");
  assert.deepEqual(record.provenance?.changes[0].actor, { kind: "simulation", name: "home-monitor" });
});
