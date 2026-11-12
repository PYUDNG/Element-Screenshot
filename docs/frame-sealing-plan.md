# 帧桥全面密封（进行中）

把 iframe 通道从「消息里带安装令牌」换成「整条消息体 AEAD 密封」。本文件是施工图：做完了哪一步、下一步动哪些文件、改的时候不能忘什么。改动落地后，把实现细节合进 `docs/frame-bridge-security.md`，本文件只留一个「已完成」的指针。

## 为什么要换

现模型（协议 `/6`）的令牌只在**向下**方向带，向上不带，所以嵌入方拿不到。但帧自己的页面能读到它，而令牌是**长期凭据**：页面可以存下来、转给第三方、或者在之后嵌一个跨域页面 C 时拿出来用——「A 截获 token → A 嵌 C → 读 C 的像素」是一条真实可走的链路。换成密封后，页面拿到的永远是一次性密文，密钥从存储直接进 AEAD，**不上线**。

## 已完成（stage 1，commit `da25f64`）

`packages/userscript/src/core/frame-crypto.ts` + `packages/userscript/tests/frame-crypto.test.ts`（15 例）：

- `createFrameKey()` / `isFrameKey()` / `deriveFrameKey()`：GM 里存 32 字节 hex；`HKDF-SHA256(ikm, salt='element-screenshot:frame-key/1', info='aead')` 派生 AEAD 密钥。
- `seal(key, aad, plain)` / `open(key, aad, box)`：XChaCha20-Poly1305，box = `nonce(24) ‖ ciphertext ‖ tag`；失败一律返回 `null`。
- `encodePayload(meta, binary)` / `decodePayload()`：`[u32 头长度][JSON 头][二进制尾巴]`，帧图走原始字节，不做 base64。
- `randomId()`：hex 随机串（会话 id / 帧跳编号）。
- `ReplayGuard`：按 `(发送方, 类型)` 记住 `seq`，允许乱序、容量有界。

依赖：`@noble/ciphers`、`@noble/hashes`（零依赖、同步、非安全上下文也能跑）。**选它而不是 WebCrypto 的原因**：`crypto.subtle` 在 http 页面不存在，一旦为它降级就出现两条模型。

模块目前**没有被任何入口引用**（tree-shaken），所以 bundle 仍是 564.69 kB。

## 待做（stage 2）：把 `/6` 换成密封信封 `/7`

### 信封

```ts
interface SealedEnvelope {
  protocol: 'element-screenshot:frame/7'
  /** 明文，只为路由；密文头里再校验一次同名字段 */
  type: FrameMessageType
  /** nonce ‖ ciphertext ‖ tag */
  box: Uint8Array
}
```

- 消息体（原来的业务字段）全部进 `meta`，`token` 字段**删除**。
- AAD = `` `${protocol}|${type}|${direction}` ``，direction 由 type 查表得出（每种消息只有一个方向）。
- 明文 `type` 只用来决定「用哪个 handler / 哪个 AAD 去解」，解不开就当没收到；不要在解密前信任它的内容。

### 会话与重放

- 每个端点（顶层、每个帧）启动时 `sid = randomId(8)`。
- `hello` / `ready` 的 `meta` 里带发送方 `sid`（接收方记下来）。
- 其余消息的 `meta` 带 `{ to: 接收方 sid, sid: 发送方 sid, seq }`；接收方校验 `to === 自己的 sid` 且 `ReplayGuard.accept(发送方 sid, type, seq)`。
- 握手类（`hello` / `ready` / `subscribe`）允许 `to: ''`，因为对方 sid 还不知道；其他类型 `to` 必须匹配。
- `seq` 是发送方自己的单调计数（每个 endpoint 一个，从 1 开始）。

### 文件与改动量

| 文件 | 改什么 |
| --- | --- |
| `core/frame-bridge.ts` | 协议常量 `/7`；`readFrameMessage` 改成「校验信封形状 + 解封 + 校验 meta」；16 个构造点改成 `seal()`；`waitForMessages` 在解密后按 `nonce`/`source` 匹配；`postFrameMessage` 接收 `Uint8Array` |
| `core/frame-helper.ts` | `reply()` 密封；`replyStack` / `capture` 的 `via` 中继带上 `to`/`seq`；`hello` 回 `ready` 时带自己的 `sid` |
| `core/hotkey-bridge.ts` | `subscribe` / `hotkey` / `trigger` / `ui` / `key` 全部走密封；双向都要记住对方 `sid` |
| `core/frame-pointer.ts` | `pointer` 上报密封；转发嵌套帧的上报时重新密封（`to` 换成父级 sid） |
| `main.ts` / `frame-bridge.ts` | `ensureFrameKey()`：读 `element-screenshot:frame-key`，不合法就生成并回读；`setFrameKey()` 取代 `setFrameToken()`；**删除**旧 `element-screenshot:frame-token` |
| `tests/frame-*.test.ts` | 测试辅助函数改成「用同一把测试 key 密封/解封」；原「错 token」用例改为「错 key / 篡改 box / 重放 seq / 错 `to`」 |

### 必须一起改的测试语义

- 原来的 `token` 断言全部删除（`hasToken` 之类的检查改成「信封里没有明文字段」）。
- 新增：明文 `type` 与密文 `meta.type` 不一致 → 丢弃；`to` 不匹配 → 丢弃；重复 `seq` → 丢弃；盒子截断 → 丢弃。
- 跨域链路（`#cross-frame-demo`）与两层帧（`#split-frame-demo`）必须重跑一遍出图验证。

### 迁移与兼容

- 新键名 `element-screenshot:frame-key`（hex）；旧的 `element-screenshot:frame-token` 在启动时尽力 `GM_deleteValue`。
- 协议 `/7` 与 `/6` 构建**不互通**：旧构建的消息在 `readFrameMessage` 处被丢弃，表现为「帧没有 helper」，安全降级。发版说明里要写清楚「升级后请刷新所有标签页，混版本期间旧帧不参与截图」。
- 不需要设置迁移：`frame-key` 不在设置信封里，也没有旧格式需要读。

## 落地后应当成立的性质

| 页面能做 | 页面做不到 |
| --- | --- |
| 看到消息存在、大小、时序 | 读到任何业务字段（坐标、元素编号、DOM 栈、PNG） |
| 丢弃/延迟消息（DoS） | 伪造请求（没有密钥） |
| 重放同一条密文 | 拿到可读数据（应答也是密文）；跨帧重放被 `to` 拒，同帧重放被 `seq` 拒 |
| 读到明文 `type` | 把一种消息的密文当另一种用（AAD 绑定） |
| —— | 取得密钥（只在 GM 存储，不上线） |

模型之外的前提：**存储要被信任**。机器被攻破、管理器数据库被拷走，密钥就失去保密性——不属于「页面脚本」威胁模型，但文档要写明。

## 验证清单（做完 stage 2 后）

1. `pnpm check`（37+ 测试文件全绿，覆盖率不低于当前 85.69 / 74.47 / 89.42 / 89.42）。
2. `pnpm build` 记录 bundle 大小（加密模块接入后的真实增量）。
3. 浏览器：`index.html?vm=1` 的 `#frame-demo`（同源）、`#cross-frame-demo`（4177 跨域）、`#split-frame-demo`（两层）各截一次，确认走 helper、尺寸正确。
4. 穿透：悬停帧内行 → `帧内` 栈正常；穿透开启时 `pointer` 上报 → 点击出图。
5. 安全回归：页面里挂 `message` 监听，确认收到的只有 `{protocol, type, box}`，没有任何业务字段；用页面自己伪造一条 `/7` 信封（随便填 box）确认 helper 沉默。
6. 把结果追加到 `docs/frame-verification.md`，并把本文件的实现细节并入 `docs/frame-bridge-security.md`。

## 注意

- 别在 `readFrameMessage` 里做解密：它是同步的路由层；解密放在各 handler 入口，解密失败就直接返回（不要打日志，避免给页面一个探测信号）。
- 帧图片不要转 base64；`encodePayload` 的二进制尾巴 + `Uint8Array` 直接 `postMessage` 即可（结构化克隆）。
- 一次截图可能同时有多条在途消息（并行渲染），所以 `ReplayGuard` 必须容忍乱序，不能只记最大值。
- `pointer` 消息量大（每次 mousemove 一条）：加密是同步的、XChaCha 很快，但别在密封前做 `JSON.stringify` 大对象；`pointer` 的 meta 只有几个数字。
