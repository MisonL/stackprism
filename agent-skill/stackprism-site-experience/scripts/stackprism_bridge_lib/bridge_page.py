from .bridge_page_assets import BRIDGE_PAGE_SCRIPT, BRIDGE_PAGE_STYLE
from .protocol import PROTOCOL_VERSION, html_escape_script_json, new_csp_nonce, redact_url
from .status import FINAL_STATES


BRIDGE_PAGE_HTML_TEMPLATE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="stackprism-agent-bridge" content="1">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>StackPrism Agent Bridge</title>
<style nonce="{csp_nonce}">{style}</style>
</head>
<body>
<main class="bridge-shell">
<section id="bridgeCard" class="bridge-card" data-status="waiting_extension" aria-labelledby="bridge-title" tabindex="-1">
<header class="bridge-header">
<div class="bridge-mark" aria-hidden="true">SP</div>
<div><p class="bridge-kicker">本机通道</p><h1 id="bridge-title" class="bridge-title">StackPrism Agent Bridge</h1><p class="bridge-copy">正在连接本机 Agent 与当前浏览器 profile，请保持本页打开。</p></div>
<span id="statusBadge" class="bridge-badge">等待扩展连接</span>
</header>
<div class="bridge-body">
<section class="status-panel" aria-live="polite"><div id="stateLabel" class="state-label">等待扩展连接</div><p id="status" class="status-text">等待 StackPrism 扩展连接。</p><div class="progress" aria-hidden="true"><span id="progressBar"></span></div></section>
		<section class="preview-panel" aria-label="采集预览"><div><p class="preview-label">目标网址</p><p id="targetUrl" class="target-url">等待读取目标网址</p><p id="copyStatus" class="copy-status" role="status" aria-live="polite"></p><div class="preview-actions"><button id="copyAllInfo" class="preview-button" type="button" disabled>复制全部信息</button></div></div><div><p class="preview-label">截图预览</p><button id="screenshotFrame" class="screenshot-frame" type="button" disabled><img id="targetScreenshot" alt=""><div class="screenshot-empty">采集完成后显示可用截图</div></button><p id="screenshotMeta" class="screenshot-meta">截图可用后会显示格式与范围</p><div class="preview-actions"><button id="copyScreenshot" class="preview-button" type="button" disabled>复制截图</button><button id="screenshotDownload" class="preview-button" type="button" disabled>下载截图</button></div></div></section>
		<div id="stepSummary" class="step-summary" role="status" aria-live="polite">当前步骤：扩展连接</div><ol class="steps" aria-label="采集步骤" role="list"><li class="step current" data-phase="bridge_connected" aria-current="step"><span class="step-index">1</span><div>扩展连接</div></li><li class="step" data-phase="request_loaded"><span class="step-index">2</span><div>读取请求</div></li><li class="step" data-phase="target_opening"><span class="step-index">3</span><div>打开目标</div></li><li class="step" data-phase="target_loaded"><span class="step-index">4</span><div>页面加载</div></li><li class="step" data-phase="detecting_tech"><span class="step-index">5</span><div>技术识别</div></li><li class="step" data-phase="profiling_experience"><span class="step-index">6</span><div>体验分析</div></li><li class="step" data-phase="posting_profile"><span class="step-index">7</span><div>回传 Profile</div></li><li class="step" data-phase="cleanup"><span class="step-index">8</span><div>清理完成</div></li></ol>
<section id="profileContentSection" class="content-section" hidden><div class="section-head"><div><h2>Profile 内容</h2><p>已转换为 Agent 可读摘要，完整 raw profile 仍需 API token 读取。</p></div></div><div id="profileContentGrid" class="content-grid"></div></section>
<footer class="bridge-footer"><p class="bridge-note">本页只服务当前一次采集；摘要不包含 token、nonce、raw JSON 或截图 data URL。</p><div class="pills"><span class="pill">127.0.0.1</span><span class="pill">当前 profile</span><span class="pill">只读采集</span></div></footer>
</div>
</section>
</main>
<section id="screenshotModal" class="screenshot-modal" data-open="false" aria-label="截图放大预览" role="dialog" aria-modal="true"><div class="modal-card"><div class="modal-bar"><p class="modal-title">截图预览</p><div class="modal-actions"><button id="modalCopyScreenshot" class="modal-close" type="button" disabled>复制截图</button><button id="modalDownload" class="modal-close" type="button" disabled>下载截图</button><button id="modalClose" class="modal-close" type="button">关闭</button></div></div><p id="modalCopyStatus" class="modal-copy-status" role="status" aria-live="polite"></p><img id="modalScreenshot" class="modal-image" alt=""></div></section>
<script id="stackprism-agent-bridge-config" type="application/json" nonce="{csp_nonce}">{config}</script>
<script nonce="{csp_nonce}">{script}</script>
</body>
</html>"""


def render_bridge_page_html(csp_nonce, config):
    return BRIDGE_PAGE_HTML_TEMPLATE.format(csp_nonce=csp_nonce, style=BRIDGE_PAGE_STYLE, config=config, script=BRIDGE_PAGE_SCRIPT)


def bridge_page_response(handler, capture):
    if capture["status"] == "expired":
        return "fail", 410, "CAPTURE_RESULT_EXPIRED", "Capture result expired.", None
    if capture["status"] in FINAL_STATES:
        error = capture.get("error") or {}
        return "fail", 409, error.get("code") or "INVALID_REQUEST", "Capture is already terminal.", {"status": capture["status"]}
    if capture["bridgeTokenRenderedAt"] or capture["bridgeTokenClaimedAt"]:
        return "fail", 409, "INVALID_REQUEST", "Bridge token has already been rendered.", None
    capture["bridgeTokenRenderedAt"] = handler.server.store.now()
    return "html", {
        "captureId": capture["id"],
        "sessionId": capture["sessionId"],
        "nonce": capture["nonce"],
        "bridgeToken": capture["bridgeToken"],
        "targetUrl": redact_url((capture.get("request") or {}).get("url")),
        "protocolVersion": PROTOCOL_VERSION,
    }


def render_bridge_page(handler, capture):
    with handler.server.store._lock:
        response = bridge_page_response(handler, capture)
    if response[0] == "fail":
        handler.fail(response[1], response[2], response[3], response[4])
        return
    csp_nonce = new_csp_nonce()
    config = html_escape_script_json(response[1])
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
        f"default-src 'none'; script-src 'nonce-{csp_nonce}'; style-src 'nonce-{csp_nonce}'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    )
    handler.end_headers()
    handler.wfile.write(render_bridge_page_html(csp_nonce, config).encode("utf-8"))
