import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { Store } from "../apps/server/src/store.ts";
import { teamNameSchema } from "../packages/contracts/src/team.ts";

test("team names ignore case and whitespace and reject empty names", () => {
  assert.equal(teamNameSchema.parse(" Team \t Blue\n"), "teamblue");
  assert.equal(teamNameSchema.safeParse(" \t ").success, false);
});

test("name joins share keys and worlds across concurrency, legacy records and restart", { skip: !process.env.ROW_STORAGE_TEST_URL }, async () => {
  const url = process.env.ROW_STORAGE_TEST_URL;
  assert.ok(url);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const database = `nhssim_rejoin_test_${Date.now()}`;
  const isolated = new URL(url);
  isolated.pathname = `/${database}`;
  let store: Store | undefined;
  async function closeStore() {
    if (!store) return;
    if (store.lockClient) {
      await store.lockClient.query("SELECT pg_advisory_unlock(7812026)");
      store.lockClient.release();
    }
    await store.pool.end();
  }
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    store = new Store(isolated.toString());
    await store.init();
    const [first, joined] = await Promise.all([
      store.issue(" Blue Team ", ["gp"]),
      store.issue("blue\tteam", ["gp", "hospital"]),
    ]);
    assert.equal(first.teamName, "blueteam");
    assert.equal(first.created, true);
    assert.equal(joined.created, false);
    assert.equal(joined.apiKey, first.apiKey);
    assert.equal(joined.world, first.world);
    assert.deepEqual(joined.scopes, ["gp"]);
    const other = await store.issue("Green Team", ["hospital"]);
    assert.notEqual(other.apiKey, first.apiKey);
    assert.notEqual(other.world, first.world);

    const legacyRaw = "sim_legacy_key_for_test";
    const legacyHash = createHash("sha256").update(legacyRaw).digest("hex");
    await store.pool.query("INSERT INTO team_keys(hash,team,world,scopes) VALUES($1,'Legacy Team',$2,'[\"gp\"]'::jsonb)", [legacyHash, first.world]);
    store.keys = (await store.pool.query("SELECT hash,team,world,scopes,recoverable_key FROM team_keys")).rows;
    const legacy = await store.issue(" LEGACYteam ", ["gp", "hospital"]);
    assert.equal(legacy.world, first.world);
    assert.equal(legacy.team, "Legacy Team");
    assert.equal(legacy.created, false);
    assert.deepEqual(legacy.scopes, ["gp"]);
    assert.equal(store.authenticate(legacyRaw)?.world, first.world);
    assert.equal((await store.issue("Legacy Team", ["hospital"])).apiKey, legacy.apiKey);

    await store.pool.query("INSERT INTO team_keys(hash,team,world,scopes) VALUES('collision','BLUE TEAM',$1,'[\"gp\"]'::jsonb)", [other.world]);
    store.keys = (await store.pool.query("SELECT hash,team,world,scopes,recoverable_key FROM team_keys")).rows;
    await assert.rejects(store.issue("blueteam", ["gp"]), { status: 409 });
    assert.equal(store.authenticate(first.apiKey)?.world, first.world);
    await closeStore();
    store = new Store(isolated.toString());
    await store.init();
    assert.equal((await store.issue("legacyteam", ["gp"])).apiKey, legacy.apiKey);
    assert.equal(store.authenticate(legacyRaw)?.world, first.world);
    assert.equal((await store.issue("green team", ["hospital"])).apiKey, other.apiKey);
  } finally {
    await closeStore();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  }
});
