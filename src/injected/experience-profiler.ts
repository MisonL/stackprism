import { LIMITS, cleanText, emptyTruncation, selectNodes } from './experience-profiler-common'
import { collectComponents, collectCssSignals, collectInteraction } from './experience-profiler-components'
import { collectBoundaries, collectAssets, collectUxSignals } from './experience-profiler-ux-assets'
import { collectLayout, collectVisual } from './experience-profiler-visual-layout'

const unavailableProfile = () => ({
  visual: {},
  layout: {},
  components: { samples: [] },
  interaction: { passive: true },
  ux: { textSamples: [] },
  document: { language: '' },
  assets: { urls: [] },
  evidence: { truncation: emptyTruncation() },
  limitations: ['document_unavailable']
})

const enforceResultLimit = (profile: any) => {
  const bytes = new TextEncoder().encode(JSON.stringify(profile)).byteLength
  if (bytes <= LIMITS.executeScriptResultBytes) return profile
  profile.components.samples = profile.components.samples.slice(0, 10)
  profile.ux.textSamples = profile.ux.textSamples.slice(0, 10)
  profile.assets.urls = profile.assets.urls.slice(0, 50)
  profile.evidence.truncation.executeScriptResult = bytes - LIMITS.executeScriptResultBytes
  profile.limitations.push('execute_script_result_truncated')
  return profile
}

const collectSiteExperienceProfile = () => {
  if (typeof document === 'undefined') return unavailableProfile()

  const truncation = emptyTruncation()
  const nodes = selectNodes()
  const cssSignals = collectCssSignals()
  const boundaries = collectBoundaries()
  const components = collectComponents()

  truncation.domNodes = Math.max(0, document.querySelectorAll('body *').length - nodes.length)
  truncation.componentSamples = components.omitted
  truncation.cssRules = cssSignals.omittedCssRules

  const profile = {
    visual: collectVisual(nodes),
    layout: collectLayout(nodes),
    components: { samples: components.samples, counts: components.counts },
    interaction: collectInteraction(nodes, cssSignals),
    ux: collectUxSignals(nodes, truncation),
    document: { language: cleanText(document.documentElement.lang || document.body?.getAttribute('lang') || '', 40) },
    assets: collectAssets(truncation),
    evidence: { inaccessibleStylesheets: cssSignals.inaccessibleStylesheets, ...boundaries, truncation },
    limitations: [
      'passive_interaction_only',
      boundaries.crossOriginIframes ? 'cross_origin_iframes_limited' : '',
      'closed_shadow_roots_unobservable'
    ].filter(Boolean)
  }

  return enforceResultLimit(profile)
}

export default collectSiteExperienceProfile()
