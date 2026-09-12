import type { World } from "../../contracts/src/index.ts";
import { secondaryCareConsultationKinds, type SecondaryCareQuery } from "../../contracts/src/secondary-care.ts";

export function secondaryCarePage(world: World, collection: "consultations" | "genomes", query: SecondaryCareQuery) {
  const { patient, offset, limit } = query;
  const resources = world.resources.filter(resource =>
    resource.owner === "hospital" && resource.visibleTo.includes("hospital") &&
    (collection === "genomes" ? resource.kind === "genome-record" : secondaryCareConsultationKinds.has(resource.kind)) &&
    (!patient || resource.patientId === patient),
  );
  return { items: resources.slice(offset, offset + limit), total: resources.length, offset, limit, now: world.now };
}
