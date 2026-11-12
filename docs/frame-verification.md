# iframe 通道的真实浏览器验证记录

按时间顺序追加。每次改帧渲染、帧选取或帧桥协议后，在这里补一段；`AGENTS.md` 只保留结论与素材索引。

## 验证手法

- `page.addInitScript` 把 `HTMLCanvasElement.prototype.toBlob` 包一层，按 realm 记调用次数（`window.__shotCount`，再用 `frame.contentWindow.__shotCount` 区分「帧自己渲染」和「父级渲染」）。注意 `native` 在 document-start 就快照了 `toBlob`，运行期再包原型统计不到。
- 想证明「帧自己渲染」时看帧内的计数；想证明「谁在跟谁说话」时在页面里挂 `message` 监听，记录 `protocol` 以 `element-screenshot` 开头的消息。
- Playwright 受控标签页常常是 `hidden`：`requestAnimationFrame` 不跑，而 picker 的 hover 是 rAF 节流的 → 先 `mouse.move`（同步更新 `picker.cursor`）再 `dispatchEvent(new Event('resize'))`（`handleResize()` 同步 `refresh()`）。
- 贴边的 FAB 用可见半边的坐标点；`elementsFromPoint()` 在滚动条区域返回空数组，点击要落在 `clientWidth` 内。

## 2026-11-11：首轮（同源/跨域出图、鉴权、展开、帧内快捷键、穿透选取）

- 同源 `#frame-demo`（`?vm=1`）：864×726、`ratio 2`，1.4 秒；父级 `toBlob` +1、帧内 1 → 走 helper；表头 `#eef2ff` 52,811 像素、下沿露出 `Frame row 02` 半行 → `scrollY = 60` 平移正确。跨域（4176 嵌 4177）：1040×682、1.5 秒、表头 65,835 像素 → 只有 helper 能做到；兜底（`about:blank` + `document.write`）帧内 0 次、父级 2 次、720×360 正常。
- 鉴权：页面伪造 `hello`/`render`（错 token 或空 token）→ 900ms 内无任何回复。截完页面和帧内都没有残留快照节点、iframe 行内样式未改、帧滚动仍是 60。
- 选中帧本身 = 展开：同源 + helper **788×2226**、跨域 + helper **964×2226**；同源兜底也一样。选中包含帧的祖先 **864×770**、帧只画 220px 视口、盒子没撑高。
- 帧内快捷键（`Alt+S`）：点进同源/跨域帧后按快捷键 → 顶层收到 `trigger`、选框出现，`document.activeElement` 始终是 `IFRAME`；方向键换层、`Esc` 关闭，页面 window keydown 监听一条都没收到。
- 穿透选取：悬停同源帧（394×220）→ 标签 `div.row帧内377 × 369/9`、可见框 `784.5,389.7 377×36`（帧在 783.5,300.7，1px 边框）；层级 1/9→9/9 = `html → body → main → section#frame-demo → iframe → html帧内 → body帧内 → div#frame-list 帧内 → div.row 帧内`。点它 → **754×72**、跨域帧同样 → **930×72**；无 helper 的帧悬停 ~120ms 退回 `iframe`，2 秒内重进命中缓存。

## 2026-11-12：token 泄漏修复、多层穿透、鼠标穿透下的帧内选取

环境：VM 里是当天构建（`562 KB`），`index.html?vm=1`，Playwright 受控标签页（`visibilityState === 'hidden'`，按上面的 resize 技巧取 hover）。

- **token 不再上行**：在页面里挂 `message` 监听后加载 `index.html?vm=1`，收到的三条 `subscribe` 都只有 `{protocol, type, nonce}`（`hasToken: false`）。修复前同一手法读到的是带 token 的 `subscribe`，并且能用它向跨域帧发 `hover`/`render`：拿到 5 层 DOM 结构和一张 12,561 字节的 PNG。现在同一条伪造路径在 `hello` 这一步就没有回复。
- **多层穿透（默认 2 层）**：`#split-frame-demo` → `frame-split.html` → `/frame.html`。悬停最内层行 → 标签 `div.row帧内343 × 36`、**12/12** 层（单层时是 9/9），说明外层帧的 helper 又把内层帧的栈并了回来。用合成 click 选中它 → 结果 **686×72**（343×36 @2x），说明 `capture` 的 `via` 两跳中继、以及内层帧自己渲染都成立。
- **鼠标穿透下的帧内选取**：临时把穿透开关读成 true（只改读取处，验证后已还原）。此时重叠层消失（`[data-element-screenshot-pick-surface]` 不存在），帧自己上报 `pointer`：
  - 悬停 `#frame-demo` 内部 → picker 得到 `div.row帧内377 × 36`、**9/9**，说明帧上报的坐标被换算、重放后 picker 正常解析；
  - 在帧的文档里派发 click → 帧把事件吞掉（`defaultPrevented: true`）并上报，顶层重放后开始渲染，结果 **754×72**（377×36 @2x）。
- 备注：`hidden` 标签页里真实的 `click`/`keydown` 到不了页面（合成事件可以），所以上面两处「点击」用的是文档内派发；这不是产品行为，验证可见标签页时应改回真实点击。

## 2026-11-12（第二轮）：帧桥全面密封（协议 `/7`）

环境：VM 里是当天构建（`610.10 kB`），`index.html?vm=1`，Playwright 受控标签页（`visibilityState === 'hidden'`，hover 仍用上一轮的 `mousemove` + `resize` 技巧）。页面里有四个帧实例：`/frame.html`（同源）、`4177/frame.html`（跨域）、`frame-split.html`、以及它内部的 `/frame.html`。

- **信封是页面能看到的全部**：在页面里挂 `message` 监听后完整跑一次拾取 + 整页截图，收到的每条消息都只有 `{protocol, type, box}` 三个键，`protocol` 全是 `element-screenshot:frame/7`；顶层窗口观察到的类型是 `subscribe` / `ready` / `stack` / `result`。没有任何业务字段、没有 token、没有快捷键字符串。
- **向上握手与应答都密封**：四个实例的 `subscribe` 都解开了（顶层记录下各自的 `sid`），随后同意下发的 `hotkey` / `ui` 被每个实例按 `to` 收下；`ui{active:true}` 在三层帧里都生效（含 `frame-split` 转发给它内部的帧）。
- **跨域与嵌套渲染**：整页截图时观察到 3 条 `ready`（同源、跨域、`frame-split`）+ 3 条 `render` / `result`；`frame-split` 内部的帧走它自己的父级，日志里表现为 `frame-split` 的 `sid` 发 `hello`、内层帧回 `ready`、再收 `render`——说明逐层中继在密封后仍然成立。
- **穿透选取**：悬停 `#frame-demo` 内部（`824, 298`），帧返回 `stack`，顶层 `readPickItems` 解析出 **4 层**（`html` / `body` / `#frame-list` / `div.row`），说明 `hover`/`stack` 的密封、`to`/`seq` 校验、坐标换算都正常。
- **伪造一律沉默**：从页面直接向同源帧发三种东西——`/7` 的 `hello`（随机 `box`）、`/6` 的 `hello`（带一个猜的 token）、`/7` 的 `measure`（随机 `box`）——2 秒内没有任何回复（顶层 `message` 监听与帧内监听都是空的）。
- **观察到的慢**：`hidden` 标签页里消息任务是排队的，`stack` 应答可能比 `hover` 晚数秒才到（同一次悬停的两条应答在后面的轮询里才出现）；因此**固定等 1–2 秒没看到回复，不能当作失败证据**，要么多等，要么看帧内/顶层的监听累计结果。整页 html-to-image 渲染在 `hidden` 下会被定时器节流拖到分钟级，与本次改动无关。
- **没在浏览器里验的**：帧内图层的 `capture`/`captured`（需要在帧图层上真实点一下；`hidden` 标签页的点击不可靠）。它和 `render`/`result` 走同一条应答路径（`postFrameReply` + 二进制尾巴），单元测试覆盖了两端。
