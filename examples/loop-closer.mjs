// node examples/loop-closer.mjs
// Set SIM_ORIGIN and SIM_API_KEY. Read-only by default; APPLY=1 creates follow-up tasks.
const origin = process.env.SIM_ORIGIN ?? "http://localhost:8080";
if (!process.env.SIM_API_KEY) throw new Error("Set SIM_API_KEY");
const headers = {
  Authorization: "Bearer " + process.env.SIM_API_KEY,
  "Content-Type": "application/json",
};
const response = await fetch(origin + "/api/sites/gp/view", { headers });
if (!response.ok) throw new Error("Read failed: " + response.status);
const view = await response.json();
for (const r of view.resources.filter((r) => r.kind === "request" && r.status === "open")) {
  const action = {
    type: "create_task",
    patientId: r.patientId,
    title: "Review unresolved request " + r.id,
  };
  if (process.env.APPLY !== "1") {
    console.log("Proposed:", action);
    continue;
  }
  const result = await fetch(origin + "/api/sites/gp/actions", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "loop-closer-" + r.id },
    body: JSON.stringify(action),
  });
  if (!result.ok) throw new Error("Action failed: " + result.status);
  console.log("Created:", (await result.json()).id);
}
