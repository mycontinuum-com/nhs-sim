import { teamNameSchema, normalizeTeamName } from "../../../packages/contracts/src/team.ts";
import { seedPatientBloodResults } from "../../../packages/engine/src/blood-results.ts";
import { upgradeMessagingWorld } from "../../../packages/engine/src/messaging-seed.ts";
import { upgradeAppointmentWorld } from "../../../packages/engine/src/appointment-sessions.ts";
import { upgradeDocumentWorld } from "../../../packages/engine/src/document-seed.ts";
import { upgradePharmacyWorld } from "../../../packages/engine/src/pharmacy-seed.ts";
import { migrateRecordAttribution } from "./attribution-migration.ts";
import { upgradeHospitalWorld } from "../../../packages/engine/src/hospital-seed.ts";
import pg from "pg";
import { migrateMedicationHistory } from "./medication-migration.ts";
import { Engine, SimError } from "../../../packages/engine/src/index.ts";
import type { Patient, Resource, SiteId } from "../../../packages/contracts/src/index.ts";
import { createHash, randomBytes } from "node:crypto";
import { RowPersistence, patientRowsSql, resourceRowsSql } from "./persistence.ts";

export type TeamKey = { hash: string; team: string; world: string; scopes: string[]; recoverable_key?: string | null };
export class Store {
  pool: pg.Pool;
  engine = new Engine();
  keys: TeamKey[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private persistence = new RowPersistence();
  lockClient?: pg.PoolClient;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 4 });
  }
  async init() {
    const client = await this.pool.connect();
    const lock = await client.query("SELECT pg_try_advisory_lock(7812026) AS locked");
    if (!lock.rows[0].locked) {
      client.release();
      throw new Error("Another simulator owns this database");
    }
    this.lockClient = client;
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE TABLE IF NOT EXISTS simulation_state(id integer PRIMARY KEY CHECK(id=1), schema_version integer NOT NULL, payload jsonb NOT NULL); CREATE TABLE IF NOT EXISTS team_keys(hash text PRIMARY KEY, team text NOT NULL, world text NOT NULL, scopes jsonb NOT NULL)",
      );
      await client.query("ALTER TABLE team_keys ADD COLUMN IF NOT EXISTS recoverable_key text");
      await this.persistence.schema(client);
      const rowStorage = await client.query(
        "SELECT schema_version FROM simulation_storage WHERE id=1",
      );
      if (!rowStorage.rows.length) {
        const legacy = await client.query(
          "SELECT schema_version,payload FROM simulation_state WHERE id=1",
        );
        if (legacy.rows[0]) {
          if (legacy.rows[0].schema_version !== 1)
            throw new Error("Unsupported legacy database schema");
          this.engine.state = legacy.rows[0].payload;
        }
        await this.persistence.write(client, null, this.engine.state);
      }
      await migrateMedicationHistory(client);
      await migrateRecordAttribution(client);
      const loaded = await this.persistence.load(client);
      if (!loaded) throw new Error("Row storage did not initialize");
      this.engine.state = { ...loaded, worlds: Object.fromEntries(Object.entries(loaded.worlds).map(([id, world]) => [id, upgradeMessagingWorld(upgradeAppointmentWorld(upgradeDocumentWorld(upgradePharmacyWorld(upgradeHospitalWorld(world)))))])) };
      const upgraded = await this.persistence.write(client, loaded, this.engine.state);
      this.keys = (await client.query("SELECT hash,team,world,scopes,recoverable_key FROM team_keys")).rows;
      await client.query("COMMIT");
      upgraded();
    } catch (error) {
      await client.query("ROLLBACK");
      await client.query("SELECT pg_advisory_unlock(7812026)");
      client.release();
      this.lockClient = undefined;
      throw error;
    }
  }
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.tail.then(fn);
    this.tail = task.catch(() => {});
    return task;
  }
  private async write<T>(
    fn: () => T | Promise<T>,
    affected?: string | string[],
    extra?: (client: pg.PoolClient) => Promise<void>,
  ): Promise<T> {
    const before = this.engine.state;
    let client: pg.PoolClient | undefined;
    try {
      const result = await fn();
      if (before === this.engine.state && !extra) return result;
      client = await this.pool.connect();
      await client.query("BEGIN");
      const commit = await this.persistence.write(client, before, this.engine.state, affected);
      if (extra) await extra(client);
      await client.query("COMMIT");
      commit();
      return result;
    } catch (error) {
      if (client) await client.query("ROLLBACK");
      this.engine.state = before;
      this.persistence.discardAttachments();
      throw error;
    } finally {
      client?.release();
    }
  }
  run<T>(fn: () => T | Promise<T>, affectedWorldIds?: string | string[]): Promise<T> {
    return this.enqueue(() => this.write(fn, affectedWorldIds));
  }
  attachPopulation(worldId: string, sourceWorldId: string): void {
    if (worldId === sourceWorldId) throw new SimError("Choose a different population source", 409);
    const source = this.persistence.baseline(sourceWorldId),
      existing = this.engine.require(worldId);
    const merge = <T extends { id: string }>(baseline: T[], overlays: T[]) => {
      const remaining = new Map(overlays.map((row) => [row.id, row]));
      const result = baseline.map((row) => {
        const own = remaining.get(row.id);
        remaining.delete(row.id);
        return own ?? row;
      });
      result.push(...remaining.values());
      return result;
    };
    const patients = merge(source.patients, existing.patients),
      resources = merge(source.resources, existing.resources);
    this.engine.transaction(worldId, (world) => {
      world.patients = patients;
      world.resources = resources;
      world.nextId = Math.max(world.nextId, this.engine.require(sourceWorldId).nextId);
    });
    this.persistence.attachPopulation(worldId, sourceWorldId);
  }
  publishPopulation(worldId: string): Promise<void> {
    return this.enqueue(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const commit = await this.persistence.publish(client, this.engine.require(worldId));
        await client.query("COMMIT");
        commit();
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  }
  async issue(inputTeam: string, requestedScopes: string[]) {
    const canonical = teamNameSchema.parse(inputTeam);
    return this.enqueue(async () => {
      const matches = this.keys.filter((key) => normalizeTeamName(key.team) === canonical);
      if (new Set(matches.map((key) => key.world)).size > 1)
        throw new SimError("This team name matches multiple existing worlds. Connect with your existing API key instead.", 409);
      const existing = matches[0];
      const reusable = matches.find((key) => key.recoverable_key);
      if (reusable?.recoverable_key)
        return { apiKey: reusable.recoverable_key, team: reusable.team, teamName: canonical, world: reusable.world, scopes: reusable.scopes, created: false };
      const created = !existing;
      if (created && new Set(this.keys.map((key) => key.world)).size >= 5000)
        throw new SimError("The 5,000-team capacity has been reached; ask the organiser", 429);
      const raw = "sim_" + randomBytes(24).toString("hex"),
        hash = createHash("sha256").update(raw).digest("hex"),
        world = existing?.world ?? "team-" + randomBytes(6).toString("hex"),
        team = existing?.team ?? canonical,
        scopes = existing ? existing.scopes.filter((scope) => matches.every((key) => key.scopes.includes(scope))) : requestedScopes;
      const key = { hash, team, world, scopes, recoverable_key: raw };
      await this.write(
        () => {
          if (!created) return;
          this.engine.create(world);
          const baseline = this.persistence.baseline("default");
          const target = this.engine.require(world);
          this.engine.save(upgradeMessagingWorld(upgradeAppointmentWorld(upgradeDocumentWorld(upgradePharmacyWorld(upgradeHospitalWorld({
            ...target,
            patients: baseline.patients,
            resources: baseline.resources,
            counters: { ...target.counters, hospitalAttendanceVersion: 0, pharmacyVersion: 0, documentVersion: 0, documentAuthorVersion: 0, appointmentSessionVersion: 0, messagingVersion: 0, bloodResultVersion: 0 },
            nextId: Math.max(target.nextId, this.engine.require("default").nextId),
          }))))));
          this.persistence.attachPopulation(world, "default");
        },
        world,
        async (client) => {
          await client.query("INSERT INTO team_keys(hash,team,world,scopes,recoverable_key) VALUES($1,$2,$3,$4,$5)", [
            hash,
            team,
            world,
            JSON.stringify(scopes),
            raw,
          ]);
        },
      );
      this.keys.push(key);
      return { apiKey: raw, team, teamName: canonical, world, scopes, created };
    });
  }
  authenticate(raw: string) {
    const hash = createHash("sha256").update(raw).digest("hex");
    return this.keys.find((key) => key.hash === hash);
  }
  async readPatients(
    world: string,
    q = "",
    offset = 0,
    limit = 30,
  ): Promise<{ total: number; items: Patient[] }> {
    this.engine.require(world);
    offset = Math.max(0, Math.trunc(offset));
    limit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const words = q
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean)
      .map((word) => word + ":*")
      .join(" & ");
    const prefix = q.trim().replace(/[\\%_]/g, "\\$&") + "%";
    const filter = q.trim()
      ? " WHERE (lower(id) LIKE lower($2) OR lower(name) LIKE lower($2) OR to_tsvector('simple',search_text) @@ to_tsquery('simple',$3))"
      : "";
    const parameters: unknown[] = [world];
    if (q.trim()) parameters.push(prefix, words || "''");
    const count = await this.pool.query(
      `SELECT count(*)::integer AS total FROM (${patientRowsSql}) visible${filter}`,
      parameters,
    );
    const result = await this.pool.query(
      `SELECT payload FROM (${patientRowsSql}) visible${filter} ORDER BY ordinal,id OFFSET $${parameters.length + 1} LIMIT $${parameters.length + 2}`,
      [...parameters, offset, limit],
    );
    return { total: count.rows[0].total, items: result.rows.map((row) => row.payload) };
  }
  async readResources(
    world: string,
    site: SiteId,
    patient?: string,
    offset = 0,
    limit = 100,
    kind?: string,
    date?: string,
  ): Promise<{
    resources: Resource[];
    resourceTotal: number;
    resourceOffset: number;
    resourceLimit: number;
  }> {
    this.engine.require(world);
    if (patient && ["gp", "hospital", "diagnostics"].includes(site)) {
      await this.enqueue(() => this.write(() => {
        const current = this.engine.require(world);
        if (current.counters[`bloodPatient:${patient}`] === 1) return;
        this.engine.transaction(world, draft => seedPatientBloodResults(draft, patient));
      }, world));
    }
    offset = Math.max(0, Math.trunc(offset));
    limit = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const values: unknown[] = [world],
      filters: string[] = [];
    if (site !== "control") {
      values.push(site);
      filters.push(`payload->'visibleTo' ? $${values.length}`);
    }
    if (patient) {
      values.push(patient);
      filters.push(`(patient_id=$${values.length} OR patient_id IS NULL)`);
    }
    if (kind) {
      values.push(kind);
      filters.push(`kind=$${values.length}`);
    }
    if (date) {
      const start = Date.parse(date + "T00:00:00Z");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start))
        throw new SimError("Use a calendar date in YYYY-MM-DD format");
      values.push(start, start + 86400000);
      filters.push(`occurs_at >= $${values.length - 1} AND occurs_at < $${values.length}`);
    }
    const where = filters.length ? " WHERE " + filters.join(" AND ") : "";
    const count = await this.pool.query(
      `SELECT count(*)::integer AS total FROM (${resourceRowsSql}) visible${where}`,
      values,
    );
    const result = await this.pool.query(
      `SELECT payload FROM (${resourceRowsSql}) visible${where} ORDER BY ordinal,id OFFSET $${values.length + 1} LIMIT $${values.length + 2}`,
      [...values, offset, limit],
    );
    return {
      resources: result.rows.map((row) => row.payload),
      resourceTotal: count.rows[0].total,
      resourceOffset: offset,
      resourceLimit: limit,
    };
  }
  async close() {
    await this.tail;
    if (this.lockClient) {
      await this.lockClient.query("SELECT pg_advisory_unlock(7812026)");
      this.lockClient.release();
      this.lockClient = undefined;
    }
    await this.pool.end();
  }
}
