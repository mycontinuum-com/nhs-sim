import {
  actionSchema,
  sites,
  type Action,
  type Resource,
  type SimEvent,
  type SiteId,
  type World,
} from "../../contracts/src/index.ts";

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
      birthDate: 1940 + (i % 65) + "-05-12",
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
    { stock: 3, drug: "SYNTHETIC-MED-A", note: "Simulation only; no dosing guidance." },
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
    "patient",
  ]);
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
    { value: 1800, baseline: 4200, unit: "steps/day", quality: "good" },
    ["wearables", "community", "patient"],
  );
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
    { options: ["Northbank CDC · 9 days", "Riverside Hub · 15 days"], accessibility: "evening slot" },
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
  return w;
}
export class Engine {
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
    this.state.worlds[w.id] = w;
  }
  worlds(): string[] {
    return Object.keys(this.state.worlds);
  }
  transaction<T>(id: string, fn: (w: World) => T): T {
    const before = structuredClone(this.state);
    try {
      return fn(this.require(id));
    } catch (e) {
      this.state = before;
      throw e;
    }
  }
  event(w: World, type: string, actor: string, detail: string, r?: Resource) {
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
  view(id: string, site: SiteId, patientId?: string) {
    const w = this.require(id);
    return {
      id: w.id,
      now: w.now,
      speed: w.speed,
      paused: w.paused,
      population: w.patients.length,
      counters: w.counters,
      resources: w.resources.filter(
        (r) =>
          (site === "control" || r.visibleTo.includes(site)) &&
          (!patientId || r.patientId === patientId || !r.patientId),
      ),
      agents: site === "control" ? w.agents : undefined,
      faults: w.faults,
      events: this.events(id, site),
    };
  }
  patients(id: string, q = "", offset = 0, limit = 30) {
    const all = this.require(id).patients.filter((p) =>
      (p.id + " " + p.name).toLowerCase().includes(q.toLowerCase()),
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
    w.resources.push(r);
    return r;
  }
  action(id: string, site: SiteId, input: unknown, actor: string, key?: string) {
    const a = actionSchema.parse(input);
    return this.transaction(id, (w) => {
      const fingerprint = JSON.stringify({ site, actor, a });
      if (key) {
        const receipt = this.state.receipts[id + ":" + key];
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw new SimError("Idempotency key reused with different action", 409);
          return receipt.result;
        }
      }
      if (a.patientId && !w.patients.some((p) => p.id === a.patientId))
        throw new SimError("Unknown patient", 404);
      if (
        w.faults["cyber-readonly"] &&
        ["hospital", "legacy", "diagnostics", "referrals", "theatre", "beds"].includes(site)
      )
        throw new SimError("Service is in cyber incident read-only mode", 423);
      let r: Resource | undefined;
      if (a.resourceId) {
        r = w.resources.find((x) => x.id === a.resourceId);
        if (!r) throw new SimError("Unknown resource", 404);
        if (site !== "control" && !r.visibleTo.includes(site))
          throw new SimError("Record not visible to this service", 403);
        if (a.expectedVersion !== undefined && r.version !== a.expectedVersion)
          throw new SimError("Stale resource version", 409);
      }
      const create: Partial<Record<Action["type"], [string, SiteId]>> = {
        create_task: ["task", site],
        create_referral: ["referral", "referrals"],
        order_test: ["test", "diagnostics"],
        draft_prescription: ["prescription", "pharmacy"],
        book_appointment: ["appointment", a.target ?? "gp"],
        send_message: ["message", "patient"],
        schedule_visit: ["visit", "community"],
        dispatch_robot: ["robot-job", "robotics"],
      };
      if (create[a.type]) {
        if (!a.patientId) throw new SimError("patientId required");
        const [kind, owner] = create[a.type]!;
        if (["order_test", "book_appointment", "schedule_visit"].includes(a.type)) {
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
        if (a.type === "draft_prescription") r.status = "draft";
        if (a.type === "order_test")
          w.scheduled.push({ at: w.now + 120 * minute, type: "result", resourceId: r.id });
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
        if (a.type === "share_record") {
          if (!a.target) throw new SimError("target required");
          r.visibleTo = [...new Set([...r.visibleTo, a.target])];
        } else if (["report_absence", "restore_staff", "allocate_shift"].includes(a.type)) {
          if (r.kind !== "staff" || !["control", "hr", "roster"].includes(site))
            throw new SimError("Staff management permission required", 403);
          if (a.type === "report_absence") r.status = "absent";
          if (a.type === "restore_staff") r.status = "available";
          if (a.type === "allocate_shift") r.data.allocated = !r.data.allocated;
          this.event(w, "staffing.changed", actor, "A&E staffed capacity recalculated", r);
        } else {
          if (
            site !== "control" &&
            r.owner !== site &&
            !(a.type === "collect" && site === "patient")
          )
            throw new SimError("Only owning service may change this record", 403);
          const transitions: Partial<Record<Action["type"], [string[], string]>> = {
            review: [["open", "draft", "available"], "reviewed"],
            accept: [["open", "reviewed", "rejected"], "accepted"],
            complete: [["open", "reviewed", "accepted", "scheduled", "waiting"], "completed"],
            reject: [["open", "reviewed", "accepted"], "rejected"],
            dispense: [["approved"], "dispensed"],
            collect: [["dispensed"], "collected"],
          };
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
            if (Number(r.data.stock ?? 1) <= 0) throw new SimError("Out of stock", 409);
            r.data.stock = Number(r.data.stock ?? 1) - 1;
          }
          if (a.type === "complete") {
            w.counters.completed++;
            const cap = w.resources.find((x) => x.id === "capacity-" + r!.owner);
            if (cap && ["appointment", "test", "visit"].includes(r.kind))
              cap.data.remaining = Math.min(Number(cap.data.total), Number(cap.data.remaining) + 1);
          }
          if (a.type === "reject") w.counters.rejected++;
          if (a.type === "review") w.counters.reviewMinutes += 5;
        }
        r.version++;
      }
      w.counters.actions++;
      this.event(w, a.type, actor, r!.title, r);
      if (key) this.state.receipts[id + ":" + key] = { fingerprint, result: structuredClone(r!) };
      return r!;
    });
  }
  staffing(w: World) {
    const on = w.resources.filter(
      (r) => r.kind === "staff" && r.status === "available" && r.data.allocated,
    );
    const doctors = on.filter((r) => r.data.role === "doctor").length;
    const nurses = on.filter((r) => r.data.role === "nurse").length;
    return {
      doctors,
      nurses,
      staffedSpaces: Math.min(doctors * 2, nurses * 2),
      waiting: w.resources.filter(
        (r) => ["encounter", "handover"].includes(r.kind) && r.status === "waiting",
      ).length,
    };
  }
  clock(id: string, update: { paused?: boolean; speed?: number; advanceMinutes?: number }) {
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
      return { now: w.now, paused: w.paused, speed: w.speed };
    });
  }
  advance(w: World, ms: number) {
    const end = w.now + ms;
    let processed = 0;
    while (true) {
      w.scheduled.sort((a, b) => a.at - b.at);
      const job = w.scheduled[0];
      if (!job || job.at > end) break;
      if (++processed > 20000) throw new SimError("Event budget exceeded; use smaller step");
      w.scheduled.shift();
      w.now = job.at;
      const r = w.resources.find((x) => x.id === job.resourceId);
      const enabled = (id: string) => w.agents.some((a) => a.id === id && a.enabled);
      if (job.type === "acute") {
        if (enabled("acute-flow")) {
          const capacity = Math.floor(this.staffing(w).staffedSpaces / 2);
          const queue = w.resources
            .filter((x) => ["encounter", "handover"].includes(x.kind) && x.status === "waiting")
            .sort((a, b) => a.createdAt - b.createdAt);
          for (const item of queue.slice(0, capacity)) {
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
            const patient = w.patients[w.rng % w.patients.length];
            const item = this.add(
              w,
              i === 0 ? "handover" : "encounter",
              i === 0 ? "New ambulance handover" : "New A&E arrival",
              i === 0 ? "ambulance" : "hospital",
              patient.id,
            );
            item.status = "waiting";
            item.visibleTo = ["ambulance", "hospital"];
            this.event(w, "emergency.arrived", "acute-flow", item.title, item);
          }
        }
        w.scheduled.push({ at: w.now + 20 * minute, type: "acute" });
      }
      if (job.type === "bed-pressure") {
        if (enabled("bed-flow")) {
          const openBeds = w.resources.filter(
            (x) => x.kind === "bed" && x.status === "available",
          ).length;
          const waiting = w.resources.filter(
            (x) => x.kind === "encounter" && x.status === "waiting",
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
        if (enabled("prevention-recall")) {
          w.rng = (Math.imul(1664525, w.rng) + 1013904223) >>> 0;
          const patient = w.patients[w.rng % w.patients.length];
          const item = this.add(
            w,
            "screening",
            "Population recall due",
            "population",
            patient.id,
            { channel: patient.needs.includes("Offline contact") ? "letter" : "app", completed: false },
          );
          item.visibleTo = ["population", "gp", "nhsapp", "patient"];
          this.event(w, "prevention.recall", "prevention-recall", item.title, item);
        }
        w.scheduled.push({ at: w.now + 24 * 60 * minute, type: "screening" });
      }
      if (job.type === "service-demand") {
        if (enabled("service-demand")) {
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
          const patient = w.patients[(w.rng >>> 4) % w.patients.length];
          const item = this.add(w, kind, title, owner, patient.id, { generated: true });
          item.visibleTo = [owner, "patient"];
          this.event(w, "service.requested", "service-demand", item.title, item);
        }
        w.scheduled.push({ at: w.now + 30 * minute, type: "service-demand" });
      }
      if (job.type === "arrival") {
        if (enabled("patient-demand")) {
          w.rng = (Math.imul(1664525, w.rng) + 1013904223) >>> 0;
          const p = w.patients[w.rng % w.patients.length];
          const x = this.add(w, "request", "New synthetic patient request", "triage", p.id);
          x.visibleTo = ["triage", "gp", "patient"];
          this.event(w, "request.arrived", "patient-demand", x.title, x);
        }
        w.scheduled.push({ at: w.now + 15 * minute, type: "arrival" });
      }
      if (job.type === "observation") {
        if (enabled("home-monitor")) {
          const x = this.add(
            w,
            "observation",
            w.faults["wearable-disconnect"] ? "Device disconnected" : "Home activity reading",
            "wearables",
            job.patientId,
            {
              quality: w.faults["wearable-disconnect"] ? "missing" : "good",
              value: w.faults["wearable-disconnect"] ? null : 1600 + (w.nextId % 8) * 100,
              unit: "steps/day",
            },
          );
          x.status = "available";
          x.visibleTo = ["wearables", "community", "patient"];
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
          w.resources.find((x) => x.id === "robot-1")!.status = "available";
        } else {
          const cap = w.resources.find((x) => x.id === "capacity-community")!;
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
      if (name === "demand-surge" && enabled)
        for (let i = 0; i < 20; i++) {
          const item = this.add(
            w,
            "request",
            "Demand surge: new patient request",
            "triage",
            w.patients[i % w.patients.length].id,
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
        if (enabled)
          for (let i = 0; i < 8; i++) {
            const item = this.add(
              w,
              "encounter",
              "Winter-pressure A&E arrival",
              "hospital",
              w.patients[(i + 12) % w.patients.length].id,
            );
            item.status = "waiting";
            item.visibleTo = ["hospital", "ambulance", "beds"];
            this.event(w, "emergency.arrived", "scenario", item.title, item);
          }
      }
      if (name === "pharmacy-shortage") {
        for (const prescription of w.resources.filter((x) => x.kind === "prescription")) {
          prescription.data.stock = enabled ? 0 : Math.max(3, Number(prescription.data.stock ?? 0));
          prescription.version++;
        }
      }
      if (name === "pathology-outage" && !enabled)
        for (const r of w.resources.filter((x) => x.kind === "test" && x.status === "available"))
          r.visibleTo = [...new Set<SiteId>([...r.visibleTo, "gp"])];
      this.event(w, "incident", "operator", name + ": " + enabled);
      return w.faults;
    });
  }
}
