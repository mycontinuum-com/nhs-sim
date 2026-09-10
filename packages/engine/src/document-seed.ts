import { nameDocumentAuthors } from "./document-authors.ts";
import type { RecordChange, Resource, World } from "../../contracts/src/index.ts";
export function seedDocuments(world: World) {
  if ((world.counters.documentVersion ?? 0) >= 2) { nameDocumentAuthors(world); return; }
  const ids = new Set(world.resources.map(resource => resource.id));
  if (!ids.has("discharge-summary-example") && world.patients[0]) {
    const actor = "Dr Morgan Bell";
    const resource: Resource = {
      id: "discharge-summary-example", kind: "discharge-summary", title: "Discharge summary · monitoring handover", patientId: world.patients[0].id,
      owner: "hospital", visibleTo: ["hospital", "gp"], status: "sent", priority: "routine", version: 1, createdAt: world.now,
      data: { stage: "sent", assignee: "", sentAt: world.now, sentBy: actor, sections: {
        reason: "Synthetic admission for a monitoring review.", course: "Observation and discharge planning completed in this fictional scenario.", diagnoses: "See the existing simulated problem list; no new diagnosis recorded.", medicationChanges: "No changes recorded in this example letter.", results: "No outstanding investigations recorded in this example.", followUp: "Follow-up arrangements require confirmation by the receiving team.", gpActions: "Review this handover and record its processing outcome in the simulation.",
      } }, provenance: { created: { actor: { kind: "simulation", name: actor }, source: "hospital", action: "seed", time: world.now, version: 1 }, changes: [] },
    };
    world.resources.push(resource);
  }
  const patients = world.patients.slice(0, 60);
  if (patients.length) {
    for (let index = 0; index < 60; index++) {
      const id = `document-batch-2-${String(index + 1).padStart(3, "0")}`;
      const patient = patients[index % patients.length];
      const scenario = scenarios[index % scenarios.length];
      if (ids.has(id) || !patient || !scenario) continue;
      const stage = index < 36 ? "sent" : index < 48 ? "reviewed" : index < 56 ? "filed" : "draft";
      const createdAt = world.now - (2 + index % 14) * 86400000;
      const author = scenario.author;
      const assignee = index % 3 === 0 ? "" : index % 2 === 0 ? "Duty GP" : "Practice document team";
      const sections = {
        reason: `${scenario.reason} This is a fictional episode for document workflow practice.`,
        course: `${scenario.course} The discharge coordinator recorded the handover for ${patient.name}.`,
        diagnoses: "No new coded diagnosis is asserted by this training letter. Check the simulated patient record when classifying the correspondence.",
        medicationChanges: scenario.medication,
        results: scenario.results,
        followUp: scenario.followUp,
        gpActions: scenario.actions,
      };
      const changes: RecordChange[] = [];
      const data: Resource["data"] = { stage, sections, assignee };
      if (stage !== "draft") {
        Object.assign(data, { sentAt: createdAt + 3600000, sentBy: author });
        changes.push({ actor: { kind: "simulation", name: author }, source: "hospital", action: "seed_document_sent", time: createdAt + 3600000, version: 2 });
      }
      if (stage === "reviewed" || stage === "filed") {
        const reviewer = "Dr Rowan Page";
        Object.assign(data, { reviewedAt: createdAt + 7200000, reviewedBy: reviewer, reviewNote: `Identity and ${scenario.specialty.toLowerCase()} correspondence checked. ${scenario.actions}`, assignee: assignee || "Duty GP" });
        changes.push({ actor: { kind: "simulation", name: reviewer }, source: "gp", action: "seed_document_reviewed", time: createdAt + 7200000, version: 3 });
      }
      if (stage === "filed") {
        const filer = "Alex Ledger · Practice administrator";
        Object.assign(data, { filedAt: createdAt + 10800000, filedBy: filer, filingNote: "Filed to the matching synthetic patient after document review. Administrative handover recorded; no prescribing action inferred." });
        changes.push({ actor: { kind: "simulation", name: filer }, source: "gp", action: "seed_document_filed", time: createdAt + 10800000, version: 4 });
      }
      world.resources.push({
        id, kind: "discharge-summary", patientId: patient.id,
        title: `${scenario.specialty} · ${scenario.title}`, owner: "hospital",
        visibleTo: stage === "draft" ? ["hospital"] : ["hospital", "gp"],
        status: stage, priority: index % 7 === 0 ? "urgent" : "routine",
        createdAt, version: changes.length + 1, data,
        provenance: { created: { actor: { kind: "simulation", name: author }, source: "hospital", action: "seed", time: createdAt, version: 1 }, changes },
      });
    }
  }
  nameDocumentAuthors(world);
  world.counters.documentVersion = 2;
}
export function upgradeDocumentWorld(world: World): World {
  if ((world.counters.documentVersion ?? 0) >= 2 && world.counters.documentAuthorVersion === 1) return world;
  const upgraded = { ...world, resources: [...world.resources], counters: { ...world.counters } };
  seedDocuments(upgraded);
  return upgraded;
}

const scenarios = [
  {
    specialty: "Cardiology", author: "Dr Morgan Bell", title: "Monitoring handover",
    reason: "Attendance for a planned monitoring episode.", course: "The monitoring episode is complete. The appointment reference was missing from the original referral.",
    medication: "The reconciliation attachment has not arrived. No medicine change is specified in this letter.", results: "The simulated monitoring report is awaiting administrative sign-off.",
    followUp: "The cardiology booking office will issue a follow-up appointment letter.", actions: "Route to the duty GP for review and request the missing reconciliation attachment from the hospital document team.",
  },
  {
    specialty: "Respiratory", author: "Dr Casey Reed", title: "Assessment discharge letter",
    reason: "Attendance at a respiratory assessment clinic.", course: "The clinic visit is complete. A separate equipment-service note will follow.",
    medication: "No prescribing instruction is included. The medicine list requires comparison with the existing record.", results: "A lung-function report is referenced but was not enclosed with this letter.",
    followUp: "The respiratory team retains ownership of the outstanding report.", actions: "Record the missing report and assign the correspondence to the practice respiratory review queue.",
  },
  {
    specialty: "Orthopaedics", author: "Dr Jamie Frame", title: "Day-case discharge handover",
    reason: "Planned orthopaedic day-case attendance.", course: "The day-case episode is complete. The transport booking was confirmed before departure.",
    medication: "A discharge medication list is recorded separately in the synthetic hospital chart. No changes are transcribed here.", results: "No investigation attachment is expected for this administrative handover.",
    followUp: "A physiotherapy appointment request is pending acknowledgement by the booking team.", actions: "Check that the physiotherapy referral is visible, record the receiving service and file after clinician review.",
  },
  {
    specialty: "Gastroenterology", author: "Dr Robin Wells", title: "Investigation episode handover",
    reason: "Attendance for a planned investigation episode.", course: "The episode is complete. The procedural report will be issued through the hospital correspondence service.",
    medication: "Medication reconciliation was recorded in the source chart. This letter contains no prescribing request.", results: "One report remains pending. The hospital investigation team is the named result owner.",
    followUp: "The hospital team will contact the patient after the outstanding report is authorised.", actions: "Route for GP review and record the pending report with the hospital team as its owner.",
  },
  {
    specialty: "Older people's medicine", author: "Dr Ellis Oak", title: "Supported discharge coordination",
    reason: "Attendance for a multidisciplinary discharge-planning episode.", course: "The discharge coordinator completed a home-support discussion. The receiving service has not yet acknowledged the handover.",
    medication: "No changes are specified in this correspondence. The separate discharge list remains the source document.", results: "No new investigation result is enclosed.",
    followUp: "The community coordinator is awaiting confirmation of the first visit slot.", actions: "Assign to the care-coordination team and record whether the community handover has been acknowledged.",
  },
  {
    specialty: "Renal", author: "Dr Taylor Brook", title: "Clinic discharge correspondence",
    reason: "Attendance for a planned renal clinic review.", course: "The clinic attendance is complete. The appointment outcome was entered in the hospital record.",
    medication: "The letter does not request a prescription. A medicines reconciliation note is still expected.", results: "An existing simulated laboratory panel is referenced without new values in this letter.",
    followUp: "The clinic secretary will confirm the next appointment through a separate booking letter.", actions: "Match the referenced panel to the patient record and request the outstanding medicines note before closing the document task.",
  },
  {
    specialty: "Neurology", author: "Dr Avery Fields", title: "Assessment episode summary",
    reason: "Attendance for a neurology assessment episode.", course: "The assessment record is complete. An external imaging attachment was unavailable during correspondence preparation.",
    medication: "No medication change is recorded in this letter.", results: "The imaging attachment remains outstanding and has not been interpreted here.",
    followUp: "The hospital records team owns the request for the missing attachment.", actions: "Flag the missing attachment for administrative follow-up and route the letter to the named GP reviewer.",
  },
  {
    specialty: "Diabetes service", author: "Dr Sam Finch", title: "Education visit handover",
    reason: "Attendance for a structured education visit.", course: "The education session was completed. The patient information pack was sent through the simulated messaging service.",
    medication: "No prescription or dose change is requested in this training letter.", results: "No new results are enclosed. The clinic letter references the existing longitudinal record.",
    followUp: "The service administrator will offer the remaining education session.", actions: "Record receipt of the education summary and check that the patient information message is present before filing.",
  },
  {
    specialty: "Emergency department", author: "Dr Quinn Harbour", title: "Attendance discharge notification",
    reason: "Attendance at the emergency department for assessment.", course: "The attendance has ended. A triage note and an attendance record remain in the synthetic hospital chart.",
    medication: "The notification contains no prescribing request or medication change.", results: "No result report accompanies this notification.",
    followUp: "Any onward service booking must be confirmed against the hospital record.", actions: "Match this notification to the correct patient, review the attendance record and route any unresolved administrative handover.",
  },
  {
    specialty: "Ophthalmology", author: "Dr Drew Iris", title: "Day-unit correspondence",
    reason: "Attendance at the ophthalmology day unit.", course: "The day-unit attendance is complete. The document team corrected an appointment-reference mismatch before sending.",
    medication: "No medicine changes are specified. No prescribing action should be inferred from this administrative letter.", results: "The clinic imaging report is held in the source system and is not attached.",
    followUp: "The day-unit booking team will send a separate appointment confirmation.", actions: "Record the corrected appointment reference and route for clinician review before filing to the patient record.",
  },
  {
    specialty: "General surgery", author: "Dr Alex Stitch", title: "Post-episode handover",
    reason: "Attendance for a planned surgical review episode.", course: "The review episode is complete. A discharge document was requested by the practice administration team.",
    medication: "The source chart contains the medication reconciliation record. This copy makes no additional medication request.", results: "A procedural attachment is expected from the surgical records team.",
    followUp: "The surgical booking office is responsible for confirming any return appointment.", actions: "Check the procedural attachment has arrived and record the practice document-review outcome.",
  },
  {
    specialty: "Therapy service", author: "Jordan Pace", title: "Rehabilitation episode handover",
    reason: "Attendance for a therapy assessment episode.", course: "The assessment is complete. Equipment-delivery details are tracked by the community service.",
    medication: "Medication changes are outside the scope of this correspondence; none are requested.", results: "The functional assessment summary is available in the simulated community record.",
    followUp: "The community team is awaiting confirmation of the equipment-delivery slot.", actions: "Assign to the practice care coordinator, check the community handover and record the delivery acknowledgement when available.",
  },
];
