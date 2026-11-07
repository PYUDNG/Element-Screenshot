# AGENTS.md

给后续在本仓库工作的 Agent 的开发操作手册。开始改动前先读本文件。

## 项目概览

- 这是一个 pnpm workspace，目标是构建一个 Vue 3 + TypeScript + Tailwind CSS 4 的用户脚本：对任意网页元素做完整滚动截图。
- 用户脚本入口：`packages/userscript/src/main.ts`
- 设置库：`packages/settings`
- 构建产物：`packages/userscript/dist/element-shot.user.js`（`dist/` 被 git 忽略）
- 包管理器：pnpm 10；Node.js >= 22.12。

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
packages/userscript/src/net/      GM_xmlhttpRequest 适配
packages/userscript/src/plugin/   Vite 插件：注入 GM fetch/XHR 适配并 patch html-to-image
packages/userscript/src/ui/       Shadow DOM UI、InPageApp/Fab/PickerOverlay
packages/userscript/tests/        Vitest + jsdom 测试
playground/                       本地测试页与 GM stub
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
2. 用 Violentmonkey MCP 的 `scripts_list` 找 `Element Shot` 的 id。
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
- Greasyfork 中文：`greasyfork/README.md`
- Greasyfork English：`greasyfork/README_en.md`

Greasyfork 版本不要添加站外安装链接；Greasyfork 图片使用 `PYUDNG/Element-Screenshot` 的 raw 绝对地址；仓库迁移时同步更新。Greasyfork 的本地化说明由平台/同步工具按语言选择对应文件。

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

- 当前工作区可能保留用户未提交的 README 改写和 `assets/`；不要清理或提交它们。
- 用户会调整 DSH 的 MCP 策略；工具列表可能变化，执行前以本轮实际工具为准。
- 如果 MCP 工具不可用，先用 `mcp_scope list` 查看可见性；不要猜测工具仍存在。
- 完成较大任务后，在最终回复中说明：改动、测试结果、真实页面验证、版本/commit/tag、剩余限制。
