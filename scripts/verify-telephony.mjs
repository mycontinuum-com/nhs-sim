import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { telephonyServerMessageSchema } from "../packages/contracts/src/telephony.ts";

const origin = process.env.NHS_SIM_ORIGIN ?? process.env.TEST_ORIGIN ?? "http://localhost:8080";
const sockets = [];
const evidence = { origin, startedAt: new Date().toISOString(), checks: [] };
async function issue(name, site) {
  const response = await fetch(`${origin}/api/keys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamName: name, ...(site ? { site } : {}) }) });
  assert.equal(response.status, 201);
  return response.json();
}
async function connect(key, name) {
  const socket = new WebSocket(origin.replace(/^http/, "ws") + "/api/telephony/live", { origin });
  sockets.push(socket);
  const messages = [];
  const listeners = new Set();
  const client = {
    socket, messages,
    latest() { return messages.findLast(message => message.kind === "snapshot"); },
    wait(predicate, timeout = 15000) {
      const existing = messages.findLast(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`Timed out waiting for ${name}`)); }, timeout);
        const check = message => { if (predicate(message)) { clearTimeout(timer); listeners.delete(check); resolve(message); } };
        listeners.add(check);
      });
    },
    async command(command, requestId = randomUUID()) {
      socket.send(JSON.stringify({ kind: "command", requestId, command }));
      return client.wait(message => message.requestId === requestId);
    },
  };
  socket.on("message", bytes => {
    const message = telephonyServerMessageSchema.parse(JSON.parse(bytes.toString()));
    messages.push(message);
    for (const listener of listeners) listener(message);
  });
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  socket.send(JSON.stringify({ kind: "authenticate", apiKey: key, name }));
  const first = await client.wait(message => message.kind === "snapshot" || message.kind === "error");
  return { ...client, first };
}
const call = (client, id) => client.latest().calls.find(item => item.id === id);
const owned = client => client.latest().calls.find(item => item.state.kind === "active" && item.state.memberId === client.latest().memberId);
const check = description => { evidence.checks.push(description); console.log("PASS " + description); };
try {
  assert.equal((await fetch(origin + "/api/telephony/live")).status, 426);
  await new Promise((resolve, reject) => {
    const denied = new WebSocket(origin.replace(/^http/, "ws") + "/api/telephony/live", { origin: "https://other-origin.invalid" });
    sockets.push(denied);
    denied.once("open", () => reject(new Error("Cross-origin socket was accepted")));
    denied.once("error", error => { try { assert.match(error.message, /403/); resolve(); } catch (failure) { reject(failure); } });
  });
  check("WebSocket upgrade is required and foreign browser origins are rejected");
  const suffix = randomUUID().slice(0, 8);
  const team = await issue(`Telephony proof ${suffix}`);
  const other = await issue(`Telephony isolated ${suffix}`);
  const restricted = await issue(`Telephony scope ${suffix}`, "hospital");
  const alice = await connect(team.apiKey, "Alice Reception");
  assert.equal(alice.first.kind, "snapshot");
  const bob = await connect(team.apiKey, "Bob Reception");
  const stranger = await connect(other.apiKey, "Other Team");
  await alice.wait(message => message.kind === "snapshot" && message.members.length === 2);
  assert.deepEqual(alice.latest().members.map(member => member.name).sort(), ["Alice Reception", "Bob Reception"]);
  assert.deepEqual(stranger.latest().members.map(member => member.name), ["Other Team"]);
  check("connected receptionists appear only in their team room");
  for (const [key, label] of [["invalid-key", "invalid team key"], [restricted.apiKey, "missing GP scope"]]) {
    const denied = await connect(key, label);
    assert.equal(denied.first.kind, "error");
    denied.socket.close();
  }
  check("invalid keys and keys without GP scope are rejected");
  const waiting = alice.latest().calls.find(item => item.state.kind === "waiting");
  assert.ok(waiting, "seeded callers exist");
  const results = await Promise.all([alice.command({ kind: "answer", callId: waiting.id, version: waiting.version }), bob.command({ kind: "answer", callId: waiting.id, version: waiting.version })]);
  assert.deepEqual(results.map(result => result.kind).sort(), ["error", "snapshot"]);
  const winner = results[0].kind === "snapshot" ? alice : bob;
  const loser = winner === alice ? bob : alice;
  await loser.wait(message => message.kind === "snapshot" && message.calls.some(item => item.id === waiting.id && item.state.kind === "active"));
  assert.equal(call(loser, waiting.id).state.memberId, winner.latest().memberId);
  check("two simultaneous answers produce one owner and a visible conflict");
  let active = owned(winner);
  assert.equal((await loser.command({ kind: "end", callId: active.id, version: active.version })).kind, "error");
  assert.equal((await winner.command({ kind: "transfer", callId: active.id, version: active.version, targetMemberId: stranger.latest().memberId })).kind, "error");
  await loser.command({ kind: "availability", available: false });
  assert.equal((await winner.command({ kind: "transfer", callId: active.id, version: active.version, targetMemberId: loser.latest().memberId })).kind, "error");
  await loser.command({ kind: "availability", available: true });
  await loser.command({ kind: "next", callId: null, version: null, note: "" });
  assert.equal((await winner.command({ kind: "transfer", callId: active.id, version: active.version, targetMemberId: loser.latest().memberId })).kind, "error");
  const busyCall = owned(loser);
  await loser.command({ kind: "end", callId: busyCall.id, version: busyCall.version, note: "Ready for transfers" });
  check("nonowners, other teams and unavailable transfer recipients cannot take a call");
  assert.equal((await winner.command({ kind: "hold", callId: active.id, version: active.version, held: true })).kind, "snapshot");
  active = owned(winner);
  assert.equal(active.state.held, true);
  await winner.command({ kind: "hold", callId: active.id, version: active.version, held: false });
  active = owned(winner);
  const note = "Reception verification completed";
  const requestId = randomUUID();
  const nextCommand = { kind: "next", callId: active.id, version: active.version, note };
  assert.equal((await winner.command(nextCommand, requestId)).kind, "snapshot");
  const next = owned(winner);
  assert.ok(next && next.id !== active.id);
  assert.equal(call(winner, active.id).state.note, note);
  assert.equal((await winner.command(nextCommand)).kind, "error", "stale end-next must not end the new call");
  assert.equal(owned(winner).id, next.id);
  winner.socket.send(JSON.stringify({ kind: "command", requestId, command: nextCommand }));
  await winner.command({ kind: "rename", name: "Verified receptionist" });
  assert.equal(owned(winner).id, next.id);
  check("hold, resume, atomic end-and-next and duplicate/stale protection work");
  active = owned(winner);
  assert.equal((await winner.command({ kind: "transfer", callId: active.id, version: active.version, targetMemberId: loser.latest().memberId })).kind, "snapshot");
  await loser.wait(message => message.kind === "snapshot" && message.calls.some(item => item.id === active.id && item.state.kind === "active" && item.state.memberId === loser.latest().memberId));
  assert.equal(owned(loser).id, active.id);
  const departedId = loser.latest().memberId;
  loser.socket.close();
  await winner.wait(message => message.kind === "snapshot" && !message.members.some(member => member.id === departedId) && message.calls.some(item => item.id === active.id && item.state.kind === "waiting"));
  check("transfer changes ownership and disconnect returns the call to the shared queue");
  await winner.command({ kind: "next", callId: null, version: null, note: "" });
  const callback = owned(winner);
  await winner.command({ kind: "callback", callId: callback.id, version: callback.version, note: "Requested a callback" });
  const queuedCallback = winner.latest().calls.find(item => item.id !== callback.id && item.patientId === callback.patientId && item.reason.startsWith("Callback:") && item.state.kind === "waiting");
  assert.ok(queuedCallback);
  await winner.command({ kind: "answer", callId: queuedCallback.id, version: queuedCallback.version });
  assert.equal(owned(winner).patientId, callback.patientId);
  const callbackActive = owned(winner);
  await winner.command({ kind: "end", callId: callbackActive.id, version: callbackActive.version, note: "Callback completed" });
  check("callbacks return to an answerable queue for the same patient");
  const patientResponse = await fetch(`${origin}/api/sites/gp/patients?q=${encodeURIComponent(active.patientId)}`, { headers: { Authorization: `Bearer ${team.apiKey}` } });
  assert.equal(patientResponse.status, 200);
  assert.equal((await patientResponse.json()).items.find(patient => patient.id === active.patientId)?.name, active.patientName);
  const recordResponse = await fetch(`${origin}/api/sites/gp/view?patient=${encodeURIComponent(waiting.patientId)}`, { headers: { Authorization: `Bearer ${team.apiKey}` } });
  assert.equal(recordResponse.status, 200);
  const saved = await recordResponse.json();
  assert.ok(saved.resources.some(resource => resource.patientId === waiting.patientId && resource.data?.state?.note === note));
  assert.equal((await fetch(`${origin}/gp/?patient=${encodeURIComponent(active.patientId)}`)).status, 200);
  check("caller identity resolves to GP Records and completed notes persist as GP resources");
  if (process.argv.includes("--restart")) {
    for (const socket of sockets) socket.close();
    await promisify(execFile)("docker", ["compose", "restart", "app"]);
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(origin + "/healthz")).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const restored = await connect(team.apiKey, "After restart");
    assert.equal(restored.first.kind, "snapshot");
    assert.equal(call(restored, waiting.id).state.note, note);
    assert.equal(call(restored, waiting.id).state.kind, "completed");
    check("completed call and notes survive application restart from PostgreSQL");
  }
  evidence.completedAt = new Date().toISOString();
  await mkdir(".verification/evidence", { recursive: true });
  await writeFile(".verification/evidence/telephony-live.json", JSON.stringify(evidence, null, 2));
} finally {
  for (const socket of sockets) socket.close();
}
