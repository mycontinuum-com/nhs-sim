import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlanLabSnapshot } from "../../engine/src/plan-lab.ts";
import "./plan-lab.css";

const source =
  "https://www.gov.uk/government/publications/10-year-health-plan-for-england-fit-for-the-future/fit-for-the-future-10-year-health-plan-for-england-executive-summary";
type Props = {
  connected: boolean;
  api: <T>(path: string, data?: unknown) => Promise<T>;
  join: () => void;
};
export function PlanLab({ connected, api, join }: Props) {
  const [selected, setSelected] = useState("discharge");
  const [feedback, setFeedback] = useState("");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["plan-lab"],
    queryFn: () => api<PlanLabSnapshot>("/api/plan-lab"),
    enabled: connected,
    refetchInterval: 3000,
  });
  const action = useMutation({
    mutationFn: (input: unknown) => api<PlanLabSnapshot>("/api/plan-lab", input),
    onSuccess: (snapshot) => {
      client.setQueryData(["plan-lab"], snapshot);
      client.invalidateQueries();
      setFeedback("Your team's records have been updated. Check the evidence below.");
    },
    onError: (error) => setFeedback(error.message),
  });
  const challenge = query.data?.challenges.find((item) => item.id === selected);
  return (
    <main className="plan-lab">
      <header className="plan-intro">
        <a href="/control/">← Back to the neighbourhood</a>
        <p className="plan-kicker">THE TEN-YEAR PLAN · A PRACTICAL LAB</p>
        <h1>Three shifts. Real coordination problems.</h1>
        <p>
          Try a decision, see who it reaches, and inspect the record in the receiving service. Your
          team can use the same actions through the API.
        </p>
        <div className="plan-source">
          <a href={source} target="_blank" rel="noreferrer">
            Read the plan for England ↗
          </a>
          <span>Fictional scenarios. Operational outcomes, not clinical forecasts.</span>
        </div>
      </header>
      {!connected ? (
        <section className="plan-join">
          <h2>Explore with your team</h2>
          <p>
            Each challenge adds a small set of records to your isolated world. Your existing patient
            work stays available.
          </p>
          <button className="primary" onClick={join}>
            Create or connect a team
          </button>
        </section>
      ) : query.error ? (
        <section className="plan-join" role="alert">
          <h2>Challenge access unavailable</h2>
          <p>{query.error.message}</p>
          <p>These cross-service exercises need a full team key.</p>
          <button onClick={join}>Team access</button>
        </section>
      ) : !query.data ? (
        <p role="status">Opening your challenge workbook…</p>
      ) : (
        <>
          <nav className="plan-choices" aria-label="Choose a shift">
            {query.data.challenges.map((item, index) => (
              <button
                key={item.id}
                aria-pressed={selected === item.id}
                onClick={() => {
                  setSelected(item.id);
                  setFeedback("");
                }}
              >
                <span>0{index + 1}</span>
                <small>{item.shift}</small>
                <strong>{item.title}</strong>
                <em>
                  {item.started
                    ? `${item.steps.filter((step) => step.done).length} / ${item.steps.length} checks met`
                    : "Ready to explore"}
                </em>
              </button>
            ))}
          </nav>
          {challenge && (
            <section className="plan-workbook" aria-label={challenge.title}>
              <div className="plan-brief">
                <p className="plan-kicker">{challenge.shift}</p>
                <h2>{challenge.title}</h2>
                <p>{challenge.summary}</p>
                <div className="plan-workplaces">
                  {challenge.links.map((link) => (
                    <a key={link.href} href={link.href}>
                      {link.label} ↗
                    </a>
                  ))}
                </div>
              </div>
              <div className="plan-metrics">
                {challenge.metrics.map((metric) => (
                  <div key={metric.label}>
                    <strong>{metric.value}</strong>
                    <span>{metric.label}</span>
                  </div>
                ))}
              </div>
              <div className="plan-columns">
                <section>
                  <h3>Try an action</h3>
                  <p className="plan-help">
                    Actions affect this team's simulated records. A blocked step explains what is
                    still missing.
                  </p>
                  <div className="plan-actions">
                    {challenge.actions.map((item) => (
                      <div key={JSON.stringify(item.input)}>
                        <button
                          disabled={action.isPending || item.disabled}
                          onClick={() => {
                            setFeedback("");
                            action.mutate(item.input);
                          }}
                        >
                          {item.label}
                        </button>
                        {item.reason && <small>{item.reason}</small>}
                      </div>
                    ))}
                  </div>
                  <p className="plan-feedback" role="status">
                    {action.isPending ? "Updating the shared records…" : feedback}
                  </p>
                </section>
                <section className="plan-checks">
                  <h3>What changed?</h3>
                  <ol>
                    {challenge.steps.map((step) => (
                      <li key={step.label} className={step.done ? "is-done" : ""}>
                        <span aria-label={step.done ? "Met" : "Not yet met"}>
                          {step.done ? "✓" : "○"}
                        </span>
                        <div>
                          <strong>{step.label}</strong>
                          <p>{step.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
              <details className="plan-evidence">
                <summary>Decision trail · {challenge.events.length} events</summary>
                {challenge.events.length ? (
                  <ol>
                    {challenge.events
                      .slice()
                      .reverse()
                      .map((event, index) => (
                        <li key={`${event.time}-${index}`}>
                          <time>
                            {new Date(event.time).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "UTC",
                            })}
                          </time>
                          {event.detail}
                        </li>
                      ))}
                  </ol>
                ) : (
                  <p>Start this challenge to record the first decision.</p>
                )}
              </details>
              <details className="plan-evidence">
                <summary>Build with the challenge API</summary>
                <p>
                  Use your team bearer key with <code>GET /api/plan-lab</code>. Each action below is
                  a complete JSON body for <code>POST /api/plan-lab</code>.
                </p>
                <pre>
                  {JSON.stringify(
                    challenge.actions.map((item) => item.input),
                    null,
                    2,
                  )}
                </pre>
                <a href="/docs/ten-year-plan/">Challenge guide and model limits ↗</a>
              </details>
            </section>
          )}
        </>
      )}
      <footer className="plan-note">
        These exercises explore selected implementation tensions in the 2025 plan. They do not
        represent the whole plan, national delivery progress or clinical eligibility rules.
      </footer>
    </main>
  );
}
