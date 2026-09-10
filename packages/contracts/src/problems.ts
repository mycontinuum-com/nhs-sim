import { z } from "zod";
import type { Patient, Resource } from "./index.ts";

const legacyProblems = z.array(z.object({
  term: z.string(), code: z.string().optional(), date: z.string().optional(), status: z.string(),
}));
export type PatientProblem = {
  key: string;
  term: string;
  code: string;
  onsetDate: string;
  status: "active" | "resolved";
  record?: Resource;
};
export function patientProblems(rows: Resource[], patient: Patient): PatientProblem[] {
  const own = rows.filter((row) => row.patientId === patient.id);
  const historical: PatientProblem[] = own.filter((row) => row.kind === "ehr-record").flatMap((row) => {
    const parsed = legacyProblems.safeParse(row.data.problems);
    return parsed.success ? parsed.data.map((problem, index) => ({
      key: `${row.id}:${index}`, term: problem.term, code: problem.code ?? "",
      onsetDate: problem.date?.slice(0, 10) ?? "",
      status: problem.status.toLowerCase() === "resolved" || problem.status.toLowerCase() === "inactive" ? "resolved" as const : "active" as const,
    })) : [];
  });
  const recorded = own.filter((row) => row.kind === "problem");
  const terms = new Set([...historical.map((entry) => entry.term), ...recorded.map((row) => row.title)].map((term) => term.toLowerCase()));
  for (const term of patient.conditions) {
    if (!terms.has(term.toLowerCase())) historical.push({ key: `summary:${term}`, term, code: "", onsetDate: "", status: "active" });
  }
  const replaced = new Set(recorded.map((row) => row.data.sourceProblemKey));
  return [...historical.filter((entry) => !replaced.has(entry.key)), ...recorded.map((record): PatientProblem => ({
    key: record.id, term: record.title, code: typeof record.data.code === "string" ? record.data.code : "",
    onsetDate: typeof record.data.onsetDate === "string" ? record.data.onsetDate : "",
    status: record.status === "resolved" ? "resolved" : "active", record,
  }))];
}
