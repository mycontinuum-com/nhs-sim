import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { MockOIDC, bundle, matchAdapterPath } from "../packages/nhs-mocks/src/index.ts";
import { createHash } from "node:crypto";
import { actionSchema } from "../packages/contracts/src/index.ts";

test("home dashboard receives stored history and new readings as time advances", () => {
  const engine = new Engine();
  const world = engine.require("default");
  const readings = () =>
    world.resources.filter(
      (r) => r.owner === "wearables" && r.kind === "observation" && r.patientId === "SIM-000006",
    );
  assert.equal(readings().length, 22);
  assert.deepEqual([...new Set(readings().map((r) => r.data.unit))].sort(), [
    "bpm",
    "h",
    "steps/day",
  ]);
  assert.ok(readings().every((r) => r.createdAt <= world.now));
  engine.clock("default", { advanceMinutes: 15 });
  assert.equal(readings().length, 23);
  assert.equal(readings().at(-1)?.data.metric, "steps");
  assert.equal(readings().at(-1)?.data.quality, "good");
});

test("focused EHRs can hand over to community and hospital services", () => {
  const engine = new Engine();
  const visit = engine.action(
    "default",
    "hospital",
    actionSchema.parse({
      type: "schedule_visit",
      target: "community",
      patientId: "SIM-000001",
    }),
    "team",
  );
  assert.equal(visit.owner, "community");
  assert.equal(visit.status, "scheduled");
  engine.clock("default", { advanceMinutes: 90 });
  assert.equal(visit.status, "completed");
  const referral = engine.action(
    "default",
    "gp",
    actionSchema.parse({
      type: "create_referral",
      target: "hospital",
      patientId: "SIM-000001",
    }),
    "team",
  );
  assert.ok(referral.visibleTo.includes("hospital"));
  assert.equal(actionSchema.safeParse({ type: "create_task", target: "icb" }).success, false);
});

test("A&E backlog responds to roster staffing over time", () => {
  const normal = new Engine(),
    understaffed = new Engine();
  for (const r of understaffed
    .require("default")
    .resources.filter((r) => r.kind === "staff" && r.data.role === "doctor")) {
    understaffed.action("default", "hr", { type: "report_absence", resourceId: r.id }, "team");
  }
  normal.clock("default", { advanceMinutes: 120 });
  understaffed.clock("default", { advanceMinutes: 120 });
  assert.ok(
    understaffed.staffing(understaffed.require("default")).waiting >
      normal.staffing(normal.require("default")).waiting,
  );
});

test("one demand burst does not multiply recurring agent schedules", () => {
  const e = new Engine(),
    before = e.require("default").scheduled.length;
  e.fault("default", "demand-surge", true);
  assert.equal(e.require("default").scheduled.length, before);
  assert.equal(
    e.require("default").resources.filter((r) => r.title.startsWith("Demand surge")).length,
    20,
  );
});

test("manual visit completion is not completed a second time by logistics", () => {
  const e = new Engine();
  e.require("default").agents.find((a) => a.id === "acute-flow")!.enabled = false;
  const visit = e.action(
    "default",
    "community",
    { type: "schedule_visit", patientId: "SIM-000001" },
    "team",
  );
  e.action("default", "community", { type: "complete", resourceId: visit.id }, "team");
  const completed = e.require("default").counters.completed;
  e.clock("default", { advanceMinutes: 120 });
  assert.equal(e.require("default").counters.completed, completed);
});

test("world starts paused, seeded and deterministic", () => {
  const a = new Engine(),
    b = new Engine();
  a.tick(1000);
  assert.equal(a.require("default").now, b.require("default").now);
  a.clock("default", { advanceMinutes: 180 });
  b.clock("default", { advanceMinutes: 180 });
  assert.deepEqual(a.state, b.state);
});
test("team worlds are isolated", () => {
  const e = new Engine();
  e.create("team-a");
  e.clock("team-a", { advanceMinutes: 60 });
  assert.notEqual(e.require("team-a").now, e.require("default").now);
});
test("clock steps match incremental ticks", () => {
  const a = new Engine(),
    b = new Engine();
  a.clock("default", { advanceMinutes: 60 });
  for (let i = 0; i < 60; i++) b.clock("default", { advanceMinutes: 1 });
  assert.deepEqual(a.state, b.state);
});
test("hidden records cannot be mutated; sharing changes visibility", () => {
  const e = new Engine();
  const r = e.require("default").resources.find((r) => r.owner === "legacy")!;
  assert.equal(
    e.view("default", "gp").resources.some((x) => x.id === r.id),
    false,
  );
  assert.throws(
    () => e.action("default", "gp", { type: "review", resourceId: r.id }, "team"),
    /not visible/,
  );
  e.action("default", "legacy", { type: "share_record", resourceId: r.id, target: "gp" }, "team");
  assert.equal(
    e.view("default", "gp").resources.some((x) => x.id === r.id),
    true,
  );
});
test("test order produces delayed report and honours lab outage", () => {
  const e = new Engine();
  e.fault("default", "pathology-outage", true);
  const r = e.action("default", "gp", { type: "order_test", patientId: "SIM-000001" }, "team");
  assert.equal(r.status, "open");
  e.clock("default", { advanceMinutes: 121 });
  assert.equal(
    e.view("default", "gp").resources.some((x) => x.id === r.id),
    false,
  );
  assert.equal(
    e.view("default", "diagnostics").resources.find((x) => x.id === r.id)?.status,
    "available",
  );
  e.fault("default", "pathology-outage", false);
  assert.ok(e.view("default", "gp").resources.some((x) => x.id === r.id));
});
test("capacity rejection is atomic", () => {
  const e = new Engine();
  for (let i = 0; i < 4; i++)
    e.action("default", "gp", { type: "schedule_visit", patientId: "SIM-000001" }, "team");
  const before = structuredClone(e.state);
  assert.throws(
    () => e.action("default", "gp", { type: "schedule_visit", patientId: "SIM-000001" }, "team"),
    /capacity/,
  );
  assert.deepEqual(e.state, before);
});
test("idempotency and optimistic concurrency prevent duplicates", () => {
  const e = new Engine(),
    a = { type: "create_task", patientId: "SIM-000001", title: "Test" };
  const first = e.action("default", "gp", a, "team", "key");
  const second = e.action("default", "gp", a, "team", "key");
  assert.equal(first.id, second.id);
  assert.throws(() => e.action("default", "gp", { ...a, title: "Other" }, "team", "key"), /reused/);
  e.action("default", "gp", { type: "review", resourceId: first.id, expectedVersion: 1 }, "team");
  assert.throws(
    () =>
      e.action(
        "default",
        "gp",
        { type: "complete", resourceId: first.id, expectedVersion: 1 },
        "team",
      ),
    /Stale/,
  );
});
test("prescription lifecycle requires review then approval", () => {
  const e = new Engine(),
    r = e.action("default", "gp", { type: "draft_prescription", patientId: "SIM-000001" }, "team");
  assert.throws(
    () => e.action("default", "pharmacy", { type: "dispense", resourceId: r.id }, "team"),
    /transition/,
  );
  e.action("default", "pharmacy", { type: "review", resourceId: r.id }, "team");
  e.action("default", "pharmacy", { type: "accept", resourceId: r.id }, "team");
  e.action("default", "pharmacy", { type: "dispense", resourceId: r.id }, "team");
  e.action("default", "patient", { type: "collect", resourceId: r.id }, "team");
  assert.equal(e.require("default").resources.find((x) => x.id === r.id)?.status, "collected");
});
test("HR absence and roster affect emergency capacity", () => {
  const e = new Engine(),
    w = e.require("default");
  const initial = e.staffing(w).staffedSpaces;
  e.action("default", "hr", { type: "report_absence", resourceId: "staff-0" }, "team");
  assert.ok(e.staffing(e.require("default")).staffedSpaces < initial);
  for (const r of e
    .require("default")
    .resources.filter(
      (r) => r.kind === "staff" && r.data.role === "doctor" && r.status === "available",
    ))
    e.action("default", "roster", { type: "allocate_shift", resourceId: r.id }, "team");
  assert.equal(e.staffing(e.require("default")).staffedSpaces, 0);
  const encounter = e.require("default").resources.find((r) => r.kind === "encounter")!;
  assert.throws(
    () => e.action("default", "hospital", { type: "complete", resourceId: encounter.id }, "team"),
    /staffed/,
  );
});
test("robot dispatch has causal completion and capacity", () => {
  const e = new Engine(),
    r = e.action(
      "default",
      "pharmacy",
      { type: "dispatch_robot", patientId: "SIM-000001" },
      "team",
    );
  assert.throws(
    () =>
      e.action("default", "pharmacy", { type: "dispatch_robot", patientId: "SIM-000001" }, "team"),
    /unavailable/,
  );
  e.clock("default", { advanceMinutes: 31 });
  assert.equal(e.require("default").resources.find((x) => x.id === r.id)?.status, "completed");
});
test("winter pressure changes bed capacity and creates an acute backlog", () => {
  const e = new Engine();
  const before = e.staffing(e.require("default")).waiting;
  e.fault("default", "winter-pressure", true);
  assert.equal(
    e.require("default").resources.find((r) => r.id === "capacity-beds")?.data.remaining,
    0,
  );
  assert.equal(e.staffing(e.require("default")).waiting, before + 8);
});
test("cyber incident makes affected services read-only until restored", () => {
  const e = new Engine();
  const encounter = e.require("default").resources.find((r) => r.kind === "encounter")!;
  e.fault("default", "cyber-readonly", true);
  assert.throws(
    () => e.action("default", "hospital", { type: "complete", resourceId: encounter.id }, "team"),
    /read-only/,
  );
  e.fault("default", "cyber-readonly", false);
  assert.doesNotThrow(() =>
    e.action("default", "hospital", { type: "complete", resourceId: encounter.id }, "team"),
  );
});
test("background agents create cross-service demand and flow alerts", () => {
  const e = new Engine();
  e.fault("default", "winter-pressure", true);
  e.clock("default", { advanceMinutes: 61 });
  const generated = e.require("default").resources.filter((r) => r.data.generated === true);
  assert.equal(generated.length, 2);
  assert.ok(e.view("default", "beds").resources.some((r) => r.kind === "flow-alert"));
});
test("NHS mock bundles preserve synthetic labelling", () => {
  const b = bundle(new Engine(), "default", "pds", "SIM-000001")!;
  assert.equal(b.resourceType, "Bundle");
  assert.equal(b.entry.length, 1);
});
test("NHS adapter routes accept numeric identifiers", () => {
  assert.equal(matchAdapterPath("/api/nhs/111")?.[1], "111");
  assert.equal(matchAdapterPath("/api/nhs/eps-tracker/actions")?.[2], "actions");
});
test("CIS2 mock enforces redirect, one-time code and PKCE", async () => {
  const oidc = new MockOIDC("http://localhost:8080");
  await oidc.init();
  const verifier = "a".repeat(43),
    params = new URLSearchParams({
      client_id: "nhs-sim-client",
      redirect_uri: "http://localhost:8080/cis2/callback",
      response_type: "code",
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      state: "random-state",
      nonce: "random-nonce",
    });
  const redirect = new URL(oidc.authorize(params));
  const tokenParams = new URLSearchParams({
    client_id: "nhs-sim-client",
    redirect_uri: "http://localhost:8080/cis2/callback",
    grant_type: "authorization_code",
    code: redirect.searchParams.get("code")!,
    code_verifier: verifier,
  });
  const tokens = await oidc.token(tokenParams);
  assert.ok(tokens.id_token);
  assert.equal(oidc.userinfo(tokens.access_token).nhs_sim, true);
  await assert.rejects(() => oidc.token(tokenParams));
  params.set("redirect_uri", "https://evil.example");
  assert.throws(() => oidc.authorize(params));
});
