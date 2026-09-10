import { z } from "zod";
export const pharmacyPathways = [
  "Sinusitis",
  "Sore throat",
  "Acute otitis media",
  "Infected insect bites",
  "Impetigo",
  "Shingles",
  "Uncomplicated UTI",
  "Minor illness",
  "Urgent medicine supply",
] as const;
export const pharmacyProductSchema = z.object({
  drug: z.string(),
  formulation: z.string(),
  packSize: z.number().int().positive(),
  stock: z.number().int().nonnegative(),
  stockCostPence: z.number().nonnegative(),
  reorderLevel: z.number().int().nonnegative(),
  costPence: z.number().int().nonnegative(),
  pricePence: z.number().int().nonnegative(),
});
export const pharmacyReferralSchema = z.object({
  pathway: z.enum(pharmacyPathways),
  source: z.enum(["gp", "hospital", "patient", "referrals"]),
  receivedAt: z.number(),
  stage: z.enum(["received", "accepted", "consulting", "completed"]),
  outcome: z.string().optional(),
  completedAt: z.number().optional(),
});

export const supplierQuoteSchema = z.object({
  productId: z.string(),
  supplier: z.string(),
  packSize: z.number().int().positive(),
  packCostPence: z.number().int().nonnegative(),
  minimumPacks: z.number().int().positive(),
  leadDays: z.number().int().nonnegative(),
  deliveryFeePence: z.number().int().nonnegative().default(0),
  available: z.boolean().default(true),
});
export const purchaseOrderSchema = supplierQuoteSchema.extend({
  packs: z.number().int().positive(),
  totalPence: z.number().int().nonnegative(),
  orderedAt: z.number(),
  dueAt: z.number(),
  receivedAt: z.number().optional(),
  receivedPacks: z.number().int().nonnegative().default(0),
  cancelledPacks: z.number().int().nonnegative().default(0),
  receivedCostPence: z.number().nonnegative().default(0),
  batchId: z.string().optional(),
  cancellationReason: z.string().optional(),
});

export const pharmacyBasketSchema = z.object({
  lines: z.array(z.object({quoteId: z.string(), quoteVersion: z.number().int().positive(), productId: z.string(), packs: z.number().int().positive(), requiredUnits: z.number().int().positive(), quote: supplierQuoteSchema})).max(100),
  orderIds: z.array(z.string()).optional(),
});
