import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Store } from "../apps/server/src/store.ts";

test("database health rejects an uninitialized store without opening a connection", async () => {
  const store = new Store("postgres://unused:unused@127.0.0.1:1/unused");
  try {
    await assert.rejects(store.health(), /Store is not initialized/);
    assert.equal(store.pool.totalCount, 0);
  } finally { await store.close(); }
});

test("database health succeeds while all data-query connections are occupied", { skip: !process.env.ROW_STORAGE_TEST_URL }, async () => {
  const url = process.env.ROW_STORAGE_TEST_URL;
  assert.ok(url);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const database = "nhssim_health_" + Date.now();
  const isolated = new URL(url);
  isolated.pathname = "/" + database;
  let store: Store | undefined;
  const clients: pg.PoolClient[] = [];
  let queued: Promise<pg.QueryResult> | undefined;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    store = new Store(isolated.toString());
    await store.init();
    for (let i = 0; i < 3; i++) clients.push(await store.pool.connect());
    assert.equal(store.pool.totalCount, 4);
    assert.equal(store.pool.idleCount, 0);
    queued = store.pool.query("SELECT 1 AS queued");
    assert.equal(store.pool.waitingCount, 1);
    await store.health();
    assert.equal(store.pool.waitingCount, 1);
    assert.equal(store.pool.totalCount, 4);
  } finally {
    for (const client of clients) client.release();
    try { await queued; } finally {
      await store?.close();
      await admin.query('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)');
      await admin.end();
    }
  }
});
