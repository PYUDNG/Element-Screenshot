# AGENTS.md

给后续在本仓库工作的 Agent 的开发操作手册。开始改动前先读本文件。

## 项目概览

- 这是一个 pnpm workspace，目标是构建一个 Vue 3 + TypeScript + Tailwind CSS 4 的用户脚本：对任意网页元素做完整滚动截图。
- 用户脚本入口：`packages/userscript/src/main.ts`
- 设置库：`packages/settings`
- 构建产物：`packages/userscript/dist/script.user.js`（`dist/` 被 git 忽略）
- 包管理器：pnpm 10；Node.js >= 22.12。

## 当前发布状态（2026-11-08）

- 公开名称：**Element Screenshot**
- 仓库：<https://github.com/PYUDNG/Element-Screenshot>
- 当前版本：`0.3.3`
- 当前 tag：`v0.3.3`（具体 commit 以 `git log --oneline --decorate -5` 为准）
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
- Greasyfork 脚本页尚未写入 GitHub README 的安装表格；发布后把「即将上线」替换成实际脚本链接。

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
                                  区域截图：region.ts / scroll-replay.ts / crop.ts / canvas.ts
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
→ collectScrollReplay() 采样滚动链 / sticky（采集即快照）
→ 根节点按 窗口滚动 + Σ滚动容器 做 relative 偏移
→ applyScrollReplay() 去掉裁剪 + 钉住 sticky
→ html-to-image 渲染整个视口
→ planCrop() + cropBlob() 按矩形裁剪
→ 复制或保存
```

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
2. 用 Violentmonkey MCP 的 `scripts_list` 找 `Element Screenshot` 的 id。
3. `scripts_write` 写入完整构建产物，保留 `id`，源码必须包含完整 `==UserScript==` 元数据。
4. 用 Playwright 重新导航/刷新目标页面，让 Violentmonkey 重新注入。
5. 用 Playwright 执行 DOM 检查、点击、截图、控制台验证。

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

- 拖拽框选不是元素截图，模型是「渲染面 + 裁剪框」：`captureRegion(rect)` 以 `documentElement` 为根渲染整个视口（`innerWidth × innerHeight`），再按 `rect` 裁剪；
- html-to-image 不携带 `scrollTop`，所以必须把滚动「重放」：
  - 窗口滚动：克隆根加 `position: relative; top: -window.scrollY; left: -window.scrollX`；
  - 内部滚动容器：收集区域所在的滚动祖先链（`core/scroll-replay.ts`），临时 `overflow: visible` 去掉裁剪，把各层 `scrollTop/scrollLeft` **求和**后一起并入根偏移；
  - 光去裁剪不够：滚动容器的背景只画在自己的盒子上，根偏移会把盒子一起移走，裁剪区就会露出页面底色；所以还要把 `height` 临时撑到 `scrollHeight`（撑高后盒子位置若变化就回退，宁可缺背景也不能让内容错位）；
  - 因为根偏移和裁剪用的是同一组坐标，裁剪框始终等于 `rect`，不会随滚动量漂移；
- 不要用 `transform` 做根偏移：它会让克隆根成为 `fixed` 后代的包含块，固定弹窗/浮层会跟着被移出画布；`relative` 不会；
- 渲染面必须等于视口而不是拖拽矩形：`position: fixed` 元素以 `foreignObject` 为包含块，只有渲染面=视口时它的坐标才和屏幕上一致；
- `sticky` 元素要临时改成 `position: relative` 并加「当前屏幕位置 − 静态位置」的偏移钉住；不要改成 `fixed`，那会脱离文档流、让后面的内容整体上移，裁剪坐标全错；
- 裁剪用 `core/crop.ts` 的 `planCrop()` 把 CSS 像素映射到设备像素：只做一次 `round`，再夹到位图范围内；
- 交互：拖拽超过 4px 进入框选，区域小于 8×8 视为点击；`Esc` 先取消拖拽再退出；`window.blur` 取消拖拽；区域模式强制 `expandNested=false`（要的是所见即所得）；`suppressClick` 用来吃掉拖拽后浏览器补发的 `click`；
- 已知边界：只在视口内框选；区域覆盖多个独立滚动面板时只重放主链（中心 + 四角采样中滚动量最大的那条）；iframe 内部不处理；
- 验证页：`playground/region.html`（内部滚动面板 + 吸顶表头 + fixed 工具条），`pnpm playground` 后访问 `http://127.0.0.1:4176/region.html`；
- 调试顺序：渲染卡住先看 `applyScrollReplay()` 的 DOM 预处理；内容整体偏移先核对「窗口滚动 + Σ滚动容器」，再核对 sticky 的「屏幕 − 静态」偏移。

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
