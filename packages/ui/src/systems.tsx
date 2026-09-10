import { RecordAttribution } from "./record-attribution.tsx";
import React, { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AppointmentBook, Consultations, type WorkflowApi } from "./gp-workflows.tsx";
import { Problems } from "./gp-problems.tsx";
import { Allergies } from "./gp-allergies.tsx";
import { patientProblems } from "../../contracts/src/problems.ts";
import { patientAllergies } from "../../contracts/src/allergies.ts";
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
  patientMatches: Patient[];
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
  if (["ehr-record", "problem", "allergy"].includes(r.kind)) return;
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
  siteId = "gp",
}: { record: Resource; siteId?: SiteId } & Pick<Props, "act" | "pending">) {
  const action = nextAction(record);
  const service = record.kind === "referral" && record.owner === "referrals" && record.visibleTo.includes("hospital") ? "hospital" : record.owner;
  if (action && service !== siteId && !(siteId === "gp" && record.kind === "test" && record.status === "available")) {
    return ["gp", "hospital", "pharmacy", "community", "wearables"].includes(service)
      ? <a className="ehr-record-link" href={`/${service}/?patient=${encodeURIComponent(record.patientId ?? "")}`}>Open in {service}</a>
      : <span className="ehr-terminal">{record.status} · managed by {service}</span>;
  }
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
          {props.patientMatches.map((patient) => (
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
          {!props.patientMatches.length && <p>No matching patients.</p>}
        </div>
      )}
    </div>
  );
}
function Banner({ patient, rows }: { patient: Patient | undefined; rows: Resource[] }) {
  const allergies = patient ? patientAllergies(rows, patient.id).filter((allergy) => allergy.status === "active") : [];
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
          {patient ? allergies.map((allergy) => allergy.term).join(", ") || "No active allergies recorded" : "Select a patient"}
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
      <RecordAttribution record={record} history />
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
        <ActionButton record={record} act={act} pending={pending} siteId={siteId} />
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
  select,
  patient,
}: {
  rows: Resource[];
  patientId: string;
  collection: string;
  select?: (id: string) => void;
  patient?: Patient;
}) {
  const parsed = ehrSchema.safeParse(
    rows.find((r) => r.kind === "ehr-record" && r.patientId === patientId)?.data,
  );
  const [page, setPage] = useState(0);
  const prescriptions = rows.filter((record) => record.patientId === patientId && record.kind === "prescription");
  const entries =
    collection === "Problems" && patient
      ? patientProblems(rows, patient).map((x) => ({
          title: x.term,
          date: x.onsetDate,
          detail: x.code,
          status: x.status,
        }))
      : !parsed.success ? [] : collection === "Medication"
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
      {collection === "Medication" && <section>
        <h3>Prescription requests</h3>
        {prescriptions.length ? <table className="ehr-table"><thead><tr><th>Request</th><th>Status</th><th>Service</th></tr></thead><tbody>
          {prescriptions.map((record) => <tr key={record.id}><td>
            <button className="ehr-record-link" onClick={() => select?.(record.id)}>{record.title}</button>
            <RecordAttribution record={record} />
          </td><td>{record.status}</td><td>Pharmacy</td></tr>)}
        </tbody></table> : <p className="ehr-empty">No prescription requests. Use Prescription above to create one.</p>}
        <h3>Medication history</h3>
      </section>}
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
                  <RecordAttribution record={r} />
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
                  <RecordAttribution record={r} />
                  <small>
                    {r.owner} · {r.status}
                  </small>
                  <div className="ehr-inline-actions">
                    <ActionButton record={r} act={act} pending={pending} siteId="hospital" />
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
                  <RecordAttribution record={r} />
                  <small>
                    {r.owner} · {r.id}
                  </small>
                </td>
                <td>{r.status}</td>
                <td>
                  <ActionButton record={r} act={act} pending={pending} siteId={r.owner} />
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
function PracticeWorkspace(props: Props) {
  const hospital = props.siteId === "hospital";
  const careService = new URLSearchParams(location.search).get("care") ?? "";
  const [tab, setTab] = useState(
    ["community", "pharmacy"].includes(careService)
      ? "Care coordination"
      : hospital
        ? "Worklist"
        : props.selectedPatient ? "Journal" : "Home",
  );
  const [recordId, setRecordId] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [newNoteRequest, setNewNoteRequest] = useState<{id: number; patientId: string}>();
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
  const [menu, setMenu] = useState("");
  const menuBar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !menuBar.current?.contains(event.target)) setMenu(""); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menu]);
  const navigate = (name: string) => { setTab(name); setRecordId(""); setMenu(""); };
  const findPatient = () => { setMenu(""); document.getElementById("ehr-patient-search")?.focus(); };
  const shortcuts = [
    { label: "Search", symbol: "⌕", run: findPatient },
    { label: "Appointments", symbol: "▦", run: () => navigate("Appointment book") },
    { label: "Consultations", symbol: "✎", run: () => navigate("Consultations") },
    { label: "Problems", symbol: "✚", run: () => navigate("Problems") },
    { label: "Results", symbol: "▤", run: () => navigate("Results") },
    { label: "Medication", symbol: "℞", run: () => navigate("Medication") },
    { label: "Tasks", symbol: "☑", run: () => navigate("Tasks") },
    { label: "Care coordination", symbol: "⇄", run: () => navigate("Care coordination") },
  ];
  const tabs = hospital
    ? ["Worklist", "Journal", "Results", "Medication", "Documents", "Care coordination"]
    : [
        "Home",
        "Journal",
        "Consultations",
        "Appointment book",
        "Problems",
        "Allergies",
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
          <span>{hospital ? "EPR" : "Primary care"} · SIMULATION</span>
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
      <nav ref={menuBar} className="practice-menubar" aria-label="Practice menu" onKeyDown={(event) => { if (event.key === "Escape") setMenu(""); }}>
        {[
          { name: "Patient", items: [{ label: "Find patient", run: findPatient }, { label: "Practice home", run: () => navigate("Home") }, { label: "Patient journal", run: () => navigate("Journal") }] },
          { name: "Appointments", items: [{ label: "Appointment book", run: () => navigate("Appointment book") }] },
          { name: "Clinical tools", items: shortcuts.filter((item) => ["Consultations", "Problems", "Medication", "Results"].includes(item.label)) },
          { name: "Workflow", items: [{ label: "Task list", run: () => navigate("Tasks") }, { label: "Pathology / radiology inbox", run: () => navigate("Results") }, { label: "Document management", run: () => navigate("Documents") }, { label: "Care coordination", run: () => navigate("Care coordination") }] },
        ].map((group) => <div className="practice-menu" key={group.name}>
          <button aria-expanded={menu === group.name} onClick={() => setMenu(menu === group.name ? "" : group.name)}>{group.name}</button>
          {menu === group.name && <div className="practice-menu-items">{group.items.map((item) => <button key={item.label} onClick={item.run}>{item.label}</button>)}</div>}
        </div>)}
        <a href="/docs/" target="_blank" rel="noreferrer">Help</a>
      </nav>
      <div className="ehr-toolbar practice-iconbar">
        <button onClick={findPatient}><span aria-hidden="true">⌕</span>Search</button>
        <button onClick={() => navigate("Home")}><span aria-hidden="true">▦</span>Home</button>
        <button disabled={!patient} onClick={() => { navigate("Consultations"); if (patient) setNewNoteRequest({ id: Date.now(), patientId: patient.id }); }}><span aria-hidden="true">✎</span>New consultation</button>
        {operations.map((operation, index) => <button key={operation.type} disabled={!patient || props.pending} onClick={() => setOperation(operation)}><span aria-hidden="true">{["☑", "▤", "℞", "↗", "⌂"][index]}</span>{operation.label}</button>)}
        <time>{date(props.view.now)}</time>
      </div>
      <div className="ehr-searchbar">
        <PatientFinder {...props} selectPatient={(id) => { props.selectPatient(id); if (tab === "Home") navigate("Journal"); }} />
        <span>
          {hospital
            ? "Inpatient care · shared discharge coordination"
            : "Longitudinal record · practice correspondence"}
        </span>
      </div>
      {tab !== "Home" && <Banner patient={patient} rows={props.rows} />}
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
            {tab === "Home" ? (
              <div className="practice-desktop">
                <section className="practice-shortcuts"><h2>Riverside Practice</h2><p>Clinical workspace</p><div>{shortcuts.map((shortcut) => <button key={shortcut.label} onClick={shortcut.run}><span aria-hidden="true">{shortcut.symbol}</span>{shortcut.label}</button>)}</div></section>
                <section className="practice-recent"><h2>Open a patient record</h2><p>Search the directory or select a patient below.</p>{props.patients.slice(0, 8).map((person) => <button key={person.id} onClick={() => { props.selectPatient(person.id); navigate("Journal"); }}><b>{person.name}</b><span>{person.id} · {date(person.birthDate)}</span></button>)}</section>
              </div>
            ) : hospital && tab === "Worklist" ? (
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
                newNoteRequest={newNoteRequest}
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
            ) : tab === "Problems" ? (
              <Problems key={props.view.id + patient.id} patient={patient} rows={rows} api={props.api} siteId={props.siteId} />
            ) : tab === "Allergies" ? (
              <Allergies key={props.view.id + patient.id} patient={patient} rows={rows} api={props.api} siteId={props.siteId} />
            ) : ["Medication", "Coded history"].includes(tab) ? (
              <ClinicalCollections
                key={patient.id + tab}
                rows={rows}
                patientId={patient.id}
                collection={tab}
                select={setRecordId}
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
        {tab !== "Home" && <details className="ehr-summary-disclosure">
          <summary>Patient overview and outstanding tasks</summary>
          <Summary patient={patient} rows={coordinationRows} act={props.act} pending={props.pending} select={setRecordId} />
        </details>}
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

function HospitalSummary({ patient, rows, openSection, select }: { patient: Patient; rows: Resource[]; openSection: (section: string) => void; select: (id: string) => void }) {
  const problems = patientProblems(rows, patient);
  const sections = [
    { title: "Results & investigations", destination: "Results", records: rows.filter((record) => ["test", "report", "observation", "genomic-test"].includes(record.kind)) },
    { title: "Current care activity", destination: "Journal", records: rows.filter((record) => ["encounter", "task", "referral", "visit"].includes(record.kind) && !finished(record)) },
    { title: "Documents & handover", destination: "Handover", records: rows.filter((record) => ["document", "discharge", "handover"].includes(record.kind)) },
  ];
  return <div className="hospital-summary-panels">
    <div className="hospital-summary-heading"><h2>Inpatient summary</h2><span>Shared clinical record · {patient.id}</span></div>
    <section><header><h3>Histories</h3><button onClick={() => openSection("Problems")}>Open problem list</button></header><div className="hospital-panel-strip">Problems ({problems.length})</div><table className="ehr-table"><thead><tr><th>Problem</th><th>Status</th><th>Onset</th></tr></thead><tbody>{problems.slice(0, 8).map((problem) => <tr key={problem.key}><td>{problem.term}</td><td>{problem.status}</td><td>{problem.onsetDate || "Not recorded"}</td></tr>)}</tbody></table>{!problems.length && <p className="ehr-empty">No problems recorded.</p>}</section>
    {sections.map((section) => <section key={section.title}><header><h3>{section.title}</h3><button onClick={() => openSection(section.destination)}>View all ({section.records.length})</button></header><table className="ehr-table"><thead><tr><th>Record</th><th>Status</th><th>Recorded</th></tr></thead><tbody>{section.records.slice(0, 5).map((record) => <tr key={record.id}><td><button className="ehr-record-link" onClick={() => select(record.id)}>{record.title}</button><RecordAttribution record={record} /></td><td>{record.status}</td><td>{date(record.createdAt)}</td></tr>)}</tbody></table>{!section.records.length && <p className="ehr-empty">No records available in this section.</p>}</section>)}
  </div>;
}

function HospitalWorkspace(props: Props) {
  const [section, setSection] = useState("Hospital operations");
  const [drawerTab, setDrawerTab] = useState(
    new URLSearchParams(location.search).has("care") ? "Handover" : "Summary",
  );
  const [recordId, setRecordId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(Boolean(props.selectedPatient));
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [activityGroup, setActivityGroup] = useState("All activity");
  const [limit, setLimit] = useState(30);
  const [operation, setOperation] = useState<Operation | null>(null);
  const allRows = [
    ...props.rows,
    ...(props.handoverRows ?? []).filter(
      (r) => !props.rows.some((existing) => existing.id === r.id),
    ),
  ];
  const patient = props.patients.find((p) => p.id === props.selectedPatient);
  const patientRows = allRows.filter((r) => r.patientId === patient?.id);
  const record = allRows.find((r) => r.id === recordId && (!r.patientId || r.patientId === props.selectedPatient));
  const operational = props.rows.filter(
    (r) => !["ehr-record", "problem", "allergy", "staff", "capacity", "robot"].includes(r.kind) && !finished(r),
  );
  const search = props.patientSearch.trim().toLowerCase();
  const visible = operational.filter(
    (r) =>
      (!urgentOnly || r.priority === "urgent") &&
      (!search ||
        [r.title, r.patientId ?? "", props.patients.find((p) => p.id === r.patientId)?.name ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(search)),
  );
  const groups = [
    {
      title: "Active care",
      subtitle: "Encounters, referrals & tasks",
      rows: visible.filter(
        (r) =>
          ![
            "test",
            "report",
            "observation",
            "genomic-test",
            "discharge",
            "document",
            "handover",
            "prescription",
            "visit",
          ].includes(r.kind),
      ),
    },
    {
      title: "Investigations",
      subtitle: "Requests & results",
      rows: visible.filter((r) =>
        ["test", "report", "observation", "genomic-test"].includes(r.kind),
      ),
    },
    {
      title: "Discharge & onward care",
      subtitle: "Documents & transitions between services",
      rows: visible.filter((r) =>
        ["discharge", "document", "handover", "prescription", "visit"].includes(r.kind),
      ),
    },
  ];
  const activityRows = activityGroup === "All activity" ? visible : groups.find((group) => group.title === activityGroup)?.rows ?? [];
  const openRecord = (r: Resource) => {
    props.selectPatient(r.patientId ?? "");
    setRecordId(r.id);
    setDrawerTab("Encounter");
    setDrawerOpen(true);
  };
  return (
    <section className="system-ui immersive-ehr hospital-operations">
      <header className="hospital-masthead">
        <div className="hospital-brand">
          <span aria-hidden="true">▦</span>
          <div>
            <strong>Millbank</strong>
            <small>Hospital record · SIMULATION</small>
          </div>
        </div>
        <nav aria-label="Hospital workspace">
          {["Hospital operations", "All records"].map((name) => (
            <button
              key={name}
              className={section === name ? "active" : ""}
              onClick={() => { setSection(name); setDrawerOpen(false); }}
            >
              {name}
            </button>
          ))}
        </nav>
        <button
          onClick={() => (props.exitToMap ? props.exitToMap() : location.assign("/control/"))}
        >
          ← Neighbourhood map
        </button>
        <span>{props.identityLabel ?? "Simulation workspace"}</span>
      </header>
      <div className="hospital-contextbar">
        <b>Millbank · Clinical workspace</b>
        <span>Northbank General</span>
        <span>{props.view.staffing.staffedSpaces} staffed spaces · {props.view.staffing.waiting} waiting</span>
        <time>{date(props.view.now)}</time>
      </div>
      <div className="hospital-tools">
        <PatientFinder
          {...props}
          selectPatient={(id) => {
            props.selectPatient(id);
            setRecordId("");
            setDrawerTab("Summary");
            setDrawerOpen(true);
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={urgentOnly}
            onChange={(e) => {
              setUrgentOnly(e.target.checked);
              setLimit(30);
            }}
          />{" "}
          Urgent only
        </label>
        <a href="/docs/" target="_blank" rel="noreferrer">
          Handbook ↗
        </a>
      </div>
      <div
        className={"hospital-stage" + (drawerOpen && (patient || record) ? " with-encounter" : "")}
      >
        <main className="hospital-board">
          {section === "Hospital operations" ? (
            <>
              <nav className="hospital-list-tabs" aria-label="Activity lists">
                {["All activity", ...groups.map((group) => group.title)].map((name) => (
                  <button
                    key={name}
                    className={activityGroup === name ? "active" : ""}
                    onClick={() => { setActivityGroup(name); setLimit(30); }}
                  >
                    {name}
                    <span>{name === "All activity" ? visible.length : groups.find((group) => group.title === name)?.rows.length}</span>
                  </button>
                ))}
              </nav>
              <div className="ehr-section-heading">
                <h2>Patient activity <small>Open a record to enter the patient chart</small></h2>
                <span>{urgentOnly ? "Urgent only" : "All priorities"}</span>
              </div>
              <div className="ehr-table-wrap">
                <table className="ehr-table hospital-activity-table">
                  <thead>
                    <tr>
                      <th>Priority</th><th>Patient / identifier</th><th>Activity</th>
                      <th>Type</th><th>Status</th><th>Service</th><th>Due / created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityRows.slice(0, limit).map((r) => (
                      <tr key={r.id}>
                        <td><span className={r.priority === "urgent" ? "ehr-urgent" : "ehr-routine"}>{r.priority}</span></td>
                        <td>
                          <button className="ehr-record-link" onClick={() => openRecord(r)}>
                            {props.patients.find((p) => p.id === r.patientId)?.name ?? r.patientId ?? "Service record"}
                          </button>
                          <small>{r.patientId ?? "Hospital"}</small>
                        </td>
                        <td><button className="ehr-record-link" onClick={() => openRecord(r)}>{r.title}</button></td>
                        <td>{r.kind}</td><td>{r.status}</td><td>{r.owner}</td>
                        <td>{date(r.dueAt ?? r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!activityRows.length && <p className="ehr-empty">No open records in this view. Find a patient above to open their chart.</p>}
              <div className="ehr-pagination">
                <span>{Math.min(limit, activityRows.length)} records shown</span>
                {activityRows.length > limit && <button onClick={() => setLimit(limit + 30)}>Show 30 more</button>}
              </div>
            </>
          ) : (
            <Journal
              rows={props.rows.filter((r) => !urgentOnly || r.priority === "urgent")}
              tab="Journal"
              select={(id) => {
                const r = props.rows.find((row) => row.id === id);
                if (r) openRecord(r);
              }}
            />
          )}
        </main>
        {drawerOpen && (patient || record) && (
          <aside className="hospital-encounter" aria-label="Patient encounter">
            <div className="hospital-chart-title">
              <button aria-label="Close encounter" onClick={() => setDrawerOpen(false)}>← Return to patient list</button>
              <b>Patient chart</b>
              <span>{props.identityLabel ?? "Simulation workspace"}</span>
            </div>
            <Banner patient={patient} rows={allRows} />
            {patient && (
              <div className="ehr-toolbar hospital-chart-actions">
                {operations.filter((x) => x.type !== "create_referral").map((x) => (
                  <button key={x.type} disabled={props.pending} onClick={() => setOperation(x)}>{x.label}</button>
                ))}
                <span>{patient.conditions.join(", ") || "No problems recorded"}</span>
              </div>
            )}
            <div className="hospital-chart-layout">
            <nav className="hospital-workflow-nav" aria-label="Encounter sections">
              <h2>Workflow</h2>
              {(patient
                ? [
                    "Summary",
                    "Encounter",
                    "Journal",
                    "Results",
                    "Medication",
                    "Problems",
                    "Documents",
                    "Handover",
                  ]
                : ["Encounter"]
              ).map((name) => (
                <button
                  className={drawerTab === name ? "active" : ""}
                  aria-current={drawerTab === name ? "page" : undefined}
                  key={name}
                  onClick={() => setDrawerTab(name)}
                >
                  {name}
                </button>
              ))}
            </nav>
            <div className="hospital-encounter-content">
              {drawerTab === "Summary" && patient ? (
                <HospitalSummary patient={patient} rows={patientRows} openSection={setDrawerTab} select={(id) => { setRecordId(id); setDrawerTab("Encounter"); }} />
              ) : drawerTab === "Encounter" ? (
                record ? (
                  <Detail
                    record={record}
                    act={props.act}
                    pending={props.pending}
                    siteId="hospital"
                    close={() => {
                      setRecordId("");
                      setDrawerTab("Journal");
                    }}
                  />
                ) : (
                  <p className="ehr-empty">
                    Open a record from this patient's journal to view its details.
                  </p>
                )
              ) : drawerTab === "Handover" && patient ? (
                <Handover
                  patient={patient}
                  rows={allRows}
                  act={props.act}
                  pending={props.pending}
                  open={setOperation}
                  select={(id) => {
                    setRecordId(id);
                    setDrawerTab("Encounter");
                  }}
                />
              ) : ["Medication", "Problems"].includes(drawerTab) && patient ? (
                <ClinicalCollections
                  key={patient.id + drawerTab}
                  rows={patientRows}
                  patientId={patient.id}
                  collection={drawerTab}
                  patient={patient}
                  select={(id) => { setRecordId(id); setDrawerTab("Encounter"); }}
                />
              ) : (
                <Journal
                  key={(patient?.id ?? "service") + drawerTab}
                  rows={
                    drawerTab === "Results"
                      ? patientRows.filter((r) =>
                          ["test", "report", "observation", "genomic-test"].includes(r.kind),
                        )
                      : patientRows
                  }
                  tab={drawerTab === "Results" ? "Journal" : drawerTab}
                  select={(id) => {
                    setRecordId(id);
                    setDrawerTab("Encounter");
                  }}
                />
              )}
            </div>
            </div>
          </aside>
        )}
      </div>
      <footer className="hospital-status">
        <span>{props.pending ? "Saving changes…" : "Connected to simulation"}</span>
        <span>
          {operational.length} open records loaded · {props.view.staffing.doctors} doctors ·{" "}
          {props.view.staffing.nurses} nurses
        </span>
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

export function SystemWorkspace(props: Props) {
  return props.siteId === "hospital" ? (
    <HospitalWorkspace {...props} />
  ) : (
    <PracticeWorkspace {...props} />
  );
}
