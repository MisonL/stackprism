import { getPreviousActiveTab } from './active-tab-tracker'
import { normalizeComparableUrl } from './agent-capture-request'
import { clearBundleLicenseTimer } from './bundle-license'
import { clearDynamicSnapshotState } from './dynamic-snapshot'
import { clearBadge, clearTabSession } from './tab-store'
import type { AgentCaptureRequest } from '@/types/agent-bridge'
import type { AgentBridgeError } from '@/types/agent-bridge'
import { makeAgentCaptureError } from './agent-capture-common'
import { logBackgroundError } from './logging'

const TARGET_LOAD_TIMEOUT_REPORTING_GRACE_MS = 5000
const MAX_TARGET_LOAD_WAIT_MS = 60000

export const cleanForCapture = async (tabId: number): Promise<void> => {
  clearBundleLicenseTimer(tabId)
  clearDynamicSnapshotState(tabId)
  await clearTabSession(tabId)
  clearBadge(tabId)
}

export const cleanupTarget = async (state: { targetTabId?: number; createdByCapture?: boolean; keepTabOpen?: boolean }): Promise<void> => {
  if (typeof state.targetTabId !== 'number') return
  await cleanForCapture(state.targetTabId)
  if (state.createdByCapture && !state.keepTabOpen) {
    await chrome.tabs.remove(state.targetTabId)
  }
}

const findReusableTab = async (targetUrl: string): Promise<chrome.tabs.Tab | null> => {
  const tabs = await chrome.tabs.query({})
  return tabs.find(tab => !tab.incognito && normalizeComparableUrl(tab.url) === targetUrl) || null
}

type TargetResolution = { ok: true; tab: chrome.tabs.Tab; createdByCapture: boolean } | { ok: false; error: AgentBridgeError }

export const resolveTargetTab = async (request: AgentCaptureRequest, bridgeWindowId: number): Promise<TargetResolution> => {
  if (request.options.targetMode === 'active_tab') {
    return resolveActiveTargetTab(request, bridgeWindowId)
  }
  if (request.options.targetMode === 'reuse_or_new_tab' && request.options.allowPrivateNetworkTarget) {
    const reusable = await findReusableTab(request.url)
    if (reusable) return { ok: true, tab: reusable, createdByCapture: false }
  }
  const tab = await chrome.tabs.create({ url: request.url, active: false, windowId: bridgeWindowId })
  if (tab.incognito) {
    if (typeof tab.id === 'number') {
      await chrome.tabs.remove(tab.id).catch(error => logBackgroundError('incognito target tab cleanup failed', { tabId: tab.id, error }))
    }
    return { ok: false, error: makeAgentCaptureError('INCOGNITO_NOT_SUPPORTED', 'Incognito tabs are not supported.') }
  }
  return { ok: true, tab, createdByCapture: true }
}

const resolveActiveTargetTab = async (request: AgentCaptureRequest, bridgeWindowId: number): Promise<TargetResolution> => {
  const active = await getPreviousActiveTab(bridgeWindowId)
  if (!active) {
    return { ok: false, error: makeAgentCaptureError('ACTIVE_TAB_UNAVAILABLE', 'Previous active tab is unavailable.') }
  }
  if (normalizeComparableUrl(active.url) !== request.url) {
    return { ok: false, error: makeAgentCaptureError('ACTIVE_TAB_MISMATCH', 'Previous active tab URL does not match target URL.') }
  }
  try {
    const tab = await chrome.tabs.get(active.tabId)
    if (tab.incognito) {
      return { ok: false, error: makeAgentCaptureError('INCOGNITO_NOT_SUPPORTED', 'Incognito tabs are not supported.') }
    }
    return { ok: true, tab, createdByCapture: false }
  } catch {
    return { ok: false, error: makeAgentCaptureError('ACTIVE_TAB_UNAVAILABLE', 'Previous active tab was closed.') }
  }
}

export const waitForTargetTabLoaded = async (tabId: number, deadlineAt: number): Promise<chrome.tabs.Tab> => {
  const current = await chrome.tabs.get(tabId)
  if (current.status === 'complete') return current
  const timeoutMs = Math.max(0, Math.min(deadlineAt - Date.now() - TARGET_LOAD_TIMEOUT_REPORTING_GRACE_MS, MAX_TARGET_LOAD_WAIT_MS))
  return new Promise((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      chrome.tabs.onUpdated?.removeListener?.(listener)
      chrome.tabs.onRemoved?.removeListener?.(removedListener)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedTabId !== tabId) return
      if (changeInfo.status === 'complete' || tab.status === 'complete') {
        finish(() => resolve(tab))
      }
    }
    const removedListener = (removedTabId: number) => {
      if (removedTabId === tabId) finish(() => reject(new Error('TARGET_TAB_CLOSED')))
    }
    chrome.tabs.onUpdated?.addListener?.(listener)
    chrome.tabs.onRemoved?.addListener?.(removedListener)
    timeout = setTimeout(() => finish(() => reject(new Error('TARGET_LOAD_TIMEOUT'))), timeoutMs)
  })
}

export const executeExperienceProfiler = async (
  tabId: number,
  options: { captureScreenshotMetadata: boolean } = { captureScreenshotMetadata: false }
): Promise<any> => {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: profilerOptions => {
      ;(globalThis as any).__STACKPRISM_EXPERIENCE_OPTIONS__ = profilerOptions
    },
    args: [{ captureScreenshotMetadata: options.captureScreenshotMetadata === true }]
  })
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['injected/experience-profiler.iife.js']
    })
    return injection?.[0]?.result || null
  } finally {
    await chrome.scripting
      .executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          delete (globalThis as any).__STACKPRISM_EXPERIENCE_OPTIONS__
        }
      })
      .catch(() => {})
  }
}

export const getAgentCaptureUserAgent = (): string =>
  typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : ''

export const getExtensionVersion = (): string => {
  try {
    return chrome.runtime.getManifest().version || ''
  } catch {
    return ''
  }
}
