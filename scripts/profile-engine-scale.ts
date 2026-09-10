import { performance } from "node:perf_hooks";
import { freeze } from "immer";
import { Engine } from "../packages/engine/src/index.ts";
import { generatePopulationBatch } from "../packages/engine/src/population-batch.ts";

const population = Number(process.argv[2] ?? 5000);
if (!Number.isSafeInteger(population) || population < 500 || population > 50000) {
  throw new Error("Pass a population between 500 and 50000");
}
const results: object[] = [];
for (const frozen of [false, true]) {
  const engine = new Engine();
  const world = engine.require("default");
  const start = performance.now();
  for (let ordinal = world.patients.length + 1; ordinal <= population; ordinal += 500) {
    const batch = generatePopulationBatch({ seed: world.seed, start: ordinal, count: Math.min(500, population - ordinal + 1), now: world.now });
    engine.transaction("default", (draft) => {
      draft.patients.push(...batch.patients);
      draft.resources.push(...batch.resources);
    });
  }
  const generationMs = performance.now() - start;
  const freezeStart = performance.now();
  if (frozen) {
    for (const row of engine.require("default").patients) freeze(row, true);
    for (const row of engine.require("default").resources) freeze(row, true);
  }
  const freezeMs = performance.now() - freezeStart;
  const saveMs: number[] = [];
  for (let index = 0; index < 5; index++) {
    const started = performance.now();
    engine.action("default", "gp", { type: "save_consultation", patientId: "SIM-000001", title: `Profile ${index}`, text: "Synthetic performance test consultation.", consultationStatus: "saved" }, "scale-profile");
    saveMs.push(performance.now() - started);
  }
  results.push({ population: engine.require("default").patients.length, resources: engine.require("default").resources.length, frozen, generationMs, freezeMs, saveMs });
  console.log(JSON.stringify(results.at(-1)));
}
