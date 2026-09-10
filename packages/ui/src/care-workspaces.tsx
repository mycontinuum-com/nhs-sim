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
type Filter = "active" | "ready" | "done" | "all";
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
  const [composing, setComposing] = useState(false);
  const kind = pharmacy ? "prescription" : "visit";
  const records = props.rows.filter(
    (record) =>
      record.kind === kind &&
      (!props.selectedPatient || record.patientId === props.selectedPatient),
  );
  const matches = (record: Resource, value: Filter) =>
    value === "all" ||
    (value === "done"
      ? terminal(record)
      : value === "ready"
        ? ["approved", "dispensed"].includes(record.status)
        : !terminal(record));
  const visible = records.filter((record) => matches(record, filter));
  const selected = records.find((record) => record.id === selectedId) ?? visible[0];
  const patient = props.patients.find(
    (person) => person.id === (selected?.patientId ?? props.selectedPatient),
  );
  const draftingPatient =
    props.patients.find((person) => person.id === props.selectedPatient) ?? patient;
  const next = selected ? actionFor(selected) : undefined;
  const filters: { id: Filter; label: string }[] = pharmacy
    ? [
        { id: "active", label: "In progress" },
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
            <strong>{pharmacy ? "Juniper Pharmacy" : "Neighbourhood nursing"}</strong>
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
        <button className="care-primary" onClick={() => setComposing(true)}>
          {pharmacy ? "+ New prescription" : "+ Arrange a visit"}
        </button>
      </div>
      <div className="care-directory-bar">
        <PatientSearch {...props} />
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
      <main className="care-main">
        <section className="care-queue" aria-label={pharmacy ? "Prescription queue" : "Visit list"}>
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
                setComposing(false);
                if (record.patientId) props.selectPatient(record.patientId);
              }}
            >
              <span className="care-record-index" aria-hidden="true">
                {pharmacy ? "Rx" : "⌂"}
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
                    : `Created ${date(record.createdAt)}`}{" "}
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
              <button onClick={() => setComposing(true)}>
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
                setComposing(false);
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
                      : "Record the outcome using the visit action below."}
                  </p>
                </div>
              )}
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
          <PersonContext patient={composing ? draftingPatient : patient} />
        </div>
      </main>
    </div>
  );
}
