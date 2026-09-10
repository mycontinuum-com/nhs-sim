import React, { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Patient, Resource } from "../../contracts/src/index.ts";
import { hospitalNoteSchema, hospitalNoteTemplates, type HospitalNoteCommand } from "../../contracts/src/clinical-notes.ts";
import type { WorkflowApi } from "./gp-workflows.tsx";
import "./hospital-note-editor.css";

export function HospitalNoteEditor({ api, worldId, patient, record, close }: { api: WorkflowApi; worldId: string; patient: Patient; record?: Resource; close: (saved?: Resource) => void }) {
  const client = useQueryClient();
  const requestIds = useRef(new Map<string, string>());
  const initial = record ? hospitalNoteSchema.safeParse(record.data) : null;
  const [saved, setSaved] = useState(record);
  const [template, setTemplate] = useState(initial?.success ? initial.data.template : "free-text");
  const [title, setTitle] = useState(record?.title ?? "Free text note");
  const [sections, setSections] = useState(initial?.success ? initial.data.sections : [{ id: "section-0", heading: "Clinical note", text: "" }]);
  const [activeSection, setActiveSection] = useState("section-0");
  const [addendum, setAddendum] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const parsed = saved ? hospitalNoteSchema.safeParse(saved.data) : null;
  const signed = parsed?.success && parsed.data.stage === "signed" ? parsed.data : null;
  const save = useMutation({
    mutationFn: async ({ sign, append }: { sign?: boolean; append?: boolean }) => {
      const send = (command: HospitalNoteCommand, resource?: Resource) => {
        const payload = { type: "hospital_note", patientId: patient.id, title, hospitalNoteCommand: command, ...(resource ? { resourceId: resource.id, expectedVersion: resource.version } : {}) };
        const fingerprint = JSON.stringify(payload);
        const clientRequestId = requestIds.current.get(fingerprint) ?? crypto.randomUUID();
        requestIds.current.set(fingerprint, clientRequestId);
        return api<Resource>("/api/sites/hospital/actions", { ...payload, clientRequestId });
      };
      if (append) return send({ kind: "addendum", text: addendum }, saved);
      const draft = await send({ kind: "save", template, sections }, saved);
      setSaved(draft);
      return sign ? send({ kind: "sign" }, draft) : draft;
    },
    onSuccess: async result => {
      setSaved(result);
      setAddendum("");
      setReviewing(false);
      setNotice(result.status === "signed" ? "Signed documentation saved to the patient record." : "Draft saved. You can return to it from Documentation.");
      await client.invalidateQueries();
    },
  });
  const hasContent = sections.some(section => section.text.trim());
  return <section className="hospital-note-editor" aria-label="Hospital documentation editor" data-world={worldId}>
    <div className="hn-bluebar"><strong>Documentation</strong><span>{patient.name} · {patient.id}</span></div>
    <div className="hn-tools"><button onClick={() => close(saved)}>← Document list</button><span>{signed ? "Final document · addenda only" : "In progress"}</span><label>Note type <select disabled={!!signed || hasContent} value={template} onChange={event => {
      const selected = hospitalNoteTemplates.find(item => item.value === event.target.value);
      if (!selected) return;
      setTemplate(selected.value); setTitle(selected.label); setSections(selected.headings.map((heading, index) => ({ id: `section-${index}`, heading, text: "" })));
    }}>{hospitalNoteTemplates.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label></div>
    <div className="hn-tab">{title || "Untitled note"} <small>{signed ? "Final" : "Draft"}</small></div>
    <div className="hn-body"><nav aria-label="Note sections"><strong>Document sections</strong>{sections.map(section => <button key={section.id} className={activeSection === section.id ? "selected" : ""} onClick={() => { setActiveSection(section.id); document.getElementById(`note-${section.id}`)?.focus(); }}>{section.text.trim() ? "✓" : "□"} {section.heading}</button>)}{signed && <button onClick={() => document.getElementById("hospital-addendum")?.focus()}>+ Addendum</button>}</nav>
      <div className="hn-paper"><div className="hn-demographics"><strong>{patient.name}</strong><span>Patient ID {patient.id}</span><span>Document status {signed ? "Final" : "In progress"}</span></div>
        <label className="hn-title">Document title<input value={title} maxLength={500} disabled={!!signed || reviewing} onChange={event => setTitle(event.target.value)} /></label>
        {sections.map(section => <label className="hn-section" key={section.id}><strong>{section.heading}</strong>{signed || reviewing ? <p>{section.text || "Not recorded"}</p> : <textarea id={`note-${section.id}`} value={section.text} rows={section.text.split("\n").length > 5 ? 8 : 5} onFocus={() => setActiveSection(section.id)} onChange={event => setSections(current => current.map(item => item.id === section.id ? { ...item, text: event.target.value } : item))} />}</label>)}
        {signed && <><div className="hn-signature"><strong>Signature line</strong><p>Electronically signed by {signed.signedBy} on {new Date(signed.signedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC.</p></div>{signed.addenda.map((item, index) => <section className="hn-addendum" key={index}><strong>Addendum</strong><p>{item.text}</p><small>{item.author} · {new Date(item.time).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</small></section>)}<label className="hn-section"><strong>Addendum</strong><textarea id="hospital-addendum" value={addendum} onChange={event => setAddendum(event.target.value)} rows={6} placeholder="Add a correction or further information. The signed note remains unchanged." /></label></>}
      </div></div>
    {save.error && <p className="hn-error" role="alert">{save.error.message}</p>}{notice && <p className="hn-notice" role="status">{notice}</p>}
    <footer className="hn-footer"><span>{reviewing ? "Review the note before signing. Signed text cannot be changed." : `Note details: ${title} · ${patient.name}`}</span>{signed ? <button disabled={save.isPending || !addendum.trim()} onClick={() => save.mutate({ append: true })}>Save addendum</button> : reviewing ? <><button disabled={save.isPending} onClick={() => setReviewing(false)}>Back to editing</button><button disabled={save.isPending} onClick={() => save.mutate({ sign: true })}>{save.isPending ? "Signing…" : "Confirm & sign"}</button></> : <><button disabled={save.isPending || !title.trim()} onClick={() => save.mutate({})}>Save draft</button><button disabled={save.isPending || !title.trim() || !hasContent} onClick={() => setReviewing(true)}>Review & sign</button></>}<button disabled={save.isPending} onClick={() => close(saved)}>Close</button></footer>
  </section>;
}
