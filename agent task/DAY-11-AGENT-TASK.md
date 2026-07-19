# Panda Stage Agent Task — Day 11

> **工单编号**：B-11/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 11  
> **分支建议**：`feat/day-11-project-schema-v1`  
> **任务类型**：领域建模 + 数据契约 + 迁移框架  
> **唯一目标**：把 M0.5 探针数据升级为可覆盖 Panda Stage MVP 的 `ProjectSchema v1`，并建立可测试、可扩展、可拒绝非法数据的版本检测与迁移框架。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：ProjectSchema v1 + TimelineEvent 全量联合类型 + Migration Framework
- **轰炸目标**：完成 `Project / Asset / Character / VoiceProfile / Shot / Layer / Dialogue / AudioClip / SubtitleStyle / TimelineEvent` 的 Zod 契约、跨引用校验、版本检测、v0→v1 测试迁移与 round-trip 验证。
- **任务性质**：领域建模 + 数据验证 + 迁移基础设施
- **输入基线**：Gate A 必须已通过；Day 2 的最小模型与 Day 3～10 探针数据结构已存在，可作为兼容性输入，但不得直接把探针结构当正式项目模型。
- **输出要求**：可执行 schema + 迁移函数 + 示例 JSON + 自动化质量闸门 + 16 项刀刃表 + 债务声明 + 结构化收卷。
- **通用铁律**：
  1. **Gate 前置**：若 `docs/test-receipts/GATE-A.md` 不存在或结论不是 `PASS`，立即停止本工单，不得进入 M1。
  2. **数据诚实**：所有通过/失败用例数量必须来自真实测试输出。
  3. **整数时间**：全部时间字段统一为非负整数毫秒，禁止浮点秒。
  4. **版本明确**：`schemaVersion` 必须显式存在，未知未来版本必须拒绝而非猜测解析。
  5. **迁移纯函数**：迁移不得访问 UI、Electron、文件系统或网络。

---

## 【模块2】输入基线（完整技术背景，零占位符）

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | Gate A 结论必须为 `PASS` | 读取 `docs/test-receipts/GATE-A.md`；记录结论与证据路径 | 必须 |
| 当前模型 | 盘点 Day 2 最小 `Asset/Layer/Shot/Project/TimelineEvent` 与探针数据字段 | `git grep -n "ProjectSchema\|TimelineEvent\|schemaVersion\|evaluateShotAtTime" -- shared src tests demo-project` | 必须 |
| 目标范围 | `shared/` 或 `src/domain/models/` 下 schema、migration、cross-reference validator、示例项目与测试 | `git diff --name-only` | 必须 |
| 目标结果 | schema 覆盖 MVP 数据；未知事件拒绝；`endMs < startMs` 拒绝；v0→v1 迁移成功；parse→serialize→parse 不丢数据 | 单元测试 + 示例 JSON | 必须 |
| 技术约束 | Zod discriminated union；UUID 字符串；逻辑画布固定 1920×1080；FPS 固定 24；时间整数毫秒；坐标以图层中心点为语义 | schema 与测试 | 必须 |
| 风险边界 | 不做 UI；不做磁盘读写；不做自动保存；不做素材导入；不设计 V2/V3 空壳字段 | diff 审查 | 必须 |
| 测试基线 | 记录变更前 typecheck/lint/test/build 状态 | `pnpm typecheck`；`pnpm lint`；`pnpm test:unit`；`pnpm build` | 必须 |
| 文档同步 | 更新 `docs/architecture.md` 的数据模型、坐标与版本策略；新建 `docs/test-receipts/DAY-11.md` | 文档 diff | 必须 |
| 历史债务 | 探针 schema 与正式 schema 字段不一致时，必须记录兼容方案，不得悄悄丢弃已有 probe 数据 | 决策记录 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | MVP 需要项目、素材、角色、镜头、图层、对白、音频、字幕样式和时间轴事件。 |
| 待确认问题 | 现有探针字段命名；TimelineEvent 当前实际类型；跨引用校验采用 `superRefine` 还是独立 validator；v0 测试夹具的最小形态。 |
| 预期输出 | 一个稳定的 `ProjectSchema v1` 与纯函数 migration API。 |
| 停止条件 | 全部核心实体、全部 MVP 事件、版本检测、跨引用验证、round-trip 和 v0→v1 测试完成。 |

---

## 【模块3】工单矩阵（通用高压版）

### 1）基础信息

- **工单编号**：B-11/45
- **角色**：Engineer
- **目标**：完成正式项目数据契约、版本检测与迁移框架。
- **依赖关系**：强依赖 Gate A PASS；依赖 Day 2 的最小模型作为迁移输入参考。

### 2）输出交付物

- **预计变更文件**：
  - `shared/constants.ts`
  - `src/domain/models/project.ts`
  - `src/domain/models/asset.ts`
  - `src/domain/models/character.ts`
  - `src/domain/models/shot.ts`
  - `src/domain/models/layer.ts`
  - `src/domain/models/dialogue.ts`
  - `src/domain/models/audio.ts`
  - `src/domain/models/subtitle.ts`
  - `src/domain/models/timeline-event.ts`
  - `src/domain/migrations/index.ts`
  - `src/domain/validators/projectReferences.ts`
  - `tests/unit/models/*.test.ts`
  - `tests/unit/migrations/*.test.ts`
  - `demo-project/project-v1.example.json`
  - `docs/architecture.md`
  - `docs/test-receipts/DAY-11.md`
- **核心修改点**：
  - `schemaVersion: 1`；
  - `detectSchemaVersion(input)`；
  - `migrateProject(input)`；
  - Project、Asset、Character、VoiceProfile、Shot、Layer、Dialogue、AudioClip、SubtitleStyle；
  - TimelineEvent discriminated union 至少覆盖 `move / scale / opacity / shake / expression / flip / visibility`；
  - 默认值、时间边界、非空名称、固定画布/FPS；
  - 跨引用校验：素材、角色、表情、音频、图层和事件引用必须存在；
  - round-trip 稳定性测试；
  - v0 fixture 迁移到 v1。
- **必须包含**：
  - 未知 `event.type` 被拒绝；
  - 未知 `schemaVersion` 被拒绝；
  - 缺失引用被拒绝并指出路径；
  - `endMs < startMs` 被拒绝；
  - 时间字段为负数或小数被拒绝；
  - `parse → serialize → parse` 结果语义一致；
  - v0→v1 迁移不访问外部资源。
- **禁止包含**：
  - UI 组件；
  - Electron IPC；
  - 文件系统读写；
  - 为未来假想需求加入大量 nullable 字段；
  - 用 `z.any()`、`unknown as` 或宽泛 record 绕过契约；
  - 静默删除未知字段而不记录迁移决策。
- **交付证明**：
  - schema/migration 单元测试真实输出；
  - 示例 JSON 成功 parse；
  - 至少 4 类非法数据失败证据；
  - 架构文档与 schemaVersion 决策记录。

### 3）规模与复杂度观察

- 每个实体 schema 保持单一职责；跨引用校验允许集中到独立 validator。
- TimelineEvent 联合类型如较长，应按事件文件拆分后统一导出，不得塞进一个巨型文件。
- 若迁移框架为了仅有 v0→v1 引入过重注册中心，必须简化；本日目标是“可扩展”，不是“预建十代迁移宇宙”。
- 如因跨引用校验复杂触发例外，声明 `DEBT-COMPLEXITY-B11-001` 并说明未来拆分点。

### 4）自动化质量闸门（强制）

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 不新增 lint error | `pnpm lint` | 返工 |
| TEST | schema、迁移、非法引用、round-trip 测试通过 | `pnpm test:unit` | 返工 |
| ARCH | domain 层无 Electron/React/FS 依赖 | `git grep -n "electron\|react\|node:fs\|child_process" -- src/domain shared` | 返工 |
| REAL | 示例 JSON 由真实 schema parse，不是假断言 | 测试与 fixture 证据 | 返工 |
| DOC | 数据模型与迁移策略已同步 | `git diff -- docs/architecture.md docs/test-receipts/DAY-11.md` | 返工或声明债务 |

---

## 【模块3-A】刀刃表（16 项，强制命令化）

| 类别 | 检查点 ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | `ProjectSchema v1` 可解析示例项目 | 运行对应单测或解析脚本 | [ ] |
| FUNC | FUNC-002 | 全部 MVP 实体均有 schema | 文件清单 + 导出检查 | [ ] |
| FUNC | FUNC-003 | TimelineEvent 全量联合类型可解析合法事件 | 事件参数化测试 | [ ] |
| FUNC | FUNC-004 | v0 fixture 可迁移为 v1 | migration 单测 | [ ] |
| CONST | CONST-001 | 固定 1920×1080 / 24 FPS | 常量与拒绝测试 | [ ] |
| CONST | CONST-002 | 时间字段必须为非负整数毫秒 | 负数与小数测试 | [ ] |
| CONST | CONST-003 | 坐标语义为图层中心点 | schema 注释 + 文档证据 | [ ] |
| CONST | CONST-004 | domain 无 UI/Electron/FS 依赖 | 静态搜索结果 | [ ] |
| NEG | NEG-001 | 未知事件类型被拒绝 | 单测 | [ ] |
| NEG | NEG-002 | `endMs < startMs` 被拒绝 | 单测 | [ ] |
| NEG | NEG-003 | 缺失素材/角色/音频引用被拒绝 | 跨引用单测 | [ ] |
| NEG | NEG-004 | 未来未知 schemaVersion 被拒绝 | 单测 | [ ] |
| UX | UX-001 | 验证错误包含可定位字段路径 | 错误快照/断言 | [ ] |
| UX | UX-002 | 示例 JSON 对人可读且字段命名一致 | fixture 审查 | [ ] |
| E2E | E2E-001 | parse→serialize→parse 语义一致 | round-trip 测试 | [ ] |
| High | HIGH-001 | 迁移不丢关键字段且不访问外部资源 | 迁移对比 + 静态搜索 | [ ] |

---

## 【模块3-B】地狱红线（10 项）

1. Gate A 非 PASS 仍开始 Day 11 → 立即停止。
2. 使用 `z.any()` 或类型断言绕过核心契约 → 返工。
3. 时间字段使用浮点秒或混合单位 → 返工。
4. 未知 schemaVersion 被静默接受 → 返工。
5. 未知事件被丢弃后仍声称迁移成功 → 返工。
6. migration 访问文件系统、Electron 或网络 → 返工。
7. 只测合法路径，不测非法引用与边界 → 返工。
8. 顺手实现项目 UI 或文件保存 → 范围失控。
9. 示例 JSON 与 schema 不一致却未跑真实解析 → 返工。
10. 自动化门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测轻量检查表 v3.0

| 检查点 | 自检问题 | 覆盖情况 | 相关用例 / 命令 | 备注 |
|---|---|---|---|---|
| CF | 全部 MVP 实体与事件是否可解析？ | [ ] | CF-B11-001 | |
| RG | Day 2 探针数据是否有明确迁移方案？ | [ ] | RG-B11-001 | |
| NG | 未知版本、事件、非法时间、缺失引用是否覆盖？ | [ ] | NG-B11-001 | |
| UX | 错误路径是否能定位到具体字段？ | [ ] | UX-B11-001 | |
| E2E | round-trip 与 v0→v1 是否真实跑通？ | [ ] | E2E-B11-001 | |
| High | 数据迁移是否无静默丢失？ | [ ] | HIGH-B11-001 | |
| 字段完整性 | 回执是否记录测试数、失败夹具和结果？ | [ ] | `DAY-11.md` | |
| 需求映射 | 刀刃表是否覆盖 Daily Plan Day 11 全项？ | [ ] | 本文 | |
| 自测执行 | 是否真实运行全量 unit tests？ | [ ] | `pnpm test:unit` | |
| 范围边界与债务 | 未覆盖事件/字段是否显式申报？ | [ ] | 债务声明 | |

---

## 【模块5】收卷格式（强制结构）

```markdown
## ✅ 工单 B-11/45 完成并提交

### 提交信息
- Commit: `feat(project): define complete versioned ProjectSchema v1`
- 分支: `feat/day-11-project-schema-v1`
- Gate A: PASS（证据路径）
- 基线 SHA: `<执行前真实输出>`
- 结果 SHA: `<提交后真实输出>`
- 变更文件: [逐项列出]

### 本轮目标与实际结果
- 目标: 完整 ProjectSchema v1 + migration framework
- 实际完成: [真实完成项]
- 未完成/不在范围: 项目磁盘生命周期、UI、自动保存

### 关键决策记录
- DECISION-001: [实体拆分策略]
- DECISION-002: [跨引用校验策略]
- DECISION-003: [v0→v1 迁移策略]

### 自动化质量检查报告
- `pnpm typecheck`: [真实摘要]
- `pnpm lint`: [真实摘要]
- `pnpm test:unit`: [真实摘要]
- `pnpm build`: [真实摘要]
- 合法 fixture: [数量与结果]
- 非法 fixture: [数量与结果]

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
- DEBT-COMPLEXITY-B11-001: [无 / 具体内容]
- DEBT-MIGRATION-B11-001: [无 / 具体内容]
- DEBT-TEST-B11-001: [无 / 具体内容]

### 风险与回滚点
- 主要风险: schema 过宽或迁移静默丢字段
- 回滚方式: `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| GATE-B11-001 | Gate A 非 PASS | 停止 Day 11 | 阻塞 |
| ARCH-B11-001 | domain 必须依赖 Electron/UI 才能工作 | 重构依赖边界 | 返工 |
| DATA-B11-001 | 迁移无法避免关键字段丢失 | 暂停并形成迁移决策记录 | 阻塞 |
| QUALITY-B11-001 | 非法数据仍可通过 schema | 收紧契约与补测试 | 返工 |
| COMPLEXITY-B11-001 | 跨引用校验过度集中且连续返工 | 允许声明债务后拆分 validator | 有条件交付 |
| TEST-B11-001 | 无法形成 round-trip 或 migration 自动化测试 | 不得收卷 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 11：ProjectSchema v1 + Migration Framework**！

### 验收铁律
- Gate A 必须 PASS；
- MVP 实体与事件全部有正式 schema；
- 时间统一为整数毫秒；
- 未知版本、未知事件、非法引用全部被拒绝；
- v0→v1 与 round-trip 测试通过；
- domain 层无 UI/Electron/文件系统依赖。

Ouroboros 闭环启动，**B-11/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "ProjectSchema\|TimelineEvent\|schemaVersion\|migrateProject" -- shared src tests demo-project
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
git grep -n "electron\|react\|node:fs\|child_process" -- src/domain shared
git diff --stat
git diff -- src/domain shared tests/unit docs/architecture.md docs/test-receipts/DAY-11.md
```
