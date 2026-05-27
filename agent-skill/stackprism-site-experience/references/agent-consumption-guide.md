# Agent Consumption Guide

Use the profile as evidence for recreating a similar website, not as a copyable page dump.

1. Start from `agentGuidance.recreationPlan`; it turns observed evidence into implementation order, design tokens, layout blueprint, component inventory, interaction checklist, UX checklist, asset hints, and verification checks.
2. Read `limitations`. Do not infer that a missing section means the site lacks that feature.
3. Use `visualProfile`, `layoutProfile`, and `componentProfile` to match the observable experience.
4. Use `techProfile` to select equivalent implementation tools only when the destination project has no stronger local convention.
5. Use `interactionProfile` conservatively. The first version is passive and does not click or submit controls.
6. Use `assetProfile` for dependency and CDN clues, but do not copy signed or sensitive URLs.
7. Verify the result with screenshots, DOM geometry, and interaction smoke tests in the destination app.

Never reproduce private text, account identifiers, credentials, tokens, or user-specific data from a target page.
