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

## 2026-11-12（第三轮）：渲染层数跟随「帧层级」

环境：`pnpm build`（`610.99 kB`），`index.html` 不装 VM、由页面自己注入构建产物（stub 的 `GM_*` 走 `localStorage`），这样才改得动设置；新夹具 `#deep-frame-demo` → `/frame-deep.html` → `/frame-split.html` → `/frame.html`（三层帧）。

- **设置走真实 UI**：用 stub 的 `__menuCommands` 打开设置面板 →「截图」→ 把「帧层级」从默认的 `2 层` 改成 `3 层`，`localStorage` 里的 `element-screenshot:settings` 立刻变成 `"picker.frameDepth":"3"`；界面上新文案（「选择器最多能钻进几层 iframe，截图时也按这个层数渲染帧里的帧」）正常显示。验完把这条值删掉，恢复默认。
- **三层帧，层数 2**：选中 `#deep-frame-demo`（520×563 CSS，`ratio 2` → **1040×1126**），最里层那一格是白盒；截图中 `frame.html` 表头色 `#eef2ff` 的像素数 **16**（抗锯齿噪声级）。
- **三层帧，层数 3**：同样的选区、同样的 **1040×1126**，最里层出现 `Inside the frame — this header is sticky` 表头和 `Frame row 03…07`；`#eef2ff` 像素数 **56,277**。行号从 03 开始、表头被钉在顶部，说明最内层帧自己的 `scrollTo(0, 60)` 和 `pinFrameSticky()` 也一起生效了。
- 两次截图只有最内层不同，其余（两层外框、圆角、留白）逐像素一致，说明差异确实来自层数而不是布局抖动。
- **没在浏览器里验的**：这次的帧里没有脚本（没有 helper），走的是父级兜底 `renderFrameViewport()`；helper 路径传 `maxDepth` 只做了单元测试覆盖（`frame-helper.test.ts` 的 render / capture / 中继三处断言），而 helper 渲染调用的就是同一个函数。要看 helper 版的三层，得让 VM 里那份的 `picker.frameDepth` 变成 3，而 VM 存储没有对外的写入接口。
- 另一个实测坑：`hidden` 标签页里三层渲染等了 90 秒以上没结束，`browser_tabs.select` 让标签页变成 `visible` 后几秒就完成 —— 与上一轮记的定时器节流一致，别把 `hidden` 下的慢当作卡死。

## 2026-11-12（第四轮）：帧在可滚动祖先里，祖先展开后帧位置

以前缺的一条：帧待在滚动容器里，容器被展开撑高后，帧图会不会还画在展开前的位置。补了新夹具，并在真实浏览器里量了像素。

- 夹具：`playground/index.html` 的 `#frame-scroll-demo` → `#frame-scroll-box`（`height:240px; overflow:auto`，`scrollHeight 1043`），里面先是 14 行占位（`#frame-scroll-rows` 高 **581**），然后才是 `/frame.html`（220px），末尾 240px 空白。所以帧默认完全在滚动口下方、屏幕上看不见。
- 环境：VM 安装（script `355`，`0.9.0`）访问 `http://127.0.0.1:4176/?vm=1`；FAB 开始拾取，悬停滚动口 → 框显示 `div#frame-scroll-box 482 × 240 可滚动 ↓1043px`（栈 5/5）→ `Enter`。
- 输出 **482 × 1043**：482 = 480 client + 2 border，1043 = 展开后的 `scrollHeight`。
- 帧表头色 `#eef2ff` 只出现在 **y 582–618**（582 = 1px border + 581 行占位），`y=100/300/560` 都是占位行的白底。帧图确实被画在「展开后」的盒子上，而不是展开前那个 240px 滚动口的坐标（那样它要么落在占位行上、要么整块落在画布外）。
- 表头是帧自己的 sticky 元素（帧内还带着 `scrollTo(0, 60)`），它出现在 582 而不是消失，说明这条路径上的 `pinFrameSticky()` 也照常生效。
- 没验的：打开 `capture.expandNested` 时的**嵌套**展开（卡片 → 滚动框 → 帧）。VM 存储没有写入接口；而「不装 VM、用 stub 的 `localStorage` 改设置」这条路本次没走通（页面上同时有页面注入的实例和 VM 的实例，两个都要抢指针事件，`hidden` 标签页还会让 Vue 的浮层停在旧状态）。机制上和已验路径共用同一段：帧图写回副本里那个 iframe 盒子的 `background-image`，盒子在 `expandForCapture()` 之后才被量、被画，位置由布局决定而不是由记录下来的坐标决定；写回本身由 `capture.test.ts` 的 iframe 合成用例覆盖。
