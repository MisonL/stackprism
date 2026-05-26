import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = resolve(root, 'dist')
const firefoxDir = resolve(root, 'dist-firefox')

if (!existsSync(distDir)) {
  console.error('[package-firefox] dist/ not found, run `pnpm build` first')
  process.exit(1)
}

rmSync(firefoxDir, { recursive: true, force: true })
cpSync(distDir, firefoxDir, { recursive: true })

// --- Inline ES module chunks into a single background script ---
// CRXJS outputs background as ES modules with code-split shared chunks.
// Firefox background scripts don't support ES modules, so we:
// 1. Wrap each shared chunk in an IIFE to isolate scope (prevents variable name collisions)
// 2. Store each chunk's exports in a per-chunk namespace
// 3. Replace the entry chunk's imports with variable declarations from those namespaces

const parseAllImportBindings = (code) => {
  const re = /import\{([^}]*)\}from"([^"]*)"/g
  const imports = []
  let match
  while ((match = re.exec(code)) !== null) {
    const bindings = match[1].split(',').map(s => {
      const parts = s.trim().split(/\s+as\s+/)
      return { exported: parts[0].trim(), local: (parts[1] || parts[0]).trim() }
    })
    imports.push({ path: match[2], bindings })
  }
  if (!imports.length && /import\s/.test(code)) {
    throw new Error('[package-firefox] unsupported import syntax in entry chunk — cannot inline')
  }
  return imports
}

const parseExportBindings = (code) => {
  const match = code.match(/export\{([^}]*)\};?\s*$/)
  if (!match) {
    if (/export\s/.test(code)) {
      throw new Error('[package-firefox] unsupported export syntax in shared chunk — cannot inline')
    }
    return []
  }
  return match[1].split(',').map(s => {
    const parts = s.trim().split(/\s+as\s+/)
    return { local: parts[0].trim(), exported: (parts[1] || parts[0]).trim() }
  })
}

const stripModuleSyntax = (code) =>
  code.replace(/import\{[^}]*\}from"[^"]*";?/g, '').replace(/export\{[^}]*\};?/g, '')

const resolveImports = (filePath) => {
  const code = readFileSync(filePath, 'utf8')
  const dir = dirname(filePath)
  const importRe = /import\{[^}]*\}from"(\.\/[^"]+)"/g
  const deps = []
  let match
  while ((match = importRe.exec(code)) !== null) {
    deps.push(resolve(dir, match[1]))
  }
  return { code, deps }
}

const topologicalSort = (entryPath) => {
  const visited = new Set()
  const order = []
  const visit = (filePath) => {
    if (visited.has(filePath)) return
    visited.add(filePath)
    const { deps } = resolveImports(filePath)
    for (const dep of deps) visit(dep)
    order.push(filePath)
  }
  visit(entryPath)
  return order
}

// Read the loader to find the entry chunk
const loaderPath = resolve(firefoxDir, 'service-worker-loader.js')
const loaderCode = readFileSync(loaderPath, 'utf8')
const entryMatch = loaderCode.match(/import\s+'\.\/(assets\/[^']+)'/)
if (!entryMatch) {
  console.error('[package-firefox] could not resolve service-worker-loader entry')
  process.exit(1)
}

const entryPath = resolve(firefoxDir, entryMatch[1])
const chunkOrder = topologicalSort(entryPath)
const sharedChunks = chunkOrder.slice(0, -1)
const entryChunkPath = chunkOrder[chunkOrder.length - 1]

const parts = [`var __chunks = {};`]

for (const filePath of sharedChunks) {
  const code = readFileSync(filePath, 'utf8')
  const chunkId = basename(filePath, '.js')
  const exports = parseExportBindings(code)
  const stripped = stripModuleSyntax(code)
  const exportAssignments = exports
    .map(e => `__chunks["${chunkId}"].${e.exported} = ${e.local};`)
    .join(' ')
  parts.push(`(function() { ${stripped} __chunks["${chunkId}"] = {}; ${exportAssignments} })();`)
}

const entryCode = readFileSync(entryChunkPath, 'utf8')
const entryImports = parseAllImportBindings(entryCode)
let entryBody = stripModuleSyntax(entryCode)
if (entryImports.length) {
  const varDecls = entryImports.flatMap(imp => {
    const chunkId = basename(resolve(dirname(entryChunkPath), imp.path), '.js')
    return imp.bindings.map(b => `var ${b.local} = __chunks["${chunkId}"].${b.exported};`)
  }).join(' ')
  entryBody = varDecls + '\n' + entryBody
}
parts.push(entryBody)

const backgroundPath = resolve(firefoxDir, 'background.js')
writeFileSync(backgroundPath, parts.join('\n'))
console.log(`[package-firefox] inlined ${chunkOrder.length} chunks into background.js`)

// --- Transform manifest.json ---

const manifestPath = resolve(firefoxDir, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

if (manifest.background?.service_worker) {
  manifest.background = { scripts: ['background.js'] }
}

manifest.browser_specific_settings = {
  gecko: {
    id: 'stackprism@stackprism.dev',
    strict_min_version: '128.0'
  }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log('[package-firefox] manifest.json transformed')

// --- Package .xpi ---

const releaseDir = resolve(root, 'release')
if (!existsSync(releaseDir)) mkdirSync(releaseDir)

const version = manifest.version
const xpiName = `stackprism-v${version}.xpi`
execFileSync('zip', ['-r', resolve(releaseDir, xpiName), '.'], { cwd: firefoxDir, stdio: 'inherit' })
console.log(`[package-firefox] created release/${xpiName}`)
