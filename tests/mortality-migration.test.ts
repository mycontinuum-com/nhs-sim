import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { RowPersistence } from "../apps/server/src/persistence.ts";
import { migrateMortality, mortalityMigrationId } from "../apps/server/src/mortality-migration.ts";

const url = process.env.ROW_STORAGE_TEST_URL;
test("PostgreSQL mortality migration updates shared and overlay patients once, preserving demographics, deaths and deletions", { skip: !url }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const schema = `mortality_${Date.now()}`;
  const now = Date.parse("2026-09-12T08:00:00Z");
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await new RowPersistence().schema(client);
    await client.query("INSERT INTO simulation_populations VALUES('base',1),('unattached',1)");
    await client.query("INSERT INTO simulation_worlds VALUES('later','base',$1),('earlier','base',$2)", [JSON.stringify({now}),JSON.stringify({now:now-30*86400000})]);
    const patient = { id: "SIM-000009", name: "Original fictional name", birthDate: "2018-02-09", needs: ["Retain me"] };
    const existingDeath = { date: "2020-01-02", cause: "Existing authored cause", synthetic: true, source: "authored-synthetic-mortality-v1" };
    await client.query("INSERT INTO population_patients(population_id,id,ordinal,payload) VALUES('base',$1,0,$2),('unattached',$1,0,$2),('base','SIM-000001',1,$3),('base','SIM-000012',2,$4)", [patient.id,JSON.stringify(patient),JSON.stringify({...patient,id:"SIM-000001"}),JSON.stringify({...patient,id:"SIM-000012",death:existingDeath})]);
    const overlay = {...patient, birthDate: "1975-05-12", name: "Preserved overlay"};
    await client.query("INSERT INTO world_patients(world_id,id,ordinal,payload,deleted) VALUES('later',$1,0,$2,false),('earlier',$1,0,NULL,true),('later','SIM-000011',1,$3,false)", [patient.id,JSON.stringify(overlay),JSON.stringify({...patient,id:"SIM-000011",death:existingDeath})]);
    await client.query("BEGIN");
    assert.equal(await migrateMortality(client), 3);
    await client.query("COMMIT");
    const baseline = (await client.query("SELECT payload FROM population_patients WHERE population_id='base' AND id=$1", [patient.id])).rows[0].payload;
    assert.deepEqual({...baseline,death:undefined}, {...patient,death:undefined});
    assert.equal(baseline.death.date, "2026-08-06");
    assert.equal(baseline.death.cause, "Road traffic collision");
    const changedOverlay = (await client.query("SELECT payload FROM world_patients WHERE world_id='later' AND id=$1", [patient.id])).rows[0].payload;
    assert.deepEqual({...changedOverlay,death:undefined}, {...overlay,death:undefined});
    assert.equal(changedOverlay.death.date, "2026-09-05");
    assert.deepEqual((await client.query("SELECT payload->'death' AS death FROM population_patients WHERE id='SIM-000012'")).rows[0].death,existingDeath);
    assert.deepEqual((await client.query("SELECT payload->'death' AS death FROM world_patients WHERE id='SIM-000011'")).rows[0].death,existingDeath);
    assert.equal((await client.query("SELECT payload FROM world_patients WHERE deleted")).rows[0].payload,null);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM world_patients")).rows[0].n,3);
    assert.equal((await client.query("SELECT payload ? 'death' AS deceased FROM population_patients WHERE id='SIM-000001'")).rows[0].deceased,false);
    assert.equal(await migrateMortality(client),0);
    await client.query("DELETE FROM simulation_data_migrations WHERE id=$1",[mortalityMigrationId]);
    assert.equal(await migrateMortality(client),0);
    assert.equal((await client.query("SELECT payload->'death'->>'date' AS date FROM population_patients WHERE population_id='base' AND id=$1",[patient.id])).rows[0].date,"2026-08-06");
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
