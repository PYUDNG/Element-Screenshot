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

### main 上的未发布改动（截至 2026-11-11，无 tag）

按顺序，都是 0.8.0 / 0.9.0 的组成部分，**尚未 bump 版本、未写 CHANGELOG**：

1. `77831ea` picker：实线/虚线双层框、`可滚动 ↓Npx` 徽标、`Shift+滚轮` 跳到滚动层、`scrollContainerInfo()` 统一判定；
2. `4bc826e` 展开语义：默认只展开根 + `fitBoxToLayout()` 重测画布 + 自定义元素 shadow 去重；
3. `8ad160d` playground：`#nested-demo` / `#frame-demo` 加 `align-self: start`；
4. `d491bc8` + `cbb0ad0` iframe：`FrameRecord` 记录、跳过快照自身 iframe、`/frame.html` 夹具与路由；
5. `38b1696` iframe 视口合成：`createSnapshot({ doc })`、帧视口出图写回帧盒子背景、帧内 sticky 钉住、递归深度 2、单帧失败降级；
6. `770e9be` 统一帧渲染：每个帧装 helper（`main.ts` 分流 + `frame-bridge`/`frame-helper`）、helper 优先 / 父级兜底、安装级 token 鉴权、去掉 `@noframes`、`app.ts` 拆分、`#cross-frame-demo` 夹具。

发版前需要：补 CHANGELOG（已开 `[Unreleased]` 段落）、README 的 iframe 说明、三个 `package.json` 版本号、真实页面回归。`FrameRecord` 的几何字段（`rect` / `radius`）已在 `38b1696` 里删掉，改成渲染时从 `copy` 量。

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
→ expandForCapture() 在副本里展开滚动容器（默认只展开根）
→ fitBoxToLayout() 按展开后的布局重新量根并撑到内容尺寸
→ computeCaptureScale() 用最终尺寸算比例（画布上限在这里生效）
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
  - iframe 只留一个同尺寸的空盒子（清掉 `src` / `srcdoc`，不重复请求），并把 `FrameRecord`（活元素、副本里的空盒、同源 `contentDocument`）记到 `snapshot.frames`；帧内容由渲染层单独出图、再写回那个空盒的 `background-image`，因为 html-to-image 克隆 `<iframe>` 时**不会带浏览上下文**。克隆时跳过带 `data-element-screenshot-snapshot` / `-ignore` 的节点，否则快照自己的离屏 iframe 会被拷进副本（它会作为 `<iframe>` 出现在 `snapshot.frames` 里）；
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

### 元素选择器（picker）

- 层级栈来自 `getElementStack()`（topmost first），`picker.refresh()` 会 `reverse()` 成「外层在前」，所以 `index 0` 是最外层、默认选中最内层。单元测试里 mock 的 `getElementStack` 必须按**topmost first** 给，否则断言会全部错位。
- 「可滚动」的判定统一在 `core/scroll-axis.ts` 的 `scrollContainerInfo()`：`overflow-x/y` 属于 `SCROLL_OVERFLOW`（`auto|scroll|overlay`）**且**该轴真的溢出 >1px。`overflow: hidden` 不算——它只是布局裁剪，用户没法滚过去看被裁的内容。picker 的徽标、`getTargetBox()` 的扩张、区域截图的切片收集都走同一个谓词，三处不能各写一套。历史坑：旧判定只看 `scrollHeight > clientHeight + 1`，30×30 的图标按钮因为行高多 1px 就被标成「含滚动内容」。
- 框分两层：**实线**是 `getVisibleBox()`（屏幕上看到的 border box，根元素是视口），**虚线**是 `getTargetBox()`（展开滚动内容后的截图尺寸）。两者不一致时才画虚线，否则看起来像重影。
- 徽标文案带轴向和数量（`可滚动 ↓2341px` / `→2400px` / `↕`），因为「这一层会不会变长、变多长」才是用户要判断的信息；单纯标「可滚动」和三格尺寸数字混在一起反而看不懂。
- `Shift+滚轮` / `Shift+↑↓` 由 `picker.cycleScroll()` 直接跳到上/下一个滚动容器。滚轮已经占用普通层级切换，用 Shift 区分；部分平台按住 Shift 会把纵向滚轮挪到 `deltaX`，所以方向取 `deltaY || deltaX`。
- **测试陷阱**：picker 的监听挂在 `window` 的捕获阶段，并且会 `stopImmediatePropagation`。一个用例如果在断言失败处抛错、没走到 `picker.stop()`，就会留下一个仍然 active 的实例吞掉后续用例的事件，表现成一串无关用例失败（实测：两个新用例断言写错，导致 4 个拖拽用例全挂）。改断言时先确认 `stop()` 一定会执行。

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

### 展开语义与画布尺寸（0.8.0）

- **默认只展开根**：`capture.expandNested` 默认 `false`。根自己的滚动内容永远展开（`getTargetBox()` 已经把 `max(rect, scrollHeight)` 当截图框）；开启设置后才会递归展开后代滚动容器。
- **画布跟着布局走**：`renderElement()` 的顺序必须是「展开 → 重新测量（`fitBoxToLayout()`）→ `computeCaptureScale()` → 渲染」。早期版本先算 `plan` 再展开，导致后代撑高的内容被裁掉（实测：选中包含 `#long-card` 的 `section`，盒高 398、内部展开到 934，输出仍是 398）。
- `fitBoxToLayout()` 用 `getTargetBox()` 重新量根；变高/变宽时**同时**给根写显式 `height/width`（`documentElement` 除外），否则根的背景和边框会在旧盒子处结束、内容溢出到画布外面。
- 展开是**重排**：展开后代等于替祖先重新排版，所以默认不做。嵌套展开仍然可能被中间的 `overflow: hidden` 面板裁掉——那不是 bug，是页面自己的裁剪（playground 的 `#pick-stage` 就是这种）。
- 自定义元素的坑：`cloneNode()` 会对克隆出来的自定义元素**跑构造函数**（jsdom 和 Chrome 都是），构造函数里 `attachShadow` + `insertRule` 会在未连接的克隆上抛 `Cannot read properties of null (reading 'insertRule')`，构造函数建出的 shadow 树还会和 `collectShadow()` 收集的内容**重复**。`attachDeferred()` 现在用 `root.replaceChildren(shadow.content)` 覆盖构造函数产物；playground 的 `<shadow-card>` 也加了 `sheet?.insertRule(...)` 兜底。
- 嵌套展开的开关**已由用户手动验证**：`#nested-demo` 关闭时 520×373 → 1040×746，打开后卡片被撑高、12 行全部出现。自动化里曾读到「设置面板是 true 但渲染收到 false」，那是 Playwright 合成点击/hover 的时序假象（`mouse.click` 会补发 `mousemove` 把键盘选中的层级重置回最深，且截图调用会打断 hover 栈），不是产品问题。
- playground 的 fixture 注意 `main` 是 grid：卡片默认会被同一行里 900px 的 `.tall` 撑高，所以 `#nested-demo` / `#frame-demo` 都必须写 `align-self: start`，否则「内部展开后变高」永远观察不到。

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

## iframe 视口合成（0.9.0，同源 + 跨域都已实现）

> 2026-11-10 用户拍板：**跨域也要做**，走「帧内 helper 渲染回传像素」，接受为此去掉 `@noframes`。
> 2026-11-11 用户确认：先做同源部分，跨域随后；帧内滚动沿用普通元素的规则（选中 iframe 本身 = 展开，选中祖先 = 只画当前视口）。
> 2026-11-11 用户拍板：**统一成 helper 优先、父级兜底**（方案 A），同源也走 helper，只为没有 helper 的帧保留父级渲染。

### 架构（一条渲染器，两种宿主）

`renderFrameViewport(doc, ratio, options, depth)` 是**唯一**的帧渲染实现，它只做「把某个 document 的当前视口画成 PNG」。跑在哪个 realm 都一样：

- **helper（首选）**：每个 iframe 里都有本脚本的一份实例（`main.ts` 检测 `window !== window.top` → 只装 helper，不挂 UI、不注册菜单、不建设置面板）。父级发 `postMessage` 请它渲染，它渲染完回传 PNG。跨域帧**只能**走这条；同源帧也走这条，因为帧自己的 realm 里 `getFontEmbedCSS` 读的是帧自己的样式表、`devicePixelRatio`/字体/`color-scheme` 也都是帧的。
- **父级兜底**：帧里没有 helper（`about:blank` / `srcdoc` / `data:` 帧、`sandbox` 没有 `allow-scripts`、或脚本还没加载完）时，只要 `frame.doc` 可读就用同一份实现本地渲染。跨域且没有 helper → 保持空盒。

### 桥协议（`core/frame-bridge.ts` + `core/frame-helper.ts`）

- `FRAME_PROTOCOL = 'element-screenshot:frame/1'`，消息 `hello/ready/render/result`，每条消息带 `nonce`；协议或版本不匹配一律忽略。改消息形状或渲染语义时**必须**升这个常量，否则新旧实例会互相误解。
- 探测：`probeFrameHelpers(frames)` 一次向所有帧发 `hello`，在**同一个 400ms 窗口**里收 `ready`，所以一页有 N 个没有 helper 的帧也只等一次；返回的集合里没有的帧就走兜底。
- 请求：`requestFrameImage(frame, { ratio, depth })` 发 `render`，等 `result`（默认 10 秒），期间每 100ms 检查 `native.capture.aborted`，用户取消时立即放弃等待。失败/超时/`busy`/`error` 都返回 `null` → 走兜底（可读时）或空盒。
- 顺序：`paintFrames()` 先 `probeFrameHelpers`，再逐帧 `requestFrameImage ?? renderFrameViewport(frame.doc, …)`，图写回副本 iframe 的 `background-image`（`origin: content-box`、`size: 100% 100%`），父级只渲染一次页面。
- 深度：`paintFrames(root, frames, ratio, options, depth)` 里 `depth > MAX_FRAME_DEPTH(2)` 直接返回；helper 收到 `depth` 原样转给 `renderFrameViewport`，所以「帧里的帧」最多两层，再深留空盒。
- 并发：helper 同时只渲染一个请求，第二个立刻回 `busy`；helper 会等 `DOMContentLoaded`（最多 5 秒）再开始，避免在解析中途拍照。
- **鉴权（别拆）**：helper 会渲染自己的页面，没有门槛的话任何站点都能嵌一个页面进来、用我们的 helper 截它的图（跨域像素外泄）。现在 `main.ts` 用 `GM_getValue/GM_setValue` 生成并共享一个安装级 token（`element-screenshot:frame-token`），helper 只接受 `event.source === window.parent` 且 token 匹配的请求。页面脚本读不到 userscript 存储，所以拿不到 token。两个不同安装（或 playground stub 与 VM）token 不同 → 互相不响应，这是**预期**行为。
- `setFrameToken()` / `getFrameToken()` 是模块级状态：`main.ts` 在两边的 realm 里都要先调用 `setFrameToken(ensureFrameToken())`；token 为空时桥整体沉默（探测返回空集、请求返回 null），安全降级。

### 已经做完（别再重复实现）

- `createSnapshot()` 支持 `doc` 选项：整条快照链路（`createFrame`、克隆、`copyStyleSheets`、`settle`、`restoreScroll`、`base`）都按传入的 document 工作，默认仍是顶层 `document`。帧副本的离屏 iframe 挂在**帧自己的 documentElement** 上，尺寸 = 帧的 `innerWidth × innerHeight`，所以媒体查询、`vw` 单位和滚动条都和帧一致。
- `FrameRecord` 只记三件事，几何在渲染时从副本量（展开后位置可能变化）：
  ```ts
  interface FrameRecord {
    live: HTMLIFrameElement
    copy: HTMLIFrameElement // 快照里的那个空盒子，用它判断「是否在渲染根内」和量尺寸
    doc: Document | null // 跨域为 null，需要 helper
  }
  ```
- `collectFrame()` 仍只清 `src` / `srcdoc`（不重复请求、不二次执行页面脚本），克隆时跳过带 `data-element-screenshot-snapshot` / `-ignore` 的节点。
- 渲染在 `capture.ts`：`renderFrameViewport()`（帧视口出图，**导出**给 helper 用）+ `paintFrames()`（探测 helper → 请求 → 写回背景）+ `pinFrameSticky()`。
- **帧图不走结果 canvas 合成，而是写回副本里那个空 iframe 的背景**（和区域截图的切片同一套思路）：`sliceBackgroundStyle(computed, { url, origin: 'content-box', size: '100% 100%' })`。好处是边框、圆角、`overflow` 裁剪、以及「压在 iframe 上的 sticky 表头/浮层」全部由父级那一次渲染按真实层叠顺序画，不存在「把帧图贴在最上层盖住别的东西」的问题。
- **必须钉住帧内 sticky**：克隆里没有滚动口，sticky 退化为 static；帧视口又是靠 `top: -scrollY` 平移出来的，文档顶部的 sticky 表头会直接跑到画布外消失（实测 `frame.html` 的表头会整条不见）。`pinFrameSticky()` 在**展开根之前**（副本还在帧的真实滚动位置时）量 `pinned - static` 差值，写成 `position: relative + top`，顺序不能颠倒——`expandForCapture()` 会把副本滚回 0。
- 帧渲染的根样式与区域截图一致：`position: relative; inset: auto; top: -scrollY; left: -scrollX; transform: none`（`transform` 会把 `fixed` 后代变成相对克隆根定位）；渲染面 = 帧的 `innerWidth × innerHeight`，`pixelRatio` 取父级 `plan.ratio`。
- 递归：`paintFrames()` 先给「帧里的帧」出图，深度上限 `MAX_FRAME_DEPTH = 2`，更深的留空盒；单帧失败只 `console.warn`，不影响整次截图；取消会向上抛。
- 字体：helper 渲染用帧自己的样式表（正确）；父级兜底时用 `sharedFontEmbedCSS()` 解析一次顶层页面的字体 CSS 并共享给页面渲染，帧独有字体在**兜底路径**上仍会回退。
- 测试：`snapshot.test.ts` 覆盖 `doc` 选项（副本挂在帧 documentElement、宽度 = 帧视口）、`FrameRecord.copy/doc`、跨域 `doc: null`、副本不留 `src` / `srcdoc`；`capture.test.ts` 的 `iframe compositing` 覆盖帧视口参数、背景层写法（`100% 100%` / `content-box`）、根外的帧不探测、跨域留空盒、零尺寸跳过、单帧失败不影响整次、字体 CSS 只解析一次、**helper 优先 / helper 沉默时回退**；`frame-bridge.test.ts` 覆盖协议校验、探测、请求、超时、取消、无 token 沉默；`frame-helper.test.ts` 覆盖 ready/render/result、错误回传、busy、等 DOMContentLoaded、非父窗口与非 token 请求被忽略。
- playground 夹具：`playground/frame.html`（自带样式、sticky 表头、30 行、初始 `scrollTo(0, 60)`）；`index.html` 的 `#frame-demo`（同源）与 `#cross-frame-demo`（`http://127.0.0.1:4177/frame.html`，跨域，需要 `PLAYGROUND_PORT=4177 pnpm playground`）；`scripts/serve-playground.mjs` 有 `/frame.html` 路由。

### 已验证（真实浏览器，VM 实例 + playground，2026-11-11）

验证手法：`page.addInitScript` 把 `HTMLCanvasElement.prototype.toBlob` 包一层统计每个 realm 的调用次数（`window.__shotCount`），再用 `frame.contentWindow.__shotCount` 区分「帧自己渲染」和「父级渲染」。

- 同源 `#frame-demo`（`?vm=1`）：864×726、`ratio 2`，1.4 秒；**父级计数器 +1、帧内计数器 = 1** → 走 helper；帧内 sticky 表头 `#eef2ff` 52,811 像素，表头下沿露出被它盖住的 `Frame row 02` 半行 → 帧自己的 `scrollY = 60` 平移正确。同源走父级兜底时输出完全一致（864×726、表头 52,811）。
- 帧圆角/边框：帧图四个角外侧是卡片底色（`255,255,255`），内缩 1px 起才是表头色；截 iframe 元素本身时 788×440、边框 `#d4d4d8` 都在。
- 跨域 `#cross-frame-demo`（顶层 4176、帧 4177）：1040×682（卡片 520×341 @2），1.5 秒；`topCalls = 1`、帧内容 65,835 像素（表头色）→ **只有 helper 能做到**（父级读不到 `contentDocument`）。
- 兜底：`about:blank` + `document.write` 的帧（VM 不注入）→ `frameCalls = 0`、`topCalls = 2`（帧 + 页面），内容与 sticky 表头正常（720×360，1.1 秒）。
- 鉴权：从页面直接 `postMessage` 伪造 `hello`/`render`（token 猜错、或 token 为空）→ 900ms 内没有任何回复；来源检查 + token 缺一不可。
- 截完活页面干净：页面和帧内都没有残留 `[data-element-screenshot-snapshot]`，iframe 行内样式/背景未改、帧滚动仍是 60。

### 下一步（按顺序）

1. **选中 iframe 本身 = 展开**：现在选中 iframe 是「它的视口」，按已定语义应该把帧文档当根整页展开，并让父级副本里的 iframe 盒子长高、父级重排（在副本里改 iframe 高度即可，别动活页面）。跨域时「帧内容有多高」要由 helper 回报（协议加字段），并且要处理「父级盒子长高后画布尺寸跟着变」。
2. **区域截图里的 iframe**：暂不处理，写进已知限制（`captureRegion()` 现在不读 `snapshot.frames`）。
3. **兜底路径的帧内字体**：给 `native` 加一个「字体源文档」钩子，把 `gm-fetch-plugin.ts` 里 `toArray(node.ownerDocument.styleSheets)` 的替换改成可切换的 document，让本地兜底渲染也能用帧自己的 `@font-face`（helper 路径已经正确）。
4. 分布式 picker（穿透任意 iframe）：有了 helper 通道后，picker 可以让帧内实例回报「指针下最内层元素」，再把整条层级栈拼起来（跨域只拿得到帧自身，除非 helper 回传标签）。
5. 多帧并行：现在 `paintFrames()` 串行请求，整页有 N 个帧就是 N 次串行渲染；帧之间互不依赖，可以并行发请求（注意 helper 是 busy 队列）。

### 关键约束（别踩）

- html-to-image 克隆 `<iframe>` 时**不带浏览上下文**：`cloneIFrameElement()` 会退化成「克隆 `contentDocument.body` 并把 iframe 的 computed style 扣到那个 `<body>` 上」。所以副本里的空 iframe 仍会保留正确尺寸/边框/圆角/背景——我们的帧图正是作为它的 `background-image` 画出来的。
- 帧渲染用的是**帧自己的文档**：背景、`color-scheme` 跟帧走；`getFontEmbedCSS` 在构建时被 patch 成读「当前 realm 的 `native.document`」，所以 helper（帧 realm）自动正确，父级兜底只能读顶层。
- 帧内滚动语义：**直接选中 iframe** 时它相当于「根」，可以按整页展开并让父级把盒子撑高；**选中包含 iframe 的祖先**时只画帧的当前可见视口（除非打开「展开内部滚动区域」）。
- 每个帧都是一次独立 html-to-image 渲染：整页截图里有 N 个帧就多 N 次渲染（实测小帧 1～1.5 秒/个）；没有 helper 的帧只多等一次 400ms 探测窗口。日志里出现 `[element-screenshot] frame render failed:` / `frame helper failed:` 表示该帧降级成空盒。
- 去掉了 `@noframes`：脚本会在**每个** iframe 里执行一遍（解析 520KB bundle、读一次 token），但帧实例不挂 UI、不注册菜单、不建设置，开销只在这个量级。不要给它加「顺手」的初始化逻辑。
- playground 的坑：`/frame.html` 只有在帧里也装了这个脚本时才有 helper。用 **VM 安装**（`?vm=1` 或不带参数都行，VM 会注入每个帧）时跨域那格也能出图；完全不装 VM 时 playground 的 stub 只注入顶层页面，`/frame.html` 没有实例 → 同源帧走兜底、跨域帧只能空白。

### 验证素材

- 同源：`http://127.0.0.1:4176/?vm=1` 的 `#frame-demo`。
- 跨域：先 `PLAYGROUND_PORT=4177 pnpm playground`，再访问 4176 页面的 `#cross-frame-demo`。
- 兜底：`about:blank` + `document.write` 的临时 iframe（VM 不注入这种帧）。
- 还缺：「帧内再嵌帧」的两层用例、「帧在可滚动祖先里、祖先展开后帧位置是否跟得上」的用例。

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
