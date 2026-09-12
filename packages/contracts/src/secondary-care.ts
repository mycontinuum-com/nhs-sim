import { z } from "zod";

export const secondaryCareQuerySchema = z.object({
  patient: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type SecondaryCareQuery = z.infer<typeof secondaryCareQuerySchema>;
export const secondaryCareConsultationKinds: ReadonlySet<string> = new Set(["hospital-note", "clinical-note", "consultation", "encounter"]);
export const secondaryCareApi = {
  name: "Secondary care",
  site: "hospital",
  description: "Raw synthetic hospital consultations and genome records; requires hospital scope.",
  consultations: "/api/sites/hospital/consultations",
  genomes: "/api/sites/hospital/genomes",
} as const;
