import React, { useMemo, useState } from "react";
import { z } from "zod";
import type { Action, Patient, Resource, SiteId } from "../../contracts/src/index.ts";

type View = {
  now: number;
  resources: Resource[];
  staffing: { doctors: number; nurses: number; staffedSpaces: number; waiting: number };
  faults?: Record<string, boolean>;
};
type Props = {
  siteId: SiteId;
  view: View;
  rows: Resource[];
  patients: Patient[];
  selectedPatient: string;
  patientSearch: string;
  searchPatients: (query: string) => void;
  selectPatient: (id: string) => void;
  act: (type: Action["type"], resource: Resource, target?: SiteId) => void;
  create: (type: Action["type"], patientId: string, title: string, target?: SiteId) => void;
  pending: boolean;
};

const statusAction = (r: Resource): Action["type"] | undefined => {
  if (["open", "draft", "available"].includes(r.status)) return "review";
  if (["reviewed", "rejected"].includes(r.status)) return "accept";
  if (["accepted", "scheduled", "waiting"].includes(r.status)) return "complete";
};
const age = (dob: string) => Math.floor((Date.now() - Date.parse(dob)) / 31_557_600_000);
const initials = (name: string) =>
  name
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2);
const value = (r: Resource, key: string, fallback = "—") => String(r.data[key] ?? fallback);

function PatientBanner({ patient }: { patient?: Patient }) {
  if (!patient)
    return (
      <div className="patient-banner empty">Select a synthetic patient to open their record</div>
    );
  return (
    <div className="patient-banner">
      <span className="patient-avatar">{initials(patient.name)}</span>
      <div>
        <strong>{patient.name}</strong>
        <small>
          {patient.id} · {age(patient.birthDate)} years · NHS no. 999 000 0000
        </small>
      </div>
      <div>
        <b>Alerts</b>
        <span>{patient.needs[0] ?? "None recorded"}</span>
      </div>
      <div>
        <b>Problems</b>
        <span>{patient.conditions.join(", ")}</span>
      </div>
      <mark>SYNTHETIC</mark>
    </div>
  );
}

function RecordButton({
  r,
  act,
  pending,
  label,
}: Pick<Props, "act" | "pending"> & { r: Resource; label?: string }) {
  const next = statusAction(r);
  return next ? (
    <button disabled={pending} onClick={() => act(next, r)}>
      {label ?? next[0].toUpperCase() + next.slice(1)}
    </button>
  ) : (
    <span className="done-mark">✓ {r.status}</span>
  );
}

function SystemTwo({
  rows,
  patients,
  selectedPatient,
  selectPatient,
  act,
  create,
  pending,
}: Props) {
  const [tab, setTab] = useState("Overview");
  const patient = patients.find((p) => p.id === selectedPatient) ?? patients[0];
  const visible = rows.filter((r) => !patient || !r.patientId || r.patientId === patient.id);
  const recordKinds: Record<string, string[]> = {
    Observations: ["observation"],
    Results: ["test", "report"],
    Medications: ["prescription"],
    "Care plan": ["care-plan", "task"],
    Discharge: ["document", "discharge"],
  };
  const tabRows = visible.filter((r) => !recordKinds[tab] || recordKinds[tab].includes(r.kind));
  const [note, setNote] = useState("");
  return (
    <section className="system-ui systemtwo">
      <div className="system-bar">
        <strong>
          <i>◈</i> SystemTwo EPR
        </strong>
        <input
          aria-label="Find a patient"
          placeholder="Search patients…"
          onChange={(e) => {
            const p = patients.find((x) =>
              x.name.toLowerCase().includes(e.target.value.toLowerCase()),
            );
            if (p) selectPatient(p.id);
          }}
        />
        <span>Ward D4 · Dr A. Cole</span>
      </div>
      <PatientBanner patient={patient} />
      <div className="tab-strip">
        {[
          "Overview",
          "Timeline",
          "Observations",
          "Results",
          "Medications",
          "Care plan",
          "Discharge",
        ].map((x) => (
          <button className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>
            {x}
          </button>
        ))}
      </div>
      <div className="epr-layout">
        <div className="clinical-grid">
          <article>
            <h3>Current problems</h3>
            {patient?.conditions.map((x, i) => (
              <p className="problem" key={x}>
                <b>{i + 1}</b>
                <span>
                  {x}
                  <small>Active · recorded problem</small>
                </span>
              </p>
            ))}
          </article>
          <article>
            <h3>Latest observations</h3>
            {visible.filter((r) => r.kind === "observation").length ? (
              visible
                .filter((r) => r.kind === "observation")
                .slice(0, 3)
                .map((r) => (
                  <p key={r.id}>
                    <b>{r.title}</b>
                    <small>{r.status}</small>
                  </p>
                ))
            ) : (
              <p>No observations recorded for this patient.</p>
            )}
          </article>
          <article className="wide">
            <h3>{tab}</h3>
            {tabRows.slice(0, 12).map((r) => (
              <div className="clinical-row" key={r.id}>
                <time>{new Date(r.createdAt).toISOString().slice(11, 16)}</time>
                <span>
                  <b>{r.title}</b>
                  <small>
                    {r.kind} · {r.owner} · version {r.version}
                  </small>
                </span>
                <span className={"status " + r.status}>{r.status}</span>
                <RecordButton r={r} act={act} pending={pending} />
              </div>
            ))}
            {!tabRows.length && <p>No records in this view.</p>}
          </article>
          <article className="wide quick-note">
            <h3>Add clinical note</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (patient && note) {
                  create("create_task", patient.id, note);
                  setNote("");
                }
              }}
            >
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Document a plan or create a follow-up task"
              />
              <button disabled={!note || pending}>Save note</button>
            </form>
          </article>
        </div>
      </div>
    </section>
  );
}

function Pingr({ rows, patients, selectedPatient, selectPatient, create, pending }: Props) {
  const threads = rows.filter((r) => ["message", "request", "task", "handover"].includes(r.kind));
  const [selected, setSelected] = useState(threads[0]?.id ?? "");
  const [text, setText] = useState("");
  const thread = threads.find((r) => r.id === selected) ?? threads[0];
  const patient =
    patients.find((p) => p.id === (selectedPatient || thread?.patientId)) ?? patients[0];
  const send = () => {
    if (text && patient) {
      create("send_message", patient.id, text);
      setText("");
    }
  };
  return (
    <section className="system-ui pingr">
      <div className="system-bar">
        <strong>
          <i>↘</i> Pingr
        </strong>
        <input placeholder="Search people, teams or messages…" />
        <span className="presence">● Available</span>
        <span>Dr A. Cole⌄</span>
      </div>
      <div className="message-layout">
        <aside className="channels">
          <b>Channels</b>
          {[
            "All unreads",
            "General",
            "Respiratory",
            "Discharge & flow",
            "Pharmacy",
            "Radiology",
            "Site team",
            "Social care",
          ].map((x, i) => (
            <button key={x}>
              <span># {x}</span>
              {i < 5 && <em>{[12, 3, 1, 4, 1][i]}</em>}
            </button>
          ))}
          <b>Direct messages</b>
          {patients.slice(0, 5).map((p) => (
            <button key={p.id} onClick={() => selectPatient(p.id)}>
              <span className="mini-avatar">{initials(p.name)}</span>
              {p.name}
            </button>
          ))}
        </aside>
        <div className="threads">
          <h2>
            Inbox <small>{threads.length} active conversations</small>
          </h2>
          {threads.map((r, i) => (
            <button
              className={r.id === thread?.id ? "active" : ""}
              onClick={() => {
                setSelected(r.id);
                if (r.patientId) selectPatient(r.patientId);
              }}
              key={r.id}
            >
              <span className="mini-avatar">
                {initials(patients.find((p) => p.id === r.patientId)?.name ?? "System")}
              </span>
              <span>
                <b>{r.title}</b>
                <small>
                  {patients.find((p) => p.id === r.patientId)?.name ?? "Operations"} · {i + 2}m
                </small>
              </span>
              <em>{r.status}</em>
            </button>
          ))}
        </div>
        <div className="conversation">
          <header>
            <div>
              <b>#{thread?.kind ?? "general"}</b>
              <small>{patient?.name ?? "No patient context"}</small>
            </div>
            <span>☆ ⓘ</span>
          </header>
          <div className="messages">
            <p className="date-rule">Today</p>
            <div className="bubble">
              <span className="mini-avatar">AC</span>
              <p>
                <b>
                  Dr A. Cole <time>10:02</time>
                </b>
                {thread?.title ?? "Can the team review this patient?"}
              </p>
            </div>
            <div className="bubble">
              <span className="mini-avatar nurse">NW</span>
              <p>
                <b>
                  N. Wilson <time>10:04</time>
                </b>
                I’ve reviewed the shared synthetic record. I’ll update the task when the next step
                is confirmed.
              </p>
            </div>
            <div className="bubble">
              <span className="mini-avatar pharmacy">JP</span>
              <p>
                <b>
                  J. Patel <time>10:08</time>
                </b>
                Thanks — checking availability now. Please keep this channel linked to the patient.
              </p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message this care team…"
            />
            <button disabled={!text || pending}>Send</button>
          </form>
        </div>
        <aside className="context">
          <h3>Patient context</h3>
          <PatientBanner patient={patient} />
          <button onClick={() => patient && location.assign("/hospital/?patient=" + patient.id)}>
            Open in SystemTwo
          </button>
          <button onClick={() => patient && location.assign("/gp/?patient=" + patient.id)}>
            Open GP record
          </button>
          <h3>Shared tasks</h3>
          {rows
            .filter((r) => r.patientId === patient?.id)
            .slice(0, 4)
            .map((r) => (
              <p key={r.id}>
                <b>{r.title}</b>
                <small>
                  {r.owner} · {r.status}
                </small>
              </p>
            ))}
        </aside>
      </div>
    </section>
  );
}

const ehrRecordSchema = z.object({
  provenance: z.literal("ehr-collection-shape-v1"),
  problems: z.array(
    z.object({ term: z.string(), code: z.string(), date: z.string(), status: z.string() }),
  ),
  medications: z.array(
    z.object({ term: z.string(), isCurrent: z.boolean(), issueDate: z.string() }),
  ),
  allergies: z.array(z.object({ term: z.string() })),
  miscCodes: z.array(z.object({ term: z.string(), code: z.string() })),
});

function RecordCollection({
  title,
  entries,
}: {
  title: string;
  entries: { title: string; detail: string }[];
}) {
  return (
    <details className="record-collection">
      <summary>
        {title}
        <span>{entries.length}</span>
      </summary>
      {entries.length ? (
        <ul>
          {entries.slice(0, 30).map((entry, index) => (
            <li key={index}>
              <b>{entry.title}</b>
              <small>{entry.detail}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>No entries recorded.</p>
      )}
      {entries.length > 30 && (
        <p>Showing the first 30 entries. The full record is available through the API.</p>
      )}
    </details>
  );
}

function LongitudinalRecord({ rows, patientId }: { rows: Resource[]; patientId: string }) {
  const resources = rows.filter((r) => r.patientId === patientId);
  const record = resources.find((r) => r.kind === "ehr-record");
  const parsed = ehrRecordSchema.safeParse(record?.data);
  const timeline = resources
    .filter((r) => r.kind !== "ehr-record")
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <section className="longitudinal-record" aria-label="Longitudinal GP record">
      <h3>Longitudinal record</h3>
      <p>Fictional entries and dates. Collection sizes follow the calibrated synthetic profile.</p>
      {parsed.success ? (
        <>
          <RecordCollection
            title="Problems"
            entries={parsed.data.problems.map((entry) => ({
              title: entry.term,
              detail: `${entry.date} · ${entry.status} · ${entry.code}`,
            }))}
          />
          <RecordCollection
            title="Medications"
            entries={parsed.data.medications.map((entry) => ({
              title: entry.term,
              detail: `${entry.issueDate} · ${entry.isCurrent ? "Current" : "Historical"}`,
            }))}
          />
          <RecordCollection
            title="Allergies"
            entries={parsed.data.allergies.map((entry) => ({
              title: entry.term,
              detail: "Synthetic allergy entry",
            }))}
          />
          <RecordCollection
            title="Other coded entries"
            entries={parsed.data.miscCodes.map((entry) => ({
              title: entry.term,
              detail: entry.code,
            }))}
          />
        </>
      ) : (
        <p>
          {record ? "This record could not be displayed." : "No structured record is available."}
        </p>
      )}
      <details className="record-collection">
        <summary>
          Recent history<span>{timeline.length}</span>
        </summary>
        {timeline.length ? (
          <ol>
            {timeline.slice(0, 20).map((entry) => (
              <li key={entry.id}>
                <time>{new Date(entry.createdAt).toISOString().slice(0, 10)}</time>
                <b>{entry.title}</b>
                <small>
                  {entry.kind} · {entry.status}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p>No events recorded.</p>
        )}
        {timeline.length > 20 && <p>Showing the 20 most recent events.</p>}
      </details>
    </section>
  );
}

function PrimaryCare({
  siteId,
  patientSearch,
  searchPatients,
  rows,
  patients,
  selectedPatient,
  selectPatient,
  act,
  pending,
}: Props) {
  const [filter, setFilter] = useState("All");
  const filtered = rows.filter(
    (r) =>
      !["ehr-record", "encounter", "observation"].includes(r.kind) &&
      (filter === "All" ||
        (filter === "Urgent" && r.priority === "urgent") ||
        (filter === "Open" && ["open", "rejected", "waiting"].includes(r.status))),
  );
  const active = patients.find((p) => p.id === selectedPatient);
  const title =
    siteId === "referrals"
      ? "Referral inbox"
      : siteId === "urgent"
        ? "Disposition queue"
        : siteId === "triage"
          ? "Triage inbox"
          : "Today at Riverside";
  return (
    <section className={"system-ui primary-desk " + siteId}>
      <div className="system-bar">
        <strong>
          Riverside <i>Practice</i>
        </strong>
        <span>Care together, closer to home</span>
        <input
          aria-label="Search patient record"
          placeholder="Search patient record…"
          value={patientSearch}
          onChange={(e) => {
            searchPatients(e.target.value);
            selectPatient("");
          }}
        />
        <span>Dr A. Cole · AC</span>
      </div>
      {patientSearch && !selectedPatient && (
        <div className="patient-search-results" aria-label="Patient search results">
          {patients.slice(0, 8).map((p) => (
            <button key={p.id} onClick={() => selectPatient(p.id)}>
              {p.name}
              <small>
                {p.id} · {p.birthDate}
              </small>
            </button>
          ))}
          {!patients.length && <p>No matching patients.</p>}
        </div>
      )}
      <div className="practice-layout">
        <div className="inbox">
          <header>
            <div>
              <h2>{title}</h2>
              <div className="segmented">
                {["All", "Open", "Urgent"].map((x) => (
                  <button
                    className={filter === x ? "active" : ""}
                    onClick={() => setFilter(x)}
                    key={x}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>
          </header>
          <table>
            <thead>
              <tr>
                <th>Priority</th>
                <th>Patient</th>
                <th>Request / reason</th>
                <th>Received</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((r) => {
                const p = patients.find((x) => x.id === r.patientId);
                return (
                  <tr
                    className={selectedPatient === p?.id ? "selected" : ""}
                    onClick={() => r.patientId && selectPatient(r.patientId)}
                    key={r.id}
                  >
                    <td>
                      <span className={"priority " + r.priority}>{r.priority}</span>
                    </td>
                    <td>
                      <button
                        className="patient-record-link"
                        onClick={() => r.patientId && selectPatient(r.patientId)}
                        disabled={!r.patientId}
                      >
                        {p?.name ?? r.patientId ?? "System"}
                      </button>
                      <small>{p ? age(p.birthDate) + "y" : ""}</small>
                    </td>
                    <td>
                      <b>{r.title}</b>
                      <small>
                        {r.kind} · {r.owner}
                      </small>
                    </td>
                    <td>{new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td>
                      <span className={"status " + r.status}>{r.status}</span>
                    </td>
                    <td>
                      <RecordButton r={r} act={act} pending={pending} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > 200 && (
            <p className="worklist-limit">
              Showing 200 of {filtered.length.toLocaleString()} items. Search for a patient to focus
              the worklist.
            </p>
          )}
          {!filtered.length && (
            <p className="worklist-limit">
              No worklist items match this view. Search for a patient to open their record.
            </p>
          )}
        </div>
        {active && (
          <aside className="record-drawer">
            <button aria-label="Close patient record" onClick={() => selectPatient("")}>
              ×
            </button>
            <PatientBanner patient={active} />
            <LongitudinalRecord rows={rows} patientId={active.id} />
            <h3>Care navigation</h3>
            <p>{active.goals.join(" · ")}</p>
            <h3>Access needs</h3>
            <p>{active.needs.join(", ")}</p>
            <a href={"/hospital/?patient=" + active.id}>Open hospital record →</a>
          </aside>
        )}
      </div>
    </section>
  );
}

function EmergencyBoard({ rows, patients, view, act, pending }: Props) {
  const live = rows.filter((r) => ["handover", "encounter", "flow-alert", "bed"].includes(r.kind));
  return (
    <section className="system-ui emergency-board">
      <div className="system-bar">
        <strong>⌁ CAD-astrophe</strong>
        <span>Emergency Department Command & Control</span>
        <time>{new Date(view.now).toISOString().slice(11, 16)}</time>
        <mark>
          {view.staffing.waiting} patients waiting · {view.staffing.staffedSpaces} staffed spaces
        </mark>
      </div>
      <div className="ed-tabs">
        <button className="active">Live board</button>
        <button>Arrivals</button>
        <button>Cubicles</button>
        <button>Diagnostics</button>
        <button>Transfers</button>
        <button>Discharges</button>
      </div>
      <div className="ed-layout">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Patient</th>
              <th>Age</th>
              <th>Presenting problem</th>
              <th>Triage</th>
              <th>Flow</th>
              <th>Location</th>
              <th>Wait</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {live.map((r, i) => {
              const p = patients.find((x) => x.id === r.patientId);
              return (
                <tr key={r.id}>
                  <td>ED{String(i + 1).padStart(3, "0")}</td>
                  <td>{p?.name ?? "Unmatched"}</td>
                  <td>{p ? age(p.birthDate) : "—"}</td>
                  <td>{r.title}</td>
                  <td>
                    <span className={"triage t" + ((i % 4) + 1)}>{(i % 4) + 1}</span>
                  </td>
                  <td>→</td>
                  <td>{r.kind === "bed" ? r.title : "Cubicle " + (i + 2)}</td>
                  <td className="timer">
                    {String(i).padStart(2, "0")}:{12 + i * 9}
                  </td>
                  <td>
                    <RecordButton r={r} act={act} pending={pending} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <aside>
          <h3>ED today</h3>
          {[
            ["Arrivals", 102],
            ["Seen", 78],
            ["Waiting", view.staffing.waiting],
            ["> 4 hours", 12],
            ["Admitted", 28],
          ].map(([x, n]) => (
            <p key={x}>
              <span>{x}</span>
              <b>{n}</b>
            </p>
          ))}
          <h3>Cubicle status</h3>
          <div className="cubicles">
            <span>
              Resus <b>3/4</b>
            </span>
            <span>
              Majors <b>{view.staffing.staffedSpaces}/12</b>
            </span>
            <span>
              Minors <b>6/10</b>
            </span>
          </div>
          <h3>Staffing</h3>
          <p>
            <span>Doctors / nurses</span>
            <b>
              {view.staffing.doctors}/{view.staffing.nurses}
            </b>
          </p>
        </aside>
      </div>
    </section>
  );
}

function Workforce({ siteId, rows, view, act, pending }: Props) {
  const staff = rows.filter((r) => r.kind === "staff");
  const days = ["Mon 14", "Tue 15", "Wed 16", "Thu 17", "Fri 18", "Sat 19", "Sun 20"];
  return (
    <section className={"system-ui workforce " + siteId}>
      <div className="system-bar">
        <strong>{siteId === "hr" ? "ES-Arrr People" : "Allocate-ish"}</strong>
        <span>
          {siteId === "hr" ? "Electronic Staff Record-ish" : "Right people. Better care."}
        </span>
        <span>Northbank Trust · Ward D4</span>
      </div>
      <div className="purple-tabs">
        {["Rostering", "Annual leave", "Bank", "Reports", "Staff", "Settings"].map((x, i) => (
          <button className={i === 0 ? "active" : ""} key={x}>
            {x}
          </button>
        ))}
      </div>
      <div className="roster-layout">
        <div className="roster">
          <header>
            <div className="segmented">
              <button className="active">Week</button>
              <button>Month</button>
            </div>
            <b>14 – 20 September 2026</b>
            <button>Today</button>
          </header>
          <table>
            <thead>
              <tr>
                <th>Staff member</th>
                {days.map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.title}</b>
                    <small>{value(r, "role")}</small>
                  </td>
                  {days.map((d, j) => (
                    <td key={d}>
                      <button
                        onClick={() => act("allocate_shift", r)}
                        className={r.data.allocated && j < 5 ? "shift" : "gap"}
                      >
                        {r.status === "absent"
                          ? "ABS"
                          : r.data.allocated && j < 5
                            ? j % 2
                              ? "08–16"
                              : "08–20"
                            : "+"}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside>
          <h3>Live staffing</h3>
          <div className="staff-ring">
            <b>{view.staffing.staffedSpaces}</b>
            <span>A&E spaces</span>
          </div>
          <p>
            <span>Doctors</span>
            <b>{view.staffing.doctors}</b>
          </p>
          <p>
            <span>Nurses</span>
            <b>{view.staffing.nurses}</b>
          </p>
          <h3>Live gaps</h3>
          {staff
            .filter((r) => r.status === "absent" || !r.data.allocated)
            .map((r) => (
              <button
                onClick={() => act(r.status === "absent" ? "restore_staff" : "allocate_shift", r)}
                key={r.id}
              >
                <b>{r.title}</b>
                <span>{r.status === "absent" ? "Return from absence" : "Fill shift"}</span>
              </button>
            ))}
        </aside>
      </div>
    </section>
  );
}

function Pharmacy({ rows, patients, act, pending }: Props) {
  const rx = rows.filter((r) => r.kind === "prescription");
  const counts = (s: string) => rx.filter((r) => r.status === s).length;
  return (
    <section className="system-ui pharmacy-desk">
      <div className="system-bar">
        <strong>✚ e-Pre-scripted</strong>
        <span>Neighbourhood Pharmacy (Main)</span>
        <span>J. Wilson · Pharmacist</span>
      </div>
      <div className="rx-tabs">
        {["Dispensing queue", "Clinical check", "Ready to collect", "Collected", "Returns"].map(
          (x, i) => (
            <button className={i === 0 ? "active" : ""} key={x}>
              {x}
            </button>
          ),
        )}
      </div>
      <div className="rx-metrics">
        {[
          ["In queue", rx.length],
          ["Clinical check", counts("reviewed")],
          ["Dispensing", counts("approved")],
          ["Ready", counts("dispensed")],
          ["Overdue", rx.filter((r) => r.priority === "urgent").length],
        ].map(([x, n]) => (
          <article key={x}>
            <small>{x}</small>
            <b>{n}</b>
          </article>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Patient</th>
            <th>Item</th>
            <th>Type</th>
            <th>Received</th>
            <th>Stock</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rx.map((r, i) => {
            const p = patients.find((x) => x.id === r.patientId);
            return (
              <tr key={r.id}>
                <td>
                  <span className={"status " + r.status}>{r.status}</span>
                </td>
                <td>
                  <b>{p?.name}</b>
                </td>
                <td>
                  {value(r, "drug", r.title)}
                  <small>{value(r, "note", r.title)}</small>
                </td>
                <td>{i % 2 ? "Repeat" : "Acute"}</td>
                <td>09:{String(8 + i * 7).padStart(2, "0")}</td>
                <td>{value(r, "stock", "1")}</td>
                <td>
                  {r.status === "approved" ? (
                    <button onClick={() => act("dispense", r)}>Dispense</button>
                  ) : r.status === "dispensed" ? (
                    <button onClick={() => act("collect", r)}>Collect</button>
                  ) : (
                    <RecordButton r={r} act={act} pending={pending} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="rx-flow">
        <span>① Received</span>
        <i>→</i>
        <span>② Clinical check</span>
        <i>→</i>
        <span>③ Dispensing</span>
        <i>→</i>
        <span>④ Ready</span>
        <i>→</i>
        <span>⑤ Collected</span>
      </div>
    </section>
  );
}

const domain: Partial<Record<SiteId, { title: string; verb: string; lanes: string[] }>> = {
  diagnostics: {
    title: "Path & Picture reporting cockpit",
    verb: "Report",
    lanes: ["Acquisition", "Awaiting report", "Clinical validation", "Released"],
  },
  community: {
    title: "Neighbourhood virtual ward",
    verb: "Visit",
    lanes: ["New referrals", "Visit due", "In progress", "Closed"],
  },
  social: {
    title: "Solid Logic care coordination",
    verb: "Assess",
    lanes: ["Contact", "Assessment", "Funding", "Package live"],
  },
  wearables: {
    title: "Home Signals monitoring wall",
    verb: "Escalate",
    lanes: ["Connected", "New signal", "Needs review", "Escalated"],
  },
  robotics: {
    title: "Fleet Operations mission control",
    verb: "Dispatch",
    lanes: ["Available", "Queued", "In transit", "Complete"],
  },
  theatre: {
    title: "Orpheus theatre lists",
    verb: "Schedule",
    lanes: ["Pre-op", "List confirmed", "In theatre", "Recovery"],
  },
  beds: {
    title: "Bedrock flow control",
    verb: "Move",
    lanes: ["ED decision", "Bed requested", "Ready", "Discharge"],
  },
  mental: {
    title: "RiO Grande caseload",
    verb: "Review",
    lanes: ["Referral", "Assessment", "Care plan", "Crisis review"],
  },
  maternity: {
    title: "Badger-ish maternity record",
    verb: "Record",
    lanes: ["Booking", "Antenatal", "Birth plan", "Postnatal"],
  },
  dental: {
    title: "Dentally Challenged recall book",
    verb: "Book",
    lanes: ["Recall due", "Contacted", "Appointment", "Treatment"],
  },
  genomics: {
    title: "Gene-ius case workspace",
    verb: "Interpret",
    lanes: ["Consent", "Laboratory", "MDT", "Result"],
  },
  population: {
    title: "Prevention command centre",
    verb: "Invite",
    lanes: ["Cohort", "Invitation", "Follow-up", "Complete"],
  },
  research: {
    title: "Trial & Error cohort studio",
    verb: "Screen",
    lanes: ["Potential match", "Consent check", "Research contact", "Enrolled"],
  },
  icb: {
    title: "Commission Impossible system room",
    verb: "Assure",
    lanes: ["Signal", "Provider response", "Recovery plan", "Assured"],
  },
  nhsapp: {
    title: "My Health Thing",
    verb: "Open",
    lanes: ["For you", "Appointments", "Messages", "Your records"],
  },
  patient: {
    title: "My Neighbourhood",
    verb: "View",
    lanes: ["Today", "Care team", "Medicines", "Help"],
  },
};
function DomainWorkspace({ siteId, rows, patients, act, pending }: Props) {
  const meta = domain[siteId] ?? {
    title: "Service workbench",
    verb: "Review",
    lanes: ["New", "In progress", "Waiting", "Complete"],
  };
  const grouped = useMemo(
    () =>
      meta.lanes.map((lane, i) => ({
        lane,
        rows: rows.filter((_, j) => j % meta.lanes.length === i),
      })),
    [rows, meta],
  );
  return (
    <section className={"system-ui domain-workspace domain-" + siteId}>
      <div className="domain-title">
        <div>
          <small>LIVE SYNTHETIC SERVICE</small>
          <h2>{meta.title}</h2>
        </div>
        <div>
          <button>Filter</button>
          <button>+ New</button>
        </div>
      </div>
      <div className="domain-stats">
        <article>
          <b>{rows.length}</b>
          <span>Visible records</span>
        </article>
        <article>
          <b>{rows.filter((r) => r.priority === "urgent").length}</b>
          <span>Urgent</span>
        </article>
        <article>
          <b>{rows.filter((r) => ["waiting", "open"].includes(r.status)).length}</b>
          <span>Waiting</span>
        </article>
        <article>
          <b>{rows.filter((r) => r.status === "completed").length}</b>
          <span>Completed</span>
        </article>
      </div>
      <div className="kanban">
        {grouped.map((g) => (
          <div className="lane" key={g.lane}>
            <h3>
              {g.lane}
              <em>{g.rows.length}</em>
            </h3>
            {g.rows.map((r) => {
              const p = patients.find((x) => x.id === r.patientId);
              return (
                <article key={r.id}>
                  <span className={"priority-dot " + r.priority} />
                  <small>
                    {r.kind} · {r.id}
                  </small>
                  <b>{r.title}</b>
                  {p && <a href={"/" + siteId + "/?patient=" + p.id}>{p.name}</a>}
                  <footer>
                    <span className={"status " + r.status}>{r.status}</span>
                    <RecordButton r={r} act={act} pending={pending} label={meta.verb} />
                  </footer>
                </article>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

export function SystemWorkspace(props: Props) {
  if (props.siteId === "hospital") return <SystemTwo {...props} />;
  if (props.siteId === "messaging") return <Pingr {...props} />;
  if (["gp", "triage", "referrals", "urgent"].includes(props.siteId))
    return <PrimaryCare {...props} />;
  if (props.siteId === "ambulance") return <EmergencyBoard {...props} />;
  if (["roster", "hr"].includes(props.siteId)) return <Workforce {...props} />;
  if (props.siteId === "pharmacy") return <Pharmacy {...props} />;
  return <DomainWorkspace {...props} />;
}
