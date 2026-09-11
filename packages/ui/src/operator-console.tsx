import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { scenarios, type SimEvent } from "../../contracts/src/index.ts";
import type {
  OperatorTeams,
  OperatorActivity,
  OperatorSession,
} from "../../contracts/src/operator.ts";
import "./operator-console.css";

type Api = <T>(path: string, data?: unknown, credential?: string) => Promise<T>;
type OperatorWorld = {
  now: number;
  paused: boolean;
  speed: number;
  faults?: Record<string, boolean>;
  agents?: { id: string; enabled: boolean }[];
  events: SimEvent[];
};
const sessionFields = ["sim-key", "sim-team", "sim-world"];
const backupSchema = z.array(
  z.tuple([z.enum(["sim-key", "sim-team", "sim-world"]), z.string().nullable()]),
);
function explore(session: OperatorSession, path: string) {
  if (!localStorage.getItem("sim-operator-backup")) {
    localStorage.setItem(
      "sim-operator-backup",
      JSON.stringify(sessionFields.map((name) => [name, localStorage.getItem(name)])),
    );
  }
  localStorage.setItem("sim-team", session.teamName);
  localStorage.setItem("sim-world", session.world);
  localStorage.setItem("sim-operator-viewing", session.teamName);
  localStorage.setItem("sim-key", session.apiKey);
  sessionStorage.removeItem("sim-tour-world");
  location.assign(path);
}
export function OperatorViewingBanner() {
  const bannerRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(() => localStorage.getItem("sim-operator-viewing"));
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === "sim-operator-viewing") setName(event.newValue);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useLayoutEffect(() => {
    const banner = bannerRef.current;
    const parent = banner?.parentElement;
    if (!banner || !parent) return;
    const measure = () =>
      parent.style.setProperty(
        "--operator-banner-height",
        `${banner.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(banner);
    return () => {
      observer.disconnect();
      parent.style.removeProperty("--operator-banner-height");
    };
  }, [name]);
  if (!name) return null;
  function restore() {
    const raw = localStorage.getItem("sim-operator-backup");
    let backup: z.infer<typeof backupSchema> = [];
    try {
      const saved = backupSchema.safeParse(raw ? JSON.parse(raw) : null);
      if (saved.success) backup = saved.data;
    } catch {
      /* A corrupt backup must never leave a team session impersonated. */
    }
    localStorage.removeItem("sim-operator-backup");
    localStorage.removeItem("sim-operator-viewing");
    for (const field of sessionFields.filter((name) => name !== "sim-key")) {
      const value = backup.find(([name]) => name === field)?.[1];
      if (value) localStorage.setItem(field, value);
      else localStorage.removeItem(field);
    }
    const originalKey = backup.find(([name]) => name === "sim-key")?.[1];
    if (originalKey) localStorage.setItem("sim-key", originalKey);
    else localStorage.removeItem("sim-key");
    location.assign("/control/?operator=1");
  }
  return (
    <aside ref={bannerRef} className="operator-viewing">
      <span>
        Organiser viewing <strong>{name}</strong> · Changes affect this team's world
      </span>
      <button onClick={restore}>Return to organiser</button>
    </aside>
  );
}
function when(value: string | number | null) {
  return value === null
    ? "No requests yet"
    : new Date(value).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
}
export function OperatorConsole({ api }: { api: Api }) {
  const [token, setToken] = useState(() => sessionStorage.getItem("sim-operator-token") ?? "");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [world, setWorld] = useState(() => sessionStorage.getItem("sim-operator-world") ?? "");
  const [tab, setTab] = useState<"requests" | "patients" | "changes" | "controls">("requests");
  const [message, setMessage] = useState("");
  const teams = useQuery({
    queryKey: ["operator-teams", token],
    enabled: !!token,
    queryFn: () => api<OperatorTeams>("/api/control/teams", undefined, token),
    refetchInterval: 10000,
  });
  const selected = teams.data?.teams.find((team) => team.world === world);
  const activity = useQuery({
    queryKey: ["operator-activity", token, world],
    enabled: !!token && !!selected,
    queryFn: () =>
      api<OperatorActivity>(
        `/api/control/teams/${encodeURIComponent(world)}/activity`,
        undefined,
        token,
      ),
    refetchInterval: 5000,
  });
  const state = useQuery({
    queryKey: ["operator-world", token, world],
    enabled: !!token && !!selected && tab === "controls",
    queryFn: () =>
      api<OperatorWorld>(
        `/api/sites/control/view?world=${encodeURIComponent(world)}&limit=1`,
        undefined,
        token,
      ),
    refetchInterval: 5000,
  });
  const login = useMutation({
    mutationFn: async () => {
      const candidate = input
        .trim()
        .replace(/^Bearer\s+/i, "")
        .trim();
      if (!candidate) throw new Error("Enter the operator token for this server.");
      await api<OperatorTeams>("/api/control/teams", undefined, candidate);
      return candidate;
    },
    onSuccess: (value) => {
      sessionStorage.setItem("sim-operator-token", value);
      setToken(value);
      setInput("");
      if (value === token) void teams.refetch();
    },
  });
  const enter = useMutation({
    mutationFn: async (path: string) => {
      const session = await api<OperatorSession>(
        `/api/control/teams/${encodeURIComponent(world)}/session`,
        {},
        token,
      );
      return { session, path };
    },
    onSuccess: ({ session, path }) => explore(session, path),
  });
  const change = useMutation({
    mutationFn: ({ path, data }: { path: string; data: unknown }) =>
      api(path + "?world=" + encodeURIComponent(world), data, token),
    onSuccess: () => {
      setMessage("Updated " + selected?.teamName + ".");
      void state.refetch();
      void activity.refetch();
    },
    onError: () => setMessage(""),
  });
  const refresh = () => {
    void teams.refetch();
    if (selected) {
      void activity.refetch();
      if (tab === "controls") void state.refetch();
    }
  };
  const disconnect = () => {
    sessionStorage.removeItem("sim-operator-token");
    setToken("");
    setInput("");
  };
  if (!token || teams.error)
    return (
      <div className="operator-login">
        <p className="operator-eyebrow">For hackathon organisers</p>
        <h2>Organiser controls</h2>
        <p>
          Connect once to see every team, inspect API calls and record changes, and explore their
          world.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            login.mutate();
          }}
        >
          <label>
            Operator token
            <input
              type="password"
              autoComplete="off"
              required
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste this server's operator token"
            />
          </label>
          <button className="primary" disabled={login.isPending}>
            {login.isPending ? "Checking token…" : "Connect organiser"}
          </button>
        </form>
        {(login.error || teams.error) && (
          <p role="alert">
            Could not connect. {(login.error ?? teams.error)?.message} Use this server's operator
            token, not a team API key.
          </p>
        )}
        <p>
          The operator token stays in this tab's session. Your team connection remains separate.
        </p>
      </div>
    );
  return (
    <div className="operator-console">
      <header className="operator-heading">
        <div>
          <p className="operator-eyebrow">Organiser controls</p>
          <h2>Teams & activity</h2>
        </div>
        <div className="operator-actions">
          <button onClick={refresh} disabled={teams.isFetching || activity.isFetching}>
            Refresh
          </button>
          <a href="/cis2/?operator=1">CIS2 controls ↗</a>
          <button onClick={disconnect}>Disconnect organiser</button>
        </div>
      </header>
      <div className="operator-layout">
        <aside className="operator-team-list">
          <label>
            Find a team
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Team name"
            />
          </label>
          <p>{teams.data?.teams.length ?? 0} teams · updates automatically</p>
          {teams.isPending && <p role="status">Loading teams…</p>}
          {teams.data?.teams.length === 0 && <p>No teams have joined yet.</p>}
          {teams.data &&
            teams.data.teams.length > 0 &&
            !teams.data.teams.some((team) =>
              team.teamName.toLowerCase().includes(search.toLowerCase().replace(/\s/g, "")),
            ) && <p>No matching teams.</p>}
          {teams.data?.teams
            .filter((team) =>
              team.teamName.toLowerCase().includes(search.toLowerCase().replace(/\s/g, "")),
            )
            .map((team) => (
              <button
                key={team.world}
                className={team.world === world ? "selected" : ""}
                onClick={() => {
                  setWorld(team.world);
                  sessionStorage.setItem("sim-operator-world", team.world);
                  setMessage("");
                  change.reset();
                  enter.reset();
                }}
              >
                <strong>{team.teamName}</strong>
                {teams.data &&
                  teams.data.teams.filter((candidate) => candidate.teamName === team.teamName)
                    .length > 1 && <small>World {team.world}</small>}
                <span>
                  {team.requestCount} API calls · {team.affectedPatientCount} patients affected
                </span>
                <small>{when(team.lastRequestAt)}</small>
              </button>
            ))}
        </aside>
        <main className="operator-detail">
          {!selected ? (
            <div className="operator-empty">
              <h3>Select a team</h3>
              <p>
                Choose whose requests and patient records to inspect. Controls always target the
                selected team.
              </p>
            </div>
          ) : (
            <>
              <div className="operator-team-heading">
                <div>
                  <p className="operator-eyebrow">Selected team</p>
                  <h3>{selected.teamName}</h3>
                  <small>
                    {selected.patientCount} patients · {selected.scopes.join(", ")}
                  </small>
                </div>
                <button
                  className="primary"
                  disabled={enter.isPending}
                  onClick={() => enter.mutate("/control/")}
                >
                  {enter.isPending ? "Opening…" : "Explore as this team"}
                </button>
              </div>
              <p className="operator-context">
                Exploring uses this team's API permissions. Any edits you make affect its world.
                This switches the team connection in all tabs of this browser. A return button
                restores your previous connection.
              </p>
              {enter.error && <p role="alert">{enter.error.message}</p>}
              <nav className="operator-tabs" aria-label="Team activity">
                {(
                  [
                    ["requests", "API calls"],
                    ["patients", "Affected patients"],
                    ["changes", "Record changes"],
                    ["controls", "World controls"],
                  ] as const
                ).map(([value, label]) => (
                  <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>
                    {label}
                  </button>
                ))}
              </nav>
              {activity.isPending && <p role="status">Loading team activity…</p>}
              {activity.error && (
                <p role="alert">
                  {activity.error.message}{" "}
                  <button onClick={() => void activity.refetch()}>Retry</button>
                </p>
              )}
              {tab === "requests" && activity.data && (
                <>
                  <p className="operator-context">
                    Latest recorded calls. Request bodies and credentials are never shown. History
                    starts {when(activity.data.logging.since)}; retained for{" "}
                    {activity.data.logging.retentionDays} days, up to{" "}
                    {activity.data.logging.maxRequestsPerWorld.toLocaleString()} calls per world.
                  </p>
                  {activity.data.requests.length === 0 ? (
                    <p>
                      No API calls recorded yet. Open this team's workspace or make an API request
                      to start the trail.
                    </p>
                  ) : (
                    <div className="operator-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Request</th>
                            <th>Status</th>
                            <th>Duration</th>
                            <th>Patients</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activity.data.requests.map((request) => (
                            <tr key={request.id}>
                              <td>{when(request.time)}</td>
                              <td>
                                <strong>{request.method}</strong> <code>{request.path}</code>
                              </td>
                              <td className={request.status >= 400 ? "operator-error" : ""}>
                                {request.status}
                              </td>
                              <td>{request.durationMs.toFixed(0)} ms</td>
                              <td>{request.patientIds.join(", ") || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
              {tab === "patients" && activity.data && (
                <>
                  {activity.data.patients.length === 0 && (
                    <p>No patients changed by this team yet.</p>
                  )}
                  {activity.data.patients.map((patient) => (
                    <article className="operator-patient" key={patient.id}>
                      <div>
                        <strong>{patient.name}</strong>
                        <small>
                          {patient.id} · {patient.changeCount} changes ·{" "}
                          {when(patient.lastChangedAt)}
                        </small>
                      </div>
                      <div className="operator-actions">
                        {["gp", "hospital", "pharmacy", "community", "wearables"]
                          .filter((site) => selected.scopes.includes(site))
                          .map((site) => (
                            <button
                              disabled={enter.isPending}
                              key={site}
                              onClick={() =>
                                enter.mutate(`/${site}/?patient=${encodeURIComponent(patient.id)}`)
                              }
                            >
                              {site === "gp"
                                ? "GP"
                                : site === "wearables"
                                  ? "Home"
                                  : site[0].toUpperCase() + site.slice(1)}
                            </button>
                          ))}
                      </div>
                    </article>
                  ))}
                </>
              )}
              {tab === "changes" && activity.data && (
                <>
                  {activity.data.changes.length === 0 && <p>No attributed changes recorded yet.</p>}
                  {activity.data.changes.map((item, index) => (
                    <article
                      className="operator-change"
                      key={item.resourceId + "-" + item.version + "-" + index}
                    >
                      <strong>{item.title}</strong>
                      <p>
                        {item.action} · {item.kind} · {item.patientId ?? "World record"}
                      </p>
                      <small>
                        {item.actor.name} ({item.actor.kind}) · {item.source} · {when(item.time)} ·
                        version {item.version}
                      </small>
                    </article>
                  ))}
                </>
              )}
              {tab === "controls" && (
                <>
                  {state.isPending && <p role="status">Loading world controls…</p>}
                  {state.error && <p role="alert">{state.error.message}</p>}
                  {state.data && (
                    <>
                      <div className="operator-clock">
                        <h4>Simulation time</h4>
                        <p>
                          {when(state.data.now)} ·{" "}
                          {state.data.paused ? "Paused" : `Running at ${state.data.speed}×`}
                        </p>
                        <div className="operator-actions">
                          <button
                            disabled={change.isPending}
                            onClick={() =>
                              change.mutate({
                                path: "/api/clock",
                                data: { paused: !state.data?.paused },
                              })
                            }
                          >
                            {state.data.paused ? "Run" : "Pause"}
                          </button>
                          {[15, 60, 1440].map((minutes) => (
                            <button
                              disabled={change.isPending}
                              key={minutes}
                              onClick={() =>
                                change.mutate({
                                  path: "/api/clock",
                                  data: { paused: true, advanceMinutes: minutes },
                                })
                              }
                            >
                              {minutes === 1440 ? "+1 day" : `+${minutes} minutes`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <h4>Incidents affecting {selected.teamName}</h4>
                      <div className="operator-incidents">
                        {scenarios.map((scenario) => (
                          <label className="toggle" key={scenario.id}>
                            <input
                              type="checkbox"
                              disabled={change.isPending}
                              checked={!!state.data?.faults?.[scenario.id]}
                              onChange={(event) =>
                                change.mutate({
                                  path: "/api/control/incidents",
                                  data: { id: scenario.id, enabled: event.target.checked },
                                })
                              }
                            />
                            <span>
                              <strong>{scenario.title}</strong>
                              <small>{scenario.description}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                      <h4>Scripted world agents</h4>
                      <p>Background simulation processes run as the clock advances.</p>
                      <div className="operator-incidents">
                        {state.data.agents?.map((agent) => (
                          <label className="toggle" key={agent.id}>
                            <input
                              type="checkbox"
                              disabled={change.isPending}
                              checked={agent.enabled}
                              onChange={(event) =>
                                change.mutate({
                                  path: "/api/control/agents",
                                  data: { id: agent.id, enabled: event.target.checked },
                                })
                              }
                            />
                            {agent.id.replace(/-/g, " ")}
                          </label>
                        ))}
                      </div>
                      <h4>Recent world activity</h4>
                      {state.data.events.length === 0 && <p>No activity yet.</p>}
                      {state.data.events.slice(0, 20).map((event) => (
                        <p key={event.id}>
                          {when(event.time)} · {event.actor} · {event.detail}
                        </p>
                      ))}
                    </>
                  )}
                  {change.error && <p role="alert">{change.error.message}</p>}
                  <p role="status">{change.isPending ? "Updating selected world…" : message}</p>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
