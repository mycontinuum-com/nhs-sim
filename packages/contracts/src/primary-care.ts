import { z } from "zod";

export const prescriptionQuerySchema = z.object({
  patient: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type PrescriptionQuery = z.infer<typeof prescriptionQuerySchema>;
export const primaryCareApi = {
  name: "Primary care prescriptions",
  site: "gp",
  description: "Issue, retrieve, review and approve synthetic GP prescriptions; requires GP scope.",
  prescriptions: "/api/sites/gp/prescriptions",
  actions: "/api/sites/gp/actions",
} as const;
