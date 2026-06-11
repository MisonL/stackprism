# StackPrism Site Experience Skill

This is a repo-local skill package for StackPrism Agent Bridge.

It is not automatically installed into Codex or any global skill registry. Run the scripts by path from this repository, or copy/symlink this directory into your agent's skill directory if you want global discovery.

Paths in this package are relative to the StackPrism repository root. If an agent starts from another working directory, it should either `cd <repo-root>` before launching the bridge or resolve `agent-skill/...` to an absolute script path. The bridge scripts are repo-local tools, not global commands.

## Scripts

- `scripts/capture-site.mjs`: preferred one-shot capture client. It starts the JavaScript bridge, keeps stdin open, creates the capture, polls for the completed profile, writes the profile JSON, downloads the screenshot image when present, and rewrites the Profile screenshot reference to the local image file before exiting.
- `scripts/stackprism-bridge.mjs`: JavaScript loopback bridge, preferred.
- `scripts/stackprism_bridge.py`: Python standard-library fallback.

The direct bridge scripts print a single ready JSON line to stdout after the HTTP server is bound. Logs and startup errors go to stderr.

Use `capture-site.mjs` for ordinary agent work. Use `stackprism-bridge.mjs` or the Python fallback directly only for protocol debugging or custom orchestration.

`capture-site.mjs` prints one JSON summary to stdout on success and one JSON error object to stderr on failure. It bounds each bridge API request with `--request-timeout-ms`, defaulting to 30000 ms, so a stalled local bridge fails explicitly instead of hanging the calling agent. It also accepts `--include tech,visual,layout,components,interaction,ux,assets` and `--max-resource-urls <n>` so retry attempts can reduce profile size without editing scripts.

The bridge page opened in the browser becomes a result workbench after completion: target URL, screenshot preview, enlarged screenshot preview, screenshot download/copy, one-click Markdown summary, and grouped profile content cards. The page reads only the status preview with its one-capture `bridgeToken`; raw `/profile` still requires the API token.

The JavaScript bridge and Python fallback intentionally share the same bridge page CSS and client script text. If `scripts/bridge/bridge-page-assets.mjs` changes, update `scripts/stackprism_bridge_lib/bridge_page_assets.py` in the same patch and keep `tests/stackprism_bridge_py.test.mjs` passing.

Profile JSON is standard JSON and cannot contain comments. Screenshot guidance is stored in `note`, `profileJsonNote`, and `agentGuidance.recreationPlan.visualReference.screenshotDownloadHint`. Screenshot base64 is intentionally omitted; open `visualProfile.screenshot.downloadUrl` to inspect the actual visual appearance.

Lifecycle: direct bridge screenshot links are valid only while the local bridge process is running and before the completed result TTL expires. The capture helper avoids that race by downloading the image during the live bridge window and saving a stable local `file://` URL plus `localPath` in the written Profile.

When selecting a non-default browser or profile, keep the opener executable and its arguments separate: `STACKPRISM_BROWSER_OPEN_COMMAND` is only the executable or platform opener, while `STACKPRISM_BROWSER_OPEN_ARGS_JSON` is a JSON string array of opener/profile arguments. The bridge URL is appended by the script as the final argv item.

Local development targets such as `localhost`, `127.0.0.1`, RFC1918 addresses, and real intranet hosts require both the extension's high-risk all-network-targets setting and the helper/request `--allow-private-network` override. Treat a `PRIVATE_NETWORK_TARGET_BLOCKED` response as a safety gate, not as a reason to reuse the old bridge URL.

## Security Notes

- API tokens are process-local and must not be written into files.
- The bridge binds to `127.0.0.1`.
- The browser extension must be explicitly enabled for Agent Bridge in the current browser profile.
- This first version does not defend against malicious local processes or malicious extensions in the same browser profile.
