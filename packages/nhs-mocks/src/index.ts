import { activeServices } from "../../contracts/src/index.ts";
import type { Engine } from "../../engine/src/index.ts";
import type { SiteId } from "../../contracts/src/index.ts";

export const matchAdapterPath = (path: string) =>
  path.match(/^\/api\/nhs\/([a-z0-9-]+)(?:\/([^/]+))?$/);

const adapterDefinitions = [
  {
    id: "pds",
    name: "Personal Demographics Service",
    site: "gp",
    resource: "Patient",
    description: "FHIR Patient search and read with local SIM identifiers",
    fhirBase: "/api/nhs/pds/Patient",
  },
  {
    id: "ods",
    name: "Organisation Data Service",
    site: "referrals",
    resource: "Organization",
    description: "FHIR Organization search and read for the fictional care network",
    fhirBase: "/api/nhs/ods/Organization",
  },
  {
    id: "dos",
    name: "Directory of Services",
    site: "referrals",
    resource: "HealthcareService",
    description: "Service discovery and availability",
  },
  {
    id: "ers",
    name: "e-Referral Service",
    site: "referrals",
    resource: "ServiceRequest",
    kind: "referral",
    description: "Create, read, accept and reject referrals",
  },
  {
    id: "eps",
    name: "Electronic Prescription Service",
    site: "pharmacy",
    resource: "MedicationRequest",
    kind: "prescription",
    description: "Draft, approve, dispense and collect",
  },
  {
    id: "eps-tracker",
    name: "Electronic Prescription Tracker",
    site: "pharmacy",
    resource: "MedicationRequest",
    kind: "prescription",
    description: "Read prescription lifecycle",
  },
  {
    id: "gp-connect",
    name: "GP Connect task adapter",
    site: "gp",
    resource: "Task",
    kind: "task",
    description: "Local primary-care task projection",
  },
  {
    id: "mesh",
    name: "MESH message adapter",
    site: "gp",
    resource: "Communication",
    kind: "message",
    description: "Simplified JSON mailbox; not real MESH protocol",
  },
  {
    id: "scr",
    name: "Shared Care Documents",
    site: "gp",
    resource: "DocumentReference",
    kind: "document",
    description: "Visible shared documents only",
  },
  {
    id: "immunisations",
    name: "Jab-a-Dabba-Doo",
    site: "population",
    resource: "Immunization",
    kind: "vaccination",
    description: "Synthetic immunisation register",
  },
  {
    id: "screening",
    name: "Screen Time",
    site: "population",
    resource: "ServiceRequest",
    kind: "screening",
    description: "Screening follow-up register",
  },
  {
    id: "pathology",
    name: "Pathology results",
    site: "diagnostics",
    resource: "DiagnosticReport",
    kind: "test",
    description: "Delayed laboratory results",
  },
  {
    id: "radiology",
    name: "Radiology reports",
    site: "diagnostics",
    resource: "DiagnosticReport",
    kind: "report",
    description: "Synthetic report metadata; no DICOM server",
  },
  {
    id: "appointments",
    name: "Appointments",
    site: "gp",
    resource: "Appointment",
    kind: "appointment",
    description: "Capacity-backed booking",
  },
  {
    id: "nhs-login",
    name: "NHS-ish Login",
    site: "nhsapp",
    resource: "Person",
    description: "Patient-facing identity fixture; separate from CIS-too",
  },
  {
    id: "nrl",
    name: "National Record Lo-Cater",
    site: "nhsapp",
    resource: "DocumentReference",
    kind: "document",
    description: "Pointers to records visible in the synthetic world",
  },
  {
    id: "personal-demographics",
    name: "Who Do You Think You Are?",
    site: "nhsapp",
    resource: "Patient",
    description: "Patient-facing demographic projection",
  },
  {
    id: "111",
    name: "Pathways-ish API",
    site: "urgent",
    resource: "ServiceRequest",
    kind: "disposition",
    description: "Synthetic urgent-care dispositions",
  },
  {
    id: "uec-booking",
    name: "Book Me Maybe",
    site: "urgent",
    resource: "Appointment",
    kind: "appointment",
    description: "Urgent-care appointment projection",
  },
  {
    id: "mental-health",
    name: "MHSDS-ish",
    site: "mental",
    resource: "CarePlan",
    kind: "mental-health-plan",
    description: "Community mental-health care-plan projection",
  },
  {
    id: "maternity",
    name: "Maternity Matters",
    site: "maternity",
    resource: "EpisodeOfCare",
    kind: "maternity-episode",
    description: "Synthetic maternity episode projection",
  },
  {
    id: "dental",
    name: "Open Wide API",
    site: "dental",
    resource: "ServiceRequest",
    kind: "dental-recall",
    description: "Dental recall and access workflow",
  },
  {
    id: "social-care",
    name: "Care Act-ually",
    site: "social",
    resource: "CarePlan",
    kind: "care-package",
    description: "Synthetic adult-social-care package workflow",
  },
  {
    id: "genomics",
    name: "Genome Sweet Genome",
    site: "genomics",
    resource: "DiagnosticReport",
    kind: "genomic-test",
    description: "Consent-aware fictional genomic reports",
  },
  {
    id: "beds",
    name: "Bedrock Flow",
    site: "beds",
    resource: "Location",
    kind: "bed",
    description: "Bed state and discharge-barrier projection",
  },
  {
    id: "theatres",
    name: "All the Ward's a Stage",
    site: "theatre",
    resource: "Appointment",
    kind: "theatre-slot",
    description: "Theatre list, robot and recovery-capacity projection",
  },
  {
    id: "workforce",
    name: "ES-Arrr Workforce",
    site: "hr",
    resource: "PractitionerRole",
    kind: "staff",
    description: "Synthetic staff availability; no real ESR interface",
  },
  {
    id: "rostering",
    name: "Allocate-ish Roster",
    site: "roster",
    resource: "Schedule",
    kind: "staff",
    description: "Skill mix and allocation projection",
  },
  {
    id: "ambulance",
    name: "CAD-astrophe Feed",
    site: "ambulance",
    resource: "Encounter",
    kind: "handover",
    description: "Synthetic dispatch and handover work",
  },
  {
    id: "provider-metrics",
    name: "League of Extraordinary Providers",
    site: "icb",
    resource: "MeasureReport",
    kind: "provider-metric",
    description: "Quality, wait and experience metrics",
  },
  {
    id: "research",
    name: "Trial & Error Finder",
    site: "research",
    resource: "ResearchSubject",
    kind: "trial-candidate",
    description: "Consent-aware synthetic cohort candidates",
  },
] as const;
export const catalogue = adapterDefinitions.filter((api) => activeServices.some((id) => id === api.site));
export function bundle(engine: Engine, world: string, id: string, q: string) {
  const api = catalogue.find((a) => a.id === id);
  if (!api) return undefined;
  if (["pds", "personal-demographics", "nhs-login"].includes(id)) {
    const ps = engine.patients(world, q);
    return {
      resourceType: "Bundle",
      type: "searchset",
      total: ps.total,
      entry: ps.items.map((p) => ({
        resource: {
          resourceType: "Patient",
          id: p.id,
          identifier: [{ system: "urn:nhs-sim:synthetic", value: p.id }],
          name: [{ text: p.name }],
          birthDate: p.birthDate,
          meta: { tag: [{ code: "SYNTHETIC" }] },
        },
      })),
    };
  }
  if (id === "ods" || id === "dos")
    return {
      resourceType: "Bundle",
      type: "searchset",
      entry: ["gp", "hospital", "community", "pharmacy", "diagnostics"].map((site) => ({
        resource: {
          resourceType: api.resource,
          id: site,
          name: site + " (fictional)",
          active: true,
        },
      })),
    };
  const resources = engine
    .view(world, api.site as SiteId)
    .resources.filter((r) => "kind" in api && r.kind === api.kind && (!q || r.patientId === q));
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: resources.length,
    entry: resources.slice(0, 100).map((r) => ({
      resource: {
        resourceType: api.resource,
        id: r.id,
        status: r.status,
        subject: r.patientId ? { reference: "Patient/" + r.patientId } : undefined,
        description: r.title,
        extension: [{ url: "urn:nhs-sim:workflow", valueString: JSON.stringify(r.data) }],
        meta: {
          versionId: String(r.version),
          tag: [{ code: "SIMPLIFIED-MOCK-NOT-FHIR-CONFORMANT" }],
        },
      },
    })),
  };
}
export { MockOIDC } from "./cis2.ts";
