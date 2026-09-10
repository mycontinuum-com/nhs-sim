import type { Resource } from "../../contracts/src/index.ts";

export function attributeSyntheticRecord(record: Resource): void {
  if (record.provenance?.created) return;
  const author = typeof record.data.author === "string" ? record.data.author.trim() : "";
  const name = author ? `Synthetic clinician ${author}` : `Synthetic ${record.owner === "gp" ? "GP" : record.owner} history`;
  record.provenance = {
    ...record.provenance,
    created: { actor: { kind: "simulation", name }, source: record.owner,
      action: "generate_history", time: record.createdAt, version: 1 },
    changes: record.provenance?.changes ?? [],
  };
}
