import type pg from "pg";
import { z } from "zod";
import type { Patient } from "../../../packages/contracts/src/index.ts";
import {
  generateAllergyHistory,
  generateMedicationHistory,
} from "../../../packages/engine/src/medication-history.ts";

const migrationId = "condition-linked-medication-history-v1";
const patientSchema = z.object({
  id: z.string(),
  name: z.string(),
  birthDate: z.string(),
  localIds: z.record(z.string(), z.string()),
  conditions: z.array(z.string()),
  needs: z.array(z.string()),
  goals: z.array(z.string()),
  synthetic: z.literal(true),
});
const recordSchema = z
  .object({ id: z.string(), kind: z.string(), data: z.record(z.string(), z.unknown()) })
  .passthrough();
const entrySchema = z.object({ term: z.string() }).passthrough();
function term(entry: unknown) {
  const parsed = entrySchema.safeParse(entry);
  return parsed.success ? parsed.data.term : undefined;
}
function replaceCollection(
  entries: unknown[],
  prefix: string,
  generated: unknown[],
  recordId?: string,
) {
  const retained = entries.flatMap((entry, index) => {
    if (term(entry)?.startsWith(prefix)) return [];
    if (recordId) {
      const parsed = entrySchema.safeParse(entry);
      if (parsed.success)
        return [
          {
            ...parsed.data,
            key: typeof parsed.data.key === "string" ? parsed.data.key : `${recordId}:${index}`,
          },
        ];
    }
    return [entry];
  });
  const names = new Set(
    retained
      .map(term)
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase()),
  );
  const additions = generated.filter((entry) => {
    const name = term(entry)?.trim().toLowerCase();
    if (!name || names.has(name)) return false;
    return true;
  });
  return [
    ...retained,
    ...additions.map((entry, index) =>
      recordId
        ? { ...entrySchema.parse(entry), key: `${recordId}:generated-allergy-v1:${index}` }
        : entry,
    ),
  ];
}
export function migrateMedicationRecord(input: unknown, patient: Patient | undefined, now: number) {
  const record = recordSchema.parse(input);
  if (record.kind === "prescription" && record.data.drug === "SYNTHETIC-MED-A")
    return { ...record, data: { ...record.data, drug: "Furosemide tablets" } };
  if (record.kind !== "ehr-record") return record;
  const medications = record.data.medications,
    allergies = record.data.allergies;
  const replaceMedications =
    Array.isArray(medications) &&
    medications.some((entry) => term(entry)?.startsWith("SYNTHETIC-MED-"));
  const replaceAllergies =
    Array.isArray(allergies) &&
    allergies.some((entry) => term(entry)?.startsWith("SYNTHETIC-ALLERGEN-"));
  if (!replaceMedications && !replaceAllergies) return record;
  if (!patient)
    throw new Error("Placeholder EHR record has no associated synthetic patient: " + record.id);
  return {
    ...record,
    data: {
      ...record.data,
      medicationProfile: "condition-linked-v1",
      ...(replaceMedications
        ? {
            medications: replaceCollection(
              medications,
              "SYNTHETIC-MED-",
              generateMedicationHistory(patient, now),
            ),
          }
        : {}),
      ...(replaceAllergies
        ? {
            allergies: replaceCollection(
              allergies,
              "SYNTHETIC-ALLERGEN-",
              generateAllergyHistory(patient, now),
              record.id,
            ),
          }
        : {}),
    },
  };
}
const eligible = `(r.kind='prescription' AND r.payload->'data'->>'drug'='SYNTHETIC-MED-A') OR (r.kind='ehr-record' AND (r.payload @? '$.data.medications[*] ? (@.term like_regex "^SYNTHETIC-MED-")' OR r.payload @? '$.data.allergies[*] ? (@.term like_regex "^SYNTHETIC-ALLERGEN-")'))`;
export async function migrateMedicationHistory(
  client: Pick<pg.PoolClient, "query">,
  batchSize = 250,
): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error("Medication migration batch size must be 1–1000");
  await client.query(
    "CREATE TABLE IF NOT EXISTS simulation_data_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now(),changed_rows integer NOT NULL)",
  );
  if (
    (await client.query("SELECT 1 FROM simulation_data_migrations WHERE id=$1", [migrationId])).rows
      .length
  )
    return 0;
  let changed = 0;
  for (const table of ["population_resources", "world_resources"] as const) {
    const baseline = table === "population_resources",
      scope = baseline ? "population_id" : "world_id";
    let previousScope = "",
      previousId = "";
    for (;;) {
      const patientJoin = baseline
        ? "LEFT JOIN population_patients p ON p.population_id=r.population_id AND p.id=r.patient_id"
        : "JOIN simulation_worlds w ON w.id=r.world_id LEFT JOIN world_patients own ON own.world_id=r.world_id AND own.id=r.patient_id LEFT JOIN population_patients p ON p.population_id=w.population_id AND p.id=r.patient_id";
      const patient = baseline
        ? "p.payload"
        : "CASE WHEN own.id IS NOT NULL THEN CASE WHEN own.deleted THEN NULL ELSE own.payload END ELSE p.payload END";
      const clock = baseline
        ? "COALESCE((SELECT (w.payload->>'now')::double precision FROM simulation_worlds w WHERE w.population_id=r.population_id ORDER BY (w.id='default') DESC,w.id LIMIT 1),r.created_at)"
        : "COALESCE((w.payload->>'now')::double precision,r.created_at)";
      const result = await client.query(
        `SELECT r.${scope} AS scope,r.id,r.payload,${patient} AS patient,${clock} AS now FROM ${table} r ${patientJoin} WHERE ${baseline ? "" : "NOT r.deleted AND "}(r.${scope},r.id)>($1,$2) AND (${eligible}) ORDER BY r.${scope},r.id LIMIT $3`,
        [previousScope, previousId, batchSize],
      );
      if (!result.rows.length) break;
      const updates = result.rows.map((row) => ({
        scope: row.scope,
        id: row.id,
        payload: migrateMedicationRecord(
          row.payload,
          row.patient ? patientSchema.parse(row.patient) : undefined,
          z.number().finite().parse(row.now),
        ),
      }));
      await client.query(
        `UPDATE ${table} r SET payload=u.payload FROM jsonb_to_recordset($1::jsonb) AS u(scope text,id text,payload jsonb) WHERE r.${scope}=u.scope AND r.id=u.id`,
        [JSON.stringify(updates)],
      );
      changed += updates.length;
      const last = updates.at(-1);
      if (!last) throw new Error("Medication migration batch unexpectedly empty");
      previousScope = last.scope;
      previousId = last.id;
    }
  }
  await client.query("INSERT INTO simulation_data_migrations(id,changed_rows) VALUES($1,$2)", [
    migrationId,
    changed,
  ]);
  return changed;
}
