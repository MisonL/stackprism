const BRIDGE_META_SELECTOR = 'meta[name="stackprism-agent-bridge"][content="stackprism-agent-bridge"]'

const isLoopbackBridgePage = (): boolean => {
  try {
    return (
      location.origin.startsWith('http://127.0.0.1:') &&
      location.pathname === '/bridge' &&
      Boolean(document.querySelector(BRIDGE_META_SELECTOR))
    )
  } catch {
    return false
  }
}

if (isLoopbackBridgePage()) {
  document.documentElement.dataset.stackprismAgentBridgeClient = 'ready'
}
