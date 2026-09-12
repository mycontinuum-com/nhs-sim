import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

export async function verifyPrimaryCare(base, issued, gpKey) {
  const headers = { Authorization: `Bearer ${gpKey}`, "Content-Type": "application/json" };
  const call = async (path, options = {}) => {
    const response = await fetch(base + path, { headers, ...options });
    return { status: response.status, data: await response.json() };
  };
  const action = (body) => call("/api/sites/gp/actions", { method: "POST", body: JSON.stringify(body) });
  const patientId = "SIM-000003";
  const path = `/api/sites/gp/prescriptions?patient=${patientId}`;
  assert.equal((await call(path, { headers: {} })).status, 401);
  assert.equal((await call(path, { method: "POST", body: "{}" })).status, 405);
  assert.equal((await call("/api/sites/gp/prescriptions?limit=501")).status, 400);
  const created = await action({ type: "draft_prescription", patientId, title: "Synthetic primary care API proof" });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.status, "draft");
  const resourceId = created.data.id;
  assert.equal((await action({ type: "review", resourceId })).status, 400, "GP review requires a version");
  const premature = await action({ type: "accept", resourceId, expectedVersion: created.data.version });
  assert.equal(premature.status, 409, "approval requires review");
  const reviewed = await action({ type: "review", resourceId, expectedVersion: created.data.version });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.equal(reviewed.data.status, "reviewed");
  const stale = await action({ type: "accept", resourceId, expectedVersion: created.data.version });
  assert.equal(stale.status, 409, "stale approval is rejected");
  const approved = await action({ type: "accept", resourceId, expectedVersion: reviewed.data.version });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.status, "approved");
  const read = await call(path);
  assert.equal(read.status, 200);
  assert.deepEqual(read.data.items.find(item => item.id === resourceId), approved.data);
  assert.ok(read.data.items.every(item => item.kind === "prescription" && item.patientId === patientId));
  const absent = await call("/api/sites/gp/prescriptions?patient=SIM-NOT-A-PATIENT");
  assert.equal(absent.status, 200);
  assert.deepEqual(absent.data.items, []);
  const denied = await action({ type: "dispense", resourceId, expectedVersion: approved.data.version });
  assert.equal(denied.status, 403, "GP approval does not permit dispensing");
  const isolated = await call(path, { headers: { Authorization: `Bearer ${issued.apiKey}` } });
  assert.equal(isolated.status, 200);
  assert.ok(!isolated.data.items.some(item => item.id === resourceId), "another team cannot read the prescription");
  mkdirSync(".verification/evidence", { recursive: true });
  writeFileSync(".verification/evidence/primary-care.json", JSON.stringify({
    at: new Date().toISOString(), origin: base, patientId, resourceId,
    submitted: ["draft_prescription", "review", "accept"],
    observed: { status: approved.data.status, version: approved.data.version, retrieved: true },
    checks: ["GP-only key", "review before approval", "stale version rejected", "patient-filtered retrieval", "dispensing forbidden", "team isolation"],
  }, null, 2) + "\n");
  console.log("PASS: primary care issues, retrieves, reviews and approves prescriptions with a GP-only key");
}
