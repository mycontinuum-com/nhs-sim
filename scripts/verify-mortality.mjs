import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { patientDeathSchema } from "../packages/contracts/src/mortality.ts";
import { mortalityFixtures } from "../packages/engine/src/mortality.ts";

export async function verifyMortality(base, issued) {
  const headers = { Authorization: `Bearer ${issued.apiKey}` };
  const get = async path => {
    const response = await fetch(base + path, { headers });
    assert.equal(response.status, 200, `Mortality verification: ${path}`);
    return response.json();
  };
  const report = [];
  for (const [id, cause] of mortalityFixtures) {
    const directory = await get(`/api/sites/gp/patients?q=${id}`);
    const patient = directory.items.find(patient => patient.id === id);
    assert.ok(patient, `Fixture ${id} exists`);
    const death = patientDeathSchema.parse(patient.death);
    assert.equal(death.cause, cause);
    assert.ok(patient.birthDate <= death.date);
    const hospital = await get(`/api/sites/hospital/patients?q=${id}`);
    assert.deepEqual(hospital.items.find(patient => patient.id === id), patient);
    const fhir = await get(`/api/nhs/pds/Patient/${id}`);
    assert.equal(fhir.deceasedDateTime, death.date);
    assert.equal(fhir.active, true);
    const birth = new Date(patient.birthDate), died = new Date(death.date);
    const birthdayPending = died.getUTCMonth() < birth.getUTCMonth() || (died.getUTCMonth() === birth.getUTCMonth() && died.getUTCDate() < birth.getUTCDate());
    report.push({ id, name: patient.name, birthDate: patient.birthDate, death, ageAtDeath: died.getUTCFullYear() - birth.getUTCFullYear() - Number(birthdayPending) });
  }
  const living = await get("/api/sites/gp/patients?q=SIM-000001");
  assert.equal(living.items.find(patient => patient.id === "SIM-000001").death, undefined);
  const livingFhir = await get("/api/nhs/pds/Patient/SIM-000001");
  assert.equal(livingFhir.deceasedDateTime, undefined);
  mkdirSync(".verification/evidence", { recursive: true });
  writeFileSync(".verification/evidence/mortality.json", JSON.stringify({ world: issued.world, patients: report }, null, 2));
  return report;
}
