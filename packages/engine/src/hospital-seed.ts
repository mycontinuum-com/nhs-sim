import { isDraft, original } from "immer";
import type { World } from "../../contracts/src/index.ts";
import { hospitalAttendanceSchema } from "../../contracts/src/hospital.ts";
export function seedHospitalAttendances(world: World) {
  if (world.counters.hospitalAttendanceVersion === 2) return;
  const snapshot = isDraft(world) ? original(world) ?? world : world;
  const existingPatients = new Set(snapshot.resources.filter((r) => r.kind === "hospital-attendance").map((r) => r.patientId));
  snapshot.resources.forEach((record, index) => {
    if (record.kind !== "encounter" || record.owner !== "hospital" || record.status !== "waiting" || !record.patientId) return;
    if (existingPatients.has(record.patientId) || !["New A&E arrival", "Winter-pressure A&E arrival"].includes(record.title)) return;
    world.resources[index] = { ...record, kind: "hospital-attendance", data: hospitalAttendanceSchema.parse({ stage: "waiting", arrivalAt: record.createdAt, presentingComplaint: record.title, acuity: "3", location: "Waiting room", clinician: "Unassigned" }) };
    existingPatients.add(record.patientId);
  });
  const complaints = ["Breathlessness", "Abdominal pain", "Wheeze", "Head injury", "Dizziness", "Reduced mobility", "Chest discomfort", "Fall at home"];
  snapshot.patients.slice(0, 8).forEach((patient, i) => {
    if (existingPatients.has(patient.id)) return;
    const arrivalAt = world.now - (35 + i * 37) * 60000;
    const common = { arrivalAt, presentingComplaint: complaints[i], acuity: i % 3 === 0 ? "2" : "3", location: i < 3 ? "Waiting room" : i < 5 ? "Majors " + (i - 2) : "AMU bed " + (i - 4), clinician: i < 3 ? "Unassigned" : "Dr Alex Morgan" };
    const data = hospitalAttendanceSchema.parse(i < 3 ? { ...common, stage: "waiting" } : i === 3 ? { ...common, stage: "assessing", assessmentAt: arrivalAt + 25 * 60000 } : i < 6 ? { ...common, stage: "take", assessmentAt: arrivalAt + 30 * 60000, referredAt: arrivalAt + 60 * 60000 } : { ...common, stage: "inpatient", assessmentAt: arrivalAt + 20 * 60000, referredAt: arrivalAt + 40 * 60000, admittedAt: arrivalAt + 90 * 60000 });
    world.resources.push({ id: "hospital-attendance-seed-" + i, patientId: patient.id, kind: "hospital-attendance", title: data.presentingComplaint, status: data.stage, owner: "hospital", visibleTo: ["hospital"], priority: data.acuity === "2" ? "urgent" : "routine", createdAt: arrivalAt, data, version: 1, provenance: { created: { actor: { kind: "simulation", name: "Synthetic hospital seed" }, source: "hospital", action: "seed", time: arrivalAt, version: 1 }, changes: [] } });
  });
  world.counters.hospitalAttendanceVersion = 2;
}

export function upgradeHospitalWorld(world: World): World {
  if (world.counters.hospitalAttendanceVersion === 2) return world;
  const upgraded = { ...world, resources: [...world.resources], counters: { ...world.counters } };
  seedHospitalAttendances(upgraded);
  if (upgraded.resources.length === world.resources.length && upgraded.resources.every((row, index) => row === world.resources[index])) upgraded.resources = world.resources;
  return upgraded;
}
