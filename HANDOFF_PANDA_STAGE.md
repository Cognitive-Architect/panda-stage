# Panda Stage 工程接管手册｜Day 24 Merged / Day 25 Ready

> 最后现场核对：2026-07-26T19:54:46+08:00  
> 事实基线：`origin/main` @ `5ad69110f7141cbc969466c8179bf1709753a945`  
> 本文只描述已核对事实、来源冲突与待验证项，不代表产品已正式发行。

## 0. 如何使用本接管文档

1. 先核对 Git/GitHub 现场，再使用本文；旧聊天、旧计划标题和回执中的旧 SHA 不能覆盖当前仓库事实。
2. “已完成”只表示已有合并提交和对应回执，不等于已正式发布。
3. “未验证”表示本轮未获得足够证据；不得把它改写成“应该可用”。
4. 接手顺序固定为：同步 `main` → 阅读本文和 Day 25 工单 → 审计事件/求值/正式渲染链 → 记录决策 → 创建 Day 25 分支 → 纯函数与测试 → UI → M3 Gate。
5. 本轮按 Issue #51 禁止开发 Day 25、修改业务源码、重跑全量 Electron 回归或重生 evidence。

本次事实核对使用了 `git status --short`、`git branch --show-current`、`git rev-parse HEAD`、`git log`、`git remote -v`、GitHub PR/Issue 查询和源码搜索。文档分支创建时干净，仓库根目录为 `D:\panda-stage\.worktrees\handoff`；原工作目录的用户改动未被触碰。

**人话版：** 把本文当导航，不当缓存。真正开工前仍要看最新 Git 现场。

## 1. 一页式当前状态

```yaml
project_name: Panda Stage
repository: https://github.com/Cognitive-Architect/panda-stage
current_stage: Day 24 CLOSED / Day 25 READY
overall_status: Day 24 已合并；Day 25 未启动；产品未声明正式发行
current_main_branch: main
current_main_sha: 5ad69110f7141cbc969466c8179bf1709753a945
latest_merged_pr: "#48"
latest_merge_commit: 5ad69110f7141cbc969466c8179bf1709753a945
current_schema_version: 5
completed_days: "Day 01-24（以合并记录、Gate 和回执限定能力范围）"
completed_milestones:
  - Gate A PASS
  - M1 PASS
  - M2 PASS
  - M3 NOT PASSED
current_task: "B-25/45 Action Presets + Validated Event Generation + M3 Gate"
current_task_status: NOT STARTED
current_blocker: "无已确认外部 blocker；开工前必须处理正式 TimelineEvent 与旧 preview/export evaluator 的消费链分叉"
next_single_action: "从最新 main 创建 feat/day-25-action-presets，并先完成事件/求值/正式渲染链预检"
confidence_score: "4/5（Git/PR/源码高；安装、低配性能及正式导出全链未完整验证）"
last_verified_at: 2026-07-26T19:54:46+08:00
```

现场 GitHub 事实：

- PR #48 状态为 `MERGED`，合并时间 2026-07-26，PR head 为 `d416f8b0c51d60d042e0d6793001503716e4ee59`。
- 合并后 `origin/main` 为 `5ad69110f7141cbc969466c8179bf1709753a945`。
- 查询时无开放 PR，无 Day 25 远端分支、提交或 PR 证据。
- 本文专用分支 `docs/panda-stage-handoff-day25` 从上述 `origin/main` 创建；这不是 Day 25 功能启动证据。

## 2. 产品是什么

Panda Stage 是面向初学者的桌面短 2D 剪纸动画编辑器，当前包描述见 `package.json`。目标工作流是把图片、角色定义和镜头组织成固定逻辑画布中的短动画，并通过预览/导出链生成视频素材。

当前已经有证据覆盖的能力包括：项目生命周期、素材导入与引用保护、角色/表情定义、镜头管理、固定画布与 viewport、图层放置/变换/层级/锁定/翻转、内存撤销重做，以及若干预览/导出 probe。

当前不是：

- 已正式发行或已完成安装签名/自动更新的商业产品；
- 完整时间轴、关键帧曲线、复杂转场或脚本系统；
- 骨骼动画、口型音素或 TTS/声音克隆工具；
- 已通过 M3 的动作预设编辑器；Day 25 尚未开始。

**人话版：** 它已经能搭静态镜头和编辑图层，但“点选动作预设并可靠地在正式预览/导出中动起来”仍是下一关。

## 3. 当前里程碑地图

### Day 01～10 / Gate A

- 已完成能力：Electron/Vite/React 基础、领域模型、IPC 边界、共享渲染 probe、音频/FFmpeg/导出/取消/路径和打包基础。
- Gate：`docs/test-receipts/GATE-A.md` 记录 PASS。
- 合并状态：能力已在当前 `main` 历史中；本轮未逐日重放早期 PR。
- 证据：`docs/test-receipts/GATE-A.md`、`docs/evidence/gate-a/`、`package.json` 的 `verify:day03`～`verify:day09` 与 `verify:gate-a`。
- 债务：早期 probe 与现行正式 schema 并存；不得直接把 probe 证明推广为全部正式项目路径。

### Day 11～15 / M1

- 已完成能力：正式项目创建、打开、恢复、保存、修订安全与生命周期边界。
- Gate：`docs/test-receipts/M1.md` 记录 PASS。
- 关键分支：`chore/day-15-m1-gate`；本轮未重新运行 M1。
- 证据：`docs/test-receipts/M1.md`、`docs/evidence/m1/`、`verify:m1`。
- 已记录债务：UNC 网络 IO 未验证；legacy probe schema v1 兼容路径仍在；renderer 主 chunk 超过 500KB。

### Day 16～20 / M2

- 已完成能力：素材导入/元数据/缩略图、素材库和引用保护、角色定义、镜头 CRUD/复制/排序/时长/重开。
- Gate：`docs/test-receipts/M2.md` 记录 PASS。
- 关键 PR：Day 19 PR #38；Day 20 PR #39。
- 证据：M2 回执、Day 19 回执、Day 20 machine evidence。
- 缺口：`docs/test-receipts/DAY-20.md` 未找到；只能用 PR #39、`docs/evidence/day-20/results.json` 与 M2 回执交叉证明。

### Day 21～25 / M3

- Day 21～24 已完成并合并：固定画布、图层放置、静态变换、History。
- 关键 PR：#41、#44、#46、#48。
- Day 25：动作预设、合法事件生成及 M3 Gate，**未启动、未完成、未 PASS**。
- 证据：Day 21～24 回执/evidence 与 `agent task/DAY-25-AGENT-TASK.md`。
- 冲突：`ROADMAP.md` 把 M3 写为 Day 21～27，`DAILY_PLAN.md` 的旧标题映射也与详细任务发生漂移；Issue #51 要求按 Day 21～25 接管，且详细 Day 25 工单是当前实施合同。若 Gate 定义要扩到 Day 27，必须先形成明确决策，不能静默改口径。

**人话版：** Gate A、M1、M2 已过；M3 还差 Day 25，不能因为前四天合并就称 M3 完成。

## 4. Day 19～24 精确进度

```yaml
day: 19
feature: Character Definitions
branch: feat/day-19-character-definitions
final_head: 009df3e4b0852b4908c7c2add81f8f9ec9f6c9c3
pull_request: "#38 MERGED"
merge_commit: c5c94beeacb7a458d9bca33acdc9766e041b3cb5
issues_closed: ["#35"]
schema_change: "引入角色 defaultExpressionId/defaultScale/defaultFlipX 等；当时正式版本推进到 v2"
core_result: "角色/表情定义、替换、引用保护、修订安全保存均有测试与 Electron evidence"
test_receipt: docs/test-receipts/DAY-19.md
machine_evidence: docs/evidence/day-19/results.json
known_limits:
  - "回执 Result SHA 5dc27e... 与 GitHub PR 最终 head 冲突；采用 GitHub 009df3..."
  - "baseAssetId 仍是默认表情素材的兼容别名"
  - "自动截图代替人工视频"
```

```yaml
day: 20
feature: Shot Management / M2 closeout
branch: feat/day-20-shot-management
final_head: b25c0d6547f0f20684b145d70d99b2c2dd98b8b0
pull_request: "#39 MERGED"
merge_commit: d654e06a9825851087c6932a4b601ce33c2f2af5
issues_closed: ["#40"]
schema_change: "本轮未从独立 Day 20 回执验证；以当前 v5 与迁移链为最终事实"
core_result: "镜头 CRUD、复制、排序、时长与保存重开；M2 回执为 PASS"
test_receipt: "未找到 docs/test-receipts/DAY-20.md；替代来源 docs/test-receipts/M2.md"
machine_evidence: docs/evidence/day-20/results.json
known_limits:
  - "独立 Day 20 回执缺失"
```

```yaml
day: 21
feature: Fixed Canvas and Shared Rendering
branch: feat/day-21-canvas-stage
final_head: 27ba25a3287c421aa1c26041d5bc41ec86daca65
pull_request: "#41 MERGED"
merge_commit: 61f9b1a486bc657e9099e109c15218ea4d9e9c8c
issues_closed: ["#42", "#43"]
schema_change: "v3；Shot.backgroundLayerId 成为唯一背景身份"
core_result: "1920×1080 逻辑画布、Fit/Actual viewport、显式背景和共享 layer render contract"
test_receipt: docs/test-receipts/DAY-21.md
machine_evidence: docs/evidence/day-21/results.json
known_limits:
  - "编辑预览继续使用 thumbnail preload；全分辨率素材加载留给后续 renderer"
```

```yaml
day: 22
feature: Asset-to-Canvas Placement
branch: feat/day-22-layer-placement
final_head: 40f90fbe96ca91d57e52f6a3e451045c123a18c0
pull_request: "#44 MERGED"
merge_commit: 4a5266c6147b11b0769d85f5fa91fd8361ca767d
issues_closed: ["#45"]
schema_change: "v4；Layer.locked 为必填，v3 迁移默认 false"
core_result: "素材/角色明确身份拖放、逻辑坐标放置、选择、拖动、属性提交与锁定"
test_receipt: docs/test-receipts/DAY-22.md
machine_evidence: docs/evidence/day-22/results.json
known_limits:
  - "viewport 与选择仅为 renderer 会话状态"
  - "普通图片不会被隐式认定为背景"
```

```yaml
day: 23
feature: Layer Transform, Flip, Order, Lock and Delete
branch: feat/day-23-layer-controls
final_head: 73710ead3d25085145a4a7b8cf68e02a1a950a0e
pull_request: "#46 MERGED"
merge_commit: ed046c1ee58adca31057cabf79469afc83d59b6b
issues_closed: ["#47"]
schema_change: "v5；Layer.flipX 显式持久化，scale 继续保持正数"
core_result: "静态变换、overlay Transformer、层级、锁定、删除；生产 flip probe 有像素证据"
test_receipt: docs/test-receipts/DAY-23.md
machine_evidence:
  - docs/evidence/day-23/results.json
  - docs/evidence/day-23/issue-47-results.json
known_limits:
  - "不包含 undo/redo、时间轴变换编辑、多选或对齐工具"
```

```yaml
day: 24
feature: Command History, Undo/Redo and Drag Coalescing
branch: feat/day-24-history
final_head: d416f8b0c51d60d042e0d6793001503716e4ee59
pull_request: "#48 MERGED"
merge_commit: 5ad69110f7141cbc969466c8179bf1709753a945
issues_closed: ["#49", "#50"]
schema_change: "无；History/selection/draft 不进入 Project schema"
core_result: "最多 50 条 renderer-memory ProjectCommand；真实 Project undo/redo；手势末端一次提交"
test_receipt: docs/test-receipts/DAY-24.md
machine_evidence: docs/evidence/day-24/results.json
known_limits:
  - "Project 相等性在中央写入边界使用确定性 JSON 序列化；项目变大后需 profile"
  - "History 不跨进程、不跨会话持久化"
```

## 5. 当前系统架构地图

| 区域 | 真实路径 | 职责与依赖 |
|---|---|---|
| Electron Main | `src/main/index.ts`, `src/main/windows/`, `src/main/services/` | 创建窗口、文件 IO、项目/素材/导出服务和 IPC；正式写盘只在 Main。 |
| Preload / IPC | `src/preload/index.ts`, `src/preload/hidden.ts`, `src/shared/ipc/` | 通过 `contextBridge` 暴露冻结 API；窗口启用 `contextIsolation`、关闭 `nodeIntegration`。 |
| Renderer | `src/renderer/App.tsx`, `src/renderer/features/` | UI 和会话状态；通过 preload 调用 Main。 |
| Project Schema / Migration | `src/domain/models/project.ts`, `src/domain/migrations/index.ts`, `src/domain/constants.ts` | 当前正式 v5 严格解析和 v0～v5 迁移。 |
| Project Store | `src/renderer/stores/EditorProjectStore.ts` | renderer 中的当前正式 Project、revision、dirty 与更新入口。 |
| History Store | `src/history/HistoryStore.ts`, `src/history/commands/ProjectCommand.ts` | 仅 renderer 内存；保存 before/after Project 并驱动 undo/redo。 |
| Asset / Character / Shot | `src/domain/services/`, `src/renderer/stores/`, `src/main/services/` | 领域验证、引用保护、UI 命令和 Main 素材 IO。 |
| Canvas / Viewport | `src/renderer/features/canvas/`, `src/domain/selectors/stageRenderModel.ts` | 1920×1080 逻辑画布、viewport 变换、编辑渲染模型与交互。 |
| Layer Service | `src/domain/services/LayerService.ts` | 放置、变换、锁定、顺序、删除的领域边界。 |
| TimelineEvent | `src/domain/models/timeline-event.ts` | 正式事件 union：move/scale/opacity/shake/expression/flip/visibility。 |
| Evaluator | `src/shared/domain/evaluate-shot-at-time.ts` | 当前 shared/probe evaluator 只处理旧 `move` 事件；与正式 union 存在分叉。 |
| StageRenderer | `src/renderer/stage/StageRenderer.tsx`, `src/shared/stage/` | 消费 shared/probe Project/EvaluatedShot 和共享 layer render contract。 |
| Preview / Export | `src/renderer/stage/StagePreview.tsx`, `src/renderer/preview/`, `src/export-renderer/ExportRendererApp.tsx`, `src/main/services/ExportService.ts` | 预览及隐藏导出窗口；现有 ExportRendererApp 使用 shared evaluator 与 `PROBE_PROJECT` 路径。 |
| Test / Evidence / Gate | `tests/`, `scripts/`, `docs/test-receipts/`, `docs/evidence/` | 单元/集成/Electron 流程、机器结果和 Gate 回执。 |

数据修改方向：

```text
UI → Renderer Store/History → Domain Service/strict Project
   → Preload typed API → IPC → Main Service → filesystem
```

只存在 renderer 内存、不得序列化的状态包括 viewport、selection、Transformer、表单 draft 和 History。当前编辑 Canvas 使用正式 `src/domain` 模型；旧 Preview/Export probe 使用 `src/shared/domain/schema.ts`，后者的 `MoveEvent` 使用 `durationMs`，并非正式事件的 `startMs/endMs` 完整 union。

**人话版：** 仓库现在有“正式编辑数据链”和“旧预览/导出 probe 链”两条路。Day 25 不能只把事件写进前者，还必须证明后者能正确消费。

## 6. 不可破坏的工程合同

| # | 合同 | 证据路径 | 违反后果 | 人话解释 |
|---:|---|---|---|---|
| 1 | Main 独占文件系统和正式写盘 | `src/main/services/`, `src/main/index.ts` | 沙箱/修订/原子写边界被绕过 | 文件只让主进程碰。 |
| 2 | Renderer 不直接访问文件系统 | `src/preload/`, `src/main/windows/main-window.ts` | 权限扩大与不可控 IO | UI 只能走桥。 |
| 3 | 所有正式 Project 经过严格 Schema + Migration | `src/domain/models/project.ts`, `src/domain/migrations/index.ts` | 老项目或坏数据进入运行时 | 先验数据，再使用。 |
| 4 | 新持久字段不得静默塞进旧版本 | 同上及迁移测试 | 同版本出现多种含义 | 改数据就升级版本。 |
| 5 | 逻辑画布固定 1920×1080 | `src/domain/constants.ts`, Day 21 回执 | viewport/导出坐标漂移 | 缩放窗口，不缩放项目世界。 |
| 6 | viewport/selection/Transformer/History 不进项目 | Day 21～24 回执、`src/history/HistoryStore.ts` | 保存 UI 噪声、重开不确定 | 临时界面状态不存档。 |
| 7 | 编辑与正式预览/导出共用渲染合同 | `src/shared/stage/layer-render-contract.ts` | 编辑所见与输出不同 | 同一套图层规则必须贯通；事件链分叉仍待补证。 |
| 8 | 图层位置使用逻辑坐标 | `src/domain/models/project.ts`, Day 21/22 回执 | 不同窗口尺寸改变项目 | 存舞台坐标，不存屏幕像素。 |
| 9 | 拖动只在 gesture end 正式提交一次 | Day 22/24 回执 | revision/history 被 pointermove 淹没 | 一次手势就是一次命令。 |
| 10 | 项目修改经过领域 Service / Store | `src/domain/services/`, `src/renderer/stores/` | 校验、引用保护和 History 被绕过 | 不直接改对象。 |
| 11 | locked 不得被旁路 | `src/domain/services/LayerService.ts`, Day 22～24 测试 | 锁定形同虚设 | 锁住后所有写入口都要拒绝。 |
| 12 | undo/redo 修改真实 Project | `src/history/`, `src/renderer/stores/EditorProjectStore.ts` | UI 看似回退但保存数据不回退 | 撤销的是项目，不是画面假象。 |
| 13 | 背景使用 `backgroundLayerId` 明确引用 | `src/domain/models/project.ts`, Day 21 回执 | 名称/zIndex 猜测误分类 | 背景要点名，不猜。 |
| 14 | 角色拖放携带明确角色/表情身份 | Day 22 回执、canvas drag payload 源码 | 表情引用漂移 | 拖的是具体身份，不是图片猜测。 |
| 15 | flip 使用显式 `flipX`，持久 scale 保持正数 | v5 schema、Day 23 回执 | 负缩放破坏几何/验证 | 翻转单独记，不偷改缩放符号。 |
| 16 | 其他临时 UI 状态不得保存 | Project schema 与 Day 21～24 JSON assertions | 项目格式污染 | 只有创作结果进项目。 |
| 17 | 本地测试、CI、PR 合并、main 和正式发布必须区分 | receipts、GitHub PR、当前 Git | 把绿灯误报成发布 | 测过、合并、发布是三件事。 |

**人话版：** 所有规则都在保护同一件事：项目文件必须可迁移、可重开、可撤销，而且编辑画面不能骗过正式输出。

## 7. 当前 Schema 与迁移链

- 当前 `PROJECT_SCHEMA_VERSION = 5`，来源 `src/domain/constants.ts`。
- `src/domain/migrations/index.ts` 接受 legacy probe 及正式版本 0、1、2、3、4、5，并迁移至当前模型。
- 主要演进：
  - 角色迁移补齐 `defaultExpressionId`、`defaultScale`、`defaultFlipX`，保留 `baseAssetId` 兼容别名。
  - v2→v3：显式 `Shot.backgroundLayerId` 及背景身份规则。
  - v3→v4：`Layer.locked=false`。
  - v4→v5：`Layer.flipX=false`。
- `backgroundLayerId` 为 nullable 显式引用；背景必须指向有效直接图片 layer。
- Layer 当前关键字段含 `locked:boolean`、`flipX:boolean`，scale 必须为正，仓库边界为 `0.05..20`。
- Character 含 `baseAssetId`、`defaultVoiceProfileId`、`expressions`、`defaultExpressionId`、可选 `mouthOpenAssetId`、`defaultScale`、`defaultFlipX`。
- 正式 TimelineEvent 基础字段为 `id`、`layerId`、`startMs`、`endMs`，且 `endMs >= startMs`；union 为：
  - `move`：逻辑坐标起止；
  - `scale`：正数起止与 easing；
  - `opacity`：0～1 起止与 easing；
  - `shake`；
  - `expression`；
  - `flip`；
  - `visibility`。
- `move/scale/opacity` easing 支持 `linear` 与 `ease-in-out`。
- shared/probe `src/shared/domain/schema.ts` 仍只有使用 `durationMs` 的旧 `MoveEvent`；不能与正式 union 混称同一 schema。

新增持久字段的正确步骤：先定义语义与默认值 → 提升 schema version → 更新严格 schema → 写单向 migration → 增加旧版本/坏数据/保存重开测试 → 更新 renderer/export 消费者 → 更新 receipt/evidence。若 Day 25 现有事件字段足够，不得为预设配置随意升级 schema；若不足，则按上述步骤最小升级。

**人话版：** 正式项目是 v5。新增字段不能只改 TypeScript 类型，必须给旧项目一条可验证的升级路线。

## 8. 本地开发与验证命令

环境约束来自 `package.json`：Node `>=22.12.0 <25`，pnpm `>=10 <11`，锁定包管理器 `pnpm@10.13.1`。

```bash
# 安装（包管理器命令，不是 package.json script）
pnpm install --frozen-lockfile

# 开发
pnpm dev
pnpm dev:renderer
pnpm dev:electron

# 快速质量检查
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration

# 构建
pnpm build
pnpm build:renderer
pnpm build:electron
pnpm dist

# 素材/evidence 工具
pnpm assets:probe-audio
pnpm assets:generate-day16-fixtures
pnpm evidence:screenshot

# 现存逐日与专题验证
pnpm verify:day03
pnpm verify:day04
pnpm verify:day05
pnpm verify:day06
pnpm verify:day07
pnpm verify:day08
pnpm verify:day09
pnpm verify:day13
pnpm verify:day14
pnpm verify:day16
pnpm verify:day17
pnpm verify:day18
pnpm verify:day19
pnpm verify:day20
pnpm verify:day21
pnpm verify:day22
pnpm verify:day23
pnpm verify:day24
pnpm verify:issue47
pnpm verify:m1
pnpm verify:gate-a
```

成本说明：

- `typecheck`、`lint`、针对性 unit 是首轮快速检查。
- `build` 已包含 typecheck；逐日 verify 多数还会重复 build/integration。
- 除 Day 17 使用 Node、M1 使用 Node、Gate A 使用 Node 包装器外，列出的 Day verify 通常启动 Electron；Day 23 还串行运行 Issue #47 Electron probe。
- `dist` 包含发行构建，成本高于普通 build。
- `package.json` **没有** `verify:m2`、`verify:m3` 或 M3 script；M2 以现有回执/组合证据为准，Day 25 必须按工单补齐 M3 证据，不能伪造命令。
- 本轮遵守 Issue #51，未运行上述全量 Gate。

## 9. 当前唯一下一步：Day 25

- 工单：`agent task/DAY-25-AGENT-TASK.md`
- 建议分支：`feat/day-25-action-presets`
- 当前状态：未找到 Day 25 远端分支、提交或 PR；`main` 也无 Day 25 功能提交，因此为 **NOT STARTED**。
- 唯一目标：用户无需改代码，通过 UI 选择预设并由纯函数生成合法 TimelineEvent；写入 History；以静态镜头 + 基础动作完成 M3 Gate。
- 8 类预设及现行事件映射：
  1. 左入场 → `move`
  2. 右入场 → `move`
  3. 移动到 → `move`
  4. 放大强调 → `scale`
  5. 抖动 → `shake`
  6. 表情切换 → `expression`
  7. 淡入 → `opacity`
  8. 淡出 → `opacity`
- 生成规则：纯函数；唯一 event ID；整数毫秒；使用逻辑坐标；opacity 0～1；expression 必须属于对应角色；结果必须通过正式 schema/validator。
- 时间边界：不得静默越出 Shot；必须选择“拒绝”或“显式裁剪并在 UI 反馈”，并写测试。
- 保护：无选择时禁用；locked、失效 layer/character/expression 引用必须拒绝。
- History：应用预设必须经过 ProjectCommand/Store；undo/redo 改变真实 Project。
- 持久化：保存、关闭/重开后事件不丢。
- 冲突：至少检测同一 layer/同属性的重叠事件；若本日不解决，显式记录 `DEBT-CONFLICT-B25-001`。
- Gate 输出：`docs/test-receipts/M3.md`，结论只能 PASS 或 FAIL；任何未验证项按 FAIL。
- FAIL 后果：冻结 Day 26～45 实际开发，仅修 M3，并创建 `docs/decisions/M3-FAILURE-REPORT.md`。
- 禁止范围：直接操作 DOM/Konva 制造动画、完整时间轴 UI、关键帧曲线、复杂转场、脚本语言、提前做 Day 26。

最重要的实施前置不是新增 UI，而是证明 8 类事件从正式 Project 到 evaluator、StageRenderer、Preview/Export 的真实消费链。当前代码只证明旧 shared evaluator 的 move probe，不能据此认定 scale/shake/expression/opacity 已能在正式输出生效。

**人话版：** Day 25 不是做八段动画特效，而是做八个“合法事件生成器”，并证明保存、撤销、预览和导出都接得住。

## 10. Day 25 开工前核对清单

- [ ] 确认 HEAD 等于开工时最新 `origin/main`，工作区干净。
- [ ] 阅读 `src/domain/models/timeline-event.ts` 的完整正式 union 和字段约束。
- [ ] 对比 `src/shared/domain/schema.ts` 的旧 MoveEvent，禁止混用 `durationMs` 与 `endMs` 语义。
- [ ] 审计 `src/shared/domain/evaluate-shot-at-time.ts` 当前只支持 move 的事实。
- [ ] 逐项确认 8 预设映射：3 move、1 scale、1 shake、1 expression、2 opacity。
- [ ] 决定是否需要 schema/migration；字段已足够则不升级，字段不足才走完整迁移链。
- [ ] 对时间越界明确采用拒绝或显式裁剪，并定义 UI 反馈与测试。
- [ ] 定义同 layer/同属性区间重叠策略；至少检测并记录债务。
- [ ] 左/右入场与 move target 全部使用 1920×1080 逻辑坐标。
- [ ] 校验 expression 确属该 Character，并处理直接 asset layer 不可用路径。
- [ ] 确保重复生成得到唯一 event ID。
- [ ] 无选择禁用，locked/失效引用拒绝且不产生 revision/history。
- [ ] 通过 Store/History 写入，验证 undo/redo 和 redo 分支清理。
- [ ] 验证正式保存/重开保持事件。
- [ ] 让正式 Preview/Export 消费同一正式事件语义，而非只在编辑 UI 模拟。
- [ ] 设计 M3 真实操作证据：静态镜头 → 预设 → undo/redo → 保存重开 → 正式预览/输出。
- [ ] Gate 有任一核心项未证实就写 FAIL，不得先写 PASS 再补证据。

## 11. 已知风险与技术债务

```yaml
risk_id: RISK-EVENT-001
severity: critical
category: technical_debt
fact: "正式 src/domain TimelineEvent 有 7 类；shared preview/export evaluator 只处理旧 move/durationMs"
impact: "预设事件可保存但可能不在正式预览/导出中生效"
stop_loss: "Day 25 写 UI 前先形成统一消费链方案；M3 未证明全链则 FAIL"
required_evidence: "各预设的正式 Project→evaluator→StageRenderer/Export 机器断言和真实流程"
```

```yaml
risk_id: RISK-CONFLICT-002
severity: high
category: unverified
fact: "同 layer/同属性的重叠事件冲突策略未验证"
impact: "求值结果依赖隐含顺序，保存重开或导出可能不一致"
stop_loss: "至少检测并阻止/提示；未解决则登记 DEBT-CONFLICT-B25-001"
required_evidence: "区间重叠参数化测试、UI 反馈和确定性求值测试"
```

```yaml
risk_id: RISK-TIME-003
severity: high
category: unverified
fact: "Day 25 尚未选择越界拒绝或显式裁剪策略"
impact: "事件被静默截断或落到镜头外"
stop_loss: "实现前写明单一策略，禁止无反馈 clamp"
required_evidence: "start/end 边界、零长度、镜头末尾和 UI 提示测试"
```

```yaml
risk_id: RISK-EXPORT-004
severity: high
category: unverified
fact: "本轮未对含 8 类动作的长镜头执行正式导出性能测试"
impact: "交互可用但导出耗时或内存不可接受"
stop_loss: "M3 先证明正确性；性能异常即记录样本并停止扩大功能"
required_evidence: "固定机器/镜头/帧数的耗时、峰值内存和输出帧一致性"
```

```yaml
risk_id: RISK-FFMPEG-005
severity: high
category: unverified
fact: "FFmpeg 子进程峰值内存未在 Day 25 场景完整验证"
impact: "低内存机器可能导出失败或被系统终止"
stop_loss: "避免并行扩大帧缓存；出现峰值异常先定位管线"
required_evidence: "Windows 导出进程树峰值内存、退出码、取消和残留进程记录"
```

```yaml
risk_id: RISK-WIN-006
severity: medium
category: technical_debt
fact: "Windows 安装、代码签名和自动更新不在已验证当前能力内"
impact: "构建成功不能转化为可信安装/升级体验"
stop_loss: "不得把 dist/CI 绿称为正式发行"
required_evidence: "签名安装包、SmartScreen、升级/回滚和卸载测试矩阵"
```

```yaml
risk_id: RISK-LOWEND-007
severity: medium
category: unverified
fact: "低配设备、多层和连续事件性能未完整验证"
impact: "编辑或预览掉帧，History 快照成本上升"
stop_loss: "先限定 M3 样本规模，发生卡顿时保留 profile 而非加缓存猜测"
required_evidence: "目标低配硬件上的交互 FPS、内存和导出数据"
```

```yaml
risk_id: RISK-INSTRUMENT-008
severity: medium
category: technical_debt
fact: "仓库存在 Day verify/probe 与常驻可观测标记；生产剥离范围未在本轮审计"
impact: "测试接口或探针可能扩大生产表面"
stop_loss: "发布前做构建产物静态审计，不在 Day 25 顺手清理"
required_evidence: "生产 bundle/窗口/API 清单与探针不可达证明"
```

```yaml
risk_id: RISK-MODEL-009
severity: medium
category: technical_debt
fact: "Character.baseAssetId 仍作为 default expression asset 的兼容别名"
impact: "双字段同步遗漏会造成角色显示不一致"
stop_loss: "Day 25 expression 只引用稳定 expression ID，并沿用现有 Service"
required_evidence: "表情预设、默认切换、替换与保存重开一致性测试"
```

```yaml
risk_id: RISK-PLAN-010
severity: medium
category: unverified
fact: "ROADMAP/DAILY_PLAN 的 Day/M3 标题与详细 Day 24/25 工单发生漂移"
impact: "接手者可能重复实现 History 或误判 M3 范围"
stop_loss: "以 Git/PR、详细 Task 和 Issue #51 优先；范围变化必须显式决策"
required_evidence: "更新后的唯一规划来源或批准的范围决策"
```

**人话版：** 最大风险是“双模型双求值链”，其次是动作冲突和时间越界。安装、性能和发布能力目前不能靠推测补齐。

## 12. 禁止事项

- 未读本文和 Day 25 工单直接写代码。
- 从旧功能分支继续开发，或未同步最新 `main`。
- 在旧 schema version 中静默增加持久字段。
- 直接操作 DOM/Konva 节点制造动画。
- 绕过 Domain Service、Store、History 或 locked 保护。
- 用截图替代机器数据、保存重开和正式消费链证据。
- 把本地测试绿、CI 绿或 PR 合并等同正式发布。
- M3 未验收或为 FAIL 时进入 Day 26。
- 提前实现完整时间轴、贝塞尔曲线、脚本、复杂转场或插件抽象。
- 把推测、旧聊天记忆、旧回执 SHA 写成当前事实。
- 为“顺便清理”修改与 Day 25 无关的债务。

## 13. 接手智能体前 30 分钟

严格按顺序执行；原工作区不干净时，不覆盖用户改动，改用独立 worktree。

```bash
# 0-3 分钟：读接管文档
git rev-parse --show-toplevel
git status --short
git branch --show-current
git rev-parse HEAD

# 3-8 分钟：同步远端事实
git fetch origin
git log --oneline --decorate -20 origin/main
git remote -v

# 8-13 分钟：核对任务与 Gate
sed -n '1,700p' HANDOFF_PANDA_STAGE.md
sed -n '1,320p' 'agent task/DAY-25-AGENT-TASK.md'
sed -n '1,260p' docs/test-receipts/M2.md

# 13-20 分钟：盘点事件、求值和正式渲染
git grep -n "TimelineEvent\\|MoveEvent\\|evaluateShotAtTime\\|StageRenderer\\|HistoryStore" -- src tests
git grep -n "durationMs\\|startMs\\|endMs\\|expression\\|shake\\|opacity" -- src tests

# 20-23 分钟：把时间边界、冲突、schema 与正式消费链决策写入任务笔记/决策文件
git status --short

# 23-25 分钟：仅从最新 main 建分支
git switch main
git pull --ff-only
git switch -c feat/day-25-action-presets

# 25-30 分钟：先写失败测试和纯事件工厂，再做 UI
pnpm typecheck
pnpm test:unit
```

PowerShell 环境可用 `Get-Content` 替代 `sed`。若 `main` worktree 有用户改动，使用 `git worktree add` 建隔离目录，不 stash、不 reset、不清理。

实现顺序：参数/schema 测试 → 纯函数事件工厂 → 冲突/边界 validator → Store/History → 保存重开 → 正式 evaluator/render/export → UI → 针对性测试 → 全 Gate → `M3.md`。

## 14. 下一智能体启动 Prompt

```text
你正在接手 Panda Stage Day 25。先完整阅读仓库根目录
HANDOFF_PANDA_STAGE.md 和 agent task/DAY-25-AGENT-TASK.md。

先现场执行 git status、branch、rev-parse、fetch 和 origin/main log；不要盲信摘要。
从最新 origin/main 创建 feat/day-25-action-presets，保护任何现有用户改动。
只执行 B-25/45：Action Presets + Validated Event Generation + M3 Gate；
不得提前开发 Day 26。

在写 UI 前，先审计正式 src/domain TimelineEvent、shared/probe MoveEvent、
evaluateShotAtTime、StageRenderer、Preview/Export 和 HistoryStore。
当前已知关键风险是正式事件 union 与旧 preview/export evaluator 分叉；
必须统一或用真实证据证明 8 类预设的正式消费链。

8 个预设只通过纯函数生成合法 TimelineEvent，不直接操作 DOM/Konva。
保证唯一 ID、整数毫秒、逻辑坐标、expression 归属、opacity 范围、
未选/locked/失效引用保护和显式时间越界反馈。
同属性冲突至少检测；未完整解决时显式记录 DEBT-CONFLICT-B25-001。
所有项目写入接入 Store/History，验证 undo/redo、保存重开和正式预览/导出。

完成后输出 docs/test-receipts/M3.md。M3 只能 PASS 或 FAIL；
任一核心项未验证即 FAIL，并创建 docs/decisions/M3-FAILURE-REPORT.md，
冻结 Day 26-45 实际开发。除真正无法判断的产品决策外自动推进。
按仓库规则提交并推送功能分支，报告精确 SHA、命令、证据和剩余风险。
```

## 15. Evidence Index

| ID | 类型 | 文件/PR/Issue/SHA | 证明内容 | 当前状态 |
|---|---|---|---|---|
| E-001 | 规划 | `ROADMAP_PANDA_STAGE.md` | Issue 指定规划文件 | 未找到 |
| E-002 | 规划替代 | `ROADMAP.md` | 初始里程碑背景 | 存在但标题/日程陈旧，仅作低优先级上下文 |
| E-003 | 计划 | `DAILY_PLAN_PANDA_STAGE.md` | Issue 指定每日计划 | 未找到 |
| E-004 | 计划替代 | `DAILY_PLAN.md` | 每日计划背景 | 存在；Day 24/25 标题与详细工单冲突 |
| E-005 | 当前面板 | `MasterMind_唯一事实输入面板_PandaStage_CURRENT.md` | Issue 指定当前事实面板 | 未找到 |
| E-006 | Task | `agent task/DAY-19-AGENT-TASK.md`～`DAY-25-AGENT-TASK.md` | Day 19～25 详细实施合同 | 存在；Day 25 为下一任务 |
| E-007 | Gate | `docs/test-receipts/M1.md` | M1 项目生命周期 Gate | PASS |
| E-008 | Gate | `docs/test-receipts/M2.md` | M2 素材/角色/镜头 Gate | PASS |
| E-009 | Receipt | `docs/test-receipts/DAY-19.md` | Day 19 行为与证据 | PASS；Result SHA 与 PR head 冲突 |
| E-010 | Receipt | `docs/test-receipts/DAY-20.md` | Day 20 独立回执 | 未找到 |
| E-011 | Evidence | `docs/evidence/day-20/results.json` | Day 20 机器结果 | 存在 |
| E-012 | Receipt | `docs/test-receipts/DAY-21.md` | 固定画布/共享渲染 | PASS |
| E-013 | Receipt | `docs/test-receipts/DAY-22.md` | 图层放置/locked | PASS |
| E-014 | Receipt | `docs/test-receipts/DAY-23.md` | 变换/flip/order/delete | PASS |
| E-015 | Receipt | `docs/test-receipts/DAY-24.md` | History/undo/redo | PASS |
| E-016 | Evidence | `docs/evidence/day-24/results.json` | Day 24 机器断言 | 存在 |
| E-017 | PR | `#38` / `009df3e...` / merge `c5c94be...` | Day 19 最终合并事实 | MERGED |
| E-018 | PR | `#39` / `b25c0d6...` / merge `d654e06...` | Day 20 最终合并事实 | MERGED |
| E-019 | PR | `#41` / `27ba25a...` / merge `61f9b1a...` | Day 21 最终合并事实 | MERGED |
| E-020 | PR | `#44` / `40f90fb...` / merge `4a5266c...` | Day 22 最终合并事实 | MERGED |
| E-021 | PR | `#46` / `73710ea...` / merge `ed046c1...` | Day 23 最终合并事实 | MERGED |
| E-022 | PR | `#48` / `d416f8b...` / merge `5ad6911...` | Day 24 最终合并事实、CI 通过 | MERGED |
| E-023 | Issue | `#35` | Day 19 commit-safe save / expression replacement | CLOSED |
| E-024 | Issue | `#40` | Day 20 no-op revision / failed draft | CLOSED |
| E-025 | Issue | `#42`, `#43` | Day 21 shared canvas/background identity hardening | CLOSED |
| E-026 | Issue | `#45` | Day 22 schema lock/drop identity | CLOSED |
| E-027 | Issue | `#47` | Day 23 production flip/Transformer overlay | CLOSED |
| E-028 | Issue | `#49`, `#50` | Day 24 blur/z-order/pending draft history | CLOSED |
| E-029 | Git | `main@5ad69110f7141cbc969466c8179bf1709753a945` | 当前主线基线 | 现场已核对 |
| E-030 | Package | `package.json` | 真实环境、命令和依赖 | 现场已核对 |
| E-031 | Schema | `src/domain/models/project.ts`, `src/domain/migrations/index.ts` | 正式 v5 与迁移链 | 现场已核对 |
| E-032 | Event | `src/domain/models/timeline-event.ts` | 正式事件 union | 现场已核对 |
| E-033 | Legacy path | `src/shared/domain/schema.ts`, `src/shared/domain/evaluate-shot-at-time.ts` | 旧 MoveEvent/evaluator 分叉 | 现场已核对 |
| E-034 | Issue | `#51` | 本接管文档的验收合同 | OPEN（文档回填后关闭） |

最终事实结论：`main` 已包含 PR #48，Day 24 已关闭；Day 25 没有启动证据；M3 未通过；唯一下一步是先审计并打通正式事件消费链，再在 `feat/day-25-action-presets` 执行 Day 25 工单。
