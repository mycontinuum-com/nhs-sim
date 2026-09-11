import { z } from "zod";

const nameSchema = z.string().trim().min(1).max(60);
export const callStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("waiting"), queuedAt: z.number() }),
  z.object({ kind: z.literal("active"), memberId: z.string(), answeredBy: nameSchema, answeredAt: z.number(), held: z.boolean() }),
  z.object({ kind: z.literal("completed"), answeredBy: nameSchema, answeredAt: z.number(), endedAt: z.number(), note: z.string(), outcome: z.enum(["completed", "callback"]) }),
]);
export const callDataSchema = z.object({ patientName: z.string(), phone: z.string(), reason: z.string(), script: z.string(), voiceSeed: z.number().int(), state: callStateSchema });
export const telephonyCallSchema = callDataSchema.extend({ id: z.string(), patientId: z.string(), version: z.number().int() });
const owned = { callId: z.string(), version: z.number().int().positive() };
export const telephonyCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answer"), ...owned }),
  z.object({ kind: z.literal("next"), callId: z.string().nullable(), version: z.number().int().positive().nullable(), note: z.string().max(2000).default("") }),
  z.object({ kind: z.literal("end"), ...owned, note: z.string().max(2000).default("") }),
  z.object({ kind: z.literal("callback"), ...owned, note: z.string().max(2000).default("") }),
  z.object({ kind: z.literal("hold"), ...owned, held: z.boolean() }),
  z.object({ kind: z.literal("transfer"), ...owned, targetMemberId: z.string() }),
  z.object({ kind: z.literal("availability"), available: z.boolean() }),
  z.object({ kind: z.literal("rename"), name: nameSchema }),
]);
export const telephonyClientMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("authenticate"), apiKey: z.string().min(1).max(200), name: nameSchema }),
  z.object({ kind: z.literal("command"), requestId: z.string().min(1).max(100), command: telephonyCommandSchema }),
]);
export const telephonyMemberSchema = z.object({ id: z.string(), name: nameSchema, status: z.enum(["available", "away", "on-call"]), callId: z.string().nullable() });
export const telephonyServerMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), memberId: z.string(), revision: z.number(), calls: z.array(telephonyCallSchema), members: z.array(telephonyMemberSchema), requestId: z.string().optional() }),
  z.object({ kind: z.literal("error"), requestId: z.string().optional(), message: z.string() }),
]);
export type TelephonyCall = z.infer<typeof telephonyCallSchema>;
export type TelephonyCommand = z.infer<typeof telephonyCommandSchema>;
export type TelephonyMember = z.infer<typeof telephonyMemberSchema>;
export type TelephonyServerMessage = z.infer<typeof telephonyServerMessageSchema>;
export type TelephonySnapshot = Extract<TelephonyServerMessage, { kind: "snapshot" }>;
