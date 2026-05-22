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

test('redacts sensitive headers in header records', async () => {
  const { buildHeaderRecord } = await loadTsModule('src/background/headers.ts')
  const record = buildHeaderRecord(
    {
      requestId: 'req-1',
      url: 'https://example.com/app?token=secret#hash',
      type: 'main_frame',
      method: 'GET',
      statusCode: 200,
      statusLine: 'HTTP/2 200',
      responseHeaders: [
        { name: 'server', value: 'nginx/1.25.0' },
        { name: 'set-cookie', value: 'sid=abc; Path=/, theme=dark; Path=/' },
        { name: 'cookie', value: 'sid=abc' },
        { name: 'authorization', value: 'Bearer secret' },
        { name: 'proxy-authorization', value: 'Basic secret' },
        { name: 'x-api-key', value: 'key-secret' },
        { name: 'x-session-token', value: 'session-secret' }
      ]
    },
    {
      interestingHeaders: ['server', 'set-cookie', 'cookie', 'authorization', 'proxy-authorization', 'x-api-key', 'x-session-token']
    },
    {}
  )

  assert.equal(record.headers['set-cookie'], 'sid, theme')
  assert.equal(record.allHeaders['set-cookie'], 'sid, theme')
  for (const name of ['cookie', 'authorization', 'proxy-authorization', 'x-api-key', 'x-session-token']) {
    assert.equal(record.headers[name], '[redacted]')
    assert.equal(record.allHeaders[name], '[redacted]')
  }
})

test('builds a redacted site experience profile from raw popup data and experience signals', async () => {
  const { buildSiteExperienceProfile } = await loadTsModule('src/utils/site-experience-profile.ts')
  const capabilities = {
    agentBridge: true,
    siteExperienceProfileV1: true,
    profileChunkTransport: true,
    bridgeContentPost: true,
    storageSession: true,
    experienceProfiler: true,
    rawProfile: true,
    viewportMetadata: true
  }

  const profile = buildSiteExperienceProfile({
    captureId: 'cap_CCCCCCCCCCCCCCCCCCCCCC',
    request: {
      url: 'https://example.com/app?token=secret#frag',
      mode: 'experience',
      waitMs: 1000,
      include: ['tech', 'visual', 'layout', 'components', 'interaction', 'ux', 'assets'],
      viewports: [{ name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 }],
      options: {
        forceRefresh: false,
        captureScreenshotMetadata: false,
        keepTabOpen: false,
        allowPrivateNetworkTarget: false,
        targetMode: 'reuse_or_new_tab',
        maxResourceUrls: 2
      },
      protocolVersion: 1
    },
    raw: {
      url: 'https://example.com/app?token=secret#frag',
      title: 'Dashboard',
      generatedAt: '2026-05-22T06:00:00.000Z',
      technologies: [
        {
          category: '前端框架',
          name: 'Vue',
          version: '3.4.0',
          confidence: '高',
          sources: ['页面扫描'],
          evidence: ['window.__VUE__ token=secret'],
          url: 'https://vuejs.org/?session=abc#docs'
        },
        {
          category: '实验',
          name: 'GuessLib',
          confidence: '低',
          sources: ['启发式']
        }
      ],
      resources: {
        total: 4,
        scripts: ['https://cdn.example.com/app.js?signature=abc#bundle'],
        stylesheets: ['https://cdn.example.com/app.css?theme=dark'],
        themeAssetUrls: ['https://cdn.example.com/logo.png?auth=secret'],
        resourceDomains: [{ domain: 'cdn.example.com', count: 3 }],
        cssVariableCount: 12,
        metaGenerator: 'AcmeCMS',
        manifest: 'https://example.com/manifest.json?key=secret'
      },
      headers: [
        { name: 'authorization', value: 'Bearer secret' },
        { name: 'set-cookie', value: 'sid, theme' }
      ]
    },
    experience: {
      visual: { colors: ['#123456'], aboveFold: { heroText: 'Hi user@example.com' } },
      layout: { landmarks: ['header', 'main'], boundingBoxes: [{ text: 'secret@example.com', x: 1, y: 2 }] },
      components: { samples: [{ type: 'button', text: '支付 ￥199 给 张三 13800138000' }] },
      interaction: { passive: true, animations: ['fade'], closedShadowRoots: 1 },
      ux: { textSamples: ['联系 user@example.com 或 13800138000，订单 1234567890123，金额 ￥199，联系人 张三'] },
      assets: { urls: ['https://cdn.example.com/private.woff2?token=abc#font'] },
      evidence: {
        inaccessibleStylesheets: 2,
        crossOriginIframes: 1,
        omitted: { resourceUrls: 3, textSamples: 2, componentSamples: 1, cssRules: 4 }
      }
    },
    capabilities,
    finalUrl: 'https://example.com/app?session=abc#final'
  })

  const serialized = JSON.stringify(profile)
  assert.equal(profile.schema, 'stackprism.site_experience_profile.v1')
  assert.equal(profile.captureId, 'cap_CCCCCCCCCCCCCCCCCCCCCC')
  assert.deepEqual(profile.browserContext.extensionCapabilities, capabilities)
  assert.equal(profile.browserContext.viewportMode, 'current_viewport')
  assert.equal(profile.techProfile.technologies.length, 2)
  assert.equal(profile.assetProfile.resourceUrls.length, 2)
  assert.equal(profile.evidence.truncation.resourceUrls, 3)
  assert.equal(profile.visualProfile.aboveFold, undefined)
  assert.equal(profile.layoutProfile.boundingBoxes, undefined)
  assert.ok(profile.limitations.includes('viewport_emulation_unsupported'))
  assert.ok(profile.limitations.includes('screenshot_metadata_not_requested'))
  assert.ok(profile.limitations.includes('cross_origin_iframes_limited'))
  assert.ok(profile.limitations.includes('closed_shadow_roots_limited'))
  assert.ok(profile.limitations.includes('stylesheet_access_limited'))
  assert.match(profile.agentGuidance.summary, /Vue/)
  assert.deepEqual(profile.visualProfile.colorTokens, ['#123456'])
  assert.doesNotMatch(serialized, /secret|Bearer|user@example\.com|13800138000|1234567890123|￥199|张三/)
  for (const url of [
    profile.target.url,
    profile.target.finalUrl,
    profile.techProfile.technologies[0].url,
    profile.assetProfile.manifest,
    ...profile.assetProfile.scripts,
    ...profile.assetProfile.stylesheets,
    ...profile.assetProfile.themeAssetUrls,
    ...profile.assetProfile.resourceUrls
  ]) {
    assert.equal(new URL(url).hash, '')
  }
  assert.match(serialized, /token=\[redacted\]|signature=\[redacted\]|auth=\[redacted\]|session=\[redacted\]|key=\[redacted\]/)
})

test('returns empty sections and section limitations when include excludes experience data', async () => {
  const { buildSiteExperienceProfile } = await loadTsModule('src/utils/site-experience-profile.ts')
  const profile = buildSiteExperienceProfile({
    captureId: 'cap_CCCCCCCCCCCCCCCCCCCCCC',
    request: {
      url: 'https://example.com/',
      mode: 'experience',
      waitMs: 0,
      include: ['tech'],
      viewports: [],
      options: {
        forceRefresh: false,
        captureScreenshotMetadata: true,
        keepTabOpen: false,
        allowPrivateNetworkTarget: false,
        targetMode: 'new_tab',
        maxResourceUrls: 300
      },
      protocolVersion: 1
    },
    raw: null,
    experience: null,
    capabilities: {
      agentBridge: true,
      siteExperienceProfileV1: true,
      profileChunkTransport: true,
      bridgeContentPost: true,
      storageSession: true,
      experienceProfiler: true,
      rawProfile: false,
      viewportMetadata: false
    },
    finalUrl: 'https://example.com/'
  })

  assert.deepEqual(profile.visualProfile, {})
  assert.deepEqual(profile.layoutProfile, {})
  assert.deepEqual(profile.componentProfile, {})
  assert.deepEqual(profile.interactionProfile, {})
  assert.deepEqual(profile.uxProfile, {})
  assert.deepEqual(profile.assetProfile.resourceUrls, [])
  for (const section of ['visual', 'layout', 'components', 'interaction', 'ux', 'assets']) {
    assert.ok(profile.limitations.includes(`${section}_section_not_requested`))
  }
})
