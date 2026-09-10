import { z } from "zod";
import type { Resource } from "./index.ts";
const legacyAllergies = z.array(z.object({ term: z.string(), key: z.string().optional(), reaction: z.string().default(""), status: z.enum(["active", "inactive"]).default("active") }));
export type PatientAllergy = { key: string; term: string; reaction: string; status: "active" | "inactive"; record?: Resource };
export function patientAllergies(rows: Resource[], patientId: string): PatientAllergy[] {
  const own = rows.filter((row) => row.patientId === patientId);
  const recorded = own.filter((row) => row.kind === "allergy");
  const replaced = new Set(recorded.map((row) => row.data.sourceAllergyKey));
  const historical = own.filter((row) => row.kind === "ehr-record").flatMap((row) => {
    const parsed = legacyAllergies.safeParse(row.data.allergies);
    return parsed.success ? parsed.data.map((allergy, index): PatientAllergy => ({ key: allergy.key ?? `${row.id}:${index}`, term: allergy.term, reaction: allergy.reaction, status: allergy.status })) : [];
  });
  return [...historical.filter((allergy) => !replaced.has(allergy.key)), ...recorded.map((record): PatientAllergy => ({
    key: record.id, term: record.title, reaction: typeof record.data.reaction === "string" ? record.data.reaction : "",
    status: record.status === "inactive" ? "inactive" : "active", record,
  }))];
}
