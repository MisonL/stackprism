# Agent Consumption Guide

Use the profile as evidence, not as a design brief.

1. Start from `limitations`. Do not infer that a missing section means the site lacks that feature.
2. Use `visualProfile`, `layoutProfile`, and `componentProfile` to match the observable experience.
3. Use `techProfile` to select equivalent implementation tools only when the destination project has no stronger local convention.
4. Use `interactionProfile` conservatively. The first version is passive and does not click or submit controls.
5. Use `assetProfile` for dependency and CDN clues, but do not copy signed or sensitive URLs.
6. Verify the result with screenshots, DOM geometry, and interaction smoke tests in the destination app.

Never reproduce private text, account identifiers, credentials, tokens, or user-specific data from a target page.
