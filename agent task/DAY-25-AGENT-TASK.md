# Panda Stage Agent Task — Day 25

> **工单编号**：B-25/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 25  
> **分支建议**：`feat/day-25-action-presets`  
> **任务类型**：功能开发 + 事件生成 + M3 Gate  
> **唯一目标**：让用户通过动作预设生成合法 TimelineEvent，并以“无需改代码即可完成静态镜头与基础动作”作为 M3 Gate。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Action Presets + Validated Event Generation + M3 Gate
- **轰炸目标**：实现左入场、右入场、移动到、放大强调、抖动、表情切换、淡入、淡出预设，统一通过纯函数生成事件并进入 History。
- **任务性质**：功能开发 + 数据契约 + Gate 验收
- **输入基线**：M2 Gate PASS；Day 21～24 已完成画布、图层放置、变换与历史；ProjectSchema v1 已含 TimelineEvent 联合类型。
- **输出要求**：预设产生合法事件、边界可控、未选图层时禁用、可撤销，并输出 `docs/test-receipts/M3.md` 的 PASS/FAIL 结论。
- **通用铁律**：
  1. 预设只生成 TimelineEvent，不直接操作 DOM 或 Konva 节点。
  2. 所有时间字段使用整数毫秒，事件不得越过镜头边界而无提示。
  3. 预设操作必须走 History，可撤销重做。
  4. 未选中图层、锁定图层或引用失效时必须禁用或拒绝。
  5. M3 Gate 结论只能 PASS 或 FAIL，未验证项按 FAIL 处理。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | M2 Gate PASS，Day 21～24 回执与测试通过 | Gate/回执文件 | 必须 |
| 当前模型 | TimelineEvent union、Layer、Shot duration、HistoryStore 可用 | `git grep -n "TimelineEvent\|HistoryStore\|durationMs\|expression\|shake\|opacity" -- src shared tests` | 必须 |
| 目标范围 | preset 定义、事件工厂、面板 UI、参数校验、History 接入、测试与 M3 回执 | `git diff --name-only` | 必须 |
| 目标结果 | 8 类预设生成正确事件；越界被限制/提示；无选择时禁用；可撤销；用户无需改代码完成一个静态镜头并添加动作 | unit/component/integration/manual evidence | 必须 |
| 技术约束 | 纯函数事件工厂；整数毫秒；ID 唯一；参数通过 schema；同属性冲突至少检测或明确延后 | 代码与测试 | 必须 |
| 风险边界 | 不做完整时间轴 UI；不做关键帧曲线编辑；不做复杂转场；不做脚本语言 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 21～24 回归 | 命令输出 | 必须 |
| 文档同步 | 创建 `docs/test-receipts/M3.md`，记录预设映射、边界和 Gate 结论 | 文档 diff | 必须 |
| 历史债务 | 若 TimelineEvent 类型缺字段，必须最小补 schema 与 migration，并保留旧项目可开 | schema/migration tests | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 事件必须由 evaluator 消费；本日重点是合法生成，不是完整时间轴编辑。 |
| 待确认问题 | 当前 TimelineEvent 字段；默认动作时长；入场起止位置；同属性重叠检测已有程度。 |
| 预期输出 | 一套可预测、可撤销、可测试的预设→事件映射。 |
| 停止条件 | 8 类预设、边界、History、锁定/无选择和 M3 Gate 全部有证据。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-25/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 21～24；M3 FAIL 时阻塞 Day 26～45 实际开发。

### 输出交付物

- **预计变更文件**：
  - `src/domain/actions/ActionPreset.ts`
  - `src/domain/actions/createPresetEvents.ts`
  - `src/domain/validators/timelineEventValidator.ts`
  - `src/features/actions/ActionPresetPanel.tsx`
  - `src/features/actions/PresetParameterForm.tsx`
  - History command 适配文件
  - 对应 unit/component/integration tests
  - `docs/test-receipts/M3.md`
  - 失败时：`docs/decisions/M3-FAILURE-REPORT.md`
- **核心修改点**：
  - 左入场、右入场、移动到；
  - 放大强调；
  - 抖动；
  - 表情切换；
  - 淡入、淡出；
  - preset 参数 schema；
  - 基于当前时间、图层和镜头时长生成事件；
  - 唯一 event ID；
  - 越界 clamp 或阻止并提示；
  - 未选、锁定或无合法表情时禁用；
  - 通过 History command 写入；
  - M3 静态镜头与动作验收。
- **必须包含**：
  - 每个预设生成正确 `type` 与字段；
  - 左/右入场起点在画布外或明确边界；
  - move target 使用逻辑坐标；
  - expression 只引用角色已有表情；
  - opacity 值限定 0～1；
  - duration/start/end 为整数毫秒；
  - 超出镜头边界时阻止或明确裁剪；
  - 未选图层时按钮禁用；
  - locked 图层不能应用；
  - 操作可 undo/redo；
  - 事件保存重开不丢；
  - M3 结论唯一明确。
- **禁止包含**：
  - 直接修改 DOM/Konva 节点制造动画；
  - 生成 schema 不接受的任意对象；
  - 静默把越界事件截断而无反馈；
  - 对锁定图层写事件；
  - 提前实现完整时间轴、贝塞尔曲线、转场或脚本系统；
  - M3 未验证就判 PASS。
- **交付证明**：事件工厂参数化单测、组件禁用与提示测试、History undo/redo、保存重开 integration、用户完成静态镜头+动作的操作证据、M3 回执。

### 规模与复杂度观察

- preset 配置可数据驱动，但不要建立插件市场式抽象。
- 事件生成必须纯函数化，UI 只收集参数和分发命令。
- 同属性冲突若 Day 27 才完整实现，本日至少检测明显冲突并声明 `DEBT-CONFLICT-B25-001`，不得完全忽略。
- Gate 日仅修 M3 阻塞；结构性问题过多时判 FAIL。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | Gate FAIL |
| TYPE | 类型通过 | `pnpm typecheck` | Gate FAIL |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | Gate FAIL |
| TEST | preset、边界、禁用、History、持久化测试通过 | unit/component/integration tests | Gate FAIL |
| ARCH | 只生成事件，不直接操作 DOM/Konva | 静态搜索 + diff | Gate FAIL |
| REAL | 用户不改代码完成静态镜头与动作 | `pnpm dev` 操作证据 | Gate FAIL |
| DOC | M3 回执完整且结论明确 | `docs/test-receipts/M3.md` | Gate FAIL |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 左入场、右入场、移动到生成正确 move | parameterized tests | [ ] |
| FUNC | FUNC-002 | 放大强调与抖动生成正确事件 | unit tests | [ ] |
| FUNC | FUNC-003 | 表情切换生成合法 expression | unit/integration | [ ] |
| FUNC | FUNC-004 | 淡入/淡出生成合法 opacity | unit tests | [ ] |
| CONST | CONST-001 | 时间均为整数毫秒 | schema tests | [ ] |
| CONST | CONST-002 | event ID 唯一 | repeated generation test | [ ] |
| CONST | CONST-003 | move 使用逻辑坐标 | geometry assertion | [ ] |
| CONST | CONST-004 | 预设通过 History 写入 | command spy | [ ] |
| NEG | NEG-001 | 未选图层按钮禁用 | component test | [ ] |
| NEG | NEG-002 | locked 图层拒绝应用 | negative test | [ ] |
| NEG | NEG-003 | 越界事件被限制或提示 | boundary tests | [ ] |
| NEG | NEG-004 | 不存在的表情被拒绝 | validator test | [ ] |
| UX | UX-001 | 参数与预计效果提示清楚 | UI 证据 | [ ] |
| UX | UX-002 | 错误/越界反馈可理解 | UI 证据 | [ ] |
| E2E | E2E-001 | 摆镜头→应用动作→undo/redo→保存重开 | 完整流程 | [ ] |
| High | HIGH-001 | 无需改代码即可完成静态镜头与动作 | M3 手动验收 | [ ] |

---

## 【模块3-B】地狱红线

1. M2 Gate 非 PASS 仍开工 → 停止。
2. 预设直接操作 DOM/Konva → 返工。
3. 生成非法 TimelineEvent → 返工。
4. 越界事件静默进入项目 → 返工。
5. 未选或锁定图层仍可应用 → 返工。
6. 操作不可撤销 → 返工。
7. 保存重开后事件丢失 → Gate FAIL。
8. 提前实现完整时间轴、曲线或转场 → 范围失控。
9. 需要改代码才能完成验收镜头 → Gate FAIL。
10. 自动化门禁失败仍交付 → Gate FAIL。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 8 类预设是否生成正确事件？ | [ ] | CF-B25-001 |
| RG | Day 21～24 的画布与历史是否保持？ | [ ] | RG-B25-001 |
| NG | 无选择、锁定、越界、错误表情是否覆盖？ | [ ] | NG-B25-001 |
| UX | 参数、禁用和错误反馈是否清楚？ | [ ] | UX-B25-001 |
| E2E | 动作到保存重开是否完整？ | [ ] | E2E-B25-001 |
| High | 是否真正无需改代码完成镜头？ | [ ] | HIGH-B25-001 |
| 字段完整性 | M3 回执是否包含全部命令与操作证据？ | [ ] | M3.md |
| 需求映射 | 是否覆盖 Day 25 与 M3 条款？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实制作并保存一个镜头？ | [ ] | 操作证据 |
| 范围边界与债务 | 冲突/测试限制是否显式列出？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
# M3 Gate — Canvas Editing and Action Presets

## 结论
- Result: PASS / FAIL
- 执行分支: `feat/day-25-action-presets`
- 基线 SHA:
- 结果 SHA:
- M2 Gate: PASS（证据路径）

## 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component tests:
- integration tests:
- `pnpm build`:
- CI:

## M3 能力验收
| 项目 | 结果 | 证据 |
|---|---|---|
| 固定逻辑画布与 viewport | PASS/FAIL | |
| 图层拖入、选择与移动 | PASS/FAIL | |
| 图层变换、层级与锁定 | PASS/FAIL | |
| Undo / Redo 与拖动合并 | PASS/FAIL | |
| 8 类动作预设 | PASS/FAIL | |
| 事件边界与参数校验 | PASS/FAIL | |
| 保存重开 | PASS/FAIL | |
| 无代码完成静态镜头与动作 | PASS/FAIL | |

## 验收镜头
- 使用素材:
- Layer 数量:
- 动作预设:
- Undo/Redo 结果:
- 保存重开结果:
- 是否修改代码:

## 债务与未验证项
- DEBT-CONFLICT-B25-001:
- DEBT-TEST-B25-001:
- 继承自 Day 21～24 的债务:

## 决策
- PASS：允许进入 Day 26。
- FAIL：冻结 Day 26～45 的实际开发，只允许修复 M3，并创建 `docs/decisions/M3-FAILURE-REPORT.md`。
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| EVENT-B25-001 | 预设可生成非法/越界事件 | 修事件工厂与 validator | Gate FAIL |
| ARCH-B25-001 | 预设依赖直接操作渲染节点 | 回退为纯事件生成 | Gate FAIL |
| HISTORY-B25-001 | 预设无法稳定 undo/redo | 修命令适配 | Gate FAIL |
| UX-B25-001 | 用户必须改代码才能完成镜头 | 冻结 M4，修编辑体验 | Gate FAIL |
| TEST-B25-001 | 主路径未真实制作镜头 | 不得 PASS | Gate FAIL |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 25：Action Presets + Validated Event Generation + M3 Gate**！

验收铁律：8 类预设生成合法事件；越界受控；未选/锁定不可用；可撤销；保存重开不丢；用户无需改代码完成静态镜头和动作；M3 只能 PASS 或 FAIL。

Ouroboros 闭环启动，**B-25/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "ActionPreset\|createPresetEvents\|TimelineEvent\|HistoryStore" -- src shared tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
git log --oneline -n 25
```
