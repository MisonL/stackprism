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
  removeAgentCaptureState,
  saveAgentCaptureState,
  type AgentCaptureState
} from './agent-capture-state'
import { normalizeComparableUrl, validateAgentCaptureRequest } from './agent-capture-request'
import {
  CAPTURE_DEADLINE_MS,
  makeAgentCaptureError,
  mapCaughtErrorCode,
  nonTerminalStatuses,
  PROFILE_TRANSFER_DEADLINE_MS,
  runningStatuses
} from './agent-capture-common'
import type { AgentCaptureResponse } from './agent-capture-common'
import {
  cleanupTarget,
  cleanForCapture,
  captureVisibleViewportScreenshot,
  executeExperienceProfiler,
  getAgentCaptureUserAgent,
  getExtensionVersion,
  resolveTargetTab,
  waitForTargetTabLoaded
} from './agent-capture-target'
import { validateAgentCaptureNetwork, waitForAgentCaptureNetworkEvidence } from './agent-capture-network'
import {
  clearProfileTransferPort,
  registerAgentProfileTransferPort,
  sendProfileToBridge,
  setAgentCaptureFailureHandler,
  waitForProfileTransferPort
} from './agent-capture-transfer'
import { failAgentCaptureWithPoster, reportCleanupFailure } from './agent-capture-failure'
import { postCaptureStatusToBridge } from './agent-capture-status'
import { runAgentPageDetection } from './detection'
import { loadDetectorSettings } from './detector-settings'
import { buildPopupRawResult } from './popup-cache'
import { getTabData, getTabSnapshot } from './tab-store'
import { buildSiteExperienceProfile } from '@/utils/site-experience-profile'
import { isAgentBridgePageUrl, isDetectablePageUrl } from '@/utils/page-support'
import type { AgentBridgeError, AgentBridgeRuntimeMessage, AgentCaptureRequest, StartAgentCaptureMessage } from '@/types/agent-bridge'
import { logBackgroundError, sanitizeLogDetails } from './logging'

export { registerAgentProfileTransferPort }

const MAX_FAILURE_REASON_CHARS = 240
let startCaptureMutation: Promise<void> = Promise.resolve()

type CaptureFailureError = Error & { details?: Record<string, unknown> }

type PreparedAgentCapture = { ok: true; state: AgentCaptureState; request: AgentCaptureRequest } | { ok: false; error: AgentBridgeError }

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

const sanitizeFailureReason = (caught: unknown): string => {
  const rawReason = caught instanceof Error ? caught.message || caught.name : String(caught || '')
  const sanitized = sanitizeLogDetails({ reason: rawReason }).reason
  return String(sanitized || 'unknown').slice(0, MAX_FAILURE_REASON_CHARS)
}

const makeCaptureFailureError = (code: AgentBridgeError['code'], caught?: unknown): CaptureFailureError => {
  const error = new Error(code) as CaptureFailureError
  if (caught !== undefined) error.details = { reason: sanitizeFailureReason(caught) }
  return error
}

const getCaptureFailureDetails = (caught: unknown): Record<string, unknown> => {
  if (!(caught instanceof Error) || !('details' in caught)) return {}
  const details = caught.details
  return details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>) : {}
}

const shouldContinueCapture = async (state: AgentCaptureState): Promise<boolean> => {
  const latest = await getAgentCaptureState(state.captureId)
  return Boolean(latest && runningStatuses.has(latest.status))
}

const cleanupTargetAndReport = async (state: AgentCaptureState): Promise<void> => {
  await cleanupTarget(state).catch(caught => reportCleanupFailure('cleanupTarget', caught))
}

const cleanupStoredCaptureAndSession = async (state: AgentCaptureState): Promise<void> => {
  await removeAgentCaptureState(state.captureId).catch(caught => reportCleanupFailure('removeAgentCaptureState', caught))
  await clearBridgeSession(state.bridgeTabId).catch(caught => reportCleanupFailure('clearBridgeSession', caught))
}

const failAgentCapture = async (
  state: AgentCaptureState,
  code: AgentBridgeError['code'],
  message: string = code,
  details: Record<string, unknown> = {},
  notifyBridge = true
): Promise<void> => {
  const latest = await getAgentCaptureState(state.captureId)
  if (!latest || !nonTerminalStatuses.has(latest.status)) return
  state = latest
  await failAgentCaptureWithPoster(state, code, postCaptureStatusToBridge, message, details, notifyBridge)
}

setAgentCaptureFailureHandler(async (state, code, message, details, notifyBridge) => {
  await failAgentCapture(state, code, message, details, notifyBridge)
})

const runCapture = async (state: AgentCaptureState, request: AgentCaptureRequest, capabilities: any): Promise<void> => {
  try {
    if (!state.targetTabId) throw new Error('TARGET_TAB_CLOSED')
    const targetTabId = state.targetTabId
    const loadedTab = await waitForTargetTabLoaded(targetTabId, state.deadlineAt)
    if (!(await shouldContinueCapture(state))) return
    const targetTab = {
      id: loadedTab.id ?? state.targetTabId,
      url: loadedTab.url || '',
      title: loadedTab.title || ''
    }
    const finalUrl = normalizeComparableUrl(targetTab.url)
    if (!finalUrl || !isDetectablePageUrl(finalUrl)) throw new Error('FINAL_URL_BLOCKED')
    state.finalUrl = finalUrl
    state.phase = 'target_loaded'
    state.updatedAt = Date.now()
    await saveAgentCaptureState(state)
    state = await waitForAgentCaptureNetworkEvidence(state)
    const networkError = validateAgentCaptureNetwork(state, request)
    if (networkError) {
      await failAgentCapture(state, networkError.code, networkError.message, networkError.details || {})
      return
    }
    await postCaptureStatusToBridge(state, 'running', 'target_loaded', {
      finalUrl,
      targetNetworkAddress: state.targetNetwork?.ip,
      targetNetworkFromCache: state.targetNetwork?.fromCache
    })

    const shouldRunTech = request.include.includes('tech')
    const shouldRunExperience = request.include.some(section => section !== 'tech')
    if (request.options.forceRefresh) await cleanForCapture(targetTabId)
    if (!(await shouldContinueCapture(state))) return
    if (shouldRunTech) {
      try {
        await runAgentPageDetection(targetTabId, state.deadlineAt)
      } catch (caught) {
        throw makeCaptureFailureError(mapCaughtErrorCode(caught, 'TARGET_INJECTION_FAILED'), caught)
      }
    }
    if (request.waitMs > 0) await new Promise(resolve => setTimeout(resolve, Math.min(request.waitMs, 30000)))
    if (!(await shouldContinueCapture(state))) return
    let experience = null
    if (shouldRunExperience) {
      try {
        experience = await executeExperienceProfiler(targetTabId, {
          captureScreenshotMetadata: request.options.captureScreenshotMetadata
        })
      } catch (caught) {
        throw makeCaptureFailureError('TARGET_INJECTION_FAILED', caught)
      }
    }
    const [settings, data, tab] = await Promise.all([loadDetectorSettings(), getTabData(targetTabId), getTabSnapshot(targetTabId)])
    const raw = shouldRunTech ? await buildPopupRawResult(data, settings, tab) : null
    const capturedAt = new Date().toISOString()
    const screenshotResult =
      request.options.captureScreenshot && request.include.includes('visual')
        ? await captureVisibleViewportScreenshot(targetTabId, state.targetWindowId || state.bridgeWindowId, state.bridgeTabId)
        : { screenshot: null, limitations: [] }
    if (!(await shouldContinueCapture(state))) return
    const profile = buildSiteExperienceProfile({
      captureId: state.captureId,
      request,
      raw,
      experience,
      capabilities,
      screenshot: screenshotResult.screenshot,
      limitations: screenshotResult.limitations,
      finalUrl,
      userAgent: getAgentCaptureUserAgent(),
      extensionVersion: getExtensionVersion(),
      capturedAt,
      pageSupported: true
    })
    state.phase = 'posting_profile'
    state.profileTransferDeadlineAt = Date.now() + PROFILE_TRANSFER_DEADLINE_MS
    await saveAgentCaptureState(state)
    if (!(await shouldContinueCapture(state))) return
    await sendProfileToBridge(state, profile)
    state.status = 'completed'
    state.phase = 'cleanup'
    state.updatedAt = Date.now()
    await saveAgentCaptureState(state)
    clearProfileTransferPort(state)
  } catch (caught) {
    const code = mapCaughtErrorCode(caught, 'PROFILE_TRANSPORT_FAILED')
    await failAgentCapture(state, code, code, getCaptureFailureDetails(caught))
    return
  }
  await cleanupTargetAndReport(state)
  await cleanupStoredCaptureAndSession(state)
}

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

export const handleAgentCaptureNavigationError = async (tabId: number, frameId: number): Promise<void> => {
  await reconcileAndCleanupAgentCaptures()
  if (frameId !== 0) return
  for (const state of await loadActiveAgentCaptureStates()) {
    if (state.targetTabId === tabId) {
      await failAgentCapture(state, 'TARGET_LOAD_FAILED', 'Agent target tab main frame failed to load.')
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
    const target = await resolveTargetTab(requestResult.request, session.session.windowId)
    if (!target.ok) return { ok: false, error: target.error }
    if (target.tab.incognito)
      return { ok: false, error: makeAgentCaptureError('INCOGNITO_NOT_SUPPORTED', 'Incognito target tabs are not supported.') }
    const now = Date.now()
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
