import test from "node:test";
import assert from "node:assert/strict";
import { Engine, SimError } from "../packages/engine/src/index.ts";
import { getPlanLab, runPlanLab } from "../packages/engine/src/plan-lab.ts";
import { activeServices } from "../packages/contracts/src/index.ts";

function resource(engine: Engine, challenge: string, role: string) {
  const record = engine
    .require("default")
    .resources.find((record) => record.data.planLab === challenge && record.data.labRole === role);
  assert.ok(record, `Missing ${challenge} ${role}`);
  return record;
}
const rejectStatus = (status: number) => (error: unknown) =>
  error instanceof SimError && error.status === status;

test("plan lab reads do not seed records and starts are additive and idempotent", () => {
  const engine = new Engine();
  const original = JSON.stringify(engine.state);
  const before = getPlanLab(engine, "default");
  assert.deepEqual(
    before.challenges.map((challenge) => [challenge.id, challenge.started]),
    [
      ["discharge", false],
      ["digital", false],
      ["prevention", false],
    ],
  );
  assert.equal(JSON.stringify(engine.state), original);
  for (const challenge of ["discharge", "digital", "prevention"]) {
    runPlanLab(engine, "default", { challenge, action: "start" });
    const once = JSON.stringify(engine.state);
    runPlanLab(engine, "default", { challenge, action: "start" });
    assert.equal(JSON.stringify(engine.state), once);
  }
  const records = engine.require("default").resources.filter((record) => record.data.planLab);
  assert.ok(records.every((record) => activeServices.includes(record.owner)));
  const ids = engine.require("default").resources.map((record) => record.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("discharge checklist blocks premature readiness and uses visible workflow records", () => {
  const engine = new Engine();
  runPlanLab(engine, "default", { challenge: "discharge", action: "start" });
  assert.throws(
    () => runPlanLab(engine, "default", { challenge: "discharge", action: "complete-visit" }),
    rejectStatus(409),
  );
  assert.throws(
    () => runPlanLab(engine, "default", { challenge: "discharge", action: "check-readiness" }),
    rejectStatus(409),
  );
  runPlanLab(engine, "default", { challenge: "discharge", action: "agree-support" });
  runPlanLab(engine, "default", { challenge: "discharge", action: "collect-prescription" });
  runPlanLab(engine, "default", { challenge: "discharge", action: "complete-visit" });
  assert.throws(
    () => runPlanLab(engine, "default", { challenge: "discharge", action: "check-readiness" }),
    rejectStatus(409),
  );
  runPlanLab(engine, "default", { challenge: "discharge", action: "share-gp" });
  const result = runPlanLab(engine, "default", {
    challenge: "discharge",
    action: "check-readiness",
  });
  assert.equal(resource(engine, "discharge", "state").status, "ready");
  assert.ok(
    engine
      .view("default", "gp")
      .resources.some((record) => record.id === resource(engine, "discharge", "document").id),
  );
  assert.equal(
    engine
      .view("default", "pharmacy")
      .resources.find((record) => record.id === resource(engine, "discharge", "prescription").id)
      ?.status,
    "collected",
  );
  assert.equal(
    engine
      .view("default", "community")
      .resources.find((record) => record.id === resource(engine, "discharge", "visit").id)?.status,
    "completed",
  );
  assert.equal(
    result.challenges
      .find((challenge) => challenge.id === "discharge")
      ?.steps.filter((step) => step.done).length,
    4,
  );
  const confirmed = JSON.stringify(engine.state);
  runPlanLab(engine, "default", { challenge: "discharge", action: "check-readiness" });
  assert.equal(JSON.stringify(engine.state), confirmed);
});

test("sharing permission and withdrawal affect ordinary resource visibility and audit denied reads", () => {
  const engine = new Engine();
  runPlanLab(engine, "default", { challenge: "digital", action: "start" });
  const document = resource(engine, "digital", "document");
  const visible = () =>
    engine.view("default", "community").resources.some((record) => record.id === document.id);
  assert.equal(visible(), false);
  const denied = runPlanLab(engine, "default", { challenge: "digital", action: "read" });
  assert.equal(JSON.stringify(denied).includes(String(document.data.text)), false);
  assert.match(
    denied.challenges.find((challenge) => challenge.id === "digital")?.events[0]?.detail ?? "",
    /^Community read denied/,
  );
  runPlanLab(engine, "default", { challenge: "digital", action: "permit" });
  assert.equal(visible(), true);
  const allowed = runPlanLab(engine, "default", { challenge: "digital", action: "read" });
  assert.match(
    allowed.challenges.find((challenge) => challenge.id === "digital")?.events[0]?.detail ?? "",
    /^Community read allowed/,
  );
  runPlanLab(engine, "default", { challenge: "digital", action: "revoke" });
  assert.equal(visible(), false);
  const after = runPlanLab(engine, "default", { challenge: "digital", action: "read" });
  assert.deepEqual(after.challenges.find((challenge) => challenge.id === "digital")?.metrics, [
    { label: "Allowed read attempts", value: 1 },
    { label: "Blocked read attempts", value: 2 },
  ]);
  assert.equal(JSON.stringify(after).includes(String(document.data.text)), false);
  assert.ok(
    engine
      .events("default", "control")
      .filter((event) => event.type === "plan-lab.digital")
      .every((event) => !event.detail.includes(String(document.data.text))),
  );
});

test("prevention app-only outreach misses offline people and booking enforces two round places", () => {
  const engine = new Engine();
  runPlanLab(engine, "default", { challenge: "prevention", action: "start" });
  assert.throws(
    () =>
      runPlanLab(engine, "default", {
        challenge: "prevention",
        action: "book",
        person: "SIM-000003",
      }),
    rejectStatus(409),
  );
  runPlanLab(engine, "default", { challenge: "prevention", action: "outreach-app" });
  assert.equal(resource(engine, "prevention", "outreach-SIM-000003").status, "offered");
  assert.equal(resource(engine, "prevention", "outreach-SIM-000006").status, "not-reached");
  assert.equal(resource(engine, "prevention", "outreach-SIM-000008").status, "not-reached");
  assert.throws(
    () =>
      runPlanLab(engine, "default", {
        challenge: "prevention",
        action: "book",
        person: "SIM-000006",
      }),
    rejectStatus(409),
  );
  const once = JSON.stringify(engine.state);
  runPlanLab(engine, "default", { challenge: "prevention", action: "outreach-app" });
  assert.equal(JSON.stringify(engine.state), once);
  runPlanLab(engine, "default", { challenge: "prevention", action: "outreach-phone" });
  runPlanLab(engine, "default", { challenge: "prevention", action: "outreach-letter" });
  assert.equal(resource(engine, "prevention", "outreach-SIM-000006").status, "offered");
  assert.equal(resource(engine, "prevention", "outreach-SIM-000008").status, "offered");
  for (const person of ["SIM-000003", "SIM-000006"])
    runPlanLab(engine, "default", { challenge: "prevention", action: "book", person });
  const full = JSON.stringify(engine.state);
  assert.throws(
    () =>
      runPlanLab(engine, "default", {
        challenge: "prevention",
        action: "book",
        person: "SIM-000008",
      }),
    rejectStatus(409),
  );
  assert.equal(JSON.stringify(engine.state), full);
  runPlanLab(engine, "default", {
    challenge: "prevention",
    action: "complete",
    person: "SIM-000003",
  });
  assert.equal(resource(engine, "prevention", "appointment-SIM-000003").status, "completed");
  assert.ok(
    engine
      .view("default", "gp")
      .resources.some(
        (record) => record.id === resource(engine, "prevention", "appointment-SIM-000003").id,
      ),
  );
  assert.throws(
    () =>
      runPlanLab(engine, "default", {
        challenge: "prevention",
        action: "book",
        person: "SIM-000008",
      }),
    rejectStatus(409),
  );
  assert.throws(
    () =>
      runPlanLab(engine, "default", {
        challenge: "prevention",
        action: "complete",
        person: "SIM-000008",
      }),
    rejectStatus(409),
  );
});

test("plan lab survives serialized engine state and preserves withdrawn permission", () => {
  const engine = new Engine();
  for (const challenge of ["discharge", "digital", "prevention"])
    runPlanLab(engine, "default", { challenge, action: "start" });
  runPlanLab(engine, "default", { challenge: "digital", action: "permit" });
  runPlanLab(engine, "default", { challenge: "digital", action: "revoke" });
  runPlanLab(engine, "default", { challenge: "prevention", action: "outreach-letter" });
  runPlanLab(engine, "default", { challenge: "prevention", action: "book", person: "SIM-000008" });
  const restored = new Engine();
  restored.state = JSON.parse(JSON.stringify(engine.state));
  assert.deepEqual(getPlanLab(restored, "default"), getPlanLab(engine, "default"));
  assert.equal(
    restored
      .view("default", "community")
      .resources.some((record) => record.id === resource(restored, "digital", "document").id),
    false,
  );
  runPlanLab(restored, "default", {
    challenge: "prevention",
    action: "complete",
    person: "SIM-000008",
  });
  assert.equal(resource(restored, "prevention", "appointment-SIM-000008").status, "completed");
});

test("plan lab rejects malformed commands and unknown participants without mutations", () => {
  const engine = new Engine();
  assert.throws(
    () => runPlanLab(engine, "missing", { challenge: "digital", action: "start" }),
    rejectStatus(404),
  );
  assert.throws(
    () => runPlanLab(engine, "default", { challenge: "digital", action: "permit" }),
    rejectStatus(409),
  );
  runPlanLab(engine, "default", { challenge: "prevention", action: "start" });
  const before = JSON.stringify(engine.state);
  assert.throws(
    () => runPlanLab(engine, "default", { challenge: "prevention", action: "book" }),
    rejectStatus(400),
  );
  assert.throws(
    () =>
      runPlanLab(engine, "default", {
        challenge: "prevention",
        action: "outreach-phone",
        person: "SIM-000006",
      }),
    rejectStatus(400),
  );
  assert.throws(
    () =>
      runPlanLab(engine, "default", {
        challenge: "prevention",
        action: "book",
        person: "NOT-A-PERSON",
      }),
    rejectStatus(404),
  );
  assert.equal(JSON.stringify(engine.state), before);
});

test("discharge visits reserve capacity after agreement and return it exactly once", () => {
  for (const finish of ["lab", "workspace", "clock"]) {
    const engine = new Engine();
    const remaining = () =>
      Number(
        engine.require("default").resources.find((record) => record.id === "capacity-community")
          ?.data.remaining,
      );
    const initial = remaining();
    const started = runPlanLab(engine, "default", { challenge: "discharge", action: "start" });
    const visitId = resource(engine, "discharge", "visit").id;
    assert.equal(remaining(), initial);
    assert.equal(
      started.challenges
        .find((challenge) => challenge.id === "discharge")
        ?.actions.find((action) => action.input.action === "check-readiness")?.disabled,
      undefined,
    );
    assert.throws(
      () =>
        engine.action("default", "community", { type: "complete", resourceId: visitId }, "test"),
      rejectStatus(409),
    );
    runPlanLab(engine, "default", { challenge: "discharge", action: "agree-support" });
    assert.equal(remaining(), initial - 1);
    assert.equal(
      engine
        .require("default")
        .scheduled.filter((job) => job.resourceId === visitId && job.type === "visit").length,
      1,
    );
    runPlanLab(engine, "default", { challenge: "discharge", action: "agree-support" });
    assert.equal(remaining(), initial - 1);
    if (finish === "lab")
      runPlanLab(engine, "default", { challenge: "discharge", action: "complete-visit" });
    if (finish === "workspace")
      engine.action("default", "community", { type: "complete", resourceId: visitId }, "test");
    engine.clock("default", { advanceMinutes: 90 });
    assert.equal(resource(engine, "discharge", "visit").status, "completed");
    assert.equal(remaining(), initial);
  }
});

test("prevention appointments reserve real GP capacity and completion returns it", () => {
  const engine = new Engine();
  const remaining = () =>
    Number(
      engine.require("default").resources.find((record) => record.id === "capacity-gp")?.data
        .remaining,
    );
  const before = remaining();
  runPlanLab(engine, "default", { challenge: "prevention", action: "start" });
  runPlanLab(engine, "default", { challenge: "prevention", action: "outreach-app" });
  runPlanLab(engine, "default", { challenge: "prevention", action: "book", person: "SIM-000003" });
  assert.equal(remaining(), before - 1);
  runPlanLab(engine, "default", {
    challenge: "prevention",
    action: "complete",
    person: "SIM-000003",
  });
  assert.equal(remaining(), before);
  runPlanLab(engine, "default", {
    challenge: "prevention",
    action: "complete",
    person: "SIM-000003",
  });
  assert.equal(remaining(), before);
});

test("normal sharing actions cannot bypass the recorded digital challenge choice", () => {
  const engine = new Engine();
  runPlanLab(engine, "default", { challenge: "digital", action: "start" });
  const documentId = resource(engine, "digital", "document").id;
  assert.throws(
    () =>
      engine.action(
        "default",
        "gp",
        { type: "share_record", resourceId: documentId, target: "community" },
        "test",
      ),
    rejectStatus(409),
  );
  runPlanLab(engine, "default", { challenge: "digital", action: "permit" });
  runPlanLab(engine, "default", { challenge: "digital", action: "revoke" });
  assert.throws(
    () =>
      engine.action(
        "default",
        "gp",
        { type: "share_record", resourceId: documentId, target: "community" },
        "test",
      ),
    rejectStatus(409),
  );
  assert.equal(
    engine.view("default", "community").resources.some((record) => record.id === documentId),
    false,
  );
});
