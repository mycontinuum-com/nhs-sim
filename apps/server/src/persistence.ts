import { freeze } from "immer";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Engine } from "../../../packages/engine/src/index.ts";
import type { Patient, Resource, World } from "../../../packages/contracts/src/index.ts";

type State = Engine["state"];
type Population = { id: string; patients: Patient[]; resources: Resource[] };
type Queryable = Pick<pg.PoolClient, "query">;
type Row = { id: string; payload: unknown; deleted?: boolean; ordinal?: number };
const freezeRows = (rows: readonly object[]) => {
  for (const row of rows) freeze(row, true);
};
const metadata = (world: World) => {
  const { patients, resources, ...rest } = world;
  return rest;
};
export function changedRows<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
): { upserts: T[]; deleted: string[] } {
  if (before === after) return { upserts: [], deleted: [] };
  if (before.length === after.length && before.every((row, index) => row.id === after[index]?.id))
    return { upserts: after.filter((row, index) => row !== before[index]), deleted: [] };
  const previous = new Map(before.map((row) => [row.id, row])),
    present = new Set(after.map((row) => row.id));
  return {
    upserts: after.filter((row) => row !== previous.get(row.id)),
    deleted: before.filter((row) => !present.has(row.id)).map((row) => row.id),
  };
}
const schema = `
CREATE TABLE IF NOT EXISTS simulation_storage (id integer PRIMARY KEY CHECK(id=1), schema_version integer NOT NULL);
CREATE TABLE IF NOT EXISTS simulation_populations (id text PRIMARY KEY, version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS simulation_worlds (id text PRIMARY KEY, population_id text NOT NULL REFERENCES simulation_populations(id), payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS population_patients (population_id text NOT NULL REFERENCES simulation_populations(id), id text NOT NULL, ordinal integer NOT NULL, payload jsonb NOT NULL, name text GENERATED ALWAYS AS (payload->>'name') STORED, search_text text GENERATED ALWAYS AS (coalesce(payload->>'name','') || ' ' || coalesce((payload->'conditions')::text,'') || ' ' || coalesce((payload->'needs')::text,'')) STORED, PRIMARY KEY(population_id,id));
CREATE TABLE IF NOT EXISTS population_resources (population_id text NOT NULL REFERENCES simulation_populations(id), id text NOT NULL, ordinal integer NOT NULL, payload jsonb NOT NULL, patient_id text GENERATED ALWAYS AS (payload->>'patientId') STORED, owner text GENERATED ALWAYS AS (payload->>'owner') STORED, kind text GENERATED ALWAYS AS (payload->>'kind') STORED, created_at double precision GENERATED ALWAYS AS ((payload->>'createdAt')::double precision) STORED, occurs_at double precision GENERATED ALWAYS AS (CASE WHEN payload->'data'->>'startsAt' ~ '^[0-9]+$' THEN (payload->'data'->>'startsAt')::double precision ELSE (payload->>'createdAt')::double precision END) STORED, PRIMARY KEY(population_id,id));
CREATE TABLE IF NOT EXISTS world_patients (world_id text NOT NULL REFERENCES simulation_worlds(id) ON DELETE CASCADE, id text NOT NULL, ordinal integer NOT NULL, payload jsonb, deleted boolean NOT NULL DEFAULT false, name text GENERATED ALWAYS AS (payload->>'name') STORED, search_text text GENERATED ALWAYS AS (coalesce(payload->>'name','') || ' ' || coalesce((payload->'conditions')::text,'') || ' ' || coalesce((payload->'needs')::text,'')) STORED, PRIMARY KEY(world_id,id));
CREATE TABLE IF NOT EXISTS world_resources (world_id text NOT NULL REFERENCES simulation_worlds(id) ON DELETE CASCADE, id text NOT NULL, ordinal integer NOT NULL, payload jsonb, deleted boolean NOT NULL DEFAULT false, patient_id text GENERATED ALWAYS AS (payload->>'patientId') STORED, owner text GENERATED ALWAYS AS (payload->>'owner') STORED, kind text GENERATED ALWAYS AS (payload->>'kind') STORED, created_at double precision GENERATED ALWAYS AS ((payload->>'createdAt')::double precision) STORED, occurs_at double precision GENERATED ALWAYS AS (CASE WHEN payload->'data'->>'startsAt' ~ '^[0-9]+$' THEN (payload->'data'->>'startsAt')::double precision ELSE (payload->>'createdAt')::double precision END) STORED, PRIMARY KEY(world_id,id));
CREATE TABLE IF NOT EXISTS world_events (world_id text NOT NULL REFERENCES simulation_worlds(id) ON DELETE CASCADE, id text NOT NULL, ordinal integer NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(world_id,id));
CREATE TABLE IF NOT EXISTS world_receipts (world_id text NOT NULL REFERENCES simulation_worlds(id) ON DELETE CASCADE, id text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(world_id,id));
CREATE INDEX IF NOT EXISTS population_patient_name ON population_patients(population_id,lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS world_patient_name ON world_patients(world_id,lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS population_patient_search ON population_patients USING gin(to_tsvector('simple',search_text));
CREATE INDEX IF NOT EXISTS world_patient_search ON world_patients USING gin(to_tsvector('simple',search_text));
CREATE INDEX IF NOT EXISTS population_patient_id_folded ON population_patients(population_id,lower(id) text_pattern_ops);
CREATE INDEX IF NOT EXISTS world_patient_id_folded ON world_patients(world_id,lower(id) text_pattern_ops);
CREATE INDEX IF NOT EXISTS population_patient_id_prefix ON population_patients(population_id,id text_pattern_ops);
CREATE INDEX IF NOT EXISTS world_patient_id_prefix ON world_patients(world_id,id text_pattern_ops);
CREATE INDEX IF NOT EXISTS population_resource_patient ON population_resources(population_id,patient_id,kind,created_at DESC);
CREATE INDEX IF NOT EXISTS world_resource_patient ON world_resources(world_id,patient_id,kind,created_at DESC);
CREATE INDEX IF NOT EXISTS population_resource_owner ON population_resources(population_id,owner,kind,created_at DESC);
CREATE INDEX IF NOT EXISTS world_resource_owner ON world_resources(world_id,owner,kind,created_at DESC);
CREATE INDEX IF NOT EXISTS population_resource_date ON population_resources(population_id,kind,occurs_at);
CREATE INDEX IF NOT EXISTS world_resource_date ON world_resources(world_id,kind,occurs_at);
CREATE INDEX IF NOT EXISTS world_event_order ON world_events(world_id,ordinal);
`;
async function rows(
  client: Queryable,
  table: string,
  scopeColumn: string,
  scope: string,
  input: Row[],
  overlays = false,
) {
  for (let offset = 0; offset < input.length; offset += 500) {
    const batch = input.slice(offset, offset + 500);
    const hasOrdinal = table !== "world_receipts";
    await client.query(
      `INSERT INTO ${table} (${scopeColumn},id,${hasOrdinal ? "ordinal," : ""}payload${overlays ? ",deleted" : ""}) SELECT $1,x.id,${hasOrdinal ? "x.ordinal," : ""}x.payload${overlays ? ",x.deleted" : ""} FROM jsonb_to_recordset($2::jsonb) AS x(id text,ordinal integer,payload jsonb,deleted boolean) ON CONFLICT (${scopeColumn},id) DO UPDATE SET payload=excluded.payload${hasOrdinal ? ",ordinal=excluded.ordinal" : ""}${overlays ? ",deleted=excluded.deleted" : ""}`,
      [scope, JSON.stringify(batch)],
    );
  }
}
export class RowPersistence {
  private populations = new Map<string, Population>();
  private worldPopulations = new Map<string, string>();
  private attachments = new Map<string, string>();
  async schema(client: Queryable) {
    await client.query(schema);
  }
  attachPopulation(worldId: string, sourceWorldId: string) {
    const id = this.worldPopulations.get(sourceWorldId);
    if (!id) throw new Error("Publish the source population before attaching a world");
    this.attachments.set(worldId, id);
  }
  discardAttachments() {
    this.attachments.clear();
  }
  baseline(worldId: string) {
    const id = this.worldPopulations.get(worldId);
    const population = id ? this.populations.get(id) : undefined;
    if (!population) throw new Error("Source population has not been published");
    return population;
  }
  async load(client: Queryable): Promise<State | null> {
    const marker = await client.query("SELECT schema_version FROM simulation_storage WHERE id=1");
    if (!marker.rows.length) return null;
    if (marker.rows[0].schema_version !== 2) throw new Error("Unsupported row-storage schema");
    const state: State = { worlds: {}, events: {}, receipts: {} };
    const worlds = await client.query(
      "SELECT id,population_id,payload FROM simulation_worlds ORDER BY id",
    );
    for (const row of worlds.rows) {
      let population = this.populations.get(row.population_id);
      if (!population) {
        const patients = await client.query(
          "SELECT payload FROM population_patients WHERE population_id=$1 ORDER BY ordinal",
          [row.population_id],
        );
        const resources = await client.query(
          "SELECT payload FROM population_resources WHERE population_id=$1 ORDER BY ordinal",
          [row.population_id],
        );
        population = {
          id: row.population_id,
          patients: patients.rows.map((row) => freeze(row.payload, true)),
          resources: resources.rows.map((row) => freeze(row.payload, true)),
        };
        this.populations.set(population.id, population);
      }
      const patientOverlays = await client.query(
        "SELECT id,payload,deleted,ordinal FROM world_patients WHERE world_id=$1 ORDER BY ordinal",
        [row.id],
      );
      const resourceOverlays = await client.query(
        "SELECT id,payload,deleted,ordinal FROM world_resources WHERE world_id=$1 ORDER BY ordinal",
        [row.id],
      );
      const merge = <T extends { id: string }>(
        baseline: T[],
        overlays: { id: string; payload: T; deleted: boolean; ordinal: number }[],
      ) => {
        if (!overlays.length) return baseline;
        for (const row of overlays) if (!row.deleted) freeze(row.payload, true);
        const changes = new Map(overlays.map((row) => [row.id, row]));
        const merged: T[] = [];
        for (const item of baseline) {
          const overlay = changes.get(item.id);
          if (!overlay) merged.push(item);
          else if (!overlay.deleted) merged.push(overlay.payload);
          changes.delete(item.id);
        }
        for (const overlay of changes.values()) if (!overlay.deleted) merged.push(overlay.payload);
        return merged;
      };
      state.worlds[row.id] = {
        ...row.payload,
        patients: merge(population.patients, patientOverlays.rows),
        resources: merge(population.resources, resourceOverlays.rows),
      };
      this.worldPopulations.set(row.id, population.id);
      const events = await client.query(
        "SELECT payload FROM world_events WHERE world_id=$1 ORDER BY ordinal",
        [row.id],
      );
      state.events[row.id] = events.rows.map((row) => row.payload);
      const receipts = await client.query(
        "SELECT id,payload FROM world_receipts WHERE world_id=$1",
        [row.id],
      );
      for (const receipt of receipts.rows) state.receipts[receipt.id] = receipt.payload;
    }
    return state;
  }
  private async createPopulation(client: Queryable, world: World): Promise<Population> {
    const population = {
      id: "population-" + randomUUID(),
      patients: world.patients,
      resources: world.resources,
    };
    const previous = this.worldPopulations.get(world.id);
    await client.query(
      "INSERT INTO simulation_populations(id,version) VALUES($1,COALESCE((SELECT version + 1 FROM simulation_populations WHERE id=$2),1))",
      [population.id, previous ?? null],
    );
    await rows(
      client,
      "population_patients",
      "population_id",
      population.id,
      world.patients.map((payload, ordinal) => ({ id: payload.id, payload, ordinal })),
    );
    await rows(
      client,
      "population_resources",
      "population_id",
      population.id,
      world.resources.map((payload, ordinal) => ({ id: payload.id, payload, ordinal })),
    );
    return population;
  }
  async write(
    client: Queryable,
    before: State | null,
    after: State,
    affected?: string | string[],
  ): Promise<() => void> {
    if (before === after) return () => {};
    const pendingFreeze: (readonly object[])[] = [];
    const populations = new Map(this.populations),
      bindings = new Map(this.worldPopulations);
    const ids = affected
      ? typeof affected === "string"
        ? [affected]
        : affected
      : [...new Set([...Object.keys(before?.worlds ?? {}), ...Object.keys(after.worlds)])];
    for (const id of ids) {
      const previous = before?.worlds[id],
        world = after.worlds[id];
      if (!world) {
        if (previous) {
          await client.query("DELETE FROM simulation_worlds WHERE id=$1", [id]);
          bindings.delete(id);
        }
        continue;
      }
      let populationId = this.attachments.get(id) ?? bindings.get(id);
      let population = populationId ? populations.get(populationId) : undefined;
      if (!population) {
        population = [...populations.values()].find(
          (base) => base.patients === world.patients && base.resources === world.resources,
        );
        if (!population) {
          population = await this.createPopulation(client, world);
          populations.set(population.id, population);
          pendingFreeze.push(population.patients, population.resources);
        }
        populationId = population.id;
        bindings.set(id, populationId);
      }
      if (!previous || previous !== world || this.attachments.has(id))
        await client.query(
          "INSERT INTO simulation_worlds(id,population_id,payload) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET population_id=excluded.population_id,payload=excluded.payload",
          [id, population.id, JSON.stringify(metadata(world))],
        );
      const rebase = this.attachments.has(id) && population.id !== this.worldPopulations.get(id);
      if (rebase) {
        await client.query("DELETE FROM world_patients WHERE world_id=$1", [id]);
        await client.query("DELETE FROM world_resources WHERE world_id=$1", [id]);
      }
      for (const [table, oldValues, newValues] of [
        [
          "world_patients",
          rebase || !previous ? population.patients : previous.patients,
          world.patients,
        ],
        [
          "world_resources",
          rebase || !previous ? population.resources : previous.resources,
          world.resources,
        ],
      ] as const) {
        const diff = changedRows<Patient | Resource>(oldValues, newValues);
        if (diff.upserts.length) pendingFreeze.push(diff.upserts);
        if (diff.upserts.length || diff.deleted.length) {
          const ordinals = new Map(newValues.map((value, index) => [value.id, index]));
          await rows(
            client,
            table,
            "world_id",
            id,
            [
              ...diff.upserts.map((payload) => ({
                id: payload.id,
                payload,
                ordinal: ordinals.get(payload.id),
                deleted: false,
              })),
              ...diff.deleted.map((deleted) => ({
                id: deleted,
                payload: null,
                ordinal: 0,
                deleted: true,
              })),
            ],
            true,
          );
        }
      }
      const oldEvents = before?.events[id] ?? [],
        events = after.events[id] ?? [];
      const eventDiff = changedRows(oldEvents, events);
      if (eventDiff.upserts.length) {
        const ordinals = new Map(events.map((event, index) => [event.id, index]));
        await rows(
          client,
          "world_events",
          "world_id",
          id,
          eventDiff.upserts.map((payload) => ({
            id: payload.id,
            payload,
            ordinal: ordinals.get(payload.id),
          })),
        );
      }
      if (eventDiff.deleted.length)
        await client.query("DELETE FROM world_events WHERE world_id=$1 AND id=ANY($2::text[])", [
          id,
          eventDiff.deleted,
        ]);
      bindings.set(id, population.id);
    }
    if (before?.receipts !== after.receipts) {
      const allowed = new Set(ids),
        changed = Object.entries(after.receipts).filter(
          ([key, value]) => allowed.has(key.split(":")[0] ?? "") && value !== before?.receipts[key],
        );
      for (const id of ids)
        await rows(
          client,
          "world_receipts",
          "world_id",
          id,
          changed
            .filter(([key]) => key.startsWith(id + ":"))
            .map(([key, payload]) => ({ id: key, payload })),
        );
      const deleted = Object.keys(before?.receipts ?? {}).filter(
        (key) => allowed.has(key.split(":")[0] ?? "") && !(key in after.receipts),
      );
      if (deleted.length)
        await client.query("DELETE FROM world_receipts WHERE id=ANY($1::text[])", [deleted]);
    }
    await client.query("INSERT INTO simulation_storage VALUES(1,2) ON CONFLICT(id) DO NOTHING");
    return () => {
      for (const batch of pendingFreeze) freezeRows(batch);
      this.populations = populations;
      this.worldPopulations = bindings;
      this.attachments.clear();
    };
  }
  async publish(client: Queryable, world: World): Promise<() => void> {
    const existingId = this.worldPopulations.get(world.id),
      existing = existingId ? this.populations.get(existingId) : undefined;
    if (existing?.patients === world.patients && existing.resources === world.resources)
      return () => {};
    const population = await this.createPopulation(client, world);
    await client.query("UPDATE simulation_worlds SET population_id=$2,payload=$3 WHERE id=$1", [
      world.id,
      population.id,
      JSON.stringify(metadata(world)),
    ]);
    await client.query("DELETE FROM world_patients WHERE world_id=$1", [world.id]);
    await client.query("DELETE FROM world_resources WHERE world_id=$1", [world.id]);
    return () => {
      freezeRows(population.patients);
      freezeRows(population.resources);
      this.populations.set(population.id, population);
      this.worldPopulations.set(world.id, population.id);
    };
  }
}

export const patientRowsSql = `SELECT b.id,b.ordinal,b.payload,b.name,b.search_text FROM population_patients b WHERE b.population_id=(SELECT population_id FROM simulation_worlds WHERE id=$1) AND NOT EXISTS(SELECT 1 FROM world_patients o WHERE o.world_id=$1 AND o.id=b.id) UNION ALL SELECT id,ordinal,payload,name,search_text FROM world_patients WHERE world_id=$1 AND NOT deleted`;
export const resourceRowsSql = `SELECT b.id,b.ordinal,b.payload,b.patient_id,b.owner,b.kind,b.created_at,b.occurs_at FROM population_resources b WHERE b.population_id=(SELECT population_id FROM simulation_worlds WHERE id=$1) AND NOT EXISTS(SELECT 1 FROM world_resources o WHERE o.world_id=$1 AND o.id=b.id) UNION ALL SELECT id,ordinal,payload,patient_id,owner,kind,created_at,occurs_at FROM world_resources WHERE world_id=$1 AND NOT deleted`;
