import assert from "node:assert/strict";
import pg from "pg";
import { genomeRecordDataSchema } from "../packages/contracts/src/genomics.ts";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const worlds = (await client.query("SELECT id,population_id FROM simulation_worlds")).rows;
  const baselinePatients = new Map();
  const patientRows = (await client.query("SELECT population_id,id FROM population_patients")).rows;
  for (const row of patientRows) {
    if (!baselinePatients.has(row.population_id)) baselinePatients.set(row.population_id, new Set());
    baselinePatients.get(row.population_id).add(row.id);
  }
  const patientOverlays = new Map();
  for (const row of (await client.query("SELECT world_id,id,deleted FROM world_patients")).rows) {
    if (!patientOverlays.has(row.world_id)) patientOverlays.set(row.world_id, new Map());
    patientOverlays.get(row.world_id).set(row.id, row.deleted);
  }
  const baselineGenomes = new Map();
  const ownGenomes = new Map();
  let validPanels = 0;
  const add = (map, scope, record) => {
    if (record.owner !== "hospital" || !record.visibleTo?.includes("hospital") || !genomeRecordDataSchema.safeParse(record.data).success) return;
    if (!map.has(scope)) map.set(scope, new Map());
    const patients = map.get(scope);
    if (!patients.has(record.patientId)) patients.set(record.patientId, []);
    patients.get(record.patientId).push(record.id);
    validPanels++;
  };
  for (const row of (await client.query("SELECT population_id,payload FROM population_resources WHERE kind='genome-record'")).rows) add(baselineGenomes, row.population_id, row.payload);
  for (const row of (await client.query("SELECT world_id,payload FROM world_resources WHERE kind='genome-record' AND NOT deleted")).rows) add(ownGenomes, row.world_id, row.payload);
  const shadowed = new Map();
  const shadows = await client.query("SELECT r.world_id,r.id FROM world_resources r JOIN simulation_worlds w ON w.id=r.world_id JOIN population_resources p ON p.population_id=w.population_id AND p.id=r.id WHERE p.kind='genome-record'");
  for (const row of shadows.rows) {
    if (!shadowed.has(row.world_id)) shadowed.set(row.world_id, new Set());
    shadowed.get(row.world_id).add(row.id);
  }
  let effectivePatients = 0;
  let missingPatients = 0;
  let missingBaselinePatients = 0;
  const examples = [];
  for (const [population, patients] of baselinePatients) {
    for (const patient of patients) if (!baselineGenomes.get(population)?.has(patient)) missingBaselinePatients++;
  }
  for (const world of worlds) {
    const patients = new Set(baselinePatients.get(world.population_id));
    for (const [id, deleted] of patientOverlays.get(world.id) ?? []) {
      if (deleted) patients.delete(id);
      else patients.add(id);
    }
    for (const patient of patients) {
      effectivePatients++;
      const own = ownGenomes.get(world.id)?.has(patient);
      const inherited = baselineGenomes.get(world.population_id)?.get(patient)?.some(id => !shadowed.get(world.id)?.has(id));
      if (!own && !inherited) {
        missingPatients++;
        if (examples.length < 10) examples.push({ world: world.id, patient });
      }
    }
  }
  const migration = (await client.query("SELECT id,applied_at,changed_rows FROM simulation_data_migrations WHERE id='secondary-care-cyp2c19-v1'")).rows[0];
  await client.query("COMMIT");
  console.log(JSON.stringify({ ok: missingPatients === 0 && missingBaselinePatients === 0 && Boolean(migration), worlds: worlds.length, baselinePatients: patientRows.length, storedValidPanels: validPanels, effectivePatients, missingPatients, missingBaselinePatients, examples, migration }, null, 2));
  assert.equal(missingPatients, 0, "Every effective patient must have a hospital-accessible complete SNP panel");
  assert.equal(missingBaselinePatients, 0, "Every published population patient must have a complete SNP panel");
  assert.ok(migration, "Startup migration must be recorded");
} finally {
  await client.end();
}
