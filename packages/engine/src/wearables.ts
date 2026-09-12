import type { World } from "../../contracts/src/index.ts";
import type { WearableQuery } from "../../contracts/src/wearables.ts";

export function wearablePage(world: World, kind: "device" | "observation", query: WearableQuery) {
  const { patient, metric, offset, limit } = query;
  const resources = world.resources.filter(resource =>
    resource.owner === "wearables" && resource.visibleTo.includes("wearables") &&
    resource.kind === kind && (!patient || resource.patientId === patient) &&
    (!metric || resource.data.metric === metric),
  );
  return { items: resources.slice(offset, offset + limit), total: resources.length, offset, limit, now: world.now };
}
