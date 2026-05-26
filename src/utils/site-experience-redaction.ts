import { cleanStringArray } from '@/utils/normalize-settings'
import { normalizeHttpUrl } from '@/utils/url'

const REDACTED = '[redacted]'
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const LONG_NUMBER_RE = /\b\d{11,}\b/g
const MONEY_RE = /(?:[￥$€£]\s*\d+(?:\.\d+)?)/g
const PHONE_RE = /\b(?:\+?\d[\d\s-]{8,}\d)\b/g
const PERSONAL_NAME_RE = /(联系人|收件人|收货人|姓名|用户|客户|负责人|给|致)\s*([\u4e00-\u9fa5]{2,4})/g
const SENSITIVE_QUERY_RE = /(?:token|secret|session|auth|key|signature|password|pass|cookie)/i
const SENSITIVE_TEXT_PAIR_RE =
  /\b([A-Za-z0-9_-]*(?:token|secret|session|auth|authorization|key|signature|password|pass|cookie)[A-Za-z0-9_-]*)\s*[:=]\s*[^,\s;&]+/gi
const EMBEDDED_HTTP_URL_RE = /\bhttps?:\/\/[^\s"'<>()[\]{}]+/gi

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const cleanInlineText = (value: unknown): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()

const redactNormalizedUrl = (value: unknown): string => {
  const normalized = normalizeHttpUrl(value)
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    url.hash = ''
    if (url.search) {
      const query = [...url.searchParams.entries()].map(([name]) => `${name}=${REDACTED}`).join('&')
      url.search = query ? `?${query}` : ''
    }
    return url.toString()
  } catch {
    return normalized.replace(/#.*$/, '')
  }
}

export const redactText = (value: unknown): string => {
  const text = cleanInlineText(value)
  if (!text) return ''
  return text
    .replace(EMBEDDED_HTTP_URL_RE, url => redactNormalizedUrl(url) || REDACTED)
    .replace(EMAIL_RE, REDACTED)
    .replace(PHONE_RE, REDACTED)
    .replace(LONG_NUMBER_RE, REDACTED)
    .replace(MONEY_RE, REDACTED)
    .replace(SENSITIVE_TEXT_PAIR_RE, (_match, key) => `${key}=${REDACTED}`)
    .replace(PERSONAL_NAME_RE, (_match, prefix) => `${prefix} ${REDACTED}`)
}

export const redactUrl = (value: unknown): string => {
  return redactNormalizedUrl(value) || redactText(value)
}

export const redactHeaderValue = (name: string, value: string): string => {
  const lowerName = String(name || '').toLowerCase()
  if (!lowerName) return REDACTED
  if (lowerName === 'set-cookie') {
    const cookieNames = String(value)
      .split(/,\s*(?=[^;,=\s]+=)/)
      .map(cookie => cookie.split('=')[0]?.trim())
      .filter(Boolean)
    return cookieNames.length ? cookieNames.join(', ') : REDACTED
  }
  if (
    lowerName === 'cookie' ||
    lowerName === 'authorization' ||
    lowerName === 'proxy-authorization' ||
    lowerName === 'x-api-key' ||
    SENSITIVE_QUERY_RE.test(lowerName)
  ) {
    return REDACTED
  }
  return redactText(value)
}

export const sanitizeValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return /^https?:\/\//i.test(value) || /^\/\//.test(value) || /^www\./i.test(value) ? redactUrl(value) : redactText(value)
  }
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item))
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const baseKey = redactText(key).slice(0, 120) || 'field'
      let safeKey = baseKey
      let suffix = 2
      while (Object.prototype.hasOwnProperty.call(out, safeKey)) {
        safeKey = `${baseKey}_${suffix}`
        suffix += 1
      }
      out[safeKey] = sanitizeValue(item)
    }
    return out
  }
  return value
}

export const sanitizeRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? (sanitizeValue(value) as Record<string, unknown>) : {}

export const sanitizeList = (values: unknown, limit = Infinity): string[] => {
  const list = cleanStringArray(values).map(item => cleanInlineText(sanitizeValue(item)))
  return [...new Set(list.filter(Boolean))].slice(0, limit)
}

export const sanitizeUrlList = (values: unknown, limit = Infinity): string[] => {
  if (!Array.isArray(values)) return []
  const list = values.map(item => redactUrl(item)).filter(Boolean)
  return [...new Set(list)].slice(0, limit)
}
