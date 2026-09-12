import { seedGenomeRecords } from "../../../packages/engine/src/genomics.ts";
import { migrateGenomicRecords } from "./genomic-migration.ts";
import { initializeOperatorAudit } from './operator.ts';
import type { OperatorAllTeamIncident, OperatorBulkDeletion, OperatorDeletion, OperatorSession } from '../../../packages/contracts/src/operator.ts';
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
import { RowPersistence, patientRowsSql } from "./persistence.ts";

export type TeamKey = { hash: string; team: string; world: string; scopes: string[]; recoverable_key?: string | null };
export class Store {
  pool: pg.Pool;
  engine = new Engine();
  keys: TeamKey[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private persistence = new RowPersistence();
  private resourceReads = new WeakMap<Resource[], Map<string, Resource[]>>();
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
      await initializeOperatorAudit(client);
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
      await migrateGenomicRecords(client);
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
      seedGenomeRecords(world);
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
          const upgraded = upgradeMessagingWorld(upgradeAppointmentWorld(upgradeDocumentWorld(upgradePharmacyWorld(upgradeHospitalWorld({
            ...target,
            patients: baseline.patients,
            resources: baseline.resources,
            counters: { ...target.counters, hospitalAttendanceVersion: 0, pharmacyVersion: 0, documentVersion: 0, documentAuthorVersion: 0, appointmentSessionVersion: 0, messagingVersion: 0, bloodResultVersion: 0 },
            nextId: Math.max(target.nextId, this.engine.require("default").nextId),
          })))));
          if (upgraded.resources.length === baseline.resources.length && upgraded.resources.every((record, index) => record === baseline.resources[index])) upgraded.resources = baseline.resources;
          this.engine.save(upgraded);
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
  exploreTeam(world: string): Promise<OperatorSession> {
    return this.enqueue(async () => {
      const matches = this.keys.filter(key => key.world === world);
      const existing = matches[0];
      if (!existing) throw new SimError("Unknown team world", 404);
      const reusable = matches.find(key => key.recoverable_key);
      if (reusable?.recoverable_key) return {apiKey:reusable.recoverable_key,team:reusable.team,teamName:normalizeTeamName(reusable.team),world,scopes:reusable.scopes,created:false};
      const raw = "sim_" + randomBytes(24).toString("hex");
      const key: TeamKey = {hash:createHash("sha256").update(raw).digest("hex"),team:existing.team,world,scopes:existing.scopes,recoverable_key:raw};
      await this.pool.query("INSERT INTO team_keys(hash,team,world,scopes,recoverable_key) VALUES($1,$2,$3,$4,$5)",[key.hash,key.team,world,JSON.stringify(key.scopes),raw]);
      this.keys.push(key);
      return {apiKey:raw,team:key.team,teamName:normalizeTeamName(key.team),world,scopes:key.scopes,created:false};
    });
  }
  async deleteTeam(world: string, confirmTeamName: string): Promise<OperatorDeletion> {
    await this.deleteTeams([{world,confirmTeamName}]);
    return {deleted:true,world,teamName:confirmTeamName};
  }
  deleteTeams(input: {world:string;confirmTeamName:string}[]): Promise<OperatorBulkDeletion> {
    return this.enqueue(async () => {
      if (!input.length || input.length > 5000 || new Set(input.map(team=>team.world)).size !== input.length) throw new SimError("Choose between 1 and 5,000 distinct teams",400);
      const byWorld = new Map<string, TeamKey[]>();
      for (const key of this.keys) byWorld.set(key.world,[...(byWorld.get(key.world) ?? []),key]);
      const teams = input.map(({world,confirmTeamName}) => {
        const matches = byWorld.get(world) ?? [];
        const selected = matches.find(key => key.recoverable_key) ?? matches[0];
        if (world === "default" || !selected || !this.engine.state.worlds[world]) throw new SimError("Unknown team world", 404);
        const teamName = normalizeTeamName(selected.team);
        if (confirmTeamName !== teamName) throw new SimError("The selected team has changed. Refresh the teams and review the selection again.",409);
        return {world,teamName};
      });
      const worlds = teams.map(team=>team.world), selectedWorlds = new Set(worlds);
      const before = this.engine.state;
      const after = {
        worlds: Object.fromEntries(Object.entries(before.worlds).filter(([id]) => !selectedWorlds.has(id))),
        events: Object.fromEntries(Object.entries(before.events).filter(([id]) => !selectedWorlds.has(id))),
        receipts: Object.fromEntries(Object.entries(before.receipts).filter(([id]) => !selectedWorlds.has(id.split(":")[0] ?? ""))),
      };
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const commit = await this.persistence.write(client, before, after, worlds);
        await client.query("DELETE FROM team_keys WHERE world=ANY($1::text[])", [worlds]);
        await client.query("DELETE FROM team_api_requests WHERE world=ANY($1::text[])", [worlds]);
        await client.query("COMMIT");
        commit();
        this.engine.state = after;
        this.keys = this.keys.filter(key => !selectedWorlds.has(key.world));
        return {deleted:true,teams};
      } catch (error) {
        await client.query("ROLLBACK");
        this.persistence.discardAttachments();
        throw error;
      } finally {
        client.release();
      }
    });
  }
  allTeamIncident(id: string, enabled: boolean, expectedWorlds: string[]): Promise<OperatorAllTeamIncident> {
    return this.enqueue(async () => {
      const worlds = [...new Set(this.keys.map(key=>key.world))].filter(world=>world !== "default").sort();
      const current = new Set(worlds);
      if (expectedWorlds.length !== worlds.length || new Set(expectedWorlds).size !== worlds.length || expectedWorlds.some(world=>!current.has(world))) throw new SimError("The team list has changed. Refresh and review all teams before applying this disruption.",409);
      return this.write(() => {
        for (const world of worlds) if (Boolean(this.engine.require(world).faults[id]) !== enabled) this.engine.fault(world,id,enabled);
        return {id,enabled,affectedTeams:worlds.length,worlds};
      },worlds);
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
    const current = this.engine.require(world);
    if (patient && ["gp", "hospital", "diagnostics"].includes(site) && current.counters[`bloodPatient:${patient}`] !== 1) {
      await this.enqueue(() => this.write(() => {
        const current = this.engine.require(world);
        if (current.counters[`bloodPatient:${patient}`] === 1) return;
        this.engine.transaction(world, draft => seedPatientBloodResults(draft, patient));
      }, world));
    }
    offset = Math.max(0, Math.trunc(offset));
    limit = Math.max(1, Math.min(1000, Math.trunc(limit)));
    let start: number | undefined;
    if (date) {
      start = Date.parse(date + "T00:00:00Z");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start))
        throw new SimError("Use a calendar date in YYYY-MM-DD format");
    }
    const source = this.engine.require(world).resources;
    const key = JSON.stringify([site, patient || null, kind || null, date || null]);
    let queries = this.resourceReads.get(source);
    let matches = queries?.get(key);
    if (!matches) {
      matches = [];
      for (const resource of source) {
        if (resource.kind === "genome-record" && site !== "hospital" && site !== "control") continue;
        if (site !== "control" && !resource.visibleTo.includes(site)) continue;
        if (patient && resource.patientId != null && resource.patientId !== patient) continue;
        if (kind && resource.kind !== kind) continue;
        if (start !== undefined) {
          const startsAt = resource.data.startsAt;
          const occursAt = (typeof startsAt === "number" || typeof startsAt === "string") && /^\d+$/.test(String(startsAt))
            ? Number(startsAt) : resource.createdAt;
          if (occursAt < start || occursAt >= start + 86400000) continue;
        }
        matches.push(resource);
      }
      if (!queries) {
        queries = new Map();
        this.resourceReads.set(source, queries);
      }
      let references = matches.length;
      for (const cached of queries.values()) references += cached.length;
      for (const [oldest, cached] of queries) {
        if (queries.size < 8 && references <= source.length) break;
        queries.delete(oldest);
        references -= cached.length;
      }
      queries.set(key, matches);
    }
    return {
      resources: matches.slice(offset, offset + limit),
      resourceTotal: matches.length,
      resourceOffset: offset,
      resourceLimit: limit,
    };
  }
  async health(): Promise<void> {
    if (!this.lockClient) throw new Error("Store is not initialized");
    const query = { text: "SELECT 1", query_timeout: 2000 };
    await this.lockClient.query(query);
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
