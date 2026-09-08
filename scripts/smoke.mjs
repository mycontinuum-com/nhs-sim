import assert from 'node:assert/strict';
const base=process.env.TEST_ORIGIN??'http://localhost:8080';
const call=async(path,options={})=>{const r=await fetch(base+path,options);return {status:r.status,data:await r.json()};};
assert.equal((await call('/healthz')).status,200);
const {data:catalogue}=await call('/api/catalogue');
for(const site of catalogue.sites){const response=await fetch(base+'/'+site.id+'/');assert.equal(response.status,200,site.id);const html=await response.text();assert.ok(html.includes('root'));const assets=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)];assert.ok(assets.length>0);for(const [,asset] of assets)assert.equal((await fetch(base+asset)).status,200,asset);}
const issued=await call('/api/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({teamName:'Smoke test'})});assert.equal(issued.status,201);
const headers={Authorization:'Bearer '+issued.data.apiKey,'Content-Type':'application/json'};
assert.equal((await call('/api/sites/gp/view',{headers})).status,200);
assert.equal((await call('/api/sites/control/view',{headers})).status,403);
assert.equal((await call('/api/sites/legacy/view',{headers})).status,501);
assert.equal((await call('/api/sites/gp/view')).status,401);
for(const api of catalogue.apis)assert.equal((await call('/api/nhs/'+api.id,{headers})).status,200,api.id);
const order=await call('/api/sites/gp/actions',{method:'POST',headers,body:JSON.stringify({type:'order_test',patientId:'SIM-000001',title:'Smoke test order'})});assert.equal(order.status,200);
const step=await call('/api/clock',{method:'POST',headers,body:JSON.stringify({advanceMinutes:121})});assert.equal(step.status,200);
const view=await call('/api/sites/diagnostics/view',{headers});assert.equal(view.data.resources.find(r=>r.id===order.data.id).status,'available');
console.log('PASS: all sites and assets, all NHS namespaces, authorization, legacy boundary and delayed result workflow');
