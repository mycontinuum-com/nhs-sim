import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Store } from "../apps/server/src/store.ts";

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("blood reads batch at most 32 patients, await commit, share failures and retry after rollback", { skip: !process.env.ROW_STORAGE_TEST_URL }, async () => {
  const url = process.env.ROW_STORAGE_TEST_URL;
  assert.ok(url);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const database = "nhssim_blood_batches_" + Date.now();
  const isolated = new URL(url); isolated.pathname = "/" + database;
  let store: Store | undefined;
  let gate: pg.Client | undefined;
  let locked = false;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    store = new Store(isolated.toString());
    await store.init();
    const active = store;
    await active.run(() => {
      active.engine.create("batch-world", 42, 40);
      active.engine.transaction("batch-world", world => {
        world.resources = world.resources.filter(resource => !resource.id.startsWith("blood-v1-"));
        for (const patient of world.patients) delete world.counters[`bloodPatient:${patient.id}`];
      });
    }, "batch-world");
    await active.pool.query(`CREATE TABLE seed_transactions (transaction_id bigint PRIMARY KEY);
      CREATE FUNCTION observe_seed_transaction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id='batch-world' THEN INSERT INTO seed_transactions VALUES(txid_current()) ON CONFLICT DO NOTHING; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER observe_seed AFTER INSERT OR UPDATE ON simulation_worlds FOR EACH ROW EXECUTE FUNCTION observe_seed_transaction();`);
    const read = (id: number) => active.readResources("batch-world", "gp", "SIM-" + String(id).padStart(6, "0"), 0, 1000);
    const pages = await Promise.all([...Array.from({ length: 33 }, (_, index) => read(index + 1)), read(1)]);
    for (const page of pages) assert.equal(page.resources.filter(resource => resource.id.startsWith("blood-v1-")).length, 36);
    assert.equal((await active.pool.query("SELECT count(*)::integer AS count FROM seed_transactions")).rows[0].count, 2);

    gate = new pg.Client({ connectionString: isolated.toString() });
    await gate.connect();
    await gate.query("SELECT pg_advisory_lock(673129)");
    locked = true;
    await active.pool.query(`CREATE FUNCTION fail_blocked_seed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.world_id='batch-world' AND NEW.id LIKE 'blood-v1-SIM-000034-%' THEN
        PERFORM pg_advisory_xact_lock(673129);
        RAISE EXCEPTION 'Deliberate seed failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER block_seed BEFORE INSERT OR UPDATE ON world_resources FOR EACH ROW EXECUTE FUNCTION fail_blocked_seed();`);
    const first = read(34);
    const sibling = read(36);
    const failure = assert.rejects(first, /Deliberate seed failure/);
    const siblingFailure = assert.rejects(sibling, /Deliberate seed failure/);
    const deadline = Date.now() + 3000;
    while (active.engine.require("batch-world").counters["bloodPatient:SIM-000034"] !== 1 && Date.now() < deadline) await pause(5);
    assert.equal(active.engine.require("batch-world").counters["bloodPatient:SIM-000034"], 1);
    let duplicateSettled = false;
    const duplicate = read(34);
    const duplicateFailure = assert.rejects(duplicate, /Deliberate seed failure/);
    void duplicate.then(() => { duplicateSettled = true; }, () => { duplicateSettled = true; });
    const next = read(35);
    await pause(30);
    assert.equal(duplicateSettled, false);
    assert.equal(active.engine.require("batch-world").counters["bloodPatient:SIM-000035"], undefined);
    await gate.query("SELECT pg_advisory_unlock(673129)");
    locked = false;
    await Promise.all([failure, siblingFailure, duplicateFailure]);
    assert.equal((await next).resources.filter(resource => resource.id.startsWith("blood-v1-")).length, 36);
    assert.equal(active.engine.require("batch-world").counters["bloodPatient:SIM-000034"], undefined);
    assert.equal(active.engine.require("batch-world").counters["bloodPatient:SIM-000036"], undefined);
    await active.pool.query("DROP TRIGGER block_seed ON world_resources");
    const retried = await Promise.all([read(34), read(36)]);
    for (const retry of retried) assert.equal(retry.resources.filter(resource => resource.id.startsWith("blood-v1-")).length, 36);
    assert.equal((await active.pool.query("SELECT count(*)::integer AS count FROM seed_transactions")).rows[0].count, 4);
  } finally {
    if (locked) await gate?.query("SELECT pg_advisory_unlock(673129)");
    await gate?.end();
    await store?.close();
    await admin.query('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)');
    await admin.end();
  }
});
