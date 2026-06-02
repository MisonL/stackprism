const DEFAULT_TERMINAL_SETTLE_MS = 1500
const MAX_TERMINAL_SETTLE_MS = 5000
const CHILD_STOP_GRACE_MS = 2500

const timeoutSignal = ms => {
  let timer
  const promise = new Promise(resolve => {
    timer = setTimeout(resolve, ms)
  })
  return {
    promise,
    clear: () => clearTimeout(timer)
  }
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export const parseTerminalSettleMs = value => {
  if (value == null || value === '') return DEFAULT_TERMINAL_SETTLE_MS
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_TERMINAL_SETTLE_MS
    ? parsed
    : DEFAULT_TERMINAL_SETTLE_MS
}

export const stopChild = async child => {
  if (child.exitCode !== null || child.killed) return
  try {
    if (child.stdin?.writable && !child.stdin.destroyed) child.stdin.end()
  } catch {}
  const firstTimeout = timeoutSignal(CHILD_STOP_GRACE_MS)
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    firstTimeout.promise.then(() => {
      child.kill('SIGTERM')
      return 'killed'
    })
  ])
  firstTimeout.clear()
  if (exited === 'killed') {
    const secondTimeout = timeoutSignal(CHILD_STOP_GRACE_MS)
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), secondTimeout.promise]).catch(() => {})
    secondTimeout.clear()
  }
}
