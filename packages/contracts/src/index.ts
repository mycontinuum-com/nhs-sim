import { z } from "zod";

export const sites = [
  {
    id: "control",
    name: "Simulation control",
    subtitle: "Clock, scenarios and world operations",
    color: "#17324d",
    kind: "control",
  },
  {
    id: "gp",
    name: "Riverside Practice",
    subtitle: "Primary care · modern record",
    color: "#005eb8",
    kind: "clinical",
  },
  {
    id: "hospital",
    name: "SystemTwo EPR",
    subtitle: "Northbank acute care · inpatient record",
    color: "#164f87",
    kind: "clinical",
  },
  {
    id: "messaging",
    name: "Pingr",
    subtitle: "Secure-ish care-team messaging · patient context",
    color: "#087f7d",
    kind: "clinical",
  },
  {
    id: "legacy",
    name: "Cerner? I Hardly Know Her",
    subtitle: "Westhaven legacy EPR · browser workflow",
    color: "#60533f",
    kind: "legacy",
  },
  {
    id: "triage",
    name: "Front Door",
    subtitle: "Requests and patient navigation",
    color: "#007f78",
    kind: "clinical",
  },
  {
    id: "diagnostics",
    name: "Path & Picture",
    subtitle: "Pathology and radiology worklists",
    color: "#8c3b20",
    kind: "clinical",
  },
  {
    id: "referrals",
    name: "Referral Exchange",
    subtitle: "Services, referrals and booking",
    color: "#394f99",
    kind: "clinical",
  },
  {
    id: "pharmacy",
    name: "Neighbourhood Pharmacy",
    subtitle: "Prescriptions, stock and dispensing",
    color: "#137047",
    kind: "clinical",
  },
  {
    id: "community",
    name: "Neighbourhood Care",
    subtitle: "Virtual ward, home visits and support",
    color: "#087b89",
    kind: "clinical",
  },
  {
    id: "wearables",
    name: "Home Signals",
    subtitle: "Devices and remote observations",
    color: "#a02e57",
    kind: "clinical",
  },
  {
    id: "robotics",
    name: "Fleet Operations",
    subtitle: "Robots, deliveries and capacity",
    color: "#3e4e66",
    kind: "clinical",
  },
  {
    id: "patient",
    name: "My Neighbourhood",
    subtitle: "Synthetic patient and carer workspace",
    color: "#005eb8",
    kind: "clinical",
  },
  {
    id: "population",
    name: "Population & Research",
    subtitle: "Prevention, genomics and quality",
    color: "#635091",
    kind: "clinical",
  },
  {
    id: "hr",
    name: "ES-Arrr",
    subtitle: "Electronic Staff Record-ish · HR and absence",
    color: "#85476d",
    kind: "clinical",
  },
  {
    id: "roster",
    name: "Allocate-ish",
    subtitle: "Rostering · skill mix and safe staffing",
    color: "#304f87",
    kind: "clinical",
  },
  {
    id: "ambulance",
    name: "CAD-astrophe",
    subtitle: "Dispatch, handovers and emergency demand",
    color: "#087653",
    kind: "clinical",
  },
  {
    id: "nhsapp",
    name: "My Health Thing",
    subtitle: "Citizen front door · choices, messages and records",
    color: "#005eb8",
    kind: "patient",
  },
  {
    id: "urgent",
    name: "Pathways-ish 111",
    subtitle: "Urgent-care dispositions and service discovery",
    color: "#007f3b",
    kind: "clinical",
  },
  {
    id: "mental",
    name: "RiO Grande",
    subtitle: "Community mental health and crisis pathways",
    color: "#006b75",
    kind: "clinical",
  },
  {
    id: "maternity",
    name: "Badger-ish Notes",
    subtitle: "Maternity, neonatal and perinatal records",
    color: "#9b286f",
    kind: "clinical",
  },
  {
    id: "dental",
    name: "Dentally Challenged",
    subtitle: "NHS dentistry, recalls and oral-health programmes",
    color: "#0072ce",
    kind: "clinical",
  },
  {
    id: "social",
    name: "Solid Logic",
    subtitle: "Adult social care, carers and home support",
    color: "#5a4b84",
    kind: "clinical",
  },
  {
    id: "genomics",
    name: "Gene-ius",
    subtitle: "Genomic testing, consent and family relationships",
    color: "#5b3f96",
    kind: "clinical",
  },
  {
    id: "theatre",
    name: "Orpheus",
    subtitle: "Theatre lists, robots, beds and recovery capacity",
    color: "#006a73",
    kind: "operations",
  },
  {
    id: "beds",
    name: "Bedrock",
    subtitle: "Bed state, discharge barriers and patient flow",
    color: "#bd4f19",
    kind: "operations",
  },
  {
    id: "icb",
    name: "Commission Impossible",
    subtitle: "Population budgets, quality and provider performance",
    color: "#243b64",
    kind: "operations",
  },
  {
    id: "research",
    name: "Trial & Error",
    subtitle: "Synthetic cohort discovery and trial recruitment",
    color: "#59458b",
    kind: "research",
  },
] as const;
export type SiteId = (typeof sites)[number]["id"];
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
  target: z.enum(sites.map((s) => s.id) as [SiteId, ...SiteId[]]).optional(),
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
