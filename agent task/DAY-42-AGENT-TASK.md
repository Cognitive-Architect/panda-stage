# Panda Stage Agent Task — Day 42

> **工单编号**：B-42/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 42  
> **分支建议**：`fix/day-42-top-production-blockers`  
> **任务类型**：P0 Bug 修复 + 回归测试 + Gate C 复验  
> **唯一目标**：只修复 Sample A 证据中排序最高的三个真实 P0 生产阻塞，为每个问题补复现和回归测试，并证明修复直接改善出片且不破坏 Gate C。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Fix Top Production Blockers from Sample A
- **轰炸目标**：从 `docs/validation/SAMPLE-A.md` 提取前三个真实 P0，逐项复现、最小修复、补测试、重跑相关流程和导出，不夹带美化、重构或新功能。
- **任务性质**：Bug 修复 + 回归保护 + 生产闭环
- **输入基线**：Sample A 已完成并有可复现问题证据；RC1/Gate C 基线可运行；每个候选 P0 有步骤、影响和证据。
- **输出要求**：最多三个真实 P0 的独立复现与修复 + 自动化测试 + Gate C 关键回归 + 更新后的问题状态 + 结构化收卷。
- **通用铁律**：
  1. 只修 Sample A 中有证据的 P0，禁止把 P1/P2 升级凑数。
  2. 每个修复必须先复现、再写失败测试、再改代码、最后证明测试由红转绿。
  3. 只做最小必要修复，禁止视觉美化、无关重构和新功能。
  4. 修复后必须复跑受影响流程与 Gate C 关键路径。
  5. 若真实 P0 少于三个，只处理实际数量并诚实说明，不得虚构第三个问题。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 当前分支、HEAD、工作区状态 | `git branch --show-current`；`git rev-parse HEAD`；`git status --short` | 必须 |
| 来源文档 | `docs/validation/SAMPLE-A.md` 中 P0 与前三阻塞 | 文档路径 + 证据链接 | 必须 |
| 当前基线 | RC1/Gate C 相关命令、导出产物和问题复现环境 | 回执与产物 | 必须 |
| 目标范围 | 最多三个 P0 涉及的最小代码、测试和问题文档 | `git diff --name-only` | 必须 |
| 目标结果 | 每个 P0 有复现、失败测试、最小修复、回归证据；导出仍通过 | tests/recording/MP4 | 必须 |
| 技术约束 | 保持项目格式、预览/导出共享链路、安全 IPC、整数毫秒和原有数据兼容 | 代码与测试 | 必须 |
| 风险边界 | 不做 P1/P2；不做视觉美化；不做 TTS/AI/云；不改无关模块；不借机重构 | diff 审查 | 必须 |
| 测试基线 | 修复前先记录现有门禁和每个复现结果 | 原始命令输出 | 必须 |
| 文档同步 | 更新 `SAMPLE-A.md` 问题状态，新建 `docs/test-receipts/DAY-42.md` | 文档 diff | 必须 |
| 历史债务 | 未处理 P1/P2 和非前三 P0 必须保留，不得从清单消失 | 问题对照表 | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 问题优先级来自真实样片，不来自开发者主观偏好。 |
| 待确认问题 | 每个 P0 的最小根因；是否共享同一底层原因；修复是否触碰 Gate C 高风险链路。 |
| 预期输出 | 直接减少生产阻塞、可回滚且有回归测试的最小修复集。 |
| 停止条件 | 实际 P0 全部完成复现、修复、测试、生产流程复验和文档更新。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-42/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 41 Sample A 的真实证据。

### 输出交付物

- **每个 P0 必须产出**：
  - 问题 ID、严重度依据和 Sample A 证据；
  - 稳定复现步骤；
  - 修复前失败测试或可自动化复现；
  - 根因说明；
  - 最小代码修复；
  - 修复后测试；
  - 生产流程复验；
  - 回滚方式。
- **建议变更范围**：仅由实际 P0 根因决定，不预写虚假路径；执行前必须记录文件与函数位置。
- **必须包含**：
  - P0 选择表与排序依据；
  - 若少于三个真实 P0，明确写“实际 P0 数量”，不补假问题；
  - 每个 P0 修复前复现证据；
  - 每个 P0 至少一条回归测试；
  - 测试不得只断言 mock 成功；
  - 修复后重跑 Sample A 相关步骤；
  - 修复后重新导出样片或最小等价项目；
  - `ffprobe` 验证输出；
  - 受影响 Gate C 关键帧/同步/取消路径复验；
  - 全量默认门禁通过；
  - diff 无无关重构；
  - 未处理问题继续保留分级和证据。
- **禁止包含**：
  - 将 P1/P2 冒充 P0；
  - 先改代码后补复现；
  - 只改文案掩盖功能失败；
  - 删除失败测试；
  - 大规模架构重构；
  - TTS、AI、云功能或视觉美化；
  - 修改 Sample A 数据使问题消失；
  - 用 `test.skip` 或硬编码通过。
- **交付证明**：红绿测试记录、diff、复现录屏、修复后样片流程、MP4/ffprobe、Gate C 定向复验、问题状态表。

### 规模与复杂度观察

- 三个问题应尽量独立提交或至少在回执中独立列出，便于单独回滚。
- 若多个 P0 共享根因，可做一个根因修复，但必须分别证明三个症状被解决。
- 若修复必须改变项目格式或导出语义，触发熔断，回到对应 Gate 设计，不得在本日硬塞大改。
- 复杂函数或状态机新增必须说明必要性并申报 `DEBT-COMPLEXITY-B42-xxx`。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式检查通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | lint 通过 | `pnpm lint` | 返工 |
| TEST | 每个 P0 的回归测试 + 相关 integration/E2E 通过 | 仓库实际命令 | 返工 |
| ARCH | 无无关重构、无新功能、兼容原项目 | diff + tests | 返工 |
| REAL | Sample A 受阻步骤和导出真实复验 | 录屏/MP4/ffprobe | 返工 |
| DOC | 问题状态与 DAY-42 回执同步 | 文档 diff | 返工 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | P0-1 稳定复现并修复 | test/recording | [ ] |
| FUNC | FUNC-002 | P0-2 稳定复现并修复或 N/A + 原因 | test/recording | [ ] |
| FUNC | FUNC-003 | P0-3 稳定复现并修复或 N/A + 原因 | test/recording | [ ] |
| FUNC | FUNC-004 | Sample A 受阻流程重新走通 | production replay | [ ] |
| CONST | CONST-001 | 每个修复都有回归测试 | test mapping | [ ] |
| CONST | CONST-002 | 不改变无关行为和项目兼容性 | regression evidence | [ ] |
| CONST | CONST-003 | diff 仅含必要文件 | diff review | [ ] |
| CONST | CONST-004 | P0 严重度与排序来自 Sample A 证据 | source mapping | [ ] |
| NEG | NEG-001 | 不将 P1/P2 升级凑数 | issue audit | [ ] |
| NEG | NEG-002 | 修复失败/异常路径仍可读 | negative tests | [ ] |
| NEG | NEG-003 | 未处理问题未被删除 | issue comparison | [ ] |
| NEG | NEG-004 | 无 skip/mock/hardcode 假通过 | static review | [ ] |
| UX | UX-001 | 修复后用户无需改代码完成步骤 | manual flow | [ ] |
| UX | UX-002 | 错误或边界提示可理解 | UI evidence | [ ] |
| E2E | E2E-001 | 相关编辑→保存→预览→导出完整复验 | complete flow | [ ] |
| High | HIGH-001 | Gate C 高风险路径未回归 | targeted Gate C evidence | [ ] |

---

## 【模块3-B】地狱红线

1. 没有 Sample A 证据就开始修 → 返工。
2. 把 P1/P2 冒充 P0 → 严重违规。
3. 先改代码、后编复现步骤 → 返工。
4. 没有回归测试 → 返工。
5. mock 或硬编码成功 → 返工。
6. 修改样片数据掩盖问题 → 返工。
7. 夹带视觉美化、新功能或大重构 → 范围失控。
8. Gate C 定向回归失败仍交付 → 返工。
9. 删除未处理问题 → 数据不诚实。
10. 质量门禁失败仍收卷 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 每个真实 P0 是否完成红绿闭环？ | [ ] | CF-B42-001 |
| RG | Gate C 和 Sample A 是否回归？ | [ ] | RG-B42-001 |
| NG | 原失败路径和边界是否覆盖？ | [ ] | NG-B42-001 |
| UX | 修复是否真正减少用户阻塞？ | [ ] | UX-B42-001 |
| E2E | 生产关键路径是否重新走通？ | [ ] | E2E-B42-001 |
| High | 导出一致性/同步/取消是否未破坏？ | [ ] | HIGH-B42-001 |
| 字段完整性 | 每个问题是否有复现、根因、修复、测试？ | [ ] | DAY-42.md |
| 需求映射 | 是否只处理 Sample A 前三 P0？ | [ ] | 问题映射 |
| 自测执行 | 是否真实重跑相关样片步骤？ | [ ] | 操作证据 |
| 范围边界与债务 | 未处理问题和复杂度债务是否保留？ | [ ] | debt 表 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-42/45 完成并提交
- Commit: `fix(production): remove top three RC workflow blockers`
- 分支: `fix/day-42-top-production-blockers`
- 基线 SHA:
- 结果 SHA:
- Sample A 证据路径:
- 实际 P0 数量:

## P0 修复表
| ID | 复现 | 根因 | 修改文件 | 失败测试 | 修复后测试 | 生产复验 | 状态 |
|---|---|---|---|---|---|---|---|

## 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration/E2E:
- `pnpm build`:
- Gate C 定向复验:

## 真实复验
- Sample A 受阻步骤:
- 保存重开:
- 预览:
- 导出/ffprobe:

## 未处理问题
- P0:
- P1:
- P2:

## 债务与回滚
- DEBT-COMPLEXITY-B42-001:
- DEBT-TEST-B42-001:
- 回滚: `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| SOURCE-B42-001 | P0 无 Sample A 证据 | 不修，退回问题分级 | 阻塞该项 |
| SCOPE-B42-001 | 修复需要大重构/新功能 | 停止并拆分后续工单 | 阻塞 |
| GATE-B42-001 | 修复破坏 Gate C | 回滚修复并重新设计 | 阻塞 |
| TEST-B42-001 | 无法自动化关键复现 | 可复现实测 + DEBT-TEST，不得假测 | 有条件交付 |
| COUNT-B42-001 | 少于三个真实 P0 | 只处理实际 P0，禁止凑数 | 正常收卷 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 42：Fix Top Production Blockers from Sample A**！

验收铁律：问题必须来自 Sample A；不升级凑数；先复现再修；每个修复有测试；只做最小改动；重跑真实生产流程和 Gate C 高风险路径；未处理问题不得消失。

Ouroboros 闭环启动，**B-42/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git diff --name-only
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
ffprobe -v error -print_format json -show_streams -show_format "<fixed-sample-a.mp4>"
git diff --stat
```
