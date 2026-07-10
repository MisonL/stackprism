# 安装与启用

StackPrism 支持 Chrome / Edge 等 Chromium 内核浏览器，也支持 Firefox 128+。浏览器需要支持 Manifest V3。

::: tip 当前 fork 说明
商店版或不同 Release 是否包含 Agent Bridge，以对应版本为准。当前 fork 的源码构建版包含 Agent Bridge；repo-local skill 和 bridge helper 仍在仓库内运行，不随扩展安装。如果设置页没有 Agent Bridge 卡片，请从当前 fork 构建后加载。
:::

商店安装和 Release 方式使用的是上游公开发布资产，适合普通技术栈识别；不代表当前 fork 的 Agent Bridge 已随对应版本发布。当前 fork 尚无公开 Release 资产，需要 Agent Bridge 或 Firefox 本地验证时，请使用源码构建方式。若后续 fork 发布 Release，请以对应 release 页面说明为准。

## 方式一：从商店安装（Chrome / Edge）

1. Chrome 打开 [Chrome Web Store](https://chromewebstore.google.com/detail/stackprism/cagpdifljieeiajlhlcboelglkalofak)
2. Edge 打开 [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/stackprism/ojgmhlogaoiegdonnlnibeoikbleccno)
3. 点击浏览器页面里的安装按钮
4. 安装后刷新目标网页，再打开 StackPrism popup

::: tip
商店版是否包含 Agent Bridge，以对应商店版本和隐私披露状态为准。当前 fork 的 Agent Bridge 验证请使用源码构建方式。
:::

## 方式二：从 Release 下载 crx（Chrome / Edge）

1. 打开 [GitHub Releases](https://github.com/setube/stackprism/releases)
2. 选最新版本，下载 `stackprism-v{version}.crx`
3. 在浏览器地址栏输入 `chrome://extensions/`（Edge 是 `edge://extensions/`），开启右上角「开发者模式」
4. 把下载的 `.crx` 文件拖进扩展页面
5. 弹窗出现后确认「添加扩展」

::: tip
Chrome 有时会拦截 .crx 拖入安装（提示"无法添加来自此网站的应用、扩展程序和用户脚本"）。这种情况改用方式三：zip 解压加载。
:::

## 方式三：从 Release 下载 zip 解压加载（Chrome / Edge）

1. 打开 [GitHub Releases](https://github.com/setube/stackprism/releases)，下载 `stackprism-v{version}.zip`
2. 解压到一个稳定的目录（**别删，扩展运行依赖这个目录**）
3. 打开 `chrome://extensions/`（Edge 是 `edge://extensions/`），开启「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选中刚解压的目录

## 方式四：本地从源码构建

适合开发者、想使用当前 fork 最新能力，或需要 Agent Bridge 的用户。

```bash
git clone https://github.com/MisonL/stackprism.git
cd stackprism
pnpm install
pnpm run build            # Chrome / Edge -> dist/
pnpm run build:firefox    # Firefox -> dist-firefox/ 和 release/*.xpi
```

Chrome / Edge 构建产物在 `dist/`。在 `chrome://extensions/` 或 `edge://extensions/` 开发者模式下加载 `dist/` 目录即可。

当前 fork 文档不提供 Firefox Add-ons 商店入口。Firefox 128+ 开发验证优先打开 `about:debugging#/runtime/this-firefox`，选择「临时载入附加组件」，加载 `dist-firefox/manifest.json`。当前脚本默认写入上游 Firefox 扩展 ID，仅适合开发临时加载；fork 独立签名分发前需要维护者改成自己的 ID。`release/` 里的 `.xpi` 是打包产物；普通 Firefox 正式版永久安装仍以 Firefox Add-ons 签名或对应发布说明为准。

修改源码后，Chrome / Edge 重跑 `pnpm run build`，再到扩展管理页刷新扩展卡片即可。Firefox 需要重跑 `pnpm run build:firefox`，再到 `about:debugging#/runtime/this-firefox` 重新临时加载 `dist-firefox/manifest.json`。

Firefox 临时加载版当前没有写入 Firefox `browser_specific_settings.gecko.data_collection_permissions.optional` manifest 字段，Agent Bridge 运行时以设置页显式开启作为有效门禁。若后续正式 Firefox 版本完整声明 Agent Bridge 所需数据收集权限，浏览器可能还会要求额外同意；未同意时采集会被拒绝。

## 启用与权限

首次安装会请求以下权限。下表以当前 fork 源码构建版为准；商店版或上游 Release 的权限范围以对应安装包清单为准。

Manifest permissions：

| 权限            | 用途                                                          |
| --------------- | ------------------------------------------------------------- |
| `tabs`          | 读取当前标签页 URL / title                                    |
| `activeTab`     | 当前激活页面注入检测脚本                                      |
| `scripting`     | 注入 page-detector / page-source-search / experience-profiler |
| `storage`       | 存设置、缓存检测结果、主题偏好                                |
| `webRequest`    | 监听响应头收集 server / x-powered-by 等                       |
| `webNavigation` | 跟踪页面跳转、最终 URL 和检测生命周期                         |

Host permissions 与 content script 范围：

| 范围                                      | 用途                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| `<all_urls>` / `http://*/*` / `https://*/*` | 普通 http(s) 网页检测、响应头采集和脚本注入                 |
| `http://127.0.0.1/*`                      | 本机 bridge 页面的 host 权限，也是 Agent Bridge content script 匹配范围 |

检测过程不依赖外部 API：规则文件随扩展打包到本地，检测结果只在浏览器内存与扩展 storage 内流转。

注意：`http://127.0.0.1/*` 是扩展包声明的访问范围；Agent Bridge 功能本身默认关闭，只有在设置页显式启用后才接受本机 bridge 请求。

## 卸载

Chrome / Edge 在 `chrome://extensions/` 或 `edge://extensions/` 找到 StackPrism 后移除。Firefox 在 `about:addons` 移除正式安装版本；临时加载版本也可以在 `about:debugging#/runtime/this-firefox` 移除。
