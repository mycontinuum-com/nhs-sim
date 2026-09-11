import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../apps/server/src/store.ts';
import { auditPath, operatorActivity, operatorTeams, recordTeamRequest, pruneTeamRequests } from '../apps/server/src/operator.ts';

test('request paths preserve operations but redact arbitrary identifiers and credentials', () => {
  assert.equal(auditPath('/api/sites/gp/actions'), '/api/sites/gp/actions');
  assert.equal(auditPath('/api/nhs/pds/Patient/sim_secret_key'), '/api/nhs/pds/Patient/:id');
  assert.equal(auditPath('/api/arbitrary-secret'), '/api/:id');
});

test('organiser directory and audit survive restart, preserve scoped team access and distinguish read requests from changes', {skip:!process.env.ROW_STORAGE_TEST_URL}, async () => {
  const url = process.env.ROW_STORAGE_TEST_URL;
  assert.ok(url);
  const admin = new pg.Client({connectionString:url});
  await admin.connect();
  const database = `nhssim_operator_test_${Date.now()}`, isolated = new URL(url);
  isolated.pathname = `/${database}`;
  let store: Store | undefined;
  let server: ChildProcess | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    store = new Store(isolated.toString()); await store.init();
    const team = await store.issue('Op test',['gp']);
    const other = await store.issue('Another team',['hospital']);
    const session = await store.exploreTeam(team.world);
    assert.equal(session.apiKey,team.apiKey); assert.deepEqual(session.scopes,['gp']);
    assert.equal((await operatorTeams(store)).teams.length,2);
    await recordTeamRequest(store,{team:team.team,world:team.world,method:'GET',path:'/api/sites/gp/patients',status:200,durationMs:4,patientIds:['SIM-000003']});
    await recordTeamRequest(store,{team:team.team,world:team.world,method:'POST',path:'/api/sites/hospital/actions',status:403,durationMs:2,patientIds:[]});
    assert.deepEqual((await operatorActivity(store,team.world)).patients,[]);
    await store.run(() => store!.engine.action(team.world,'gp',{type:'save_consultation',patientId:'SIM-000003',title:'Operator audit test',text:'Fictional test consultation',consultationStatus:'saved'},{kind:'team',name:team.team}),team.world);
    let activity = await operatorActivity(store,team.world);
    assert.equal(activity.patients.length,1);
    assert.equal(activity.patients[0]?.id,'SIM-000003');
    assert.equal(activity.patients[0]?.changeCount,1);
    assert.equal(activity.requests.length,2);
    assert.equal(activity.requests[0]?.status,403);
    assert.equal(activity.team.affectedPatientCount,1);
    assert.equal((await operatorActivity(store,other.world)).requests.length,0);
    assert.equal(JSON.stringify(await operatorTeams(store)).includes(team.apiKey),false);
    const since = activity.logging.since;
    await store.close(); store = new Store(isolated.toString()); await store.init();
    activity = await operatorActivity(store,team.world);
    assert.equal(activity.requests.length,2); assert.equal(activity.logging.since,since);
    assert.equal((await store.exploreTeam(team.world)).apiKey,team.apiKey);
    await store.pool.query("INSERT INTO team_api_requests(time,team,world,method,path,status,duration_ms,patient_ids) VALUES(now()-interval '8 days',$1,$2,'GET','/api/team',200,1,'[]')",[team.team,team.world]);
    await store.pool.query("INSERT INTO team_api_requests(team,world,method,path,status,duration_ms,patient_ids) SELECT $1,$2,'GET','/api/team',200,1,'[]' FROM generate_series(1,2005)",[team.team,team.world]);
    await pruneTeamRequests(store);
    const count = await store.pool.query('SELECT count(*)::integer AS count FROM team_api_requests WHERE world=$1',[team.world]);
    assert.equal(count.rows[0].count,2000);
    await assert.rejects(store.exploreTeam('default'),{status:404});
    await store.pool.query("INSERT INTO team_keys(hash,team,world,scopes) VALUES('legacy-operator','Same name',$1,'[\"gp\"]'),('legacy-other','Same name',$2,'[\"hospital\"]')",[team.world,other.world]);
    await store.close(); store = undefined;
    const portProbe = createServer(); portProbe.listen(0,'127.0.0.1'); await once(portProbe,'listening');
    const address = portProbe.address(); assert.ok(address && typeof address === 'object');
    const port = address.port; await new Promise<void>(resolve => portProbe.close(() => resolve()));
    const token = 'operator-integration-test-only';
    server = spawn(process.execPath,['--experimental-strip-types','apps/server/src/index.ts'],{env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:`http://127.0.0.1:${port}`,OPERATOR_TOKEN:token,DATABASE_URL:isolated.toString()},stdio:['ignore','pipe','pipe']});
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt=0;attempt<100;attempt++) {
      try { ready = (await fetch(base+'/healthz')).ok; } catch { ready = false; }
      if (ready) break;
      await delay(50);
    }
    assert.ok(ready,'isolated HTTP server started');
    const get = (path:string,key:string) => fetch(base+path,{headers:{Authorization:'Bearer '+key}});
    assert.equal((await get('/api/control/teams',team.apiKey)).status,403);
    assert.equal((await get('/api/control/teams','invalid')).status,403);
    const invalidControl = await get('/api/sites/control/view','invalid');
    assert.equal(invalidControl.status,403); assert.match((await invalidControl.json()).error,/operator token/i);
    const directory = await get('/api/control/teams',token);
    assert.equal(directory.status,200); assert.equal((await directory.json()).teams.length,2);
    const explore = await fetch(base+`/api/control/teams/${team.world}/session`,{method:'POST',headers:{Authorization:'Bearer '+token}});
    assert.equal(explore.status,200); assert.equal((await explore.json()).apiKey,team.apiKey);
    const request = await get('/api/sites/gp/patients?patientId=SIM-000003&apiKey=never-log-this',team.apiKey);
    assert.equal(request.status,200);
    const failed = await get('/api/sites/hospital/patients',team.apiKey); assert.equal(failed.status,403);
    let httpActivity;
    for (let attempt=0;attempt<30;attempt++) {
      httpActivity = await (await get(`/api/control/teams/${team.world}/activity`,token)).json();
      if (httpActivity.requests.some((entry:{path:string;status:number}) => entry.path==='/api/sites/hospital/patients' && entry.status===403)) break;
      await delay(20);
    }
    assert.ok(httpActivity.requests.some((entry:{path:string;patientIds:string[]}) => entry.path==='/api/sites/gp/patients' && entry.patientIds.includes('SIM-000003')));
    assert.ok(httpActivity.requests.some((entry:{path:string;status:number}) => entry.path==='/api/sites/hospital/patients' && entry.status===403));
    assert.equal(JSON.stringify(httpActivity).includes('never-log-this'),false);
    assert.equal(JSON.stringify(httpActivity).includes(team.apiKey),false);

  } finally {
    if (server && server.exitCode === null) { server.kill("SIGTERM"); await once(server,"exit"); }
    await store?.close();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await admin.end();
  }
});
