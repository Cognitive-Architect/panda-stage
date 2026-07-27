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
| UNIT / COMPONENT | PASS（452 passed） |
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

## 待补项（阻塞解除冻结）

- **真实 Electron UI 手动验收（HIGH-001）**：在无显示 headless 环境无法执行。需在真实 Electron 外壳中：选镜头 → 选非背景层 → 应用预设 → undo/redo → 保存并重开项目，确认镜头与事件正确落盘、渲染无回跳/无提前生效。
- 补齐后重跑 M3 Gate（TYPE/LINT/BUILD/UNIT/INTEGRATION + 真实 GUI 验收），全部 PASS 方可解除 Day 26~45 冻结。

## 冻结范围

- Day 26~45 实际开发**暂停**。
- `DEBT-CONFLICT-B25-001`（重叠叠加语义）与 `UX-001`（参数旁预计效果提示）待真实验收后于 Day 27 推进。
- 本分支 `feat/day-25-action-presets` 仅做上述合并前修复，**不合并、不进入 Day 26**。
