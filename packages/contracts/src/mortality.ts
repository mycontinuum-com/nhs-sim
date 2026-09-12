import { z } from "zod";

export const patientDeathSchema = z.object({
  date: z.iso.date(),
  cause: z.string().min(1),
  synthetic: z.literal(true),
  source: z.literal("authored-synthetic-mortality-v1"),
});
export type PatientDeath = z.infer<typeof patientDeathSchema>;
