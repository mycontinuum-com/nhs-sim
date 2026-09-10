import React from "react";
import { sites, type RecordActor, type RecordChange, type Resource } from "../../contracts/src/index.ts";
import "./record-attribution.css";

const actorName = (actor: RecordActor) =>
  actor.kind === "team" ? `Team ${actor.name}` : actor.name;
const timestamp = (time: number) => new Date(time).toLocaleString("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
});
function Change({ change }: { change: RecordChange }) {
  return <>{actorName(change.actor)} · {sites.find((site) => site.id === change.source)?.name ?? change.source} · {timestamp(change.time)} · v{change.version}</>;
}
export function RecordAttribution({ record, history = false, summary = true }: { record: Resource; history?: boolean; summary?: boolean }) {
  const created = record.provenance?.created;
  const changes = record.provenance?.changes ?? [];
  const latest = changes.at(-1);
  return <div className="record-attribution">
    {summary && <div>{created ? <>Created by <Change change={created} /></> : "Original author not recorded"}</div>}
    {summary && latest && (!created || latest.version !== created.version || latest.actor.name !== created.actor.name) &&
      <div>Last changed by <Change change={latest} /></div>}
    {history && changes.length > 0 && <details>
      <summary>Activity history · {changes.length}</summary>
      <ol>{changes.map((change, index) => <li key={index}>
        <strong>{change.action.replaceAll("_", " ").replaceAll(".", " ")}</strong>
        <span><Change change={change} /></span>
      </li>)}</ol>
      <small>Times follow the simulation clock.</small>
    </details>}
  </div>;
}
