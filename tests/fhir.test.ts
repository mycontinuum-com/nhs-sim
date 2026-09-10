import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { handleFhir, simulationIdentifierSystem } from "../packages/nhs-mocks/src/fhir.ts";
const engine = new Engine();
function request(path: string, world = "default", method = "GET") {
  const response = handleFhir({ engine, world, url: new URL(path, "http://localhost:8080"), method });
  assert.ok(response);
  return response;
}

test("PDS Patient read projects local identifiers and fictional demographics", () => {
  const response = request("/api/nhs/pds/Patient/SIM-000001");
  assert.equal(response.status, 200);
  assert.equal(response.headers?.["Content-Type"], "application/fhir+json");
  assert.equal(response.body.resourceType, "Patient");
  assert.deepEqual(response.body.name, [{ use: "official", text: "Amira Khan", family: "Khan", given: ["Amira"] }]);
  assert.deepEqual(response.body.identifier, [{ use: "usual", system: simulationIdentifierSystem, value: "SIM-000001" }]);
  assert.deepEqual(response.body.generalPractitioner, [{ reference: "http://localhost:8080/api/nhs/ods/Organization/SIM-RIVERSIDE", display: "Riverside Practice" }]);
  assert.ok(Array.isArray(response.body.address));
  assert.ok(Array.isArray(response.body.telecom));
  assert.equal(request("/api/nhs/pds/Patient/SIM-999999").status, 404);
  assert.equal(request("/api/nhs/pds/Patient/9000000009").status, 400);
});

test("PDS filters combine and paged bundles preserve query with stable ordering", () => {
  const exact = request("/api/nhs/pds/Patient?family=khan&given=am&birthdate=1952-05-12");
  assert.equal(exact.body.total, 1);
  assert.ok(Array.isArray(exact.body.entry));
  assert.equal(exact.body.entry[0].resource.id, "SIM-000001");
  assert.equal(request(`/api/nhs/pds/Patient?identifier=${encodeURIComponent(simulationIdentifierSystem + "|SIM-000001")}`).body.total, 1);
  assert.equal(request("/api/nhs/pds/Patient?identifier=https://wrong.example|SIM-000001").body.total, 0);
  const first = request("/api/nhs/pds/Patient?_count=2");
  assert.equal(first.body.total, 500);
  assert.ok(Array.isArray(first.body.link));
  const next = first.body.link.find((link) => link.relation === "next");
  assert.ok(next);
  const second = request(next.url);
  assert.ok(Array.isArray(second.body.entry));
  assert.deepEqual(second.body.entry.map((entry) => entry.resource.id), ["SIM-000003", "SIM-000004"]);
  assert.deepEqual(request("/api/nhs/pds/Patient?_offset=9999").body.entry, []);
});

test("FHIR errors reject malformed, unsupported and ambiguous searches", () => {
  for (const query of ["birthdate=2026-02-30", "birthdate=ge2000-01-01", "_count=101", "_count=0", "_offset=-1", "family=Khan&family=Evans", "family=", "gender=female", "world=other", "identifier=a|b|c"]) {
    const response = request("/api/nhs/pds/Patient?" + query);
    assert.equal(response.status, 400, query);
    assert.equal(response.body.resourceType, "OperationOutcome");
  }
  assert.equal(request("/api/nhs/pds/Patient", "default", "POST").status, 405);
  assert.equal(request("/api/nhs/pds/Patient/SIM-000001?family=Khan").status, 400);
  assert.equal(request("/api/nhs/pds/Organization").status, 404);
});

test("FHIR search and reads stay inside the authenticated world", () => {
  engine.create("isolated", 77, 8);
  engine.transaction("isolated", (world) => { world.patients[0].name = "Unique Isolated"; });
  assert.equal(request("/api/nhs/pds/Patient?family=Isolated", "isolated").body.total, 1);
  assert.equal(request("/api/nhs/pds/Patient?family=Isolated").body.total, 0);
  assert.equal(request("/api/nhs/pds/Patient/SIM-000009", "isolated").status, 404);
  assert.equal(request("/api/nhs/pds/Patient", "missing").status, 404);
});

test("ODS directory matches local organisations and metadata advertises only reads", () => {
  const response = request("/api/nhs/ods/Organization?name=Riverside%20Practice");
  assert.equal(response.body.total, 1);
  assert.ok(Array.isArray(response.body.entry));
  assert.equal(response.body.entry[0].resource.id, "SIM-RIVERSIDE");
  assert.equal(request("/api/nhs/ods/Organization/SIM-NORTHBANK").body.name, "Northbank General");
  assert.equal(request("/api/nhs/ods/Organization?active=false").body.total, 0);
  assert.equal(request("/api/nhs/ods/Organization?active=maybe").status, 400);
  const capability = request("/api/nhs/pds/metadata");
  assert.equal(capability.body.resourceType, "CapabilityStatement");
  assert.ok(Array.isArray(capability.body.rest));
  assert.deepEqual(capability.body.rest[0].resource[0].interaction, [{ code: "read" }, { code: "search-type" }]);
  assert.equal(handleFhir({ engine, world: "default", url: new URL("http://localhost/api/nhs/ers"), method: "GET" }), undefined);
});
