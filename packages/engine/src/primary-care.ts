import type { World } from "../../contracts/src/index.ts";
import type { PrescriptionQuery } from "../../contracts/src/primary-care.ts";

export function prescriptionPage(world: World, query: PrescriptionQuery) {
  const records = world.resources.filter(resource => resource.kind === "prescription" && resource.visibleTo.includes("gp") && (!query.patient || resource.patientId === query.patient));
  return { items: records.slice(query.offset, query.offset + query.limit), total: records.length, offset: query.offset, limit: query.limit };
}
