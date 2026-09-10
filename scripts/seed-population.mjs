import { performance } from 'node:perf_hooks';
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key)+1] : fallback;
const origin = option('--origin','http://localhost:8080');
const world = option('--world','default');
const target = Number(option('--target','50000'));
const token = process.env.OPERATOR_TOKEN;
if (!token) throw new Error('Set OPERATOR_TOKEN in the environment');
const started = performance.now();
for (;;) {
  const before = performance.now();
  const response = await fetch(`${origin}/api/control/population?world=${encodeURIComponent(world)}`, {
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({target,batchSize:500}),
  });
  const result = await response.json();
  if(!response.ok) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify({...result,batchMs:Math.round(performance.now()-before),elapsedMs:Math.round(performance.now()-started)}));
  if(result.complete) break;
}
