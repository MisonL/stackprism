# Agent Bridge

Agent Bridge 让本机 AI Agent 在用户已安装并显式启用 StackPrism 扩展后，通过 `127.0.0.1` 本地 HTTP bridge 获取 `stackprism.site_experience_profile.v1`。

## 数据流

1. Agent 启动 `agent-skill/stackprism-site-experience/scripts/stackprism-bridge.mjs`，读取 stdout 中唯一 ready JSON。
2. Agent 用 `apiToken` 调用 `POST /v1/captures` 创建采集任务。
3. bridge 打开 `/bridge?session=...&capture=...&nonce=...`。
4. `src/content/agent-bridge-client.ts` 只在 `http://127.0.0.1/*` 的 bridge 页面运行，读取 DOM config，向 background 发送 `AGENT_BRIDGE_HELLO`。
5. background 校验 `chrome.storage.local` 中的 `agentBridgeEnabled` 后，打开或复用目标 tab，运行技术识别和 experience profiler。
6. background 将 profile 分片发送回 bridge content script，content script 再同源 POST 给本地 bridge。
7. Agent 轮询 status，并在 completed 后用 `apiToken` 读取 profile。

## 用户门禁

`agentBridgeEnabled` 是本机浏览器 profile 级 opt-in，只从 `chrome.storage.local` 生效。即使旧 `chrome.storage.sync` 中存在同名字段，也不得自动开启 Agent Bridge。

发布到 Chrome Web Store 或 Edge Add-ons 前，默认值必须保持 `false`，除非维护者完成隐私披露、用户文档和发布说明更新。

## 信任边界

- 本版本信任用户或 Agent 启动的本机 bridge 进程。
- `127.0.0.1`、nonce、bridge 页面 meta 和 `bridgeToken` 只能绑定一次 capture，不能证明本机进程一定没有被同机恶意进程伪造。
- DOM 中的 `bridgeToken` 不是对同浏览器 profile 中其他扩展保密的秘密。
- 默认不采集 cookie、Authorization、localStorage/sessionStorage 明文、完整敏感 query 或页面全文。
- Agent Bridge 不是浏览器级 SSRF 防火墙。private-network 校验用于拒绝创建 capture、停止采集和阻止 profile 交付，不保证导航前零网络触达。

## 本地脚本

JavaScript bridge：

```bash
node agent-skill/stackprism-site-experience/scripts/stackprism-bridge.mjs
```

Python fallback：

```bash
python3 agent-skill/stackprism-site-experience/scripts/stackprism_bridge.py
```

Python fallback 基于标准库 HTTP server，定位是 Node 不可用时的兼容路径。长时间批量采集、重复压力测试或需要更可靠连接上限控制时优先使用 JavaScript bridge；如果 Python fallback 在本机连接堆积下超时，应停止子进程、重新启动 bridge 并重试，不复用半完成 capture。

测试环境可设置 `STACKPRISM_BRIDGE_NO_OPEN=1`，此时不会自动打开浏览器，但仍会返回 `bridgeUrl`。

Agent 只读取 stdout 的第一条 ready JSON line，并应在 10 秒内完成解析。超时按 `BRIDGE_START_TIMEOUT`，非 JSON stdout 按 `BRIDGE_READY_PARSE_FAILED`，`protocolVersion` 不匹配按 `BRIDGE_PROTOCOL_UNSUPPORTED` 处理；这些失败都必须停止 bridge 子进程并等待退出。

大型页面 profile 通过分片传回 bridge 页面。若采集中出现 `BRIDGE_TRANSPORT_DISCONNECTED`、`PROFILE_TRANSPORT_FAILED`、`PROFILE_CHUNK_MISSING` 或 `CAPTURE_TIMEOUT`，Agent 应将本次 capture 视为失败，停止当前 bridge 子进程后重启，并用更小的 `include` 范围或更低的 `maxResourceUrls` 重试一次；不得从部分分片拼出“降级成功”的 profile。

如果扩展安装在非默认浏览器或非默认用户 profile，设置 `STACKPRISM_BROWSER_OPEN_COMMAND` 指向对应 Chrome 内核浏览器可执行文件，并把 profile 参数放入 `STACKPRISM_BROWSER_OPEN_ARGS_JSON` 字符串数组。bridge URL 始终由脚本作为最后一个独立 argv 追加，不要写入环境变量或 shell 命令。

## 发布产物 Hygiene

`dist/` 只应包含扩展运行所需文件。发布前必须确认：

- `dist/manifest.json` 不包含 `externally_connectable`。
- `dist/` 不包含 `agent-skill/`、`docs/superpowers/`、`tests/`、Python 源文件、Python 字节码或本地 bridge server 源脚本。
- `experience-profiler.iife.js` 默认不放入 `web_accessible_resources`。

## 验证命令

```bash
pnpm run build:injected
pnpm run test:unit
pnpm run typecheck
pnpm run build
node --check agent-skill/stackprism-site-experience/scripts/stackprism-bridge.mjs
python3 -m py_compile agent-skill/stackprism-site-experience/scripts/stackprism_bridge.py
```
