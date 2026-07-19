# Panda Stage Agent Task — Day 14

> **工单编号**：B-14/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 14  
> **分支建议**：`feat/day-14-recent-projects`  
> **唯一目标**：补齐最近项目、未保存关闭提醒和项目移动后的重新定位能力。

---

## 【模块1】饱和攻击头部

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Recent Projects + Unsaved Close Guard + Project Relocation
- **轰炸目标**：建立应用级最近项目列表、保存/不保存/取消三分支关闭流程，以及项目目录移动或改名后的重新定位。
- **任务性质**：功能开发 + 路径回归 + UX 保护
- **输入基线**：Day 12 已完成项目新建/打开/原子保存；Day 13 已完成 dirty、autosave 与 recovery。
- **输出要求**：可运行能力 + 自动化证据 + 16 项刀刃表 + 债务声明 + 结构化收卷。
- **通用铁律**：
  1. 最近项目数据属于应用配置，不写入项目目录。
  2. dirty 关闭必须支持保存、不保存、取消。
  3. 取消关闭必须真正阻止退出。
  4. 项目重新定位不得破坏项目内相对素材路径。
  5. 路径失效时不得崩溃或静默删除记录。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD | `git branch --show-current`、`git rev-parse HEAD` | 必须 |
| 前置能力 | Day 12/13 回执和测试通过 | 回执路径 + 命令输出 | 必须 |
| 目标范围 | 最近项目服务、路径工具、关闭流程、最小 UI、测试与文档 | `git diff --name-only` | 必须 |
| 当前缺口 | 尚无最近项目列表、完整关闭保护和移动项目重定位 | 代码搜索 + 现象复现 | 必须 |
| 目标结果 | 最近项目可打开；失效路径可处理；关闭三分支正确；项目移动后可重新定位 | 自动化 + 手动证据 | 必须 |
| 技术约束 | 最近项目存 app userData；统一路径规范化；关闭流程防重入；项目内仍使用相对路径 | 代码与测试 | 必须 |
| 风险边界 | 不做云同步、文件监控、自动扫描磁盘、素材库 UI | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁真实结果 | `pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm build` | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-14.md` | 文档 diff | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 最近项目是应用级状态；项目素材使用相对路径。 |
| 待确认问题 | app userData 当前位置；窗口关闭事件链；Windows 路径规范化边界。 |
| 预期输出 | 最小、稳定、可恢复的最近项目和关闭保护流程。 |
| 停止条件 | 三分支关闭、失效路径、项目移动和相对路径回归全部通过。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-14/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 12 项目服务与 Day 13 dirty/recovery。

### 输出交付物

- **预计变更文件**：
  - `electron/main/services/RecentProjectsService.ts`
  - `electron/main/services/PathService.ts`
  - 窗口生命周期模块
  - `electron/main/ipc/handlers/recent-projects.ts`
  - `electron/preload/index.ts`
  - `shared/` 下最近项目与关闭结果类型
  - `src/features/welcome/`
  - `src/features/project/`
  - 对应 unit/integration tests
  - `docs/test-receipts/DAY-14.md`
- **核心修改点**：
  - 最近项目增删改查、去重和失效标记；
  - 项目打开成功后更新最近记录；
  - dirty 关闭时处理保存/不保存/取消；
  - 保存失败时保持窗口打开；
  - 项目移动后重新选择目录并恢复；
  - 统一路径规范化。
- **必须包含**：
  - 最近项目可打开；
  - 重复路径去重；
  - 失效路径不崩溃；
  - 保存、不保存、取消三分支测试；
  - 保存失败不得关闭；
  - 项目移动后重新定位成功；
  - Windows 路径边界测试；
  - 最近项目配置不写入项目目录。
- **禁止包含**：
  - 云同步、自动扫描、文件监控；
  - 静默删除失效记录；
  - 取消后仍退出；
  - 改写为绝对素材路径；
  - Day 16+ 素材功能。
- **交付证明**：配置位置、三分支证据、移动项目证据、相对路径前后对比、路径测试结果。

### 规模与复杂度观察

- 最近项目存储、路径规范化和窗口关闭编排分离职责。
- 关闭流程允许小型状态机，但必须防重复弹窗和重入。
- 平台路径限制需声明 `DEBT-PLATFORM-B14-001`。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 最近项目、路径、关闭三分支与移动项目测试通过 | `pnpm test:unit` + integration 测试 | 返工 |
| ARCH | 最近项目仅存 app data；Renderer 无文件系统访问 | 静态证据 | 返工 |
| REAL | 真实移动项目后可重新定位 | 可复现实测 | 返工 |
| DOC | 回执同步 | 文档 diff | 返工或声明 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 打开项目后进入最近列表 | integration test | [ ] |
| FUNC | FUNC-002 | 最近项目可重新打开 | 手动/组件测试 | [ ] |
| FUNC | FUNC-003 | dirty 关闭选择保存后正确退出 | integration test | [ ] |
| FUNC | FUNC-004 | 项目移动后可重新定位 | 真实目录移动测试 | [ ] |
| CONST | CONST-001 | 最近项目存 app userData | 配置路径证据 | [ ] |
| CONST | CONST-002 | 重复路径被去重 | 单元测试 | [ ] |
| CONST | CONST-003 | 项目内素材继续用相对路径 | JSON 对比 | [ ] |
| CONST | CONST-004 | 路径规范化使用单一工具 | diff 审查 | [ ] |
| NEG | NEG-001 | 失效路径不崩溃 | integration test | [ ] |
| NEG | NEG-002 | 取消关闭确实阻止退出 | 生命周期测试 | [ ] |
| NEG | NEG-003 | 保存失败时窗口保持打开 | 故障注入 | [ ] |
| NEG | NEG-004 | 失效记录不静默删除 | 配置断言 | [ ] |
| UX | UX-001 | 三种关闭动作含义清楚 | UI 证据 | [ ] |
| UX | UX-002 | 失效项目可移除或重新定位 | UI 证据 | [ ] |
| E2E | E2E-001 | 打开→修改→取消关闭→保存关闭 | 完整流程 | [ ] |
| High | HIGH-001 | 项目移动后素材仍有效 | 重定位后检查 | [ ] |

---

## 【模块3-B】地狱红线

1. 最近项目数据写入项目目录 → 返工。
2. dirty 关闭没有取消路径 → 返工。
3. 用户取消后仍退出 → 返工。
4. 保存失败仍关闭 → 返工。
5. 路径失效导致崩溃 → 返工。
6. 静默删除记录 → 返工。
7. 重新定位后改为绝对素材路径 → 返工。
8. 顺手做云同步、监控或素材库 → 范围失控。
9. 未做真实目录移动测试却声称通过 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 最近项目与三分支关闭是否可用？ | [ ] | CF-B14-001 |
| RG | Day 12/13 能力是否保持？ | [ ] | RG-B14-001 |
| NG | 失效路径、保存失败、取消关闭是否覆盖？ | [ ] | NG-B14-001 |
| UX | 重定位与提示是否可理解？ | [ ] | UX-B14-001 |
| E2E | 完整关闭流程是否走通？ | [ ] | E2E-B14-001 |
| High | 移动后相对素材是否有效？ | [ ] | HIGH-B14-001 |
| 字段完整性 | 回执是否完整？ | [ ] | DAY-14.md |
| 需求映射 | 是否映射 Day 14？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实移动项目？ | [ ] | 实测证据 |
| 范围边界与债务 | 平台限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-14/45 完成并提交
- Commit: `feat(project): add recent projects and unsaved-close protection`
- 分支: `feat/day-14-recent-projects`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 最近项目:
- 保存/不保存/取消:
- 保存失败保护:
- 项目移动重定位:
- 相对素材路径:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration tests:
- `pnpm build`:

### 决策与债务
- DECISION-001:
- DECISION-002:
- DEBT-PLATFORM-B14-001:
- DEBT-TEST-B14-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| DATA-B14-001 | 保存失败仍可能关闭窗口 | 停止并修关闭编排 | 阻塞 |
| PATH-B14-001 | 移动项目后只能靠绝对路径修复 | 修相对路径策略 | 返工 |
| STATE-B14-001 | 关闭事件重复弹窗 | 增加单一状态机与重入锁 | 返工 |
| QUALITY-B14-001 | 失效路径导致崩溃 | 修错误路径 | 返工 |
| TEST-B14-001 | 无真实 Windows 环境 | 声明债务，不得判完全通过 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 14：Recent Projects + Unsaved Close Guard + Project Relocation**！

验收铁律：最近项目存应用配置；三分支关闭正确；取消必须留在应用；保存失败不得退出；项目移动后可重新定位；相对素材路径保持有效。

Ouroboros 闭环启动，**B-14/45**，执行！ ☝️🐍♾️🔥

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
```
