import { z } from "zod";
import { Engine, SimError } from "./index.ts";
import type { Resource, SiteId, World } from "../../contracts/src/index.ts";

const challengeId = z.enum(["discharge", "digital", "prevention"]);
type ChallengeId = z.infer<typeof challengeId>;
const inputSchema = z.discriminatedUnion("challenge", [
  z
    .object({
      challenge: z.literal("discharge"),
      action: z.enum([
        "start",
        "agree-support",
        "share-gp",
        "collect-prescription",
        "complete-visit",
        "check-readiness",
      ]),
    })
    .strict(),
  z
    .object({
      challenge: z.literal("digital"),
      action: z.enum(["start", "permit", "revoke", "read"]),
    })
    .strict(),
  z
    .object({
      challenge: z.literal("prevention"),
      action: z.enum([
        "start",
        "outreach-app",
        "outreach-phone",
        "outreach-letter",
        "book",
        "complete",
      ]),
      person: z.string().optional(),
    })
    .strict()
    .superRefine((input, ctx) => {
      if (["book", "complete"].includes(input.action) !== Boolean(input.person))
        ctx.addIssue({ code: "custom", message: "Only booking and completion require a person" });
    }),
]);
type LabInput = z.infer<typeof inputSchema>;
type LabAction = { label: string; input: LabInput; disabled?: boolean; reason?: string };
type Challenge = {
  id: ChallengeId;
  title: string;
  shift: string;
  summary: string;
  started: boolean;
  steps: { label: string; done: boolean; detail: string }[];
  metrics: { label: string; value: string | number }[];
  actions: LabAction[];
  links: { label: string; href: string }[];
  events: { time: number; detail: string }[];
};
export type PlanLabSnapshot = { now: number; challenges: Challenge[] };
const choiceSchema = z.enum(["not-recorded", "permitted", "revoked"]);
const channelSchema = z.enum(["app", "phone", "letter"]);
const cohortSchema = z.array(
  z.object({ id: z.string(), name: z.string(), preference: channelSchema }),
);
const definitions = {
  discharge: {
    title: "A handover that reaches home",
    shift: "Hospital to community",
    summary:
      "Resolve four operational handover barriers using shared records, medicine collection and a home visit. Readiness is an operational checklist, never a clinical discharge decision.",
    links: [
      { label: "Hospital handover", href: "/hospital/" },
      { label: "Community visits", href: "/community/" },
      { label: "Pharmacy supply", href: "/pharmacy/" },
    ],
  },
  digital: {
    title: "Share a record, then withdraw access",
    shift: "Analogue to digital",
    summary:
      "Record a simulated sharing choice for one document and one nominated community service. Try the read before and after withdrawal. This authored choice is not a legal consent model.",
    links: [
      { label: "Primary care record", href: "/gp/" },
      { label: "Community record access", href: "/community/" },
    ],
  },
  prevention: {
    title: "Reach people beyond the app",
    shift: "Sickness to prevention",
    summary:
      "Offer a fictional prevention review to three people through their preferred channels. Two places are available in this round. Booking and attendance are process measures, not predicted health outcomes.",
    links: [
      { label: "Practice appointments", href: "/gp/" },
      { label: "Community outreach", href: "/community/" },
    ],
  },
};
const tagged = (world: World, id: ChallengeId, role: string) =>
  world.resources.find(
    (resource) => resource.data.planLab === id && resource.data.labRole === role,
  );
function required(world: World, id: ChallengeId, role: string) {
  const resource = tagged(world, id, role);
  if (!resource) throw new SimError("Start this challenge first", 409);
  return resource;
}
function change(resource: Resource, status: string) {
  if (resource.status !== status) {
    resource.status = status;
    resource.version++;
  }
}
function add(
  engine: Engine,
  world: World,
  id: ChallengeId,
  role: string,
  kind: string,
  title: string,
  owner: SiteId,
  patientId?: string,
  data: Record<string, unknown> = {},
) {
  return engine.add(world, kind, title, owner, patientId, { ...data, planLab: id, labRole: role });
}
function audit(engine: Engine, world: World, id: ChallengeId, detail: string, resource: Resource) {
  engine.event(world, "plan-lab." + id, "plan-lab", detail, resource);
}
function start(engine: Engine, world: World, id: ChallengeId) {
  if (tagged(world, id, "state")) return;
  const state = add(engine, world, id, "state", "challenge", definitions[id].title, "control");
  state.status = "in-progress";
  if (id === "discharge") {
    const patient = world.patients[0];
    if (!patient) throw new SimError("Challenge patient missing", 404);
    const document = add(
      engine,
      world,
      id,
      "document",
      "document",
      "Plan lab: fictional discharge handover",
      "hospital",
      patient.id,
      {
        text: "Synthetic handover. Confirm agreed support, medicine collection and a completed home visit. No clinical recommendation.",
      },
    );
    document.status = "available";
    add(
      engine,
      world,
      id,
      "support",
      "task",
      "Plan lab: agree home support",
      "community",
      patient.id,
    );
    const prescription = add(
      engine,
      world,
      id,
      "prescription",
      "prescription",
      "Plan lab: fictional handover medicine pack",
      "pharmacy",
      patient.id,
      { stock: 1, drug: "SYNTHETIC-HANDOVER-PACK", note: "No dosing or prescribing guidance." },
    );
    prescription.status = "dispensed";
    prescription.visibleTo = ["pharmacy", "hospital"];
    const visit = add(
      engine,
      world,
      id,
      "visit",
      "visit",
      "Plan lab: confirm home handover",
      "community",
      patient.id,
    );
    visit.status = "awaiting-support";
  } else if (id === "digital") {
    const patient = world.patients[1];
    if (!patient) throw new SimError("Challenge patient missing", 404);
    state.data.choice = "not-recorded";
    const document = add(
      engine,
      world,
      id,
      "document",
      "document",
      "Plan lab: nominated-service sharing exercise",
      "gp",
      patient.id,
      {
        text: "Fictional access exercise. Preferred contact window is after 16:00. All details are authored for this simulation.",
        nominatedService: "community",
      },
    );
    document.status = "available";
  } else {
    const positions = [2, 5, 7];
    const preferences = channelSchema.array().parse(["app", "phone", "letter"]);
    const cohort = positions.map((position, index) => {
      const patient = world.patients[position],
        preference = preferences[index];
      if (!patient || !preference) throw new SimError("Challenge cohort missing", 404);
      return { id: patient.id, name: patient.name, preference };
    });
    state.data.cohort = cohort;
    for (const person of cohort) {
      const task = add(
        engine,
        world,
        id,
        "outreach-" + person.id,
        "task",
        `Plan lab: prevention invitation for ${person.name}`,
        "community",
        person.id,
        { preference: person.preference, attemptedChannels: [] },
      );
      task.status = "not-reached";
      task.visibleTo = ["community", "gp"];
    }
  }
  audit(engine, world, id, "Challenge started with authored synthetic records", state);
}
function dischargeReady(world: World) {
  return (
    required(world, "discharge", "support").status === "agreed" &&
    required(world, "discharge", "document").visibleTo.includes("gp") &&
    required(world, "discharge", "prescription").status === "collected" &&
    required(world, "discharge", "visit").status === "completed"
  );
}
function cohort(world: World) {
  return cohortSchema.parse(required(world, "prevention", "state").data.cohort);
}
function bookedPlaces(world: World) {
  return world.resources.filter(
    (resource) => resource.data.planLab === "prevention" && resource.kind === "appointment",
  ).length;
}
function action(label: string, input: LabInput, blocked = false, reason?: string): LabAction {
  return { label, input, ...(blocked ? { disabled: true, reason } : {}) };
}
function snapshot(engine: Engine, world: World, id: ChallengeId): Challenge {
  const state = tagged(world, id, "state");
  const base: Challenge = {
    id,
    ...definitions[id],
    started: Boolean(state),
    steps: [],
    metrics: [],
    actions: [],
    events: engine
      .events(world.id, "control", 500)
      .filter((event) => event.type === "plan-lab." + id)
      .slice(0, 12)
      .map((event) => ({ time: event.time, detail: event.detail })),
  };
  if (!state) {
    base.actions = [action("Start challenge", { challenge: id, action: "start" })];
    return base;
  }
  const patientId =
    id === "prevention" ? cohort(world)[0]?.id : required(world, id, "document").patientId;
  if (patientId)
    base.links = base.links.map((link) => ({
      ...link,
      href: link.href + "?patient=" + encodeURIComponent(patientId),
    }));
  if (id === "discharge") {
    const support = required(world, id, "support"),
      document = required(world, id, "document"),
      prescription = required(world, id, "prescription"),
      visit = required(world, id, "visit"),
      ready = dischargeReady(world);
    base.steps = [
      { label: "Agree home support", done: support.status === "agreed", detail: support.status },
      {
        label: "Share the handover with the GP",
        done: document.visibleTo.includes("gp"),
        detail: document.visibleTo.includes("gp")
          ? "Visible in the practice record"
          : "Still held by hospital",
      },
      {
        label: "Collect the medicine pack",
        done: prescription.status === "collected",
        detail: prescription.status,
      },
      {
        label: "Complete the home visit",
        done: visit.status === "completed",
        detail:
          visit.status === "awaiting-support"
            ? "Agree support to reserve a visit. It completes after 90 simulation minutes."
            : visit.status,
      },
    ];
    base.metrics = [
      { label: "Barriers resolved", value: base.steps.filter((step) => step.done).length + " / 4" },
      {
        label: "Operational handover",
        value:
          state.status === "ready"
            ? "Checklist confirmed"
            : ready
              ? "Ready for checklist review"
              : "Barriers remain",
      },
    ];
    base.actions = [
      action(
        "Agree support",
        { challenge: id, action: "agree-support" },
        support.status === "agreed",
        "Already agreed",
      ),
      action(
        "Share with GP",
        { challenge: id, action: "share-gp" },
        document.visibleTo.includes("gp"),
        "Already shared",
      ),
      action(
        "Confirm collection",
        { challenge: id, action: "collect-prescription" },
        prescription.status === "collected",
        "Already collected",
      ),
      action(
        "Complete home visit",
        { challenge: id, action: "complete-visit" },
        support.status !== "agreed" || visit.status === "completed",
        visit.status === "completed" ? "Already completed" : "Agree home support first",
      ),
      {
        ...action(
          "Review operational readiness",
          { challenge: id, action: "check-readiness" },
          state.status === "ready",
        ),
        ...(!ready
          ? { reason: "Try the checklist to see which operational barriers still block it." }
          : state.status === "ready"
            ? { reason: "Checklist already confirmed" }
            : {}),
      },
    ];
  } else if (id === "digital") {
    const choice = choiceSchema.parse(state.data.choice),
      document = required(world, id, "document");
    const allowed = choice === "permitted" && document.visibleTo.includes("community");
    const reads =
      engine.state.events[world.id]?.filter(
        (event) => event.type === "plan-lab.digital" && event.detail.startsWith("Community read"),
      ) ?? [];
    base.steps = [
      {
        label: "Record a simulated sharing choice",
        done: choice !== "not-recorded",
        detail: choice,
      },
      {
        label: "Nominated community service can read",
        done: allowed,
        detail: allowed ? "This document is visible to community" : "Community access is blocked",
      },
      {
        label: "Withdraw access",
        done: choice === "revoked",
        detail:
          choice === "revoked"
            ? "Removed from community resource views"
            : "Withdrawal can be tried after permission",
      },
    ];
    base.metrics = [
      {
        label: "Allowed read attempts",
        value: reads.filter((event) => event.detail.startsWith("Community read allowed")).length,
      },
      {
        label: "Blocked read attempts",
        value: reads.filter((event) => event.detail.startsWith("Community read denied")).length,
      },
    ];
    base.actions = [
      action(
        "Permit community access",
        { challenge: id, action: "permit" },
        allowed,
        "Already permitted",
      ),
      action(
        "Withdraw permission",
        { challenge: id, action: "revoke" },
        choice !== "permitted",
        "Permit access first",
      ),
      action("Try community read", { challenge: id, action: "read" }),
    ];
  } else {
    const people = cohort(world),
      places = bookedPlaces(world);
    base.steps = people.map((person) => {
      const task = required(world, id, "outreach-" + person.id),
        appointment = tagged(world, id, "appointment-" + person.id);
      return {
        label: person.name,
        done: appointment?.status === "completed",
        detail: `Prefers ${person.preference}. ${appointment?.status ?? task.status}.`,
      };
    });
    base.metrics = [
      {
        label: "People reached",
        value:
          people.filter(
            (person) => required(world, id, "outreach-" + person.id).status !== "not-reached",
          ).length + " / 3",
      },
      { label: "Places remaining this round", value: 2 - places },
      {
        label: "Reviews completed",
        value: people.filter(
          (person) => tagged(world, id, "appointment-" + person.id)?.status === "completed",
        ).length,
      },
    ];
    base.actions = [
      action("Send app invitations", { challenge: id, action: "outreach-app" }),
      action("Call people who prefer phone", { challenge: id, action: "outreach-phone" }),
      action("Write to people who prefer letters", { challenge: id, action: "outreach-letter" }),
    ];
    for (const person of people) {
      const task = required(world, id, "outreach-" + person.id),
        appointment = tagged(world, id, "appointment-" + person.id);
      base.actions.push(
        action(
          "Book " + person.name,
          { challenge: id, action: "book", person: person.id },
          Boolean(appointment) || task.status === "not-reached" || places >= 2,
          appointment
            ? "Already booked"
            : task.status === "not-reached"
              ? "Reach this person through their preferred channel first"
              : "Both places in this round are taken",
        ),
      );
      if (appointment)
        base.actions.push(
          action(
            "Complete review for " + person.name,
            { challenge: id, action: "complete", person: person.id },
            appointment.status === "completed",
            "Already completed",
          ),
        );
    }
  }
  return base;
}
export function getPlanLab(engine: Engine, worldId: string): PlanLabSnapshot {
  const world = engine.require(worldId);
  return {
    now: world.now,
    challenges: challengeId.options.map((id) => snapshot(engine, world, id)),
  };
}
export function runPlanLab(engine: Engine, worldId: string, input: unknown): PlanLabSnapshot {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    throw new SimError(parsed.error.issues.map((issue) => issue.message).join("; "), 400);
  const command = parsed.data;
  engine.transaction(worldId, (world) => {
    if (command.action === "start") {
      start(engine, world, command.challenge);
      return;
    }
    const state = required(world, command.challenge, "state");
    if (command.challenge === "discharge") {
      if (command.action === "agree-support") {
        const support = required(world, command.challenge, "support");
        if (support.status === "agreed") return;
        const visit = required(world, command.challenge, "visit");
        if (visit.status === "awaiting-support") {
          const capacity = world.resources.find((resource) => resource.id === "capacity-community");
          if (!capacity || Number(capacity.data.remaining) <= 0)
            throw new SimError("No community visit capacity", 409);
          capacity.data.remaining = Number(capacity.data.remaining) - 1;
          capacity.version++;
          change(visit, "scheduled");
          world.scheduled.push({ at: world.now + 90 * 60000, type: "visit", resourceId: visit.id });
        }
        change(support, "agreed");
      } else if (command.action === "share-gp") {
        const document = required(world, command.challenge, "document");
        if (document.visibleTo.includes("gp")) return;
        document.visibleTo.push("gp");
        document.version++;
      } else if (command.action === "collect-prescription") {
        const prescription = required(world, command.challenge, "prescription");
        if (prescription.status === "collected") return;
        if (prescription.status !== "dispensed")
          throw new SimError("Medicine pack must be dispensed first", 409);
        change(prescription, "collected");
      } else if (command.action === "complete-visit") {
        if (required(world, command.challenge, "support").status !== "agreed")
          throw new SimError("Agree home support before completing the visit", 409);
        const visit = required(world, command.challenge, "visit");
        if (visit.status === "completed") return;
        engine.action(worldId, "community", { type: "complete", resourceId: visit.id }, "plan-lab");
      } else if (command.action === "check-readiness") {
        if (!dischargeReady(world))
          throw new SimError("Resolve all four operational barriers first", 409);
        if (state.status === "ready") return;
        change(state, "ready");
      }
      audit(
        engine,
        world,
        command.challenge,
        {
          "agree-support": "Home support agreed",
          "share-gp": "Handover shared with the GP",
          "collect-prescription": "Fictional medicine pack collected",
          "complete-visit": "Home handover visit completed",
          "check-readiness":
            "Operational checklist confirmed. This is not clinical discharge advice.",
        }[command.action],
        state,
      );
    } else if (command.challenge === "digital") {
      const document = required(world, command.challenge, "document"),
        choice = choiceSchema.parse(state.data.choice);
      if (command.action === "permit") {
        if (choice === "permitted" && document.visibleTo.includes("community")) return;
        state.data.choice = "permitted";
        document.visibleTo = ["gp", "community"];
        document.version++;
        state.version++;
        audit(
          engine,
          world,
          command.challenge,
          "Simulated sharing choice recorded: permit nominated community service",
          state,
        );
      } else if (command.action === "revoke") {
        if (choice === "revoked") return;
        if (choice !== "permitted")
          throw new SimError("Record permission before withdrawing it", 409);
        state.data.choice = "revoked";
        document.visibleTo = ["gp"];
        document.version++;
        state.version++;
        audit(
          engine,
          world,
          command.challenge,
          "Simulated sharing choice withdrawn; community visibility removed",
          state,
        );
      } else {
        const allowed =
          choice === "permitted" &&
          engine
            .view(worldId, "community")
            .resources.some((resource) => resource.id === document.id);
        audit(
          engine,
          world,
          command.challenge,
          allowed
            ? "Community read allowed: nominated service viewed the fictional document"
            : "Community read denied: no document content returned",
          state,
        );
      }
    } else {
      const people = cohort(world);
      if (command.action.startsWith("outreach-")) {
        const channel = channelSchema.parse(command.action.slice("outreach-".length));
        let reached = 0,
          changed = false;
        for (const person of people) {
          const task = required(world, command.challenge, "outreach-" + person.id),
            attempts = channelSchema.array().parse(task.data.attemptedChannels);
          if (attempts.includes(channel)) continue;
          task.data.attemptedChannels = [...attempts, channel];
          task.version++;
          changed = true;
          if (person.preference === channel && task.status === "not-reached") {
            change(task, "offered");
            reached++;
          }
        }
        if (changed)
          audit(
            engine,
            world,
            command.challenge,
            `${channel} outreach reached ${reached} additional people; other channel preferences remain unchanged`,
            state,
          );
      } else {
        const person = people.find((person) => person.id === command.person);
        if (!person) throw new SimError("Unknown challenge participant", 404);
        const task = required(world, command.challenge, "outreach-" + person.id),
          appointment = tagged(world, command.challenge, "appointment-" + person.id);
        if (command.action === "book") {
          if (appointment) return;
          if (task.status === "not-reached")
            throw new SimError("Reach this person through their preferred channel first", 409);
          if (bookedPlaces(world) >= 2)
            throw new SimError("Both prevention review places are taken for this round", 409);
          const booking = engine.action(
            worldId,
            "gp",
            {
              type: "book_appointment",
              target: "gp",
              patientId: person.id,
              title: "Plan lab: fictional prevention review for " + person.name,
            },
            "plan-lab",
          );
          booking.data = {
            ...booking.data,
            planLab: command.challenge,
            labRole: "appointment-" + person.id,
            round: "authored-two-place-round",
          };
          booking.status = "scheduled";
          booking.visibleTo = ["gp", "community"];
          change(task, "booked");
          audit(
            engine,
            world,
            command.challenge,
            "Prevention review booked for " + person.name,
            booking,
          );
        } else {
          if (!appointment) throw new SimError("Book this person before completing a review", 409);
          if (appointment.status === "completed") return;
          engine.action(
            worldId,
            "gp",
            { type: "complete", resourceId: appointment.id },
            "plan-lab",
          );
          change(task, "completed");
          audit(
            engine,
            world,
            command.challenge,
            "Prevention review completed for " + person.name + "; no health outcome is inferred",
            appointment,
          );
        }
      }
    }
  });
  return getPlanLab(engine, worldId);
}
