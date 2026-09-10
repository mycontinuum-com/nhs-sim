import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Patient, Resource, SiteId } from "../../contracts/src/index.ts";
import { patientProblems, type PatientProblem } from "../../contracts/src/problems.ts";
import type { WorkflowApi } from "./gp-workflows.tsx";
import { RecordAttribution } from "./record-attribution.tsx";
import "./gp-workflows.css";

export function Problems({ patient, rows, api, siteId }: {
  patient: Patient; rows: Resource[]; api: WorkflowApi; siteId: SiteId;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<PatientProblem | null>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [code, setCode] = useState("");
  const [onset, setOnset] = useState("");
  const [status, setStatus] = useState<"active" | "resolved">("active");
  const [notice, setNotice] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const save = useMutation({
    mutationFn: () => api<Resource>(`/api/sites/${siteId}/actions`, {
      type: "save_problem", patientId: patient.id, title: term.trim(), problemCode: code,
      problemStatus: status, ...(onset ? { onsetDate: onset } : {}),
      ...(editing?.record ? { resourceId: editing.record.id, expectedVersion: editing.record.version } :
        editing ? { sourceProblemKey: editing.key } : {}),
    }),
    onSuccess: async () => {
      setOpen(false);
      setNotice(status === "resolved" ? "Problem resolved. It remains in the resolved history." : "Problem saved to the patient record.");
      await client.invalidateQueries();
    },
    onError: (error) => setNotice(error.message),
  });
  const problems = patientProblems(rows, patient);
  const visible = problems.filter((problem) => (showResolved || problem.status === "active") &&
    `${problem.term} ${problem.code}`.toLowerCase().includes(filter.toLowerCase()));
  const activePage = Math.min(page, Math.max(0, Math.ceil(visible.length / 30) - 1));
  function edit(problem: PatientProblem | null) {
    setEditing(problem); setTerm(problem?.term ?? ""); setCode(problem?.code ?? "");
    setOnset(problem?.onsetDate ?? ""); setStatus(problem?.status ?? "active"); setNotice(""); setOpen(true);
  }
  return <section className="gp-problems">
    <div className="ehr-section-heading">
      <h2>Problems<small>{patient.name} · {problems.filter((problem) => problem.status === "active").length} active</small></h2>
      <button onClick={() => edit(null)} disabled={save.isPending}>Add problem</button>
    </div>
    {open && <form className="gp-note-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <h3>{editing ? "Edit problem" : "New problem"}</h3>
      <label>Problem name<input autoFocus required maxLength={500} value={term} onChange={(event) => setTerm(event.target.value)} /></label>
      <div className="gp-form-actions">
        <label>Code (optional)<input maxLength={100} value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <label>Onset date (optional)<input type="date" value={onset} onChange={(event) => setOnset(event.target.value)} /></label>
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value === "resolved" ? "resolved" : "active")}><option value="active">Active</option><option value="resolved">Resolved</option></select></label>
      </div>
      <div className="gp-form-actions"><button type="submit" disabled={save.isPending || !term.trim()}>{save.isPending ? "Saving…" : "Save problem"}</button><button type="button" disabled={save.isPending} onClick={() => setOpen(false)}>Cancel</button></div>
    </form>}
    {notice && <p role={save.isError ? "alert" : "status"}>{notice}</p>}
    <div className="gp-book-controls">
      <label>Find a problem<input value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }} placeholder="Name or code" /></label>
      <label><span>History</span><select value={showResolved ? "all" : "active"} onChange={(event) => { setShowResolved(event.target.value === "all"); setPage(0); }}><option value="active">Active problems</option><option value="all">Active and resolved</option></select></label>
    </div>
    {!visible.length ? <p className="ehr-empty">{filter ? "No matching problems." : "No active problems. Add a problem or include resolved history."}</p> :
      <div className="gp-contact-history">{visible.slice(activePage * 30, (activePage + 1) * 30).map((problem) => <article key={problem.key}>
        <div className="ehr-section-heading"><h3>{problem.term}<small>{problem.status === "resolved" ? "Resolved" : "Active"} · {problem.onsetDate ? `Onset ${problem.onsetDate}` : "Onset not recorded"}{problem.code ? ` · ${problem.code}` : ""}</small></h3><button disabled={save.isPending} onClick={() => edit(problem)}>Edit{problem.status === "active" ? " / resolve" : " / reactivate"}</button></div>
        {problem.record ? <RecordAttribution record={problem.record} history /> : <small>Original author not recorded · Historical problem</small>}
      </article>)}</div>}
    {visible.length > 30 && <div className="gp-form-actions"><button disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous problems</button><span>Page {activePage + 1} of {Math.ceil(visible.length / 30)}</span><button disabled={(activePage + 1) * 30 >= visible.length} onClick={() => setPage(activePage + 1)}>Next problems</button></div>}
  </section>;
}
