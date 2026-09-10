import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action, Patient, Resource } from "../../contracts/src/index.ts";
import {
  pharmacyPathways,
  pharmacyProductSchema,
  pharmacyReferralSchema,
  supplierQuoteSchema,
  purchaseOrderSchema,
} from "../../contracts/src/pharmacy.ts";
import type { WorkflowApi } from "./gp-workflows.tsx";
import { RecordAttribution } from "./record-attribution.tsx";
import "./pharmacy-workspace.css";
type Props = {
  api: WorkflowApi;
  view: { id: string };
  selectedPatient: string;
  selectPatient: (id: string) => void;
  patientSearch: string;
  searchPatients: (text: string) => void;
  patientMatches: Patient[];
  patients: Patient[];
  exitToMap?: () => void;
};
const money = (pence: number) => "£" + (pence / 100).toFixed(2);
const date = (n: number) =>
  new Date(n).toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
export function PharmacyWorkspace(props: Props) {
  const client = useQueryClient();
  const [tab, setTab] = useState("Dispensing bench");
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState<"referral" | "prescription" | null>(null);
  const [notice, setNotice] = useState("");
  const data = useQuery({
    queryKey: ["pharmacy-workspace", props.view.id],
    queryFn: () =>
      props.api<{ resources: Resource[]; patients: Patient[]; now: number }>(
        "/api/sites/pharmacy/pharmacy-workspace",
      ),
    refetchInterval: 5000,
  });
  const change = useMutation({
    mutationFn: (action: Action) => props.api<Resource>("/api/sites/pharmacy/actions", action),
    onSuccess: (r) => {
      setNotice("Saved · " + r.title);
      setForm(null);
      setSelected(r.id);
      if (r.kind === "pharmacy-order") setTab("Purchasing");
      void client.invalidateQueries();
    },
  });
  const all = data.data?.resources ?? [];
  const products = all.flatMap((r) => {
    const parsed = r.kind === "pharmacy-product" ? pharmacyProductSchema.safeParse(r.data) : null;
    return parsed?.success ? [{ resource: r, product: parsed.data }] : [];
  });
  const kind =
    tab === "Purchasing"
      ? "pharmacy-order"
      : tab === "Pharmacy First"
        ? "pharmacy-referral"
        : tab === "Stock & prices"
          ? "pharmacy-product"
          : tab === "Movement ledger"
            ? "pharmacy-movement"
            : "prescription";
  const rows = all.filter(
    (r) =>
      r.kind === kind &&
      (!props.selectedPatient || !r.patientId || r.patientId === props.selectedPatient),
  );
  const record = rows.find((r) => r.id === selected);
  const name = (id?: string) =>
    data.data?.patients.find((p) => p.id === id)?.name ??
    props.patients.find((p) => p.id === id)?.name ??
    id ??
    "Stock catalogue";
  const act = (action: Action) => change.mutate(action);
  return (
    <div className="pharmacy-workspace">
      <header className="rx-header">
        <div className="rx-brand">
          <span>✚</span>
          <div>
            <b>Counterpart</b>
            <small>HIGH STREET PHARMACY · SIMULATION</small>
          </div>
        </div>
        <div className="rx-header-right">
          <span>{data.data ? date(data.data.now) : "Opening dispensary…"}</span>
          <a href="/docs/pharmacy/">Pharmacy guide ↗</a>
          <button onClick={props.exitToMap}>Neighbourhood map</button>
        </div>
      </header>
      <section className="rx-overview">
        <div>
          <p>COMMUNITY PHARMACY WORKSPACE</p>
          <h1>Dispensary</h1>
          <span>Referrals, medicines and stock in one working dispensary.</span>
        </div>
        <div className="rx-stat">
          <b>
            {
              all.filter(
                (r) => r.kind === "prescription" && !["collected", "cancelled"].includes(r.status),
              ).length
            }
          </b>
          <span>Open prescriptions</span>
        </div>
        <div className="rx-stat">
          <b>
            {all.filter((r) => r.kind === "pharmacy-referral" && r.status !== "completed").length}
          </b>
          <span>Pharmacy First</span>
        </div>
        <div className="rx-stat">
          <b>{products.filter((p) => p.product.stock <= p.product.reorderLevel).length}</b>
          <span>Stock to reorder</span>
        </div>
      </section>
      <nav className="rx-tabs" aria-label="Pharmacy areas">
        {[
          "Dispensing bench",
          "Pharmacy First",
          "Stock & prices",
          "Purchasing",
          "Movement ledger",
        ].map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => {
              setTab(t);
              setSelected("");
              setForm(null);
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="rx-financial">
        <span>
          Stock at cost{" "}
          <b>{money(products.reduce((sum, p) => sum + p.product.stockCostPence, 0))}</b>
        </span>
        <span>
          Received purchases{" "}
          <b>
            {money(
              all
                .filter((r) => r.kind === "pharmacy-movement")
                .reduce((sum, r) => sum + Number(r.data.acquisitionPence ?? 0), 0),
            )}
          </b>
        </span>
        <span>
          Dispensing revenue{" "}
          <b>
            {money(
              all
                .filter((r) => r.kind === "pharmacy-movement")
                .reduce((sum, r) => sum + Number(r.data.revenuePence ?? 0), 0),
            )}
          </b>
        </span>
        <span>
          Gross margin{" "}
          <b>
            {money(
              all
                .filter((r) => r.kind === "pharmacy-movement" && r.data.prescriptionId)
                .reduce(
                  (sum, r) =>
                    sum + Number(r.data.revenuePence ?? 0) - Number(r.data.costPence ?? 0),
                  0,
                ),
            )}
          </b>
        </span>
        <small>Simulated ledger · weighted-average stock cost · excludes overheads</small>
      </div>
      <div className="rx-directory care-search">
        <label>
          Find patient
          <input
            value={props.patientSearch}
            onChange={(e) => props.searchPatients(e.target.value)}
            placeholder="Name or SIM identifier"
          />
        </label>
        <label>
          Patient context
          <select
            value={props.selectedPatient}
            onChange={(e) => props.selectPatient(e.target.value)}
          >
            <option value="">All patients</option>
            {props.patientMatches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.id}
              </option>
            ))}
            {props.selectedPatient &&
              !props.patientMatches.some((p) => p.id === props.selectedPatient) && (
                <option value={props.selectedPatient}>{name(props.selectedPatient)}</option>
              )}
          </select>
        </label>
        <button
          onClick={() => {
            setTab("Pharmacy First");
            setForm("referral");
          }}
        >
          + Receive referral
        </button>
        <button
          className="rx-primary"
          onClick={() => {
            setTab("Dispensing bench");
            setForm("prescription");
          }}
        >
          + New prescription
        </button>
      </div>
      {change.isError && (
        <p className="rx-notice" role="alert">
          {change.error.message}
        </p>
      )}
      {notice && (
        <p className="rx-notice" role="status">
          {notice}
        </p>
      )}
      {data.isPending && (
        <p className="rx-notice" role="status">
          Loading pharmacy records…
        </p>
      )}
      {data.isError && <p role="alert">{data.error.message}</p>}
      <main className="rx-main">
        <section className="rx-list">
          <div className="rx-section-title">
            <h2>{tab}</h2>
            <span>{rows.length} records</span>
          </div>
          {tab === "Stock & prices" && (
            <p className="rx-caption">
              Quantities are individual units. All pack prices are simulated, not NHS tariffs.
            </p>
          )}
          <div className="rx-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    {kind === "pharmacy-product"
                      ? "Product / formulation"
                      : kind === "pharmacy-order"
                        ? "Product / supplier"
                        : kind === "pharmacy-movement"
                          ? "Product / movement"
                          : "Patient / record"}
                  </th>
                  <th>
                    {kind === "pharmacy-product"
                      ? "On hand"
                      : kind === "pharmacy-movement"
                        ? "Units"
                        : "Status"}
                  </th>
                  <th>
                    {kind === "pharmacy-product"
                      ? "Indicative pack price"
                      : kind === "pharmacy-order"
                        ? "Total / delivery due"
                        : "Recorded"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const product = products.find((p) => p.resource.id === r.id)?.product;
                  const relatedProduct = products.find(
                    (p) => p.resource.id === r.data.productId,
                  )?.product;
                  const order =
                    r.kind === "pharmacy-order" ? purchaseOrderSchema.parse(r.data) : null;
                  return (
                    <tr key={r.id} aria-selected={r.id === selected}>
                      <td>
                        <button
                          onClick={() => {
                            setSelected(r.id);
                            setForm(null);
                          }}
                        >
                          <strong>
                            {product?.drug ?? relatedProduct?.drug ?? name(r.patientId)}
                          </strong>
                          <span>
                            {product
                              ? product.formulation + " · " + product.packSize + " units/pack"
                              : r.title}
                          </span>
                        </button>
                      </td>
                      <td>
                        {product ? (
                          <>
                            <b>{product.stock}</b> units{" "}
                            {product.stock <= product.reorderLevel && (
                              <small className="rx-low">Reorder</small>
                            )}
                          </>
                        ) : r.kind === "pharmacy-movement" ? (
                          <span>
                            {Number(r.data.quantity) > 0 ? "+" : ""}
                            {Number(r.data.quantity ?? 0)}
                          </span>
                        ) : (
                          <span className="rx-status">{r.status}</span>
                        )}
                      </td>
                      <td>
                        {product ? (
                          money(product.pricePence)
                        ) : order ? (
                          <>
                            <strong>{money(order.totalPence)}</strong>
                            <span>{date(order.dueAt)}</span>
                          </>
                        ) : (
                          date(r.createdAt)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <p className="rx-empty">
              No records in this view. Select all patients or start a new referral or prescription.
            </p>
          )}
        </section>
        <aside className="rx-bench">
          {form ? (
            <form
              key={form}
              onSubmit={(e) => {
                e.preventDefault();
                const fields = new FormData(e.currentTarget);
                const title = String(fields.get("title"));
                if (form === "prescription")
                  act({ type: "draft_prescription", patientId: props.selectedPatient, title });
                else {
                  const pathway = pharmacyPathways.find((p) => p === fields.get("pathway"));
                  const source = fields.get("source");
                  if (pathway)
                    act({
                      type: "receive_pharmacy_referral",
                      patientId: props.selectedPatient,
                      title,
                      pharmacyPathway: pathway,
                      referralSource:
                        source === "hospital"
                          ? "hospital"
                          : source === "patient"
                            ? "patient"
                            : source === "referrals"
                              ? "referrals"
                              : "gp",
                    });
                }
              }}
            >
              <h2>
                {form === "referral" ? "Receive Pharmacy First referral" : "New prescription"}
              </h2>
              <p>
                {props.selectedPatient
                  ? name(props.selectedPatient)
                  : "Choose a patient above to continue."}
              </p>
              <label>
                {form === "referral" ? "Reason for referral" : "Prescription description"}
                <textarea name="title" required maxLength={500} />
              </label>
              {form === "referral" && (
                <>
                  <label>
                    Pathway / referral type
                    <select name="pathway">
                      {pharmacyPathways.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Referring service
                    <select name="source">
                      <option value="gp">GP practice</option>
                      <option value="hospital">Hospital / A&E</option>
                      <option value="referrals">NHS 111 / referral hub</option>
                      <option value="patient">Walk-in / patient</option>
                    </select>
                  </label>
                  <p className="rx-caption">
                    Record a fictional referral. Pathway eligibility and clinical decisions are made
                    by the participant; no treatment is recommended automatically.
                  </p>
                </>
              )}
              <button disabled={change.isPending || !props.selectedPatient} className="rx-primary">
                Save {form}
              </button>
              <button type="button" onClick={() => setForm(null)}>
                Cancel
              </button>
            </form>
          ) : record ? (
            <PharmacyDetail
              key={record.id + ":" + record.version}
              record={record}
              movements={all.filter((r) => r.kind === "pharmacy-movement")}
              now={data.data?.now ?? 0}
              quotes={all.filter((r) => r.kind === "pharmacy-quote")}
              products={products}
              name={name(record.patientId)}
              act={act}
              pending={change.isPending}
            />
          ) : (
            <div className="rx-empty-bench">
              <span>Rx</span>
              <h2>
                {tab === "Pharmacy First"
                  ? "Consultation room"
                  : tab === "Stock & prices"
                    ? "Stock control"
                    : "The checking bench"}
              </h2>
              <p>
                Open a record from the list to work on it here. Every saved change stays in your
                team's world with its author.
              </p>
              <div className="rx-paper">
                <b>COUNTERPART / DAILY CHECK</b>
                <p>Receive → Review → Approve → Dispense → Collect</p>
                <small>Synthetic prescriptions and prices · Not for real dispensing</small>
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
function PharmacyDetail({
  record: r,
  quotes,
  movements,
  now,
  products,
  name,
  act,
  pending,
}: {
  record: Resource;
  now: number;
  movements: Resource[];
  quotes: Resource[];
  products: { resource: Resource; product: ReturnType<typeof pharmacyProductSchema.parse> }[];
  name: string;
  act: (a: Action) => void;
  pending: boolean;
}) {
  const base = { resourceId: r.id, expectedVersion: r.version };
  const product = products.find((p) => p.resource.id === r.id)?.product;
  const referral = r.kind === "pharmacy-referral" ? pharmacyReferralSchema.safeParse(r.data) : null;
  return (
    <section>
      <p className="rx-caption">
        {r.id} · VERSION {r.version}
      </p>
      <h2>{r.title}</h2>
      {r.patientId && <h3>{name}</h3>}
      <span className="rx-status">{r.status}</span>
      {referral?.success && (
        <>
          <dl>
            <dt>Pathway</dt>
            <dd>{referral.data.pathway}</dd>
            <dt>Referring service</dt>
            <dd>{referral.data.source}</dd>
            <dt>Received</dt>
            <dd>{date(referral.data.receivedAt)}</dd>
          </dl>
          {r.status === "received" && (
            <button
              disabled={pending}
              onClick={() =>
                act({ ...base, type: "update_pharmacy_referral", pharmacyCommand: "accept" })
              }
            >
              Accept referral
            </button>
          )}
          {r.status === "accepted" && (
            <button
              disabled={pending}
              onClick={() =>
                act({ ...base, type: "update_pharmacy_referral", pharmacyCommand: "consult" })
              }
            >
              Start consultation
            </button>
          )}
          {r.status === "consulting" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act({
                  ...base,
                  type: "update_pharmacy_referral",
                  pharmacyCommand: "complete",
                  text: String(new FormData(e.currentTarget).get("outcome")),
                });
              }}
            >
              <label>
                Consultation outcome
                <textarea
                  required
                  name="outcome"
                  maxLength={20000}
                  placeholder="Record assessment, outcome and any onward referral."
                />
              </label>
              <button disabled={pending} className="rx-primary">
                Complete & return to referrer
              </button>
            </form>
          )}
          {referral.data.outcome && (
            <div className="rx-paper">
              <b>
                Outcome shared with{" "}
                {referral.data.source === "gp"
                  ? "GP practice"
                  : referral.data.source + " and GP practice"}
              </b>
              <p>{referral.data.outcome}</p>
            </div>
          )}
        </>
      )}
      {r.kind === "pharmacy-order" &&
        (() => {
          const order = purchaseOrderSchema.parse(r.data);
          return (
            <>
              <dl>
                <dt>Product</dt>
                <dd>
                  {products.find((p) => p.resource.id === order.productId)?.product.drug ??
                    order.productId}
                </dd>
                <dt>Supplier</dt>
                <dd>{order.supplier}</dd>
                <dt>Quantity</dt>
                <dd>
                  {order.packs} packs × {order.packSize} units
                </dd>
                <dt>Order total</dt>
                <dd>{money(order.totalPence)}</dd>
                <dt>Delivery due</dt>
                <dd>{date(order.dueAt)}</dd>
              </dl>
              {r.status === "ordered" && (
                <button
                  disabled={pending || now < order.dueAt}
                  onClick={() => act({ ...base, type: "receive_pharmacy_order" })}
                >
                  Receive ordered delivery
                </button>
              )}
              <p className="rx-caption">
                Advance simulation time to the due date, then record receipt. It adds stock and
                acquisition cost once.
              </p>
            </>
          );
        })()}
      {product && (
        <>
          <h3>Compare suppliers</h3>
          <ul className="rx-quotes">
            {quotes
              .filter((q) => q.data.productId === r.id)
              .map((quote) => (
                <SupplierOrder key={quote.id} record={quote} act={act} pending={pending} />
              ))}
          </ul>
          <p className="rx-caption">
            Fictional suppliers and prices. Orders appear in Purchasing. Historic order cost is
            fixed at placement.
          </p>
          <dl>
            <dt>Stock asset value</dt>
            <dd>{money(product.stockCostPence)}</dd>
            <dt>Received purchase costs</dt>
            <dd>
              {money(
                movements
                  .filter((m) => m.data.productId === r.id)
                  .reduce((sum, m) => sum + Number(m.data.acquisitionPence ?? 0), 0),
              )}
            </dd>
            <dt>Total dispensing costs</dt>
            <dd>
              {money(
                movements
                  .filter((m) => m.data.productId === r.id && m.data.prescriptionId)
                  .reduce((sum, m) => sum + Number(m.data.costPence ?? 0), 0),
              )}
            </dd>
            <dt>Stock on hand</dt>
            <dd>{product.stock} units</dd>
            <dt>Pack size</dt>
            <dd>{product.packSize} units</dd>
            <dt>Simulated cost / price per pack</dt>
            <dd>
              {money(product.costPence)} / {money(product.pricePence)}
            </dd>
          </dl>
          <details className="rx-disclosure">
            <summary>Receive an unlisted delivery</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act({
                  ...base,
                  type: "receive_stock",
                  quantity: Number(f.get("quantity")),
                  text: String(f.get("reference")),
                });
              }}
            >
              <h3>Receive delivery</h3>
              <label>
                Units received
                <input name="quantity" type="number" min="1" max="100000" required />
              </label>
              <label>
                Delivery reference
                <input name="reference" required maxLength={500} />
              </label>
              <button disabled={pending}>Receive stock</button>
            </form>
          </details>
          <details className="rx-disclosure">
            <summary>Edit prices and reorder level</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act({
                  ...base,
                  type: "update_stock_price",
                  costPence: Number(f.get("cost")),
                  pricePence: Number(f.get("price")),
                  reorderLevel: Number(f.get("reorder")),
                });
              }}
            >
              <h3>Prices & reorder</h3>
              <label>
                Simulated pack cost (pence)
                <input
                  name="cost"
                  type="number"
                  min="0"
                  required
                  defaultValue={product.costPence}
                />
              </label>
              <label>
                Indicative pack price (pence)
                <input
                  name="price"
                  type="number"
                  min="0"
                  required
                  defaultValue={product.pricePence}
                />
              </label>
              <label>
                Reorder below (units)
                <input
                  name="reorder"
                  type="number"
                  min="0"
                  required
                  defaultValue={product.reorderLevel}
                />
              </label>
              <button disabled={pending}>Save prices</button>
            </form>
          </details>
        </>
      )}
      {r.kind === "prescription" && (
        <>
          <ol className="rx-progress">
            {["draft", "reviewed", "approved", "dispensed", "collected"].map((s) => (
              <li key={s} aria-current={s === r.status ? "step" : undefined}>
                {s}
              </li>
            ))}
          </ol>
          {typeof r.data.drug === "string" && (
            <div className="rx-paper">
              <b>{r.data.drug}</b>
              <p>{String(r.data.quantity ?? "Not linked")} units</p>
              <small>Simulation dispensing record</small>
            </div>
          )}
          {!["dispensed", "collected"].includes(r.status) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act({
                  ...base,
                  type: "link_prescription_stock",
                  productId: String(f.get("product")),
                  quantity: Number(f.get("quantity")),
                });
              }}
            >
              <h3>Confirm supply item</h3>
              {typeof r.data.supplyDrug === "string" && (
                <p>
                  Linked supply: <b>{r.data.supplyDrug}</b>
                </p>
              )}
              <p className="rx-caption">
                Choose the item matching this fictional prescription. This does not make a clinical
                recommendation.
              </p>
              <label>
                Catalogue product
                <select
                  name="product"
                  required
                  defaultValue={typeof r.data.productId === "string" ? r.data.productId : ""}
                >
                  <option value="">Choose item</option>
                  {products.map((p) => (
                    <option value={p.resource.id} key={p.resource.id}>
                      {p.product.drug} · {p.product.stock} units
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity in units
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  required
                  defaultValue={typeof r.data.quantity === "number" ? r.data.quantity : 28}
                />
              </label>
              <button disabled={pending}>Link supply item</button>
            </form>
          )}
          {["open", "available", "draft"].includes(r.status) && (
            <button disabled={pending} onClick={() => act({ ...base, type: "review" })}>
              Record review
            </button>
          )}
          {["reviewed", "rejected"].includes(r.status) && (
            <button disabled={pending} onClick={() => act({ ...base, type: "accept" })}>
              Approve prescription
            </button>
          )}
          {r.status === "approved" && (
            <button
              disabled={pending || !r.data.productId}
              onClick={() => act({ ...base, type: "dispense" })}
            >
              Dispense & deduct stock
            </button>
          )}
          {r.status === "dispensed" && (
            <button disabled={pending} onClick={() => act({ ...base, type: "collect" })}>
              Confirm collection
            </button>
          )}
        </>
      )}
      {r.kind === "pharmacy-movement" && (
        <dl>
          {[
            ["productId", "Product"],
            ["quantity", "Units moved"],
            ["balance", "Units remaining"],
            ["reference", "Reference"],
            ["acquisitionPence", "Received cost"],
            ["costPence", "Dispensed cost"],
            ["revenuePence", "Dispensing revenue"],
          ].map(([key, label]) => (
            <React.Fragment key={key}>
              <dt>{label}</dt>
              <dd>
                {key && key.endsWith("Pence")
                  ? money(Number(r.data[key] ?? 0))
                  : String(r.data[key ?? ""] ?? "—")}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <RecordAttribution record={r} history />
    </section>
  );
}

function SupplierOrder({
  record,
  act,
  pending,
}: {
  record: Resource;
  act: (action: Action) => void;
  pending: boolean;
}) {
  const quote = supplierQuoteSchema.parse(record.data);
  const [packs, setPacks] = useState(String(quote.minimumPacks));
  return (
    <li>
      <details className="rx-disclosure">
        <summary>
          <b>
            {quote.supplier} · {money(quote.packCostPence)}/pack
          </b>
          <small>
            {quote.packSize} units/pack · minimum {quote.minimumPacks} packs · {quote.leadDays} day
            lead time
          </small>
        </summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            act({
              type: "place_pharmacy_order",
              resourceId: record.id,
              expectedVersion: record.version,
              quantity: Number(packs),
            });
          }}
        >
          <label>
            Packs to order
            <input
              type="number"
              required
              min={quote.minimumPacks}
              max="100000"
              value={packs}
              onChange={(event) => setPacks(event.target.value)}
            />
          </label>
          <p className="rx-order-total">
            {Number(packs) * quote.packSize} units · Order total{" "}
            <strong>{money(Number(packs) * quote.packCostPence)}</strong>
          </p>
          <button disabled={pending}>Place order with {quote.supplier}</button>
        </form>
      </details>
    </li>
  );
}
