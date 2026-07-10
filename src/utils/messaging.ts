import type { Message, MessageType, ResponseFor } from '@/types/messages'

export type RuntimeMessageListener = (
  message: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void

export type RuntimePortMessageListener<T extends Message = Message> = (message: T, port: chrome.runtime.Port) => void

export type RuntimeMessageTransport = {
  sendMessage: (message: Message, runtime?: typeof chrome.runtime) => Promise<unknown>
  addListener: (listener: RuntimeMessageListener, runtime?: typeof chrome.runtime) => void
  connect: (name: string, runtime?: typeof chrome.runtime) => chrome.runtime.Port
  postPortMessage: (port: chrome.runtime.Port, message: Message) => void
  addPortMessageListener: (port: chrome.runtime.Port, listener: RuntimePortMessageListener) => void
}

export const installRuntimeMessaging = (): void => {
  const key = '__stackPrismRuntimeMessaging__'
  const scope = globalThis as typeof globalThis & Record<string, unknown>
  const existing = scope[key] as Partial<RuntimeMessageTransport> | undefined
  if (
    typeof existing?.sendMessage === 'function' &&
    typeof existing.addListener === 'function' &&
    typeof existing.connect === 'function' &&
    typeof existing.postPortMessage === 'function' &&
    typeof existing.addPortMessageListener === 'function'
  ) {
    return
  }

  const transport: RuntimeMessageTransport = {
    sendMessage: (message, runtime = chrome.runtime) =>
      new Promise((resolve, reject) => {
        try {
          runtime.sendMessage(message, response => {
            const error = runtime.lastError
            if (error) {
              reject(new Error(error.message || 'chrome.runtime error'))
              return
            }
            resolve(response)
          })
        } catch (error) {
          reject(error)
        }
      }),
    addListener: (listener, runtime = chrome.runtime) => runtime.onMessage.addListener(listener),
    connect: (name, runtime = chrome.runtime) => runtime.connect({ name }),
    postPortMessage: (port, message) => port.postMessage(message),
    addPortMessageListener: (port, listener) => port.onMessage.addListener(listener)
  }
  scope[key] = transport
}

const runtimeMessaging = (): RuntimeMessageTransport => {
  installRuntimeMessaging()
  return (globalThis as typeof globalThis & Record<string, unknown>).__stackPrismRuntimeMessaging__ as RuntimeMessageTransport
}

export const sendMessage = <T extends MessageType>(message: Extract<Message, { type: T }>): Promise<ResponseFor<T>> =>
  runtimeMessaging().sendMessage(message) as Promise<ResponseFor<T>>

export const sendTabMessage = async <T extends MessageType>(
  tabId: number,
  message: Extract<Message, { type: T }>
): Promise<ResponseFor<T>> => (await chrome.tabs.sendMessage(tabId, message)) as ResponseFor<T>

export const registerMessageListener = (listener: RuntimeMessageListener): void => runtimeMessaging().addListener(listener)

export const connectRuntimePort = (name: string): chrome.runtime.Port => runtimeMessaging().connect(name)

export const postPortMessage = <T extends MessageType>(port: chrome.runtime.Port, message: Extract<Message, { type: T }>): void =>
  runtimeMessaging().postPortMessage(port, message)

export const registerPortMessageListener = <T extends Message>(port: chrome.runtime.Port, listener: RuntimePortMessageListener<T>): void =>
  runtimeMessaging().addPortMessageListener(port, listener as RuntimePortMessageListener)

export const registerConnectListener = (listener: (port: chrome.runtime.Port) => void): void =>
  chrome.runtime.onConnect.addListener(listener)

type Handler<T extends MessageType> = (
  message: Extract<Message, { type: T }>,
  sender: chrome.runtime.MessageSender
) => Promise<ResponseFor<T>> | ResponseFor<T>

type HandlerMap = {
  [K in MessageType]?: Handler<K>
}

export const registerMessageHandlers = (handlers: HandlerMap): void => {
  registerMessageListener((message, sender, sendResponse) => {
    const handler = handlers[message.type]
    if (!handler) return false

    Promise.resolve()
      .then(() => (handler as Handler<MessageType>)(message, sender))
      .then(result => sendResponse(result))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        sendResponse({ ok: false, error: message })
      })
    return true
  })
}
