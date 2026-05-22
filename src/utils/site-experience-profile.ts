import {
  bridgeProtocolVersion,
  SITE_EXPERIENCE_PROFILE_SCHEMA,
  type AgentBridgeCapabilities,
  type AgentCaptureRequest,
  type SiteExperienceProfile
} from '@/types/agent-bridge'
import type { PopupRawResult } from '@/types/popup'
import type { TechnologyRecord } from '@/types/rules'
import { cleanStringArray } from '@/utils/normalize-settings'
import {
  cleanInlineText,
  isRecord,
  redactText,
  redactUrl,
  sanitizeList,
  sanitizeRecord,
  sanitizeUrlList,
  sanitizeValue
} from '@/utils/site-experience-redaction'

const sanitizeTechnology = (technology: TechnologyRecord): TechnologyRecord => ({
  category: cleanInlineText(technology.category) || '其他库',
  name: cleanInlineText(technology.name),
  kind: cleanInlineText(technology.kind) || undefined,
  confidence:
    technology.confidence === '高' || technology.confidence === '中' || technology.confidence === '低' ? technology.confidence : '中',
  evidence: sanitizeList(technology.evidence).slice(0, 8),
  sources: sanitizeList(technology.sources || (technology.source ? [technology.source] : [])).slice(0, 8),
  url: redactUrl(technology.url) || undefined,
  version: cleanInlineText(technology.version) || undefined
})

const buildConfidenceSummary = (technologies: TechnologyRecord[]) => ({
  high: technologies.filter(item => item.confidence === '高').length,
  medium: technologies.filter(item => item.confidence === '中').length,
  low: technologies.filter(item => item.confidence === '低').length
})

const pickPrimaryFrontend = (technologies: TechnologyRecord[]) =>
  technologies.find(
    tech => /前端框架|ui \/ css 框架|前端库/i.test(tech.category) || /^(react|vue|svelte|angular|next\.js|nuxt|solid)/i.test(tech.name)
  )

const pickNamedTechnology = (technologies: TechnologyRecord[], pattern: RegExp) =>
  technologies.find(tech => pattern.test(`${tech.category} ${tech.name}`))

const buildTechProfile = (technologies: TechnologyRecord[]) => {
  const primaryFrontend = pickPrimaryFrontend(technologies)
  const uiFramework = pickNamedTechnology(technologies, /UI \/ CSS 框架|Tailwind|Bootstrap|Ant Design|Element Plus/i)
  const buildRuntime = pickNamedTechnology(technologies, /构建与运行时|Vite|Webpack|Rollup|esbuild|Node/i)
  const cmsOrSiteProgram = pickNamedTechnology(technologies, /网站程序|CMS|电商平台|WordPress|Shopify|Drupal/i)
  const thirdPartyServices = technologies.filter(tech => /第三方服务|CDN \/ 托管|统计|广告|支付/i.test(tech.category))
  return {
    technologies,
    primaryFrontend: primaryFrontend?.name || '',
    uiFramework: uiFramework?.name || '',
    buildRuntime: buildRuntime?.name || '',
    cmsOrSiteProgram: cmsOrSiteProgram?.name || '',
    serverHints: [],
    thirdPartyServices: thirdPartyServices.map(tech => tech.name),
    confidenceSummary: buildConfidenceSummary(technologies),
    implementationNotes: '技术栈用于复刻参考，不是必须照搬。'
  }
}

const buildAssetProfile = (raw: PopupRawResult | null, experience: any, maxResourceUrls: number) => {
  const resources = raw?.resources
  const scripts = sanitizeUrlList(resources?.scripts)
  const stylesheets = sanitizeUrlList(resources?.stylesheets)
  const themeAssetUrls = sanitizeUrlList(resources?.themeAssetUrls)
  const manifest = redactUrl(resources?.manifest)
  const experienceAssetUrls = sanitizeUrlList(experience?.assets?.urls)
  const resourceUrls = [
    ...new Set([...scripts, ...stylesheets, ...themeAssetUrls, ...experienceAssetUrls, ...(manifest ? [manifest] : [])])
  ].slice(0, maxResourceUrls)
  return {
    scripts,
    stylesheets,
    resourceDomains: sanitizeValue(resources?.resourceDomains) || [],
    imageDomains: [],
    fontUrls: [],
    manifest,
    themeAssetUrls,
    favicon: '',
    cdnHints: [
      ...new Set(
        resourceUrls
          .map(url => {
            try {
              return new URL(url).hostname
            } catch {
              return ''
            }
          })
          .filter(Boolean)
      )
    ],
    resourceUrls,
    redactionPolicy: {
      hashDropped: true,
      sensitiveQueryValuesRedacted: true
    }
  }
}

const buildSourceCoverage = (raw: PopupRawResult | null, experience: any) =>
  [
    raw?.headers?.length ? 'headers' : '',
    raw?.technologies?.length ? 'page' : '',
    raw?.resources ? 'bundle' : '',
    experience ? 'visual' : '',
    experience?.interaction ? 'interaction' : ''
  ].filter(Boolean)

const buildEvidence = (
  raw: PopupRawResult | null,
  technologies: TechnologyRecord[],
  assetProfile: { resourceUrls: string[] },
  experience: any
) => ({
  highConfidence: technologies.filter(item => item.confidence === '高').map(item => item.name),
  mediumConfidence: technologies.filter(item => item.confidence === '中').map(item => item.name),
  lowConfidence: technologies.filter(item => item.confidence === '低').map(item => item.name),
  rawCounts: {
    technologies: technologies.length,
    resourceUrls: assetProfile.resourceUrls.length,
    textSamples: cleanStringArray(experience?.ux?.textSamples).length,
    componentSamples: Array.isArray(experience?.components?.samples) ? experience.components.samples.length : 0,
    cssRules: Number(experience?.evidence?.omitted?.cssRules || 0)
  },
  sourceCoverage: buildSourceCoverage(raw, experience),
  truncation: {
    resourceUrls: Number(experience?.evidence?.omitted?.resourceUrls || 0),
    textSamples: Number(experience?.evidence?.omitted?.textSamples || 0),
    componentSamples: Number(experience?.evidence?.omitted?.componentSamples || 0),
    cssRules: Number(experience?.evidence?.omitted?.cssRules || 0)
  }
})

const stripScreenshotMetadata = (value: Record<string, unknown>, includeMetadata: boolean): Record<string, unknown> => {
  if (includeMetadata) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (/abovefold|bounding/i.test(key)) continue
    out[key] = item
  }
  return out
}

const buildVisualProfile = (experience: any, includeMetadata: boolean): Record<string, unknown> => {
  const visual = experience?.visual || {}
  if (!isRecord(visual) || !Object.keys(visual).length) return {}
  const { colors, ...rest } = visual
  return {
    colorTokens: sanitizeList(colors),
    ...stripScreenshotMetadata(sanitizeRecord(rest), includeMetadata)
  }
}

const buildLayoutProfile = (experience: any, includeMetadata: boolean): Record<string, unknown> => {
  const layout = experience?.layout || {}
  if (!isRecord(layout) || !Object.keys(layout).length) return {}
  return stripScreenshotMetadata(sanitizeRecord(layout), includeMetadata)
}

const buildComponentProfile = (experience: any): Record<string, unknown> => {
  const components = experience?.components || {}
  if (!isRecord(components) || !Object.keys(components).length) return {}
  return sanitizeRecord(components)
}

const buildInteractionProfile = (experience: any): Record<string, unknown> => {
  const interaction = experience?.interaction || {}
  if (!isRecord(interaction) || !Object.keys(interaction).length) return {}
  return sanitizeRecord(interaction)
}

const buildUxProfile = (experience: any): Record<string, unknown> => {
  const ux = experience?.ux || {}
  if (!isRecord(ux) || !Object.keys(ux).length) return {}
  return sanitizeRecord({
    ...ux,
    textSamples: cleanStringArray(ux.textSamples).map(redactText)
  })
}

const buildLimitations = (request: AgentCaptureRequest, experience: any) => {
  const limitations = new Set<string>()
  if (request.viewports.length) limitations.add('viewport_emulation_unsupported')
  if (request.options.captureScreenshotMetadata === false) limitations.add('screenshot_metadata_not_requested')
  if (request.include && !request.include.includes('visual')) limitations.add('visual_section_not_requested')
  if (request.include && !request.include.includes('layout')) limitations.add('layout_section_not_requested')
  if (request.include && !request.include.includes('components')) limitations.add('components_section_not_requested')
  if (request.include && !request.include.includes('interaction')) limitations.add('interaction_section_not_requested')
  if (request.include && !request.include.includes('ux')) limitations.add('ux_section_not_requested')
  if (request.include && !request.include.includes('assets')) limitations.add('assets_section_not_requested')
  if (Number(experience?.evidence?.crossOriginIframes || 0) > 0) limitations.add('cross_origin_iframes_limited')
  if (Number(experience?.interaction?.closedShadowRoots || 0) > 0) limitations.add('closed_shadow_roots_limited')
  if (Number(experience?.evidence?.inaccessibleStylesheets || 0) > 0) limitations.add('stylesheet_access_limited')
  if (experience?.interaction?.passive) limitations.add('passive_interaction_only')
  return [...limitations]
}

const buildAgentGuidance = (techProfile: ReturnType<typeof buildTechProfile>, limitations: string[]) => {
  const summaryParts = []
  if (techProfile.primaryFrontend) summaryParts.push(`优先复刻 ${techProfile.primaryFrontend} 的前端体验。`)
  summaryParts.push('优先复刻视觉层级、交互反馈、布局密度和信息结构。')
  if (limitations.length) summaryParts.push(`注意 limitations: ${limitations.slice(0, 3).join('、')}`)
  return {
    summary: summaryParts.join(' '),
    priorities: ['布局密度', '视觉层级', '交互反馈', '信息结构'],
    cautions: ['高置信证据优先', '低置信候选仅作参考', '隐私字段已脱敏']
  }
}

export interface BuildSiteExperienceProfileInput {
  captureId: string
  request: AgentCaptureRequest
  raw: PopupRawResult | null
  experience: any
  capabilities: AgentBridgeCapabilities
  finalUrl?: string
  userAgent?: string
  extensionVersion?: string
  capturedAt?: string
  loginState?: 'unknown' | 'likely_authenticated' | 'likely_public'
  pageSupported?: boolean
}

export const buildSiteExperienceProfile = (input: BuildSiteExperienceProfileInput): SiteExperienceProfile => {
  const technologies = (input.raw?.technologies || []).map(sanitizeTechnology)
  const assetProfile = buildAssetProfile(input.raw, input.experience, input.request.options.maxResourceUrls)
  const limitations = buildLimitations(input.request, input.experience)
  const techProfile = buildTechProfile(technologies)
  const browserContext = {
    userAgent: cleanInlineText(input.userAgent || ''),
    extensionVersion: cleanInlineText(input.extensionVersion || ''),
    capturedAt: cleanInlineText(input.capturedAt || input.raw?.generatedAt || new Date().toISOString()),
    waitMs: input.request.waitMs,
    viewports: input.request.viewports.map(viewport => ({
      name: cleanInlineText(viewport.name || ''),
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor
    })),
    pageSupported: input.pageSupported ?? Boolean(input.raw || input.experience),
    loginState: input.loginState || 'unknown',
    viewportMode: 'current_viewport',
    bridgeProtocolVersion,
    extensionCapabilities: input.capabilities
  }
  const targetUrl = redactUrl(input.raw?.url || input.request.url)
  const finalUrl = redactUrl(input.finalUrl || input.raw?.url || input.request.url)

  return {
    schema: SITE_EXPERIENCE_PROFILE_SCHEMA,
    captureId: input.captureId,
    generatedAt: cleanInlineText(input.capturedAt || input.raw?.generatedAt || new Date().toISOString()),
    target: {
      url: targetUrl,
      finalUrl,
      origin: (() => {
        try {
          return new URL(finalUrl || targetUrl).origin
        } catch {
          return ''
        }
      })(),
      title: redactText(input.raw?.title || ''),
      language: '',
      viewportProfiles: input.request.viewports.map(viewport => ({
        name: cleanInlineText(viewport.name || ''),
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor
      })),
      captureScope: 'target_url'
    },
    browserContext,
    techProfile,
    visualProfile: buildVisualProfile(input.experience, input.request.options.captureScreenshotMetadata),
    layoutProfile: buildLayoutProfile(input.experience, input.request.options.captureScreenshotMetadata),
    componentProfile: buildComponentProfile(input.experience),
    interactionProfile: buildInteractionProfile(input.experience),
    uxProfile: buildUxProfile(input.experience),
    assetProfile,
    evidence: buildEvidence(input.raw, technologies, assetProfile, input.experience),
    limitations,
    agentGuidance: buildAgentGuidance(techProfile, limitations)
  }
}
