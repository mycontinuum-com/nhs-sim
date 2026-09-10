import React, { useState } from "react";
import type { Action, Resource } from "../../contracts/src/index.ts";
import { dischargeDocumentSchema } from "../../contracts/src/documents.ts";
import { documentSnomedConcepts } from "../../contracts/src/document-terminology.ts";

export function DocumentCoding({ resource, pending, save }: { resource: Resource; pending: boolean; save: (action: Action) => void }) {
  const doc = dischargeDocumentSchema.parse(resource.data);
  const [tags, setTags] = useState(doc.tags);
  const [codes, setCodes] = useState(doc.snomedCodes);
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const dirty = JSON.stringify(tags) !== JSON.stringify(doc.tags) || JSON.stringify(codes) !== JSON.stringify(doc.snomedCodes);
  const matches = documentSnomedConcepts.filter(concept => !codes.some(item => item.code === concept.code) && `${concept.code} ${concept.display}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <details className="document-coding"><summary>Tags and SNOMED codes <small>{doc.tags.length} tags · {doc.snomedCodes.length} codes</small></summary>
    <form onSubmit={event => { event.preventDefault(); if (tag.trim() && tags.length < 20 && !tags.some(value => value.toLowerCase() === tag.trim().toLowerCase())) setTags([...tags, tag.trim()]); setTag(""); }}>
      <label>Document tag<input maxLength={50} value={tag} onChange={event => setTag(event.target.value)} placeholder="e.g. Follow-up needed" /></label><button disabled={pending || !tag.trim() || tags.length >= 20}>Add tag</button>
    </form>
    <ul className="document-code-chips" aria-label="Document tags">{tags.map(value => <li key={value}>{value}<button aria-label={`Remove tag ${value}`} disabled={pending} onClick={() => setTags(tags.filter(item => item !== value))}>×</button></li>)}</ul>
    <label>Search SNOMED CT<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Clinical term or code" /></label>
    <p className="document-help">Search the simulation's 10-concept subset. Codes annotate this letter; add patient problems separately.</p>
    <ul className="document-code-results" aria-label="SNOMED search results">{matches.map(concept => <li key={concept.code}><button disabled={pending || codes.length >= 20} onClick={() => { setCodes([...codes, concept]); setQuery(""); }}>{concept.display}<small>{concept.code} · Add</small></button></li>)}</ul>{matches.length === 0 && <p>No matching unselected concepts.</p>}
    <ul className="document-code-chips" aria-label="Selected SNOMED codes">{codes.map(concept => <li key={concept.code}><span>{concept.display}<small>{concept.code}</small></span><button aria-label={`Remove code ${concept.code}`} disabled={pending} onClick={() => setCodes(codes.filter(item => item.code !== concept.code))}>×</button></li>)}</ul>
    <button disabled={pending || !dirty} onClick={() => save({ type: "process_document", documentCommand: "annotate", resourceId: resource.id, expectedVersion: resource.version, documentTags: tags, documentSnomedCodes: codes })}>{pending ? "Saving…" : "Save tags and codes"}</button>{dirty && <p className="document-help">Unsaved tags or codes</p>}
  </details>;
}
