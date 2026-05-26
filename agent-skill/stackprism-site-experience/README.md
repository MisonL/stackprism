# StackPrism Site Experience Skill

This is a repo-local skill package for StackPrism Agent Bridge.

It is not automatically installed into Codex or any global skill registry. Run the scripts by path from this repository, or copy/symlink this directory into your agent's skill directory if you want global discovery.

## Scripts

- `scripts/stackprism-bridge.mjs`: JavaScript loopback bridge, preferred.
- `scripts/stackprism_bridge.py`: Python standard-library fallback.

Both scripts print a single ready JSON line to stdout after the HTTP server is bound. Logs and startup errors go to stderr.

## Security Notes

- API tokens are process-local and must not be written into files.
- The bridge binds to `127.0.0.1`.
- The browser extension must be explicitly enabled for Agent Bridge in the current browser profile.
- This first version does not defend against malicious local processes or malicious extensions in the same browser profile.
