import { z } from "zod";
const body = z.string().trim().min(1).max(5000);
const channel = z.enum(["sms", "email"]);
const actor = z.object({ kind: z.enum(["team", "operator", "simulation"]), name: z.string() });
const base = { id: z.string(), body, at: z.number(), actor };
export const conversationEntrySchema = z.discriminatedUnion("direction", [
  z.object({ ...base, direction: z.literal("outgoing"), channel, delivery: z.array(z.object({ status: z.enum(["queued", "delivered", "failed"]), at: z.number(), actor })).min(1) }),
  z.object({ ...base, direction: z.literal("incoming"), channel }),
  z.object({ ...base, direction: z.literal("internal") }),
]);
export const conversationSchema = z.object({ assignee: z.string(), allowReply: z.boolean(), entries: z.array(conversationEntrySchema).min(1) });
export type Conversation = z.infer<typeof conversationSchema>;
export const messageTemplateSchema = z.object({ body, channel });
export const messagingCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), subject: z.string().trim().min(1).max(160), body, channel, allowReply: z.boolean() }),
  z.object({ kind: z.literal("send"), body, channel }),
  z.object({ kind: z.literal("reply"), body }),
  z.object({ kind: z.literal("note"), body }),
  z.object({ kind: z.literal("assign"), assignee: z.string().trim().max(120) }),
  z.object({ kind: z.literal("complete") }), z.object({ kind: z.literal("reopen") }),
  z.object({ kind: z.literal("delivery"), entryId: z.string(), status: z.enum(["delivered", "failed"]) }),
  z.object({ kind: z.literal("retry"), entryId: z.string() }),
  z.object({ kind: z.literal("save_template"), title: z.string().trim().min(1).max(120), body, channel }),
  z.object({ kind: z.literal("archive_template") }),
]);
export type MessagingCommand = z.infer<typeof messagingCommandSchema>;
