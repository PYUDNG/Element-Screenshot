# AGENTS.md

给后续在本仓库工作的 Agent 的开发操作手册。开始改动前先读本文件。

## 项目概览

- 这是一个 pnpm workspace，目标是构建一个 Vue 3 + TypeScript + Tailwind CSS 4 的用户脚本：对任意网页元素做完整滚动截图。
- 用户脚本入口：`packages/userscript/src/main.ts`
- 设置库：`packages/settings`
- 构建产物：`packages/userscript/dist/script.user.js`（`dist/` 被 git 忽略）
- 包管理器：pnpm 10；Node.js >= 22.12。

## 当前发布状态（2026-11-10）

- 公开名称：**Element Screenshot**
- 仓库：<https://github.com/PYUDNG/Element-Screenshot>
- 当前版本：`0.7.1`（shadow root 内 `<style>` 的 CSSOM 重放）
- 当前 tag：`v0.7.1`（commit `417ad01`，发布 2026-11-10；release 资产与本地 `pnpm build` 产物字节一致，506,322 B，`sha256 EB839907…`）
- Release 资产：
  - `script.user.js`
  - `script.meta.js`
- 最新脚本直链：
  <https://github.com/PYUDNG/Element-Screenshot/releases/latest/download/script.user.js>
- Greasyfork 的 GitHub webhook 依赖 release 资产名 **`script.user.js`**，不要改回其他文件名。
- GitHub Actions：
  - push / PR 跑 `ci.yml`
  - push `v*` tag 跑 `release.yml`
  - release notes 从 `CHANGELOG.md` 对应版本段落提取
- Greasyfork README 直链：
  - `https://raw.githubusercontent.com/PYUDNG/Element-Screenshot/main/greasyfork/README_en.md`
  - `https://raw.githubusercontent.com/PYUDNG/Element-Screenshot/main/greasyfork/README_zh-CN.md`
  - `https://raw.githubusercontent.com/PYUDNG/Element-Screenshot/main/greasyfork/README_zh-TW.md`
- Greasyfork 脚本页：<https://greasyfork.org/scripts/604334>（GitHub README 的安装表格已指向它）
  - 2026-11-10 已同步到 `Version 0.7.1`、494.5 KB；平台侧会缓存页面内容，说明文字没跟上时在脚本页手动 Sync / Update description。

## 文档同步规则

每次重大更改或发版后，必须在同一轮对话中同步更新：

1. 本文件的「当前发布状态」和受影响的操作说明；
2. `CHANGELOG.md`，它同时是 Release notes 的来源；
3. `README.md` / `README.en.md` 中的安装链接、版本或功能描述；
4. 必要时同步 `greasyfork/README_zh-CN.md`、`README_zh-TW.md`、`README_en.md`；
5. 资产名、构建路径或 workflow 变化时，同步 `.github/workflows/`、`scripts/`、`playground/`。

如果上下文被压缩，先重新读本文件、`git status` 和 `git log`，不要依赖聊天记忆。

## 常用命令

```bash
pnpm install
pnpm dev:settings     # 设置库演示页
pnpm playground       # 用户脚本本地测试页 http://127.0.0.1:4176/
pnpm build            # 构建设置库（ESM + IIFE）和用户脚本
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check            # lint + typecheck + coverage + build，提交前必须通过
```

覆盖率阈值在 `vitest.config.ts`：lines 75、functions 80、branches 65、statements 75。

## 目录与职责

```text
packages/settings/                可复用设置库（schema、存储、快捷键、i18n、Vue 组件）
packages/userscript/src/main.ts   用户脚本入口
packages/userscript/src/core/     截图、选择器、背景、原生 API 快照、XML/SVG 清理
                                  区域截图：region.ts / scroll-slice.ts / crop.ts / canvas.ts
packages/userscript/src/net/      GM_xmlhttpRequest 适配
packages/userscript/src/plugin/   Vite 插件：注入 GM fetch/XHR 适配并 patch html-to-image
packages/userscript/src/ui/       Shadow DOM UI、InPageApp/Fab/PickerOverlay/ResultViewer
packages/userscript/tests/        Vitest + jsdom 测试
playground/                       本地测试页与 GM stub（index.html 元素、region.html 区域截图）
scripts/serve-playground.mjs      本地 playground 服务器
```

截图核心链路：

```text
选择元素
→ getTargetBox(活元素)  —— 选框尺寸，之后作为 options.box 传进渲染
→ createSnapshot() 把整页复制进离屏 iframe，并把目标元素映射到副本里
→ expandForCapture() 在副本里展开滚动容器（根节点尺寸用 options.box 冻结）
→ 解析背景（纯色 / 复杂背景，也在副本里渲染）
→ html-to-image 克隆副本子树并嵌入资源
→ SVG / XML 清理
→ canvas 转 PNG
→ 丢弃快照
→ 复制或保存
```

区域截图链路：

```text
拖拽出矩形
→ createSnapshot() 把整页复制进离屏 iframe
→ collectScrollSlices() 在副本里找出与选区相交的滚动容器（含容器内部的嵌套面板，深的在前）
→ 对每个容器：采集 sticky / 隐藏 fixed 后代 → 以其为根渲染「当前滚动视图」切片
              → blob 转 data URL → 作为该容器第一个 background 图层写回 + 隐藏子内容
→ 整页渲染一次（根节点只按窗口滚动做 relative 偏移）
→ planCrop() + cropBlob() 按矩形裁剪
→ 丢弃快照
→ 复制或保存
```

两条路径都只有这一条渲染路径：没有「在活页面上改样式再恢复」的备选实现。活页面全程只被读取，所以渲染期间用户可以继续操作，取消也能真正中断（副本直接丢掉即可）。

## 修改前约定

- 用户明确要求“先讨论”时，先说明方案和风险，不要直接改。
- 先看 `git status`。不要提交与当前任务无关的 README、assets、用户本地改动。
- 只 stage 本次改动涉及的文件，不要 `git add -A`。
- 修复跨站兼容问题前，尽量在真实页面复现；仓内测试通过不等于页面通过。
- 不要为了通过测试而放宽断言或删除覆盖真实行为的测试。

## 浏览器调试与 MCP

当前环境可能提供以下 MCP；以本轮实际工具列表为准：

- `context7`：查库文档。
- `playwright`：操作普通网页、执行 JS、截图、读控制台/网络。
- `violentmonkey`：直接管理已安装用户脚本。
- `js-reverse` / `rea`：可能被策略隐藏；不可用时不要调用。

### 推荐的脚本更新闭环

1. `pnpm build`
2. 用 `invoke_tool` 把构建产物直接写进 Violentmonkey，**不要**把源码当作参数自己发：

   ```json
   {
     "tool": "mcp__violentmonkey__scripts_write",
     "files": { "code": "packages/userscript/dist/script.user.js" },
     "args": { "id": 355, "enabled": true },
     "saveResultTo": ".playwright-mcp/vm-write-result.json"
   }
   ```

   构建产物约 470 KB，走 `scripts_write` 的 `code` 参数会把整份源码塞进对话上下文（十几万 token），`invoke_tool` 直接从文件读，不进上下文。返回值同样用 `saveResultTo` 落到文件，只回一个 preview。
   `scripts_get` 的结果会溢出到临时文件，需要核对内容时读那个 spill 文件，不要让整份源码进上下文。
3. 用 Playwright 重新导航/刷新目标页面，让 Violentmonkey 重新注入。
4. 用 Playwright 执行 DOM 检查、点击、截图、控制台验证。

`?vm=1`：playground 页面的这个参数会跳过注入 `dist/script.user.js`，只用 Violentmonkey 里那份。VM 里装了同名脚本时务必带上它，否则两份实例会同时挂 UI/抢事件。

Playwright 的 `page.addInitScript(() => { HTMLCanvasElement.prototype.toBlob = ... })` 能早于 VM 的快照生效，所以 `window.__lastShot` 在 VM 实例下同样可用，便于取出截图做像素比对。

`scripts_write` 不需要标签页授权。只有 `tabs_list`、`tab_scripts`、`tab_reload`、`script_logs` 需要用户在 Violentmonkey 中授权标签页；常规更新流程可以不用。

### Playwright 限制

- Playwright extension 模式可以连接正在运行的 Edge，并共享登录态；
- 它只能控制自己的受控标签页，通常不接管用户当前正在看的标签页；
- 它**不能操作 `extension://` / `chrome-extension://` 扩展页面**，导航会 detached；
- 截图文件只能写到 Playwright 允许的目录，通常是：
  - `C:\Users\InvFish\.dsh\profiles\desktop`
  - `C:\Users\InvFish\.dsh\profiles\desktop\.playwright-mcp`
- 不要把 Playwright 能打开扩展页面误认为能操作扩展页面。

### 旧的 CDP 方案

仅在 MCP 不可用时使用：

```powershell
msedge.exe `
  --headless=new `
  --remote-debugging-port=9222 `
  --user-data-dir=D:\bin\edge-profile-xhs `
  --no-first-run `
  --no-default-browser-check `
  --disable-gpu `
  --window-size=1400,1000 `
  about:blank
```

然后通过 `http://127.0.0.1:9222/json/list` 连接 page target，使用临时 CDP 脚本做导航、`Runtime.evaluate`、`Page.captureScreenshot`。注意：

- CDP 没有认证，能连上端口就能完全控制浏览器；
- 不要把日常主力 Profile 长期裸开调试端口；
- 更适合用专用自动化 Profile，并只绑定 `127.0.0.1`；
- 本机进程仍可访问 loopback 端口，防火墙不能真正隔离。

实测好用的几个细节（临时脚本放仓库外，例如 `%TEMP%\es-cdp\`，不要污染工作区）：

- 新开页面用 `PUT http://127.0.0.1:9222/json/new?<url>`，直接连返回的 `webSocketDebuggerUrl`；**不要**在 `/json/list` 里按 `type === 'page'` 取第一个，可能拿到扩展安装页。
- 输入用 `Input.dispatchMouseEvent`（`mousePressed` → 多次 `mouseMoved` + `buttons: 1` → `mouseReleased`），会正常产出 pointer 事件；`Emulation.setDeviceMetricsOverride` 先设成 1400×900 让坐标稳定。
- 新 profile 里没有 Violentmonkey，所以直接访问 `http://127.0.0.1:4176/region.html`（**不带** `?vm=1`），页面自己注入 `dist/script.user.js`；`pnpm build` 后重新导航即可换版本，也可以把不同构建产物互相覆盖到 `dist/` 做 A/B。
- 想要早于用户脚本的原生快照打点，用 `Page.addScriptToEvaluateOnNewDocument` 包一层 `HTMLCanvasElement.prototype.toBlob` / `CanvasRenderingContext2D.prototype.drawImage` / `XMLSerializer.prototype.serializeToString` / `window.encodeURIComponent`：快照会把这些包装函数当成「原生」实现，所以截图链路会走你的包装（页面里后来自己 hook 是无效的）。借此既能分阶段计时，也能在最后一帧 `toDataURL` 取出 PNG 做像素比对。
- 页面里的 GM 存储（playground stub）在 `localStorage` 的 `gm:*` 下，`window.__resetPlayground()` 会清空并 reload；`__resetPlayground` 之后要重新轮询 FAB 是否挂载。
- `Page.captureScreenshot` 带 `clip`（CSS 像素）可以只截某个小区域，便于直接看 FAB 的半隐藏状态。

## 发布流程

1. 修改代码并新增/更新测试。
2. `pnpm check` 全部通过。
3. 同步修改：
   - 根 `package.json`
   - `packages/settings/package.json`
   - `packages/userscript/package.json`
   - `CHANGELOG.md`
   - README 中若有版本号、安装链接或 Greasyfork 链接，一并同步
4. `pnpm build`。
5. 安装并做真实页面验证。
6. commit，使用 Conventional Commits；必要时打 tag `vX.Y.Z`。
7. 复杂高风险功能尽量单独 commit/tag，方便回滚。

不要提交 `dist/`、`coverage/`、`node_modules/`；它们已被忽略。

### README 版本

- GitHub 中文：`README.md`
- GitHub English：`README.en.md`
- Greasyfork 中文：`greasyfork/README_zh-CN.md`
- Greasyfork 繁體中文：`greasyfork/README_zh-TW.md`
- Greasyfork English：`greasyfork/README_en.md`

Greasyfork 版本不要添加站外安装链接；Greasyfork 图片使用 `PYUDNG/Element-Screenshot` 的 raw 绝对地址；仓库迁移时同步更新。Greasyfork 的本地化说明由平台/同步工具按语言选择对应文件。

### Greasyfork 构建

Greasyfork 要求非压缩代码，因此用户脚本构建保持 `minify: false`，并通过
`formatInlineCss()` 把 Tailwind 的内联 CSS 拆成可读的多行字符串。不要为了
减小体积重新开启 JS/CSS minify，否则上传会再次被拒绝。

## 已验证过的关键坑

### 背景取色

- 高元素中心点会被 clamp 到视口底部；
- `document.elementsFromPoint()` 可能不返回 `body`（body 盒高为 0，但背景仍绘制 canvas）；
- 不要从固定白色开始合成；先把 `html` / `body` 背景作为页面基础底色；
- 复杂背景会单独渲染隐藏背景层，再与元素截图合成；
- 目前复杂背景主要覆盖 `html` / `body` 的渐变和背景图，不包括所有 fixed/absolute 图层、伪元素、mask 等。

### SVG 与 CSS 变量

- SVG 的 `fill="var(--brand)"` 在克隆后可能丢失变量，回退为黑色；
- 截图前需要把 SVG paint 属性里的 `var()` 解析成 computed value，截完恢复；
- 相关实现：`packages/userscript/src/core/capture.ts` 的 `inlineSvgPaintVariables()`；
- 典型页面：DeepSeek 左上角 logo。

### 主线程渲染与分片让出

- 渲染不可能离开主线程：html-to-image 需要真实 DOM，克隆、`getComputedStyle`、样式内联都只能在页面线程做；不能指望 Worker（`new Worker(blob:)` 还受页面 CSP `worker-src` 限制）。
- html-to-image 的 `cloneNode` 用微任务链递归，整棵子树在一个任务里跑完 → 页面冻结到克隆结束。`vite` 插件里的 `patchCloneYield()` 在 `cloneNode` 入口插入 `await __elementScreenshotYield()`，按 **8ms 时间预算**（`CLONE_CHUNK_MS`）换让出：`native.yieldToMain()` 优先 `scheduler.yield()`，其次 `MessageChannel`（不受 timer 4ms clamp），最后 `setTimeout`。
- 预算按时间算而不是按节点数：单个节点可能极贵（巨大的内联 `style`、深子树）。
- 这类 patch 依赖 prelude 注入的 `__elementScreenshotNative`，所以和 `patchSvgSerialization` 一样只在 `nativeAdapter` 开启时加入；`patchCloneYield` 必须排在 `patchSvgSymbols` **之后**，否则它插在 `cloneNode` 前面的 helper 会被 `patchSvgSymbols` 的整段替换一起删掉。
- 实测（`playground/region.html`，3 面板 + 嵌套，1400×900）：最长阻塞任务 638ms → 223ms，长任务总时长 1257ms → 482ms，总耗时 1393ms → 1338ms（噪声内），裁剪出的 PNG 字节完全一致。
- 剩余的一次 200ms 级长任务来自「把数 MB 的 SVG data URL 交给浏览器解析」和「把切片 data URL 写进 `background-image` 内联样式」，都是单次调用，无法切片；要再降只能改成 blob URL 流，属于另一个量级的工作且有 CSP 风险。
- 分片让出意味着页面自己的任务有机会在截图过程中运行：截图期间页面样式是被临时改写过的（切片隐藏子内容等），这也是为什么不要顺手把让出点加得过于频繁。

### 离屏快照（`core/snapshot.ts`）

- 目的：html-to-image 从「要渲染的文档」读 computed style，而两条截图链路都必须临时改写页面（展开滚动容器、隐藏已画好的面板）。改活页面就等于把用户锁在外面，所以改成：把页面复制进一个**离屏 same-origin iframe**，之后所有改写都发生在副本上。活页面零改动 → 渲染期间可交互、取消可以真中断、没有「恢复样式」的失败模式。
- iframe 必须参与布局：`display:block; position:fixed; left:-(width+400)px; width:innerWidth; height:innerHeight`，用 `!important` 写，防止被页面 CSS（`iframe{display:none}`）破坏。`display:none` 会让所有测量为 0。
- 复制方式是**自己递归 clone**（不是 `cloneNode(true)`，也不是 `srcdoc`），这样才能：
  - 剥掉 `SCRIPT`/`NOSCRIPT`（`importNode` 过来的 `<script>` 一旦插入文档仍会执行，页面 JS 会跑第二遍）；
  - 把 `<canvas>` / `<video>` 换成同尺寸 `<img src=toDataURL()>`（DOM 克隆不携带位图，实测像素 `239,68,68,255` → `0,0,0,0`）；污染画布退回原元素（空盒子，尺寸仍对）；
  - 对 open shadow root 用 `attachShadow` + 克隆子节点重建（**不要**指望 declarative shadow DOM：`<template shadowrootmode>` 只在 HTML 解析器里生效，`appendChild` 不认）；
  - 同源 iframe 清掉 `src` 后把它的 `body` 内容克隆进去（跨域读不到就留空盒子，也不会再发一次请求）；
  - 回填 `scrollTop/scrollLeft`、`input/textarea/select` 的 value/checked/selected、以及窗口滚动；
  - 建 `<base href=页面 baseURI>`，让相对 URL、`@font-face` 和图片解析和页面一致；`document.adoptedStyleSheets` 也要导出成 `<style>`。
- 复制在**活文档**里建树，最后 `snapshotDoc.replaceChild(html, snapshotDoc.documentElement)`；现代 DOM 会把整棵子树 adopt 进目标文档且**保持节点 identity**，所以构建时记下的 `live → clone` 映射（`Map`）在插入后依然有效，目标元素、滚动偏移都靠它。
- `settle()` 等三件事：`<link rel=stylesheet>` 的 `link.sheet` 就绪（失败的 link 有 1.5s 上限，否则坏链接会吃掉整个预算）、`doc.images` 的 load/error、`doc.fonts.ready`；总预算 8s。**不要在 jsdom 用真实快照做管线测试**（没有 CSS 加载，会等满预算）：`capture.test.ts` 用 `vi.mock('../src/core/snapshot')` 把副本换成活文档。
- **字体必须先强制一次布局再等**：刚建好的 iframe 还没跑过 layout，`@font-face` 甚至还没发起请求，此时 `document.fonts.ready` 会立刻 resolve → 用回退字体度量去量元素（实测某站点文章高度差 14px、`scrollWidth` 差 10px）。现在 `settle()` 先读 `documentElement.clientHeight` 强制布局，再 `await fonts.ready`，然后循环到 `fonts.status === 'loaded'`（最多 4 次、总预算 3s）。
- **选框以活页面为准**：`captureElement` 的 `options.box` 由 `shot-app` 在点击时用活元素量好传入，`renderElement` 优先用它（副本自己再量一次只作为兜底，并且在两者不一致时 `console.info` 打出来）。否则「选择框显示的尺寸」和「截图尺寸」会对不上。
- **必须重放 CSSOM，不能只复制 `<style>` 文本**：页面用 `CSSStyleSheet.insertRule()` 加的规则只存在于 CSSOM，`<style>` 的文本里没有，`cloneNode` 会静默丢掉。实测 x.com：活页面 3724 条规则，朴素克隆只剩 2634 条，丢掉的正好包括 `.r-1c7gwzm { padding-left:16px }` 这类原子类 → 副本里 article 的 padding 变 0、内容贴边（尺寸还会因 `max(rect, scrollWidth)` 差 10px）。`copyStyleSheets()` 把每个 `<style>` 的 `sheet.cssRules` 序列化回副本，x.com 上副本与页面完全一致（`598×602`、`padding: 0 16px`、头像 `(16,12)`）。
- **shadow root 里的 `<style>` 走另一条路**：`Document.querySelectorAll('style')` 不穿透 shadow root，所以 `copyStyleSheets()` 管不到它。`collectShadow()` 在克隆子节点时用 `replayShadowStyle()` 把该 `<style>` 的 `sheet.cssRules` 写进副本（`<style>` 还没插入文档时写 `textContent` 是安全的，attach 后再解析），嵌套 shadow root 因为本来就是递归克隆所以自动覆盖。`sheetText()` 现在返回 `string | null`：`null` = 读不到（跨域），`''` = 读得到但确实没有规则——后者要写回去，否则页面用 `deleteRule()` 删掉的规则会留在副本里。
- **为什么 shadow 的 CSSOM 会影响到最终 PNG**：html-to-image 1.11.13 的 `cloneNode` 会把 open shadow root 的子节点**拍平成克隆的普通子节点**（`nativeNode.shadowRoot?.childNodes ?? childNodes`），所以 shadow 内容能出图；但它读的 computed style 来自**快照副本**，副本里 shadow `<style>` 的 CSSOM 错了，拍平后的内联样式就是错的。实测（`playground/` 的 `<shadow-card>` / `<nested-shadow-card>`，运行时 `insertRule` 注入 `padding: 16px 20px; background: #fef9c3`）：修复前同一张 1040×1800 截图里运行时背景 0 像素，修复后 385,960 像素（嵌套那层的绿色 `#dcfce7` 从 0 → 178,557）。
- 顺手加了 `reportCascadeMismatch()`：抓图后对比活元素与副本的 `box-sizing`/padding/border/字体度量，不一致就 `console.warn`（**只报告、不修补**，修补是治标）。
- iframe 挂在 `document.documentElement` 而不是 `body`：很多站点（X、各种浮层库）用 MutationObserver 盯着 body，插入子节点会触发整页重渲染。
- 取消：`native.capture.aborted` 由 `cancelCapture()` 置位，`patchCloneYield` 生成的 helper 在每个 chunk 检查并抛 `Capture cancelled`，异常一路冒到 `captureElement/captureRegion` 的 `finally` 里 `snapshot.dispose()`。所以取消只对「克隆循环进行中」有效，序列化/编码阶段只能丢弃结果（shot-app 用 token 兜底）。
- UI：渲染期间只渲染 `RenderingChip`（顶部小胶囊 + 取消）；结果由 `ResultViewer`（居中预览 + 底部操作栏）呈现，`PickerOverlay` 只在 `mode === 'picking'` 时渲染。交互守卫推迟到渲染结束（`finishRender()`）才安装，渲染期间只挂一个不吞事件的 Esc 监听。
- 实测（`playground/region.html`，3 面板 + 嵌套）：区域截图输出与「直接渲染活页面」的 0.5.0 **PNG 字节完全一致**（`sha256 cc3e7324…`，多次复现）；渲染中点击页面按钮新增 3 行，截图里没有这 3 行；渲染中面板的 `style`/`background-image`/子元素 `visibility` 全程未被改动。
- 代价：快照是整页副本（内存、首次布局约翻倍），大头是那一次性的构建 + 布局（小页面 ~80ms，大页面几百 ms，无法切片）；总耗时比 0.5.0 大约 +10%～70%（波动大，别用单次测量下结论）。

### 悬浮按钮（FAB）

- 位置与贴边状态的几何计算在 `packages/userscript/src/ui/fab-position.ts`（纯函数，`tests/fab-position.test.ts` 覆盖），`shot-app.ts` 只负责读写设置，`Fab.vue` 只负责渲染。
- 两种静止状态：未贴边时保持 `FAB_MARGIN`(12px) 间距；贴边时**只在一条边上**贴合（`left/top` = 0 或 `viewport - size`），另一半靠 `transform: translateX/Y(±50%)` 甩到视口外，`opacity: 0.55`。不要允许同时贴两条边（角落会剩四分之一圆，既找不到也点不到）。
- 吸附距离 `DOCK_DISTANCE` 只有 10px（旧实现是 48px），所以「贴边」一定是刻意拖过去的；拖动过程中坐标允许到达 0 / `viewport - size`，否则永远拖不到边。
- 贴边轴固定，另一轴仍受 `FAB_MARGIN` 约束；`trigger.fabX/fabY` 存的是自由轴的 ratio，`trigger.fabDock`（隐藏的 `text` 字段，`''|left|right|top|bottom`）存贴边轴。「重置悬浮按钮」必须同时清空 `trigger.fabDock`。
- **hover 不能用 `pointerenter/pointerleave` 判断**：拖动时 `setPointerCapture` 会抑制 enter/leave，松手后按钮可能贴着光标却仍半隐藏，且光标不离开再回来就不会恢复。现在改成在 `window` 上监听 `pointermove`，用**静止（露出）矩形**做命中测试，并在 `pointerup` 里按松手位置刷新一次；`pointerout` 的 `relatedTarget === null` 用于光标离开窗口时复位。命中测试用露出矩形而不是当前视觉位置，才不会在滑动过程中来回抖动。
- `(hover: hover)` 为假的设备（触屏）直接不隐藏，否则只剩半个圆可点。
- 验证：`fabQuery` 读 `button.style.left/top` + computed `transform`/`opacity`，期望 `< 0px / -24 / 0.55`、`0px / none / 1` 两组；注意贴边后的 `getBoundingClientRect().x` 已经是 `-24`（含 transform），CDP 里要用可见半边的坐标去点。

### 结果预览（`ResultViewer.vue`）

- 渲染结束后页面大概率已经被用户滚走或改过，**不要再把结果叠在原选框上**：`mode === 'selected'` 时只渲染 `ResultViewer`，`PickerOverlay` 仅在 `mode === 'picking'` 时存在。
- 预览用 `URL.createObjectURL(blob)`（存在 `state.previewUrl`），在 `reset()` / `clearSelection()` 里必须 `revokeObjectURL`，否则每次截图漏一个几十 MB 的 blob。
- 有站点的 CSP `img-src` 不含 `blob:`，预览会空。`<img @error>` 触发 `usePreviewFallback()`：用 `FileReader` 转 data URL 再塞回 `state.previewUrl`，并用 `previewFallback` 标志防死循环。实测 GitHub 允许 blob:，所以这条通常不触发。
- 预览层自己就能挡住鼠标（`pointer-events-auto` + 全屏 backdrop），但拦截滚动/快捷键仍靠 `finishRender()` 安装的交互守卫。**点遮罩不关闭**（渲染很贵，误触不该丢结果）：关闭只有右上角 44px 的 `×`、底栏「关闭」和守卫的 `Esc`。因此原先的「双击页面保存」已删除（模态层收不到页面的 dblclick），Ctrl+S / 保存按钮覆盖同一需求。
- 尺寸不再交给 CSS `max-h-full`：组件量取 stage 的 `clientWidth/Height`（`ResizeObserver` + `resize`）算出 `fitScale = min(1, stageW/natW, stageH/natH)`，再乘以 `zoom` 写成显式 `width/height`，所以 fit 状态下小图保持原始像素、不放大也不糊。图片必须 `shrink-0`，否则作为 flex 子项会被压缩回 stage 宽度、破坏缩放比例。
- 缩放：`zoom` 是相对 fit 的倍数（1 = 适应窗口，10 上限）。点击是在 1 和 `CLICK_ZOOM = 3` 之间切换（只有两个状态，所以步长要大）；滚轮用 `exp(-delta * 0.0012)` 连续步进并把单次因子夹在 `[0.8, 1.25]`，滚轮缩放以指针位置为锚点（把指针下的图内坐标换算成平移量），最小钳到 1（即适应窗口），回到 1 时平移归零。
- 键盘缩放：`+` / `=`、`-` / `_` 各按 `KEY_ZOOM = 1.25` 步进，`0` 回到 fit。监听挂在 `window` 的 capture 阶段（预览没有自带焦点元素），带 Ctrl / Meta / Alt 的组合一律放过（那是浏览器缩放），命中时 `preventDefault` + `stopImmediatePropagation`，否则按键会漏给页面。组件卸载时必须摘掉这个监听。
- 底栏顺序：左半边是尺寸 / 倍率徽标 / 就绪状态 / 快捷键提示，右半边是一个 `ml-auto` 的组，里面「提示文字 → 复制 / 保存 / 关闭」，所以按钮永远贴最右，提示在它左边；提示用 `whitespace-nowrap` 且 `lg` 以下隐藏，避免把按钮挤到第二行。
- 平移：图片上的 pointer 拖动直接改 `translate3d`，并按 stage 尺寸把位移钳在 `±(显示尺寸 - stage)/2`，所以图不会整个拖出可视区；拖动超过 3px 视为平移、抬手不再触发缩放切换（点击和拖动共用左键）。
- `<img>` 的鼠标滚轮和根节点的 `@wheel.prevent` 都要 `preventDefault`：交互守卫会放过 UI 事件，不拦的话滚轮会滚到底下的页面。透明截图垫棋盘格，否则透明区域在黑底上看不出边界。

### 设置面板的项目链接

- `createSettings({ links })` 接收 `{ id, label, href, icon }`，渲染在 footer 版本号后面，`target=_blank` + `rel="noopener noreferrer"`，`label` 同时用作 `title` 和 `aria-label`。
- 品牌图标在 `packages/settings/src/icons.ts`：GitHub 是 `createSolidIcon`（填充路径，stroke 关掉），Greasyfork 是描边的叉子+油滴。14px 下再细就糊，别再减小 `size`。
- URL 常量在 `packages/userscript/src/config/links.ts`；仓库或 Greasyfork ID 变化时只改这里。

### html-to-image / 浏览器 API

- 在 `document-start` 保存原生 API 快照，避免页面 hook 干扰截图；
- 后台/遮挡标签页不会执行 `requestAnimationFrame`，必须用定时器兜底；
- `<canvas>` / `<video>` 跨域会污染画布，`toDataURL` / `toBlob` 会抛 `SecurityError`；
- 图片加载失败不应中止整次截图，使用透明占位和错误处理器；
- `<noscript>` 在 SVG 图片文档中会显示 fallback 内容，必须排除；
- XML 1.0 非法字符、非法属性名、未绑定命名空间前缀都要清理。

### 元素裁剪

- 截图框是 border box，克隆根必须清除 `margin`；
- `inline` / `inline-*` 根会进入行盒，要改成对应的块级 display；
- 元素内部滚动容器需要在截图前展开，截完恢复。

### 克隆根的位置

- html-to-image 把克隆根直接放进 `<foreignObject>`，但会把元素自己的 computed 位置一起复制过去；
- 任何让元素在页面上发生位移的样式（`transform: translate(...)`、`translate`、`position: fixed/absolute` 的 inset）都会让整棵克隆在裁剪框里偏移，超出部分被裁掉；
- 居中弹窗是最常见的触发场景：小红书笔记详情 `#noteContainer` 用 `transform: translate(...) scale(1)` 定位，修复前整个评论区被切掉；
- 实现：`packages/userscript/src/core/capture.ts` 的 `rootPlacementStyle()`，只清除位置（`position` 改 `relative` + `inset: auto`、纯平移的 `transform` 改 `none`），保留尺寸与缩放；
- 判断“纯平移”用 `pureTranslation()`：只接受线性部分为单位矩阵的 `matrix` / `matrix3d`，带 `scale` / `rotate` / `skew` 的一律不动，因为缩放会改变裁剪框与视觉尺寸的对应关系；
- 调试这类问题直接读元素 computed `transform`：如果 `matrix(1, 0, 0, 1, tx, ty)` 的 `tx/ty` 与 `getBoundingClientRect()` 的 `left/top` 相同，就是这个坑。

### 区域截图（拖拽）

- 拖拽框选不是元素截图，模型是「渲染面 + 裁剪框」：`captureRegion(rect)` 渲染整个视口（`innerWidth × innerHeight`），再按 `rect` 裁剪；
- 克隆不携带 `scrollTop`，所以滚动必须被「重放」，做法是「每个滚动容器各自渲染一张切片」：
  - `collectScrollSlices()`（`core/scroll-slice.ts`）先找出所有与选区相交、且滚动量不为 0 的容器；容器内部还有滚动面板时也要收集（它同样会出现在父容器的切片里），并按文档顺序倒序处理，保证父容器渲染时子面板已经替换完成；
  - 每个容器**以自己为克隆根**渲染一张「当前滚动视图」：渲染面 = `clientWidth × clientHeight`（滚动口），根节点 `position: relative; top: -(scrollTop + borderTop); left: -(scrollLeft + borderLeft)`，这样内容坐标 `c` 正好落在 `padding + c - scroll`，裁剪面就是滚动口；不需要动任何后代，所以不会踩包含块、层叠顺序或裁剪的坑；
  - 切片里的边框要**去掉并把宽度并进 padding**（`border-width: 0` + `padding + border`），而不是只把颜色设成 transparent：透明边框仍然会画出下/右圆角的弧线（盒子比滚动口高，底边落在渲染面内，实测会留下青色弧线残影）。`border-radius` 也要清零，圆角交给页面渲染那一层；
  - 因为渲染面是滚动口而不是边框盒，`clientWidth` 已排除滚动条；内容宽度由显式 `width/height` 冻结，去掉 `overflow` 后不会重排；
  - 容器里的 `position: fixed` 后代在切片里坐标是错的（包含块变成 `foreignObject`），渲染切片前先 `visibility: hidden`，最后由整页渲染按视口坐标画一次；
  - `sticky` 元素照旧用 `position: relative` + 「屏幕 − 静态」偏移钉住，插值偏移对整体平移不敏感，所以单容器切片模型同样适用；
  - 切片转成 data URL 后，作为该容器**第一个 background 图层**写回（`background-origin: padding-box`、`background-size: clientWidth clientHeight`、`background-clip: border-box`），原有背景图层保留在后面，透明处露出容器自己的背景；
  - 然后隐藏容器的直接子元素（`visibility` 继承，所以只动一层）并加上 `scrollbar-width: none`（否则克隆会在滚动 0 的位置画一根假滚动条）；容器自身的边框、圆角、阴影由整页渲染照常绘制；
  - 直接写在容器里的文本节点用 `color: transparent` 隐藏，并把 computed 的 `border-*-color` 显式写回，避免 `currentColor` 边框一起变透明；
- 最后整页渲染一次，根节点只按**窗口滚动**做 `relative` 偏移（不再有 `Σ滚动容器`），再按 `rect` 裁剪；
- 字体 CSS 用 `getFontEmbedCSS()` 只解析一次，通过 `fontEmbedCSS` 传给所有切片和整页渲染，否则每次渲染都会重新遍历样式表，多面板时通常能省下数秒；
- 多面板的代价是「每个滚动容器一次渲染」：实测单面板约 5 秒，3 个面板 + 1 个嵌套面板约 10～15 秒（第一次渲染有数秒的一次性开销，之后每个容器约 1 秒；不同机器/页面波动不小）；测量耗时不要在页面里挂高频轮询 + 每次 `toBlob` 都做 `FileReader`，那会明显放大数字；
- 不要用 `transform` 做根偏移：它会让克隆根成为 `fixed` 后代的包含块，固定弹窗/浮层会跟着被移出画布；`relative` 不会；
- 渲染面必须等于视口而不是拖拽矩形：`position: fixed` 元素以 `foreignObject` 为包含块，只有渲染面=视口时它的坐标才和屏幕上一致；
- 裁剪用 `core/crop.ts` 的 `planCrop()` 把 CSS 像素映射到设备像素：只做一次 `round`，再夹到位图范围内；
- 交互：拖拽超过 4px 进入框选，区域小于 8×8 视为点击；`Esc` 先取消拖拽再退出；`window.blur` 取消拖拽；区域模式强制 `expandNested=false`（要的是所见即所得）；`suppressClick` 用来吃掉拖拽后浏览器补发的 `click`；
- 已知边界：只在视口内框选；iframe 内部不处理；容器自身的伪元素覆盖层会被切片和整页各画一次（位置差一个滚动量）；容器内 `mix-blend-mode` 与「包含块在容器外、逃出裁剪」的后代可能与实际有差异；
- 验证页：`playground/region.html`（三个独立面板 + 嵌套面板 + 渐变/圆角 + 面板内 fixed 元素 + 吸顶表头 + 页面滚动），`pnpm playground` 后访问 `http://127.0.0.1:4176/region.html`；页面把初始滚动位置写死，方便反复对比；
- 调试顺序：内容错位先核对「滚动口尺寸 + border 并入 padding + 根偏移 = 滚动量 + 边框」；边框/圆角残影先看是不是只清了颜色没清 `border-width`/`border-radius`；出现假滚动条先看 `scrollbar-width: none` 是否生效；样式没恢复先看 `replaceScrollContainer()` 的 `restore` 是否按逆序执行。

## 待办：iframe 支持（用户已定方向）

> 2026-11-10 用户拍板：**跨域要做**，走「帧内 helper 渲染回传像素」，接受为此去掉 `@noframes`；帧内滚动策略尚未定（见下）。
> 同期已完成：shadow root 内 `<style>` 的 CSSOM 重放（0.7.1，见「已验证过的关键坑 → 离屏快照」）。

### 已确认的现状（别再猜）

- `collectFrame()` 只处理**同源** iframe：清掉 `src` / `srcdoc` 后把 `contentDocument.body` 的子节点克隆进副本。**但这段克隆对最终 PNG 没有用**：html-to-image 的 `cloneNode` 对 `<iframe>` 只会克隆元素本身（子文档不在 DOM 树里），帧内容进不了 `<foreignObject>`。所以同源帧今天在截图里也是一个空盒子。
- 结论：iframe 支持不能用「把帧 DOM 塞进副本里的 iframe」这条路，必须**渲染成图再合成**：以 `<img>`（或包一层抄了 computed 边框/圆角/阴影的 wrapper）替换 iframe 元素。同源与跨域只在「谁来渲染」上不同——同源父实例自己渲染，跨域靠帧内 helper 回传 PNG。
- `@noframes: true` 现在写在 `packages/userscript/vite.config.ts` 的 monkey 配置里。要去掉它，并让帧内实例在入口最早期判定 `window.top !== window.self` → 只做 helper（不挂 FAB、不建 InlineApp、不装交互守卫），否则每个 iframe 都会冒出一个 FAB。
- 字体：html-to-image 的 `getWebFontCSS(node)` 用 `node.ownerDocument.styleSheets`，而我们的构建把它 patch 成了顶层 document（`gm-fetch-plugin.ts` 里 `toArray(node.ownerDocument.styleSheets)` → `toArray(__elementScreenshotNative.document.styleSheets)`）。所以「跨域 helper 渲染」是字体表现**最好**的路径（helper 的 `native.document` 就是那个帧的文档）；只有「把帧 DOM 拍平进父级」才有字体缺失问题——而那条路本来就不走。

### 要做的（按顺序）

1. **协议**：父实例克隆到 `<iframe>` 时替换成占位（记录 border box 尺寸），克隆结束后 `postMessage` 带 nonce 的请求给 `frame.contentWindow`（`targetOrigin: '*'`，因为不知道对方源），校验 `event.source === frame.contentWindow` + nonce；helper 回传 PNG blob（跨域 `postMessage` 可传 Blob，不必 base64）。
2. **helper 模式**：帧内实例不挂 UI，收到请求后用自己那份管线渲染「当前视口」（`innerWidth × innerHeight`，不改页面）并回传。忙 / 版本不匹配 / 超时都要回一个明确的失败，父实例降级成空盒子 + `console.info`，**绝不能让一个挂住的帧卡死整次截图**（单帧上限建议 4s，并计入总预算）。
3. **合成**：把占位换成 `<img>`，`width/height` = 帧的 border box，必要时 wrapper 抄 `border` / `border-radius` / `box-shadow` / `background`，`overflow: hidden` 裁剪。
4. **同源帧**：父实例自己渲染，避免多一次 IPC 与递归；两条路径共用同一个「占位 → 图片」结构。
5. **登录态/SPA**：helper 在自己文档里渲染，天然拿到登录态与脚本渲出的 DOM——这是选这条路的主要理由。
6. 递归深度上限（建议 2 层），防止跨域帧套跨域帧把时间乘爆。

### 尚未定的策略

- **帧内滚动**：只拍帧的可见视口（WYSIWYG，实现简单），还是让 helper 展开帧内滚动容器渲染到 `scrollHeight`（等于把区域截图那套切片机制搬进帧里，父实例还得把 iframe 布局盒撑高）？0.8.0 建议先只做可见视口，长截图记待办。
- 选择器是否进入同源 iframe 内部（跨域永远不可能，因为拿不到 DOM）。

### 验证

`playground/` 需要有：同源 iframe 页（含内部滚动与嵌套）、跨域 iframe（换一个端口起第二个 server）、以及一个「帧内再嵌跨域帧」的用例。逐个对比截图与页面。

## 验证建议

- 小改动至少跑 targeted Vitest + lint；提交前跑 `pnpm check`。
- 真实页面验证要检查：
  - 截图尺寸与选择框一致；
  - 背景颜色/渐变/图片没有丢失；
  - 文字、SVG logo、图标对比度正常；
  - 页面原样式在截图后已恢复；
  - 页面滚动位置没有被破坏。
- 涉及背景/克隆/原生 API 的改动，优先同时验证浅色和深色主题。

## 协作备注

- `assets/` 中的 README 截图已提交；后续新增截图时只 stage 本次新增文件。
- 先看 `git status`，不要把用户的本地实验文件一起提交。
- 用户会调整 DSH 的 MCP 策略；工具列表可能变化，执行前以本轮实际工具为准。
- 如果 MCP 工具不可用，先用 `mcp_scope list` 查看可见性；不要猜测工具仍存在。
- 完成较大任务后，在最终回复中说明：改动、测试结果、真实页面验证、版本/commit/tag、剩余限制。
