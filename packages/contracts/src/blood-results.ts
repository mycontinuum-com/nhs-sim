import { z } from "zod";

export const bloodPanelIdSchema = z.enum(["fbc", "ue", "hba1c", "lft", "crp", "lipids"]);
export const bloodAnalyteSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), value: z.number().finite(), unit: z.string().min(1),
  referenceLow: z.number().finite(), referenceHigh: z.number().finite(),
}).refine(value => value.referenceLow <= value.referenceHigh, { message: "Reference interval must be ordered" });
export const bloodResultSchema = z.object({
  kind: z.literal("blood-result"),
  panel: z.object({ id: bloodPanelIdSchema, name: z.string().min(1) }),
  collectedAt: z.number().finite(),
  analytes: z.array(bloodAnalyteSchema).min(1),
  laboratory: z.string().min(1),
  synthetic: z.literal(true),
});
export type BloodAnalyte = z.infer<typeof bloodAnalyteSchema>;
export type BloodResult = z.infer<typeof bloodResultSchema>;
export const bloodPanels: BloodResult["panel"][] = [
  { id: "fbc", name: "Full blood count (FBC)" },
  { id: "ue", name: "Urea & electrolytes (U&E)" },
  { id: "hba1c", name: "HbA1c" },
  { id: "lft", name: "Liver function tests (LFT)" },
  { id: "crp", name: "C-reactive protein (CRP)" },
  { id: "lipids", name: "Lipid profile" },
];
