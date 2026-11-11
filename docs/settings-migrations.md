# 设置迁移的版本化（方案已定，待实现）

> 状态：方案已确认，代码未动。上一轮只做了第一段迁移（`migratePointerSetting`），
> 没有版本号。动手前先读本文件，别凭记忆重写判定规则。

## 现状（已发布）

- 代码：`packages/userscript/src/config/migrate.ts`，由 `app.ts` 在 `createSettings()`
  **之前**调用（先改存储 blob，再交给 store hydrate）。
- 判定：**只看退役键名**——`'capture.pointerIsolation' in record`。值形状
  （`typeof === 'boolean'`）只决定「要不要写新键」：非布尔就丢掉旧键、不写新键，
  退回默认，而不是猜。
- 转换：`isolation:false → passthrough:true`，`true → false`；新键已有值则新键优先；
  旧键无论如何删除；坏 JSON、非对象、读不到存储 → 返回 null（什么都不做）。
- 幂等：第二次运行已经没有旧键，直接返回 null。
- 交付：`a38172a`（设置反转）、`46f502d`（picker 监听提前）、`6d3677b`（文档）。

## 为什么不是「按值格式迁移」

用户问过：以后若又出现同值格式（另一个 boolean 设置）会不会冲突？

- **不会**：迁移只认那一个键名，别的键一律不碰。「boolean」不是触发条件。
- 真正的风险只有三个，都不是值形状相同：
  1. **复用退役键名**——以后加回 `capture.pointerIsolation`（语义不同）会被这段迁移吃掉。
     → 纪律：退役键名永久保留，登记在 `migrate.ts` 顶部常量并注明禁止复用。
  2. **同一个键、值语义变了**——例如 `pointerPassthrough` 从布尔变三态，或默认再翻一次；
     此时无法从 blob 判断这个 `true` 是「老迁移来的」还是「新版本用户点的」。
     → 这正是版本号要解决的。
  3. **迁移链顺序**——迁移一多，靠「键的痕迹」推断就不可靠，且步骤会互相干扰。
- 约束：设置持久化是「整体写回 `values`」（store 的 `watch(values)` →
  `setItem(JSON.stringify(values))`），未知键会在下一次任何设置变动时被洗掉。
  所以**版本号不能放进 blob 的 values**，只能放独立的 GM 键（或 schema 隐藏字段，
  但面板会露出来，不好）。

## 待做方案

1. `migrate.ts` 改成步骤表：`STEPS = [{ id, run(record) }]`，按 id 升序执行。
2. 版本存独立键 `element-screenshot:settings-version`（GM 数字），缺失视为 `0`。
3. 只跑 `version < step.id` 的步骤；一个步骤成功（不抛）后写回新的 version。
4. blob 版本**高于**脚本认识的上限（用户从新版降级回来）：什么都不做，只
   `console.warn` 一次，避免用旧逻辑解释新数据。
5. 退役键名集中成常量 + 注释（永不复用）。
6. pointer 迁移作为 step 1：老 blob 没有版本，仍只能按「键名 + 值形状」判定；
   从 step 2 起就能靠版本精确判定，不再猜。
7. `resetAll()` 不清版本键：它描述 blob 的格式世代，不是用户偏好；步骤只对存在的键生效。

要补的测试（`tests/migrate.test.ts`）：

- 版本高于上限 → 不迁移、不写回；
- 同一个 step 不重复执行（跑两次结果一致）；
- 坏 JSON / 读不到存储 → 不阻塞启动，返回 null；
- 步骤按 id 顺序执行（后一步能看到前一步的结果）。

## 其它待办（与迁移无关，但记在这里免得丢）

- `AGENTS.md` 只剩极小的指令预算余量（65,3xx / 65,536 B），下次加内容前先等量删除。
- 穿透选取的三个已知缺口见 `AGENTS.md` 的「下一步」。
