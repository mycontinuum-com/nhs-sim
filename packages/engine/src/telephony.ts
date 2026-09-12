import { current, isDraft } from "immer";
import type { Resource, World } from "../../contracts/src/index.ts";
import { callDataSchema, type TelephonyCall, type TelephonyCommand, type TelephonyMember } from "../../contracts/src/telephony.ts";
import { SimError } from "./index.ts";

const reasons = [
  ["Appointment request", "Hello, I'd like to arrange a routine appointment please. A morning appointment would suit me best."],
  ["Prescription collection", "Good morning. I'm calling to ask whether my repeat prescription is ready to collect."],
  ["Change of address", "Hello. I've moved house and would like to update the address on my record."],
  ["Appointment cancellation", "Hi, I need to cancel my upcoming appointment. Could you help me arrange another date?"],
  ["Registration enquiry", "Hello, I wanted to check my registration details and the contact number you have for me."],
  ["Letter collection", "Good afternoon. I'm checking whether a letter I requested is ready at reception."],
];
function resourceSnapshot(world: World) {
  return isDraft(world.resources) ? current(world.resources) : world.resources;
}
export function telephonyCalls(world: World): TelephonyCall[] {
  return resourceSnapshot(world).filter(r => r.kind === "telephone-call").map(r => {
    if (!r.patientId) throw new SimError("Call has no patient", 500);
    return { ...callDataSchema.parse(r.data), id: r.id, patientId: r.patientId, version: r.version };
  });
}
export function replenishCalls(world: World, now: number): void {
  if (!world.patients.length) return;
  const calls = telephonyCalls(world);
  let waiting = calls.filter(c => c.state.kind === "waiting").length;
  while (waiting < 8) {
    const index = world.counters.telephonySequence ?? 0;
    const patient = world.patients[index % world.patients.length];
    const [reason, script] = reasons[index % reasons.length];
    const id = `call-${world.id}-${++world.nextId}`;
    world.resources.push({ id, patientId: patient.id, kind: "telephone-call", owner: "gp", visibleTo: ["gp"], title: reason, status: "waiting", priority: "routine", createdAt: now, version: 1, data: { patientName: patient.name, phone: `07700 900${String(index % 1000).padStart(3, "0")}`, reason, script: `Hello, my name is ${patient.name}. ${script}`, voiceSeed: index % 12, state: { kind: "waiting", queuedAt: now } } });
    world.counters.telephonySequence = index + 1;
    waiting++;
  }

}
function update(resource: Resource, state: TelephonyCall["state"]) {
  resource.data = { ...callDataSchema.parse(resource.data), state };
  resource.status = state.kind;
  resource.version++;
}
function callResource(world: World, id: string): Resource {
  const index = resourceSnapshot(world).findIndex(resource => resource.id === id);
  const resource = world.resources[index];
  if (!resource) throw new SimError("Call no longer exists", 409);
  return resource;
}
export function releaseCalls(world: World, memberIds: Set<string> | null, now: number): void {
  resourceSnapshot(world).forEach((resource, index) => {
    if (resource.kind !== "telephone-call") return;
    const data = callDataSchema.parse(resource.data);
    if (data.state.kind === "active" && (memberIds === null || memberIds.has(data.state.memberId))) update(world.resources[index], { kind: "waiting", queuedAt: now });
  });
}
export function applyTelephonyCommand(world: World, member: {id: string; name: string}, members: TelephonyMember[], command: TelephonyCommand, now: number): void {
  if (command.kind === "availability" || command.kind === "rename") return;
  const calls = telephonyCalls(world);
  const current = calls.find(c => c.state.kind === "active" && c.state.memberId === member.id);
  const take = (call: TelephonyCall) => {
    if (call.state.kind !== "waiting") throw new SimError("This call has already been answered", 409);
    const resource = callResource(world, call.id);
    update(resource, { kind: "active", memberId: member.id, answeredBy: member.name, answeredAt: now, held: false });
  };
  if (command.kind === "answer") {
    if (current) throw new SimError("End your current call first", 409);
    const call = calls.find(c => c.id === command.callId);
    if (!call || call.version !== command.version) throw new SimError("This call has changed", 409);
    take(call);
  } else {
    if (command.kind === "next" && command.callId === null) {
      if (current || command.version !== null) throw new SimError("Your current call has changed", 409);
    } else {
      if (!current || current.id !== command.callId || current.version !== command.version || current.state.kind !== "active") throw new SimError("Your current call has changed", 409);
      const resource = callResource(world, current.id);
      if (command.kind === "hold") update(resource, { ...current.state, held: command.held });
      else if (command.kind === "transfer") {
        const target = members.find(m => m.id === command.targetMemberId && m.id !== member.id && m.status === "available");
        if (!target) throw new SimError("This teammate is no longer available", 409);
        update(resource, { ...current.state, memberId: target.id, answeredBy: target.name, held: false });
      } else update(resource, { kind: "completed", answeredBy: current.state.answeredBy, answeredAt: current.state.answeredAt, endedAt: now, note: command.note, outcome: command.kind === "callback" ? "callback" : "completed" });
    }
    if (command.kind === "next") {
      const next = calls.filter(c => c.state.kind === "waiting").sort((a, b) => (a.state.kind === "waiting" ? a.state.queuedAt : 0) - (b.state.kind === "waiting" ? b.state.queuedAt : 0))[0];
      if (next) take(next);
    }
  }
  if (command.kind === "callback" && current) {
    world.resources.push({ id: `call-${world.id}-${++world.nextId}`, patientId: current.patientId, kind: "telephone-call", owner: "gp", visibleTo: ["gp"], title: `Callback: ${current.reason}`, status: "waiting", priority: "routine", createdAt: now, version: 1, data: { patientName: current.patientName, phone: current.phone, reason: `Callback: ${current.reason}`, script: current.script, voiceSeed: current.voiceSeed, state: { kind: "waiting", queuedAt: now } } });
  }
  replenishCalls(world, now);
}
