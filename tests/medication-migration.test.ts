import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { seedWorld } from "../packages/engine/src/index.ts";
import { generateMedicationHistory } from "../packages/engine/src/medication-history.ts";
import {
  migrateMedicationHistory,
  migrateMedicationRecord,
} from "../apps/server/src/medication-migration.ts";
import { RowPersistence } from "../apps/server/src/persistence.ts";
import { Store } from "../apps/server/src/store.ts";
const world = seedWorld("default", 42, 8),
  patient = world.patients[2]!;
function record(id = "record-0") {
  return {
    id,
    patientId: patient.id,
    kind: "ehr-record",
    title: "Preserved title",
    owner: "gp",
    visibleTo: ["gp"],
    status: "available",
    priority: "routine",
    createdAt: world.now - 86400000,
    version: 7,
    data: {
      notes: "Preserve user narrative",
      medications: [
        { term: "SYNTHETIC-MED-1" },
        { term: "User-authored medicine", note: "Keep custom fields", isCurrent: false },
      ],
      allergies: [
        { term: "SYNTHETIC-ALLERGEN-A" },
        { term: "User-authored allergen", reaction: "Recorded user reaction", status: "active" },
      ],
    },
  };
}
test("medication migration preserves named entries, notes and stable allergy source keys", () => {
  const input = record(),
    result = migrateMedicationRecord(input, patient, world.now);
  assert.equal(result.version, 7);
  assert.equal(result.title, input.title);
  assert.equal(result.data.notes, input.data.notes);
  assert.equal(result.data.medicationProfile, "condition-linked-v1");
  const medications = result.data.medications;
  assert.ok(Array.isArray(medications));
  assert.deepEqual(medications[0], input.data.medications[1]);
  assert.ok(medications.some((entry) => entry.term === "Salbutamol inhaler"));
  assert.equal(JSON.stringify(medications).includes("SYNTHETIC-MED-"), false);
  const allergies = result.data.allergies;
  assert.ok(Array.isArray(allergies));
  assert.deepEqual(allergies[0], { ...input.data.allergies[1], key: "record-0:1" });
  assert.equal(JSON.stringify(allergies).includes("SYNTHETIC-ALLERGEN-"), false);
  assert.deepEqual(migrateMedicationRecord(result, patient, world.now), result);
});
test("generated current and historical issues survive replacement while retained named medicines are not duplicated", () => {
  const historicalPatient = Array.from({ length: 100 }, (_, index) => ({
    ...patient,
    id: "SIM-MIGRATION-" + index,
  })).find((person) =>
    generateMedicationHistory(person, world.now).some((entry) => !entry.isCurrent),
  );
  assert.ok(historicalPatient);
  const generated = generateMedicationHistory(historicalPatient, world.now);
  const input = record();
  input.data.medications = [{ term: "SYNTHETIC-MED-1" }];
  const replaced = migrateMedicationRecord(input, historicalPatient, world.now);
  assert.deepEqual(replaced.data.medications, generated);
  const retained = {
    ...input,
    data: {
      ...input.data,
      medications: [
        { term: "SYNTHETIC-MED-1" },
        { term: "Salbutamol inhaler", note: "A user entry" },
      ],
    },
  };
  const deduplicated = migrateMedicationRecord(retained, historicalPatient, world.now).data
    .medications;
  assert.ok(Array.isArray(deduplicated));
  assert.equal(deduplicated.filter((entry) => entry.term === "Salbutamol inhaler").length, 1);
});
test("prescription fixture migration changes only the drug field", () => {
  const input = {
    ...record(),
    kind: "prescription",
    data: { drug: "SYNTHETIC-MED-A", stock: 3, note: "Existing fixture note" },
  };
  assert.deepEqual(migrateMedicationRecord(input, undefined, world.now), {
    ...input,
    data: { ...input.data, drug: "Furosemide tablets" },
  });
});

test(
  "PostgreSQL medication migration batches atomically, prefers patient overlays and runs before hydration",
  { skip: !process.env.ROW_STORAGE_TEST_URL },
  async () => {
    const url = process.env.ROW_STORAGE_TEST_URL;
    assert.ok(url);
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const database = "nhssim_medication_test_" + Date.now();
    const isolated = new URL(url);
    isolated.pathname = "/" + database;
    let client: pg.Client | undefined, store: Store | undefined;
    try {
      await admin.query('CREATE DATABASE "' + database + '"');
      client = new pg.Client({ connectionString: isolated.toString() });
      await client.connect();
      await new RowPersistence().schema(client);
      const { patients, resources, ...metadata } = world;
      await client.query(
        "INSERT INTO simulation_populations(id,version) VALUES('base',1); INSERT INTO simulation_storage VALUES(1,2)",
      );
      await client.query(
        "INSERT INTO simulation_worlds VALUES('default','base',$1),('overlay','base',$2)",
        [
          JSON.stringify(metadata),
          JSON.stringify({ ...metadata, id: "overlay", now: world.now + 86400000 }),
        ],
      );
      await client.query(
        "INSERT INTO population_patients(population_id,id,ordinal,payload) VALUES('base',$1,0,$2)",
        [patient.id, JSON.stringify(patient)],
      );
      await client.query(
        "INSERT INTO world_patients(world_id,id,ordinal,payload) VALUES('overlay',$1,0,$2)",
        [patient.id, JSON.stringify({ ...patient, conditions: ["Type 2 diabetes"] })],
      );
      for (let index = 0; index < 6; index++) {
        const payload = record("record-" + index);
        await client.query(
          "INSERT INTO population_resources(population_id,id,ordinal,payload) VALUES('base',$1,$2,$3)",
          [payload.id, index, JSON.stringify(payload)],
        );
      }
      const prescription = {
        ...record("prescription-fixture"),
        kind: "prescription",
        data: { drug: "SYNTHETIC-MED-A", stock: 3, note: "Stock fixture only" },
      };
      await client.query(
        "INSERT INTO population_resources(population_id,id,ordinal,payload) VALUES('base',$1,6,$2)",
        [prescription.id, JSON.stringify(prescription)],
      );
      await client.query(
        "INSERT INTO world_resources(world_id,id,ordinal,payload) VALUES('overlay','record-0',0,$1)",
        [JSON.stringify(record())],
      );
      await client.query(
        "CREATE FUNCTION fail_medication_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='record-3' THEN RAISE EXCEPTION 'test interrupted migration'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_medication_batch BEFORE UPDATE ON population_resources FOR EACH ROW EXECUTE FUNCTION fail_medication_batch()",
      );
      await client.query("BEGIN");
      await assert.rejects(
        () => migrateMedicationHistory(client!, 2),
        /test interrupted migration/,
      );
      await client.query("ROLLBACK");
      assert.deepEqual(
        (await client.query("SELECT payload FROM population_resources WHERE id='record-0'")).rows[0]
          .payload,
        record(),
      );
      assert.equal(
        (await client.query("SELECT to_regclass('simulation_data_migrations') AS relation")).rows[0]
          .relation,
        null,
      );
      await client.query(
        "DROP TRIGGER fail_medication_batch ON population_resources; DROP FUNCTION fail_medication_batch()",
      );
      await client.query("BEGIN");
      assert.equal(await migrateMedicationHistory(client, 2), 8);
      await client.query("COMMIT");
      assert.equal(await migrateMedicationHistory(client, 2), 0);
      const baseline = (
        await client.query("SELECT payload FROM population_resources WHERE id='record-0'")
      ).rows[0].payload;
      const overlay = (
        await client.query("SELECT payload FROM world_resources WHERE id='record-0'")
      ).rows[0].payload;
      assert.ok(
        baseline.data.medications.some(
          (entry: { term: string }) => entry.term === "Salbutamol inhaler",
        ),
      );
      assert.ok(
        overlay.data.medications.some(
          (entry: { term: string }) => entry.term === "Metformin tablets",
        ),
      );
      assert.equal(
        overlay.data.medications.some(
          (entry: { term: string }) => entry.term === "Salbutamol inhaler",
        ),
        false,
      );
      assert.deepEqual(baseline.data.allergies[0], {
        ...record().data.allergies[1],
        key: "record-0:1",
      });
      assert.equal(baseline.data.notes, "Preserve user narrative");
      assert.deepEqual(
        (
          await client.query(
            "SELECT payload FROM population_resources WHERE id='prescription-fixture'",
          )
        ).rows[0].payload,
        { ...prescription, data: { ...prescription.data, drug: "Furosemide tablets" } },
      );
      await client.query("DELETE FROM simulation_data_migrations");
      await client.query("UPDATE population_resources SET payload=$1 WHERE id='record-0'", [
        JSON.stringify(record()),
      ]);
      store = new Store(isolated.toString());
      await store.init();
      const hydrated = store.engine
        .require("default")
        .resources.find((resource) => resource.id === "record-0");
      assert.ok(hydrated);
      assert.equal(JSON.stringify(hydrated.data).includes("SYNTHETIC-MED-"), false);
      assert.equal(Object.isFrozen(hydrated.data), true);
    } finally {
      await store?.close();
      await client?.end();
      await admin.query('DROP DATABASE IF EXISTS "' + database + '" WITH(FORCE)');
      await admin.end();
    }
  },
);
