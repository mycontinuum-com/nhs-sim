import React from "react";
import "./product-brand.css";
const brands = {
  gp: { name: "GP Records", asset: "gp-records", line: "Patient records and appointments" },
  hospital: { name: "Hospital EPR", asset: "hospital-epr", line: "Inpatient records and hospital operations" },
  pharmacy: { name: "Pharmacy", asset: "pharmacy", line: "Dispensing, stock and purchasing" },
  community: { name: "Community Care", asset: "community-care", line: "Caseloads and home visits" },
  wearables: { name: "Home Health", asset: "home-health", line: "Your health and connected devices" },
  documents: { name: "Document Inbox", asset: "document-inbox", line: "Letters and document processing" },
  messaging: { name: "Messagey", asset: "messagey", line: "Patient conversations" },
  telephony: { name: "Reception Calls", asset: "reception-calls", line: "Reception calls and team switchboard" },
  identity: { name: "Staff Identity", asset: "staff-identity", line: "Simulated staff sign-in" },
} as const;
export function ProductBrand({ product, compact = false }: { product: keyof typeof brands; compact?: boolean }) {
  const brand = brands[product];
  return <span className={`product-brand product-brand-${product}${compact ? " product-brand-compact" : ""}`}>
    <img src={`/control/brands/${brand.asset}.svg`} alt="" width={44} height={44} />
    <span><strong>{brand.name}</strong>{!compact && <small>{brand.line}</small>}</span>
  </span>;
}
