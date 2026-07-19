# Panda Stage Agent Task — Day 24

> **工单编号**：B-24/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 24  
> **分支建议**：`feat/day-24-history`  
> **任务类型**：功能开发 + 状态机 + 回归安全  
> **唯一目标**：建立命令式撤销/重做系统，使移动、变换、删除、层级、表情等操作可恢复，并将连续拖动合并为一步历史。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Command History + Undo/Redo + Drag Coalescing
- **轰炸目标**：实现 HistoryStore、before/after 命令、undo/redo、拖动合并、redo 清空、项目切换清空与至少 20 步历史。
- **任务性质**：功能开发 + 状态管理 + 回归测试
- **输入基线**：Day 22/23 已有图层移动、属性编辑、变换、删除、层级和表情切换操作。
- **输出要求**：核心操作可撤销重做，拖动 10 次只形成 1 条历史，历史不进入项目文件。
- **通用铁律**：
  1. 历史记录存编辑器状态，不得序列化进 `project.json`。
  2. 拖动过程不能每帧生成历史，只在完整手势结束时提交一个命令。
  3. 执行新命令后必须清空 redo 栈。
  4. 打开或新建另一个项目时必须清空旧历史。
  5. undo/redo 必须重放真实状态变化，不允许仅改 UI 假装成功。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | Day 22/23 操作与保存重开测试通过 | 回执 + 测试结果 | 必须 |
| 当前状态 | 盘点 project store actions、dirty 更新、拖动临时状态和删除/层级实现 | `git grep -n "moveLayer\|updateLayer\|deleteLayer\|reorder\|expression\|dirty" -- src tests` | 必须 |
| 目标范围 | HistoryStore、command 类型、操作适配、快捷键、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 20 步历史；拖动合并；删除可恢复；redo 一致；新操作清 redo；项目切换清历史 | unit/component/integration/manual evidence | 必须 |
| 技术约束 | command 包含 before/after 或等价可逆信息；项目快照不可无界复制；快捷键仅作用当前编辑器 | 代码与测试 | 必须 |
| 风险边界 | 不做跨会话历史；不把历史保存进项目；不做协同编辑；不做通用事件溯源框架 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 22/23 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-24.md`，同步历史语义与快捷键 | 文档 diff | 必须 |
| 历史债务 | 若当前 actions 旁路 store 直接改对象，必须先收敛必要写入口 | diff 与决策记录 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 图层操作已有明确 before/after；拖动已在 drag end 才提交持久状态。 |
| 待确认问题 | store 技术栈；命令保存差量还是局部快照；历史上限；属性输入提交边界。 |
| 预期输出 | 一个简单、可预测、不会污染项目文件的编辑历史系统。 |
| 停止条件 | 移动、变换、删除、层级、表情五类操作与边界测试全部通过。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-24/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 22/23 所有可编辑操作。

### 输出交付物

- **预计变更文件**：
  - `src/history/HistoryCommand.ts`
  - `src/history/HistoryStore.ts`
  - `src/history/commands/LayerCommands.ts`
  - `src/features/editor/useHistoryShortcuts.ts`
  - `src/stores/projectStore.ts`
  - Day 22/23 相关 action 适配文件
  - 对应 unit/component/integration tests
  - `docs/test-receipts/DAY-24.md`
- **核心修改点**：
  - `execute(command)` / `undo()` / `redo()`；
  - before/after 或等价可逆 payload；
  - 最大历史深度至少 20；
  - drag coalescing；
  - 属性输入在 blur/Enter 提交；
  - 新命令清 redo；
  - 新建/打开项目清空历史；
  - 删除、层级、表情、位置、缩放、旋转、翻转进入历史；
  - Ctrl+Z、Ctrl+Y 或 Ctrl+Shift+Z；
  - dirty 状态与历史重放一致。
- **必须包含**：
  - 连续拖动 10 次只需 undo 一次回到起点；
  - 删除图层可撤销；
  - undo 后 redo 恢复同一结果；
  - undo 后执行新操作，redo 为空；
  - 空栈 undo/redo 安全；
  - 打开新项目后旧历史清空；
  - 历史不写入 project.json；
  - locked 图层不会因历史旁路保护；
  - 至少 20 步可用；
  - 属性输入不按每个按键生成历史。
- **禁止包含**：
  - 整个应用状态无界深拷贝；
  - 每次 pointermove 生成命令；
  - 历史写入项目文件；
  - undo 只改变 UI 不改项目；
  - 为历史引入通用事件总线/事件溯源平台；
  - 提前实现时间轴或动作预设。
- **交付证明**：HistoryStore 单测、拖动合并 spy、删除与变换 undo/redo、20 步边界、项目切换、JSON 断言、快捷键手动证据。

### 规模与复杂度观察

- 命令模型保持局部、明确，不为未来所有业务预建复杂框架。
- 如局部快照比字段差量更安全，可使用必要快照，但必须有大小与上限说明。
- coalescing 规则必须基于同一目标、同一操作类型与同一手势，不得误合并独立操作。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 历史、合并、边界、项目切换与 JSON 测试通过 | unit/component/integration tests | 返工 |
| ARCH | 历史不持久化；命令重放走正式数据 action | 静态搜索 + JSON 断言 | 返工 |
| REAL | 快捷键与真实拖动/删除可撤销 | `pnpm dev` 手动证据 | 返工 |
| DOC | 历史规则和回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | undo/redo 标准路径可用 | HistoryStore tests | [ ] |
| FUNC | FUNC-002 | 连续拖动合并为一步 | coalescing test | [ ] |
| FUNC | FUNC-003 | 删除、层级、表情可撤销 | command tests | [ ] |
| FUNC | FUNC-004 | 快捷键触发正确 | component/manual | [ ] |
| CONST | CONST-001 | 历史深度至少 20 | boundary test | [ ] |
| CONST | CONST-002 | 新命令清空 redo | unit test | [ ] |
| CONST | CONST-003 | 项目切换清空历史 | integration test | [ ] |
| CONST | CONST-004 | 历史不写 project.json | JSON 断言 | [ ] |
| NEG | NEG-001 | 空栈 undo/redo 安全 | unit test | [ ] |
| NEG | NEG-002 | 锁定保护不被历史旁路 | negative test | [ ] |
| NEG | NEG-003 | 独立拖动不被错误合并 | coalescing boundary | [ ] |
| NEG | NEG-004 | 属性输入不按键逐条入栈 | action count spy | [ ] |
| UX | UX-001 | undo/redo 禁用状态正确 | UI 证据 | [ ] |
| UX | UX-002 | 快捷键与按钮结果一致 | component/manual | [ ] |
| E2E | E2E-001 | 拖动→删除→undo→redo→保存 | 完整流程 | [ ] |
| High | HIGH-001 | 10 次拖动仅 1 次 undo 回起点 | 实测与断言 | [ ] |

---

## 【模块3-B】地狱红线

1. 每个 pointermove 生成历史 → 返工。
2. 历史进入 project.json → 返工。
3. undo 只改 UI 不改项目数据 → 返工。
4. 新操作后 redo 仍保留旧分支 → 返工。
5. 打开新项目继承旧历史 → 返工。
6. 锁定保护被 undo/redo 绕过 → 返工。
7. 无界保存整个应用状态 → 返工。
8. 顺手搭建通用事件溯源平台 → 范围失控。
9. 未做 20 步与空栈边界测试 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 核心编辑操作是否可 undo/redo？ | [ ] | CF-B24-001 |
| RG | Day 22/23 操作是否保持一致？ | [ ] | RG-B24-001 |
| NG | 空栈、分支、锁定和项目切换是否覆盖？ | [ ] | NG-B24-001 |
| UX | 按钮与快捷键状态是否清楚？ | [ ] | UX-B24-001 |
| E2E | 多操作历史流程是否完整？ | [ ] | E2E-B24-001 |
| High | 拖动合并是否单独验证？ | [ ] | HIGH-B24-001 |
| 字段完整性 | 回执是否记录命令数和结果？ | [ ] | DAY-24.md |
| 需求映射 | 是否覆盖 Day 24 全项？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实执行 20 步与快捷键？ | [ ] | 操作证据 |
| 范围边界与债务 | 快照大小/复杂度是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-24/45 完成并提交
- Commit: `feat(history): add command-based undo redo with drag coalescing`
- 分支: `feat/day-24-history`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- undo/redo:
- 拖动合并:
- 删除/层级/表情:
- 属性输入提交:
- 20 步边界:
- 项目切换:
- project.json 排除历史:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component/integration tests:
- `pnpm build`:
- `pnpm dev`:

### 决策与债务
- DECISION-001: [命令数据结构]
- DECISION-002: [coalescing 规则]
- DEBT-PERF-B24-001:
- DEBT-TEST-B24-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| STATE-B24-001 | undo/redo 产生不可预测项目状态 | 停止并收敛命令模型 | 阻塞 |
| PERF-B24-001 | 历史快照导致明显内存回退 | 改用局部 payload/上限 | 返工 |
| COALESCE-B24-001 | 独立操作被错误合并 | 修手势边界 | 返工 |
| DATA-B24-001 | 历史写入项目文件 | 移出序列化模型 | 阻塞 |
| TEST-B24-001 | 无法自动验证拖动合并 | 补 action spy 与可复现实测 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 24：Command History + Undo/Redo + Drag Coalescing**！

验收铁律：至少 20 步；拖动 10 次只撤销 1 次；删除可恢复；新操作清 redo；项目切换清历史；历史不进入项目文件。

Ouroboros 闭环启动，**B-24/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "HistoryStore\|HistoryCommand\|undo\|redo\|coalesc" -- src tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
```
