---
layout: home

hero:
  name: StackPrism
  text: 网页技术线索查看器
  tagline: 打开扩展弹窗，查看当前页面暴露出的框架、CDN、CMS、统计、登录、支付和 SaaS 线索。每条结果都带证据和来源，便于判断是否可信。
  image:
    src: /icon.svg
    alt: StackPrism
  actions:
    - theme: brand
      text: 安装与启用
      link: /guide/install
    - theme: alt
      text: 当前 fork
      link: https://github.com/MisonL/stackprism
    - theme: alt
      text: 上游仓库
      link: https://github.com/setube/stackprism

features:
  - icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'/></svg>"
    title: 本地规则库
    details: 规则随扩展打包，页面 URL、资源、DOM、响应头和动态资源都在本机匹配，不需要账号或外部 API。
  - icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'/></svg>"
    title: 缓存优先的弹窗
    details: 后台先整理轻量结果。打开弹窗时优先显示缓存里的重点结果，原始 JSON 和技术链接按需加载。
  - icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z'/></svg>"
    title: 自定义规则
    details: 可以在设置页补自己的关键词、正则、CSS 选择器和全局变量规则，用来覆盖内置规则没有照顾到的站点。
  - icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'/></svg>"
    title: 结果可追溯
    details: 技术名、置信度、证据、来源放在同一张卡片里。需要排查误报时，可以直接展开对应来源的原始数据。
  - icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12.67 19a2 2 0 0 0 1.416-.586l6.13-6.13a4.992 4.992 0 0 0 .832-2.65V5l-3 1.5L17.97 5h-1.97a4.992 4.992 0 0 0-2.65.832l-6.13 6.13a2 2 0 0 0-.586 1.416v3.288c0 .53.211 1.04.586 1.415l1.456 1.456c.375.375.884.586 1.414.586h3.287Z'/><path d='M16 8 2 22'/><path d='M17.5 15H9'/></svg>"
    title: 可过滤输出
    details: 分类开关、禁用名单和重点视图可以减少噪音。完整数据仍保留在原始线索里，方便回看。
  - icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m18 16 4-4-4-4'/><path d='m6 8-4 4 4 4'/><path d='m14.5 4-5 16'/></svg>"
    title: 规则可审阅
    details: 内置规则按 JSON 文件分类维护。新增识别通常只需要补一条规则和几条能复现的证据。
---

## 这是什么

StackPrism 是一个 Chrome / Edge / Firefox 128+ MV3 扩展。它不“看穿”服务器内部，只整理浏览器能看到的线索：脚本和样式资源、DOM 标记、全局变量、响应头、动态加载的资源、WordPress 主题样式表等。

每条结果都会标注**置信度**、**证据**和**来源**。如果某个结果看起来不对，可以先看证据，再点来源展开对应的原始 JSON。

## 从哪里开始

- 第一次安装：看 [安装与启用](/guide/install.md)
- 看不懂结果：看 [结果解读](/guide/results.md)
- 想屏蔽噪音或补规则：看 [配置指南](/config/)
- 想改内置规则：看 [规则文件格式](/dev/rule-format.md) 和 [贡献规则](/dev/contribute-rules.md)

## 准确性边界

识别结果不是审计报告。站点如果隐藏响应头、把资源名全部 hash 化、SSR 后移除框架痕迹，插件就只能给出很少的结果，甚至没有结果。

这个项目的取舍是：尽量把判断依据放出来，让用户能知道“为什么识别成这样”。规则会持续补，但不会把低质量猜测包装成确定结论。
