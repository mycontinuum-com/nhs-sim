import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const origin = process.env.NHS_SIM_ORIGIN ?? "http://localhost:8080";
const label = process.argv[2] ?? "current";
assert.match(label, /^[a-z0-9-]+$/);
const request = async (path, key, body) => {
  const started = performance.now();
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  assert.equal(response.status, body ? 201 : 200, `${path}: ${response.status}`);
  return { data, ms: Math.round(performance.now() - started) };
};

const { data: team } = await request("/api/keys", undefined, { teamName: "API latency verification" });
const probes = [
  "/api/sites/gp/view?limit=1",
  "/api/sites/gp/view?limit=500",
  "/api/sites/gp/patients?q=SIM-000006",
  "/api/sites/gp/view?patient=SIM-000006",
  "/api/sites/hospital/view?limit=500",
  "/healthz",
];
const samples = [];
for (let round = 0; round < 3; round++) {
  for (let offset = 0; offset < probes.length; offset += 3) {
    const batch = await Promise.all(probes.slice(offset, offset + 3).map(async path => {
      const { data, ms } = await request(path, team.apiKey);
      if (data.resources) {
        const site = path.includes("/hospital/") ? "hospital" : "gp";
        assert.ok(data.resources.every(record => record.visibleTo.includes(site)));
        if (path.includes("patient=")) assert.ok(data.resources.every(record => !record.patientId || record.patientId === "SIM-000006"));
      }
      return { round, path, ms, ...(data.population ? { population: data.population } : {}), ...(data.resources ? { returned: data.resources.length, total: data.resourceTotal } : {}) };
    }));
    samples.push(...batch);
  }
}
const proof = { at: new Date().toISOString(), origin, world: team.world, concurrentClients: 3, samples, maxMs: Math.max(...samples.map(sample => sample.ms)) };
mkdirSync(".verification/evidence", { recursive: true });
writeFileSync(`.verification/evidence/api-latency-${label}.json`, JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify(proof, null, 2));
if (process.env.MAX_API_LATENCY_MS) assert.ok(proof.maxMs <= Number(process.env.MAX_API_LATENCY_MS), `Slowest request took ${proof.maxMs}ms`);
