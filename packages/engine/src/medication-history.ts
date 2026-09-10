import type { Patient } from "../../contracts/src/index.ts";

export const medicationHistorySources = [
  { medicine: "Furosemide tablets", indication: "Authored discharge supply fixture", url: "https://www.nhs.uk/medicines/furosemide/" },
  { medicine: "Named allergy histories", indication: "Reported food and contact reactions", url: "https://www.nhs.uk/conditions/allergies/" },
  { medicine: "Latex allergy history", indication: "Contact reaction", url: "https://www.cuh.nhs.uk/patient-information/information-for-patients-with-latex-allergy/" },
  { medicine: "Amlodipine tablets", indication: "Hypertension", url: "https://www.nhs.uk/medicines/amlodipine/" },
  { medicine: "Metformin tablets", indication: "Type 2 diabetes", url: "https://www.nhs.uk/medicines/metformin/" },
  { medicine: "Beclometasone inhaler", indication: "Asthma", url: "https://www.nhs.uk/medicines/beclometasone-inhalers/about-beclometasone-inhalers/" },
  { medicine: "Salbutamol inhaler", indication: "Asthma", url: "https://www.nhs.uk/medicines/salbutamol-inhaler/about-salbutamol-inhalers/" },
  { medicine: "Diclofenac gel", indication: "Osteoarthritis", url: "https://www.nhs.uk/medicines/diclofenac/about-diclofenac/" },
  { medicine: "Hydrocortisone cream", indication: "Eczema", url: "https://www.nhs.uk/medicines/hydrocortisone-for-skin/" },
  { medicine: "Cetirizine tablets", indication: "Hay fever", url: "https://www.nhs.uk/medicines/cetirizine/about-cetirizine/" },
  { medicine: "Omeprazole capsules", indication: "Acid reflux", url: "https://www.nhs.uk/medicines/omeprazole/" },
  { medicine: "Sertraline tablets", indication: "Depression", url: "https://www.nhs.uk/medicines/sertraline/" },
  { medicine: "Levothyroxine tablets", indication: "Hypothyroidism", url: "https://www.nhs.uk/medicines/levothyroxine/" },
  { medicine: "Paracetamol tablets", indication: "Migraine", url: "https://www.nhs.uk/medicines/paracetamol-for-adults/about-paracetamol-for-adults/" },
  { medicine: "Amoxicillin allergy history", indication: "Reported rash", url: "https://www.nhs.uk/medicines/amoxicillin/side-effects-of-amoxicillin/" },
];

type PrescriptionType = "repeat" | "acute";
export type MedicationHistoryEntry = {
  term: string;
  isCurrent: boolean;
  issueDate: string;
  indication: string;
  route: "oral" | "inhaled" | "topical";
  prescriptionType: PrescriptionType;
  supplyStatus: "issued" | "dispensed" | "collected" | "ended";
  reviewDate: string;
  note: string;
  synthetic: true;
};
export type AllergyHistoryEntry = {
  term: string;
  reaction: string;
  status: "active";
  verification: "patient-reported";
  date: string;
  synthetic: true;
};
type Medicine = Pick<MedicationHistoryEntry, "term" | "route" | "prescriptionType">;
type CatalogueEntry = { conditions: string[]; medicines: Medicine[]; exclude: string[] };
const catalogue: CatalogueEntry[] = [
  { conditions: ["asthma"], medicines: [
    { term: "Beclometasone inhaler", route: "inhaled", prescriptionType: "repeat" },
    { term: "Salbutamol inhaler", route: "inhaled", prescriptionType: "repeat" },
  ], exclude: [] },
  { conditions: ["type 2 diabetes", "type ii diabetes"], medicines: [{ term: "Metformin tablets", route: "oral", prescriptionType: "repeat" }], exclude: ["ckd", "chronic kidney disease", "heart failure"] },
  { conditions: ["hypertension"], medicines: [{ term: "Amlodipine tablets", route: "oral", prescriptionType: "repeat" }], exclude: ["heart failure", "ckd", "chronic kidney disease"] },
  { conditions: ["osteoarthritis"], medicines: [{ term: "Diclofenac gel", route: "topical", prescriptionType: "acute" }], exclude: ["asthma", "ckd", "chronic kidney disease", "heart failure"] },
  { conditions: ["eczema"], medicines: [{ term: "Hydrocortisone cream", route: "topical", prescriptionType: "acute" }], exclude: [] },
  { conditions: ["hay fever", "allergic rhinitis"], medicines: [{ term: "Cetirizine tablets", route: "oral", prescriptionType: "acute" }], exclude: ["ckd", "chronic kidney disease"] },
  { conditions: ["acid reflux", "gord", "gastro-oesophageal reflux disease"], medicines: [{ term: "Omeprazole capsules", route: "oral", prescriptionType: "repeat" }], exclude: [] },
  { conditions: ["depression"], medicines: [{ term: "Sertraline tablets", route: "oral", prescriptionType: "repeat" }], exclude: [] },
  { conditions: ["hypothyroidism", "underactive thyroid"], medicines: [{ term: "Levothyroxine tablets", route: "oral", prescriptionType: "repeat" }], exclude: [] },
  { conditions: ["migraine"], medicines: [{ term: "Paracetamol tablets", route: "oral", prescriptionType: "acute" }], exclude: ["liver disease"] },
];
const day = 86_400_000;
function fingerprint(value: string) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
function validClock(patient: Patient, now: number) {
  const birth = Date.parse(patient.birthDate);
  if (!Number.isFinite(now) || Number.isNaN(new Date(now).getTime()) || !Number.isFinite(birth) || birth > now) throw new Error("Medication history requires a valid birth date and simulation clock");
  return birth;
}
function date(time: number) { return new Date(time).toISOString().slice(0, 10); }

export function generateMedicationHistory(patient: Patient, now: number): MedicationHistoryEntry[] {
  const birth = validClock(patient, now);
  const adulthood = new Date(birth);
  adulthood.setUTCFullYear(adulthood.getUTCFullYear() + 18);
  if (now < adulthood.getTime()) return [];
  const conditions = patient.conditions.map((condition) => condition.toLowerCase().trim());
  const entries: MedicationHistoryEntry[] = [];
  for (const item of catalogue) {
    const indication = patient.conditions.find((condition) => item.conditions.includes(condition.toLowerCase().trim()));
    if (!indication || item.exclude.some((condition) => conditions.includes(condition))) continue;
    for (const medicine of item.medicines) {
      const hash = fingerprint(`${patient.id}:${patient.birthDate}:${medicine.term}`);
      const acute = medicine.prescriptionType === "acute";
      const issueTime = Math.max(adulthood.getTime(), now - (acute ? 45 + hash % 320 : 7 + hash % 55) * day);
      const supplyStatus = acute ? "ended" : hash % 3 === 0 ? "issued" : hash % 3 === 1 ? "dispensed" : "collected";
      const note = acute ? "Previous acute issue retained in the record. The course is closed and is not on the repeat list." : supplyStatus === "issued" ? "Practice issue recorded; community pharmacy collection has not yet been recorded." : supplyStatus === "dispensed" ? "Community pharmacy has prepared the repeat issue; collection is outstanding." : "Community pharmacy collection recorded. The practice retains the next review date.";
      entries.push({ ...medicine, indication, isCurrent: !acute, supplyStatus,
        issueDate: date(issueTime), reviewDate: date(acute ? Math.min(now, issueTime + 14 * day) : now + (14 + hash % 90) * day),
        note, synthetic: true,
      });
      if (!acute && hash % 4 === 0 && now - adulthood.getTime() > 240 * day) {
        entries.push({ ...medicine, indication, isCurrent: false, supplyStatus: "ended", issueDate: date(now - (180 + hash % 45) * day), reviewDate: date(now - 90 * day), note: "Earlier repeat issue retained for reconciliation. A later issue of the same medicine is recorded above.", synthetic: true });
      }
    }
  }
  return entries;
}

export function generateAllergyHistory(patient: Patient, now: number): AllergyHistoryEntry[] {
  const birth = validClock(patient, now);
  const hash = fingerprint(`${patient.id}:${patient.birthDate}:allergy`);
  if (hash % 9 !== 0) return [];
  const reactions = [
    { term: "Amoxicillin", reaction: "Itchy rash reported after a previous course; details awaiting confirmation" },
    { term: "Latex", reaction: "Local itching and redness after contact with gloves; reported at registration" },
    { term: "Peanuts", reaction: "Hives reported after eating peanuts; previous allergy clinic letter requested" },
  ];
  const reaction = reactions[Math.floor(hash / 9) % reactions.length];
  return [{ ...reaction, status: "active", verification: "patient-reported", date: date(Math.max(birth, now - (180 + hash % 900) * day)), synthetic: true }];
}
