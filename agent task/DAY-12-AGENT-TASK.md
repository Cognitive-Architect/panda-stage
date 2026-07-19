# Panda Stage Agent Task — Day 12

> **工单编号**：B-12/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 12  
> **分支建议**：`feat/day-12-project-lifecycle`  
> **任务类型**：功能开发 + 持久化安全  
> **唯一目标**：建立可靠的项目文件夹生命周期，完成新建、打开、校验、迁移与原子保存，并保证失败时不破坏原 `project.json`。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：ProjectService Create/Open/Save + Atomic Persistence
- **轰炸目标**：在 Main Process 中实现项目目录创建、schema 校验与迁移、相对路径持久化、临时文件写入与原子替换，并通过受控 Preload API 暴露给 Renderer。
- **任务性质**：功能开发 + 数据安全 + 集成测试
- **输入基线**：Day 11 已完成 `ProjectSchema v1`、版本检测与 migration framework；Gate A 已 PASS。
- **输出要求**：项目目录生命周期可复现 + 原子保存失败保护 + Unicode 路径验证 + integration test + 结构化收卷。
- **通用铁律**：
  1. Renderer 不得直接访问 `fs`、`path` 或 `child_process`。
  2. 保存必须先写同目录临时文件，再原子替换正式文件。
  3. 失败不得破坏旧 `project.json`，也不得留下“半截 JSON”。
  4. 项目数据只保存项目内相对路径，不写开发机绝对素材路径。
  5. 打开项目必须先检测版本、迁移、校验，再交给 UI。

---

## 【模块2】输入基线（完整技术背景，零占位符）

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 执行前记录分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | Gate A 必须为 PASS，Day 11 schema 测试必须通过 | Gate 文档 + `pnpm test:unit` | 必须 |
| 当前能力 | `ProjectSchema v1`、`detectSchemaVersion()`、`migrateProject()` 已存在 | `git grep -n "ProjectSchema\|detectSchemaVersion\|migrateProject" -- src shared` | 必须 |
| 目标范围 | Main Process 项目服务、文件系统服务、IPC handler、Preload API、集成测试与文档 | `git diff --name-only` | 必须 |
| 当前缺口 | 尚无正式项目目录创建、打开、原子保存和受控 project API | 代码搜索与现状说明 | 必须 |
| 目标结果 | 新建项目目录结构正确；打开时校验/迁移；保存中断不破坏旧文件；Unicode 路径通过 | integration test + 手动证据 | 必须 |
| 技术约束 | `.pandastage` 目录；自动创建 `assets/cache/exports/recovery`；相对路径；Main 唯一写盘；Zod 校验；错误类型可读 | 代码与测试 | 必须 |
| 风险边界 | 不做自动保存；不做最近项目；不做未保存提醒；不做素材导入 UI；不做云同步 | diff 审查 | 必须 |
| 测试基线 | 记录变更前默认质量门禁 | `pnpm typecheck`；`pnpm lint`；`pnpm test:unit`；`pnpm build` | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-12.md`，同步 `docs/architecture.md` / `docs/development.md` 的项目目录和保存协议 | 文档 diff | 必须 |
| 历史债务 | 若 Windows 上同目录 rename 语义与预期不同，必须用真实测试收敛，不得凭记忆写“原子” | integration test | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 项目 schema 已版本化；项目需要本地目录和项目内相对素材路径。 |
| 待确认问题 | 当前 Electron Main 服务布局；Windows 上替换已有文件的可靠步骤；临时文件命名与残留清理；错误分类方式。 |
| 预期输出 | `ProjectService.create/open/save` 与最小 Preload API。 |
| 停止条件 | 新建→修改→保存→关闭→重开成功，且受控写入失败不破坏旧文件。 |

---

## 【模块3】工单矩阵（通用高压版）

### 1）基础信息

- **工单编号**：B-12/45
- **角色**：Engineer
- **目标**：完成项目创建、打开与原子保存全链路。
- **依赖关系**：依赖 Day 11 schema 与 migration；无并行依赖。

### 2）输出交付物

- **预计变更文件**：
  - `electron/main/services/ProjectService.ts`
  - `electron/main/services/FileSystemService.ts`
  - `electron/main/ipc/handlers/project.ts`
  - `electron/preload/index.ts`
  - `src/types/electron-api.d.ts`
  - `shared/ipc-channels.ts`
  - `tests/integration/project-lifecycle.test.ts`
  - `tests/fixtures/projects/`
  - `docs/architecture.md`
  - `docs/development.md`
  - `docs/test-receipts/DAY-12.md`
- **核心修改点**：
  - `ProjectService.create(root, metadata)`；
  - 创建 `project.json` 与 `assets/cache/exports/recovery`；
  - `ProjectService.open(projectRoot)`：读取、版本检测、迁移、校验；
  - `ProjectService.save(projectRoot, project)`：schema 校验、写 `.tmp`、flush/close、原子替换；
  - 保存失败保留正式文件；
  - 统一路径工具，持久化项目内相对路径；
  - Preload 仅暴露 `project.create/open/save` 白名单接口；
  - 标准化错误码和用户可读信息。
- **必须包含**：
  - 新建目录已存在时的明确策略；
  - 无效 JSON 打开失败且不修改原文件；
  - 旧版 fixture 通过 migration 后打开；
  - 写入失败时旧 `project.json` hash 不变；
  - Unicode、空格路径 integration test；
  - Renderer 无原始 Node API。
- **禁止包含**：
  - Renderer 直接 `fs`；
  - 直接覆盖正式 JSON 后再“补救”；
  - 把绝对路径写进项目模型；
  - 保存失败仍返回 success；
  - 自动保存、最近项目、素材导入等后续范围。
- **交付证明**：
  - integration test 真实输出；
  - 新建目录树证据；
  - 失败前后正式文件 hash 对比；
  - Unicode 项目生命周期结果；
  - Preload API 静态证据。

### 3）规模与复杂度观察

- `ProjectService` 负责业务流程，`FileSystemService` 负责受控文件操作；不允许两边各写一套原子保存。
- IPC handler 只做参数校验、调用服务和错误映射，不承载业务逻辑。
- 若 Windows 替换语义需要“备份→替换→回滚”，必须记录状态机与失败恢复；如明显复杂，声明 `DEBT-COMPLEXITY-B12-001`。

### 4）自动化质量闸门（强制）

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增 lint error | `pnpm lint` | 返工 |
| TEST | 单元与项目生命周期集成测试通过 | `pnpm test:unit`；仓库对应 `pnpm test:integration` 或单独测试命令 | 返工 |
| ARCH | Renderer 无 FS；IPC 输入校验 | 静态搜索 + handler 测试 | 返工 |
| REAL | 保存失败前后正式文件 hash 一致 | 集成测试证据 | 返工 |
| DOC | 项目目录与保存协议文档同步 | 文档 diff | 返工或声明债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | 检查点 ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 新建项目目录结构正确 | integration test + 目录树 | [ ] |
| FUNC | FUNC-002 | 合法 v1 项目可打开 | integration test | [ ] |
| FUNC | FUNC-003 | v0 项目迁移后可打开 | migration integration test | [ ] |
| FUNC | FUNC-004 | 修改后原子保存并重开一致 | lifecycle test | [ ] |
| CONST | CONST-001 | Main Process 唯一写盘 | 静态搜索 | [ ] |
| CONST | CONST-002 | 项目只保存相对路径 | JSON fixture 与断言 | [ ] |
| CONST | CONST-003 | IPC 输入经过运行时校验 | handler 测试 / schema 证据 | [ ] |
| CONST | CONST-004 | 正式文件替换前先写临时文件 | diff + integration spy/证据 | [ ] |
| NEG | NEG-001 | 无效 JSON 不修改原文件 | hash 对比 | [ ] |
| NEG | NEG-002 | 写入中断保留旧文件 | 故障注入测试 | [ ] |
| NEG | NEG-003 | 目标目录不可写时报可读错误 | 受控失败测试 | [ ] |
| NEG | NEG-004 | 未知未来版本打开失败 | integration test | [ ] |
| UX | UX-001 | 错误包含项目路径与可理解原因 | 错误断言/截图 | [ ] |
| UX | UX-002 | Unicode 与空格路径正常 | Windows 实测 | [ ] |
| E2E | E2E-001 | 新建→修改→保存→重开完整通过 | lifecycle test + 手动验证 | [ ] |
| High | HIGH-001 | 任何失败都不破坏已有 `project.json` | 故障矩阵 + hash | [ ] |

---

## 【模块3-B】地狱红线（10 项）

1. Renderer 直接访问文件系统 → 返工。
2. 保存直接覆盖正式文件，无临时文件策略 → 返工。
3. 写入失败仍返回成功 → 返工。
4. 把开发机绝对素材路径写入项目 JSON → 返工。
5. 打开无效 JSON 时自动“修复”并覆盖原文件 → 返工。
6. 未运行故障注入测试却声称原子保存可靠 → 未验证。
7. Unicode 路径失败后改用英文路径绕过 → 返工。
8. 顺手实现自动保存或最近项目 → 范围失控。
9. IPC 接受未校验任意对象 → 返工。
10. 默认质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测轻量检查表 v3.0

| 检查点 | 自检问题 | 覆盖情况 | 相关用例 | 备注 |
|---|---|---|---|---|
| CF | create/open/save 三条标准路径是否通过？ | [ ] | CF-B12-001 | |
| RG | Day 11 schema/migration 是否保持全绿？ | [ ] | RG-B12-001 | |
| NG | 无效 JSON、不可写、写入中断、未来版本是否覆盖？ | [ ] | NG-B12-001 | |
| UX | 用户错误是否能看懂并定位项目？ | [ ] | UX-B12-001 | |
| E2E | 新建到重开是否完整跑通？ | [ ] | E2E-B12-001 | |
| High | 保存失败是否确实保护旧文件？ | [ ] | HIGH-B12-001 | |
| 字段完整性 | 回执是否记录路径、hash、命令和实际结果？ | [ ] | `DAY-12.md` | |
| 需求映射 | 验证是否覆盖 Day 12 全项？ | [ ] | 刀刃表 | |
| 自测执行 | 是否在真实 Unicode 路径运行？ | [ ] | Windows 证据 | |
| 范围边界与债务 | 平台原子替换限制是否申报？ | [ ] | 债务声明 | |

---

## 【模块5】收卷格式（强制结构）

```markdown
## ✅ 工单 B-12/45 完成并提交

### 提交信息
- Commit: `feat(project): add atomic create open and save lifecycle`
- 分支: `feat/day-12-project-lifecycle`
- 基线 SHA: `<执行前真实输出>`
- 结果 SHA: `<提交后真实输出>`
- 变更文件: [逐项列出]

### 本轮目标与实际结果
- 目标: 新建、打开、迁移与原子保存项目
- 实际完成: [真实结果]
- 未完成/不在范围: 自动保存、最近项目、素材导入 UI

### 关键决策记录
- DECISION-001: [项目目录结构]
- DECISION-002: [原子保存/替换策略]
- DECISION-003: [错误模型与 Preload API]

### 自动化质量检查报告
- `pnpm typecheck`: [摘要]
- `pnpm lint`: [摘要]
- `pnpm test:unit`: [摘要]
- `pnpm test:integration`: [摘要或真实替代命令]
- `pnpm build`: [摘要]
- 失败前后 project.json hash: [结果]
- Unicode 路径: [结果]

### 债务声明
- DEBT-COMPLEXITY-B12-001: [无 / 具体内容]
- DEBT-PLATFORM-B12-001: [无 / 具体内容]
- DEBT-TEST-B12-001: [无 / 具体内容]

### 风险与回滚点
- 主要风险: Windows 文件替换与写入中断
- 回滚方式: `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| DATA-B12-001 | 写入失败会破坏正式项目 | 停止所有后续 M1 工作，修原子保存 | 阻塞 |
| ARCH-B12-001 | Renderer 必须直接访问 FS | 修 Preload/IPC 边界 | 返工 |
| PATH-B12-001 | Unicode 路径不可用 | 修路径处理，不接受规避 | 阻塞 |
| QUALITY-B12-001 | 无效项目被静默修改 | 恢复只读失败策略 | 返工 |
| TEST-B12-001 | 无法故障注入验证保存安全 | 提供可复现实测并声明债务；不得写“已证明原子” | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 12：ProjectService Create/Open/Save + Atomic Persistence**！

### 验收铁律
- Main Process 唯一写盘；
- 保存先写临时文件再替换；
- 失败不破坏旧项目；
- 项目内只保存相对路径；
- Unicode 路径通过；
- 新建→保存→重开完整通过。

Ouroboros 闭环启动，**B-12/45**，执行！ ☝️🐍♾️🔥

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
git grep -n "node:fs\|child_process\|require('fs')" -- src
git diff --stat
git diff -- electron/main/services/ProjectService.ts electron/main/services/FileSystemService.ts electron/main/ipc/handlers/project.ts electron/preload/index.ts tests/integration docs
```
