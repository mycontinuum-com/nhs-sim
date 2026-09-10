import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { upgradeDocumentWorld } from "../packages/engine/src/document-seed.ts";

test("existing seeded discharge authors become fictional clinicians without changing team reviews", () => {
  const world = new Engine().require("default");
  const example = world.resources.find(record => record.id === "discharge-summary-example")!;
  const created = example.provenance!.created!;
  const old = { ...example, data: { ...example.data, sentBy: "Synthetic hospital discharge team", reviewedBy: "Hackathon reviewers", reviewNote: "Keep our review" }, provenance: { created: { ...created, actor: { kind: "simulation" as const, name: "Synthetic hospital discharge team" } }, changes: [{ ...created, actor: { kind: "team" as const, name: "Hackathon reviewers" }, action: "process_document", version: 2 }] } };
  const legacy = { ...world, resources: [old], counters: { ...world.counters, documentAuthorVersion: 0 } };
  const updated = upgradeDocumentWorld(legacy);
  const result = updated.resources[0]!;
  assert.equal(result.provenance?.created?.actor.name, "Dr Morgan Bell");
  assert.equal(result.data.sentBy, "Dr Morgan Bell");
  assert.equal(result.data.reviewedBy, "Hackathon reviewers");
  assert.equal(result.data.reviewNote, "Keep our review");
  assert.deepEqual(result.provenance?.changes, old.provenance.changes);
  assert.equal(old.provenance.created.actor.name, "Synthetic hospital discharge team");
  assert.equal(upgradeDocumentWorld(updated), updated);
});

test("new example letters have a fictional doctor as both author and sender", () => {
  const example = new Engine().require("default").resources.find(record => record.id === "discharge-summary-example")!;
  assert.equal(example.provenance?.created?.actor.name, "Dr Morgan Bell");
  assert.equal(example.data.sentBy, "Dr Morgan Bell");
});
