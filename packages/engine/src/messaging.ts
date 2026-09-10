import type { RecordActor, Resource, SiteId, World } from "../../contracts/src/index.ts";
import { conversationSchema, type MessagingCommand } from "../../contracts/src/messaging.ts";
type Context = { world: World; site: SiteId; command: MessagingCommand; actor: RecordActor; resource?: Resource; patientId?: string; expectedVersion?: number; add: (kind: string, title: string, patientId?: string) => Resource; fail: (message: string, status: number) => never };
export function applyMessaging({ world, site, command, actor, resource, patientId, expectedVersion, add, fail }: Context): Resource {
  if (site !== "gp" && site !== "patient") return fail("Use the practice or patient messaging workspace", 403);
  if (site === "patient" && command.kind !== "reply") return fail("Patients can only reply to practice conversations", 403);
  if (resource && expectedVersion === undefined) return fail("A resource version is required", 409);
  if (command.kind === "create") {
    if (resource || !patientId) return fail("Choose a patient for a new conversation", 400);
    const r = add("conversation", command.subject, patientId);
    r.status = "open"; r.visibleTo = ["gp", "patient"];
    r.data = { assignee: "", allowReply: command.allowReply, entries: [{ id: `${r.id}-1`, direction: "outgoing", body: command.body, channel: command.channel, at: world.now, actor, delivery: [{ status: "queued", at: world.now, actor }] }] };
    return r;
  }
  if (command.kind === "save_template") {
    if (resource && resource.kind !== "message-template") return fail("Choose a messaging template", 400);
    const r = resource ?? add("message-template", command.title);
    r.title = command.title; r.data = { body: command.body, channel: command.channel }; r.visibleTo = ["gp"]; r.status = "active";
    if (resource) r.version++;
    return r;
  }
  if (command.kind === "archive_template") {
    if (!resource || resource.kind !== "message-template") return fail("Choose a messaging template", 400);
    resource.status = "archived"; resource.version++; return resource;
  }
  if (!resource || resource.kind !== "conversation" || resource.owner !== "gp") return fail("Choose a practice conversation", 400);
  if (site === "patient" && patientId !== resource.patientId) return fail("Select the patient who owns this conversation", 403);
  const doc = conversationSchema.parse(resource.data);
  if (command.kind === "complete") resource.status = "done";
  else if (command.kind === "reopen") resource.status = "open";
  else if (command.kind === "assign") doc.assignee = command.assignee;
  else if (command.kind === "delivery" || command.kind === "retry") {
    const entry = doc.entries.find(item => item.id === command.entryId);
    if (!entry || entry.direction !== "outgoing") return fail("Choose an outgoing message", 400);
    const previous = entry.delivery.at(-1)?.status;
    if (command.kind === "retry" && previous !== "failed") return fail("Only failed messages can be retried", 409);
    if (command.kind === "delivery" && previous !== "queued") return fail("Only queued messages can receive a delivery outcome", 409);
    entry.delivery.push({ status: command.kind === "retry" ? "queued" : command.status, at: world.now, actor });
  } else {
    if (resource.status !== "open") return fail("Reopen the conversation before adding messages", 409);
    const base = { id: `${resource.id}-${doc.entries.length + 1}`, body: command.body, at: world.now, actor };
    if (command.kind === "note") doc.entries.push({ ...base, direction: "internal" });
    else if (command.kind === "send") doc.entries.push({ ...base, direction: "outgoing", channel: command.channel, delivery: [{ status: "queued", at: world.now, actor }] });
    else {
      if (!doc.allowReply) return fail("Replies are disabled for this conversation", 409);
      const last = [...doc.entries].reverse().find(entry => entry.direction === "outgoing" && entry.delivery.at(-1)?.status === "delivered");
      if (!last || last.direction !== "outgoing") return fail("Wait for a delivered message before replying", 409);
      doc.entries.push({ ...base, direction: "incoming", channel: last.channel });
    }
  }
  resource.data = doc; resource.version++; return resource;
}
export function patientConversation(resource: Resource): Resource {
  const doc = conversationSchema.parse(resource.data);
  return { ...resource, data: { ...doc, assignee: "", entries: doc.entries.filter(entry => entry.direction === "incoming" || (entry.direction === "outgoing" && entry.delivery.at(-1)?.status === "delivered")) }, provenance: undefined };
}
