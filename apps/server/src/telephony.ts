import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { telephonyClientMessageSchema, type TelephonyMember, type TelephonySnapshot, type TelephonyServerMessage } from "../../../packages/contracts/src/telephony.ts";
import { applyTelephonyCommand, releaseCalls, replenishCalls, telephonyCalls } from "../../../packages/engine/src/telephony.ts";
import type { PublicOrigins } from "./origins.ts";
import type { Store } from "./store.ts";

type Member = { id: string; name: string; available: boolean; socket: WebSocket; apiKey: string; alive: boolean; requests: Map<string, string> };
type Room = { world: string; revision: number; members: Map<string, Member> };
export function attachTelephony(server: Server, store: Store, origins: PublicOrigins) {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  const send = (socket: WebSocket, message: TelephonyServerMessage) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 1024 * 1024) { socket.close(1013, "Reconnect to refresh the call queue"); return; }
    socket.send(JSON.stringify(message));
  };
  const members = (room: Room): TelephonyMember[] => {
    const calls = telephonyCalls(store.engine.require(room.world));
    return [...room.members.values()].filter(member => member.socket.readyState === WebSocket.OPEN).map(member => {
      const call = calls.find(c => c.state.kind === "active" && c.state.memberId === member.id);
      return { id: member.id, name: member.name, status: call ? "on-call" : member.available ? "available" : "away", callId: call?.id ?? null };
    });
  };
  const capture = (room: Room) => {
    const calls = telephonyCalls(store.engine.require(room.world));
    return { calls: [...calls.filter(call => call.state.kind !== "completed"), ...calls.filter(call => call.state.kind === "completed").slice(-100)], members: members(room) };
  };
  const broadcast = (room: Room, state: Pick<TelephonySnapshot, "calls" | "members">, requester?: Member, requestId?: string) => {
    room.revision++;
    for (const member of room.members.values()) send(member.socket, { kind: "snapshot", memberId: member.id, revision: room.revision, ...state, ...(member === requester && requestId ? { requestId } : {}) });
  };
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", origins.forHost(request.headers.host));
    if (url.pathname !== "/api/telephony/live") { socket.destroy(); return; }
    if (!origins.allows(request.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
    }
    wss.handleUpgrade(request, socket, head, socket => wss.emit("connection", socket));
  });
  wss.on("connection", socket => {
    let member: Member | undefined;
    let room: Room | undefined;
    let chain: Promise<void> = Promise.resolve();
    const timeout = setTimeout(() => socket.close(1008, "Authenticate first"), 5000);
    socket.on("error", () => {});
    socket.on("pong", () => { if (member) member.alive = true; });
    socket.on("message", (raw, binary) => {
      chain = chain.then(async () => {
        let requestId: string | undefined;
        try {
          if (binary) throw new Error("Send JSON text messages");
          const message = telephonyClientMessageSchema.parse(JSON.parse(raw.toString()));
          if (message.kind === "authenticate") {
            if (member) throw new Error("Already connected");
            const key = store.authenticate(message.apiKey);
            if (!key || !key.scopes.includes("gp")) { send(socket, { kind: "error", message: "A GP team key is required" }); socket.close(1008, "A GP team key is required"); return; }
            const identity: Member = { id: randomUUID(), name: message.name, available: true, socket, apiKey: message.apiKey, alive: true, requests: new Map() };
            member = identity;
            const joined = await store.run(() => {
              const valid = store.authenticate(message.apiKey);
              if (!valid || valid.world !== key.world || !valid.scopes.includes("gp")) throw new Error("Team access has ended");
              const existing = rooms.get(key.world);
              room = existing ?? { world: key.world, revision: 0, members: new Map() };
              store.engine.transaction(key.world, world => {
                if (!existing) releaseCalls(world, null, Date.now());
                replenishCalls(world, Date.now());
              });
              rooms.set(key.world, room);
              room.members.set(identity.id, identity);
              return capture(room);
            }, key.world);
            if (!room) throw new Error("Unable to connect");
            clearTimeout(timeout);
            broadcast(room, joined);
            return;
          }
          requestId = message.requestId;
          if (!member || !room) throw new Error("Authenticate first");
          const currentMember = member, currentRoom = room;
          const signature = JSON.stringify(message.command);
          const state = await store.run(() => {
            const key = store.authenticate(currentMember.apiKey);
            if (!key || key.world !== currentRoom.world || !key.scopes.includes("gp")) { socket.close(1008, "Team access has ended"); throw new Error("Team access has ended"); }
            const previous = currentMember.requests.get(message.requestId);
            if (previous && previous !== signature) throw new Error("Request ID was already used");
            if (!previous && (message.command.kind === "availability" || message.command.kind === "rename")) {
              if (message.command.kind === "availability") currentMember.available = message.command.available;
              else currentMember.name = message.command.name;
            } else if (!previous) {
              store.engine.transaction(currentRoom.world, world => {
                replenishCalls(world, Date.now());
                applyTelephonyCommand(world, currentMember, members(currentRoom), message.command, Date.now());
              });
            }
            return capture(currentRoom);
          }, currentRoom.world);
          const previous = currentMember.requests.get(message.requestId);
          if (!previous) {
            currentMember.requests.set(message.requestId, signature);
            if (currentMember.requests.size > 200) currentMember.requests.delete(currentMember.requests.keys().next().value ?? "");
          }
          broadcast(currentRoom, state, currentMember, message.requestId);
        } catch (error) {
          send(socket, { kind: "error", ...(requestId ? { requestId } : {}), message: error instanceof Error ? error.message : "Call action failed" });
          if (!requestId) socket.close(1008, "Connection could not be authenticated");
        }
      });
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      chain = chain.then(async () => {
        if (!member || !room) return;
        const departed = member, currentRoom = room;
        const state = await store.run(() => {
          if (!store.engine.get(currentRoom.world)) return null;
          store.engine.transaction(currentRoom.world, world => releaseCalls(world, new Set([departed.id]), Date.now()));
          return capture(currentRoom);
        }, currentRoom.world);
        currentRoom.members.delete(departed.id);
        if (!currentRoom.members.size) rooms.delete(currentRoom.world);
        else if (state) broadcast(currentRoom, state);
      }).catch(() => { socket.terminate(); });
    });
  });
  let checking = false;
  const heartbeat = setInterval(() => {
    if (checking) return;
    checking = true;
    const checks = [...rooms.values()].map(async room => {
      for (const member of room.members.values()) {
        const key = store.authenticate(member.apiKey);
        if (member.socket.readyState !== WebSocket.OPEN || !key || key.world !== room.world || !key.scopes.includes("gp") || !store.engine.get(room.world) || !member.alive) { member.socket.terminate(); continue; }
        member.alive = false;
        member.socket.ping();
      }
      const state = await store.run(() => {
        if (!store.engine.get(room.world)) return null;
        const connected = new Set([...room.members.values()].filter(member => member.socket.readyState === WebSocket.OPEN).map(member => member.id));
        const orphanOwners = new Set(telephonyCalls(store.engine.require(room.world)).flatMap(call => call.state.kind === "active" && !connected.has(call.state.memberId) ? [call.state.memberId] : []));
        store.engine.transaction(room.world, world => {
          releaseCalls(world, orphanOwners, Date.now());
          if (connected.size) replenishCalls(world, Date.now());
        });
        return capture(room);
      }, room.world);
      for (const member of room.members.values()) if (member.socket.readyState !== WebSocket.OPEN) room.members.delete(member.id);
      if (!room.members.size) rooms.delete(room.world);
      else if (state) broadcast(room, state);
    });
    void Promise.allSettled(checks).finally(() => { checking = false; });
  }, 15000);
  heartbeat.unref();
  return { close() { clearInterval(heartbeat); for (const socket of wss.clients) socket.terminate(); wss.close(); } };
}
