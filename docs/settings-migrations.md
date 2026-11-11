# 设置迁移：版本化信封（已实现）

> 状态：已实现并验证（`packages/settings/src/domain.ts` + `packages/userscript/src/config/migrate.ts`）。
> 改动设置结构前先读本文件；这里记的是判定规则和为什么不能写成别的样子。

## 存储形态

设置存在**一条** GM 值里，内容是信封：

```json
{ "version": 1, "value": "{\"theme\":\"dark\", ...}" }
```

- `version`：非负整数，blob 的**世代**（schema 第几版）。
- `value`：不透明字符串，默认是 `JSON.stringify(values)`，但信封层不关心它的格式。

两层责任分明：

| 层 | 职责 |
| --- | --- |
| 信封（`createDomain`） | 版本号、写回、判定、诊断 |
| 载荷（`value`） | 设置本身；读写和每一步迁移的格式由该域自己决定 |

## 判定（`readDomain`）

按**类型**三分支，不做形状嗅探：

| 读到的值 | 结论 |
| --- | --- |
| `null` / `undefined` | 空域，世代 0，**不写回** |
| `string` | 旧格式（版本化之前写入的裸 JSON），世代 0 |
| `{ version: 非负整数, value: string }` | 新格式，用它的 `version` |
| 其他（数组、数字、`version` 不是整数、`value` 不是字符串） | 坏值，`warn` 一次并**原样保留** |

为什么 `string` 一定等于旧格式：旧版写的是 `JSON.stringify(values)`，GM 读回来就是字符串；新版写对象，读回来就是对象。这条往返保证对 `{number, string}` 这个受限信封是**恒等**，所以不需要「字符串化的信封」这类兜底——那种情况只说明运行环境坏了，属于要修环境，不是要在业务代码里兼容。

## 执行顺序

```text
读到世代 from
if from > 最新步骤 id  → warn，保持原样（降级保护）
for step in steps（按 id 升序）
    if from >= step.id → 跳过
    payload = step.run(payload)
    单次写入 { version: step.id, value: payload }
```

- **版本号与数据同一次写入**：信封方案的唯一理由就是这条，别再拆成两个 GM 键。
- **只有一个步骤时也先写 payload 再推进版本**并不存在：两者是同一个值。
- 步骤抛异常 → `warn` + **不写回**，保持原世代，下次启动重试。半个改写过的载荷比旧世代糟。
- 空的域不写任何东西：新装用户不会因为「先记个版本号」而多出一条存储。

## 版本号放在哪里（历史决定，别再讨论）

- **不能放在 `values` 里**：store 的持久化是 `JSON.stringify(values)`，未知键会被洗掉（`settings.ts` 的 `hydrate()` 也只拷已知键）。放进 blob 的 `version` 会静默消失。
- **不能放独立 GM 键**：与数据分两次写入，永远存在「数据写成功、版本号没写」的窗口；一旦落下，就成了要靠「任意数据没有版本号」这种不可靠信号去猜的状态。
- 因此：**同一条 GM 值里的信封**。代价是降级到 0.7.x 会重置设置一次（它读不懂信封），已接受。

## 步骤表

`packages/userscript/src/config/migrate.ts`：

| id | 内容 |
| --- | --- |
| 1 | `capture.pointerIsolation` → `capture.pointerPassthrough`（布尔取反）；新键已存在则新键优先；非布尔值只删旧键 |

规则：

- 步骤**只对存在的字段动手**，空载荷上必须能空转。
- 退役键名（`capture.pointerIsolation`）永久保留、**禁止复用**：世代 0 的 blob 会被 step 1 改写，复用会让新设置继承旧语义。
- 加步骤时：新 id 必须大于所有已有 id，且注明它读的是「上一代的载荷」。

## 第二个数据域出现时

`createDomain` 不写死任何键名：每个域用一条 GM 键 + 一份 `steps`，版本各自独立。新增一个域 = 再调一次 `createDomain`，两者互不影响（不会出现「A 域版本新、B 域版本旧」导致重复跑步骤的问题）。

`frame-token` 这类不需要迁移的数据**不注册**域，保持裸字符串；注册行为本身就是「这份数据受版本管理」的声明。

## 验证（2026-11-12，真实浏览器 + VM）

- 旧 blob `{"capture.pointerIsolation":false,"capture.scale":2}` → 启动后立即变成
  `{"version":1,"value":"{\"capture.scale\":2,\"capture.pointerPassthrough\":true}"}`。
- 空存储启动 → 键不出现（只有 `frame-token`）；改一个设置（主题下拉）→ 出现 `{version:1, value:"…"}`。
- 种 `{version:9}` → 原样不动，控制台一条 `stored generation 9 is newer than 1; left untouched`。
- 种 `{"foo":1}`（对象但无版本号）→ 原样不动，控制台 `unrecognised stored value; left untouched`。
- 种 `{version:1, value:"{\"trigger.fabSize\":64}"}` → FAB 渲染成 64×64（store 拿到的是载荷而不是信封），且启动未重写该值。
- VM 里旧版本的裸 blob 静默升级，无任何告警。

## 与迁移无关、但记在这里免得丢

- `AGENTS.md` 只剩极小的指令预算余量（65,0xx / 65,536 B），加内容前先等量删除；长文放 `docs/`。
- 穿透选取的三个已知缺口见 `AGENTS.md` 的「下一步」。
