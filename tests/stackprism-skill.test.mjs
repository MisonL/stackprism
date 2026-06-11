import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const skillSource = await readFile(new URL('../agent-skill/stackprism-site-experience/SKILL.md', import.meta.url), 'utf8')
const agentsSource = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8')
const readmeSource = await readFile(new URL('../agent-skill/stackprism-site-experience/README.md', import.meta.url), 'utf8')
const openaiYamlSource = await readFile(new URL('../agent-skill/stackprism-site-experience/agents/openai.yaml', import.meta.url), 'utf8')
const consumptionGuideSource = await readFile(
  new URL('../agent-skill/stackprism-site-experience/references/agent-consumption-guide.md', import.meta.url),
  'utf8'
)
const profileSchemaSource = await readFile(
  new URL('../agent-skill/stackprism-site-experience/references/site-experience-profile-schema.md', import.meta.url),
  'utf8'
)

const frontmatter = source => {
  const match = source.match(/^---\n(?<body>[\s\S]*?)\n---/)
  assert.ok(match?.groups?.body, 'skill must have YAML frontmatter')
  return Object.fromEntries(
    match.groups.body.split('\n').map(line => {
      const separatorIndex = line.indexOf(':')
      assert.ok(separatorIndex > 0, `invalid frontmatter line: ${line}`)
      return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()]
    })
  )
}

const yamlValue = (source, key) => {
  const match = source.match(new RegExp(`^\\s*${key}:\\s*'(?<value>[^']+)'`, 'm'))
  assert.ok(match?.groups?.value, `missing ${key} in openai.yaml`)
  return match.groups.value
}

const fencedBlocks = source => [...source.matchAll(/```(?<lang>\w+)?\n(?<body>[\s\S]*?)```/g)].map(match => match.groups)

const assertBefore = (source, first, second) => {
  const firstIndex = source.indexOf(first)
  const secondIndex = source.indexOf(second)
  assert.notEqual(firstIndex, -1, `missing ${first}`)
  assert.notEqual(secondIndex, -1, `missing ${second}`)
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`)
}

test('stackprism site experience skill advertises the current bridge workflow', () => {
  const metadata = frontmatter(skillSource)
  const bashBlocks = fencedBlocks(skillSource)
    .filter(block => block.lang === 'bash')
    .map(block => block.body)

  assert.equal(metadata.name, 'stackprism-site-experience')
  assert.match(metadata.description, /StackPrism Agent Bridge profile/)
  assert.match(metadata.description, /specific http\(s\) URL/)
  assert.match(metadata.description, /Agent Bridge E2E verification/)
  assert.match(metadata.description, /Do not use for generic UI edits/)
  assert.match(metadata.description, /backend-only work/)
  assert.match(metadata.description, /StackPrism internal code review/)
  assert.ok(
    bashBlocks.some(block => block.includes('scripts/capture-site.mjs')),
    'skill must show preferred capture helper'
  )
  assert.ok(
    bashBlocks.some(block => block.includes('scripts/stackprism-bridge.mjs')),
    'skill must show JS bridge'
  )
  assert.ok(
    bashBlocks.some(block => block.includes('scripts/stackprism_bridge.py')),
    'skill must show Python fallback'
  )
  assert.match(skillSource, /scripts\/capture-site\.mjs/)
  assert.match(skillSource, /scripts\/stackprism-bridge\.mjs/)
  assert.match(skillSource, /scripts\/stackprism_bridge\.py/)
  assert.match(skillSource, /STACKPRISM_BROWSER_OPEN_COMMAND/)
  assert.match(skillSource, /STACKPRISM_BROWSER_OPEN_ARGS_JSON/)
  assert.match(skillSource, /--allow-private-network/)
  assert.match(skillSource, /--include tech,visual,layout,components,interaction,ux,assets/)
  assert.match(skillSource, /--max-resource-urls/)
  assert.match(skillSource, /one JSON summary on stdout/)
  assert.match(skillSource, /one JSON error object to stderr/)
  assert.match(skillSource, /`error\.code`, `error\.message`, and sanitized `error\.details`/)
  assert.match(skillSource, /PRIVATE_NETWORK_TARGET_BLOCKED/)
  assert.match(skillSource, /CAPTURE_BUSY/)
  assert.match(skillSource, /AGENT_BRIDGE_DISABLED/)
  assert.match(skillSource, /EXTENSION_NOT_CONNECTED/)
  assert.match(skillSource, /Firefox profiles/)
  assert.match(skillSource, /"--profile","\/absolute\/path\/to\/profile"/)
  assert.match(skillSource, /correct Chrome, Edge, or Firefox profile/)
})

test('stackprism site experience skill points agents to repo-local references', () => {
  assert.match(skillSource, /references\/site-experience-profile-schema\.md/)
  assert.match(skillSource, /references\/agent-consumption-guide\.md/)
  assert.match(profileSchemaSource, /Schema id: `stackprism\.site_experience_profile\.v1`/)
  assert.match(profileSchemaSource, /agentGuidance/)
  assert.match(profileSchemaSource, /recreationPlan/)
  assert.match(profileSchemaSource, /Screenshot image base64 is intentionally omitted/)
  assert.match(consumptionGuideSource, /Start from `agentGuidance\.recreationPlan`/)
  assert.match(consumptionGuideSource, /Read `limitations`/)
  assertBefore(consumptionGuideSource, 'Read `limitations` first', 'Start from `agentGuidance.recreationPlan`')
  assertBefore(skillSource, 'Read `limitations` first', 'Start from `agentGuidance.recreationPlan`')
  assert.match(consumptionGuideSource, /verificationChecklist/)
  assert.match(consumptionGuideSource, /Raw `\/profile` access still requires the API token/)
  assert.match(consumptionGuideSource, /`apiToken`, `bridgeToken`, nonce, raw profile JSON, nor screenshot data URLs/)
  assert.match(consumptionGuideSource, /If `visualProfile` or screenshot evidence is missing, do not claim visual parity/)
  assert.match(consumptionGuideSource, /A tech-only profile supports technology, dependency, and runtime observations only/)
  assert.match(consumptionGuideSource, /not sufficient for UI implementation, visual comparison, or visual verification/)
  assert.match(consumptionGuideSource, /Destination project conventions override the source page's stack/)
  assert.match(consumptionGuideSource, /component library, routing, state, CSS architecture, test framework/)
  assert.match(consumptionGuideSource, /Interaction smoke tests should cover viewport, key path, hover and focus states/)
  assert.match(consumptionGuideSource, /responsive breakpoint, screenshot or DOM geometry evidence, and explicit limitations/)
  assert.match(consumptionGuideSource, /Screenshots are not pixel-redacted/)
  assert.match(consumptionGuideSource, /login-protected, account-specific, or private pages/)
  assert.match(consumptionGuideSource, /public demo, desensitized test environment, design brief, or user-provided summary/)
  assert.match(profileSchemaSource, /`visualReference` for optional screenshot handling/)
  assert.match(profileSchemaSource, /`verificationChecklist` for destination-app acceptance checks/)
})

test('stackprism site experience skill UI metadata remains aligned with global discovery', () => {
  const shortDescription = yamlValue(openaiYamlSource, 'short_description')
  const defaultPrompt = yamlValue(openaiYamlSource, 'default_prompt')

  assert.equal(yamlValue(openaiYamlSource, 'display_name'), 'StackPrism Site Experience')
  assert.equal(shortDescription, 'Capture StackPrism Agent Bridge URL profiles')
  assert.ok(shortDescription.length >= 25 && shortDescription.length <= 64)
  assert.match(defaultPrompt, /\$stackprism-site-experience/)
  assert.match(defaultPrompt, /StackPrism Agent Bridge profile/)
  assert.match(defaultPrompt, /website recreation/)
  assert.match(defaultPrompt, /UX comparison/)
  assert.match(defaultPrompt, /live browser evidence/)
  assert.match(defaultPrompt, /Agent Bridge E2E validation/)
  assert.match(defaultPrompt, /extension/)
  assert.match(defaultPrompt, /not a .*private login page/)
  assert.ok(defaultPrompt.length <= 260)
  assert.equal(defaultPrompt.split(/[.!?]\s+/).filter(Boolean).length, 1)
  assert.match(openaiYamlSource, /display_name: 'StackPrism Site Experience'/)
  assert.match(openaiYamlSource, /allow_implicit_invocation: true/)
})

test('repo-local skill documents bridge asset parity and local installation boundary', () => {
  assert.match(readmeSource, /not automatically installed into Codex or any global skill registry/)
  assert.match(readmeSource, /JavaScript bridge and Python fallback intentionally share the same bridge page CSS and client script text/)
  assert.match(readmeSource, /--include tech,visual,layout,components,interaction,ux,assets/)
  assert.match(readmeSource, /--max-resource-urls <n>/)
  assert.match(readmeSource, /The direct bridge scripts print a single ready JSON line/)
  assert.match(readmeSource, /one JSON summary to stdout/)
  assert.match(readmeSource, /one JSON error object to stderr/)
  assert.match(readmeSource, /Local development targets such as `localhost`/)
  assert.match(readmeSource, /--allow-private-network/)
  assert.match(readmeSource, /tests\/stackprism_bridge_py\.test\.mjs/)
  assert.match(agentsSource, /repo-local skill/)
  assert.match(agentsSource, /JavaScript bridge 优先/)
  assert.match(agentsSource, /Python fallback/)
  assert.match(agentsSource, /ready JSON/)
})
