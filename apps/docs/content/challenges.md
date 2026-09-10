---
title: Choose a challenge
---

# Choose a challenge

Start with one workflow. Demonstrate the state before your intervention, the actions your system takes, and the observed result.

## Close a rejected referral

Use `SIM-000002`. Inspect referrals and diagnostics, then retrieve the additional letter through the [legacy browser](./legacy.mdx). Share the relevant records and progress the referral through its owning service.

Show which evidence was missing and whether the referral was accepted. Creating another referral does not prove that the original problem is resolved.

## Coordinate a discharge

Use `SIM-000001`. Find the hospital document, GP task, and pharmacy supply. Order a test from GP and advance the clock by 121 simulation minutes:

```bash
curl --fail --silent "$SIM_ORIGIN/api/clock" \
  -H "Authorization: Bearer $SIM_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"advanceMinutes":121}'
```

Inspect diagnostics for the available result. Ask the organiser to introduce a pathology outage when you are ready to test failure handling.

## Make a browser-only record useful

Transfer a letter from the legacy browser into GP. Show the form submission and the newly visible GP document. The legacy JSON endpoint intentionally returns HTTP 501.

## Coordinate support at home

Use `SIM-000006`. Read the activity observations and unresolved support plan. Schedule a community visit, handle unavailable capacity, and inspect completion after advancing the clock.

## Present the evidence

Keep the initial seed and intervention sequence fixed when comparing runs. Report completed work, rejected actions, and review effort separately. Synthetic counters do not establish real-world clinical benefit.

See the [API reference](./api.md) for available actions and the [data guide](./data.md) for visibility rules.
