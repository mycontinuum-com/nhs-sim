import { ProductBrand } from "./product-brand.tsx";
import React, { useState, type ComponentProps } from "react";
import { z } from "zod";
import type { SystemWorkspace } from "./systems.tsx";
import "./home-workspace.css";

type Props = ComponentProps<typeof SystemWorkspace>;
const readingSchema = z.object({
  value: z.number().nullable(),
  unit: z.string(),
  quality: z.string(),
  baseline: z.number().optional(),
  observedAt: z.number().optional(),
});
const deviceSchema = z.object({ battery: z.number().optional(), quality: z.string().optional() });
type Reading = z.infer<typeof readingSchema> & { id: string; at: number; title: string };
const clock = (at: number) =>
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const day = (at: number) =>
  new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const number = (value: number) => value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
const metricDefinitions = [
  {
    id: "activity",
    label: "Movement",
    unit: "steps/day",
    suffix: "steps",
    icon: "↗",
    tone: "apricot",
  },
  { id: "pulse", label: "Heart rate", unit: "bpm", suffix: "bpm", icon: "♡", tone: "rose" },
  { id: "sleep", label: "Sleep", unit: "h", suffix: "hours", icon: "☾", tone: "lavender" },
];
function Trend({ readings, label }: { readings: Reading[]; label: string }) {
  const valid = readings.filter(
    (reading) => reading.value !== null && reading.quality !== "missing",
  );
  const maximum = Math.max(1, ...valid.map((reading) => reading.value ?? 0));
  if (!valid.length) return <div className="home-chart-empty">No readings in this period</div>;
  return (
    <div
      className="home-chart"
      role="img"
      aria-label={`${label}: ${valid.length} readings, latest available ${number(valid.at(-1)?.value ?? 0)}`}
    >
      <div className="home-chart-bars">
        {readings.map((reading) => (
          <div className="home-chart-column" key={reading.id}>
            <span
              className={`home-chart-bar ${reading.quality === "missing" ? "is-missing" : ""}`}
              style={{
                height: `${reading.value === null || reading.quality === "missing" ? 3 : Math.max(3, (reading.value / maximum) * 100)}%`,
              }}
              title={`${day(reading.at)} ${clock(reading.at)}: ${reading.value === null ? "missing" : `${number(reading.value)} ${reading.unit}`}`}
            />
          </div>
        ))}
      </div>
      <div className="home-chart-axis">
        <span>
          {day(readings[0].at)} · {clock(readings[0].at)}
        </span>
        <span>
          {day(readings[readings.length - 1].at)} · {clock(readings[readings.length - 1].at)}
        </span>
      </div>
    </div>
  );
}

export function HomeWorkspace(props: Props) {
  const [period, setPeriod] = useState<"day" | "week">("week");
  const [showReadings, setShowReadings] = useState(false);
  const [chooseResident, setChooseResident] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const patient = props.patients.find((resident) => resident.id === props.selectedPatient);
  const readings: Reading[] = props.rows
    .filter(
      (resource) =>
        resource.patientId === props.selectedPatient &&
        resource.kind === "observation" &&
        resource.owner === "wearables",
    )
    .flatMap((resource) => {
      const parsed = readingSchema.safeParse(resource.data);
      return parsed.success
        ? [
            {
              ...parsed.data,
              id: resource.id,
              at: parsed.data.observedAt ?? resource.createdAt,
              title: resource.title,
            },
          ]
        : [];
    })
    .sort((a, b) => a.at - b.at);
  const from = props.view.now - (period === "day" ? 24 : 168) * 60 * 60 * 1000;
  const inPeriod = readings.filter((reading) => reading.at >= from && reading.at <= props.view.now);
  const devices = props.rows.filter(
    (resource) =>
      resource.patientId === props.selectedPatient &&
      resource.kind === "device" &&
      resource.owner === "wearables",
  );
  const activityWatch = devices.find(
    (device) => device.status === "active" &&
      (device.data.metric === "steps" || device.title === "Home activity watch"),
  );
  const latest = readings.at(-1);

  return (
    <div className="home-workspace">
      <header className="home-header">
        <button className="home-back" onClick={props.exitToMap}>
          ← Neighbourhood
        </button>
        <a className="home-wordmark" href="/wearables/">
          <ProductBrand product="wearables" />
        </a>
        <a className="home-back" href={`/wearables/messages/${props.selectedPatient ? "?patient=" + encodeURIComponent(props.selectedPatient) : ""}`}>Messages</a>
        <span className="home-synthetic">Synthetic world</span>
      </header>
      <main className="home-main">
        <div className="home-heading">
          <div>
            <p className="home-eyebrow">Your everyday rhythms</p>
            <h1>{patient ? `Hello, ${patient.name.split(" ")[0]}.` : "Welcome home."}</h1>
            <p>Your activity, connected devices and everyday rhythms.</p>
          </div>
          <button
            className="home-resident-button"
            aria-expanded={chooseResident || !patient}
            onClick={() => setChooseResident(!chooseResident)}
          >
            {patient ? (
              <>
                <span className="home-avatar">
                  {patient.name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span>
                  {patient.name}
                  <small>Change resident</small>
                </span>
              </>
            ) : (
              "Choose a resident"
            )}
            <span aria-hidden="true">⌄</span>
          </button>
        </div>
        {(chooseResident || !patient) && (
          <section className="home-resident-picker" aria-label="Resident selection">
            <div>
              <h2>Whose day are we looking at?</h2>
              <p>Switch between fictional residents in your team’s world.</p>
            </div>
            <label>
              Find a resident
              <input
                value={props.patientSearch}
                placeholder="Name or patient ID"
                onChange={(event) => props.searchPatients(event.target.value)}
              />
            </label>
            <div className="home-resident-options">
              {props.patientMatches.map((resident) => (
                <button
                  key={resident.id}
                  onClick={() => {
                    props.selectPatient(resident.id);
                    setChooseResident(false);
                    setConnectionError("");
                  }}
                >
                  {resident.name}
                  <small>{resident.id}</small>
                </button>
              ))}
              {!props.patientMatches.length && <p>No matching residents.</p>}
            </div>
          </section>
        )}
        {patient && (
          <>
            <div className="home-period-row">
              <div>
                <span
                  className={`home-connection-dot ${latest?.quality === "missing" ? "is-offline" : ""}`}
                />
                {latest
                  ? latest.quality === "missing"
                    ? "Latest reading missing"
                    : `Last reading · ${day(latest.at)}, ${clock(latest.at)}`
                  : "No readings received"}
              </div>
              <div className="home-period" aria-label="Reading period">
                <button aria-pressed={period === "day"} onClick={() => setPeriod("day")}>
                  24 hours
                </button>
                <button aria-pressed={period === "week"} onClick={() => setPeriod("week")}>
                  7 days
                </button>
              </div>
            </div>
            <div className="home-dashboard">
              <section className="home-metrics" aria-label="Wellbeing readings">
                {metricDefinitions.map((metric) => {
                  const series = inPeriod.filter((reading) => reading.unit === metric.unit);
                  const current = series.at(-1);
                  const available =
                    current && current.value !== null && current.quality !== "missing";
                  return (
                    <article
                      key={metric.id}
                      className={`home-metric home-${metric.tone} ${metric.id === "activity" ? "home-activity" : ""}`}
                    >
                      <div className="home-metric-title">
                        <span className="home-metric-icon" aria-hidden="true">
                          {metric.icon}
                        </span>
                        <h2>{metric.label}</h2>
                        <span className="home-metric-period">
                          {period === "day" ? "24H" : "7D"}
                        </span>
                      </div>
                      <div
                        className={
                          metric.id === "activity"
                            ? "home-movement-summary"
                            : "home-reading-summary"
                        }
                      >
                        {metric.id === "activity" && (
                          <svg
                            className="home-movement-ring"
                            viewBox="0 0 180 180"
                            aria-hidden="true"
                          >
                            <circle className="home-ring-track" cx="90" cy="90" r="77" />
                            {available &&
                              current.baseline !== undefined &&
                              current.baseline > 0 && (
                                <circle
                                  className="home-ring-value"
                                  cx="90"
                                  cy="90"
                                  r="77"
                                  pathLength="100"
                                  strokeDasharray={`${Math.min(100, Math.max(0, ((current.value ?? 0) / current.baseline) * 100))} 100`}
                                />
                              )}
                          </svg>
                        )}
                        <div className="home-metric-value">
                          {available ? number(current.value ?? 0) : "—"}
                          <small>{metric.suffix}</small>
                        </div>
                      </div>
                      <p className="home-metric-caption">
                        {current
                          ? current.quality === "missing"
                            ? "Reading unavailable · device connection interrupted"
                            : `Latest recorded · ${day(current.at)}, ${clock(current.at)}`
                          : "No recorded data in this period"}
                      </p>
                      <Trend readings={series} label={metric.label} />
                      {metric.id === "activity" && (
                        <div className="home-baseline">
                          {current?.baseline !== undefined ? (
                            <>
                              Ring compares the latest reading with a recorded baseline of{" "}
                              <b>{number(current.baseline)}</b> steps/day. This is not a target.
                            </>
                          ) : (
                            "Each bar is a recorded daily activity estimate, not an hourly step count."
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
              <div className="home-lower-grid">
                <section className="home-panel home-devices">
                  <div className="home-panel-heading">
                    <h2>Connected at home</h2>
                    <span>
                      {devices.length} {devices.length === 1 ? "device" : "devices"}
                    </span>
                  </div>
                  {devices.length ? (
                    devices.map((device) => {
                      const parsed = deviceSchema.safeParse(device.data);
                      return (
                        <div className="home-device" key={device.id}>
                          <span className="home-device-icon" aria-hidden="true">
                            ⌚
                          </span>
                          <div>
                            <strong>{device.title}</strong>
                            <p>
                              {device.status} ·{" "}
                              {parsed.success
                                ? (parsed.data.quality ?? "No signal quality recorded")
                                : "No signal quality recorded"}
                            </p>
                          </div>
                          {parsed.success && parsed.data.battery !== undefined && (
                            <span className="home-battery">
                              {parsed.data.battery}%<small>battery</small>
                            </span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="home-muted">No device is registered for this resident.</p>
                  )}
                  {!activityWatch && (
                    <button
                      className="home-connect-device"
                      disabled={props.pending}
                      onClick={async () => {
                        setConnectionError("");
                        try {
                          await props.create(
                            "connect_device", props.selectedPatient, "Home activity watch",
                          );
                        } catch (error) {
                          setConnectionError(
                            error instanceof Error ? error.message : "Unable to connect the watch.",
                          );
                        }
                      }}
                    >
                      {props.pending ? "Connecting…" : "Connect simulated watch"}
                    </button>
                  )}
                  {connectionError && <p role="alert">{connectionError}</p>}
                  <p className="home-panel-note">
                    These are simulated devices. No physical device or external account is connected.
                  </p>
                </section>
                <section className="home-panel home-simulation">
                  <p className="home-eyebrow">Try it in your team’s world</p>
                  <h2>See a new reading arrive.</h2>
                  <p>
                    Connect a simulated watch for this resident. Its first activity reading arrives
                    after 10 simulated minutes, followed by a reading every hour. Use Simulation time
                    to advance the clock.
                  </p>
                  <p className="home-panel-note">
                    The operator can simulate a disconnected device. Missing readings stay missing.
                  </p>
                </section>
              </div>
            </div>
            <section className="home-records">
              <button
                className="home-records-toggle"
                aria-expanded={showReadings}
                onClick={() => setShowReadings(!showReadings)}
              >
                <span>
                  Recorded readings <small>{inPeriod.length} in this period</small>
                </span>
                <span>{showReadings ? "Hide −" : "Show +"}</span>
              </button>
              {showReadings && (
                <div className="home-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Recorded</th>
                        <th>Reading</th>
                        <th>Value</th>
                        <th>Quality</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inPeriod
                        .slice()
                        .reverse()
                        .map((reading) => (
                          <tr key={reading.id}>
                            <td>
                              {day(reading.at)} · {clock(reading.at)}
                            </td>
                            <td>{reading.title}</td>
                            <td>
                              {reading.value === null
                                ? "Not received"
                                : `${number(reading.value)} ${reading.unit}`}
                            </td>
                            <td>{reading.quality}</td>
                          </tr>
                        ))}
                      {!inPeriod.length && (
                        <tr>
                          <td colSpan={4}>No readings in this period.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
        <footer className="home-footnote">
          DAYLIGHT · A fictional home health experience for NHS-SIM. All residents and readings are
          synthetic.
        </footer>
      </main>
    </div>
  );
}
