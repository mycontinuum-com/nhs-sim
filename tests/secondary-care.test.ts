import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { secondaryCarePage } from "../packages/engine/src/secondary-care.ts";
import { secondaryCareQuerySchema } from "../packages/contracts/src/secondary-care.ts";

test("raw hospital consultations preserve signed text, sections, addenda and provenance across pages", () => {
  const engine = new Engine();
  const worldId = "default";
  const patientId = "SIM-000004";
  const text = "Fictional consultation\n\nOriginal spacing:  two spaces\n" + "Raw narrative. ".repeat(500);
  let note = engine.action(worldId, "hospital", { type: "hospital_note", patientId, title: "Raw record proof", hospitalNoteCommand: { kind: "save", template: "free-text", sections: [{ id: "body", heading: "Clinical note", text }] } }, { kind: "team", name: "Hospital team" });
  note = engine.action(worldId, "hospital", { type: "hospital_note", resourceId: note.id, expectedVersion: note.version, hospitalNoteCommand: { kind: "sign" } }, { kind: "team", name: "Hospital team" });
  note = engine.action(worldId, "hospital", { type: "hospital_note", resourceId: note.id, expectedVersion: note.version, hospitalNoteCommand: { kind: "addendum", text: "Fictional appended clarification\nsecond line" } }, { kind: "team", name: "Hospital team" });
  engine.action(worldId, "hospital", { type: "hospital_note", patientId, title: "Second consultation", hospitalNoteCommand: { kind: "save", template: "progress", sections: [{ id: "plan", heading: "Plan", text: "Synthetic follow-up" }] } }, "Hospital team");
  engine.action(worldId, "gp", { type: "save_consultation", patientId, title: "GP consultation", text: "Primary care only", consultationStatus: "saved" }, "GP team");
  const world = engine.require(worldId);
  const first = secondaryCarePage(world, "consultations", secondaryCareQuerySchema.parse({ patient: patientId, limit: 1 }));
  assert.equal(first.total, 2);
  assert.equal(first.offset, 0);
  assert.equal(first.limit, 1);
  assert.equal(first.now, world.now);
  assert.deepEqual(JSON.parse(JSON.stringify(first.items[0])), JSON.parse(JSON.stringify(note)));
  assert.equal(first.items[0]?.data.text, "Clinical note\n" + text);
  assert.deepEqual(first.items[0]?.data.addenda, [{ text: "Fictional appended clarification\nsecond line", time: world.now, author: "Hospital team" }]);
  assert.ok(first.items[0]?.provenance?.changes.length);
  const second = secondaryCarePage(world, "consultations", secondaryCareQuerySchema.parse({ patient: patientId, offset: 1, limit: 1 }));
  assert.equal(second.items[0]?.title, "Second consultation");
  assert.equal(secondaryCarePage(world, "consultations", secondaryCareQuerySchema.parse({ patient: patientId, offset: 2 })).items.length, 0);
  assert.equal(secondaryCarePage(world, "consultations", secondaryCareQuerySchema.parse({ patient: "SIM-00000" })).total, 0);
});

test("secondary care raw reads filter ownership and visibility and cannot cross worlds", () => {
  const engine = new Engine();
  engine.create("isolated");
  const world = engine.require("default");
  const make = (kind: string, owner: "hospital" | "gp", id: string) => {
    const resource = engine.add(world, kind, id, owner, "SIM-000004");
    resource.visibleTo = ["hospital"];
    resource.data = { text: "Unabridged synthetic source", extra: { original: [1, 2, 3] } };
    return resource;
  };
  const source = make("encounter", "hospital", "hospital source");
  make("encounter", "gp", "shared GP encounter");
  make("clinical-note", "hospital", "hidden hospital note").visibleTo = ["gp"];
  const query = secondaryCareQuerySchema.parse({ patient: "SIM-000004" });
  assert.deepEqual(secondaryCarePage(world, "consultations", query).items, [source]);
  assert.equal(secondaryCarePage(engine.require("isolated"), "consultations", query).total, 0);
  const genomePage = secondaryCarePage(world, "genomes", query);
  assert.ok(genomePage.total >= 1);
  const genome = genomePage.items[0];
  assert.ok(genome);
  assert.equal(genome.kind, "genome-record");
  assert.equal(genome.owner, "hospital");
  assert.deepEqual(genome.visibleTo, ["hospital"]);
  assert.deepEqual(genome, world.resources.find(item => item.id === genome.id));
  assert.equal(secondaryCarePage(world, "genomes", secondaryCareQuerySchema.parse({ patient: "unknown" })).total, 0);
  assert.equal(genomePage.items.some(item => item.kind === "genomic-test"), false);
});

test("secondary care query validates patient and bounded pagination", () => {
  assert.deepEqual(secondaryCareQuerySchema.parse({}), { offset: 0, limit: 100 });
  for (const offset of ["-1", "1.5", "Infinity", "9007199254740992"]) assert.equal(secondaryCareQuerySchema.safeParse({ offset }).success, false);
  for (const limit of ["0", "501", "", "1.5"]) assert.equal(secondaryCareQuerySchema.safeParse({ limit }).success, false);
  assert.equal(secondaryCareQuerySchema.safeParse({ patient: "" }).success, false);
});
