import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { prescriptionPage } from "../packages/engine/src/primary-care.ts";
import { prescriptionQuerySchema, primaryCareApi } from "../packages/contracts/src/primary-care.ts";
import { openApiDocument } from "../apps/server/src/openapi.ts";

const medicationOrder = { drug: "Example medicine", dose: "1", unit: "tablet", route: "Oral", frequency: "Once daily", duration: "7 days", quantity: 7, indication: "Fictional workflow test" };

test("GP issues, retrieves, reviews and approves its prescription with versioned attribution", () => {
  const engine = new Engine();
  const input = { type: "draft_prescription", patientId: "SIM-000001", title: "Fictional GP prescription", medicationOrder };
  let rx = engine.action("default", "gp", input, "GP team", "issue-rx");
  assert.equal(engine.action("default", "gp", input, "GP team", "issue-rx").id, rx.id);
  assert.equal(rx.status, "draft");
  assert.equal(rx.owner, "pharmacy");
  assert.deepEqual(rx.data.medicationOrder, medicationOrder);
  const change = (type: string, version = rx.version) => engine.action("default", "gp", { type, resourceId: rx.id, expectedVersion: version }, "GP team");
  assert.throws(() => change("accept"), /Invalid lifecycle transition/);
  assert.throws(() => engine.action("default", "gp", { type: "review", resourceId: rx.id }, "GP team"), /Versioned prescription required/);
  rx = change("review");
  assert.equal(rx.status, "reviewed");
  assert.throws(() => change("accept", 1), /Stale resource version/);
  rx = change("accept");
  assert.equal(rx.status, "approved");
  assert.deepEqual(rx.provenance?.changes.map(entry => [entry.source, entry.action]), [["gp", "draft_prescription"], ["gp", "review"], ["gp", "accept"]]);
  assert.throws(() => change("dispense"), /Only owning service/);
  assert.throws(() => change("collect"), /Only owning service/);
  const page = prescriptionPage(engine.require("default"), prescriptionQuerySchema.parse({ patient: "SIM-000001" }));
  assert.deepEqual(page.items.find(item => item.id === rx.id), rx);
  assert.equal(page.items.find(item => item.id === rx.id)?.status, "approved");
});

test("sharing hospital prescriptions with GP does not grant primary care approval", () => {
  const engine = new Engine();
  const rx = engine.action("default", "hospital", { type: "draft_prescription", patientId: "SIM-000001", medicationOrder }, "Hospital team");
  const shared = engine.action("default", "hospital", { type: "share_record", resourceId: rx.id, target: "gp" }, "Hospital team");
  assert.ok(prescriptionPage(engine.require("default"), prescriptionQuerySchema.parse({})).items.some(item => item.id === rx.id));
  for (const type of ["review", "accept"]) assert.throws(() => engine.action("default", "gp", { type, resourceId: rx.id, expectedVersion: shared.version }, "GP team"), /Only owning service/);
  const reviewed = engine.action("default", "pharmacy", { type: "review", resourceId: rx.id, expectedVersion: shared.version }, "Pharmacy team");
  const approved = engine.action("default", "pharmacy", { type: "accept", resourceId: rx.id, expectedVersion: reviewed.version }, "Pharmacy team");
  assert.equal(approved.status, "approved");
});

test("prescription retrieval filters exact patients and visibility before pagination", () => {
  const engine = new Engine();
  engine.action("default", "gp", { type: "draft_prescription", patientId: "SIM-000001" }, "GP team");
  engine.action("default", "hospital", { type: "draft_prescription", patientId: "SIM-000001" }, "Hospital team");
  engine.action("default", "gp", { type: "draft_prescription", patientId: "SIM-000002" }, "GP team");
  const second = engine.action("default", "gp", { type: "draft_prescription", patientId: "SIM-000001" }, "GP team");
  engine.transaction("default", world => { world.resources = world.resources.filter(resource => resource.provenance?.created?.action === "draft_prescription"); });
  const world = engine.require("default");
  const page = prescriptionPage(world, prescriptionQuerySchema.parse({ patient: "SIM-000001", limit: "1", offset: "1" }));
  assert.deepEqual(page, { items: [second], total: 2, offset: 1, limit: 1 });
  assert.equal(prescriptionPage(world, prescriptionQuerySchema.parse({ patient: "missing" })).total, 0);
  for (const query of [{ limit: 501 }, { offset: -1 }, { patient: "" }]) assert.equal(prescriptionQuerySchema.safeParse(query).success, false);
});

test("primary care prescription APIs are discoverable in OpenAPI", () => {
  const operation = openApiDocument.paths[primaryCareApi.prescriptions]?.get;
  assert.ok(operation);
  assert.deepEqual(operation.tags, ["Primary care"]);
  assert.ok(operation.responses["405"]);
  assert.ok(openApiDocument.paths["/api/sites/{site}/actions"]?.post);
  assert.ok(JSON.stringify(openApiDocument.paths["/api/catalogue"]).includes(primaryCareApi.prescriptions));
});
