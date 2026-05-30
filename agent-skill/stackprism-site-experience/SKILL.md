---
name: stackprism-site-experience
description: Use when an AI agent needs to recreate or improve a website from a real URL. Captures browser-observed tech stack, UI design, layout, interactions, UX, and assets through StackPrism so the agent can build from evidence.
---

# StackPrism Site Experience

StackPrism helps AI agents recreate websites from real browser evidence: tech stack, UI design, layout, components, interactions, UX, and assets.

Use this skill proactively when the task involves:

- Building or cloning a page, app, component set, landing page, dashboard, or marketing site similar to an existing URL.
- Reviewing or improving UI/UX by comparing against a live product, competitor, reference site, or production page.
- Choosing implementation details from evidence: detected technologies, visual tokens, layout density, component patterns, interaction behavior, asset dependencies, and first-order UX structure.
- Verifying that a target page's browser-observed facts match a design brief, audit claim, or migration requirement.

Do not use this skill for backend-only tasks, generic web search, SEO content extraction, login-protected private data capture, or cases where the user has not installed and enabled StackPrism Agent Bridge.

## Preconditions

- The user has installed the StackPrism extension in the browser profile that will open the bridge page.
- StackPrism Agent Bridge is enabled in the extension settings for that local browser profile.
- The target URL is `http:` or `https:`.
- Local development targets require `"allowPrivateNetworkTarget": true`.
- If the user has enabled the extension's high-risk "allow all network targets" setting, still pass `--allow-private-network` for local or DNS-proxy targets; the extension setting affects the browser-observed final target gate, while the helper's create-stage URL policy remains explicit per capture.

## Preferred Capture Command

Use the capture helper first. It keeps the bridge child process alive, creates one fresh bridge per capture, polls the profile endpoint, and can decode the optional screenshot:

```bash
cd <repo-root>
node agent-skill/stackprism-site-experience/scripts/capture-site.mjs \
  --url https://target.example \
  --out /tmp/stackprism-profile.json \
  --result-out /tmp/stackprism-result.json \
  --screenshot-out /tmp/stackprism-screenshot.jpg
```

Set `STACKPRISM_BROWSER_OPEN_COMMAND` and `STACKPRISM_BROWSER_OPEN_ARGS_JSON` only when the default opener is not the browser/profile with StackPrism installed. On macOS, for example, use `STACKPRISM_BROWSER_OPEN_COMMAND=open` and `STACKPRISM_BROWSER_OPEN_ARGS_JSON='["-a","Google Chrome"]'` to force Chrome.

The helper prints one JSON summary on stdout. `screenshotPresent` means the profile contains screenshot evidence; `screenshotWritten` means the optional `--screenshot-out` file was actually written and can be opened by image-capable coding tools.

Each bridge API request has a bounded timeout. The default is 30000 ms; use `--request-timeout-ms <ms>` only when a slower local browser opener or debug bridge needs more time. If it exits with `BRIDGE_REQUEST_TIMEOUT`, stop that attempt and start one fresh helper process rather than reusing a partial capture.

The opened bridge page is also a local result workbench. After completion it shows the target URL, screenshot preview, click-to-enlarge preview, screenshot download/copy buttons, a one-click Markdown summary, and grouped profile content cards. That page only uses the bridge-token status preview; it cannot read raw `/profile`. For programmatic use, prefer the helper output or the API-token profile endpoint.

If the helper exits with `PRIVATE_NETWORK_TARGET_BLOCKED` in a known DNS-proxy or local-development environment, run a second fresh helper process with `--allow-private-network` and record that this was a controlled override. Do not reuse the first bridge URL, capture id, session, or token.

If the helper exits with `CAPTURE_BUSY`, wait a few seconds, stop any bridge child process from that attempt, and run one fresh helper process. Do not keep polling an old capture after a terminal or stale status.

When wrapping retries in shell scripts, avoid reserved or readonly shell variable names such as `status` in zsh. Use names like `capture_status` instead so a successful helper run is not masked by wrapper errors.

## Advanced Bridge API

All script paths in this skill are repository-relative. Run commands from the StackPrism checkout root, or resolve `agent-skill/...` to an absolute script path before spawning the bridge from another working directory. These scripts are repo-local tools, not global executables. Use the manual bridge API only when you need protocol-level debugging or custom orchestration beyond the capture helper.

For advanced use, prefer the JavaScript bridge:

```bash
cd <repo-root>
node agent-skill/stackprism-site-experience/scripts/stackprism-bridge.mjs
```

Use the Python fallback only when Node is unavailable:

```bash
cd <repo-root>
python3 agent-skill/stackprism-site-experience/scripts/stackprism_bridge.py
```

The Python fallback is a compatibility path built on the standard library HTTP server. Prefer the JavaScript bridge for long-running or repeated captures; if the Python fallback stalls under local connection pressure, stop the child process, start a fresh bridge, and retry the capture instead of reusing partial state.

Read exactly one JSON line from stdout within 10 seconds. Treat timeout as `BRIDGE_START_TIMEOUT`, any non-JSON stdout before readiness as `BRIDGE_READY_PARSE_FAILED`, and a missing or mismatched `protocolVersion` as `BRIDGE_PROTOCOL_UNSUPPORTED`.

The ready line contains `baseUrl`, `healthUrl`, and `apiToken`. Send ordinary logs to stderr only. Never paste or store the token in source files.

Always stop the bridge child process in a `finally` block after the capture finishes or fails. On startup failure, protocol mismatch, or parse failure, terminate the child process and wait for it to exit before reporting the error. If a fixed `STACKPRISM_BRIDGE_PORT` is already occupied, the script exits non-zero with `PORT_IN_USE` on stderr and no ready JSON.

If StackPrism is installed in a non-default browser or browser profile, set `STACKPRISM_BROWSER_OPEN_COMMAND` to the platform opener or browser executable, and put only opener/profile arguments in `STACKPRISM_BROWSER_OPEN_ARGS_JSON` as a JSON string array. The bridge script appends the bridge URL as the final argv item. Do not include the bridge URL in the environment variable.

Keep the executable and arguments separate. For example, use `STACKPRISM_BROWSER_OPEN_COMMAND=open` with `STACKPRISM_BROWSER_OPEN_ARGS_JSON='["-a","Google Chrome"]'`, not `STACKPRISM_BROWSER_OPEN_COMMAND='open -a Google Chrome'`.

Platform notes:

- macOS default opener: `open`. To force Chrome, use `STACKPRISM_BROWSER_OPEN_COMMAND=open` and `STACKPRISM_BROWSER_OPEN_ARGS_JSON='["-a","Google Chrome"]'`. To select a Chrome profile, use the Chrome executable as the command and pass profile args, for example `["--profile-directory=Default"]`.
- Windows default opener: command `rundll32.exe` with the built-in argument `url.dll,FileProtocolHandler`. To force Chrome or Edge, set `STACKPRISM_BROWSER_OPEN_COMMAND` to the full browser `.exe` path and put profile args such as `["--profile-directory=Default"]` in `STACKPRISM_BROWSER_OPEN_ARGS_JSON`.
- Linux default opener: `xdg-open`. To force Chrome or Chromium, set `STACKPRISM_BROWSER_OPEN_COMMAND` to `google-chrome`, `chromium`, or the absolute executable path, and put profile args such as `["--profile-directory=Default"]` in `STACKPRISM_BROWSER_OPEN_ARGS_JSON`.

## Capture A Target

Call `POST /v1/captures` with `Authorization: Bearer {apiToken}`:

```json
{
  "url": "https://target.example",
  "mode": "experience",
  "waitMs": 3000,
  "include": ["tech", "visual", "layout", "components", "interaction", "ux", "assets"],
  "viewports": [{ "name": "desktop", "width": 1440, "height": 900, "deviceScaleFactor": 1 }],
  "options": {
    "forceRefresh": true,
    "captureScreenshotMetadata": false,
    "captureScreenshot": false,
    "keepTabOpen": false,
    "allowPrivateNetworkTarget": false,
    "targetMode": "reuse_or_new_tab",
    "maxResourceUrls": 300
  }
}
```

Use the real target URL for the task. Do not treat `https://example.com` as the default smoke target; in some local DNS-proxy environments public hostnames can resolve to `198.18.*` and correctly fail closed unless private-network targets are explicitly allowed for a controlled test.

Then poll `GET /v1/captures/{id}` and read `GET /v1/captures/{id}/profile` when status is `completed`.

If the consuming model can read images, set `"captureScreenshot": true` with `include` containing `"visual"`. The profile will include `visualProfile.screenshot.dataUrl` when Chrome can capture the visible target viewport. This can briefly activate the target tab before returning to the bridge page. Treat it as optional evidence; models without image input should ignore it. The screenshot is kept in the bridge's in-memory profile and is cleared when the completed profile TTL expires or the bridge process exits. A user-downloaded or clipboard-copied screenshot is managed by the browser or operating system and is not auto-deleted by StackPrism. The screenshot is not text-redacted pixel by pixel, so do not request it for login-protected or private user pages.

Large pages can produce multi-chunk profile transfers. If the browser extension reports `BRIDGE_TRANSPORT_DISCONNECTED`, `PROFILE_TRANSPORT_FAILED`, `PROFILE_CHUNK_MISSING`, or `CAPTURE_TIMEOUT`, treat the capture as failed, stop the bridge child process, start a new bridge, and retry once with a smaller `include` set or lower `maxResourceUrls`. Do not synthesize a profile from partial chunks.

Handle user-actionable failures explicitly:

- `AGENT_BRIDGE_DISABLED`: ask the user to enable Agent Bridge in the StackPrism settings for this local browser profile. Do not retry or fall back to a mock profile.
- `EXTENSION_NOT_CONNECTED`: the opened browser/profile probably does not have StackPrism installed or enabled. Set `STACKPRISM_BROWSER_OPEN_COMMAND` and `STACKPRISM_BROWSER_OPEN_ARGS_JSON` for the correct Chrome/Edge profile.
- `BROWSER_OPEN_FAILED`: surface the sanitized stderr/details and keep the capture failed. Do not ask the user to paste a token-bearing bridge URL.

## Use The Profile

- Start from `agentGuidance.recreationPlan`. Follow its `implementationOrder`, then map `designTokens`, `layoutBlueprint`, `componentInventory`, `interactionChecklist`, `uxChecklist`, and `assetHints` into the target project.
- Use `visualProfile.screenshot.dataUrl` as an optional visual reference only when it is present and your model supports image input.
- Treat `techProfile` as implementation guidance, not a mandate to copy the source site's private stack.
- Prioritize layout density, visual hierarchy, interaction feedback, and information architecture.
- Respect `limitations`; missing fields may mean a section was not requested or was truncated.
- Do not reproduce sensitive text, account data, tokens, signed URLs, or private user content.

## Trust Boundary

The first version trusts the local bridge process started by the user or agent. Loopback, nonce, and `bridgeToken` bind one capture to one local browser page, but they do not prove the process was not spoofed by another local process. The DOM-readable `bridgeToken` is also not secret from other installed extensions in the same browser profile.
