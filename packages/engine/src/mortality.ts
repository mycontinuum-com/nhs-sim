import type { Patient } from "../../contracts/src/index.ts";
import type { PatientDeath } from "../../contracts/src/mortality.ts";

export const mortalityFixtures = new Map([
  ["SIM-000009", "Road traffic collision"],
  ["SIM-000011", "Pneumonia"],
  ["SIM-000012", "Sepsis"],
  ["SIM-000018", "Cancer"],
  ["SIM-000019", "Stroke"],
]);

export function syntheticDeath(patient: Pick<Patient, "id" | "birthDate" | "death">, now: number): PatientDeath | undefined {
  if (patient.death) return patient.death;
  const cause = mortalityFixtures.get(patient.id);
  if (!cause) return undefined;
  const birth = Date.parse(patient.birthDate);
  if (!Number.isFinite(birth) || !Number.isFinite(now) || birth > now) return undefined;
  return {
    date: new Date(Math.max(birth, now - 7 * 86400000)).toISOString().slice(0, 10),
    cause, synthetic: true, source: "authored-synthetic-mortality-v1",
  };
}

export function seedMortality(patients: Patient[], now: number): Patient[] {
  let changed = false;
  const updated = patients.map(patient => {
    const death = syntheticDeath(patient, now);
    if (!death || patient.death) return patient;
    changed = true;
    return { ...patient, death };
  });
  return changed ? updated : patients;
}
