import { dischargeSectionsSchema } from "./documents.ts";
import { pharmacyPathways } from "./pharmacy.ts";
import { z } from "zod";

const serviceIds = [
  "control",
  "gp",
  "hospital",
  "messaging",
  "legacy",
  "triage",
  "diagnostics",
  "referrals",
  "pharmacy",
  "community",
  "wearables",
  "robotics",
  "patient",
  "population",
  "hr",
  "roster",
  "ambulance",
  "nhsapp",
  "urgent",
  "mental",
  "maternity",
  "dental",
  "social",
  "genomics",
  "theatre",
  "beds",
  "icb",
  "research",
] as const;
export type SiteId = (typeof serviceIds)[number];
export const sites = [
  {
    id: "control",
    name: "The neighbourhood",
    subtitle: "Explore the simulated world",
    color: "#456352",
    kind: "control",
  },
  {
    id: "gp",
    name: "SystemTwo",
    subtitle: "Riverside Practice · primary care",
    color: "#315b82",
    kind: "clinical",
  },
  {
    id: "hospital",
    name: "Millenni-ish EPR",
    subtitle: "Northbank General · secondary care",
    color: "#63516f",
    kind: "clinical",
  },
  {
    id: "pharmacy",
    name: "ProScrip-ish",
    subtitle: "High Street Pharmacy",
    color: "#11675e",
    kind: "clinical",
  },
  {
    id: "community",
    name: "CareBnB",
    subtitle: "Community visiting team",
    color: "#976039",
    kind: "clinical",
  },
  {
    id: "wearables",
    name: "Witherings",
    subtitle: "Personal health journal",
    color: "#6d71cb",
    kind: "consumer",
  },
] as const;
export const activeServices: SiteId[] = [
  "control",
  "gp",
  "hospital",
  "community",
  "pharmacy",
  "diagnostics",
  "referrals",
  "wearables",
  "legacy",
];

export type Patient = {
  id: string;
  name: string;
  birthDate: string;
  localIds: Record<string, string>;
  conditions: string[];
  needs: string[];
  goals: string[];
  synthetic: true;
};
export type RecordActor =
  | { kind: "team"; name: string }
  | { kind: "operator"; name: string }
  | { kind: "simulation"; name: string };
export type RecordChange = {
  actor: RecordActor;
  source: SiteId;
  action: string;
  time: number;
  version: number;
};
export type Resource = {
  id: string;
  patientId?: string;
  kind: string;
  title: string;
  status: string;
  owner: SiteId;
  visibleTo: SiteId[];
  priority: "routine" | "urgent";
  createdAt: number;
  dueAt?: number;
  data: Record<string, unknown>;
  version: number;
  provenance?: {
    created: RecordChange | null;
    changes: RecordChange[];
    recovery?: {
      migration: string;
      basis:
        | "synthetic-history"
        | "simulation-generator"
        | "recorded-change"
        | "team-event"
        | "unavailable";
    };
  };
};
export type SimEvent = {
  id: string;
  time: number;
  type: string;
  actor: string;
  resourceId?: string;
  patientId?: string;
  detail: string;
  visibleTo: SiteId[];
};
export type Scheduled = {
  at: number;
  type:
    | "result"
    | "delivery"
    | "visit"
    | "arrival"
    | "observation"
    | "acute"
    | "bed-pressure"
    | "screening"
    | "service-demand";
  resourceId?: string;
  patientId?: string;
};
export type World = {
  id: string;
  seed: number;
  rng: number;
  now: number;
  speed: number;
  paused: boolean;
  nextId: number;
  patients: Patient[];
  resources: Resource[];
  scheduled: Scheduled[];
  agents: { id: string; enabled: boolean }[];
  counters: Record<string, number>;
  faults: Record<string, boolean>;
};
export const actionSchema = z
  .object({
    type: z.enum([
      "save_discharge_summary",
      "process_document",
      "place_pharmacy_order",
      "receive_pharmacy_order",
      "receive_pharmacy_referral",
      "update_pharmacy_referral",
      "receive_stock",
      "update_stock_price",
      "link_prescription_stock",
      "register_attendance",
      "update_attendance",
      "connect_device",
      "create_task",
      "create_referral",
      "order_test",
      "draft_prescription",
      "book_appointment",
      "create_appointment_session",
      "set_appointment_slot",
      "arrive_appointment",
      "cancel_appointment",
      "save_consultation",
      "save_problem",
      "save_allergy",
      "send_message",
      "schedule_visit",
      "dispatch_robot",
      "review",
      "accept",
      "complete",
      "reject",
      "dispense",
      "collect",
      "share_record",
      "report_absence",
      "restore_staff",
      "allocate_shift",
    ]),
    dischargeSections: dischargeSectionsSchema.optional(),
    documentCommand: z.enum(["send", "assign", "review", "file"]).optional(),
    patientId: z.string().optional(),
    resourceId: z.string().optional(),
    title: z.string().min(1).max(500).optional(),
    target: z.enum(activeServices as [SiteId, ...SiteId[]]).optional(),
    expectedVersion: z.number().int().positive().optional(),
    text: z.string().trim().min(1).max(20000).optional(),
    consultationStatus: z.enum(["draft", "saved"]).optional(),
    allergyStatus: z.enum(["active", "inactive"]).optional(),
    reaction: z.string().trim().max(2000).optional(),
    sourceAllergyKey: z.string().min(1).max(600).optional(),
    problemStatus: z.enum(["active", "resolved"]).optional(),
    problemCode: z.string().trim().max(100).optional(),
    onsetDate: z.iso.date().optional(),
    sourceProblemKey: z.string().min(1).max(600).optional(),
    startsAt: z.number().int().nonnegative().max(8640000000000000).optional(),
    endsAt: z.number().int().nonnegative().max(8640000000000000).optional(),
    slotMinutes: z.number().int().min(5).max(120).optional(),
    sessionId: z.string().min(1).optional(),
    sessionVersion: z.number().int().positive().optional(),
    slotCommand: z.enum(["block", "unblock"]).optional(),
    durationMinutes: z.number().int().min(5).max(120).optional(),
    productId: z.string().min(1).optional(),
    quantity: z.number().int().min(1).max(100000).optional(),
    costPence: z.number().int().min(0).max(10000000).optional(),
    pricePence: z.number().int().min(0).max(10000000).optional(),
    reorderLevel: z.number().int().min(0).max(100000).optional(),
    pharmacyPathway: z.enum(pharmacyPathways).optional(),
    referralSource: z.enum(["gp", "hospital", "patient", "referrals"]).optional(),
    pharmacyCommand: z.enum(["accept", "consult", "complete"]).optional(),
    hospitalCommand: z.enum(["assign", "assess", "refer", "admit", "discharge"]).optional(),
    acuity: z.enum(["1", "2", "3", "4", "5"]).optional(),
    location: z.string().trim().min(1).max(100).optional(),
    disposition: z.string().trim().min(1).max(500).optional(),
    clinician: z.string().trim().min(1).max(100).optional(),
    mode: z.enum(["in-person", "telephone", "video", "online"]).optional(),
  })
  .superRefine((action, context) => {
    if (action.type === "connect_device") {
      if (!action.patientId?.trim())
        context.addIssue({
          code: "custom",
          path: ["patientId"],
          message: "patientId is required for a device",
        });
      if (action.resourceId)
        context.addIssue({
          code: "custom",
          path: ["resourceId"],
          message: "Connect a device by patient, not resource",
        });
    }
    if (action.type === "save_allergy") {
      for (const field of ["patientId", "title", "allergyStatus"] as const)
        if (!action[field]?.trim())
          context.addIssue({
            code: "custom",
            path: [field],
            message: field + " is required for an allergy",
          });
      if (action.resourceId && action.expectedVersion === undefined)
        context.addIssue({
          code: "custom",
          path: ["expectedVersion"],
          message: "expectedVersion is required when editing an allergy",
        });
      if (action.resourceId && action.sourceAllergyKey)
        context.addIssue({
          code: "custom",
          path: ["sourceAllergyKey"],
          message: "Choose an existing allergy or a historical source",
        });
    }
    if (action.type === "save_problem") {
      for (const field of ["patientId", "title", "problemStatus"] as const)
        if (!action[field]?.trim())
          context.addIssue({
            code: "custom",
            path: [field],
            message: field + " is required for a problem",
          });
      if (action.resourceId && action.expectedVersion === undefined)
        context.addIssue({
          code: "custom",
          path: ["expectedVersion"],
          message: "expectedVersion is required when editing a problem",
        });
      if (action.resourceId && action.sourceProblemKey)
        context.addIssue({
          code: "custom",
          path: ["sourceProblemKey"],
          message: "Choose an existing problem or a historical source",
        });
    }
    if (action.type === "save_consultation") {
      for (const field of ["patientId", "title", "text", "consultationStatus"] as const)
        if (!action[field]?.trim())
          context.addIssue({
            code: "custom",
            path: [field],
            message: field + " is required for a consultation",
          });
      if (action.resourceId && action.expectedVersion === undefined)
        context.addIssue({
          code: "custom",
          path: ["expectedVersion"],
          message: "expectedVersion is required when editing a consultation",
        });
    }
  });
export type Action = z.infer<typeof actionSchema>;
export const scenarios = [
  {
    id: "pathology-outage",
    title: "Pathology feed outage",
    description: "Hold new results in diagnostics until the feed is restored.",
  },
  {
    id: "staff-shortage",
    title: "Community staffing shortage",
    description: "Reduce available home-visit slots.",
  },
  {
    id: "robot-failure",
    title: "Robot maintenance incident",
    description: "Prevent new dispatches until the fleet is restored.",
  },
  {
    id: "demand-surge",
    title: "Demand surge",
    description: "Create a burst of new patient requests.",
  },
  {
    id: "wearable-disconnect",
    title: "Home device disconnection",
    description: "Generate missing readings rather than normal observations.",
  },
  {
    id: "winter-pressure",
    title: "Winter pressure",
    description: "Increase urgent arrivals and reduce available beds.",
  },
  {
    id: "pharmacy-shortage",
    title: "Medicine supply interruption",
    description: "Reduce stock and generate dispensing exceptions.",
  },
  {
    id: "cyber-readonly",
    title: "Supplier read-only incident",
    description: "Represent a safety-preserving degradation across legacy systems.",
  },
] as const;
