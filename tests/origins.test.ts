import test from "node:test";
import assert from "node:assert/strict";
import { PublicOrigins } from "../apps/server/src/origins.ts";

test("public origins select configured hosts and reject untrusted browser origins", () => {
  const origins = new PublicOrigins("https://sim.animahacks.com", " https://sim.animahealth.com,https://sim.animahacks.com ");
  assert.deepEqual(origins.values, ["https://sim.animahacks.com", "https://sim.animahealth.com"]);
  assert.equal(origins.forHost("sim.animahealth.com"), "https://sim.animahealth.com");
  assert.equal(origins.forHost("sim.animahacks.com"), "https://sim.animahacks.com");
  assert.equal(origins.forHost("attacker.example"), "https://sim.animahacks.com");
  assert.equal(origins.forHost(undefined), "https://sim.animahacks.com");
  assert.equal(origins.allows("https://sim.animahacks.com"), true);
  assert.equal(origins.allows("https://sim.animahealth.com"), true);
  assert.equal(origins.allows(undefined), true);
  assert.equal(origins.allows("https://attacker.example"), false);
  assert.equal(origins.allows("null"), false);
  assert.equal(origins.allows("http://sim.animahealth.com"), false);
});

test("public origin configuration rejects paths, credentials and non-HTTP URLs", () => {
  for (const invalid of ["https://user:password@example.test", "https://example.test/path", "https://example.test/?q=1", "https://example.test/#fragment", "ftp://example.test", "not a URL"])
    assert.throws(() => new PublicOrigins("http://localhost:8080", invalid));
});
