# Element Shot

对任意网页元素进行**完整滚动截图**的浏览器用户脚本。它用鼠标点选元素，自动展开元素内部被滚动裁掉的内容，再通过 [html-to-image](https://github.com/bubkoo/html-to-image) 渲染为 PNG；跨域图片、样式表与字体通过 `GM_xmlhttpRequest` 抓取并内联，从而绕过页面 CORS 限制。

[English documentation](README.en.md)

## 功能

- **元素选择器**：鼠标移动实时预选，滚轮或 `+` / `-` 在层叠元素之间切换；边框按元素完整滚动范围绘制，所见即所得。
- **完整滚动截图**：递归展开元素内部的可滚动子区域，截图包含全部内容；`Ctrl+A` 直接整页截图。
- **结果操作**：`Ctrl+C` 复制到剪贴板，`Ctrl+S` 或双击保存（优先文件选择器），`Esc` 退出。
- **悬浮按钮（FAB）**：点击触发截图，可拖动，靠近页面边缘自动吸附；可在设置中隐藏。
- **设置面板**：Tab + 折叠分组、搜索、快捷键录制、颜色/数值控件、站点加载策略、三语文案、深浅色主题。
- **独立设置库**：`@element-shot/settings` 可被其他用户脚本复用，提供 ESM、IIFE 与类型声明。
- **现代工程**：Vite + `vite-plugin-monkey` + Vue 3 + TypeScript + Tailwind CSS 4 + Vitest + ESLint + 语义化版本。

## 安装

先构建（见[开发](#开发)），然后在 Tampermonkey / Violentmonkey 中安装：

```text
packages/userscript/dist/element-shot.user.js
```

脚本申请了以下权限：

| 权限                                                  | 用途                       |
| ----------------------------------------------------- | -------------------------- |
| `GM_xmlhttpRequest` + `@connect *`                    | 跨域抓取图片、样式表、字体 |
| `GM_registerMenuCommand` / `GM_unregisterMenuCommand` | 脚本菜单                   |
| `GM_getValue` / `GM_setValue` / `GM_deleteValue`      | 保存设置与 FAB 位置        |
| `GM_info`                                             | 读取脚本版本               |

`@match *://*/*`、`@run-at document-idle`、`@noframes`。脚本只在本页执行，不上传任何数据。

## 使用

### 触发

- 点击页面边缘的相机悬浮按钮；
- 或按默认快捷键 `Alt+Shift+S`；
- 或使用脚本菜单「截图元素」。

快捷键可在设置中修改，修改后立即生效。

### 选择元素

| 操作                 | 效果                                     |
| -------------------- | ---------------------------------------- |
| 移动鼠标             | 预选鼠标下的元素，边框覆盖其完整滚动范围 |
| 滚轮向下 / `+` / `↓` | 选择更内层（更深）的元素                 |
| 滚轮向上 / `-` / `↑` | 选择外层元素                             |
| 单击 / `Enter`       | 确认当前预选元素，开始渲染               |
| `Ctrl+A` / `Cmd+A`   | 选择整个页面（滚动截图）                 |
| `Esc`                | 取消选择                                 |

选中后：

| 操作               | 效果                                  |
| ------------------ | ------------------------------------- |
| `Ctrl+C` / `Cmd+C` | 复制 PNG 到剪贴板                     |
| `Ctrl+S` / `Cmd+S` | 保存 PNG（优先 `showSaveFilePicker`） |
| 双击页面           | 保存 PNG                              |
| `Esc`              | 关闭选择器                            |

> 剪贴板与文件选择器都依赖浏览器能力：剪贴板需要安全上下文与图片写入权限；文件选择器仅 Chromium 支持，其他浏览器自动回退为下载。

### 设置

- 从脚本菜单「设置」打开。
- **触发快捷键**、**边框颜色/粗细**、**导出倍率**、**背景/透明背景**、**展开内部滚动区域**。
- **悬浮按钮**：显示/隐藏、尺寸、重置位置（拖动后的位置也会记住）。
- **站点策略**：仅在指定网站运行 / 不在指定网站运行。
- **界面语言**：简体中文、繁體中文、English；**主题**：自动 / 浅色 / 深色。
- 所有设置即时持久化到脚本管理器。

### 站点规则

每行一条，`#` 开头为注释：

| 规则                           | 匹配                   |
| ------------------------------ | ---------------------- |
| `example.com`                  | 该域名及其子域名       |
| `*.example.com`                | 仅子域名               |
| `https://*.example.com/docs/*` | 完整 URL glob          |
| `/docs/*`                      | 路径 glob              |
| `/^https:\/\/docs\./`          | 正则（作用于完整 URL） |

- 「仅在这些网站运行」留空表示全部网站；
- 「不在这些网站运行」优先于包含列表；
- 被排除的页面不会挂载 FAB 与选择器，但脚本菜单仍提供「在此站点启用」，点击后会移除当前页命中的排除规则并把域名加入包含列表。

## 开发

要求 Node.js >= 22.12、pnpm 10。

```bash
pnpm install
pnpm dev:settings     # 设置库演示页（Vite）
pnpm playground       # 用户脚本本地测试页 http://127.0.0.1:4176/
pnpm build            # 构建设置库（ESM + IIFE）与用户脚本
pnpm lint             # ESLint
pnpm typecheck        # vue-tsc
pnpm test             # Vitest
pnpm test:coverage    # 覆盖率
pnpm check            # lint + typecheck + coverage + build
```

构建产物：

- `packages/userscript/dist/element-shot.user.js`：用户脚本（含 `@grant` 头）
- `packages/userscript/dist/element-shot.meta.js`：轻量元数据（可用于更新检查）
- `packages/settings/dist/index.mjs` + `auto.mjs` + `*.d.ts`：设置库 ESM
- `packages/settings/dist/iife/userscript-settings.iife.js`：设置库 IIFE（内置 Vue 与样式）

本地测试页使用 `playground/gm-stub.js` 模拟 GM API，实际截图尺寸可通过页面内的 Canvas 钩子检查。

## 架构

```text
.
├─ packages/
│  ├─ settings/                 # 独立设置面板库
│  │  ├─ src/i18n.ts            # 轻量响应式 i18n，可注册新语言
│  │  ├─ src/settings.ts        # 声明式 schema + 动态增删改 + 持久化
│  │  ├─ src/components/        # Vue 3 + Tailwind 4，无组件库
│  │  ├─ src/auto.ts            # 自动注入样式的入口
│  │  └─ src/iife.ts            # IIFE 入口
│  └─ userscript/
│     ├─ src/plugin/            # 把 html-to-image 的 fetch/XHR 改写为 GM 适配器
│     ├─ src/net/               # GM_xmlhttpRequest → fetch / XHR 适配层
│     ├─ src/core/capture.ts    # 滚动展开、画布上限、渲染
│     ├─ src/core/picker.ts     # 层叠选择、滚轮/键盘、遮罩事件
│     ├─ src/ui/                # FAB、选框、Toast（Vue）
│     └─ src/main.ts            # 菜单、快捷键、站点策略、设置
├─ playground/                  # 本地验收页面与 GM 桩
└─ tests/                       # 跨包测试（emoji 策略等）
```

### 跨域 fetch/XHR 注入

`gmFetchPlugin()` 在 Vite 转换阶段解析 `html-to-image` 的模块，把全局 `fetch(...)` 与 `XMLHttpRequest` 引用替换为虚拟模块导出的适配器。适配器基于 `GM_xmlhttpRequest`，因此：

- 跨域图片/背景图可以读成 Blob 并内联为 data URL；
- `@font-face` 与跨域样式表同样可以抓取；
- Canvas 不会因为跨域资源而污染。

`main.ts` 与 `userscript` 侧的 `optimizeDeps.exclude` 保证开发模式也不会绕过该插件。

### 滚动截图

1. 读取元素 `getBoundingClientRect` 与 `scrollWidth/scrollHeight`，计算完整范围（含边框）；
2. 记录并临时展开目标及内部 `overflow: auto/scroll` 的子区域，重置滚动位置；
3. 按 canvas 上限计算导出倍率，调用 `toBlob`；
4. 在 `finally` 中逐项恢复原始 `style` 与滚动位置。

因此边框尺寸、渲染尺寸与最终 PNG 像素尺寸一致（导出倍率会乘上后者）。

### 设置库

```ts
import { createSettings } from '@element-shot/settings/auto'

const settings = createSettings({
  version: '1.0.0',
  tabs: [
    {
      id: 'capture',
      title: '截图',
      icon: 'camera',
      groups: [
        {
          id: 'basic',
          title: '基础',
          defaultOpen: true,
          fields: [
            { type: 'shortcut', key: 'shortcut', label: '快捷键', default: 'Alt+Shift+S' },
            { type: 'color', key: 'borderColor', label: '边框颜色', default: '#2563eb' }
          ]
        }
      ]
    }
  ]
})

settings.open()
```

详细 API（字段类型、动态注册、i18n、存储适配器、IIFE 用法）见 [`packages/settings/README.md`](packages/settings/README.md)。

## 已知限制

- **Closed Shadow DOM** 内部无法点选；Open Shadow DOM 可以穿透选择，但截图仍由 html-to-image 渲染，Shadow 内容可能缺失。
- 跨域 `iframe` 内部不可选；`<video>`、WebGL/Canvas 内容依赖其当前像素，可能为空白。
- 超大页面会按浏览器 canvas 上限自动降低导出倍率（`app.toast.downscaled` 提示）。
- 整页截图中的 `position: sticky/fixed` 元素由渲染器按视口处理，可能与逐屏拼接的结果不同。
- 跨域字体能否内联取决于脚本管理器与目标站的 CORS/响应；失败时会回退字体。
- 截图是本地行为，不联网上传；但为内联资源，脚本管理器会向资源原始地址发起请求。
- 文件选择器仅 Chromium；其他浏览器回退为普通下载。剪贴板写入需要浏览器权限。
- 当前只针对键鼠设计，触摸屏仅保证 FAB/设置面板可点按。

## 版本

当前 `0.1.0`。变更记录见 [CHANGELOG.md](CHANGELOG.md)。使用语义化版本，Git tag 形如 `v0.1.0`。

## 许可

[MIT](LICENSE)
