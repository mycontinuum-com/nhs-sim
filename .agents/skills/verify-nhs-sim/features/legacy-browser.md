# Legacy browser workflow

The fictional legacy EPR denies JSON API access but permits a real CSRF-protected HTML correspondence workflow suitable for RPA experiments.

## Sub-features

- Vendor-style HTTP 501 response
- Session cookie creation
- Browser-only correspondence table
- Explicit document transfer to GP

## How to get to it (user POV)

Open `/legacy/`, connect with a team key, start a legacy session, and use Send copy to GP inside the embedded system.

## Driving it with control-nhs-sim

Run `pnpm verify -- smoke`. It creates a session, reads the form token, submits one correspondence item, follows the transfer, and confirms the GP can see the document.

## Gotchas

- The legacy site API must remain unavailable; do not bypass it with a test-only endpoint.
- The session cookie and CSRF token are both required.
- Form submission is not enough; verify the record becomes GP-visible.
