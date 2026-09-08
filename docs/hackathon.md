# Playable projects and expansion map

## Projects that can use the scaffold now

1. **Close the referral loop.** Patient SIM-000002 repeatedly requests help. The rejection is in referrals, the imaging report in diagnostics and another letter in the legacy browser. Discover, share and coordinate the evidence, then progress the referral.
2. **Post-discharge coordination.** SIM-000001 has a hospital document, GP task and pharmacy supply. Order monitoring, process the result and coordinate follow-up. Test under a pathology outage.
3. **Pharmacy assistant.** Draft a prescription, request review/approval and progress dispensing/collection. Dispatch a robot and verify completion rather than assuming the request succeeded.
4. **Home-monitoring coordinator.** SIM-000006 has an activity trend and unresolved support plan. Inspect observations, distinguish disconnected-device data, and allocate a home visit within finite capacity.
5. **Legacy integration agent.** Use browser automation to transfer a document. API requests deliberately fail with the fictional supplier's integration policy.
6. **A&E staffing assistant.** Report doctor/nurse absences in ES-Arrr, alter allocation in Allocate-ish, and observe staffed capacity and blocked emergency completion in Epi-ish/CAD-astrophe.
7. **Resource-aware robot dispatcher.** Queue jobs, handle busy robots and maintenance incidents, and verify eventual completion.
8. **Accessible care navigator.** SIM-000003 works shifts; SIM-000008 needs offline contact. Use patient needs and goals when creating communication and follow-up tasks.
9. **Shared-record explorer.** Build a timeline from different API projections without assuming every record is visible everywhere.
10. **NHS integration starter.** Implement OIDC PKCE against CIS-too and exercise local e-RS/EPS-like action adapters.

## Plan coverage: implemented vs extension

The [10-Year Health Plan](https://www.gov.uk/government/publications/10-year-health-plan-for-england-fit-for-the-future/fit-for-the-future-10-year-health-plan-for-england-accessible-version) motivates the environment. These are simulation design choices, not validated predictions of policy effects.

| Theme | Working foundation | Next deeper implementation |
|---|---|---|
| Hospital → community | Home-visit capacity, shared care plan, discharge handover | Eligibility, travel, home access, social-care packages |
| Analogue → digital | Multiple sites, APIs, explicit sharing, browser-only workflow | Incompatible full EPR schemas and document pipelines |
| Prevention | Screening fixtures, patient access needs | Eligibility engine, invitations, uptake and long-horizon cohorts |
| Wearables | Synthetic observation stream, device disconnection | Multiple sensor models, measurement vs arrival times, personalised baselines |
| Robotics | Capacity-bound courier jobs and simulated failures | Route planning, battery consumption, surgery scheduling constraints |
| Genomics | Uncertain variant and family-history fixture | Consent, test directory, phenotype journeys and specialist review |
| Patient choice | Goals, needs and patient-facing workbench | Provider comparison, real proxy permissions and shared decisions |
| Workforce | Absence, allocation, A&E staffed-space constraint | Time-bounded shifts, leave approval, fatigue and supervision |
| Quality | Event audit, completed-work and resource metrics | Outcome/experience measures, incident detection, case-mix adjustment |
| Finance | Capacity and review-time counters | Costs, budgets, commissioning and incentive scenarios |
| Mental health, maternity, dentistry | Extensible patient/resource/action primitives | Authored pathways and distinct interfaces; not yet implemented |
| Research | Synthetic genomics/population workbench | Consent-aware trial matching and recruitment workflows |

## Evaluation

Record actions, completed work, review minutes, rejected work and staffing constraints separately. Compare identical seeds with a fixed intervention sequence. Never describe synthetic counters as demonstrated real-world clinical benefits.

Missing data must not imply health. A message is not treatment; collection is not adherence; referral creation is not acceptance; dispatch is not delivery. Teams should show how they verify consequential steps.

## Suggested event setup

Issue one key per team and share it within the team. Keep the operator token to organisers. Test the expected number of worlds before the event; the initial JSONB snapshot backend is deliberately simple. Keep normal rule agents enabled, then inject one incident during judging.

Keep model APIs opt-in. Default agents are deterministic state machines and require no paid access. A team can run its own agent externally using the API, or add an Agent implementation in packages/agents.
