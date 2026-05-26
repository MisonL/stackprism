---
name: stackprism-site-experience
description: Use when an agent needs to collect StackPrism site experience profiles from a user's installed browser extension through the local loopback bridge.
---

# StackPrism Site Experience

Use this skill when you need browser-observed technology, visual, layout, component, interaction, UX, and asset facts from a target website before implementing a similar experience.

## Preconditions

- The user has installed the StackPrism extension in the browser profile that will open the bridge page.
- StackPrism Agent Bridge is enabled in the extension settings for that local browser profile.
- The target URL is `http:` or `https:`.
- Local development targets require `"allowPrivateNetworkTarget": true`.

## Start The Bridge

Prefer the JavaScript bridge:

```bash
node agent-skill/stackprism-site-experience/scripts/stackprism-bridge.mjs
```

Use the Python fallback only when Node is unavailable:

```bash
python3 agent-skill/stackprism-site-experience/scripts/stackprism_bridge.py
```

The Python fallback is a compatibility path built on the standard library HTTP server. Prefer the JavaScript bridge for long-running or repeated captures; if the Python fallback stalls under local connection pressure, stop the child process, start a fresh bridge, and retry the capture instead of reusing partial state.

Read exactly one JSON line from stdout within 10 seconds. Treat timeout as `BRIDGE_START_TIMEOUT`, any non-JSON stdout before readiness as `BRIDGE_READY_PARSE_FAILED`, and a missing or mismatched `protocolVersion` as `BRIDGE_PROTOCOL_UNSUPPORTED`.

The ready line contains `baseUrl`, `healthUrl`, and `apiToken`. Send ordinary logs to stderr only. Never paste or store the token in source files.

Always stop the bridge child process in a `finally` block after the capture finishes or fails. On startup failure, protocol mismatch, or parse failure, terminate the child process and wait for it to exit before reporting the error. If a fixed `STACKPRISM_BRIDGE_PORT` is already occupied, the script exits non-zero with `PORT_IN_USE` on stderr and no ready JSON.

If StackPrism is installed in a non-default browser or browser profile, set `STACKPRISM_BROWSER_OPEN_COMMAND` to that browser executable. Put profile arguments in `STACKPRISM_BROWSER_OPEN_ARGS_JSON` as a JSON string array; the bridge script appends the bridge URL as the final argv item. Do not include the bridge URL in the environment variable.

## Capture A Target

Call `POST /v1/captures` with `Authorization: Bearer {apiToken}`:

```json
{
  "url": "https://example.com",
  "mode": "experience",
  "waitMs": 3000,
  "include": ["tech", "visual", "layout", "components", "interaction", "ux", "assets"],
  "viewports": [{ "name": "desktop", "width": 1440, "height": 900, "deviceScaleFactor": 1 }],
  "options": {
    "forceRefresh": true,
    "captureScreenshotMetadata": false,
    "keepTabOpen": false,
    "allowPrivateNetworkTarget": false,
    "targetMode": "reuse_or_new_tab",
    "maxResourceUrls": 300
  }
}
```

Then poll `GET /v1/captures/{id}` and read `GET /v1/captures/{id}/profile` when status is `completed`.

Large pages can produce multi-chunk profile transfers. If the browser extension reports `BRIDGE_TRANSPORT_DISCONNECTED`, `PROFILE_TRANSPORT_FAILED`, `PROFILE_CHUNK_MISSING`, or `CAPTURE_TIMEOUT`, treat the capture as failed, stop the bridge child process, start a new bridge, and retry once with a smaller `include` set or lower `maxResourceUrls`. Do not synthesize a profile from partial chunks.

Handle user-actionable failures explicitly:

- `AGENT_BRIDGE_DISABLED`: ask the user to enable Agent Bridge in the StackPrism settings for this local browser profile. Do not retry or fall back to a mock profile.
- `EXTENSION_NOT_CONNECTED`: the opened browser/profile probably does not have StackPrism installed or enabled. Set `STACKPRISM_BROWSER_OPEN_COMMAND` and `STACKPRISM_BROWSER_OPEN_ARGS_JSON` for the correct Chrome/Edge profile.
- `BROWSER_OPEN_FAILED`: surface the sanitized stderr/details and keep the capture failed. Do not ask the user to paste a token-bearing bridge URL.

## Use The Profile

- Treat `techProfile` as implementation guidance, not a mandate to copy the source site's private stack.
- Prioritize layout density, visual hierarchy, interaction feedback, and information architecture.
- Respect `limitations`; missing fields may mean a section was not requested or was truncated.
- Do not reproduce sensitive text, account data, tokens, signed URLs, or private user content.

## Trust Boundary

The first version trusts the local bridge process started by the user or agent. Loopback, nonce, and `bridgeToken` bind one capture to one local browser page, but they do not prove the process was not spoofed by another local process. The DOM-readable `bridgeToken` is also not secret from other installed extensions in the same browser profile.
