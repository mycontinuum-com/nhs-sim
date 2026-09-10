import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import type { Resource } from "../packages/contracts/src/index.ts";

test("four-day supplier lead time advances a 500k-record world without rewalking history per event", { timeout: 20000 }, (t) => {
  const engine = new Engine();
  const world = engine.require("default");
  const history: Resource[] = Array.from({ length: 500000 }, (_, i) => ({
    id: "scale-history-" + i, kind: "consultation", title: "Synthetic historical consultation", owner: "gp", visibleTo: ["gp"], status: "saved", priority: "routine", createdAt: world.now, version: 1, data: { text: "Synthetic scale fixture" },
  }));
  world.resources = [...history, ...world.resources];
  const unchanged = world.resources[0];
  const startedAt = world.now;
  const started = performance.now();
  engine.clock("default", { advanceMinutes: 5760 });
  const elapsed = performance.now() - started;
  const after = engine.require("default");
  assert.equal(after.now, startedAt + 5760 * 60000);
  assert.equal(after.resources[0], unchanged);
  assert.ok(after.resources.some(r => r.kind === "hospital-attendance" && r.createdAt > startedAt));
  assert.ok(after.resources.some(r => r.kind === "observation" && r.createdAt > startedAt));
  const active = after.resources.filter(r => r.kind === "hospital-attendance" && r.status !== "discharged");
  assert.equal(new Set(active.map(r => r.patientId)).size, active.length);
  t.diagnostic(`Advanced four days with 500,000 historical records in ${Math.round(elapsed)}ms`);
  assert.ok(elapsed < 10000, `Clock should return within 10 seconds, took ${elapsed}ms`);
});
