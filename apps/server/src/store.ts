import pg from "pg";
import { enrichPatientStories } from "../../../packages/engine/src/population.ts";
import { Engine } from "../../../packages/engine/src/index.ts";
import { createHash, randomBytes } from "node:crypto";

export type TeamKey = { hash: string; team: string; world: string; scopes: string[] };
export class Store {
  pool: pg.Pool;
  engine = new Engine();
  keys: TeamKey[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 2 });
  }
  async init() {
    // One authoritative simulator process. Prevent accidental split-brain on shared DB.
    const client = await this.pool.connect();
    const lock = await client.query("SELECT pg_try_advisory_lock(7812026) AS locked");
    if (!lock.rows[0].locked) {
      client.release();
      throw new Error("Another simulator owns this database");
    }
    this.lockClient = client;
    await client.query(
      "CREATE TABLE IF NOT EXISTS simulation_state(id integer PRIMARY KEY CHECK(id=1), schema_version integer NOT NULL, payload jsonb NOT NULL); CREATE TABLE IF NOT EXISTS team_keys(hash text PRIMARY KEY, team text NOT NULL, world text NOT NULL, scopes jsonb NOT NULL)",
    );
    const result = await client.query(
      "SELECT schema_version,payload FROM simulation_state WHERE id=1",
    );
    if (result.rows[0]) {
      if (result.rows[0].schema_version !== 1) throw new Error("Unsupported database schema");
      this.engine.state = result.rows[0].payload;
    }
    for (const world of Object.values(this.engine.state.worlds)) enrichPatientStories(world);
    this.keys = (await client.query("SELECT * FROM team_keys")).rows;
    await this.persist();
  }
  lockClient?: pg.PoolClient;
  async persist() {
    await this.pool.query(
      "INSERT INTO simulation_state VALUES(1,1,$1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      [JSON.stringify(this.engine.state)],
    );
  }
  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const task = this.tail.then(async () => {
      const before = structuredClone(this.engine.state);
      try {
        const result = await fn();
        await this.persist();
        return result;
      } catch (e) {
        this.engine.state = before;
        throw e;
      }
    });
    this.tail = task.catch(() => {});
    return task;
  }
  async issue(team: string, scopes: string[]) {
    const raw = "sim_" + randomBytes(24).toString("hex");
    const hash = createHash("sha256").update(raw).digest("hex");
    const world = "team-" + randomBytes(6).toString("hex");
    await this.run(() => this.engine.create(world));
    const key = { hash, team, world, scopes };
    await this.pool.query("INSERT INTO team_keys VALUES($1,$2,$3,$4)", [
      hash,
      team,
      world,
      JSON.stringify(scopes),
    ]);
    this.keys.push(key);
    return { apiKey: raw, team, world, scopes };
  }
  authenticate(raw: string) {
    const hash = createHash("sha256").update(raw).digest("hex");
    return this.keys.find((k) => k.hash === hash);
  }
  async close() {
    await this.tail;
    this.lockClient?.release();
    await this.pool.end();
  }
}
