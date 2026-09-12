import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { changedRows } from "../apps/server/src/persistence.ts";
import { Store } from "../apps/server/src/store.ts";
import { Engine } from "../packages/engine/src/index.ts";

test("row diff retains unchanged identities and detects replacements, additions and removals", () => {
  const a = { id: "a", value: 1 },
    b = { id: "b", value: 2 },
    updated = { ...b, value: 3 },
    added = { id: "c", value: 4 };
  assert.deepEqual(changedRows([a, b], [a, updated]), { upserts: [updated], deleted: [] });
  assert.deepEqual(changedRows([a, b], [b, added]), { upserts: [added], deleted: ["a"] });
  const shared = [a, b];
  assert.deepEqual(changedRows(shared, shared), { upserts: [], deleted: [] });
});

test(
  "PostgreSQL row storage migrates, shares baselines, rolls back and reloads overlays",
  { skip: !process.env.ROW_STORAGE_TEST_URL },
  async () => {
    const url = process.env.ROW_STORAGE_TEST_URL;
    assert.ok(url);
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const database = "nhssim_storage_test_" + Date.now();
    const isolated = new URL(url);
    isolated.pathname = "/" + database;
    let store: Store | undefined;
    try {
      await admin.query('CREATE DATABASE "' + database + '"');
      const seed = new pg.Client({ connectionString: isolated.toString() });
      await seed.connect();
      const legacy = new Engine();
      legacy.transaction("default", (world) => {
        const patient = world.patients[0];
        assert.ok(patient);
        patient.name = "Published baseline Avery";
      });
      legacy.create("existing", 51, 8);
      const note = legacy.action(
        "existing",
        "gp",
        {
          type: "save_consultation",
          patientId: "SIM-000001",
          title: "Preserve this fictional note",
          text: "Authored integration test note.",
          consultationStatus: "saved",
        },
        "tester",
      );
      await seed.query(
        "CREATE TABLE simulation_state(id integer PRIMARY KEY,schema_version integer NOT NULL,payload jsonb NOT NULL); CREATE TABLE team_keys(hash text PRIMARY KEY,team text NOT NULL,world text NOT NULL,scopes jsonb NOT NULL)",
      );
      await seed.query("INSERT INTO simulation_state VALUES(1,1,$1)", [
        JSON.stringify(legacy.state),
      ]);
      await seed.query(
        "INSERT INTO team_keys VALUES('preserved-key','Existing team','existing','[\"gp\"]')",
      );
      await seed.end();
      store = new Store(isolated.toString());
      await store.init();
      assert.equal(store.keys[0]?.hash, "preserved-key");
      const committedBeforeClock = store.engine.state;
      await store.run(() => store!.engine.clock("default", { paused: true, advanceMinutes: 1 }, "Clock QA"), "default");
      assert.equal(store.engine.require("default").now, committedBeforeClock.worlds.default.now + 60_000);
      assert.equal(store.engine.require("default").resources, committedBeforeClock.worlds.default.resources);
      assert.equal(Object.isFrozen(store.engine.state), true);
      const committedClock = store.engine.state;
      await assert.rejects(store.run(() => store!.engine.clock("default", { advanceMinutes: -1 }, "Clock QA")));
      assert.equal(store.engine.state, committedClock);
      assert.equal(Object.isFrozen(store.engine.require("default").patients[0]), true);
      assert.equal(Object.isFrozen(store.engine.require("default").resources[0]?.data), true);
      assert.equal(Object.isFrozen(store.engine.require("default").resources), true);
      assert.deepEqual(
        (await store.pool.query("SELECT payload FROM simulation_state")).rows[0].payload,
        JSON.parse(JSON.stringify(legacy.state)),
      );
      assert.equal(
        (await store.pool.query("SELECT schema_version FROM simulation_storage")).rows[0]
          .schema_version,
        2,
      );
      assert.equal(
        store.engine.require("existing").resources.find((row) => row.id === note.id)?.data.text,
        "Authored integration test note.",
      );
      const defaultPopulation = (
        await store.pool.query("SELECT population_id FROM simulation_worlds WHERE id='default'")
      ).rows[0].population_id;
      await store.publishPopulation("default");
      assert.equal(
        (await store.pool.query("SELECT population_id FROM simulation_worlds WHERE id='default'"))
          .rows[0].population_id,
        defaultPopulation,
      );
      await store.run(() => store?.attachPopulation("existing", "default"), "existing");
      assert.equal(store.engine.require("existing").patients.length, 500);
      assert.equal(
        store.engine.require("existing").patients[100],
        store.engine.require("default").patients[100],
      );
      const bindings = await store.pool.query(
        "SELECT population_id FROM simulation_worlds WHERE id IN ('default','existing')",
      );
      assert.equal(new Set(bindings.rows.map((row) => row.population_id)).size, 1);
      const patients = await store.readPatients("existing", "", 10, 7);
      assert.equal(patients.total, 500);
      assert.equal(patients.items.length, 7);
      assert.equal(patients.items[0]?.id, "SIM-000011");
      const condition = await store.readPatients("existing", "diab");
      assert.ok(condition.total > 0);
      assert.ok(
        condition.items.every((patient) =>
          patient.conditions.some((condition) => condition.toLowerCase().includes("diab")),
        ),
      );
      const idSearch = await store.readPatients("existing", "SIM-000100");
      assert.equal(idSearch.total, 1);
      const needs = await store.readPatients("existing", "transport");
      assert.ok(needs.total > 0);
      const startsAt = store.engine.require("existing").now + 86400000;
      const booking = await store.run(
        () =>
          store!.engine.action(
            "existing",
            "gp",
            {
              type: "book_appointment",
              patientId: "SIM-000001",
              startsAt,
              clinician: "Storage calendar tester",
            },
            "tester",
          ),
        "existing",
      );
      const calendar = await store.readResources(
        "existing",
        "gp",
        undefined,
        0,
        100,
        "appointment",
        new Date(startsAt).toISOString().slice(0, 10),
      );
      assert.ok(calendar.resources.some((row) => row.id === booking.id));
      assert.ok(
        calendar.resources.every(
          (row) =>
            Number(row.data.startsAt) >=
            Date.parse(new Date(startsAt).toISOString().slice(0, 10) + "T00:00:00Z"),
        ),
      );

      const consultation = await store.readResources(
        "existing",
        "gp",
        "SIM-000001",
        0,
        20,
        "consultation",
      );
      assert.ok(consultation.resources.some((row) => row.id === note.id));
      const prior = store.engine.state;
      await assert.rejects(
        () =>
          store!.run(() => {
            store!.engine.action(
              "existing",
              "gp",
              { type: "create_task", patientId: "SIM-000001", title: "Must roll back" },
              "tester",
            );
            throw Error("abort integration operation");
          }, "existing"),
        /abort/,
      );
      assert.equal(store.engine.state, prior);
      await store.pool.query(
        "CREATE FUNCTION reject_test_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected database failure'; END $$; CREATE TRIGGER reject_test_write BEFORE INSERT OR UPDATE ON world_resources FOR EACH ROW EXECUTE FUNCTION reject_test_write()",
      );
      await store.run(() => {}, "existing");
      await assert.rejects(
        () =>
          store!.run(
            () =>
              store!.engine.action(
                "existing",
                "gp",
                { type: "create_task", patientId: "SIM-000001", title: "Rejected DB write" },
                "tester",
              ),
            "existing",
          ),
        /injected database failure/,
      );
      assert.equal(store.engine.state, prior);
      await store.pool.query(
        "DROP TRIGGER reject_test_write ON world_resources; DROP FUNCTION reject_test_write()",
      );
      const beforeOverlay = Number(
        (
          await store.pool.query(
            "SELECT count(*) AS count FROM world_resources WHERE world_id='existing'",
          )
        ).rows[0].count,
      );
      const created = await store.run(
        () =>
          store!.engine.action(
            "existing",
            "gp",
            {
              type: "create_task",
              patientId: "SIM-000001",
              title: "Persist only this consultation",
            },
            "tester",
            "durable-receipt",
          ),
        "existing",
      );
      assert.equal(
        Number(
          (
            await store.pool.query(
              "SELECT count(*) AS count FROM world_resources WHERE world_id='existing'",
            )
          ).rows[0].count,
        ),
        beforeOverlay + 1,
      );
      assert.equal(
        Object.isFrozen(
          store.engine.require("existing").resources.find((row) => row.id === created.id)?.data,
        ),
        true,
      );
      const resourcePage = await store.readResources("existing", "gp", undefined, 0, 3);
      assert.equal(resourcePage.resources.length, 3);
      assert.ok(resourcePage.resourceTotal > 3);
      const team = await store.issue("Baseline attached team", ["gp"]);
      assert.equal(store.engine.require(team.world).patients.length, 500);
      assert.equal(
        store.engine.require(team.world).patients,
        store.engine.require("default").patients,
      );
      assert.equal(
        store.engine.require(team.world).resources,
        store.engine.require("default").resources,
      );
      assert.equal(store.engine.require(team.world).patients[0]?.name, "Published baseline Avery");
      assert.equal(
        Number(
          (
            await store.pool.query(
              "SELECT count(*) AS count FROM world_patients WHERE world_id=$1",
              [team.world],
            )
          ).rows[0].count,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await store.pool.query(
              "SELECT count(*) AS count FROM world_resources WHERE world_id=$1",
              [team.world],
            )
          ).rows[0].count,
        ),
        0,
      );
      const sharedId = (
        await store.pool.query("SELECT population_id FROM simulation_worlds WHERE id=$1", [
          team.world,
        ])
      ).rows[0].population_id;
      assert.equal(sharedId, defaultPopulation);
      await store.close();
      store = new Store(isolated.toString());
      await store.init();
      assert.equal(
        store.engine.require("existing").resources.find((row) => row.id === created.id)?.title,
        "Persist only this consultation",
      );
      assert.ok(store.engine.state.receipts["existing:durable-receipt"]);
      assert.equal(
        Object.isFrozen(
          store.engine.require("existing").resources.find((row) => row.id === created.id)?.data,
        ),
        true,
      );
      assert.equal(Object.isFrozen(store.engine.require("default").patients[0]), true);
      assert.equal(Object.isFrozen(store.engine.require("existing").resources), true);
      assert.equal(
        store.engine.require("existing").patients[100],
        store.engine.require("default").patients[100],
      );
      assert.ok(store.authenticate(team.apiKey));
      assert.deepEqual(
        (await store.pool.query("SELECT payload FROM simulation_state")).rows[0].payload,
        JSON.parse(JSON.stringify(legacy.state)),
      );
    } finally {
      await store?.close();
      await admin.query('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)');
      await admin.end();
    }
  },
);
