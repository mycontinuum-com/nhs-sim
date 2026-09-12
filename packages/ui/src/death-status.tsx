import React from "react";
import type { Patient } from "../../contracts/src/index.ts";
import "./death-status.css";

export function ageAtDeath(patient: Patient): number | undefined {
  if (!patient.death) return undefined;
  const born = new Date(patient.birthDate);
  const died = new Date(patient.death.date);
  const birthdayPassed = died.getUTCMonth() > born.getUTCMonth()
    || (died.getUTCMonth() === born.getUTCMonth() && died.getUTCDate() >= born.getUTCDate());
  return died.getUTCFullYear() - born.getUTCFullYear() - (birthdayPassed ? 0 : 1);
}

export function DeathStatus({ patient, compact = false }: { patient?: Patient; compact?: boolean }) {
  if (!patient?.death) return null;
  const date = new Date(patient.death.date).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  return <span className={`patient-death-status${compact ? " patient-death-compact" : ""}`}>
    <strong>Deceased</strong>
    <span><time dateTime={patient.death.date}>{date}</time> · Age at death: {ageAtDeath(patient)}</span>
    {!compact && <span>Recorded cause: {patient.death.cause}</span>}
  </span>;
}
