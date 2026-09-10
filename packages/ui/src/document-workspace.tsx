import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action, Patient, Resource } from "../../contracts/src/index.ts";
import { dischargeDocumentSchema, dischargeSectionsSchema, dischargeSectionLabels, emptyDischargeSections } from "../../contracts/src/documents.ts";
import type { WorkflowApi } from "./gp-workflows.tsx";
import { RecordAttribution } from "./record-attribution.tsx";
import { ProductBrand } from "./product-brand.tsx";
import "./document-workspace.css";
type Props = { api: WorkflowApi; worldId: string; mode: "hospital" | "gp"; selectedPatient: string; patients: Patient[] };
export function DocumentWorkspace(props: Props) {
  const client = useQueryClient();
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("all");
  const [patientOnly, setPatientOnly] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const data = useQuery({ queryKey: ["documents", props.worldId, props.mode], queryFn: () => props.api<{ resources: Resource[]; patients: Patient[] }>(`/api/sites/${props.mode}/documents`), refetchInterval: 5000 });
  const mutation = useMutation({ mutationFn: (action: Action) => props.api<Resource>(`/api/sites/${props.mode}/actions`, action), onSuccess: r => { setSelected(r.id); setEditing(false); setNotice(r.status === "sent" ? "Delivered to the GP document inbox." : r.status === "filed" ? "Filed in the patient's document history." : "Document saved."); void client.invalidateQueries(); } });
  const records = data.data?.resources ?? [];
  const names = new Map([...props.patients, ...(data.data?.patients ?? [])].map(p => [p.id, p.name]));
  const current = records.find(r => r.id === selected);
  const parsed = current ? dischargeDocumentSchema.safeParse(current.data) : null;
  const doc = parsed?.success ? parsed.data : null;
  const rows = records.filter(r => (filter === "all" || r.status === filter) && (!patientOnly || r.patientId === props.selectedPatient));
  return <section className={`document-workspace document-${props.mode}`} aria-label={props.mode === "gp" ? "DocuMañana document processing" : "Discharge correspondence"}>
    <header className="document-banner"><div>{props.mode === "gp" ? <ProductBrand product="documents" /> : <strong>Discharge correspondence</strong>}<small>{props.mode === "gp" ? "Clinical correspondence · review, route and file" : "Author a handover and deliver it to the GP practice"}</small></div>{props.mode === "hospital" && <button disabled={!props.selectedPatient || mutation.isPending} onClick={() => { setSelected(""); setEditing(true); setNotice(""); }}>New discharge summary</button>}</header>
    {props.mode === "hospital" && <p className="document-patient-context">{props.selectedPatient ? `New summaries will be for ${names.get(props.selectedPatient) ?? props.selectedPatient}.` : "Select a patient in the hospital directory to write a new summary."}</p>}
    <div className="document-toolbar"><label>Queue <select value={filter} onChange={e => setFilter(e.target.value)}>{["all", ...(props.mode === "hospital" ? ["draft"] : []), "sent", "reviewed", "filed"].map(s => <option key={s} value={s}>{s === "all" ? "All correspondence" : s === "sent" ? "Awaiting review" : s}</option>)}</select></label><label><input type="checkbox" disabled={!props.selectedPatient} checked={patientOnly} onChange={e => setPatientOnly(e.target.checked)} /> Selected patient only</label><span>{rows.length} documents</span></div>
    {data.isError && <p role="alert">Unable to load documents. {data.error.message}</p>}{mutation.isError && <p role="alert">{mutation.error.message}</p>}{notice && <p role="status">{notice}</p>}
    <div className="document-columns"><nav aria-label="Document inbox">{data.isPending && <p>Loading correspondence…</p>}{!data.isPending && rows.length === 0 && <p>No documents in this queue.</p>}{rows.map(r => <button key={r.id} aria-current={r.id === selected ? "true" : undefined} onClick={() => { setSelected(r.id); setEditing(false); setNotice(""); }}><strong>{names.get(r.patientId ?? "") ?? r.patientId}</strong><span>{r.title}</span><small>{r.status} · {r.patientId}</small></button>)}</nav>
    <main>{editing ? <DischargeEditor key={current?.id ?? props.selectedPatient} resource={current} patientId={current?.patientId ?? props.selectedPatient} pending={mutation.isPending} save={a => mutation.mutate(a)} cancel={() => setEditing(false)} /> : current && doc ? <>
      <div className="document-letter-head"><span>HOSPITAL → GP PRACTICE</span><h2>{current.title}</h2><p>{names.get(current.patientId ?? "") ?? current.patientId} · {current.patientId}</p><RecordAttribution record={current} history /></div>
      <article className="document-letter">{dischargeSectionsSchema.keyof().options.map(key => <section key={key}><h3>{dischargeSectionLabels[key]}</h3><p>{doc.sections[key] || "Not entered"}</p></section>)}</article>
      {doc.stage !== "draft" && <p>Sent by {doc.sentBy} · {new Date(doc.sentAt).toLocaleString("en-GB", { timeZone: "UTC" })}</p>}
      {doc.assignee && <p>Assigned to {doc.assignee}</p>}{(doc.stage === "reviewed" || doc.stage === "filed") && <p>Reviewed by {doc.reviewedBy}: {doc.reviewNote}</p>}{doc.stage === "filed" && <p>Filed by {doc.filedBy}: {doc.filingNote}</p>}
      {props.mode === "hospital" && doc.stage === "draft" && <div className="document-actions"><button onClick={() => setEditing(true)}>Edit draft</button><button disabled={mutation.isPending} onClick={() => mutation.mutate({ type: "process_document", documentCommand: "send", resourceId: current.id, expectedVersion: current.version })}>Send to GP practice</button><small>Sending locks the letter text and delivers it to DocuMañana.</small></div>}
      {props.mode === "gp" && doc.stage !== "draft" && doc.stage !== "filed" && <DocumentProcessing key={current.id + ":" + current.version} resource={current} stage={doc.stage} pending={mutation.isPending} save={a => mutation.mutate(a)} />}
    </> : <div className="document-empty"><h2>{props.mode === "gp" ? "The inbox can wait. The patient shouldn't." : "A clear handover starts here."}</h2><p>Select a letter to read its full contents, author and processing history.</p>{props.mode === "gp" && <p>Assign incoming letters, record a review, then file them to the patient. Filing never happens automatically.</p>}</div>}</main></div>
  </section>;
}
function DischargeEditor({ resource, patientId, pending, save, cancel }: { resource?: Resource; patientId: string; pending: boolean; save: (a: Action) => void; cancel: () => void }) {
  const parsed = resource ? dischargeDocumentSchema.safeParse(resource.data) : null;
  const [sections, setSections] = useState(parsed?.success ? parsed.data.sections : emptyDischargeSections);
  const [title, setTitle] = useState(resource?.title ?? "Discharge summary");
  return <form className="document-editor" onSubmit={e => { e.preventDefault(); save({ type: "save_discharge_summary", patientId, title, dischargeSections: sections, ...(resource ? { resourceId: resource.id, expectedVersion: resource.version } : {}) }); }}><h2>{resource ? "Edit discharge draft" : "New discharge summary"}</h2><p>Patient {patientId} · Synthetic simulation</p><label>Letter title<input required value={title} maxLength={500} onChange={e => setTitle(e.target.value)} /></label>{dischargeSectionsSchema.keyof().options.map(key => <label key={key}>{dischargeSectionLabels[key]}<textarea rows={3} maxLength={10000} value={sections[key]} onChange={e => setSections({ ...sections, [key]: e.target.value })} /></label>)}<p>Drafts may be incomplete. Complete every section before sending; record “none” or “not known” explicitly where appropriate.</p><div className="document-actions"><button disabled={pending} type="submit">Save draft</button><button type="button" onClick={cancel}>Cancel</button></div></form>;
}
function DocumentProcessing({ resource, stage, pending, save }: { resource: Resource; stage: "sent" | "reviewed"; pending: boolean; save: (a: Action) => void }) {
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  return <div className="document-processing"><form onSubmit={e => { e.preventDefault(); save({ type: "process_document", resourceId: resource.id, expectedVersion: resource.version, documentCommand: "assign", clinician: assignee }); }}><label>Assign to clinician or team<input required maxLength={100} value={assignee} onChange={e => setAssignee(e.target.value)} /></label><button disabled={pending || !assignee.trim()}>Assign document</button></form><form onSubmit={e => { e.preventDefault(); save({ type: "process_document", resourceId: resource.id, expectedVersion: resource.version, documentCommand: stage === "sent" ? "review" : "file", text: note }); }}><label>{stage === "sent" ? "Review note and actions identified" : "Filing outcome"}<textarea required value={note} maxLength={20000} onChange={e => setNote(e.target.value)} /></label><button disabled={pending || !note.trim()}>{stage === "sent" ? "Confirm reviewed" : "File to patient history"}</button></form></div>;
}
