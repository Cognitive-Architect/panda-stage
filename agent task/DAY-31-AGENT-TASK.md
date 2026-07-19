# Panda Stage Agent Task — Day 31

> **工单编号**：B-31/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 31  
> **分支建议**：`feat/day-31-export-snapshot`  
> **任务类型**：功能开发 + 导出前校验 + 不可变快照  
> **唯一目标**：在导出开始前完成项目完整性校验并生成不可变 ExportSnapshot，使导出任务不受后续编辑影响，同时精确计算项目总时长与总帧数。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Immutable Export Snapshot + Validation + Frame Count
- **轰炸目标**：建立导出前 parse、素材存在性、引用合法性、事件合法性、字体/输出配置记录、唯一 job ID、不可变快照和精确帧数计算。
- **任务性质**：功能开发 + 数据冻结 + 失败前置
- **输入基线**：Gate B 必须 PASS；Day 30 内部 Alpha 项目可保存重开并完整预览；ProjectSchema、evaluator、素材引用和项目时间映射已稳定。
- **输出要求**：缺素材能定位 + 校验失败不启动隐藏窗口 + 导出编辑隔离 + 24 FPS 总帧数精确 + 16 项刀刃表 + 结构化收卷。
- **通用铁律**：
  1. Gate B 非 PASS 时停止，不得进入生产级导出。
  2. ExportSnapshot 必须是只读且与后续编辑隔离的完整数据快照。
  3. 校验失败时不得创建大量临时帧、启动隐藏窗口或拉起 FFmpeg。
  4. 总帧数必须由固定 24 FPS 与整数毫秒规则唯一计算，禁止四舍五入口径漂移。
  5. 所有错误必须指出具体素材、引用位置或事件，不得只说“项目无效”。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | `docs/test-receipts/GATE-B.md` 结论为 PASS | 读取 Gate 文档 | 必须 |
| 当前能力 | ProjectSchema、ReferenceScanner、eventConflicts、项目总时长、24 FPS 常量、导出探针可用 | `git grep -n "ProjectSchema\|ReferenceScanner\|eventConflicts\|projectDuration\|FPS\|ExportService" -- src shared electron tests` | 必须 |
| 目标范围 | ExportValidator、ExportSnapshotBuilder、frame count、job config、IPC、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 缺素材列出路径和引用；总帧数精确；编辑不影响 job；失败不启隐藏窗口；每个 job ID 唯一 | unit/integration/manual evidence | 必须 |
| 技术约束 | snapshot 深度只读；路径在 Main 解析；Renderer 不直读 FS；输出配置 schema 校验；字体与版本被记录 | 代码与测试 | 必须 |
| 风险边界 | 不渲染帧；不做队列调度；不做混音；不做进度 UI；不启动 FFmpeg | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Gate B 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-31.md`，同步 snapshot 与 frame count 规则 | 文档 diff | 必须 |
| 历史债务 | 若旧探针直接读取实时 store，必须切断并声明迁移范围 | diff + 决策记录 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 导出必须复用正式 ProjectSchema、evaluator 和 StageRenderer；当前项目固定 24 FPS。 |
| 待确认问题 | 总帧数采用 ceil 还是明确末帧规则；字体列表来源；快照深拷贝/冻结策略；job 配置字段。 |
| 预期输出 | 可序列化、可冻结、可独立传给隐藏窗口的 ExportSnapshot。 |
| 停止条件 | 正常、缺素材、坏引用、非法事件、编辑隔离和帧数边界全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-31/45
- **角色**：Engineer
- **依赖关系**：依赖 Gate B PASS、正式项目模型与 M0.5 导出探针。

### 输出交付物

- **预计变更文件**：
  - `shared/export-types.ts`
  - `electron/main/services/ExportValidator.ts`
  - `electron/main/services/ExportSnapshotBuilder.ts`
  - `electron/main/services/ExportJobFactory.ts`
  - `electron/main/ipc/handlers/export.ts`
  - `src/domain/export/frameCount.ts`
  - 对应 unit/integration tests
  - `docs/test-receipts/DAY-31.md`
- **核心修改点**：
  - 导出前再次 parse ProjectSchema；
  - 检查所有 asset relativePath 对应项目内文件存在；
  - 检查角色、图层、背景、对白、AudioClip 与事件引用；
  - 运行事件冲突与边界校验；
  - 校验输出目录、文件名、编码配置；
  - 记录字体、应用版本、schemaVersion 与输出参数；
  - 生成唯一 jobId；
  - 构建深度只读 snapshot；
  - 计算 projectDurationMs 与 totalFrames；
  - 校验失败返回结构化问题列表且不产生导出副作用。
- **必须包含**：
  - 缺图片、缺音频、错误角色/图层引用测试；
  - 非法 TimelineEvent 测试；
  - 0 ms、1 ms、1000 ms、30000 ms 帧数边界测试；
  - 总帧数计算规则写入文档；
  - snapshot 创建后修改编辑器项目，snapshot 不变；
  - snapshot 内对象不可被意外修改；
  - jobId 连续创建不重复；
  - 校验失败时隐藏窗口创建函数、临时目录与 FFmpeg 调用次数均为 0；
  - 输出路径和文件名经过 schema/路径安全校验；
  - 错误返回引用位置而非只有 asset ID。
- **禁止包含**：
  - 导出线程直接读取实时 store；
  - 只做浅拷贝并声称不可变；
  - 校验失败仍创建 temp 目录或隐藏窗口；
  - Renderer 直接访问 `fs`；
  - 硬编码总帧数；
  - 提前实现帧调度、混音、进度或 Gate C。
- **交付证明**：validator 单测、snapshot 隔离测试、frame count 参数化测试、副作用 spy、真实 Day 30 项目校验结果、结构化错误样例。

### 规模与复杂度观察

- 校验与快照构建分离：先收集全部问题，再生成 snapshot。
- 不可变策略优先采用 schema parse 后的独立对象 + 开发期 deepFreeze 或明确只读类型；不得为了冻结引入重型状态框架。
- 帧数公式必须唯一并在预览、导出、ffprobe 验收中复用。
- 若字体枚举跨平台不稳定，声明 `DEBT-FONT-B31-001` 并保存实际可用字体/回退信息。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式检查通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | validator、snapshot、frame count、副作用测试通过 | unit/integration tests | 返工 |
| ARCH | Main 负责路径；snapshot 与实时 store 隔离；失败零副作用 | 静态检查 + spy | 返工 |
| REAL | 使用 Day 30 项目生成真实 snapshot | 手动/集成证据 | 返工 |
| DOC | frame count 与校验规则同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 完整项目生成 ExportSnapshot | integration test | [ ] |
| FUNC | FUNC-002 | 素材/引用/事件校验完整 | validator matrix | [ ] |
| FUNC | FUNC-003 | 总时长与总帧数精确 | parameterized tests | [ ] |
| FUNC | FUNC-004 | 唯一 jobId 与输出配置记录 | factory tests | [ ] |
| CONST | CONST-001 | snapshot 与后续编辑隔离 | mutation test | [ ] |
| CONST | CONST-002 | snapshot 深度只读 | freeze/type evidence | [ ] |
| CONST | CONST-003 | Renderer 不直接访问 FS | static search | [ ] |
| CONST | CONST-004 | 帧数规则单一可追溯 | code/docs evidence | [ ] |
| NEG | NEG-001 | 缺素材列出路径与引用位置 | negative test | [ ] |
| NEG | NEG-002 | 非法事件阻止 snapshot | validator test | [ ] |
| NEG | NEG-003 | 校验失败零临时目录/窗口/FFmpeg | side-effect spy | [ ] |
| NEG | NEG-004 | 非法输出路径/文件名被拒绝 | boundary test | [ ] |
| UX | UX-001 | 错误列表能定位并指导修复 | error object/UI evidence | [ ] |
| UX | UX-002 | 输出配置摘要可读 | snapshot/report evidence | [ ] |
| E2E | E2E-001 | Day 30 项目→校验→snapshot→保存配置 | complete path | [ ] |
| High | HIGH-001 | 导出开始后编辑项目不改变 snapshot | isolation test | [ ] |

---

## 【模块3-B】地狱红线

1. Gate B 非 PASS 仍开工 → 停止。
2. 导出直接读取实时 store → 返工。
3. 浅拷贝冒充不可变快照 → 返工。
4. 缺素材只报“项目无效” → 返工。
5. 校验失败仍启动隐藏窗口/FFmpeg → 返工。
6. 总帧数存在多套计算口径 → 返工。
7. 输出配置或路径不校验 → 返工。
8. 提前实现帧调度、混音或进度 UI → 范围失控。
9. 未用真实 Day 30 项目验证 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | snapshot、校验、总帧数和 job ID 是否完整？ | [ ] | CF-B31-001 |
| RG | Gate B 项目与旧探针导出契约是否兼容？ | [ ] | RG-B31-001 |
| NG | 缺素材、坏引用、非法事件和路径是否覆盖？ | [ ] | NG-B31-001 |
| UX | 错误是否能指出具体修复位置？ | [ ] | UX-B31-001 |
| E2E | Day 30 项目到 snapshot 是否走通？ | [ ] | E2E-B31-001 |
| High | 编辑隔离是否单独验证？ | [ ] | HIGH-B31-001 |
| 字段完整性 | 回执是否记录公式、问题列表和 snapshot 摘要？ | [ ] | DAY-31.md |
| 需求映射 | 是否覆盖 Day 31 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实修改项目验证快照不变？ | [ ] | 操作证据 |
| 范围边界与债务 | 字体/路径限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-31/45 完成并提交
- Commit: `feat(export): create validated immutable project snapshots`
- 分支: `feat/day-31-export-snapshot`
- Gate B: PASS（证据路径）
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- Project parse:
- 素材与引用校验:
- 事件校验:
- ExportSnapshot:
- projectDurationMs:
- totalFrames:
- jobId:
- 字体与输出配置:
- 校验失败零副作用:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration tests:
- `pnpm build`:

### 决策与债务
- DECISION-001: [总帧数公式]
- DECISION-002: [snapshot 冻结策略]
- DECISION-003: [输出配置 schema]
- DEBT-FONT-B31-001:
- DEBT-TEST-B31-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| GATE-B31-001 | Gate B 非 PASS | 停止 M5 | 阻塞 |
| DATA-B31-001 | snapshot 可被后续编辑改变 | 重构隔离策略 | 阻塞 |
| VALIDATION-B31-001 | 无法定位缺失引用 | 补引用扫描契约 | 返工 |
| FRAME-B31-001 | 帧数口径与探针/ffprobe 不一致 | 统一公式后再继续 | 阻塞 |
| TEST-B31-001 | 无法证明失败零副作用 | 不得收卷 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 31：Immutable Export Snapshot + Validation + Frame Count**！

验收铁律：快照不可变；缺素材可定位；校验失败零副作用；总帧数与 24 FPS 精确对应；导出开始后编辑不影响当前 job；job ID 唯一。

Ouroboros 闭环启动，**B-31/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "ExportSnapshot\|ExportValidator\|totalFrames\|ExportJobFactory" -- electron src shared tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --stat
```
