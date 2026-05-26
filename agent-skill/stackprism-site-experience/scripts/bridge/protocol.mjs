import { randomBytes, timingSafeEqual } from 'node:crypto'

export const service = 'stackprism-agent-bridge'
export const version = '0.1.0'
export const protocolVersion = 1
export const profileSchema = 'stackprism.site_experience_profile.v1'

const bridgeErrorCodes = new Set([
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'ORIGIN_NOT_ALLOWED',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNSUPPORTED_TRANSFER_ENCODING',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'REQUEST_TOO_LARGE',
  'REQUEST_TIMEOUT',
  'SERVER_BUSY',
  'STALE_STATUS_UPDATE',
  'PORT_IN_USE',
  'BRIDGE_INVALID_ENV',
  'BRIDGE_START_TIMEOUT',
  'BRIDGE_READY_PARSE_FAILED',
  'BRIDGE_PROTOCOL_UNSUPPORTED',
  'BRIDGE_REQUEST_MISMATCH',
  'AGENT_BRIDGE_DISABLED',
  'CAPTURE_BUSY',
  'CAPTURE_TIMEOUT',
  'EXTENSION_NOT_CONNECTED',
  'BROWSER_OPEN_FAILED',
  'BRIDGE_TOKEN_CANNOT_READ_PROFILE',
  'PRIVATE_NETWORK_TARGET_BLOCKED',
  'TARGET_DNS_LOOKUP_FAILED',
  'BRIDGE_SELF_TARGET_BLOCKED',
  'FINAL_URL_BLOCKED',
  'ACTIVE_TAB_UNAVAILABLE',
  'ACTIVE_TAB_MISMATCH',
  'INCOGNITO_NOT_SUPPORTED',
  'TARGET_LOAD_TIMEOUT',
  'TARGET_LOAD_FAILED',
  'TARGET_INJECTION_FAILED',
  'TARGET_TAB_CLOSED',
  'BRIDGE_TAB_CLOSED',
  'TARGET_NAVIGATED_AWAY',
  'SERVICE_WORKER_RESTARTED',
  'BRIDGE_TRANSPORT_DISCONNECTED',
  'PROFILE_TRANSPORT_FAILED',
  'PROFILE_CHUNK_MISSING',
  'PROFILE_HASH_MISMATCH',
  'PROFILE_TOO_LARGE',
  'RATE_LIMITED',
  'NONCE_REUSED',
  'CAPTURE_ALREADY_COMPLETED',
  'CAPTURE_RESULT_EXPIRED',
  'NOT_SUPPORTED'
])

const SENSITIVE_DETAIL_KEY = /authorization|cookie|token|nonce|secret/i
const ID_PATTERN = /\b(?:spbt?_|cap_|s_|n_|xfer_)[A-Za-z0-9_-]{8,}\b/g
const URL_PATTERN = /https?:\/\/[^\s"')\]}]+/g
const MAX_ERROR_TEXT_LENGTH = 512
const MAX_ERROR_DETAIL_DEPTH = 4
const MAX_ERROR_DETAIL_KEYS = 50
const MAX_ERROR_DETAIL_ARRAY_ITEMS = 20

export const identifierSpecs = {
  apiToken: /^spb_[A-Za-z0-9_-]{43}$/,
  bridgeToken: /^spbt_[A-Za-z0-9_-]{43}$/,
  captureId: /^cap_[A-Za-z0-9_-]{22}$/,
  sessionId: /^s_[A-Za-z0-9_-]{22}$/,
  nonce: /^n_[A-Za-z0-9_-]{22}$/,
  profileTransferId: /^xfer_[A-Za-z0-9_-]{22}$/,
  cspNonce: /^[A-Za-z0-9_-]{22}$/
}

export const makeId = prefix =>
  `${prefix}${randomBytes(prefix === '' ? 16 : prefix === 'spb_' || prefix === 'spbt_' ? 32 : 16).toString('base64url')}`

export const newApiToken = () => makeId('spb_')
export const newBridgeToken = () => makeId('spbt_')
export const newCaptureId = () => makeId('cap_')
export const newSessionId = () => makeId('s_')
export const newNonce = () => makeId('n_')
export const newCspNonce = () => makeId('')

export const isValidId = (kind, value) => typeof value === 'string' && Boolean(identifierSpecs[kind]?.test(value))

export const isKnownBridgeErrorCode = value => typeof value === 'string' && bridgeErrorCodes.has(value)

export const safeEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  const comparisonLength = Math.max(a.length, b.length)
  const paddedA = Buffer.alloc(comparisonLength)
  const paddedB = Buffer.alloc(comparisonLength)
  a.copy(paddedA)
  b.copy(paddedB)
  return timingSafeEqual(paddedA, paddedB) && a.length === b.length
}

export const errorBody = (code, message, details = {}) => ({ error: { code, message, details } })

export const json = (res, status, body, extraHeaders = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  })
  res.end(JSON.stringify(body))
}

export const fail = (res, status, code, message, details = {}, extraHeaders = {}) =>
  json(res, status, errorBody(code, message, details), extraHeaders)

export const htmlEscapeScriptJson = value =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

export const redactUrl = value => {
  try {
    const url = new URL(String(value || ''))
    url.hash = ''
    if (url.search) url.search = '?[redacted]'
    return url.toString()
  } catch {
    return ''
  }
}

const redactErrorText = value =>
  String(value || '')
    .replace(URL_PATTERN, url => redactUrl(url) || '[redacted-url]')
    .replace(ID_PATTERN, '[redacted-id]')
    .slice(0, MAX_ERROR_TEXT_LENGTH)

const sanitizeErrorValue = (key, value, depth) => {
  if (SENSITIVE_DETAIL_KEY.test(key)) return '[redacted]'
  if (typeof value === 'string') return redactErrorText(value)
  if (!value || typeof value !== 'object') return value
  if (depth >= MAX_ERROR_DETAIL_DEPTH) return '[redacted-object]'
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ERROR_DETAIL_ARRAY_ITEMS).map(item => sanitizeErrorValue('', item, depth + 1))
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_ERROR_DETAIL_KEYS)
      .map(([childKey, child]) => [redactErrorText(childKey).slice(0, 64) || 'field', sanitizeErrorValue(childKey, child, depth + 1)])
  )
}

export const sanitizeBridgeError = error => {
  const source = error && typeof error === 'object' ? error : {}
  const rawCode = typeof source.code === 'string' ? source.code : ''
  const code = isKnownBridgeErrorCode(rawCode) ? rawCode : 'INVALID_REQUEST'
  const message = redactErrorText(source.message || code || 'Capture status failed.') || 'Capture status failed.'
  const details = sanitizeErrorValue('details', source.details || {}, 0)
  return { code, message, details }
}
