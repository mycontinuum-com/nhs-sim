import { z } from "zod";
const body = z.string().trim().min(1).max(5000);
const channel = z.enum(["sms", "email"]);
const actor = z.object({ kind: z.enum(["team", "operator", "simulation"]), name: z.string() });
const subject = z.string().trim().min(1).max(160);
const base = { id: z.string(), body, at: z.number(), actor };
export const conversationEntrySchema = z.discriminatedUnion("direction", [
  z.object({ ...base, direction: z.literal("outgoing"), channel, delivery: z.array(z.object({ status: z.enum(["queued", "delivered", "failed"]), at: z.number(), actor })).min(1) }),
  z.object({ ...base, direction: z.literal("incoming"), channel }),
  z.object({ ...base, direction: z.literal("internal") }),
]);
export const patientReplyStepSchema = z.object({ body, delayMinutes: z.number().min(0).max(10080) });
export const patientReplyPresets = [
  { id: "appointment-preference", title: "Appointment preference", steps: [{ body: "An afternoon appointment would suit me, thank you.", delayMinutes: 5 }] },
  { id: "acknowledgment", title: "Acknowledgment", steps: [{ body: "Thank you, I have received your message.", delayMinutes: 2 }] },
  { id: "collection-availability", title: "Collection availability", steps: [{ body: "I can collect it from reception tomorrow afternoon, thank you.", delayMinutes: 10 }] },
] satisfies { id: string; title: string; steps: z.infer<typeof patientReplyStepSchema>[] }[];
export const conversationSchema = z.object({
  assignee: z.string(), allowReply: z.boolean(), entries: z.array(conversationEntrySchema).min(1),
  autoReply: z.object({
    steps: z.array(patientReplyStepSchema).max(20), nextStep: z.number().int().nonnegative(),
    pending: z.array(z.object({ entryId: z.string(), stepIndex: z.number().int().nonnegative(), at: z.number() })),
  }).optional(),
});
export type Conversation = z.infer<typeof conversationSchema>;
export const messageTemplateSchema = z.object({ body, channel });
export const patientMessagingCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("patient_create"), subject, body, channel }),
  z.object({ kind: z.literal("reply"), body }),
]);
export const practiceMessagingCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), subject, body, channel, allowReply: z.boolean() }),
  z.object({ kind: z.literal("send"), body, channel }),
  z.object({ kind: z.literal("configure_auto_reply"), steps: z.array(patientReplyStepSchema).max(20) }),
  z.object({ kind: z.literal("note"), body }),
  z.object({ kind: z.literal("assign"), assignee: z.string().trim().max(120) }),
  z.object({ kind: z.literal("complete") }), z.object({ kind: z.literal("reopen") }),
  z.object({ kind: z.literal("delivery"), entryId: z.string(), status: z.enum(["delivered", "failed"]) }),
  z.object({ kind: z.literal("retry"), entryId: z.string() }),
  z.object({ kind: z.literal("save_template"), title: z.string().trim().min(1).max(120), body, channel }),
  z.object({ kind: z.literal("archive_template") }),
]);
export const messagingCommandSchema = z.discriminatedUnion("kind", [...patientMessagingCommandSchema.options, ...practiceMessagingCommandSchema.options]);
export type MessagingCommand = z.infer<typeof messagingCommandSchema>;
