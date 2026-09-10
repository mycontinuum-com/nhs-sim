import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
const origin = process.env.NHS_SIM_ORIGIN ?? 'http://localhost:8080';
const label = process.argv[2] ?? 'population';
async function call(path, key, body) {
  const start = performance.now();
  const response = await fetch(origin + path, {method:body === undefined ? 'GET':'POST', headers:{'Content-Type':'application/json',...(key ? {Authorization:'Bearer '+key}: {})}, ...(body === undefined ? {}:{body:JSON.stringify(body)})});
  const data = await response.json();
  if(!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`);
  return {data,ms:performance.now()-start};
}
const team = (await call('/api/keys',undefined,{teamName:'Scale verification '+label})).data;
const first = (await call('/api/sites/gp/view?limit=1',team.apiKey)).data;
const date = new Date(first.now).toISOString().slice(0,10);
const timings = {search:[],patientRecord:[],appointmentBook:[],saveConsultation:[],concurrentReads:[]};
for(let n=0;n<5;n++) {
  timings.search.push((await call('/api/sites/gp/patients?q=Ada',team.apiKey)).ms);
  timings.patientRecord.push((await call('/api/sites/gp/view?patient=SIM-'+String(first.population).padStart(6,'0'),team.apiKey)).ms);
  timings.appointmentBook.push((await call('/api/sites/gp/appointments?date='+date,team.apiKey)).ms);
  timings.saveConsultation.push((await call('/api/sites/gp/actions',team.apiKey,{type:'save_consultation',patientId:'SIM-000001',title:'Synthetic scale verification '+n,text:'Fictional performance-test consultation. No clinical content.',consultationStatus:'saved'})).ms);
}
for(let round=0;round<3;round++) {
  const values = await Promise.all(Array.from({length:5},(_,i)=>call('/api/sites/gp/view?patient=SIM-'+String(1+i).padStart(6,'0'),team.apiKey)));
  timings.concurrentReads.push(...values.map(v=>v.ms));
}
const summary = Object.fromEntries(Object.entries(timings).map(([name,values])=>{
  values.sort((a,b)=>a-b);return[name,{samples:values.length,p50Ms:Math.round(values[Math.floor(values.length/2)]),p95Ms:Math.round(values[Math.ceil(values.length*.95)-1]),maxMs:Math.round(values.at(-1))}];
}));
const result = {label,population:first.population,world:team.world,at:new Date().toISOString(),origin,concurrentClients:5,summary};
mkdirSync('.verification/evidence',{recursive:true});
writeFileSync(`.verification/evidence/scale-${label}.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
