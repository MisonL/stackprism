import {
  clearBridgeSession,
  getAgentBridgeCapabilities,
  loadAgentBridgeEnabled,
  validateRegisteredBridgeMessage,
  validateStartAgentCaptureMessage
} from './agent-bridge-session'
import {
  assertStorageSessionAvailable,
  getAgentCaptureState,
  listAgentCaptureIds,
  reconcileAgentCaptureDeadlines,
  saveAgentCaptureState,
  type AgentCaptureState
} from './agent-capture-state'
import { normalizeComparableUrl, validateAgentCaptureRequest } from './agent-capture-request'
import { CAPTURE_DEADLINE_MS, makeAgentCaptureError, mapCaughtErrorCode, nonTerminalStatuses } from './agent-capture-common'
import type { AgentCaptureResponse } from './agent-capture-common'
import { resolveTargetTab } from './agent-capture-target'
import {
  clearProfileTransferPort,
  registerAgentProfileTransferPort,
  setAgentCaptureFailureHandler,
  waitForProfileTransferPort
} from './agent-capture-transfer'
import { reportCleanupFailure } from './agent-capture-failure'
import { postCaptureStatusToBridge } from './agent-capture-status'
import { cleanupStoredCaptureAndSession, cleanupTargetAndReport, failAgentCapture, getCaptureFailureDetails } from './agent-capture-lifecycle'
import { runCapture } from './agent-capture-runner'
import { isAgentBridgePageUrl } from '@/utils/page-support'
import type { AgentBridgeError, AgentBridgeRuntimeMessage, AgentCaptureRequest, StartAgentCaptureMessage } from '@/types/agent-bridge'
import { logBackgroundError } from './logging'

export { registerAgentProfileTransferPort }

let startCaptureMutation: Promise<void> = Promise.resolve()

type PreparedAgentCapture = { ok: true; state: AgentCaptureState; request: AgentCaptureRequest } | { ok: false; error: AgentBridgeError }

const NAVIGATION_ERROR_REASON_PATTERN = /^net::[A-Z0-9_]+$/
const NAVIGATION_ABORTED_ERROR = 'net::ERR_ABORTED'

const navigationErrorDetails = (error?: string): Record<string, unknown> => {
  const reason = String(error || '').trim()
  if (!reason) return {}
  return { reason: NAVIGATION_ERROR_REASON_PATTERN.test(reason) ? reason : 'navigation_error' }
}

const isSupersededNavigationError = (error?: string): boolean => String(error || '').trim() === NAVIGATION_ABORTED_ERROR

const withStartCaptureLock = async <T>(work: () => Promise<T>): Promise<T> => {
  const previous = startCaptureMutation
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const next = previous.catch(() => {}).then(() => gate)
  startCaptureMutation = next
  await previous.catch(() => {})
  try {
    return await work()
  } finally {
    release()
    if (startCaptureMutation === next) startCaptureMutation = Promise.resolve()
  }
}

setAgentCaptureFailureHandler(async (state, code, message, details, notifyBridge) => {
  await failAgentCapture(state, code, message, details, notifyBridge)
})

const loadActiveAgentCaptureStates = async (): Promise<AgentCaptureState[]> => {
  const states = await Promise.all((await listAgentCaptureIds()).map(getAgentCaptureState))
  return states.filter((state): state is AgentCaptureState => Boolean(state && nonTerminalStatuses.has(state.status)))
}

const reconcileAndCleanupAgentCaptures = async (): Promise<AgentCaptureState[]> => {
  const expired = await reconcileAgentCaptureDeadlines()
  for (const state of expired) {
    clearProfileTransferPort(state)
    await postCaptureStatusToBridge(state, state.status, 'cleanup', { error: state.error }).catch(caught =>
      reportCleanupFailure('postCaptureStatusToBridge', caught)
    )
    await cleanupTargetAndReport(state)
    await cleanupStoredCaptureAndSession(state)
  }
  return expired
}

export const handleAgentCaptureTabRemoved = async (tabId: number): Promise<void> => {
  await reconcileAndCleanupAgentCaptures()
  for (const state of await loadActiveAgentCaptureStates()) {
    if (state.bridgeTabId === tabId) {
      await failAgentCapture(state, 'BRIDGE_TAB_CLOSED', 'Agent bridge tab was closed.', {}, false)
    } else if (state.targetTabId === tabId) {
      await failAgentCapture(state, 'TARGET_TAB_CLOSED', 'Agent target tab was closed.')
    }
  }
}

export const handleAgentCaptureTabNavigation = async (tabId: number, nextUrl: unknown): Promise<void> => {
  await reconcileAndCleanupAgentCaptures()
  const normalizedNextUrl = normalizeComparableUrl(nextUrl)
  for (const state of await loadActiveAgentCaptureStates()) {
    if (state.bridgeTabId === tabId && !isAgentBridgePageUrl(nextUrl)) {
      await failAgentCapture(state, 'BRIDGE_TAB_CLOSED', 'Agent bridge tab navigated away.', {}, false)
      continue
    }
    if (!state.finalUrl || state.targetTabId !== tabId || !normalizedNextUrl) continue
    if (normalizeComparableUrl(state.finalUrl) !== normalizedNextUrl) {
      await failAgentCapture(state, 'TARGET_NAVIGATED_AWAY', 'Agent target tab navigated away.', { finalUrlChanged: true })
    }
  }
}

export const handleAgentCaptureNavigationError = async (tabId: number, frameId: number, error?: string): Promise<void> => {
  await reconcileAndCleanupAgentCaptures()
  if (frameId !== 0) return
  if (isSupersededNavigationError(error)) return
  const details = navigationErrorDetails(error)
  for (const state of await loadActiveAgentCaptureStates()) {
    if (state.targetTabId === tabId) {
      await failAgentCapture(state, 'TARGET_LOAD_FAILED', 'Agent target tab main frame failed to load.', details)
    }
  }
}

export const recoverInterruptedAgentCaptures = async (): Promise<void> => {
  const expired = await reconcileAndCleanupAgentCaptures()
  const expiredIds = new Set(expired.map(state => state.captureId))
  for (const state of await loadActiveAgentCaptureStates()) {
    if (expiredIds.has(state.captureId)) continue
    await failAgentCapture(state, 'SERVICE_WORKER_RESTARTED', 'Agent capture was interrupted by service worker restart.')
  }
}

export const handleAgentBridgeOptInDisabled = async (): Promise<void> => {
  await reconcileAndCleanupAgentCaptures()
  for (const state of await loadActiveAgentCaptureStates()) {
    await failAgentCapture(state, 'AGENT_BRIDGE_DISABLED', 'Agent Bridge was disabled in this browser profile.')
  }
}

export const startAgentCapture = async (
  message: StartAgentCaptureMessage & Record<string, unknown>,
  sender: chrome.runtime.MessageSender
): Promise<AgentCaptureResponse> => {
  const storage = assertStorageSessionAvailable()
  if (!storage.ok) return { ok: false, error: storage.error }
  await reconcileAndCleanupAgentCaptures()
  const session = await validateStartAgentCaptureMessage(message, sender)
  if (!session.ok) {
    if (Number.isInteger(sender.tab?.id)) {
      await clearBridgeSession(sender.tab!.id!).catch(caught => reportCleanupFailure('clearBridgeSession', caught))
    }
    return { ok: false, error: session.error }
  }
  const rejectBeforeTargetResolution = async (error: AgentBridgeError): Promise<AgentCaptureResponse> => {
    await clearBridgeSession(session.session.tabId).catch(caught => reportCleanupFailure('clearBridgeSession', caught))
    return { ok: false, error }
  }
  if (!(await loadAgentBridgeEnabled())) {
    return rejectBeforeTargetResolution(makeAgentCaptureError('AGENT_BRIDGE_DISABLED', 'Agent Bridge is disabled in this browser profile.'))
  }
  const requestResult = validateAgentCaptureRequest(message.request)
  if (!requestResult.ok) return rejectBeforeTargetResolution(requestResult.error)

  const prepared = await withStartCaptureLock<PreparedAgentCapture>(async () => {
    if ((await loadActiveAgentCaptureStates()).length > 0)
      return { ok: false, error: makeAgentCaptureError('CAPTURE_BUSY', 'An agent capture is already running.') }
    const bridgeTab = sender.tab
    if (bridgeTab?.incognito)
      return { ok: false, error: makeAgentCaptureError('INCOGNITO_NOT_SUPPORTED', 'Incognito bridge tabs are not supported.') }
    const now = Date.now()
    const target = await resolveTargetTab(requestResult.request, session.session.windowId)
    if (!target.ok) return { ok: false, error: target.error }
    if (target.tab.incognito)
      return { ok: false, error: makeAgentCaptureError('INCOGNITO_NOT_SUPPORTED', 'Incognito target tabs are not supported.') }
    const state: AgentCaptureState = {
      captureId: session.session.captureId,
      sessionId: session.session.sessionId,
      nonce: session.session.nonce,
      bridgeOrigin: session.session.bridgeOrigin,
      bridgeUrl: sender.url || '',
      bridgeTabId: session.session.tabId,
      bridgeWindowId: session.session.windowId,
      targetTabId: target.tab.id,
      targetWindowId: target.tab.windowId,
      targetUrl: requestResult.request.url,
      targetMode: requestResult.request.options.targetMode,
      createdByCapture: target.createdByCapture,
      keepTabOpen: requestResult.request.options.keepTabOpen,
      phase: 'target_opening',
      status: 'running',
      startedAt: now,
      updatedAt: now,
      deadlineAt: now + CAPTURE_DEADLINE_MS
    }
    await saveAgentCaptureState(state)
    return { ok: true, state, request: requestResult.request }
  })
  if (!prepared.ok) return rejectBeforeTargetResolution(prepared.error)
  const { state, request } = prepared
  if (!(await waitForProfileTransferPort(state))) {
    await cleanupTargetAndReport(state)
    await cleanupStoredCaptureAndSession(state)
    return {
      ok: false,
      error: makeAgentCaptureError('BRIDGE_TRANSPORT_DISCONNECTED', 'Agent bridge profile transfer port is not connected.')
    }
  }
  runCapture(state, request, getAgentBridgeCapabilities()).catch(error => {
    logBackgroundError('Agent capture runner failed', { captureId: state.captureId, error })
    failAgentCapture(
      state,
      mapCaughtErrorCode(error, 'PROFILE_TRANSPORT_FAILED'),
      'Agent capture runner failed.',
      getCaptureFailureDetails(error)
    ).catch(caught => logBackgroundError('Agent capture runner failure cleanup failed', { captureId: state.captureId, error: caught }))
  })
  return { ok: true, data: null }
}

export const cancelAgentCapture = async (
  message: AgentBridgeRuntimeMessage,
  sender: chrome.runtime.MessageSender
): Promise<AgentCaptureResponse> => {
  if (message.type !== 'AGENT_CAPTURE_CONTROL' || message.command !== 'cancel') return { ok: true, data: null }
  const storage = assertStorageSessionAvailable()
  if (!storage.ok) return { ok: false, error: storage.error }
  await reconcileAndCleanupAgentCaptures()
  const validated = await validateRegisteredBridgeMessage(message, sender)
  if (!validated.ok) return { ok: false, error: validated.error }
  const state = await getAgentCaptureState(message.captureId)
  if (!state || !nonTerminalStatuses.has(state.status)) return { ok: true, data: null }
  state.status = 'cancelled'
  state.phase = 'cleanup'
  state.updatedAt = Date.now()
  state.error = undefined
  await saveAgentCaptureState(state)
  clearProfileTransferPort(state)
  await cleanupTargetAndReport(state)
  await postCaptureStatusToBridge(state, 'cancelled', 'cleanup').catch(caught => reportCleanupFailure('postCaptureStatusToBridge', caught))
  await cleanupStoredCaptureAndSession(state)
  return { ok: true, data: null }
}
