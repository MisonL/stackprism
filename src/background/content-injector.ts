import { isDetectablePageUrl } from '@/utils/page-support'
import { sanitizeLogDetails } from './logging'

const CONTENT_OBSERVER_FILE_PATTERN = /(^|\/)content-observer(?:\.ts)?(?:[-.]|$)/

const canInjectContentObserver = (tab: chrome.tabs.Tab): boolean => typeof tab?.id === 'number' && isDetectablePageUrl(tab.url)

export const getContentObserverFile = (): string | undefined => {
  const contentScripts = chrome.runtime.getManifest().content_scripts || []
  for (const script of contentScripts) {
    const observerFile = script.js?.find(file => CONTENT_OBSERVER_FILE_PATTERN.test(file))
    if (observerFile) return observerFile
  }
  return undefined
}

export const injectContentObserver = async (tabId: number, options: { failOnError?: boolean } = {}): Promise<void> => {
  const observerFile = getContentObserverFile()
  if (!observerFile) {
    if (options.failOnError) throw new Error('CONTENT_OBSERVER_NOT_FOUND')
    console.warn('[SP background] Content observer injection skipped.', sanitizeLogDetails({ reason: 'CONTENT_OBSERVER_NOT_FOUND', tabId }))
    return
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [observerFile]
    })
  } catch (error) {
    if (options.failOnError) throw error
    console.warn('[SP background] Content observer injection failed.', sanitizeLogDetails({ tabId, observerFile, error }))
    return
  }
}

export const injectContentObserverIntoOpenTabs = async (): Promise<void> => {
  try {
    const tabs = await chrome.tabs.query({})
    await Promise.allSettled(tabs.filter(canInjectContentObserver).map(tab => injectContentObserver(tab.id!)))
  } catch {
    return
  }
}
