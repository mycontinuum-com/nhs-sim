import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { applyTelephonyCommand, releaseCalls, replenishCalls, telephonyCalls } from "../packages/engine/src/telephony.ts";
import { telephonyClientMessageSchema, type TelephonyCommand, type TelephonyMember } from "../packages/contracts/src/telephony.ts";

const alice = { id: "alice", name: "Alice" }, bob = { id: "bob", name: "Bob" };
const team: TelephonyMember[] = [alice, bob].map(member => ({ ...member, status: "available", callId: null }));
function setup() {
  const engine = new Engine();
  engine.transaction("default", world => replenishCalls(world, 1000));
  return {
    engine,
    calls: () => telephonyCalls(engine.require("default")),
    act: (command: TelephonyCommand, member = alice, peers = team) => engine.transaction("default", world => applyTelephonyCommand(world, member, peers, command, 2000)),
  };
}
test("Calls are claimed once, end-and-next is atomic, stale commands cannot end the next patient", () => {
  const { engine, calls, act } = setup();
  const first = calls()[0];
  act({ kind: "answer", callId: first.id, version: first.version });
  assert.throws(() => act({ kind: "answer", callId: first.id, version: first.version }, bob), /changed/);
  const active = calls().find(c => c.state.kind === "active"); assert.ok(active);
  const next: TelephonyCommand = { kind: "next", callId: active.id, version: active.version, note: "Booked routine appointment" };
  act(next);
  const history = calls().find(c => c.id === first.id); assert.equal(history?.state.kind, "completed");
  if (history?.state.kind === "completed") assert.equal(history.state.note, "Booked routine appointment");
  const nextCall = calls().find(c => c.state.kind === "active"); assert.ok(nextCall); assert.notEqual(nextCall.id, first.id);
  const before = engine.state;
  assert.throws(() => act(next), /changed/);
  assert.equal(engine.state, before);
  assert.equal(calls().filter(c => c.state.kind === "waiting").length, 8);
});
test("Hold, transfer, callback and disconnect preserve exact patient ownership", () => {
  const { engine, calls, act } = setup();
  act({ kind: "next", callId: null, version: null, note: "" });
  let call = calls().find(c => c.state.kind === "active"); assert.ok(call);
  act({ kind: "hold", callId: call.id, version: call.version, held: true });
  call = calls().find(c => c.id === call?.id); assert.ok(call);
  assert.equal(call.state.kind === "active" && call.state.held, true);
  const held = call;
  assert.throws(() => act({ kind: "transfer", callId: held.id, version: held.version, targetMemberId: bob.id }, alice, [{ ...team[1], status: "away" }]), /available/);
  act({ kind: "transfer", callId: call.id, version: call.version, targetMemberId: bob.id });
  call = calls().find(c => c.id === call?.id); assert.ok(call);
  assert.equal(call.state.kind === "active" && call.state.memberId, bob.id);
  assert.throws(() => act({ kind: "end", callId: call.id, version: call.version, note: "" }), /changed/);
  act({ kind: "callback", callId: call.id, version: call.version, note: "Call back later" }, bob);
  assert.ok(calls().some(c => c.patientId === call.patientId && c.reason.startsWith("Callback:") && c.state.kind === "waiting"));
  act({ kind: "next", callId: null, version: null, note: "" }, bob);
  const current = calls().find(c => c.state.kind === "active"); assert.ok(current);
  engine.transaction("default", world => releaseCalls(world, new Set([bob.id]), 3000));
  assert.equal(calls().find(c => c.id === current.id)?.state.kind, "waiting");
});
test("Calls remain isolated between worlds and recovery requeues abandoned ownership", () => {
  const { engine, calls, act } = setup();
  const call = calls()[0];
  engine.create("other", 43, 8);
  assert.throws(() => engine.transaction("other", world => applyTelephonyCommand(world, alice, team, { kind: "answer", callId: call.id, version: call.version }, 1000)), /changed/);
  act({ kind: "answer", callId: call.id, version: call.version });
  engine.transaction("default", world => releaseCalls(world, null, 4000));
  assert.equal(calls().find(c => c.id === call.id)?.state.kind, "waiting");
  assert.equal(telephonyCalls(engine.require("other")).length, 0);
});
test("Protocol rejects malformed and oversized commands", () => {
  assert.equal(telephonyClientMessageSchema.safeParse({ kind: "authenticate", apiKey: "key", name: " " }).success, false);
  assert.equal(telephonyClientMessageSchema.safeParse({ kind: "command", requestId: "a", command: { kind: "end", callId: "a", version: 0, note: "" } }).success, false);
  assert.equal(telephonyClientMessageSchema.safeParse({ kind: "command", requestId: "a", command: { kind: "end", callId: "a", version: 1, note: "x".repeat(2001) } }).success, false);
});
test("A disconnected call returns behind older waiting callers", () => {
  const { engine, calls, act } = setup();
  const first = calls()[0], second = calls()[1];
  act({ kind: "answer", callId: first.id, version: first.version });
  engine.transaction("default", world => releaseCalls(world, new Set([alice.id]), 3000));
  act({ kind: "next", callId: null, version: null, note: "" }, bob);
  assert.equal(calls().find(call => call.state.kind === "active")?.id, second.id);
});

test("Call snapshots see pending additions, ownership edits and release within one transaction", () => {
  const engine = new Engine();
  let firstId = "";
  engine.transaction("default", world => {
    replenishCalls(world, 1000);
    const first = telephonyCalls(world)[0];
    firstId = first.id;
    applyTelephonyCommand(world, alice, team, { kind: "answer", callId: first.id, version: first.version }, 2000);
    const active = telephonyCalls(world).find(call => call.id === first.id);
    assert.ok(active);
    assert.equal(active.state.kind === "active" && active.state.memberId, "alice");
    releaseCalls(world, new Set([alice.id]), 3000);
    const released = telephonyCalls(world).find(call => call.id === first.id);
    assert.ok(released);
    assert.deepEqual(released.state, { kind: "waiting", queuedAt: 3000 });
    applyTelephonyCommand(world, bob, team, { kind: "answer", callId: released.id, version: released.version }, 4000);
    assert.equal(telephonyCalls(world).filter(call => call.state.kind === "waiting").length, 8);
  });
  const calls = telephonyCalls(engine.require("default"));
  assert.equal(calls.length, 9);
  assert.equal(new Set(calls.map(call => call.id)).size, 9);
  const active = calls.find(call => call.id === firstId);
  assert.equal(active?.state.kind === "active" && active.state.memberId, "bob");
  assert.equal(active?.version, 4);
});

test("Commands and release update drafts without mutating the preceding world", () => {
  const { engine, calls, act } = setup();
  const first = calls()[0];
  const before = engine.require("default");
  act({ kind: "answer", callId: first.id, version: first.version });
  assert.equal(telephonyCalls(before).find(call => call.id === first.id)?.state.kind, "waiting");
  const answered = engine.require("default");
  assert.throws(() => engine.transaction("default", world => {
    releaseCalls(world, null, 3000);
    assert.equal(telephonyCalls(world).find(call => call.id === first.id)?.state.kind, "waiting");
    throw new Error("Discard release");
  }), /Discard release/);
  assert.equal(engine.require("default"), answered);
  assert.equal(calls().find(call => call.id === first.id)?.state.kind, "active");
});
