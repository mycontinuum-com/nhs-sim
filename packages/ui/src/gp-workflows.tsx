import { RecordAttribution } from "./record-attribution.tsx";
import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action, Patient, Resource, SiteId } from "../../contracts/src/index.ts";
import "./gp-workflows.css";

export type WorkflowApi = <T>(path: string, data?: unknown) => Promise<T>;
const modes = ["in-person", "telephone", "video", "online"] as const;
const dayString = (time: number) => new Date(time).toISOString().slice(0, 10);
const stamp = (time: number) => new Date(time).toLocaleString("en-GB", { timeZone: "UTC" });

export function Consultations({
  patient,
  rows,
  api,
  siteId,
  worldId,
}: {
  patient: Patient;
  rows: Resource[];
  api: WorkflowApi;
  siteId: SiteId;
  worldId: string;
}) {
  const client = useQueryClient();
  const storageKey = `consultation-draft:${worldId}:${siteId}:${patient.id}`;
  const [title, setTitle] = useState(() => sessionStorage.getItem(storageKey + ":title") ?? "");
  const [text, setText] = useState(() => sessionStorage.getItem(storageKey + ":text") ?? "");
  const [mode, setMode] = useState<Action["mode"]>("in-person");
  const [editing, setEditing] = useState<Resource | null>(
    () => rows.find((r) => r.id === sessionStorage.getItem(storageKey + ":record")) ?? null,
  );
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    sessionStorage.setItem(storageKey + ":title", title);
    sessionStorage.setItem(storageKey + ":text", text);
  }, [storageKey, title, text]);
  const save = useMutation({
    mutationFn: (consultationStatus: "draft" | "saved") =>
      api<Resource>(`/api/sites/${siteId}/actions`, {
        type: "save_consultation",
        patientId: patient.id,
        title,
        text,
        mode,
        consultationStatus,
        ...(editing ? { resourceId: editing.id, expectedVersion: editing.version } : {}),
      }),
    onSuccess: async (record) => {
      setEditing(record);
      sessionStorage.setItem(storageKey + ":record", record.id);
      setNotice(
        record.status === "draft"
          ? "Draft saved to your team world. You can reopen it below."
          : "Consultation saved to the patient journal.",
      );
      await client.invalidateQueries();
    },
    onError: (error) => setNotice(error.message),
  });
  const notes = rows
    .filter(
      (r) =>
        ["consultation", "encounter"].includes(r.kind) &&
        (r.title + " " + String(r.data.text ?? "")).toLowerCase().includes(filter.toLowerCase()),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <section className="gp-consultations">
      <div className="ehr-section-heading">
        <h2>
          Consultations<small>{patient.name} · saved notes and contact history</small>
        </h2>
      </div>
      <form
        className="gp-note-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate("saved");
        }}
      >
        <header>
          <h3>
            {editing
              ? `Edit ${editing.status === "draft" ? "draft" : "consultation"}`
              : "New consultation"}
          </h3>
          {editing && (
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                setEditing(null);
                sessionStorage.removeItem(storageKey + ":record");
                setTitle("");
                setText("");
                setNotice("");
              }}
            >
              New note
            </button>
          )}
        </header>
        <label>
          Consultation title
          <input
            required
            maxLength={500}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Reason for this contact"
          />
        </label>
        <label>
          Contact type
          <select
            value={mode}
            onChange={(e) => {
              const value = modes.find((m) => m === e.target.value);
              if (value) setMode(value);
            }}
          >
            {modes.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Consultation notes
          <textarea
            required
            maxLength={20000}
            rows={9}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Record the fictional encounter, the person's concerns and agreed follow-up."
          />
        </label>
        <div className="gp-form-actions">
          <button
            type="button"
            disabled={save.isPending || !title.trim() || !text.trim()}
            onClick={() => save.mutate("draft")}
          >
            Save draft
          </button>
          <button type="submit" disabled={save.isPending || !title.trim() || !text.trim()}>
            Save consultation
          </button>
        </div>
        <p role="status">
          {save.isPending
            ? "Saving consultation…"
            : notice || "Unsubmitted text is kept in this browser session for this patient."}
        </p>
      </form>
      <div className="ehr-section-heading">
        <h3>Previous contacts · {notes.length}</h3>
        <input
          aria-label="Search consultations"
          placeholder="Search titles and notes"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="gp-contact-history">
        {notes.map((r) => (
          <details key={r.id}>
            <summary>
              <strong>{r.title}</strong>
              <span>
                {stamp(r.createdAt)} · {r.status} · {String(r.data.mode ?? r.owner)}
              </span>
              <RecordAttribution record={r} />
            </summary>
            <p className="gp-note-text">
              {String(r.data.text ?? r.data.summary ?? "No narrative recorded for this contact.")}
            </p>
            <RecordAttribution record={r} history summary={false} />
            {r.kind === "consultation" && r.owner === siteId && (
              <button
                disabled={save.isPending}
                onClick={() => {
                  setEditing(r);
                  sessionStorage.setItem(storageKey + ":record", r.id);
                  setTitle(r.title);
                  setText(String(r.data.text ?? ""));
                  setNotice("");
                  const contactMode = modes.find((m) => m === r.data.mode);
                  setMode(contactMode ?? "in-person");
                }}
              >
                Open for editing
              </button>
            )}
          </details>
        ))}
        {!notes.length && <p>No matching contacts yet.</p>}
      </div>
    </section>
  );
}

export function AppointmentBook({
  now,
  api,
  patient,
  selectPatient,
}: {
  now: number;
  api: WorkflowApi;
  patient?: Patient;
  selectPatient: (id: string) => void;
}) {
  const client = useQueryClient();
  const [day, setDay] = useState(dayString(now));
  const [clinicianFilter, setClinicianFilter] = useState("");
  const [clinician, setClinician] = useState("Dr Maya Shah");
  const [time, setTime] = useState("14:00");
  const [durationMinutes, setDuration] = useState(15);
  const [mode, setMode] = useState<Action["mode"]>("in-person");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: ["appointment-book", day],
    queryFn: () =>
      api<{ appointments: Resource[]; patients: Pick<Patient, "id" | "name">[] }>(
        "/api/sites/gp/appointments?date=" + day,
      ),
    refetchInterval: 3000,
  });
  const mutation = useMutation({
    mutationFn: (input: Action) => api<Resource>("/api/sites/gp/actions", input),
    onSuccess: async () => {
      setNotice("Appointment book updated.");
      await client.invalidateQueries();
    },
    onError: (error) => setNotice(error.message),
  });
  const appointments = (query.data?.appointments ?? []).filter(
    (r) => !clinicianFilter || r.data.clinician === clinicianFilter,
  );
  const clinicians = ["Dr Maya Shah", "Dr Daniel Brooks", "Nurse Alex Morgan", "Duty GP"];
  return (
    <section className="gp-appointment-book">
      <div className="ehr-section-heading">
        <h2>
          Appointment book<small>Riverside Practice · all patients · simulation time UTC</small>
        </h2>
      </div>
      <div className="gp-book-controls">
        <label>
          Book date
          <input
            type="date"
            value={day}
            onChange={(e) => {
              if (e.target.value) setDay(e.target.value);
            }}
          />
        </label>
        <button onClick={() => setDay(dayString(now))}>Today</button>
        <label>
          Clinician filter
          <select value={clinicianFilter} onChange={(e) => setClinicianFilter(e.target.value)}>
            <option value="">All clinicians</option>
            {[
              ...new Set([
                ...clinicians,
                ...(query.data?.appointments ?? []).map((r) =>
                  String(r.data.clinician ?? "Duty GP"),
                ),
              ]),
            ].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      {query.error && <p role="alert">{query.error.message}</p>}
      <div className="ehr-table-wrap">
        <table className="ehr-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Clinician</th>
              <th>Patient / reason</th>
              <th>Contact</th>
              <th>Status / action</th>
            </tr>
          </thead>
          <tbody>
            {appointments.map((r) => (
              <tr key={r.id}>
                <td>
                  {typeof r.data.startsAt === "number"
                    ? new Date(r.data.startsAt).toISOString().slice(11, 16)
                    : "Unscheduled"}
                  <small>{String(r.data.durationMinutes ?? 15)} min</small>
                </td>
                <td>{String(r.data.clinician ?? "Duty GP")}</td>
                <td>
                  <button
                    className="ehr-record-link"
                    onClick={() => {
                      if (r.patientId) selectPatient(r.patientId);
                    }}
                  >
                    {query.data?.patients.find((p) => p.id === r.patientId)?.name ?? r.patientId}
                  </button>
                  <small>{r.title}</small>
                </td>
                <td>{String(r.data.mode ?? "in-person")}</td>
                <td>
                  <span>{r.status}</span>
                  <div className="gp-book-actions">
                    {["booked", "arrived", "scheduled", "open"].includes(r.status) && (
                      <>
                        {r.status !== "arrived" && (
                          <button
                            disabled={mutation.isPending}
                            onClick={() =>
                              mutation.mutate({
                                type: "arrive_appointment",
                                resourceId: r.id,
                                expectedVersion: r.version,
                              })
                            }
                          >
                            Arrive
                          </button>
                        )}
                        <button
                          disabled={mutation.isPending}
                          onClick={() =>
                            mutation.mutate({
                              type: "complete",
                              resourceId: r.id,
                              expectedVersion: r.version,
                            })
                          }
                        >
                          Complete
                        </button>
                        <button
                          disabled={mutation.isPending}
                          onClick={() =>
                            mutation.mutate({
                              type: "cancel_appointment",
                              resourceId: r.id,
                              expectedVersion: r.version,
                            })
                          }
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!appointments.length && (
        <p className="ehr-empty">
          {query.isPending
            ? "Loading the appointment book…"
            : "No appointments on this date for this clinician."}
        </p>
      )}
      <form
        className="gp-book-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (patient)
            mutation.mutate({
              type: "book_appointment",
              patientId: patient.id,
              title: reason,
              target: "gp",
              startsAt: Date.parse(day + "T" + time + ":00Z"),
              durationMinutes,
              clinician,
              mode,
            });
        }}
      >
        <h3>
          {patient ? "Book for " + patient.name : "Select a patient above to book an appointment"}
        </h3>
        <div className="gp-book-fields">
          <label>
            Appointment time
            <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label>
            Duration
            <select value={durationMinutes} onChange={(e) => setDuration(Number(e.target.value))}>
              {[10, 15, 20, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} minutes
                </option>
              ))}
            </select>
          </label>
          <label>
            Booking clinician
            <select value={clinician} onChange={(e) => setClinician(e.target.value)}>
              {clinicians.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Appointment contact type
            <select
              value={mode}
              onChange={(e) => {
                const value = modes.find((m) => m === e.target.value);
                if (value) setMode(value);
              }}
            >
              {modes.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            Appointment reason
            <input
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        <button disabled={!patient || mutation.isPending}>Book appointment</button>
      </form>
      <p role="status">{mutation.isPending ? "Saving appointment…" : notice}</p>
    </section>
  );
}
