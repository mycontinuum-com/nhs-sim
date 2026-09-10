import React from "react";
import "./plan-exploration.css";

const source = "https://www.gov.uk/government/publications/10-year-health-plan-for-england-fit-for-the-future/fit-for-the-future-10-year-health-plan-for-england-executive-summary";

const shifts = [
  {
    title: "Hospital to community",
    question: "What gets lost when care moves between services?",
    context: "Follow Amira Khan (SIM-000001) across her hospital records, practice follow-up and medicines. Compare what each service can see and what is still waiting.",
    places: [
      { title: "Hospital record", href: "/hospital/?patient=SIM-000001" },
      { title: "Practice follow-up", href: "/gp/?patient=SIM-000001" },
      { title: "Pharmacy", href: "/pharmacy/?patient=SIM-000001" },
      { title: "Community care", href: "/community/?patient=SIM-000001" },
    ],
  },
  {
    title: "Analogue to digital",
    question: "Does information reach the person who needs it?",
    context: "Compare Eleanor Chen's (SIM-000006) home readings with her practice and community records. Inspect record visibility, attribution and staff identity as you explore where information is available.",
    places: [
      { title: "Home readings", href: "/wearables/?patient=SIM-000006" },
      { title: "Practice record", href: "/gp/?patient=SIM-000006" },
      { title: "Community record", href: "/community/?patient=SIM-000006" },
      { title: "Staff identity", href: "/cis2/" },
    ],
  },
  {
    title: "Sickness to prevention",
    question: "How could services notice an unmet need earlier?",
    context: "Explore Eleanor Chen's (SIM-000006) history, appointments and home readings. Consider what these records reveal, what they leave out, and who would need to follow up.",
    places: [
      { title: "Practice history", href: "/gp/?patient=SIM-000006" },
      { title: "Home readings", href: "/wearables/?patient=SIM-000006" },
      { title: "Community visits", href: "/community/?patient=SIM-000006" },
    ],
  },
];

export function PlanExploration({ enter, close }: { enter: (href: string) => void; close: () => void }) {
  return (
    <section id="plan-exploration" className="plan-exploration" aria-labelledby="plan-title">
      <div className="plan-exploration-intro">
        <div>
          <p className="eyebrow">THE TEN-YEAR HEALTH PLAN FOR ENGLAND</p>
          <h2 id="plan-title">Bring a problem into the neighbourhood</h2>
          <p>Read the plan, choose a problem that interests you, then explore it through the people and services here. These questions are starting points for your own investigation.</p>
          <a href={source} target="_blank" rel="noreferrer">Read the full executive summary ↗</a>
          <a href="/docs/ten-year-plan/">About exploring the plan</a>
        </div>
        <button onClick={close} aria-label="Close plan exploration">Close</button>
      </div>
      <div className="plan-shifts">
        {shifts.map((shift) => (
          <details key={shift.title}>
            <summary>{shift.title}</summary>
            <h3>{shift.question}</h3>
            <p>{shift.context}</p>
            <nav aria-label={`${shift.title} workplaces`}>
              {shift.places.map((place) => (
                <a key={place.href} href={place.href} onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  enter(place.href);
                }}>{place.title} →</a>
              ))}
            </nav>
          </details>
        ))}
      </div>
      <p className="plan-exploration-note">Opening a place shows your team's existing records. The fictional data can help you examine service workflows; it does not predict clinical outcomes or national progress.</p>
    </section>
  );
}
