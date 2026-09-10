# Population expansion

- Ground: existing Engine accepts50000 but Store cloned and rewrote all worlds per action. Linear whole-resource UI reads also need replacing.
- Choice: immutable row-based persistence with a shared versioned baseline plus per-world changes. Rejected raising the count alone because every consultation would copy all histories.
- Generation: deterministic per-person batches, stable IDs, fixed generator version/seed/clock; resume at the existing population count. Existing patients and records remain in place.
- Public data: published GP appointment marginals, England May2025. Historical appointment fixtures use measured marginal counts; combinations and patient clinical histories remain authored assumptions.
- Blocking first: inspect storage/action paths before assigning disjoint work.
- Independent owners: persistence; generator; public calibration and immutable regression proof; root engine/routes/import/benchmark/UI.
- Shared mutation: one existing server process and serialized persistence queue; no parallel builds or active-world imports.
- Checkpoints: migrate database retaining old snapshot, import5000, measure, continue50000, publish baseline, attach active world, test restart and browse.

5000 checkpoint:
- Import completed in roughly10seconds in500-person batches.
- Initial local API samples: search31–37ms, patient20–21ms, appointmentbook4–7ms, consultation writes1320–1335ms. This exposed a write cost before full import.
- Direct engine profiler with5000people/37843resources measured unfrozen saves265–274ms. Deep-freezing immutable rows once cost70ms and reduced saves to6.1–6.5ms. Apply this at import, hydration and successful persistence commit.

50000 checkpoint:
- Default contains exactly50000patients and370861resources; import from5000 took28.6seconds. Rerun returned complete in25ms with unchangedcounts.
- Published baseline attached to team-5253484b4cf5; SQL confirmed50000baselinepatients and retained School support follow-up(saved) and School support review(completed). Legacy snapshot remains.
- 5000 after freezing rows: consultation p50/p9560/62ms. 50000 clock120min:730ms versus3330ms before selective resource drafting.
- First50000API run exposed patient reads p501462ms and concurrent p955088ms; investigation found PostgreSQL scanning370861rows because baseline lookup was expressed as a join. Fix and final measurements follow.
- Browser QA: new team Population browser QA inherited fullpopulation, found SIM-050000 Ada X. Robinson with8historicalcontacts, saved Population continuity check and retrieved its saved narrative afterreload. Appointmentbook loaded live and historical rows with status-appropriatecontrols.
- Required58tests:57pass,1conditionalPGskip; separate actualPostgreSQL integration passed. Typecheck,skills,build,50kjourney andsmoke passed before finalSQLtuning.

Final verification (2026-09-10):
- Indexed baseline lookup and folded-ID search reduced patient SQL count549ms to0.60ms and Ada search140ms to10.55ms with identical results.
- Final local API medians/p95: search14/102ms; patient record19/21ms; appointmentbook5/5ms; consultation save694/757ms; five concurrent readers64/115ms. Five sequential samples per operation and15concurrentread samples; this is a local checkpoint, not a full hackathon load test.
- New benchmark team has zero patient overlays and exactly five resource overlays (the five saved notes), confirming baseline sharing.
- Final restart retained active-world school-support note and completed appointment. Required checks repeated after SQL fix:58tests,57pass,1conditionalPGskip; isolated actualPG suite2/2; typecheck/build pass. Final doctor/journey/smoke pass, evidence under.verification/evidence.
- No AWS deployment or DNS changes.
