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
    if (index >= stories.length) {
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
    const story = stories[index];
    if (story && index >= 8) {
      patient.name = story.name;
      patient.birthDate = story.birthDate;
      patient.conditions = [...story.conditions];
      patient.needs = [...story.needs];
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
  enrichPatientStories(world);
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

type LifeStory = {
  name: string;
  birthDate: string;
  conditions: string[];
  needs: string[];
  goal: string;
  context: string;
  contacts: [string, string, string];
};

const stories: LifeStory[] = [
  {
    name: "Amira Khan",
    birthDate: "1952-05-12",
    conditions: ["Heart failure", "CKD"],
    needs: ["Home visit", "Carer involvement"],
    goal: "Stay at home with a clear contact for help",
    context:
      "Lives alone in a ground-floor flat. Her daughter visits after work. Enjoys tending pots outside her front door.",
    contacts: [
      "Amira described getting tired on the walk to the shops. Her daughter asked for appointments to be grouped on one day.",
      "Following a hospital contact, Amira could not tell which team would arrange her next review. The practice requested the correspondence.",
      "Amira wants to return home. Her daughter can collect a prescription but cannot attend during working hours. Home support arrangements remain to be confirmed.",
    ],
  },
  {
    name: "George Evans",
    birthDate: "1984-05-12",
    conditions: ["Referral follow-up"],
    needs: ["Transport"],
    goal: "Know who owns the next step in the referral",
    context:
      "Works as a delivery driver with changing routes. Shares a car with his partner and cannot predict his finish time.",
    contacts: [
      "George asked about a referral sent by the practice. He had not received an appointment letter.",
      "The hospital letter arrived at an old address. George confirmed his contact preferences and asked for a copy of the next letter.",
      "George would like the community team to see the practice summary, but wants to understand which part will be shared.",
    ],
  },
  {
    name: "Aisha Patel",
    birthDate: "1992-05-12",
    conditions: ["Asthma"],
    needs: ["Shift work", "SMS preferred"],
    goal: "Fit reviews around night shifts",
    context:
      "Works rotating shifts at a hotel. Uses the patient app and prefers messages she can read after sleeping.",
    contacts: [
      "Aisha missed a morning appointment after a night shift. She asked the practice to avoid calls before midday.",
      "Aisha attended a routine asthma review. Work patterns and how to contact the practice were recorded.",
      "Aisha asked to book her next routine review through the app. She can attend a late-afternoon slot on a day off.",
    ],
  },
  {
    name: "Thomas Reed",
    birthDate: "2004-05-12",
    conditions: ["Possible inherited disorder"],
    needs: ["Interpreter"],
    goal: "Understand the specialist letter before deciding on next steps",
    context:
      "An apprentice living with family. Requests an interpreter for detailed appointments and wants letters addressed directly to him.",
    contacts: [
      "Thomas brought a family history question to the practice. A specialist referral was recorded.",
      "An appointment was moved because the requested interpreter was unavailable. Thomas asked for enough notice to inform his supervisor.",
      "Thomas received a specialist letter containing unfamiliar terms. He requested a longer follow-up with an interpreter present.",
    ],
  },
  {
    name: "Grace Okafor",
    birthDate: "1991-05-12",
    conditions: ["Diabetes"],
    needs: ["Device setup"],
    goal: "Bring home measurements to a review without retyping them",
    context:
      "Runs a small catering business. A new phone has interrupted the connection to her home device.",
    contacts: [
      "Grace brought a paper list of home measurements because her device had stopped syncing.",
      "The practice recorded Grace's preferred way to submit readings. She wants to retain a paper option during busy work periods.",
      "Grace has a new phone and asked for help reconnecting her device before the next review. No new readings have arrived yet.",
    ],
  },
  {
    name: "Eleanor Chen",
    birthDate: "1943-05-12",
    conditions: ["Frailty"],
    needs: ["Step-free access"],
    goal: "Attend local appointments with reliable transport",
    context:
      "Lives with her husband and enjoys a weekly library group. Uses a landline and does not use the patient app.",
    contacts: [
      "Eleanor cancelled an upstairs appointment because the lift was unavailable. A step-free room was requested.",
      "Eleanor's husband could not drive her to a review. She asked whether appointments could be arranged locally.",
      "Eleanor prefers a telephone call to arrange her next appointment. Her library group meets on Thursday mornings.",
    ],
  },
  {
    name: "Mohammed Ali",
    birthDate: "1968-05-12",
    conditions: ["Awaiting elective surgery"],
    needs: ["Transport"],
    goal: "Plan work and travel around a confirmed operation date",
    context:
      "Self-employed electrician. Long journeys need advance planning and unpaid time away from work.",
    contacts: [
      "Mohammed discussed how his symptoms affect ladder work. A referral was already in progress.",
      "A provisional hospital date changed after he had arranged cover for work. He asked the practice to confirm which team would contact him.",
      "Mohammed remains on the waiting list. He wants a written update and enough notice to arrange transport.",
    ],
  },
  {
    name: "Sofia Williams",
    birthDate: "1978-05-12",
    conditions: ["Prevention review"],
    needs: ["Offline contact"],
    goal: "Receive invitations without needing a smartphone",
    context:
      "Cares for her mother and works part-time at a school. Uses a basic mobile and checks post every evening.",
    contacts: [
      "Sofia could not open an app-only invitation. She asked for appointment information by letter.",
      "Sofia postponed a routine review while arranging support for her mother. She can usually attend during school hours.",
      "Sofia would welcome another invitation by post. She asked that letters include a number to call rather than only a web link.",
    ],
  },
  {
    name: "Nina Brooks",
    birthDate: "2018-02-09",
    conditions: ["Eczema"],
    needs: ["Parent contact", "After-school appointment"],
    goal: "Attend without missing a full school day",
    context:
      "Lives with her father, who works school hours. School correspondence comes through him.",
    contacts: [
      "Nina attended with her father to discuss recurring skin symptoms. Her father described how these affected sleep.",
      "Her father brought the school support form to a follow-up and asked where to send future updates.",
      "The family asked for an after-school appointment. The practice confirmed her father's contact details.",
    ],
  },
  {
    name: "Leo Mason",
    birthDate: "2009-11-23",
    conditions: ["Asthma"],
    needs: ["School coordination"],
    goal: "Keep school and practice information consistent",
    context:
      "A secondary-school pupil who plays percussion. His mother arranges appointments around rehearsals.",
    contacts: [
      "Leo attended an annual review with his mother. The school requested an updated record of his existing plan.",
      "Leo's mother asked for a copy of the review summary for the school office.",
      "Leo wants to attend the next appointment himself with his mother nearby. His communication preference was recorded.",
    ],
  },
  {
    name: "Ruby Ellis",
    birthDate: "2003-07-18",
    conditions: ["Migraine"],
    needs: ["University term dates"],
    goal: "Keep follow-up connected while moving between home and university",
    context: "Studies graphic design away from home. Her term-time and home addresses differ.",
    contacts: [
      "Ruby registered while home for the summer and described how recurring headaches disrupted study.",
      "A letter went to her term-time address while she was home. The practice checked her correspondence preference.",
      "Ruby asked for a telephone follow-up before returning to university and a copy of her recent consultation.",
    ],
  },
  {
    name: "Ben Cooper",
    birthDate: "1987-03-04",
    conditions: ["Back pain"],
    needs: ["Early appointment"],
    goal: "Understand the referral timetable and keep working",
    context: "Works in a warehouse and starts at six. Shares school pick-up with his partner.",
    contacts: [
      "Ben discussed back discomfort and the tasks he finds difficult at work. He requested a record of the consultation.",
      "Ben had not heard from the referral service. The practice checked the destination and contact details.",
      "Ben asked for the first appointment of the day so he can arrange cover at work.",
    ],
  },
  {
    name: "Laila Hussain",
    birthDate: "1971-09-30",
    conditions: ["Hypertension"],
    needs: ["Carer involvement", "Telephone preferred"],
    goal: "Combine her own review with time away from caring",
    context:
      "Supports a husband with limited mobility. Her sister can cover caring duties on Tuesdays.",
    contacts: [
      "Laila postponed her own review when her usual caring cover fell through.",
      "Laila attended with a list of questions about her existing record. She asked the practice to telephone rather than send app messages.",
      "Laila requested a Tuesday appointment when her sister can stay with her husband.",
    ],
  },
  {
    name: "Peter Davies",
    birthDate: "1948-12-16",
    conditions: ["Hearing loss", "Arthritis"],
    needs: ["Written instructions", "Step-free access"],
    goal: "Leave each appointment with a readable summary",
    context:
      "A retired bus mechanic who lives with his partner. Telephone conversations are difficult for him.",
    contacts: [
      "Peter missed part of a telephone conversation and came to reception to clarify the appointment date.",
      "Peter requested written summaries and face-to-face appointments where possible.",
      "Peter brought his previous letter to a review. He confirmed that large, clearly printed appointment details help him attend.",
    ],
  },
  {
    name: "Maya Santos",
    birthDate: "1998-06-21",
    conditions: [],
    needs: ["Interpreter", "Longer appointment"],
    goal: "Complete registration and understand how to access the practice",
    context:
      "Recently moved to the area for work. Prefers a Portuguese interpreter for detailed discussions.",
    contacts: [
      "Maya attended a new-patient contact. Her previous record had not yet arrived.",
      "Maya requested an interpreter and asked how routine appointments and repeat requests work.",
      "Maya confirmed her contact details after moving accommodation. The practice is still awaiting transferred correspondence.",
    ],
  },
  {
    name: "Alfie Turner",
    birthDate: "2021-04-08",
    conditions: [],
    needs: ["Parent contact"],
    goal: "Keep routine childhood appointments on track",
    context: "Lives between two family homes. His mother is the recorded contact for invitations.",
    contacts: [
      "Alfie's mother brought his paper child-health record to registration.",
      "A routine invitation was returned after the family moved. His mother updated the correspondence address.",
      "Alfie's mother asked for a new appointment invitation with enough notice to arrange time off.",
    ],
  },
  {
    name: "Jo Bennett",
    birthDate: "1980-10-12",
    conditions: ["Depression"],
    needs: ["Continuity of clinician"],
    goal: "Avoid repeating personal history at every appointment",
    context:
      "Works in a bookshop and helps organise a local reading group. Values seeing a familiar clinician.",
    contacts: [
      "Jo described how changes at work affected sleep and daily routines. A follow-up with the same clinician was requested.",
      "Jo found repeating their history to a different clinician difficult. The practice recorded a continuity preference.",
      "Jo asked whether the next review could be with the clinician who wrote the previous note.",
    ],
  },
  {
    name: "David Mensah",
    birthDate: "1962-01-27",
    conditions: ["Diabetes", "Hypertension"],
    needs: ["Evening appointment"],
    goal: "Reduce separate trips for routine reviews",
    context: "Runs a corner shop with his brother. Closing during the day affects both of them.",
    contacts: [
      "David received two invitations for separate routine reviews and asked if they could be coordinated.",
      "David brought his appointment letters to reception to clarify which visits were still needed.",
      "David requested an evening slot and one written summary of the outstanding follow-up.",
    ],
  },
  {
    name: "Iris Walker",
    birthDate: "1937-08-05",
    conditions: ["Arthritis", "Frailty"],
    needs: ["Home visit", "Offline contact"],
    goal: "Know which team is visiting and when",
    context:
      "Lives alone with support from a neighbour. Keeps appointment letters beside her landline.",
    contacts: [
      "Iris asked the practice to confirm the name of a visiting team before she let anyone in.",
      "A community visit clashed with a family outing. Iris requested that future visits be confirmed by telephone.",
      "Iris wants a paper list of the teams involved in her care and a number for rearranging visits.",
    ],
  },
  {
    name: "Owen Price",
    birthDate: "1995-02-14",
    conditions: ["Epilepsy"],
    needs: ["Transport", "SMS preferred"],
    goal: "Arrange follow-up around public transport",
    context:
      "Works in IT support and travels by bus. The last bus limits late hospital appointments.",
    contacts: [
      "Owen asked for appointments that allow him to travel home by bus.",
      "Owen received a specialist letter and requested that the practice add a copy to his record.",
      "Owen asked for a text reminder and the location of the next appointment before booking transport.",
    ],
  },
  {
    name: "Fatima Noor",
    birthDate: "1989-11-02",
    conditions: ["Iron deficiency history"],
    needs: ["School-hours appointment"],
    goal: "Complete follow-up without losing school pick-up cover",
    context: "Works part-time and is the main school contact for two children.",
    contacts: [
      "Fatima discussed tiredness at a practice appointment and described her work and caring routine.",
      "Fatima called to ask whether correspondence from her recent contact had arrived.",
      "Fatima requested her next appointment during school hours and asked for a copy of the summary.",
    ],
  },
  {
    name: "Arthur Green",
    birthDate: "1955-06-19",
    conditions: ["COPD"],
    needs: ["Transport", "Telephone preferred"],
    goal: "Coordinate practice and hospital follow-up",
    context:
      "A retired decorator living on the edge of town. His daughter drives him when her shifts permit.",
    contacts: [
      "Arthur attended a routine respiratory review and asked which future appointments would be local.",
      "Arthur received a hospital invitation for the same week as a practice review and asked whether both remained booked.",
      "Arthur's daughter requested enough notice to arrange transport. Arthur prefers the practice to speak to him first.",
    ],
  },
  {
    name: "Eva Novak",
    birthDate: "2000-04-26",
    conditions: ["Anxiety"],
    needs: ["Written appointment details"],
    goal: "Know what to expect before attending",
    context:
      "An engineering trainee sharing a flat. Written information helps her prepare for unfamiliar appointments.",
    contacts: [
      "Eva asked what would happen at an initial appointment and whether she could bring a friend.",
      "Eva attended with questions written in advance. She requested the follow-up details in writing.",
      "Eva asked to confirm the room, expected length and clinician name before the next visit.",
    ],
  },
  {
    name: "Hassan Farah",
    birthDate: "1975-07-07",
    conditions: ["Osteoarthritis"],
    needs: ["Shift work", "Interpreter"],
    goal: "Receive referral updates in a usable format",
    context:
      "Works alternating factory shifts. Prefers an interpreter when discussing specialist correspondence.",
    contacts: [
      "Hassan discussed joint symptoms and the effect on standing at work.",
      "Hassan brought a referral letter to reception and requested help arranging an interpreted appointment.",
      "Hassan asked for the next update after his shift change and confirmed his preferred contact number.",
    ],
  },
  {
    name: "Chloe Martin",
    birthDate: "2012-09-03",
    conditions: ["Hearing loss"],
    needs: ["Written instructions", "Parent contact"],
    goal: "Make appointments easy to follow",
    context:
      "Attends secondary school and enjoys swimming. Her father helps coordinate school and practice correspondence.",
    contacts: [
      "Chloe attended with her father. They asked staff to face her when speaking and provide written details.",
      "Her father supplied a copy of a school communication plan for the practice record.",
      "Chloe asked for a written outline of her next appointment so she can prepare her own questions.",
    ],
  },
  {
    name: "Simon Ross",
    birthDate: "1966-03-22",
    conditions: ["Sleep apnoea"],
    needs: ["Device support"],
    goal: "Keep device support connected to his care record",
    context:
      "Works in accounts and looks after his grandson on Fridays. Keeps device correspondence in a folder.",
    contacts: [
      "Simon brought a specialist device-service letter to the practice.",
      "Simon was unsure whether a device query belonged with the practice or the specialist service. The contact route was recorded.",
      "Simon requested a copy of his recent correspondence and an appointment outside his Friday caring commitment.",
    ],
  },
  {
    name: "Tessa Grant",
    birthDate: "1959-10-28",
    conditions: ["Postoperative follow-up"],
    needs: ["Community coordination"],
    goal: "Have one clear plan after leaving hospital",
    context:
      "Lives with her partner in a first-floor flat. A friend helps with shopping while she recovers.",
    contacts: [
      "Tessa notified the practice of a planned hospital admission and asked who would receive the discharge letter.",
      "Tessa returned home with correspondence describing follow-up. The community team had not yet contacted her.",
      "Tessa asked which team would arrange the next visit and requested that her partner receive the appointment time with her agreement.",
    ],
  },
  {
    name: "Arjun Shah",
    birthDate: "1990-12-09",
    conditions: [],
    needs: ["SMS preferred"],
    goal: "Review his activity record without duplicate data entry",
    context:
      "Works at a desk and cycles at weekends. Uses a consumer activity watch and wants to understand what the practice can see.",
    contacts: [
      "Arjun asked whether his activity watch could contribute to his routine review.",
      "Arjun brought a screenshot of a weekly activity summary. The practice recorded that these were consumer-device data.",
      "Arjun asked how to choose which home information to share and how to withdraw that choice.",
    ],
  },
  {
    name: "Ruth Campbell",
    birthDate: "1946-01-13",
    conditions: ["Diabetes", "Visual impairment"],
    needs: ["Large print", "Telephone preferred"],
    goal: "Receive accessible letters and keep managing her own appointments",
    context: "Lives with her sister and manages her own diary using large print.",
    contacts: [
      "Ruth received a letter she could not read comfortably and requested large print.",
      "Ruth attended a review with her sister but asked staff to address questions to her directly.",
      "Ruth asked the practice to confirm that future invitations would use her recorded accessible format.",
    ],
  },
  {
    name: "Callum Wood",
    birthDate: "1983-08-17",
    conditions: ["Psoriasis"],
    needs: ["Changing work location"],
    goal: "Keep correspondence reliable while working away",
    context: "Works on construction contracts in different towns. Returns home on some weekends.",
    contacts: [
      "Callum attended while home between contracts and asked for follow-up he could arrange remotely.",
      "Callum missed a letter while away. He confirmed a telephone contact route for appointment offers.",
      "Callum asked for a copy of his latest specialist letter before his next contract starts.",
    ],
  },
  {
    name: "Yasmin Ahmed",
    birthDate: "2006-06-06",
    conditions: ["Asthma"],
    needs: ["Continuity during transition"],
    goal: "Manage appointments independently after leaving school",
    context: "Starting college and taking over appointment arrangements from her parent.",
    contacts: [
      "Yasmin attended with a parent and asked how to arrange her own routine reviews.",
      "Yasmin confirmed that appointment messages should now come directly to her. Her own questions were recorded.",
      "Yasmin requested a review during the college break and a copy of her current record summary.",
    ],
  },
  {
    name: "Frank Walsh",
    birthDate: "1951-04-02",
    conditions: ["Parkinson's disease"],
    needs: ["Longer appointment", "Transport"],
    goal: "Allow enough time for appointments and travel",
    context:
      "Lives with his wife and attends a local music group. Community transport requires advance booking.",
    contacts: [
      "Frank asked for additional time at appointments so he would not feel rushed.",
      "A hospital time changed after community transport had been booked. Frank asked for a written confirmation before rearranging travel.",
      "Frank requested a longer practice appointment and an update on the correspondence from his specialist team.",
    ],
  },
];

export function enrichPatientStories(world: World) {
  for (const [index, story] of stories.entries()) {
    if (
      world.resources.some(
        (resource) =>
          resource.data.storyVersion === "patient-stories-v1" && resource.data.storyIndex === index,
      )
    )
      continue;
    let patient = world.patients[index];
    if (!patient) continue;
    if (index >= 8 && patient.birthDate !== story.birthDate) {
      const number = Math.max(...world.patients.map((person) => Number(person.id.slice(4)))) + 1;
      patient = {
        id: "SIM-" + String(number).padStart(6, "0"),
        name: story.name,
        birthDate: story.birthDate,
        conditions: [...story.conditions],
        needs: [...story.needs],
        goals: [],
        synthetic: true,
        localIds: {
          gp: "RIV-" + number,
          hospital: "NBG-" + (10000 + number),
          legacy: "WH-" + (90000 + number),
        },
      };
      world.patients.push(patient);
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
          provenance: "authored-synthetic-v1",
          problems: story.conditions.map((term, item) => ({
            term,
            code: `SIM-PROBLEM-${item + 1}`,
            date: new Date(world.now - 240 * day).toISOString().slice(0, 10),
            status: "active",
          })),
          medications: [],
          allergies: [],
          miscCodes: [],
        },
      });
    }
    patient.goals = [...new Set([...patient.goals, story.goal])];
    addHistory(
      world,
      patient,
      "observation",
      "Personal context and contact preferences",
      world.now - 4 * day,
      {
        storyVersion: "patient-stories-v1",
        storyIndex: index,
        category: "administrative",
        text: `${story.context}\nWhat matters to me: ${story.goal}`,
        context: story.context,
        goal: story.goal,
      },
    );
    if (index < 12) {
      const startsAt =
        Math.ceil(world.now / 900_000) * 900_000 + (1 + Math.floor(index / 3)) * 900_000;
      world.resources.push({
        id: "r-" + world.nextId++,
        patientId: patient.id,
        kind: "appointment",
        title: "Practice follow-up",
        owner: "gp",
        visibleTo: ["gp"],
        status: "booked",
        priority: "routine",
        createdAt: world.now,
        dueAt: startsAt,
        version: 1,
        data: {
          synthetic: true,
          provenance: "authored-synthetic-v1",
          storyVersion: "patient-stories-v1",
          startsAt,
          durationMinutes: 15,
          clinician: ["Dr Maya Shah", "Dr Daniel Brooks", "Nurse Alex Morgan"][index % 3],
          mode: index % 3 === 1 ? "telephone" : "in-person",
          capacityReserved: false,
        },
      });
    }
    for (const [visit, text] of story.contacts.entries()) {
      addHistory(
        world,
        patient,
        "encounter",
        ["Earlier practice contact", "Follow-up consultation", "Recent practice consultation"][
          visit
        ],
        world.now - [240, 83, 9][visit] * day,
        {
          storyVersion: "patient-stories-v1",
          channel: visit === 1 ? "telephone" : "in-person",
          reason: visit === 2 ? story.goal : (story.conditions[0] ?? "Registration and access"),
          text,
          author: "Dr Rowan Ellis",
          sections: {
            history: text,
            context: story.context,
            plan: "Recorded patient preferences and outstanding administrative follow-up.",
          },
        },
      );
    }
  }
}
