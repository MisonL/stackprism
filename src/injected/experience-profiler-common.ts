export const LIMITS = {
  nodes: 2000,
  styleNodes: 80,
  componentSamples: 80,
  textSamples: 80,
  cssRules: 400,
  resourceUrls: 300,
  executeScriptResultBytes: 2 * 1024 * 1024
} as const

export type Truncation = {
  domNodes: number
  componentSamples: number
  textSamples: number
  cssRules: number
  resourceUrls: number
  executeScriptResult: number
}

export const emptyTruncation = (): Truncation => ({
  domNodes: 0,
  componentSamples: 0,
  textSamples: 0,
  cssRules: 0,
  resourceUrls: 0,
  executeScriptResult: 0
})

export const cleanText = (value: unknown, limit = 140): string =>
  String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\b(?:\+?\d[\d\s-]{8,}\d|\d{11,})\b/g, '[redacted]')
    .replace(/(?:[￥$€£]\s*\d+(?:\.\d+)?)/g, '[redacted]')
    .replace(
      /\b([A-Za-z0-9_-]*(?:token|secret|session|auth|authorization|key|signature|password|pass|cookie)[A-Za-z0-9_-]*)\s*[:=]\s*[^,\s;&]+/gi,
      '$1=[redacted]'
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)

export const includeScreenshotMetadata = (): boolean => Boolean((globalThis as any).__STACKPRISM_EXPERIENCE_OPTIONS__?.captureScreenshotMetadata)

export const uniquePush = (target: string[], value: unknown, limit = 80): void => {
  const clean = cleanText(value, 180)
  if (clean && !target.includes(clean) && target.length < limit) target.push(clean)
}

export const safeUrl = (value: unknown): string => {
  try {
    const url = new URL(String(value || ''), location.href)
    if (!/^https?:$/i.test(url.protocol)) return ''
    url.hash = ''
    for (const name of [...url.searchParams.keys()]) {
      url.searchParams.set(name, '[redacted]')
    }
    return url.toString()
  } catch {
    return ''
  }
}

export const safeRect = (element: Element) => {
  try {
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  } catch {
    return null
  }
}

export const selectNodes = (): Element[] => {
  if (typeof document === 'undefined') return []
  return [...document.querySelectorAll('body *')].slice(0, LIMITS.nodes)
}
