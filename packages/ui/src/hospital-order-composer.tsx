import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Patient, Resource } from "../../contracts/src/index.ts";
import type { WorkflowApi } from "./gp-workflows.tsx";
import "./hospital-order-composer.css";
import { bloodPanels } from "../../contracts/src/blood-results.ts";

const medications = ["Amoxicillin", "Atorvastatin", "Bisoprolol", "Furosemide", "Metformin", "Omeprazole", "Paracetamol", "Salbutamol"];
const panels = bloodPanels.map(panel => panel.name);

export function HospitalOrderComposer({ api, worldId, patient, close, kind }: { api: WorkflowApi; worldId: string; patient: Patient; close: (resource?: Resource) => void; kind: "prescription" | "test" }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState("");
  const [route, setRoute] = useState("");
  const [frequency, setFrequency] = useState("");
  const [duration, setDuration] = useState("");
  const [quantity, setQuantity] = useState("");
  const [indication, setIndication] = useState("");
  const [specimen, setSpecimen] = useState("");
  const [priority, setPriority] = useState<"routine" | "urgent" | "">("");
  const [collection, setCollection] = useState<"now" | "next-round" | "">("");
  const [clinicalDetails, setClinicalDetails] = useState("");
  const prescription = kind === "prescription";
  const catalog = prescription ? medications : panels;
  const matching = catalog.filter(name => name.toLowerCase().includes(search.toLowerCase()));
  const order = useMutation({
    mutationFn: () => api<Resource>("/api/sites/hospital/actions", prescription ? {
      type: "draft_prescription", clientRequestId: requestId, patientId: patient.id, title: selected,
      medicationOrder: { drug: selected, dose: dose.trim(), unit: unit.trim(), route: route.trim(), frequency: frequency.trim(), duration: duration.trim(), quantity: Number(quantity), indication: indication.trim() },
    } : {
      type: "order_test", clientRequestId: requestId, patientId: patient.id, title: selected,
      bloodTestOrder: { panel: selected, panelId: bloodPanels.find(panel => panel.name === selected)?.id, specimen: specimen.trim(), priority, collection, clinicalDetails: clinicalDetails.trim() },
    }),
    onSuccess: (resource) => {
      void client.invalidateQueries();
      close(resource);
    },
  });
  const details = prescription
    ? [["Medication", selected], ["Dose", `${dose} ${unit}`], ["Route", route], ["Frequency", frequency], ["Duration", duration], ["Quantity", quantity], ["Indication", indication]]
    : [["Test", selected], ["Specimen", specimen], ["Priority", priority], ["Collection", collection === "now" ? "Now" : "Next collection round"], ["Clinical details", clinicalDetails]];
  return <section className="hospital-order-composer" aria-label={prescription ? "Prescription order entry" : "Blood test order entry"} data-world={worldId}>
    <div className="hoc-title"><span>✚ {prescription ? "Medication orders" : "Laboratory orders"}</span><span>Hospital EPR · Order entry</span></div>
    <div className="hoc-patient"><strong>{patient.name}</strong><span>DOB: {patient.birthDate}</span><span>Patient ID: {patient.id}</span><b>SIMULATION</b></div>
    <div className="hoc-steps"><strong>{reviewing ? "2  Review & sign" : "1  Select & complete order"}</strong><span>{prescription ? "Inpatient prescription → pharmacy review" : "Laboratory request → specimen collection → results"}</span></div>
    {reviewing ? <div className="hoc-review">
      <h2>Review order for {patient.name}</h2>
      <p>Check the patient and all order details before signing.</p>
      <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="hoc-advisory">{prescription ? "Sending creates a prescription for pharmacy review. Pharmacy approval is still required before dispensing." : "Signing creates a simulated laboratory request. Results appear after processing in simulation time."}</p>
      {order.error && <p role="alert" className="hoc-error">{order.error.message}</p>}
      <footer className="hoc-footer"><button type="button" onClick={() => setReviewing(false)} disabled={order.isPending}>Back to details</button><button type="button" onClick={() => close()} disabled={order.isPending}>Cancel</button><button type="button" className="hoc-primary" onClick={() => order.mutate()} disabled={order.isPending}>{order.isPending ? "Sending order…" : prescription ? "Sign & send to pharmacy" : "Sign test order"}</button></footer>
    </div> : <form onSubmit={event => { event.preventDefault(); setRequestId(crypto.randomUUID()); setReviewing(true); }}>
      <div className="hoc-layout">
        <aside className="hoc-catalog"><h3>{prescription ? "Medication catalogue" : "Laboratory catalogue"}</h3>
          <label>Search catalogue<input value={search} onChange={event => setSearch(event.target.value)} placeholder={prescription ? "Medication name" : "Test or panel"}/></label>
          <div className="hoc-catalog-group">{prescription ? "Scenario medications" : "Blood sciences"}</div>
          <div className="hoc-catalog-list">{matching.map(name => <button type="button" key={name} aria-pressed={selected === name} onClick={() => setSelected(name)}><span>{prescription ? "℞" : "▧"}</span>{name}</button>)}{matching.length === 0 && <p>No catalogue matches. Try another search.</p>}</div>
          <p>Simulation catalogue. Order details are entered by the author.</p>
        </aside>
        <div className="hoc-details"><h2>Order details</h2><p className="hoc-required">All fields are required.</p>
          <label className="hoc-wide">{prescription ? "Medication name" : "Test / panel name"}<input value={selected} readOnly={!prescription} onChange={event => setSelected(event.target.value)} required pattern={".*\\S.*"} maxLength={160} placeholder={prescription ? "Select from the catalogue or enter a name" : "Select a panel from the catalogue"}/></label>
          {prescription ? <div className="hoc-fields">
            <label>Dose<input value={dose} onChange={event => setDose(event.target.value)} required pattern={".*\\S.*"} maxLength={80}/></label>
            <label>Dose unit<input value={unit} onChange={event => setUnit(event.target.value)} required pattern={".*\\S.*"} maxLength={40}/></label>
            <label>Route<input value={route} onChange={event => setRoute(event.target.value)} required pattern={".*\\S.*"} maxLength={80}/></label>
            <label>Frequency<input value={frequency} onChange={event => setFrequency(event.target.value)} required pattern={".*\\S.*"} maxLength={120}/></label>
            <label>Duration<input value={duration} onChange={event => setDuration(event.target.value)} required pattern={".*\\S.*"} maxLength={120}/></label>
            <label>Quantity to supply<input type="number" min={1} max={100000} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} required/></label>
            <label className="hoc-wide">Indication<textarea value={indication} onChange={event => { setIndication(event.target.value); event.target.setCustomValidity(event.target.value.trim() ? "" : "Enter an indication."); }} required maxLength={2000} rows={3}/></label>
          </div> : <div className="hoc-fields">
            <label className="hoc-wide">Specimen<input value={specimen} onChange={event => setSpecimen(event.target.value)} required pattern={".*\\S.*"} maxLength={160}/></label>
            <label>Priority<select value={priority} onChange={event => { if (event.target.value === "routine" || event.target.value === "urgent") setPriority(event.target.value); }} required><option value="" disabled>Select priority</option><option value="routine">Routine</option><option value="urgent">Urgent</option></select></label>
            <label>Collection<select value={collection} onChange={event => { if (event.target.value === "now" || event.target.value === "next-round") setCollection(event.target.value); }} required><option value="" disabled>Select collection time</option><option value="now">Now</option><option value="next-round">Next collection round</option></select></label>
            <label className="hoc-wide">Clinical details<textarea value={clinicalDetails} onChange={event => { setClinicalDetails(event.target.value); event.target.setCustomValidity(event.target.value.trim() ? "" : "Enter clinical details."); }} required maxLength={4000} rows={5}/></label>
          </div>}
        </div>
      </div>
      <footer className="hoc-footer"><span>{selected || "No order selected"}</span><button type="button" onClick={() => close()}>Cancel</button><button type="submit" disabled={!selected.trim()} className="hoc-primary">Review order</button></footer>
    </form>}
  </section>;
}
