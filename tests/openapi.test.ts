import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { actionExamples, openApiDocument } from "../apps/server/src/openapi.ts";
import { actionSchema, activeServices } from "../packages/contracts/src/index.ts";
import { catalogue } from "../packages/nhs-mocks/src/index.ts";
import { wearableApi, wearableDeviceDataSchema, wearableReadingDataSchema } from "../packages/contracts/src/wearables.ts";

const operationSchema = z.object({ operationId: z.string(), parameters: z.array(z.object({ in: z.string(), name: z.string(), required: z.boolean().optional(), schema: z.record(z.string(), z.unknown()) })).optional(), responses: z.record(z.string(), z.unknown()), security: z.array(z.record(z.string(), z.array(z.string()))).optional() });
const paths = openApiDocument.paths;
test("wearable APIs are discoverable with named runtime data schemas and bounded filters", () => {
  assert.ok(openApiDocument.tags.some(tag => tag.name === "Wearables"));
  for (const [path, page] of [[wearableApi.devices, "WearableDevicesPage"], [wearableApi.readings, "WearableReadingsPage"]]) {
    const operation = paths[path ?? ""]?.get;
    assert.ok(operation);
    assert.deepEqual(operation.tags, ["Wearables"]);
    assert.deepEqual(operation.responses["200"], { description: "Success", content: { "application/json": { schema: { $ref: `#/components/schemas/${page}` } } } });
    const parameters = operationSchema.parse(operation).parameters;
    assert.equal(parameters?.find(parameter => parameter.name === "limit")?.schema.maximum, 500);
    assert.equal(parameters?.find(parameter => parameter.name === "patient")?.schema.minLength, 1);
    assert.ok(operation.responses["405"]);
  }
  for (const [name, schema] of Object.entries({ WearableDeviceData: wearableDeviceDataSchema, WearableReadingData: wearableReadingDataSchema })) {
    const { $schema, ...runtime } = z.toJSONSchema(schema, { io: "input" });
    assert.deepEqual(openApiDocument.components.schemas[name], runtime);
  }
});
test("OpenAPI is serializable, resolves every internal reference and declares each path parameter", () => {
  const document = JSON.parse(JSON.stringify(openApiDocument));
  assert.equal(document.openapi, "3.1.0");
  assert.deepEqual(document.servers, [{ url: "/", description: "This deployment (same origin)" }]);
  const operationIds = new Set<string>();
  function check(value: unknown): void {
    if (Array.isArray(value)) { for (const item of value) check(item); return; }
    if (value === null || typeof value !== "object") return;
    for (const [name, item] of Object.entries(value)) {
      if (name === "$ref" && typeof item === "string") {
        assert.ok(item.startsWith("#/"), `Unexpected external reference: ${item}`);
        let target: unknown = document;
        for (const segment of item.slice(2).split("/")) {
          const object = z.record(z.string(), z.unknown()).parse(target);
          target = object[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
          assert.notEqual(target, undefined, `Unresolved reference ${item}`);
        }
      }
      check(item);
    }
  }
  check(document);
  for (const [path, methods] of Object.entries(paths)) for (const raw of Object.values(methods)) {
    const operation = operationSchema.parse(raw);
    assert.ok(!operationIds.has(operation.operationId), operation.operationId);
    operationIds.add(operation.operationId);
    for (const [, name] of path.matchAll(/\{([^}]+)\}/g)) assert.ok(operation.parameters?.some(parameter => parameter.in === "path" && parameter.name === name && parameter.required), `${path} lacks ${name}`);
    for (const security of operation.security ?? []) for (const name of Object.keys(security)) assert.ok(name in openApiDocument.components.securitySchemes, `Unknown security scheme ${name}`);
    assert.ok(Object.keys(operation.responses).some(status => /^[23]\d\d$/.test(status) || status === "410" || status === "101"));
  }
});

test("runtime literal JSON routes and every active adapter have documented operations", () => {
  const index = readFileSync(new URL("../apps/server/src/index.ts", import.meta.url), "utf8");
  const cis2 = readFileSync(new URL("../apps/server/src/cis2.ts", import.meta.url), "utf8");
  for (const source of [index, cis2]) for (const [, path] of source.matchAll(/path === "((?:\/api\/|\/cis2\/|\/healthz|\/openapi\.json)[^"]*)"/g)) {
    if (["/cis2/", "/cis2/callback"].includes(path)) continue;
    assert.ok(paths[path], `Document new server route ${path}`);
  }
  for (const api of catalogue) {
    assert.ok(paths[`/api/nhs/${api.id}`]?.get);
    assert.ok(paths[`/api/nhs/${api.id}/actions`]?.post);
  }
  const siteParam = operationSchema.parse(paths["/api/sites/{site}/actions"]?.post).parameters?.find(parameter => parameter.name === "site");
  assert.deepEqual(siteParam?.schema.enum, [...activeServices.filter(site => site !== "legacy"), "patient"]);
  for (const path of ["/api/sites/gp/documents", "/api/sites/hospital/documents", "/api/sites/hospital/attendances", "/api/sites/pharmacy/pharmacy-workspace", "/api/sites/gp/messaging-workspace", "/api/sites/patient/messaging-workspace", "/api/nhs/pds/Patient", "/api/nhs/pds/Patient/{id}", "/api/nhs/ods/Organization", "/api/nhs/ods/Organization/{id}"]) assert.ok(paths[path]?.get, path);
});

test("documented action schema stays derived from runtime fields and all examples parse", () => {
  const { $schema, ...runtime } = z.toJSONSchema(actionSchema, { io: "input" });
  const { description, ...documented } = openApiDocument.components.schemas.Action ?? {};
  assert.deepEqual(documented, runtime);
  for (const [name, example] of Object.entries(actionExamples)) assert.ok(actionSchema.safeParse(example.value).success, `Invalid example: ${name}`);
});

test("identity, operator, public and team authentication are distinct and FHIR responses use the proper media type", () => {
  assert.deepEqual(paths["/api/keys"]?.post?.security, []);
  assert.deepEqual(paths["/cis2/token"]?.post?.security, []);
  assert.deepEqual(paths["/cis2/userinfo"]?.get?.security, [{ CIS2AccessToken: [] }]);
  assert.deepEqual(paths["/api/operator/cis2"]?.put?.security, [{ OperatorKey: [] }]);
  for (const path of ["/api/nhs/pds/Patient", "/api/nhs/ods/Organization"]) {
    const content = z.object({ content: z.record(z.string(), z.unknown()) }).parse(paths[path]?.get?.responses["200"]).content;
    assert.ok(content["application/fhir+json"]);
    assert.ok(!operationSchema.parse(paths[path]?.get).parameters?.some(parameter => parameter.name === "world"));
  }
  const patientMessaging = operationSchema.parse(paths["/api/sites/patient/messaging-workspace"]?.get);
  assert.ok(patientMessaging.parameters?.some(parameter => parameter.name === "patientId" && parameter.required));
});
