# Panda Stage Agent Task — Day 13

> **工单编号**：B-13/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 13  
> **分支建议**：`feat/day-13-autosave-recovery`  
> **任务类型**：功能开发 + 数据恢复 + 定时状态管理  
> **唯一目标**：实现只在项目 dirty 时触发的 30 秒自动保存与崩溃恢复流程，并保证恢复副本不会静默覆盖正式项目。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Autosave + Recovery Detection + Crash Restore
- **轰炸目标**：基于 Day 12 的 ProjectService 和原子写入能力，建立 dirty-aware 自动保存、recovery 文件命名、启动检测、恢复/忽略选择与恢复后手动保存闭环。
- **任务性质**：功能开发 + 数据安全 + 生命周期管理
- **输入基线**：Day 12 已完成 create/open/save、项目目录结构与 `recovery/` 目录、原子保存和受控 Preload API。
- **输出要求**：自动保存与恢复可复现 + 计时器与并发保护测试 + 模拟异常退出证据 + 结构化收卷。
- **通用铁律**：
  1. 自动保存只写 recovery 副本，不直接覆盖正式 `project.json`。
  2. 只在 dirty 时触发，未修改项目不得重复写盘。
  3. 同一项目不得并发执行多个自动保存。
  4. 恢复成功后不得立刻覆盖正式项目，必须等待用户主动保存。
  5. “忽略恢复”不得无提示删除证据文件。

---

## 【模块2】输入基线（完整技术背景，零占位符）

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | Day 12 项目生命周期与原子保存集成测试通过 | Day 12 回执 + `pnpm test:integration` | 必须 |
| 当前状态 | Editor/Project state 中必须能判断 dirty；若尚无，应以最小方式补齐，不扩展编辑器 UI | 代码搜索 + 状态说明 | 必须 |
| 目标范围 | autosave scheduler、recovery persistence、启动检测、恢复 API、最小提示 UI、测试与文档 | `git diff --name-only` | 必须 |
| 当前缺口 | 无定时 recovery、无恢复候选检测、无恢复/忽略闭环 | `git grep -n "autosave\|recovery\|dirty" -- electron src shared tests` | 必须 |
| 目标结果 | dirty 项目 30 秒后产生 recovery；clean 项目不写；异常退出后启动可提示恢复；恢复内容与最后一次 autosave 一致 | fake timer test + integration/manual test | 必须 |
| 技术约束 | recovery 文件包含项目 ID 与时间戳；只使用整数毫秒时间；计时器可释放；写入串行化；恢复文件必须通过 ProjectSchema | 代码与测试 | 必须 |
| 风险边界 | 不做版本历史浏览器；不做无限快照；不做云备份；不做最近项目；不做复杂冲突合并 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁与 Day 12 integration 当前结果 | 实际命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-13.md`；同步 recovery 目录与恢复流程文档 | 文档 diff | 必须 |
| 历史债务 | 若 dirty 状态目前散落多个 store，必须最小收敛并声明，不得复制判断逻辑 | 决策记录 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 正式保存与 recovery 具有不同语义；恢复文件应晚于正式文件才具备提示价值。 |
| 待确认问题 | dirty 状态当前来源；应用启动时项目上下文何时可用；recovery 候选选择规则；计时器放 Main 还是 Renderer。 |
| 预期输出 | 一个不会重入、不会覆盖正式文件、可模拟崩溃验证的恢复流程。 |
| 停止条件 | dirty/clean、并发保护、恢复/忽略、异常退出四类路径全部有证据。 |

---

## 【模块3】工单矩阵（通用高压版）

### 1）基础信息

- **工单编号**：B-13/45
- **角色**：Engineer
- **目标**：完成 dirty-aware 自动保存与崩溃恢复闭环。
- **依赖关系**：依赖 Day 12 ProjectService 与 recovery 目录；无并行依赖。

### 2）输出交付物

- **预计变更文件**：
  - `electron/main/services/AutosaveService.ts`
  - `electron/main/services/ProjectService.ts`
  - `electron/main/ipc/handlers/recovery.ts`
  - `electron/preload/index.ts`
  - `shared/` 下 recovery 类型与 IPC 定义
  - `src/stores/` 下最小 dirty/recovery 状态
  - `src/features/recovery/` 下最小恢复提示（如现有 UI 架构允许）
  - `tests/unit/autosave*.test.ts`
  - `tests/integration/recovery*.test.ts`
  - `docs/test-receipts/DAY-13.md`
- **核心修改点**：
  - 30 秒周期调度；
  - dirty 为 false 时跳过；
  - 同一项目写入互斥/串行；
  - recovery 文件名含 project ID 与时间戳；
  - 启动/打开项目时比较 recovery 与正式文件更新时间；
  - 提供恢复与忽略；
  - 恢复内容只载入内存并标 dirty，不自动覆盖正式文件；
  - 正式保存成功后按明确策略清理过期 recovery；
  - 应用退出/切项目时释放计时器。
- **必须包含**：
  - fake timer 测试 30 秒触发；
  - clean 项目不写盘；
  - dirty 连续变化不会并发写入；
  - recovery 通过 schema 校验；
  - 恢复后内容等于最后一次 autosave；
  - 忽略后 recovery 仍保留或明确归档；
  - 正式保存后旧 recovery 清理策略有测试。
- **禁止包含**：
  - 自动覆盖正式项目；
  - 未修改项目每 30 秒写盘；
  - 多个未受控 interval；
  - 无限保留 recovery；
  - 用 `setTimeout` 作为测试等待 30 秒真实时间；
  - 云备份、版本树、冲突合并。
- **交付证明**：
  - fake timer 单测；
  - integration recovery 测试；
  - 模拟异常退出与重启手动证据；
  - recovery 文件路径与内容摘要；
  - 计时器释放与并发保护证据。

### 3）规模与复杂度观察

- Autosave scheduler、recovery 文件操作和 UI 提示应分层；不要把 interval、FS 和 React 状态塞进同一模块。
- 恢复候选规则应简单明确：项目 ID 匹配、schema 可解析、时间晚于正式文件。
- 若 dirty 状态整合需要跨多个 store，先只建立一个可信来源；如无法完全清偿，声明 `DEBT-STATE-B13-001`。

### 4）自动化质量闸门（强制）

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增 lint error | `pnpm lint` | 返工 |
| TEST | timer、dirty、并发、恢复 integration 测试通过 | `pnpm test:unit`；`pnpm test:integration` 或真实替代命令 | 返工 |
| ARCH | Renderer 不直接写 recovery 文件 | 静态搜索 + IPC 证据 | 返工 |
| REAL | 模拟异常退出后真实检测 recovery | 可复现实测步骤与截图/日志 | 返工 |
| DOC | recovery 流程文档和回执同步 | 文档 diff | 返工或声明债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | 检查点 ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | dirty 项目 30 秒后产生 recovery | fake timer + 文件断言 | [ ] |
| FUNC | FUNC-002 | clean 项目不重复写盘 | spy/mtime 断言 | [ ] |
| FUNC | FUNC-003 | 启动时识别更新 recovery | integration test | [ ] |
| FUNC | FUNC-004 | 恢复后内存内容正确且保持 dirty | store/integration test | [ ] |
| CONST | CONST-001 | recovery 文件带 project ID 与时间戳 | 文件名断言 | [ ] |
| CONST | CONST-002 | 同项目 autosave 不并发 | 并发/互斥测试 | [ ] |
| CONST | CONST-003 | recovery 通过 ProjectSchema 校验 | schema 测试 | [ ] |
| CONST | CONST-004 | 退出/切项目释放计时器 | fake timer/资源测试 | [ ] |
| NEG | NEG-001 | 损坏 recovery 不会覆盖正式项目 | integration test | [ ] |
| NEG | NEG-002 | recovery 写入失败给出明确错误 | 故障注入 | [ ] |
| NEG | NEG-003 | 忽略恢复不会静默删除证据 | 文件存在/归档断言 | [ ] |
| NEG | NEG-004 | 重复触发不会产生并发写入 | 高频 dirty 变化测试 | [ ] |
| UX | UX-001 | 恢复提示说明时间和项目 | UI/数据证据 | [ ] |
| UX | UX-002 | 恢复/忽略选择结果明确 | 手动或组件测试 | [ ] |
| E2E | E2E-001 | 修改→autosave→异常退出→重启→恢复 | 完整手动证据 | [ ] |
| High | HIGH-001 | 恢复流程任何情况下都不自动覆盖正式项目 | 文件 hash + integration test | [ ] |

---

## 【模块3-B】地狱红线（10 项）

1. 自动保存直接覆盖正式项目 → 返工。
2. clean 项目持续写盘 → 返工。
3. 同项目并发启动多个 autosave → 返工。
4. 恢复后立即自动覆盖正式文件 → 返工。
5. 忽略恢复时无提示删除 recovery → 返工。
6. 使用真实 30 秒等待代替 fake timer 测试 → 返工。
7. 损坏 recovery 导致应用白屏或覆盖正式项目 → 返工。
8. 顺手实现版本历史、云备份或复杂合并 → 范围失控。
9. 未模拟异常退出却声称恢复闭环完成 → 未验证。
10. 自动化门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测轻量检查表 v3.0

| 检查点 | 自检问题 | 覆盖情况 | 相关用例 | 备注 |
|---|---|---|---|---|
| CF | dirty autosave 与恢复标准路径是否完成？ | [ ] | CF-B13-001 | |
| RG | Day 12 正式保存是否仍保持原子安全？ | [ ] | RG-B13-001 | |
| NG | 损坏 recovery、写入失败、重复触发是否覆盖？ | [ ] | NG-B13-001 | |
| UX | 恢复/忽略是否可理解？ | [ ] | UX-B13-001 | |
| E2E | 异常退出后的恢复链路是否真实走通？ | [ ] | E2E-B13-001 | |
| High | 正式项目是否从未被 recovery 静默覆盖？ | [ ] | HIGH-B13-001 | |
| 字段完整性 | 回执是否记录 timer、路径、hash 与结果？ | [ ] | `DAY-13.md` | |
| 需求映射 | 验证是否覆盖 Day 13 全任务？ | [ ] | 刀刃表 | |
| 自测执行 | 是否跑过 fake timer + 手动崩溃恢复？ | [ ] | 测试与截图 | |
| 范围边界与债务 | dirty 单一来源问题是否申报？ | [ ] | 债务声明 | |

---

## 【模块5】收卷格式（强制结构）

```markdown
## ✅ 工单 B-13/45 完成并提交

### 提交信息
- Commit: `feat(project): add autosave and crash recovery workflow`
- 分支: `feat/day-13-autosave-recovery`
- 基线 SHA: `<真实输出>`
- 结果 SHA: `<真实输出>`
- 变更文件: [逐项列出]

### 本轮目标与实际结果
- 目标: dirty-aware autosave + crash recovery
- 实际完成: [真实结果]
- 未完成/不在范围: 版本历史、云备份、冲突合并

### 关键决策记录
- DECISION-001: [计时器所在层]
- DECISION-002: [recovery 命名与保留策略]
- DECISION-003: [恢复后不覆盖正式文件的状态设计]

### 自动化质量检查报告
- `pnpm typecheck`: [摘要]
- `pnpm lint`: [摘要]
- `pnpm test:unit`: [摘要]
- `pnpm test:integration`: [摘要]
- `pnpm build`: [摘要]
- fake timer 30 秒触发: [结果]
- 异常退出恢复: [结果]

### 债务声明
- DEBT-STATE-B13-001: [无 / 具体内容]
- DEBT-TEST-B13-001: [无 / 具体内容]
- DEBT-DOC-B13-001: [无 / 具体内容]

### 风险与回滚点
- 主要风险: 自动保存重入与 recovery 覆盖正式项目
- 回滚方式: `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| DATA-B13-001 | recovery 会自动覆盖正式项目 | 立即停止并重构恢复语义 | 阻塞 |
| TIMER-B13-001 | 多计时器/并发写入无法控制 | 收敛为单一 scheduler | 返工 |
| QUALITY-B13-001 | clean 项目仍持续写盘 | 修 dirty 判断 | 返工 |
| TEST-B13-001 | 无法模拟异常退出恢复 | 提供最小可复现实测并声明债务；不得声称全自动验证 | 有条件交付 |
| STATE-B13-001 | dirty 状态无法形成可信单一来源 | 暂停 UI 扩展，先收敛状态模型 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 13：Autosave + Recovery Detection + Crash Restore**！

### 验收铁律
- dirty 才写，clean 不写；
- 30 秒触发可用 fake timer 证明；
- 同项目不并发写；
- 恢复不自动覆盖正式项目；
- 异常退出后可检测、恢复或忽略；
- 默认质量门禁全通过。

Ouroboros 闭环启动，**B-13/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "autosave\|recovery\|dirty" -- electron src shared tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --stat
git diff -- electron/main/services/AutosaveService.ts electron/main/services/ProjectService.ts electron/main/ipc src/stores src/features/recovery tests docs
```
