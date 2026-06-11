# Agent Consumption Guide

Use the profile as evidence for recreating a similar website, not as a copyable page dump.

1. Read `limitations` first. Do not infer that a missing section means the site lacks that feature.
2. Start from `agentGuidance.recreationPlan`; it turns observed evidence into implementation order, design tokens, layout blueprint, component inventory, interaction checklist, UX checklist, asset hints, visual reference, and verification checks.
3. Open or download `visualProfile.screenshot.downloadUrl` only when present and needed for visual comparison. The Profile JSON intentionally omits screenshot base64; do not assume the JSON text alone shows the final visual appearance.
4. Cross-check `visualProfile`, `layoutProfile`, and `componentProfile` before choosing layout, density, and component patterns.
5. Use `techProfile` to select equivalent implementation tools only when the destination project has no stronger local convention.
6. Use `interactionProfile` conservatively. The first version is passive and does not click or submit controls.
7. Use `assetProfile` for dependency and CDN clues, but do not copy signed or sensitive URLs.
8. Implement against the destination project's conventions, then verify with `agentGuidance.recreationPlan.verificationChecklist`, screenshots, DOM geometry, and interaction smoke tests.

Hard evidence gates:

- If `visualProfile` or screenshot evidence is missing, do not claim visual parity. Limit the conclusion to the available sections, or recapture with `include` containing `visual` and screenshot capture enabled.
- A tech-only profile supports technology, dependency, and runtime observations only. It is not sufficient for UI implementation, visual comparison, or visual verification.
- Destination project conventions override the source page's stack for component library, routing, state, CSS architecture, test framework, accessibility baseline, and build tooling.
- Interaction smoke tests should cover viewport, key path, hover and focus states, empty and error states, overlays or navigation, scroll and sticky behavior, responsive breakpoint, screenshot or DOM geometry evidence, and explicit limitations.

The bridge page status preview, `copyText`, and grouped `contentSummary` are convenience views derived from the completed profile. Raw `/profile` access still requires the API token, and neither `apiToken`, `bridgeToken`, nonce, raw profile JSON, nor screenshot data URLs should be copied into downstream code, issue text, or prompts.

Never reproduce private text, account identifiers, credentials, tokens, or user-specific data from a target page. Screenshots are not pixel-redacted, so do not request or consume them for login-protected, account-specific, or private pages. Use a public demo, desensitized test environment, design brief, or user-provided summary instead.
