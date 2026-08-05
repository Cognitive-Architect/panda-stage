# Panda Stage Agent Task — Day 34

> **工单编号**：B-34/45<br>
> **角色**：Engineer<br>
> **来源**：`DAILY_PLAN.md` Day 34<br>
> **分支建议**：`feat/day-34-export-ux`<br>
> **任务类型**：功能开发 + 取消协议 + 错误恢复 + 日志<br>
> **唯一目标**：建立完整导出对话框、分阶段进度、统一取消、可读错误、job 日志与失败恢复，使导出成功、失败或取消后应用都能回到可再次导出的稳定状态。

> **Issue #106 草稿声明**：本文件是原正式工单的非覆盖式对齐稿；页首唯一业务目标、依赖、质量门禁、刀刃表、红线和收卷逻辑均保留。新增内容仅补充 PR #75 的工作区落位、Owner、状态边界、视觉与真实 Electron 验收。
>
> **基线状态（2026-08-05）**：PR #75 仍为 Draft；其文档明确 M3 在真实 Electron 验收正式记录前保持 FAIL。Day 26～45 因此继续冻结，本草稿不构成开工、合并或 Gate 放行。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Export Progress + Cancellation + Recovery + Readable Logs
- **轰炸目标**：把 snapshot、帧调度、写队列与 FFmpeg 编码串成可观察 job，并统一处理中途取消、错误映射、临时文件清理和打开输出目录。
- **任务性质**：功能开发 + 状态机 + 用户体验
- **输入基线**：Gate B PASS；Day 31～33 已完成 snapshot、多镜头帧调度、音频混合与最终 mux；M0.5 已验证基础取消清理。
- **输出要求**：进度不倒退 + 取消可完成 + 失败可重试 + 临时文件清理 + 用户可读错误 + 日志最小披露 + 16 项刀刃表。
- **通用铁律**：
  1. 隐藏窗口、帧写队列、FFmpeg 和临时目录必须由同一个 job cancellation token/状态机统一管理。
  2. 进度只能单调增长，不得因阶段切换回退。
  3. 取消、失败与成功都必须进入唯一终态并执行幂等清理。
  4. 错误提示必须包含用户下一步，日志保留诊断细节但不得过度暴露本地隐私。
  5. 失败或取消后必须能立即再次导出，不能要求重启应用。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | Gate B PASS；Day 31～33 回执和测试通过 | 回执文件 | 必须 |
| 当前实现 | ExportService/Scheduler、FrameWriteQueue、FFmpegAdapter、job 状态、临时目录与 IPC | `git grep -n "ExportService\|ExportScheduler\|FrameWriteQueue\|FFmpegAdapter\|jobId\|cancel" -- src tests` | 必须 |
| 目标范围 | ExportDialog、progress model、cancel coordinator、error mapper、logger、cleanup、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 进度单调；取消及时；失败后可重试；临时文件清理；错误含下一步；日志不过度泄露；成功可打开目录 | unit/component/integration/manual evidence | 必须 |
| 技术约束 | 明确状态机；取消幂等；FFmpeg 进程可终止；路径脱敏；最终文件只在成功后原子移动/保留 | 代码与测试 | 必须 |
| 风险边界 | 不改渲染算法；不改音频混合语义；不做队列并行优化；不做云日志或遥测 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 9/31～33 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-34.md`，同步错误码、日志与取消协议 | 文档 diff | 必须 |
| 历史债务 | 若 Day 9 与新 job 状态重复，必须统一，不允许保留两套取消协议 | diff + tests | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 导出包含 validation、rendering、encoding/mux、finalizing 等阶段；旧探针已有取消经验。 |
| 待确认问题 | 当前 job 状态字段；FFmpeg 终止方式；日志保存目录；Windows 打开文件夹 API；临时成片原子移动策略。 |
| 预期输出 | 用户能理解、开发者能诊断、失败后可恢复的导出控制面。 |
| 停止条件 | 成功、取消、渲染失败、写盘失败、FFmpeg 失败和再次导出全部验证。 |

---

## 【Issue #106】PR #75 对齐补丁（草稿）

> 本节是增量合同；未列出的要求继续以原工单为准。若本节与原工单的唯一目标、依赖或 Gate 冲突，停止执行并提交主理人裁决，不得自行改写目标。

### 对齐深度

**重点映射 / Export UX。** 原工单的进度、取消、日志与恢复目标不变；本补丁定义唯一可见 Owner。

### 工作区、Owner 与状态边界

| 维度 | 补充要求 |
|---|---|
| 可见 Owner | 全产品最多一个 `ExportDialog`；配置、校验、渲染、编码、收尾、完成按状态切换内容，禁止六段同时纵向铺开。 |
| 后台 Owner | Main export service 拥有 job、取消、日志、temp 与清理；StatusBar 只显示简短任务摘要，不复制工作流。 |
| 状态 | ExportStore / job 状态不进入 ProjectSchema、History 或 dirty；导出使用创建时的不可变 Snapshot。 |
| 关闭语义 | 关闭 Dialog 不等于取消；运行中关闭必须让用户明确选择。重复取消幂等，清理完成前不可重启。 |
| 文件语义 | 正式输出只在成功时出现；失败/取消清理 temp 后回到可再次导出的稳定状态。 |

### Dialog 状态合同

- 配置：输出位置、文件名、固定参数摘要。
- 进行：阶段、总体进度、当前/总帧、已用时间、取消。
- 失败：原因、影响、建议、查看日志、重新导出。
- 取消：明确“正在清理”，完成后开放重试。
- 完成：打开文件、打开所在文件夹、关闭。

### 视觉、可访问性与真实 Electron 验收

- 打开后焦点落在标题/首字段；阶段用 `aria-live=polite`，不逐帧朗读；失败时焦点转到错误摘要，结束后返回 TopBar 导出按钮。
- 取消确认默认焦点为“继续导出”；错误、进度和完成均有非颜色信号。
- 800×560 与 1366×768 下 Dialog 不裁切；内容区可内部滚动但根页面不滚动。
- 在真实 Electron 覆盖成功、验证失败、编码失败、取消、重复取消、关闭但继续、清理后重试与打开输出位置，并证明 `ExportDialog <= 1`。

### Roadmap Evidence Index（A1～A22）

- **本日覆盖**：`A17 视频导出`、`A19 导出取消`。
- **反向证据**：唯一 ExportDialog 全状态、幂等取消、temp 清理、可立即重试与可读错误证据。

### 追踪来源

- [原正式 Day 34 工单](../../../agent%20task/DAY-34-AGENT-TASK.md)
- [Day 26～45 前端与交互技术实施蓝图](../../design/day26-45-ux-implementation-blueprint.md)
- [Panda Stage 视觉设计规范](../../design/DESIGN.md)

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-34/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 31～33 完整导出链路与 Day 9 基础取消经验。

### 输出交付物

- **预计变更文件**：
  - `src/shared/export-types.ts`
  - `src/main/services/ExportJobController.ts`
  - `src/main/services/ExportCancellation.ts`
  - `src/main/services/ExportErrorMapper.ts`
  - `src/main/services/ExportJobLogger.ts`
  - `src/main/services/ExportCleanupService.ts`
  - `src/main/ipc/handlers/export.ts`
  - `src/renderer/features/export/ExportDialog.tsx`
  - `src/renderer/features/export/ExportProgress.tsx`
  - `src/renderer/stores/exportStore.ts`
  - 对应 unit/component/integration tests
  - `docs/test-receipts/DAY-34.md`
- **核心修改点**：
  - 导出配置、开始、取消和完成对话框；
  - `validating/rendering/encoding/finalizing` 分阶段进度；
  - 总体进度单调映射；
  - 统一 cancellation token；
  - 停止隐藏窗口帧循环；
  - 关闭/清空写队列；
  - 终止 FFmpeg 子进程；
  - 删除 temp 目录与半成品；
  - 错误码到用户文案映射；
  - job 日志与路径最小披露；
  - 成功后打开所在文件夹；
  - 失败/取消后重置 UI 并允许再次导出。
- **必须包含**：
  - progress 永不倒退；
  - render 与 encode 阶段切换可解释；
  - 取消在 validation/rendering/encoding/finalizing 各阶段行为明确；
  - 重复点击取消安全；
  - FFmpeg 进程退出/被终止；
  - hidden renderer 和写队列清理；
  - temp 与半成品清理；
  - 正式输出文件仅成功时存在；
  - 失败后立即再次导出成功；
  - 错误提示包含原因、影响和下一步；
  - 日志包含 jobId、阶段、时间和必要错误；
  - 日志不记录不相关用户目录、素材正文或敏感环境变量；
  - 打开输出目录失败时不影响导出成功结果。
- **禁止包含**：
  - 每个模块各自维护一套取消布尔值；
  - 取消后留下 FFmpeg、隐藏窗口或临时目录；
  - 失败后 exportStore 永久卡在 busy；
  - 日志复制完整项目 JSON 或环境变量；
  - 为进度好看伪造百分比完成；
  - 提前执行 Gate C 或新增编码功能。
- **交付证明**：状态机单测、progress 单调测试、各阶段取消故障注入、进程/窗口/目录检查、错误文案快照、日志脱敏测试、取消后再次导出录屏。

### 规模与复杂度观察

- ExportJobController 是唯一 job 状态机，子服务只接收 token 与回调，不能自行决定全局状态。
- 总体进度可按阶段权重映射，但权重必须文档化；阶段内按真实计数计算，禁止 setTimeout 模拟。
- cleanup 必须幂等，成功、失败和取消重复调用不会误删正式输出。
- 若 Windows 进程树终止存在平台限制，声明 `DEBT-PROCESS-B34-001` 并提供真实残留检查。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 仓库格式工具现状已记录 | N/A（未安装 Prettier）；使用 `pnpm lint` + `git diff --check` | 未记录即返工 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 状态机、进度、取消、清理、错误和日志测试通过 | unit/component/integration tests | 返工 |
| ARCH | 统一 job 状态与 token；cleanup 幂等；正式输出受保护 | 静态检查 + tests | 返工 |
| REAL | 真实取消与失败后再次成功导出 | `pnpm dev` 录屏/进程证据 | 返工 |
| DOC | 错误码、日志与回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 导出对话框与阶段进度可用 | component/manual | [ ] |
| FUNC | FUNC-002 | 统一取消停止所有子系统 | integration test | [ ] |
| FUNC | FUNC-003 | 错误映射与 job 日志可用 | unit/integration | [ ] |
| FUNC | FUNC-004 | 成功后可打开输出目录 | IPC/manual | [ ] |
| CONST | CONST-001 | 进度单调不倒退 | progress tests | [ ] |
| CONST | CONST-002 | job 终态唯一 | state machine tests | [ ] |
| CONST | CONST-003 | cleanup 幂等且保护正式文件 | repeated cleanup tests | [ ] |
| CONST | CONST-004 | 日志最小披露 | redaction tests | [ ] |
| NEG | NEG-001 | validation 阶段取消安全 | stage test | [ ] |
| NEG | NEG-002 | rendering/encoding 取消无残留 | process/file tests | [ ] |
| NEG | NEG-003 | 失败后可立即再次导出 | integration test | [ ] |
| NEG | NEG-004 | 重复取消不会抛错或误删 | idempotency test | [ ] |
| UX | UX-001 | 错误包含用户下一步 | message evidence | [ ] |
| UX | UX-002 | 阶段、百分比和取消状态清楚 | UI evidence | [ ] |
| E2E | E2E-001 | 开始→取消→清理→再次成功导出 | complete flow | [ ] |
| High | HIGH-001 | 取消后无 FFmpeg/隐藏窗口/temp 残留 | process/file report | [ ] |

---

## 【模块3-B】地狱红线

1. 多套取消状态互相打架 → 返工。
2. 进度倒退或伪造 → 返工。
3. 取消后残留 FFmpeg/隐藏窗口/temp → 返工。
4. 失败后必须重启应用才能再导出 → 返工。
5. cleanup 误删正式成功文件 → 严重返工。
6. 日志泄露完整项目 JSON 或敏感环境信息 → 返工。
7. 错误只显示“导出失败” → 返工。
8. 打开目录失败反向把成功 job 标成失败 → 返工。
9. 未实际取消并检查进程就声称清理可靠 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 进度、取消、错误、日志和打开目录是否完整？ | [ ] | CF-B34-001 |
| RG | Day 9 和 Day 31～33 导出能力是否保持？ | [ ] | RG-B34-001 |
| NG | 各阶段取消、失败、重复取消是否覆盖？ | [ ] | NG-B34-001 |
| UX | 进度与错误是否可理解？ | [ ] | UX-B34-001 |
| E2E | 取消后再次导出是否走通？ | [ ] | E2E-B34-001 |
| High | 进程/窗口/临时文件是否无残留？ | [ ] | HIGH-B34-001 |
| 字段完整性 | 回执是否记录阶段、取消时长和残留检查？ | [ ] | DAY-34.md |
| 需求映射 | 是否覆盖 Day 34 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否实际制造 FFmpeg/写盘失败？ | [ ] | 故障证据 |
| 范围边界与债务 | 进程/日志平台限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-34/45 完成并提交
- Commit: `feat(export): add progress cancellation recovery and readable logs`
- 分支: `feat/day-34-export-ux`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- ExportDialog:
- 阶段/总体进度:
- 统一取消:
- hidden renderer 清理:
- write queue 清理:
- FFmpeg 终止:
- temp/半成品清理:
- 错误映射:
- job 日志与脱敏:
- 再次导出:
- 打开输出目录:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- component/integration tests:
- `pnpm build`:
- 实际进程/文件检查:

### 决策与债务
- DECISION-001: [job 状态机]
- DECISION-002: [阶段权重]
- DECISION-003: [日志脱敏]
- DEBT-PROCESS-B34-001:
- DEBT-TEST-B34-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| CANCEL-B34-001 | 取消无法统一终止子系统 | 收敛 controller/token | 阻塞 |
| CLEANUP-B34-001 | 产生残留或误删正式文件 | 停止并修清理边界 | 阻塞 |
| STATE-B34-001 | job 卡在非终态 | 修状态机与 finally | 返工 |
| PRIVACY-B34-001 | 日志泄露超出必要信息 | 立即加脱敏与测试 | 阻塞 |
| TEST-B34-001 | 无法检查 Windows 残留进程 | 明确债务并人工可复现，不得判完全通过 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 34：Export Progress + Cancellation + Recovery + Readable Logs**！

验收铁律：进度不倒退；统一取消；无进程/窗口/temp 残留；失败或取消后能再次导出；错误给下一步；日志可诊断但不过度暴露；正式成功文件不被清理。

Ouroboros 闭环启动，**B-34/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "ExportJobController\|ExportCancellation\|ExportErrorMapper\|ExportJobLogger\|ExportCleanupService" -- src tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --stat
```
