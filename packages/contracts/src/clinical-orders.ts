import { z } from "zod";
import { bloodPanelIdSchema } from "./blood-results.ts";
const field = z.string().trim().min(1).max(500);
export const medicationOrderSchema = z.object({ drug: field, dose: field, unit: field, route: field, frequency: field, duration: field, quantity: z.number().int().min(1).max(100000), indication: z.string().trim().min(1).max(2000) });
export const bloodTestOrderSchema = z.object({ panel: field, panelId: bloodPanelIdSchema.optional(), specimen: field, priority: z.enum(["routine", "urgent"]), collection: z.enum(["now", "next-round"]), clinicalDetails: z.string().trim().min(1).max(2000) });
export type MedicationOrder = z.infer<typeof medicationOrderSchema>;
export type BloodTestOrder = z.infer<typeof bloodTestOrderSchema>;
