import type pg from "pg";
import { seedWorld } from "../../../packages/engine/src/index.ts";

const migrationId = "historical-record-attribution-v2";
const creationActions = ["save_consultation", "register_attendance", "book_appointment", "create_referral", "draft_prescription", "order_test", "schedule_visit", "create_task", "connect_device"];

export async function migrateRecordAttribution(client: Pick<pg.PoolClient, "query">, batchSize = 500): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("Attribution migration batch size must be 1–1000");
  await client.query("CREATE TABLE IF NOT EXISTS simulation_data_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now(),changed_rows integer NOT NULL)");
  if ((await client.query("SELECT 1 FROM simulation_data_migrations WHERE id=$1", [migrationId])).rows.length) return 0;
  await client.query("CREATE TEMP TABLE attribution_seeds(id text PRIMARY KEY,payload jsonb) ON COMMIT DROP");
  await client.query("INSERT INTO attribution_seeds SELECT id,payload FROM jsonb_to_recordset($1) AS s(id text,payload jsonb)", [JSON.stringify(seedWorld("default", 42, 8).resources.map(record => ({ id: record.id, payload: record }))) ]);
  await client.query(`CREATE TEMP TABLE attribution_events ON COMMIT DROP AS
    SELECT e.world_id, e.payload->>'resourceId' AS resource_id, min(e.payload::text)::jsonb AS payload
    FROM world_events e JOIN world_resources r ON r.world_id=e.world_id AND r.id=e.payload->>'resourceId'
    WHERE NOT r.deleted AND e.payload->>'type'=ANY($1::text[])
      AND e.payload->>'time'=r.payload->>'createdAt'
      AND EXISTS(SELECT 1 FROM team_keys k WHERE k.world=e.world_id AND k.team=e.payload->>'actor')
    GROUP BY e.world_id,e.payload->>'resourceId' HAVING count(*)=1`, [creationActions]);
  await client.query("CREATE UNIQUE INDEX ON attribution_events(world_id,resource_id)");
  let changed = 0;
  for (const table of ["population_resources", "world_resources"] as const) {
    const baseline = table === "population_resources", scope = baseline ? "population_id" : "world_id";
    let previousScope = "", previousId = "";
    for (;;) {
      const result = await client.query(`WITH batch AS (
        SELECT r.${scope} AS scope,r.id,r.payload,
          CASE WHEN r.payload->'data'->>'synthetic'='true'
            OR (s.id IS NOT NULL AND s.payload->>'kind'=r.payload->>'kind' AND s.payload->>'title'=r.payload->>'title' AND s.payload->>'createdAt'=r.payload->>'createdAt')
            OR r.id LIKE 'hospital-attendance-seed-%' THEN true ELSE false END AS generated,
          CASE WHEN r.id ~ '^r-[0-9]+$' AND r.payload->>'patientId' IS NOT NULL AND r.owner='hospital'
            AND ((r.kind='encounter' AND r.payload->>'title' IN ('New A&E arrival','Winter-pressure A&E arrival')
                  AND ((r.payload->'data') - 'waitMinutes')='{}'::jsonb
                  AND (r.payload->>'dueAt')::double precision=r.created_at+86400000)
              OR (r.kind='hospital-attendance' AND r.payload->>'title' IN ('New A&E arrival','Winter-pressure A&E arrival')
                  AND r.payload->'data'->>'presentingComplaint'=r.payload->>'title'
                  AND r.payload->'data'->>'arrivalAt'=r.payload->>'createdAt'
                  AND r.payload->'data'->>'acuity'='3')
              OR (r.kind='encounter' AND r.payload->>'title'='A&E assessment waiting list'
                  AND r.payload->'data'->>'requires'='doctor and nurse'
                  AND ((r.payload->'data') - 'requires' - 'waitMinutes')='{}'::jsonb))
            THEN CASE WHEN r.payload->>'title'='Winter-pressure A&E arrival' THEN 'Simulation winter-pressure scenario'
                 WHEN r.payload->>'title'='A&E assessment waiting list' THEN 'Synthetic hospital seed' ELSE 'Simulation acute flow' END END AS generator,
          ${baseline ? "NULL::jsonb" : "e.payload"} AS event,
          (SELECT c FROM jsonb_array_elements(COALESCE(NULLIF(r.payload->'provenance'->'changes','null'::jsonb),'[]'::jsonb)) c
            WHERE c->>'version'='1' AND c->>'time'=r.payload->>'createdAt' AND c->>'action'=ANY($4::text[]) LIMIT 1) AS creation
        FROM ${table} r LEFT JOIN attribution_seeds s ON s.id=r.id
        ${baseline ? "" : "LEFT JOIN attribution_events e ON e.world_id=r.world_id AND e.resource_id=r.id"}
        WHERE ${baseline ? "" : "NOT r.deleted AND "}(r.${scope},r.id)>($1,$2)
          AND COALESCE(r.payload->'provenance'->'created','null'::jsonb)='null'::jsonb
        ORDER BY r.${scope},r.id LIMIT $3
      ), repaired AS (
        SELECT *, CASE WHEN creation IS NOT NULL THEN 'recorded-change' WHEN event IS NOT NULL THEN 'team-event' WHEN generator IS NOT NULL THEN 'simulation-generator' WHEN generated THEN 'synthetic-history' ELSE 'unavailable' END AS basis,
          COALESCE(creation,CASE WHEN event IS NOT NULL THEN jsonb_build_object('actor',jsonb_build_object('kind','team','name',event->>'actor'),'source',payload->>'owner','action',event->>'type','time',payload->'createdAt','version',1)
          WHEN generator IS NOT NULL THEN jsonb_build_object('actor',jsonb_build_object('kind','simulation','name',generator),'source',payload->>'owner','action','create_record','time',payload->'createdAt','version',1)
          WHEN generated THEN jsonb_build_object('actor',jsonb_build_object('kind','simulation','name',CASE WHEN nullif(trim(payload->'data'->>'author'),'') IS NOT NULL THEN 'Synthetic clinician '||trim(payload->'data'->>'author') ELSE 'Synthetic '||CASE WHEN payload->>'owner'='gp' THEN 'GP' ELSE payload->>'owner' END||' history' END),'source',payload->>'owner','action','generate_history','time',payload->'createdAt','version',1)
          ELSE 'null'::jsonb END) AS created FROM batch
      ), updated AS (UPDATE ${table} r SET payload=jsonb_set(r.payload,'{provenance}',
        COALESCE(NULLIF(r.payload->'provenance','null'::jsonb),'{}'::jsonb)||jsonb_build_object('created',u.created,'changes',COALESCE(NULLIF(r.payload->'provenance'->'changes','null'::jsonb),'[]'::jsonb),'recovery',jsonb_build_object('migration',$5::text,'basis',u.basis)))
        FROM repaired u WHERE r.${scope}=u.scope AND r.id=u.id RETURNING u.scope,u.id) SELECT scope,id FROM updated ORDER BY scope,id`,
      [previousScope,previousId,batchSize,creationActions,migrationId]);
      if (!result.rows.length) break;
      changed += result.rows.length;
      const last = result.rows.at(-1);
      previousScope = last.scope; previousId = last.id;
    }
  }
  await client.query("INSERT INTO simulation_data_migrations(id,changed_rows) VALUES($1,$2)", [migrationId,changed]);
  return changed;
}
