import type { Resource, World } from "../../contracts/src/index.ts";
export function seedMessaging(world: World) {
  if (world.counters.messagingVersion === 1) return;
  const ids = new Set(world.resources.map(r => r.id));
  const subjects = ["Appointment confirmation", "Contact details check", "Form ready to collect", "Hospital letter received", "Appointment preference", "Registration paperwork"];
  const bodies = ["Your appointment booking is ready to confirm. Please reply with your preferred morning or afternoon time.", "Please check your contact preferences with reception. This message uses a fictional delivery address.", "Your requested administrative form is ready for collection at reception.", "The practice has received your hospital letter. Our team will record the next administrative step.", "Would you prefer an in-person or telephone appointment? Reply with your preference.", "Please contact reception to finish the outstanding registration paperwork."];
  for (let index = 0; index < 12; index++) {
    const patient = world.patients[index % world.patients.length];
    if (!patient) continue;
    const id = `messaging-example-${index + 1}`;
    if (ids.has(id)) continue;
    const actor = { kind: "simulation", name: index % 2 ? "Dr Rowan Page" : "Alex Ledger · Practice administrator" } satisfies { kind: "simulation"; name: string };
    const at = world.now - (12 - index) * 3600000;
    const resource: Resource = { id, kind: "conversation", patientId: patient.id, title: subjects[index % subjects.length] ?? "Practice message", owner: "gp", visibleTo: ["gp", "patient"], status: index > 9 ? "done" : "open", priority: "routine", createdAt: at, version: 1, data: { assignee: index % 3 ? actor.name : "", allowReply: index % 4 !== 3, entries: [{ id: `${id}-1`, direction: "outgoing", body: bodies[index % bodies.length], channel: index % 3 ? "sms" : "email", at, actor, delivery: [{ status: "queued", at, actor }, { status: index === 2 ? "failed" : "delivered", at: at + 1000, actor }] }, ...(index % 4 === 0 ? [{ id: `${id}-2`, direction: "incoming", body: "Thank you. An afternoon appointment would work for me.", channel: "sms", at: at + 60000, actor: { kind: "simulation", name: patient.name } }] : [])] }, provenance: { created: { actor, source: "gp", action: "seed", time: at, version: 1 }, changes: [] } };
    world.resources.push(resource);
  }
  for (let index = 0; index < 3; index++) {
    const id = `messaging-template-${index + 1}`;
    if (ids.has(id)) continue;
    world.resources.push({ id, kind: "message-template", title: subjects[index] ?? "Practice template", owner: "gp", visibleTo: ["gp"], status: "active", priority: "routine", version: 1, createdAt: world.now, data: { body: bodies[index], channel: "sms" }, provenance: { created: { actor: { kind: "simulation", name: "Alex Ledger · Practice administrator" }, source: "gp", action: "seed", time: world.now, version: 1 }, changes: [] } });
  }
  world.counters.messagingVersion = 1;
}
export function upgradeMessagingWorld(world: World): World {
  if (world.counters.messagingVersion === 1) return world;
  const upgraded = { ...world, resources: [...world.resources], counters: { ...world.counters } };
  seedMessaging(upgraded); return upgraded;
}
