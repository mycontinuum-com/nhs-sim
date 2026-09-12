import type pg from "pg";
import { z } from "zod";
import { createGenomeRecord } from "../../../packages/engine/src/genomics.ts";

const migrationId = "secondary-care-cyp2c19-v1";
const rowSchema = z.object({ scope: z.string(), id: z.string(), now: z.number().finite() });
const template = createGenomeRecord("template", 0).data;
const isGenome = (alias: string) => {
  const { variants, ...fixed } = template;
  return `${alias}.kind='genome-record' AND ${alias}.owner='hospital' AND ${alias}.payload->'visibleTo' ? 'hospital' AND ${alias}.payload->'data' @> '${JSON.stringify(fixed)}'::jsonb AND jsonb_array_length(CASE WHEN jsonb_typeof(${alias}.payload->'data'->'variants')='array' THEN ${alias}.payload->'data'->'variants' ELSE '[]'::jsonb END)=3 AND ` + [
    ["rs4244285", "G", "A", "G/G", "G/A", "A/A"],
    ["rs4986893", "G", "A", "G/G", "G/A", "A/A"],
    ["rs12248560", "C", "T", "C/C", "C/T", "T/T"],
  ].map(([rsid, reference, alternate, ...genotypes], index) => `${alias}.payload->'data'->'variants'->${index} @> '${JSON.stringify({rsid, reference, alternate})}'::jsonb AND ${alias}.payload->'data'->'variants'->${index}->>'genotype' IN (${genotypes.map(value => `'${value}'`).join(",")})`).join(" AND ");
};

export async function migrateGenomicRecords(client: Pick<pg.PoolClient, "query">, batchSize = 250): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("Genomic migration batch size must be 1 to 1000");
  await client.query("CREATE TABLE IF NOT EXISTS simulation_data_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now(),changed_rows integer NOT NULL)");
  if ((await client.query("SELECT 1 FROM simulation_data_migrations WHERE id=$1", [migrationId])).rows.length) return 0;
  let changed = 0;
  for (const baseline of [true, false]) {
    const table = baseline ? "population_resources" : "world_resources";
    const scope = baseline ? "population_id" : "world_id";
    const ordinalRows = z.array(z.object({ scope: z.string(), ordinal: z.number().int() })).parse((await client.query(`SELECT ${scope} AS scope,MAX(ordinal)::integer AS ordinal FROM ${table} GROUP BY ${scope}`)).rows);
    const ordinals = new Map(ordinalRows.map(row => [row.scope, row.ordinal]));
    let previousScope = "", previousId = "";
    for (;;) {
      const candidates = baseline
        ? `SELECT p.population_id AS scope,p.id,COALESCE((SELECT (w.payload->>'now')::double precision FROM simulation_worlds w WHERE w.population_id=p.population_id ORDER BY w.id LIMIT 1),extract(epoch FROM now()) * 1000)::double precision AS now FROM population_patients p WHERE NOT EXISTS (SELECT 1 FROM population_resources r WHERE r.population_id=p.population_id AND r.patient_id=p.id AND ${isGenome("r")})`
        : `SELECT w.id AS scope,p.id,(w.payload->>'now')::double precision AS now FROM simulation_worlds w JOIN (
            SELECT world_id,id FROM world_patients WHERE NOT deleted
            UNION
            SELECT wr.world_id,pr.patient_id AS id FROM world_resources wr JOIN simulation_worlds sw ON sw.id=wr.world_id JOIN population_resources pr ON pr.population_id=sw.population_id AND pr.id=wr.id WHERE ${isGenome("pr")}
          ) p ON p.world_id=w.id
          WHERE NOT EXISTS (SELECT 1 FROM world_patients deleted WHERE deleted.world_id=w.id AND deleted.id=p.id AND deleted.deleted)
          AND NOT EXISTS (SELECT 1 FROM world_resources own WHERE own.world_id=w.id AND own.patient_id=p.id AND NOT own.deleted AND ${isGenome("own")})
          AND NOT EXISTS (SELECT 1 FROM population_resources r WHERE r.population_id=w.population_id AND r.patient_id=p.id AND ${isGenome("r")} AND NOT EXISTS (SELECT 1 FROM world_resources shadow WHERE shadow.world_id=w.id AND shadow.id=r.id))`;
      const result = await client.query(`SELECT c.* FROM (${candidates}) c WHERE (c.scope,c.id)>($1,$2) ORDER BY c.scope,c.id LIMIT $3`, [previousScope, previousId, batchSize]);
      const found = z.array(rowSchema).parse(result.rows);
      if (!found.length) break;
      const updates = found.map(row => {
        const ordinal = (ordinals.get(row.scope) ?? -1) + 1;
        ordinals.set(row.scope, ordinal);
        const payload = createGenomeRecord(row.id, row.now);
        return { scope: row.scope, id: payload.id, ordinal, payload };
      });
      const written = await client.query(`INSERT INTO ${table} (${scope},id,ordinal,payload${baseline ? "" : ",deleted"}) SELECT x.scope,x.id,x.ordinal,x.payload${baseline ? "" : ",false"} FROM jsonb_to_recordset($1::jsonb) AS x(scope text,id text,ordinal integer,payload jsonb) ${baseline ? `ON CONFLICT (${scope},id) DO NOTHING` : `ON CONFLICT (${scope},id) DO UPDATE SET payload=excluded.payload,deleted=false WHERE ${table}.deleted`} RETURNING id`, [JSON.stringify(updates)]);
      if (written.rows.length !== updates.length) throw new Error("An existing record conflicts with the synthetic genomic record identifier");
      changed += updates.length;
      const last = found.at(-1);
      if (!last) throw new Error("Genomic migration batch unexpectedly empty");
      previousScope = last.scope; previousId = last.id;
    }
  }
  await client.query("INSERT INTO simulation_data_migrations(id,changed_rows) VALUES($1,$2)", [migrationId, changed]);
  return changed;
}
