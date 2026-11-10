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
- 当前版本：`0.5.0`（悬浮按钮贴边半隐藏、渲染分片让出事件循环）
- 当前 tag：`v0.5.0`（commit `542dc42`，发布 2026-11-10；release 资产与本地 `pnpm build` 产物字节一致）
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
  - 2026-11-10 已同步到 `Version 0.5.0`、459 KB；说明文字会比 release 晚一拍（平台侧缓存），要立刻刷新就在脚本页手动 Sync / Update description。

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
packages/userscript/src/ui/       Shadow DOM UI、InPageApp/Fab/PickerOverlay
packages/userscript/tests/        Vitest + jsdom 测试
playground/                       本地测试页与 GM stub（index.html 元素、region.html 区域截图）
scripts/serve-playground.mjs      本地 playground 服务器
```

截图核心链路：

```text
选择元素
→ getTargetBox()
→ expandForCapture() 展开滚动容器
→ 解析背景（纯色 / 复杂背景）
→ html-to-image 克隆并嵌入资源
→ SVG / XML 清理
→ canvas 转 PNG
→ 复制或保存
```

区域截图链路：

```text
拖拽出矩形
→ collectScrollSlices() 找出与选区相交的滚动容器（含容器内部的嵌套面板，深的在前）
→ 对每个容器：采集 sticky / 隐藏 fixed 后代 → 以其为根渲染「当前滚动视图」切片
              → blob 转 data URL → 作为该容器第一个 background 图层写回 + 隐藏子内容
→ 整页渲染一次（根节点只按窗口滚动做 relative 偏移）
→ planCrop() + cropBlob() 按矩形裁剪
→ 恢复所有内联样式
→ 复制或保存
```

`captureRegion()` 只有这一条渲染路径：没有 `scrollTop` 重放的备选实现。

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

### 悬浮按钮（FAB）

- 位置与贴边状态的几何计算在 `packages/userscript/src/ui/fab-position.ts`（纯函数，`tests/fab-position.test.ts` 覆盖），`shot-app.ts` 只负责读写设置，`Fab.vue` 只负责渲染。
- 两种静止状态：未贴边时保持 `FAB_MARGIN`(12px) 间距；贴边时**只在一条边上**贴合（`left/top` = 0 或 `viewport - size`），另一半靠 `transform: translateX/Y(±50%)` 甩到视口外，`opacity: 0.55`。不要允许同时贴两条边（角落会剩四分之一圆，既找不到也点不到）。
- 吸附距离 `DOCK_DISTANCE` 只有 10px（旧实现是 48px），所以「贴边」一定是刻意拖过去的；拖动过程中坐标允许到达 0 / `viewport - size`，否则永远拖不到边。
- 贴边轴固定，另一轴仍受 `FAB_MARGIN` 约束；`trigger.fabX/fabY` 存的是自由轴的 ratio，`trigger.fabDock`（隐藏的 `text` 字段，`''|left|right|top|bottom`）存贴边轴。「重置悬浮按钮」必须同时清空 `trigger.fabDock`。
- **hover 不能用 `pointerenter/pointerleave` 判断**：拖动时 `setPointerCapture` 会抑制 enter/leave，松手后按钮可能贴着光标却仍半隐藏，且光标不离开再回来就不会恢复。现在改成在 `window` 上监听 `pointermove`，用**静止（露出）矩形**做命中测试，并在 `pointerup` 里按松手位置刷新一次；`pointerout` 的 `relatedTarget === null` 用于光标离开窗口时复位。命中测试用露出矩形而不是当前视觉位置，才不会在滑动过程中来回抖动。
- `(hover: hover)` 为假的设备（触屏）直接不隐藏，否则只剩半个圆可点。
- 验证：`fabQuery` 读 `button.style.left/top` + computed `transform`/`opacity`，期望 `< 0px / -24 / 0.55`、`0px / none / 1` 两组；注意贴边后的 `getBoundingClientRect().x` 已经是 `-24`（含 transform），CDP 里要用可见半边的坐标去点。

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
