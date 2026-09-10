import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import { upgradePharmacyWorld } from "../packages/engine/src/pharmacy-seed.ts";
import type { Action, Resource } from "../packages/contracts/src/index.ts";
const actor = { kind: "team", name: "Pharmacy QA" } as const;
const get = (e: Engine, id: string) => e.require("default").resources.find((r) => r.id === id)!;
function action(e: Engine, r: Resource, fields: Omit<Action, "resourceId" | "expectedVersion">) {
  return e.action(
    "default",
    "pharmacy",
    { ...fields, resourceId: r.id, expectedVersion: r.version },
    actor,
  );
}
test("Pharmacy First returns attributed outcome to referring service and protects transitions", () => {
  const e = new Engine();
  let r = e.action(
    "default",
    "gp",
    {
      type: "receive_pharmacy_referral",
      patientId: "SIM-000020",
      title: "Fictional symptom referral",
      pharmacyPathway: "Sore throat",
      referralSource: "gp",
    },
    actor,
    "referral",
  );
  assert.throws(
    () =>
      action(e, r, {
        type: "update_pharmacy_referral",
        pharmacyCommand: "complete",
        text: "Outcome",
      }),
    /transition/,
  );
  r = action(e, r, { type: "update_pharmacy_referral", pharmacyCommand: "accept" });
  r = action(e, r, { type: "update_pharmacy_referral", pharmacyCommand: "consult" });
  r = action(e, r, {
    type: "update_pharmacy_referral",
    pharmacyCommand: "complete",
    text: "Fictional consultation completed and returned",
  });
  assert.equal(
    e.view("default", "gp").resources.find((x) => x.id === r.id)?.data.outcome,
    "Fictional consultation completed and returned",
  );
  assert.deepEqual(r.provenance?.changes.at(-1)?.actor, actor);
  assert.throws(
    () =>
      e.action(
        "default",
        "gp",
        {
          type: "receive_pharmacy_referral",
          patientId: "SIM-000020",
          title: "Supply",
          pharmacyPathway: "Urgent medicine supply",
          referralSource: "gp",
        },
        actor,
      ),
    /not a GP/,
  );
});
test("supplier orders snapshot costs, receipt occurs once and dispensing records weighted cost", () => {
  const e = new Engine();
  const productId = "pharmacy-product-furosemide";
  const quote = get(e, productId + "-quote-1");
  const order = action(e, quote, { type: "place_pharmacy_order", quantity: 4 });
  assert.equal(order.data.totalPence, 452);
  const receive = { type: "receive_pharmacy_order", resourceId: order.id, expectedVersion: 1 };
  assert.throws(() => e.action("default", "pharmacy", receive, actor), /not due/);
  e.require("default").now += 5760 * 60000;
  const received = e.action("default", "pharmacy", receive, actor, "receipt");
  assert.equal(get(e, productId).data.stock, 224);
  assert.equal(get(e, productId).data.stockCostPence, 972);
  assert.equal(e.action("default", "pharmacy", receive, actor, "receipt").id, received.id);
  assert.equal(get(e, productId).data.stock, 224);
  assert.throws(() => action(e, received, { type: "receive_pharmacy_order" }), /outstanding/);
  let rx = e.action(
    "default",
    "gp",
    { type: "draft_prescription", patientId: "SIM-000001", title: "Furosemide fictional supply" },
    actor,
  );
  rx = action(e, rx, { type: "review" });
  rx = action(e, rx, { type: "accept" });
  rx = action(e, rx, { type: "link_prescription_stock", productId, quantity: 28 });
  const dispense = { type: "dispense", resourceId: rx.id, expectedVersion: rx.version };
  e.action("default", "pharmacy", dispense, actor, "dispense");
  e.action("default", "pharmacy", dispense, actor, "dispense");
  assert.equal(get(e, productId).data.stock, 196);
  const movement = e
    .require("default")
    .resources.find((r) => r.kind === "pharmacy-movement" && r.data.prescriptionId === rx.id)!;
  assert.equal(movement.data.costPence, 121.5);
  assert.equal(movement.data.revenuePence, 250);
  action(e, get(e, productId), {
    type: "update_stock_price",
    costPence: 900,
    pricePence: 1000,
    reorderLevel: 50,
  });
  assert.equal(movement.data.revenuePence, 250);
  assert.equal(order.data.totalPence, 452);
  assert.throws(() => action(e, get(e, rx.id), { type: "dispense" }), /transition/);
  e.create("other");
  assert.equal(
    e.view("other", "pharmacy").resources.some((r) => r.id === rx.id),
    false,
  );
});
test("insufficient stock and shortage roll back prescription and inventory together", () => {
  const e = new Engine();
  const productId = "pharmacy-product-furosemide";
  let rx = e.action(
    "default",
    "gp",
    { type: "draft_prescription", patientId: "SIM-000001" },
    actor,
  );
  rx = action(e, rx, { type: "review" });
  rx = action(e, rx, { type: "accept" });
  rx = action(e, rx, { type: "link_prescription_stock", productId, quantity: 9999 });
  assert.throws(() => action(e, rx, { type: "dispense" }), /Insufficient stock/);
  assert.equal(get(e, rx.id).status, "approved");
  assert.equal(get(e, productId).data.stock, 112);
  rx = action(e, rx, { type: "link_prescription_stock", productId, quantity: 28 });
  e.fault("default", "pharmacy-shortage", true);
  assert.throws(() => action(e, rx, { type: "dispense" }), /shortage/);
  e.fault("default", "pharmacy-shortage", false);
  assert.equal(action(e, rx, { type: "dispense" }).status, "dispensed");
});
test("pharmacy upgrade preserves existing records and is idempotent", () => {
  const e = new Engine();
  const world = e.require("default");
  assert.equal(upgradePharmacyWorld(world), world);
  const old = {
    ...world,
    counters: { ...world.counters, pharmacyVersion: 0 },
    resources: world.resources.filter((r) => !r.kind.startsWith("pharmacy-")),
  };
  const upgraded = upgradePharmacyWorld(old);
  assert.equal(upgraded.resources[0], old.resources[0]);
  assert.equal(upgraded.resources.filter((r) => r.kind === "pharmacy-product").length, 30);
  assert.equal(upgradePharmacyWorld(upgraded), upgraded);
});
