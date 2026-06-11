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

The bridge page status preview, `copyText`, and grouped `contentSummary` are convenience views derived from the completed profile. Raw `/profile` access still requires the API token, and neither `apiToken`, `bridgeToken`, nonce, raw profile JSON, nor screenshot data URLs should be copied into downstream code, issue text, or prompts.

Never reproduce private text, account identifiers, credentials, tokens, or user-specific data from a target page. Screenshots are not pixel-redacted, so do not request or consume them for login-protected, account-specific, or private pages.
