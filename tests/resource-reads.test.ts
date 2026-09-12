import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Store } from "../apps/server/src/store.ts";
import { resourceRowsSql } from "../apps/server/src/persistence.ts";
import type { Resource } from "../packages/contracts/src/index.ts";

const day = Date.parse("2026-09-12T00:00:00Z");
function resource(id: string, changes: Partial<Resource> = {}): Resource {
  return { id, kind: "report", title: id, status: "available", owner: "diagnostics", visibleTo: ["gp"], priority: "routine", createdAt: day, data: {}, version: 1, ...changes };
}
function fixture(resources: Resource[]) {
  const store = new Store("postgres://unused:unused@127.0.0.1:1/unused");
  store.engine.transaction("default", world => {
    world.resources = resources;
    world.counters["bloodPatient:SIM-000001"] = 1;
  });
  return store;
}

test("resource reads preserve visibility, shared records, order, total and page bounds without database access", async () => {
  const store = fixture([
    resource("z", { patientId: "SIM-000001" }),
    resource("hidden", { visibleTo: ["hospital"] }),
    resource("other", { patientId: "SIM-000002" }),
    resource("shared"),
    resource("appointment", { kind: "appointment" }),
    resource("a", { patientId: "SIM-000001" }),
  ]);
  try {
    const page = await store.readResources("default", "gp", "SIM-000001", 1.9, 1.9, "report");
    assert.deepEqual(page, { resources: [resource("shared")], resourceTotal: 3, resourceOffset: 1, resourceLimit: 1 });
    assert.deepEqual((await store.readResources("default", "gp", "SIM-000001", 0, 100, "report")).resources.map(row => row.id), ["z", "shared", "a"]);
    assert.deepEqual((await store.readResources("default", "control")).resources.map(row => row.id), ["z", "hidden", "other", "shared", "appointment", "a"]);
    const empty = await store.readResources("default", "gp", undefined, 50, 2000);
    assert.deepEqual([empty.resources, empty.resourceTotal, empty.resourceOffset, empty.resourceLimit], [[], 5, 50, 1000]);
    const minimum = await store.readResources("default", "gp", undefined, -3, 0);
    assert.deepEqual([minimum.resources.map(row => row.id), minimum.resourceOffset, minimum.resourceLimit], [["z"], 0, 1]);
  } finally { await store.close(); }
});

test("resource dates use integer startsAt or createdAt and a half-open UTC day", async () => {
  const store = fixture([
    resource("start"),
    resource("end", { createdAt: day + 86400000 - 1 }),
    resource("next", { createdAt: day + 86400000 }),
    resource("before", { createdAt: day - 1 }),
    resource("scheduled", { createdAt: day - 1, data: { startsAt: day } }),
    resource("string", { createdAt: day - 1, data: { startsAt: String(day) } }),
    resource("outside", { data: { startsAt: day + 86400000 } }),
    resource("fallback", { data: { startsAt: "invalid" } }),
    resource("fraction", { data: { startsAt: day - 0.5 } }),
  ]);
  try {
    assert.deepEqual((await store.readResources("default", "gp", undefined, 0, 100, "report", "2026-09-12")).resources.map(row => row.id), ["start", "end", "scheduled", "string", "fallback", "fraction"]);
    await assert.rejects(store.readResources("default", "gp", undefined, 0, 100, undefined, "not-a-date"), /calendar date/);
    await assert.rejects(store.readResources("default", "gp", undefined, 0, 100, undefined, "2026-99-12"), /calendar date/);
  } finally { await store.close(); }
});

test("resource refetches use each world's current records after edits and deletions", async () => {
  const store = fixture([resource("same"), resource("removed")]);
  store.engine.create("another", 42, 8);
  store.engine.transaction("another", world => { world.resources = [resource("same", { title: "Other team" })]; });
  try {
    store.engine.transaction("default", world => { world.resources = [resource("same", { title: "Updated" }), resource("added")]; });
    assert.deepEqual((await store.readResources("default", "gp")).resources.map(row => row.title), ["Updated", "added"]);
    assert.deepEqual((await store.readResources("another", "gp")).resources.map(row => row.title), ["Other team"]);
    await assert.rejects(store.readResources("missing", "gp"), /Unknown world/);
  } finally { await store.close(); }
});

test("already-seeded reads bypass the write queue and refetch restored state after rollback", async () => {
  const store = fixture([resource("original", { patientId: "SIM-000001" })]);
  let markEntered = () => {};
  let releaseWrite = () => {};
  const entered = new Promise<void>(resolve => { markEntered = resolve; });
  const release = new Promise<void>(resolve => { releaseWrite = resolve; });
  const write = store.run(async () => {
    store.engine.transaction("default", world => { world.resources = [resource("pending", { patientId: "SIM-000001" })]; });
    markEntered();
    await release;
    throw new Error("Deliberate rollback");
  }, "default");
  const rejected = assert.rejects(write, /Deliberate rollback/);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await entered;
    const pending = await Promise.race([
      store.readResources("default", "gp", "SIM-000001"),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Read joined blocked write queue")), 1000); }),
    ]);
    assert.deepEqual(pending.resources.map(row => row.id), ["pending"]);
    releaseWrite();
    await rejected;
    assert.deepEqual((await store.readResources("default", "gp", "SIM-000001")).resources.map(row => row.id), ["original"]);
  } finally {
    if (timeout) clearTimeout(timeout);
    releaseWrite();
    await rejected;
    await store.close();
  }
});

test("concurrent first resource reads persist one blood seed and retain it after restart", { skip: !process.env.ROW_STORAGE_TEST_URL }, async () => {
  const url = process.env.ROW_STORAGE_TEST_URL;
  assert.ok(url);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const database = "nhssim_resource_reads_" + Date.now();
  const isolated = new URL(url);
  isolated.pathname = "/" + database;
  let store: Store | undefined;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    store = new Store(isolated.toString());
    await store.init();
    const active = store;
    await active.run(() => {
      active.engine.create("blood-reader", 42, 8);
      active.engine.transaction("blood-reader", world => {
        world.resources = world.resources.filter(row => row.patientId !== "SIM-000001" || !row.id.startsWith("blood-v1-"));
        delete world.counters["bloodPatient:SIM-000001"];
      });
    }, "blood-reader");
    assert.notEqual(active.engine.require("blood-reader").counters["bloodPatient:SIM-000001"], 1);
    const pages = await Promise.all(Array.from({ length: 4 }, () => active.readResources("blood-reader", "gp", "SIM-000001", 0, 1000)));
    for (const page of pages) assert.equal(page.resources.filter(row => row.id.startsWith("blood-v1-")).length, 36);
    const count = await active.pool.query(`SELECT count(*)::integer AS total FROM (${resourceRowsSql}) visible WHERE patient_id='SIM-000001' AND id LIKE 'blood-v1-%'`, ["blood-reader"]);
    assert.equal(count.rows[0].total, 36);
    await store.close();
    store = new Store(isolated.toString());
    await store.init();
    assert.equal(store.engine.require("blood-reader").counters["bloodPatient:SIM-000001"], 1);
    assert.equal((await store.readResources("blood-reader", "gp", "SIM-000001", 0, 1000)).resources.filter(row => row.id.startsWith("blood-v1-")).length, 36);
  } finally {
    await store?.close();
    await admin.query('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)');
    await admin.end();
  }
});
