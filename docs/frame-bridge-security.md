# 跨帧消息的安全模型

这份文档记录 `core/frame-bridge.ts` 建立的 iframe 通道：它传什么、每一端校验什么、为什么这样设计，以及仍然存在的边界。改协议或加消息前先读它。

## 威胁模型

真正的对手是**页面自己的脚本**，不是另一个安装的脚本。

- 每个 iframe 里都跑着本脚本的一份实例（helper），它能渲染自己所在文档的像素。跨域帧的父页面读不到这份像素——这正是同源策略要挡的事。
- 所以攻击场景是：**A 站嵌入 B 站**，B 站里跑着 helper，A 想让 helper 把 B 的截图交出来。
- 页面脚本与 helper 共享同一个 `window`（脚本管理器给的是沙箱变量，但 DOM 窗口只有一个）。因此：**任何发给某个窗口的消息，那个窗口的页面脚本都能读到**；反过来，页面发到父窗口的消息，父窗口的脚本也能读到。

这条事实决定了整个设计：**能挡住页面的秘密只有一个方向**——页面读不到脚本管理器存储（`GM_getValue`），所以存在存储里的值可以是秘密，但只能在"不经过对方窗口"的前提下当秘密用。

## 通道与三条校验

1. **协议 + 类型 + 随机数**（`readFrameMessage`）：`protocol` 必须严格等于 `FRAME_PROTOCOL`，`type` 必须是已知消息，`nonce` 必须是非空字符串。页面随手 `postMessage` 的东西在这里就被丢掉了。
2. **来源窗口**（helper）：`event.source !== window.parent` 一律忽略。兄弟帧、`opener`、祖父窗口都进不来——这也意味着多层穿透必须逐层中继，而不是顶层直连深层帧。
3. **安装令牌**（token）：`GM_getValue('element-screenshot:frame-token')` 里的一把随机串，`document-start` 生成，所有帧和顶层共享。请求里带的 token 必须与本地一致。

另外每条**应答**都用 `nonce` + `event.source === 请求的那一帧` 双重比对（`waitForMessages` 的各个 handler），所以别的帧无法冒充应答。

## 传输方向与内容

| 消息 | 方向 | 携带 | 对方校验 |
| --- | --- | --- | --- |
| `hello` / `ready` | 父 → 帧 / 帧 → 父 | token | token |
| `measure` / `size` | 父 → 帧 / 帧 → 父 | 无 | token + nonce + source |
| `render` / `result` | 父 → 帧 / 帧 → 父 | 比例、深度、展开尺寸 / PNG | token + nonce + source |
| `hover{ x, y, depth }` / `stack{ items }` | 父 → 帧 / 帧 → 父 | 坐标、层数 / 标签、矩形、滚动轴、`via` 链 | token + nonce + source |
| `capture{ elementId, via }` / `captured` | 父 → 帧 / 帧 → 父 | 元素编号、路径、比例、背景 / PNG | token + nonce + source |
| `cancel` | 父 → 帧 | 无 | token |
| `ui{ active, passthrough }` | 父 → 帧 | 状态 | token + `source === parent` |
| `hotkey` | 父 → 帧 | 快捷键字符串 | token + `source === parent` |
| `subscribe` | 帧 → 父 | 无 | **无**（见下） |
| `trigger{ shortcut }` | 帧 → 父 | 快捷键字符串 | 与顶层当前设置比对 |
| `key{ key, 修饰键 }` | 帧 → 父 | 一个按键 + 修饰键 | 顶层用 `isPickerKey()` 白名单复核 |
| `pointer{ kind, x, y }` | 帧 → 父 | 帧内坐标 | 来源必须是本页直接嵌入的帧 |

## 令牌只在"向下"的方向上有效

`subscribe` / `trigger` / `key` / `pointer` 都**不带 token**，这是 2026-11-12 修掉的一个真漏洞：

- 帧加载时会向父窗口发 `subscribe` 请求快捷键。旧实现把 token 写在里面，于是**任何嵌入该帧的页面**只要监听 `message` 就能读到它——实测 `region.html` 的页面脚本读到了 `2bd04dd5-…`，接着用这把 token 对跨域帧发 `hover` 和 `render`，拿到了 5 层 DOM 结构和一张 12,561 字节的 PNG。也就是说，令牌检查形同虚设。
- 现在向下的消息仍然带 token（helper 需要它来拒绝陌生人），向上的消息一个字节都不带。
- 代价：向上的按键/指针无法再"证明自己是本安装"。帧最多能让选择器打开、或按一个选择器本来就认的键——这是骚扰，不是数据泄漏。另一个安装的帧发来的 `subscribe` 也会被回答，但它拿到的 `hotkey` 里带 token，而它自己校验的是另一把，所以不会生效。

## 仍然存在的边界（不打算修）

- **帧自己的页面能读到 token**：`hello` / `hover` / `render` 都送进帧的窗口。页面脚本因此可以冒充父级向**它自己**的 helper 要图——但那本来就是它自己的文档。它也能用同一把 token 向**它嵌入的**子帧要图，这算一个窄口子：需要攻击者页面本身是某个帧、并且嵌入了受害者页面。要彻底消除，只能让脚本运行在隔离世界（浏览器扩展 `content_scripts.world` 那种），用户脚本管理器给不了。
- **`stack` 会泄漏结构**：悬停应答里有标签（`div#id.class`，≤120 字符）和矩形。拿到 token 的一方能借此探测帧内 DOM 结构。同源策略保护的是像素和 DOM 读取，这里等于开了一个"结构可读"的口子——不泄漏文本内容，但泄漏标签/类名/尺寸。
- **没有重放保护**：`nonce` 只用于匹配本次应答，不拒绝重放。可以重放的一方只能重放给它自己的 helper，收益为零。
- **`postMessage` 用 `'*'`**：目标窗口是明确的（`frame.contentWindow` / `window.parent`），`'*'` 只是省掉算 origin；换来源只会把消息送给同一个窗口。真正要防的是读消息的人，那个 `targetOrigin` 帮不上忙。

## 验证手法

- 单元：`frame-bridge.test.ts`（协议、nonce、来源、`readVia`、指针换算）、`frame-helper.test.ts`（token、父窗口、busy、路径）、`hotkey-bridge.test.ts`（向上消息不带 token）、`frame-pointer.test.ts`（只在 `active && passthrough` 时上报）。
- 浏览器：在页面里 `addInitScript` 挂一个 `message` 监听，记录所有 `protocol` 以 `element-screenshot` 开头的消息——**修复后不应再出现 `token` 字段**；再用读到的 token 发 `hello` 应当得不到 `ready`。
