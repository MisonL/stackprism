# 开发手册

这一部分写给准备看源码、改规则或提 PR 的人。只需要安装扩展的话，看 [使用指南](/guide/) 就够了。

## 章节

- [架构概览](./architecture.md) — 项目目录结构、各模块职责、数据流
- [规则文件格式](./rule-format.md) — `public/rules/` 下 JSON 怎么组织，nested groups + defaults 继承
- [检测流程](./detection-flow.md) — 从 webRequest / 页面注入到弹窗渲染走过哪些环节
- [Agent Bridge](./agent-bridge.md) — 本地 loopback bridge、扩展握手、profile 回传和信任边界
- [贡献规则](./contribute-rules.md) — 怎么往内置规则集合加新技术
- [构建与发布](./release.md) — 本地构建、Firefox 打包、签 crx、发布工作流

## 技术栈概况

项目主体是 Vite 5 + Vue 3 + TypeScript + `@crxjs/vite-plugin` 2.x，包管理器用 pnpm。Chromium 构建的后台脚本是 Manifest V3 ESM service worker；Firefox 包会重新打包为 `background.js` IIFE scripts。当前 fork 还包含 repo-local Agent Bridge skill，位置是 `agent-skill/stackprism-site-experience/`。

规则放在 `public/rules/` 下，按页面规则、响应头规则、WordPress / Drupal 生态等方向拆成多个 JSON 文件。构建时会预处理规则，注入 `__hints` / `__keywordCombined` 这类用于匹配加速的字段。

## 开发常用命令

```bash
pnpm install            # 装依赖
pnpm run dev            # 起 vite dev server，扩展热更
pnpm run build          # Chrome / Edge 构建到 dist/
pnpm run build:firefox  # Firefox 构建到 dist-firefox/，并生成 release/*.xpi
pnpm run typecheck      # vue-tsc 严格类型检查，并触发生产构建
pnpm run test:unit      # Node 单元测试
pnpm run lint           # eslint 检查
pnpm run check:links    # 技术链接完整性检查
pnpm run docs:dev       # 起本文档站本地预览
pnpm run docs:build     # 构建文档静态站
```

dev 模式下，扩展页面支持热更新。改 popup / settings / help 通常会自动刷新；改 `src/background/` 或 content script 后，Chromium 需要到 `chrome://extensions/` 手动刷新扩展卡片。Firefox 本地验证需要重跑 `pnpm run build:firefox`，再到 `about:debugging#/runtime/this-firefox` 重新临时加载 `dist-firefox/manifest.json`。

## Vue 入口

三个独立 SPA 入口，分别构建，互不干扰：

| 入口     | 文件                         | 说明                                                |
| -------- | ---------------------------- | --------------------------------------------------- |
| popup    | `src/ui/popup/index.html`    | 浏览器右上角点扩展图标弹出的 440px × 600px 小窗     |
| settings | `src/ui/settings/index.html` | 在 `chrome://extensions/` 详情页打开的 options page |
| help     | `src/ui/help/index.html`     | 设置页里点「使用说明」打开的独立标签页              |

## 相关链接

- [上游仓库](https://github.com/setube/stackprism)
- [当前 fork](https://github.com/MisonL/stackprism)
- [上游 Issue 列表（普通误识 / 规则反馈）](https://github.com/setube/stackprism/issues)
- [上游 Release 列表（现有公开资产）](https://github.com/setube/stackprism/releases)

当前 fork 未开启公开 Issues / Discussions；Agent Bridge 或 fork 构建专属问题请在相关 PR 线程或维护者指定渠道反馈。若后续要公开收集 fork 问题，应先在 GitHub 仓库设置中启用 Issues，再把反馈入口改为当前 fork Issues。
