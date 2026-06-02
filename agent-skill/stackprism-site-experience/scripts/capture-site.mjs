#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTerminalSettleMs, sleep, stopChild } from './capture-runtime.mjs'

const DEFAULT_INCLUDE = ['tech', 'visual', 'layout', 'components', 'interaction', 'ux', 'assets']
const DEFAULT_VIEWPORT = { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 }
const READY_TIMEOUT_MS = 10000
const CAPTURE_TIMEOUT_MS = 90000
const POLL_INTERVAL_MS = 1000
const DEFAULT_REQUEST_TIMEOUT_MS = 30000

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const bridgeScript = resolve(
  process.env.STACKPRISM_CAPTURE_BRIDGE_SCRIPT || resolve(repoRoot, 'agent-skill/stackprism-site-experience/scripts/stackprism-bridge.mjs')
)

const usage = () => {
  process.stderr.write(
    [
      'Usage: node agent-skill/stackprism-site-experience/scripts/capture-site.mjs --url <url> --out <profile.json> [--screenshot-out <image.jpg>] [--allow-private-network]',
      '',
      'Options:',
      '  --url <url>                 Target http/https URL.',
      '  --out <path>                Write completed profile JSON to this path.',
      '  --result-out <path>         Optional capture result summary JSON path.',
      '  --screenshot-out <path>     Optional decoded screenshot output path when profile includes one.',
      '  --allow-private-network     Allow controlled private-network targets for this attempt.',
      '  --wait-ms <ms>              Target settle wait, default 3000.',
      '  --request-timeout-ms <ms>   Per bridge API request timeout, default 30000.',
      '  --max-resource-urls <n>     Resource URL cap, default 300.',
      '  --no-screenshot             Do not request visible viewport screenshot.'
    ].join('\n') + '\n'
  )
}

const parseArgs = argv => {
  const args = {
    waitMs: 3000,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    maxResourceUrls: 300,
    captureScreenshot: true,
    allowPrivateNetworkTarget: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--url') args.url = argv[++index]
    else if (arg === '--out') args.out = argv[++index]
    else if (arg === '--result-out') args.resultOut = argv[++index]
    else if (arg === '--screenshot-out') args.screenshotOut = argv[++index]
    else if (arg === '--allow-private-network') args.allowPrivateNetworkTarget = true
    else if (arg === '--no-screenshot') args.captureScreenshot = false
    else if (arg === '--wait-ms') args.waitMs = Number(argv[++index])
    else if (arg === '--request-timeout-ms') args.requestTimeoutMs = Number(argv[++index])
    else if (arg === '--max-resource-urls') args.maxResourceUrls = Number(argv[++index])
    else return { ok: false, message: `Unknown argument: ${arg}` }
  }
  if (!args.url || !args.out) return { ok: false, message: '--url and --out are required.' }
  if (!Number.isInteger(args.waitMs) || args.waitMs < 0 || args.waitMs > 30000) {
    return { ok: false, message: '--wait-ms must be an integer from 0 to 30000.' }
  }
  if (!Number.isInteger(args.requestTimeoutMs) || args.requestTimeoutMs < 100 || args.requestTimeoutMs > 60000) {
    return { ok: false, message: '--request-timeout-ms must be an integer from 100 to 60000.' }
  }
  if (!Number.isInteger(args.maxResourceUrls) || args.maxResourceUrls < 0 || args.maxResourceUrls > 1000) {
    return { ok: false, message: '--max-resource-urls must be an integer from 0 to 1000.' }
  }
  return { ok: true, args }
}

const readReady = child =>
  new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => reject(Object.assign(new Error('BRIDGE_START_TIMEOUT'), { stderr })), READY_TIMEOUT_MS)
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
      const newline = stdout.indexOf('\n')
      if (newline < 0) return
      clearTimeout(timer)
      try {
        const ready = JSON.parse(stdout.slice(0, newline))
        resolve({ ready, stderr: () => stderr })
      } catch (error) {
        reject(Object.assign(new Error('BRIDGE_READY_PARSE_FAILED'), { cause: error, stdout, stderr }))
      }
    })
    child.once('exit', code => {
      clearTimeout(timer)
      reject(Object.assign(new Error('BRIDGE_EXITED_BEFORE_READY'), { code, stderr }))
    })
  })

const requestJson = async (url, token, init = {}) => {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, headers: initHeaders, ...requestInit } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...requestInit,
      signal: controller.signal,
      headers: {
        ...(requestInit.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(initHeaders || {})
      }
    })
    let body
    try {
      body = await response.json()
    } catch {
      body = { error: { code: 'INVALID_JSON', message: 'Bridge returned non-JSON response.' } }
    }
    if (!response.ok) {
      const error = new Error(body?.error?.code || `HTTP_${response.status}`)
      error.response = { status: response.status, body }
      throw error
    }
    return body
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error('BRIDGE_REQUEST_TIMEOUT')
      timeout.response = {
        status: 504,
        body: { error: { code: 'BRIDGE_REQUEST_TIMEOUT', message: `Bridge request timed out after ${timeoutMs}ms.` } }
      }
      throw timeout
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

const terminalSettleMs = parseTerminalSettleMs(process.env.STACKPRISM_CAPTURE_TERMINAL_SETTLE_MS)

const captureRequest = args => ({
  url: args.url,
  mode: 'experience',
  waitMs: args.waitMs,
  include: DEFAULT_INCLUDE,
  viewports: [DEFAULT_VIEWPORT],
  options: {
    forceRefresh: true,
    captureScreenshotMetadata: false,
    captureScreenshot: args.captureScreenshot,
    keepTabOpen: false,
    allowPrivateNetworkTarget: args.allowPrivateNetworkTarget,
    targetMode: 'new_tab',
    maxResourceUrls: args.maxResourceUrls
  }
})

const runCapture = async args => {
  const child = spawn(process.execPath, [bridgeScript], {
    cwd: repoRoot,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let readyEnvelope
  try {
    readyEnvelope = await readReady(child)
    const { ready } = readyEnvelope
    if (ready.protocolVersion !== 1 || !ready.baseUrl || !ready.apiToken) {
      throw new Error('BRIDGE_PROTOCOL_UNSUPPORTED')
    }
    const created = await requestJson(`${ready.baseUrl}/v1/captures`, ready.apiToken, {
      method: 'POST',
      body: JSON.stringify(captureRequest(args)),
      timeoutMs: args.requestTimeoutMs
    })
    const deadline = Date.now() + CAPTURE_TIMEOUT_MS
    let status = created
    while (Date.now() < deadline) {
      status = await requestJson(`${ready.baseUrl}/v1/captures/${created.id}`, ready.apiToken, {
        timeoutMs: args.requestTimeoutMs
      })
      if (['completed', 'failed', 'cancelled', 'expired'].includes(status.status)) break
      await sleep(POLL_INTERVAL_MS)
    }
    if (['completed', 'failed', 'cancelled', 'expired'].includes(status.status) && terminalSettleMs > 0) {
      await sleep(terminalSettleMs)
    }
    if (status.status !== 'completed') {
      const error = new Error(status.error?.code || status.status || 'CAPTURE_TIMEOUT')
      error.response = { status: 409, body: status }
      throw error
    }
    const profile = await requestJson(`${ready.baseUrl}/v1/captures/${created.id}/profile`, ready.apiToken, {
      timeoutMs: args.requestTimeoutMs
    })
    return { ok: true, ready, created, status, profile, stderr: readyEnvelope.stderr() }
  } finally {
    await stopChild(child).catch(() => {})
  }
}

const writeJson = async (path, value) => {
  await mkdir(dirname(resolve(path)), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

const writeScreenshot = async (path, dataUrl) => {
  const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/i.exec(String(dataUrl || ''))
  if (!match) return false
  await mkdir(dirname(resolve(path)), { recursive: true })
  await writeFile(path, Buffer.from(match[2], 'base64'))
  return true
}

const main = async () => {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok) {
    usage()
    throw new Error(parsed.message)
  }
  const { args } = parsed
  const result = await runCapture(args)
  const screenshotDataUrl = result.profile.visualProfile?.screenshot?.dataUrl
  const screenshotPresent = Boolean(screenshotDataUrl)
  let screenshotWritten = false
  await writeJson(args.out, result.profile)
  if (args.screenshotOut) {
    screenshotWritten = await writeScreenshot(args.screenshotOut, screenshotDataUrl)
  }
  if (args.resultOut) {
    await writeJson(args.resultOut, {
      ok: true,
      targetUrl: args.url,
      allowPrivateNetworkTarget: args.allowPrivateNetworkTarget,
      captureId: result.created.id,
      finalUrl: result.profile.target?.finalUrl || result.profile.target?.url || '',
      language: result.profile.target?.language || '',
      screenshotPresent,
      screenshotWritten,
      techCount: result.profile.techProfile?.technologies?.length || 0,
      limitations: result.profile.limitations || []
    })
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      captureId: result.created.id,
      finalUrl: result.profile.target?.finalUrl || result.profile.target?.url || '',
      language: result.profile.target?.language || '',
      screenshotPresent,
      screenshotWritten,
      techCount: result.profile.techProfile?.technologies?.length || 0
    })}\n`
  )
}

main().catch(error => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: {
        code: error.response?.body?.error?.code || error.response?.body?.error || error.message || 'CAPTURE_FAILED',
        details: error.response?.body || {}
      }
    })}\n`
  )
  process.exit(1)
})
