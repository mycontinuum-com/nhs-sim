import React, { useEffect, useRef, useState } from "react";
import type { Resource } from "../../contracts/src/index.ts";
import { bloodResultSchema, type BloodAnalyte } from "../../contracts/src/blood-results.ts";
import "./blood-results.css";

type Point = BloodAnalyte & { time: number; reportId: string };
const date = (time: number) => new Date(time).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
export function BloodResults({ rows, patientName, select, variant = "gp" }: { rows: Resource[]; patientName: string; select: (id: string) => void; variant?: "gp" | "hospital" }) {
  const [layout, setLayout] = useState(variant === "hospital" ? "flowsheet" : "list");
  const [sampleLimit, setSampleLimit] = useState(6);
  const [panel, setPanel] = useState("all");
  const [chosen, setChosen] = useState<string[]>([]);
  const [graph, setGraph] = useState(false);
  const reports = rows.flatMap(resource => { const parsed = bloodResultSchema.safeParse(resource.data); return parsed.success ? [{ ...parsed.data, resource }] : []; }).sort((a, b) => b.collectedAt - a.collectedAt);
  const series = new Map<string, { panelId: string; panelName: string; points: Point[] }>();
  for (const report of reports) for (const analyte of report.analytes) {
    const key = `${report.panel.id}:${analyte.id}`;
    const existing = series.get(key) ?? { panelId: report.panel.id, panelName: report.panel.name, points: [] };
    existing.points.push({ ...analyte, time: report.collectedAt, reportId: report.resource.id });
    series.set(key, existing);
  }
  const panels = [...new Map(reports.map(report => [report.panel.id, report.panel.name])).entries()];
  const other = rows.filter(resource => ["test", "report", "genomic-test"].includes(resource.kind) && !bloodResultSchema.safeParse(resource.data).success);
  const samples = [...new Set(reports.filter(report => panel === "all" || report.panel.id === panel).map(report => report.collectedAt))].sort((a, b) => b - a);
  return <section className={`blood-results blood-results-${variant}`} aria-label="Blood test results">
    {variant === "hospital" && <div className="results-module-bar">⌂ &nbsp; Results Review</div>}
    <div className="ehr-section-heading"><h2>Blood test results<small>{patientName} · Synthetic laboratory history</small></h2><button disabled={!chosen.length} onClick={() => setGraph(true)}>Graph selected ({chosen.length})</button></div>
    {variant === "hospital" && <div className="results-view-controls"><label>Flowsheet <select value={layout} onChange={event => setLayout(event.target.value)}><option value="flowsheet">Quick view · by sample time</option><option value="list">Latest and previous results</option></select></label><span>Laboratory · {reports.length} result panels</span></div>}
    <div className="results-browser"><nav className="blood-panels" aria-label="Blood test panels"><button aria-pressed={panel === "all"} onClick={() => setPanel("all")}>All panels</button>{panels.map(([id, name]) => <button key={id} aria-pressed={panel === id} onClick={() => setPanel(id)}>{name}</button>)}</nav>
    <div className="results-values"><p className="blood-hint">Select tests to compare their history. Reference intervals and values are fictional simulation data.</p>
    {layout === "flowsheet" ? <div className="blood-table-scroll results-flowsheet"><table className="ehr-table"><thead><tr><th>Measurement / reference interval</th>{samples.slice(0, sampleLimit).map(time => <th key={time}>{date(time)}<small>{new Date(time).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit",timeZone:"UTC"})} UTC</small></th>)}</tr></thead>{panels.filter(([id]) => panel === "all" || panel === id).map(([id, name]) => <tbody key={id}><tr className="results-panel-row"><th colSpan={Math.min(samples.length, sampleLimit) + 1}>{name}</th></tr>{[...series].filter(([, entry]) => entry.panelId === id).map(([key, entry]) => { const first = entry.points[0]; if (!first) return null; return <tr key={key}><th><label><input type="checkbox" aria-label={`Select ${first.name}`} checked={chosen.includes(key)} onChange={event => setChosen(event.target.checked ? [...chosen, key] : chosen.filter(value => value !== key))} />{first.name}</label><small>{first.referenceLow}–{first.referenceHigh} {first.unit}</small></th>{samples.slice(0, sampleLimit).map(time => { const point = entry.points.find(value => value.time === time); const flag = point && (point.value < point.referenceLow ? "Low" : point.value > point.referenceHigh ? "High" : ""); return <td key={time}>{point ? <button className={flag ? "result-value result-abnormal" : "result-value"} title={`Open ${first.name} result for ${date(time)}`} onClick={() => select(point.reportId)}>{point.value} {point.unit}{flag && <b> {flag}</b>}</button> : <span aria-label="No sample">—</span>}</td>; })}</tr>; })}</tbody>)}</table>{samples.length > sampleLimit && <button onClick={() => setSampleLimit(sampleLimit + 6)}>Show earlier samples</button>}</div> : <div className="blood-table-scroll"><table className="ehr-table"><thead><tr><th>Select</th><th>Test / panel</th><th>Latest result</th><th>Reference interval</th><th>Sample date</th><th>Previous result</th><th>History</th></tr></thead><tbody>{[...series].filter(([, entry]) => panel === "all" || entry.panelId === panel).map(([key, entry]) => {
      const latest = entry.points[0];
      if (!latest) return null;
      const previous = entry.points[1];
      const flag = latest.value < latest.referenceLow ? "Low" : latest.value > latest.referenceHigh ? "High" : "";
      return <tr key={key}><td><input type="checkbox" aria-label={`Select ${latest.name}`} checked={chosen.includes(key)} onChange={event => setChosen(event.target.checked ? [...chosen, key] : chosen.filter(value => value !== key))} /></td><td><strong>{latest.name}</strong><small>{entry.panelName}</small></td><td>{latest.value} {latest.unit} {flag && <span className="blood-flag">{flag}</span>}</td><td>{latest.referenceLow}–{latest.referenceHigh} {latest.unit}</td><td>{date(latest.time)}</td><td>{previous ? <>{previous.value} {previous.unit}<small>{date(previous.time)}</small></> : "No previous result"}</td><td><button onClick={() => { setChosen([key]); setGraph(true); }}>View trend</button></td></tr>;
    })}</tbody></table></div>}
    {!reports.length && <p>No blood test results are available for this patient.</p>}
    {other.length > 0 && <details className="blood-other"><summary>Other investigations and pending requests ({other.length})</summary>{other.map(resource => <p key={resource.id}><button onClick={() => select(resource.id)}>{resource.title}</button> · {resource.status}</p>)}</details>}
    </div></div>
    {graph && <TrendModal patientName={patientName} series={chosen.flatMap(key => { const entry = series.get(key); return entry ? [entry.points] : []; })} close={() => setGraph(false)} />}
  </section>;
}
function TrendModal({ patientName, series, close }: { patientName: string; series: Point[][]; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [days, setDays] = useState(0);
  useEffect(() => { ref.current?.showModal(); }, []);
  const latestTime = Math.max(...series.flatMap(points => points.map(point => point.time)));
  return <dialog ref={ref} className="blood-trend-modal" aria-labelledby="blood-trend-title" onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}><header><div><h2 id="blood-trend-title">Blood test trends</h2><p>{patientName} · Synthetic results</p></div><button onClick={close} aria-label="Close blood test trends">Close ×</button></header><label className="blood-period">History period<select value={days} onChange={event => setDays(Number(event.target.value))}><option value={0}>All results</option><option value={90}>Last 3 months</option><option value={180}>Last 6 months</option><option value={365}>Last 12 months</option></select></label><div className="blood-trend-body">{series.map(points => <Trend key={points[0]?.id} points={points.filter(point => !days || point.time >= latestTime - days * 86400000)} />)}</div></dialog>;
}
function Trend({ points }: { points: Point[] }) {
  const ordered = [...points].sort((a, b) => a.time - b.time);
  const first = ordered[0];
  if (!first) return <p>No results in this period.</p>;
  const last = ordered[ordered.length - 1] ?? first;
  const low = Math.min(...ordered.map(point => Math.min(point.value, point.referenceLow)));
  const high = Math.max(...ordered.map(point => Math.max(point.value, point.referenceHigh)));
  const pad = Math.max((high - low) * 0.15, 1);
  const y = (value: number) => 180 - (value - low + pad) / (high - low + pad * 2) * 150;
  const x = (time: number) => first.time === last.time ? 330 : 65 + (time - first.time) / (last.time - first.time) * 525;
  return <section className="blood-trend"><h3>{first.name} <small>{first.unit}</small></h3><svg viewBox="0 0 650 235" role="img" aria-label={`${first.name} trend, ${ordered.length} results. Values are listed below.`}>
    <rect x="65" y={y(first.referenceHigh)} width="525" height={y(first.referenceLow) - y(first.referenceHigh)} fill="#e8f1e7" />
    {[low - pad, (high + low) / 2, high + pad].map(value => <g key={value}><line x1="65" x2="590" y1={y(value)} y2={y(value)} stroke="#d8dfe5" /><text x="57" y={y(value) + 4} textAnchor="end">{Number(value.toFixed(1))}</text></g>)}
    <polyline points={ordered.map(point => `${x(point.time)},${y(point.value)}`).join(" ")} fill="none" stroke="#17658b" strokeWidth="2.5" />
    {ordered.map(point => <circle key={`${point.time}-${point.reportId}`} cx={x(point.time)} cy={y(point.value)} r="4" fill="#17658b"><title>{date(point.time)} · {point.value} {point.unit}</title></circle>)}
    <text x="65" y="210">{date(first.time)}</text>{last.time !== first.time && <text x="590" y="210" textAnchor="end">{date(last.time)}</text>}
  </svg><p className="blood-hint">Shaded band shows the simulated reference interval.</p><details><summary>View values ({ordered.length})</summary><table className="ehr-table"><thead><tr><th>Sample date</th><th>Result</th><th>Reference interval</th></tr></thead><tbody>{[...ordered].reverse().map(point => <tr key={`${point.time}-${point.reportId}`}><td>{date(point.time)}</td><td>{point.value} {point.unit}</td><td>{point.referenceLow}–{point.referenceHigh} {point.unit}</td></tr>)}</tbody></table></details></section>;
}
