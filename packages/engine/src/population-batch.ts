import { syntheticDeath } from "./mortality.ts";
import { createGenomeRecord } from "./genomics.ts";
import { attributeSyntheticRecord } from "./synthetic-attribution.ts";
import { generateMedicationHistory, generateAllergyHistory } from "./medication-history.ts";
import type { Patient, Resource } from "../../contracts/src/index.ts";
import profile from "./ehr-profile.json" with { type: "json" };
import publicProfile from "./public-data-profile.json" with { type: "json" };

export const POPULATION_BATCH_VERSION = "population-v2";
const day = 86_400_000;
type BatchInput = { seed: number; start: number; count: number; now: number };

export function populationBatchManifest(input: BatchInput) {
  return {
    ...input,
    version: POPULATION_BATCH_VERSION,
    endExclusive: input.start + input.count,
    maximumResourcesPerPatient: 11,
    maximumCollectionEntriesPerPatient: 28,
    calibration: profile.id,
    synthesis: "Authored life-course templates; aggregate collection counts only",
  };
}

const givenNames = [
  "Ada",
  "Adam",
  "Alana",
  "Alex",
  "Alice",
  "Anika",
  "Arlo",
  "Ava",
  "Beatrice",
  "Bilal",
  "Cameron",
  "Clara",
  "Daisy",
  "Dara",
  "Edith",
  "Elias",
  "Emilia",
  "Ethan",
  "Evelyn",
  "Felix",
  "Florence",
  "Hamza",
  "Hannah",
  "Harriet",
  "Henry",
  "Imani",
  "Isaac",
  "Isla",
  "Jasper",
  "Jude",
  "Julia",
  "Kai",
  "Leila",
  "Lewis",
  "Luca",
  "Lucy",
  "Mabel",
  "Marcus",
  "Mariam",
  "Matilda",
  "Miles",
  "Mina",
  "Naomi",
  "Nathan",
  "Nora",
  "Oscar",
  "Otis",
  "Poppy",
  "Ravi",
  "Reuben",
  "Rosa",
  "Rowan",
  "Sara",
  "Sebastian",
  "Sienna",
  "Theo",
  "Toby",
  "Vera",
  "Violet",
  "Willow",
  "Yara",
  "Yusuf",
  "Zain",
  "Zoe",
];
const familyNames = [
  "Adams",
  "Allen",
  "Anderson",
  "Bailey",
  "Baker",
  "Bell",
  "Bishop",
  "Burton",
  "Carter",
  "Cole",
  "Collins",
  "Cook",
  "Cross",
  "Dawson",
  "Dean",
  "Dixon",
  "Edwards",
  "Fisher",
  "Foster",
  "Fox",
  "Gibson",
  "Gray",
  "Hall",
  "Hamilton",
  "Harris",
  "Hart",
  "Hawkins",
  "Hill",
  "Holmes",
  "Howard",
  "Hughes",
  "Hunt",
  "Iqbal",
  "James",
  "Jones",
  "Kelly",
  "King",
  "Lane",
  "Lawrence",
  "Marshall",
  "Matthews",
  "Miller",
  "Mitchell",
  "Moore",
  "Morris",
  "Murray",
  "Palmer",
  "Parker",
  "Phillips",
  "Powell",
  "Rahman",
  "Richards",
  "Roberts",
  "Robinson",
  "Scott",
  "Simpson",
  "Smith",
  "Stevens",
  "Stewart",
  "Thompson",
  "Watson",
  "West",
  "White",
  "Wright",
];
const interests = [
  "drawing",
  "listening to music",
  "gardening",
  "local history",
  "cooking",
  "walking",
  "photography",
  "reading",
  "puzzles",
  "watching football",
  "crafts",
  "visiting the library",
];
type LifeCourse = { context: string; need: string; goal: string; interruption: string };
const earlyChildhood: LifeCourse[] = [
  {
    context: "Lives with a parent who arranges routine childhood contacts.",
    need: "Parent contact",
    goal: "Keep routine childhood appointments on track",
    interruption: "The parent requested a new invitation after the family moved.",
  },
  {
    context: "Lives across two family homes. A parent is the recorded contact for invitations.",
    need: "Parent contact",
    goal: "Keep appointment information consistent between family homes",
    interruption: "A family change meant the original appointment time could not be attended.",
  },
];
const childhood: LifeCourse[] = [
  {
    context: "Lives with a parent who arranges appointments around school hours.",
    need: "Parent contact",
    goal: "Attend without missing a full school day",
    interruption: "The parent could not leave work for the original appointment time.",
  },
  {
    context: "Lives across two family homes. One parent is the recorded contact for invitations.",
    need: "Written appointment details",
    goal: "Keep both home routines consistent with the appointment diary",
    interruption: "An invitation went to the previous correspondence address.",
  },
  {
    context: "Attends school and uses a written communication plan.",
    need: "Accessible information",
    goal: "Know what to expect before attending",
    interruption: "The family requested an accessible copy of the appointment information.",
  },
];
const working: LifeCourse[] = [
  {
    context: "Works rotating shifts in hospitality and shares a home with a partner.",
    need: "Shift work",
    goal: "Fit routine reviews around changing shifts",
    interruption: "A shift change meant the original appointment could not be attended.",
  },
  {
    context: "Works in a warehouse and shares school pick-up with family.",
    need: "Early appointment",
    goal: "Arrange follow-up without losing a full day of work",
    interruption: "Work cover was unavailable for the offered appointment.",
  },
  {
    context: "Studies away from home during term and returns during breaks.",
    need: "Term-time contact",
    goal: "Keep follow-up connected between home and study",
    interruption: "Correspondence arrived at the term-time address during a break.",
  },
  {
    context: "Works part-time and supports a relative with daily tasks.",
    need: "Carer involvement",
    goal: "Make time for personal reviews alongside caring",
    interruption: "The usual person covering caring duties was unavailable.",
  },
  {
    context: "Runs a small shop with a family member.",
    need: "Evening appointment",
    goal: "Combine routine reviews into fewer journeys",
    interruption: "Separate invitations required closing the shop twice.",
  },
  {
    context: "Works on short contracts in different towns and travels by public transport.",
    need: "Transport",
    goal: "Receive enough notice to arrange travel",
    interruption: "An appointment change left too little time to rearrange travel.",
  },
  {
    context: "Works from home and uses a consumer activity device.",
    need: "Device support",
    goal: "Understand which home information is visible to the practice",
    interruption: "A replacement phone stopped receiving appointment notifications.",
  },
  {
    context: "Recently moved to the area and is settling into a new job.",
    need: "Longer appointment",
    goal: "Understand registration and the route for routine follow-up",
    interruption: "The previous practice record had not arrived at registration.",
  },
];
const laterLife: LifeCourse[] = [
  {
    context: "Lives alone in a ground-floor flat. A neighbour helps with shopping.",
    need: "Offline contact",
    goal: "Know which team is visiting and when",
    interruption: "An app-only invitation could not be opened.",
  },
  {
    context: "Lives with a partner and books community transport in advance.",
    need: "Transport",
    goal: "Coordinate appointments with reliable travel",
    interruption: "The appointment moved after transport had been booked.",
  },
  {
    context: "Lives with family and manages a diary using large print.",
    need: "Large print",
    goal: "Keep managing appointments independently",
    interruption: "The appointment letter was difficult to read.",
  },
  {
    context: "Lives in an upstairs flat and attends a weekly local social group.",
    need: "Step-free access",
    goal: "Attend locally in an accessible room",
    interruption: "The originally allocated room did not offer step-free access.",
  },
  {
    context: "Lives with a partner and prefers a familiar clinician for follow-up.",
    need: "Continuity of clinician",
    goal: "Avoid repeating the same history at each contact",
    interruption: "The requested clinician was unavailable on the offered date.",
  },
];

function random(seed: number, ordinal: number) {
  let state = (Math.imul(seed ^ 0x9e3779b9, 1664525) ^ Math.imul(ordinal, 2246822519)) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function generatePopulationBatch(input: BatchInput): {
  patients: Patient[];
  resources: Resource[];
  version: string;
} {
  if (
    !Number.isSafeInteger(input.seed) ||
    !Number.isSafeInteger(input.start) ||
    input.start < 1 ||
    !Number.isSafeInteger(input.count) ||
    input.count < 0 ||
    input.count > 1000 ||
    input.start + input.count > 1_000_000 ||
    !Number.isFinite(input.now) ||
    Number.isNaN(new Date(input.now).getTime())
  ) {
    throw new Error(
      "Invalid population batch: use a valid clock, integer seed, positive ordinal and 0–1000 patients",
    );
  }
  const patients: Patient[] = [];
  const resources: Resource[] = [];
  for (let ordinal = input.start; ordinal < input.start + input.count; ordinal++) {
    const draw = random(input.seed, ordinal);
    const pick = <T>(items: T[]): T => items[Math.floor(draw() * items.length)];
    const targetAge = Math.floor(draw() * 96);
    const current = new Date(input.now);
    let birth = Date.UTC(
      current.getUTCFullYear() - targetAge,
      Math.floor(draw() * 12),
      1 + Math.floor(draw() * 28),
    );
    if (birth > input.now)
      birth = Date.UTC(
        current.getUTCFullYear() - 1,
        new Date(birth).getUTCMonth(),
        new Date(birth).getUTCDate(),
      );
    const age = Math.floor((input.now - birth) / (365.25 * day));
    const life = pick(
      age < 5 ? earlyChildhood : age < 18 ? childhood : age < 67 ? working : laterLife,
    );
    const contact = age < 18 ? "parent telephone" : pick(["telephone", "letter", "SMS", "app"]);
    const actualContact = life.need === "Offline contact" ? "letter" : contact;
    const terms =
      age < 18
        ? ["Asthma", "Eczema", "No active long-term condition recorded"]
        : age < 40
          ? ["Asthma", "Migraine", "Eczema", "Anxiety", "No active long-term condition recorded"]
          : [
              "Hypertension",
              "Osteoarthritis",
              "Type 2 diabetes",
              "Asthma",
              "Hearing loss",
              "No active long-term condition recorded",
            ];
    const primary = pick(terms);
    const conditions = primary.startsWith("No active") ? [] : [primary];
    if (age >= 60 && draw() < 0.35 && primary !== "Osteoarthritis")
      conditions.push("Osteoarthritis");
    const patient: Patient = {
      id: `SIM-${String(ordinal).padStart(6, "0")}`,
      name: `${pick(givenNames)} ${String.fromCharCode(65 + Math.floor(draw() * 26))}. ${pick(familyNames)}`,
      birthDate: new Date(birth).toISOString().slice(0, 10),
      localIds: { gp: `RIV-P${ordinal}`, hospital: `NBG-P${ordinal}`, legacy: `WH-P${ordinal}` },
      conditions,
      needs: [life.need, `${actualContact} preferred`],
      goals: [life.goal],
      synthetic: true,
    };
    patient.death = syntheticDeath(patient, input.now);
    patients.push(patient);
    resources.push(createGenomeRecord(patient.id, input.now));
    const historySpan = Math.max(0, Math.min(input.now - birth, 1460 * day));
    const count = 3 + Math.floor(draw() * 6);
    const dates = Array.from(
      { length: count },
      (_, index) => input.now - (historySpan * (count - index)) / (count + 1),
    );
    const conditionDate = new Date(dates[0]).toISOString().slice(0, 10);
    const collectionSize = (weights: Record<string, number>, maximum: number) => {
      let position = draw() * Object.values(weights).reduce((sum, weight) => sum + weight, 0);
      for (const [band, weight] of Object.entries(weights)) {
        position -= weight;
        if (position < 0)
          return Math.min(
            maximum,
            band === "0"
              ? 0
              : band === "1-5"
                ? 1 + Math.floor(draw() * 5)
                : band === "6-20"
                  ? 6 + Math.floor(draw() * 15)
                  : 21 + Math.floor(draw() * 10),
          );
      }
      return 0;
    };
    const base = {
      patientId: patient.id,
      owner: "gp",
      visibleTo: ["gp"],
      priority: "routine",
      version: 1,
    } satisfies Pick<Resource, "patientId" | "owner" | "visibleTo" | "priority" | "version">;
    const context = `${life.context} Enjoys ${pick(interests)}. Preferred contact: ${actualContact}.`;
    const problems = [
      ...conditions.map((term, index) => ({
        term,
        code: `SIM-CONDITION-${index + 1}`,
        date: conditionDate,
        status: "active",
      })),
      ...Array.from(
        {
          length: Math.max(0, collectionSize(profile.collections.problems, 8) - conditions.length),
        },
        (_, index) => ({
          term: pick([
            "Previous skin symptom",
            "Previous sleep concern",
            "Previous respiratory symptom",
            "Previous minor injury",
          ]),
          code: `SIM-HISTORY-${index + 1}`,
          date: conditionDate,
          status: "resolved",
        }),
      ),
    ];
    // Preserve the cohort random stream when replacing clinical content.
    collectionSize(profile.collections.medications, 10);
    collectionSize(profile.collections.allergies, 4);
    resources.push({
      ...base,
      visibleTo: [...base.visibleTo],
      id: `pop-v2-${ordinal}-ehr`,
      kind: "ehr-record",
      title: "Longitudinal GP record",
      status: "available",
      createdAt: dates[0],
      data: {
        synthetic: true,
        populationVersion: POPULATION_BATCH_VERSION,
        provenance: profile.id,
        calibration:
          "Aggregate collection sizes, capped for the large cohort; all content authored or generated",
        context,
        contactPreference: actualContact,
        goals: [...patient.goals],
        problems,
        medications: generateMedicationHistory(patient, input.now),
        allergies: generateAllergyHistory(patient, input.now),
        medicationProfile: "condition-linked-v1",
        miscCodes: Array.from(
          { length: collectionSize(profile.collections.miscCodes, 6) },
          (_, index) => ({
            term: "Historical administrative contact",
            code: `SIM-ADMIN-${index + 1}`,
          }),
        ),
      },
    });
    const marginal = (distribution: {
      denominator: number;
      categories: { value: string; count: number }[];
    }) => {
      let position = draw() * distribution.denominator;
      for (const category of distribution.categories) {
        position -= category.count;
        if (position < 0) return category.value;
      }
      return "Unknown";
    };
    const sourceMode = marginal(publicProfile.distributions.appointmentMode);
    const sourceStatus = marginal(publicProfile.distributions.appointmentStatus);
    const sourceRole = marginal(publicProfile.distributions.healthcareProfessionalType);
    const serviceSetting = marginal(publicProfile.distributions.serviceSetting);
    const mode =
      sourceMode === "Face-to-Face"
        ? "in-person"
        : sourceMode === "Telephone"
          ? "telephone"
          : sourceMode === "Home Visit"
            ? "home-visit"
            : sourceMode === "Video Conference/Online"
              ? "online"
              : "unknown";
    resources.push({
      ...base,
      visibleTo: [...base.visibleTo],
      id: `pop-v2-${ordinal}-appointment`,
      kind: "appointment",
      title: "Historical practice appointment",
      status:
        sourceStatus === "Attended" ? "completed" : sourceStatus === "DNA" ? "missed" : "unknown",
      createdAt: dates[0],
      dueAt: dates[1],
      data: {
        synthetic: true,
        populationVersion: POPULATION_BATCH_VERSION,
        provenance: "nhs-england-gp-appointments-2025-05-v1",
        startsAt: dates[1],
        durationMinutes: 15,
        mode,
        capacityReserved: false,
        clinician:
          sourceRole === "GP"
            ? "Dr Maya Shah"
            : sourceRole === "Other Practice staff"
              ? "Practice team"
              : "Not recorded",
        sourceMode,
        sourceStatus,
        sourceRole,
        serviceSetting,
        calibrationPeriod: "2025-05",
        sourceUrl: publicProfile.source.url,
        sampling:
          "Independent count-weighted public marginals; patient assignment, date and duration authored. This appointment is separate from the consultation narrative.",
      },
    });
    const interim = [
      "The patient requested a copy of the previous consultation summary and confirmed the contact details held by the practice.",
      "The patient brought a question about outstanding correspondence. The practice recorded which service was expected to reply.",
      "The patient asked whether separate routine appointments could be arranged on the same day.",
      "The patient checked the next appointment location and requested written confirmation of the booking.",
      "The patient described a change in daily routine and asked for the next review to fit the updated availability.",
    ];
    for (const [index, createdAt] of dates.entries()) {
      const phase =
        index === 0
          ? "Initial practice review"
          : index === count - 1
            ? "Follow-up and preferences"
            : "Practice consultation";
      const text =
        index === 0
          ? `${age < 18 ? "The patient attended with a parent." : "The patient attended a practice review."} ${conditions.length ? `The existing record lists ${conditions.join(" and ")}.` : "No active long-term condition is recorded."} ${context}`
          : index === count - 1
            ? `${life.interruption} ${age < 18 ? "The family" : "The patient"} requested follow-up by ${actualContact}. Stated goal: ${life.goal}.`
            : `${pick(interim)} ${life.context}`;
      resources.push({
        ...base,
        visibleTo: [...base.visibleTo],
        id: `pop-v2-${ordinal}-contact-${index + 1}`,
        kind: "encounter",
        title: phase,
        status: "completed",
        createdAt,
        data: {
          synthetic: true,
          populationVersion: POPULATION_BATCH_VERSION,
          provenance: "authored-life-course-v2",
          reason: conditions[0] ?? "Routine review and access",
          channel: index === 0 ? "in-person" : "telephone",
          author: pick(["Dr Maya Shah", "Dr Daniel Brooks", "Nurse Alex Morgan"]),
          text,
          sections: {
            history: text,
            context,
            plan: "Recorded the patient's preferences and outstanding administrative follow-up.",
          },
        },
      });
    }
  }
  resources.forEach(attributeSyntheticRecord);
  return { patients, resources, version: POPULATION_BATCH_VERSION };
}
