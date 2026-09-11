import React from "react";
import "./product-brand.css";
const brands = {
  gp: { name: "SystemTwo", asset: "systemtwo", line: "Twice the system. Same number of clicks." },
  hospital: { name: "Millenni-ish", asset: "millenni-ish", line: "Cernerish clinical systems" },
  pharmacy: { name: "NoobScript", asset: "proscrip-ish", line: "Dispensing with a margin of error." },
  community: { name: "CareBnB", asset: "carebnb", line: "Home visits. No cleaning fee." },
  wearables: { name: "Witherings", asset: "witherings", line: "Every step counts. Eventually." },
  documents: { name: "DocuMañana", asset: "documanana", line: "Today's letters. Tomorrow's problem." },
  messaging: { name: "Fax & Furious", asset: "fax-and-furious", line: "Family. Forms. Follow-ups." },
  telephony: { name: "Surgery Disconnect", asset: "surgery-disconnect", line: "Please continue to hold." },
  identity: { name: "CIS-too", asset: "cistoo", line: "You again?" },
} as const;
export function ProductBrand({ product, compact = false }: { product: keyof typeof brands; compact?: boolean }) {
  const brand = brands[product];
  return <span className={`product-brand product-brand-${product}${compact ? " product-brand-compact" : ""}`}>
    <img src={`/control/brands/${brand.asset}.png`} alt="" width={44} height={44} />
    <span><strong>{brand.name}</strong>{!compact && <small>{brand.line}</small>}</span>
  </span>;
}
