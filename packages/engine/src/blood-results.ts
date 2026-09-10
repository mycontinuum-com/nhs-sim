import type { World } from "../../contracts/src/index.ts";
import { bloodPanels, type BloodAnalyte, type BloodResult } from "../../contracts/src/blood-results.ts";

type AnalyteTemplate = Omit<BloodAnalyte, "value"> & { baseline: number; variation: number; decimals: number };
const templates: Record<BloodResult["panel"]["id"], AnalyteTemplate[]> = {
  fbc: [
    { id: "haemoglobin", name: "Haemoglobin", unit: "g/L", referenceLow: 115, referenceHigh: 165, baseline: 137, variation: 24, decimals: 0 },
    { id: "white-cell-count", name: "White cell count", unit: "×10⁹/L", referenceLow: 4, referenceHigh: 11, baseline: 7, variation: 5, decimals: 1 },
    { id: "platelets", name: "Platelets", unit: "×10⁹/L", referenceLow: 150, referenceHigh: 400, baseline: 265, variation: 135, decimals: 0 },
    { id: "mcv", name: "Mean cell volume", unit: "fL", referenceLow: 80, referenceHigh: 100, baseline: 90, variation: 12, decimals: 1 },
    { id: "neutrophils", name: "Neutrophils", unit: "×10⁹/L", referenceLow: 2, referenceHigh: 7.5, baseline: 4.5, variation: 3, decimals: 1 },
  ],
  ue: [
    { id: "sodium", name: "Sodium", unit: "mmol/L", referenceLow: 133, referenceHigh: 146, baseline: 139, variation: 8, decimals: 0 },
    { id: "potassium", name: "Potassium", unit: "mmol/L", referenceLow: 3.5, referenceHigh: 5.3, baseline: 4.3, variation: 1.2, decimals: 1 },
    { id: "urea", name: "Urea", unit: "mmol/L", referenceLow: 2.5, referenceHigh: 7.8, baseline: 6, variation: 5, decimals: 1 },
    { id: "creatinine", name: "Creatinine", unit: "µmol/L", referenceLow: 45, referenceHigh: 110, baseline: 88, variation: 60, decimals: 0 },
    { id: "egfr", name: "eGFR", unit: "mL/min/1.73m²", referenceLow: 60, referenceHigh: 120, baseline: 82, variation: 38, decimals: 0 },
  ],
  hba1c: [{ id: "hba1c", name: "HbA1c", unit: "mmol/mol", referenceLow: 20, referenceHigh: 41, baseline: 42, variation: 23, decimals: 0 }],
  lft: [
    { id: "alt", name: "ALT", unit: "U/L", referenceLow: 0, referenceHigh: 40, baseline: 28, variation: 30, decimals: 0 },
    { id: "alp", name: "Alkaline phosphatase", unit: "U/L", referenceLow: 30, referenceHigh: 130, baseline: 85, variation: 60, decimals: 0 },
    { id: "bilirubin", name: "Bilirubin", unit: "µmol/L", referenceLow: 0, referenceHigh: 21, baseline: 12, variation: 12, decimals: 0 },
    { id: "albumin", name: "Albumin", unit: "g/L", referenceLow: 35, referenceHigh: 50, baseline: 42, variation: 9, decimals: 0 },
  ],
  crp: [{ id: "crp", name: "C-reactive protein", unit: "mg/L", referenceLow: 0, referenceHigh: 5, baseline: 8, variation: 6, decimals: 1 }],
  lipids: [
    { id: "total-cholesterol", name: "Total cholesterol", unit: "mmol/L", referenceLow: 0, referenceHigh: 5, baseline: 4.8, variation: 1.7, decimals: 1 },
    { id: "hdl", name: "HDL cholesterol", unit: "mmol/L", referenceLow: 1, referenceHigh: 2.5, baseline: 1.5, variation: 0.7, decimals: 1 },
    { id: "triglycerides", name: "Triglycerides", unit: "mmol/L", referenceLow: 0, referenceHigh: 1.7, baseline: 1.4, variation: 1.1, decimals: 1 },
  ],
};

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function seedBloodResults(world: World): void {
  if ((world.counters.bloodResultVersion ?? 0) >= 1) return;
  const ids = new Set(world.resources.map(resource => resource.id));
  const daysAgo = [365, 240, 120, 60, 14, 1];
  for (const patient of world.patients) {
    const historySpan = Math.min(365 * 86400000, world.now - Date.parse(patient.birthDate));
    for (const panel of bloodPanels) {
      for (const [sample, days] of daysAgo.entries()) {
        const id = `blood-v1-${patient.id}-${panel.id}-${sample}`;
        if (ids.has(id)) continue;
        const collectedAt = world.now - historySpan * days / 365;
        const reportedAt = Math.min(world.now, collectedAt + 3600000);
        const analytes = templates[panel.id].map(({ baseline, variation, decimals, ...analyte }) => {
          const offset = hash(`${patient.id}:${analyte.id}`) % 201 / 100 - 1;
          const trend = Math.sin(sample * 0.8 + hash(`${patient.id}:${panel.id}`) % 10) * 0.35;
          const value = Number(Math.max(0.1, baseline + variation * (offset + trend)).toFixed(decimals));
          return { ...analyte, value };
        });
        const whiteCells = analytes.find(analyte => analyte.id === "white-cell-count");
        const neutrophils = analytes.find(analyte => analyte.id === "neutrophils");
        if (whiteCells && neutrophils) neutrophils.value = Number(Math.min(neutrophils.value, whiteCells.value * 0.75).toFixed(1));
        const data: BloodResult = { kind: "blood-result", panel: { ...panel }, collectedAt, analytes, laboratory: "Northbank training laboratory", synthetic: true };
        world.resources.push({
          id, patientId: patient.id, kind: "report", title: `${panel.name} · synthetic blood results`,
          owner: "diagnostics", visibleTo: ["gp", "hospital", "diagnostics"], status: "available", priority: "routine",
          createdAt: reportedAt, version: 1, data,
          provenance: { created: { actor: { kind: "simulation", name: "Dr Robin Vial" }, source: "diagnostics", action: "seed_blood_results", time: reportedAt, version: 1 }, changes: [] },
        });
        ids.add(id);
      }
    }
  }
  world.counters.bloodResultVersion = 1;
}

export function upgradeBloodResultWorld(world: World): World {
  if ((world.counters.bloodResultVersion ?? 0) >= 1) return world;
  const upgraded = { ...world, resources: [...world.resources], counters: { ...world.counters } };
  seedBloodResults(upgraded);
  return upgraded;
}

export function seedPatientBloodResults(world: World, patientId: string): void {
  if (world.counters[`bloodPatient:${patientId}`] === 1) return;
  const patient = world.patients.find(item => item.id === patientId);
  if (!patient) return;
  const sample: World = { ...world, patients: [patient], resources: [], counters: {} };
  seedBloodResults(sample);
  const ids = new Set(world.resources.filter(resource => resource.patientId === patientId).map(resource => resource.id));
  world.resources.push(...sample.resources.filter(resource => !ids.has(resource.id)));
  world.counters[`bloodPatient:${patientId}`] = 1;
}

export function orderedBloodResult(panelName: string, patientId: string, collectedAt: number): BloodResult | undefined {
  const normalized = panelName.toLowerCase().replace(/\s*\([^)]*\)/g, "").trim();
  const panel = bloodPanels.find(item => item.id === panelName || item.name.toLowerCase().replace(/\s*\([^)]*\)/g, "").trim() === normalized);
  if (!panel) return;
  const analytes = templates[panel.id].map(({ baseline, variation, decimals, ...analyte }) => ({ ...analyte, value: Number(Math.max(0.1, baseline + variation * ((hash(`${patientId}:${analyte.id}:${collectedAt}`) % 201 / 100 - 1) * 0.5)).toFixed(decimals)) }));
  const whiteCells = analytes.find(analyte => analyte.id === "white-cell-count");
  const neutrophils = analytes.find(analyte => analyte.id === "neutrophils");
  if (whiteCells && neutrophils) neutrophils.value = Number(Math.min(neutrophils.value, whiteCells.value * 0.75).toFixed(1));
  return { kind: "blood-result", panel: { ...panel }, collectedAt, analytes, laboratory: "Northbank training laboratory", synthetic: true };
}
