import React, { useState } from "react";
import { z } from "zod";
import { AppointmentBook, Consultations, type WorkflowApi } from "./gp-workflows.tsx";
import type { Action, Patient, Resource, SiteId } from "../../contracts/src/index.ts";

type Props = {
  siteId: SiteId;
  api: WorkflowApi;
  view: {
    id: string;
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
const ehrSchema = z.object({
  problems: z.array(
    z.object({ term: z.string(), code: z.string(), date: z.string(), status: z.string() }),
  ),
  medications: z.array(
    z.object({ term: z.string(), isCurrent: z.boolean(), issueDate: z.string() }),
  ),
  allergies: z.array(z.object({ term: z.string() })),
  miscCodes: z.array(z.object({ term: z.string(), code: z.string() })),
});
const date = (time: number | string) =>
  new Date(time).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const finished = (r: Resource) => ["completed", "collected", "cancelled"].includes(r.status);
const nextAction = (r: Resource): { type: Action["type"]; label: string } | undefined => {
  if (r.kind === "ehr-record") return;
  if (r.kind === "prescription") {
    if (r.status === "approved") return { type: "dispense", label: "Dispense" };
    if (r.status === "dispensed") return { type: "collect", label: "Confirm collection" };
    if (["reviewed", "rejected"].includes(r.status))
      return { type: "accept", label: "Approve prescription" };
  }
  if (["open", "draft", "available"].includes(r.status))
    return { type: "review", label: "Mark reviewed" };
  if (["reviewed", "rejected"].includes(r.status)) return { type: "accept", label: "Accept" };
  if (["accepted", "scheduled", "waiting"].includes(r.status))
    return { type: "complete", label: "Complete" };
};
const operations = [
  { type: "create_task", label: "New task", title: "Record a follow-up task", target: "gp" },
  {
    type: "order_test",
    label: "Request test",
    title: "Request a diagnostic test",
    target: "diagnostics",
  },
  {
    type: "draft_prescription",
    label: "Prescription",
    title: "Draft a synthetic prescription",
    target: "pharmacy",
  },
  {
    type: "create_referral",
    label: "Refer to hospital",
    title: "Refer to Northbank General",
    target: "hospital",
  },
  {
    type: "schedule_visit",
    label: "Home visit",
    title: "Schedule a community visit",
    target: "community",
  },
] satisfies { type: Action["type"]; label: string; title: string; target: SiteId }[];
type Operation = (typeof operations)[number];

function ActionButton({
  record,
  act,
  pending,
}: { record: Resource } & Pick<Props, "act" | "pending">) {
  const action = nextAction(record);
  return action ? (
    <button className="ehr-action" disabled={pending} onClick={() => act(action.type, record)}>
      {action.label}
    </button>
  ) : (
    <span className="ehr-terminal">{record.status}</span>
  );
}
function PatientFinder(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ehr-finder">
      <label htmlFor="ehr-patient-search">Find patient</label>
      <input
        id="ehr-patient-search"
        value={props.patientSearch}
        placeholder="Name, patient ID or care need"
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
        <div className="ehr-search-results">
          <div className="ehr-search-heading">
            <b>Patient directory</b>
            <button onClick={() => setOpen(false)} aria-label="Close patient search">
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
              <small>
                {patient.id} · {date(patient.birthDate)}
              </small>
            </button>
          ))}
          {!props.patients.length && <p>No matching patients.</p>}
        </div>
      )}
    </div>
  );
}
function Banner({ patient, rows }: { patient: Patient | undefined; rows: Resource[] }) {
  const parsed = ehrSchema.safeParse(
    rows.find((r) => r.patientId === patient?.id && r.kind === "ehr-record")?.data,
  );
  return (
    <div className="ehr-patient-banner">
      <div className="ehr-patient-name">
        <small>Patient record</small>
        <strong>{patient?.name ?? "No patient selected"}</strong>
      </div>
      <div>
        <small>Patient ID</small>
        <b>{patient?.id ?? "Select from the directory"}</b>
      </div>
      <div>
        <small>Date of birth</small>
        <b>{patient ? date(patient.birthDate) : "Not selected"}</b>
      </div>
      <div className="ehr-allergy">
        <small>Recorded allergies</small>
        <b>
          {parsed.success
            ? parsed.data.allergies.map((a) => a.term).join(", ") || "None recorded"
            : "Record not available"}
        </b>
      </div>
      <span className="ehr-synthetic">SYNTHETIC</span>
    </div>
  );
}
function Composer({
  operation,
  patient,
  create,
  pending,
  close,
}: { operation: Operation; patient: Patient; close: () => void } & Pick<
  Props,
  "create" | "pending"
>) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="ehr-dialog-backdrop">
      <section
        className="ehr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
      >
        <header>
          <h2 id="composer-title">{operation.title}</h2>
          <button onClick={close} aria-label="Close editor">
            ×
          </button>
        </header>
        <p>
          {patient.name} · {patient.id}
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (title.trim()) {
              try {
                await create(operation.type, patient.id, title.trim(), operation.target);
                close();
              } catch (failure) {
                setError(failure instanceof Error ? failure.message : "Could not save request");
              }
            }
          }}
        >
          <label htmlFor="ehr-action-title">
            {operation.type === "draft_prescription"
              ? "Fictional medication / supply request"
              : "Details"}
          </label>
          <textarea
            autoFocus
            id="ehr-action-title"
            maxLength={500}
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Enter synthetic scenario details"
          />
          <small>Sent to {operation.target}. This creates a shared simulation record.</small>
          {error && <p role="alert">{error}</p>}
          <footer>
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button className="ehr-primary" disabled={pending || !title.trim()}>
              Save {operation.type === "draft_prescription" ? "draft" : "request"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
function Summary({
  patient,
  rows,
  act,
  pending,
  select,
}: { patient: Patient | undefined; rows: Resource[]; select: (id: string) => void } & Pick<
  Props,
  "act" | "pending"
>) {
  const current = rows.filter((r) => r.patientId === patient?.id);
  const tasks = current.filter(
    (r) => ["task", "visit", "referral", "prescription"].includes(r.kind) && !finished(r),
  );
  return (
    <aside className="ehr-summary">
      <section>
        <h3>Patient summary</h3>
        <dl>
          <dt>Name</dt>
          <dd>{patient?.name ?? "No patient selected"}</dd>
          <dt>Date of birth</dt>
          <dd>{patient ? date(patient.birthDate) : "Not selected"}</dd>
          <dt>Local identifier</dt>
          <dd>{patient?.id ?? "Not selected"}</dd>
          <dt>Source</dt>
          <dd>Fictional patient</dd>
        </dl>
      </section>
      <section>
        <h3>
          Active problems <span>{patient?.conditions.length ?? 0}</span>
        </h3>
        {patient?.conditions.map((condition) => (
          <p className="ehr-summary-line" key={condition}>
            {condition}
            <span>Active</span>
          </p>
        ))}
        {!patient?.conditions.length && <p className="ehr-empty">No problems recorded.</p>}
      </section>
      <section>
        <h3>Care needs</h3>
        {patient?.needs.map((need) => (
          <p className="ehr-summary-line" key={need}>
            {need}
          </p>
        ))}
        {!patient?.needs.length && <p className="ehr-empty">No care needs recorded.</p>}
      </section>
      <section>
        <h3>
          Care coordination <span>{tasks.length}</span>
        </h3>
        {tasks.slice(0, 6).map((r) => (
          <div className="ehr-task" key={r.id}>
            <button className="ehr-text-button" onClick={() => select(r.id)}>
              {r.title}
            </button>
            <small>
              {r.owner} · {r.status}
            </small>
            <ActionButton record={r} act={act} pending={pending} />
          </div>
        ))}
        {!tasks.length && <p className="ehr-empty">No outstanding tasks.</p>}
      </section>
    </aside>
  );
}
function Detail({
  record,
  act,
  pending,
  close,
  siteId,
}: { record: Resource; close: () => void } & Pick<Props, "act" | "pending" | "siteId">) {
  const fields = Object.entries(record.data).filter(([, value]) =>
    ["string", "number", "boolean"].includes(typeof value),
  );
  return (
    <section className="ehr-record-detail">
      <header>
        <div>
          <small>
            {record.kind} · {record.id}
          </small>
          <h3>{record.title}</h3>
        </div>
        <button onClick={close} aria-label="Close record details">
          ×
        </button>
      </header>
      <dl>
        <dt>Service</dt>
        <dd>{record.owner}</dd>
        <dt>Status</dt>
        <dd>{record.status}</dd>
        <dt>Created</dt>
        <dd>{date(record.createdAt)}</dd>
        <dt>Shared with</dt>
        <dd>{record.visibleTo.join(", ")}</dd>
        {fields.map(([key, value]) => (
          <React.Fragment key={key}>
            <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
            <dd>{String(value)}</dd>
          </React.Fragment>
        ))}
      </dl>
      <footer>
        <ActionButton record={record} act={act} pending={pending} />
        <button
          disabled={pending || record.visibleTo.includes(siteId === "gp" ? "hospital" : "gp")}
          onClick={() => act("share_record", record, siteId === "gp" ? "hospital" : "gp")}
        >
          Share with {siteId === "gp" ? "hospital" : "GP"}
        </button>
      </footer>
    </section>
  );
}
function ClinicalCollections({
  rows,
  patientId,
  collection,
}: {
  rows: Resource[];
  patientId: string;
  collection: string;
}) {
  const parsed = ehrSchema.safeParse(
    rows.find((r) => r.kind === "ehr-record" && r.patientId === patientId)?.data,
  );
  const [page, setPage] = useState(0);
  if (!parsed.success)
    return <p className="ehr-empty">No structured record available for this patient.</p>;
  const entries =
    collection === "Problems"
      ? parsed.data.problems.map((x) => ({
          title: x.term,
          date: x.date,
          detail: x.code,
          status: x.status,
        }))
      : collection === "Medication"
        ? parsed.data.medications.map((x) => ({
            title: x.term,
            date: x.issueDate,
            detail: "Medication history",
            status: x.isCurrent ? "Current" : "Historical",
          }))
        : parsed.data.miscCodes.map((x) => ({
            title: x.term,
            date: "",
            detail: x.code,
            status: "Recorded",
          }));
  return (
    <>
      <table className="ehr-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>{collection}</th>
            <th>Code / detail</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(page * 30, (page + 1) * 30).map((entry, index) => (
            <tr key={index}>
              <td>{entry.date ? date(entry.date) : "Not dated"}</td>
              <td>{entry.title}</td>
              <td>{entry.detail}</td>
              <td>{entry.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!entries.length && <p className="ehr-empty">No entries recorded.</p>}
      <div className="ehr-pagination">
        <span>
          {entries.length} entries · page {page + 1} of{" "}
          {Math.max(1, Math.ceil(entries.length / 30))}
        </span>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <button disabled={(page + 1) * 30 >= entries.length} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </>
  );
}
function Journal({
  rows,
  tab,
  select,
}: {
  rows: Resource[];
  tab: string;
  select: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(30);
  const filtered = rows
    .filter(
      (r) =>
        r.kind !== "ehr-record" &&
        (tab !== "Results" || ["test", "report", "observation"].includes(r.kind)) &&
        (tab !== "Documents" ||
          ["document", "discharge", "handover", "referral"].includes(r.kind)) &&
        (tab !== "Tasks" || ["task", "visit", "appointment", "prescription"].includes(r.kind)) &&
        r.title.toLowerCase().includes(filter.toLowerCase()),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <>
      <div className="ehr-section-heading">
        <h2>
          {tab === "Journal" ? "Clinical journal" : tab}
          <small>Most recent first</small>
        </h2>
        <input
          aria-label="Filter clinical journal"
          placeholder="Filter entries"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setLimit(30);
          }}
        />
      </div>
      <div className="ehr-table-wrap">
        <table className="ehr-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Detail</th>
              <th>Service / status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r) => (
              <tr key={r.id}>
                <td>{date(r.createdAt)}</td>
                <td>{r.kind}</td>
                <td>
                  <button className="ehr-record-link" onClick={() => select(r.id)}>
                    {r.title}
                  </button>
                </td>
                <td>
                  <span>{r.owner}</span>
                  <small className={r.priority === "urgent" ? "ehr-urgent" : ""}>
                    {r.status}
                    {r.priority === "urgent" ? " · urgent" : ""}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p className="ehr-empty">No entries match this view.</p>}
      <div className="ehr-pagination">
        <span>
          {Math.min(limit, filtered.length)} of {filtered.length} entries
        </span>
        {limit < filtered.length && (
          <button onClick={() => setLimit(limit + 30)}>Show 30 more</button>
        )}
      </div>
    </>
  );
}
function Handover({
  patient,
  rows,
  act,
  pending,
  open,
  select,
}: {
  patient: Patient | undefined;
  rows: Resource[];
  open: (operation: Operation) => void;
  select: (id: string) => void;
} & Pick<Props, "act" | "pending">) {
  const sections = [
    {
      title: "01",
      label: "Discharge & GP handover",
      kinds: ["discharge", "handover", "document", "referral"],
      operation: operations[0],
    },
    { title: "02", label: "Pharmacy supply", kinds: ["prescription"], operation: operations[2] },
    {
      title: "03",
      label: "Community follow-up",
      kinds: ["visit", "task"],
      operation: operations[4],
    },
  ];
  return (
    <aside className="ehr-handover">
      <div className="ehr-chart-heading">
        <small>CONTINUITY OF CARE</small>
        <h2>Discharge chart</h2>
        <p>{patient?.name ?? "Select a patient from the worklist"}</p>
      </div>
      {sections.map((section) => {
        const records = rows.filter(
          (r) => r.patientId === patient?.id && section.kinds.includes(r.kind),
        );
        return (
          <section key={section.title}>
            <h3>
              <span>{section.title}</span>
              {section.label}
            </h3>
            {records.slice(0, 5).map((r) => (
              <div className="ehr-handover-item" key={r.id}>
                <span className={"ehr-check " + (finished(r) ? "complete" : "")}>
                  {finished(r) ? "✓" : "○"}
                </span>
                <div>
                  <button className="ehr-text-button" onClick={() => select(r.id)}>
                    {r.title}
                  </button>
                  <small>
                    {r.owner} · {r.status}
                  </small>
                  <div className="ehr-inline-actions">
                    <ActionButton record={r} act={act} pending={pending} />
                    {section.title === "01" && !r.visibleTo.includes("gp") && (
                      <button disabled={pending} onClick={() => act("share_record", r, "gp")}>
                        Send to GP
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!records.length && <p className="ehr-empty">Nothing recorded yet.</p>}
            {section.operation && (
              <button
                className="ehr-add-row"
                disabled={!patient || pending}
                onClick={() => {
                  if (section.operation) open(section.operation);
                }}
              >
                + {section.operation.label}
              </button>
            )}
          </section>
        );
      })}
    </aside>
  );
}
function HospitalWorklist({
  patients,
  rows,
  selectedPatient,
  selectPatient,
}: Pick<Props, "patients" | "rows" | "selectedPatient" | "selectPatient">) {
  const [filter, setFilter] = useState("All patients");
  const worklist = patients.filter(
    (p) =>
      filter === "All patients" ||
      rows.some(
        (r) =>
          r.patientId === p.id &&
          !finished(r) &&
          (filter === "Urgent"
            ? r.priority === "urgent"
            : ["discharge", "handover", "prescription", "visit"].includes(r.kind)),
      ),
  );
  return (
    <>
      <div className="ehr-section-heading">
        <h2>
          Patient worklist<small>{worklist.length} patients in current search</small>
        </h2>
        <select
          aria-label="Filter hospital worklist"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {["All patients", "Urgent", "Handover outstanding"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <div className="ehr-table-wrap">
        <table className="ehr-table ehr-worklist">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Clinical context</th>
              <th>Outstanding</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>
            {worklist.map((p) => {
              const current = rows.filter(
                (r) => r.patientId === p.id && !finished(r) && r.kind !== "ehr-record",
              );
              const urgent = current.some((r) => r.priority === "urgent");
              return (
                <tr key={p.id} className={p.id === selectedPatient ? "selected" : ""}>
                  <td>
                    <button className="ehr-record-link" onClick={() => selectPatient(p.id)}>
                      {p.name}
                    </button>
                    <small>
                      {p.id} · {date(p.birthDate)}
                    </small>
                  </td>
                  <td>{p.conditions.join(", ") || "No problems recorded"}</td>
                  <td>
                    {current.length} records<small>{current[0]?.kind ?? "No pending work"}</small>
                  </td>
                  <td>
                    <span className={urgent ? "ehr-urgent" : "ehr-routine"}>
                      {urgent ? "Urgent" : "Routine"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!worklist.length && <p className="ehr-empty">No patients match this worklist.</p>}
    </>
  );
}
function CareCoordination({
  rows,
  initialService,
  act,
  pending,
  select,
  open,
}: {
  rows: Resource[];
  initialService: string;
  select: (id: string) => void;
  open: (operation: Operation) => void;
} & Pick<Props, "act" | "pending">) {
  const [service, setService] = useState(initialService === "community" ? "community" : "pharmacy");
  const visible = rows
    .filter(
      (r) =>
        r.owner === service &&
        (service === "pharmacy"
          ? r.kind === "prescription"
          : ["visit", "task", "referral"].includes(r.kind)),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const operation = operations.find(
    (item) => item.type === (service === "pharmacy" ? "draft_prescription" : "schedule_visit"),
  );
  return (
    <section className="ehr-coordination">
      <div className="ehr-section-heading">
        <h2>
          {service === "pharmacy" ? "Community pharmacy" : "Community nursing"}
          <small>Shared service records for this patient</small>
        </h2>
        <select
          aria-label="Care coordination service"
          value={service}
          onChange={(event) => setService(event.target.value)}
        >
          <option value="pharmacy">Pharmacy</option>
          <option value="community">Community</option>
        </select>
      </div>
      <p className="ehr-coordination-note">
        {service === "pharmacy"
          ? "Review the draft, approve supply, then record dispensing and collection. Each step updates the shared prescription."
          : "Schedule a home visit and track its progress with the community team. The shared record stays linked to this patient."}
      </p>
      <div className="ehr-table-wrap">
        <table className="ehr-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>{service === "pharmacy" ? "Prescription" : "Visit / follow-up"}</th>
              <th>Status</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>{date(r.createdAt)}</td>
                <td>
                  <button className="ehr-record-link" onClick={() => select(r.id)}>
                    {r.title}
                  </button>
                  <small>
                    {r.owner} · {r.id}
                  </small>
                </td>
                <td>{r.status}</td>
                <td>
                  <ActionButton record={r} act={act} pending={pending} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <p className="ehr-empty">
          No {service === "pharmacy" ? "prescriptions" : "community visits"} recorded for this
          patient.
        </p>
      )}
      <div className="ehr-pagination">
        <span>{visible.length} shared records</span>
        {operation && (
          <button disabled={pending} onClick={() => open(operation)}>
            + {operation.label}
          </button>
        )}
      </div>
    </section>
  );
}
export function SystemWorkspace(props: Props) {
  const hospital = props.siteId === "hospital";
  const careService = new URLSearchParams(location.search).get("care") ?? "";
  const [tab, setTab] = useState(
    ["community", "pharmacy"].includes(careService)
      ? "Care coordination"
      : hospital
        ? "Worklist"
        : "Journal",
  );
  const [recordId, setRecordId] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  const patient = props.patients.find((p) => p.id === props.selectedPatient);
  const rows = props.rows.filter((r) => r.patientId === patient?.id);
  const coordinationRows = [
    ...props.rows,
    ...(props.handoverRows ?? []).filter(
      (r) => !props.rows.some((existing) => existing.id === r.id),
    ),
  ];
  const selectedRecord = coordinationRows.find(
    (r) => r.id === recordId && r.patientId === patient?.id,
  );
  const tabs = hospital
    ? ["Worklist", "Journal", "Results", "Medication", "Documents", "Care coordination"]
    : [
        "Journal",
        "Consultations",
        "Appointment book",
        "Problems",
        "Medication",
        "Results",
        "Documents",
        "Tasks",
        "Coded history",
        "Care coordination",
      ];
  return (
    <section className={"system-ui immersive-ehr " + (hospital ? "millbank" : "systemtwo")}>
      <header className="ehr-titlebar">
        <strong>
          {hospital ? "Millbank" : "SystemTwo"}
          <span>{hospital ? "EPR" : "Primary care"}</span>
        </strong>
        <button
          onClick={() => (props.exitToMap ? props.exitToMap() : location.assign("/control/"))}
        >
          Neighbourhood map
        </button>
        <span className="ehr-location">
          {hospital ? "Northbank General" : "Riverside Practice"}
        </span>
        <span className="ehr-identity">{props.identityLabel ?? "Simulation workspace"}</span>
      </header>
      <div className="ehr-toolbar">
        {!hospital && (
          <button
            disabled={!patient}
            onClick={() => {
              setTab("Consultations");
              setRecordId("");
            }}
          >
            New consultation
          </button>
        )}
        {!hospital && (
          <button
            onClick={() => {
              setTab("Appointment book");
              setRecordId("");
            }}
          >
            Appointment book
          </button>
        )}
        {operations
          .filter((x) => !hospital || x.type !== "create_referral")
          .map((x) => (
            <button
              key={x.type}
              disabled={!patient || props.pending}
              onClick={() => setOperation(x)}
            >
              {x.label}
            </button>
          ))}
        <a href="/docs/" target="_blank" rel="noreferrer">
          Handbook ↗
        </a>
        <time>{date(props.view.now)}</time>
      </div>
      <div className="ehr-searchbar">
        <PatientFinder {...props} />
        <span>
          {hospital
            ? "Inpatient care · shared discharge coordination"
            : "Longitudinal record · practice correspondence"}
        </span>
      </div>
      <Banner patient={patient} rows={props.rows} />
      <div className="ehr-body">
        <div className="ehr-main">
          <nav className="ehr-tabs" aria-label="Patient record sections">
            {tabs.map((name) => (
              <button
                key={name}
                aria-current={tab === name ? "page" : undefined}
                className={tab === name ? "active" : ""}
                onClick={() => {
                  setTab(name);
                  setRecordId("");
                }}
              >
                {name}
              </button>
            ))}
          </nav>
          <div className="ehr-content">
            {hospital && tab === "Worklist" ? (
              <HospitalWorklist {...props} />
            ) : tab === "Appointment book" ? (
              <AppointmentBook
                now={props.view.now}
                api={props.api}
                patient={patient}
                selectPatient={props.selectPatient}
              />
            ) : !patient ? (
              <div className="ehr-start">
                <span>＋</span>
                <h2>Open a patient record</h2>
                <p>Search by name or ID above to begin.</p>
                <div>
                  {props.patients.slice(0, 6).map((p) => (
                    <button key={p.id} onClick={() => props.selectPatient(p.id)}>
                      {p.name}
                      <small>{p.id}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : tab === "Consultations" ? (
              <Consultations
                key={props.view.id + patient.id}
                worldId={props.view.id}
                patient={patient}
                rows={rows}
                api={props.api}
                siteId={props.siteId}
              />
            ) : tab === "Care coordination" ? (
              <CareCoordination
                rows={coordinationRows.filter((r) => r.patientId === patient.id)}
                initialService={careService}
                act={props.act}
                pending={props.pending}
                select={setRecordId}
                open={setOperation}
              />
            ) : ["Problems", "Medication", "Coded history"].includes(tab) ? (
              <ClinicalCollections
                key={patient.id + tab}
                rows={rows}
                patientId={patient.id}
                collection={tab}
              />
            ) : (
              <Journal key={patient.id + tab} rows={rows} tab={tab} select={setRecordId} />
            )}
            {selectedRecord && (
              <Detail
                record={selectedRecord}
                act={props.act}
                pending={props.pending}
                siteId={props.siteId}
                close={() => setRecordId("")}
              />
            )}
          </div>
        </div>
        {hospital ? (
          <Handover
            patient={patient}
            rows={coordinationRows}
            act={props.act}
            pending={props.pending}
            open={setOperation}
            select={setRecordId}
          />
        ) : (
          <Summary
            patient={patient}
            rows={coordinationRows}
            act={props.act}
            pending={props.pending}
            select={setRecordId}
          />
        )}
      </div>
      <footer className="ehr-statusbar">
        <span>{props.pending ? "Saving changes…" : "Connected to simulation"}</span>
        <span>
          {patient ? patient.id + " · " + rows.length + " shared records" : "No patient open"}
        </span>
        <span>Fictional clinical system · {date(props.view.now)}</span>
      </footer>
      {operation && patient && (
        <Composer
          operation={operation}
          patient={patient}
          create={props.create}
          pending={props.pending}
          close={() => setOperation(null)}
        />
      )}
    </section>
  );
}
