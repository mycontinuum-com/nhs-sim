import test from "node:test";
import assert from "node:assert/strict";
import { Engine, SimError } from "../packages/engine/src/index.ts";
const worldId = "default",
  patientId = "SIM-000003";
const conflict = (error: unknown) => error instanceof SimError && error.status === 409;
function remaining(engine: Engine) {
  return Number(
    engine.require(worldId).resources.find((resource) => resource.id === "capacity-gp")?.data
      .remaining,
  );
}
const consultation = {
  type: "save_consultation",
  patientId,
  title: "Fictional follow-up",
  text: "Synthetic discussion of next steps. No clinical recommendation.",
  consultationStatus: "draft",
  mode: "telephone",
};

test("GP consultation draft survives reload, saves and edits with version checks", () => {
  const engine = new Engine();
  const draft = engine.action(worldId, "gp", consultation, "Dr Fictional", "draft-once");
  assert.equal(draft.kind, "consultation");
  assert.equal(draft.status, "draft");
  assert.equal(draft.owner, "gp");
  assert.equal(draft.patientId, patientId);
  assert.deepEqual(draft.data, {
    text: consultation.text,
    author: "Dr Fictional",
    mode: "telephone",
    recordedAt: engine.require(worldId).now,
  });
  const again = engine.action(worldId, "gp", consultation, "Dr Fictional", "draft-once");
  assert.equal(again.id, draft.id);
  const restored = new Engine();
  restored.state = JSON.parse(JSON.stringify(engine.state));
  const reloaded = restored
    .view(worldId, "gp", patientId)
    .resources.find((resource) => resource.id === draft.id);
  assert.equal(reloaded?.data.text, consultation.text);
  const saved = restored.action(
    worldId,
    "gp",
    {
      ...consultation,
      resourceId: draft.id,
      expectedVersion: 1,
      consultationStatus: "saved",
      text: "Synthetic updated encounter note.",
    },
    "Dr Editor",
    "save-once",
  );
  assert.equal(saved.version, 2);
  assert.equal(saved.status, "saved");
  assert.equal(saved.data.author, "Dr Editor");
  const before = JSON.stringify(restored.state);
  assert.throws(
    () =>
      restored.action(
        worldId,
        "gp",
        { ...consultation, resourceId: draft.id, expectedVersion: 1 },
        "Dr Editor",
      ),
    conflict,
  );
  assert.equal(JSON.stringify(restored.state), before);
  assert.throws(
    () =>
      restored.action(
        worldId,
        "gp",
        { ...consultation, text: "changed" },
        "Dr Fictional",
        "draft-once",
      ),
    conflict,
  );
});

test("consultations reject another patient, another service, invalid text and missing edit version", () => {
  const engine = new Engine(),
    draft = engine.action(worldId, "gp", consultation, "Dr Fictional");
  assert.throws(
    () =>
      engine.action(
        worldId,
        "gp",
        {
          ...consultation,
          patientId: "SIM-000004",
          resourceId: draft.id,
          expectedVersion: draft.version,
        },
        "Dr Fictional",
      ),
    conflict,
  );
  assert.throws(
    () => engine.action(worldId, "hospital", consultation, "Dr Fictional"),
    (error: unknown) => error instanceof SimError && error.status === 403,
  );
  assert.throws(() =>
    engine.action(worldId, "gp", { ...consultation, text: "  " }, "Dr Fictional"),
  );
  assert.throws(() =>
    engine.action(worldId, "gp", { ...consultation, text: "x".repeat(20001) }, "Dr Fictional"),
  );
  assert.throws(() =>
    engine.action(worldId, "gp", { ...consultation, resourceId: draft.id }, "Dr Fictional"),
  );
  const task = engine.action(
    worldId,
    "gp",
    { type: "create_task", patientId, title: "Other record" },
    "Dr Fictional",
  );
  assert.throws(
    () =>
      engine.action(
        worldId,
        "gp",
        { ...consultation, resourceId: task.id, expectedVersion: task.version },
        "Dr Fictional",
      ),
    conflict,
  );
});

test("appointment booking stores session details, rejects overlapping clinicians and permits adjacent slots", () => {
  const engine = new Engine(),
    startsAt = engine.require(worldId).now + 60 * 60000,
    initial = remaining(engine);
  const booking = {
    type: "book_appointment",
    patientId,
    startsAt,
    durationMinutes: 20,
    clinician: "Dr Test Calendar",
    mode: "video",
  };
  const first = engine.action(worldId, "gp", booking, "reception", "first-booking");
  assert.equal(first.status, "booked");
  assert.deepEqual(first.data, {
    startsAt,
    durationMinutes: 20,
    clinician: "Dr Test Calendar",
    mode: "video",
    capacityReserved: true,
  });
  assert.equal(remaining(engine), initial - 1);
  assert.equal(engine.action(worldId, "gp", booking, "reception", "first-booking").id, first.id);
  assert.equal(remaining(engine), initial - 1);
  const before = JSON.stringify(engine.state);
  assert.throws(
    () =>
      engine.action(
        worldId,
        "gp",
        {
          ...booking,
          patientId: "SIM-000004",
          startsAt: startsAt + 10 * 60000,
          clinician: "dr test calendar",
        },
        "reception",
      ),
    conflict,
  );
  assert.equal(JSON.stringify(engine.state), before);
  const adjacent = engine.action(
    worldId,
    "gp",
    { ...booking, startsAt: startsAt + 20 * 60000 },
    "reception",
  );
  assert.equal(adjacent.data.startsAt, startsAt + 20 * 60000);
  const parallel = engine.action(
    worldId,
    "gp",
    { ...booking, clinician: "Another doctor" },
    "reception",
  );
  assert.equal(parallel.data.startsAt, startsAt);
});

test("appointment arrival, completion and cancellation return reserved capacity only once", () => {
  for (const ending of ["complete", "cancel_appointment"]) {
    const engine = new Engine(),
      initial = remaining(engine);
    const booked = engine.action(
      worldId,
      "gp",
      { type: "book_appointment", patientId },
      "reception",
    );
    const arrived = engine.action(
      worldId,
      "gp",
      { type: "arrive_appointment", resourceId: booked.id, expectedVersion: 1 },
      "reception",
    );
    assert.equal(arrived.status, "arrived");
    assert.equal(remaining(engine), initial - 1);
    const final = engine.action(
      worldId,
      "gp",
      { type: ending, resourceId: booked.id, expectedVersion: 2 },
      "reception",
      "finish",
    );
    assert.equal(final.status, ending === "complete" ? "completed" : "cancelled");
    assert.equal(final.data.capacityReserved, false);
    assert.equal(remaining(engine), initial);
    engine.action(
      worldId,
      "gp",
      { type: ending, resourceId: booked.id, expectedVersion: 2 },
      "reception",
      "finish",
    );
    assert.equal(remaining(engine), initial);
    assert.throws(
      () => engine.action(worldId, "gp", { type: ending, resourceId: booked.id }, "reception"),
      conflict,
    );
    assert.equal(remaining(engine), initial);
    assert.throws(
      () =>
        engine.action(
          worldId,
          "gp",
          { type: "arrive_appointment", resourceId: booked.id },
          "reception",
        ),
      conflict,
    );
  }
});

test("unreserved appointment completion cannot create service capacity", () => {
  const engine = new Engine(),
    world = engine.require(worldId),
    initial = remaining(engine);
  const cap = world.resources.find((resource) => resource.id === "capacity-gp");
  assert.ok(cap);
  cap.data.remaining = initial - 2;
  const seeded = engine.add(
    world,
    "appointment",
    "Authored historical appointment",
    "gp",
    patientId,
    { capacityReserved: false },
  );
  engine.action(worldId, "gp", { type: "complete", resourceId: seeded.id }, "Dr Fictional");
  assert.equal(remaining(engine), initial - 2);
});

test("legacy appointment callers receive defaults and consecutive free slots", () => {
  const engine = new Engine();
  const first = engine.action(worldId, "gp", { type: "book_appointment", patientId }, "reception");
  const second = engine.action(worldId, "gp", { type: "book_appointment", patientId }, "reception");
  assert.equal(first.data.durationMinutes, 15);
  assert.equal(first.data.clinician, "Duty GP");
  assert.equal(first.data.mode, "in-person");
  assert.equal(Number(second.data.startsAt) - Number(first.data.startsAt), 15 * 60000);
  engine.action(worldId, "gp", { type: "cancel_appointment", resourceId: first.id }, "reception");
  const replacement = engine.action(
    worldId,
    "gp",
    { type: "book_appointment", patientId, startsAt: first.data.startsAt },
    "reception",
  );
  assert.equal(replacement.data.startsAt, first.data.startsAt);
  assert.throws(
    () =>
      engine.action(
        worldId,
        "gp",
        { type: "book_appointment", patientId, startsAt: engine.require(worldId).now - 1 },
        "reception",
      ),
    conflict,
  );
  assert.throws(() =>
    engine.action(
      worldId,
      "gp",
      { type: "book_appointment", patientId, durationMinutes: 0 },
      "reception",
    ),
  );
});
