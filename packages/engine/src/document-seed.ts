import type { Resource, World } from "../../contracts/src/index.ts";
export function seedDocuments(world: World) {
  if (world.counters.documentVersion === 1) return;
  if (!world.resources.some(r => r.id === "discharge-summary-example") && world.patients[0]) {
    const actor = "Synthetic hospital discharge team";
    const resource: Resource = {
      id: "discharge-summary-example", kind: "discharge-summary", title: "Discharge summary · monitoring handover", patientId: world.patients[0].id,
      owner: "hospital", visibleTo: ["hospital", "gp"], status: "sent", priority: "routine", version: 1, createdAt: world.now,
      data: { stage: "sent", assignee: "", sentAt: world.now, sentBy: actor, sections: {
        reason: "Synthetic admission for a monitoring review.", course: "Observation and discharge planning completed in this fictional scenario.", diagnoses: "See the existing simulated problem list; no new diagnosis recorded.", medicationChanges: "No changes recorded in this example letter.", results: "No outstanding investigations recorded in this example.", followUp: "Follow-up arrangements require confirmation by the receiving team.", gpActions: "Review this handover and record its processing outcome in the simulation.",
      } }, provenance: { created: { actor: { kind: "simulation", name: actor }, source: "hospital", action: "seed", time: world.now, version: 1 }, changes: [] },
    };
    world.resources.push(resource);
  }
  world.counters.documentVersion = 1;
}
export function upgradeDocumentWorld(world: World): World {
  if (world.counters.documentVersion === 1) return world;
  const upgraded = { ...world, resources: [...world.resources], counters: { ...world.counters } };
  seedDocuments(upgraded);
  return upgraded;
}
