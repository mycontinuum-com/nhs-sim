Generated with the built-in Imagegen tool.

## Final prompt

Use case: ui-mockup
Asset type: high fidelity design reference for an existing synthetic healthcare hackathon simulator.
Primary request: Design two adjacent desktop browser screens for a convincing UK care staff identity sign-in emulator, inspired by NHS service design. Left screen: entry page. Right screen: choosing a working role.
Style: restrained public-service transactional web design, blue masthead, white background, large readable black Arial typography, green primary button, thin grey separators, generous purposeful whitespace. No dashboard cards or left sidebar. Small persistent amber strip reading "SIMULATION — fictional staff identities". Use text wordmark "Care Identity" with adjacent small "NHS-SIM" label, no official NHS logo.
Left exact text: "Sign in with your Care Identity", "Choose how to sign in", "Smartcard", "Security key", "Simulate smartcard sign-in", "Developer and operator tools" as collapsed disclosure. Smartcard graphic should be a simple fictional card with chip, no real photo, no PIN fields, no real credentials.
Right exact text: "Choose your role", "Dr Maya Shah", "Riverside Practice", "General practitioner", "Millbank Hospital", "Clinical practitioner", "Continue", "Back". Radio choices and clear organisation codes such as "SIM-RIV". Small disclosure "Technical session details".
Constraints: implementable accessible form layout; realistic workflow, explicitly emulator, no actual NHS branding, no fabricated biometric scans, no gradients/glass/lavish decoration. 1600x1000 landscape composition showing both full pages with crisp hierarchy.

## Implementation notes

Reference: sign-in-reference-v1.png. The implementation keeps the generated form hierarchy, blue masthead, simulation strip and green actions. It uses the emulator's existing fictional staff names, omits the generated slogans and implements controls in accessible HTML rather than embedding a screenshot.
