# Panda Stage Agent Task — Day 20

> **工单编号**：B-20/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 20  
> **分支建议**：`feat/day-20-shot-management`  
> **任务类型**：功能开发 + M2 集成验收  
> **唯一目标**：完成镜头新增、复制、移除、重命名、时长编辑、拖拽排序和当前镜头选择，并通过 5 镜头保存重开回归关闭 M2。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Shot CRUD + Ordering + Duration + M2 Gate
- **轰炸目标**：建立最小镜头列表、镜头数据操作、稳定排序、时长校验、当前选择、项目总时长和 M2 回执。
- **任务性质**：功能开发 + 状态一致性 + Gate 验收
- **输入基线**：M1 Gate 必须 PASS；Day 16～19 已完成素材、元数据、素材库和角色定义。
- **输出要求**：5 镜头可创建、复制、排序、移除、保存和重开；总时长准确；M2 结论明确。
- **通用铁律**：
  1. M1 Gate 非 PASS 时停止。
  2. 复制镜头必须生成新 Shot ID，需要复制的子实体也必须重建 ID。
  3. 排序必须写回项目数据，不能只改变界面顺序。
  4. `durationMs` 必须为整数且不少于 500。
  5. 移除当前镜头后必须得到稳定的新选择状态。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 当前分支与 HEAD | `git branch --show-current`、`git rev-parse HEAD` | 必须 |
| Gate 前置 | M1 Gate PASS，Day 16～19 回执存在 | 回执文件 | 必须 |
| 当前模型 | Project/Shot schema、项目保存、角色和素材引用可用 | 搜索 `ShotSchema`、`durationMs`、`currentShot` | 必须 |
| 目标范围 | ShotService、store/selectors、镜头列表 UI、排序、总时长、测试和 M2 回执 | `git diff --name-only` | 必须 |
| 目标结果 | 5 镜头可排序；复制产生新 ID；移除后选择有效；总时长正确；保存重开一致 | unit/component/integration/manual evidence | 必须 |
| 技术约束 | `durationMs` 为整数且 ≥500；排序稳定；所有变更进入 dirty 状态 | 代码与测试 | 必须 |
| 风险边界 | 不做画布、真实镜头缩略图、时间轴、转场或批量编辑 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 16～19 回归 | 命令输出 | 必须 |
| 文档同步 | 创建 `docs/test-receipts/M2.md` | 文档 diff | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 镜头是项目有序列表；总时长等于所有镜头 `durationMs` 之和。 |
| 待确认问题 | Shot 数据结构；复制时需重建哪些子 ID；拖拽库；移除后的选择规则。 |
| 预期输出 | 不丢顺序、不复用 ID、可稳定保存的镜头管理闭环。 |
| 停止条件 | 5 镜头操作、排序、总时长、保存重开和 M2 Gate 全有证据。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-20/45
- **角色**：Engineer
- **依赖关系**：依赖 M1 与 Day 16～19；M2 FAIL 时阻塞 Day 21 之后的实际开发。

### 输出交付物

- **预计变更文件**：
  - `src/domain/services/ShotService.ts`
  - `src/domain/selectors/projectDuration.ts`
  - `src/stores/shotStore.ts`
  - `src/features/shots/ShotList.tsx`
  - `src/features/shots/ShotListItem.tsx`
  - `src/features/shots/ShotEditor.tsx`
  - `src/features/shots/ShotThumbnailPlaceholder.tsx`
  - 对应 unit/component/integration tests
  - `docs/test-receipts/M2.md`
  - 失败时：`docs/decisions/M2-FAILURE-REPORT.md`
- **核心修改点**：
  - 新增、复制、移除、重命名镜头；
  - 时长编辑与校验；
  - 拖拽排序写回模型；
  - 当前镜头选择；
  - 项目总时长纯函数；
  - 5 镜头保存重开回归；
  - 输出 M2 PASS/FAIL。
- **必须包含**：
  - 复制镜头得到新 Shot ID；
  - 需要复制的子实体 ID 不冲突；
  - 顺序、名称、时长保存重开一致；
  - 非法时长被拒绝；
  - 移除当前镜头后选择有效；
  - 总时长准确；
  - M2 结论只能 PASS 或 FAIL。
- **禁止包含**：
  - 只改界面顺序不改模型；
  - 复制后复用原 ID；
  - 把临时选中状态写入项目真相；
  - 提前实现画布、时间轴或转场；
  - 未验证就判 M2 PASS。
- **交付证明**：ShotService 单测、排序组件测试、5 镜头生命周期测试、ID 对比、总时长证据和 M2 回执。

### 规模与复杂度观察

- ShotService 负责纯数据变换，组件只处理交互。
- 复制镜头使用显式 ID remap，禁止只深拷贝后更换 Shot ID。
- Gate 日只修 M2 阻塞；结构性问题过多时判 FAIL 并拆后续修复工单。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | Gate FAIL |
| TYPE | 类型通过 | `pnpm typecheck` | Gate FAIL |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | Gate FAIL |
| TEST | CRUD、复制、排序、时长和保存重开测试通过 | unit/component/integration tests | Gate FAIL |
| ARCH | 数据规则集中，排序写回模型，无超范围功能 | diff 审查 | Gate FAIL |
| REAL | 真实创建 5 镜头并保存重开 | 手动 + 文件证据 | Gate FAIL |
| DOC | M2 回执完整且结论明确 | `docs/test-receipts/M2.md` | Gate FAIL |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 新增/重命名/移除可用 | unit/component | [ ] |
| FUNC | FUNC-002 | 复制生成新 Shot 与子 ID | remap tests | [ ] |
| FUNC | FUNC-003 | 拖拽排序写回项目模型 | component/integration | [ ] |
| FUNC | FUNC-004 | 总时长准确 | selector tests | [ ] |
| CONST | CONST-001 | `durationMs` 为整数且 ≥500 | validator tests | [ ] |
| CONST | CONST-002 | 当前选择规则明确 | store tests | [ ] |
| CONST | CONST-003 | 顺序持久化到项目文件 | JSON 断言 | [ ] |
| CONST | CONST-004 | 缩略图仅为占位 | diff 审查 | [ ] |
| NEG | NEG-001 | 小数、空值、NaN 和过小时长被拒绝 | boundary tests | [ ] |
| NEG | NEG-002 | 移除当前镜头后选择有效 | store/component test | [ ] |
| NEG | NEG-003 | 最后一个镜头有明确规则 | test | [ ] |
| NEG | NEG-004 | 保存失败不丢顺序 | fault injection | [ ] |
| UX | UX-001 | 常用操作入口清楚 | UI 证据 | [ ] |
| UX | UX-002 | 确认和时长错误可理解 | UI 证据 | [ ] |
| E2E | E2E-001 | 5 镜头创建→排序→保存→重开 | 完整流程 | [ ] |
| High | HIGH-001 | 复制与重排后 ID/引用一致 | schema/reference validation | [ ] |

---

## 【模块3-B】地狱红线

1. M1 Gate 非 PASS 仍开工 → 停止。
2. 复制镜头复用原 ID → 返工。
3. 子实体 ID 冲突未验证 → 返工。
4. 拖拽只改界面不改项目数据 → 返工。
5. 非法时长进入项目文件 → 返工。
6. 移除当前镜头后状态悬空 → 返工。
7. 保存重开后顺序或时长变化 → Gate FAIL。
8. 提前实现画布、时间轴或转场 → 范围失控。
9. M2 未完整验证就写 PASS → Gate FAIL。
10. 自动化门禁失败仍交付 → Gate FAIL。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | CRUD、排序、时长和选择是否可用？ | [ ] | CF-B20-001 |
| RG | M1 与 Day 16～19 是否保持？ | [ ] | RG-B20-001 |
| NG | 非法时长、移除边界、保存失败是否覆盖？ | [ ] | NG-B20-001 |
| UX | 操作确认与错误是否清楚？ | [ ] | UX-B20-001 |
| E2E | 5 镜头保存重开是否完整？ | [ ] | E2E-B20-001 |
| High | 复制与排序后的 ID/引用是否一致？ | [ ] | HIGH-B20-001 |
| 字段完整性 | M2 回执是否完整？ | [ ] | M2.md |
| 需求映射 | 是否覆盖 Day 20 与 M2 条款？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实拖拽排序并重开？ | [ ] | 操作证据 |
| 范围边界与债务 | 未验证与 debt 是否列出？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
# M2 Gate — Assets, Characters and Shots

## 结论
- Result: PASS / FAIL
- 执行分支: `feat/day-20-shot-management`
- 基线 SHA:
- 结果 SHA:
- M1 Gate: PASS（证据路径）

## 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component tests:
- integration tests:
- `pnpm build`:
- CI:

## M2 能力验收
| 项目 | 结果 | 证据 |
|---|---|---|
| 四类素材导入与去重 | PASS/FAIL | |
| 缩略图与媒体元数据 | PASS/FAIL | |
| 素材库和引用保护 | PASS/FAIL | |
| 角色与表情管理 | PASS/FAIL | |
| 镜头 CRUD | PASS/FAIL | |
| 镜头复制 ID 安全 | PASS/FAIL | |
| 镜头排序与总时长 | PASS/FAIL | |
| 5 镜头保存重开 | PASS/FAIL | |

## 5 镜头回归
- 初始顺序:
- 重排后顺序:
- 重开后顺序:
- 名称:
- 时长:
- 总时长:
- 复制 ID 对比:
- 移除后的当前选择:

## 债务与未验证项
- DEBT-IDMAP-B20-001:
- DEBT-TEST-B20-001:
- 继承自 Day 16～19 的债务:

## 决策
- PASS：允许进入 Day 21。
- FAIL：冻结 Day 21～45 的实际开发，只允许修复 M2，并创建 `docs/decisions/M2-FAILURE-REPORT.md`。
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| ID-B20-001 | 复制镜头产生重复 ID/引用 | 修 ID remap | Gate FAIL |
| DATA-B20-001 | 保存重开后顺序、名称或时长变化 | 修持久化与排序 | Gate FAIL |
| STATE-B20-001 | 移除镜头后当前选择悬空 | 修 store 规则 | 返工 |
| QUALITY-B20-001 | Day 16～19 回归失败 | 冻结 M3 | Gate FAIL |
| TEST-B20-001 | 5 镜头主路径未真实执行 | 不得 PASS | Gate FAIL |

---

## 【模块7】派单口令

启动执行 **Panda Stage Day 20：Shot CRUD + Ordering + Duration + M2 Gate**。

验收铁律：5 镜头可创建和排序；复制生成新 ID；非法时长拒绝；移除后选择有效；总时长准确；保存重开保持顺序、名称和时长；M2 结论只能 PASS 或 FAIL。

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "ShotService\|durationMs\|currentShot\|projectDuration" -- src shared electron tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
git log --oneline -n 20
```
