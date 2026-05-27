import {
  bridgeProtocolVersion,
  SITE_EXPERIENCE_PROFILE_SCHEMA,
  type AgentBridgeCapabilities,
  type AgentCaptureRequest,
  type SiteExperienceProfile
} from '@/types/agent-bridge'
import type { PopupRawResult } from '@/types/popup'
import { buildAgentGuidance } from '@/utils/site-experience-guidance'
import { buildLimitations } from '@/utils/site-experience-limitations'
import { cleanInlineText, redactText, redactUrl } from '@/utils/site-experience-redaction'
import {
  buildAssetProfile,
  buildComponentProfile,
  buildEvidence,
  buildInteractionProfile,
  buildLayoutProfile,
  buildTargetLanguage,
  buildTechProfile,
  buildUxProfile,
  buildVisualProfile,
  sanitizeTechnology
} from '@/utils/site-experience-profile-sections'

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
  const visualProfile = include.has('visual') ? buildVisualProfile(input.experience, input.request.options.captureScreenshotMetadata) : {}
  const layoutProfile = include.has('layout') ? buildLayoutProfile(input.experience, input.request.options.captureScreenshotMetadata) : {}
  const componentProfile = include.has('components')
    ? buildComponentProfile(input.experience, input.request.options.captureScreenshotMetadata)
    : {}
  const interactionProfile = include.has('interaction') ? buildInteractionProfile(input.experience) : {}
  const uxProfile = include.has('ux') ? buildUxProfile(input.experience) : {}
  const evidence = buildEvidence(input.raw, technologies, assetProfile, input.experience)
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
      language: buildTargetLanguage(input.experience),
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
    visualProfile,
    layoutProfile,
    componentProfile,
    interactionProfile,
    uxProfile,
    assetProfile,
    evidence,
    limitations,
    agentGuidance: buildAgentGuidance(techProfile, limitations, {
      visualProfile,
      layoutProfile,
      componentProfile,
      interactionProfile,
      uxProfile,
      assetProfile,
      evidence,
      browserContext
    })
  }
}
