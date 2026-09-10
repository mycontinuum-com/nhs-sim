import type { RecordChange, Resource, World } from "../../contracts/src/index.ts";

function fictionalName(name: string): string {
  if (name === "Synthetic hospital discharge team") return "Dr Morgan Bell";
  if (name === "Synthetic GP document reviewer · Dr Rowan Page") return "Dr Rowan Page";
  if (name === "Synthetic practice administrator · Alex Ledger") return "Alex Ledger · Practice administrator";
  const namedTeam = /^Synthetic .+ team · (Dr .+)$/.exec(name);
  return namedTeam?.[1] ?? name;
}

export function nameDocumentAuthors(world: World): void {
  if (world.counters.documentAuthorVersion === 1) return;
  world.resources = world.resources.map((record): Resource => {
    if (record.kind !== "discharge-summary" || !record.provenance) return record;
    const renames = new Map<string, string>();
    const rename = (change: RecordChange): RecordChange => {
      if (change.actor.kind !== "simulation") return change;
      const name = fictionalName(change.actor.name);
      if (name === change.actor.name) return change;
      renames.set(change.actor.name, name);
      return { ...change, actor: { ...change.actor, name } };
    };
    const created = record.provenance.created ? rename(record.provenance.created) : null;
    const changes = record.provenance.changes.map(rename);
    if (!renames.size) return record;
    const data = { ...record.data };
    for (const field of ["sentBy", "reviewedBy", "filedBy"] as const) {
      const value = data[field];
      const source = field === "sentBy"
        ? record.provenance.changes.find(change => change.action === "seed_document_sent") ?? record.provenance.created
        : record.provenance.changes.find(change => change.action === (field === "reviewedBy" ? "seed_document_reviewed" : "seed_document_filed"));
      if (source?.actor.kind === "simulation" && value === source.actor.name) data[field] = fictionalName(source.actor.name);
    }
    return { ...record, data, provenance: { ...record.provenance, created, changes } };
  });
  world.counters.documentAuthorVersion = 1;
}
