import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  sites,
  scenarios,
  type SiteId,
  type Resource,
  type Patient,
  type Action,
  type SimEvent,
} from "../../contracts/src/index.ts";
import { SystemWorkspace } from "./systems.tsx";
import { CareWorkspace } from "./care-workspaces.tsx";
import { HomeWorkspace } from "./home-workspace.tsx";
import { PlanLab } from "./plan-lab.tsx";
import "./care-workspaces.css";
import "./home-workspace.css";
import "./style.css";
import "./systems.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
type View = {
  id: string;
  now: number;
  speed: number;
  paused: boolean;
  population: number;
  resources: Resource[];
  events: SimEvent[];
  resourceTotal: number;
  staffing: { doctors: number; nurses: number; staffedSpaces: number; waiting: number };
  agents?: { id: string; enabled: boolean }[];
  faults?: Record<string, boolean>;
};
const places = [
  {
    id: "practice",
    title: "Riverside Practice",
    label: "Primary care",
    description: "Open the clinical journal, review results and arrange follow-up in SystemTwo.",
    href: "/gp/",
    x: 23,
    y: 44,
    system: "SystemTwo",
  },
  {
    id: "hospital",
    title: "Northbank General",
    label: "Secondary care",
    description: "Work the ward list and coordinate discharge in Millbank EPR.",
    href: "/hospital/",
    x: 75,
    y: 39,
    system: "Millbank EPR",
  },
  {
    id: "community",
    title: "Neighbourhood Care",
    label: "Community",
    description: "Arrange home visits and follow the handover from hospital to home.",
    href: "/community/",
    x: 49,
    y: 64,
    system: "Neighbourhood Care",
  },
  {
    id: "pharmacy",
    title: "High Street Pharmacy",
    label: "Pharmacy",
    description:
      "Review, approve and dispense a synthetic prescription as part of the shared care journey.",
    href: "/pharmacy/",
    x: 37,
    y: 79,
    system: "Dispensary",
  },
  {
    id: "home",
    title: "Eleanor’s home",
    label: "At home",
    description:
      "Explore a week of synthetic activity, sleep and heart-rate readings. Advance time to receive the next watch reading.",
    href: "/wearables/?patient=SIM-000006",
    x: 17,
    y: 73,
    system: "At home",
  },
  {
    id: "identity",
    title: "Staff identity",
    label: "CIS2 emulator",
    description:
      "Choose a fictional staff identity and explore sign-in, role selection and controlled failure scenarios.",
    href: "/cis2/",
    x: 79,
    y: 69,
    system: "Care identity",
  },
];
export function mount(siteId: SiteId) {
  document.title = (sites.find((site) => site.id === siteId)?.name ?? "NHS-SIM") + " | NHS-SIM";
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={client}>
      <WorldApp siteId={siteId} />
    </QueryClientProvider>,
  );
}
function WorldApp({ siteId }: { siteId: SiteId }) {
  const [key, setKey] = useState(() => sessionStorage.getItem("sim-key") ?? "");
  const [patient, setPatient] = useState(
    () => new URLSearchParams(location.search).get("patient") ?? "",
  );
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState("");
  const [drawer, setDrawer] = useState<"team" | "simulation" | "operator" | null>(null);
  const [destination, setDestination] = useState("/gp/");
  const [team, setTeam] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [world, setWorld] = useState("default");
  const [operatorToken, setOperatorToken] = useState("");
  const [place, setPlace] = useState<string | null>(null);
  const isMap = siteId === "control";
  const isPlan = isMap && new URLSearchParams(location.search).has("challenges");
  const Workspace =
    siteId === "pharmacy" || siteId === "community"
      ? CareWorkspace
      : siteId === "wearables"
        ? HomeWorkspace
        : SystemWorkspace;
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button, input")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(null);
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), a[href], summary, select, textarea",
        ),
      ).filter((item) => item.getClientRects().length > 0);
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [drawer]);
  async function api<T>(path: string, data?: unknown, credential = key): Promise<T> {
    const response = await fetch(path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(credential ? { Authorization: "Bearer " + credential } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? result.error ?? "Request failed");
    return result;
  }
  function saveKey(value: string) {
    sessionStorage.setItem("sim-key", value);
    setKey(value);
    client.clear();
  }
  function enter(href: string) {
    if (key || href === "/cis2/") location.assign(href);
    else {
      setDestination(href);
      setDrawer("team");
    }
  }
  const view = useQuery({
    queryKey: ["view", siteId, key, patient, offset],
    placeholderData: (previous) => previous,
    queryFn: () =>
      api<View>(
        `/api/sites/${isMap ? "gp" : siteId}/view?${patient ? "patient=" + encodeURIComponent(patient) : "limit=200&offset=" + offset}`,
      ),
    enabled: !!key,
    refetchInterval: 3000,
  });
  const patients = useQuery({
    queryKey: ["patients", key, search],
    queryFn: () =>
      api<{ items: Patient[]; total: number }>(
        `/api/sites/${isMap ? "gp" : siteId}/patients?q=` + encodeURIComponent(search),
      ),
    enabled: !!key && !isMap,
  });
  const selectedPatient = useQuery({
    queryKey: ["selected-patient", key, patient],
    queryFn: () =>
      api<{ items: Patient[]; total: number }>(
        `/api/sites/${isMap ? "gp" : siteId}/patients?q=` + encodeURIComponent(patient),
      ),
    enabled: !!key && !!patient && !isMap,
  });
  const overview = useQuery({
    queryKey: ["hospital-overview", key, offset],
    queryFn: () => api<View>("/api/sites/hospital/view?limit=200&offset=" + offset),
    enabled: !!key && siteId === "hospital" && !!patient,
    refetchInterval: 3000,
  });
  const staff = useQuery({
    queryKey: ["staff-identity"],
    queryFn: () =>
      api<{ identity: null | { name: string; role: string; organisation: string } }>(
        "/cis2/session",
      ),
    refetchInterval: 5000,
  });
  const handovers = useQuery({
    queryKey: ["handovers", key, patient],
    queryFn: async () => {
      const result = await Promise.allSettled(
        (["community", "pharmacy", "diagnostics"] as const).map(async (service) => ({
          service,
          view: await api<View>(
            `/api/sites/${service}/view?patient=${encodeURIComponent(patient)}`,
          ),
        })),
      );
      return {
        resources: result.flatMap((item) =>
          item.status === "fulfilled" ? item.value.view.resources : [],
        ),
        unavailable: result.flatMap((item, index) =>
          item.status === "rejected" ? [["community", "pharmacy", "diagnostics"][index]] : [],
        ),
      };
    },
    enabled: !!key && !!patient && !isMap,
    refetchInterval: 3000,
  });
  const operatorView = useQuery({
    queryKey: ["operator", operatorToken, world],
    queryFn: () =>
      api<View>(
        "/api/sites/control/view?world=" + encodeURIComponent(world) + "&limit=1",
        undefined,
        operatorToken,
      ),
    enabled: drawer === "operator" && !!operatorToken,
    refetchInterval: 3000,
  });
  const mutation = useMutation({
    mutationFn: ({
      path,
      data,
      credential,
    }: {
      path: string;
      data: unknown;
      credential?: string;
    }) => api(path, data, credential),
    onSuccess: () => {
      client.invalidateQueries();
      setNotice("Saved to your team world.");
    },
    onError: (error) => setNotice(error.message),
  });
  const issue = useMutation({
    mutationFn: () => api<{ apiKey: string; world: string }>("/api/keys", { teamName: team }),
    onSuccess: (result) => {
      saveKey(result.apiKey);
      location.assign(destination);
    },
    onError: (error) => setNotice(error.message),
  });
  const act = (type: Action["type"], resource: Resource, target?: SiteId) => {
    const embedded = handovers.data?.resources.some((item) => item.id === resource.id);
    const actor =
      embedded && ["community", "pharmacy", "diagnostics"].includes(resource.owner)
        ? resource.owner
        : siteId;
    mutation.mutate({
      path: `/api/sites/${actor}/actions`,
      data: { type, resourceId: resource.id, expectedVersion: resource.version, target },
    });
  };
  const create = (type: Action["type"], patientId: string, title: string, target?: SiteId) =>
    mutation.mutateAsync({
      path: `/api/sites/${type === "create_task" ? (target ?? siteId) : siteId}/actions`,
      data: { type, patientId, title, target },
    });
  const selectPatient = (id: string) => {
    setPatient(id);
    setOffset(0);
  };
  const selectedPlace = places.find((item) => item.id === place);
  const error = view.error?.message || patients.error?.message;
  return (
    <div className={isMap ? "world-app" : "immersive-app"}>
      {isMap ? (
        <>
          <header className="world-header">
            <a href="/control/" className="world-brand">
              NHS-SIM <span>Riverside & Northbank</span>
            </a>
            <nav aria-label="World tools">
              <a href="/control/?challenges=1">Plan challenges</a>
              <a href="/docs/">Handbook</a>
              <button onClick={() => setDrawer("operator")}>Operator</button>
              <button onClick={() => setDrawer("team")}>
                {key ? "Your team" : "Join the world"}
              </button>
            </nav>
          </header>
          {isPlan ? (
            <PlanLab
              connected={!!key}
              api={api}
              join={() => {
                setDestination("/control/?challenges=1");
                setDrawer("team");
              }}
            />
          ) : (
            <main className="world-map" aria-label="Interactive neighbourhood map">
              <div className="map-intro">
                <span>A SYNTHETIC HEALTH NEIGHBOURHOOD</span>
                <h1>Where would you like to work?</h1>
                <p>
                  Choose a building to enter its system.
                  <span className="map-mobile-hint"> Swipe the map or open Places below.</span>
                </p>
              </div>
              <div className="map-landscape">
                <img
                  src="/control/world/neighbourhood-v2.png"
                  alt="Illustrated English neighbourhood with Riverside GP practice to the west, Northbank hospital to the east, a community centre and high street pharmacy beside the river"
                />
                {places.map((item) => (
                  <button
                    key={item.id}
                    className={"map-place" + (item.id === place ? " selected" : "")}
                    style={{ left: item.x + "%", top: item.y + "%" }}
                    onClick={() => setPlace(item.id)}
                    aria-label={`Explore ${item.title}`}
                    aria-expanded={item.id === place}
                  >
                    <span className="map-pin" />
                    <span className="map-label">
                      <small>{item.label}</small>
                      {item.title}
                    </span>
                  </button>
                ))}
              </div>
              {selectedPlace && (
                <section className="place-detail" aria-label={selectedPlace.title}>
                  <button
                    className="close"
                    onClick={() => setPlace(null)}
                    aria-label="Close place details"
                  >
                    ×
                  </button>
                  <span>{selectedPlace.label}</span>
                  <h2>{selectedPlace.title}</h2>
                  <p>{selectedPlace.description}</p>
                  <button className="primary" onClick={() => enter(selectedPlace.href)}>
                    Enter {selectedPlace.system}
                  </button>
                </section>
              )}
              <footer className="map-footer">
                <span>Fictional people. Shared records. Consequences over time.</span>
                <details>
                  <summary>Places</summary>
                  <nav aria-label="Accessible place directory">
                    {places.map((item) => (
                      <button key={item.id} onClick={() => enter(item.href)}>
                        {item.title}
                        <small>{item.system}</small>
                      </button>
                    ))}
                  </nav>
                </details>
              </footer>
            </main>
          )}
        </>
      ) : (
        <>
          {!key ? (
            <main className="access-gate">
              <a href="/control/">Back to neighbourhood</a>
              <h1>{sites.find((s) => s.id === siteId)?.name}</h1>
              <p>Join a team world to open this workspace.</p>
              <button
                className="primary"
                onClick={() => {
                  setDestination(location.pathname + location.search);
                  setDrawer("team");
                }}
              >
                Create or connect your team
              </button>
            </main>
          ) : view.data ? (
            <Workspace
              siteId={siteId}
              view={view.data}
              rows={[
                ...view.data.resources,
                ...(overview.data?.resources ?? []).filter(
                  (r) => !view.data?.resources.some((item) => item.id === r.id),
                ),
              ]}
              identityLabel={
                staff.data?.identity
                  ? staff.data.identity.name + " · " + staff.data.identity.role
                  : undefined
              }
              handoverRows={handovers.data?.resources ?? []}
              patients={[
                ...(patients.data?.items ?? []),
                ...(selectedPatient.data?.items ?? []).filter(
                  (p) => !patients.data?.items.some((item) => item.id === p.id),
                ),
              ]}
              selectedPatient={patient}
              patientSearch={search}
              searchPatients={(value) => {
                setPatient("");
                setSearch(value);
                setOffset(0);
              }}
              selectPatient={selectPatient}
              act={act}
              create={create}
              api={api}
              pending={mutation.isPending}
              exitToMap={() => location.assign("/control/")}
            />
          ) : view.error ? (
            <main className="access-gate">
              <h1>Unable to open this workspace</h1>
              <p>{view.error.message}</p>
              <p>
                An older or service-specific key may not include this workspace. Connect a full team
                key or create a new team.
              </p>
              <button
                onClick={() => {
                  saveKey("");
                  setDestination(location.pathname + location.search);
                  setDrawer("team");
                }}
              >
                Connect another team
              </button>
              <a href="/control/">Back to neighbourhood</a>
            </main>
          ) : (
            <p className="loading">Opening the patient record…</p>
          )}
          <footer className="workspace-status">
            <a href="/control/?challenges=1">Plan challenges</a>
            <a href="/control/">Neighbourhood</a>
            <span>
              {view.data
                ? new Date(view.data.now).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"
                : "Synthetic workspace"}
            </span>
            <button onClick={() => setDrawer("simulation")}>
              {view.data?.paused ? "Paused" : "Running"} · Simulation controls
            </button>
            <button onClick={() => setDrawer("team")}>Team & API key</button>
            <a href="/docs/">Handbook</a>
            <span className="synthetic-label">SIMULATION</span>
          </footer>
          {!patient && view.data && view.data.resourceTotal > 200 && (
            <div className="resource-pager">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 200))}>
                Previous records
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 200, view.data.resourceTotal)} of{" "}
                {view.data.resourceTotal}
              </span>
              <button
                disabled={offset + 200 >= view.data.resourceTotal}
                onClick={() => setOffset(offset + 200)}
              >
                Next records
              </button>
            </div>
          )}
          {handovers.data?.unavailable.length ? (
            <p className="status-message">
              Unavailable coordination services: {handovers.data.unavailable.join(", ")}
            </p>
          ) : null}
        </>
      )}
      {(notice || error) && (
        <div className="status-message" role="status">
          {notice || error}
          <button onClick={() => setNotice("")} aria-label="Dismiss status">
            ×
          </button>
        </div>
      )}
      {drawer && (
        <div className="dialog-scrim" onClick={() => setDrawer(null)}>
          <section
            ref={dialogRef}
            className="world-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={drawer + " controls"}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="close" onClick={() => setDrawer(null)} aria-label="Close controls">
              ×
            </button>
            {drawer === "team" && (
              <>
                <span className="eyebrow">YOUR TEAM WORLD</span>
                <h2>{key ? "Team access" : "Start exploring"}</h2>
                {key ? (
                  <>
                    <p>Your key connects the portals and your agent to the same isolated world.</p>
                    <details>
                      <summary>Reveal API key</summary>
                      <code className="api-key">{key}</code>
                    </details>
                    <button
                      onClick={() => {
                        saveKey("");
                        setDrawer(null);
                      }}
                    >
                      Disconnect this browser
                    </button>
                  </>
                ) : (
                  <>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        issue.mutate();
                      }}
                    >
                      <label>
                        Team name
                        <input
                          autoFocus
                          required
                          minLength={2}
                          maxLength={80}
                          value={team}
                          onChange={(event) => setTeam(event.target.value)}
                        />
                      </label>
                      <button className="primary" disabled={issue.isPending}>
                        Create team and enter
                      </button>
                    </form>
                    <details>
                      <summary>Use an existing team key</summary>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveKey(keyInput);
                          location.assign(destination);
                        }}
                      >
                        <label>
                          API key
                          <input
                            required
                            type="password"
                            value={keyInput}
                            onChange={(event) => setKeyInput(event.target.value)}
                          />
                        </label>
                        <button>Connect</button>
                      </form>
                    </details>
                  </>
                )}
              </>
            )}
            {drawer === "simulation" && (
              <>
                <h2>Simulation time</h2>
                <p>Advance this team's world to see delayed results, deliveries and home visits.</p>
                <div className="control-row">
                  <button
                    onClick={() =>
                      mutation.mutate({ path: "/api/clock", data: { paused: !view.data?.paused } })
                    }
                  >
                    {view.data?.paused ? "Run" : "Pause"}
                  </button>
                  {[15, 60, 121].map((minutes) => (
                    <button
                      key={minutes}
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({ path: "/api/clock", data: { advanceMinutes: minutes } })
                      }
                    >
                      +{minutes} minutes
                    </button>
                  ))}
                </div>
                <details>
                  <summary>Activity trail</summary>
                  {view.data?.events.slice(0, 20).map((event) => (
                    <p key={event.id}>
                      {new Date(event.time).toISOString().slice(11, 16)} · {event.detail}
                    </p>
                  ))}
                </details>
              </>
            )}
            {drawer === "operator" && (
              <>
                <h2>World operator</h2>
                <p>
                  Use the operator token to control world incidents and agents. Team keys do not
                  grant operator access.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setOperatorToken(keyInput);
                  }}
                >
                  <label>
                    Operator token
                    <input
                      required
                      type="password"
                      value={keyInput}
                      onChange={(event) => setKeyInput(event.target.value)}
                    />
                  </label>
                  <label>
                    World ID
                    <input value={world} onChange={(event) => setWorld(event.target.value)} />
                  </label>
                  <button>Connect operator</button>
                </form>
                {operatorView.error && <p role="alert">{operatorView.error.message}</p>}
                {operatorView.data && (
                  <>
                    <h3>Incidents</h3>
                    {scenarios.map((scenario) => (
                      <label className="toggle" key={scenario.id}>
                        <input
                          type="checkbox"
                          checked={!!operatorView.data.faults?.[scenario.id]}
                          onChange={(event) =>
                            mutation.mutate({
                              path: "/api/control/incidents?world=" + encodeURIComponent(world),
                              credential: operatorToken,
                              data: { id: scenario.id, enabled: event.target.checked },
                            })
                          }
                        />
                        {scenario.title}
                      </label>
                    ))}
                    <h3>World agents</h3>
                    {operatorView.data.agents?.map((agent) => (
                      <label className="toggle" key={agent.id}>
                        <input
                          type="checkbox"
                          checked={agent.enabled}
                          onChange={(event) =>
                            mutation.mutate({
                              path: "/api/control/agents?world=" + encodeURIComponent(world),
                              credential: operatorToken,
                              data: { id: agent.id, enabled: event.target.checked },
                            })
                          }
                        />
                        {agent.id}
                      </label>
                    ))}
                  </>
                )}
                <a href="/cis2/">Open CIS2 identity controls</a>
              </>
            )}
            {notice && <p role="alert">{notice}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
