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
  newNoteRequest,
}: {
  patient: Patient;
  rows: Resource[];
  api: WorkflowApi;
  siteId: SiteId;
  worldId: string;
  newNoteRequest?: { id: number; patientId: string };
}) {
  const client = useQueryClient();
  const storageKey = `consultation-draft:${worldId}:${siteId}:${patient.id}`;
  const [title, setTitle] = useState(() => sessionStorage.getItem(storageKey + ":title") ?? "");
  const [text, setText] = useState(() => sessionStorage.getItem(storageKey + ":text") ?? "");
  const [mode, setMode] = useState<Action["mode"]>(() => {
    const saved = sessionStorage.getItem(storageKey + ":mode");
    const record = rows.find((r) => r.id === sessionStorage.getItem(storageKey + ":record"));
    return modes.find((value) => value === (saved ?? record?.data.mode)) ?? "in-person";
  });
  const [editing, setEditing] = useState<Resource | null>(
    () => rows.find((r) => r.id === sessionStorage.getItem(storageKey + ":record")) ?? null,
  );
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    sessionStorage.setItem(storageKey + ":title", title);
    sessionStorage.setItem(storageKey + ":text", text);
    sessionStorage.setItem(storageKey + ":mode", mode ?? "in-person");
  }, [storageKey, title, text, mode]);
  function newNote() {
    setEditing(null);
    sessionStorage.removeItem(storageKey + ":record");
    setTitle("");
    setText("");
    setMode("in-person");
    setNotice("");
  }
  useEffect(() => {
    if (
      newNoteRequest?.patientId === patient.id &&
      sessionStorage.getItem(storageKey + ":new-request") !== String(newNoteRequest.id)
    ) {
      sessionStorage.setItem(storageKey + ":new-request", String(newNoteRequest.id));
      newNote();
    }
  }, [storageKey, patient.id, newNoteRequest]);
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
              onClick={newNote}
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

export { AppointmentBook } from "./appointment-book.tsx";
