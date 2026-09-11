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
    const bulkPost = (path:string,payload:unknown,key=token) => fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const allTeams=[team.world,other.world];
    assert.equal((await bulkPost('/api/control/incidents/all',{id:'demand-surge',enabled:true,expectedWorlds:allTeams},team.apiKey)).status,403);
    assert.equal((await bulkPost('/api/control/incidents/all',{id:'demand-surge',enabled:true,expectedWorlds:[]},token)).status,409);
    const applied=await bulkPost('/api/control/incidents/all',{id:'demand-surge',enabled:true,expectedWorlds:allTeams});
    assert.equal(applied.status,200); assert.equal((await applied.json()).affectedTeams,2);
    const firstSnapshot=await (await get(`/api/control/snapshot?world=${team.world}`,token)).json();
    assert.equal(firstSnapshot.world.faults['demand-surge'],true);
    assert.equal((await bulkPost('/api/control/incidents/all',{id:'demand-surge',enabled:true,expectedWorlds:allTeams})).status,200);
    const repeatedSnapshot=await (await get(`/api/control/snapshot?world=${team.world}`,token)).json();
    assert.equal(repeatedSnapshot.world.resources.length,firstSnapshot.world.resources.length);
    assert.equal((await bulkPost('/api/control/incidents/all',{id:'demand-surge',enabled:false,expectedWorlds:allTeams})).status,200);
    const defaultSnapshot=await (await get('/api/control/snapshot?world=default',token)).json();
    assert.equal(Boolean(defaultSnapshot.world.faults['demand-surge']),false);
    const oversizedSnapshot=Array.from({length:5000},(_,i)=>`team-expected-world-${String(i).padStart(5,'0')}`);
    assert.equal((await bulkPost('/api/control/incidents/all',{id:'demand-surge',enabled:true,expectedWorlds:oversizedSnapshot})).status,409);
    assert.equal((await bulkPost('/api/control/teams/delete',{teams:oversizedSnapshot.map(world=>({world,confirmTeamName:'disposable-team'}))})).status,404);
    assert.equal((await bulkPost('/api/control/teams/delete',{teams:[{world:team.world,confirmTeamName:team.teamName}]},team.apiKey)).status,403);
    assert.equal((await bulkPost('/api/control/teams/delete',{teams:[{world:team.world,confirmTeamName:team.teamName},{world:other.world,confirmTeamName:'wrong'}]})).status,409);
    assert.equal((await get('/api/team',team.apiKey)).status,200);
    const remove = (target:string,confirmTeamName:string,key:string) => fetch(base+`/api/control/teams/${target}`,{method:'DELETE',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({confirmTeamName})});
    assert.equal((await remove(team.world,team.teamName,team.apiKey)).status,403);
    assert.equal((await remove(team.world,team.teamName,'invalid')).status,403);
    assert.equal((await remove('default','default',token)).status,404);
    assert.equal((await remove(team.world,'OPTEST',token)).status,409);
    const removed = await remove(team.world,team.teamName,token);
    assert.equal(removed.status,200);
    assert.deepEqual(await removed.json(),{deleted:true,world:team.world,teamName:team.teamName});
    assert.equal((await get('/api/team',team.apiKey)).status,401);
    assert.equal((await get('/api/team',other.apiKey)).status,200);
    assert.equal((await get(`/api/control/teams/${team.world}/activity`,token)).status,404);
    assert.equal((await remove(team.world,team.teamName,token)).status,404);
    server.kill('SIGTERM'); await once(server,'exit'); server=undefined;
    store = new Store(isolated.toString()); await store.init();
    assert.equal(store.authenticate(team.apiKey),undefined);
    assert.equal(store.engine.state.worlds[team.world],undefined);
    assert.equal(store.keys.some(key => key.world===team.world),false);
    assert.equal(store.authenticate(other.apiKey)?.world,other.world);
    const fresh = await store.issue(team.teamName,['gp']);
    assert.notEqual(fresh.world,team.world); assert.notEqual(fresh.apiKey,team.apiKey);


  } finally {
    if (server && server.exitCode === null) { server.kill("SIGTERM"); await once(server,"exit"); }
    await store?.close();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await admin.end();
  }
});


test('team deletion is atomic, revokes aliases and removes receipts without changing shared populations or other worlds', {skip:!process.env.ROW_STORAGE_TEST_URL}, async () => {
  const url=process.env.ROW_STORAGE_TEST_URL; assert.ok(url);
  const admin=new pg.Client({connectionString:url}); await admin.connect();
  const database=`nhssim_delete_test_${Date.now()}`, isolated=new URL(url); isolated.pathname=`/${database}`;
  let store:Store|undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    store=new Store(isolated.toString()); await store.init();
    const target=await store.issue('Delete me',['gp']), other=await store.issue('Keep me',['hospital']);
    const baseline=JSON.stringify(store.engine.require('default')), otherBefore=JSON.stringify(store.engine.require(other.world));
    await store.pool.query("INSERT INTO team_keys(hash,team,world,scopes) VALUES('deleted-alias','Legacy alias',$1,'[\"gp\"]')",[target.world]);
    store.keys=(await store.pool.query('SELECT hash,team,world,scopes,recoverable_key FROM team_keys')).rows;
    const action={type:'save_consultation',patientId:'SIM-000003',title:'Disposable test note',text:'Synthetic deletion test',consultationStatus:'saved',clientRequestId:'08f4a37d-a0d4-4307-bbbb-29197759c015'};
    await store.run(() => store!.engine.action(target.world,'gp',action,target.team),target.world);
    assert.ok(Object.keys(store.engine.state.receipts).some(id=>id.startsWith(target.world+':')));
    await assert.rejects(store.deleteTeam(target.world,'DELETE ME'),{status:409});
    const before=store.engine.state;
    await store.pool.query("CREATE FUNCTION fail_team_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$; CREATE TRIGGER fail_team_delete BEFORE DELETE ON team_keys FOR EACH ROW EXECUTE FUNCTION fail_team_delete()");
    await assert.rejects(store.deleteTeam(target.world,target.teamName),/test rollback/);
    assert.equal(store.engine.state,before); assert.equal(store.authenticate(target.apiKey)?.world,target.world);
    assert.equal((await store.pool.query('SELECT id FROM simulation_worlds WHERE id=$1',[target.world])).rows.length,1);
    await store.pool.query('DROP TRIGGER fail_team_delete ON team_keys; DROP FUNCTION fail_team_delete()');
    const audit={team:target.team,world:target.world,method:'GET',path:'/api/team',status:200,durationMs:1,patientIds:[]};
    const pendingAudit=recordTeamRequest(store,audit);
    const deletion=store.deleteTeam(target.world,target.teamName);
    const queuedAction=store.run(()=>store!.engine.action(target.world,'gp',action,target.team),target.world);
    const outcomes=await Promise.allSettled([pendingAudit,deletion,queuedAction]);
    assert.equal(outcomes[0]?.status,'fulfilled'); assert.equal(outcomes[1]?.status,'fulfilled');
    assert.equal(outcomes[2]?.status,'rejected');
    await recordTeamRequest(store,audit);
    for (const table of ['world_patients','world_resources','world_events','world_receipts']) {
      assert.equal((await store.pool.query(`SELECT count(*)::integer AS count FROM ${table} WHERE world_id=$1`,[target.world])).rows[0].count,0);
    }
    assert.equal((await store.pool.query('SELECT count(*)::integer AS count FROM team_api_requests WHERE world=$1',[target.world])).rows[0].count,0);
    assert.equal((await store.pool.query('SELECT count(*)::integer AS count FROM team_keys WHERE world=$1',[target.world])).rows[0].count,0);
    assert.equal(store.keys.some(key=>key.world===target.world),false);
    assert.equal(store.engine.state.events[target.world],undefined);
    assert.equal(Object.keys(store.engine.state.receipts).some(id=>id.startsWith(target.world+':')),false);
    assert.deepEqual(store.engine.require(other.world),JSON.parse(otherBefore));
    assert.deepEqual(store.engine.require('default'),JSON.parse(baseline));
    await store.close(); store=new Store(isolated.toString()); await store.init();
    assert.equal(store.engine.state.worlds[target.world],undefined);
    assert.equal(store.authenticate(target.apiKey),undefined);
    assert.equal(store.authenticate(other.apiKey)?.world,other.world);
    assert.equal(store.keys.some(key=>key.hash==='deleted-alias'),false);
    assert.deepEqual(store.engine.require(other.world),JSON.parse(otherBefore));
    const fresh=await store.issue(target.teamName,['gp']); assert.notEqual(fresh.world,target.world);
    const second=await store.issue('Second disposable',['gp']);
    const snapshot=[other.world,fresh.world,second.world];
    await assert.rejects(store.allTeamIncident('demand-surge',true,[other.world]),{status:409});
    const beforeAll=store.engine.state;
    const last=[...snapshot].sort().at(-1); assert.ok(last);
    await store.pool.query(`CREATE FUNCTION fail_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'incident rollback'; END $$; CREATE TRIGGER fail_incident BEFORE UPDATE ON simulation_worlds FOR EACH ROW WHEN (OLD.id='${last}') EXECUTE FUNCTION fail_incident()`);
    await assert.rejects(store.allTeamIncident('demand-surge',true,snapshot),/incident rollback/);
    assert.equal(store.engine.state,beforeAll);
    await store.pool.query('DROP TRIGGER fail_incident ON simulation_worlds; DROP FUNCTION fail_incident()');
    const all=await store.allTeamIncident('demand-surge',true,snapshot); assert.equal(all.affectedTeams,3);
    const count=store.engine.require(fresh.world).resources.length;
    await store.allTeamIncident('demand-surge',true,snapshot);
    assert.equal(store.engine.require(fresh.world).resources.length,count);
    await store.allTeamIncident('demand-surge',false,snapshot);
    assert.equal(Boolean(store.engine.require('default').faults['demand-surge']),false);
    assert.ok(snapshot.every(world=>!store!.engine.require(world).faults['demand-surge']));
    const otherAfterIncidents=JSON.stringify(store.engine.require(other.world));
    const selected=[{world:fresh.world,confirmTeamName:fresh.teamName},{world:second.world,confirmTeamName:second.teamName}];
    await assert.rejects(store.deleteTeams([...selected,{world:'missing-world',confirmTeamName:'missing'}]),{status:404});
    assert.equal(store.authenticate(fresh.apiKey)?.world,fresh.world);
    await assert.rejects(store.deleteTeams([selected[0]!,selected[0]!]),{status:400});
    assert.deepEqual(await store.deleteTeams(selected),{deleted:true,teams:[{world:fresh.world,teamName:fresh.teamName},{world:second.world,teamName:second.teamName}]});
    assert.equal(store.authenticate(fresh.apiKey),undefined); assert.equal(store.authenticate(second.apiKey),undefined);
    assert.deepEqual(store.engine.require(other.world),JSON.parse(otherAfterIncidents));
    await store.close(); store=new Store(isolated.toString()); await store.init();
    assert.equal(store.engine.state.worlds[fresh.world],undefined); assert.equal(store.engine.state.worlds[second.world],undefined);

  } finally {
    await store?.close(); await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await admin.end();
  }
});
