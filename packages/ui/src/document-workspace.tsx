import { DocumentCoding } from "./document-coding.tsx";
import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action, Patient, Resource } from "../../contracts/src/index.ts";
import { dischargeDocumentSchema, dischargeSectionsSchema, dischargeSectionLabels, emptyDischargeSections } from "../../contracts/src/documents.ts";
import type { WorkflowApi } from "./gp-workflows.tsx";
import { RecordAttribution } from "./record-attribution.tsx";
import { ProductBrand } from "./product-brand.tsx";
import "./document-workspace.css";
type Props = { api: WorkflowApi; worldId: string; mode: "hospital" | "gp"; selectedPatient: string; patients: Patient[]; standalone?: boolean };
type DocumentSort = "urgent" | "newest" | "oldest";
const documentSortOptions: { value: DocumentSort; label: string }[] = [
  { value: "urgent", label: "Urgent first" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];
const stageLabel = (stage: string) => stage === "sent" ? "Awaiting review" : stage === "reviewed" ? "Ready to file" : stage === "filed" ? "Filed" : stage === "draft" ? "Draft" : "All correspondence";
const dateLabel = (time: number) => new Date(time).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
export function DocumentWorkspace(props: Props) {
  const client = useQueryClient();
  const inboxRef = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<DocumentSort>("urgent");
  const [search, setSearch] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [patientOnly, setPatientOnly] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileLetter, setMobileLetter] = useState(false);
  const data = useQuery({ queryKey: ["documents", props.worldId, props.mode], queryFn: () => props.api<{ resources: Resource[]; patients: Patient[] }>(`/api/sites/${props.mode}/documents`), refetchInterval: 5000 });
  const mutation = useMutation({ mutationFn: (action: Action) => props.api<Resource>(`/api/sites/${props.mode}/actions`, action), onSuccess: (r, action) => { client.setQueryData<{ resources: Resource[]; patients: Patient[] }>(["documents", props.worldId, props.mode], previous => previous ? { ...previous, resources: previous.resources.some(item => item.id === r.id) ? previous.resources.map(item => item.id === r.id ? r : item) : [r, ...previous.resources] } : previous); setSelected(r.id); setEditing(false); setNotice(action.documentCommand === "annotate" ? "Tags and SNOMED codes saved." : r.status === "sent" && props.mode === "hospital" ? "Delivered to the GP document inbox." : r.status === "filed" ? "Filed in the patient's document history." : r.status === "reviewed" ? "Review recorded. Add a filing outcome to finish." : "Document saved."); void client.invalidateQueries(); } });
  const records = [...(data.data?.resources ?? [])].sort((a, b) => {
    const priority = Number(b.priority === "urgent") - Number(a.priority === "urgent");
    if (sort === "urgent" && priority) return priority;
    const left = dischargeDocumentSchema.safeParse(a.data);
    const right = dischargeDocumentSchema.safeParse(b.data);
    const leftTime = left.success && left.data.stage !== "draft" ? left.data.sentAt : a.provenance?.created?.time ?? 0;
    const rightTime = right.success && right.data.stage !== "draft" ? right.data.sentAt : b.provenance?.created?.time ?? 0;
    return (sort === "oldest" ? leftTime - rightTime : rightTime - leftTime) || a.id.localeCompare(b.id);
  });
  const names = new Map([...props.patients, ...(data.data?.patients ?? [])].map(p => [p.id, p.name]));
  const rows = records.filter(r => {
    const parsed = dischargeDocumentSchema.safeParse(r.data);
    return (filter === "all" || r.status === filter) && (!patientOnly || r.patientId === props.selectedPatient) && (!urgentOnly || r.priority === "urgent") && (!unassignedOnly || (parsed.success && !parsed.data.assignee)) && `${names.get(r.patientId ?? "")} ${r.patientId} ${r.title} ${r.id} ${parsed.success ? parsed.data.tags.join(" ") + " " + parsed.data.snomedCodes.map(code => `${code.code} ${code.display}`).join(" ") : ""}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  const current = records.find(r => r.id === selected) ?? (!editing ? rows[0] : undefined);
  const parsed = current ? dischargeDocumentSchema.safeParse(current.data) : null;
  const doc = parsed?.success ? parsed.data : null;
  const changeFilter = () => { setSelected(""); setEditing(false); setNotice(""); setMobileLetter(false); };
  const stages = ["all", ...(props.mode === "hospital" ? ["draft"] : []), "sent", "reviewed", "filed"];
  return <section className={`document-workspace document-${props.mode}${props.standalone ? " document-standalone" : ""}${mobileLetter ? " document-mobile-letter" : ""}`} aria-label={props.mode === "gp" ? "Document Inbox document processing" : "Discharge correspondence"}>
    <header className="document-banner"><div>{props.mode === "gp" ? <ProductBrand product="documents" /> : <strong>Discharge correspondence</strong>}<small>{props.mode === "gp" ? "Clinical correspondence · Riverside Practice" : "Author a handover and deliver it to the GP practice"}</small></div>{props.standalone && <nav aria-label="Workspace navigation"><a href={`/gp/${props.selectedPatient ? `?patient=${encodeURIComponent(props.selectedPatient)}` : ""}`}>Open GP Records ↗</a><a href="/control/">Neighbourhood map</a></nav>}{props.mode === "hospital" && <button disabled={!props.selectedPatient || mutation.isPending} onClick={() => { setSelected(""); setEditing(true); setNotice(""); setMobileLetter(true); }}>New discharge summary</button>}</header>
    {props.mode === "hospital" && <p className="document-patient-context">{props.selectedPatient ? `New summaries will be for ${names.get(props.selectedPatient) ?? props.selectedPatient}.` : "Select a patient in the hospital directory to write a new summary."}</p>}
    <div className="document-toolbar"><label className="document-search">Search correspondence<input type="search" placeholder="Patient, letter title or ID" value={search} onChange={e => { setSearch(e.target.value); changeFilter(); }} /></label><label>Queue<select value={filter} onChange={e => { setFilter(e.target.value); changeFilter(); }}>{stages.map(s => <option key={s} value={s}>{stageLabel(s)} ({s === "all" ? records.length : records.filter(r => r.status === s).length})</option>)}</select></label><label>Sort by<select value={sort} onChange={e => { const option = documentSortOptions.find(option => option.value === e.target.value); if (option) { setSelected(current?.id ?? ""); setSort(option.value); } }}>{documentSortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="document-check"><input type="checkbox" checked={urgentOnly} onChange={e => { setUrgentOnly(e.target.checked); changeFilter(); }} /> Urgent</label><label className="document-check"><input type="checkbox" checked={unassignedOnly} onChange={e => { setUnassignedOnly(e.target.checked); changeFilter(); }} /> Unassigned</label>{props.selectedPatient && <label className="document-check"><input type="checkbox" checked={patientOnly} onChange={e => { setPatientOnly(e.target.checked); changeFilter(); }} /> Selected patient</label>}</div>
    {data.isError && <p role="alert">Unable to load documents. {data.error.message} <button onClick={() => void data.refetch()}>Retry</button></p>}{mutation.isError && <p role="alert">{mutation.error.message}</p>}{notice && <p role="status">{notice}</p>}
    <div className={`document-columns${editing ? " document-is-editing" : ""}`}><nav ref={inboxRef} className="document-inbox" aria-label="Document inbox"><div className="document-inbox-heading"><strong>Correspondence</strong><span>{rows.length} {rows.length === 1 ? "letter" : "letters"}</span></div>{data.isPending && <p>Loading correspondence…</p>}{!data.isPending && rows.length === 0 && <p className="document-queue-empty">No letters match these filters. Try another queue or search.</p>}{rows.map(r => { const details = dischargeDocumentSchema.safeParse(r.data); return <button key={r.id} aria-current={r.id === current?.id ? "true" : undefined} onClick={() => { setSelected(r.id); setEditing(false); setNotice(""); setMobileLetter(true); }}><span className="document-row-top"><strong>{names.get(r.patientId ?? "") ?? r.patientId}</strong>{r.priority === "urgent" && <b className="document-urgent">Urgent</b>}</span><span className="document-row-title">{r.title}</span><small>{r.patientId} · {details.success && details.data.stage !== "draft" ? dateLabel(details.data.sentAt) : "Draft"}</small><span className="document-row-bottom"><span className={`document-stage document-stage-${r.status}`}>{stageLabel(r.status)}</span><small>{details.success && details.data.assignee ? details.data.assignee : "Unassigned"}</small></span></button>; })}</nav>
    <main className="document-reading"><button className="document-back" onClick={() => { setMobileLetter(false); requestAnimationFrame(() => inboxRef.current?.scrollIntoView({ block: "start" })); }}>← Back to correspondence</button>{editing ? <DischargeEditor key={current?.id ?? props.selectedPatient} resource={current} patientId={current?.patientId ?? props.selectedPatient} pending={mutation.isPending} save={a => mutation.mutate(a)} cancel={() => setEditing(false)} /> : current && doc ? <>
      <div className="document-letter-head"><div className="document-letter-route"><span>Hospital → GP practice</span><span className={`document-stage document-stage-${doc.stage}`}>{stageLabel(doc.stage)}</span></div><h1>{current.title}</h1><a className="document-patient-link" href={`/gp/?patient=${encodeURIComponent(current.patientId ?? "")}`}>{names.get(current.patientId ?? "") ?? current.patientId} · {current.patientId} ↗</a>{doc.stage !== "draft" && <p className="document-sender">Received {dateLabel(doc.sentAt)} UTC · {doc.sentBy}</p>}</div>
      <article className="document-letter" aria-label="Letter contents"><div className="document-paper-label">Clinical correspondence <span>Synthetic record</span></div>{dischargeSectionsSchema.keyof().options.map(key => <section key={key}><h3>{dischargeSectionLabels[key]}</h3><p>{doc.sections[key] || "Not entered"}</p></section>)}</article>
      <details className="document-history"><summary>Authorship and activity history</summary><RecordAttribution record={current} history /></details>
    </> : <div className="document-empty"><h2>{data.isPending ? "Loading your inbox" : "No letter selected"}</h2><p>Choose a letter from the correspondence queue to read and process it.</p></div>}</main>
    {!editing && <aside className="document-processing-pane" aria-label="Document processing">{current && doc ? <><h2>Process this letter</h2><ol className="document-steps">{["sent", "reviewed", "filed"].map((stage, index) => <li key={stage} className={stage === doc.stage ? "active" : ""}><span>{index + 1}</span>{stage === "sent" ? "Review" : stage === "reviewed" ? "File" : "Complete"}</li>)}</ol><dl className="document-facts"><dt>Patient</dt><dd>{names.get(current.patientId ?? "") ?? current.patientId}</dd><dt>Assigned to</dt><dd>{doc.assignee || "Unassigned"}</dd><dt>Priority</dt><dd>{current.priority === "urgent" ? "Urgent" : "Routine"}</dd></dl>
      {props.mode === "hospital" && doc.stage === "draft" && <div className="document-actions"><button onClick={() => setEditing(true)}>Edit draft</button><button className="document-primary" disabled={mutation.isPending} onClick={() => mutation.mutate({ type: "process_document", documentCommand: "send", resourceId: current.id, expectedVersion: current.version })}>Send to GP practice</button><small>Sending locks the letter text and delivers it to Document Inbox.</small></div>}
      {props.mode === "gp" && doc.stage !== "draft" && <DocumentCoding key={`${current.id}-${JSON.stringify([doc.tags, doc.snomedCodes])}`} resource={current} pending={mutation.isPending} save={a => mutation.mutate(a)} />}
      {props.mode === "gp" && doc.stage !== "draft" && doc.stage !== "filed" && <DocumentProcessing key={current.id} resource={current} stage={doc.stage} initialAssignee={doc.assignee} pending={mutation.isPending} save={a => mutation.mutate(a)} />}
      {(doc.stage === "reviewed" || doc.stage === "filed") && <section className="document-outcome"><h3>Review recorded</h3><p>{doc.reviewNote}</p><small>{doc.reviewedBy} · {dateLabel(doc.reviewedAt)} UTC</small></section>}{doc.stage === "filed" && <section className="document-outcome"><h3>Filed to patient history</h3><p>{doc.filingNote}</p><small>{doc.filedBy} · {dateLabel(doc.filedAt)} UTC</small></section>}{props.mode === "hospital" && doc.stage !== "draft" && <p className="document-help">The GP practice can now assign, review and file this letter. Its original text is locked.</p>}
    </> : <p className="document-help">Select a letter to see its processing actions.</p>}</aside>}</div>
  </section>;
}
function DischargeEditor({ resource, patientId, pending, save, cancel }: { resource?: Resource; patientId: string; pending: boolean; save: (a: Action) => void; cancel: () => void }) {
  const parsed = resource ? dischargeDocumentSchema.safeParse(resource.data) : null;
  const [sections, setSections] = useState(parsed?.success ? parsed.data.sections : emptyDischargeSections);
  const [title, setTitle] = useState(resource?.title ?? "Discharge summary");
  return <form className="document-editor" onSubmit={e => { e.preventDefault(); save({ type: "save_discharge_summary", patientId, title, dischargeSections: sections, ...(resource ? { resourceId: resource.id, expectedVersion: resource.version } : {}) }); }}><h2>{resource ? "Edit discharge draft" : "New discharge summary"}</h2><p>Patient {patientId} · Synthetic simulation</p><label>Letter title<input required value={title} maxLength={500} onChange={e => setTitle(e.target.value)} /></label>{dischargeSectionsSchema.keyof().options.map(key => <label key={key}>{dischargeSectionLabels[key]}<textarea rows={3} maxLength={10000} value={sections[key]} onChange={e => setSections({ ...sections, [key]: e.target.value })} /></label>)}<p>Drafts may be incomplete. Complete every section before sending; record “none” or “not known” explicitly where appropriate.</p><div className="document-actions"><button disabled={pending} type="submit">Save draft</button><button type="button" onClick={cancel}>Cancel</button></div></form>;
}
function DocumentProcessing({ resource, stage, initialAssignee, pending, save }: { resource: Resource; stage: "sent" | "reviewed"; initialAssignee: string; pending: boolean; save: (a: Action) => void }) {
  const [assignee, setAssignee] = useState(initialAssignee);
  const [reviewNote, setReviewNote] = useState("");
  const [filingNote, setFilingNote] = useState("");
  const note = stage === "sent" ? reviewNote : filingNote;
  return <div className="document-processing"><form onSubmit={e => { e.preventDefault(); save({ type: "process_document", resourceId: resource.id, expectedVersion: resource.version, documentCommand: "assign", clinician: assignee }); }}><label>Assign to clinician or team<input required maxLength={100} placeholder="e.g. Dr Patel or duty team" value={assignee} onChange={e => setAssignee(e.target.value)} /></label><button disabled={pending || !assignee.trim()}>Assign document</button></form><form onSubmit={e => { e.preventDefault(); save({ type: "process_document", resourceId: resource.id, expectedVersion: resource.version, documentCommand: stage === "sent" ? "review" : "file", text: note }); }}><label>{stage === "sent" ? "Review note and actions identified" : "Filing outcome"}<textarea rows={4} required placeholder={stage === "sent" ? "Record your review and any follow-up work." : "Record where the letter was filed and any work handed over."} value={note} maxLength={20000} onChange={e => stage === "sent" ? setReviewNote(e.target.value) : setFilingNote(e.target.value)} /></label><button className="document-primary" disabled={pending || !note.trim()}>{pending ? "Saving…" : stage === "sent" ? "Confirm reviewed" : "File to patient history"}</button><p className="document-help">{stage === "sent" ? "Review the full letter before confirming. You will file it in the next step." : "Filing keeps the original letter and your review in the patient's history."}</p></form></div>;
}
