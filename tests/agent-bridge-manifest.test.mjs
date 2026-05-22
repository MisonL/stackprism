import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const manifestSource = await readFile(new URL('../src/manifest.config.ts', import.meta.url), 'utf8')

test('manifest keeps agent bridge content script scoped to loopback bridge pages', () => {
  const observerIndex = manifestSource.indexOf("js: ['src/content/content-observer.ts']")
  const bridgeIndex = manifestSource.indexOf("js: ['src/content/agent-bridge-client.ts']")

  assert.ok(observerIndex >= 0)
  assert.ok(bridgeIndex > observerIndex)
  assert.match(manifestSource, /matches:\s*\['http:\/\/127\.0\.0\.1\/\*'\]/)
  assert.doesNotMatch(manifestSource, /chrome\.windows/)
  assert.doesNotMatch(manifestSource, /externally_connectable/)
  assert.doesNotMatch(manifestSource, /injected\/experience-profiler\.iife\.js/)
})
