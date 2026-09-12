import { z } from "zod";
import { patientMessagingCommandSchema, practiceMessagingCommandSchema } from "./messaging.ts";

const resourceFields = {
  resourceId: z.string().min(1).optional(),
  expectedVersion: z.number().int().min(1).optional(),
};
export const practiceMessageRequestSchema = z.object({
  ...resourceFields,
  patientId: z.string().min(1).optional(),
  command: practiceMessagingCommandSchema,
}).strict();
export const patientMessageRequestSchema = z.object({
  ...resourceFields,
  patientId: z.string().min(1),
  command: patientMessagingCommandSchema,
}).strict();
export const messageListQuerySchema = z.object({
  patientId: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const messagingApi = {
  name: "Messaging",
  practice: "/api/sites/gp/messages",
  patient: "/api/sites/patient/messages",
  replyPresets: "/api/messaging/reply-presets",
  scope: "gp",
} as const;
