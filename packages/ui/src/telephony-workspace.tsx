import React, { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CheckCircle, Circle, Headset, Pause, Phone, PhoneDisconnect, Play, SkipForward, SpeakerHigh, Users, WifiHigh, WifiSlash } from "@phosphor-icons/react";
import { telephonyServerMessageSchema, type TelephonyCommand, type TelephonySnapshot, type TelephonyCall } from "../../contracts/src/telephony.ts";
import { ProductBrand } from "./product-brand.tsx";
import "./telephony-workspace.css";

function elapsed(since: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
function recordUrl(call: TelephonyCall) { return `/gp/?patient=${encodeURIComponent(call.patientId)}`; }

export function TelephonyWorkspace({ apiKey, teamName }: { apiKey: string; teamName: string }) {
  const [name, setName] = useState(() => sessionStorage.getItem("telephony-name") ?? "Receptionist");
  const [joined, setJoined] = useState(() => sessionStorage.getItem("telephony-joined") === "yes");
  const [snapshot, setSnapshot] = useState<TelephonySnapshot | null>(null);
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [note, setNote] = useState("");
  const [now, setNow] = useState(Date.now());
  const [voicesEnabled, setVoicesEnabled] = useState(false);
  const [speechState, setSpeechState] = useState("Enable caller voices to hear each patient.");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const nameRef = useRef(name);
  const recordWindow = useRef<Window | null>(null);
  const openedCall = useRef<string | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  nameRef.current = name;
  const ownCall = snapshot?.calls.find(call => call.state.kind === "active" && call.state.memberId === snapshot.memberId);
  const waiting = snapshot?.calls.filter(call => call.state.kind === "waiting").sort((a, b) => (a.state.kind === "waiting" ? a.state.queuedAt : 0) - (b.state.kind === "waiting" ? b.state.queuedAt : 0)) ?? [];
  const active = snapshot?.calls.filter(call => call.state.kind === "active") ?? [];
  const history = snapshot?.calls.filter(call => call.state.kind === "completed").slice().reverse() ?? [];
  const selected = ownCall ?? snapshot?.calls.find(call => call.id === selectedId) ?? waiting[0];
  const me = snapshot?.members.find(member => member.id === snapshot.memberId);
  const canAct = connection === "online" && !pending;

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!("speechSynthesis" in window)) { setSpeechState("Caller audio is unavailable in this browser. Read the caller's words below."); return; }
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update(); window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => { window.speechSynthesis.removeEventListener("voiceschanged", update); window.speechSynthesis.cancel(); };
  }, []);
  useEffect(() => {
    if (!joined) return;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    function connect() {
      setConnection("connecting");
      const url = new URL("/api/telephony/live", location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url); socket.current = ws;
      let receivedSnapshot = false;
      ws.onopen = () => ws.send(JSON.stringify({ kind: "authenticate", apiKey, name: nameRef.current.trim() || "Receptionist" }));
      ws.onmessage = event => {
        let value: unknown;
        try { value = JSON.parse(String(event.data)); } catch { setError("The call desk received an unreadable update."); return; }
        const parsed = telephonyServerMessageSchema.safeParse(value);
        if (!parsed.success) { setError("The call desk received an unsupported update. Refresh to reconnect."); return; }
        const message = parsed.data;
        if (message.kind === "snapshot") {
          if (!receivedSnapshot) { setError(""); receivedSnapshot = true; }
          setSnapshot(message); setConnection("online"); retry = 0;
          if (message.requestId) setPending(current => current === message.requestId ? null : current);
        } else if (message.kind === "error") {
          setError(message.message);
          if (message.requestId) setPending(current => current === message.requestId ? null : current);
        }
      };
      ws.onerror = () => setError("The connection was interrupted. Reconnecting to your team.");
      ws.onclose = event => {
        if (stopped) return;
        setConnection("offline"); setSnapshot(null); setPending(null);
        if (event.code === 1008) { setError("Unable to join reception. Check your team connection, then change your name to reconnect."); return; }
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
      };
    }
    connect();
    return () => { stopped = true; clearTimeout(timer); socket.current?.close(); socket.current = null; if (pendingTimer.current) clearTimeout(pendingTimer.current); };
  }, [apiKey, joined]);

  function send(command: TelephonyCommand) {
    if (!canAct || socket.current?.readyState !== WebSocket.OPEN) return;
    const requestId = crypto.randomUUID();
    setPending(requestId); setError("");
    socket.current.send(JSON.stringify({ kind: "command", requestId, command }));
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => setPending(current => {
      if (current === requestId) { setError("The action could not be confirmed. Reconnecting for the latest call status."); socket.current?.close(); return null; }
      return current;
    }), 10000);
  }
  function speak(call: TelephonyCall) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(call.script);
    const english = voices.filter(voice => voice.lang.toLowerCase().startsWith("en"));
    const preferred = english.filter(voice => voice.lang.toLowerCase() === "en-gb");
    const pool = preferred.length ? preferred : english;
    const seed = String(call.voiceSeed).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const voice = pool[seed % Math.max(1, pool.length)];
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-GB";
    utterance.rate = 0.91 + (seed % 5) * 0.03;
    utterance.pitch = 0.94 + (seed % 4) * 0.04;
    utterance.onstart = () => setSpeechState("Caller speaking");
    utterance.onend = () => setSpeechState("Caller finished. Replay whenever you need.");
    utterance.onerror = event => { if (event.error !== "canceled" && event.error !== "interrupted") setSpeechState("Audio could not play. Press Replay caller, or read the words below."); };
    setSpeechState("Starting caller audio. If silent, press Replay caller.");
    window.speechSynthesis.speak(utterance);
  }
  const speakingCallId = ownCall?.state.kind === "active" && !ownCall.state.held && connection === "online" ? ownCall.id : null;
  useEffect(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (voicesEnabled && speakingCallId && ownCall) speak(ownCall);
    return () => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); };
  }, [speakingCallId, voicesEnabled]);
  useEffect(() => {
    setNote("");
    if (ownCall && openedCall.current !== ownCall.id) {
      openedCall.current = ownCall.id;
      if (recordWindow.current && !recordWindow.current.closed) recordWindow.current.location.href = recordUrl(ownCall);
    }
  }, [ownCall?.id]);
  function prepareRecord(call: TelephonyCall | undefined) {
    if (!call) return;
    if (recordWindow.current && !recordWindow.current.closed) {
      recordWindow.current.location.href = recordUrl(call);
      recordWindow.current.focus();
    } else {
      recordWindow.current = window.open(recordUrl(call), "_blank");
    }
  }
  function answer(call: TelephonyCall) { send({ kind: "answer", callId: call.id, version: call.version }); }
  function next() { send({ kind: "next", callId: ownCall?.id ?? null, version: ownCall?.version ?? null, note }); }
  function enableVoices() {
    if (!("speechSynthesis" in window)) return;
    setVoicesEnabled(true);
    if (!ownCall || ownCall.state.kind !== "active" || ownCall.state.held) {
      const hello = new SpeechSynthesisUtterance("Caller voices enabled."); hello.lang = "en-GB"; window.speechSynthesis.speak(hello);
      setSpeechState("Caller voices enabled. Answer a call to listen.");
    }
  }
  function join(event: React.FormEvent) {
    event.preventDefault(); sessionStorage.setItem("telephony-name", name.trim() || "Receptionist"); sessionStorage.setItem("telephony-joined", "yes"); setJoined(true);
  }
  return <section className="telephony-workspace" aria-label="Surgery Disconnect reception desk">
    <header className="tel-header">
      <ProductBrand product="telephony" />
      <div className="tel-practice"><strong>{teamName || "Riverside Practice"}</strong><span>Reception desk</span></div>
      <div className="tel-header-date">{new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}<strong>{new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</strong></div>
      <label className="tel-availability"><Circle weight="fill" className={`tel-status tel-status-${me?.status ?? "away"}`} /><select aria-label="Your availability" disabled={!canAct || !me || me.status === "on-call"} value={me?.status ?? "available"} onChange={event => send({ kind: "availability", available: event.target.value === "available" })}><option value="available">Available</option><option value="away">Away</option><option value="on-call">On a call</option></select></label>
    </header>
    {!joined ? <form className="tel-join" onSubmit={join}><Headset size={44} /><h1>Your reception desk</h1><p>Join {teamName || "your practice"} to answer calls alongside your team.</p><label>Your name<input value={name} maxLength={60} onChange={event => setName(event.target.value)} required /></label><button className="tel-primary" type="submit">Join reception</button></form> : <>
      <div className="tel-connection" role="status">{connection === "online" ? <WifiHigh size={17} /> : <WifiSlash size={17} />}<span>{connection === "online" ? `Connected as ${me?.name ?? name}` : connection === "connecting" ? "Connecting to reception…" : "Connection lost. Reconnecting…"}</span><button onClick={() => { sessionStorage.removeItem("telephony-joined"); setJoined(false); setSnapshot(null); }}>Change name</button></div>
      {error && <div className="tel-error" role="alert">{error}<button aria-label="Dismiss message" onClick={() => setError("")}>Dismiss</button></div>}
      <div className="tel-layout">
        <aside className="tel-queue" aria-label="Call queue">
          <div className="tel-queue-heading"><h2>{tab === "queue" ? `Call queue (${waiting.length})` : `Call history (${history.length})`}</h2><span>{tab === "queue" ? "Oldest first" : "Latest first"}</span></div>
          <div className="tel-tabs"><button aria-pressed={tab === "queue"} onClick={() => setTab("queue")}>Waiting & active</button><button aria-pressed={tab === "history"} onClick={() => setTab("history")}>Answered calls</button></div>
          {(tab === "queue" ? [...waiting, ...active] : history).map(call => <button key={call.id} className={`tel-queue-call${selected?.id === call.id ? " selected" : ""}`} onClick={() => setSelectedId(call.id)} aria-pressed={selected?.id === call.id}>
            <span className="tel-phone-circle">{call.state.kind === "completed" ? <CheckCircle size={25} /> : <Phone size={25} weight="fill" />}</span>
            <span className="tel-queue-person"><strong>{call.patientName}</strong><span>{call.reason}</span><small>{call.state.kind === "waiting" ? call.phone : `${call.state.kind === "active" ? call.state.held ? "On hold" : "Answered" : "Completed"} · ${call.state.answeredBy}`}</small></span>
            <span className="tel-queue-time">{call.state.kind === "waiting" ? elapsed(call.state.queuedAt, now) : call.state.kind === "active" ? elapsed(call.state.answeredAt, now) : new Date(call.state.endedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
          </button>)}
          {!snapshot && <p className="tel-empty">Connecting to your team's call queue…</p>}
          {snapshot && !(tab === "queue" ? waiting.length + active.length : history.length) && <p className="tel-empty">{tab === "queue" ? "All caught up. New calls will appear here." : "Answered calls will appear here."}</p>}
        </aside>
        <main className="tel-main">
          <div className="tel-detail">
            {selected ? <>
              <div className="tel-caller-top"><div><p className="tel-eyebrow">{selected.state.kind === "waiting" ? "Incoming call" : selected.state.kind === "completed" ? "Call completed" : selected.state.held ? "Call on hold" : "On a call"}</p><h1>{selected.patientName}</h1><h2>{selected.reason}</h2><p className="tel-phone"><Phone size={22} weight="fill" />{selected.phone}</p></div><div className="tel-waiting"><span>{selected.state.kind === "waiting" ? "Waiting for" : "Call duration"}</span><strong>{selected.state.kind === "waiting" ? elapsed(selected.state.queuedAt, now) : elapsed(selected.state.answeredAt, selected.state.kind === "completed" ? selected.state.endedAt : now)}</strong></div></div>
              <section className="tel-patient"><div className="tel-section-heading"><h3>Matched patient</h3><span>SystemTwo patient record</span></div><div className="tel-patient-row"><span className="tel-initials">{selected.patientName.split(" ").map(part => part[0]).slice(0, 2).join("")}</span><div><strong>{selected.patientName}</strong><span>Patient ID: {selected.patientId}</span></div><a className="tel-record-link" href={recordUrl(selected)} target="SystemTwo" onClick={event => { event.preventDefault(); prepareRecord(selected); }}>Open in SystemTwo <ArrowSquareOut size={20} /></a></div></section>
              {selected.state.kind === "active" && selected.state.memberId !== snapshot?.memberId && <p className="tel-other-call"><Headset size={21} />{selected.state.answeredBy} is handling this call.</p>}
              {ownCall && <section className="tel-conversation"><div className="tel-section-heading"><h3>Caller conversation</h3><button disabled={!canAct || ownCall.state.kind !== "active" || ownCall.state.held || !("speechSynthesis" in window)} onClick={() => { setVoicesEnabled(true); speak(ownCall); }}><SpeakerHigh size={18} />Replay caller</button></div><blockquote>{ownCall.script}</blockquote><label>Call notes<textarea placeholder="Add a note for the team…" value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={2} /></label></section>}
              {selected.state.kind === "completed" && <section className="tel-conversation"><h3>Handled by {selected.state.answeredBy}</h3><p>{selected.state.note || "No call note added."}</p></section>}
            </> : <div className="tel-clear"><Headset size={48} /><h1>Ready for the next call</h1><p>Your team's incoming calls appear on the left.</p></div>}
            <section className="tel-team"><div className="tel-section-heading"><h3><Users size={21} />Reception team</h3><span>{snapshot?.members.filter(member => member.status === "available").length ?? 0} available · {snapshot?.members.length ?? 0} online</span></div>{snapshot?.members.map(member => <div className="tel-team-row" key={member.id}><Circle weight="fill" className={`tel-status tel-status-${member.status}`} /><strong>{member.name}{member.id === snapshot.memberId ? " (you)" : ""}</strong><span>{member.status === "on-call" ? `On a call${snapshot.calls.find(call => call.id === member.callId) ? ` · ${snapshot.calls.find(call => call.id === member.callId)?.patientName}` : ""}` : member.status === "available" ? "Available" : "Away"}</span>{ownCall && member.id !== snapshot.memberId && member.status === "available" && <button disabled={!canAct} onClick={() => send({ kind: "transfer", callId: ownCall.id, version: ownCall.version, targetMemberId: member.id })}>Transfer call</button>}</div>)}</section>
          </div>
          <footer className="tel-call-controls">
            <div className="tel-audio"><SpeakerHigh size={18} /><span role="status">{speechState}</span>{<button disabled={!("speechSynthesis" in window)} aria-pressed={voicesEnabled} onClick={() => { if (voicesEnabled) { window.speechSynthesis.cancel(); setVoicesEnabled(false); setSpeechState("Caller voices off. Read the caller conversation below."); } else enableVoices(); }}>{voicesEnabled ? "Turn voices off" : "Enable caller voices"}</button>}</div>
            <div className="tel-action-row">{ownCall ? <><button className="tel-secondary tel-callback" disabled={!canAct} onClick={() => send({ kind: "callback", callId: ownCall.id, version: ownCall.version, note })}>Arrange callback</button><button className="tel-secondary" disabled={!canAct} onClick={() => send({ kind: "hold", callId: ownCall.id, version: ownCall.version, held: ownCall.state.kind === "active" && !ownCall.state.held })}>{ownCall.state.kind === "active" && ownCall.state.held ? <Play size={21} /> : <Pause size={21} />}{ownCall.state.kind === "active" && ownCall.state.held ? "Resume" : "Hold"}</button><button className="tel-end" disabled={!canAct} onClick={() => send({ kind: "end", callId: ownCall.id, version: ownCall.version, note })}><PhoneDisconnect size={23} />End call</button><button className="tel-primary" disabled={!canAct} onClick={next}><SkipForward size={23} />End call & next</button></> : <><button className="tel-primary" disabled={!canAct || selected?.state.kind !== "waiting" || me?.status !== "available"} onClick={() => selected && answer(selected)}><Phone size={23} weight="fill" />Answer call</button><button className="tel-secondary" disabled={!canAct || !waiting.length || me?.status !== "available"} onClick={next}><SkipForward size={23} />Answer next</button></>}{pending && <span className="tel-saving" role="status">Updating…</span>}</div>
          </footer>
        </main>
      </div>
    </>}
  </section>;
}
