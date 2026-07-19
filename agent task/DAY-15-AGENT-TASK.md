# Panda Stage Agent Task — Day 15

> **工单编号**：B-15/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 15  
> **分支建议**：`chore/day-15-m1-gate`  
> **任务类型**：集成回归 + Gate 验收 + 文档闭环  
> **唯一目标**：验证 M1 项目系统是否足以作为后续素材、画布和时间轴功能的可靠地基，并形成唯一、明确的 PASS 或 FAIL 结论。

---

## 【模块1】饱和攻击头部

- **火力配置**：1 Agent（Engineer）
- **任务名称**：M1 Project Lifecycle Gate + Regression Receipt
- **轰炸目标**：对 Day 11～14 的 schema、migration、create/open/save、autosave、recovery、最近项目、关闭保护和路径迁移进行完整回归，并输出 `docs/test-receipts/M1.md`。
- **任务性质**：集成回归 + 技术 Gate + 清债文档
- **输入基线**：Day 11～14 代码与回执已存在；Gate A 已 PASS。
- **输出要求**：自动化测试 + 手动端到端流程 + Unicode/移动目录/异常恢复证据 + 唯一 Gate 结论 + 债务声明。
- **通用铁律**：
  1. 结论只能是 `PASS` 或 `FAIL`，禁止写“基本通过”。
  2. 任一数据丢失、正式文件损坏、恢复覆盖正式项目、绝对路径绑死均直接判 FAIL。
  3. 未验证的高优先项按 FAIL 处理。
  4. 只修 M1 阻塞，不提前做素材导入或画布 UI。
  5. 所有数字、测试数量和路径结果必须来自真实命令与实际操作。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`、`git rev-parse HEAD` | 必须 |
| Gate 前置 | Gate A 为 PASS | `docs/test-receipts/GATE-A.md` | 必须 |
| Day 11 | ProjectSchema v1、migration、跨引用验证、round-trip | Day 11 回执 + unit tests | 必须 |
| Day 12 | 新建、打开、原子保存、Unicode 路径 | Day 12 回执 + integration tests | 必须 |
| Day 13 | dirty autosave、recovery 检测、恢复/忽略 | Day 13 回执 + timer/integration tests | 必须 |
| Day 14 | 最近项目、关闭三分支、项目移动重定位 | Day 14 回执 + integration/manual tests | 必须 |
| 目标结果 | M1 全部验收通过；无数据丢失；无绝对路径绑死；错误可理解；CI 全绿 | 自动化 + 手动证据 | 必须 |
| 风险边界 | 不新增素材 UI、角色系统、镜头编辑器、画布功能 | diff 审查 | 必须 |
| 测试基线 | 记录 Gate 前全部质量命令的真实输出 | typecheck/lint/unit/integration/build | 必须 |
| 文档同步 | 创建 `docs/test-receipts/M1.md`，必要时同步 architecture/development/known issues | 文档 diff | 必须 |
| 历史债务 | Day 11～14 已声明的 debt 必须逐条复核，不得在 Gate 文档中消失 | 回执与 debt 对照 | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | M1 的核心价值是“项目不丢、能保存、能恢复、能移动”。 |
| 待确认问题 | 哪些路径只能手动验证；当前 CI 是否运行 integration tests；Windows 文件替换和路径边界是否都已实测。 |
| 预期输出 | 一份可接管、可复现、可决定是否进入 M2 的 Gate 证据包。 |
| 停止条件 | 所有高优先级条款获得证据并明确 PASS/FAIL。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-15/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 11～14 全部完成；FAIL 时阻塞 Day 16～45 实际开发。

### 输出交付物

- **预计变更文件**：
  - `tests/integration/project-lifecycle.test.ts`
  - 必要 regression tests
  - `docs/test-receipts/M1.md`
  - 必要的 `docs/architecture.md`
  - 必要的 `docs/development.md`
  - 若 FAIL：`docs/decisions/M1-FAILURE-REPORT.md`
- **核心验证流程**：
  1. 运行 schema、migration、project lifecycle 全部自动化测试；
  2. 手动执行新建→修改→保存→关闭→重开；
  3. 模拟异常退出→重启→检测 recovery→恢复；
  4. 使用 Unicode + 空格路径；
  5. 移动/改名项目目录后重新定位并打开；
  6. 验证项目内素材/资源引用仍为相对路径；
  7. 验证最近项目失效路径不崩溃；
  8. 验证关闭保存/不保存/取消三分支；
  9. 汇总已知 debt 和未验证项。
- **必须包含**：
  - 全部自动化命令真实输出；
  - 正式 `project.json` 前后 hash 或等价完整性证据；
  - recovery 不覆盖正式项目的证据；
  - Unicode 路径结果；
  - 项目目录移动结果；
  - 最近项目与关闭保护结果；
  - CI 结果；
  - PASS/FAIL 唯一结论。
- **禁止包含**：
  - 未验证项写成 PASS；
  - 用英文路径代替 Unicode 路径；
  - 只跑 unit tests 不跑生命周期；
  - Gate FAIL 后继续 Day 16；
  - 顺手实现素材、角色、镜头或画布功能。
- **交付证明**：M1 回执、测试输出、操作步骤、截图/日志、项目样例、失败报告（如适用）。

### 规模与复杂度观察

- 本日以验证和最小阻塞修复为主，不进行大重构。
- 若发现多个结构性问题，不得边测边大改；应判 FAIL，创建 failure report，拆出后续修复工单。
- 若 integration test 基础设施不足，声明 `DEBT-TEST-B15-001`；高风险主路径未验证时 Gate 仍为 FAIL。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | Gate FAIL |
| TYPE | 类型检查通过 | `pnpm typecheck` | Gate FAIL |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | Gate FAIL |
| TEST | unit + integration 全部通过 | `pnpm test:unit`；`pnpm test:integration` 或真实替代命令 | Gate FAIL |
| ARCH | Renderer 无文件系统访问；项目只存相对路径 | 静态证据 + JSON 检查 | Gate FAIL |
| REAL | 新建、保存、恢复、移动路径真实执行 | 操作证据 | Gate FAIL |
| DOC | M1 回执完整且结论明确 | `docs/test-receipts/M1.md` | Gate FAIL |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | schema 与 migration 全部通过 | unit tests | [ ] |
| FUNC | FUNC-002 | 新建→保存→关闭→重开一致 | lifecycle test | [ ] |
| FUNC | FUNC-003 | 异常退出后可检测并恢复 | integration/manual | [ ] |
| FUNC | FUNC-004 | 最近项目与关闭保护可用 | integration/manual | [ ] |
| CONST | CONST-001 | 项目内只存相对路径 | JSON 检查 | [ ] |
| CONST | CONST-002 | 原子保存保护旧文件 | hash/故障注入 | [ ] |
| CONST | CONST-003 | recovery 不自动覆盖正式项目 | 文件对比 | [ ] |
| CONST | CONST-004 | Day 11～14 debt 全部被汇总 | 文档对照 | [ ] |
| NEG | NEG-001 | 无效项目不修改原文件 | integration test | [ ] |
| NEG | NEG-002 | Unicode + 空格路径通过 | Windows 实测 | [ ] |
| NEG | NEG-003 | 项目移动/改名后可重新定位 | 真实目录操作 | [ ] |
| NEG | NEG-004 | 保存失败时窗口不关闭 | 故障注入 | [ ] |
| UX | UX-001 | 错误提示可理解并指向下一步 | UI/日志证据 | [ ] |
| UX | UX-002 | 恢复、忽略、取消关闭含义清晰 | UI 证据 | [ ] |
| E2E | E2E-001 | 新建到恢复再移动项目完整闭环 | 完整验收记录 | [ ] |
| High | HIGH-001 | 无数据丢失、损坏或绝对路径绑死 | 全量证据汇总 | [ ] |

---

## 【模块3-B】地狱红线

1. 任一数据丢失仍判 PASS → 严重违规。
2. 正式项目文件可能损坏仍判 PASS → 严重违规。
3. recovery 自动覆盖正式文件仍判 PASS → 严重违规。
4. 项目移动后失效仍判 PASS → 返工。
5. Unicode 路径未验证却判 PASS → 返工。
6. 未跑 integration tests 只跑 unit tests → 不得 PASS。
7. 未验证项用“应该没问题”代替证据 → 返工。
8. Gate FAIL 后继续 M2 → 严重违规。
9. 债务在 M1 回执中被隐藏 → 返工。
10. 为了过 Gate 降低原验收标准 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | M1 主能力是否全部通过？ | [ ] | CF-B15-001 |
| RG | Day 11～14 是否完整回归？ | [ ] | RG-B15-001 |
| NG | 损坏、失败、Unicode、移动路径是否覆盖？ | [ ] | NG-B15-001 |
| UX | 错误、恢复、关闭提示是否清晰？ | [ ] | UX-B15-001 |
| E2E | 完整项目生命周期是否跑通？ | [ ] | E2E-B15-001 |
| High | 是否证明无数据丢失与路径绑死？ | [ ] | HIGH-B15-001 |
| 字段完整性 | M1 回执是否包含全部命令与证据？ | [ ] | M1.md |
| 需求映射 | 是否逐条映射 Day 11～15？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实执行手动全流程？ | [ ] | 操作证据 |
| 范围边界与债务 | 未验证与 debt 是否显式列出？ | [ ] | 债务章节 |

---

## 【模块5】收卷格式

```markdown
# M1 Gate — Project Lifecycle

## 结论
- Result: PASS / FAIL
- 执行分支:
- 基线 SHA:
- 结果 SHA:
- Gate A: PASS（证据路径）

## 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- `pnpm test:integration`:
- `pnpm build`:
- CI:

## 生命周期验收
| 项目 | 结果 | 证据 |
|---|---|---|
| Schema / Migration | PASS/FAIL | |
| 新建 / 打开 / 保存 | PASS/FAIL | |
| 原子保存失败保护 | PASS/FAIL | |
| Autosave / Recovery | PASS/FAIL | |
| 最近项目 | PASS/FAIL | |
| 关闭三分支 | PASS/FAIL | |
| Unicode 路径 | PASS/FAIL | |
| 项目移动重定位 | PASS/FAIL | |
| 相对素材路径 | PASS/FAIL | |

## 数据安全
- 是否发生数据丢失:
- 正式 project.json 是否被损坏:
- recovery 是否覆盖正式项目:
- 是否存在绝对路径绑死:

## 债务与未验证项
- DEBT-TEST-B15-001:
- DEBT-PLATFORM-B15-001:
- 继承自 Day 11～14 的债务:

## 决策
- PASS：允许进入 Day 16。
- FAIL：冻结 Day 16～45 的实际开发，只允许修复 M1，并创建 `docs/decisions/M1-FAILURE-REPORT.md`。
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| DATA-B15-001 | 数据丢失或正式文件损坏 | 立即判 FAIL，冻结 M2 | 阻塞 |
| PATH-B15-001 | Unicode 或移动项目失败 | 判 FAIL，修路径与相对引用 | 阻塞 |
| RECOVERY-B15-001 | recovery 可能覆盖正式项目 | 判 FAIL，修恢复语义 | 阻塞 |
| QUALITY-B15-001 | CI 或核心自动化失败 | 判 FAIL | 阻塞 |
| TEST-B15-001 | 高风险主路径未验证 | 不允许降级为 PASS | FAIL |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 15：M1 Project Lifecycle Gate**！

验收铁律：无数据丢失；无正式文件损坏；无绝对路径绑死；Unicode 和项目移动通过；恢复与关闭保护通过；CI 全绿；结论只能 PASS 或 FAIL。

Ouroboros 闭环启动，**B-15/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
git log --oneline -n 15
```
