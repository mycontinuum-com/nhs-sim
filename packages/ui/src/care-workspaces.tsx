import { RecordAttribution } from "./record-attribution.tsx";
import React, { useState } from "react";
import type { Action, Patient, Resource, SiteId } from "../../contracts/src/index.ts";
import "./care-workspaces.css";

type Props = {
  siteId: SiteId;
  view: {
    now: number;
    resources: Resource[];
    staffing: { doctors: number; nurses: number; staffedSpaces: number; waiting: number };
  };
  rows: Resource[];
  handoverRows?: Resource[];
  patients: Patient[];
  selectedPatient: string;
  patientSearch: string;
  searchPatients: (query: string) => void;
  selectPatient: (id: string) => void;
  act: (type: Action["type"], resource: Resource, target?: SiteId) => void;
  create: (
    type: Action["type"],
    patientId: string,
    title: string,
    target?: SiteId,
  ) => Promise<unknown>;
  pending: boolean;
  exitToMap?: () => void;
  identityLabel?: string;
};
type Filter = "active" | "received" | "review" | "ready" | "done" | "all";
const terminal = (record: Resource) =>
  ["collected", "completed", "cancelled"].includes(record.status);
const date = (time: number | string) =>
  new Date(time).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
function actionFor(record: Resource): { type: Action["type"]; label: string } | undefined {
  if (record.kind === "prescription") {
    if (["draft", "open", "available"].includes(record.status))
      return { type: "review", label: "Record review" };
    if (["reviewed", "rejected"].includes(record.status))
      return { type: "accept", label: "Approve prescription" };
    if (record.status === "approved") return { type: "dispense", label: "Confirm dispensing" };
    if (record.status === "dispensed") return { type: "collect", label: "Confirm collection" };
  } else if (["open", "reviewed", "accepted", "scheduled", "waiting"].includes(record.status)) {
    return { type: "complete", label: "Complete visit" };
  }
}
function PersonContext({ patient }: { patient?: Patient }) {
  return (
    <section className="care-person-context">
      <p className="care-eyebrow">{patient ? "Person receiving care" : "Patient context"}</p>
      <h3>{patient?.name ?? "Select a patient"}</h3>
      {patient ? (
        <>
          <p className="care-muted">
            {patient.id} · Born {date(patient.birthDate)}
          </p>
          <h4>Recorded needs</h4>
          <ul>
            {patient.needs.map((need) => (
              <li key={need}>{need}</li>
            ))}
          </ul>
          {!patient.needs.length && <p>No needs recorded.</p>}
          <h4>Personal goals</h4>
          <ul>
            {patient.goals.map((goal) => (
              <li key={goal}>{goal}</li>
            ))}
          </ul>
          {!patient.goals.length && <p>No goals recorded.</p>}
        </>
      ) : (
        <p>Use the patient directory to start a prescription or arrange a home visit.</p>
      )}
    </section>
  );
}
function PatientSearch(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="care-search">
      <label htmlFor="care-patient-search">Patient directory</label>
      <input
        id="care-patient-search"
        placeholder="Search name or patient ID"
        value={props.patientSearch}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          props.searchPatients(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <div className="care-search-results">
          <div className="care-search-caption">
            <b>Select a person</b>
            <button onClick={() => setOpen(false)} aria-label="Close patient directory">
              ×
            </button>
          </div>
          {props.patients.slice(0, 20).map((patient) => (
            <button
              key={patient.id}
              onClick={() => {
                props.selectPatient(patient.id);
                setOpen(false);
              }}
            >
              <strong>{patient.name}</strong>
              <small>{patient.id}</small>
            </button>
          ))}
          {!props.patients.length && <p>No matching patients.</p>}
        </div>
      )}
    </div>
  );
}
function CreateRecord({
  pharmacy,
  patient,
  props,
  close,
}: {
  pharmacy: boolean;
  patient?: Patient;
  props: Props;
  close: () => void;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="care-composer"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!patient || !title.trim()) return;
        setSaving(true);
        setError("");
        try {
          await props.create(
            pharmacy ? "draft_prescription" : "schedule_visit",
            patient.id,
            title.trim(),
            pharmacy ? "pharmacy" : "community",
          );
          close();
        } catch (failure) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not save. Your draft is still here.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="care-detail-heading">
        <div>
          <p className="care-eyebrow">{pharmacy ? "New prescription" : "Arrange a visit"}</p>
          <h2>{patient?.name ?? "Choose a patient first"}</h2>
        </div>
        <button type="button" onClick={close} aria-label="Close draft">
          ×
        </button>
      </div>
      {!patient && (
        <p>Select a person in the patient directory above. This draft will stay open.</p>
      )}
      <label htmlFor="care-draft-title">
        {pharmacy ? "Synthetic prescription description" : "Purpose of visit"}
      </label>
      <textarea
        autoFocus
        id="care-draft-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={
          pharmacy
            ? "For example, fictional discharge supply follow-up"
            : "For example, confirm home equipment and support needs"
        }
        required
        maxLength={500}
        rows={4}
      />
      <p className="care-muted">
        {pharmacy
          ? "The prescription starts as a draft. Review, approve, dispense and confirm collection here."
          : "This simulation schedules a visit in 90 minutes. You can also record completion manually."}
      </p>
      {error && (
        <p className="care-error" role="alert">
          {error}
        </p>
      )}
      <div className="care-form-actions">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button
          className="care-primary"
          disabled={!patient || !title.trim() || props.pending || saving}
        >
          {saving ? "Saving…" : pharmacy ? "Save draft" : "Schedule visit"}
        </button>
      </div>
    </form>
  );
}
export function CareWorkspace(props: Props) {
  const pharmacy = props.siteId === "pharmacy";
  const [filter, setFilter] = useState<Filter>("active");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<{ patient: Patient | undefined } | null>(null);
  const composing = draft !== null;
  const kind = pharmacy ? "prescription" : "visit";
  const records = props.rows.filter(
    (record) =>
      record.kind === kind &&
      (!props.selectedPatient || record.patientId === props.selectedPatient),
  );
  const carePlans = props.rows.filter(
    (record) =>
      record.kind === "care-plan" &&
      record.owner === "community" &&
      (!props.selectedPatient || record.patientId === props.selectedPatient),
  );
  const matches = (record: Resource, value: Filter) =>
    value === "all" ||
    (value === "received" && ["draft", "open", "available"].includes(record.status)) ||
    (value === "review" && ["reviewed", "rejected"].includes(record.status)) ||
    (value === "done"
      ? terminal(record)
      : value === "ready"
        ? ["approved", "dispensed"].includes(record.status)
        : value === "active" && !terminal(record));
  const visible = records.filter((record) => matches(record, filter));
  if (!pharmacy) visible.sort((a, b) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt));
  const selected = visible.find((record) => record.id === selectedId) ?? visible[0];
  const patient = props.patients.find(
    (person) => person.id === (selected?.patientId ?? props.selectedPatient),
  );
  const draftingPatient = draft?.patient;
  const startDraft = (
    person = props.patients.find((person) => person.id === props.selectedPatient) ?? patient,
  ) => {
    if (!draft) setDraft({ patient: person });
  };
  const next = selected ? actionFor(selected) : undefined;
  const filters: { id: Filter; label: string }[] = pharmacy
    ? [
        { id: "active", label: "All active" },
        { id: "received", label: "Received" },
        { id: "review", label: "Clinical check" },
        { id: "ready", label: "Dispensing & collection" },
        { id: "done", label: "Finished" },
        { id: "all", label: "All prescriptions" },
      ]
    : [
        { id: "active", label: "Upcoming visits" },
        { id: "done", label: "Completed" },
        { id: "all", label: "All visits" },
      ];
  return (
    <div className={`care-workspace ${pharmacy ? "care-pharmacy" : "care-community"}`}>
      <header className="care-header">
        <div className="care-brand">
          <span className="care-brand-mark" aria-hidden="true">
            {pharmacy ? "+" : "⌂"}
          </span>
          <div>
            <strong>{pharmacy ? "High Street Pharmacy" : "Neighbourhood nursing"}</strong>
            <small>{pharmacy ? "Dispensary workspace" : "Community care workspace"}</small>
          </div>
        </div>
        <span className="care-simulation">SIMULATION · SYNTHETIC PEOPLE</span>
        <button
          className="care-map-button"
          onClick={() =>
            props.exitToMap ? props.exitToMap() : window.location.assign("/control/")
          }
        >
          Neighbourhood map
        </button>
      </header>
      <div className="care-heading">
        <div>
          <p className="care-eyebrow">
            {pharmacy ? "Community pharmacy" : "Care beyond the clinic"} · {date(props.view.now)}
          </p>
          <h1>{pharmacy ? "The dispensing bench" : "A day in the neighbourhood"}</h1>
          <p>
            {pharmacy
              ? "Follow each prescription through to collection."
              : "Plan home visits around the person and the care they need."}
          </p>
        </div>
        <button className="care-primary" onClick={() => startDraft()}>
          {pharmacy ? "+ New prescription" : "+ Arrange a visit"}
        </button>
      </div>
      <div className="care-directory-bar">
        <PatientSearch
          {...props}
          selectPatient={(id) => {
            props.selectPatient(id);
            if (draft && !draft.patient) {
              setDraft({ patient: props.patients.find((person) => person.id === id) });
            }
          }}
        />
        <div className="care-scope">
          {props.selectedPatient ? (
            <>
              <span>
                Showing{" "}
                {props.patients.find((person) => person.id === props.selectedPatient)?.name ??
                  props.selectedPatient}
              </span>
              <button
                onClick={() => {
                  props.selectPatient("");
                  props.searchPatients("");
                  setSelectedId("");
                }}
              >
                Show everyone
              </button>
            </>
          ) : (
            <span>All patients in the loaded work queue</span>
          )}
        </div>
        <span className="care-identity">{props.identityLabel ?? "Simulation staff session"}</span>
      </div>
      {!pharmacy &&
        props.rows.some(
          (record) =>
            record.kind === "document" &&
            record.data.planLab === "digital" &&
            (!props.selectedPatient || record.patientId === props.selectedPatient),
        ) && (
          <section className="care-incoming" aria-label="Shared record inbox">
            <div className="care-incoming-heading">
              <div>
                <p className="care-eyebrow">Shared record inbox</p>
                <h2>From the practice</h2>
              </div>
              <a href="/docs/api/">Record sharing guide ↗</a>
            </div>
            {props.rows
              .filter(
                (record) =>
                  record.kind === "document" &&
                  record.data.planLab === "digital" &&
                  (!props.selectedPatient || record.patientId === props.selectedPatient),
              )
              .map((record) => (
                <details className="care-handover-card" key={record.id}>
                  <summary>{record.title}</summary>
                  <p>
                    {record.patientId} · Shared by {record.owner} · Version {record.version}
                  </p>
                  <p>
                    {typeof record.data.text === "string"
                      ? record.data.text
                      : "No document body recorded."}
                  </p>
                </details>
              ))}
          </section>
        )}
      {!pharmacy && (
        <details className="care-incoming care-incoming-disclosure">
          <summary>
            <strong>Incoming care handovers</strong>
            <span>
              {carePlans.length} care {carePlans.length === 1 ? "plan" : "plans"} · Review before a
              first visit
            </span>
          </summary>
          {carePlans.length ? (
            <div className="care-handover-strip">
              {carePlans.map((plan) => (
                <article className="care-handover-card" key={plan.id}>
                  <div className="care-handover-person">
                    <span className="care-handover-icon" aria-hidden="true">
                      ⌂
                    </span>
                    <div>
                      <h3>
                        {props.patients.find((person) => person.id === plan.patientId)?.name ??
                          plan.patientId}
                      </h3>
                      <p>{plan.title}</p>
                    </div>
                    <span className="care-status">{plan.status}</span>
                  </div>
                  <dl className="care-handover-flags">
                    <div>
                      <dt>Carer availability</dt>
                      <dd>{plan.data.carerAvailable === true ? "Confirmed" : "Not confirmed"}</dd>
                    </div>
                    <div>
                      <dt>Home access</dt>
                      <dd>
                        {plan.data.homeAccessConfirmed === true ? "Confirmed" : "Not confirmed"}
                      </dd>
                    </div>
                  </dl>
                  <div className="care-handover-footer">
                    <small>{plan.id} · Synthetic care plan</small>
                    <button
                      className="care-primary"
                      disabled={!plan.patientId}
                      onClick={() => {
                        if (plan.patientId) props.selectPatient(plan.patientId);
                        setSelectedId("");
                        startDraft(props.patients.find((person) => person.id === plan.patientId));
                      }}
                    >
                      Plan a visit
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="care-incoming-empty">
              No incoming care plans for this view. You can still arrange a visit using the patient
              directory.
            </p>
          )}
        </details>
      )}
      {pharmacy && (
        <nav className="dispensing-stages" aria-label="Dispensing stages">
          {filters
            .filter((item) => ["received", "review", "ready", "done"].includes(item.id))
            .map((item, index) => (
              <button
                key={item.id}
                aria-pressed={filter === item.id}
                onClick={() => {
                  setFilter(item.id);
                  setSelectedId("");
                }}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <b>{item.label}</b>
                <strong>{records.filter((record) => matches(record, item.id)).length}</strong>
              </button>
            ))}
        </nav>
      )}
      <main className="care-main">
        {!pharmacy && (
          <section className="community-route" aria-label="Schematic visit route">
            <div className="community-route-heading">
              <h2>Neighbourhood route</h2>
              <p>Schematic · loaded visits, no geographic coordinates</p>
            </div>
            <div className="community-route-canvas">
              <svg viewBox="0 0 300 600" preserveAspectRatio="none" aria-hidden="true">
                <path className="route-river" d="M-30 190 Q160 260 330 170" />
                <path
                  className="route-street"
                  d="M40 0 L120 600 M230 0 L180 600 M0 90 L300 110 M0 350 L300 290 M0 520 L300 540"
                />
                <path className="route-trail" d="M80 60 Q240 140 150 240 T100 420 T220 560" />
              </svg>
              {visible.slice(0, 6).map((record, index) => (
                <button
                  key={record.id}
                  className={`community-stop stop-${index} ${selected?.id === record.id ? "is-selected" : ""}`}
                  aria-pressed={selected?.id === record.id}
                  onClick={() => setSelectedId(record.id)}
                >
                  <b>{index + 1}</b>
                  <span>
                    {props.patients.find((person) => person.id === record.patientId)?.name ??
                      record.patientId}
                    <small>
                      {record.dueAt === undefined
                        ? "Unscheduled"
                        : new Date(record.dueAt).toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "UTC",
                          })}{" "}
                      · {record.status}
                    </small>
                  </span>
                </button>
              ))}
              {!visible.length && (
                <p className="route-empty">Arrange a visit to start your route.</p>
              )}
            </div>
            <p className="route-disclaimer">
              {visible.length > 6
                ? "First six visits shown. All visits are available in the agenda."
                : "Illustrative placement, not travel directions."}
            </p>
          </section>
        )}

        <section className="care-queue" aria-label={pharmacy ? "Prescription queue" : "Visit list"}>
          {!pharmacy && (
            <div className="care-ledger-heading">
              <p className="care-eyebrow">Field visits</p>
              <h2>Visit agenda</h2>
              <p>Open a visit to see the person's needs and record its completion.</p>
            </div>
          )}
          <nav className="care-filters" aria-label="Queue filters">
            {filters.map((item) => (
              <button
                key={item.id}
                aria-pressed={filter === item.id}
                onClick={() => {
                  setFilter(item.id);
                  setSelectedId("");
                }}
              >
                {item.label}
                <span>{records.filter((record) => matches(record, item.id)).length}</span>
              </button>
            ))}
          </nav>
          <div className="care-queue-caption">
            <span>{pharmacy ? "Prescription / person" : "Visit / person"}</span>
            <span>Status</span>
          </div>
          {visible.map((record) => (
            <button
              key={record.id}
              className={`care-record ${selected?.id === record.id ? "is-selected" : ""}`}
              aria-pressed={selected?.id === record.id}
              onClick={() => {
                setSelectedId(record.id);
              }}
            >
              <span className="care-record-index" aria-hidden="true">
                {pharmacy ? (
                  "Rx"
                ) : (
                  <>
                    <small>{record.dueAt === undefined ? "Created" : "Due"}</small>
                    {new Date(record.dueAt ?? record.createdAt).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "UTC",
                    })}
                  </>
                )}
              </span>
              <span className="care-record-name">
                <strong>
                  {props.patients.find((person) => person.id === record.patientId)?.name ??
                    record.patientId ??
                    "Unassigned"}
                </strong>
                <span>{record.title}</span>
                <small>
                  {pharmacy
                    ? `Received ${date(record.createdAt)}`
                    : `${record.dueAt === undefined ? "Created" : "Due"} ${date(record.dueAt ?? record.createdAt)}`}{" "}
                  · {record.id}
                </small>
              </span>
              <span className={`care-status ${terminal(record) ? "is-done" : ""}`}>
                {record.status}
              </span>
            </button>
          ))}
          {!visible.length && (
            <div className="care-empty">
              <span aria-hidden="true">{pharmacy ? "Rx" : "⌂"}</span>
              <h2>
                {filter === "done"
                  ? "Nothing completed yet"
                  : pharmacy
                    ? "No prescriptions in this view"
                    : "No visits in this view"}
              </h2>
              <p>
                {pharmacy
                  ? "Select a patient and draft a prescription, or change the filter to see another stage."
                  : "Select a person and arrange a visit. Completed visits remain in the visit history."}
              </p>
              <button onClick={() => startDraft()}>
                {pharmacy ? "Draft a prescription" : "Arrange a visit"}
              </button>
            </div>
          )}
          <div className="care-queue-foot">
            {visible.length} {pharmacy ? "prescriptions" : "visits"} in this view · Changes are
            shared across your team's world
          </div>
        </section>
        <div className="care-details">
          {composing ? (
            <CreateRecord
              pharmacy={pharmacy}
              patient={draftingPatient}
              props={props}
              close={() => {
                setDraft(null);
                setFilter("active");
                setSelectedId("");
              }}
            />
          ) : selected ? (
            <section className="care-detail-card">
              <div className="care-detail-heading">
                <div>
                  <p className="care-eyebrow">
                    {pharmacy ? "Dispensing record" : "Visit brief"} · {selected.id}
                  </p>
                  <h2>{selected.title}</h2>
                </div>
                <span className="care-priority">{selected.priority}</span>
              </div>
              <div className="care-detail-person">
                <span className="care-avatar">
                  {patient?.name
                    .split(" ")
                    .map((name) => name[0])
                    .slice(0, 2)
                    .join("") ?? "?"}
                </span>
                <div>
                  <h3>{patient?.name ?? selected.patientId}</h3>
                  <p>{selected.patientId} · Synthetic patient</p>
                </div>
              </div>
              {pharmacy ? (
                <>
                  <ol className="care-progress" aria-label="Prescription progress">
                    {["draft", "reviewed", "approved", "dispensed", "collected"].map((stage) => (
                      <li key={stage} aria-current={selected.status === stage ? "step" : undefined}>
                        {stage}
                      </li>
                    ))}
                  </ol>
                  {typeof selected.data.drug === "string" && (
                    <div className="care-label-slip">
                      <span>Simulation item</span>
                      <strong>{selected.data.drug}</strong>
                      {typeof selected.data.stock === "number" && (
                        <small>Stock remaining: {selected.data.stock}</small>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="care-visit-note">
                  <b>{selected.status === "completed" ? "Visit completed" : "Home visit"}</b>
                  <p>
                    {selected.status === "scheduled"
                      ? "Scheduled visits complete after 90 simulation minutes, or when you record completion below."
                      : terminal(selected)
                        ? "This visit remains available in your team's history."
                        : "Record the outcome using the visit action below."}
                  </p>
                </div>
              )}
              <RecordAttribution record={selected} history />
              {typeof selected.data.note === "string" && (
                <p className="care-muted">{selected.data.note}</p>
              )}
              {next ? (
                <div className="care-next-action">
                  <p>{pharmacy ? "Next dispensing step" : "Visit outcome"}</p>
                  <button
                    className="care-primary"
                    disabled={props.pending}
                    onClick={() => props.act(next.type, selected)}
                  >
                    {props.pending ? "Saving…" : next.label}
                  </button>
                </div>
              ) : (
                <p className="care-finished">
                  {terminal(selected)
                    ? "This record is complete and remains available in the history."
                    : `Current status: ${selected.status}`}
                </p>
              )}
            </section>
          ) : null}
          {!pharmacy && <PersonContext patient={composing ? draftingPatient : patient} />}
        </div>
        {pharmacy && (
          <aside className="pharmacy-label-column">
            <section className="pharmacy-label-preview">
              <h2>Dispensing label preview</h2>
              <div className="pharmacy-paper-label">
                <h3>High Street Pharmacy</h3>
                <p className="care-eyebrow">SIMULATION LABEL</p>
                <h2>{(composing ? draftingPatient : patient)?.name ?? "Select a prescription"}</h2>
                <p>
                  {(composing ? draftingPatient?.id : selected?.patientId) ?? "No patient selected"}
                </p>
                <hr />
                <strong>
                  {composing
                    ? "Draft prescription · label available after saving"
                    : selected && typeof selected.data.drug === "string"
                      ? selected.data.drug
                      : (selected?.title ?? "Prescription details appear here")}
                </strong>
                <p>{composing ? "Unsaved draft" : (selected?.id ?? "—")}</p>
                <small>Synthetic record · Not for dispensing</small>
              </div>
            </section>
            <PersonContext patient={composing ? draftingPatient : patient} />
          </aside>
        )}
        <div className="care-supply-history" hidden={!pharmacy || !selected}>
          <h2>Prescription history</h2>
          {records
            .filter((record) => record.patientId === selected?.patientId)
            .map((record) => (
              <button
                key={record.id}
                onClick={() => {
                  setFilter("all");
                  setSelectedId(record.id);
                }}
              >
                <span>{date(record.createdAt)}</span>
                <strong>{record.title}</strong>
                <span>{record.status}</span>
              </button>
            ))}
        </div>
      </main>
    </div>
  );
}
