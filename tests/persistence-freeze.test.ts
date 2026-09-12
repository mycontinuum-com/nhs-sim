import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { RowPersistence } from "../apps/server/src/persistence.ts";
import { Engine } from "../packages/engine/src/index.ts";

test("persistence freezes entire changed arrays only after commit, including unchanged unfrozen rows", { skip: !process.env.ROW_STORAGE_TEST_URL }, async () => {
  const url = process.env.ROW_STORAGE_TEST_URL;
  assert.ok(url);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const database = "nhssim_freeze_" + Date.now();
  const isolated = new URL(url);
  isolated.pathname = "/" + database;
  let client: pg.Client | undefined;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    client = new pg.Client({ connectionString: isolated.toString() });
    await client.connect();
    const persistence = new RowPersistence();
    await persistence.schema(client);
    const engine = new Engine();
    engine.transaction("default", world => {
      world.patients = world.patients.slice(0, 2);
      world.resources = world.resources.slice(0, 2);
      engine.event(world, "test.freeze", "Test", "Original event");
    });
    await client.query("BEGIN");
    const initialCommit = await persistence.write(client, null, engine.state);
    await client.query("COMMIT");
    initialCommit();
    const before = structuredClone(engine.state);
    const world = before.worlds.default;
    const added = { ...world.resources[0], id: "freeze-appended", data: { nested: { value: "saved" } } };
    const after = {
      ...before,
      worlds: { ...before.worlds, default: { ...world, resources: [...world.resources, added] } },
      events: { ...before.events, default: [...before.events.default, { ...before.events.default[0], id: "freeze-event", detail: "Appended event" }] },
    };
    await client.query("BEGIN");
    await persistence.write(client, before, after, "default");
    assert.equal(Object.isFrozen(after.worlds.default.resources), false);
    assert.equal(Object.isFrozen(added.data.nested), false);
    await client.query("ROLLBACK");
    assert.equal((await client.query("SELECT count(*)::integer AS count FROM world_resources WHERE id='freeze-appended'")).rows[0].count, 0);
    assert.equal(Object.isFrozen(world.patients[0]), false);
    assert.equal(Object.isFrozen(after.events.default[0]), false);
    added.data.nested.value = "committed";
    await client.query("BEGIN");
    const commit = await persistence.write(client, before, after, "default");
    await client.query("COMMIT");
    commit();
    assert.equal(Object.isFrozen(after), true);
    for (const values of [after.worlds.default.patients, after.worlds.default.resources, after.events.default]) {
      assert.equal(Object.isFrozen(values), true);
      assert.ok(values.every(value => Object.isFrozen(value)));
    }
    assert.equal(Object.isFrozen(after.worlds.default.patients[0].conditions), true);
    assert.equal(Object.isFrozen(after.worlds.default.resources[0].data), true);
    assert.equal(Object.isFrozen(added.data.nested), true);
    assert.throws(() => { added.data.nested.value = "mutated"; }, TypeError);
    const reloaded = await new RowPersistence().load(client);
    assert.deepEqual(reloaded?.worlds.default.resources.find(resource => resource.id === added.id)?.data, { nested: { value: "committed" } });
    assert.equal(reloaded?.events.default.find(event => event.id === "freeze-event")?.detail, "Appended event");
  } finally {
    await client?.end();
    await admin.query('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)');
    await admin.end();
  }
});
