import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { genomeRecordDataSchema } from "../packages/contracts/src/genomics.ts";

export async function verifySecondaryCare(base, issued, gpKey) {
  const headers = { Authorization: `Bearer ${issued.apiKey}`, "Content-Type": "application/json" };
  const call = async (path, options = {}) => {
    const response = await fetch(base + path, { headers, ...options });
    return { status: response.status, data: await response.json() };
  };
  const patientId = "SIM-000003";
  for (const collection of ["consultations", "genomes"]) {
    const path = `/api/sites/hospital/${collection}`;
    assert.equal((await call(path, { headers: {} })).status, 401);
    assert.equal((await call(path, { headers: { Authorization: `Bearer ${gpKey}` } })).status, 403);
    assert.equal((await call(path, { method: "POST", body: "{}" })).status, 405);
    assert.equal((await call(`/api/sites/gp/${collection}`)).status, 404);
    assert.equal((await call(`${path}?limit=501`)).status, 400);
    const absent = await call(`${path}?patient=SIM-NOT-A-PATIENT`);
    assert.equal(absent.status, 200);
    assert.deepEqual(absent.data.items, []);
    assert.equal(absent.data.total, 0);
  }
  const genomes = await call(`/api/sites/hospital/genomes?patient=${patientId}`);
  assert.equal(genomes.status, 200);
  assert.ok(genomes.data.total >= 1, "an existing synthetic patient has genomic data");
  const genome = genomes.data.items[0];
  assert.equal(genome.patientId, patientId);
  assert.equal(genome.owner, "hospital");
  assert.deepEqual(genome.visibleTo, ["hospital"]);
  const data = genomeRecordDataSchema.parse(genome.data);
  assert.deepEqual(data.variants.map(variant => variant.rsid), ["rs4244285", "rs4986893", "rs12248560"]);
  for (const site of ["gp", "pharmacy", "community", "wearables", "patient"]) {
    const view = await call(`/api/sites/${site}/view?patient=${patientId}`);
    assert.equal(view.status, 200);
    assert.ok(!view.data.resources.some(record => record.kind === "genome-record"), `${site} cannot read genomic records`);
  }
  const shared = await call("/api/sites/hospital/actions", {
    method: "POST", body: JSON.stringify({ type: "share_record", resourceId: genome.id, expectedVersion: genome.version, target: "gp" }),
  });
  assert.equal(shared.status, 403, "genomes cannot be shared outside secondary care");
  const page = await call("/api/sites/hospital/genomes?limit=1");
  const next = await call("/api/sites/hospital/genomes?limit=1&offset=1");
  assert.equal(page.status, 200);
  assert.equal(next.status, 200);
  assert.equal(page.data.items.length, 1);
  assert.equal(next.data.items.length, 1);
  assert.notEqual(page.data.items[0].id, next.data.items[0].id);
  const patients = await call("/api/sites/hospital/patients");
  assert.equal(patients.status, 200);
  assert.ok(page.data.total >= patients.data.total, "genomic records cover the team population");

  const sections = [{ id: "history", heading: "Raw narrative", text: "Synthetic hospital consultation.\nPreserve this second line exactly." }];
  const draft = await call("/api/sites/hospital/actions", {
    method: "POST", body: JSON.stringify({ type: "hospital_note", patientId, title: "Raw consultation API proof", hospitalNoteCommand: { kind: "save", template: "free-text", sections } }),
  });
  assert.equal(draft.status, 200);
  const signed = await call("/api/sites/hospital/actions", {
    method: "POST", body: JSON.stringify({ type: "hospital_note", resourceId: draft.data.id, expectedVersion: draft.data.version, hospitalNoteCommand: { kind: "sign" } }),
  });
  assert.equal(signed.status, 200);
  const amended = await call("/api/sites/hospital/actions", {
    method: "POST", body: JSON.stringify({ type: "hospital_note", resourceId: signed.data.id, expectedVersion: signed.data.version, hospitalNoteCommand: { kind: "addendum", text: "Synthetic addendum retained verbatim." } }),
  });
  assert.equal(amended.status, 200);
  const consultations = await call(`/api/sites/hospital/consultations?patient=${patientId}`);
  assert.equal(consultations.status, 200);
  const rawNote = consultations.data.items.find(record => record.id === draft.data.id);
  assert.deepEqual(rawNote, amended.data, "raw consultation read preserves the complete signed resource");
  assert.deepEqual(rawNote.data.sections, sections);
  assert.ok(consultations.data.items.every(record => record.owner === "hospital" && record.patientId === patientId));
  const isolated = await call(`/api/sites/hospital/consultations?patient=${patientId}&world=default`);
  assert.equal(isolated.status, 200);
  assert.deepEqual(isolated.data.items.find(record => record.id === draft.data.id), rawNote);
  const isolatedGenome = await call(`/api/sites/hospital/genomes?patient=${patientId}&world=default`);
  assert.deepEqual(isolatedGenome.data.items, genomes.data.items);
  mkdirSync(".verification/evidence", { recursive: true });
  writeFileSync(".verification/evidence/secondary-care.json", JSON.stringify({
    at: new Date().toISOString(), origin: base, world: issued.world,
    observed: { patientId, patientTotal: patients.data.total, genomeTotal: page.data.total, genomeId: genome.id, variants: data.variants, consultationId: rawNote.id, stage: rawNote.data.stage, addenda: rawNote.data.addenda.length },
    checks: ["patient genomic coverage", "hospital-only access", "sharing rejected", "raw signed text and addenda", "pagination", "authentication", "world isolation"],
  }, null, 2) + "\n");
  console.log("PASS: raw secondary care consultations and genomic SNP data, hospital-only access, and pagination");
}
