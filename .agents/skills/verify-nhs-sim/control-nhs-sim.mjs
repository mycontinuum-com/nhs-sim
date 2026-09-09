#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../../..");
const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--")) ?? "help";
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const origin = valueAfter("--origin") ?? process.env.NHS_SIM_ORIGIN ?? "http://localhost:8080";
const evidenceDir = resolve(repo, ".verification/evidence");

function run(program, programArgs) {
  const result = spawnSync(program, programArgs, { cwd: repo, stdio: "inherit" });
  if (result.error?.code === "ENOENT")
    throw new Error(`${program} is unavailable; install it before running this command`);
  if (result.status !== 0)
    throw new Error(`${program} ${programArgs.join(" ")} failed with exit ${result.status}`);
}

function save(kind, proof) {
  mkdirSync(evidenceDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const path = resolve(evidenceDir, `${stamp}-${kind}.json`);
  writeFileSync(path, JSON.stringify(proof, null, 2) + "\n");
  return path;
}

async function request(path, options) {
  const response = await fetch(origin + path, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok)
    throw new Error(`${options?.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function doctor(staticOnly = false) {
  const local = {
    node: process.versions.node,
    node24: Number(process.versions.node.split(".")[0]) >= 24,
    package: existsSync(resolve(repo, "package.json")),
    pstack: existsSync(resolve(repo, ".agents/skills/poteto-mode/SKILL.md")),
    verifier: existsSync(resolve(repo, ".agents/skills/verify-nhs-sim/SKILL.md")),
  };
  if (!Object.values(local).every(Boolean)) throw new Error(`Checkout is incomplete: ${JSON.stringify(local)}`);
  if (staticOnly) return { ok: true, mode: "static", local };
  const health = await request("/healthz");
  const catalogue = await request("/api/catalogue");
  return {
    ok: health.ok === true && health.database === "postgresql",
    mode: "live",
    origin,
    local,
    database: health.database,
    sites: catalogue.sites.length,
    adapters: catalogue.apis.length,
    scenarios: catalogue.scenarios.length,
  };
}

async function journey() {
  const issued = await request("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamName: `Verification ${Date.now()}` }),
  });
  const headers = {
    Authorization: `Bearer ${issued.apiKey}`,
    "Content-Type": "application/json",
  };
  const order = await request("/api/sites/gp/actions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "order_test",
      patientId: "SIM-000001",
      title: "Verification: post-discharge monitoring",
    }),
  });
  await request("/api/clock", {
    method: "POST",
    headers,
    body: JSON.stringify({ advanceMinutes: 121 }),
  });
  const view = await request("/api/sites/diagnostics/view", { headers });
  const result = view.resources.find((resource) => resource.id === order.id);
  if (result?.status !== "available")
    throw new Error(`Ordered test ${order.id} was not available after 121 simulation minutes`);
  return {
    ok: true,
    origin,
    world: issued.world,
    action: { type: "order_test", resourceId: order.id, initialStatus: order.status },
    observed: { site: "diagnostics", status: result.status, version: result.version },
  };
}

async function main() {
  let proof;
  if (command === "help") {
    proof = {
      commands: {
        doctor: "Check the live instance; add --static for checkout-only diagnostics",
        launch: "Build and start app plus PostgreSQL, then run doctor",
        build: "Run typecheck, behavior tests, and all production builds",
        smoke: "Exercise every live site, adapter, auth boundary, and legacy workflow",
        journey: "Prove GP order → simulated time → diagnostics result",
        snapshot: "Capture a non-mutating health and catalogue summary",
        cleanup: "Stop Compose services while preserving data; supports --dry-run",
      },
      options: { "--origin": "Override NHS_SIM_ORIGIN", "--dry-run": "Preview cleanup" },
    };
  } else if (command === "doctor") {
    proof = await doctor(args.includes("--static"));
  } else if (command === "build") {
    run("pnpm", ["typecheck"]);
    run("pnpm", ["test"]);
    run("pnpm", ["build"]);
    proof = { ok: true, checks: ["typecheck", "test", "build"] };
  } else if (command === "launch") {
    run("docker", ["compose", "up", "-d", "--build", "--wait", "--wait-timeout", "180"]);
    proof = await doctor();
  } else if (command === "smoke") {
    run("node", ["scripts/smoke.mjs"]);
    proof = { ok: true, origin, check: "full single-origin smoke" };
  } else if (command === "journey") {
    proof = await journey();
  } else if (command === "snapshot") {
    proof = await doctor();
  } else if (command === "cleanup") {
    if (args.includes("--dry-run")) proof = { ok: true, dryRun: true, command: "docker compose down" };
    else {
      run("docker", ["compose", "down"]);
      proof = { ok: true, stopped: true, dataVolumePreserved: true };
    }
  } else {
    throw new Error(`Unknown command ${command}; run pnpm verify -- help`);
  }
  const evidence = command === "help" ? undefined : save(command, { command, at: new Date().toISOString(), ...proof });
  console.log(JSON.stringify({ ...proof, evidence }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, command, origin, error: error.message }, null, 2));
  process.exitCode = 1;
});
