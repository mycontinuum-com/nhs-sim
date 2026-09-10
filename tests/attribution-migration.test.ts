import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { seedWorld } from "../packages/engine/src/index.ts";
import { generatePopulationBatch } from "../packages/engine/src/population-batch.ts";
import { migrateRecordAttribution } from "../apps/server/src/attribution-migration.ts";
import { RowPersistence } from "../apps/server/src/persistence.ts";

test("generated consultations carry their fictional authors and complete provenance", () => {
  const world = seedWorld("default",42,8);
  const story = world.resources.find(r => r.data.author === "Dr Rowan Ellis");
  assert.equal(story?.provenance?.created?.actor.name,"Synthetic clinician Dr Rowan Ellis");
  const batch = generatePopulationBatch({seed:42,start:100,count:4,now:world.now});
  assert.ok(batch.resources.length > 0);
  for (const record of batch.resources) {
    assert.equal(record.provenance?.created?.actor.kind,"simulation");
    assert.equal(record.provenance?.created?.time,record.createdAt);
    if (record.data.author) assert.equal(record.provenance?.created?.actor.name,`Synthetic clinician ${record.data.author}`);
  }
});

test("PostgreSQL attribution repair preserves authors and changes, recovers evidence and is idempotent", {skip:!process.env.ROW_STORAGE_TEST_URL}, async () => {
  const url = process.env.ROW_STORAGE_TEST_URL;
  assert.ok(url);
  const admin = new pg.Client({connectionString:url});
  await admin.connect();
  const database = `nhssim_attribution_test_${Date.now()}`;
  const isolated = new URL(url); isolated.pathname = "/"+database;
  let client: pg.Client | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    client = new pg.Client({connectionString:isolated.toString()}); await client.connect();
    await new RowPersistence().schema(client);
    await client.query("CREATE TABLE team_keys(hash text PRIMARY KEY,team text,world text,scopes jsonb); INSERT INTO simulation_populations(id,version) VALUES('base',1); INSERT INTO simulation_worlds VALUES('team-world','base','{}'); INSERT INTO team_keys VALUES('test','Original team','team-world','[]')");
    const template = {id:"synthetic",kind:"encounter",owner:"gp",createdAt:1000,version:3,title:"Historical consultation",data:{synthetic:true,author:"Dr Rowan Ellis",text:"Retain this text"}};
    const change = {actor:{kind:"team",name:"Reviewer"},source:"gp",action:"review",time:2000,version:3};
    const original = {actor:{kind:"team",name:"Authentic author"},source:"gp",action:"save_consultation",time:1000,version:1};
    const arrival = {...template,patientId:"SIM-000001",id:"r-900",owner:"hospital",title:"New A&E arrival",dueAt:86401000,data:{waitMinutes:20}};
    const attendance = {...arrival,id:"r-901",kind:"hospital-attendance",data:{stage:"waiting",arrivalAt:1000,presentingComplaint:"New A&E arrival",acuity:"3",location:"Waiting room",clinician:"Unassigned"}};
    const records = [
      arrival, attendance,
      {...arrival,id:"r-902",data:{text:"Custom note with an arrival title"}},
      {...arrival,id:"r-903",title:"Custom hospital contact"},
      {...template,provenance:{created:null,changes:[change]}},
      {...template,id:"existing",provenance:{created:original,changes:[change]}},
      {...template,id:"unknown",data:{text:"Legacy custom content"}},
      {...template,id:"event",kind:"consultation",data:{text:"Created by a team"}},
      {...template,id:"changed",data:{text:"Structured history"},provenance:{created:null,changes:[original,change]}},
    ];
    for (const [index,record] of records.entries()) await client.query("INSERT INTO world_resources(world_id,id,ordinal,payload) VALUES('team-world',$1,$2,$3)",[record.id,index,JSON.stringify(record)]);
    await client.query("INSERT INTO population_resources(population_id,id,ordinal,payload) VALUES('base',$1,0,$2)",[template.id,JSON.stringify(template)]);
    await client.query("INSERT INTO world_events VALUES('team-world','event-1',0,$1)",[JSON.stringify({id:"event-1",resourceId:"event",time:1000,type:"save_consultation",actor:"Original team"})]);
    await client.query("BEGIN"); assert.equal(await migrateRecordAttribution(client,2),9); await client.query("COMMIT");
    const rows = (await client.query("SELECT id,payload FROM world_resources ORDER BY id")).rows;
    const byId = new Map(rows.map(row => [row.id,row.payload]));
    assert.deepEqual(byId.get("existing"),records[5]);
    assert.equal(byId.get("r-900").provenance.created.actor.name,"Simulation acute flow");
    assert.equal(byId.get("r-901").provenance.created.actor.name,"Simulation acute flow");
    assert.equal(byId.get("r-900").provenance.recovery.basis,"simulation-generator");
    assert.equal(byId.get("r-902").provenance.created,null);
    assert.equal(byId.get("r-903").provenance.created,null);
    assert.deepEqual(byId.get("synthetic").data,template.data);
    assert.equal(byId.get("synthetic").version,3);
    assert.equal(byId.get("synthetic").createdAt,1000);
    assert.equal(byId.get("synthetic").provenance.created.actor.name,"Synthetic clinician Dr Rowan Ellis");
    assert.deepEqual(byId.get("synthetic").provenance.changes,[change]);
    assert.equal(byId.get("unknown").provenance.created,null);
    assert.equal(byId.get("unknown").provenance.recovery.basis,"unavailable");
    assert.deepEqual(byId.get("event").provenance.created.actor,{kind:"team",name:"Original team"});
    assert.deepEqual(byId.get("changed").provenance.created,original);
    assert.equal(await migrateRecordAttribution(client,2),0);
    assert.deepEqual((await client.query("SELECT id,payload FROM world_resources ORDER BY id")).rows,rows);
  } finally {
    await client?.end(); await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await admin.end();
  }
});
