# Panda Stage Agent Task — Day 16

> **工单编号**：B-16/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 16  
> **分支建议**：`feat/day-16-asset-import`  
> **任务类型**：功能开发 + 文件安全 + 数据一致性  
> **唯一目标**：把外部 PNG、JPG、MP3、WAV 安全复制进当前项目 `assets/`，完成真实类型校验、哈希去重、文件名冲突处理，并保证失败时项目模型不被污染。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Asset Import Service + Validation + Deduplication
- **轰炸目标**：建立 Main Process 素材导入服务、受控 IPC、文件选择与拖放入口，完成白名单校验、内容读取、哈希、复制、去重与事务式模型更新。
- **任务性质**：功能开发 + 安全边界 + 集成测试
- **输入基线**：M1 Gate 必须 PASS；项目目录、ProjectSchema v1、原子保存、相对路径与 Unicode 路径能力已可用。
- **输出要求**：四类素材可导入 + 重复与冲突可处理 + 失败不写模型 + 自动化闸门 + 16 项刀刃表 + 结构化收卷。
- **通用铁律**：
  1. **Gate 前置**：`docs/test-receipts/M1.md` 结论不是 PASS 时立即停止。
  2. **复制入项目**：不得只记录外部原路径；导入完成后项目必须能脱离原文件继续使用。
  3. **三重校验**：扩展名、声明类型与实际可读取内容不得只信其中一个。
  4. **事务一致性**：复制失败、校验失败或保存失败时，不得向 Project 模型留下半条 Asset。
  5. **路径安全**：目标文件名必须净化，不允许目录穿越或覆盖未知文件。

---

## 【模块2】输入基线（完整技术背景，零占位符）

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | M1 Gate 必须为 PASS | 读取 `docs/test-receipts/M1.md` | 必须 |
| 当前项目能力 | 项目目录包含 `assets/`，ProjectService 能原子保存，Asset schema 已存在 | `git grep -n "ProjectService\|AssetSchema\|assets" -- electron src shared tests` | 必须 |
| 目标范围 | AssetImportService、文件类型检测、哈希、IPC/Preload、最小导入入口、集成测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | PNG/JPG/MP3/WAV 导入成功；不支持类型拒绝；重复素材不静默复制；中文名正常；中途失败模型保持一致 | integration test + 手动证据 | 必须 |
| 技术约束 | Main 唯一读写外部文件；Renderer 只传受控选择结果或 drop token；项目记录相对路径；hash 算法固定并文档化 | 代码与测试 | 必须 |
| 风险边界 | 不生成缩略图；不读取音频时长；不做素材库网格；不做角色定义；不做网络下载 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁与 M1 回归当前结果 | `pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm build` | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-16.md`；同步素材目录与导入安全协议 | 文档 diff | 必须 |
| 历史债务 | 若 Asset schema 缺少 hash、relativePath、mediaKind 等必要字段，必须以最小迁移补齐并记录 | schema diff + migration test | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 项目素材必须落盘到项目内；支持类型限定为 PNG/JPG/MP3/WAV。 |
| 待确认问题 | 当前 Electron 文件对话框封装；内容嗅探方式；大文件 hash 是否需要流式；重复素材 UX 返回结构。 |
| 预期输出 | 一个不会污染模型、支持 Unicode、可检测重复的导入事务。 |
| 停止条件 | 四类正常路径、四类失败路径、重复与冲突路径全部有证据。 |

---

## 【模块3】工单矩阵（通用高压版）

### 1）基础信息

- **工单编号**：B-16/45
- **角色**：Engineer
- **目标**：完成安全素材导入、去重与失败回滚。
- **依赖关系**：依赖 M1 Gate PASS、ProjectService 与 Asset schema。

### 2）输出交付物

- **预计变更文件**：
  - `electron/main/services/AssetImportService.ts`
  - `electron/main/services/FileSystemService.ts`
  - `electron/main/services/HashService.ts` 或等价纯服务
  - `electron/main/ipc/handlers/assets.ts`
  - `electron/preload/index.ts`
  - `shared/asset-import-types.ts`
  - `src/features/assets/AssetImportButton.tsx`
  - `src/features/assets/useAssetDrop.ts`
  - `tests/unit/assets/*.test.ts`
  - `tests/integration/asset-import.test.ts`
  - `tests/fixtures/assets/`
  - `docs/test-receipts/DAY-16.md`
- **核心修改点**：
  - 文件选择与拖放导入入口；
  - 白名单扩展名与媒体种类映射；
  - 实际解码/读取或文件签名校验；
  - 流式 hash；
  - hash 重复检测；
  - 文件名冲突采用可预测重命名或复用策略；
  - 先复制到临时目标，再确认写入项目模型；
  - 保存失败时删除本轮新复制文件或记录可清理状态；
  - 统一返回 imported / duplicate / rejected / failed 结果。
- **必须包含**：
  - PNG、JPG、MP3、WAV 四类成功用例；
  - 扩展名伪装文件被拒绝；
  - 同一文件重复导入不会产生两份静默副本；
  - 同名不同内容可安全共存；
  - 中文和空格文件名通过；
  - 复制或保存故障时项目 JSON 与 Asset 数量不变；
  - 原始外部文件删除后项目内副本仍存在。
- **禁止包含**：
  - Renderer 直接读本地文件系统；
  - 只按扩展名放行；
  - 用绝对路径写入项目模型；
  - 先修改模型再尝试复制且无回滚；
  - 覆盖已有项目文件；
  - 缩略图、元数据、素材库 UI 等 Day 17/18 内容。
- **交付证明**：
  - 四类 fixture 测试输出；
  - hash 与重复检测结果；
  - 中文文件名落盘路径；
  - 故障注入前后 project.json hash；
  - 原文件删除后的项目副本验证。

### 3）规模与复杂度观察

- 校验、hash、复制、模型更新应分步骤但由单一导入事务编排。
- 大文件必须流式读取，禁止一次性把完整 MP3/WAV 装进 Renderer 内存。
- 若实际媒体嗅探库引入成本较高，必须说明选择与许可证；不得用 `DEBT` 掩盖“只看扩展名”。
- 若回滚状态机较复杂，声明 `DEBT-COMPLEXITY-B16-001` 并给出清偿点。

### 4）自动化质量闸门（强制）

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式检查通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增 lint error | `pnpm lint` | 返工 |
| TEST | 类型、hash、重复、冲突、失败回滚测试通过 | `pnpm test:unit` + integration 测试 | 返工 |
| ARCH | Renderer 无 FS；项目只存相对路径 | 静态搜索 + JSON 断言 | 返工 |
| REAL | 真实文件复制并可脱离原文件使用 | 删除原文件后的验证 | 返工 |
| DOC | 导入协议与 Day 16 回执同步 | 文档 diff | 返工或声明债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | PNG/JPG 导入成功 | fixture integration tests | [ ] |
| FUNC | FUNC-002 | MP3/WAV 导入成功 | fixture integration tests | [ ] |
| FUNC | FUNC-003 | 文件被复制到项目 `assets/` | 目录与 JSON 证据 | [ ] |
| FUNC | FUNC-004 | hash 重复检测生效 | 重复导入测试 | [ ] |
| CONST | CONST-001 | Main Process 唯一读写素材 | 静态搜索 | [ ] |
| CONST | CONST-002 | 项目记录相对路径 | JSON 断言 | [ ] |
| CONST | CONST-003 | 同名不同内容不会覆盖 | 冲突测试 | [ ] |
| CONST | CONST-004 | hash 算法固定并记录 | 代码与文档 | [ ] |
| NEG | NEG-001 | 不支持类型被拒绝 | fixture test | [ ] |
| NEG | NEG-002 | 扩展名伪装文件被拒绝 | signature/decode test | [ ] |
| NEG | NEG-003 | 复制失败不修改模型 | 故障注入 + hash | [ ] |
| NEG | NEG-004 | 保存失败可回滚新文件与模型 | integration test | [ ] |
| UX | UX-001 | 重复素材提示清楚 | 返回结构/UI 证据 | [ ] |
| UX | UX-002 | 中文、空格文件名正常 | Windows 实测 | [ ] |
| E2E | E2E-001 | 选择文件→导入→保存→重开仍存在 | 完整流程 | [ ] |
| High | HIGH-001 | 删除外部原文件不影响项目副本 | 删除后打开验证 | [ ] |

---

## 【模块3-B】地狱红线（10 项）

1. M1 Gate 非 PASS 仍开工 → 停止。
2. Renderer 直接访问文件系统 → 返工。
3. 只按扩展名判断真实类型 → 返工。
4. 项目记录外部绝对路径 → 返工。
5. 复制失败后模型出现半条 Asset → 返工。
6. 同名文件覆盖已有素材 → 返工。
7. 重复素材被静默复制多份 → 返工。
8. 顺手实现缩略图、素材库或角色 UI → 范围失控。
9. 未删除外部原文件验证独立性 → 未验证。
10. 自动化门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测轻量检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 四类素材标准导入是否通过？ | [ ] | CF-B16-001 |
| RG | M1 保存和路径能力是否保持？ | [ ] | RG-B16-001 |
| NG | 伪装文件、重复、冲突、写入失败是否覆盖？ | [ ] | NG-B16-001 |
| UX | 重复、拒绝和失败提示是否可理解？ | [ ] | UX-B16-001 |
| E2E | 导入后保存重开是否完整？ | [ ] | E2E-B16-001 |
| High | 项目是否真正脱离外部原文件？ | [ ] | HIGH-B16-001 |
| 字段完整性 | 回执是否记录 fixture、hash、路径与结果？ | [ ] | DAY-16.md |
| 需求映射 | 是否覆盖 Day 16 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实导入 Unicode 文件名？ | [ ] | Windows 证据 |
| 范围边界与债务 | 嗅探/回滚限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-16/45 完成并提交

### 提交信息
- Commit: `feat(assets): import validated local media into project storage`
- 分支: `feat/day-16-asset-import`
- M1 Gate: PASS（证据路径）
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- PNG/JPG:
- MP3/WAV:
- 重复检测:
- 同名冲突:
- Unicode 文件名:
- 故障回滚:
- 删除外部原文件后的项目状态:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration tests:
- `pnpm build`:

### 决策与债务
- DECISION-001: [媒体真实性校验方式]
- DECISION-002: [hash 与命名策略]
- DECISION-003: [事务与回滚策略]
- DEBT-COMPLEXITY-B16-001:
- DEBT-TEST-B16-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| GATE-B16-001 | M1 非 PASS | 停止 Day 16 | 阻塞 |
| DATA-B16-001 | 导入失败污染项目模型 | 重构为事务式导入 | 阻塞 |
| SECURITY-B16-001 | 只能靠扩展名或 Renderer FS 实现 | 收敛 Main 服务与真实校验 | 返工 |
| PATH-B16-001 | Unicode 文件名失败 | 修路径与命名策略 | 阻塞 |
| TEST-B16-001 | 无真实媒体 fixture | 补合法来源 fixture，不得假测 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 16：Asset Import Service + Validation + Deduplication**！

验收铁律：四类素材真实可导入；复制进项目；只存相对路径；重复不静默复制；同名不覆盖；失败不污染模型；Unicode 文件名通过。

Ouroboros 闭环启动，**B-16/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "AssetImportService\|AssetSchema\|hash\|relativePath" -- electron src shared tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --stat
git diff -- electron/main/services electron/main/ipc electron/preload src/features/assets shared tests docs/test-receipts/DAY-16.md
```
