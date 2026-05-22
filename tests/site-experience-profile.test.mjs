import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { loadTsModule } from './helpers/load-ts-module.mjs'
import identifiers from './fixtures/bridge-protocol-identifiers.json' with { type: 'json' }

test('unit tests run with a 60 second timeout guard', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts['test:unit'], /--test-timeout=60000/)
})

test('normalizes agent bridge opt-in as a local-only setting', async () => {
  const { defaultSettings, normalizeSettings, normalizeSettingsWithLocalOptIn } = await loadTsModule('src/utils/normalize-settings.ts')

  assert.equal(defaultSettings().agentBridgeEnabled, false)
  assert.equal(normalizeSettings({}).agentBridgeEnabled, false)
  assert.equal(normalizeSettings({ agentBridgeEnabled: 'true' }, { allowAgentBridge: true }).agentBridgeEnabled, false)
  assert.equal(normalizeSettings({ agentBridgeEnabled: true }).agentBridgeEnabled, false)
  assert.equal(normalizeSettings({ agentBridgeEnabled: true }, { allowAgentBridge: true }).agentBridgeEnabled, true)
  assert.equal(normalizeSettingsWithLocalOptIn({ agentBridgeEnabled: true }, {}).agentBridgeEnabled, false)
  assert.equal(normalizeSettingsWithLocalOptIn({}, { agentBridgeEnabled: true }).agentBridgeEnabled, true)
  assert.equal(
    normalizeSettingsWithLocalOptIn({ disabledTechnologies: ['React'] }, { agentBridgeEnabled: true }).disabledTechnologies[0],
    'React'
  )
})

test('defines the site experience schema and required capabilities', async () => {
  const contract = await loadTsModule('src/types/agent-bridge.ts')

  assert.equal(contract.bridgeProtocolVersion, 1)
  assert.equal(contract.SITE_EXPERIENCE_PROFILE_SCHEMA, 'stackprism.site_experience_profile.v1')
  assert.deepEqual(contract.REQUIRED_AGENT_BRIDGE_CAPABILITIES, [
    'agentBridge',
    'siteExperienceProfileV1',
    'profileChunkTransport',
    'bridgeContentPost',
    'storageSession',
    'experienceProfiler'
  ])
})

test('validates all protocol identifiers with fixed ascii contracts', async () => {
  const { validateProtocolIdentifier } = await loadTsModule('src/types/agent-bridge.ts')

  for (const [kind, cases] of Object.entries(identifiers)) {
    for (const value of cases.valid) {
      assert.equal(validateProtocolIdentifier(kind, value), true, `${kind} should accept ${value}`)
    }
    for (const value of cases.invalid) {
      assert.equal(validateProtocolIdentifier(kind, value), false, `${kind} should reject ${value}`)
    }
  }
})

test('exports the first-version bridge error code contract', async () => {
  const { AGENT_BRIDGE_ERROR_CODES } = await loadTsModule('src/types/agent-bridge.ts')
  const required = [
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
  ]

  for (const code of required) assert.equal(AGENT_BRIDGE_ERROR_CODES.includes(code), true, `${code} missing`)
  assert.equal(new Set(AGENT_BRIDGE_ERROR_CODES).size, AGENT_BRIDGE_ERROR_CODES.length)
})

test('message runtime field contracts do not carry bridge tokens or profile wrappers', async () => {
  const contract = await loadTsModule('src/types/agent-bridge.ts')

  assert.equal(contract.START_AGENT_CAPTURE_MESSAGE_FIELDS.includes('bridgeToken'), false)
  assert.equal(contract.START_AGENT_CAPTURE_MESSAGE_FIELDS.includes('callbackUrl'), false)
  assert.equal(contract.PROFILE_TRANSFER_BEGIN_FIELDS.includes('profile'), false)
  assert.equal(contract.PROFILE_TRANSFER_CHUNK_FIELDS.includes('profile'), false)
  assert.equal(contract.PROFILE_TRANSFER_COMPLETE_FIELDS.includes('profile'), false)
})
