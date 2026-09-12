import type { Engine } from "../../engine/src/index.ts";
import type { Patient } from "../../contracts/src/index.ts";

export const fhirSources = [
  "https://digital.nhs.uk/developer/api-catalogue/personal-demographics-service-fhir",
  "https://digital.nhs.uk/developer/api-catalogue/organisation-data-service-fhir",
];
export const simulationIdentifierSystem = "https://nhs-sim.example/identifier/patient";
export const organisationIdentifierSystem = "https://nhs-sim.example/identifier/organisation";
export type FhirResponse = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };
const headers = { "Content-Type": "application/fhir+json", "Cache-Control": "no-store" };
const meta = () => ({ tag: [{ system: "https://nhs-sim.example/tags", code: "synthetic", display: "Fictional simulation record" }] });
export function operationOutcome(status: number, code: string, diagnostics: string): FhirResponse {
  return { status, headers, body: { resourceType: "OperationOutcome", meta: meta(), issue: [{ severity: "error", code, diagnostics }] } };
}
const organisations = [
  { id: "SIM-RIVERSIDE", name: "Riverside Practice", type: "General practice" },
  { id: "SIM-NORTHBANK", name: "Northbank General", type: "Hospital" },
  { id: "SIM-COMMUNITY", name: "Riverside Community Services", type: "Community care" },
  { id: "SIM-PHARMACY", name: "Riverside Pharmacy", type: "Community pharmacy" },
];
function nameParts(patient: Patient) {
  const parts = patient.name.trim().split(/\s+/);
  return { use: "official", text: patient.name, family: parts.at(-1) ?? patient.name, given: parts.slice(0, -1) };
}
function patientResource(patient: Patient, origin: string) {
  const ordinal = Number(patient.id.slice(4));
  const streets = ["Willow Lane", "Cedar Crescent", "Meadow Walk", "Orchard Close"];
  return { resourceType: "Patient", id: patient.id, meta: meta(), active: true,
    identifier: [{ use: "usual", system: simulationIdentifierSystem, value: patient.id }],
    name: [nameParts(patient)], birthDate: patient.birthDate,
    ...(patient.death ? { deceasedDateTime: patient.death.date } : {}),
    address: [{ use: "home", type: "physical", line: [`${1 + ordinal % 180} ${streets[ordinal % streets.length]}`], city: "Northbank", country: "GB" }],
    telecom: [{ system: "email", value: `${patient.id.toLowerCase()}@patients.example`, use: "home" }],
    generalPractitioner: [{ reference: `${origin}/api/nhs/ods/Organization/SIM-RIVERSIDE`, display: "Riverside Practice" }],
  };
}
function organisationResource(organisation: (typeof organisations)[number]) {
  return { resourceType: "Organization", id: organisation.id, meta: meta(), active: true, name: organisation.name,
    identifier: [{ system: organisationIdentifierSystem, value: organisation.id }], type: [{ text: organisation.type }],
    address: [{ use: "work", line: [organisation.name, "Riverside Health Campus"], city: "Northbank", country: "GB" }],
    telecom: [{ system: "email", value: `${organisation.id.toLowerCase()}@organisations.example`, use: "work" }],
  };
}
const searchParameters = {
  Patient: [{ name: "family", type: "string" }, { name: "given", type: "string" }, { name: "birthdate", type: "date" }, { name: "identifier", type: "token" }],
  Organization: [{ name: "name", type: "string" }, { name: "identifier", type: "token" }, { name: "active", type: "token" }],
};
function capability(resource: "Patient" | "Organization") {
  return { resourceType: "CapabilityStatement", id: `sim-${resource.toLowerCase()}`, meta: meta(), status: "active", date: "2026-09-10", kind: "instance", implementation: { description: "NHS-SIM local adapter" }, fhirVersion: "4.0.1", format: ["json"],
    description: "Local read-only FHIR-shaped simulation subset. SIM identifiers are not NHS numbers or ODS codes. No NHS profile validation, fuzzy matching, record updates or real NHS network access. Metadata and _offset pagination are local conveniences, not claims of production PDS or ODS parity.",
    rest: [{ mode: "server", resource: [{ type: resource, interaction: [{ code: "read" }, { code: "search-type" }], searchParam: searchParameters[resource] }] }],
  };
}
function prefix(value: string, query: string | null) { return query === null || value.toLocaleLowerCase("en-GB").startsWith(query.toLocaleLowerCase("en-GB")); }
function identifierMatches(id: string, query: string | null, system: string) {
  if (query === null) return true;
  const split = query.split("|");
  return split.length === 1 ? id === query : (split[0] === "" || split[0] === system) && split[1] === id;
}

// Search deliberately supports exact date and simple prefix matching, without NHS trace scoring.
export function handleFhir({ engine, world, url, method }: { engine: Engine; world: string; url: URL; method: string }): FhirResponse | undefined {
  const path = url.pathname.match(/^\/api\/nhs\/(pds|ods)\/(Patient|Organization|metadata)(?:\/(.*))?$/);
  if (!path) return undefined;
  const resourceType = path[1] === "pds" ? "Patient" : "Organization";
  if (method !== "GET") return { ...operationOutcome(405, "not-supported", "This simulation supports GET only"), headers: { ...headers, Allow: "GET" } };
  if (!engine.get(world)) return operationOutcome(404, "not-found", "Simulation world not found");
  if (path[2] === "metadata") {
    if (path[3] !== undefined || url.search) return operationOutcome(400, "invalid", "Metadata does not accept a resource ID or search parameters");
    return { status: 200, headers, body: capability(resourceType) };
  }
  if (path[2] !== resourceType) return operationOutcome(404, "not-found", "Resource type is not available from this adapter");
  if (path[3] !== undefined) {
    if (url.search) return operationOutcome(400, "invalid", "Read interactions do not accept search parameters");
    const id = path[3];
    if (!(resourceType === "Patient" ? /^SIM-\d{6}$/ : /^SIM-[A-Z]+$/).test(id)) return operationOutcome(400, "invalid", "Use a local SIM identifier");
    const resource = resourceType === "Patient" ? engine.require(world).patients.find((patient) => patient.id === id) : organisations.find((organisation) => organisation.id === id);
    if (!resource) return operationOutcome(404, "not-found", "Synthetic record not found");
    return { status: 200, headers, body: "birthDate" in resource ? patientResource(resource, url.origin) : organisationResource(resource) };
  }
  const parameters = url.searchParams;
  const allowed = new Set([...searchParameters[resourceType].map((parameter) => parameter.name), "_count", "_offset"]);
  for (const [name, value] of parameters) {
    if (!allowed.has(name)) return operationOutcome(400, "not-supported", `Unsupported search parameter: ${name}`);
    if (parameters.getAll(name).length !== 1 || !value.trim()) return operationOutcome(400, "invalid", `Search parameter must have one non-empty value: ${name}`);
  }
  const countValue = parameters.get("_count") ?? "20";
  const offsetValue = parameters.get("_offset") ?? "0";
  if (!/^\d+$/.test(countValue) || !/^\d+$/.test(offsetValue) || Number(countValue) < 1 || Number(countValue) > 100 || !Number.isSafeInteger(Number(offsetValue))) return operationOutcome(400, "invalid", "Use _count from 1 to 100 and a non-negative integer _offset");
  const birthdate = parameters.get("birthdate");
  if (birthdate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || !Number.isFinite(Date.parse(birthdate)) || new Date(birthdate).toISOString().slice(0, 10) !== birthdate)) return operationOutcome(400, "invalid", "birthdate must be a valid YYYY-MM-DD date; date prefixes are unsupported");
  const identifier = parameters.get("identifier");
  if (identifier !== null && (identifier.split("|").length > 2 || !identifier.split("|").at(-1))) return operationOutcome(400, "invalid", "identifier must be a value or system|value");
  const active = parameters.get("active");
  if (active !== null && !["true", "false"].includes(active)) return operationOutcome(400, "invalid", "active must be true or false");
  const matches = resourceType === "Patient" ? engine.require(world).patients.filter((patient) => {
    const name = nameParts(patient);
    return prefix(name.family, parameters.get("family")) && (parameters.get("given") === null || name.given.some((given) => prefix(given, parameters.get("given")))) && (birthdate === null || patient.birthDate === birthdate) && identifierMatches(patient.id, identifier, simulationIdentifierSystem);
  }).sort((a, b) => a.id.localeCompare(b.id)) : organisations.filter((organisation) => prefix(organisation.name, parameters.get("name")) && identifierMatches(organisation.id, identifier, organisationIdentifierSystem) && active !== "false").sort((a, b) => a.id.localeCompare(b.id));
  const count = Number(countValue), offset = Number(offsetValue);
  const link = (relation: string, pageOffset: number) => {
    const next = new URL(url);
    next.searchParams.set("_count", String(count)); next.searchParams.set("_offset", String(pageOffset));
    return { relation, url: next.toString() };
  };
  return { status: 200, headers, body: { resourceType: "Bundle", meta: meta(), type: "searchset", total: matches.length,
    link: [link("self", offset), ...(offset > 0 ? [link("previous", Math.max(0, offset - count))] : []), ...(offset + count < matches.length ? [link("next", offset + count)] : [])],
    entry: matches.slice(offset, offset + count).map((record) => ({ fullUrl: `${url.origin}/api/nhs/${path[1]}/${resourceType}/${record.id}`, resource: "birthDate" in record ? patientResource(record, url.origin) : organisationResource(record), search: { mode: "match" } })),
  } };
}
