import type pg from 'pg';
import type { Patient, Resource } from '../../../packages/contracts/src/index.ts';
import { catalogue } from '../../../packages/nhs-mocks/src/index.ts';
import { z } from 'zod';
import type { Store } from './store.ts';
import type { OperatorActivity, OperatorChange, OperatorLogging, OperatorRequest, OperatorTeam, OperatorTeams } from '../../../packages/contracts/src/operator.ts';
import { normalizeTeamName } from '../../../packages/contracts/src/team.ts';
import { SimError } from '../../../packages/engine/src/index.ts';

const retentionDays = 7;
const maxRequestsPerWorld = 2000;
const patientPositions = new WeakMap<Patient[], Map<string, number>>();
export function auditPatientIds(patients: Patient[], references: Iterable<string | null>): string[] {
  let positions = patientPositions.get(patients);
  if (!positions) {
    positions = new Map(patients.map((patient, index) => [patient.id, index]));
    patientPositions.set(patients, positions);
  }
  const matches: number[] = [];
  for (const reference of new Set(references)) {
    if (reference === null) continue;
    const index = positions.get(reference);
    if (index !== undefined) matches.push(index);
  }
  return matches.sort((a, b) => a - b).map(index => patients[index].id);
}
export async function initializeOperatorAudit(client: pg.PoolClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS operator_audit_metadata (id integer PRIMARY KEY CHECK(id=1), started_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO operator_audit_metadata(id) VALUES(1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS team_api_requests (id bigserial PRIMARY KEY, time timestamptz NOT NULL DEFAULT now(), team text NOT NULL, world text NOT NULL, method text NOT NULL, path text NOT NULL, status integer NOT NULL, duration_ms integer NOT NULL, patient_ids jsonb NOT NULL);
    CREATE INDEX IF NOT EXISTS team_api_requests_world_time ON team_api_requests(world,time DESC,id DESC);
    CREATE INDEX IF NOT EXISTS team_api_requests_time ON team_api_requests(time);`);
}
const requestRows = z.array(z.object({ id: z.string(), time: z.string(), team: z.string(), world: z.string(), method: z.string(), path: z.string(), status: z.number(), durationMs: z.number(), patientIds: z.array(z.string()) }));
export async function recordTeamRequest(store: Store, entry: Omit<OperatorRequest, 'id' | 'time'>) {
  await store.pool.query('WITH active_world AS (SELECT id FROM simulation_worlds WHERE id=$2 FOR KEY SHARE) INSERT INTO team_api_requests(team,world,method,path,status,duration_ms,patient_ids) SELECT $1,id,$3,$4,$5,$6,$7 FROM active_world', [entry.team,entry.world,entry.method,entry.path,entry.status,entry.durationMs,JSON.stringify(entry.patientIds)]);
}
export async function pruneTeamRequests(store: Store) {
  await store.pool.query(`DELETE FROM team_api_requests WHERE time < now() - interval '7 days' OR id IN (SELECT id FROM (SELECT id,row_number() OVER (PARTITION BY world ORDER BY time DESC,id DESC) AS position FROM team_api_requests) ranked WHERE position > 2000)`);
}
async function logging(store: Store): Promise<OperatorLogging> {
  const rows = z.array(z.object({ since: z.string() })).parse((await store.pool.query("SELECT to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS since FROM operator_audit_metadata WHERE id=1")).rows);
  const first = rows[0];
  if (!first) throw new Error('Missing operator audit metadata');
  return { since: first.since, retentionDays, maxRequestsPerWorld };
}
const changeCache = new WeakMap<Resource[], OperatorChange[]>();
const resourceChangeCache = new WeakMap<Resource, OperatorChange[]>();
function teamChanges(store: Store, worldId: string): OperatorChange[] {
  const resources = store.engine.require(worldId).resources;
  const cached = changeCache.get(resources);
  if (cached) return cached;
  const result = resources.flatMap(resource => {
    const cachedResource = resourceChangeCache.get(resource);
    if (cachedResource) return cachedResource;
    const provenance = resource.provenance;
    const changes = provenance ? [...new Map([provenance.created, ...provenance.changes].filter(change => change?.actor.kind === 'team').map(change => [change?.version, change])).values()] : [];
    const own = changes.flatMap(change => change ? [{ ...change, resourceId: resource.id, patientId: resource.patientId, title: resource.title, kind: resource.kind }] : []);
    resourceChangeCache.set(resource,own);
    return own;
  }).sort((a,b) => b.time - a.time);
  changeCache.set(resources,result);
  return result;
}
function teamSummary(store: Store, keys: Store['keys'], count?: {requestCount:number;lastRequestAt:string|null}): OperatorTeam {
  const key = keys.find(item => item.recoverable_key) ?? keys[0];
  if (!key) throw new SimError('Unknown team world',404);
  const world = store.engine.require(key.world);
  return {team:key.team,teamName:normalizeTeamName(key.team),world:key.world,scopes:[...key.scopes],patientCount:world.patients.length,resourceCount:world.resources.length,affectedPatientCount:new Set(teamChanges(store,key.world).flatMap(change => change.patientId ? [change.patientId] : [])).size,requestCount:count?.requestCount ?? 0,lastRequestAt:count?.lastRequestAt ?? null};
}
export async function operatorTeams(store: Store): Promise<OperatorTeams> {
  const counts = z.array(z.object({world:z.string(), requestCount:z.number(), lastRequestAt:z.string().nullable()})).parse((await store.pool.query(`SELECT world,LEAST(count(*),2000)::integer AS "requestCount", to_char(max(time) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastRequestAt" FROM team_api_requests WHERE time >= now() - interval '7 days' GROUP BY world`)).rows);
  const groups = new Map<string, typeof store.keys>();
  for (const key of store.keys) groups.set(key.world, [...(groups.get(key.world) ?? []), key]);
  const countsByWorld = new Map(counts.map(count => [count.world,count]));
  const teams = [...groups].map(([id,keys]) => teamSummary(store,keys,countsByWorld.get(id)));
  return {teams:teams.sort((a,b) => (b.lastRequestAt ?? '').localeCompare(a.lastRequestAt ?? '') || a.team.localeCompare(b.team)),logging:await logging(store)};
}
export async function operatorActivity(store: Store, world: string): Promise<OperatorActivity> {
  const keys = store.keys.filter(key => key.world === world);
  if (!keys.length) throw new SimError('Unknown team world',404);
  const requests = requestRows.parse((await store.pool.query(`SELECT id::text, to_char(time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS time,team,world,method,path,status,duration_ms AS "durationMs",patient_ids AS "patientIds" FROM team_api_requests WHERE world=$1 AND time >= now() - interval '7 days' ORDER BY time DESC,id DESC LIMIT 2000`,[world])).rows);
  const changes = teamChanges(store,world), byPatient = new Map<string,{changeCount:number;lastChangedAt:number}>();
  for (const change of changes) {
    if (!change.patientId) continue;
    const existing = byPatient.get(change.patientId);
    byPatient.set(change.patientId,{changeCount:(existing?.changeCount ?? 0)+1,lastChangedAt:Math.max(existing?.lastChangedAt ?? 0,change.time)});
  }
  const patients = store.engine.require(world).patients.flatMap(patient => {
    const own = byPatient.get(patient.id);
    return own ? [{id:patient.id,name:patient.name,...own}] : [];
  });
  const team = teamSummary(store,keys,{requestCount:requests.length,lastRequestAt:requests[0]?.time ?? null});
  return {team,requests,patients,changes:changes.slice(0,500),events:(store.engine.state.events[world] ?? []).slice(-200).reverse(),logging:await logging(store)};
}

const publicSegments = new Set('api browser sites nhs control teams activity catalogue openapi.json team clock session plan-lab keys gp hospital community pharmacy diagnostics referrals wearables patient legacy view patients actions appointments attendances pharmacy-workspace documents messaging-workspace messages messaging reply-presets devices readings population publish attach worlds incidents agents model-propose snapshot pds ods Patient Organization OrganizationAffiliation Practitioner PractitionerRole Observation Encounter MedicationRequest ServiceRequest DocumentReference Communication Task Bundle metadata'.split(' '));
for (const adapter of catalogue) publicSegments.add(adapter.id);
export function auditPath(path: string) {
  return path.split('/').map(segment => !segment || publicSegments.has(segment) ? segment : ':id').join('/').slice(0,512);
}
