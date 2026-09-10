import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Patient, Resource, SiteId } from "../../contracts/src/index.ts";
import { patientAllergies, type PatientAllergy } from "../../contracts/src/allergies.ts";
import type { WorkflowApi } from "./gp-workflows.tsx";
import { RecordAttribution } from "./record-attribution.tsx";
import "./gp-workflows.css";

export function Allergies({ patient, rows, api, siteId }: {
  patient: Patient; rows: Resource[]; api: WorkflowApi; siteId: SiteId;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<PatientAllergy | null>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [reaction, setReaction] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [notice, setNotice] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const save = useMutation({
    mutationFn: () => api<Resource>(`/api/sites/${siteId}/actions`, {
      type: "save_allergy", patientId: patient.id, title: term.trim(), reaction,
      allergyStatus: status,
      ...(editing?.record ? { resourceId: editing.record.id, expectedVersion: editing.record.version } :
        editing ? { sourceAllergyKey: editing.key } : {}),
    }),
    onSuccess: async () => {
      setOpen(false);
      setNotice(status === "inactive" ? "Allergy marked inactive. Its history is retained." : "Allergy saved to the patient record.");
      await client.invalidateQueries();
    },
    onError: (error) => setNotice(error.message),
  });
  const allergies = patientAllergies(rows, patient.id);
  const visible = allergies.filter((allergy) => (showInactive || allergy.status === "active") &&
    `${allergy.term} ${allergy.reaction}`.toLowerCase().includes(filter.toLowerCase()));
  const activePage = Math.min(page, Math.max(0, Math.ceil(visible.length / 30) - 1));
  function edit(allergy: PatientAllergy | null) {
    setEditing(allergy); setTerm(allergy?.term ?? ""); setReaction(allergy?.reaction ?? "");
    setStatus(allergy?.status ?? "active"); setNotice(""); setOpen(true);
  }
  return <section className="gp-allergies">
    <div className="ehr-section-heading">
      <h2>Allergies<small>{patient.name} · {allergies.filter((allergy) => allergy.status === "active").length} active</small></h2>
      <button onClick={() => edit(null)} disabled={save.isPending}>Add allergy</button>
    </div>
    {open && <form className="gp-note-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <h3>{editing ? "Edit allergy" : "New allergy"}</h3>
      <label>Allergen name<input autoFocus required maxLength={500} value={term} onChange={(event) => setTerm(event.target.value)} /></label>
      <div className="gp-form-actions">
        <label>Reaction (optional)<textarea maxLength={2000} rows={3} value={reaction} onChange={(event) => setReaction(event.target.value)} /></label>
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value === "inactive" ? "inactive" : "active")}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      </div>
      <div className="gp-form-actions"><button type="submit" disabled={save.isPending || !term.trim()}>{save.isPending ? "Saving…" : "Save allergy"}</button><button type="button" disabled={save.isPending} onClick={() => setOpen(false)}>Cancel</button></div>
    </form>}
    {notice && <p role={save.isError ? "alert" : "status"}>{notice}</p>}
    <div className="gp-book-controls">
      <label>Find an allergy<input value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }} placeholder="Allergen or reaction" /></label>
      <label><span>History</span><select value={showInactive ? "all" : "active"} onChange={(event) => { setShowInactive(event.target.value === "all"); setPage(0); }}><option value="active">Active allergies</option><option value="all">Active and inactive</option></select></label>
    </div>
    {!visible.length ? <p className="ehr-empty">{filter ? "No matching allergies." : "No active allergies recorded. This does not establish that there are no known allergies."}</p> :
      <div className="gp-contact-history">{visible.slice(activePage * 30, (activePage + 1) * 30).map((allergy) => <article key={allergy.key}>
        <div className="ehr-section-heading"><h3>{allergy.term}<small>{allergy.status === "inactive" ? "Inactive" : "Active"} · {allergy.reaction || "Reaction not recorded"}</small></h3><button disabled={save.isPending} onClick={() => edit(allergy)}>Edit{allergy.status === "active" ? " / deactivate" : " / reactivate"}</button></div>
        {allergy.record ? <RecordAttribution record={allergy.record} history /> : <small>Original author not recorded · Historical allergy</small>}
      </article>)}</div>}
    {visible.length > 30 && <div className="gp-form-actions"><button disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous allergies</button><span>Page {activePage + 1} of {Math.ceil(visible.length / 30)}</span><button disabled={(activePage + 1) * 30 >= visible.length} onClick={() => setPage(activePage + 1)}>Next allergies</button></div>}
  </section>;
}
