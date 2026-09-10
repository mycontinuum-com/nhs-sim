import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../packages/engine/src/index.ts";
import type { Action, Resource } from "../packages/contracts/src/index.ts";
import { upgradePharmacyWorld } from "../packages/engine/src/pharmacy-seed.ts";
const actor = { kind: "team", name: "Procurement QA" } as const;
const get = (engine: Engine, id: string) => engine.require("default").resources.find(resource => resource.id === id)!;
const act = (engine: Engine, record: Resource, fields: Omit<Action, "resourceId" | "expectedVersion">, key?: string) => engine.action("default", "pharmacy", { ...fields, resourceId: record.id, expectedVersion: record.version }, actor, key);
function add(engine: Engine, product: string, packs = 4) {
  const quote = get(engine, "pharmacy-product-" + product + "-quote-1");
  return act(engine, get(engine, "pharmacy-basket"), { type: "update_pharmacy_basket", quoteId: quote.id, quoteVersion: quote.version, quantity: packs, requiredUnits: 28 });
}
test("patient-free team basket survives serialization and checkout is atomic and idempotent", () => {
  const engine = new Engine();
  add(engine, "metformin");
  const basket = add(engine, "atorvastatin");
  assert.equal(JSON.parse(JSON.stringify(engine.require("default"))).resources.find((resource: Resource) => resource.id === basket.id).data.lines.length, 2);
  const stock = get(engine, "pharmacy-product-metformin").data.stock;
  const checked = act(engine, basket, { type: "checkout_pharmacy_basket" }, "checkout");
  assert.deepEqual(act(engine, basket, { type: "checkout_pharmacy_basket" }, "checkout"), checked);
  assert.equal(get(engine, "pharmacy-product-metformin").data.stock, stock);
  const orders = engine.require("default").resources.filter(resource => resource.kind === "pharmacy-order");
  assert.equal(orders.length, 2);
  assert.equal(orders[0]!.data.batchId, orders[1]!.data.batchId);
  assert.equal(orders[0]!.patientId, undefined);
  assert.equal(orders[0]!.provenance?.created?.actor.name, actor.name);
  assert.throws(() => act(engine, checked, { type: "checkout_pharmacy_basket" }), /empty/);
  engine.create("other");
  assert.equal(engine.require("other").resources.filter(resource => resource.kind === "pharmacy-order").length, 0);
});
test("minimum quantities and changed offers cannot silently checkout", () => {
  const engine = new Engine();
  assert.throws(() => add(engine, "metformin", 1), /minimum packs/);
  const basket = add(engine, "metformin");
  get(engine, "pharmacy-product-metformin-quote-1").data.packCostPence = 900;
  assert.throws(() => act(engine, basket, { type: "checkout_pharmacy_basket" }), /offer changed/);
  assert.equal(engine.require("default").resources.filter(resource => resource.kind === "pharmacy-order").length, 0);
  assert.equal((get(engine, basket.id).data.lines as unknown[]).length, 1);
});
test("partial receipts, retry references and cancellation reconcile units and acquisition cost", () => {
  const engine = new Engine();
  const checked = act(engine, add(engine, "metformin"), { type: "checkout_pharmacy_basket" });
  const orderId = String((checked.data.orderIds as string[])[0]);
  let order = get(engine, orderId);
  engine.require("default").now = Number(order.data.dueAt);
  const packSize = Number(order.data.packSize);
  const packCost = Number(order.data.packCostPence);
  order = act(engine, order, { type: "receive_pharmacy_order", quantity: 1, text: "delivery-001" }, "receipt");
  assert.equal(order.status, "part-received");
  assert.equal(get(engine, "pharmacy-product-metformin").data.stock, packSize);
  assert.equal(get(engine, "pharmacy-product-metformin").data.stockCostPence, packCost);
  assert.throws(() => act(engine, order, { type: "receive_pharmacy_order", quantity: 1, text: "delivery-001" }), /already received/);
  assert.throws(() => act(engine, order, { type: "receive_pharmacy_order", quantity: 4, text: "excess" }), /exceeds/);
  order = act(engine, order, { type: "cancel_pharmacy_order", text: "Supplier cannot fulfil remaining packs" });
  assert.equal(order.data.cancelledPacks, 3);
  assert.equal(order.status, "cancelled");
  assert.throws(() => act(engine, order, { type: "receive_pharmacy_order", quantity: 1 }), /outstanding/);
  const movements = engine.require("default").resources.filter(resource => resource.kind === "pharmacy-movement" && resource.data.productId === "pharmacy-product-metformin");
  assert.equal(movements.reduce((sum, movement) => sum + Number(movement.data.quantity), 0), packSize);
  assert.equal(movements.reduce((sum, movement) => sum + Number(movement.data.valuePence ?? movement.data.acquisitionPence ?? 0), 0), packCost);
});
test("opening migration preserves existing orders and balances without inventing supplier history", () => {
  const engine = new Engine();
  const world = engine.require("default");
  const old = { ...world, counters: { ...world.counters, pharmacyVersion: 1 }, resources: world.resources.filter(resource => resource.data.movementType !== "opening" && resource.kind !== "pharmacy-basket") };
  const upgraded = upgradePharmacyWorld(old);
  assert.equal(upgradePharmacyWorld(upgraded), upgraded);
  assert.equal(upgraded.resources.filter(resource => resource.kind === "pharmacy-product").length, 30);
  for (const product of upgraded.resources.filter(resource => resource.kind === "pharmacy-product")) {
    assert.equal(upgraded.resources.filter(resource => resource.kind === "pharmacy-movement" && resource.data.productId === product.id).reduce((sum, resource) => sum + Number(resource.data.quantity), 0), product.data.stock);
  }
});
test("final partial delivery receives exact frozen order value and rejects stale updates", () => {
  const engine = new Engine();
  const basket = add(engine, "metformin");
  const stale = basket;
  const updated = add(engine, "atorvastatin");
  assert.throws(() => act(engine, stale, { type: "checkout_pharmacy_basket" }), /Stale/);
  const checked = act(engine, updated, { type: "checkout_pharmacy_basket" });
  const order = get(engine, String((checked.data.orderIds as string[])[0]));
  engine.require("default").now = Number(order.data.dueAt);
  const first = act(engine, order, { type: "receive_pharmacy_order", quantity: 1, text: "part1" });
  const final = act(engine, first, { type: "receive_pharmacy_order", quantity: 3, text: "part2" });
  assert.equal(final.status, "received");
  assert.equal(final.data.receivedCostPence, final.data.totalPence);
  assert.equal(get(engine, "pharmacy-product-metformin").data.stock, Number(final.data.packSize) * 4);
  const product = get(engine, "pharmacy-product-metformin");
  assert.equal(product.data.stockCostPence, final.data.totalPence);
  assert.throws(() => engine.action("default", "gp", { type: "checkout_pharmacy_basket", resourceId: "pharmacy-basket", expectedVersion: checked.version }, actor), /not visible/);
});
test("checkout charges one highest delivery fee per supplier and freezes it", () => {
  const engine = new Engine();
  get(engine, "pharmacy-product-metformin-quote-1").data.deliveryFeePence = 150;
  get(engine, "pharmacy-product-atorvastatin-quote-1").data.deliveryFeePence = 250;
  add(engine, "metformin");
  const checked = act(engine, add(engine, "atorvastatin"), { type: "checkout_pharmacy_basket" });
  const ids = checked.data.orderIds as string[];
  const orders = ids.map(id => get(engine, id));
  assert.equal(orders.reduce((sum, order) => sum + Number(order.data.deliveryFeePence), 0), 250);
  assert.equal(orders[0]!.data.deliveryFeePence, 250);
  assert.equal(orders[1]!.data.deliveryFeePence, 0);
});
