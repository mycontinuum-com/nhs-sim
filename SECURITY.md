# Synthetic-only deployment boundary

Never use real patient/staff data, real NHS identifiers, production NHS credentials or live care actions. Fictional SIM identifiers intentionally do not masquerade as real NHS numbers.

API key issuance is deliberately public and requires only a team name. It creates an isolated world. This is not identity verification. Anyone who can reach the service may join. Put the whole host behind event access control if it should be invite-only.

Bearer keys grant team-wide simulation access, including patient demographics; the patient portal is not a real patient authorisation boundary. Site scopes restrict API namespaces. The operator token is a separate privileged secret. CIS2 mock tokens never grant operator or team access.

Keys are shown once and hashed in PostgreSQL. The UI retains your key only in sessionStorage. For a production event add expiry, revocation, request quotas and a real issuer/access gateway. Initial public issuance is capped at 200 worlds and one creation every two seconds per connecting IP (which may be the reverse proxy).

Configure PUBLIC_ORIGIN exactly. TLS terminates at Traefik. Replace all local defaults before hosting. PostgreSQL must not be exposed to the public network. Database passwords placed in DATABASE_URL must be URL-safe or percent encoded.

The mock CIS2 sign-in clearly selects a fixed fictional clinician. It has code expiry, PKCE, signed tokens and exact callback validation, but is not authentication of a real healthcare worker. Its ephemeral codes, sessions and signing key reset on restart.

The optional model adapter sends only synthetic visible GP records to OpenAI when explicitly invoked. It has no arbitrary network/tool execution. Returned text is untrusted, schema-validated, limited to three administrative task proposals, and requires separate submission to act. Configure credentials only in server environment variables, never frontend VITE_* variables.

Do not deploy multiple application replicas against one database. The singleton advisory lock intentionally rejects a second owner.
