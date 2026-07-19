# Panda Stage Agent Task — Day 06

> **工单编号**：B-06/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 6  
> **分支建议**：`spike/day-06-frame-capture`  
> **任务类型**：功能开发 + 性能风险验证  
> **唯一目标**：把 3～5 秒探针画面按 24 FPS 从隐藏窗口逐帧捕获，并以受控异步方式写入独立临时目录。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：隐藏窗口逐帧捕获 + 背压 + 临时目录
- **轰炸目标**：在 Main Process 中建立导出 Job、帧调度、受控写盘和清理流程；隐藏窗口只负责按指定时间渲染并返回帧，不得自行写磁盘。
- **任务性质**：功能开发 + 性能边界验证
- **输入基线**：Day 1～5 已形成安全 Electron 工程、最小项目模型、隐藏窗口 IPC、共享 StageRenderer 和 3～5 秒可播放探针。
- **输出要求**：72/120 帧可复现产物 + 自动化质量闸门 + 负面路径证据 + 明确债务声明 + 结构化收卷。
- **通用铁律**：
  1. **数据诚实**：帧数、队列峰值、耗时和内存观察必须来自真实运行结果。
  2. **零假实现**：禁止用 `setTimeout` 假装渲染完成，禁止写空白 PNG 冒充帧捕获。
  3. **架构边界**：隐藏 Renderer 不得直接访问 `fs`；所有磁盘写入必须由 Main Process 完成。
  4. **有限背压**：不得一次性把全部帧 Buffer 堆入内存。
  5. **失败可清理**：异常、取消或写盘失败后不得留下不可解释的大量临时文件。

---

## 【模块2】输入基线（完整技术背景，零占位符）

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 执行前记录实际分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | Day 5 探针可播放；隐藏窗口可接收指定时间点并使用共享 StageRenderer 渲染 | `git log --oneline -n 10`；启动应用后保存 Day 5 手动验证证据 | 必须 |
| 目标范围 | `electron/main/services/ExportService.ts`、`electron/main/services/FileSystemService.ts`、`src/export-window.tsx`、`shared/export-types.ts` 及必要测试文件 | `git diff --name-only` | 必须 |
| 当前缺口 | 尚无完整帧 Job、帧编号、临时目录、背压和逐帧写盘闭环 | 搜索 `ExportService`、`MAX_PENDING_FRAMES`、`frameIndex` 当前实现 | 必须 |
| 目标结果 | 3 秒生成 72 帧；5 秒生成 120 帧；编号连续、可排序、无重复；重复导出后资源不持续上涨 | 自动化测试 + 真实帧目录 + 日志 | 必须 |
| 技术约束 | 24 FPS；时间公式为 `frameIndex / 24 * 1000`；Main 写盘；隐藏窗口只渲染；使用异步写入；Job 使用唯一 ID | 代码与测试证据 | 必须 |
| 风险边界 | 禁止接入 FFmpeg；禁止新增完整导出 UI；禁止同步阻塞循环；禁止一次性生成全部 DataURL 后再写盘 | diff 审查 | 必须 |
| 测试基线 | `pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm build` 当前真实结果 | 原始输出摘要 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-06.md`；如 IPC/Job 协议变化，同步 `docs/architecture.md` 或 IPC 文档 | 文档 diff | 必须 |
| 历史债务 | 若隐藏窗口帧完成握手仍依赖固定延时，必须先声明并修复，不得在其上继续堆帧调度 | 代码搜索 + 决策记录 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 探针固定 24 FPS；共享 Renderer/Evaluator 已存在；隐藏窗口已能接收 IPC。 |
| 待确认问题 | 当前捕获方式是 canvas 导出还是 `capturePage()`；Buffer 格式与尺寸；Windows 临时目录最佳落点；写队列的合理上限。 |
| 预期输出 | 收敛一个可重复、有限内存、可取消扩展的逐帧捕获协议。 |
| 停止条件 | 72 帧探针准确写出、编号连续、背压生效、失败可清理，即可收卷；不在本日接 FFmpeg。 |

---

## 【模块3】工单矩阵（通用高压版）

### 1）基础信息

- **工单编号**：B-06/45
- **角色**：Engineer
- **目标**：完成隐藏窗口逐帧捕获、临时目录、有限背压和失败清理。
- **依赖关系**：依赖 Day 3 隐藏窗口 IPC、Day 4 共享 StageRenderer、Day 5 探针预览；无并行工单。

### 2）输出交付物

- **预计变更文件**：
  - `shared/export-types.ts`
  - `electron/main/services/ExportService.ts`
  - `electron/main/services/FileSystemService.ts`
  - `electron/main/ipc/` 下必要 handler
  - `src/export-window.tsx`
  - `tests/unit/` 或 `tests/integration/` 下对应测试
  - `docs/test-receipts/DAY-06.md`
- **核心修改点**：
  - 定义 Export Job 配置、状态和唯一 Job ID；
  - 计算 `totalFrames` 与每帧 `timeMs`；
  - Main 逐帧发请求，隐藏窗口完成真实渲染后回帧；
  - 使用 `MAX_PENDING_FRAMES` 或等价机制限制待写队列；
  - 帧名使用固定宽度，如 `frame_000000.png`；
  - 独立临时目录以 Job ID 隔离；
  - 成功、失败、取消均进入统一清理路径。
- **必须包含**：
  - 3 秒 = 72 帧测试；
  - 5 秒 = 120 帧测试；
  - 首帧时间为 0ms；
  - 最后一帧时间不越过项目时长；
  - 帧序号无重复、无缺失；
  - 队列上限可观察或可测试。
- **禁止包含**：
  - 同步 `for` 循环中调用阻塞式文件写入；
  - Renderer 直接调用 `fs`；
  - `setTimeout` 作为“渲染完成”证据；
  - 未清理的大量 Base64 字符串；
  - FFmpeg、音频 mux、正式导出 UI。
- **交付证明**：
  - 自动化命令真实输出；
  - 72 帧目录清单；
  - 连续两次导出后的队列/内存观察；
  - 一次模拟写盘失败后的清理证据。

### 3）规模与复杂度观察

- `ExportService` 可以包含状态机，但帧调度、写队列、路径管理应保持职责清晰。
- 若单函数因状态机超过约 50 行，必须在收卷中解释；不允许为了凑行数拆出无意义包装函数。
- 若需要临时采用 DataURL 而非 Buffer，必须声明 `DEBT-PERF-B06-001`，说明内存代价与 Day 10 前的清偿计划。

### 4）自动化质量闸门（强制）

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式检查通过 | `pnpm exec prettier --check .`；若仓库无该脚本则 N/A + 原因 | 返工或声明 |
| LINT | 无新增 lint error | `pnpm lint` | 返工 |
| TEST | 帧数、时间映射、队列与失败清理测试通过 | `pnpm test:unit`；如有集成脚本一并执行 | 返工 |
| ARCH | Renderer 无文件系统访问 | `git grep -n "from 'node:fs\|from \"node:fs\|require('fs')\|require(\"fs\")" -- src` | 返工 |
| REAL | 真实输出 PNG，不是假文件 | 文件签名检查 + 打开抽查首、中、尾帧 | 返工 |
| DOC | 回执与协议同步 | `git diff -- docs/test-receipts/DAY-06.md docs/architecture.md` | 返工或声明债务 |

---

## 【模块3-A】刀刃表（16 项，强制命令化）

| 类别 | 检查点 ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 3 秒探针生成 72 帧 | 运行导出探针后统计 `frame_*.png` 数量为 72 | [ ] |
| FUNC | FUNC-002 | 5 秒探针生成 120 帧 | 切换为 5 秒配置并统计为 120 | [ ] |
| FUNC | FUNC-003 | 帧编号连续且固定宽度 | 列出文件名并检查首尾及缺号 | [ ] |
| FUNC | FUNC-004 | 指定帧时间按 24 FPS 计算 | 单元测试覆盖 frame 0、1、24、71 | [ ] |
| CONST | CONST-001 | Main Process 负责写盘 | `git grep -n "writeFile\|createWriteStream" -- electron/main` | [ ] |
| CONST | CONST-002 | 隐藏 Renderer 不直接访问 Node FS | 对 `src/` 执行 Node API 静态搜索，结果应为空 | [ ] |
| CONST | CONST-003 | 待写队列存在上限 | 搜索 `MAX_PENDING_FRAMES` 或等价配置并附测试 | [ ] |
| CONST | CONST-004 | 每个 Job 使用独立临时目录 | 日志和目录结构显示 Job ID | [ ] |
| NEG | NEG-001 | 写盘失败会终止 Job | 注入不可写目录或受控失败，记录失败状态 | [ ] |
| NEG | NEG-002 | 渲染窗口返回错误会终止后续帧 | 受控缺素材测试 | [ ] |
| NEG | NEG-003 | 半成品按策略清理 | 失败后检查临时目录 | [ ] |
| NEG | NEG-004 | 重复启动同一 Job 不会并发执行两份 | 自动化或手动重复触发证据 | [ ] |
| UX | UX-001 | 错误包含 Job ID 与可读原因 | 错误日志/界面证据 | [ ] |
| UX | UX-002 | 导出结束后状态可再次开始 | 连续执行两次探针 | [ ] |
| E2E | E2E-001 | 隐藏窗口→Main→磁盘全链路完成 | 首、中、尾帧截图 + 目录证据 | [ ] |
| High | HIGH-001 | 连续两次导出资源不持续线性增长 | 任务管理器或诊断日志观察并记录 | [ ] |

---

## 【模块3-B】地狱红线（10 项）

1. 用空白 PNG 或固定图片重复复制冒充逐帧渲染 → 返工。
2. 用固定延时假装“渲染完成” → 返工。
3. Renderer 直接访问 `fs` / `path` / `child_process` → 返工。
4. 一次性缓存全部帧导致无界内存增长 → 返工。
5. 帧数不精确仍声称完成 → 返工。
6. 失败后留下大量临时文件却不申报 → 返工。
7. 自动化闸门失败仍提交“完成” → 返工。
8. 顺手接入 FFmpeg 或完整导出 UI → 范围失控，返工。
9. 不记录真实分支、SHA、命令输出 → 返工。
10. 性能未知却宣称“无内存问题” → 返工。

---

## 【模块4】P4 自测轻量检查表 v3.0

| 检查点 | 自检问题 | 覆盖情况 | 相关用例 / 命令 | 备注 |
|---|---|---|---|---|
| CF | 72/120 帧标准路径是否真实完成？ | [ ] | CF-B06-001 | |
| RG | Day 5 预览和共享 Renderer 是否保持可用？ | [ ] | RG-B06-001 | |
| NG | 写盘失败、渲染失败是否会安全终止？ | [ ] | NG-B06-001 | |
| UX | Job 错误是否可理解、可定位？ | [ ] | UX-B06-001 | |
| E2E | 隐藏窗口到磁盘是否完整跑通？ | [ ] | E2E-B06-001 | |
| High | 背压和内存风险是否单独验证？ | [ ] | HIGH-B06-001 | |
| 字段完整性 | 回执是否写明前置、预期、实际、风险？ | [ ] | `docs/test-receipts/DAY-06.md` | |
| 需求映射 | 每项验证是否映射 Day 6 任务？ | [ ] | 本文刀刃表 | |
| 自测执行 | 是否至少完整执行两次探针？ | [ ] | 运行日志 | |
| 范围边界与债务 | 未解决的 Buffer/内存问题是否申报？ | [ ] | 债务声明 | |

---

## 【模块5】收卷格式（强制结构）

```markdown
## ✅ 工单 B-06/45 完成并提交

### 提交信息
- Commit: `spike(export): capture deterministic frames with backpressure`
- 分支: `spike/day-06-frame-capture`
- 基线 SHA: `<执行前 git rev-parse HEAD 的真实输出>`
- 结果 SHA: `<提交后的真实 SHA>`
- 变更文件: [逐项列出]

### 本轮目标与实际结果
- 目标: 3～5 秒探针按 24 FPS 逐帧写入独立临时目录
- 实际完成: [真实结果]
- 未完成/不在范围: FFmpeg、音频合成、正式导出 UI

### 关键决策记录
- DECISION-001: [帧捕获格式与原因]
- DECISION-002: [背压上限及选择依据]
- DECISION-003: [临时目录与清理策略]

### 自动化质量检查报告
- `pnpm typecheck`: [真实摘要]
- `pnpm lint`: [真实摘要]
- `pnpm test:unit`: [真实摘要]
- `pnpm build`: [真实摘要]
- 探针 3 秒帧数: [真实值]
- 探针 5 秒帧数: [真实值]

### 刀刃表摘要
| 类别 | 覆盖数 | 关键证据 |
|---|---:|---|
| FUNC | X/4 | |
| CONST | X/4 | |
| NEG | X/4 | |
| UX | X/2 | |
| E2E | X/1 | |
| High | X/1 | |

### 债务声明
- DEBT-PERF-B06-001: [无 / 具体内容]
- DEBT-TEST-B06-001: [无 / 具体内容]

### 风险与回滚点
- 主要风险: 帧 Buffer 和写队列造成内存上涨
- 回滚方式: `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| ARCH-B06-001 | 隐藏窗口必须直接访问文件系统才能继续 | 停止实现，修 IPC / Main 职责边界 | 返工 |
| QUALITY-B06-001 | 72 帧数量或编号不稳定 | 停止接下游编码，先修调度 | 返工 |
| PERF-B06-001 | 待写帧无上限或内存持续线性增长 | 收紧队列、释放 Buffer、补观察证据 | 返工 |
| TEST-B06-001 | 无法自动验证帧序列 | 至少提供可复现实测脚本并声明 `DEBT-TEST` | 有条件交付 |
| CLEANUP-B06-001 | 失败后无法安全清理 | 暂停后续 Day 7 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 06：隐藏窗口逐帧捕获 + 背压 + 临时目录**！

### 关键约束
- 24 FPS，时间由 `frameIndex / 24 * 1000` 计算；
- Main Process 唯一负责写盘；
- 隐藏窗口仅渲染并回传真实帧；
- 背压必须有上限；
- 不接 FFmpeg，不做完整导出 UI。

### 验收铁律
- 3 秒 72 帧；
- 5 秒 120 帧；
- 编号连续无重复；
- 失败可清理；
- 默认质量门禁全通过。

Ouroboros 闭环启动，**B-06/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库（TS / Electron）

```bash
git branch --show-current
git rev-parse HEAD
git status --short
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
git diff --stat
git diff -- electron/main/services/ExportService.ts electron/main/services/FileSystemService.ts src/export-window.tsx shared/export-types.ts
```
