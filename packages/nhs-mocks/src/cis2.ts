import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { z } from "zod";

export const cis2Identities = [
  {
    id: "SIM-STAFF-1",
    name: "Dr Maya Bennett",
    assignments: [
      {
        id: "gp",
        role: "General practitioner",
        org: "SIM-RIVERSIDE",
        organisation: "Riverside Practice",
      },
    ],
  },
  {
    id: "SIM-STAFF-2",
    name: "Dr Oliver Chen",
    assignments: [
      {
        id: "consultant",
        role: "Hospital consultant",
        org: "SIM-NORTHBANK",
        organisation: "Northbank General",
      },
      {
        id: "acute",
        role: "Acute medicine registrar",
        org: "SIM-NORTHBANK",
        organisation: "Northbank General",
      },
    ],
  },
  {
    id: "SIM-STAFF-3",
    name: "Amara Hughes",
    assignments: [
      {
        id: "nurse",
        role: "Community nurse",
        org: "SIM-COMMUNITY",
        organisation: "Riverside Community Services",
      },
    ],
  },
  {
    id: "SIM-STAFF-4",
    name: "Jamie Patel",
    assignments: [
      {
        id: "pharmacist",
        role: "Community pharmacist",
        org: "SIM-PHARMACY",
        organisation: "Riverside Pharmacy",
      },
    ],
  },
];
const redirectSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    !url.hash &&
    !url.username &&
    !url.password &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  );
}, "Use HTTPS or a localhost HTTP callback without credentials or fragment");
export const cis2SettingsSchema = z
  .object({
    scenario: z.enum(["normal", "deny", "unavailable", "expired-session"]),
    tokenLifetimeSeconds: z.number().int().min(30).max(3600),
    clients: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/),
            name: z.string().trim().min(1).max(100),
            redirectUris: z.array(redirectSchema).min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .refine(
    (settings) =>
      new Set(settings.clients.map((client) => client.id)).size === settings.clients.length,
    "Client IDs must be unique",
  );
type Settings = z.infer<typeof cis2SettingsSchema>;
type Claims = {
  sub: string;
  name: string;
  role: string;
  org: string;
  organisation: string;
  nhs_sim: true;
};
type Request = {
  origin: string;
  client: string;
  redirect: string;
  challenge: string;
  nonce: string;
  state: string;
  scope: string;
};
export class Cis2Error extends Error {
  error: string;
  status: number;
  constructor(error: string, message: string, status = 400) {
    super(message);
    this.error = error;
    this.status = status;
  }
}
const secret = () => randomBytes(32).toString("base64url");
const matches = (left: string, right: string) => {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
export class MockOIDC {
  private keys?: Awaited<ReturnType<typeof generateKeyPair>>;
  private settings: Settings;
  private revision = 0;
  private interactions = new Map<string, { request: Request; csrf: string; expires: number }>();
  private codes = new Map<string, { request: Request; claims: Claims; expires: number }>();
  private tokens = new Map<string, { claims: Claims; expires: number }>();
  origin: string;
  private now: () => number;
  private origins: readonly string[];
  constructor(origin: string, now: () => number = Date.now, origins: readonly string[] = [origin]) {
    this.origin = origin;
    this.origins = origins;
    this.now = now;
    this.settings = {
      scenario: "normal",
      tokenLifetimeSeconds: 3600,
      clients: [
        {
          id: "nhs-sim-client",
          name: "NHS simulation explorer",
          redirectUris: origins.map(value => value + "/cis2/callback"),
        },
      ],
    };
  }
  async init() {
    this.keys = await generateKeyPair("RS256");
  }
  configuration() {
    return {
      ...structuredClone(this.settings),
      identities: structuredClone(cis2Identities),
      storage: "Process-local. Restart restores defaults and revokes sessions.",
      active: {
        interactions: this.interactions.size,
        codes: this.codes.size,
        tokens: this.tokens.size,
      },
    };
  }
  configure(input: unknown) {
    this.settings = cis2SettingsSchema.parse(input);
    this.revoke();
    return this.configuration();
  }
  revoke() {
    this.revision += 1;
    this.interactions.clear();
    this.codes.clear();
    this.tokens.clear();
  }
  discovery(origin = this.origin) {
    this.requireOrigin(origin);
    return {
      issuer: origin + "/cis2",
      authorization_endpoint: origin + "/cis2/authorize",
      token_endpoint: origin + "/cis2/token",
      userinfo_endpoint: origin + "/cis2/userinfo",
      jwks_uri: origin + "/cis2/jwks",
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["openid", "profile"],
    };
  }
  async jwks() {
    if (!this.keys) throw new Error("CIS2 not initialized");
    return {
      keys: [
        { ...(await exportJWK(this.keys.publicKey)), kid: "sim-key", alg: "RS256", use: "sig" },
      ],
    };
  }
  private requireOrigin(origin: string) {
    if (!this.origins.includes(origin)) throw new Cis2Error("invalid_request", "Unknown identity origin");
  }
  private request(params: URLSearchParams, origin: string): Request {
    this.requireOrigin(origin);
    const client = this.settings.clients.find((entry) => entry.id === params.get("client_id"));
    const redirect = params.get("redirect_uri") ?? "";
    if (!client || !client.redirectUris.includes(redirect))
      throw new Cis2Error("invalid_request", "Unknown client or unregistered redirect URI");
    const challenge = params.get("code_challenge") ?? "";
    const nonce = params.get("nonce") ?? "";
    const state = params.get("state") ?? "";
    const scope = params.get("scope") ?? "openid profile";
    if (
      params.get("response_type") !== "code" ||
      params.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      !nonce ||
      !state ||
      nonce.length > 512 ||
      state.length > 512 ||
      !scope.split(" ").includes("openid") ||
      scope.split(" ").some((part) => !["openid", "profile"].includes(part))
    )
      throw new Cis2Error(
        "invalid_request",
        "Use authorization code, PKCE S256, state, nonce and openid scope",
      );
    return { origin, client: client.id, redirect, challenge, nonce, state, scope };
  }
  begin(params: URLSearchParams, origin = this.origin) {
    const request = this.request(params, origin);
    if (this.settings.scenario === "unavailable")
      throw new Cis2Error(
        "temporarily_unavailable",
        "Identity service is unavailable in the current scenario",
        503,
      );
    this.prune();
    if (this.interactions.size >= 1000)
      throw new Cis2Error("temporarily_unavailable", "Too many sign-in requests", 429);
    const interaction = secret(),
      csrf = secret();
    this.interactions.set(interaction, { request, csrf, expires: this.now() + 300000 });
    return {
      interaction,
      csrf,
      client: this.settings.clients.find((client) => client.id === request.client)?.name,
      identities: cis2Identities,
    };
  }
  complete(params: URLSearchParams, browserSecret: string) {
    const id = params.get("interaction") ?? "",
      interaction = this.interactions.get(id);
    if (
      !interaction ||
      interaction.expires <= this.now() ||
      !matches(interaction.csrf, params.get("csrf") ?? "") ||
      !matches(interaction.csrf, browserSecret)
    )
      throw new Cis2Error(
        "invalid_request",
        "Sign-in expired or browser verification failed. Start again.",
      );
    this.interactions.delete(id);
    if (this.settings.scenario === "unavailable")
      throw new Cis2Error("temporarily_unavailable", "Identity service is unavailable", 503);
    const result = new URL(interaction.request.redirect);
    result.searchParams.set("state", interaction.request.state);
    if (
      params.get("action") === "cancel" ||
      this.settings.scenario === "deny" ||
      this.settings.scenario === "expired-session"
    ) {
      result.searchParams.set(
        "error",
        this.settings.scenario === "expired-session" ? "login_required" : "access_denied",
      );
      result.searchParams.set(
        "error_description",
        this.settings.scenario === "expired-session"
          ? "The simulated session has expired"
          : "Sign-in was declined",
      );
      return result.toString();
    }
    return this.issue(
      interaction.request,
      params.get("identity") ?? "",
      params.get("assignment") ?? "",
    );
  }
  authorize(params: URLSearchParams, origin = this.origin) {
    return this.issue(this.request(params, origin), "SIM-STAFF-1", "gp");
  }
  private issue(request: Request, identityId: string, assignmentId: string) {
    const identity = cis2Identities.find((person) => person.id === identityId);
    const assignment = identity?.assignments.find((role) => role.id === assignmentId);
    if (!identity || !assignment)
      throw new Cis2Error(
        "invalid_request",
        "Choose an assignment belonging to this fictional identity",
      );
    if (this.settings.scenario !== "normal")
      throw new Cis2Error("access_denied", "The current scenario does not allow sign-in");
    const code = secret();
    const claims = {
      sub: identity.id,
      name: identity.name,
      role: assignment.role,
      org: assignment.org,
      organisation: assignment.organisation,
      nhs_sim: true as const,
    };
    this.codes.set(code, { request, claims, expires: this.now() + 120000 });
    const result = new URL(request.redirect);
    result.searchParams.set("code", code);
    result.searchParams.set("state", request.state);
    return result.toString();
  }
  async token(params: URLSearchParams, origin = this.origin) {
    this.requireOrigin(origin);
    const revision = this.revision;
    const code = params.get("code") ?? "",
      data = this.codes.get(code);
    this.codes.delete(code);
    const verifier = params.get("code_verifier") ?? "";
    if (
      !data ||
      data.request.origin !== origin ||
      data.expires <= this.now() ||
      params.get("grant_type") !== "authorization_code" ||
      params.get("client_id") !== data.request.client ||
      params.get("redirect_uri") !== data.request.redirect ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
      createHash("sha256").update(verifier).digest("base64url") !== data.request.challenge
    )
      throw new Cis2Error(
        "invalid_grant",
        "Invalid or expired authorization code or PKCE verifier",
      );
    if (!this.keys) throw new Error("CIS2 not initialized");
    const access_token = secret(),
      expires_in = this.settings.tokenLifetimeSeconds,
      now = Math.floor(this.now() / 1000);
    const id_token = await new SignJWT({
      ...data.claims,
      nonce: data.request.nonce,
      auth_time: now,
    })
      .setProtectedHeader({ alg: "RS256", kid: "sim-key" })
      .setIssuer(data.request.origin + "/cis2")
      .setAudience(data.request.client)
      .setIssuedAt(now)
      .setExpirationTime(now + expires_in)
      .sign(this.keys.privateKey);
    if (revision !== this.revision)
      throw new Cis2Error("invalid_grant", "Session was revoked during token exchange");
    this.tokens.set(access_token, { claims: data.claims, expires: this.now() + expires_in * 1000 });
    return { access_token, id_token, token_type: "Bearer", expires_in, scope: data.request.scope };
  }
  userinfo(token: string) {
    const data = this.tokens.get(token);
    if (!data || data.expires <= this.now()) {
      this.tokens.delete(token);
      throw new Cis2Error("invalid_token", "Invalid or expired access token", 401);
    }
    return { ...data.claims };
  }
  private prune() {
    for (const map of [this.interactions, this.codes, this.tokens])
      for (const [key, value] of map) if (value.expires <= this.now()) map.delete(key);
  }
}
