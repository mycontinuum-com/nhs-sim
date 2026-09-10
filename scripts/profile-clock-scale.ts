import { performance } from "node:perf_hooks";
import { freeze } from "immer";
import { Engine } from "../packages/engine/src/index.ts";
import { generatePopulationBatch } from "../packages/engine/src/population-batch.ts";

const count = Number(process.argv[2] ?? 50000);
if (!Number.isSafeInteger(count) || count < 500 || count > 50000) throw new Error("Use 500–50000 people");
const engine = new Engine();
const initial = engine.require("default");
const now = initial.now;
const seed = initial.seed;
for (const row of initial.patients) freeze(row, true);
for (const row of initial.resources) freeze(row, true);
const start = performance.now();
for (let ordinal = initial.patients.length + 1; ordinal <= count; ordinal += 500) {
  const batch = generatePopulationBatch({ seed, start: ordinal, count: Math.min(500, count - ordinal + 1), now });
  for (const row of batch.patients) freeze(row, true);
  for (const row of batch.resources) freeze(row, true);
  engine.transaction("default", (world) => {
    world.patients.push(...batch.patients);
    world.resources.push(...batch.resources);
  });
}
const memory = () => Object.fromEntries(Object.entries(process.memoryUsage()).map(([key, value]) => [key + "MB", Math.round(value / 1024 / 1024)]));
console.log(JSON.stringify({ phase: "generated", elapsedMs: performance.now() - start, patients: engine.require("default").patients.length, resources: engine.require("default").resources.length, scheduled: engine.require("default").scheduled.length, memory: memory() }));
const clockStart = performance.now();
engine.clock("default", { advanceMinutes: 120 });
console.log(JSON.stringify({ phase: "advanced120minutes", elapsedMs: performance.now() - clockStart, resources: engine.require("default").resources.length, scheduled: engine.require("default").scheduled.length, memory: memory() }));
