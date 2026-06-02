import { makeAgentCaptureError, nonTerminalStatuses } from './agent-capture-common'
import {
  getAgentCaptureState,
  listAgentCaptureIds,
  saveAgentCaptureState,
  type AgentCaptureNetworkEvidence,
  type AgentCaptureState
} from './agent-capture-state'
import { normalizeComparableUrl } from './agent-capture-request'
import type { AgentBridgeError, AgentCaptureRequest } from '@/types/agent-bridge'
import { isPrivateNetworkAddress, isProxyReservedNetworkAddress } from '@/utils/network-address-policy'

const TARGET_NETWORK_WAIT_MS = 1000
const TARGET_NETWORK_POLL_MS = 25
const NETWORK_EVIDENCE_CAPTURE_RACE_GRACE_MS = 5000
let networkObserverRegistered = false
let networkObserverTarget: unknown = null
const tabNetworkEvidence = new Map<number, AgentCaptureNetworkEvidence>()

export interface AgentCaptureNetworkPolicy {
  allowAllNetworkTargets?: boolean
}

const isMainFrameResponse = (details: chrome.webRequest.WebResponseCacheDetails): boolean =>
  details.tabId >= 0 && details.type === 'main_frame' && Boolean(normalizeComparableUrl(details.url))

const findCaptureStatesForTab = async (tabId: number): Promise<AgentCaptureState[]> => {
  const states = await Promise.all((await listAgentCaptureIds()).map(getAgentCaptureState))
  return states.filter((state): state is AgentCaptureState =>
    Boolean(state && state.targetTabId === tabId && nonTerminalStatuses.has(state.status))
  )
}

const toNetworkEvidence = (details: chrome.webRequest.WebResponseCacheDetails): AgentCaptureNetworkEvidence => ({
  url: normalizeComparableUrl(details.url),
  ip: typeof details.ip === 'string' && details.ip.trim() ? details.ip.trim() : undefined,
  fromCache: details.fromCache === true,
  observedAt: Date.now()
})

const isFreshNetworkEvidence = (state: AgentCaptureState, evidence: AgentCaptureNetworkEvidence | undefined): boolean =>
  Boolean(
    evidence &&
      Number.isFinite(evidence.observedAt) &&
      evidence.observedAt >= (state.targetNetworkObservedAfter ?? state.startedAt)
  )

const saveFreshNetworkEvidence = async (state: AgentCaptureState, evidence: AgentCaptureNetworkEvidence): Promise<void> => {
  const latest = await getAgentCaptureState(state.captureId)
  if (!latest || latest.targetTabId !== state.targetTabId || !nonTerminalStatuses.has(latest.status)) return
  if (!isFreshNetworkEvidence(latest, evidence)) return
  latest.targetNetwork = evidence
  latest.updatedAt = Date.now()
  await saveAgentCaptureState(latest)
}

export const recordAgentCaptureNetworkResponse = async (details: chrome.webRequest.WebResponseCacheDetails): Promise<void> => {
  if (!isMainFrameResponse(details)) return
  const evidence = toNetworkEvidence(details)
  tabNetworkEvidence.set(details.tabId, evidence)
  for (const state of await findCaptureStatesForTab(details.tabId)) {
    await saveFreshNetworkEvidence(state, evidence)
  }
}

export const clearAgentCaptureNetworkEvidence = (tabId: number): void => {
  tabNetworkEvidence.delete(tabId)
}

export const clearStaleAgentCaptureNetworkEvidence = async (tabId: number): Promise<void> => {
  const evidence = tabNetworkEvidence.get(tabId)
  if (!evidence) return
  const activeStates = await findCaptureStatesForTab(tabId)
  if (activeStates.some(state => isFreshNetworkEvidence(state, evidence))) return
  if (Date.now() - evidence.observedAt < NETWORK_EVIDENCE_CAPTURE_RACE_GRACE_MS) return
  tabNetworkEvidence.delete(tabId)
}

export const registerAgentCaptureNetworkObserver = (onError: (tabId: number, error: unknown) => void): void => {
  if (networkObserverRegistered) return
  const responseStarted = chrome.webRequest?.onResponseStarted
  if (!responseStarted?.addListener) {
    networkObserverTarget = null
    return
  }
  networkObserverRegistered = true
  networkObserverTarget = responseStarted
  responseStarted.addListener(
    details => {
      recordAgentCaptureNetworkResponse(details).catch(error => onError(details.tabId, error))
    },
    { urls: ['http://*/*', 'https://*/*'] }
  )
}

const networkBlockedError = (details: Record<string, unknown>): AgentBridgeError =>
  makeAgentCaptureError('PRIVATE_NETWORK_TARGET_BLOCKED', 'Private network targets are disabled.', details)

const isCurrentNetworkEvidence = (state: AgentCaptureState): boolean => {
  const finalUrl = normalizeComparableUrl(state.finalUrl)
  return Boolean(finalUrl && isFreshNetworkEvidence(state, state.targetNetwork) && normalizeComparableUrl(state.targetNetwork?.url) === finalUrl)
}

const networkEvidenceDiagnostics = (state: AgentCaptureState): Record<string, unknown> => {
  const observedUrlMatchesFinal = isCurrentNetworkEvidence(state)
  const targetNetwork = state.targetNetwork
  if (!targetNetwork) {
    return {
      reason: 'target_network_address_unverified',
      verificationStatus: 'missing_main_frame_response',
      observedUrlMatchesFinal: false
    }
  }
  if (!observedUrlMatchesFinal) {
    if (normalizeComparableUrl(targetNetwork.url) === normalizeComparableUrl(state.finalUrl) && !isFreshNetworkEvidence(state, targetNetwork)) {
      return {
        reason: 'target_network_address_unverified',
        verificationStatus:
          typeof state.targetNetworkObservedAfter === 'number'
            ? 'main_frame_response_before_required_refresh'
            : 'main_frame_response_stale',
        observedUrlMatchesFinal: true,
        targetNetworkFromCache: targetNetwork.fromCache === true,
        targetNetworkIpPresent: Boolean(targetNetwork.ip)
      }
    }
    return {
      reason: 'target_network_address_unverified',
      verificationStatus: 'main_frame_url_mismatch',
      observedUrlMatchesFinal: false,
      targetNetworkFromCache: targetNetwork.fromCache === true,
      targetNetworkIpPresent: Boolean(targetNetwork.ip)
    }
  }
  if (targetNetwork.fromCache) {
    return {
      reason: 'target_network_address_unverified',
      verificationStatus: 'main_frame_response_from_cache',
      observedUrlMatchesFinal: true,
      targetNetworkFromCache: true,
      targetNetworkIpPresent: Boolean(targetNetwork.ip)
    }
  }
  return {
    reason: 'target_network_address_unverified',
    verificationStatus: 'main_frame_response_missing_ip',
    observedUrlMatchesFinal: true,
    targetNetworkFromCache: false,
    targetNetworkIpPresent: false
  }
}

const isIpLiteral = (value: string): boolean => {
  const host = value.replace(/^\[|\]$/g, '')
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')
}

const canUseProxyReservedAddress = (state: AgentCaptureState, ip: string): boolean => {
  if (!isProxyReservedNetworkAddress(ip)) return false
  try {
    const finalUrl = new URL(state.finalUrl || '')
    return !isIpLiteral(finalUrl.hostname) && !isPrivateNetworkAddress(finalUrl.hostname)
  } catch {
    return false
  }
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export const waitForAgentCaptureNetworkEvidence = async (state: AgentCaptureState): Promise<AgentCaptureState> => {
  if (!isNetworkObserverActive()) return state
  const deadline = Date.now() + TARGET_NETWORK_WAIT_MS
  while (Date.now() < deadline) {
    const latest = await getAgentCaptureState(state.captureId)
    if (!latest) return state
    if (isCurrentNetworkEvidence(latest)) return latest
    const observed = typeof latest.targetTabId === 'number' ? tabNetworkEvidence.get(latest.targetTabId) : undefined
    if (isFreshNetworkEvidence(latest, observed) && normalizeComparableUrl(observed?.url) === normalizeComparableUrl(latest.finalUrl)) {
      latest.targetNetwork = observed
      await saveAgentCaptureState(latest)
      return latest
    }
    await wait(TARGET_NETWORK_POLL_MS)
  }
  return (await getAgentCaptureState(state.captureId)) || state
}

export const validateAgentCaptureNetwork = (
  state: AgentCaptureState,
  request: AgentCaptureRequest,
  policy: AgentCaptureNetworkPolicy = {}
): AgentBridgeError | null => {
  if (request.options.allowPrivateNetworkTarget || policy.allowAllNetworkTargets) return null
  if (!isNetworkObserverActive()) return null
  if (!isCurrentNetworkEvidence(state)) {
    return networkBlockedError(networkEvidenceDiagnostics(state))
  }
  const targetNetwork = state.targetNetwork
  if (!targetNetwork || targetNetwork.fromCache || !targetNetwork.ip) {
    return networkBlockedError(networkEvidenceDiagnostics(state))
  }
  if (isPrivateNetworkAddress(targetNetwork.ip) && !canUseProxyReservedAddress(state, targetNetwork.ip)) {
    return networkBlockedError({ reason: 'private_network_address', address: targetNetwork.ip })
  }
  return null
}

const isNetworkObserverActive = (): boolean =>
  networkObserverRegistered && Boolean(networkObserverTarget) && networkObserverTarget === chrome.webRequest?.onResponseStarted
