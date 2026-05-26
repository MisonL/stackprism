const LIMITS = {
  nodes: 2000,
  styleNodes: 80,
  componentSamples: 80,
  textSamples: 80,
  cssRules: 400,
  resourceUrls: 300,
  executeScriptResultBytes: 2 * 1024 * 1024
} as const
type Truncation = {
  domNodes: number
  componentSamples: number
  textSamples: number
  cssRules: number
  resourceUrls: number
  executeScriptResult: number
}
const emptyTruncation = (): Truncation => ({
  domNodes: 0,
  componentSamples: 0,
  textSamples: 0,
  cssRules: 0,
  resourceUrls: 0,
  executeScriptResult: 0
})
const cleanText = (value: unknown, limit = 140): string =>
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

const includeScreenshotMetadata = (): boolean => Boolean((globalThis as any).__STACKPRISM_EXPERIENCE_OPTIONS__?.captureScreenshotMetadata)
const uniquePush = (target: string[], value: unknown, limit = 80): void => {
  const clean = cleanText(value, 180)
  if (clean && !target.includes(clean) && target.length < limit) target.push(clean)
}
const safeUrl = (value: unknown): string => {
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
const safeRect = (element: Element) => {
  try {
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  } catch {
    return null
  }
}
const selectNodes = (): Element[] => {
  if (typeof document === 'undefined') return []
  return [...document.querySelectorAll('body *')].slice(0, LIMITS.nodes)
}
const collectVisual = (nodes: Element[]) => {
  const colors: string[] = []
  const fonts: string[] = []
  const fontSizes: string[] = []
  const lineHeights: string[] = []
  const spacing: string[] = []
  const radii: string[] = []
  const shadows: string[] = []

  for (const node of nodes.slice(0, LIMITS.styleNodes)) {
    try {
      const style = getComputedStyle(node)
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const value = style[prop as any]
        if (value && !/transparent|rgba\(0,\s*0,\s*0,\s*0\)/i.test(value)) uniquePush(colors, value, 60)
      }
      uniquePush(fonts, style.fontFamily, 30)
      uniquePush(fontSizes, style.fontSize, 30)
      uniquePush(lineHeights, style.lineHeight, 30)
      uniquePush(spacing, [style.margin, style.padding].filter(Boolean).join(' | '), 60)
      uniquePush(radii, style.borderRadius, 40)
      if (style.boxShadow && style.boxShadow !== 'none') uniquePush(shadows, style.boxShadow, 40)
    } catch {}
  }

  return { colors, fonts, fontSizes, lineHeights, spacing, radii, shadows }
}

const collectLayout = (nodes: Element[]) => {
  const includeMetadata = includeScreenshotMetadata()
  const landmarks = [
    'header',
    'nav',
    'main',
    'footer',
    'aside',
    '[role="banner"]',
    '[role="navigation"]',
    '[role="main"]',
    '[role="contentinfo"]'
  ]
    .filter(selector => document.querySelector(selector))
    .map(selector => selector.replace(/\[role="(.+)"\]/, 'role:$1'))
  const keySelectors = ['header', 'nav', 'main', 'footer', 'aside', 'section', 'article', '[class*="hero" i]', '[id*="hero" i]']
  const boundingBoxes = includeMetadata
    ? keySelectors
        .flatMap(selector => [...document.querySelectorAll(selector)].slice(0, 8).map(element => ({ selector, element })))
        .map(({ selector, element }) => ({ selector, text: cleanText(element.textContent, 80), rect: safeRect(element) }))
        .filter(item => item.rect)
        .slice(0, 40)
    : []
  const aboveFoldCount = includeMetadata
    ? nodes.filter(node => {
        const rect = safeRect(node)
        return rect && rect.y >= 0 && rect.y < window.innerHeight
      }).length
    : 0
  return {
    landmarks,
    ...(includeMetadata ? { boundingBoxes, aboveFold: { elementCount: aboveFoldCount, viewportHeight: window.innerHeight } } : {})
  }
}

const collectComponents = () => {
  const includeMetadata = includeScreenshotMetadata()
  const definitions = [
    ['button', 'button, [role="button"]'],
    ['input', 'input, textarea, select'],
    ['card', '[class*="card" i], article'],
    ['nav', 'nav, [role="navigation"]'],
    ['tab', '[role="tab"], [class*="tab" i]'],
    ['modal', '[role="dialog"], [class*="modal" i]'],
    ['table', 'table, [role="table"]'],
    ['list', 'ul, ol, [role="list"]'],
    ['badge', '[class*="badge" i], [class*="tag" i], [class*="pill" i]']
  ] as const
  const samples: Array<Record<string, unknown>> = []
  const counts: Record<string, number> = {}
  for (const [type, selector] of definitions) {
    const matches = [...document.querySelectorAll(selector)].slice(0, 20)
    counts[type] = matches.length
    for (const element of matches) {
      if (samples.length >= LIMITS.componentSamples) break
      samples.push({
        type,
        tag: element.tagName.toLowerCase(),
        text: cleanText(element.textContent, 80),
        ...(includeMetadata ? { rect: safeRect(element) } : {})
      })
    }
  }
  return { samples, counts, omitted: Math.max(0, Object.values(counts).reduce((sum, count) => sum + count, 0) - samples.length) }
}

const collectCssSignals = () => {
  let inaccessibleStylesheets = 0
  let scannedRules = 0
  let totalRules = 0
  const hoverOrFocusRules: string[] = []
  for (const sheet of [...document.styleSheets]) {
    try {
      const rules = [...(sheet.cssRules || [])]
      totalRules += rules.length
      for (const rule of rules) {
        if (scannedRules >= LIMITS.cssRules) break
        scannedRules += 1
        const text = 'cssText' in rule ? String(rule.cssText) : ''
        if (/:hover|:focus|:focus-visible/i.test(text)) uniquePush(hoverOrFocusRules, text, 40)
      }
    } catch {
      inaccessibleStylesheets += 1
    }
  }
  return { inaccessibleStylesheets, scannedRules, hoverOrFocusRules, omittedCssRules: Math.max(0, totalRules - scannedRules) }
}

const collectInteraction = (nodes: Element[], cssSignals: ReturnType<typeof collectCssSignals>) => {
  const transitions: string[] = []
  const animations: string[] = []
  const stickyOrFixed: string[] = []
  for (const node of nodes.slice(0, LIMITS.styleNodes)) {
    try {
      const style = getComputedStyle(node)
      if (style.transitionDuration && style.transitionDuration !== '0s')
        uniquePush(transitions, `${style.transitionProperty} ${style.transitionDuration}`, 50)
      if (style.animationName && style.animationName !== 'none')
        uniquePush(animations, `${style.animationName} ${style.animationDuration}`, 50)
      if (style.position === 'sticky' || style.position === 'fixed')
        uniquePush(stickyOrFixed, `${node.tagName.toLowerCase()}:${style.position}`, 40)
    } catch {}
  }
  return {
    passive: true,
    transitions,
    animations,
    stickyOrFixed,
    focusHoverHints: cssSignals.hoverOrFocusRules,
    openShadowRoots: nodes.filter(node => Boolean((node as HTMLElement).shadowRoot)).length,
    closedShadowRoots: 0
  }
}

const collectBoundaries = () => {
  const iframes = [...document.querySelectorAll('iframe')]
  let sameOriginIframes = 0
  let crossOriginIframes = 0
  for (const iframe of iframes) {
    const url = safeUrl(iframe.getAttribute('src') || '')
    if (!url) continue
    if (new URL(url).origin === location.origin) sameOriginIframes += 1
    else crossOriginIframes += 1
  }
  return { sameOriginIframes, crossOriginIframes }
}

const collectTextSamples = (nodes: Element[], truncation: Truncation): string[] => {
  const samples: string[] = []
  for (const node of nodes) {
    const text = cleanText(node.textContent, 120)
    if (!text || text.length < 3) continue
    if (samples.length >= LIMITS.textSamples) {
      truncation.textSamples += 1
      continue
    }
    uniquePush(samples, text, LIMITS.textSamples)
  }
  return samples
}

const collectElementLabels = (selector: string, limit: number): string[] => {
  const labels: string[] = []
  for (const element of [...document.querySelectorAll(selector)]) {
    uniquePush(labels, element.getAttribute('aria-label') || element.textContent, limit)
    if (labels.length >= limit) break
  }
  return labels
}

const inferPagePurpose = (): string => {
  if (document.querySelector('main form, form[action], input, textarea, select')) return 'form_flow'
  if (document.querySelector('table, [role="table"], [class*="dashboard" i], [class*="chart" i]')) return 'data_display'
  if (document.querySelector('article, [class*="docs" i], [class*="blog" i]')) return 'content_or_docs'
  if (document.querySelector('[class*="pricing" i], [class*="hero" i], [id*="hero" i]')) return 'marketing'
  return 'unknown'
}

const inferFrictionPoints = (): string[] => {
  const points: string[] = []
  if (!document.querySelector('h1')) uniquePush(points, 'missing_h1', 8)
  if (document.querySelectorAll('form input[required], form textarea[required], form select[required]').length > 5)
    uniquePush(points, 'many_required_fields', 8)
  if (document.querySelectorAll('button, a, [role="button"]').length === 0) uniquePush(points, 'no_visible_actions', 8)
  return points
}

const collectUxSignals = (nodes: Element[], truncation: Truncation) => {
  const navLinks = document.querySelectorAll('nav a, [role="navigation"] a').length
  const formControls = document.querySelectorAll('input, textarea, select').length
  return {
    pagePurpose: inferPagePurpose(),
    primaryUserPath: collectElementLabels('main button, main a, [role="main"] button, [role="main"] a', 12),
    informationHierarchy: collectElementLabels('h1, h2, h3, [role="heading"]', 20),
    ctaStrategy: collectElementLabels('button, a, [role="button"], input[type="submit"]', 20),
    trustSignals: collectElementLabels(
      '[class*="trust" i], [class*="testimonial" i], [class*="review" i], [class*="security" i], [class*="privacy" i], footer',
      20
    ),
    navigationDepth: `nav_links:${navLinks}; form_controls:${formControls}`,
    contentGrouping: collectElementLabels('section, article, aside, [class*="card" i], [class*="panel" i]', 24),
    frictionPoints: inferFrictionPoints(),
    textSamples: collectTextSamples(nodes, truncation)
  }
}

const collectAssets = (truncation: Truncation) => {
  const urls = [
    ...[...document.scripts].map(item => item.src),
    ...[...document.querySelectorAll('link[href]')].map(item => (item as HTMLLinkElement).href),
    ...[...document.images].map(item => item.currentSrc || item.src),
    ...performance.getEntriesByType('resource').map(item => item.name)
  ]
    .map(safeUrl)
    .filter(Boolean)
  const unique = [...new Set(urls)]
  truncation.resourceUrls = Math.max(0, unique.length - LIMITS.resourceUrls)
  return { urls: unique.slice(0, LIMITS.resourceUrls) }
}

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
  const truncation = emptyTruncation()
  if (typeof document === 'undefined') {
    return {
      visual: {},
      layout: {},
      components: { samples: [] },
      interaction: { passive: true },
      ux: { textSamples: [] },
      document: { language: '' },
      assets: { urls: [] },
      evidence: { truncation },
      limitations: ['document_unavailable']
    }
  }
  const nodes = selectNodes()
  truncation.domNodes = Math.max(0, document.querySelectorAll('body *').length - nodes.length)
  const cssSignals = collectCssSignals()
  const boundaries = collectBoundaries()
  const components = collectComponents()
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
