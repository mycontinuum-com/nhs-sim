import React, { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { sites, type Resource } from "../../contracts/src/index.ts";
import { dischargeDocumentSchema, dischargeSectionLabels, dischargeSectionsSchema } from "../../contracts/src/documents.ts";
import { medicationOrderSchema, bloodTestOrderSchema } from "../../contracts/src/clinical-orders.ts";
import { hospitalNoteSchema } from "../../contracts/src/clinical-notes.ts";
import { RecordAttribution } from "./record-attribution.tsx";
import "./clinical-journal.css";

const narrativeSchema = z.object({
  text: z.string().optional().catch(undefined), note: z.string().optional().catch(undefined), summary: z.string().optional().catch(undefined), details: z.string().optional().catch(undefined),
  author: z.string().optional().catch(undefined), clinician: z.string().optional().catch(undefined), channel: z.string().optional().catch(undefined), mode: z.string().optional().catch(undefined),
  reason: z.string().optional().catch(undefined), value: z.union([z.string(), z.number()]).optional(), unit: z.string().optional().catch(undefined), units: z.string().optional().catch(undefined),
  metric: z.string().optional().catch(undefined), outcome: z.string().optional().catch(undefined), drug: z.string().optional().catch(undefined), dose: z.string().optional().catch(undefined),
  route: z.string().optional().catch(undefined), frequency: z.string().optional().catch(undefined), instructions: z.string().optional().catch(undefined),
  sections: z.union([z.record(z.string(), z.string()), z.array(z.object({ id: z.string(), heading: z.string(), text: z.string() }))]).optional(),
});
const hiddenKinds = new Set(["ehr-record", "device", "capacity", "stock", "pharmacy-stock", "supplier-quote", "appointment-session"]);
const documentKinds = new Set(["hospital-note", "clinical-note", "consultation", "encounter", "document", "discharge", "discharge-summary", "handover", "referral"]);
const date = (time: number) => new Date(time).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const time = (stamp: number) => new Date(stamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const label = (value: string) => value.replaceAll("-", " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
function content(record: Resource) {
  const parsed = narrativeSchema.safeParse(record.data);
  const data = parsed.success ? parsed.data : {};
  const note = record.kind === "hospital-note" ? hospitalNoteSchema.safeParse(record.data) : undefined;
  const letter = record.kind === "discharge-summary" ? dischargeDocumentSchema.safeParse(record.data) : undefined;
  const medication = medicationOrderSchema.safeParse(record.data.medicationOrder);
  const bloodTest = bloodTestOrderSchema.safeParse(record.data.bloodTestOrder);
  const lines: { heading: string; text: string }[] = [];
  if (note?.success) {
    lines.push(...note.data.sections.filter(section => section.text.trim()));
  } else if (letter?.success) {
    for (const key of dischargeSectionsSchema.keyof().options) if (letter.data.sections[key]) lines.push({ heading: dischargeSectionLabels[key], text: letter.data.sections[key] });
  } else if (medication.success) {
    const order = medication.data;
    lines.push({ heading: "Medication", text: order.drug }, { heading: "Dose", text: `${order.dose} ${order.unit}` }, { heading: "Route", text: order.route }, { heading: "Frequency", text: order.frequency }, { heading: "Duration", text: order.duration }, { heading: "Quantity", text: String(order.quantity) }, { heading: "Indication", text: order.indication });
  } else if (bloodTest.success) {
    const order = bloodTest.data;
    lines.push({ heading: "Investigation", text: order.panel }, { heading: "Specimen", text: order.specimen }, { heading: "Priority", text: label(order.priority) }, { heading: "Collection", text: label(order.collection) }, { heading: "Clinical details", text: order.clinicalDetails });
  } else {
    if (data.reason) lines.push({ heading: "Reason for contact", text: data.reason });
    if (data.sections) {
      if (Array.isArray(data.sections)) lines.push(...data.sections.filter(section => section.text.trim()));
      else for (const [key, value] of Object.entries(data.sections)) if (value.trim()) lines.push({ heading: label(key), text: value });
    }
    for (const [heading, text] of [["Consultation", data.text], ["Note", data.note], ["Summary", data.summary], ["Details", data.details], ["Outcome", data.outcome], ["Medication", data.drug], ["Dose", data.dose], ["Route", data.route], ["Frequency", data.frequency], ["Instructions", data.instructions]]) {
      if (heading && text && !lines.some(line => line.text === text) && !(heading === "Consultation" && data.sections && Array.isArray(data.sections))) lines.push({ heading, text });
    }
    if (data.value !== undefined) lines.push({ heading: data.metric ? label(data.metric) : "Recorded value", text: `${data.value}${data.unit || data.units ? ` ${data.unit ?? data.units}` : ""}` });
  }
  return { data, lines, note: note?.success ? note.data : undefined };
}
export function ClinicalRecordBody({ record }: { record: Resource }) {
  const { lines, note } = content(record);
  return <><dl className="journal-narrative">{lines.map((line, index) => <div key={index}><dt>{line.heading}</dt><dd>{line.text}</dd></div>)}</dl>
    {!lines.length && <p className="journal-no-body">{record.title}</p>}
    {note?.stage === "signed" && <><div className="journal-signature"><strong>Signature line</strong><p>Electronically signed by {note.signedBy} on {date(note.signedAt)} at {time(note.signedAt)} UTC</p></div>
    {note.addenda.map((addendum, index) => <section className="journal-addendum" key={index}><h4>Addendum {index + 1}</h4><p>{addendum.text}</p><small>{addendum.author} · {date(addendum.time)} {time(addendum.time)} UTC</small></section>)}</>}
  </>;
}
export function ClinicalJournal({ rows, tab, variant, select, onNewNote, onEditNote, selectedId: requestedId }: {
  rows: Resource[]; tab: string; variant: "gp" | "hospital"; select: (id: string) => void;
  selectedId?: string; onNewNote?: () => void; onEditNote?: (record: Resource) => void;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [limit, setLimit] = useState(30);
  const [selectedId, setSelectedId] = useState(requestedId ?? "");
  useEffect(() => { if (requestedId) setSelectedId(requestedId); }, [requestedId]);
  const entries = useMemo(() => rows.filter(record => !hiddenKinds.has(record.kind) &&
    (!["Documents", "Documentation"].includes(tab) || documentKinds.has(record.kind)) &&
    (tab !== "Results" || ["test", "report", "observation"].includes(record.kind)) &&
    (tab !== "Orders" || ["prescription", "test", "report", "genomic-test"].includes(record.kind)) &&
    (tab !== "Tasks" || ["task", "visit", "appointment", "prescription"].includes(record.kind)))
    .sort((a, b) => b.createdAt - a.createdAt), [rows, tab]);
  const filtered = entries.filter(record => {
    const { data, lines, note } = content(record);
    return (!kind || record.kind === kind) && [record.title, record.patientId, record.owner, record.status, data.author, data.clinician, ...lines.map(line => line.text), ...(note?.stage === "signed" ? note.addenda.map(addendum => `${addendum.text} ${addendum.author}`) : []), record.provenance?.created?.actor.name].join(" ").toLowerCase().includes(search.toLowerCase());
  });
  const visible = filtered.slice(0, limit);
  const selected = filtered.find(record => record.id === selectedId) ?? visible[0];
  const title = variant === "hospital" && ["Journal", "Documents"].includes(tab) ? "Documentation" : tab === "Journal" ? "Consultation record" : tab;
  const service = (record: Resource) => sites.find(site => site.id === record.owner)?.name ?? label(record.owner);
  const context = (record: Resource) => {
    const { data } = content(record);
    return [data.author ?? data.clinician, data.channel ?? data.mode, service(record)].filter(Boolean).join(" · ");
  };
  return <section className={`clinical-journal journal-${variant}`} aria-label={title}>
    <div className="journal-titlebar"><h2>{title}</h2><span>Newest at top · Simulation record</span></div>
    <div className="journal-toolbar">{onNewNote && <button onClick={onNewNote}>＋ {variant === "hospital" ? "Add note" : "New consultation"}</button>}
      <label>Display <select aria-label="Journal entry type" value={kind} onChange={event => { setKind(event.target.value); setLimit(30); }}><option value="">All record types</option>{[...new Set(entries.map(record => record.kind))].sort().map(type => <option key={type} value={type}>{label(type)}</option>)}</select></label>
      <input aria-label="Filter clinical journal" placeholder="Search record text or author" value={search} onChange={event => { setSearch(event.target.value); setLimit(30); }} />
      <span>{filtered.length} entries</span>
    </div>
    {variant === "gp" ? <div className="journal-contacts">{visible.map((record, index) => <React.Fragment key={record.id}>
      {(index === 0 || date(visible[index - 1]?.createdAt ?? 0) !== date(record.createdAt)) && <h3 className="journal-date-heading">{date(record.createdAt)}</h3>}
      <article className="journal-contact"><header><time>{time(record.createdAt)} UTC</time><div><h4>{record.title}</h4><span>{context(record)} · {label(record.kind)} · {record.status}</span></div></header>
        <ClinicalRecordBody record={record}/><RecordAttribution record={record}/><details className="journal-entry-details"><summary>Record details and activity</summary><p>Patient {record.patientId} · {record.id}</p><RecordAttribution record={record} history summary={false}/><button onClick={() => select(record.id)}>Open record actions</button></details>
      </article></React.Fragment>)}</div> : <div className="journal-documentation">
      <div className="journal-document-list" aria-label="Document list"><div className="journal-list-heading">Arranged by date <span>{visible.length} shown</span></div>{visible.map(record => <button key={record.id} className={record.id === selected?.id ? "selected" : ""} aria-pressed={record.id === selected?.id} onClick={() => setSelectedId(record.id)}><strong>{record.title}</strong><time>{date(record.createdAt)} {time(record.createdAt)}</time><span>{context(record)}</span><small>{label(record.kind)} · {record.status}</small></button>)}</div>
      <article className="journal-paper" aria-label="Document preview">{selected ? <><div className="journal-preview-actions"><span>{label(selected.kind)} · {selected.status}</span>{selected.kind === "hospital-note" && onEditNote && <button onClick={() => onEditNote(selected)}>{selected.status === "signed" ? "Add addendum" : "Modify note"}</button>}<button onClick={() => select(selected.id)}>Record details</button></div>
        <div className="journal-paper-content"><h3>{selected.title}</h3><p className="journal-paper-context">Patient {selected.patientId} · {date(selected.createdAt)} {time(selected.createdAt)} UTC</p><p>{context(selected)}</p><ClinicalRecordBody record={selected}/><div className="journal-paper-attribution"><RecordAttribution record={selected} history/></div></div>
      </> : <p className="journal-no-body">No entries match this view.</p>}</article>
    </div>}
    {!filtered.length && variant === "gp" && <p className="journal-no-body">No entries match this view.</p>}
    {filtered.length > visible.length && <button className="journal-load-more" onClick={() => setLimit(limit + 30)}>Show 30 older entries ({filtered.length - visible.length} remaining)</button>}
  </section>;
}
