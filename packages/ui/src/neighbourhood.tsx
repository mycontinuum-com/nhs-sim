import React, { useEffect, useRef, useState } from "react";
import "./neighbourhood.css";
const assets = {
  "neighbourhood-v2": "/control/world/neighbourhood-v2.5f600ac647e4.webp",
  "documanana": "/control/world/documanana.d17145d30597.webp",
  "cistoo": "/control/world/cistoo.4551d6a902b7.webp",
  "carebnb": "/control/world/carebnb.efc30b2d85b3.webp",
  "inaccurx": "/control/world/inaccurx.62cc9b00ceca.webp",
  "proscrip-ish": "/control/world/proscrip-ish.199068fd1efa.webp",
  "witherings": "/control/world/witherings.97004cccf5b8.webp",
  "millenni-ish": "/control/world/millenni-ish.4a28ec7a07c2.webp",
  "systemtwo": "/control/world/systemtwo.e90ef2c50330.webp"
};
const places = [
  {
    id: "practice",
    title: "Riverside Practice",
    label: "Primary care",
    description: "Choose SystemTwo for patient records, DocuMañana for letters, or InaccuRx for conversations.",
    href: "/gp/",
    x: 23,
    y: 44,
    system: "SystemTwo",
  },
  {
    id: "hospital",
    title: "Northbank General",
    label: "Secondary care",
    description: "Work the ward list and coordinate discharge in Millenni-ish EPR.",
    href: "/hospital/",
    x: 75,
    y: 39,
    system: "Millenni-ish EPR",
  },
  {
    id: "community",
    title: "Neighbourhood Care",
    label: "Community",
    description: "Arrange home visits and follow the handover from hospital to home.",
    href: "/community/",
    x: 49,
    y: 64,
    system: "CareBnB",
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
    system: "NoobScript",
  },
  {
    id: "home",
    title: "At home",
    label: "At home",
    description:
      "Choose a resident, open their messages from the practice, or explore their wearable health dashboard.",
    href: "/wearables/",
    x: 17,
    y: 73,
    system: "Witherings",
  },
];
const apps = {
  gp: { name: "SystemTwo", detail: "Patient records & appointments", href: "/gp/", icon: "systemtwo" },
  documents: { name: "DocuMañana", detail: "Letters & document processing", href: "/gp/documents/", icon: "documanana" },
  messaging: { name: "InaccuRx", detail: "Patient conversations", href: "/gp/messages/", icon: "inaccurx" },
  hospital: { name: "Millenni-ish", detail: "Emergency department, wards & patient charts", href: "/hospital/", icon: "millenni-ish" },
  community: { name: "CareBnB", detail: "Caseloads & home visits", href: "/community/", icon: "carebnb" },
  pharmacy: { name: "NoobScript", detail: "Dispensing, stock & purchasing", href: "/pharmacy/", icon: "proscrip-ish" },
  health: { name: "Witherings", detail: "Your health & connected devices", href: "/wearables/", icon: "witherings" },
  messages: { name: "Messages", detail: "Conversations with your practice", href: "/wearables/messages/", icon: "inaccurx" },
  identity: { name: "CIS-too", detail: "Staff identity & smartcard sign-in", href: "/cis2/", icon: "cistoo" },
} satisfies Record<string, { name: string; detail: string; href: string; icon: keyof typeof assets }>;
const installed: Record<string, (keyof typeof apps)[]> = {
  practice: ["gp", "documents", "messaging", "identity"],
  hospital: ["hospital", "identity"],
  community: ["community", "identity"],
  pharmacy: ["pharmacy", "identity"],
  home: ["health", "messages"],
};
export function Neighbourhood({ enter, suspended, connected, place, choose, now, openTeam }: { enter: (href: string) => void; suspended: boolean; connected: boolean; place: string | null; choose: (place: string | null) => void; now?: number; openTeam: () => void }) {
  const desktopRef = useRef<HTMLDialogElement>(null);
  const [startOpen, setStartOpen] = useState(false);
  const time = now ? new Date(now).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" }) : "09:41";
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = places.find((item) => item.id === place);
  useEffect(() => {
    if (selected && !connected && !suspended) openTeam();
  }, [selected, connected, suspended, openTeam]);
  useEffect(() => {
    const dialog = desktopRef.current;
    if (selected && connected && !suspended) { if (dialog && !dialog.open) dialog.showModal(); }
    else { dialog?.close(); if (!selected) triggerRef.current?.focus(); }
  }, [selected, connected, suspended]);
  useEffect(() => { setStartOpen(false); }, [place]);
  return <>
    <main className="world-map" aria-label="Interactive neighbourhood map">
      <div className="map-intro">
        <span>A SYNTHETIC HEALTH NEIGHBOURHOOD</span>
        <h1>Where would you like to work?</h1>
        <p>Choose a building, then launch an app.<span className="map-mobile-hint"> Swipe the map or open Places below.</span></p>
      </div>
      <div className="map-landscape">
        <img src={assets["neighbourhood-v2"]} width={1536} height={1024} fetchPriority="high" decoding="async"
          alt="Illustrated English neighbourhood with Riverside GP practice to the west, Northbank hospital to the east, a community centre and high street pharmacy beside the river" />
        {places.map((item) => <button key={item.id} className="map-place"
          style={{ left: item.x + "%", top: item.y + "%" }} aria-label={`Explore ${item.title}`}
          onClick={(event) => { triggerRef.current = event.currentTarget; choose(item.id); }}>
          <span className="map-pin" /><span className="map-label"><small>{item.label}</small>{item.title}</span>
        </button>)}
      </div>
      <footer className="map-footer"><span>Fictional people. Shared records. Consequences over time.</span>
        <details><summary>Places</summary><nav aria-label="Accessible place directory">
          {places.map((item) => <button key={item.id} onClick={(event) => { triggerRef.current = event.currentTarget; choose(item.id); }}>
            {item.title}<small>{item.system}</small>
          </button>)}
        </nav></details>
      </footer>
    </main>
    {selected && <dialog ref={desktopRef} className={`location-launcher ${selected.id === "home" ? "location-home" : "location-desktop"}`} aria-label={`${selected.title} ${selected.id === "home" ? "phone" : "desktop"}`} onCancel={(event) => { event.preventDefault(); choose(null); }} onClick={(event) => { if (event.target === event.currentTarget) choose(null); }}>
      <header className="location-toolbar">
        <span>{selected.title} · {selected.id === "home" ? "iPhone" : "Remote Desktop"}</span>
        <button autoFocus onClick={() => choose(null)} aria-label="Close and return to map">×</button>
      </header>
      <div className={selected.id === "home" ? "launcher-phone" : "launcher-desktop"}>
        {selected.id === "home" ? <>
          <div className="phone-status"><span>{time}</span><span className="phone-island" aria-hidden="true" /><span className="phone-radio" aria-label="Full signal and battery"><span className="phone-signal" aria-hidden="true"><i /><i /><i /><i /></span><span className="phone-wifi" aria-hidden="true" /><span className="phone-battery" aria-hidden="true" /></span></div>
          <div className="phone-widget"><span>RIVERSIDE</span><strong>{time}</strong><small>Your health neighbourhood</small></div>
        </> : <div className="xp-watermark"><strong>{selected.title}</strong><span>NHS-SIM · Fictional training workstation</span></div>}
        <nav className="launcher-apps" aria-label="Installed apps">
          {(installed[selected.id] ?? []).map((id) => {
            const app = apps[id];
            return <button key={id} className="launcher-app" onClick={() => enter(app.href)} aria-label={`Open ${app.name}`} title={app.detail}>
              <span className="shortcut-icon">{selected.id === "home" && id === "messages" ? <span className="ios-messages-icon" aria-hidden="true" /> : <img src={assets[app.icon]} alt="" width={64} height={64} />}{selected.id !== "home" && <i aria-hidden="true">↗</i>}</span>
              <strong>{app.name}</strong>
            </button>;
          })}
        </nav>
        {selected.id !== "home" && startOpen && <nav className="xp-start-menu" id="xp-start-menu" aria-label="Start menu">
          <header>{selected.title}</header>
          {(installed[selected.id] ?? []).map((id) => <button key={id} onClick={() => enter(apps[id].href)}><img src={assets[apps[id].icon]} width={32} height={32} alt="" /><span>{apps[id].name}<small>{apps[id].detail}</small></span></button>)}
          <footer><button onClick={openTeam}>Team & API key</button><button onClick={() => choose(null)}>Back to map</button></footer>
        </nav>}
        {selected.id === "home" ? <nav className="phone-dock" aria-label="Phone dock">
          <button onClick={() => choose(null)}><span className="dock-map" aria-hidden="true">⌖</span><small>Map</small></button>
          <a href="/docs/"><span className="dock-guide" aria-hidden="true">▤</span><small>Handbook</small></a>
          <button onClick={openTeam}><span className="dock-settings" aria-hidden="true">⚙</span><small>Team</small></button>
        </nav> : <footer className="launcher-taskbar">
          <button className="xp-start" aria-expanded={startOpen} aria-controls="xp-start-menu" onClick={() => setStartOpen(!startOpen)}><span aria-hidden="true">▦</span>start</button>
          <button className="xp-map-task" onClick={() => choose(null)}>Neighbourhood map</button>
          <a href="/docs/">Handbook</a>
          <button className="xp-tray" onClick={openTeam} aria-label="Team and API key"><span aria-hidden="true">♧</span> {time}<small>SIMULATION</small></button>
        </footer>}
        {selected.id === "home" && <div className="phone-home-indicator" aria-hidden="true" />}
      </div>
    </dialog>}
  </>;
}
