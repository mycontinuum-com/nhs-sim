import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action, Resource } from "../../contracts/src/index.ts";
import {
  pharmacyProductSchema,
  supplierQuoteSchema,
  purchaseOrderSchema,
  pharmacyBasketSchema,
} from "../../contracts/src/pharmacy.ts";
import type { WorkflowApi } from "./gp-workflows.tsx";
import { RecordAttribution } from "./record-attribution.tsx";
import "./pharmacy-procurement.css";
const orderStatus = (status: string) =>
  status === "part-received" ? "Part received" : status.charAt(0).toUpperCase() + status.slice(1);
const money = (p: number) => `£${(p / 100).toFixed(2)}`;
const date = (n: number) =>
  new Date(n).toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const sections = ["Buy medicines", "Inventory", "Orders", "Stock activity", "Performance"] as const;
type Section = (typeof sections)[number] | "Basket";
const amount = (r: Resource, key: string) => (typeof r.data[key] === "number" ? r.data[key] : 0);
export function PharmacyProcurement({ api, worldId }: { api: WorkflowApi; worldId: string }) {
  const client = useQueryClient();
  const [section, setSection] = useState<Section>("Buy medicines");
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [required, setRequired] = useState(28);
  const [offerId, setOfferId] = useState("");
  const [notice, setNotice] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [activityProduct, setActivityProduct] = useState("");
  const [selectedMovement, setSelectedMovement] = useState("");
  const [editProduct, setEditProduct] = useState("");
  const data = useQuery({
    queryKey: ["pharmacy-workspace", worldId],
    queryFn: () =>
      api<{ resources: Resource[]; now: number }>("/api/sites/pharmacy/pharmacy-workspace"),
    refetchInterval: 5000,
  });
  const change = useMutation({
    mutationFn: (action: Action) => api<Resource>("/api/sites/pharmacy/actions", action),
    onSuccess: async (r, action) => {
      setNotice(
        action.type === "checkout_pharmacy_basket"
          ? "Orders placed. Your confirmed orders are below; stock arrives only when you receive delivery."
          : action.type === "update_pharmacy_basket"
            ? "Basket saved to your team. Review it before placing orders."
            : "Saved · " + r.title,
      );
      if (action.type === "checkout_pharmacy_basket") setSection("Orders");
      await client.invalidateQueries();
    },
  });
  const act = (action: Action) => {
    setNotice("");
    change.mutate(action);
  };
  const all = data.data?.resources ?? [];
  const products = all.flatMap((r) => {
    const p = r.kind === "pharmacy-product" ? pharmacyProductSchema.safeParse(r.data) : null;
    return p?.success ? [{ r, p: p.data }] : [];
  });
  const quotes = all.flatMap((r) => {
    const q = r.kind === "pharmacy-quote" ? supplierQuoteSchema.safeParse(r.data) : null;
    return q?.success ? [{ r, q: q.data }] : [];
  });
  const orders = all.flatMap((r) => {
    const o = r.kind === "pharmacy-order" ? purchaseOrderSchema.safeParse(r.data) : null;
    return o?.success ? [{ r, o: o.data }] : [];
  });
  const basketResource = all.find((r) => r.kind === "pharmacy-basket");
  const basketParsed = basketResource ? pharmacyBasketSchema.safeParse(basketResource.data) : null;
  const lines = basketParsed?.success ? basketParsed.data.lines : [];
  const suppliers = [...new Set(lines.map((l) => l.quote.supplier))];
  const delivery = suppliers.reduce(
    (sum, supplier) =>
      sum +
      Math.max(
        0,
        ...lines.filter((l) => l.quote.supplier === supplier).map((l) => l.quote.deliveryFeePence),
      ),
    0,
  );
  const basketTotal = lines.reduce((sum, l) => sum + l.packs * l.quote.packCostPence, 0) + delivery;
  const productName = (id: string) => products.find((p) => p.r.id === id)?.p.drug ?? id;
  const onOrder = (id: string) =>
    orders
      .filter((o) => o.o.productId === id)
      .reduce(
        (sum, { o }) =>
          sum + Math.max(0, o.packs - o.receivedPacks - o.cancelledPacks) * o.packSize,
        0,
      );
  const product = products.find((p) => p.r.id === productId);
  const offers = quotes
    .filter((q) => q.q.productId === productId)
    .map(({ r, q }) => {
      const packs = Math.max(q.minimumPacks, Math.ceil(required / q.packSize));
      return { r, q, packs, total: packs * q.packCostPence + q.deliveryFeePence };
    })
    .sort((a, b) => a.total - b.total);
  const offer = offers.find((q) => q.r.id === offerId);
  const now = data.data?.now ?? 0;
  const movements = all.filter((r) => r.kind === "pharmacy-movement");
  const commitment = orders.reduce(
    (sum, { o }) =>
      sum +
      Math.max(0, o.packs - o.receivedPacks - o.cancelledPacks) * o.packCostPence +
      (o.receivedPacks === 0 && o.cancelledPacks === 0 ? o.deliveryFeePence : 0),
    0,
  );
  const cost = movements
    .filter((r) => r.data.prescriptionId)
    .reduce((sum, r) => sum + amount(r, "costPence"), 0);
  const revenue = movements.reduce((sum, r) => sum + amount(r, "revenuePence"), 0);
  const compare = (id: string) => {
    setProductId(id);
    setRequired(products.find((p) => p.r.id === id)?.p.packSize ?? 28);
    setOfferId("");
    setSection("Buy medicines");
  };
  const move = (next: Section) => {
    setSection(next);
    setNotice("");
    change.reset();
  };
  return (
    <div className="rx-procurement">
      <nav className="rx-buy-tabs" aria-label="Stock and buying views">
        <div className="rx-buy-navlinks">
          {sections.map((s) => (
            <button
              key={s}
              aria-current={section === s ? "page" : undefined}
              onClick={() => move(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <button className="rx-basket-link" onClick={() => move("Basket")}>
          Basket ({lines.length}) · {money(basketTotal)}
        </button>
      </nav>
      <main className="rx-buy-main">
        {data.isPending && <p role="status">Loading your pharmacy catalogue…</p>}
        {data.error && (
          <p role="alert">
            Could not load stock: {data.error.message}{" "}
            <button onClick={() => void data.refetch()}>Try again</button>
          </p>
        )}
        {notice && (
          <p className="rx-buy-notice" role="status">
            {notice}
          </p>
        )}
        {change.error && (
          <p className="rx-buy-error" role="alert">
            {change.error.message}. Your basket and orders remain available. Refresh the offer and
            review before retrying.
          </p>
        )}
        {section === "Buy medicines" && !product && (
          <>
            <div className="rx-buy-title">
              <div>
                <p>PHARMACY-WIDE PROCUREMENT</p>
                <h1>Buy medicines</h1>
                <span>Compare supplier offers. Build a basket. Receive stock when it arrives.</span>
              </div>
              <span className="rx-buy-tag">Synthetic suppliers & prices</span>
            </div>
            <div className="rx-buy-filters">
              <label>
                Search medicines
                <input
                  type="search"
                  placeholder="Drug name, strength or formulation"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="rx-check">
                <input
                  type="checkbox"
                  checked={lowOnly}
                  onChange={(e) => setLowOnly(e.target.checked)}
                />{" "}
                Below reorder level
              </label>
            </div>
            <div className="rx-buy-table">
              <table>
                <thead>
                  <tr>
                    <th>Medicine / formulation</th>
                    <th>On hand</th>
                    <th>On order</th>
                    <th>Best unit price</th>
                    <th>Earliest delivery</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {products
                    .filter(
                      ({ p }) =>
                        `${p.drug} ${p.formulation}`.toLowerCase().includes(search.toLowerCase()) &&
                        (!lowOnly || p.stock <= p.reorderLevel),
                    )
                    .map(({ r, p }) => {
                      const qs = quotes.filter((q) => q.q.productId === r.id && q.q.available);
                      const lowest = [...qs].sort(
                        (a, b) =>
                          a.q.packCostPence / a.q.packSize - b.q.packCostPence / b.q.packSize,
                      )[0];
                      return (
                        <tr key={r.id}>
                          <td>
                            <strong>{p.drug}</strong>
                            <small>
                              {p.formulation} · {p.packSize} units / standard pack
                            </small>
                          </td>
                          <td>
                            {p.stock} units
                            {p.stock <= p.reorderLevel && (
                              <small className="rx-buy-warning">Low stock</small>
                            )}
                          </td>
                          <td>{onOrder(r.id)} units</td>
                          <td>
                            {lowest ? (
                              <>
                                {(lowest.q.packCostPence / lowest.q.packSize).toFixed(2)}p / unit
                                <small>
                                  {money(lowest.q.packCostPence)} per {lowest.q.packSize}-unit pack
                                  {" · "}
                                  {lowest.q.supplier}
                                </small>
                                <small>Minimum {lowest.q.minimumPacks} packs</small>
                              </>
                            ) : (
                              "No available offers"
                            )}
                          </td>
                          <td>
                            {qs.length
                              ? date(now + Math.min(...qs.map((q) => q.q.leadDays)) * 86400000)
                              : "—"}
                          </td>
                          <td>
                            <button onClick={() => compare(r.id)}>Compare suppliers</button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {!products.some(
              ({ p }) =>
                `${p.drug} ${p.formulation}`.toLowerCase().includes(search.toLowerCase()) &&
                (!lowOnly || p.stock <= p.reorderLevel),
            ) &&
              !data.isPending && (
                <p className="rx-buy-empty">
                  No medicines match these filters. Clear the search or reorder filter to see the
                  catalogue.
                </p>
              )}
          </>
        )}
        {section === "Buy medicines" && product && (
          <>
            <button className="rx-back" onClick={() => setProductId("")}>
              ‹ Back to medicine catalogue
            </button>
            <div className="rx-buy-title">
              <div>
                <h1>{product.p.drug}</h1>
                <span>Compare supplier offers and add to basket.</span>
              </div>
            </div>
            <div className="rx-compare-context">
              <div>
                <small>Current stock</small>
                <strong>{product.p.stock} units</strong>
              </div>
              <label>
                Required quantity (units)
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={required}
                  onChange={(e) =>
                    setRequired(Math.max(1, Math.min(100000, Number(e.target.value))))
                  }
                />
              </label>
              <div>
                <small>Formulation</small>
                <strong>{product.p.formulation}</strong>
              </div>
              <div>
                <small>Already on order</small>
                <strong>{onOrder(product.r.id)} units</strong>
              </div>
            </div>
            <div className="rx-buy-section-heading">
              <h2>Supplier offers</h2>
              <p>
                Buying costs only. Minimums and excess units are included; delivery fees shown
                separately.
              </p>
            </div>
            <div className="rx-buy-table">
              <table className="rx-offers">
                <thead>
                  <tr>
                    <th>Select / supplier</th>
                    <th>Pack size</th>
                    <th>Pack / unit price</th>
                    <th>Minimum</th>
                    <th>For {required} units</th>
                    <th>Delivery</th>
                    <th>Fee</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map(({ r, q, packs, total }) => (
                    <tr key={r.id} className={offerId === r.id ? "is-selected" : ""}>
                      <td>
                        <label className="rx-offer-label">
                          <input
                            type="radio"
                            name="supplier-offer"
                            checked={offerId === r.id}
                            disabled={!q.available}
                            onChange={() => setOfferId(r.id)}
                          />
                          <span>
                            <strong>{q.supplier}</strong>
                            <small>{q.available ? "Available" : "Unavailable"}</small>
                          </span>
                        </label>
                      </td>
                      <td>{q.packSize} units</td>
                      <td>
                        <strong>{money(q.packCostPence)}</strong>
                        <small>{(q.packCostPence / q.packSize).toFixed(2)}p / unit</small>
                      </td>
                      <td>{q.minimumPacks} packs</td>
                      <td>
                        <strong>
                          {packs} packs · {packs * q.packSize} units
                        </strong>
                        <small>{packs * q.packSize - required} excess units</small>
                      </td>
                      <td>
                        {date(now + q.leadDays * 86400000)}
                        <small>{q.leadDays} day lead</small>
                      </td>
                      <td>{money(q.deliveryFeePence)}</td>
                      <td>
                        <strong>{money(total)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="rx-offer-action">
                <div>
                  <h3>Add the selected offer to your basket</h3>
                  <span>
                    {offer
                      ? `${offer.q.supplier} — ${offer.packs} packs (${offer.packs * offer.q.packSize} units) for ${money(offer.total)}`
                      : "Select a supplier above to compare its total."}
                  </span>
                </div>
                <button
                  className="rx-primary"
                  disabled={!offer || !basketResource || change.isPending}
                  onClick={() => {
                    if (offer && basketResource)
                      act({
                        type: "update_pharmacy_basket",
                        resourceId: basketResource.id,
                        expectedVersion: basketResource.version,
                        quoteId: offer.r.id,
                        quoteVersion: offer.r.version,
                        quantity: offer.packs,
                        requiredUnits: required,
                      });
                  }}
                >
                  + Add to basket
                </button>
              </div>
            </div>
            <p className="rx-buy-caption">
              Each product has one basket line; adding it again replaces your previous choice. A
              supplier's delivery fee is charged once per checkout. No medicine substitution is
              made.
            </p>
          </>
        )}
        {section === "Basket" && (
          <>
            <div className="rx-buy-title">
              <div>
                <h1>Review basket</h1>
                <span>Shared with your team. Nothing is ordered until you place orders.</span>
              </div>
              <button
                onClick={() => {
                  setProductId("");
                  move("Buy medicines");
                }}
              >
                Continue buying
              </button>
            </div>
            {!lines.length ? (
              <div className="rx-buy-empty">
                <h2>Your basket is empty</h2>
                <p>Find a medicine and compare supplier offers to begin.</p>
                <button
                  onClick={() => {
                    setProductId("");
                    move("Buy medicines");
                  }}
                >
                  Buy medicines
                </button>
              </div>
            ) : (
              <>
                {suppliers.map((supplier) => (
                  <section className="rx-basket-group" key={supplier}>
                    <h2>{supplier}</h2>
                    <div className="rx-buy-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Medicine</th>
                            <th>Packs / units</th>
                            <th>Frozen offer</th>
                            <th>Expected arrival</th>
                            <th>Goods total</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines
                            .filter((l) => l.quote.supplier === supplier)
                            .map((line) => (
                              <tr key={line.productId}>
                                <td>
                                  <strong>{productName(line.productId)}</strong>
                                  <small>
                                    {line.requiredUnits} units requested ·{" "}
                                    {line.packs * line.quote.packSize - line.requiredUnits} excess
                                  </small>
                                </td>
                                <td>
                                  <form
                                    className="rx-inline-form"
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      if (basketResource)
                                        act({
                                          type: "update_pharmacy_basket",
                                          resourceId: basketResource.id,
                                          expectedVersion: basketResource.version,
                                          quoteId: line.quoteId,
                                          quoteVersion: line.quoteVersion,
                                          quantity: Number(
                                            new FormData(e.currentTarget).get("packs"),
                                          ),
                                          requiredUnits: line.requiredUnits,
                                        });
                                    }}
                                  >
                                    <label>
                                      Packs
                                      <input
                                        key={line.packs}
                                        name="packs"
                                        type="number"
                                        min={Math.max(
                                          line.quote.minimumPacks,
                                          Math.ceil(line.requiredUnits / line.quote.packSize),
                                        )}
                                        max="100000"
                                        defaultValue={line.packs}
                                      />
                                    </label>
                                    <button disabled={change.isPending}>Update</button>
                                  </form>
                                  <small>{line.packs * line.quote.packSize} units</small>
                                </td>
                                <td>
                                  {money(line.quote.packCostPence)} / pack
                                  <small>{line.quote.packSize} units per pack</small>
                                </td>
                                <td>{date(now + line.quote.leadDays * 86400000)}</td>
                                <td>{money(line.packs * line.quote.packCostPence)}</td>
                                <td>
                                  <button onClick={() => compare(line.productId)}>Recompare</button>
                                  <button
                                    disabled={change.isPending}
                                    onClick={() => {
                                      if (basketResource)
                                        act({
                                          type: "remove_pharmacy_basket_line",
                                          resourceId: basketResource.id,
                                          expectedVersion: basketResource.version,
                                          productId: line.productId,
                                        });
                                    }}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
                <div className="rx-checkout">
                  <div>
                    <p>
                      {suppliers.length} supplier group(s), {lines.length} order line(s). Each line
                      keeps a linked order reference.
                    </p>
                    <p>
                      Goods {money(basketTotal - delivery)} · Delivery {money(delivery)} ·{" "}
                      <strong>Total {money(basketTotal)}</strong>
                    </p>
                    <small>
                      Offers are checked again at placement. Changed or unavailable offers require a
                      fresh review.
                    </small>
                  </div>
                  <button
                    className="rx-primary"
                    disabled={change.isPending || !basketResource}
                    onClick={() => {
                      if (basketResource)
                        act({
                          type: "checkout_pharmacy_basket",
                          resourceId: basketResource.id,
                          expectedVersion: basketResource.version,
                        });
                    }}
                  >
                    Place orders · {money(basketTotal)}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {section === "Orders" && (
          <>
            <div className="rx-buy-title">
              <div>
                <h1>Orders & receiving</h1>
                <span>
                  Outstanding commitment <strong>{money(commitment)}</strong>. Stock changes only
                  when received.
                </span>
              </div>
              <button
                onClick={() => {
                  setProductId("");
                  move("Buy medicines");
                }}
              >
                Buy medicines
              </button>
            </div>
            <label className="rx-status-filter">
              Order status
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {["all", "ordered", "part-received", "received", "cancelled"].map((s) => (
                  <option key={s} value={s}>
                    {s === "all" ? "All orders" : orderStatus(s)}
                  </option>
                ))}
              </select>
            </label>
            {!orders.some(({ r }) => statusFilter === "all" || r.status === statusFilter) && (
              <p className="rx-buy-empty">
                No orders match this status filter. Compare supplier offers, add medicines to your
                basket and place orders.
              </p>
            )}
            {orders
              .filter(({ r }) => statusFilter === "all" || r.status === statusFilter)
              .map(({ r, o }) => (
                <OrderCard
                  key={r.id + ":" + r.version}
                  record={r}
                  order={o}
                  drug={productName(o.productId)}
                  now={now}
                  pending={change.isPending}
                  act={act}
                />
              ))}
          </>
        )}
        {section === "Inventory" && (
          <>
            <div className="rx-buy-title">
              <div>
                <h1>Inventory</h1>
                <span>
                  Pharmacy-wide stock at acquisition cost. Reservations, batches and expiry are not
                  modelled.
                </span>
              </div>
            </div>
            <div className="rx-buy-table">
              <table>
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>On hand / available</th>
                    <th>On order</th>
                    <th>Reorder below</th>
                    <th>Inventory value</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(({ r, p }) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{p.drug}</strong>
                        <small>{p.formulation}</small>
                      </td>
                      <td>{p.stock} units</td>
                      <td>{onOrder(r.id)} units</td>
                      <td>{p.reorderLevel} units</td>
                      <td>{money(p.stockCostPence)}</td>
                      <td>
                        <button onClick={() => compare(r.id)}>Buy stock</button>
                        <button onClick={() => setEditProduct(editProduct === r.id ? "" : r.id)}>
                          Price & reorder
                        </button>
                        <button
                          onClick={() => {
                            setActivityProduct(r.id);
                            move("Stock activity");
                          }}
                        >
                          View activity
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {products
              .filter(({ r }) => r.id === editProduct)
              .map(({ r, p }) => (
                <dialog
                  aria-label="Edit dispensing price and reorder"
                  className="rx-procurement-dialog"
                  key={r.id}
                  ref={(el) => {
                    if (el && !el.open) el.showModal();
                  }}
                  onCancel={() => setEditProduct("")}
                >
                  <button className="rx-dialog-close" onClick={() => setEditProduct("")}>
                    Close
                  </button>
                  <form
                    className="rx-inventory-editor"
                    key={r.version}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      act({
                        type: "update_stock_price",
                        resourceId: r.id,
                        expectedVersion: r.version,
                        costPence: p.costPence,
                        pricePence: Number(f.get("price")),
                        reorderLevel: Number(f.get("reorder")),
                      });
                    }}
                  >
                    <h2>{p.drug} · dispensing price & reorder</h2>
                    <p>
                      Editing the dispensing price does not change supplier offers or past
                      transactions.
                    </p>
                    <label>
                      Simulated dispensing price per standard pack (pence)
                      <input
                        name="price"
                        type="number"
                        min="0"
                        defaultValue={p.pricePence}
                        required
                      />
                    </label>
                    <label>
                      Reorder below (units)
                      <input
                        name="reorder"
                        type="number"
                        min="0"
                        defaultValue={p.reorderLevel}
                        required
                      />
                    </label>
                    <button disabled={change.isPending}>Save price & reorder</button>
                  </form>
                </dialog>
              ))}
          </>
        )}
        {section === "Stock activity" && (
          <>
            <div className="rx-buy-title">
              <div>
                <h1>Stock activity</h1>
                <span>
                  Opening balances, deliveries and dispensing across the pharmacy. Orders awaiting
                  delivery are in Orders.
                </span>
              </div>
            </div>
            <label className="rx-status-filter">
              Medicine
              <select value={activityProduct} onChange={(e) => setActivityProduct(e.target.value)}>
                <option value="">All medicines</option>
                {products.map(({ r, p }) => (
                  <option key={r.id} value={r.id}>
                    {p.drug}
                  </option>
                ))}
              </select>
            </label>
            <div className="rx-buy-table">
              <table>
                <thead>
                  <tr>
                    <th>Time / reference</th>
                    <th>Medicine</th>
                    <th>Movement</th>
                    <th>Units in / out</th>
                    <th>Balance after</th>
                    <th>Cost impact</th>
                    <th>Attribution</th>
                  </tr>
                </thead>
                <tbody>
                  {movements
                    .filter((r) => !activityProduct || r.data.productId === activityProduct)
                    .slice()
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button
                            onClick={() =>
                              setSelectedMovement(selectedMovement === r.id ? "" : r.id)
                            }
                          >
                            {date(r.createdAt)}
                          </button>
                          <small>{String(r.data.reference ?? r.id)}</small>
                        </td>
                        <td>{productName(String(r.data.productId))}</td>
                        <td>
                          {String(
                            r.data.movementType ??
                              (r.data.prescriptionId
                                ? "dispensing"
                                : amount(r, "quantity") === 0
                                  ? "price update"
                                  : "receipt"),
                          )}
                        </td>
                        <td>{amount(r, "quantity")} units</td>
                        <td>{amount(r, "balance")} units</td>
                        <td>
                          {money(
                            amount(r, "valuePence") ||
                              amount(r, "acquisitionPence") ||
                              (r.data.prescriptionId ? -amount(r, "costPence") : 0),
                          )}
                        </td>
                        <td>
                          <RecordAttribution record={r} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!movements.some((r) => !activityProduct || r.data.productId === activityProduct) && (
              <p className="rx-buy-empty">
                No stock activity for this medicine. Place an order, then receive its delivery to
                add stock.
              </p>
            )}
            {movements
              .filter((r) => r.id === selectedMovement)
              .map((r) => (
                <dialog
                  className="rx-procurement-dialog"
                  aria-label="Stock movement detail"
                  key={r.id}
                  ref={(el) => {
                    if (el && !el.open) el.showModal();
                  }}
                  onCancel={() => setSelectedMovement("")}
                >
                  <button className="rx-dialog-close" onClick={() => setSelectedMovement("")}>
                    Close
                  </button>
                  <div className="rx-movement-detail">
                    <h2>{r.title}</h2>
                    <p>{String(r.data.reference ?? r.id)}</p>
                    <p>Medicine: {productName(String(r.data.productId))}</p>
                    <p>
                      Units moved: {amount(r, "quantity")} · Balance after: {amount(r, "balance")}
                    </p>
                    {r.patientId && (
                      <p>
                        Patient: {r.patientId} ·{" "}
                        <a href={`/pharmacy/?patient=${encodeURIComponent(r.patientId)}`}>
                          Open patient care
                        </a>
                      </p>
                    )}
                    {typeof r.data.prescriptionId === "string" && (
                      <p>Prescription: {r.data.prescriptionId}</p>
                    )}
                    <RecordAttribution record={r} history />
                  </div>
                </dialog>
              ))}
          </>
        )}
        {section === "Performance" && (
          <>
            <div className="rx-buy-title">
              <div>
                <h1>Costs & contribution</h1>
                <span>
                  All-time synthetic amounts in GBP. Weighted-average inventory cost; no overhead or
                  tax model.
                </span>
              </div>
            </div>
            <div className="rx-performance">
              {[
                [
                  "Outstanding purchases",
                  commitment,
                  "Unreceived, uncancelled commitments. Not stock on hand.",
                  "Orders",
                ],
                [
                  "Inventory at cost",
                  products.reduce((sum, { p }) => sum + p.stockCostPence, 0),
                  "Current stock asset value, including the opening balance.",
                  "Inventory",
                ],
                [
                  "Received purchases",
                  movements.reduce((sum, r) => sum + amount(r, "acquisitionPence"), 0),
                  "Acquisition costs recorded when deliveries were received.",
                  "Stock activity",
                ],
                [
                  "Medicines dispensed at cost",
                  cost,
                  "Historical cost removed from inventory by dispensing.",
                  "Stock activity",
                ],
                [
                  "Simulated dispensing revenue",
                  revenue,
                  "Revenue recorded by dispensing, not a real reimbursement tariff.",
                  "Stock activity",
                ],
                [
                  "Gross contribution",
                  revenue - cost,
                  "Dispensing revenue less drug cost. Excludes overheads; not net profit.",
                  "Stock activity",
                ],
              ].map(([label, value, description, target]) => (
                <article key={label}>
                  <h2>{label}</h2>
                  <strong>{money(Number(value))}</strong>
                  <p>{description}</p>
                  <button
                    onClick={() =>
                      move(
                        target === "Orders"
                          ? "Orders"
                          : target === "Inventory"
                            ? "Inventory"
                            : "Stock activity",
                      )
                    }
                  >
                    View transactions
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </main>
      {section !== "Basket" && (
        <div className="rx-basket-strip">
          <div>
            <strong>
              Basket ({lines.length} {lines.length === 1 ? "medicine" : "medicines"})
            </strong>
            <span>
              {lines.length
                ? `${suppliers.length} supplier(s) · ${money(basketTotal)} including delivery`
                : "Compare an offer to start your team basket."}
            </span>
          </div>
          <button className="rx-primary" onClick={() => move("Basket")}>
            Review basket →
          </button>
        </div>
      )}
    </div>
  );
}
function OrderCard({
  record: r,
  order: o,
  drug,
  now,
  pending,
  act,
}: {
  record: Resource;
  order: ReturnType<typeof purchaseOrderSchema.parse>;
  drug: string;
  now: number;
  pending: boolean;
  act: (action: Action) => void;
}) {
  const outstanding = Math.max(0, o.packs - o.receivedPacks - o.cancelledPacks);
  return (
    <details className="rx-order-card">
      <summary>
        <span>
          <strong>{drug}</strong>
          <small>
            {o.supplier} · {r.id}
          </small>
        </span>
        <span>
          {orderStatus(r.status)}
          <small>
            {o.receivedPacks} / {o.packs} packs received
          </small>
        </span>
        <span>
          {money(o.totalPence)}
          <small>Due {date(o.dueAt)}</small>
        </span>
      </summary>
      <div className="rx-order-body">
        <p>
          Frozen terms: {o.packs} packs × {o.packSize} units at {money(o.packCostPence)} / pack.
          Delivery {money(o.deliveryFeePence)}. Outstanding: {outstanding} packs.
        </p>
        {o.batchId && <p>Checkout reference: {o.batchId}</p>}
        {o.cancellationReason && <p>Cancellation reason: {o.cancellationReason}</p>}
        {outstanding > 0 && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act({
                  type: "receive_pharmacy_order",
                  resourceId: r.id,
                  expectedVersion: r.version,
                  quantity: Number(f.get("packs")),
                  text: String(f.get("reference")),
                });
              }}
            >
              <h3>Receive delivery</h3>
              {now < o.dueAt && (
                <p>
                  Available {date(o.dueAt)}. Use Time controls in the footer to advance the whole
                  team's simulation to the due date.
                </p>
              )}
              <label>
                Packs received
                <input
                  name="packs"
                  type="number"
                  required
                  min="1"
                  max={outstanding}
                  defaultValue={outstanding}
                />
              </label>
              <label>
                Delivery reference
                <input
                  name="reference"
                  required
                  maxLength={500}
                  placeholder="Supplier delivery note reference"
                />
              </label>
              <button className="rx-primary" disabled={pending || now < o.dueAt}>
                Record receipt
              </button>
              <p className="rx-buy-caption">
                Receive fewer packs for a partial delivery. The remaining quantity stays on order.
              </p>
            </form>
            <details>
              <summary>Cancel outstanding quantity</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act({
                    type: "cancel_pharmacy_order",
                    resourceId: r.id,
                    expectedVersion: r.version,
                    text: String(new FormData(e.currentTarget).get("reason")),
                  });
                }}
              >
                <label>
                  Reason
                  <input name="reason" required maxLength={500} />
                </label>
                <button disabled={pending}>Cancel {outstanding} outstanding packs</button>
              </form>
            </details>
          </>
        )}
        <RecordAttribution record={r} history />
      </div>
    </details>
  );
}
