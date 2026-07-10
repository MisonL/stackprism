# 架构概览

## 目录结构

| 区域                                      | 关键内容                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/manifest.config.ts`                  | `@crxjs/vite-plugin` 使用的 MV3 manifest 定义                                                                                             |
| `src/background/`                         | background 脚本源码，包括事件注册、消息路由、tab 缓存、响应头、主动检测、动态快照、规则加载、Agent Bridge session、capture 生命周期和写锁 |
| `src/content/`                            | `content-observer.ts` 持续动态采集；`agent-bridge-*.ts` 负责 127.0.0.1 bridge 页面握手、状态轮询和分片回传                                |
| `src/injected/`                           | 编译为独立 IIFE，注入页面 MAIN world；包含 page detector、source search 和 Agent Bridge experience profiler                               |
| `src/ui/`                                 | popup、settings、help 三个 Vue SPA，以及共享组件和设计 token                                                                              |
| `src/types/`                              | messages、agent-bridge、rules、settings、popup 等跨脚本共享类型                                                                           |
| `src/utils/`                              | settings normalize、browser compat、Firefox data consent、network policy、page support、site experience profile 等共享 helper             |
| `public/`                                 | icons、规则 JSON、tech-links、build:injected 输出的 IIFE 文件                                                                             |
| `build-scripts/`                          | 注入脚本构建、Firefox manifest 转换、background rebundle 和 xpi 打包                                                                      |
| `agent-skill/stackprism-site-experience/` | repo-local Agent Bridge skill 与本机 bridge helper                                                                                        |
| `dist/`、`dist-firefox/`、`release/`      | Chrome / Edge 构建产物、Firefox 临时加载产物、zip / xpi / crx 发布产物                                                                    |

## 进程模型

Chrome / Edge / Firefox 扩展主要用到这些执行环境。Chromium 构建使用 MV3 ESM service worker；Firefox 包会把 background 重新打包成 `background.js` IIFE scripts。

| 环境                      | 入口                                                                                               | 运行时                                                                        | 责任                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Background                | `src/background/*.ts`                                                                              | Chromium 是 MV3 ESM service worker；Firefox 包是 `background.js` IIFE scripts | 监听响应头、处理 runtime message、缓存检测结果、加载规则和 tech-links                                      |
| Content script            | `src/content/content-observer.ts`、`src/content/agent-bridge-client.ts`                            | 页面 isolated world                                                           | 动态采集 DOM 和资源；在 127.0.0.1 bridge 页面握手并回传 profile 分片                                       |
| Injected script           | `dist/injected/page-detector.iife.js`、`page-source-search.iife.js`、`experience-profiler.iife.js` | 页面 MAIN world                                                               | 按需注入，读取页面真实 DOM / globalKeys，完成后返回结果，不长驻                                            |
| Extension UI              | `src/ui/{popup,settings,help}/*.vue`                                                               | 扩展页面                                                                      | Vue 3 SPA，通过 `src/utils/messaging.ts` 与 background 通信；检测设置走 sync，Agent Bridge opt-in 走 local |
| Local Agent Bridge helper | `agent-skill/stackprism-site-experience/scripts/*.mjs`                                             | 本机 Node / Python helper                                                     | 绑定 127.0.0.1 bridge，打开浏览器 bridge 页，轮询 capture 状态，下载 profile 和可选截图                    |

## 跨脚本消息

消息全部在 `src/types/messages.ts` 用 discriminated union 定义类型。runtime message、tab message、listener 注册和 port 连接、发送、监听统一经过 `src/utils/messaging.ts`；可序列化 content script 的 inline fallback 会先安装同一 transport，再运行自包含 runner。Agent Bridge 的 profile 分片端口名由 `src/types/agent-bridge.ts` 统一定义。

| 消息组       | 方向                  | 用途                                                                                           |
| ------------ | --------------------- | ---------------------------------------------------------------------------------------------- |
| popup 查询   | popup -> bg           | 当前 popup 拉取弹窗结果和原始线索                                                              |
| 主动检测     | popup -> bg           | 触发刷新检测；bg 通过 `executeScript` 获取 page-detector 结果并在 bg 内增强 WordPress 主题线索 |
| 动态快照     | content -> bg         | content script 持续上报资源和 DOM 变化                                                         |
| Agent Bridge | bridge content <-> bg | HELLO、创建 capture、状态控制、profile 分片确认                                                |

`GET_HEADER_DATA`、`GET_TECH_LINK`、`PAGE_DETECTION_RESULT` 和 `GET_WORDPRESS_THEME_DETAILS` 仍有 background handler 或类型定义，但当前主界面没有发送端；维护这些兼容入口时不要把它们当成当前主路径。

新增消息时必须同时更新 `src/types/messages.ts`、发送端、接收端和相关测试。Agent Bridge 消息还要保持 `src/types/agent-bridge.ts` 中的 protocol version、capabilities、错误码和字段白名单一致。

## 注入脚本的双轨问题

当前主动检测主路径是 `executeScript({ files: ['injected/page-detector.iife.js'] })`：background 先把规则写入页面 MAIN world 的临时全局，再注入独立 IIFE 文件读取规则并返回 page 结果。

旧实现曾让 `page-detector.ts` 同时承担 background `importScripts` 引入和 `executeScript({ world: 'MAIN', func })` 序列化注入。切到 ESM 后，`Function.prototype.toString` 不能处理 import，所以这条历史路径不再适合作为主链路。

解决方案：用 `executeScript({files})` 替代 `{func}`。`page-detector.ts` 独立编译为 IIFE 单文件（`vite.injected.config.ts`），通过两次 RPC 注入：

```ts
// 1. 写入临时全局变量
chrome.scripting.executeScript({
  target: { tabId },
  world: 'MAIN',
  func: rules => {
    window.__SP_RULES__ = rules
  },
  args: [pageRules]
})

// 2. 注入 IIFE，IIFE 内部读 __SP_RULES__ 后清空，return 结果
chrome.scripting.executeScript({
  target: { tabId },
  world: 'MAIN',
  files: ['injected/page-detector.iife.js']
})
```

这样处理后，主动检测主路径通过 IIFE 文件注入页面；只有脚本文件加载失败时，background 才回退到 `page-detector-runtime` 的函数注入路径。Chromium 构建保留 ESM module service worker；Firefox 打包阶段再由 `package-firefox.mjs` 重打包为 `background.js` IIFE。

## 静态资源

`public/rules/` 和 `public/tech-links.json` 由 Vite 1:1 复制到 `dist/`，运行时通过 `chrome.runtime.getURL` + `fetch` 加载。不要用 `import rules from '...'` 直接导入这些大 JSON；那会让 Rollup 把规则内联进 bundle，拖慢 background 冷启动（Chromium service worker / Firefox background scripts 都会受影响）。

build 期还有两个 vite plugin 处理这些 JSON：

1. `precompileRulesPlugin`：递归走每个规则 JSON，给每条 leaf rule 注入 `__hints`（自动从 patterns 提取的关键词）+ `__keywordCombined`（keyword 类型规则的合并正则源码）
2. `minifyJsonAssets`：把所有 JSON 用 `JSON.stringify(parsed)` 重写一遍消除缩进 / 空白

## 状态管理

不引 Pinia。原因：

- popup / settings 只需要页面内局部状态
- popup / settings 是两个独立扩展页面（独立 chrome.runtime context），Pinia 反而要二次实例化
- 普通检测设置用 `chrome.storage.sync` 作真源 + `reactive()` 本地副本即可
- Agent Bridge 的 `agentBridgeEnabled` 和 `agentBridgeAllowAllNetworkTargets` 只从 `chrome.storage.local` 生效，不随 sync 跨设备同步

## 主题（明暗）

`src/utils/theme.ts` 管理 `getStoredTheme / setStoredTheme / cycleTheme / themeLabel`，存在 `chrome.storage.sync.stackPrismTheme`，三态：`auto` / `light` / `dark`。

`src/ui/tokens.css` 用 `:root[data-theme='dark']` 强制暗色、`@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` 跟随系统、`color-scheme` 同步浏览器默认 UI。

主题切换在 popup 与 settings 顶部都有按钮，通过 `chrome.storage.onChanged` 跨页同步。
