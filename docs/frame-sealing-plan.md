# 帧桥全面密封（已完成）

> 状态：**已完成**（2026-11-12）。实现细节与威胁模型在 `docs/frame-bridge-security.md`，真实浏览器证据在 `docs/frame-verification.md`。本文件只留施工记录，避免两份文档各说一半。

## 为什么要换

协议 `/6` 把「安装令牌」放在向下消息里。令牌只在向下方向带，所以嵌入方拿不到，但**帧自己的页面**能读到它，而令牌是长期凭据：页面可以存下来、转给第三方，或者之后嵌一个跨域页面 C 时拿出来用——「A 截获 token → A 嵌 C → 读 C 的像素」是一条真实可走的链路。换成密封后，页面拿到的永远是一次性密文，密钥从存储直接进 AEAD，**不上线**。

## 落地了什么

1. **stage 1（`da25f64`）**：`core/frame-crypto.ts` + `tests/frame-crypto.test.ts`（15 例）。
   - `createFrameKey()` / `isFrameKey()` / `deriveFrameKey()`：GM 里存 32 字节 hex；`HKDF-SHA256` 派生 AEAD 密钥。
   - `seal()` / `open()`：XChaCha20-Poly1305，box = `nonce(24) ‖ ciphertext ‖ tag`；失败一律 `null`。
   - `encodePayload()` / `decodePayload()`：`[u32 头长度][JSON 头][二进制尾巴]`，帧图走原始字节。
   - `randomId()`、`ReplayGuard`（按 `(发送方, 类型)`、允许乱序、有界）。
   - 依赖 `@noble/ciphers` / `@noble/hashes`：零依赖、同步、`http://` 页面也能跑。**不用 WebCrypto** 的原因：`crypto.subtle` 在非安全上下文不存在，一旦为它降级就出现两条模型。
2. **stage 2（本次）**：协议 `/7`，信封 `{protocol, type, box}`。
   - `core/frame-bridge.ts`：`FRAME_PROTOCOL = '…/7'`、`frameAad()`、`sealFrameMessage()` / `openFrameMessage()` / `decodeFrameEvent()`、`postFrameTo()` / `postFrameReply()`、每 realm 的 `sid` + `seq` + `peers` + `ReplayGuard`；`setFrameToken()` 换成 `setFrameKey()`；请求按 `to` 寻址，未知 peer 先 `hello` 握手。
   - `core/frame-helper.ts`：`reply()` 改成 `postFrameReply()`（PNG 走二进制尾巴）；`hello`/`hover`/`render`/`measure`/`capture` 从解密后的 `data` 读取；监听改为捕获阶段。
   - `core/hotkey-bridge.ts`、`core/frame-pointer.ts`：双向都走密封，`source` 检查保留。
   - `main.ts`：`ensureFrameKey()` 读写 `element-screenshot:frame-key`，并尽力 `GM_deleteValue('element-screenshot:frame-token')`。
   - 测试：`tests/frame-wire.ts` 用同一把测试密钥、独立发送方 `sid` 自己拼信封（不复用被测模块的写法），五个帧测试文件改成「解封后断言」。
3. **发版说明**：`/7` 与 `/6` 的构建**不互通**——旧构建的消息在 `readFrameEnvelope` 处被丢弃，表现为「帧没有 helper」，安全方向降级。升级后要刷新所有标签页。

## 结果

- 页面只能看到 `{protocol, type, box}`、大小与时序；读不到内容、伪造不了、重放被 `to`/`seq` 拒。
- 密钥不上线，仍只在管理器存储里；**存储本身要被信任**（机器被攻破、数据库被拷走不在页面威胁模型内）。
- bundle 从 `564.69 kB` 涨到 `610.10 kB`（gzip `127.41 → 139.59 kB`），即加密模块接入后的真实增量。
