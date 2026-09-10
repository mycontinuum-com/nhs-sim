import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { dischargeDocumentSchema } from "../packages/contracts/src/documents.ts";
import { upgradeDocumentWorld } from "../packages/engine/src/document-seed.ts";

test("New worlds contain a varied, attributed document workload with hospital-only drafts", () => {
  const world = new Engine().require("default");
  const documents = world.resources.filter(resource => resource.kind === "discharge-summary");
  assert.equal(documents.length, 61);
  assert.deepEqual(Object.fromEntries(["sent", "reviewed", "filed", "draft"].map(stage => [stage, documents.filter(resource => resource.status === stage).length])), { sent: 37, reviewed: 12, filed: 8, draft: 4 });
  assert.ok(new Set(documents.map(resource => resource.patientId)).size >= 30);
  assert.equal(new Set(documents.map(resource => resource.title)).size, 13);
  assert.ok(new Set(documents.map(resource => resource.provenance?.created?.actor.name)).size >= 12);
  assert.ok(documents.some(resource => resource.priority === "urgent"));
  assert.ok(documents.some(resource => resource.priority === "routine"));
  const patientIds = new Set(world.patients.map(patient => patient.id));
  for (const resource of documents) {
    const document = dischargeDocumentSchema.parse(resource.data);
    assert.equal(document.stage, resource.status);
    assert.ok(patientIds.has(resource.patientId ?? ""));
    assert.deepEqual(resource.visibleTo, document.stage === "draft" ? ["hospital"] : ["hospital", "gp"]);
    assert.ok(Object.values(document.sections).every(section => section.length > 20));
    assert.ok(resource.createdAt <= world.now);
    const changes = resource.provenance?.changes ?? [];
    assert.ok(changes.every(change => change.time <= world.now && change.time >= resource.createdAt));
    assert.equal(resource.version, changes.length + 1);
    if (document.stage === "reviewed" || document.stage === "filed") {
      assert.ok(document.assignee);
      assert.equal(changes.find(change => change.action === "seed_document_reviewed")?.actor.name, document.reviewedBy);
    }
    if (document.stage === "filed") assert.equal(changes.at(-1)?.actor.name, document.filedBy);
  }
});

test("Persisted version-one worlds gain documents without replacing existing user work", () => {
  const initial = new Engine().require("default");
  const example = initial.resources.find(resource => resource.id === "discharge-summary-example");
  assert.ok(example);
  const editedExample = { ...example, title: "Team-edited legacy letter", data: { ...example.data, assignee: "Team-selected GP" } };
  const retainedBatch = initial.resources.find(resource => resource.id === "document-batch-2-001");
  assert.ok(retainedBatch);
  const editedBatch = { ...retainedBatch, title: "Preserved partial migration edit" };
  const legacy = { ...initial, resources: [editedExample, editedBatch], counters: { ...initial.counters, documentVersion: 1 } };
  const migrated = upgradeDocumentWorld(legacy);
  assert.equal(migrated.resources.length, 61);
  assert.equal(migrated.resources[0], editedExample);
  assert.equal(migrated.resources[1], editedBatch);
  assert.equal(legacy.resources.length, 2);
  assert.equal(legacy.counters.documentVersion, 1);
  assert.equal(migrated.counters.documentVersion, 2);
  assert.equal(upgradeDocumentWorld(migrated), migrated);
  const future = { ...migrated, counters: { ...migrated.counters, documentVersion: 3 } };
  assert.equal(upgradeDocumentWorld(future), future);
});

test("Small and empty cohorts never receive documents for nonexistent patients", () => {
  const initial = new Engine().require("default");
  const small = upgradeDocumentWorld({ ...initial, patients: initial.patients.slice(0, 2), resources: [], counters: { ...initial.counters, documentVersion: 0 } });
  assert.equal(small.resources.length, 61);
  const patients = new Set(small.patients.map(patient => patient.id));
  assert.ok(small.resources.every(resource => patients.has(resource.patientId ?? "")));
  const empty = upgradeDocumentWorld({ ...initial, patients: [], resources: [], counters: { ...initial.counters, documentVersion: 0 } });
  assert.equal(empty.resources.length, 0);
  assert.equal(empty.counters.documentVersion, 2);
});
