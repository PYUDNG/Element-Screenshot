# 页面底色与整页画布

这份笔记解释「整页截图（`Ctrl+A`，根元素 `<html>`）」的底色和尺寸是怎么定的，以及为什么这两处都不能按元素截图的直觉来。

## 底色：body 背景画在 canvas 上

浏览器把 `body` 的背景（`html` 透明时）**传播到页面画布**，而不是画在 body 自己的盒子里。克隆树里的 `<html>` 只是 `foreignObject` 里的普通元素，没有画布可传播，于是 body 背景在克隆里完全消失，html-to-image 只好用我们传入的 `backgroundColor` 填满整张画布。

而 `resolveBackdropColor()` 原来的两条路对根元素都是空的：

- 绘制栈：`elementsFromPoint` 在 `<html>` 下方没有任何图层；
- 祖先链：`<html>` 没有祖先。

两条都落空就退回默认的白色。body 盒高通常只有一个视口，于是首屏以下整片变白。

修法：`resolveBackdropColor()` 对 `documentElement` / `body` 直接返回 `pageBaseColor()`（html 叠在画布上、再叠 body）。

### 实测（2026-11-12）

| 页面 | 现象 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| pawchive（2050px 高，body `#17191a`，body 盒高 691px） | 691px 以下全白，页脚浅灰字落在白底 | 白 `255,255,255` | `23,25,26` |
| x.com（9058px 高，body 黑） | 首屏以下两侧白、中间黑 | 白 | `0,0,0` |
| 轻小说文库（`color-scheme: dark`，无背景色） | 内容以外发白 | 白 | `18,18,18` |

## `color-scheme: dark` 的画布

页面可以一个背景色都不设，只声明 `color-scheme: dark`，浏览器就会用深色画布（Chrome 是 `#121212`）作底。`pageBaseColor()` 现在从这个「画布初始色」开始：

- `color-scheme` 只含 `dark` → `#121212`；
- 只含 `light`（或 `normal`）→ 白；
- `light dark` → 看 `prefers-color-scheme`（与浏览器实际选择一致）。

然后再按顺序叠 html、body 的背景色。轻小说文库那页正是这种情况：html/body 背景都是 `rgba(0,0,0,0)`，却因为 `color-scheme: dark` 显示深色。

## 宽度：根元素包含横向溢出（2026-11-12 决定）

`getTargetBox(documentElement)` 的宽度取 `max(scrollWidth, clientWidth)`，高度取 `max(scrollHeight, clientHeight)`：文档比视口宽时，整页截图就是整份文档，横向内容不会被裁掉。

这是**用户确认过的取舍**。曾经试过只取 `clientWidth`，被轻小说文库那页证明是错的判断——那页的横向溢出是页面自身异常（一个 3862px 宽的用户信息表），不是"这个工具不该渲染"：

- 宽度传进副本后内容会重排：该页 `scrollWidth` 4090，把根宽度设成 4090 后表格继续变宽，`fitBoxToLayout()` 二次测量得到 **5427**，最终画布 5427×4697 CSS（`ratio 2` 下 10854×9394）；
- 该页的 `#w8p-background` 是 `position: fixed; inset: 0`、尺寸正好一个视口（1417×679），克隆里它仍锚在左上角；画布宽 5427 时它只覆盖左边 26%，内容被挤在左侧，看起来就是「背景跑到左上角、和内容不重叠」。

**这两个现象都是把画布撑宽后的必然结果**，不是渲染错误：页面在 1417px 视口下本来就是这样排的，固定层也本来就只覆盖视口。所以现在的策略是「页面有多宽就画多宽」，不替页面裁掉横向溢出；真有内容被裁掉，反而是选择的语义不对。

如果以后想给 Ctrl+A 一个"只截视口宽"的选项，可以另加开关，但不要改默认——默认必须是完整文档。

### 实测（该页，横向宽度按 scrollWidth）

- 画布 10854×9394（`ratio 2`），右侧 3/4 是白，背景图只占左边一条；`y=800` 以下（超出一个视口）是 `18,18,18` 的深色画布（颜色修复仍然生效）。
- 背景图只覆盖左边是 1417 视口宽的 `position: fixed` 层，画布再宽它也不会跟着变宽。

## 相关代码

- `core/background.ts`：`pageBaseColor()`、`canvasColor()`、`resolveBackdropColor()`；
- `core/target.ts`：`getTargetBox()` 的根元素分支（横向取 `scrollWidth`）；
- 测试：`tests/background.test.ts`、`tests/target.test.ts`、`tests/capture.test.ts`（`document root backdrop`）。
