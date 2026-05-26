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
import { buildAgentGuidance } from '@/utils/site-experience-guidance'
import { buildLimitations } from '@/utils/site-experience-limitations'
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
  assetProfile: { resourceUrls?: string[] },
  experience: any
) => {
  const truncation = experience?.evidence?.truncation || experience?.evidence?.omitted || {}
  const resourceUrls = assetProfile.resourceUrls || []
  return {
    highConfidence: technologies.filter(item => item.confidence === '高').map(item => item.name),
    mediumConfidence: technologies.filter(item => item.confidence === '中').map(item => item.name),
    lowConfidence: technologies.filter(item => item.confidence === '低').map(item => item.name),
    rawCounts: {
      technologies: technologies.length,
      resourceUrls: resourceUrls.length,
      textSamples: cleanStringArray(experience?.ux?.textSamples).length,
      componentSamples: Array.isArray(experience?.components?.samples) ? experience.components.samples.length : 0,
      cssRules: Number(truncation.cssRules || 0)
    },
    sourceCoverage: buildSourceCoverage(raw, experience),
    truncation: {
      resourceUrls: Number(truncation.resourceUrls || 0),
      textSamples: Number(truncation.textSamples || 0),
      componentSamples: Number(truncation.componentSamples || 0),
      cssRules: Number(truncation.cssRules || 0),
      executeScriptResult: Number(truncation.executeScriptResult || 0)
    }
  }
}

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

const stripComponentRects = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripComponentRects)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (/^(rect|boundingBox|bounds)$/i.test(key)) continue
    out[key] = stripComponentRects(item)
  }
  return out
}

const buildComponentProfile = (experience: any, includeMetadata: boolean): Record<string, unknown> => {
  const components = experience?.components || {}
  if (!isRecord(components) || !Object.keys(components).length) return {}
  const sanitized = sanitizeRecord(components)
  return includeMetadata ? sanitized : (stripComponentRects(sanitized) as Record<string, unknown>)
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
  const include = new Set(input.request.include)
  const technologies = include.has('tech') ? (input.raw?.technologies || []).map(sanitizeTechnology) : []
  const assetProfile = include.has('assets') ? buildAssetProfile(input.raw, input.experience, input.request.options.maxResourceUrls) : {}
  const limitations = buildLimitations(input.request, input.experience)
  const techProfile = include.has('tech') ? buildTechProfile(technologies) : {}
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
    visualProfile: include.has('visual') ? buildVisualProfile(input.experience, input.request.options.captureScreenshotMetadata) : {},
    layoutProfile: include.has('layout') ? buildLayoutProfile(input.experience, input.request.options.captureScreenshotMetadata) : {},
    componentProfile: include.has('components')
      ? buildComponentProfile(input.experience, input.request.options.captureScreenshotMetadata)
      : {},
    interactionProfile: include.has('interaction') ? buildInteractionProfile(input.experience) : {},
    uxProfile: include.has('ux') ? buildUxProfile(input.experience) : {},
    assetProfile,
    evidence: buildEvidence(input.raw, technologies, assetProfile, input.experience),
    limitations,
    agentGuidance: buildAgentGuidance(techProfile, limitations)
  }
}
