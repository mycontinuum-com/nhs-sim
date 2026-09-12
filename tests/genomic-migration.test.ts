import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { RowPersistence, resourceRowsSql, patientRowsSql } from "../apps/server/src/persistence.ts";
import { migrateGenomicRecords } from "../apps/server/src/genomic-migration.ts";
import { createGenomeRecord } from "../packages/engine/src/genomics.ts";

const url = process.env.ROW_STORAGE_TEST_URL;
test("PostgreSQL genomic migration covers baselines and overlays without copying shared populations", {skip: !url}, async () => {
  const client = new pg.Client({connectionString: url});
  await client.connect();
  const schema = `genomics_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await new RowPersistence().schema(client);
    await client.query("INSERT INTO simulation_populations VALUES('base',1),('unattached',1); INSERT INTO simulation_worlds VALUES('one','base','{\"now\":1000}'),('two','base','{\"now\":1000}')");
    await client.query("INSERT INTO population_patients(population_id,id,ordinal,payload) VALUES('base','a',0,'{\"id\":\"a\"}'),('base','b',1,'{\"id\":\"b\"}'),('unattached','c',0,'{\"id\":\"c\"}')");
    await client.query("INSERT INTO world_patients(world_id,id,ordinal,payload) VALUES('one','overlay',2,'{\"id\":\"overlay\"}'),('two','a',0,'{\"id\":\"a\",\"name\":\"changed\"}')");
    const existing = createGenomeRecord("b", 123);
    existing.id = "retained-genome";
    await client.query("INSERT INTO population_resources VALUES('base',$1,0,$2)", [existing.id, JSON.stringify(existing)]);
    const shadow = createGenomeRecord("a", 123);
    await client.query("INSERT INTO world_resources(world_id,id,ordinal,payload,deleted) VALUES('two',$1,0,NULL,true)", [shadow.id]);
    await client.query("BEGIN");
    assert.equal(await migrateGenomicRecords(client, 1), 4);
    await client.query("COMMIT");
    assert.equal((await client.query("SELECT count(*)::integer AS n FROM population_resources")).rows[0].n, 3);
    assert.equal((await client.query("SELECT count(*)::integer AS n FROM world_resources WHERE NOT deleted")).rows[0].n, 2);
    assert.deepEqual((await client.query("SELECT payload FROM population_resources WHERE id=$1", [existing.id])).rows[0].payload, existing);
    for (const world of ["one", "two"]) {
      const coverage = await client.query(`SELECT p.id FROM (${patientRowsSql}) p WHERE NOT EXISTS (SELECT 1 FROM (${resourceRowsSql}) r WHERE r.patient_id=p.id AND r.kind='genome-record' AND r.owner='hospital')`, [world]);
      assert.deepEqual(coverage.rows, []);
    }
    assert.equal(await migrateGenomicRecords(client, 2), 0);
    await client.query("DELETE FROM simulation_data_migrations");
    assert.equal(await migrateGenomicRecords(client, 2), 0);
    assert.equal((await client.query("SELECT count(*)::integer AS n FROM world_resources WHERE NOT deleted")).rows[0].n, 2);
    await client.query("DELETE FROM simulation_data_migrations; INSERT INTO population_patients(population_id,id,ordinal,payload) VALUES('base','incomplete',3,'{\"id\":\"incomplete\"}')");
    await client.query("INSERT INTO population_resources(population_id,id,ordinal,payload) VALUES('base','incomplete-panel',5,$1)", [JSON.stringify({...createGenomeRecord("incomplete", 123), id: "incomplete-panel", data: {gene: "CYP2C19", variants: "malformed"}})]);
    assert.equal(await migrateGenomicRecords(client, 2), 1);
    assert.equal((await client.query("SELECT count(*)::integer AS n FROM population_resources WHERE patient_id='incomplete'")).rows[0].n, 2);
    await client.query("DELETE FROM simulation_data_migrations; INSERT INTO population_patients(population_id,id,ordinal,payload) VALUES('base','hidden',4,'{\"id\":\"hidden\"}')");
    await client.query("INSERT INTO population_resources(population_id,id,ordinal,payload) VALUES('base','hidden-panel',6,$1)", [JSON.stringify({...createGenomeRecord("hidden", 123), id: "hidden-panel", visibleTo: []})]);
    assert.equal(await migrateGenomicRecords(client, 2), 1);
    assert.deepEqual((await client.query("SELECT payload->'visibleTo' AS visibility FROM population_resources WHERE id='hidden-panel'")).rows[0].visibility, []);
    assert.deepEqual((await client.query("SELECT payload->'visibleTo' AS visibility FROM population_resources WHERE id='genome-cyp2c19-v1-hidden'")).rows[0].visibility, ["hospital"]);
    await client.query("DELETE FROM simulation_data_migrations; INSERT INTO population_patients(population_id,id,ordinal,payload) VALUES('base','collision',4,'{\"id\":\"collision\"}')");
    await client.query("INSERT INTO population_resources(population_id,id,ordinal,payload) VALUES('base','genome-cyp2c19-v1-collision',6,$1)", [JSON.stringify({...createGenomeRecord("collision", 123), kind: "document"})]);
    await client.query("BEGIN");
    await assert.rejects(migrateGenomicRecords(client, 1), /existing record conflicts/);
    await client.query("ROLLBACK");
    assert.equal((await client.query("SELECT count(*)::integer AS n FROM simulation_data_migrations")).rows[0].n, 0);
    assert.equal((await client.query("SELECT kind FROM population_resources WHERE id='genome-cyp2c19-v1-collision'")).rows[0].kind, "document");
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
