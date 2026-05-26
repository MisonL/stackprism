from .protocol import PROTOCOL_VERSION, html_escape_script_json, new_csp_nonce
from .status import FINAL_STATES


def render_bridge_page(handler, capture):
    with handler.server.store._lock:
        if capture["status"] == "expired":
            response = ("fail", 410, "CAPTURE_RESULT_EXPIRED", "Capture result expired.", None)
            config_data = None
        elif capture["status"] in FINAL_STATES:
            error = capture.get("error") or {}
            response = (
                "fail",
                409,
                error.get("code") or "INVALID_REQUEST",
                "Capture is already terminal.",
                {"status": capture["status"]},
            )
            config_data = None
        elif capture["bridgeTokenRenderedAt"] or capture["bridgeTokenClaimedAt"]:
            response = ("fail", 409, "INVALID_REQUEST", "Bridge token has already been rendered.", None)
            config_data = None
        else:
            response = None
            capture["bridgeTokenRenderedAt"] = handler.server.store.now()
            config_data = {
                "captureId": capture["id"],
                "sessionId": capture["sessionId"],
                "nonce": capture["nonce"],
                "bridgeToken": capture["bridgeToken"],
                "protocolVersion": PROTOCOL_VERSION,
            }
    if response:
        handler.fail(response[1], response[2], response[3], response[4])
        return
    csp_nonce = new_csp_nonce()
    config = html_escape_script_json(config_data)
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("X-Frame-Options", "DENY")
    handler.send_header("Cross-Origin-Opener-Policy", "same-origin")
    handler.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
    handler.send_header(
        "Content-Security-Policy",
        f"default-src 'none'; script-src 'nonce-{csp_nonce}'; style-src 'nonce-{csp_nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    )
    handler.end_headers()
    status_script = (
        "const statusEl=document.getElementById('status');"
        "const config=JSON.parse(document.getElementById('stackprism-agent-bridge-config').textContent);"
        "const setStatus=(value)=>{statusEl.textContent=value};"
        "const poll=async()=>{try{"
        "const res=await fetch('/v1/captures/'+config.captureId,{headers:{Authorization:'Bearer '+config.bridgeToken},cache:'no-store'});"
        "const body=await res.json();"
        "if(!res.ok){setStatus(body?.error?.code||'Bridge request failed.');return}"
        "setStatus(body.status+(body.phase?' / '+body.phase:''));"
        "if(['completed','failed','cancelled','expired'].includes(body.status))return"
        "}catch{setStatus('Bridge status unavailable.')}"
        "setTimeout(poll,1000)};poll();"
    )
    handler.wfile.write(
        (
            '<!doctype html><html><head><meta charset="utf-8"><meta name="stackprism-agent-bridge" content="1">'
            '<title>StackPrism Agent Bridge</title></head><body><p id="status">Waiting for StackPrism extension.</p>'
            f'<script id="stackprism-agent-bridge-config" type="application/json" nonce="{csp_nonce}">{config}</script>'
            f'<script nonce="{csp_nonce}">{status_script}</script>'
            "</body></html>"
        ).encode("utf-8")
    )
