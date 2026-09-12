import type pg from "pg";
import { z } from "zod";
import { mortalityFixtures, syntheticDeath } from "../../../packages/engine/src/mortality.ts";

export const mortalityMigrationId = "authored-synthetic-mortality-v1";
const rowSchema = z.object({ scope: z.string(), id: z.string(), birthDate: z.string(), now: z.number().finite() });

export async function migrateMortality(client: Pick<pg.PoolClient, "query">): Promise<number> {
  await client.query("CREATE TABLE IF NOT EXISTS simulation_data_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now(),changed_rows integer NOT NULL)");
  if ((await client.query("SELECT 1 FROM simulation_data_migrations WHERE id=$1", [mortalityMigrationId])).rows.length) return 0;
  let changed = 0;
  for (const baseline of [true, false]) {
    const table = baseline ? "population_patients" : "world_patients";
    const scope = baseline ? "population_id" : "world_id";
    // A shared baseline uses the earliest attached world's clock so its death date is valid in each world.
    const clock = baseline
      ? "COALESCE((SELECT MIN((w.payload->>'now')::double precision) FROM simulation_worlds w WHERE w.population_id=p.population_id),extract(epoch FROM now()) * 1000)"
      : "(SELECT (w.payload->>'now')::double precision FROM simulation_worlds w WHERE w.id=p.world_id)";
    const rows = z.array(rowSchema).parse((await client.query(`SELECT p.${scope} AS scope,p.id,p.payload->>'birthDate' AS "birthDate",(${clock})::double precision AS now FROM ${table} p WHERE p.id=ANY($1::text[]) AND NOT p.payload ? 'death' ${baseline ? "" : "AND NOT p.deleted"}`, [[...mortalityFixtures.keys()]])).rows);
    for (const row of rows) {
      const death = syntheticDeath(row, row.now);
      if (!death) continue;
      const result = await client.query(`UPDATE ${table} SET payload=jsonb_set(payload,'{death}',$3::jsonb) WHERE ${scope}=$1 AND id=$2 AND NOT payload ? 'death'`, [row.scope,row.id,JSON.stringify(death)]);
      changed += result.rowCount ?? 0;
    }
  }
  await client.query("INSERT INTO simulation_data_migrations(id,changed_rows) VALUES($1,$2)", [mortalityMigrationId,changed]);
  return changed;
}
