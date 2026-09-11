import { OperatorConsole, OperatorViewingBanner } from "./operator-console.tsx";
import { normalizeTeamName } from "../../contracts/src/team.ts";
import { Neighbourhood } from "./neighbourhood.tsx";
const MessagingWorkspace = lazy(() => import("./messaging-workspace.tsx").then((module) => ({ default: module.MessagingWorkspace })));
const DocumentWorkspace = lazy(() => import("./document-workspace.tsx").then((module) => ({ default: module.DocumentWorkspace })));
const PharmacyWorkspace = lazy(() => import("./pharmacy-workspace.tsx").then((module) => ({ default: module.PharmacyWorkspace })));
import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  sites,
  type SiteId,
  type Resource,
  type Patient,
  type Action,
  type SimEvent,
} from "../../contracts/src/index.ts";
const SystemWorkspace = lazy(() => import("./systems.tsx").then((module) => ({ default: module.SystemWorkspace })));
const CareWorkspace = lazy(() => import("./care-workspaces.tsx").then((module) => ({ default: module.CareWorkspace })));
const HomeWorkspace = lazy(() => import("./home-workspace.tsx").then((module) => ({ default: module.HomeWorkspace })));
const PlanExploration = lazy(() => import("./plan-exploration.tsx").then((module) => ({ default: module.PlanExploration })));
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
type Clock = Pick<View, "now" | "paused" | "speed" | "events">;
type ClockCommand = { paused: boolean } | { paused: true; advanceMinutes: number };
export function mount(siteId: SiteId) {
  document.title = (sites.find((site) => site.id === siteId)?.name ?? "NHS-SIM") + " | NHS-SIM";
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={client}>
      <WorldApp siteId={siteId} />
    </QueryClientProvider>,
  );
}
function WorldApp({ siteId }: { siteId: SiteId }) {
  const [key, setKey] = useState(() => {
    const saved = localStorage.getItem("sim-key") ?? sessionStorage.getItem("sim-key") ?? "";
    if (saved) localStorage.setItem("sim-key", saved);
    sessionStorage.removeItem("sim-key");
    return saved;
  });
  const [patient, setPatient] = useState(
    () => new URLSearchParams(location.search).get("patient") ?? "",
  );
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState("");
  const [drawer, setDrawer] = useState<"team" | "simulation" | "operator" | null>(() => new URLSearchParams(location.search).get("operator") === "1" ? "operator" : null);
  const [destination, setDestination] = useState<string | null>(
    () => siteId === "control" ? null : location.pathname + location.search,
  );
  const [place, setPlace] = useState(() => new URLSearchParams(location.search).get("place"));
  const teamRequestActive = useRef(false);
  useEffect(() => {
    const restore = () => setPlace(new URLSearchParams(location.search).get("place"));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  function choosePlace(value: string | null) {
    const url = new URL(location.href);
    if (value) url.searchParams.set("place", value);
    else url.searchParams.delete("place");
    history.pushState(null, "", url.pathname + url.search + url.hash);
    setPlace(value);
  }
  const [team, setTeam] = useState(() => localStorage.getItem("sim-team") ?? "");
  const [keyInput, setKeyInput] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const isMap = siteId === "control";
  const isDocuments = siteId === "gp" && location.pathname.replace(/\/$/, "") === "/gp/documents";
  const isMessages = (siteId === "gp" || siteId === "wearables") && location.pathname.replace(/\/$/, "") === `/${siteId}/messages`;
  const isOffice = isDocuments || isMessages;
  useEffect(() => { if (isMessages) document.title = (siteId === "gp" ? "InaccuRx" : "Messages") + " | NHS-SIM"; }, [isMessages, siteId]);
  useEffect(() => { if (isDocuments) document.title = "DocuMañana | NHS-SIM"; }, [isDocuments]);
  const [tourStep, setTourStep] = useState<number | null>(() =>
    siteId !== "control" && localStorage.getItem("sim-key") && sessionStorage.getItem("sim-tour-world") ? 0 : null,
  );
  const [explorePlan, setExplorePlan] = useState(
    () => isMap && new URLSearchParams(location.search).get("explore") === "plan",
  );
  useEffect(() => {
    if (!isMap) return;
    const url = new URL(location.href);
    url.searchParams.delete("challenges");
    if (explorePlan) url.searchParams.set("explore", "plan");
    else url.searchParams.delete("explore");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [isMap, explorePlan]);
  const Workspace =
    isMessages ? MessagingPortal : isDocuments ? DocumentPortal : siteId === "pharmacy" ? PharmacyWorkspace : siteId === "community"
      ? CareWorkspace
      : siteId === "wearables"
        ? HomeWorkspace
        : SystemWorkspace;
  const planToggleRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const tourRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const status = statusRef.current;
    const app = status?.parentElement;
    if (!status || !app) return;
    const measure = () => app.style.setProperty("--workspace-status-height", `${status.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(status);
    return () => observer.disconnect();
  }, [isMap]);
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
    if (value) localStorage.setItem("sim-key", value);
    else {
      for (const name of ["sim-key", "sim-team", "sim-world"]) localStorage.removeItem(name);
      sessionStorage.removeItem("sim-tour-world");
      setTeam("");
    }
    sessionStorage.removeItem("sim-key");
    setKey(value);
    client.clear();
  }
  useEffect(() => {
    if (!key) return;
    let current = true;
    void api<{ team: string; world: string }>("/api/team").then((identity) => {
      if (!current) return;
      const name = normalizeTeamName(identity.team);
      localStorage.setItem("sim-team", name);
      localStorage.setItem("sim-world", identity.world);
      setTeam(name);
    }).catch(() => {});
    return () => { current = false; };
  }, [key]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== "sim-key") return;
      setKey(event.newValue ?? "");
      setTeam(localStorage.getItem("sim-team") ?? "");
      client.clear();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function enter(href: string) {
    if (key || href === "/cis2/") location.assign(href);
    else {
      setDestination(href);
      setDrawer("team");
    }
  }
  const view = useQuery({
    queryKey: ["view", siteId, key, patient, offset, isOffice],
    placeholderData: (previous) => previous,
    queryFn: () =>
      api<View>(
        `/api/sites/${isMap ? "gp" : siteId}/view?${isOffice ? "limit=1" : patient ? "patient=" + encodeURIComponent(patient) : "limit=200&offset=" + offset}`,
      ),
    enabled: !!key && !isMap,
    refetchInterval: 3000,
  });
  const clock = useQuery({
    queryKey: ["clock", key],
    queryFn: () => api<Clock>("/api/clock"),
    enabled: !!key,
    refetchInterval: 3000,
  });
  const clockChange = useMutation({
    mutationFn: (command: ClockCommand) => api<Clock>("/api/clock", command),
    onSuccess: (result) => {
      client.setQueryData(["clock", key], result);
      void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "clock" });
    },
  });
  const patients = useQuery({
    queryKey: ["patients", siteId, key, search],
    queryFn: () =>
      api<{ items: Patient[]; total: number }>(
        `/api/sites/${isMap ? "gp" : siteId}/patients?q=` + encodeURIComponent(search),
      ),
    enabled: !!key && !isMap,
  });
  const selectedPatient = useQuery({
    queryKey: ["selected-patient", siteId, key, patient],
    queryFn: () =>
      api<{ items: Patient[]; total: number }>(
        `/api/sites/${isMap ? "gp" : siteId}/patients?q=` + encodeURIComponent(patient),
      ),
    enabled: !!key && !!patient && !isMap && !isOffice,
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
    enabled: !isMap,
    refetchInterval: 5000,
  });
  const handovers = useQuery({
    queryKey: ["handovers", key, patient, siteId],
    queryFn: async () => {
      const services: SiteId[] = ["community", "pharmacy", "diagnostics"];
      if (siteId === "hospital") services.push("gp");
      const result = await Promise.allSettled(
        services.map(async (service) => ({
          service,
          view: await api<View>(
            `/api/sites/${service}/view?patient=${encodeURIComponent(patient)}`,
          ),
        })),
      );
      return {
        resources: result.flatMap((item) =>
          item.status === "fulfilled" ? item.value.view.resources.filter((record) => item.value.service !== "gp" || record.kind === "task") : [],
        ),
        unavailable: result.flatMap((item, index) =>
          item.status === "rejected" ? [services[index]] : [],
        ),
      };
    },
    enabled: !!key && !!patient && !isMap && !isOffice,
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
    mutationFn: async (request: { kind: "create"; teamName: string } | { kind: "connect"; apiKey: string }): Promise<{ kind: "created"; apiKey: string; world: string; teamName: string; created: boolean } | { kind: "connected"; apiKey: string; world: string; teamName: string }> => {
      if (request.kind === "create") {
        const result = await api<{ apiKey: string; world: string; teamName: string; created: boolean }>("/api/keys", { teamName: request.teamName });
        return { kind: "created", ...result };
      }
      try {
        const identity = await api<{ team: string; world: string }>("/api/team", undefined, request.apiKey);
        return { kind: "connected", apiKey: request.apiKey, world: identity.world, teamName: normalizeTeamName(identity.team) };
      } catch {
        throw new Error("Unable to connect. Check your team key and try again.");
      }
    },
    onSuccess: (result) => {
      localStorage.setItem("sim-key", result.apiKey);
      localStorage.setItem("sim-team", result.teamName);
      localStorage.setItem("sim-world", result.world);
      setTeam(result.teamName);
      if (result.kind === "created") {
        if (result.created) sessionStorage.setItem("sim-tour-world", result.world);
        else sessionStorage.removeItem("sim-tour-world");
        setCopyStatus("");
      } else {
        sessionStorage.removeItem("sim-tour-world");
        saveKey(result.apiKey);
        if (teamRequestActive.current && destination) location.assign(destination);
        else setDrawer(null);
        issue.reset();
      }
      if (!teamRequestActive.current) {
        saveKey(result.apiKey);
        issue.reset();
      }
    },
  });
  const readyTeam = issue.isSuccess && issue.data.kind === "created" ? issue.data : null;
  function continueToWorkspace() {
    if (!readyTeam) return;
    saveKey(readyTeam.apiKey);
    issue.reset();
    setDrawer(null);
    if (destination) location.assign(destination);
  }
  function closeControls() {
    if (drawer === "team") {
      teamRequestActive.current = false;
      if (readyTeam) saveKey(readyTeam.apiKey);
      issue.reset();
      setDestination(null);
      if (isMap && !key) choosePlace(null);
    }
    setDrawer(null);
    const url = new URL(location.href);
    url.searchParams.delete("operator");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button, input")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeControls();
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
  }, [drawer, readyTeam, destination]);
  async function copyKey(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus("API key copied.");
    } catch {
      setCopyStatus("Copy unavailable. Reveal the key and copy it manually.");
    }
  }
  function finishTour() {
    sessionStorage.removeItem("sim-tour-world");
    setTourStep(null);
  }
  useEffect(() => {
    if (tourStep === null || drawer || !view.data || isMap) return;
    const selectors = ["[data-tour=team]", "[data-tour=simulation]", ".ehr-finder input, .care-search input, .home-resident-button"];
    const target = document.querySelector<HTMLElement>(selectors[tourStep] ?? "[data-tour=team]");
    target?.classList.add("tour-highlight");
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    tourRef.current?.focus();
    return () => target?.classList.remove("tour-highlight");
  }, [tourStep, drawer, view.data?.id, isMap]);
  const act = (type: Action["type"], resource: Resource, target?: SiteId) => {
    const embedded = handovers.data?.resources.some((item) => item.id === resource.id);
    const actor =
      !(siteId === "gp" && type === "review" && resource.kind === "test") && embedded && ["community", "pharmacy", "diagnostics"].includes(resource.owner)
        ? resource.owner
        : siteId;
    mutation.mutate({
      path: `/api/sites/${actor}/actions`,
      data: { type, resourceId: resource.id, expectedVersion: resource.version, target },
    });
  };
  const create = (type: Action["type"], patientId: string, title: string, target?: SiteId) =>
    mutation.mutateAsync({
      path: `/api/sites/${siteId}/actions`,
      data: { type, patientId, title, target },
    });
  const selectPatient = (id: string) => {
    setPatient(id);
    setSearch("");
    setOffset(0);
    const url = new URL(location.href);
    if (id) url.searchParams.set("patient", id);
    else url.searchParams.delete("patient");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  };
  const error = view.error?.message || patients.error?.message;
  return (
    <div className={isMap ? "world-app" : "immersive-app"}>
      <OperatorViewingBanner />
      {isMap ? (
        <>
          <header className="world-header">
            <a href="/control/" className="world-brand">
              NHS-SIM <span>Riverside & Northbank</span>
            </a>
            <nav aria-label="World tools">
              <button
                ref={planToggleRef}
                aria-expanded={explorePlan}
                aria-controls="plan-exploration"
                onClick={() => setExplorePlan(!explorePlan)}
              >
                Explore the plan
              </button>
              <a href="/docs/">Handbook</a>
              <button onClick={() => setDrawer("operator")}>Organiser controls</button>
              <button onClick={() => setDrawer("team")}>
                {key ? "Your team" : "Join the world"}
              </button>
            </nav>
          </header>
          {explorePlan && (
            <Suspense fallback={<p className="loading">Opening the plan…</p>}><PlanExploration enter={enter} close={() => {
              setExplorePlan(false);
              planToggleRef.current?.focus();
            }} /></Suspense>
          )}
          <Neighbourhood enter={enter} suspended={drawer !== null} connected={!!key} place={place} choose={choosePlace} now={clock.data?.now} openTeam={() => { setDestination(null); setDrawer("team"); }} />
        </>
      ) : (
        <>
          {!key ? (
            <main className="access-gate">
              <a href="/control/">Back to neighbourhood</a>
              <h1>{isMessages ? (siteId === "gp" ? "InaccuRx" : "Messages") : isDocuments ? "DocuMañana" : sites.find((s) => s.id === siteId)?.name}</h1>
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
            <Suspense fallback={<p className="loading" role="status">Opening the app…</p>}><Workspace
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
              patientMatches={patients.data?.items ?? []}
              selectedPatient={patient}
              patientSearch={search}
              searchPatients={(value) => {
                setSearch(value);
                setOffset(0);
              }}
              selectPatient={selectPatient}
              act={act}
              create={create}
              api={api}
              pending={mutation.isPending}
              exitToMap={() => location.assign("/control/")}
            /></Suspense>
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
          <footer ref={statusRef} className="workspace-status" aria-label="Workspace controls">
            <a href="/control/?explore=plan">Explore the plan</a>
            <a href={`/control/?place=${siteId === "gp" ? "practice" : siteId === "wearables" ? "home" : siteId}`}>{siteId === "wearables" ? "Phone" : "Desktop"}</a>
            <a href="/control/">Neighbourhood</a>
            <span>
              {clock.data
                ? new Date(clock.data.now).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"
                : "Synthetic workspace"}
            </span>
            <button data-tour="simulation" onClick={() => setDrawer("simulation")}>
              {clock.data ? (clock.data.paused ? "Paused" : "Running") : "Connect"} · Simulation controls
            </button>
            <button data-tour="team" onClick={() => setDrawer("team")}>Team & API key</button>
            <a href="/docs/">Handbook</a>
            <span className="synthetic-label">SIMULATION</span>
          </footer>
          {!isOffice && !patient && view.data && view.data.resourceTotal > 200 && (
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
      {tourStep !== null && key && view.data && !isMap && !drawer && (
        <section ref={tourRef} tabIndex={-1} className="workspace-tour" role="dialog" aria-label="Workspace tour" onKeyDown={(event) => { if (event.key === "Escape") finishTour(); }}>
          <span className="eyebrow">QUICK TOUR · {tourStep + 1} OF 3</span>
          <h2>{["Your key is always here", "Control simulation time", "Choose a patient"][tourStep]}</h2>
          <p>{[
            "Use Team & API key in the bottom bar whenever you need to copy your key, connect an agent or share this world with a teammate.",
            "Simulation controls stay in the bottom bar. Pause or advance time to see results arrive and follow the activity trail.",
            "Use the patient search or resident selector to open another person's record. Each portal uses your team's shared synthetic world.",
          ][tourStep]}</p>
          <div className="control-row">
            <button onClick={finishTour}>Skip tour</button>
            <button className="primary" onClick={() => tourStep === 2 ? finishTour() : setTourStep(tourStep + 1)}>{tourStep === 2 ? "Done" : "Next"}</button>
          </div>
        </section>
      )}
      {drawer && (
        <div className="dialog-scrim" onClick={closeControls}>
          <section
            ref={dialogRef}
            className={drawer === "operator" ? "world-dialog operator-dialog" : "world-dialog"}
            role="dialog"
            aria-modal="true"
            aria-label={drawer + " controls"}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="close" onClick={closeControls} aria-label="Close controls">
              ×
            </button>
            {drawer === "team" && (
              <>
                <span className="eyebrow">YOUR TEAM WORLD</span>
                <h2>{readyTeam ? "Your team is ready" : key ? "Team access" : "Start exploring"}</h2>
                {readyTeam ? (
                  <>
                    <p><strong>{readyTeam.teamName}</strong> {readyTeam.created ? "now has a synthetic world" : "is connected to its existing world"}. Teammates can enter this same name to join, or use the API key.</p>
                    <button className="primary" onClick={() => copyKey(readyTeam.apiKey)}>Copy API key</button>
                    <p role="status">{copyStatus}</p>
                    <details key="new-team-key"><summary>Reveal API key</summary><code className="api-key">{readyTeam.apiKey}</code></details>
                    <p>You can find it again in <strong>Team &amp; API key</strong> in the bottom bar. {readyTeam.created ? "The tour starts after you launch an app." : "Your connection is saved in this browser."}</p>
                    <button className="primary" onClick={continueToWorkspace}>{isMap ? place ? "Continue to desktop" : "Continue to map" : "Enter workspace"}</button>
                  </>
                ) : key ? (
                  <>
                    <p>Team <strong>{team}</strong> is saved in this browser. Your key connects the portals and your agent to the same shared world.</p>
                    <button onClick={() => copyKey(key)}>Copy API key</button>
                    <p role="status">{copyStatus}</p>
                    <details key="connected-team-key">
                      <summary>Reveal API key</summary>
                      <code className="api-key">{key}</code>
                    </details>
                    <button
                      onClick={() => {
                        saveKey("");
                        if (isMap) choosePlace(null);
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
                        teamRequestActive.current = true;
                        issue.mutate({ kind: "create", teamName: team.trim() });
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
                      <button className="primary" disabled={issue.isPending || issue.isSuccess}>
                        {issue.isPending && issue.variables.kind === "create" ? "Connecting your team…" : issue.isSuccess ? "Opening workspace…" : "Create or join team"}
                      </button>
                      <p>Team name: <strong>{normalizeTeamName(team) || "Enter a name above"}</strong>. Names use lowercase with no spaces. Anyone entering the same name joins the same world. This browser remembers your connection.</p>
                    </form>
                    <details>
                      <summary>Use an existing team key</summary>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          teamRequestActive.current = true;
                          issue.mutate({ kind: "connect", apiKey: keyInput.trim() });
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
                        <button disabled={issue.isPending || issue.isSuccess}>{issue.isPending && issue.variables.kind === "connect" ? "Connecting…" : issue.isSuccess ? "Opening workspace…" : "Connect"}</button>
                      </form>
                    </details>
                    {issue.error && <p role="alert">{issue.error.message}</p>}
                  </>
                )}
              </>
            )}
            {drawer === "simulation" && (
              <>
                <h2>Simulation time</h2>
                <p>Advance this team's world to see delayed results, deliveries and home visits.</p>
                {clock.data && <p><strong>{new Date(clock.data.now).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</strong> · {clock.data.paused ? "Paused" : `Running at ${clock.data.speed}×`}</p>}
                {!key && <p>Connect your team to control its simulation time.</p>}
                {key && clock.isPending && <p role="status">Loading simulation clock…</p>}
                <div className="control-row">
                  <button
                    disabled={!clock.data || clockChange.isPending}
                    onClick={() =>
                      clockChange.mutate({ paused: !clock.data?.paused })
                    }
                  >
                    {clock.data?.paused ? "Run" : "Pause"}
                  </button>
                  {[15, 60, 121, 1440].map((minutes) => (
                    <button
                      key={minutes}
                      disabled={!clock.data || clockChange.isPending}
                      onClick={() =>
                        clockChange.mutate({ paused: true, advanceMinutes: minutes })
                      }
                    >
                      {minutes === 1440 ? "+1 day" : `+${minutes} minutes`}
                    </button>
                  ))}
                </div>
                <p>Advancing time pauses the clock and processes scheduled activity.</p>
                <p role="status" aria-live="polite">
                  {clockChange.isPending
                    ? ("advanceMinutes" in clockChange.variables ? `Advancing ${clockChange.variables.advanceMinutes} minutes…` : (clockChange.variables.paused ? "Pausing…" : "Starting…"))
                    : clockChange.isSuccess
                      ? ("advanceMinutes" in clockChange.variables ? `Advanced ${clockChange.variables.advanceMinutes} minutes. Clock paused.` : (clockChange.variables.paused ? "Clock paused." : "Clock running."))
                      : ""}
                </p>
                {(clockChange.error || clock.error) && <p role="alert">{(clockChange.error ?? clock.error)?.message}</p>}
                <details open>
                  <summary>Activity trail</summary>
                  {clock.data?.events.length === 0 && <p>No activity yet. Advance time or save a record to start this team's trail.</p>}
                  {clock.data?.events.slice(0, 20).map((event) => (
                    <p key={event.id}>
                      {new Date(event.time).toISOString().slice(11, 16)} UTC · {event.actor} · {event.detail}
                    </p>
                  ))}
                </details>
              </>
            )}
            {drawer === "operator" && <OperatorConsole api={api} />}
            {notice && drawer !== "simulation" && drawer !== "operator" && <p role="alert">{notice}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function DocumentPortal(props: React.ComponentProps<typeof SystemWorkspace>) {
  return <DocumentWorkspace api={props.api} worldId={props.view.id} mode="gp" selectedPatient={props.selectedPatient} patients={props.patients} standalone />;
}

function MessagingPortal(props: React.ComponentProps<typeof SystemWorkspace>) {
  return <MessagingWorkspace api={props.api} worldId={props.view.id} role={props.siteId === "wearables" ? "patient" : "practice"} selectedPatient={props.selectedPatient} patients={props.patients} patientMatches={props.patientMatches} patientSearch={props.patientSearch} searchPatients={props.searchPatients} selectPatient={props.selectPatient} />;
}
