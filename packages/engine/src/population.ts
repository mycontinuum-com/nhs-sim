import type { Patient, World } from "../../contracts/src/index.ts";
import profile from "./ehr-profile.json" with { type: "json" };

const day = 86_400_000;
const givenNames = [
  "Amira",
  "George",
  "Aisha",
  "Thomas",
  "Grace",
  "Eleanor",
  "Mohammed",
  "Sofia",
  "Daniel",
  "Priya",
  "Oliver",
  "Zara",
  "Mei",
  "Samuel",
  "Freya",
  "Idris",
];
const familyNames = [
  "Khan",
  "Evans",
  "Patel",
  "Reed",
  "Okafor",
  "Chen",
  "Williams",
  "Ahmed",
  "Taylor",
  "Singh",
  "Brown",
  "Wilson",
  "Clarke",
  "Shah",
  "Lewis",
  "Morgan",
];
const conditions = ["Asthma", "Diabetes", "Hypertension", "Arthritis", "CKD", "Heart failure"];
const needs = [
  "Interpreter",
  "Step-free access",
  "SMS preferred",
  "Offline contact",
  "Transport",
  "Carer involvement",
];

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function populateHistories(world: World) {
  const draw = random(world.seed);
  for (const [index, patient] of world.patients.entries()) {
    if (index >= 8) {
      patient.name = `${givenNames[Math.floor(draw() * givenNames.length)]} ${familyNames[Math.floor(draw() * familyNames.length)]}`;
      const age = Math.floor(draw() * 96);
      patient.birthDate = new Date(
        Date.UTC(2025 - age, Math.floor(draw() * 12), 1 + Math.floor(draw() * 28)),
      )
        .toISOString()
        .slice(0, 10);
      patient.conditions = conditions.filter(
        (_, condition) =>
          draw() < (age < 18 ? (condition === 0 ? 0.15 : 0) : age < 60 ? 0.12 : 0.32),
      );
      patient.needs = needs.filter(() => draw() < 0.12);
    }
    const lifetimeDays = (world.now - Date.parse(patient.birthDate)) / day;
    const historyTime = (daysAgo: number) =>
      world.now - Math.min(daysAgo, (lifetimeDays * daysAgo) / (daysAgo + 30)) * day;
    const problemTerms =
      lifetimeDays < 18 * 365.25
        ? [
            "Respiratory symptoms",
            "Skin symptoms",
            "Childhood development review",
            "Routine follow-up",
          ]
        : [
            ...patient.conditions,
            "Musculoskeletal symptoms",
            "Sleep concern",
            "Medication review",
            "Preventive health review",
            "Follow-up after hospital contact",
          ];
    const collectionSize = (weights: Record<string, number>) => {
      let position = draw() * Object.values(weights).reduce((sum, weight) => sum + weight, 0);
      for (const [band, weight] of Object.entries(weights)) {
        position -= weight;
        if (position < 0) {
          if (band === "0") return 0;
          if (band === "1-5") return 1 + Math.floor(draw() * 5);
          if (band === "6-20") return 6 + Math.floor(draw() * 15);
          return 21 + Math.floor(draw() * 10);
        }
      }
      return 0;
    };
    const problems = Array.from(
      { length: collectionSize(profile.collections.problems) },
      (_, item) => ({
        term: problemTerms[item % problemTerms.length],
        code: `SIM-PROBLEM-${item + 1}`,
        date: new Date(historyTime(30 + item * 90)).toISOString().slice(0, 10),
        status: item % 3 === 0 ? "resolved" : "active",
      }),
    );
    const medications = Array.from(
      { length: collectionSize(profile.collections.medications) },
      (_, item) => ({
        term: `SYNTHETIC-MED-${item + 1}`,
        isCurrent: item < 3,
        issueDate: new Date(historyTime(7 + item * 30)).toISOString().slice(0, 10),
      }),
    );
    world.resources.push({
      id: "r-" + world.nextId++,
      patientId: patient.id,
      kind: "ehr-record",
      title: "Longitudinal GP record",
      owner: "gp",
      visibleTo: ["gp"],
      status: "available",
      priority: "routine",
      createdAt: world.now - day,
      version: 1,
      data: {
        synthetic: true,
        provenance: profile.id,
        calibration: "Collection sizes only; fictional values and dates",
        problems,
        medications,
        allergies: Array.from(
          { length: collectionSize(profile.collections.allergies) },
          (_, item) => ({ term: `SYNTHETIC-ALLERGEN-${item + 1}` }),
        ),
        miscCodes: Array.from(
          { length: collectionSize(profile.collections.miscCodes) },
          (_, item) => ({
            term: [
              "Contact preferences recorded",
              "Appointment invitation sent",
              "Record reviewed",
              "Correspondence received",
              "Care team updated",
            ][item % 5],
            code: `SIM-ADMIN-${item + 1}`,
          }),
        ),
      },
    });
    const encounters = 1 + Math.floor(draw() * 5);
    for (let visit = 0; visit < encounters; visit++) {
      const daysAgo = 14 + (encounters - visit) * 45 + Math.floor(draw() * 30);
      const createdAt = historyTime(daysAgo);
      addHistory(world, patient, "encounter", "Primary care contact", createdAt, {
        channel: draw() < 0.4 ? "telephone" : "in-person",
        reason: patient.conditions.length
          ? "Long-term condition review"
          : "General practice contact",
        text: "Fictional consultation. The patient discussed their next appointment and contact preferences.",
      });
      addHistory(
        world,
        patient,
        "observation",
        "Contact preference recorded",
        createdAt + 600_000,
        {
          category: "administrative",
          value: patient.needs.includes("SMS preferred")
            ? "SMS"
            : patient.needs.includes("Offline contact")
              ? "letter"
              : "telephone",
        },
      );
    }
    if (index >= 8 && draw() < 0.2) {
      world.resources.push({
        id: "r-" + world.nextId++,
        patientId: patient.id,
        kind: "task",
        title: "Confirm follow-up arrangements",
        owner: "gp",
        visibleTo: ["gp"],
        status: "open",
        priority: "routine",
        createdAt: world.now - 3 * day,
        dueAt: world.now + (1 + Math.floor(draw() * 14)) * day,
        version: 1,
        data: {
          synthetic: true,
          provenance: "authored-synthetic-v1",
          contactAttempts: Math.floor(draw() * 4),
        },
      });
    }
  }
}

function addHistory(
  world: World,
  patient: Patient,
  kind: string,
  title: string,
  createdAt: number,
  data: Record<string, unknown>,
) {
  world.resources.push({
    id: "r-" + world.nextId++,
    patientId: patient.id,
    kind,
    title,
    owner: "gp",
    visibleTo: ["gp"],
    status: "completed",
    priority: "routine",
    createdAt,
    version: 1,
    data: { ...data, synthetic: true, provenance: "authored-synthetic-v1" },
  });
}
