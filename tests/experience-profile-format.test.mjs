import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { loadTsModule } from './helpers/load-ts-module.mjs'

test('built experience profiler exposes executeScript result reference', async () => {
  const built = await readFile(new URL('../public/injected/experience-profiler.iife.js', import.meta.url), 'utf8')
  assert.match(built, /__StackPrismInjected_experience_profiler__;\s*$/)
})

test('experience profiler default export is structured-clone safe', async () => {
  const { default: result } = await loadTsModule('src/injected/experience-profiler.ts')
  const clone = structuredClone(result)

  assert.equal(typeof clone, 'object')
  assert.ok(clone.visual)
  assert.ok(clone.layout)
  assert.ok(clone.components)
  assert.ok(clone.interaction)
  assert.ok(clone.ux)
  assert.ok(clone.assets)
  assert.ok(clone.evidence.truncation)
  assert.ok(JSON.stringify(clone).length < 2 * 1024 * 1024)
})

test('experience profiler preserves matched selector metadata for bounding boxes', async () => {
  const source = await readFile(new URL('../src/injected/experience-profiler-visual-layout.ts', import.meta.url), 'utf8')

  assert.match(source, /map\(element => \(\{ selector, element \}\)\)/)
  assert.doesNotMatch(source, /selector:\s*element\.tagName/)
})

test('experience profiler collects language and first-order UX categories', async () => {
  const [entrySource, uxSource] = await Promise.all([
    readFile(new URL('../src/injected/experience-profiler.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/injected/experience-profiler-ux-assets.ts', import.meta.url), 'utf8')
  ])

  assert.match(entrySource, /documentElement\.lang/)
  assert.match(uxSource, /pagePurpose/)
  assert.match(uxSource, /primaryUserPath/)
  assert.match(uxSource, /informationHierarchy/)
  assert.match(uxSource, /ctaStrategy/)
  assert.match(uxSource, /trustSignals/)
  assert.match(uxSource, /navigationDepth/)
  assert.match(uxSource, /contentGrouping/)
  assert.match(uxSource, /frictionPoints/)
})

test('experience profiler redacts sensitive URL paths and preserves full component counts', async () => {
  const [commonSource, componentsSource, entrySource] = await Promise.all([
    readFile(new URL('../src/injected/experience-profiler-common.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/injected/experience-profiler-components.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/injected/experience-profiler.ts', import.meta.url), 'utf8')
  ])

  assert.match(commonSource, /isSensitivePathSegment/)
  assert.match(commonSource, /url\.pathname = redactPathname\(url\.pathname\)/)
  assert.match(componentsSource, /counts\[type\] = matches\.length/)
  assert.match(componentsSource, /matches\.slice\(0, 20\)/)
  assert.match(entrySource, /for \(const shrink of shrinkSteps\)/)
  assert.match(entrySource, /byteLengthOf\(profile\)/)
  assert.match(entrySource, /initialBytes - bytes/)
})

test('experience profiler safeUrl preserves ordinary key substrings and redacts sensitive path tokens', async () => {
  const { safeUrl } = await loadTsModule('src/injected/experience-profiler-common.ts')
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'https://example.com/base/' }
  })

  try {
    assert.equal(
      safeUrl('https://example.com/products/keyboard/turkey/monkey?token=secret#frag'),
      'https://example.com/products/keyboard/turkey/monkey?token=%5Bredacted%5D'
    )
    assert.equal(
      safeUrl('https://example.com/account/apiKey/privateKey/passcode/sessionId?next=/home'),
      'https://example.com/account/[redacted]/[redacted]/[redacted]/[redacted]?next=%5Bredacted%5D'
    )
    assert.equal(
      safeUrl('https://vercel.com/dashboard/projects/very-long-project-name-with-token-like-segment-and-many-words'),
      'https://vercel.com/dashboard/projects/very-long-project-name-with-token-like-segment-and-many-words'
    )
    assert.equal(
      safeUrl('https://example.com/download/Abcd1234EFGH5678ijkl9012?next=/home'),
      'https://example.com/download/[redacted]?next=%5Bredacted%5D'
    )
  } finally {
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation)
    else delete globalThis.location
  }
})

test('site experience fixture covers visual, layout, component and sensitive text cases', async () => {
  const fixture = await readFile(new URL('./fixtures/site-experience-fixture.html', import.meta.url), 'utf8')

  assert.match(fixture, /transition:/)
  assert.match(fixture, /<header/)
  assert.match(fixture, /<button/)
  assert.match(fixture, /user@example\.com/)
  assert.match(fixture, /token=secret/)
})
