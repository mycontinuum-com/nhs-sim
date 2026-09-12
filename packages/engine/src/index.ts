import { seedGenomeRecords } from "./genomics.ts";
import { bloodTestOrderSchema } from "../../contracts/src/clinical-orders.ts";
import { hospitalNoteSchema } from "../../contracts/src/clinical-notes.ts";
import { seedBloodResults, orderedBloodResult } from "./blood-results.ts";
import { applyMessaging } from "./messaging.ts";
import { seedMessaging } from "./messaging-seed.ts";
import { documentSnomedConcepts } from "../../contracts/src/document-terminology.ts";
import { seedAppointmentSessions } from "./appointment-sessions.ts";
import { appointmentSessionSchema, occupiesAppointmentSlot } from "../../contracts/src/appointments.ts";
import { seedDocuments } from "./document-seed.ts";
import { dischargeDocumentSchema } from "../../contracts/src/documents.ts";
import { seedPharmacy } from "./pharmacy-seed.ts";
import { pharmacyProductSchema, pharmacyReferralSchema, supplierQuoteSchema, purchaseOrderSchema, pharmacyBasketSchema } from "../../contracts/src/pharmacy.ts";
import { seedHospitalAttendances } from "./hospital-seed.ts";
import { hospitalAttendanceSchema } from "../../contracts/src/hospital.ts";
import { produce, current, isDraft, original, setAutoFreeze } from "immer";
setAutoFreeze(false);
import {
  actionSchema,
  type Action,
  type Resource,
  type RecordActor,
  type RecordChange,
  type SimEvent,
  type SiteId,
  type World,
} from "../../contracts/src/index.ts";
import { patientAllergies } from "../../contracts/src/allergies.ts";
import { patientProblems } from "../../contracts/src/problems.ts";
import { populateHistories } from "./population.ts";

function resourceSnapshot(w: World) {
  return isDraft(w.resources) ? current(w.resources) : w.resources;
}

export class SimError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
const START = Date.parse("2026-09-12T08:00:00Z");
const minute = 60_000;
export function seedWorld(id = "default", seed = 42, population = 500): World {
  const names = [
    "Amira Khan",
    "George Evans",
    "Aisha Patel",
    "Thomas Reed",
    "Grace Okafor",
    "Eleanor Chen",
    "Mohammed Ali",
    "Sofia Williams",
  ];
  const w: World = {
    id,
    seed,
    rng: seed >>> 0,
    now: START,
    speed: 60,
    paused: true,
    nextId: 1,
    patients: [],
    resources: [],
    scheduled: [],
    agents: [
      { id: "patient-demand", enabled: true },
      { id: "laboratory", enabled: true },
      { id: "home-monitor", enabled: true },
      { id: "logistics", enabled: true },
      { id: "service-demand", enabled: true },
    ],
    counters: { actions: 0, completed: 0, rejected: 0, reviewMinutes: 0 },
    faults: {},
  };
  for (let i = 0; i < population; i++)
    w.patients.push({
      id: "SIM-" + String(i + 1).padStart(6, "0"),
      name: i < 8 ? names[i] : names[i % 8] + " " + (i + 1),
      birthDate:
        (i < 8 ? [1952, 1984, 1992, 2004, 1991, 1943, 1968, 1978][i] : 1940 + (i % 65)) + "-05-12",
      localIds: { gp: "RIV-" + i, hospital: "NBG-" + (10000 + i), legacy: "WH-" + (90000 + i) },
      conditions: [
        ["Heart failure", "CKD"],
        ["Referral follow-up"],
        ["Asthma"],
        ["Possible inherited disorder"],
        ["Diabetes"],
        ["Frailty"],
        ["Awaiting elective surgery"],
        ["Prevention review"],
      ][i % 8],
      needs: [
        ["Home visit", "Carer involvement"],
        ["Transport"],
        ["Shift work", "SMS preferred"],
        ["Interpreter"],
        ["Device setup"],
        ["Step-free access"],
        ["Transport"],
        ["Offline contact"],
      ][i % 8],
      goals: ["Understand the next step", "Avoid unnecessary travel"],
      synthetic: true,
    });
  const add = (
    kind: string,
    title: string,
    owner: SiteId,
    status: string,
    patient: number,
    data: Record<string, unknown> = {},
    visibleTo: SiteId[] = [owner],
  ) => {
    w.resources.push({
      id: "r-" + w.nextId++,
      patientId: w.patients[patient].id,
      kind,
      title,
      owner,
      status,
      visibleTo,
      priority: patient === 0 ? "urgent" : "routine",
      createdAt: START,
      dueAt: START + 24 * 60 * minute,
      data,
      version: 1,
    });
  };
  add(
    "document",
    "Discharge: monitoring required; medication list changed",
    "hospital",
    "available",
    0,
    {
      text: "Fictional case. Blood monitoring requested; home equipment and medication handover not confirmed.",
    },
  );
  add("task", "Arrange post-discharge monitoring", "gp", "open", 0);
  add(
    "prescription",
    "Discharge medication supply",
    "pharmacy",
    "approved",
    0,
    { stock: 3, drug: "Furosemide tablets", note: "Simulation only; no dosing guidance." },
    ["pharmacy", "hospital", "patient"],
  );
  add(
    "referral",
    "Referral blocked: imaging attachment missing",
    "referrals",
    "rejected",
    1,
    { reason: "Missing imaging report" },
    ["referrals", "hospital"],
  );
  add("request", "Fourth contact: what happened to my referral?", "triage", "open", 1, {}, [
    "triage",
    "gp",
    "messaging",
    "patient",
  ]);
  add(
    "message",
    "Respiratory: review worsening oxygen requirement",
    "messaging",
    "open",
    0,
    { channel: "respiratory", participants: 21, linkedRecord: true },
    ["messaging", "hospital", "gp"],
  );
  add(
    "message",
    "Discharge & flow: confirm medication handover",
    "messaging",
    "open",
    0,
    { channel: "discharge-and-flow", participants: 14, linkedRecord: true },
    ["messaging", "hospital", "pharmacy", "community"],
  );
  add(
    "message",
    "Referral Exchange: imaging attachment located",
    "messaging",
    "reviewed",
    1,
    { channel: "radiology", participants: 9, linkedRecord: true },
    ["messaging", "diagnostics", "referrals", "gp"],
  );
  add("report", "Imaging report available in document silo", "diagnostics", "available", 1, {
    text: "Synthetic imaging report: attach to referral for review.",
  });
  add("request", "Appointment links expire during working shift", "triage", "open", 2, {}, [
    "triage",
    "gp",
    "patient",
  ]);
  add(
    "genomics",
    "Uncertain synthetic variant; specialist review needed",
    "population",
    "open",
    3,
    {
      classification: "uncertain",
      familyHistory: "Composite fictional history",
      consent: "research not granted",
    },
  );
  add("device", "Glucose monitor", "wearables", "active", 4, { battery: 88, quality: "good" }, [
    "wearables",
    "patient",
  ]);
  add(
    "observation",
    "Activity trend below personal baseline",
    "wearables",
    "available",
    5,
    {
      metric: "steps",
      value: 1800,
      baseline: 4200,
      unit: "steps/day",
      quality: "good",
      observedAt: START,
    },
    ["wearables", "community", "patient"],
  );
  add(
    "device",
    "Home activity watch",
    "wearables",
    "active",
    5,
    { battery: 76, quality: "good", lastSyncedAt: START, metric: "steps" },
    ["wearables", "community", "patient"],
  );
  const homeHistory = [
    {
      metric: "steps",
      title: "Daily activity",
      unit: "steps/day",
      values: [4350, 4100, 4650, 3900, 3500, 2800, 2400],
    },
    {
      metric: "heart-rate",
      title: "Resting heart rate",
      unit: "bpm",
      values: [68, 67, 69, 68, 70, 69, 68],
    },
    {
      metric: "sleep",
      title: "Sleep duration",
      unit: "h",
      values: [7.2, 7.5, 6.8, 7.1, 7.4, 6.9, 7.3],
    },
  ];
  for (const series of homeHistory) {
    series.values.forEach((value, index) => {
      const observedAt = START - (7 - index) * 24 * 60 * minute;
      add(
        "observation",
        series.title,
        "wearables",
        "available",
        5,
        { metric: series.metric, value, unit: series.unit, quality: "good", observedAt },
        ["wearables", "community", "patient"],
      );
      const observation = w.resources.at(-1);
      if (observation) observation.createdAt = observedAt;
    });
  }
  add(
    "care-plan",
    "Home support not yet arranged",
    "community",
    "open",
    5,
    { carerAvailable: false, homeAccessConfirmed: false },
    ["community", "patient"],
  );
  add("surgery", "Elective list: robot and recovery bed required", "hospital", "waiting", 6, {
    robotRequired: true,
    bedRequired: true,
  });
  add(
    "screening",
    "Screening invitation unanswered",
    "population",
    "open",
    7,
    { channel: "app", delivered: true, completed: false },
    ["population", "gp", "patient"],
  );
  add("document", "Legacy outpatient letter, awaiting GP handover", "legacy", "available", 1, {
    text: "Browser-only synthetic outpatient document.",
  });
  add(
    "disposition",
    "Urgent-care disposition awaiting booked service",
    "urgent",
    "open",
    2,
    { acuity: "urgent", recommendation: "same-day assessment", serviceFound: false },
    ["urgent", "patient"],
  );
  add(
    "mental-health-plan",
    "Crisis plan review due",
    "mental",
    "open",
    2,
    { coordinator: "Simulated CMHT", safetyPlanPresent: true, lastContactDays: 21 },
    ["mental", "gp", "patient"],
  );
  add(
    "maternity-episode",
    "Antenatal appointment and screening choices",
    "maternity",
    "open",
    4,
    { gestationWeeks: 24, namedMidwife: "M. Example", preferencesRecorded: false },
    ["maternity", "patient"],
  );
  add(
    "dental-recall",
    "NHS dental recall overdue",
    "dental",
    "open",
    7,
    { recallMonths: 18, childProgramme: false, accessBarrier: "appointment availability" },
    ["dental", "patient", "population"],
  );
  add(
    "care-package",
    "Home care assessment awaiting allocation",
    "social",
    "waiting",
    5,
    { visitsPerDay: 2, keySafe: false, fundingDecision: "pending" },
    ["social", "community", "beds", "patient"],
  );
  add(
    "genomic-test",
    "Rare-disease panel: consent and phenotype review",
    "genomics",
    "reviewed",
    3,
    { consent: "clinical-only", result: "uncertain", familyContactAllowed: false },
    ["genomics", "hospital", "patient", "research"],
  );
  add(
    "theatre-slot",
    "Robotic theatre list: two cases exceed staffed capacity",
    "theatre",
    "waiting",
    6,
    { room: "OR-3", robot: "RX-1", plannedCases: 6, staffedCases: 4, recoveryBeds: 2 },
    ["theatre", "hospital", "robotics", "beds"],
  );
  add(
    "bed",
    "Acute medical bed 12",
    "beds",
    "occupied",
    0,
    { ward: "AMU", barrier: "medicines and home monitoring", expectedDischarge: "today" },
    ["beds", "hospital", "community", "pharmacy"],
  );
  add(
    "provider-metric",
    "Northbank urgent-care performance",
    "icb",
    "available",
    2,
    { waitHours: 5.2, patientExperience: 68, outcomeIndex: 0.91, budgetUsedPercent: 72 },
    ["icb", "nhsapp"],
  );
  add(
    "trial-candidate",
    "Potential synthetic prevention-study match",
    "research",
    "reviewed",
    7,
    { consentToContact: false, eligibility: "possible", exclusionsChecked: false },
    ["research", "population"],
  );
  add(
    "choice",
    "Choose preferred diagnostic provider",
    "nhsapp",
    "open",
    2,
    {
      options: ["Northbank CDC · 9 days", "Riverside Hub · 15 days"],
      accessibility: "evening slot",
    },
    ["nhsapp", "patient", "referrals"],
  );
  for (const [owner, count] of [
    ["gp", 6],
    ["hospital", 2],
    ["community", 4],
    ["diagnostics", 4],
    ["urgent", 3],
    ["mental", 3],
    ["maternity", 4],
    ["dental", 2],
    ["social", 3],
    ["genomics", 2],
    ["theatre", 4],
    ["beds", 2],
  ] as [SiteId, number][])
    w.resources.push({
      id: "capacity-" + owner,
      kind: "capacity",
      title: owner + " available slots",
      owner,
      visibleTo: [...new Set<SiteId>([owner, "referrals", owner === "beds" ? "hospital" : owner])],
      status: "available",
      priority: "routine",
      createdAt: START,
      version: 1,
      data: { remaining: count, total: count },
    });
  w.resources.push({
    id: "robot-1",
    kind: "robot",
    title: "Courier robot 01",
    owner: "robotics",
    visibleTo: ["robotics", "pharmacy"],
    status: "available",
    priority: "routine",
    createdAt: START,
    version: 1,
    data: { battery: 100, location: "Pharmacy" },
  });
  for (let i = 0; i < 8; i++)
    w.resources.push({
      id: "staff-" + i,
      kind: "staff",
      title: ["Dr Ada Sim", "Nurse Ben Byte", "Dr Cora Test", "Nurse Dan Demo"][i % 4] + " " + i,
      owner: "hr",
      visibleTo: ["hr", "roster", "hospital"],
      status: "available",
      priority: "routine",
      createdAt: START,
      version: 1,
      data: { role: i % 2 ? "nurse" : "doctor", department: "A&E", shift: "day", allocated: true },
    });
  add(
    "handover",
    "Ambulance handover awaiting staffed space",
    "ambulance",
    "waiting",
    6,
    { minutesWaiting: 35 },
    ["ambulance", "hospital"],
  );
  add("encounter", "A&E assessment waiting list", "hospital", "waiting", 2, {
    requires: "doctor and nurse",
  });
  w.agents.push({ id: "acute-flow", enabled: true });
  w.agents.push({ id: "bed-flow", enabled: true }, { id: "prevention-recall", enabled: true });
  w.scheduled.push(
    { at: START + 15 * minute, type: "arrival" },
    { at: START + 10 * minute, type: "observation", patientId: w.patients[5].id },
    { at: START + 20 * minute, type: "acute" },
    { at: START + 60 * minute, type: "bed-pressure" },
    { at: START + 30 * minute, type: "service-demand" },
    { at: START + 24 * 60 * minute, type: "screening" },
  );
  seedHospitalAttendances(w);
  seedPharmacy(w);
  seedDocuments(w);
  seedMessaging(w);
  seedAppointmentSessions(w);
  populateHistories(w);
  seedBloodResults(w);
  seedGenomeRecords(w);
  for (const record of w.resources) {
    const created: RecordChange = {
      actor: { kind: "simulation", name: "Synthetic seed" },
      source: record.owner, action: "seed", time: record.createdAt, version: record.version,
    };
    record.provenance ??= { created, changes: [] };
  }
  return w;
}
type StaffingSummary = { doctors: number; nurses: number; staffedSpaces: number; waiting: number };

export class Engine {
  private staffingReads = new WeakMap<Resource[], StaffingSummary>();
  state: {
    worlds: Record<string, World>;
    events: Record<string, SimEvent[]>;
    receipts: Record<string, { fingerprint: string; result: Resource }>;
  } = { worlds: {}, events: {}, receipts: {} };
  constructor() {
    this.create("default");
  }
  get(id: string): World | undefined {
    return this.state.worlds[id];
  }
  require(id: string): World {
    const w = this.get(id);
    if (!w) throw new SimError("Unknown world", 404);
    return w;
  }
  create(id: string, seed = 42, population = 500) {
    if (
      !/^[a-z0-9-]{1,40}$/.test(id) ||
      population < 8 ||
      population > 50000 ||
      !Number.isInteger(population)
    )
      throw new SimError("Invalid world or population (8–50000)");
    if (this.get(id)) throw new SimError("World already exists", 409);
    const w = seedWorld(id, seed, population);
    this.save(w);
    return w;
  }
  save(w: World) {
    this.state = { ...this.state, worlds: { ...this.state.worlds, [w.id]: w } };
  }
  worlds(): string[] {
    return Object.keys(this.state.worlds);
  }
  transaction<T>(id: string, fn: (w: World) => T): T {
    if (isDraft(this.state)) return fn(this.require(id));
    const before = this.state;
    let result: T;
    try {
      const next = produce(before, (draft) => {
        this.state = draft;
        const value = fn(this.require(id));
        result =
          value !== null && typeof value === "object" && isDraft(value) ? current(value) : value;
      });
      this.state = next;
      return result!;
    } catch (error) {
      this.state = before;
      throw error;
    }
  }
  event(w: World, type: string, actor: string, detail: string, r?: Resource, automatic = true) {
    if (r && automatic) {
      const change: RecordChange = {
        actor: { kind: "simulation", name: actor }, source: r.owner,
        action: type, time: w.now, version: r.version,
      };
      r.provenance ??= { created: null, changes: [] };
      r.provenance.changes.push(change);
    }
    const event: SimEvent = {
      id: "e-" + w.nextId++,
      time: w.now,
      type,
      actor,
      detail,
      resourceId: r?.id,
      patientId: r?.patientId,
      visibleTo: r?.visibleTo ?? ["control"],
    };
    (this.state.events[w.id] ??= []).push(event);
  }
  events(id: string, site: SiteId, limit = 100): SimEvent[] {
    return [...(this.state.events[id] ?? [])]
      .reverse()
      .filter((e) => site === "control" || e.visibleTo.includes(site))
      .slice(0, Math.min(limit, 500));
  }
  view(id: string, site: SiteId, patientId?: string, page?: { offset: number; limit: number }) {
    const w = this.require(id);
    const resources = w.resources.filter(
      (r) =>
        (r.kind !== "genome-record" || site === "hospital" || site === "control") &&
        (site === "control" || r.visibleTo.includes(site)) &&
        (!patientId || r.patientId === patientId || !r.patientId),
    );
    return {
      id: w.id,
      now: w.now,
      speed: w.speed,
      paused: w.paused,
      population: w.patients.length,
      counters: w.counters,
      resources: page ? resources.slice(page.offset, page.offset + page.limit) : resources,
      resourceTotal: resources.length,
      resourceOffset: page?.offset ?? 0,
      resourceLimit: page?.limit ?? resources.length,
      agents: site === "control" ? w.agents : undefined,
      faults: w.faults,
      events: this.events(id, site),
    };
  }
  patients(id: string, q = "", offset = 0, limit = 30) {
    const all = this.require(id).patients.filter((p) =>
      (p.id + " " + p.name + " " + p.conditions.join(" ") + " " + p.needs.join(" "))
        .toLowerCase()
        .includes(q.toLowerCase()),
    );
    return { total: all.length, items: all.slice(offset, offset + Math.min(limit, 100)) };
  }
  add(
    w: World,
    kind: string,
    title: string,
    owner: SiteId,
    patientId?: string,
    data: Record<string, unknown> = {},
  ): Resource {
    const r: Resource = {
      id: "r-" + w.nextId++,
      kind,
      title,
      owner,
      visibleTo: [owner],
      patientId,
      status: "open",
      priority: "routine",
      createdAt: w.now,
      dueAt: w.now + 1440 * minute,
      data,
      version: 1,
    };
    r.provenance = {
      created: { actor: { kind: "simulation", name: "Simulator" }, source: owner,
        action: "create_record", time: w.now, version: 1 },
      changes: [],
    };
    w.resources.push(r);
    return r;
  }
  action(id: string, site: SiteId, input: unknown, identity: string | RecordActor, key?: string) {
    const attribution: RecordActor = typeof identity === "string"
      ? { kind: "team", name: identity } : identity;
    const actor = attribution.name;
    const a = actionSchema.parse(input);
    key ??= a.clientRequestId;
    return this.transaction(id, (w) => {
      const fingerprint = JSON.stringify({ site, actor: attribution, a });
      if (key) {
        const receipt = this.state.receipts[id + ":" + key];
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw new SimError("Idempotency key reused with different action", 409);
          return receipt.result;
        }
      }
      if (a.patientId && !(original(w)?.patients ?? w.patients).some((p) => p.id === a.patientId))
        throw new SimError("Unknown patient", 404);
      if (
        w.faults["cyber-readonly"] &&
        ["hospital", "legacy", "diagnostics", "referrals", "theatre", "beds"].includes(site)
      )
        throw new SimError("Service is in cyber incident read-only mode", 423);
      let r: Resource | undefined;
      if (a.resourceId) {
        const index = (original(w)?.resources ?? w.resources).findIndex(
          (x) => x.id === a.resourceId,
        );
        r = index < 0 ? undefined : w.resources[index];
        if (!r) throw new SimError("Unknown resource", 404);
        if (site !== "control" && !r.visibleTo.includes(site))
          throw new SimError("Record not visible to this service", 403);
        if (a.expectedVersion !== undefined && r.version !== a.expectedVersion)
          throw new SimError("Stale resource version", 409);
      }
      if (r?.kind === "genome-record") throw new SimError("Secondary care genome records are read-only and cannot be shared", 403);
      if (r && ["conversation", "message-template"].includes(r.kind) && a.type !== "messaging_action") throw new SimError("Use the messaging workflow for this record", 409);
      const existingId = r?.id;
      const create: Partial<Record<Action["type"], [string, SiteId]>> = {
        create_task: ["task", a.target ?? site],
        create_referral: ["referral", a.target ?? "hospital"],
        order_test: ["test", "diagnostics"],
        draft_prescription: ["prescription", "pharmacy"],
        book_appointment: ["appointment", a.target ?? "gp"],
        send_message: ["message", "patient"],
        schedule_visit: ["visit", "community"],
        dispatch_robot: ["robot-job", "robotics"],
      };
      if (a.type === "hospital_note") {
        if (site !== "hospital") throw new SimError("Hospital documentation is authored in the hospital", 403);
        const command = a.hospitalNoteCommand;
        if (!command) throw new SimError("A documentation command is required");
        if (r && (r.kind !== "hospital-note" || a.expectedVersion === undefined)) throw new SimError("A versioned hospital note is required", 409);
        if (r && a.patientId && a.patientId !== r.patientId) throw new SimError("A note cannot change patient", 409);
        if (command.kind === "save") {
          if (!a.title?.trim()) throw new SimError("Note title required");
          if (r && hospitalNoteSchema.parse(r.data).stage !== "draft") throw new SimError("Signed notes are immutable. Add an addendum instead", 409);
          if (!r) {
            if (!a.patientId) throw new SimError("Patient required");
            r = this.add(w, "hospital-note", a.title, "hospital", a.patientId);
          } else r.version++;
          r.title = a.title;
          r.status = "draft";
          r.visibleTo = ["hospital"];
          r.data = { stage: "draft", template: command.template, sections: command.sections, text: command.sections.map(section => section.heading + "\n" + section.text).join("\n\n") };
        } else {
          if (!r) throw new SimError("Save a draft before signing");
          const note = hospitalNoteSchema.parse(r.data);
          if (command.kind === "sign") {
            if (note.stage !== "draft") throw new SimError("Note is already signed", 409);
            if (!note.sections.some(section => section.text.trim())) throw new SimError("Enter note content before signing");
            r.data = { ...note, stage: "signed", signedAt: w.now, signedBy: actor, addenda: [] };
            r.status = "signed";
          } else {
            if (note.stage !== "signed") throw new SimError("Sign the note before adding an addendum", 409);
            r.data = { ...note, addenda: [...note.addenda, { text: command.text, time: w.now, author: actor }] };
          }
          r.version++;
        }
      } else if (a.type === "messaging_action") {
        if (!a.messagingCommand) throw new SimError("Messaging command required");
        r = applyMessaging({ world: w, site, command: a.messagingCommand, actor: attribution, resource: r, patientId: a.patientId, expectedVersion: a.expectedVersion, add: (kind, title, patientId) => this.add(w, kind, title, "gp", patientId), fail: (message, status) => { throw new SimError(message, status); } });
      } else if (a.type === "create_appointment_session" || a.type === "set_appointment_slot") {
        if (site !== "gp") throw new SimError("Only GP can manage appointment sessions", 403);
        const resources = original(w)?.resources ?? w.resources;
        if (a.type === "create_appointment_session") {
          const parsed = appointmentSessionSchema.safeParse({ ...a, blockedSlots: [] });
          if (!parsed.success || !a.title || a.resourceId) throw new SimError("A title and valid session properties are required");
          const session = parsed.data;
          if (session.startsAt < w.now) throw new SimError("Session cannot start before simulation time", 409);
          if (resources.some(item => item.kind === "appointment-session" && item.owner === "gp" && String(item.data.clinician).toLowerCase() === session.clinician.toLowerCase() && Number(item.data.startsAt) < session.endsAt && Number(item.data.endsAt) > session.startsAt)) throw new SimError("Clinician already has an overlapping session", 409);
          r = this.add(w, "appointment-session", a.title, "gp");
          r.data = session;
          r.visibleTo = ["gp"];
        } else {
          if (!r || r.kind !== "appointment-session" || r.owner !== "gp" || a.expectedVersion === undefined || a.startsAt === undefined || !a.slotCommand) throw new SimError("A versioned session and slot are required");
          const session = appointmentSessionSchema.parse(r.data);
          const slotStartsAt = a.startsAt;
          if (a.startsAt < session.startsAt || a.startsAt >= session.endsAt || (a.startsAt - session.startsAt) % (session.slotMinutes * minute)) throw new SimError("Choose a slot in this session", 409);
          if (a.startsAt < w.now) throw new SimError("Past slots cannot be changed", 409);
          if (a.slotCommand === "block") {
            if (!a.text || a.text.length > 500) throw new SimError("A block reason of at most 500 characters is required");
            if (resources.some(item => item.kind === "appointment" && item.owner === "gp" && occupiesAppointmentSlot(item.status) && String(item.data.clinician).toLowerCase() === session.clinician.toLowerCase() && Number(item.data.startsAt) < slotStartsAt + session.slotMinutes * minute && Number(item.data.startsAt) + Number(item.data.durationMinutes) * minute > slotStartsAt)) throw new SimError("A booked slot cannot be blocked", 409);
          }
          session.blockedSlots = session.blockedSlots.filter(slot => slot.startsAt !== a.startsAt);
          if (a.slotCommand === "block" && a.text) session.blockedSlots.push({ startsAt: slotStartsAt, reason: a.text });
          r.data = session;
          r.version++;
        }
      } else if (a.type === "save_discharge_summary" || a.type === "process_document") {
        if (a.type === "save_discharge_summary") {
          if (site !== "hospital") throw new SimError("Hospital authors discharge summaries", 403);
          if (!a.dischargeSections || !a.title) throw new SimError("Title and discharge sections required");
          if (r) {
            if (r.kind !== "discharge-summary" || a.expectedVersion === undefined || dischargeDocumentSchema.parse(r.data).stage !== "draft") throw new SimError("Only a versioned draft can be edited", 409);
            if (a.patientId && a.patientId !== r.patientId) throw new SimError("A document cannot change patient", 409);
            r.version++;
          } else {
            if (!a.patientId) throw new SimError("Patient required");
            r = this.add(w, "discharge-summary", a.title, "hospital", a.patientId);
          }
          r.title = a.title;
          r.status = "draft";
          r.visibleTo = ["hospital"];
          r.data = dischargeDocumentSchema.parse({ stage: "draft", sections: a.dischargeSections, assignee: "" });
        } else {
          if (!r || r.kind !== "discharge-summary" || a.expectedVersion === undefined) throw new SimError("Versioned discharge document required", 409);
          const doc = dischargeDocumentSchema.parse(r.data);
          if (a.documentCommand === "send") {
            if (site !== "hospital") throw new SimError("Only hospital can send this letter", 403);
            if (doc.stage !== "draft") throw new SimError("Letter already sent", 409);
            if (Object.values(doc.sections).some(value => !value.trim())) throw new SimError("Complete every section before sending; explicitly record none or not known where appropriate");
            r.data = { ...doc, stage: "sent", sentAt: w.now, sentBy: actor };
            r.visibleTo = ["hospital", "gp"];
          } else {
            if (site !== "gp") throw new SimError("GP document processing required", 403);
            if (doc.stage === "draft" || (doc.stage === "filed" && a.documentCommand !== "annotate")) throw new SimError("Document is not awaiting processing", 409);
            if (a.documentCommand === "annotate") {
              if (!a.documentTags || !a.documentSnomedCodes) throw new SimError("Tags and SNOMED codes required");
              const codes = a.documentSnomedCodes.map(value => {
                const concept = documentSnomedConcepts.find(item => item.code === value.code);
                if (!concept) throw new SimError("SNOMED code is not in the simulation catalogue");
                return concept;
              });
              r.data = { ...doc, tags: [...new Map(a.documentTags.map(tag => [tag.toLowerCase(), tag])).values()], snomedCodes: [...new Map(codes.map(code => [code.code, code])).values()] };
            } else if (a.documentCommand === "assign") {
              if (!a.clinician) throw new SimError("Assignee required");
              r.data = { ...doc, assignee: a.clinician };
            } else if (a.documentCommand === "review") {
              if (doc.stage !== "sent" || !a.text) throw new SimError("An unreviewed letter and review note are required", 409);
              r.data = { ...doc, stage: "reviewed", reviewedAt: w.now, reviewedBy: actor, reviewNote: a.text };
            } else if (a.documentCommand === "file") {
              if (doc.stage !== "reviewed" || !a.text) throw new SimError("Review the letter and enter a filing outcome first", 409);
              r.data = { ...doc, stage: "filed", filedAt: w.now, filedBy: actor, filingNote: a.text };
            } else throw new SimError("Document command required");
          }
          r.status = String(r.data.stage);
          r.version++;
        }
      } else if (["update_pharmacy_basket", "remove_pharmacy_basket_line", "checkout_pharmacy_basket"].includes(a.type)) {
        if (site !== "pharmacy" && site !== "control") throw new SimError("Pharmacy access required", 403);
        if (!r || r.kind !== "pharmacy-basket" || a.expectedVersion === undefined) throw new SimError("Versioned team basket required", 409);
        const basket = pharmacyBasketSchema.parse(r.data);
        const resources = original(w)?.resources ?? w.resources;
        if (a.type === "update_pharmacy_basket") {
          const offer = resources.find(item => item.id === a.quoteId && item.kind === "pharmacy-quote");
          if (!offer || offer.version !== a.quoteVersion) throw new SimError("Supplier offer changed; compare current prices again", 409);
          const quote = supplierQuoteSchema.parse(offer.data);
          if (!quote.available || !a.quantity || a.quantity < quote.minimumPacks || !a.requiredUnits || a.quantity * quote.packSize < a.requiredUnits) throw new SimError("Available offer, minimum packs and sufficient requested units required", 409);
          r.data = pharmacyBasketSchema.parse({ lines: [...basket.lines.filter(line => line.productId !== quote.productId), { quoteId: offer.id, quoteVersion: offer.version, productId: quote.productId, packs: a.quantity, requiredUnits: a.requiredUnits, quote }] });
        } else if (a.type === "remove_pharmacy_basket_line") {
          if (!a.productId || !basket.lines.some(line => line.productId === a.productId)) throw new SimError("Basket product not found", 404);
          r.data = { lines: basket.lines.filter(line => line.productId !== a.productId) };
        } else {
          if (!basket.lines.length) throw new SimError("Basket is empty", 409);
          for (const line of basket.lines) {
            const offer = resources.find(item => item.id === line.quoteId && item.kind === "pharmacy-quote");
            if (!offer || offer.version !== line.quoteVersion || JSON.stringify(supplierQuoteSchema.parse(offer.data)) !== JSON.stringify(line.quote)) throw new SimError("Supplier offer changed; compare and update your basket before checkout", 409);
            if (!resources.some(item => item.id === line.productId && item.kind === "pharmacy-product")) throw new SimError("Catalogue product unavailable", 409);
          }
          const chargedSuppliers = new Set<string>();
          const batchId = r.id + "-checkout-" + r.version;
          const orderIds = basket.lines.map(line => {
            const deliveryFeePence = chargedSuppliers.has(line.quote.supplier) ? 0 : Math.max(...basket.lines.filter(item => item.quote.supplier === line.quote.supplier).map(item => item.quote.deliveryFeePence));
            chargedSuppliers.add(line.quote.supplier);
            const order = this.add(w, "pharmacy-order", line.quote.supplier + " purchase order", "pharmacy", undefined, { ...line.quote, deliveryFeePence, packs: line.packs, totalPence: line.packs * line.quote.packCostPence + deliveryFeePence, orderedAt: w.now, dueAt: w.now + line.quote.leadDays * 86400000, receivedPacks: 0, cancelledPacks: 0, receivedCostPence: 0, batchId });
            order.status = "ordered";
            order.provenance = { created: { actor: attribution, source: site, action: a.type, time: w.now, version: 1 }, changes: [] };
            return order.id;
          });
          r.data = { lines: [], orderIds };
        }
        r.version++;
      } else if (["place_pharmacy_order", "cancel_pharmacy_order", "receive_pharmacy_order", "receive_pharmacy_referral", "update_pharmacy_referral", "receive_stock", "update_stock_price", "link_prescription_stock"].includes(a.type)) {
        if (site !== "pharmacy" && site !== "control" && !(a.type === "receive_pharmacy_referral" && ["gp", "hospital", "referrals", "patient"].includes(site))) throw new SimError("Pharmacy access required", 403);
        if (a.type === "place_pharmacy_order") {
          if (!r || r.kind !== "pharmacy-quote" || a.expectedVersion === undefined || !a.quantity) throw new SimError("Versioned supplier quote and quantity in packs required");
          const quote = supplierQuoteSchema.parse(r.data);
          if (!quote.available || a.quantity < quote.minimumPacks) throw new SimError("Order does not meet supplier minimum packs", 409);
          r = this.add(w, "pharmacy-order", quote.supplier + " purchase order", "pharmacy", undefined, { ...quote, packs: a.quantity, totalPence: a.quantity * quote.packCostPence + quote.deliveryFeePence, orderedAt: w.now, dueAt: w.now + quote.leadDays * 86400000 });
          r.status = "ordered";
        } else if (a.type === "cancel_pharmacy_order") {
          if (!r || r.kind !== "pharmacy-order" || !["ordered", "part-received"].includes(r.status) || a.expectedVersion === undefined || !a.text) throw new SimError("Outstanding versioned order and cancellation reason required", 409);
          const order = purchaseOrderSchema.parse(r.data);
          r.data = { ...order, cancelledPacks: order.packs - order.receivedPacks, cancellationReason: a.text };
          r.status = "cancelled"; r.version++;
        } else if (a.type === "receive_pharmacy_order") {
          if (!r || r.kind !== "pharmacy-order" || !["ordered", "part-received"].includes(r.status) || a.expectedVersion === undefined) throw new SimError("An outstanding versioned purchase order is required", 409);
          const order = purchaseOrderSchema.parse(r.data);
          if (w.now < order.dueAt) throw new SimError("Delivery is not due yet; advance simulation time", 409);
          const packs = a.quantity ?? order.packs - order.receivedPacks - order.cancelledPacks;
          if (packs > order.packs - order.receivedPacks - order.cancelledPacks) throw new SimError("Receipt exceeds outstanding packs", 409);
          const resources = original(w)?.resources ?? w.resources;
          if (a.text && resources.some(item => item.kind === "pharmacy-movement" && item.data.orderId === r!.id && item.data.reference === a.text)) throw new SimError("Delivery reference already received", 409);
          const index = resources.findIndex(item => item.id === order.productId && item.kind === "pharmacy-product");
          if (index < 0) throw new SimError("Ordered product unavailable", 409);
          const stock = w.resources[index]!;
          const product = pharmacyProductSchema.parse(stock.data);
          const acquisitionPence = packs * order.packCostPence + (order.receivedPacks === 0 ? order.deliveryFeePence : 0);
          stock.data = { ...product, stock: product.stock + packs * order.packSize, stockCostPence: product.stockCostPence + acquisitionPence };
          stock.version++;
          const receipt: RecordChange = { actor: attribution, source: site, action: a.type, time: w.now, version: stock.version };
          stock.provenance ??= { created: null, changes: [] }; stock.provenance.changes.push(receipt);
          const movement = this.add(w, "pharmacy-movement", "Supplier delivery received", "pharmacy", undefined, { productId: stock.id, orderId: r.id, quantity: packs * order.packSize, balance: stock.data.stock, acquisitionPence, reference: a.text ?? r.id + "-receipt-" + r.version });
          movement.provenance = { created: { ...receipt, version: 1 }, changes: [] };
          const receivedPacks = order.receivedPacks + packs;
          r.data = { ...order, receivedPacks, receivedCostPence: order.receivedCostPence + acquisitionPence, receivedAt: w.now }; r.status = receivedPacks === order.packs ? "received" : "part-received"; r.version++;
        } else if (a.type === "receive_pharmacy_referral") {
          if (r || !a.patientId || !a.title || !a.pharmacyPathway || !a.referralSource) throw new SimError("Patient, reason, pathway and referring service are required");
          if (a.pharmacyPathway === "Urgent medicine supply" && a.referralSource === "gp") throw new SimError("Urgent medicine supply is not a GP Pharmacy First referral route");
          r = this.add(w, "pharmacy-referral", a.title, "pharmacy", a.patientId);
          r.data = pharmacyReferralSchema.parse({ pathway: a.pharmacyPathway, source: a.referralSource, receivedAt: w.now, stage: "received" });
          r.status = "received";
          r.visibleTo = [...new Set<SiteId>(["pharmacy", a.referralSource, "patient", "gp"])];
        } else {
          if (!r || a.expectedVersion === undefined) throw new SimError("Versioned pharmacy record required");
          if (a.type === "update_pharmacy_referral") {
            if (r.kind !== "pharmacy-referral") throw new SimError("Pharmacy First referral required");
            const referral = pharmacyReferralSchema.parse(r.data);
            const next = a.pharmacyCommand === "accept" && referral.stage === "received" ? "accepted" : a.pharmacyCommand === "consult" && referral.stage === "accepted" ? "consulting" : a.pharmacyCommand === "complete" && referral.stage === "consulting" ? "completed" : null;
            if (!next) throw new SimError("Invalid referral transition", 409);
            if (next === "completed" && !a.text) throw new SimError("Record the consultation outcome before returning it");
            r.data = { ...referral, stage: next, ...(next === "completed" ? { outcome: a.text, completedAt: w.now } : {}) };
            r.status = next;
          } else if (a.type === "link_prescription_stock") {
            if (r.kind !== "prescription" || ["dispensed", "collected"].includes(r.status)) throw new SimError("Undispensed prescription required", 409);
            const product = (original(w)?.resources ?? w.resources).find(item => item.id === a.productId && item.kind === "pharmacy-product");
            if (!product || !a.quantity) throw new SimError("Choose a catalogue item and quantity in units");
            r.data = { ...r.data, productId: product.id, quantity: a.quantity, supplyDrug: pharmacyProductSchema.parse(product.data).drug };
          } else {
            if (r.kind !== "pharmacy-product") throw new SimError("Stock catalogue item required");
            const product = pharmacyProductSchema.parse(r.data);
            if (a.type === "receive_stock") {
              if (!a.quantity || !a.text) throw new SimError("Quantity and delivery reference required");
              if ((original(w)?.resources ?? w.resources).some(item => item.kind === "pharmacy-movement" && item.data.productId === r!.id && item.data.reference === a.text && Number(item.data.quantity) > 0)) throw new SimError("Delivery reference already received for this product", 409);
              r.data = { ...product, stock: product.stock + a.quantity, stockCostPence: product.stockCostPence + a.quantity / product.packSize * product.costPence };
            } else {
              if (a.costPence === undefined || a.pricePence === undefined || a.reorderLevel === undefined) throw new SimError("Cost, indicative price and reorder level required");
              r.data = { ...product, costPence: a.costPence, pricePence: a.pricePence, reorderLevel: a.reorderLevel };
            }
            const movement = this.add(w, "pharmacy-movement", a.type === "receive_stock" ? "Stock received" : "Price updated", "pharmacy", undefined, { productId: r.id, quantity: a.type === "receive_stock" ? a.quantity : 0, balance: r.data.stock, acquisitionPence: a.type === "receive_stock" ? Number(a.quantity) / product.packSize * product.costPence : 0, reference: a.text ?? "Catalogue price update", costPence: r.data.costPence, pricePence: r.data.pricePence });
            movement.provenance = { created: { actor: attribution, source: site, action: a.type, time: w.now, version: 1 }, changes: [] };
          }
          r.version++;
        }
      } else if (a.type === "register_attendance" || a.type === "update_attendance") {
        if (site !== "hospital" && site !== "control") throw new SimError("Hospital access required", 403);
        if (a.type === "register_attendance") {
          if (r || !a.patientId || !a.title || !a.acuity || !a.location) throw new SimError("Patient, complaint, acuity and location are required");
          if (resourceSnapshot(w).some((item) => item.kind === "hospital-attendance" && item.patientId === a.patientId && item.status !== "discharged")) throw new SimError("Patient already has an active hospital attendance", 409);
          r = this.add(w, "hospital-attendance", a.title, "hospital", a.patientId);
          r.data = hospitalAttendanceSchema.parse({ stage: "waiting", arrivalAt: w.now, presentingComplaint: a.title, acuity: a.acuity, location: a.location, clinician: a.clinician ?? "Unassigned" });
        } else {
          if (!r || r.kind !== "hospital-attendance" || a.expectedVersion === undefined) throw new SimError("Versioned hospital attendance required");
          const previous = hospitalAttendanceSchema.parse(r.data);
          if (previous.stage === "discharged") throw new SimError("Attendance is already discharged", 409);
          const updated = { ...previous, clinician: a.clinician ?? previous.clinician, location: a.location ?? previous.location, acuity: a.acuity ?? previous.acuity };
          switch (a.hospitalCommand) {
            case "assign":
              if (!a.clinician && !a.location && !a.acuity) throw new SimError("Choose a clinician, location or acuity");
              r.data = updated;
              break;
            case "assess":
              if (previous.stage !== "waiting") throw new SimError("Only waiting patients can start assessment", 409);
              if (updated.clinician === "Unassigned") throw new SimError("Assign a clinician before assessment", 409);
              r.data = { ...updated, stage: "assessing", assessmentAt: w.now };
              break;
            case "refer":
              if (previous.stage !== "assessing") throw new SimError("Assessment must start before referral to take", 409);
              r.data = { ...updated, stage: "take", referredAt: w.now };
              break;
            case "admit":
              if (previous.stage !== "take" || !a.location) throw new SimError("Choose an inpatient location for a patient on the take list", 409);
              r.data = { ...updated, stage: "inpatient", admittedAt: w.now };
              break;
            case "discharge":
              if (!a.disposition) throw new SimError("Discharge destination or outcome is required");
              r.data = { ...updated, stage: "discharged", dischargedAt: w.now, assessmentAt: "assessmentAt" in previous ? previous.assessmentAt : null, disposition: a.disposition };
              break;
            default: throw new SimError("Hospital command required");
          }
          r.data = hospitalAttendanceSchema.parse(r.data);
          r.version++;
        }
        const attendance = hospitalAttendanceSchema.parse(r.data);
        r.status = attendance.stage;
        r.priority = ["1", "2"].includes(attendance.acuity) ? "urgent" : "routine";
      } else if (a.type === "connect_device") {
        if (site !== "wearables" && site !== "control")
          throw new SimError("Connect home devices through the home workspace", 403);
        const existing = w.resources.find((item) => item.kind === "device" && item.owner === "wearables" && item.patientId === a.patientId && item.status === "active" && (item.data.metric === "steps" || item.title === "Home activity watch"));
        if (existing) {
          if (key) this.state.receipts[id + ":" + key] = {
            fingerprint, result: structuredClone(isDraft(existing) ? current(existing) : existing),
          };
          return existing;
        }
        r = this.add(w, "device", "Home activity watch", "wearables", a.patientId,
          { metric: "steps", battery: 100, quality: "awaiting-first-reading" });
        r.status = "active";
        r.visibleTo = ["wearables", "community", "patient"];
        if (!w.scheduled.some((job) => job.type === "observation" && job.patientId === a.patientId))
          w.scheduled.push({ at: w.now + 10 * minute, type: "observation", patientId: a.patientId });
      } else if (a.type === "save_allergy") {
        if (site !== "gp" && site !== "control")
          throw new SimError("Only primary care may maintain the allergy record", 403);
        if (!a.patientId || !a.title?.trim() || !a.allergyStatus)
          throw new SimError("Allergy patient, allergen and status are required");
        const allergies = patientAllergies(resourceSnapshot(w), a.patientId);
        if (a.sourceAllergyKey && !allergies.some((allergy) => allergy.key === a.sourceAllergyKey && !allergy.record))
          throw new SimError("Historical allergy has changed. Refresh the allergy record", 409);
        if (allergies.some((allergy) => allergy.key !== (a.sourceAllergyKey ?? r?.id) && allergy.status === "active" && a.allergyStatus === "active" && allergy.term.toLowerCase() === a.title!.trim().toLowerCase()))
          throw new SimError("This allergy is already active. Edit the existing allergy", 409);
        if (r) {
          if (r.kind !== "allergy" || r.owner !== "gp" || r.patientId !== a.patientId)
            throw new SimError("Allergy must belong to this patient and primary care", 409);
          r.title = a.title.trim(); r.version++;
        } else r = this.add(w, "allergy", a.title.trim(), "gp", a.patientId);
        r.visibleTo = [...new Set([...r.visibleTo, "gp", "hospital", "pharmacy", "community", "patient"] satisfies SiteId[])];
        r.status = a.allergyStatus;
        r.data = { ...r.data, reaction: a.reaction ?? "",
          ...(a.sourceAllergyKey ? { sourceAllergyKey: a.sourceAllergyKey } : {}) };
      } else if (a.type === "save_problem") {
        if (site !== "gp" && site !== "control")
          throw new SimError("Only primary care may maintain the problem list", 403);
        if (!a.patientId || !a.title?.trim() || !a.problemStatus)
          throw new SimError("Problem patient, title and status are required");
        const patientIndex = (original(w)?.patients ?? w.patients).findIndex((p) => p.id === a.patientId);
        const patient = w.patients[patientIndex]!;
        const problems = patientProblems(resourceSnapshot(w), patient);
        if (a.sourceProblemKey && !problems.some((problem) => problem.key === a.sourceProblemKey && !problem.record))
          throw new SimError("Historical problem has changed. Refresh the problem list", 409);
        if (problems.some((problem) => problem.key !== (a.sourceProblemKey ?? r?.id) && problem.status === "active" && a.problemStatus === "active" && problem.term.toLowerCase() === a.title!.trim().toLowerCase()))
          throw new SimError("This problem is already active. Edit the existing problem", 409);
        if (r) {
          if (r.kind !== "problem" || r.owner !== "gp" || r.patientId !== a.patientId)
            throw new SimError("Problem must belong to this patient and primary care", 409);
          r.title = a.title.trim();
          r.version++;
        } else r = this.add(w, "problem", a.title.trim(), "gp", a.patientId);
        r.visibleTo = [...new Set([...r.visibleTo, "gp", "hospital", "pharmacy", "community", "patient"] satisfies SiteId[])];
        r.status = a.problemStatus;
        r.data = { ...r.data, code: a.problemCode ?? "", onsetDate: a.onsetDate ?? "",
          ...(a.sourceProblemKey ? { sourceProblemKey: a.sourceProblemKey } : {}) };
        const replacedKey = a.sourceProblemKey ?? existingId;
        patient.conditions = [...new Set([
          ...problems.filter((problem) => problem.key !== replacedKey && problem.status === "active").map((problem) => problem.term),
          ...(r.status === "active" ? [r.title] : []),
        ])];
      } else if (a.type === "save_consultation") {
        if (site !== "gp" && site !== "control")
          throw new SimError("Only primary care may save a GP consultation", 403);
        if (!a.patientId || !a.title?.trim() || !a.text || !a.consultationStatus)
          throw new SimError("Consultation patient, title, text and status are required");
        if (r) {
          if (r.kind !== "consultation" || r.owner !== "gp" || r.patientId !== a.patientId)
            throw new SimError("Consultation must belong to this patient and primary care", 409);
          r.title = a.title.trim();
          r.version++;
        } else r = this.add(w, "consultation", a.title.trim(), "gp", a.patientId);
        r.status = a.consultationStatus;
        r.data = {
          ...r.data,
          text: a.text,
          author: r.data.author ?? actor,
          mode: a.mode ?? r.data.mode ?? "in-person",
          recordedAt: w.now,
        };
      } else if (create[a.type]) {
        if (!a.patientId) throw new SimError("patientId required");
        const [kind, owner] = create[a.type]!;
        let appointment:
          | {
              startsAt: number;
              durationMinutes: number;
              clinician: string;
              mode: string;
              capacityReserved: boolean;
              sessionId?: string;
            }
          | undefined;
        if (a.type === "book_appointment") {
          const resources = original(w)?.resources ?? w.resources;
          const sessionResource = a.sessionId ? resources.find(item => item.id === a.sessionId) : undefined;
          if (a.sessionId && (!sessionResource || sessionResource.kind !== "appointment-session" || sessionResource.owner !== owner || !sessionResource.visibleTo.includes(site))) throw new SimError("Appointment session unavailable", 403);
          const session = sessionResource ? appointmentSessionSchema.parse(sessionResource.data) : undefined;
          if (sessionResource && a.sessionVersion !== undefined && sessionResource.version !== a.sessionVersion) throw new SimError("Stale session version", 409);
          if (session && a.startsAt === undefined) throw new SimError("Choose a session slot");
          const durationMinutes = session?.slotMinutes ?? a.durationMinutes ?? 15;
          const clinician = session?.clinician ?? a.clinician ?? (owner === "gp" ? "Duty GP" : "Duty clinician");
          const duration = durationMinutes * minute;
          let startsAt = a.startsAt ?? Math.ceil(w.now / (15 * minute)) * 15 * minute;
          if (startsAt < w.now)
            throw new SimError("Choose an appointment at or after the simulation time", 409);
          const bookings = (original(w)?.resources ?? w.resources).filter(
            (item) =>
              item.kind === "appointment" &&
              item.owner === owner &&
              occupiesAppointmentSlot(item.status) &&
              typeof item.data.clinician === "string" &&
              item.data.clinician.trim().toLowerCase() === clinician.toLowerCase() &&
              typeof item.data.startsAt === "number" &&
              typeof item.data.durationMinutes === "number",
          );
          for (;;) {
            const overlap = bookings.find((item) => {
              const start = Number(item.data.startsAt),
                end = start + Number(item.data.durationMinutes) * minute;
              return startsAt < end && startsAt + duration > start;
            });
            if (!overlap) break;
            if (a.startsAt !== undefined)
              throw new SimError("Clinician already has an overlapping appointment", 409);
            startsAt =
              Number(overlap.data.startsAt) + Number(overlap.data.durationMinutes) * minute;
          }
          const matchingSessions = resources.filter(item => item.kind === "appointment-session" && item.owner === owner && String(item.data.clinician).toLowerCase() === clinician.toLowerCase() && Number(item.data.startsAt) < startsAt + duration && Number(item.data.endsAt) > startsAt);
          for (const item of matchingSessions) {
            const diary = appointmentSessionSchema.parse(item.data);
            if (startsAt < diary.startsAt || startsAt + duration > diary.endsAt || (startsAt - diary.startsAt) % (diary.slotMinutes * minute) || durationMinutes !== diary.slotMinutes) throw new SimError("Choose an exact slot within the session", 409);
            if (diary.blockedSlots.some(slot => slot.startsAt >= startsAt && slot.startsAt < startsAt + duration)) throw new SimError("This slot is blocked", 409);
          }
          if (session && (startsAt < session.startsAt || startsAt + duration > session.endsAt || (startsAt - session.startsAt) % duration)) throw new SimError("Choose a slot in this session", 409);
          appointment = {
            startsAt,
            durationMinutes,
            clinician,
            mode: session?.mode ?? a.mode ?? "in-person",
            capacityReserved: !session,
            ...(sessionResource ? { sessionId: sessionResource.id } : {}),
          };
        }
        if (["order_test", "book_appointment", "schedule_visit"].includes(a.type) && appointment?.capacityReserved !== false) {
          const cap = w.resources.find((x) => x.id === "capacity-" + owner);
          if (!cap || Number(cap.data.remaining) <= 0)
            throw new SimError("No service capacity", 409);
          cap.data.remaining = Number(cap.data.remaining) - 1;
          cap.version++;
        }
        if (a.type === "dispatch_robot") {
          const robot = w.resources.find((x) => x.id === "robot-1")!;
          if (w.faults["robot-failure"] || robot.status !== "available")
            throw new SimError("Robot unavailable", 409);
          robot.status = "busy";
          robot.version++;
        }
        r = this.add(w, kind, a.title ?? a.type.replaceAll("_", " "), owner, a.patientId);
        r.visibleTo = [...new Set<SiteId>([owner, site, "patient"])];
        if (a.type === "create_referral")
          r.visibleTo = [...new Set<SiteId>([...r.visibleTo, "referrals"])];
        if (appointment) {
          r.data = appointment;
          r.status = "booked";
          r.dueAt = appointment.startsAt;
        }
        if (a.type === "draft_prescription") {
          r.status = "draft";
          if (a.medicationOrder) r.data = { medicationOrder: a.medicationOrder, drug: a.medicationOrder.drug, requiredUnits: a.medicationOrder.quantity, text: a.medicationOrder.indication };
        }
        if (a.type === "order_test" && a.bloodTestOrder) {
          r.data = { bloodTestOrder: a.bloodTestOrder, text: a.bloodTestOrder.clinicalDetails };
          r.priority = a.bloodTestOrder.priority;
        }
        if (a.type === "order_test")
          w.scheduled.push({ at: w.now + (a.bloodTestOrder?.collection === "next-round" ? 240 : 120) * minute, type: "result", resourceId: r.id });
        if (a.type === "dispatch_robot") {
          r.status = "in-progress";
          w.scheduled.push({ at: w.now + 30 * minute, type: "delivery", resourceId: r.id });
        }
        if (a.type === "schedule_visit") {
          r.status = "scheduled";
          w.scheduled.push({ at: w.now + 90 * minute, type: "visit", resourceId: r.id });
        }
      } else {
        if (!r) throw new SimError("resourceId required");
        if (r.kind === "hospital-note") throw new SimError("Use the hospital documentation editor for this note", 409);
        if (r.kind === "discharge-summary") throw new SimError("Use the document workflow to process this letter", 409);
        if (["appointment-session", "problem", "allergy", "hospital-attendance", "pharmacy-product", "pharmacy-referral", "pharmacy-movement", "pharmacy-order", "pharmacy-quote", "pharmacy-basket"].includes(r.kind) && a.type !== "share_record")
          throw new SimError(`Use the ${r.kind} editor to change this record`, 409);
        if (a.type === "share_record") {
          if (r.data.planLab === "digital")
            throw new SimError("Sharing is restricted for this historical simulation record", 409);
          if (!a.target) throw new SimError("target required");
          r.visibleTo = [...new Set([...r.visibleTo, a.target])];
        } else if (["report_absence", "restore_staff", "allocate_shift"].includes(a.type)) {
          if (r.kind !== "staff" || !["control", "hr", "roster"].includes(site))
            throw new SimError("Staff management permission required", 403);
          if (a.type === "report_absence") r.status = "absent";
          if (a.type === "restore_staff") r.status = "available";
          if (a.type === "allocate_shift") r.data.allocated = !r.data.allocated;
          this.event(w, "staffing.changed", actor, "A&E staffed capacity recalculated", r, false);
        } else {
          if (
            site !== "control" &&
            r.owner !== site &&
            !(a.type === "collect" && site === "patient") &&
            !(a.type === "review" && site === "gp" && r.kind === "test" && r.status === "available") &&
            !(r.kind === "referral" && ["review", "accept", "reject", "complete"].includes(a.type) &&
              (site === "referrals" || (site === "hospital" && r.owner === "referrals")))
          )
            throw new SimError("Only owning service may change this record", 403);
          const transitions: Partial<Record<Action["type"], [string[], string]>> = {
            review: [["open", "draft", "available"], "reviewed"],
            accept: [["open", "reviewed", "rejected"], "accepted"],
            complete: [
              ["open", "reviewed", "accepted", "scheduled", "waiting", "booked", "arrived"],
              "completed",
            ],
            arrive_appointment: [["open", "scheduled", "booked"], "arrived"],
            cancel_appointment: [["open", "scheduled", "booked", "arrived"], "cancelled"],
            reject: [["open", "reviewed", "accepted"], "rejected"],
            dispense: [["approved"], "dispensed"],
            collect: [["dispensed"], "collected"],
          };
          if (
            ["arrive_appointment", "cancel_appointment"].includes(a.type) &&
            r.kind !== "appointment"
          )
            throw new SimError("Appointment required");
          const t = transitions[a.type];
          if (!t || !t[0].includes(r.status))
            throw new SimError("Invalid lifecycle transition", 409);
          if (
            a.type === "complete" &&
            ["encounter", "handover"].includes(r.kind) &&
            this.staffing(w).staffedSpaces === 0
          )
            throw new SimError("No staffed A&E assessment space", 409);
          if (["dispense", "collect"].includes(a.type) && r.kind !== "prescription")
            throw new SimError("Prescription required");
          if (r.kind === "prescription" && a.type === "accept") {
            r.status = "approved";
          } else r.status = t[1];
          if (a.type === "dispense") {
            if (site !== "pharmacy" && site !== "control") throw new SimError("Only pharmacy may dispense", 403);
            if (w.faults["pharmacy-shortage"]) throw new SimError("Pharmacy supply is blocked by the shortage incident", 409);
            if (!a.expectedVersion) throw new SimError("Versioned prescription required");
            const productIndex = (original(w)?.resources ?? w.resources).findIndex(item => item.id === r!.data.productId && item.kind === "pharmacy-product");
            const quantity = r.data.quantity;
            if (productIndex < 0 || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) throw new SimError("Link a catalogue item and quantity before dispensing", 409);
            const stock = w.resources[productIndex]!;
            const product = pharmacyProductSchema.parse(stock.data);
            if (product.stock < quantity) throw new SimError("Insufficient stock: receive a delivery before dispensing", 409);
            const costPence = product.stockCostPence / product.stock * quantity;
            const revenuePence = product.pricePence / product.packSize * quantity;
            stock.data = { ...product, stock: product.stock - quantity, stockCostPence: Math.max(0, product.stockCostPence - costPence) };
            stock.version++;
            const stockChange: RecordChange = { actor: attribution, source: site, action: "dispense", time: w.now, version: stock.version };
            stock.provenance ??= { created: null, changes: [] };
            stock.provenance.changes.push(stockChange);
            const movement = this.add(w, "pharmacy-movement", "Prescription dispensed", "pharmacy", r.patientId, { productId: stock.id, prescriptionId: r.id, quantity: -quantity, balance: stock.data.stock, reference: r.title, costPence, revenuePence });
            movement.provenance = { created: { ...stockChange, version: 1 }, changes: [] };
            r.data.dispensedAt = w.now;
          }
          if (a.type === "complete") {
            w.counters.completed++;
            const cap = w.resources.find((x) => x.id === "capacity-" + r!.owner);
            if (cap && ["test", "visit"].includes(r.kind))
              cap.data.remaining = Math.min(Number(cap.data.total), Number(cap.data.remaining) + 1);
          }
          if (
            ["complete", "cancel_appointment"].includes(a.type) &&
            r.kind === "appointment" &&
            r.data.capacityReserved === true
          ) {
            const capacityId = "capacity-" + r.owner;
            const capacity = w.resources.find((item) => item.id === capacityId);
            if (capacity) {
              capacity.data.remaining = Math.min(
                Number(capacity.data.total),
                Number(capacity.data.remaining) + 1,
              );
              capacity.version++;
            }
            r.data.capacityReserved = false;
          }
          if (a.type === "reject") w.counters.rejected++;
          if (a.type === "review") w.counters.reviewMinutes += 5;
        }
        r.version++;
      }
      w.counters.actions++;
      const change: RecordChange = {
        actor: attribution, source: site, action: a.type, time: w.now, version: r!.version,
      };
      if (r!.id !== existingId) r!.provenance = { created: (a.type === "save_problem" && a.sourceProblemKey) || (a.type === "save_allergy" && a.sourceAllergyKey) ? null : change, changes: [change] };
      else {
        r!.provenance ??= { created: null, changes: [] };
        r!.provenance.changes.push(change);
      }
      this.event(w, a.type, actor, r!.title, r, false);
      if (key)
        this.state.receipts[id + ":" + key] = {
          fingerprint,
          result: structuredClone(isDraft(r) ? current(r!) : r!),
        };
      return r!;
    });
  }
  staffing(w: World, resources = resourceSnapshot(w)): StaffingSummary {
    const cacheable = !isDraft(w) && resources === w.resources;
    const cached = cacheable ? this.staffingReads.get(resources) : undefined;
    if (cached) return { ...cached };
    const result: StaffingSummary = { doctors: 0, nurses: 0, staffedSpaces: 0, waiting: 0 };
    for (const resource of resources) {
      if (resource.kind === "staff" && resource.status === "available" && resource.data.allocated) {
        if (resource.data.role === "doctor") result.doctors++;
        if (resource.data.role === "nurse") result.nurses++;
      }
      if ((resource.kind === "encounter" || resource.kind === "handover" || resource.kind === "hospital-attendance") && resource.status === "waiting") result.waiting++;
    }
    result.staffedSpaces = Math.min(result.doctors * 2, result.nurses * 2);
    if (cacheable) this.staffingReads.set(resources, result);
    return { ...result };
  }
  clock(id: string, update: { paused?: boolean; speed?: number; advanceMinutes?: number }, actor?: string) {
    return this.transaction(id, (w) => {
      if (update.paused !== undefined) w.paused = update.paused;
      if (update.speed !== undefined) {
        if (!Number.isFinite(update.speed) || update.speed < 0 || update.speed > 3600)
          throw new SimError("Speed must be 0–3600");
        w.speed = update.speed;
      }
      if (update.advanceMinutes !== undefined) {
        if (!w.paused) throw new SimError("Pause before manual stepping", 409);
        if (
          !Number.isFinite(update.advanceMinutes) ||
          update.advanceMinutes < 0 ||
          update.advanceMinutes > 10080
        )
          throw new SimError("Step must be 0–10080 minutes");
        this.advance(w, update.advanceMinutes * minute);
      }
      const detail = update.advanceMinutes !== undefined
        ? `Advanced simulation by ${update.advanceMinutes} minutes; clock paused`
        : update.paused !== undefined
          ? `Simulation ${w.paused ? "paused" : "resumed"}`
          : `Simulation speed set to ${w.speed}×`;
      if (actor) this.event(w, "clock.changed", actor, detail);
      return { now: w.now, paused: w.paused, speed: w.speed };
    });
  }
  advance(w: World, ms: number) {
    const end = w.now + ms;
    let processed = 0;
    const targets = new Set(w.scheduled.flatMap((job) => job.resourceId ? [job.resourceId] : []));
    targets.add("robot-1");
    targets.add("capacity-community");
    const targetIndices = new Map<string, number>();
    const flowIndices: number[] = [];
    const activeAttendances = new Set<string>();
    const deviceIndices = new Map<string, number>();
    const livingPatients = w.scheduled.some(job => job.at <= end)
      ? (original(w)?.patients ?? w.patients).filter(patient => !patient.death) : [];
    if (w.scheduled.some((job) => job.at <= end)) {
      resourceSnapshot(w).forEach((record, index) => {
        if (targets.has(record.id)) targetIndices.set(record.id, index);
        if (record.kind === "hospital-attendance" && record.status !== "discharged" && record.patientId) activeAttendances.add(record.patientId);
        if (record.kind === "device" && record.owner === "wearables" && record.patientId && (record.data.metric === "steps" || record.title === "Home activity watch")) deviceIndices.set(record.patientId, index);
        if (record.kind === "staff" || record.kind === "bed" ||
          (["encounter", "handover", "hospital-attendance"].includes(record.kind) && record.status === "waiting"))
          flowIndices.push(index);
      });
    }
    while (true) {
      w.scheduled.sort((a, b) => a.at - b.at);
      const job = w.scheduled[0];
      if (!job || job.at > end) break;
      if (++processed > 20000) throw new SimError("Event budget exceeded; use smaller step");
      w.scheduled.shift();
      w.now = job.at;
      const resourceIndex = job.resourceId
        ? (targetIndices.get(job.resourceId) ?? -1)
        : -1;
      const r = resourceIndex < 0 ? undefined : w.resources[resourceIndex];
      const enabled = (id: string) => w.agents.some((a) => a.id === id && a.enabled);
      if (job.type === "acute") {
        if (enabled("acute-flow") && livingPatients.length) {
          const capacity = Math.floor(this.staffing(w, flowIndices.map((index) => w.resources[index])).staffedSpaces / 2);
          const queue = flowIndices
            .filter((index) => {
              const item = w.resources[index];
              return ["encounter", "handover"].includes(item.kind) && item.status === "waiting";
            })
            .sort((a, b) => w.resources[a].createdAt - w.resources[b].createdAt);
          for (const index of queue.slice(0, capacity)) {
            const item = w.resources[index];
            item.status = "completed";
            item.version++;
            item.data.waitMinutes = Math.round((w.now - item.createdAt) / minute);
            w.counters.completed++;
            this.event(
              w,
              "assessment.completed",
              "acute-flow",
              "Synthetic assessment slot completed",
              item,
            );
          }
          for (let i = 0; i < 3; i++) {
            w.rng = (Math.imul(1664525, w.rng) + 1013904223) >>> 0;
            const patient = livingPatients[w.rng % livingPatients.length];
            const item = this.add(
              w,
              i === 0 ? "handover" : "hospital-attendance",
              i === 0 ? "New ambulance handover" : "New A&E arrival",
              i === 0 ? "ambulance" : "hospital",
              patient.id,
            );
            if (i > 0) {
              if (activeAttendances.has(patient.id)) { w.resources.pop(); continue; }
              activeAttendances.add(patient.id);
              item.data = hospitalAttendanceSchema.parse({ stage: "waiting", arrivalAt: w.now, presentingComplaint: "New A&E arrival", acuity: "3", location: "Waiting room", clinician: "Unassigned" });
            }
            flowIndices.push(w.resources.length - 1);
            item.status = "waiting";
            item.visibleTo = ["ambulance", "hospital"];
            this.event(w, "emergency.arrived", "acute-flow", item.title, item);
          }
        }
        w.scheduled.push({ at: w.now + 20 * minute, type: "acute" });
      }
      if (job.type === "bed-pressure") {
        if (enabled("bed-flow")) {
          const resources = flowIndices.map((index) => w.resources[index]);
          const openBeds = resources.filter(
            (x) => x.kind === "bed" && x.status === "available",
          ).length;
          const waiting = resources.filter(
            (x) => ["encounter", "hospital-attendance"].includes(x.kind) && x.status === "waiting",
          ).length;
          if (waiting > openBeds) {
            const item = this.add(
              w,
              "flow-alert",
              "Demand exceeds staffed bed availability",
              "beds",
              undefined,
              { waiting, openBeds, winterPressure: Boolean(w.faults["winter-pressure"]) },
            );
            item.priority = "urgent";
            item.visibleTo = ["beds", "hospital", "icb"];
            this.event(w, "flow.pressure", "bed-flow", item.title, item);
          }
        }
        w.scheduled.push({ at: w.now + 60 * minute, type: "bed-pressure" });
      }
      if (job.type === "screening") {
        if (enabled("prevention-recall") && livingPatients.length) {
          w.rng = (Math.imul(1664525, w.rng) + 1013904223) >>> 0;
          const patient = livingPatients[w.rng % livingPatients.length];
          const item = this.add(w, "screening", "Population recall due", "population", patient.id, {
            channel: patient.needs.includes("Offline contact") ? "letter" : "app",
            completed: false,
          });
          item.visibleTo = ["population", "gp", "nhsapp", "patient"];
          this.event(w, "prevention.recall", "prevention-recall", item.title, item);
        }
        w.scheduled.push({ at: w.now + 24 * 60 * minute, type: "screening" });
      }
      if (job.type === "service-demand") {
        if (enabled("service-demand") && livingPatients.length) {
          const services: [SiteId, string, string][] = [
            ["mental", "mental-health-plan", "New community mental-health review"],
            ["maternity", "maternity-episode", "New maternity contact awaiting triage"],
            ["dental", "dental-recall", "New urgent dental access request"],
            ["social", "care-package", "New home-support assessment"],
            ["referrals", "referral", "New specialist referral"],
            ["pharmacy", "prescription", "New prescription awaiting review"],
          ];
          w.rng = (Math.imul(1664525, w.rng) + 1013904223) >>> 0;
          const [owner, kind, title] = services[w.rng % services.length];
          const patient = livingPatients[(w.rng >>> 4) % livingPatients.length];
          const item = this.add(w, kind, title, owner, patient.id, { generated: true });
          item.visibleTo = [owner, "patient"];
          this.event(w, "service.requested", "service-demand", item.title, item);
        }
        w.scheduled.push({ at: w.now + 30 * minute, type: "service-demand" });
      }
      if (job.type === "arrival") {
        if (enabled("patient-demand") && livingPatients.length) {
          w.rng = (Math.imul(1664525, w.rng) + 1013904223) >>> 0;
          const p = livingPatients[w.rng % livingPatients.length];
          const x = this.add(w, "request", "New synthetic patient request", "triage", p.id);
          x.visibleTo = ["triage", "gp", "patient"];
          this.event(w, "request.arrived", "patient-demand", x.title, x);
        }
        w.scheduled.push({ at: w.now + 15 * minute, type: "arrival" });
      }
      if (job.type === "observation") {
        if (enabled("home-monitor") && livingPatients.some(patient => patient.id === job.patientId)) {
          const x = this.add(
            w,
            "observation",
            w.faults["wearable-disconnect"] ? "Device disconnected" : "Home activity reading",
            "wearables",
            job.patientId,
            {
              metric: "steps",
              observedAt: w.now,
              quality: w.faults["wearable-disconnect"] ? "missing" : "good",
              value: w.faults["wearable-disconnect"] ? null : 1600 + (w.nextId % 8) * 100,
              unit: "steps/day",
            },
          );
          x.status = "available";
          x.visibleTo = ["wearables", "community", "patient"];
          const deviceIndex = job.patientId ? deviceIndices.get(job.patientId) : undefined;
          const device = deviceIndex === undefined ? undefined : w.resources[deviceIndex];
          if (device) {
            device.data.quality = x.data.quality;
            if (!w.faults["wearable-disconnect"]) device.data.lastSyncedAt = w.now;
            device.version++;
          }
          this.event(w, "observation.received", "home-monitor", x.title, x);
        }
        w.scheduled.push({
          at: w.now + 60 * minute,
          type: "observation",
          patientId: job.patientId,
        });
      }
      if (job.type === "result" && r) {
        if (!enabled("laboratory")) {
          w.scheduled.push({ ...job, at: w.now + 30 * minute });
          continue;
        }
        r.status = "available";
        r.data.report = "Synthetic result ready for review. No clinical decision implied.";
        const request = bloodTestOrderSchema.safeParse(r.data.bloodTestOrder);
        const panelIdentifier = request.success ? request.data.panelId ?? request.data.panel : "";
        const bloodResult = r.patientId && panelIdentifier ? orderedBloodResult(panelIdentifier, r.patientId, job.at - 120 * minute) : undefined;
        if (bloodResult) r.data = { ...r.data, ...bloodResult };
        r.version++;
        if (w.faults["pathology-outage"]) r.visibleTo = ["diagnostics"];
        this.event(w, "result.available", "laboratory", r.title, r);
      }
      if ((job.type === "delivery" || job.type === "visit") && r) {
        if (r.status === "completed") continue;
        if (!enabled("logistics") || (w.faults["robot-failure"] && job.type === "delivery")) {
          w.scheduled.push({ ...job, at: w.now + 30 * minute });
          continue;
        }
        r.status = "completed";
        r.version++;
        w.counters.completed++;
        if (job.type === "delivery") {
          const index = targetIndices.get("robot-1")!;
          w.resources[index].status = "available";
        } else {
          const index = targetIndices.get("capacity-community")!;
          const cap = w.resources[index];
          cap.data.remaining = Math.min(Number(cap.data.total), Number(cap.data.remaining) + 1);
        }
        this.event(w, job.type + ".completed", "logistics", r.title, r);
      }
    }
    w.now = end;
  }
  tick(realMs: number) {
    for (const id of this.worlds())
      this.transaction(id, (w) => {
        if (!w.paused && w.speed > 0) this.advance(w, Math.min(realMs, 5000) * w.speed);
      });
  }
  fault(id: string, name: string, enabled: boolean) {
    return this.transaction(id, (w) => {
      w.faults[name] = enabled;
      const livingPatients = enabled && (name === "demand-surge" || name === "winter-pressure")
        ? (original(w)?.patients ?? w.patients).filter(patient => !patient.death) : [];
      if (name === "demand-surge" && enabled && livingPatients.length)
        for (let i = 0; i < 20; i++) {
          const item = this.add(
            w,
            "request",
            "Demand surge: new patient request",
            "triage",
            livingPatients[i % livingPatients.length].id,
          );
          item.visibleTo = ["triage", "gp", "patient"];
          this.event(w, "request.arrived", "scenario", item.title, item);
        }
      if (name === "staff-shortage") {
        const c = w.resources.find((x) => x.id === "capacity-community")!;
        c.data.remaining = enabled ? 0 : 4;
        c.data.total = enabled ? 0 : 4;
      }
      if (name === "winter-pressure") {
        const beds = w.resources.find((x) => x.id === "capacity-beds");
        if (beds) {
          beds.data.remaining = enabled ? 0 : 2;
          beds.data.total = enabled ? 1 : 2;
          beds.version++;
        }
        if (enabled && livingPatients.length)
          for (let i = 0; i < 8; i++) {
            const patientId = livingPatients[(i + 12) % livingPatients.length].id;
            if (resourceSnapshot(w).some((r) => r.kind === "hospital-attendance" && r.patientId === patientId && r.status !== "discharged")) continue;
            const item = this.add(
              w,
              "hospital-attendance",
              "Winter-pressure A&E arrival",
              "hospital",
              patientId,
            );
            item.data = hospitalAttendanceSchema.parse({ stage: "waiting", arrivalAt: w.now, presentingComplaint: item.title, acuity: "3", location: "Waiting room", clinician: "Unassigned" });
            item.status = "waiting";
            item.visibleTo = ["hospital", "ambulance", "beds"];
            this.event(w, "emergency.arrived", "scenario", item.title, item);
          }
      }
      if (name === "pharmacy-shortage") {
        // The fault blocks supply without destroying the stock ledger or acquisition values.
        w.faults["pharmacy-shortage"] = enabled;
      }
      if (name === "pathology-outage" && !enabled)
        for (const r of w.resources.filter((x) => x.kind === "test" && x.status === "available"))
          r.visibleTo = [...new Set<SiteId>([...r.visibleTo, "gp"])];
      this.event(w, "incident", "operator", name + ": " + enabled);
      return w.faults;
    });
  }
}
