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
    name: "Millbank EPR",
    subtitle: "Northbank General · secondary care",
    color: "#63516f",
    kind: "clinical",
  },
  {
    id: "pharmacy",
    name: "Dispensary",
    subtitle: "High Street Pharmacy",
    color: "#11675e",
    kind: "clinical",
  },
  {
    id: "community",
    name: "Neighbourhood Care",
    subtitle: "Community visiting team",
    color: "#976039",
    kind: "clinical",
  },
  {
    id: "wearables",
    name: "At home",
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
export const actionSchema = z.object({
  type: z.enum([
    "create_task",
    "create_referral",
    "order_test",
    "draft_prescription",
    "book_appointment",
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
  patientId: z.string().optional(),
  resourceId: z.string().optional(),
  title: z.string().min(1).max(500).optional(),
  target: z.enum(activeServices as [SiteId, ...SiteId[]]).optional(),
  expectedVersion: z.number().int().positive().optional(),
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
