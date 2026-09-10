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
export const documentTagsSchema = z.array(z.string().trim().min(1).max(50)).max(20);
export const documentCodesSchema = z.array(z.object({ code: z.string().regex(/^[0-9]{6,18}$/), display: z.string().trim().min(1).max(200) })).max(20);
const content = { tags: documentTagsSchema.default([]), snomedCodes: documentCodesSchema.default([]), sections: dischargeSectionsSchema, assignee: z.string().max(100).default("") };
const delivered = { ...content, sentAt: z.number(), sentBy: z.string() };
const reviewed = { ...delivered, reviewedAt: z.number(), reviewedBy: z.string(), reviewNote: z.string() };
export const dischargeDocumentSchema = z.discriminatedUnion("stage", [
  z.object({ ...content, stage: z.literal("draft") }),
  z.object({ ...delivered, stage: z.literal("sent") }),
  z.object({ ...reviewed, stage: z.literal("reviewed") }),
  z.object({ ...reviewed, stage: z.literal("filed"), filedAt: z.number(), filedBy: z.string(), filingNote: z.string() }),
]);
export const emptyDischargeSections: DischargeSections = { reason: "", course: "", diagnoses: "", medicationChanges: "", results: "", followUp: "", gpActions: "" };
