import { z } from "zod";
import type { Resource } from "./index.ts";

const base = z.object({
  arrivalAt: z.number(), presentingComplaint: z.string(),
  acuity: z.enum(["1", "2", "3", "4", "5"]), location: z.string(), clinician: z.string(),
});
const assessed = base.extend({ assessmentAt: z.number() });
const referred = assessed.extend({ referredAt: z.number() });
export const hospitalAttendanceSchema = z.discriminatedUnion("stage", [
  base.extend({ stage: z.literal("waiting") }),
  assessed.extend({ stage: z.literal("assessing") }),
  referred.extend({ stage: z.literal("take") }),
  referred.extend({ stage: z.literal("inpatient"), admittedAt: z.number() }),
  base.extend({ stage: z.literal("discharged"), dischargedAt: z.number(), assessmentAt: z.number().nullable(), referredAt: z.number().optional(), admittedAt: z.number().optional(), disposition: z.string() }),
]);
export type HospitalAttendance = z.infer<typeof hospitalAttendanceSchema>;
export function hospitalAttendances(resources: Resource[]) {
  return resources.flatMap((resource) => {
    if (resource.kind !== "hospital-attendance") return [];
    const parsed = hospitalAttendanceSchema.safeParse(resource.data);
    return parsed.success ? [{ resource, attendance: parsed.data }] : [];
  });
}
export function hospitalMetrics(resources: Resource[], now: number) {
  const rows = hospitalAttendances(resources);
  const waiting = rows.filter(({ attendance: a }) => a.stage === "waiting");
  const today = rows.filter(({ attendance: a }) => new Date(a.arrivalAt).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10));
  const assessedToday = today.flatMap(({ attendance: a }) => "assessmentAt" in a && a.assessmentAt !== null ? [Math.max(0, a.assessmentAt - a.arrivalAt) / 60000] : []);
  return {
    waiting: waiting.length,
    averageWait: waiting.length ? Math.round(waiting.reduce((sum, { attendance: a }) => sum + Math.max(0, now - a.arrivalAt) / 60000, 0) / waiting.length) : null,
    assessedAverage: assessedToday.length ? Math.round(assessedToday.reduce((sum, n) => sum + n, 0) / assessedToday.length) : null,
    arrivalsToday: today.length,
    overFourHours: rows.filter(({ attendance: a }) => ["waiting", "assessing", "take"].includes(a.stage) && now - a.arrivalAt >= 240 * 60000).length,
  };
}
