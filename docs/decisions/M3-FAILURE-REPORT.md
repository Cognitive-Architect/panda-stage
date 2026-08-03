# M3 Failure Report — Action Presets + Validated Event Generation

> 决策记录，关联 `docs/test-receipts/M3.md`（已修正结论为 **FAIL**）。
> 依据：DAY-25-AGENT-TASK「未验证项按 FAIL」「主路径未真实制作镜头不得 PASS」。

## 结论

- **M3 Gate = FAIL**
- **HIGH-001 = ENV-LIMITED**（真实 Electron UI 点击回归未执行，按工单计入 FAIL）
- **冻结 Day 26~45 实际开发**，直至真实 Electron 手动验收补齐并通过 M3 Gate。

## 已确认并完成（代码层面）

### 自动化闸门全绿（重跑证据）

| Gate | 结果 |
|---|---|
| TYPE | PASS（0 error） |
| LINT | PASS（0 error） |
| BUILD | PASS（`build:renderer` + `build:electron` exit 0） |
| UNIT / COMPONENT | PASS（466 passed） |
| INTEGRATION | PASS（85 passed） |

### 5 个逻辑修复（合并前修复）

| # | 问题 | 文件 | 关键改动 |
|---|---|---|---|
| 1 | overlap 检测属性映射错误 | `src/domain/actions/createPresetEvents.ts` | 抽取 `propertyOfType(type)` 与 `propertyOf` 共用同一映射；第 142 行 `detectOverlap` 改传 `propertyOfType(preset.eventType)`，使 move↔shake↔scale 等按真实属性（position/scale…）比较。 |
| 2 | 未来事件在 startMs 前提前生效 | `src/domain/evaluate-shot-at-time.ts` | 事件循环最开头加 `if (timeMs < event.startMs) continue;`，未来事件不再用 `from` 覆盖基态；已结束事件仍走 `rawProgress=1` 应用最终状态。 |
| 3 | 事件 ID 唯一性未纳入已有事件 | `src/domain/validators/timelineEventValidator.ts` | `seenIds` 初始化纳入 `shot.timelineEvents.map(e => e.id)`，新事件与已有事件 ID 冲突即拒绝。 |
| 4 | build 脚本为 Day 25 内联版 | `package.json` | 恢复为 `"build": "pnpm typecheck && pnpm build:renderer && pnpm build:electron"`。 |
| 5 | M3 回执与工单口径冲突 | `docs/test-receipts/M3.md` + 本文件 | M3 结论改 FAIL 并标注 Day 26~45 冻结；本文件记录 FAIL 根因与待补项。 |

### 新增回归测试

- `tests/unit/domain/actions/createPresetEvents.test.ts`：overlap 检测（move↔move、move↔shake、scale↔scale 触发；move vs scale 不误报；边界相接不算重叠；spy `console.warn` 验证 `[DEBT-CONFLICT-B25-001]`）。
- `tests/unit/domain/evaluate-shot-at-time.test.ts`：evaluator 时间语义（expression/flip/visibility/move/scale/opacity 的「开始前=基态」「进行中」「结束后=最终态」「两连续事件之间不回跳」）。
- `tests/unit/domain/validators/timelineEventValidator.test.ts`：ID 唯一性（新事件间重复拒绝；新事件与 shot 已有事件重复拒绝；全唯一通过）。

## Issue #54 合并前修复（2026-07-27）

GitHub Issue #54 为 Issue #52 的后续，列出 2 个合并阻塞项（连续 preset 边界回弹 + Day 16 CI 资产导入门禁）。重跑完整 CI（Day 16~24）又暴露 Day 20、Day 23 两处 day25 既有回归，按判定规则同属本分支阻塞项。全部修复已提交并推送，CI 全绿（见下"CI 复核"）。**PR #53 仍保持 Draft，M3 仍 FAIL（HIGH-001 未变）**。

| # | 问题 | 根因 | 文件 | 提交 | 关键改动 |
|---|---|---|---|---|---|
| 1 | 连续 preset 在动作边界回弹 (rebound) | `createPresetEvents` 的 `from`/`to` 锚定到 Layer 静态基态，未考虑 `startMs` 时刻该 layer 已被前序事件改变的真实状态 | `src/domain/actions/createPresetEvents.ts` | `f503b4f` | 引入 `evaluateShotAtTime(shot, startMs, project)` 解析 `startMs` 时刻真实 layer 状态；新增 9 个链式回归用例（452→461）。 |
| 2 | CI Day 16 资产导入门禁失败 | Day 25 R1 在 `App.tsx` 加了一段**无条件**的 demo 自动打开 `useEffect`（`main` 没有），改变启动时序使首次导入后 `revision` 停在 0，第二次导入 `baseRevision=0` 触发断言失败 | `src/renderer/App.tsx` | `e49254f` | demo 自动打开改为仅 `?demo=1` 时执行，启动路径与 `main@5ad6911` 一致；CI `30238994985` 证实 Day 16 转绿。 |
| 3 | Day 20 shot 复制门禁失败（`Populated shot was not duplicated`） | `App.tsx` 编辑外壳重复挂载 `<ShotManager>`，与 `ProjectRecoveryPanel` 原有挂载重复，DOM 列表翻倍导致复制命中错误实例 | `src/renderer/App.tsx` | `2142003` | 移除 `App.tsx` 冗余 `<ShotManager>` 挂载及无用 `snapshot`/`useSyncExternalStore` 引入；CI 证实 Day 20 转绿。 |
| 4 | Day 23 verify-issue47 门禁失败 | `scripts/verify-issue47.cjs` 误用 `@deprecated` 的 `shared/domain` evaluator | `scripts/verify-issue47.cjs` | `d1fb8b9` | import 改指 `dist-electron/domain/index.js`，调用补第 3 参 `project`；CI 证实 Day 16~24 全绿。 |

> 说明：Day 16 失败最初被误判为"App.tsx 重复挂载 `<AssetLibrary>`"并移除——经验证无效；复核 CI 失败 JSON 后锁定真实根因为 demo 自动打开污染启动时序（见 #2）。本表已据最终核实结论修正。

### 方案2 回归护栏 + CI 复核

- 新增 `tests/unit/shot-duplicate-regression.test.ts`（QA 严过关，5 用例）：store 层（shots 1→2 / 新副本选中 / 内容完整复制且 ID 全刷新）+ 渲染层（ShotManager 单 shot 仅渲染 1 个 `.shot-list-item` 防双挂载 / 真实"复制镜头"按钮 / DOM 出现"Opening 副本"）。单测总计 466 passed。
- CI 复核 `30246579722` / `30246576419`：**success**，Day 13/16/17/18/19/20/21/22/23/24 + M1/M2 全部实际执行并 PASS；Issue #54 验收标准（Day 16~24 全实际运行并 PASS）**已达成**。

## 待补项（阻塞解除冻结）

- **真实 Electron UI 手动验收（HIGH-001）**：在无显示 headless 环境无法执行。需在真实 Electron 外壳中：选镜头 → 选非背景层 → 应用预设 → undo/redo → 保存并重开项目，确认镜头与事件正确落盘、渲染无回跳/无提前生效。
- 补齐后重跑 M3 Gate（TYPE/LINT/BUILD/UNIT/INTEGRATION + 真实 GUI 验收），全部 PASS 方可解除 Day 26~45 冻结。

## 冻结范围

- Day 26~45 实际开发**暂停**。
- `DEBT-CONFLICT-B25-001`（重叠叠加语义）与 `UX-001`（参数旁预计效果提示）待真实验收后于 Day 27 推进。
- 本分支 `feat/day-25-action-presets` 仅做上述合并前修复，**不合并、不进入 Day 26**。
