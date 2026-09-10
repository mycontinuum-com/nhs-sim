import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { bundle } from "../packages/nhs-mocks/src/index.ts";
const referral = { type: "create_referral", patientId: "SIM-000003", title: "Synthetic outpatient referral" };
test("GP referral reaches its working destination and the eRS adapter retains access", () => {
  const engine = new Engine();
  const created = engine.action("default", "gp", referral, "Orchard");
  assert.equal(created.owner, "hospital");
  assert.ok(engine.view("default", "hospital", referral.patientId).resources.some((record) => record.id === created.id));
  const reviewed = engine.action("default", "hospital", { type: "review", resourceId: created.id, expectedVersion: 1 }, "Meadow");
  const accepted = engine.action("default", "hospital", { type: "accept", resourceId: created.id, expectedVersion: reviewed.version }, "Meadow");
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.provenance?.changes.at(-1)?.actor.name, "Meadow");
  assert.ok(JSON.stringify(bundle(engine, "default", "ers", referral.patientId)).includes(created.id));
  const ers = engine.action("default", "referrals", referral, "Orchard");
  assert.equal(engine.action("default", "referrals", { type: "accept", resourceId: ers.id }, "Orchard").status, "accepted");
  assert.equal(engine.action("default", "referrals", { type: "reject", resourceId: ers.id }, "Orchard").status, "rejected");
  const community = engine.action("default", "gp", { ...referral, target: "community" }, "Orchard");
  assert.equal(community.owner, "community");
  assert.equal(engine.action("default", "community", { type: "accept", resourceId: community.id }, "Meadow").status, "accepted");
});
test("hospital can process legacy received referrals but cannot access hidden referrals", () => {
  const engine = new Engine();
  const created = engine.action("default", "gp", referral, "Orchard");
  engine.transaction("default", (world) => { world.resources.find((record) => record.id === created.id)!.owner = "referrals"; });
  assert.equal(engine.action("default", "hospital", { type: "review", resourceId: created.id }, "Meadow").status, "reviewed");
  assert.equal(engine.action("default", "hospital", { type: "accept", resourceId: created.id }, "Meadow").status, "accepted");
  assert.equal(engine.action("default", "hospital", { type: "complete", resourceId: created.id }, "Meadow").status, "completed");
  engine.transaction("default", (world) => {
    const record = world.resources.find((item) => item.id === created.id)!;
    record.status = "open"; record.visibleTo = ["gp", "referrals"];
  });
  assert.throws(() => engine.action("default", "hospital", { type: "accept", resourceId: created.id }, "Meadow"), /not visible/);
});
