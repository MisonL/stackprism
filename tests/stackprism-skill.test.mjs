import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const skillSource = await readFile(new URL('../agent-skill/stackprism-site-experience/SKILL.md', import.meta.url), 'utf8')
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

test('stackprism site experience skill advertises the current bridge workflow', () => {
  assert.match(skillSource, /name: stackprism-site-experience/)
  assert.match(skillSource, /description: .*real URL.*StackPrism/)
  assert.match(skillSource, /scripts\/capture-site\.mjs/)
  assert.match(skillSource, /scripts\/stackprism-bridge\.mjs/)
  assert.match(skillSource, /scripts\/stackprism_bridge\.py/)
  assert.match(skillSource, /STACKPRISM_BROWSER_OPEN_COMMAND/)
  assert.match(skillSource, /STACKPRISM_BROWSER_OPEN_ARGS_JSON/)
  assert.match(skillSource, /--allow-private-network/)
  assert.match(skillSource, /PRIVATE_NETWORK_TARGET_BLOCKED/)
  assert.match(skillSource, /CAPTURE_BUSY/)
  assert.match(skillSource, /AGENT_BRIDGE_DISABLED/)
  assert.match(skillSource, /EXTENSION_NOT_CONNECTED/)
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
})

test('stackprism site experience skill UI metadata remains aligned with global discovery', () => {
  assert.match(openaiYamlSource, /display_name: 'StackPrism Site Experience'/)
  assert.match(openaiYamlSource, /short_description: 'Evidence for website recreation'/)
  assert.match(openaiYamlSource, /\$stackprism-site-experience/)
  assert.match(openaiYamlSource, /allow_implicit_invocation: true/)
})

test('repo-local skill documents bridge asset parity and local installation boundary', () => {
  assert.match(readmeSource, /not automatically installed into Codex or any global skill registry/)
  assert.match(readmeSource, /JavaScript bridge and Python fallback intentionally share the same bridge page CSS and client script text/)
  assert.match(readmeSource, /tests\/stackprism_bridge_py\.test\.mjs/)
})
