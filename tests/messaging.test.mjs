import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule, resetLoadTsModuleCaches } from './helpers/load-ts-module.mjs'

const TRANSPORT_KEY = '__stackPrismRuntimeMessaging__'

const restoreGlobal = (key, value) => {
  if (value === undefined) delete globalThis[key]
  else globalThis[key] = value
}

test('messaging helper centralizes runtime, tab, listener, and port transport', async () => {
  const originalChrome = globalThis.chrome
  const originalTransport = globalThis[TRANSPORT_KEY]
  const listeners = []
  const runtimeMessages = []
  const tabMessages = []
  const portMessages = []
  const portListeners = []
  const port = {
    name: 'unit-port',
    postMessage: message => portMessages.push(message),
    onMessage: { addListener: listener => portListeners.push(listener) }
  }
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: listener => listeners.push(listener) },
      onConnect: { addListener: () => {} },
      sendMessage: (message, callback) => {
        runtimeMessages.push(message)
        callback({ ok: true, data: { echoedType: message.type } })
      },
      connect: ({ name }) => ({ ...port, name })
    },
    tabs: {
      sendMessage: async (tabId, message) => {
        tabMessages.push({ tabId, message })
        return { ok: true, data: null }
      }
    }
  }
  delete globalThis[TRANSPORT_KEY]
  resetLoadTsModuleCaches()

  try {
    const { connectRuntimePort, postPortMessage, registerMessageListener, registerPortMessageListener, sendMessage, sendTabMessage } =
      await loadTsModule('src/utils/messaging.ts')
    const response = await sendMessage({ type: 'GET_TECH_LINK', name: 'Vue' })
    const tabResponse = await sendTabMessage(7, {
      type: 'AGENT_CAPTURE_STATUS',
      payload: {
        captureId: 'cap_1234567890123456789012',
        sessionId: 's_1234567890123456789012',
        nonce: 'n_1234567890123456789012',
        protocolVersion: 1,
        status: 'running',
        phase: 'detecting_tech'
      }
    })
    const listener = () => false
    const portListener = () => {}
    registerMessageListener(listener)
    const connectedPort = connectRuntimePort('profile-port')
    registerPortMessageListener(connectedPort, portListener)
    postPortMessage(connectedPort, {
      type: 'AGENT_PROFILE_TRANSFER_PORT_HELLO',
      captureId: 'cap_1234567890123456789012',
      sessionId: 's_1234567890123456789012',
      nonce: 'n_1234567890123456789012',
      protocolVersion: 1
    })

    assert.equal(response.data.echoedType, 'GET_TECH_LINK')
    assert.equal(tabResponse.ok, true)
    assert.deepEqual(
      runtimeMessages.map(message => message.type),
      ['GET_TECH_LINK']
    )
    assert.deepEqual(
      tabMessages.map(item => [item.tabId, item.message.type]),
      [[7, 'AGENT_CAPTURE_STATUS']]
    )
    assert.equal(listeners[0], listener)
    assert.equal(connectedPort.name, 'profile-port')
    assert.equal(portListeners[0], portListener)
    assert.deepEqual(
      portMessages.map(message => message.type),
      ['AGENT_PROFILE_TRANSFER_PORT_HELLO']
    )
  } finally {
    restoreGlobal('chrome', originalChrome)
    restoreGlobal(TRANSPORT_KEY, originalTransport)
    resetLoadTsModuleCaches()
  }
})

test('runtime messaging converts lastError and synchronous failures into rejections', async () => {
  const originalChrome = globalThis.chrome
  const originalTransport = globalThis[TRANSPORT_KEY]
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      onConnect: { addListener: () => {} },
      sendMessage: (_message, callback) => {
        globalThis.chrome.runtime.lastError = { message: 'runtime unavailable' }
        callback(undefined)
        delete globalThis.chrome.runtime.lastError
      },
      connect: () => ({})
    },
    tabs: { sendMessage: async () => ({ ok: true }) }
  }
  delete globalThis[TRANSPORT_KEY]
  resetLoadTsModuleCaches()

  try {
    const { installRuntimeMessaging, sendMessage } = await loadTsModule('src/utils/messaging.ts')
    assert.equal(installRuntimeMessaging(), undefined)
    await assert.rejects(() => sendMessage({ type: 'GET_TECH_LINK', name: 'Vue' }), /runtime unavailable/)

    globalThis.chrome.runtime.sendMessage = () => {
      throw new Error('synchronous transport failure')
    }
    await assert.rejects(() => sendMessage({ type: 'GET_TECH_LINK', name: 'Vue' }), /synchronous transport failure/)
  } finally {
    restoreGlobal('chrome', originalChrome)
    restoreGlobal(TRANSPORT_KEY, originalTransport)
    resetLoadTsModuleCaches()
  }
})
