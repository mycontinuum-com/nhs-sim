import test from "node:test";
import assert from "node:assert/strict";
import { patientMessageRequestSchema, practiceMessageRequestSchema, messageListQuerySchema, messagingApi } from "../packages/contracts/src/messaging-api.ts";
import { openApiDocument, patientMessageExamples, practiceMessageExamples } from "../apps/server/src/openapi.ts";

test("Messaging Explorer examples use executable role-specific request schemas", () => {
  for (const example of Object.values(practiceMessageExamples)) assert.ok(practiceMessageRequestSchema.safeParse(example.value).success, example.summary);
  for (const example of Object.values(patientMessageExamples)) assert.ok(patientMessageRequestSchema.safeParse(example.value).success, example.summary);
  assert.equal(practiceMessageRequestSchema.safeParse(patientMessageExamples.reply.value).success, false);
  assert.equal(patientMessageRequestSchema.safeParse(practiceMessageExamples.script.value).success, false);
  assert.equal(patientMessageRequestSchema.safeParse({ command: patientMessageExamples.create.value.command }).success, false);
  assert.equal(patientMessageRequestSchema.safeParse({ ...patientMessageExamples.create.value, actor: "Someone else" }).success, false);
  for (const path of [messagingApi.practice, messagingApi.patient]) {
    assert.deepEqual(openApiDocument.paths[path]?.get?.tags, ["Messaging"]);
    assert.deepEqual(openApiDocument.paths[path]?.post?.tags, ["Messaging"]);
    assert.ok(openApiDocument.paths[path]?.post?.requestBody);
  }
  assert.deepEqual(openApiDocument.paths[messagingApi.replyPresets]?.get?.security, []);
});

test("Message list query rejects invalid pages and preserves the patient filter", () => {
  assert.deepEqual(messageListQuerySchema.parse({ patientId: "SIM-000003", offset: "1", limit: "2" }), { patientId: "SIM-000003", offset: 1, limit: 2 });
  for (const limit of ["0", "501", "NaN", "1.5"]) assert.equal(messageListQuerySchema.safeParse({ limit }).success, false);
  for (const offset of ["-1", "Infinity", "1.5"]) assert.equal(messageListQuerySchema.safeParse({ offset }).success, false);
});
