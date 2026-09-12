import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { Store } from "../apps/server/src/store.ts";
import { PublicOrigins } from "../apps/server/src/origins.ts";
import { attachTelephony } from "../apps/server/src/telephony.ts";
import { telephonyServerMessageSchema } from "../packages/contracts/src/telephony.ts";

test("authenticated telephony waits for a queued join while unauthenticated sockets expire", { timeout: 15000 }, async () => {
  const store = new Store("postgres://unused:unused@localhost/unused");
  const apiKey = "telephony-delayed-join-test";
  store.keys.push({ hash: createHash("sha256").update(apiKey).digest("hex"), team: "Delayed join", world: "default", scopes: ["gp"] });
  let releaseJoin = () => {};
  let markJoining = () => {};
  const join = new Promise<void>(resolve => { releaseJoin = resolve; });
  const joining = new Promise<void>(resolve => { markJoining = resolve; });
  store.run = async fn => {
    markJoining();
    await join;
    return fn();
  };
  const server = createServer();
  const origin = "http://localhost:8080";
  const telephony = attachTelephony(server, store, new PublicOrigins(origin));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `ws://127.0.0.1:${address.port}/api/telephony/live`;
  const authenticated = new WebSocket(endpoint, { origin });
  const first = new Promise<{ kind: "message"; body: unknown } | { kind: "closed"; code: number }>((resolve, reject) => {
    authenticated.once("message", bytes => {
      try { resolve({ kind: "message", body: JSON.parse(bytes.toString()) }); }
      catch (error) { reject(error); }
    });
    authenticated.once("close", code => resolve({ kind: "closed", code }));
    authenticated.once("error", reject);
  });
  let idle: WebSocket | undefined;
  try {
    await once(authenticated, "open");
    authenticated.send(JSON.stringify({ kind: "authenticate", apiKey, name: "Waiting receptionist" }));
    await joining;
    idle = new WebSocket(endpoint, { origin });
    const expired = once(idle, "close");
    const [code, reason] = await expired;
    assert.equal(code, 1008);
    assert.equal(String(reason), "Authenticate first");
    releaseJoin();
    const received = await first;
    assert.equal(received.kind, "message", "a valid GP key must survive a join queued beyond the authentication deadline");
    if (received.kind !== "message") return;
    const snapshot = telephonyServerMessageSchema.parse(received.body);
    assert.equal(snapshot.kind, "snapshot");
    if (snapshot.kind !== "snapshot") return;
    assert.deepEqual(snapshot.members.map(member => member.name), ["Waiting receptionist"]);
    assert.equal(snapshot.calls.filter(call => call.state.kind === "waiting").length, 8);
  } finally {
    releaseJoin();
    authenticated.terminate();
    idle?.terminate();
    telephony.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await store.pool.end();
  }
});
