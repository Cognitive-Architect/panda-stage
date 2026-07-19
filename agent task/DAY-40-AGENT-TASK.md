# Panda Stage Agent Task — Day 40

> **工单编号**：B-40/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 40  
> **分支建议**：`release/day-40-rc1`  
> **任务类型**：RC 冒烟 + 功能冻结 + 发布闭环  
> **唯一目标**：完成全量质量门禁、干净 Windows 安装包冒烟、演示项目与新建项目两条核心流程，并产出可供内部试用的 `v0.1.0-rc.1` 候选版本证据包。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Panda Stage v0.1.0-rc.1 Smoke + Freeze
- **轰炸目标**：执行 unit/integration/E2E/build/dist，验证安装包、演示预览导出、新建项目最小流程、日志和临时目录，并整理 release notes 与 RC1 回执。
- **任务性质**：发布验收 + 稳定性冒烟
- **输入基线**：Gate C PASS；Day 36～39 已完成且无阻塞项。
- **输出要求**：RC 安装包 + 全量命令结果 + 干净机双流程证据 + 无 P0 + P1 有规避 + `docs/test-receipts/RC1.md`。
- **通用铁律**：
  1. 前置 Gate 或 Day 36～39 有阻塞时停止。
  2. RC 日冻结新功能，只允许最小阻塞修复。
  3. 版本、commit、安装包和 release notes 必须一致。
  4. 存在 P0 时不得判定 RC 可用。
  5. 所有结果必须来自真实命令和干净机证据。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 分支、HEAD、干净工作区 | `git branch --show-current`；`git rev-parse HEAD`；`git status --short` | 必须 |
| Gate 前置 | Gate C PASS；Day 36～39 无阻塞 | 回执文件 | 必须 |
| 当前版本 | package 版本、builder 配置、安装包命名 | `git grep -n "version\|productName\|appId" -- package.json electron-builder.*` | 必须 |
| 目标范围 | 版本信息、release notes、RC 回执、必要最小修复 | `git diff --name-only` | 必须 |
| 目标结果 | 全量门禁通过；干净机双流程通过；无 P0；P1 有规避 | 命令与录屏 | 必须 |
| 技术约束 | 同一 commit 构建；功能冻结；产物 hash；用户数据不进安装目录 | 证据表 | 必须 |
| 风险边界 | 不新增功能；不做自动更新；不改项目格式；不处理 P2 美化 | diff 审查 | 必须 |
| 测试基线 | typecheck/lint/unit/integration/E2E/build/dist | 原始输出摘要 | 必须 |
| 文档同步 | `docs/test-receipts/RC1.md`、release notes、KNOWN_ISSUES | 文档 diff | 必须 |
| 历史债务 | Gate C 与 Day 36～39 的 P1/P2/debt 全部汇总 | 对照表 | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | RC 用于内部试用，核心是可安装、可制作、可预览、可导出。 |
| 待确认问题 | 当前版本更新文件、release notes 位置、构建产物来源。 |
| 预期输出 | 一个 commit、一个版本、一个安装包和一个证据包。 |
| 停止条件 | 全量门禁、双流程、问题分级、产物 hash 和 RC1 回执全部完成。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-40/45
- **角色**：Engineer
- **依赖关系**：依赖 Gate C PASS 与 Day 36～39。

### 输出交付物

- **必须产出**：
  - `v0.1.0-rc.1` 对应版本信息；
  - 同一 commit 构建的 Windows 安装包；
  - 安装包 SHA-256、大小和构建环境；
  - `docs/test-receipts/RC1.md`；
  - release notes；
  - 更新后的 `KNOWN_ISSUES.md`；
  - 干净 Windows 双流程录屏与导出产物。
- **流程 A：演示项目**：安装→启动→复制演示→预览→导出→重开。
- **流程 B：新建项目**：新建→导入→角色/镜头/动作/对白→保存重开→预览→导出。
- **必须包含**：
  - `pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、integration、`pnpm test:e2e`、`pnpm build`、`pnpm dist`；
  - 安装包来自记录的结果 SHA；
  - 干净机无全局 Node/pnpm/FFmpeg；
  - 双流程均通过并产生可验证 MP4；
  - 日志、临时目录和最近项目无异常测试污染；
  - 无 P0；每个 P1 有影响、规避方法和证据；
  - release notes 区分新增能力、修复、已知限制和安装注意；
  - 功能冻结声明明确。
- **禁止包含**：
  - RC 日新增功能；
  - 失败命令后继续发布；
  - 安装包与记录 commit 不一致；
  - 存在 P0 仍判通过；
  - release notes 写入未实现能力；
  - 使用开发机环境代替干净机冒烟。
- **交付证明**：命令日志、结果 SHA、安装包 hash、干净机录屏、两个 MP4/ffprobe、问题清单和 RC1 回执。

### 规模与复杂度观察

- 本日以验收和冻结为主，代码改动只能对应可复现的阻塞缺陷并附回归测试。
- 若修复触及项目格式或导出核心语义，应停止 RC，回到对应 Gate 修复。
- 产物与证据必须来自同一次确定构建，不混用旧安装包。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | build/dist 通过 | `pnpm build`；`pnpm dist` | RC FAIL |
| TYPE | 类型检查通过 | `pnpm typecheck` | RC FAIL |
| FMT | 格式通过或 N/A + 原因 | `pnpm exec prettier --check .` | 返工或声明 |
| LINT | lint 通过 | `pnpm lint` | RC FAIL |
| TEST | unit/integration/E2E 通过 | 仓库实际命令 | RC FAIL |
| ARCH | 同一 commit/version/artifact；功能冻结 | Git/artifact evidence | RC FAIL |
| REAL | 干净机双流程通过 | 录屏/MP4/ffprobe | RC FAIL |
| DOC | RC1、release notes、known issues 一致 | 文档 diff | RC FAIL |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 全量质量命令通过 | command outputs | [ ] |
| FUNC | FUNC-002 | 演示项目冒烟通过 | recording/MP4 | [ ] |
| FUNC | FUNC-003 | 新建项目最小流程通过 | recording/project | [ ] |
| FUNC | FUNC-004 | RC 安装包可安装、导出、卸载 | clean-machine evidence | [ ] |
| CONST | CONST-001 | version/commit/artifact 一致 | evidence table | [ ] |
| CONST | CONST-002 | 功能冻结且无无关改动 | diff review | [ ] |
| CONST | CONST-003 | 无 P0，P1 有规避 | issue table | [ ] |
| CONST | CONST-004 | release notes 与实际一致 | cross-check | [ ] |
| NEG | NEG-001 | 失败门禁会阻止 RC | procedure evidence | [ ] |
| NEG | NEG-002 | 日志/temp/最近项目无污染 | manual evidence | [ ] |
| NEG | NEG-003 | 无全局开发工具仍可运行 | clean-machine evidence | [ ] |
| NEG | NEG-004 | 安装/卸载不伤用户项目 | before/after hashes | [ ] |
| UX | UX-001 | 首次启动、演示和新建入口清楚 | UI evidence | [ ] |
| UX | UX-002 | P1 规避方法普通用户可执行 | known issues review | [ ] |
| E2E | E2E-001 | 安装→演示导出→新建导出→重开 | complete flow | [ ] |
| High | HIGH-001 | RC1 证据包可由第三方复现 | receipt audit | [ ] |

---

## 【模块3-B】地狱红线

1. 前置 Gate 或 Day 36～39 有阻塞仍发布 → 停止。
2. 任一全量命令失败仍判 RC → FAIL。
3. 安装包不来自记录 commit → FAIL。
4. version/commit/artifact 不一致 → FAIL。
5. 存在 P0 仍发布 → 严重违规。
6. P1 无规避仍声称可试用 → FAIL。
7. RC 日新增功能或大重构 → 范围失控。
8. release notes 写入未实现能力 → 返工。
9. 未在干净机跑双流程 → 未验证。
10. 证据不完整仍判通过 → FAIL。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 全量门禁与双流程是否通过？ | [ ] | CF-B40-001 |
| RG | Gate C 与 Day 36～39 是否完整回归？ | [ ] | RG-B40-001 |
| NG | 失败阻断、数据保护、环境隔离是否覆盖？ | [ ] | NG-B40-001 |
| UX | 首次试用和 P1 规避是否可理解？ | [ ] | UX-B40-001 |
| E2E | 干净机完整 RC 流程是否走通？ | [ ] | E2E-B40-001 |
| High | commit/version/artifact 是否一致可复现？ | [ ] | HIGH-B40-001 |
| 字段完整性 | RC1 是否链接全部命令和产物？ | [ ] | RC1.md |
| 需求映射 | 是否覆盖 Day 40 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否实际卸载并复查用户项目？ | [ ] | 操作证据 |
| 范围边界与债务 | P1/P2/debt 是否全部汇总？ | [ ] | 问题清单 |

---

## 【模块5】收卷格式

```markdown
# Panda Stage v0.1.0-rc.1 Test Receipt

## 结论
- Result: PASS / FAIL
- 分支: `release/day-40-rc1`
- Commit SHA:
- Version: `v0.1.0-rc.1`
- Gate C: PASS（证据路径）
- 功能冻结: YES / NO

## 安装包
- 文件路径:
- SHA-256:
- 文件大小:
- 构建环境:
- 签名状态:

## 全量门禁
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration:
- `pnpm test:e2e`:
- `pnpm build`:
- `pnpm dist`:
- CI:

## 干净环境与流程
- Windows 版本:
- 全局 Node/pnpm/FFmpeg:
- 演示项目流程:
- 新建项目流程:
- 两个导出 MP4/ffprobe:
- 日志/temp/最近项目:
- 卸载与用户项目保留:

## 问题清单
| ID | 等级 | 现象 | 影响 | 规避方法 | 证据 | 是否阻塞 |
|---|---|---|---|---|---|---|

## 决策
- PASS：允许进入 Day 41 真实样片验证。
- FAIL：回到对应 Gate/Day 修复后重新执行 Day 40。
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| GATE-B40-001 | 前置 Gate/Day 有阻塞 | 停止 RC | 阻塞 |
| QUALITY-B40-001 | 任一全量命令失败 | 修复并重跑全部门禁 | RC FAIL |
| ARTIFACT-B40-001 | commit/version/安装包不一致 | 废弃产物并重构建 | RC FAIL |
| P0-B40-001 | 发现 P0 | 冻结发布，回到缺陷来源日 | RC FAIL |
| CLEAN-B40-001 | 干净机流程或数据保护失败 | 停止 RC | RC FAIL |
| EVIDENCE-B40-001 | 缺命令/录屏/hash/回执 | 不得 PASS | RC FAIL |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 40：Panda Stage v0.1.0-rc.1 Smoke + Freeze**！

验收铁律：前置通过；全量命令全绿；干净机演示与新建双流程通过；无 P0；P1 有规避；功能冻结；commit/version/artifact 一致；证据不完整不得发布。

Ouroboros 闭环启动，**B-40/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "version\|productName\|appId" -- package.json electron-builder.*
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm dist
certutil -hashfile "<installer.exe>" SHA256
ffprobe -v error -print_format json -show_streams -show_format "<export.mp4>"
git diff --stat
```
