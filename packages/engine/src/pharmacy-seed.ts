import type { Resource, World } from "../../contracts/src/index.ts";
export function seedPharmacy(world: World) {
  if (world.counters.pharmacyVersion === 1) return;
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
  world.resources
    .filter((r) => r.kind === "pharmacy-product")
    .forEach((product) => {
      ["Cedar Wholesale", "Northstar Medical", "Orchard Supplies"].forEach((supplier, i) =>
        add(product.id + "-quote-" + i, "pharmacy-quote", supplier + " · " + product.title, {
          productId: product.id,
          supplier,
          packSize: product.data.packSize,
          packCostPence: Math.round(Number(product.data.costPence) * [1, 0.87, 1.15][i]!),
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
  world.counters.pharmacyVersion = 1;
}
export function upgradePharmacyWorld(world: World): World {
  if (world.counters.pharmacyVersion === 1) return world;
  const upgraded = { ...world, resources: [...world.resources], counters: { ...world.counters } };
  seedPharmacy(upgraded);
  return upgraded;
}
