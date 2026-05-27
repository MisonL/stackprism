# Site Experience Profile Schema

Schema id: `stackprism.site_experience_profile.v1`

Top-level fields:

- `target`: normalized target URL, final URL, title, `language`, viewport summaries, and page support status. `language` is taken from page language attributes when available; it is not inferred from user identity or account data.
- `browserContext`: extension version, capture time, requested viewports, bridge protocol version, and extension capabilities.
- `techProfile`: detected technologies, confidence summary, and implementation notes.
- `visualProfile`: colors, typography, spacing, shape, elevation, density, and theme mode.
- `layoutProfile`: landmarks, hero, grids, responsive behavior, sticky elements, and above-fold summary.
- `componentProfile`: buttons, links, forms, cards, navigation, overlays, and data display patterns.
- `interactionProfile`: passive hover/focus/transition/animation evidence and loading or scroll behavior.
- `uxProfile`: bounded first-order UX signals: `pagePurpose`, `primaryUserPath`, `informationHierarchy`, `ctaStrategy`, `trustSignals`, `navigationDepth`, `contentGrouping`, `frictionPoints`, and limited `textSamples`.
- `assetProfile`: scripts, stylesheets, resource domains, image/font hints, manifest, favicon, and redaction policy.
- `evidence`: confidence buckets, raw counts, source coverage, and truncation metadata.
- `limitations`: explicit capture boundaries and omitted sections.
- `agentGuidance`: implementation priorities, cautions, and `recreationPlan` for downstream agents. `recreationPlan` contains `implementationOrder`, `designTokens`, `layoutBlueprint`, `componentInventory`, `interactionChecklist`, `uxChecklist`, `assetHints`, and `verificationChecklist`.

Profiles must not contain cookie values, authorization values, localStorage/sessionStorage plaintext, signed URL secrets, full sensitive query strings, or copied private page text. UX labels and text samples must be short, best-effort summaries with token-like values, email, phone numbers, long numeric identifiers, hashes, and sensitive query values redacted before they reach the bridge.
