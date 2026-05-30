import { spawnSync } from 'node:child_process'

const containsNul = value => (typeof value === 'string' ? value.includes('\0') : Array.isArray(value) && value.some(containsNul))

export const parseOpenConfig = env => {
  for (const key of ['STACKPRISM_BROWSER_OPEN_COMMAND', 'STACKPRISM_BROWSER_OPEN_ARGS_JSON']) {
    if (String(env[key] || '').includes('\0')) {
      return { ok: false, code: 'BRIDGE_INVALID_ENV', message: 'Browser open environment contains NUL.' }
    }
  }
  if (env.STACKPRISM_BROWSER_OPEN_COMMAND && env.STACKPRISM_BROWSER_OPEN_ARGS_JSON) {
    try {
      if (containsNul(JSON.parse(env.STACKPRISM_BROWSER_OPEN_ARGS_JSON))) {
        return { ok: false, code: 'BRIDGE_INVALID_ENV', message: 'Browser open environment contains NUL.' }
      }
    } catch {}
  }
  return { ok: true }
}

export const resolveBrowserOpenCommand = (env = process.env, platform = process.platform) => {
  let command = env.STACKPRISM_BROWSER_OPEN_COMMAND
  let args = []
  if (command) {
    if (env.STACKPRISM_BROWSER_OPEN_ARGS_JSON) {
      try {
        args = JSON.parse(env.STACKPRISM_BROWSER_OPEN_ARGS_JSON)
      } catch {
        return { ok: false, details: { reason: 'invalid_open_args' } }
      }
      if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
        return { ok: false, details: { reason: 'invalid_open_args' } }
      }
    }
  } else if (platform === 'darwin') {
    command = 'open'
  } else if (platform === 'win32') {
    command = 'rundll32.exe'
    args = ['url.dll,FileProtocolHandler']
  } else {
    command = 'xdg-open'
  }
  return { ok: true, command, args }
}

export const openBrowser = (url, env = process.env, platform = process.platform) => {
  const openConfig = parseOpenConfig(env)
  if (!openConfig.ok) return { ok: false, details: { reason: openConfig.code, message: openConfig.message } }
  if (String(url).includes('\0') || String(url).includes('\n') || String(url).includes('\r')) {
    return { ok: false, details: { reason: 'invalid_url' } }
  }

  if (env.STACKPRISM_BRIDGE_NO_OPEN === '1') return { ok: true, skipped: true }

  const resolved = resolveBrowserOpenCommand(env, platform)
  if (!resolved.ok) return resolved
  const { command, args } = resolved

  try {
    const child = spawnSync(command, [...args, url], { stdio: 'ignore', shell: false, timeout: 2000 })
    if (child.error) return { ok: false, details: { reason: child.error.code === 'ETIMEDOUT' ? 'open_timeout' : 'spawn_failed' } }
    if (child.status !== 0) return { ok: false, details: { reason: 'open_failed' } }
    return { ok: true }
  } catch {
    return { ok: false, details: { reason: 'spawn_failed' } }
  }
}
