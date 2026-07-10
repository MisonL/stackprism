# 检测流程

## 三条数据源管道

StackPrism 同时跑三条管道并把结果合并：

| 管道            | 入口                                                                           | 主要行为                                                                                                                                        | 写入位置                                                |
| --------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A: 响应头       | `chrome.webRequest.onHeadersReceived`                                          | 捕获主文档、API、iframe 的 `server`、`x-powered-by` 等响应头                                                                                    | `tab:{id}.main`、`tab:{id}.apis[]`、`tab:{id}.frames[]` |
| B: 页面主动检测 | popup 发送 `START_BACKGROUND_DETECTION`                                        | background 通过 `chrome.scripting.executeScript` 注入 page detector，页面 MAIN world 跑完后返回结果                                             | `tab:{id}.page`                                         |
| C: 动态采集     | manifest content script 自动注入 http(s) 页面；background 启动和主动检测时补注 | MutationObserver / PerformanceObserver 持续累积；content 端 400ms 基础防抖，高频 DOM burst 会触发 cooldown 保护；background 再防抖 400ms 后处理 | `tab:{id}.dynamic`                                      |

三个 tab key 都存在 `chrome.storage.session`。background 重启后会从 storage 恢复状态，不依赖内存；在 Chromium 中这对应 MV3 service worker，在 Firefox 包中对应 `background.js` scripts。

## 数据流：从触发到弹窗显示

1. 用户点击扩展图标，popup mount 后调用 `loadCachedDetection()`。
2. popup 通过 `src/utils/messaging.ts` 发送 `GET_POPUP_RESULT`。
3. `background/message-router.ts` 路由到 `getPopupResultResponse(tabId)`。
4. background 检查 `chrome.storage.session` 里的 `popup:{tabId}` 缓存。
5. 缓存命中且 `settingsKey` 一致时直接返回。
6. 缓存未命中时现场跑 `buildPopupCacheRecord`：从 `tab:{id}` 读 `page`、`main`、`apis`、`frames`、`dynamic`，应用用户自定义响应头规则，合并 5 路结果，按设置过滤，合并资源统计，清洗排序后写入 `popup:{tabId}` 缓存。
7. background 返回 `PopupResult`，popup 更新 `state.result` 并展示。
8. 后续 background 持续接收 webRequest 响应头、动态快照等增量更新，每次更新都重新写 `popup:{tabId}` 缓存。
9. `chrome.storage.onChanged` 触发 popup 端 `onStorageChange`，popup 比对 `popupCacheSignature` 多字段签名，确认有真实变化才替换 `state.result`。

## 主动检测时机

弹窗里点「刷新」会触发 `START_BACKGROUND_DETECTION` 消息。主路径可简化理解为：

1. popup 发送 `START_BACKGROUND_DETECTION`。
2. background 注入或补注 `content-observer`。
3. background 构建有效 page rules，并写入页面 MAIN world 临时全局。
4. background 注入 `injected/page-detector.iife.js`，读取 `executeScript` 返回值。
5. IIFE 文件加载成功时使用 IIFE 返回的 page 结果。
6. IIFE 文件加载失败时回退到 `page-detector-runtime` 的函数注入。
7. background 调 `augmentPageWithWordPressThemeStyles` 补充 WordPress 主题样式线索。
8. `cleanPageDetectionRecord` 后进入 per-tab 写锁。
9. `mergePageDetectionRecord` 合并旧 page 结果，再通过 `saveTabDataAndBadge` 重建 popup 缓存。

## Agent Bridge 采集流程

Agent Bridge 不复用弹窗按钮作为触发入口。它由本机 bridge 页面上的专用 content script 发起，background 在校验本机 opt-in、bridge 页面身份和 capture request 后，临时接管目标 tab 完成一次 site experience profile 采集。

1. Agent 启动本机 bridge 脚本。
2. Agent 调 `POST /v1/captures` 创建 capture，得到一次性 `bridgeUrl`。
3. 浏览器打开 `http://127.0.0.1:{port}/bridge?...` 页面。
4. `agent-bridge-client.ts` 校验 `/bridge` path、meta、session、capture、nonce、protocolVersion。
5. bridge content script 发送 `AGENT_BRIDGE_HELLO` 给 background。
6. background 校验 `chrome.storage.local` 中 `agentBridgeEnabled` 为 `true`。
7. bridge content script 读取 `/v1/captures/{id}/request`。
8. bridge content script 把 `START_AGENT_CAPTURE` 交给 `background/agent-capture.ts`。
9. background 打开或复用目标 tab，等待主 frame load 完成。
10. background 先把 `finalUrl` 写回 bridge，由 bridge server 执行最终 URL 策略校验。
11. `finalUrl` 通过后才运行技术检测和 `experience-profiler`。
12. profile 分片发回 bridge content script。
13. bridge content script 校验 chunk、sha256、session、capture、nonce 后，同源 POST profile。
14. Agent 用 `apiToken` 读取 `/v1/captures/{id}/profile`。

这个流程的关键边界：

- `agentBridgeEnabled` 只从 `chrome.storage.local` 读取，sync 旧字段不能自动开启。
- bridge tab、`/bridge` 页面和 `/v1/captures/*` 请求不写入普通 `tab-store`、popup 缓存、badge 或 dynamic snapshot。
- bridge content script 不持有 `apiToken`；background 不持久化 `bridgeToken`。
- `target_loaded` 的 final URL 被 bridge 接受前，不注入主动检测脚本或 experience profiler。
- profile 回传走 bridge content script 同源 POST，不由 background 直接跨 origin fetch localhost。
- 未完成 capture 的 deadline、tab ownership 和 cleanup 锚点写入 `chrome.storage.session`；background 重启后只能 fail closed，不伪造完成。
- Firefox 数据收集同意只在 manifest 完整声明 Agent Bridge 所需三类 `browser_specific_settings.gecko.data_collection_permissions.optional` 且浏览器 API 可用时成为额外门禁；声明不完整或 API 不可用会按 unsupported 放行。当前 Firefox 打包脚本不写该字段，因此当前运行时门禁仍以本机 opt-in、网络目标策略和 session 校验为准。

## 动态采集防抖

content-observer 端：

- 每次 MutationObserver / PerformanceObserver 触发，把变化累加到 state
- `scheduleSend()` 设置 400ms trailing timer，定时到了发 `DYNAMIC_PAGE_SNAPSHOT`
- 中途如果还有变化继续累积并重置定时器
- 高频 DOM mutation 还有 burst/cooldown 保护：1 秒内超过阈值或待处理节点过多时，会清空待处理节点、取消未执行的 flush，并进入 5 秒 mutation cooldown，避免抖动页持续占用

background 端 `dynamic-snapshot.ts`：

- 收到消息后 400ms 防抖
- 防抖到点跑 `detectFromDynamicSnapshot(snapshot, pageRules)`
- 写入 `tab:{id}.dynamic`，再走 `saveTabDataAndBadge`

## 规则匹配层（rule-matcher.ts）

每条 rule 在三个层面被使用：

```text
detectFromXxx(snapshot, rules)
  for (const rule of rules):
    1. matchesRuleTextHints(rule, context) - 业务侧 resourceHints 预过滤
    2. passesRulePrefilter(rule, lowerTexts) - 自动 hint 预过滤（命中即可继续）
    3. matchesCompiledRulePatterns(rule, text) - 跑实际正则 / keyword 合并正则
       - keyword 走 getCompiledCombinedPattern: 缓存的合并正则一次匹配
       - regex 走 getCompiledRulePatterns.some: 缓存的 RegExp[] 逐个 test
    4. 命中: add(category, name, confidence, evidence)
```

WeakMap 缓存使每条 rule 的正则 + hints 编译只跑一次，整个 rules 数组重复使用。

## badge 数字

每次 `saveTabDataAndBadge` 写完 popup 缓存后会取 `popupResult.counts.high`（高置信度技术数），调用 `chrome.action.setBadgeText` 显示在扩展图标上。打开弹窗看到的数字约等于 badge 数字。

## 设置变更如何让缓存失效

`buildSettingsCacheKey(settings)` 把 settings 关键字段（disabledCategories / disabledTechnologies / customRules）序列化成一个 string。`getCachedPopupResult(popup, settings)` 命中条件之一就是 `popup.settingsKey === buildSettingsCacheKey(settings)`。

设置一变，settingsKey 变，老缓存自动失效，下次 `GET_POPUP_RESULT` 会现场重新构建。
