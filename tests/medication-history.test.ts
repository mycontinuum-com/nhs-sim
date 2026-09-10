import { test } from "node:test";
import assert from "node:assert/strict";
import type { Patient } from "../packages/contracts/src/index.ts";
import { generateMedicationHistory, generateAllergyHistory, medicationHistorySources } from "../packages/engine/src/medication-history.ts";
const now = Date.parse("2026-09-12T08:00:00Z");
const patient: Patient = { id: "SIM-000100", name: "Test Person", birthDate: "1960-01-01", localIds: {}, conditions: ["Asthma", "Type 2 diabetes", "Hypertension", "Eczema", "Osteoarthritis"], needs: [], goals: [], synthetic: true };

test("medicine histories are repeatable, condition-linked and do not mutate patients", () => {
  const before = structuredClone(patient);
  const entries = generateMedicationHistory(patient, now);
  assert.deepEqual(entries, generateMedicationHistory(patient, now));
  assert.deepEqual(patient, before);
  assert.ok(entries.some((entry) => entry.term === "Metformin tablets"));
  assert.ok(entries.some((entry) => entry.term === "Beclometasone inhaler"));
  assert.equal(entries.some((entry) => entry.term === "Diclofenac gel"), false);
  for (const entry of entries) {
    assert.ok(patient.conditions.includes(entry.indication));
    assert.ok(Date.parse(entry.issueDate) >= Date.parse(patient.birthDate));
    assert.ok(Date.parse(entry.issueDate) <= now);
    assert.ok(Date.parse(entry.reviewDate) >= Date.parse(entry.issueDate));
    assert.equal(entry.synthetic, true);
    assert.equal("dosage" in entry, false);
    assert.doesNotMatch(entry.term, /SYNTHETIC-/);
    assert.ok(medicationHistorySources.some((source) => source.medicine === entry.term));
  }
});

test("adult catalogue does not invent diabetes subtype or complex kidney and heart regimens", () => {
  assert.deepEqual(generateMedicationHistory({ ...patient, birthDate: "2015-01-01" }, now), []);
  assert.deepEqual(generateMedicationHistory({ ...patient, conditions: ["Diabetes"] }, now), []);
  assert.deepEqual(generateMedicationHistory({ ...patient, conditions: ["CKD", "Heart failure", "Type 2 diabetes", "Hypertension", "Osteoarthritis"] }, now), []);
  assert.deepEqual(generateMedicationHistory({ ...patient, conditions: [] }, now), []);
});

test("acute issues are closed while repeat supply has practice and pharmacy stages", () => {
  const acute = generateMedicationHistory({ ...patient, conditions: ["Eczema", "Osteoarthritis", "Hay fever", "Migraine"] }, now);
  assert.equal(acute.length, 4);
  assert.ok(acute.every((entry) => entry.prescriptionType === "acute" && !entry.isCurrent && entry.supplyStatus === "ended"));
  const entries = Array.from({ length: 30 }, (_, index) => generateMedicationHistory({ ...patient, id: `SIM-${index}`, conditions: ["Hypertension"] }, now)).flat();
  assert.deepEqual(new Set(entries.filter((entry) => entry.isCurrent).map((entry) => entry.supplyStatus)), new Set(["issued", "dispensed", "collected"]));
  assert.ok(entries.some((entry) => !entry.isCurrent && entry.prescriptionType === "repeat"));
});

test("allergy histories are sparse reported reactions with no generated medicine conflict", () => {
  const people = Array.from({ length: 100 }, (_, index) => ({ ...patient, id: `SIM-${index}` }));
  const histories = people.map((person) => generateAllergyHistory(person, now));
  assert.ok(histories.some((history) => history.length === 0));
  assert.ok(histories.some((history) => history.length === 1));
  assert.deepEqual(histories, people.map((person) => generateAllergyHistory(person, now)));
  for (const [index, entries] of histories.entries()) {
    for (const entry of entries) {
      assert.equal(entry.status, "active");
      assert.equal(entry.verification, "patient-reported");
      assert.doesNotMatch(entry.term, /SYNTHETIC-/);
      assert.ok(Date.parse(entry.date) >= Date.parse(patient.birthDate) && Date.parse(entry.date) <= now);
      assert.equal(generateMedicationHistory(people[index], now).some((medicine) => medicine.term.startsWith(entry.term)), false);
    }
  }
});
