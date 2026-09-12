import test from "node:test";
import assert from "node:assert/strict";
import { Engine, seedWorld } from "../packages/engine/src/index.ts";
import { createGenomeRecord, seedGenomeRecords } from "../packages/engine/src/genomics.ts";
import { genomeRecordDataSchema } from "../packages/contracts/src/genomics.ts";
import { generatePopulationBatch } from "../packages/engine/src/population-batch.ts";

test("every seeded and future batch patient has a complete secondary care synthetic SNP panel", () => {
  const world = seedWorld("default", 42, 20);
  const batch = generatePopulationBatch({seed: 42, start: 1000, count: 20, now: world.now});
  for (const cohort of [world, batch]) {
    for (const patient of cohort.patients) {
      const records = cohort.resources.filter(record => record.patientId === patient.id && record.kind === "genome-record");
      assert.equal(records.length, 1);
      assert.equal(records[0].owner, "hospital");
      assert.deepEqual(records[0].visibleTo, ["hospital"]);
      const data = genomeRecordDataSchema.parse(records[0].data);
      assert.equal(data.synthetic, true);
      assert.deepEqual(data.variants.map(variant => variant.rsid), ["rs4244285", "rs4986893", "rs12248560"]);
    }
  }
  const calls = batch.resources.filter(record => record.kind === "genome-record").map(record => genomeRecordDataSchema.parse(record.data).variants[0].genotype);
  assert.deepEqual([...new Set(calls)].sort(), ["A/A", "G/A", "G/G"]);
  const before = structuredClone(world.resources);
  seedGenomeRecords(world);
  assert.deepEqual(world.resources, before);
  assert.deepEqual(createGenomeRecord("SIM-000001", world.now), createGenomeRecord("SIM-000001", world.now));
});

test("raw genomes remain hospital-only and cannot be mutated or shared", () => {
  const engine = new Engine();
  const record = engine.require("default").resources.find(record => record.kind === "genome-record");
  assert.ok(record);
  for (const site of ["gp", "patient", "genomics", "research", "pharmacy"] as const) {
    assert.equal(engine.view("default", site).resources.some(row => row.id === record.id), false);
  }
  for (const site of ["hospital", "control"] as const) {
    for (const type of ["share_record", "review", "complete"] as const) {
      assert.throws(() => engine.action("default", site, {type, resourceId: record.id, target: "gp"}, "test"), /read-only/);
    }
  }
  engine.transaction("default", world => {
    const row = world.resources.find(row => row.id === record.id);
    assert.ok(row); row.visibleTo.push("gp");
  });
  assert.equal(engine.view("default", "gp").resources.some(row => row.id === record.id), false);
});

test("an inaccessible existing panel is preserved and does not count as coverage", () => {
  const hidden = createGenomeRecord("patient", 1000);
  hidden.id = "hidden-panel";
  hidden.visibleTo = [];
  const seeded = seedWorld("small", 42, 8);
  seeded.resources = [hidden];
  seeded.patients = [{...seeded.patients[0], id: "patient"}];
  seedGenomeRecords(seeded);
  assert.equal(seeded.resources.length, 2);
  assert.deepEqual(seeded.resources[0], hidden);
  assert.deepEqual(seeded.resources[1].visibleTo, ["hospital"]);
});
