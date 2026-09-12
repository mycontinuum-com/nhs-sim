import type { Resource, World } from "../../contracts/src/index.ts";
import { genomeRecordDataSchema, type GenomeRecordData } from "../../contracts/src/genomics.ts";

export function createGenomeRecord(patientId: string, now: number): Resource {
  let hash = 0;
  for (const character of patientId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  const ga = (value: number): "G/G" | "G/A" | "A/A" => value % 3 === 0 ? "G/G" : value % 3 === 1 ? "G/A" : "A/A";
  const ct = (value: number): "C/C" | "C/T" | "T/T" => value % 3 === 0 ? "C/C" : value % 3 === 1 ? "C/T" : "T/T";
  const data: GenomeRecordData = {
    synthetic: true,
    careSetting: "secondary-care",
    gene: "CYP2C19",
    medication: "clopidogrel",
    assay: "targeted-SNP-panel",
    profileVersion: "synthetic-cyp2c19-v1",
    source: "Authored synthetic SNP calls; not a clinical laboratory result",
    variantReference: "https://www.pharmvar.org/gene/cyp2c19",
    phasing: "unphased",
    variants: [
      { rsid: "rs4244285", reference: "G", alternate: "A", genotype: ga(hash) },
      { rsid: "rs4986893", reference: "G", alternate: "A", genotype: ga(Math.floor(hash / 3)) },
      { rsid: "rs12248560", reference: "C", alternate: "T", genotype: ct(Math.floor(hash / 9)) },
    ],
  };
  return {
    id: `genome-cyp2c19-v1-${patientId}`, patientId, kind: "genome-record",
    title: "Synthetic CYP2C19 SNP panel for clopidogrel", status: "available", owner: "hospital",
    visibleTo: ["hospital"], priority: "routine", createdAt: now, version: 1, data,
    provenance: { created: { actor: { kind: "simulation", name: "Synthetic genomic generator" }, source: "hospital", action: "seed", time: now, version: 1 }, changes: [] },
  };
}

export function seedGenomeRecords(world: Pick<World, "patients" | "resources" | "now">): void {
  const covered = new Set(world.resources.filter(record => record.kind === "genome-record" && record.owner === "hospital" && record.visibleTo.includes("hospital") && genomeRecordDataSchema.safeParse(record.data).success).map(record => record.patientId));
  const identifiers = new Set(world.resources.map(record => record.id));
  for (const patient of world.patients) {
    if (!covered.has(patient.id)) {
      const record = createGenomeRecord(patient.id, world.now);
      if (identifiers.has(record.id)) throw new Error("An existing record conflicts with the synthetic genomic record identifier");
      world.resources.push(record);
      identifiers.add(record.id);
    }
  }
}
