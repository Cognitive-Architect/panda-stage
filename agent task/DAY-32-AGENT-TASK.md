# Panda Stage Agent Task — Day 32

> **工单编号**：B-32/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 32  
> **分支建议**：`feat/day-32-export-scheduler`  
> **任务类型**：功能开发 + 多镜头帧调度 + 背压控制  
> **唯一目标**：把 M0.5 的单镜头帧捕获升级为基于不可变 ExportSnapshot 的多镜头调度器，使隐藏窗口按项目总时间逐帧渲染，并通过有界队列控制内存。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Multi-Shot Export Scheduler + Hidden Renderer + Backpressure
- **轰炸目标**：实现 `evaluateProjectAtTime()`、帧到镜头映射、隐藏窗口逐帧握手、写入确认、背压、镜头切换清理和单调进度。
- **任务性质**：功能开发 + 并发调度 + 资源控制
- **输入基线**：Gate B PASS；Day 31 已生成经过校验的不可变 ExportSnapshot、唯一 jobId、总时长与总帧数；M0.5 隐藏窗口与帧捕获探针已证明可行。
- **输出要求**：5 镜头帧顺序正确 + 队列有上限 + 进度单调 + 隐藏窗口错误终止 job + 30 秒内存观察 + 16 项刀刃表。
- **通用铁律**：
  1. 调度器只能消费 ExportSnapshot，不得读取实时编辑器 store。
  2. 每帧时间必须由 `frameIndex / 24 * 1000` 的统一规则推导，不得使用实时播放时钟。
  3. Main 必须等待隐藏窗口 ready 和写入确认，禁止无界并发推送帧。
  4. 同一 jobId 不能并发启动两次。
  5. 隐藏窗口、写队列或 evaluator 任一错误都必须终止 job 并进入可诊断状态。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | Gate B PASS；Day 31 snapshot/validator/frame count；Day 6 frame capture 可用 | 回执 + 代码搜索 | 必须 |
| 当前实现 | ExportService、隐藏窗口 IPC、StageRenderer、project time mapping、写帧队列 | `git grep -n "ExportService\|export-window\|StageRenderer\|mapProjectTimeToShot\|MAX_PENDING_FRAMES" -- electron src shared tests` | 必须 |
| 目标范围 | project evaluator、scheduler、queue、IPC 协议、隐藏窗口适配、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 5 镜头帧顺序正确；进度单调；内存不线性增长；错误终止；同 job 不重复启动 | unit/integration/manual evidence | 必须 |
| 技术约束 | 有界 pending queue；帧编号连续；每帧必须 ack；资源清理幂等；进度按已写帧计算 | 代码与测试 | 必须 |
| 风险边界 | 不编码 MP4；不混音；不做导出对话框；不改 snapshot；不并发多个 job | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 31 与 M0.5 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-32.md`，同步调度状态机和背压协议 | 文档 diff | 必须 |
| 历史债务 | 若 Day 6 的协议不支持镜头切换或 ack，必须最小升级并保留探针回归 | integration tests | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 总帧数和 snapshot 已冻结；隐藏窗口可渲染指定时点；Main 负责文件写入。 |
| 待确认问题 | 当前 IPC 是否 request/response；pending 阈值；资源预加载策略；镜头切换时是否需释放纹理。 |
| 预期输出 | 可取消、可诊断、内存有界的单 job 多镜头帧流水线。 |
| 停止条件 | 5 镜头、边界帧、背压、错误、重复启动和 30 秒资源观察全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-32/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 31 snapshot 与 M0.5 隐藏窗口探针。

### 输出交付物

- **预计变更文件**：
  - `src/domain/evaluators/projectEvaluator.ts`
  - `electron/main/services/ExportScheduler.ts`
  - `electron/main/services/FrameWriteQueue.ts`
  - `electron/main/services/ExportService.ts`
  - `electron/main/ipc/handlers/export.ts`
  - `src/export-window.tsx`
  - `shared/export-types.ts`
  - 对应 unit/integration tests
  - `docs/test-receipts/DAY-32.md`
- **核心修改点**：
  - `evaluateProjectAtTime(snapshot, projectTimeMs)`；
  - frameIndex → projectTimeMs → shotId/shotTimeMs；
  - 隐藏窗口 snapshot ready 握手；
  - Main 请求下一帧；
  - Renderer 完成绘制后返回 frame buffer；
  - 写队列完成后 ack；
  - `MAX_PENDING_FRAMES` 背压；
  - progress = writtenFrames / totalFrames；
  - 镜头切换时清理上一镜头资源；
  - job 状态机阻止重复启动；
  - 任一阶段错误传播并终止。
- **必须包含**：
  - 5 镜头首帧、边界帧、末帧顺序测试；
  - frameIndex 连续、无重复、无遗漏；
  - pending 数永不超过阈值；
  - 写入速度变慢时调度等待；
  - progress 单调且最终为 1；
  - 隐藏窗口未 ready 不发送帧；
  - 隐藏窗口渲染错误终止 job；
  - 写盘错误终止 job；
  - 同一 jobId 第二次启动被拒绝；
  - 30 秒项目内存不与总帧数线性无限增长；
  - snapshot 在整个 job 中不被修改；
  - 镜头切换无上一镜头图层残留。
- **禁止包含**：
  - 使用 `setInterval` 盲推全部帧；
  - 无界 `Promise.all`；
  - 调度器读取实时 store；
  - 进度按“已请求帧”而非“已写入帧”计算；
  - 同 job 重入；
  - 提前实现编码、混音、导出 UI 或 Gate C。
- **交付证明**：project evaluator 边界测试、queue 上限测试、慢写故障注入、IPC integration、5 镜头帧目录、内存观察表和错误日志。

### 规模与复杂度观察

- ExportScheduler 只做状态机和节流，FrameWriteQueue 只做受控写盘，隐藏窗口只做确定性渲染。
- 不需要并行渲染多帧；优先保证顺序、确定性和内存边界。
- 若资源预加载导致峰值内存过高，允许按镜头加载并声明 `DEBT-PERF-B32-001`。
- 状态机若分支复杂必须记录合法状态转换，禁止靠多个布尔值拼凑。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式检查通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | evaluator、queue、状态机、IPC 与错误测试通过 | unit/integration tests | 返工 |
| ARCH | 只消费 snapshot；队列有界；单 job 不重入 | 静态检查 + tests | 返工 |
| REAL | 30 秒 5 镜头帧捕获与内存观察 | `pnpm dev`/integration evidence | 返工 |
| DOC | 状态机、背压与回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | projectTime 正确映射镜头与镜头内时间 | evaluator tests | [ ] |
| FUNC | FUNC-002 | 5 镜头帧顺序连续 | integration/frame list | [ ] |
| FUNC | FUNC-003 | 有界队列与 ack 工作 | queue tests | [ ] |
| FUNC | FUNC-004 | 进度按已写帧单调增长 | progress tests | [ ] |
| CONST | CONST-001 | 调度器只消费 snapshot | dependency evidence | [ ] |
| CONST | CONST-002 | pending 不超过阈值 | max-depth assertion | [ ] |
| CONST | CONST-003 | 同 jobId 不重复启动 | state machine test | [ ] |
| CONST | CONST-004 | snapshot 不被修改 | freeze assertion | [ ] |
| NEG | NEG-001 | hidden renderer 未 ready 时不推帧 | IPC test | [ ] |
| NEG | NEG-002 | 渲染错误终止 job | fault injection | [ ] |
| NEG | NEG-003 | 写盘错误终止 job | fault injection | [ ] |
| NEG | NEG-004 | 慢写时等待而非堆积 | throttling test | [ ] |
| UX | UX-001 | 错误包含 jobId、frameIndex 和阶段 | error evidence | [ ] |
| UX | UX-002 | 进度阶段与数值可解释 | report evidence | [ ] |
| E2E | E2E-001 | snapshot→多镜头逐帧→完整帧目录 | complete flow | [ ] |
| High | HIGH-001 | 30 秒内存无随帧数线性无限增长 | memory report | [ ] |

---

## 【模块3-B】地狱红线

1. 调度器读取实时编辑状态 → 返工。
2. 无界并发推送/写入帧 → 返工。
3. 帧编号重复、遗漏或乱序 → 返工。
4. 进度按已请求帧计算 → 返工。
5. 同 jobId 可重入 → 返工。
6. hidden renderer 错误后仍继续写帧 → 返工。
7. 镜头切换出现上一镜头残留 → 返工。
8. 提前实现编码、混音、UI 或 Gate C → 范围失控。
9. 未做 30 秒内存观察却声称有界 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | project evaluator、调度、背压和进度是否完整？ | [ ] | CF-B32-001 |
| RG | Day 6 探针和 Day 31 snapshot 是否保持？ | [ ] | RG-B32-001 |
| NG | 未 ready、渲染错、写盘错、慢写是否覆盖？ | [ ] | NG-B32-001 |
| UX | 错误和进度是否可定位？ | [ ] | UX-B32-001 |
| E2E | 5 镜头完整帧目录是否生成？ | [ ] | E2E-B32-001 |
| High | 30 秒内存是否单独验证？ | [ ] | HIGH-B32-001 |
| 字段完整性 | 回执是否记录队列峰值、帧数和内存？ | [ ] | DAY-32.md |
| 需求映射 | 是否覆盖 Day 32 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实运行慢写和错误注入？ | [ ] | 操作证据 |
| 范围边界与债务 | 性能/平台限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-32/45 完成并提交
- Commit: `feat(export): schedule multi-shot frames with bounded backpressure`
- 分支: `feat/day-32-export-scheduler`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- project evaluator:
- frame mapping:
- hidden renderer handshake:
- queue 上限:
- progress:
- 镜头切换清理:
- 错误传播:
- 30 秒内存:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration tests:
- `pnpm build`:

### 决策与债务
- DECISION-001: [调度状态机]
- DECISION-002: [背压阈值]
- DECISION-003: [镜头资源清理]
- DEBT-PERF-B32-001:
- DEBT-TEST-B32-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| ORDER-B32-001 | 帧乱序/重复/遗漏 | 停止并修调度协议 | 阻塞 |
| MEMORY-B32-001 | 内存随总帧数线性增长 | 修背压/资源释放 | 阻塞 |
| IPC-B32-001 | ready/ack 协议不可靠 | 重构握手后继续 | 阻塞 |
| STATE-B32-001 | 同 job 重入或错误后不终止 | 收敛状态机 | 返工 |
| TEST-B32-001 | 无法测量队列/内存 | 不得判背压通过 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 32：Multi-Shot Export Scheduler + Hidden Renderer + Backpressure**！

验收铁律：只消费 snapshot；帧序连续；队列有界；进度按已写帧；错误立即终止；同 job 不重入；5 镜头无残留；30 秒内存有真实证据。

Ouroboros 闭环启动，**B-32/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "ExportScheduler\|FrameWriteQueue\|evaluateProjectAtTime\|MAX_PENDING_FRAMES" -- electron src shared tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --stat
```
