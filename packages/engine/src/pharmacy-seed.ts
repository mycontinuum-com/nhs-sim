import type { Resource, World } from "../../contracts/src/index.ts";
export function seedPharmacy(world: World) {
  if (world.counters.pharmacyVersion === 2) return;
  const ids = new Set(world.resources.map((r) => r.id));
  const add = (
    id: string,
    kind: string,
    title: string,
    data: Resource["data"],
    patientId?: string,
  ) => {
    if (ids.has(id)) return;
    world.resources.push({
      id,
      kind,
      title,
      patientId,
      owner: "pharmacy",
      visibleTo: kind === "pharmacy-referral" ? ["pharmacy", "gp", "patient"] : ["pharmacy"],
      status: kind === "pharmacy-referral" ? "received" : "available",
      priority: "routine",
      createdAt: world.now,
      version: 1,
      data,
      provenance: {
        created: {
          actor: { kind: "simulation", name: "Synthetic pharmacy team" },
          source: "pharmacy",
          action: "seed",
          time: world.now,
          version: 1,
        },
        changes: [],
      },
    });
  };
  [
    ["furosemide", "Furosemide tablets", "Tablets", 28, 112, 28, 130, 250],
    ["atorvastatin", "Atorvastatin 20mg", "Tablets", 28, 168, 40, 120, 250],
    ["amlodipine", "Amlodipine 5mg", "Tablets", 28, 84, 56, 95, 180],
    ["salbutamol", "Salbutamol 100 micrograms", "Inhaler", 1, 8, 10, 175, 350],
    ["paracetamol", "Paracetamol 500mg", "Tablets", 16, 320, 64, 65, 120],
  ].forEach(([id, drug, formulation, packSize, stock, reorderLevel, costPence, pricePence]) =>
    add("pharmacy-product-" + id, "pharmacy-product", String(drug), {
      drug,
      formulation,
      packSize,
      stock,
      stockCostPence: (Number(stock) / Number(packSize)) * Number(costPence),
      reorderLevel,
      costPence,
      pricePence,
    }),
  );
  const extraProducts = [
    ["metformin", "Metformin 500mg", "Tablets", 28],
    ["omeprazole", "Omeprazole 20mg", "Capsules", 28],
    ["lansoprazole", "Lansoprazole 30mg", "Capsules", 28],
    ["ramipril", "Ramipril 5mg", "Capsules", 28],
    ["losartan", "Losartan 50mg", "Tablets", 28],
    ["bisoprolol", "Bisoprolol 5mg", "Tablets", 28],
    ["levothyroxine", "Levothyroxine 50 micrograms", "Tablets", 28],
    ["sertraline", "Sertraline 50mg", "Tablets", 28],
    ["citalopram", "Citalopram 20mg", "Tablets", 28],
    ["fluoxetine", "Fluoxetine 20mg", "Capsules", 30],
    ["cetirizine", "Cetirizine 10mg", "Tablets", 30],
    ["loratadine", "Loratadine 10mg", "Tablets", 30],
    ["ibuprofen", "Ibuprofen 200mg", "Tablets", 24],
    ["naproxen", "Naproxen 250mg", "Tablets", 28],
    ["aspirin", "Aspirin 75mg", "Tablets", 28],
    ["clopidogrel", "Clopidogrel 75mg", "Tablets", 28],
    ["simvastatin", "Simvastatin 20mg", "Tablets", 28],
    ["gliclazide", "Gliclazide 80mg", "Tablets", 28],
    ["empagliflozin", "Empagliflozin 10mg", "Tablets", 28],
    ["amoxicillin", "Amoxicillin 500mg", "Capsules", 21],
    ["doxycycline", "Doxycycline 100mg", "Capsules", 8],
    ["nitrofurantoin", "Nitrofurantoin 100mg", "Capsules", 14],
    ["ferrous-fumarate", "Ferrous fumarate 210mg", "Tablets", 28],
    ["folic-acid", "Folic acid 5mg", "Tablets", 28],
    ["vitamin-d", "Colecalciferol 1000 units", "Capsules", 30],
  ] satisfies [string, string, string, number][];
  extraProducts.forEach(([id, drug, formulation, packSize], index) => {
    const stock = index % 4 === 0 ? 0 : packSize * (index % 5 + 1);
    const costPence = 80 + index * 19;
    add("pharmacy-product-" + id, "pharmacy-product", drug, { drug, formulation, packSize, stock, stockCostPence: stock / packSize * costPence, reorderLevel: packSize * 2, costPence, pricePence: costPence + 150 });
  });
  world.resources
    .filter((r) => r.kind === "pharmacy-product")
    .forEach((product) => {
      ["Cedar Wholesale", "Northstar Medical", "Orchard Supplies"].forEach((supplier, i) =>
        add(product.id + "-quote-" + i, "pharmacy-quote", supplier + " · " + product.title, {
          productId: product.id,
          supplier,
          packSize: Number(product.data.packSize) * (i === 1 && extraProducts.some(([id]) => product.id === "pharmacy-product-" + id) ? 2 : 1),
          packCostPence: Math.round(Number(product.data.costPence) * [1, 0.87, 1.15][i]!) * (i === 1 && extraProducts.some(([id]) => product.id === "pharmacy-product-" + id) ? 2 : 1),
          deliveryFeePence: 0,
          available: true,
          minimumPacks: i === 1 ? 4 : 1,
          leadDays: [2, 4, 1][i],
        }),
      );
    });
  world.patients.slice(8, 11).forEach((patient, i) =>
    add(
      "pharmacy-referral-seed-" + i,
      "pharmacy-referral",
      ["Sore throat referral", "Insect bite review request", "Minor illness review"][i] ??
        "Pharmacy referral",
      {
        pathway: ["Sore throat", "Infected insect bites", "Minor illness"][i],
        source: "gp",
        receivedAt: world.now - (i + 1) * 1800000,
        stage: "received",
      },
      patient.id,
    ),
  );
  world.resources = world.resources.map(resource => {
    if (resource.kind !== "pharmacy-order" || resource.data.receivedPacks !== undefined) return resource;
    return { ...resource, data: { ...resource.data, receivedPacks: resource.status === "received" ? resource.data.packs : 0, receivedCostPence: resource.status === "received" ? resource.data.totalPence : 0, cancelledPacks: 0 } };
  });
  add("pharmacy-basket", "pharmacy-basket", "Team purchasing basket", { lines: [] });
  const movements = world.resources.filter(resource => resource.kind === "pharmacy-movement");
  for (const product of world.resources.filter(resource => resource.kind === "pharmacy-product")) {
    const history = movements.filter(movement => movement.data.productId === product.id);
    const quantity = Number(product.data.stock) - history.reduce((sum, movement) => sum + Number(movement.data.quantity ?? 0), 0);
    const valuePence = Number(product.data.stockCostPence) - history.reduce((sum, movement) => sum + Number(movement.data.acquisitionPence ?? 0) - (movement.data.prescriptionId ? Number(movement.data.costPence ?? 0) : 0), 0);
    const openingId = product.id + "-opening";
    if (ids.has(openingId)) continue;
    add(openingId, "pharmacy-movement", "Opening stock balance", { productId: product.id, movementType: "opening", quantity, balance: quantity, valuePence, reference: "Reconstructed opening position; prior supplier history is not available" });
    const opening = world.resources.find(resource => resource.id === openingId);
    if (opening && opening.createdAt === world.now) opening.createdAt = Math.min(product.createdAt, ...history.map(movement => movement.createdAt)) - 1;
  }
  world.counters.pharmacyVersion = 2;
}
export function upgradePharmacyWorld(world: World): World {
  if (world.counters.pharmacyVersion === 2) return world;
  const upgraded = { ...world, resources: [...world.resources], counters: { ...world.counters } };
  seedPharmacy(upgraded);
  return upgraded;
}
