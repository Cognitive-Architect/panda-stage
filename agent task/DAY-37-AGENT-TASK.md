# Panda Stage Agent Task — Day 37

> **工单编号**：B-37/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 37  
> **分支建议**：`test/day-37-regression-suite`  
> **任务类型**：测试建设 + 桌面 E2E + CI 分层  
> **唯一目标**：补齐领域、集成与 Playwright 桌面冒烟测试，把关键流程从依赖人工记忆升级为可重复自动回归。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Domain + Integration + Playwright Desktop Regression Suite
- **轰炸目标**：覆盖 schema/migration、evaluator、事件冲突、项目生命周期、素材导入、演示项目、新建保存重开和短导出探针，并接入 CI 或 nightly 分层。
- **任务性质**：测试建设 + 基础设施 + 回归保护
- **输入基线**：Gate C PASS；Day 36 演示项目可打开、预览和导出；现有 unit/integration 测试命令与 Electron 启动方式可用。
- **输出要求**：核心纯逻辑边界测试 + 项目生命周期集成回归 + 至少一条桌面 E2E + 失败可定位 + CI 分层清楚 + 16 项刀刃表。
- **通用铁律**：
  1. 测试必须验证真实行为，禁止用大面积 snapshot 或硬编码成功掩盖错误。
  2. E2E 优先使用稳定定位符和正式 UI，不通过开发者接口直接改状态。
  3. 测试数据、临时目录和输出文件必须隔离并在结束后清理。
  4. flake 不能靠无上限重试掩盖；必须定位时序或资源根因。
  5. 测试结果、数量和耗时只能来自真实命令输出。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | Gate C PASS，Day 36 回执存在 | Gate/回执文件 | 必须 |
| 当前测试 | 盘点 Vitest、integration、Playwright、CI 脚本与测试目录 | `git grep -n "vitest\|playwright\|test:e2e\|test:integration" -- package.json .github tests playwright.config.* vitest.config.*` | 必须 |
| 目标范围 | unit、integration、desktop E2E、fixtures、CI workflow、文档与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 核心逻辑有边界；项目生命周期自动回归；桌面启动/演示/新建保存重开/短导出至少覆盖主路径 | test outputs/artifacts | 必须 |
| 技术约束 | 测试隔离；稳定 selectors；受控 fixture；失败截图/trace/log；短导出探针；Windows 可执行 | 配置与测试 | 必须 |
| 风险边界 | 不追求虚假覆盖率；不大面积 snapshot；不测第三方库内部实现；不在本日修无关功能 | diff 审查 | 必须 |
| 测试基线 | 先运行现有命令并记录真实结果 | `pnpm test:unit`；仓库实际 integration/E2E 命令 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-37.md`，更新测试运行说明 | 文档 diff | 必须 |
| 历史债务 | flaky、未覆盖平台路径和旧 skipped tests 必须列出 | 测试清单 | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 核心风险集中在项目数据、求值器、导出和 Windows 桌面流程。 |
| 待确认问题 | Playwright Electron 配置；CI 是否具备 Windows runner；短导出 fixture 时长；测试选择器现状。 |
| 预期输出 | 速度可接受、失败可诊断、覆盖核心闭环的分层回归套件。 |
| 停止条件 | unit、integration、desktop smoke 与 CI 分层全部有实际运行证据。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-37/45
- **角色**：Engineer
- **依赖关系**：依赖 Gate C PASS 与 Day 36 演示项目。

### 输出交付物

- **预计变更文件**：
  - `tests/unit/models/*`
  - `tests/unit/evaluators/*`
  - `tests/integration/project-lifecycle/*`
  - `tests/integration/asset-import/*`
  - `tests/e2e/app-launch.spec.ts`
  - `tests/e2e/demo-preview.spec.ts`
  - `tests/e2e/project-lifecycle.spec.ts`
  - `tests/e2e/export-probe.spec.ts`
  - `playwright.config.ts`
  - 测试 fixtures/helpers
  - `.github/workflows/ci.yml` 或独立 E2E workflow
  - `docs/development.md`
  - `docs/test-receipts/DAY-37.md`
- **核心修改点**：
  - schema 与 migration 正常/非法/边界；
  - evaluator/interpolator 与事件冲突；
  - 项目新建、原子保存、重开、recovery；
  - 素材导入、重复、坏文件、Unicode 路径；
  - Electron 启动与窗口可见；
  - 打开演示项目并完成预览；
  - 新建项目、保存、关闭、重开；
  - 受控 3～5 秒短导出探针；
  - 失败时收集 screenshot、trace、console/main logs；
  - CI 中 unit/integration 常规运行，E2E 按 Windows job 或 nightly 分层。
- **必须包含**：
  - evaluator 0/start/end/末尾边界；
  - migration round-trip 与未知版本；
  - 非法事件冲突；
  - 原子保存失败保留原文件；
  - Unicode/空格项目和素材路径；
  - 桌面应用至少一条真实启动冒烟；
  - 演示项目打开并预览；
  - 新建→保存→关闭→重开；
  - 短导出产物存在且 ffprobe 可验证，若 CI 无 FFmpeg 则明确 N/A + 替代层；
  - 每个 E2E 使用独立临时用户数据目录；
  - 测试结束清理进程和临时目录；
  - 失败产物有明确保存路径；
  - 禁止大面积更新 snapshot 作为修复。
- **禁止包含**：
  - `test.skip`/`only` 遗留而不申报；
  - 无上限重试；
  - 通过直接写 store/project JSON 代替 UI E2E；
  - 固定机器绝对路径；
  - 依赖开发机已有全局 FFmpeg/Node；
  - 为凑覆盖率测试第三方实现细节。
- **交付证明**：真实命令输出、测试清单、E2E trace/screenshot、临时目录清理证据、CI workflow diff、失败示例可定位说明。

### 规模与复杂度观察

- 测试按速度分层：unit 最快、integration 次之、desktop E2E 最少但覆盖关键闭环。
- 通用 helper 只抽取真正重复的启动、临时目录和等待逻辑，不建庞大测试框架。
- UI 等待使用可观察状态，不使用任意长 `sleep`；确需等待时说明原因和上限。
- 若 Electron E2E 在 CI 受 runner 限制，声明 `DEBT-CI-B37-001` 并建立 nightly/手动触发，而不是伪装全自动。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式检查通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | unit、integration、E2E 实际通过 | `pnpm test:unit` + 仓库实际命令 | 返工 |
| ARCH | E2E 走正式 UI；fixtures 隔离；无固定绝对路径 | 静态检查 + tests | 返工 |
| REAL | Windows 桌面冒烟真实运行 | Playwright artifacts | 返工 |
| DOC | 测试命令、CI 分层和回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | schema/migration 边界测试齐全 | unit output | [ ] |
| FUNC | FUNC-002 | evaluator/interpolator/conflict 测试齐全 | unit output | [ ] |
| FUNC | FUNC-003 | project/asset integration 可重复 | integration output | [ ] |
| FUNC | FUNC-004 | 桌面启动、演示、保存重开和短导出 E2E | Playwright output | [ ] |
| CONST | CONST-001 | E2E 使用正式 UI 和稳定 selectors | code review | [ ] |
| CONST | CONST-002 | fixtures/用户数据目录隔离 | path assertions | [ ] |
| CONST | CONST-003 | 失败保留 trace/screenshot/log | artifact evidence | [ ] |
| CONST | CONST-004 | CI 分层与本地命令一致 | workflow evidence | [ ] |
| NEG | NEG-001 | 原子保存失败路径自动覆盖 | integration test | [ ] |
| NEG | NEG-002 | Unicode/空格路径自动覆盖 | integration/E2E | [ ] |
| NEG | NEG-003 | 测试结束无残留进程/temp | cleanup evidence | [ ] |
| NEG | NEG-004 | 无遗留 skip/only/无限重试 | static search | [ ] |
| UX | UX-001 | 测试失败信息能指出步骤与证据 | failure artifact | [ ] |
| UX | UX-002 | 开发文档给出一键运行命令 | docs verification | [ ] |
| E2E | E2E-001 | 新安装态→演示预览→短导出 | complete flow | [ ] |
| High | HIGH-001 | 同套测试连续运行 3 次无 flaky | repeated runs | [ ] |

---

## 【模块3-B】地狱红线

1. Gate C 非 PASS 仍扩展 RC 测试 → 停止。
2. E2E 绕过 UI 直接写内部状态 → 返工。
3. 大面积 snapshot 掩盖行为错误 → 返工。
4. 固定开发机绝对路径 → 返工。
5. 用无上限重试掩盖 flaky → 返工。
6. 遗留 `only` 或未申报 `skip` → 返工。
7. 测试结束残留进程或临时目录 → 返工。
8. CI 没跑却声称 CI 全绿 → 验证造假。
9. 未连续运行验证 flaky → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | unit、integration、E2E 是否各覆盖关键主路径？ | [ ] | CF-B37-001 |
| RG | Gate C 与历史高风险缺陷是否进入回归？ | [ ] | RG-B37-001 |
| NG | 保存失败、坏素材、Unicode、清理是否覆盖？ | [ ] | NG-B37-001 |
| UX | 失败产物是否足以定位？ | [ ] | UX-B37-001 |
| E2E | 新安装态核心流程是否自动走通？ | [ ] | E2E-B37-001 |
| High | 连续 3 次是否无 flaky？ | [ ] | HIGH-B37-001 |
| 字段完整性 | 回执是否记录每层命令与真实结果？ | [ ] | DAY-37.md |
| 需求映射 | 是否覆盖 Day 37 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否实际查看失败 trace 与截图？ | [ ] | artifact 证据 |
| 范围边界与债务 | CI/平台限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-37/45 完成并提交
- Commit: `test: add domain integration and desktop smoke regression suite`
- 分支: `test/day-37-regression-suite`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- schema/migration:
- evaluator/conflicts:
- project lifecycle:
- asset import:
- Electron launch:
- demo preview:
- create/save/reopen:
- short export probe:
- CI 分层:
- flaky 连跑:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration command:
- `pnpm test:e2e`:
- `pnpm build`:

### 决策与债务
- DECISION-001: [测试分层]
- DECISION-002: [E2E fixture/selector]
- DECISION-003: [CI 触发策略]
- DEBT-CI-B37-001:
- DEBT-TEST-B37-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| FLAKE-B37-001 | 连续运行出现非确定失败 | 停止加用例，先修时序/清理 | 阻塞 |
| E2E-B37-001 | Electron 无法在 CI 稳定启动 | 分层为 Windows nightly + 债务 | 有条件交付 |
| CLEANUP-B37-001 | 测试残留进程/temp | 修 fixture teardown | 阻塞 |
| SIGNAL-B37-001 | 失败输出无法定位 | 补 trace/log/screenshot | 返工 |
| SCOPE-B37-001 | 为覆盖率扩成无价值测试海洋 | 收敛到高风险闭环 | 返工 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 37：Domain + Integration + Playwright Desktop Regression Suite**！

验收铁律：真实行为测试；正式 UI E2E；测试数据隔离；失败可定位；无残留；无无限重试；连续运行无 flaky；CI 限制必须诚实申报。

Ouroboros 闭环启动，**B-37/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "test.skip\|test.only\|describe.only\|playwright\|test:e2e" -- tests package.json .github playwright.config.*
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
git diff --stat
```
