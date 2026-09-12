import { z } from "zod";

export const wearableQuerySchema = z.object({
  patient: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const wearableReadingsQuerySchema = wearableQuerySchema.extend({
  metric: z.string().min(1).optional(),
});
export type WearableQuery = z.infer<typeof wearableReadingsQuerySchema>;

export const wearableDeviceDataSchema = z.object({
  battery: z.number().optional(),
  quality: z.string().optional(),
  metric: z.string().optional(),
  lastSyncedAt: z.number().optional(),
}).passthrough();
export const wearableReadingDataSchema = z.object({
  metric: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  quality: z.string(),
  observedAt: z.number(),
  baseline: z.number().optional(),
}).passthrough();

export const wearableApi = {
  name: "Wearables",
  site: "wearables",
  description: "Stored synthetic connected devices and home readings; requires wearables scope.",
  devices: "/api/sites/wearables/devices",
  readings: "/api/sites/wearables/readings",
} as const;
