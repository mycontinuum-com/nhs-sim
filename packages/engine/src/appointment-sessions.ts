import type { World, Resource } from "../../contracts/src/index.ts";
export function seedAppointmentSessions(world: World) {
  if (world.counters.appointmentSessionVersion === 1) return;
  const ids = new Set(world.resources.filter(r => r.kind === "appointment-session").map(r => r.id));
  const day = Math.floor(world.now / 86400000) * 86400000;
  const clinicians = ["Dr Maya Shah", "Dr Daniel Brooks", "Nurse Alex Morgan"];
  for (let offset = 0; offset < 7; offset++) for (const [index, clinician] of clinicians.entries()) for (const hour of [8, 13]) {
    const startsAt = day + offset * 86400000 + hour * 3600000;
    const id = `appointment-session-${startsAt}-${index}`;
    if (ids.has(id)) continue;
    const resource: Resource = {
      id, kind: "appointment-session", title: `${index === 1 ? "Telephone surgery" : index === 2 ? "Practice nurse" : "Main surgery"} · ${hour === 8 ? "AM" : "PM"}`,
      owner: "gp", visibleTo: ["gp"], status: "open", priority: "routine", version: 1, createdAt: world.now,
      data: { clinician, location: index === 1 ? "Telephone hub" : `Room ${index + 1}`, startsAt, endsAt: startsAt + 4 * 3600000, slotMinutes: 15, mode: index === 1 ? "telephone" : "in-person", blockedSlots: [{ startsAt: startsAt + 150 * 60000, reason: "Protected break" }] },
      provenance: { created: { actor: { kind: "simulation", name: "Alex Ledger · Practice administrator" }, source: "gp", action: "seed", time: world.now, version: 1 }, changes: [] },
    };
    world.resources.push(resource);
  }
  world.counters.appointmentSessionVersion = 1;
}
export function upgradeAppointmentWorld(world: World): World {
  if (world.counters.appointmentSessionVersion === 1) return world;
  const upgraded = { ...world, resources: [...world.resources], counters: { ...world.counters } };
  seedAppointmentSessions(upgraded);
  return upgraded;
}
