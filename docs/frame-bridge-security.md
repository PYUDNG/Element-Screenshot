# 跨帧消息的安全模型

这份文档记录 `core/frame-bridge.ts` 建立的 iframe 通道：它传什么、每一端校验什么、为什么这样设计，以及仍然存在的边界。改协议或加消息前先读它。

## 威胁模型

真正的对手是**页面自己的脚本**，不是另一个安装的脚本。

- 每个 iframe 里都跑着本脚本的一份实例（helper），它能渲染自己所在文档的像素。跨域帧的父页面读不到这份像素——这正是同源策略要挡的事。
- 所以攻击场景是：**A 站嵌入 B 站**，B 站里跑着 helper，A 想让 helper 把 B 的截图交出来；或者反过来，B 的页面脚本想借 helper 去截 A 嵌进来的东西。
- 页面脚本与 helper 共享同一个 `window`（脚本管理器给的是沙箱变量，但 DOM 窗口只有一个）。因此：**任何发给某个窗口的消息，那个窗口的页面脚本都能读到**；反过来，页面发到父窗口的消息，父窗口的脚本也能读到。

这条事实决定了整个设计：**能挡住页面的秘密只有一个方向**——页面读不到脚本管理器存储（`GM_getValue`）。旧模型（协议 `/6`）把那把秘密当作令牌放进消息里，于是它必须同时是「可验证的」和「不泄漏的」，而这两件事在共享窗口的前提下无法同时成立（见 `CHANGELOG` 0.9.0 段落与 2026-11-12 的验证记录）。现在的模型只让秘密**留在存储里**：消息本身加密，密钥一个字节都不上线。

## 通道：一个信封，一把密钥

```text
{ protocol: 'element-screenshot:frame/7', type, box: Uint8Array }
box   = nonce(24) ‖ ciphertext ‖ tag(16)          XChaCha20-Poly1305
plain = [u32 头长度][JSON 头][二进制尾巴]            PNG 走尾巴，不 base64
头    = { sid, to, seq, nonce, ...业务字段 }
```

- **密钥**：`GM_getValue('element-screenshot:frame-key')` 里的 32 字节 hex，`document-start` 生成，所有帧与顶层共享；经 `HKDF-SHA256(salt='element-screenshot:frame-key/1', info='aead')` 派生 AEAD 密钥。存储值不参与任何消息。
- **AAD** = `` `${protocol}|${type}|${direction}` ``。`type` 与方向是一张固定表（每种消息只有一个方向），所以一条 `hover` 的密文不可能被贴成 `stack` 应答，也不能被调转方向。
- **`type` 明文只用于路由**：接收方先按它选 handler / 选 AAD，解不开就当没收到。它是页面唯一能改的部分，改了也只会解不开。
- **会话**：每个 realm（顶层、每个帧）启动时 `sid = randomId(8)`；`hello`/`subscribe` 是仅有的两条允许 `to: ''` 的握手，其余消息必须 `to === 自己的 sid`。`seq` 是发送方自己的单调计数，接收方用 `ReplayGuard` 按 `(发送方 sid, type)` 记住，允许乱序（并行渲染）但有界。
- **应答匹配**：`nonce` 在密文头里，和 `event.source === 请求的那一帧` 一起校验。`seq` 只负责拒绝重放。

密钥、AAD、信封、重放守卫的实现与单测在 `core/frame-crypto.ts` 与 `tests/frame-crypto.test.ts`。

## 传输方向与内容

| 消息 | 方向 | 携带（全部在密文里） | 接收方校验 |
| --- | --- | --- | --- |
| `hello` / `ready` | 父 → 帧 / 帧 → 父 | 无 / 无（头的 `sid` 就是握手结果） | 解封 + `to`（握手可空）+ `seq` |
| `measure` / `size` | 父 → 帧 / 帧 → 父 | 无 / 宽高 | 解封 + `to` + `seq` + nonce + source |
| `render` / `result` | 父 → 帧 / 帧 → 父 | 比例、深度、展开尺寸 / PNG 字节 | 同上 |
| `hover{ x, y, depth, deadline }` / `stack{ items }` | 父 → 帧 / 帧 → 父 | 坐标、层数、截止时间 / 标签、矩形、滚动轴、`via` 链 | 同上 |
| `capture{ elementId, via, … }` / `captured` | 父 → 帧 / 帧 → 父 | 元素编号、路径、比例、背景 / PNG 字节 | 同上 |
| `cancel` | 父 → 帧 | 无 | 解封 + `to` + `seq` |
| `ui{ active, passthrough }` | 父 → 帧 | 状态 | 解封 + `to` + `seq` + `source === parent` |
| `hotkey{ shortcut }` | 父 → 帧 | 快捷键字符串 | 同上 |
| `subscribe` | 帧 → 父 | 无 | 解封 + `seq`（握手，`to` 可空） |
| `trigger{ shortcut }` | 帧 → 父 | 快捷键字符串 | 解封 + `to` + `seq`，再与顶层当前设置比对 |
| `key{ key, 修饰键 }` | 帧 → 父 | 一个按键 + 修饰键 | 解封 + `to` + `seq`，再用 `isPickerKey()` 白名单复核 |
| `pointer{ kind, x, y }` | 帧 → 父 | 帧内坐标 | 解封 + `to` + `seq`，且来源必须是本页直接嵌入的帧 |

帧内实例只接受 `event.source === window.parent` 的消息（helper、快捷键、穿透上报三处都查）；兄弟帧、`opener`、祖父窗口都进不来，所以多层穿透只能逐层中继。

## 页面看得到什么、做不到什么

| 页面能做 | 页面做不到 |
| --- | --- |
| 看到消息存在、大小、时序 | 读到任何业务字段（坐标、元素编号、DOM 栈、PNG、快捷键） |
| 丢弃 / 延迟消息（DoS） | 伪造请求（没有密钥） |
| 重放同一条密文 | 拿到可读数据（应答也是密文）；跨帧重放被 `to` 拒，同帧重放被 `seq` 拒 |
| 读到明文 `type` | 把一种消息的密文当另一种用（AAD 绑定） |
| 在自己的文档里合成按键 / 指针事件 | 取得密钥（只在管理器存储里，不上线） |

## 仍然存在的边界（不打算修）

- **元数据**：页面仍能数出「发生了几次通信、每次多大、什么时候」。要连这个都藏住，得先有一个不经过 `window` 的通道，用户脚本管理器给不了。
- **DoS**：页面可以不转发、延迟或反复触发自己文档里的事件。最坏结果是截图失败或选择器变慢，没有数据泄漏。
- **存储要被信任**：机器被攻破、管理器数据库被拷走，密钥就失去保密性。这不属于「页面脚本」威胁模型，但要写明。
- **混版本不互通**：`/7` 与 `/6` 的构建彼此静默（协议串不同，`readFrameEnvelope` 直接丢）。升级后要刷新所有标签页，旧帧不参与截图，安全方向是降级成「没有 helper」。
- **`postMessage` 用 `'*'`**：目标窗口是明确的（`frame.contentWindow` / `window.parent`），`'*'` 只是省掉算 origin。真正要防的是读消息的人，`targetOrigin` 帮不上忙。
- **帧自己的页面仍可骚扰**：它能合成自己文档里的键盘 / 指针事件，让 helper 上报一次按键或指针。那本来就是它的文档，且上报内容已加密、顶层还会按白名单复核。

## 验证手法

- 单元：`tests/frame-crypto.test.ts`（密封/解封、篡改、错密钥、错 AAD、截断、二进制尾巴、重放窗口），`tests/frame-bridge.test.ts`（信封形状、重放、`to` 不匹配、篡改、伪造、请求/应答全链路），`tests/frame-helper.test.ts` / `hotkey-bridge.test.ts` / `frame-pointer.test.ts`（各自的消息类型与来源校验）。
- 浏览器：在页面里挂 `message` 监听，记录所有 `protocol` 以 `element-screenshot` 开头的消息——应当只有 `{protocol, type, box}` 三个键；再向帧发一条自己拼的 `/7` 信封，应当得不到任何回复。2026-11-12 的实测记录见 `docs/frame-verification.md`。
