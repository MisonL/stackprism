from .protocol import PROTOCOL_VERSION, is_known_bridge_error_code

FINAL_STATES = {"completed", "failed", "cancelled", "expired"}
PLUGIN_WRITABLE_STATUSES = {"waiting_extension", "running", "cancelled", "failed"}
STATUS_PHASES = [
    "bridge_connected",
    "request_loaded",
    "target_opening",
    "target_loaded",
    "detecting_tech",
    "profiling_experience",
    "posting_profile",
    "cleanup",
]
PHASE_ORDER = {phase: index for index, phase in enumerate(STATUS_PHASES)}


def public_status(capture):
    status = {"id": capture["id"], "status": capture["status"]}
    if capture.get("phase"):
        status["phase"] = capture["phase"]
    if capture.get("error"):
        status["error"] = capture["error"]
    return status


def validate_status_update(capture, body):
    if capture["status"] in FINAL_STATES:
        return False, "STALE_STATUS_UPDATE", "Capture is already terminal."
    if (
        body.get("captureId") != capture["id"]
        or body.get("sessionId") != capture["sessionId"]
        or body.get("nonce") != capture["nonce"]
        or body.get("protocolVersion") != PROTOCOL_VERSION
    ):
        return False, "INVALID_REQUEST", "Capture status identity is invalid."
    if body.get("status") not in PLUGIN_WRITABLE_STATUSES or body.get("phase") not in PHASE_ORDER:
        return False, "INVALID_REQUEST", "Capture status or phase is invalid."
    if body["status"] == "cancelled" and capture["status"] != "cancel_requested":
        return False, "STALE_STATUS_UPDATE", "Capture cancellation was not requested."
    if capture["status"] == "cancel_requested" and body["status"] != "cancelled":
        return False, "STALE_STATUS_UPDATE", "Capture cancellation is already requested."
    if body["status"] == "failed" and not (body.get("error", {}).get("code") and body.get("error", {}).get("message")):
        return False, "INVALID_REQUEST", "Failed status requires a structured error."
    if body["status"] == "failed" and not is_known_bridge_error_code(body["error"]["code"]):
        return False, "INVALID_REQUEST", "Failed status error code is invalid."
    if body["status"] in {"cancelled", "failed"} and body["phase"] != "cleanup":
        return False, "INVALID_REQUEST", "Terminal status must use cleanup phase."
    if not isinstance(body.get("sequence"), int) or body["sequence"] <= capture["sequence"]:
        return False, "STALE_STATUS_UPDATE", "Capture status sequence is stale."
    if PHASE_ORDER[body["phase"]] < PHASE_ORDER.get(capture.get("phase"), -1):
        return False, "STALE_STATUS_UPDATE", "Capture phase cannot move backwards."
    return True, None, None
