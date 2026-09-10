import { z } from "zod";
const sectionsSchema = z.array(z.object({ id: z.string().min(1).max(80), heading: z.string().min(1).max(120), text: z.string().max(20000) })).min(1).max(12);
export const hospitalNoteTemplateSchema = z.enum(["free-text", "history-physical", "progress"]);
const content = { template: hospitalNoteTemplateSchema, sections: sectionsSchema, text: z.string() };
export const hospitalNoteSchema = z.discriminatedUnion("stage", [
  z.object({ ...content, stage: z.literal("draft") }),
  z.object({ ...content, stage: z.literal("signed"), signedAt: z.number(), signedBy: z.string(), addenda: z.array(z.object({ text: z.string(), time: z.number(), author: z.string() })) }),
]);
export const hospitalNoteCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("save"), template: hospitalNoteTemplateSchema, sections: sectionsSchema }),
  z.object({ kind: z.literal("sign") }),
  z.object({ kind: z.literal("addendum"), text: z.string().trim().min(1).max(20000) }),
]);
export type HospitalNote = z.infer<typeof hospitalNoteSchema>;
export type HospitalNoteCommand = z.infer<typeof hospitalNoteCommandSchema>;
export const hospitalNoteTemplates: { value: HospitalNote["template"]; label: string; headings: string[] }[] = [
  { value: "free-text", label: "Free text note", headings: ["Clinical note"] },
  { value: "history-physical", label: "History and physical", headings: ["Reason for attendance", "History of presenting illness", "Past medical history", "Examination", "Assessment and plan"] },
  { value: "progress", label: "Progress note", headings: ["Interval history", "Examination and results", "Assessment", "Plan"] },
];
