import React, { useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import {
  sites,
  type SiteId,
  type Resource,
  type Patient,
  type Action,
  type SimEvent,
  scenarios,
} from "../../contracts/src/index.ts";
import "./style.css";
import "./systems.css";
import { SystemWorkspace } from "./systems.tsx";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const navigation = [
  { label: "Operate", ids: ["control", "icb", "hr", "roster"] },
  {
    label: "Access",
    ids: ["nhsapp", "patient", "messaging", "triage", "urgent", "gp", "referrals"],
  },
  { label: "Acute", ids: ["ambulance", "hospital", "beds", "theatre", "diagnostics", "legacy"] },
  { label: "Beyond hospital", ids: ["community", "social", "pharmacy", "wearables", "robotics"] },
  {
    label: "Life course",
    ids: ["mental", "maternity", "dental", "genomics", "population", "research"],
  },
] as const;
const interfaceFamily: Partial<Record<SiteId, string>> = {
  control: "command",
  gp: "primary",
  hospital: "acute-epr",
  legacy: "legacy-epr",
  diagnostics: "pacs",
  ambulance: "dispatch",
  urgent: "dispatch",
  triage: "primary",
  referrals: "primary",
  messaging: "messaging",
  pharmacy: "primary",
  community: "community-epr",
  social: "community-epr",
  dental: "primary",
  wearables: "research",
  robotics: "flow",
  population: "board",
  nhsapp: "citizen",
  patient: "citizen",
  hr: "workforce",
  roster: "workforce",
  maternity: "specialist",
  mental: "community-epr",
  theatre: "theatre",
  beds: "flow",
  icb: "board",
  research: "research",
  genomics: "research",
};
export function mount(siteId: SiteId) {
  const site = sites.find((s) => s.id === siteId)!;
  document.title = site.name + " | NHS-SIM";
  const rootRoute = createRootRoute({ component: () => <Workbench siteId={siteId} /> });
  const index = createRoute({ getParentRoute: () => rootRoute, path: "/" });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index]),
    basepath: "/" + siteId,
  });
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
type View = {
  now: number;
  speed: number;
  paused: boolean;
  population: number;
  resources: Resource[];
  resourceTotal?: number;
  resourceOffset?: number;
  resourceLimit?: number;
  events: SimEvent[];
  agents?: { id: string; enabled: boolean }[];
  counters: Record<string, number>;
  faults?: Record<string, boolean>;
  staffing: { doctors: number; nurses: number; staffedSpaces: number; waiting: number };
};
function ProductOverview({ siteId, view, rows }: { siteId: SiteId; view: View; rows: Resource[] }) {
  const waiting = rows.filter((r) => ["waiting", "open", "rejected"].includes(r.status)).length;
  const urgent = rows.filter((r) => r.priority === "urgent" && r.status !== "completed").length;
  const available = rows.filter((r) => ["available", "approved"].includes(r.status)).length;
  const summaries: Partial<Record<SiteId, { title: string; items: [string, string | number][] }>> =
    {
      gp: {
        title: "Practice overview",
        items: [
          ["Inbox", waiting],
          ["Results", rows.filter((r) => ["test", "report"].includes(r.kind)).length],
          ["Appointments", rows.filter((r) => r.kind === "appointment").length],
          ["Tasks due", rows.filter((r) => r.kind === "task" && r.status !== "completed").length],
        ],
      },
      hospital: {
        title: "Patient flow",
        items: [
          ["A&E waiting", view.staffing.waiting],
          ["Staffed spaces", view.staffing.staffedSpaces],
          ["Beds visible", rows.filter((r) => r.kind === "bed").length],
          ["Theatre issues", rows.filter((r) => r.kind === "surgery").length],
        ],
      },
      ambulance: {
        title: "Control room",
        items: [
          [
            "Open handovers",
            rows.filter((r) => r.kind === "handover" && r.status === "waiting").length,
          ],
          ["Longest category", "C2"],
          ["Vehicles clear", 7],
          ["Hospital delay", view.staffing.waiting],
        ],
      },
      diagnostics: {
        title: "Reporting cockpit",
        items: [
          ["Unreported", waiting],
          ["Urgent", urgent],
          ["Available", available],
          ["Feed", view.faults?.["pathology-outage"] ? "DELAYED" : "LIVE"],
        ],
      },
      pharmacy: {
        title: "Dispensary",
        items: [
          ["To check", rows.filter((r) => ["draft", "reviewed"].includes(r.status)).length],
          ["Ready", rows.filter((r) => r.status === "dispensed").length],
          ["Shortages", rows.filter((r) => Number(r.data.stock) === 0).length],
          ["Robot jobs", rows.filter((r) => r.kind === "robot-job").length],
        ],
      },
      community: {
        title: "Neighbourhood caseload",
        items: [
          ["Visits due", rows.filter((r) => r.kind === "visit" && r.status !== "completed").length],
          ["Care plans", rows.filter((r) => r.kind === "care-plan").length],
          ["Urgent", urgent],
          [
            "Slots",
            (rows.find((r) => r.id === "capacity-community")?.data.remaining as number) ?? 0,
          ],
        ],
      },
      social: {
        title: "Adult social care",
        items: [
          ["Assessments", waiting],
          ["Packages", rows.filter((r) => r.kind === "care-package").length],
          [
            "Discharge blocks",
            rows.filter((r) => r.kind === "care-package" && r.status !== "completed").length,
          ],
          ["Due today", urgent],
        ],
      },
      wearables: {
        title: "Remote monitoring",
        items: [
          ["New signals", available],
          ["Devices", rows.filter((r) => r.kind === "device").length],
          ["Disconnected", rows.filter((r) => r.data.quality === "missing").length],
          ["Escalations", urgent],
        ],
      },
      robotics: {
        title: "Fleet status",
        items: [
          ["Available", rows.filter((r) => r.kind === "robot" && r.status === "available").length],
          ["In progress", rows.filter((r) => r.status === "in-progress").length],
          [
            "Completed",
            rows.filter((r) => r.kind === "robot-job" && r.status === "completed").length,
          ],
          ["Faults", view.faults?.["robot-failure"] ? 1 : 0],
        ],
      },
      hr: {
        title: "People dashboard",
        items: [
          ["Available", rows.filter((r) => r.kind === "staff" && r.status === "available").length],
          ["Absent", rows.filter((r) => r.kind === "staff" && r.status === "absent").length],
          ["Doctors", view.staffing.doctors],
          ["Nurses", view.staffing.nurses],
        ],
      },
      roster: {
        title: "Safe staffing",
        items: [
          ["Doctors", view.staffing.doctors],
          ["Nurses", view.staffing.nurses],
          ["A&E spaces", view.staffing.staffedSpaces],
          ["Waiting", view.staffing.waiting],
        ],
      },
      beds: {
        title: "Operational command",
        items: [
          [
            "Available beds",
            rows.filter((r) => r.kind === "bed" && r.status === "available").length,
          ],
          ["Occupied", rows.filter((r) => r.kind === "bed" && r.status === "occupied").length],
          ["Flow alerts", rows.filter((r) => r.kind === "flow-alert").length],
          ["A&E waiting", view.staffing.waiting],
        ],
      },
      theatre: {
        title: "Today's list",
        items: [
          ["Lists", rows.filter((r) => ["theatre-slot", "surgery"].includes(r.kind)).length],
          ["Waiting", waiting],
          [
            "Robotic cases",
            rows.filter((r) => Boolean(r.data.robotRequired) || Boolean(r.data.robot)).length,
          ],
          ["Recovery beds", 2],
        ],
      },
      mental: {
        title: "CMHT caseload",
        items: [
          ["Open care plans", waiting],
          ["Crisis reviews", rows.filter((r) => r.kind === "mental-health-plan").length],
          ["Due today", urgent],
          ["Unallocated", rows.filter((r) => !r.data.coordinator).length],
        ],
      },
      maternity: {
        title: "Maternity dashboard",
        items: [
          ["Active episodes", rows.filter((r) => r.kind === "maternity-episode").length],
          ["Screening due", waiting],
          ["Named midwife", "100%"],
          ["Escalations", urgent],
        ],
      },
      dental: {
        title: "Recall management",
        items: [
          ["Recalls due", waiting],
          ["Appointments", rows.filter((r) => r.kind === "appointment").length],
          ["Access barriers", rows.filter((r) => Boolean(r.data.accessBarrier)).length],
          ["Children", 0],
        ],
      },
      genomics: {
        title: "Genomic medicine",
        items: [
          ["Cases", rows.filter((r) => r.kind === "genomic-test").length],
          ["Uncertain", rows.filter((r) => r.data.result === "uncertain").length],
          ["Consent limits", rows.filter((r) => r.data.consent !== "research").length],
          ["Review due", waiting],
        ],
      },
      research: {
        title: "Cohort workspace",
        items: [
          ["Potential matches", rows.filter((r) => r.kind === "trial-candidate").length],
          ["Consent to contact", rows.filter((r) => r.data.consentToContact === true).length],
          ["Needs review", waiting],
          ["Enrolled", 0],
        ],
      },
      icb: {
        title: "System performance",
        items: [
          ["Providers", rows.filter((r) => r.kind === "provider-metric").length],
          ["Open risks", urgent],
          ["Actions completed", view.counters.completed],
          ["Review minutes", view.counters.reviewMinutes],
        ],
      },
      urgent: {
        title: "Urgent care queue",
        items: [
          ["Dispositions", rows.filter((r) => r.kind === "disposition").length],
          ["Awaiting booking", waiting],
          ["Services found", rows.filter((r) => r.data.serviceFound === true).length],
          ["A&E waiting", view.staffing.waiting],
        ],
      },
      referrals: {
        title: "Referral management",
        items: [
          ["Open", waiting],
          ["Rejected", rows.filter((r) => r.status === "rejected").length],
          ["Attachments", rows.filter((r) => r.kind === "report").length],
          ["Booked", rows.filter((r) => r.kind === "appointment").length],
        ],
      },
      population: {
        title: "Population health",
        items: [
          ["Recalls due", waiting],
          ["Screening records", rows.filter((r) => r.kind === "screening").length],
          ["Genomic records", rows.filter((r) => r.kind === "genomics").length],
          ["Inequality flags", rows.filter((r) => Boolean(r.patientId)).length],
        ],
      },
      nhsapp: {
        title: "Your health",
        items: [
          ["Appointments", rows.filter((r) => r.kind === "appointment").length],
          ["Messages", rows.filter((r) => r.kind === "message").length],
          ["Choices", rows.filter((r) => r.kind === "choice").length],
          ["To do", waiting],
        ],
      },
      patient: {
        title: "Your health",
        items: [
          ["Appointments", rows.filter((r) => r.kind === "appointment").length],
          ["Messages", rows.filter((r) => r.kind === "message").length],
          ["Medicines", rows.filter((r) => r.kind === "prescription").length],
          ["To do", waiting],
        ],
      },
    };
  const summary = summaries[siteId] ?? {
    title: "Service overview",
    items: [
      ["Open", waiting],
      ["Urgent", urgent],
      ["Available", available],
      ["Completed", view.counters.completed],
    ],
  };
  return (
    <section className="product-overview">
      <div className="overview-title">
        <span className="product-glyph">{siteId.slice(0, 2).toUpperCase()}</span>
        <div>
          <small>LIVE SYNTHETIC SERVICE</small>
          <h2>{summary.title}</h2>
        </div>
      </div>
      <div className="overview-metrics">
        {summary.items.map(([label, value]) => (
          <article key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
function Workbench({ siteId }: { siteId: SiteId }) {
  const site = sites.find((s) => s.id === siteId)!;
  const [key, setKey] = useState(() => sessionStorage.getItem("sim-key") ?? "");
  const [team, setTeam] = useState(""),
    [keyInput, setKeyInput] = useState(""),
    [search, setSearch] = useState("");
  const [patient, setPatient] = useState(new URLSearchParams(location.search).get("patient") ?? "");
  const [world, setWorld] = useState("default"),
    [tab, setTab] = useState<"work" | "apis">("work"),
    [browserReady, setBrowserReady] = useState(false);
  const [title, setTitle] = useState(""),
    [actionType, setActionType] = useState<Action["type"]>("create_task");
  const [notice, setNotice] = useState("");
  const [systemSearch, setSystemSearch] = useState("");
  const [resourceOffset, setResourceOffset] = useState(0);
  const suffix = siteId === "control" ? "?world=" + encodeURIComponent(world) : "";
  async function api<T>(path: string, data?: unknown): Promise<T> {
    const response = await fetch(path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: "Bearer " + key } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? result.error ?? "Request failed");
    return result;
  }
  const saveKey = (value: string) => {
    sessionStorage.setItem("sim-key", value);
    setKey(value);
    client.clear();
    setNotice("Key saved for this browser session.");
  };
  const catalogue = useQuery({
    queryKey: ["catalogue"],
    queryFn: () =>
      api<{ apis: { id: string; name: string; description: string; site: string }[] }>(
        "/api/catalogue",
      ),
  });
  const view = useQuery({
    queryKey: ["view", siteId, key, world, patient, resourceOffset],
    queryFn: () =>
      api<View>(
        "/api/sites/" +
          siteId +
          "/view" +
          suffix +
          (suffix ? "&" : "?") +
          (patient
            ? "patient=" + encodeURIComponent(patient)
            : "limit=200&offset=" + resourceOffset),
      ),
    enabled: !!key && siteId !== "legacy",
    refetchInterval: 2000,
  });
  const patients = useQuery({
    queryKey: ["patients", siteId, key, search, patient, world],
    queryFn: () =>
      api<{ items: Patient[]; total: number }>(
        "/api/sites/" +
          (siteId === "legacy" ? "gp" : siteId) +
          "/patients?q=" +
          encodeURIComponent(patient || search) +
          (siteId === "control" ? "&world=" + encodeURIComponent(world) : ""),
      ),
    enabled: !!key && siteId !== "legacy",
  });
  const mutation = useMutation({
    mutationFn: async ({ path, data }: { path: string; data: unknown }) => api(path, data),
    onSuccess: () => {
      client.invalidateQueries();
      setNotice("Saved to the simulation.");
    },
    onError: (e) => setNotice(e.message),
  });
  const issue = useMutation({
    mutationFn: () => api<{ apiKey: string; world: string }>("/api/keys", { teamName: team }),
    onSuccess: (r) => {
      saveKey(r.apiKey);
      setWorld(r.world);
      setNotice(
        "Team world created, paused and ready. Open any clinical site. Keep a copy of your key before closing this session.",
      );
      if (siteId === "control") location.assign("/gp/");
    },
    onError: (e) => setNotice(e.message),
  });
  const act = (type: Action["type"], r: Resource, target?: SiteId) =>
    mutation.mutate({
      path: "/api/sites/" + siteId + "/actions" + suffix,
      data: { type, resourceId: r.id, expectedVersion: r.version, target },
    });
  const clock = (data: unknown) => mutation.mutate({ path: "/api/clock" + suffix, data });
  const rows = (view.data?.resources ?? []).filter(
    (r) => !patient || r.patientId === patient || !r.patientId,
  );
  const current = patients.data?.items.find((p) => p.id === patient);
  return (
    <div
      className={
        "app ui-" + (interfaceFamily[siteId] ?? "service") + (siteId === "legacy" ? " legacy" : "")
      }
      style={{ "--brand": site.color } as CSSProperties}
    >
      <div className="app-bar">
        <a className="wordmark" href="/control/">
          NHS<span>SIM</span>
        </a>
        <details className="system-picker">
          <summary>
            {site.name} <span aria-hidden="true">⌄</span>
          </summary>
          <div className="system-menu">
            <label>
              Find a service
              <input
                value={systemSearch}
                onChange={(e) => setSystemSearch(e.target.value)}
                placeholder="Search systems…"
              />
            </label>
            <nav aria-label="Connected systems">
              {navigation.map((group) => {
                const matches = sites.filter(
                  (s) =>
                    group.ids.some((id) => id === s.id) &&
                    (s.name + " " + s.subtitle).toLowerCase().includes(systemSearch.toLowerCase()),
                );
                return (
                  matches.length > 0 && (
                    <div className="nav-group" key={group.label}>
                      <small>{group.label}</small>
                      {matches.map((s) => (
                        <a
                          key={s.id}
                          href={
                            "/" +
                            s.id +
                            "/" +
                            (patient ? "?patient=" + encodeURIComponent(patient) : "")
                          }
                          className={s.id === siteId ? "active" : ""}
                          aria-current={s.id === siteId ? "page" : undefined}
                        >
                          {s.name}
                        </a>
                      ))}
                    </div>
                  )
                );
              })}
              {!sites.some((s) =>
                (s.name + " " + s.subtitle).toLowerCase().includes(systemSearch.toLowerCase()),
              ) && <p>No matching services.</p>}
            </nav>
          </div>
        </details>
        <a className="docs-link" href="/docs/">
          Documentation
        </a>
        <span className="environment-label">Synthetic environment</span>
      </div>
      <main>
        <div className="simulation-banner">
          Fictional people and organisations · Simulation only
        </div>
        <header>
          <div>
            <p className="eyebrow">{site.subtitle}</p>
            <h1>{site.name}</h1>
          </div>
          <div className="header-actions">
            <button onClick={() => setTab(tab === "apis" ? "work" : "apis")}>
              {tab === "apis" ? "Worklists" : "Developer desk"}
            </button>
            {key && <button onClick={() => saveKey("")}>Change key</button>}
          </div>
        </header>
        {siteId === "control" && (
          <section className="control-visual" aria-label="Synthetic healthcare neighbourhood">
            <img
              src="/control/neighbourhood-control.png"
              alt="Illustrated fictional healthcare neighbourhood connected by data pathways"
            />
            <div>
              <small>LIVE WORLD MODEL</small>
              <strong>
                One neighbourhood.
                <br />
                Every service in motion.
              </strong>
              <span>Test an agent across referrals, results and care handovers.</span>
            </div>
          </section>
        )}
        {!key && (
          <section className="panel access">
            <h2>Enter the neighbourhood</h2>
            <p>
              Create an isolated synthetic neighbourhood for your team. Use your API key to connect
              an agent and explore the same records in each service.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                issue.mutate();
              }}
            >
              <label>
                Team name
                <input
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="The Loop Closers"
                />
              </label>
              <button disabled={issue.isPending}>Create team & API key</button>
            </form>
            <details>
              <summary>Use an existing team key or operator token</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveKey(keyInput);
                }}
              >
                <label>
                  API key / operator token
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    required
                  />
                </label>
                <button>Connect</button>
              </form>
            </details>
          </section>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {tab === "apis" ? (
          <section className="panel">
            <h2>Connect your agent</h2>
            <p>
              <a href="/docs/">Open the developer guide</a> for setup, workflows and API reference.
            </p>
            <p>
              Every endpoint lives on this origin. Send <code>Authorization: Bearer YOUR_KEY</code>.
              Your key selects your team's world. NHS adapters are simplified local mocks, not
              certified API replicas.
            </p>
            {key && (
              <details>
                <summary>Reveal team key (keep private)</summary>
                <code className="key">{key}</code>
              </details>
            )}
            <details>
              <summary>Browse available adapters</summary>
              <div className="api-grid">
                {catalogue.data?.apis.map((a) => (
                  <article key={a.id}>
                    <h3>{a.name}</h3>
                    <p>{a.description}</p>
                    <code>GET /api/nhs/{a.id}</code>
                    <p>Scope: {a.site}</p>
                  </article>
                ))}
              </div>
            </details>
            <h3>Legacy integration request</h3>
            <button
              onClick={async () => {
                try {
                  await api("/api/keys", { teamName: team || "Demo team", site: "legacy" });
                } catch (e) {
                  setNotice((e as Error).message);
                }
              }}
            >
              Request vendor API access
            </button>
            <h3>CIS-too</h3>
            <code>/cis2/.well-known/openid-configuration</code>
            <p>
              Authorization code + PKCE, signed ID token, JWKS and a fixed fictional clinician.
              Separate from team API keys.
            </p>
          </section>
        ) : (
          <>
            {siteId === "control" && key && (
              <section className="panel">
                <label>
                  World ID
                  <input
                    value={world}
                    onChange={(e) => setWorld(e.target.value)}
                    placeholder="default or team-…"
                  />
                </label>
                <p>
                  The control console requires the operator token. Team keys work on the other sites
                  and can control their own clock.
                </p>
              </section>
            )}
            {view.error && (
              <p className="error" role="alert">
                {view.error.message}
              </p>
            )}
            {view.data && (
              <>
                <details
                  className="clock-disclosure"
                  open={siteId === "control" ? true : undefined}
                >
                  <summary>
                    Simulation clock · {view.data.paused ? "Paused" : "Running"} ·{" "}
                    {new Date(view.data.now).toISOString().slice(11, 16)} UTC
                  </summary>
                  <section className="clock">
                    <div>
                      <small>SIMULATION TIME · UTC</small>
                      <strong>
                        {new Date(view.data.now).toISOString().replace("T", " ").slice(0, 19)}
                      </strong>
                      <span>
                        {view.data.paused ? "Paused" : "Running"} · {view.data.speed}×
                      </span>
                    </div>
                    <button
                      disabled={mutation.isPending}
                      onClick={() => clock({ paused: !view.data!.paused })}
                    >
                      {view.data.paused ? "▶ Run" : "Ⅱ Pause"}
                    </button>
                    <label>
                      Speed
                      <select
                        value={view.data.speed}
                        onChange={(e) => clock({ speed: Number(e.target.value) })}
                      >
                        {[1, 10, 60, 300, 3600].map((v) => (
                          <option key={v} value={v}>
                            {v}×
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      disabled={!view.data.paused || mutation.isPending}
                      onClick={() => clock({ advanceMinutes: 60 })}
                    >
                      Step 1 hour
                    </button>
                  </section>
                </details>
                {!patient && view.data.resourceTotal !== undefined && (
                  <div className="resource-pagination">
                    <span>
                      {view.data.resourceTotal === 0
                        ? "No records"
                        : `Records ${(view.data.resourceOffset ?? resourceOffset) + 1}–${Math.min((view.data.resourceOffset ?? resourceOffset) + view.data.resources.length, view.data.resourceTotal)} of ${view.data.resourceTotal.toLocaleString()}`}{" "}
                      · Search for a patient to open their full record.
                    </span>
                    <button
                      disabled={resourceOffset === 0}
                      onClick={() => setResourceOffset(Math.max(0, resourceOffset - 200))}
                    >
                      Previous records
                    </button>
                    <button
                      disabled={resourceOffset + 200 >= view.data.resourceTotal}
                      onClick={() => setResourceOffset(resourceOffset + 200)}
                    >
                      Next records
                    </button>
                  </div>
                )}
                {siteId === "control" && (
                  <section className="metrics">
                    <article>
                      <small>Population</small>
                      <strong>{view.data.population.toLocaleString()}</strong>
                    </article>
                    <article>
                      <small>Visible work items</small>
                      <strong>{rows.length}</strong>
                    </article>
                    <article>
                      <small>Completed actions</small>
                      <strong>{view.data.counters.completed}</strong>
                    </article>
                    <article>
                      <small>A&E staffed spaces</small>
                      <strong>{view.data.staffing.staffedSpaces}</strong>
                      <span>
                        {view.data.staffing.doctors} doctors / {view.data.staffing.nurses} nurses
                      </span>
                    </article>
                  </section>
                )}
                {siteId === "control" && (
                  <ProductOverview siteId={siteId} view={view.data} rows={rows} />
                )}
                {siteId !== "control" && siteId !== "legacy" && (
                  <SystemWorkspace
                    siteId={siteId}
                    view={view.data}
                    rows={rows}
                    patients={patients.data?.items ?? []}
                    selectedPatient={patient}
                    patientSearch={search}
                    searchPatients={setSearch}
                    selectPatient={setPatient}
                    act={act}
                    create={(type, patientId, actionTitle, target) =>
                      mutation.mutate({
                        path: "/api/sites/" + siteId + "/actions" + suffix,
                        data: { type, patientId, title: actionTitle, target },
                      })
                    }
                    pending={mutation.isPending}
                  />
                )}
                {siteId === "control" && (
                  <section className="panel">
                    <h2>World agents & incidents</h2>
                    <div className="chips">
                      {view.data.agents?.map((a) => (
                        <button
                          key={a.id}
                          onClick={() =>
                            mutation.mutate({
                              path: "/api/control/agents" + suffix,
                              data: { id: a.id, enabled: !a.enabled },
                            })
                          }
                        >
                          {a.enabled ? "On" : "Off"} · {a.id}
                        </button>
                      ))}
                    </div>
                    <div className="api-grid">
                      {scenarios.map((s) => (
                        <article key={s.id}>
                          <h3>{s.title}</h3>
                          <p>{s.description}</p>
                          <button
                            onClick={() =>
                              mutation.mutate({
                                path: "/api/control/incidents" + suffix,
                                data: { id: s.id, enabled: !view.data!.faults?.[s.id] },
                              })
                            }
                          >
                            {view.data?.faults?.[s.id] ? "Restore" : "Inject"}
                          </button>
                        </article>
                      ))}
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const result = await api("/api/control/model-propose" + suffix, {});
                          setNotice(JSON.stringify(result));
                        } catch (e) {
                          setNotice((e as Error).message);
                        }
                      }}
                    >
                      Ask optional model agent for task proposals
                    </button>
                  </section>
                )}
                {siteId === "control" && (
                  <>
                    <section className="panel">
                      <div className="section-heading">
                        <h2>Patient workspace</h2>
                        <label>
                          Find patient
                          <input
                            placeholder="Name or SIM identifier"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                      </div>
                      <label>
                        Patient
                        <select value={patient} onChange={(e) => setPatient(e.target.value)}>
                          <option value="">All visible work</option>
                          {patients.data?.items.map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.name} · {p.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      {current && (
                        <div className="patient">
                          <h3>{current.name}</h3>
                          <p>{current.conditions.join(" · ")}</p>
                          <p>Access needs: {current.needs.join(", ")}</p>
                          <p>Goals: {current.goals.join("; ")}</p>
                          <div className="chips">
                            {sites
                              .filter((s) => !["control", siteId].includes(s.id))
                              .map((s) => (
                                <a key={s.id} href={"/" + s.id + "/?patient=" + patient}>
                                  {s.name}
                                </a>
                              ))}
                          </div>
                        </div>
                      )}
                      {patient && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            mutation.mutate({
                              path: "/api/sites/" + siteId + "/actions" + suffix,
                              data: { type: actionType, patientId: patient, title },
                            });
                          }}
                        >
                          <label>
                            Action
                            <select
                              value={actionType}
                              onChange={(e) => setActionType(e.target.value as Action["type"])}
                            >
                              {[
                                "create_task",
                                "create_referral",
                                "order_test",
                                "draft_prescription",
                                "book_appointment",
                                "send_message",
                                "schedule_visit",
                                "dispatch_robot",
                              ].map((t) => (
                                <option value={t} key={t}>
                                  {t.replaceAll("_", " ")}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Reason / description
                            <input
                              value={title}
                              onChange={(e) => setTitle(e.target.value)}
                              required
                              maxLength={500}
                            />
                          </label>
                          <button disabled={mutation.isPending}>Submit action</button>
                        </form>
                      )}
                    </section>
                  </>
                )}
                {siteId === "control" && (
                  <section className="panel">
                    <h2>Operational worklist</h2>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Record</th>
                            <th>Patient / owner</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <small>
                                  {r.kind} · {r.id} · v{r.version}
                                </small>
                                <strong>{r.title}</strong>
                                <details>
                                  <summary>Record details</summary>
                                  <pre>{JSON.stringify(r.data, null, 2)}</pre>
                                </details>
                              </td>
                              <td>
                                {r.patientId ?? "System"}
                                <br />
                                <small>{r.owner}</small>
                              </td>
                              <td>
                                <span className={"status " + r.status}>{r.status}</span>
                              </td>
                              <td>
                                <div className="row-actions">
                                  {r.kind === "staff" ? (
                                    <>
                                      <button
                                        onClick={() =>
                                          act(
                                            r.status === "absent"
                                              ? "restore_staff"
                                              : "report_absence",
                                            r,
                                          )
                                        }
                                      >
                                        {r.status === "absent" ? "Return" : "Report absence"}
                                      </button>
                                      <button onClick={() => act("allocate_shift", r)}>
                                        {r.data.allocated ? "Remove shift" : "Allocate shift"}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {["open", "draft", "available"].includes(r.status) && (
                                        <button onClick={() => act("review", r)}>Review</button>
                                      )}
                                      {["open", "reviewed", "rejected"].includes(r.status) && (
                                        <button onClick={() => act("accept", r)}>Accept</button>
                                      )}
                                      {[
                                        "open",
                                        "reviewed",
                                        "accepted",
                                        "scheduled",
                                        "waiting",
                                      ].includes(r.status) && (
                                        <button onClick={() => act("complete", r)}>Complete</button>
                                      )}
                                      {r.kind === "prescription" && r.status === "approved" && (
                                        <button onClick={() => act("dispense", r)}>Dispense</button>
                                      )}
                                      {r.kind === "prescription" && r.status === "dispensed" && (
                                        <button onClick={() => act("collect", r)}>Collect</button>
                                      )}
                                      <button onClick={() => act("share_record", r, "gp")}>
                                        Share with GP
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {rows.length === 0 && (
                        <p>
                          No visible records for this selection. Use an action to start a workflow.
                        </p>
                      )}
                    </div>
                  </section>
                )}
                <section className="panel">
                  <h2>Activity trail</h2>
                  {view.data.events.length === 0 ? (
                    <p>No events yet. Start the clock or submit an action.</p>
                  ) : (
                    <ol className="events">
                      {view.data.events.slice(0, 20).map((e) => (
                        <li key={e.id}>
                          <time>{new Date(e.time).toISOString().slice(11, 19)}</time>
                          <strong>{e.type}</strong>
                          <span>{e.detail}</span>
                          <small>{e.actor}</small>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </>
            )}
            {siteId === "legacy" && key && (
              <section className="panel">
                <h2>Browser-only record system</h2>
                <p>
                  No public data API. Use the HTML workflow below; automation tools can inspect the
                  document table and submit its form.
                </p>
                <button
                  onClick={async () => {
                    try {
                      await api("/api/session", {});
                      setBrowserReady(true);
                    } catch (e) {
                      setNotice((e as Error).message);
                    }
                  }}
                >
                  Open legacy session
                </button>
                {browserReady && <iframe title="Legacy EPR" src="/browser/legacy" />}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
