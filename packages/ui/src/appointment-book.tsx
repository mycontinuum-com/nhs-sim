import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action, Patient, Resource } from "../../contracts/src/index.ts";
import { appointmentSessionSchema, occupiesAppointmentSlot } from "../../contracts/src/appointments.ts";
import type { WorkflowApi } from "./gp-workflows.tsx";
import { RecordAttribution } from "./record-attribution.tsx";
import "./appointment-book.css";

const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);
const timeOf = (time: number) => new Date(time).toISOString().slice(11, 16);
const minutes = 60000;
const contactModes = ["in-person", "telephone", "video", "online"] as const;
type Book = { appointments: Resource[]; sessions: Resource[]; patients: Pick<Patient, "id" | "name">[] };
type Selection = { sessionId: string; startsAt: number } | null;
const occupies = (r: Resource) => occupiesAppointmentSlot(r.status);

export function AppointmentBook({ now, worldId, api, patient, selectPatient }: {
  now: number; worldId: string; api: WorkflowApi; patient?: Patient; selectPatient: (id: string) => void;
}) {
  const client = useQueryClient();
  const [day, setDay] = useState(dayOf(now));
  const [clinician, setClinician] = useState("");
  const [period, setPeriod] = useState("all");
  const [selection, setSelection] = useState<Selection>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["appointment-book", worldId, day], queryFn: () => api<Book>(`/api/sites/gp/appointments?date=${day}`), refetchInterval: 3000 });
  const mutation = useMutation({ mutationFn: (action: Action) => api<Resource>("/api/sites/gp/actions", action), onSuccess: async (record) => {
    setNotice(record.kind === "appointment-session" ? "Session updated." : `Appointment ${record.status}.`);
    setCreating(false);
    await client.invalidateQueries();
  } });
  const sessions = (query.data?.sessions ?? []).flatMap(record => {
    const parsed = appointmentSessionSchema.safeParse(record.data);
    return parsed.success ? [{ record, data: parsed.data }] : [];
  }).sort((a, b) => a.data.startsAt - b.data.startsAt);
  const appointments = query.data?.appointments ?? [];
  const names = new Map((query.data?.patients ?? []).map(p => [p.id, p.name]));
  const clinicians = [...new Set(sessions.map(s => s.data.clinician))];
  const visible = sessions.filter(s => (!clinician || s.data.clinician === clinician) && (period === "all" || (period === "am" ? timeOf(s.data.startsAt) < "12:00" : timeOf(s.data.startsAt) >= "12:00")));
  const selected = sessions.find(s => s.record.id === selection?.sessionId);
  const bookingAt = (session: typeof sessions[number], start: number) => appointments.find(r => occupies(r) && r.data.clinician === session.data.clinician && Number(r.data.startsAt) < start + session.data.slotMinutes * minutes && Number(r.data.startsAt) + Number(r.data.durationMinutes) * minutes > start);
  const booking = selected && selection ? bookingAt(selected, selection.startsAt) : undefined;
  const blocked = selected?.data.blockedSlots.find(slot => slot.startsAt === selection?.startsAt);
  const changeDay = (value: string) => { if (!value) return; setDay(value); setSelection(null); setNotice(""); };
  const extra = appointments.filter(r => !sessions.some(s => r.data.clinician === s.data.clinician && Number(r.data.startsAt) >= s.data.startsAt && Number(r.data.startsAt) < s.data.endsAt));
  return <section className="gp-appointment-book appt-book" aria-label="Appointment book">
    <header className="appt-ribbon"><div><h2>Appointment book</h2><span>Riverside Practice · Session diary · UTC</span></div><button onClick={() => { setCreating(true); setSelection(null); }}>＋ Create session</button><button onClick={() => void query.refetch()}>↻ Refresh</button><div className="appt-period" aria-label="Session period">{[["all", "All day"], ["am", "AM only"], ["pm", "PM only"]].map(([value, label]) => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value!)}>{label}</button>)}</div></header>
    <div className="appt-layout"><aside className="appt-date-panel" aria-label="Appointment date navigation">
      <div className="appt-day-controls"><button aria-label="Previous day" onClick={() => changeDay(dayOf(Date.parse(day) - 86400000))}>◀</button><strong>{new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}</strong><button aria-label="Next day" onClick={() => changeDay(dayOf(Date.parse(day) + 86400000))}>▶</button></div>
      <label>Book date<input type="date" value={day} onChange={e => changeDay(e.target.value)} /></label><MonthGrid day={day} change={changeDay} /><button className="appt-today" onClick={() => changeDay(dayOf(now))}>Today</button>
      <label>Clinician filter<select value={clinician} onChange={e => setClinician(e.target.value)}><option value="">All clinicians</option>{clinicians.map(name => <option key={name}>{name}</option>)}</select></label>
      <div className="appt-legend"><span><i className="free"/> Available</span><span><i className="booked"/> Booked</span><span><i className="arrived"/> Arrived</span><span><i className="blocked"/> Blocked</span><span><i className="completed"/> Completed</span></div>
      <p>{visible.length} sessions<br/>{appointments.filter(occupies).length} appointments</p>
    </aside><div className="appt-diary">
      {query.isError && <p role="alert">{query.error.message}</p>}{mutation.isError && <p role="alert">{mutation.error.message}</p>}{notice && <p className="appt-notice" role="status">{notice}</p>}
      {query.isPending ? <p>Loading sessions…</p> : !visible.length ? <div className="appt-empty"><h3>No sessions for this selection</h3><p>Choose another date or create a clinician session with appointment slots.</p><button onClick={() => setCreating(true)}>Create session</button></div> : <div className="appt-columns">{[...new Set(visible.map(s => s.data.clinician))].map(name => <section className="appt-clinician" key={name} aria-label={`${name} sessions`}><h3>{name}</h3>{visible.filter(s => s.data.clinician === name).map(session => {
        const slots = Array.from({ length: Math.floor((session.data.endsAt - session.data.startsAt) / (session.data.slotMinutes * minutes)) }, (_, index) => session.data.startsAt + index * session.data.slotMinutes * minutes);
        return <section className="appt-session" key={session.record.id} aria-label={session.record.title}><header><strong>{session.record.title}</strong><span>{timeOf(session.data.startsAt)}–{timeOf(session.data.endsAt)} · {session.data.location}</span><small>{session.data.slotMinutes} min · {session.data.mode}</small></header><div className="appt-slot-head"><span>Time</span><span>Patient / slot description</span></div>{slots.map(start => {
          const booked = bookingAt(session, start);
          const block = session.data.blockedSlots.find(slot => slot.startsAt === start);
          const status = booked?.status ?? (block ? "blocked" : "free");
          const label = booked ? names.get(booked.patientId ?? "") ?? booked.patientId : block ? block.reason : "Available";
          return <button key={start} className={`appt-slot appt-slot-${status}`} aria-pressed={selection?.sessionId === session.record.id && selection.startsAt === start} onClick={() => { setSelection({ sessionId: session.record.id, startsAt: start }); setCreating(false); setNotice(""); }} aria-label={`${name} ${timeOf(start)} ${label}`}><time>{timeOf(start)}</time><span><strong>{label}</strong>{booked && <small>{Number(booked.data.startsAt) < start ? "Continued · " : ""}{booked.title}</small>}</span><em>{status === "free" ? "" : status}</em></button>;
        })}</section>;
      })}</section>)}</div>}
      {extra.length > 0 && <details className="appt-unallocated"><summary>{extra.length} appointments outside session hours</summary>{extra.map(r => <p key={r.id}>{timeOf(Number(r.data.startsAt))} · {String(r.data.clinician)} · <button onClick={() => r.patientId && selectPatient(r.patientId)}>{names.get(r.patientId ?? "") ?? r.patientId}</button> · {r.title} · {r.status}</p>)}</details>}
    </div></div>
    {(creating || (selected && selection)) && <div className="appt-overlay" onClick={() => { setCreating(false); setSelection(null); }}><section className="appt-dialog" role="dialog" aria-modal="true" aria-label={creating ? "Create appointment session" : "Appointment slot"} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") { setCreating(false); setSelection(null); } }}><button className="appt-close" aria-label="Close appointment panel" onClick={() => { setCreating(false); setSelection(null); }}>×</button>
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
      {creating ? <SessionForm day={day} pending={mutation.isPending} save={action => mutation.mutate(action)}/> : selected && selection && <><header><h2>{timeOf(selection.startsAt)} · {selected.data.clinician}</h2><p>{selected.record.title} · {selected.data.location} · {selected.data.slotMinutes} minutes</p></header>{booking ? <><h3>{names.get(booking.patientId ?? "") ?? booking.patientId}</h3><p>{booking.title}</p><p>Status: <strong>{booking.status}</strong></p><RecordAttribution record={booking} history/><div className="appt-dialog-actions"><button onClick={() => { if (booking.patientId) selectPatient(booking.patientId); setSelection(null); }}>Open patient record</button>{booking.status === "booked" && <button disabled={mutation.isPending} onClick={() => mutation.mutate({ type: "arrive_appointment", resourceId: booking.id, expectedVersion: booking.version })}>Arrive</button>}{["booked", "arrived"].includes(booking.status) && <><button disabled={mutation.isPending} onClick={() => mutation.mutate({ type: "complete", resourceId: booking.id, expectedVersion: booking.version })}>Complete</button><button disabled={mutation.isPending} onClick={() => mutation.mutate({ type: "cancel_appointment", resourceId: booking.id, expectedVersion: booking.version })}>Cancel appointment</button></>}</div></> : blocked ? <><h3>Blocked slot</h3><p>{blocked.reason}</p><button disabled={mutation.isPending} onClick={() => mutation.mutate({ type: "set_appointment_slot", resourceId: selected.record.id, expectedVersion: selected.record.version, startsAt: selection.startsAt, slotCommand: "unblock" })}>Unblock slot</button></> : <SlotForm key={selected.record.id + selection.startsAt} api={api} worldId={worldId} patient={patient} past={selection.startsAt < now} pending={mutation.isPending} book={(patientId, title) => mutation.mutate({ type: "book_appointment", patientId, title, sessionId: selected.record.id, sessionVersion: selected.record.version, startsAt: selection.startsAt })} block={text => mutation.mutate({ type: "set_appointment_slot", resourceId: selected.record.id, expectedVersion: selected.record.version, startsAt: selection.startsAt, slotCommand: "block", text })}/>}</>}
    </section></div>}
  </section>;
}

function MonthGrid({ day, change }: { day: string; change: (day: string) => void }) {
  const first = new Date(day.slice(0, 7) + "-01T00:00:00Z");
  const start = first.getTime() - ((first.getUTCDay() + 6) % 7) * 86400000;
  return <div className="appt-calendar" aria-label="Choose a day">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <b key={i}>{d}</b>)}{Array.from({ length: 42 }, (_, i) => dayOf(start + i * 86400000)).map(date => <button key={date} aria-label={date} aria-pressed={date === day} className={date.slice(0, 7) === day.slice(0, 7) ? "" : "outside"} onClick={() => change(date)}>{Number(date.slice(-2))}</button>)}</div>;
}
function SlotForm({ api, worldId, patient, pending, past, book, block }: { api: WorkflowApi; worldId: string; patient?: Patient; pending: boolean; past: boolean; book: (id: string, title: string) => void; block: (reason: string) => void }) {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Pick<Patient, "id" | "name"> | undefined>(patient);
  const [reason, setReason] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const people = useQuery({ queryKey: ["slot-patients", worldId, search], queryFn: () => api<{items: Patient[]}>(`/api/sites/gp/patients?q=${encodeURIComponent(search)}`), enabled: search.trim().length > 0 });
  return <><h3>Available slot</h3>{past && <p>This slot is in the past. Choose a future slot to book.</p>}<form onSubmit={e => { e.preventDefault(); if (chosen) book(chosen.id, reason); }}><label>Find patient<input autoFocus placeholder="Name or SIM identifier" value={search} onChange={e => setSearch(e.target.value)}/></label>{search && <div className="appt-patient-results">{people.data?.items.slice(0, 8).map(p => <button type="button" key={p.id} onClick={() => { setChosen(p); setSearch(""); }}>{p.name} · {p.id}</button>)}{people.isSuccess && !people.data.items.length && <p>No matching patients.</p>}{people.isError && <p role="alert">{people.error.message}</p>}</div>}<p>{chosen ? `Booking for ${chosen.name} · ${chosen.id}` : "Select a patient to book this slot."}</p><label>Appointment reason<input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label><button disabled={!chosen || pending || past}>Book appointment</button></form><details><summary>Block this slot</summary><form onSubmit={e => { e.preventDefault(); block(blockReason); }}><label>Block reason<input required maxLength={500} value={blockReason} onChange={e => setBlockReason(e.target.value)}/></label><button disabled={pending || past}>Block slot</button></form></details></>;
}
function SessionForm({ day, pending, save }: { day: string; pending: boolean; save: (action: Action) => void }) {
  const [title, setTitle] = useState("GP surgery"); const [clinician, setClinician] = useState("Dr Maya Shah"); const [location, setLocation] = useState("Main surgery"); const [start, setStart] = useState("09:00"); const [end, setEnd] = useState("12:00"); const [slotMinutes, setSlotMinutes] = useState(15); const [mode, setMode] = useState<typeof contactModes[number]>("in-person");
  return <form onSubmit={e => { e.preventDefault(); save({ type: "create_appointment_session", title, clinician, location, startsAt: Date.parse(`${day}T${start}:00Z`), endsAt: Date.parse(`${day}T${end}:00Z`), slotMinutes, mode }); }}><h2>Create session</h2><p>{day} · Simulation time UTC</p><label>Session name<input autoFocus required value={title} onChange={e => setTitle(e.target.value)}/></label><label>Clinician<input required value={clinician} onChange={e => setClinician(e.target.value)}/></label><label>Location<input required value={location} onChange={e => setLocation(e.target.value)}/></label><div className="appt-time-fields"><label>Session starts<input type="time" required value={start} onChange={e => setStart(e.target.value)}/></label><label>Session ends<input type="time" required value={end} onChange={e => setEnd(e.target.value)}/></label><label>Slot duration<select value={slotMinutes} onChange={e => setSlotMinutes(Number(e.target.value))}>{[5,10,15,20,30,60].map(n => <option key={n} value={n}>{n} minutes</option>)}</select></label></div><label>Contact type<select value={mode} onChange={e => { const value = contactModes.find(m => m === e.target.value); if (value) setMode(value); }}>{contactModes.map(m => <option key={m}>{m}</option>)}</select></label><button disabled={pending}>Create session</button></form>;
}
