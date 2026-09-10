import { z } from "zod";
export const dischargeSectionLabels = {
  reason: "Reason for admission",
  course: "Hospital course",
  diagnoses: "Diagnoses",
  medicationChanges: "Medication changes",
  results: "Results and pending investigations",
  followUp: "Follow-up arrangements",
  gpActions: "Requested GP actions",
};
const section = z.string().trim().max(10000);
export const dischargeSectionsSchema = z.object({ reason: section, course: section, diagnoses: section, medicationChanges: section, results: section, followUp: section, gpActions: section });
export type DischargeSections = z.infer<typeof dischargeSectionsSchema>;
const content = { sections: dischargeSectionsSchema, assignee: z.string().max(100).default("") };
const delivered = { ...content, sentAt: z.number(), sentBy: z.string() };
const reviewed = { ...delivered, reviewedAt: z.number(), reviewedBy: z.string(), reviewNote: z.string() };
export const dischargeDocumentSchema = z.discriminatedUnion("stage", [
  z.object({ ...content, stage: z.literal("draft") }),
  z.object({ ...delivered, stage: z.literal("sent") }),
  z.object({ ...reviewed, stage: z.literal("reviewed") }),
  z.object({ ...reviewed, stage: z.literal("filed"), filedAt: z.number(), filedBy: z.string(), filingNote: z.string() }),
]);
export const emptyDischargeSections: DischargeSections = { reason: "", course: "", diagnoses: "", medicationChanges: "", results: "", followUp: "", gpActions: "" };
