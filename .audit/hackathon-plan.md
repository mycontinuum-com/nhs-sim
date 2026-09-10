# Hackathon alignment

- [x] Read Poteto Mode principles and frame the work.
- [x] Ground current seed, shared UI, documentation, and AWS access.
- [x] Compare compact workspaces with a challenge launchpad; compare handbook with reference sidebars.
- [x] Implement compact workspaces and an on-demand system directory.
- [x] Build a Docusaurus participant handbook under the existing public port.
- [x] Discover production EHR structure with AWS CLI after session refresh.
- [x] Generate deterministic fictional longitudinal records; distinguish authored defaults from production-derived calibration.
- [x] Run skill validation, typecheck, tests, build, and the live journey and smoke suite.
- [x] Inspect browser layouts and report remaining gaps.

The three implementation seams are shared UI, docs/build/static serving, and synthetic population generation. Each has one writer. AWS access was refreshed; 50 EHR objects yielded only rounded collection-size aggregates. No production records will be copied into fixtures.

Done means participants can switch systems without persistent sidebars, follow a working handbook, and explore varied synthetic patient histories. Production calibration currently covers collection-size distributions only. The biased 50-object sample is not demographic or clinical validation, and 100-team concurrent load remains untested.
