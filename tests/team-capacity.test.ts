import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Store } from "../apps/server/src/store.ts";

test("concurrent sign-ups reserve the final team place atomically", { skip: !process.env.ROW_STORAGE_TEST_URL }, async () => {
  const url = process.env.ROW_STORAGE_TEST_URL;
  assert.ok(url);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const database = `nhssim_capacity_test_${Date.now()}`;
  const isolated = new URL(url);
  isolated.pathname = `/${database}`;
  let store: Store | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    store = new Store(isolated.toString());
    await store.init();
    await store.pool.query("INSERT INTO team_keys(hash,team,world,scopes) SELECT 'fixture-' || n, 'Capacity fixture ' || n, 'fixture-world-' || n, '[\"gp\"]'::jsonb FROM generate_series(1,4999) n");
    store.keys = (await store.pool.query("SELECT hash,team,world,scopes,recoverable_key FROM team_keys")).rows;
    const results = await Promise.allSettled([store.issue("Last place", ["gp"]), store.issue("Overflow", ["gp"])]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const failure = results.find(result => result.status === "rejected");
    assert.ok(failure && failure.status === "rejected");
    assert.equal(failure.reason.status, 429);
    assert.match(failure.reason.message, /5,000-team capacity/);
    const winner = results.find(result => result.status === "fulfilled");
    assert.ok(winner && winner.status === "fulfilled");
    const joined = await store.issue(winner.value.team.toUpperCase(), ["gp", "hospital"]);
    assert.equal(joined.apiKey, winner.value.apiKey);
    assert.equal(joined.created, false);
    assert.equal(store.keys.length, 5000);
    assert.equal((await store.pool.query("SELECT count(*)::int AS count FROM team_keys")).rows[0].count, 5000);
    assert.equal((await store.pool.query("SELECT count(*)::int AS count FROM simulation_worlds WHERE id LIKE 'team-%'")).rows[0].count, 1);
  } finally {
    if (store) {
      store.lockClient?.release();
      await store.pool.end();
    }
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  }
});
