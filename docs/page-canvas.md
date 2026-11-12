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

## 宽度：根元素不横向展开

`getTargetBox(documentElement)` 的宽度只取 `clientWidth`（视口宽），高度才取 `scrollHeight`。原因：

1. **画布会越撑越宽**。宽度传进副本后内容会重排：轻小说文库那页的 `scrollWidth` 是 4090（用户信息表 3862px 宽），把根宽度设成 4090 后表格继续变宽，`fitBoxToLayout()` 二次测量得到 **5427**，最终画布 5427×4697 CSS。
2. **视口固定层对不齐**。该页的 `#w8p-background` 是 `position: fixed; inset: 0`、尺寸正好一个视口（1417×679），克隆里它仍锚在左上角；画布宽 5427 时它只覆盖左边 26%，内容又被挤在左侧，看起来就是「背景跑到左上角、和内容不重叠」。
3. **横向溢出通常不是内容**。这页的溢出是一个 `<table class="grid">`（隐藏的用户信息表）造成的，用户从不会横向滚过去看它。

修法：`getTargetBox(documentElement)` 用 `clientWidth`（回退到 `getBoundingClientRect().width`），高度仍取 `scrollHeight`。需要横向内容时，选那个溢出的元素（元素截图会展开它自己的 `scrollWidth`）或用区域截图。

### 实测

- 修复前：画布 10854×9394（`ratio 2`，即 5427×4697 CSS），右侧 3/4 是白，背景图只占左边一条。
- 修复后：2834×9394（1417×4697 CSS）。`y=300` 一行横跨整宽都是背景图颜色（`6,25,31` / `19,61,75` / `122,92,94` …），`y=800` 以下（超出一个视口）是 `18,18,18` 的深色画布。

## 相关代码

- `core/background.ts`：`pageBaseColor()`、`canvasColor()`、`resolveBackdropColor()`；
- `core/target.ts`：`getTargetBox()` 的根元素分支；
- 测试：`tests/background.test.ts`、`tests/target.test.ts`、`tests/capture.test.ts`（`document root backdrop`）。
