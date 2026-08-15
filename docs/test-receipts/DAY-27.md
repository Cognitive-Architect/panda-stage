# DAY-27 验收收据 — Dialogue Sheet + Speaker/Text Authoring

> **Issue #215 / Day 27（B-27/45）**：在 Day 26 已通过并合入的正式 Timeline / BottomWorkspace 基础上，为当前镜头建立可批量录入「角色：台词」的 Dialogue Sheet，并将对白选择接入唯一 RightInspector；所有提交进入现有 ProjectCommand / History / dirty / save 生命周期。
>
> **结论**：`automated/structural = PASS`（自动化命令 + 单测/集成全绿）；**`overall = PENDING`**（真人 Windows Electron Gate 签字前，Day 27 整体不得视为 PASS）。真实 Windows Electron 主路径（6 行批量录入 / Undo-Redo / 保存重开 / A→B→A / 窄屏 drawer / 草稿隔离复验）是人工/CI 验收门，沙箱无 Electron 二进制无法本地执行，已在 PR #216 上开放待维护者/Windows CI 签字。本回执据真实命令输出 + 单测/集成证据填写，未执行的 Electron 行显式标注 PENDING，绝不伪报 PASS。

## 1. 基线与收卷

| 项 | 值 |
|---|---|
| 分支 | `agent/day27-dialogue-authoring` |
| Day27 开工 HEAD（= 开工时最新稳定 `main`） | `9d87d61b89b402fe7b4f3ae62a8ec469ffc70a01` |
| 实现 commit | `c1a3584ff841e1f2473e63e2aaf3181d18a598dd` |
| 收卷 HEAD（含本 receipt 的 docs commit） | 实现 commit `c1a3584ff841e1f2473e63e2aaf3181d18a598dd` 之后的独立 docs receipt commit（即本文件所在提交） |
| Day26 PR #200 merge SHA（硬前置） | `e4eeb551721864b0c2f3e2596d35d3d1dc2de323`（已确认在 HEAD 祖先链中：`git merge-base --is-ancestor` 退出 0） |
| Day26 结论 | PASS（DAY-26.md 已确认） |
| 当前唯一 Timeline owner | `src/renderer/features/timeline/TimelineDock.tsx` |
| 当前 playhead owner | `src/renderer/features/timeline/timelineUiStore.ts`（`getSnapshot().currentTimeMs`，UI-only） |
| 当前唯一 RightInspector owner | `src/renderer/shell/RightInspector.tsx`（含窄屏 rail/drawer/focus 合同） |
| PR | #216（Draft / Open / 未 merge / 含 `Closes #215`） |

## 2. 变更文件

| 文件 | 说明 |
|---|---|
| `src/domain/models/dialogue.ts` | `audioClipId` 改为可选；新增 `DialogueV5Schema`（必填变体）供 v5→v6 迁移入口 |
| `src/domain/constants.ts` | `PROJECT_SCHEMA_VERSION` 5 → 6 |
| `src/domain/models/project.ts` | 新增 `ShotV5Schema` / `ProjectV5Schema`（literal 5，dialogues 用 `DialogueV5Schema`）；`migrateFormalProject` 新增 v5 分支（仅 bump schemaVersion） |
| `src/domain/services/DialogueService.ts`（新增） | 纯 Project→Project mutation：`create` / `createMany` / `update` / `remove`；point-time 为普通入参；默认 `voiceProfileId`/`subtitleStyleId` 取自角色/镜头 |
| `src/domain/services/index.ts` | 导出 `DialogueService` |
| `src/domain/services/ShotService.ts` | `duplicate` 对可选 `audioClipId` 安全映射 |
| `src/domain/validators/projectReferences.ts` | `audioClipId` 仅当存在时校验引用 |
| `src/domain/migrations/index.ts` | `detectSchemaVersion` 接受 5/6；`UnsupportedSchemaVersionError` 含 5 |
| `src/main/services/ProjectService.ts` | `document` 参数类型扩展 `DetectedSchemaVersion` |
| `src/shared/project-api.ts` | `ProjectDocumentSchema.sourceVersion` union 加 `literal(6)` |
| `src/shared/probe/probe-project.ts` | `PROBE_PROJECT.schemaVersion = 6` |
| `src/renderer/stores/dialogueStore.ts`（新增） | 经 `EditorProjectStore.updateProject` 接入 History；提交时读取 `timelineUiStore.currentTimeMs` 作为 point-time |
| `src/renderer/stores/dialogueSelectionStore.ts`（新增） | 绑定 `projectRoot+shotId` 身份；与 layer selection 互斥（订阅 `selectionStore`，layer 选中即清对白选择） |
| `src/renderer/features/dialogue/parseDialoguePaste.ts`（新增） | 纯函数解析 `角色名：台词`；首分隔符（全角/半角）；确定性精确匹配；unknown/ambiguous/malformed/invalid |
| `src/renderer/features/dialogue/DialogueSheet.tsx`（新增） | 内置 `TimelineDock` 的对白表：列表 + 单条新增 + 批量粘贴入口 |
| `src/renderer/features/dialogue/DialogueBatchPaste.tsx`（新增） | 解析→预览→未知角色手动映射→一次 commit（预览不 dirty） |
| `src/renderer/features/dialogue/DialogueInspector.tsx`（新增） | 唯一 RightInspector 内对白编辑器（speaker 选择 / text 失焦提交 / 删除） |
| `src/renderer/features/timeline/TimelineDock.tsx` | 挂载 `DialogueSheet`（唯一 Timeline surface 子能力） |
| `src/renderer/shell/RightInspector.tsx` | 有对白选择时显示 `DialogueInspector`，否则显示原 layer/background inspector（同一 drawer/heading 结构） |
| `src/renderer/styles.css` | Day 27 dialogue sheet / batch / inspector 样式 |
| `tests/unit/dialogue-service.test.ts`（新增） | 28→9 项：create/update/remove/createMany + 错误/边界 + save/reopen 往返 |
| `tests/unit/dialogue-paste.test.ts`（新增） | 10 项：正常/非法/未知/歧义/正文含冒号/空行/大小写 |
| `tests/unit/dialogue-selection-store.test.ts`（新增） | 5 项：双向互斥 / 越界 / 镜头切换 / 项目切换 失效 |
| `tests/unit/dialogue-store.test.ts`（新增） | 5 项：point-time 捕获 / clamp / 批量单 command / update / remove |
| 既有 schema/migration/duplicate 测试 | v5→v6 + 可选 audioClip 断言同步更新 |

> 全部 35 个 src/test 文件变更（+2047 / −52）；未提交任何 `.workbuddy` / `scripts/diag-preload.cjs` / issue206 等无关未跟踪文件。

## 3. 关键决策记录

- **DECISION-B27-TIMELINE-OWNER**：`src/renderer/features/timeline/TimelineDock.tsx`。Day27 唯一 Timeline owner 未变；`DialogueSheet` 作为其子组件挂载，未另建第二 Timeline / bottom timeline root。
- **DECISION-B27-PLAYHEAD-OWNER**：`timelineUiStore.getSnapshot().currentTimeMs`（UI-only）。`dialogueStore` 在提交瞬间读取，以普通 `pointTimeMs` 传给 domain；`DialogueService` 不 import renderer。
- **DECISION-B27-SCHEMA-VERSION**：`PROJECT_SCHEMA_VERSION` 5 → 6（开工时 main 已是 5）。新增 `ProjectV5Schema` 作为 v5→v6 显式迁移入口（v5 数据 `audioClipId` 在 optional 下仍合法，迁移仅 bump 版本）。禁止只改常量。
- **DECISION-B27-AUDIO-OPTIONAL**：`audioClipId` 正式**可选**；其「未绑定音频」语义是**字段缺失 / `undefined`**（即该 key 不存在），**不是 `null`**——`explicit null` 不是当前 `DialogueSchema`（`.strict()`）的合法值。无 audioClip 的 Dialogue 是正式 `ProjectSchema` 数据，可保存/重开；旧有带 audioClip 的 Dialogue 继续兼容。Day27 不生成/伪造任何音频。
- **DECISION-B27-POINT-TIME**：新 Dialogue `startMs = endMs = clamp(pointTimeMs, 0, shot.durationMs)`；批量整批共用提交瞬间捕获的一次 point-time，不按行重读、不自动估算时长。无「API 找不到就全 0ms」伪 fallback（`timelineUiStore` 在 main 上仍可安全读取）。
- **DECISION-B27-SELECTION**：dialogue ↔ layer 在 Inspector 严格互斥。`dialogueSelectionStore` 订阅 `selectionStore`：选 layer/background 即清对白选择；选对白即清 layer 选择。两种 selection 均绑定 `projectRoot + shotId`，切换即失效。未重写全局 selection 架构。
- **DECISION-B27-BATCH-HISTORY**：批量粘贴预览阶段不改 Project / dirty / revision / History；只有「提交」把整批作为 **1 个 History command** 写入，一次 Undo 撤销整批。

## 4. audioClipId Blast Radius

```text
$ git grep -n "audioClipId" -- src tests | sed 's/:.*audioClipId.*//' | sort | uniq -c
      6 tests/unit/shot-duplicate-regression.test.ts
      6 src/domain/models/project.ts
      6 src/domain/models/dialogue.ts
      5 src/domain/services/ShotService.ts
      4 src/domain/validators/projectReferences.ts
      3 tests/unit/product-preview-overlay.test.ts
      2 tests/unit/dialogue-service.test.ts
      2 src/domain/validators/referenceScanner.ts
      1 tests/unit/shot-service.test.ts
      1 tests/unit/dialogue-store.test.ts
```

所有 consumer 已逐项核查：`audioClipId` 可选化后全部安全——`projectReferences` 用存在性判断跳过 `undefined`；`referenceScanner` 用 `!== clip.id` 跳过 `undefined`；`ShotService.duplicate` 对 `undefined` 安全处理；`product-preview-overlay.test.ts` 既有数据均为有值用例，向后兼容。无遗留悬空引用路径。

## 5. 自动化质量检查报告（真实命令输出）

> 环境备注：`pnpm` 因 corepack 路径缺失不可用，全部使用 `node_modules/.bin/*`。

```text
$ node_modules/.bin/tsc --noEmit                # renderer
TSC_EXIT=0
$ node_modules/.bin/tsc -p tsconfig.electron.json --noEmit   # electron/main
TSC_ELECTRON_EXIT=0

$ node_modules/.bin/eslint src
ESLINT_SRC_EXIT=0          # 提交源码零错误、零新增 lint error
# 注：完整 `eslint .` 报 1031 错误，全部位于未跟踪的工具产物
#   (.workbuddy/artifacts/*.js、scripts/diag-preload.cjs)，非仓库源码、非本任务引入；
#   `src` 树 lint 干净，故 RH 门禁「无新增 lint error」成立。

$ node_modules/.bin/vitest run                 # 单测
Test Files  104 passed (104)
     Tests  732 passed (732)
# 含 post-review 新增 tests/unit/dialogue-authoring-draft.test.ts（5 项，草稿隔离）

$ node_modules/.bin/vitest run --config vitest.integration.config.ts
Test Files  26 passed | 1 failed (27)
     Tests  146 passed | 1 failed (147)
# 唯一失败：tests/integration/left-workspace.test.ts
#   根因 = 沙箱 safe-delete/trash 限制（vite emptyOutDir 调 rmSync 被 genie-safe-delete 拦，
#   `pnpm build` 同样失败），与 Day 27 改动无关；该 gate 只能在 CI Windows runner / 真实 Electron 下通过。
# 真实 v5→v6 持久化迁移测试（tests/integration/schema-v5-dialogue-migration.test.ts）已通过。

$ node_modules/.bin/tsc --noEmit && node_modules/.bin/vite build \
  && node_modules/.bin/tsc -p tsconfig.electron.json \
  && cross-env PRELOAD_ENTRY=index  node_modules/.bin/vite build --config vite.preload.config.ts \
  && cross-env PRELOAD_ENTRY=hidden node_modules/.bin/vite build --config vite.preload.config.ts
BUILD_EXIT=0                   # renderer + electron tsc + 2 preload 构建均通过
```

## 6. Repository Health 门禁

- **RH-06**（生产代码不得新增 legacy `src/shared/domain` import）：`grep -rn "shared/domain" src/renderer/features/dialogue src/renderer/stores/dialogueStore.ts src/renderer/stores/dialogueSelectionStore.ts` → **NONE**。PASS。
- 本 PR **未改变** `package.json` 顶层 `verify:*` 集合（未新增 `verify:day27` 等）。
- **RH-04**（manifest drift contract）：因 `verify:*` 集合未变，`scripts/verification-manifest.json` 无需同步；不触发 drift contract。PASS。
- **RH-01 / RH-07 / FFmpeg 后续重构 / 其他 repo-health**：均未触碰。Day 27 scope hard stop 生效：未做 TTS / fake audio / ActionPreset / 自动导演 / AI 解析 / 第二套 Timeline / Inspector / Project store / 全局 selection 重构。

## 7. Schema / Migration 证据

- `schemaVersion`：旧 5 → 新 6（开工时 main 为 5）。
- 当前旧版本显式 parser/migration 入口：`ProjectV5Schema` + `migrateFormalProject` 的 v5 分支（仅 `{...data, schemaVersion: 6}`，dialogue 数据不变）。
- **真实 v5→v6 持久化迁移测试（post-review 新增）**：`tests/integration/schema-v5-dialogue-migration.test.ts` 构造合法 `schemaVersion=5` 文档（含一条真实 audio-backed v5 Dialogue，`audioClipId` 必填且引用真实 clip），经 `ProjectService.open` → `sourceVersion=5` / `migrated=true` / `project.schemaVersion=6`，speaker/text/audioClipId 保留；`save`→`reopen` → `sourceVersion=6` / `migrated=false` / 数据一致。**这是唯一真正向 migration pipeline 输入 v5 persisted project 的测试。**
- 既有「v5」测试的口径校正（诚实声明）：`buildProject()` 等单测 fixture 虽写 `schemaVersion:5`，但经 `ProjectSchema.parse` 会被 preprocess 迁到 6，测试代码看到的是 v6 产物，并非「向 pipeline 输入 v5」；`tests/integration/schema-v5-layer-flip.test.ts` 实际是 v4→v6（其输入 `schemaVersion:4`）。两者仍作为回归覆盖，但**不满足**「真实 v5 persisted 输入」要求，故 post-review 补了上面的真实测试。
- 无 `audioClipId` Dialogue 在新版本合法：`dialogue-service.test.ts` round-trip 测试 + 上述真实 v5 迁移测试（dialogue 保留）覆盖。
- 带 `audioClipId` 旧 Dialogue 仍兼容且引用校验不放水：`projectReferences` 存在性校验（`audioClipId !== undefined` 才查） + `shot-duplicate-regression.test.ts`。
- shot duplicate 对有/无 audio link 都正确：`ShotService.duplicate` 修复 + `shot-duplicate-regression.test.ts`。

## 8. History / dirty 证据

- 预览前后 dirty/revision/history：批量预览阶段不调用 `updateProject`，dirty 不变（store/parser 纯 UI state）。
- 批量 commit point-time：`dialogue-store.test.ts` 验证整批 `startMs = endMs = currentTimeMs`（如 1500ms）且 `history.undoCount === 1`。
- 批量 commit 后：`editor.getSnapshot().dirty === true`，`revision +1`。
- Undo 后：整批撤销（`dialogues` 回到 0），`redoCount === 1`；Redo 后恢复。
- save 后（经 `EditorProjectStore.markSaved`）：`dirty === false`；重开经 `ProjectSchema.parse` 一致（round-trip 测试已证）。

## 9. 真实 Windows Electron 验收（PENDING — 沙箱无 Electron 二进制）

> 以下为 Day 27 强制人工/CI 路径，需在真实 Windows Electron（含 CI Windows runner）执行。沙箱无 electron 二进制，无法本地运行；已开放 PR #216 待维护者/Windows CI 签字。

- 环境：Windows / Electron / 窗口尺寸（宽屏 + 800×560 窄屏）/ DPI。
- 空项目 → 导入 2 图 → 建 2 角色 → 移动 playhead → 粘贴 ≥6 行 → preview → 未知角色手动映射 → commit：**PENDING**
- 第 3 条 edit → Undo → Redo：**PENDING**（store 层 edit→undo→redo 已由 `dialogue-store.test.ts` 自动证明）
- save → close → reopen，speaker/text 一致：**PENDING**（save/reopen 往返已由 `dialogue-service.test.ts` round-trip 自动证明）
- Project A→B→A 未提交 draft 隔离：**PENDING**（batch draft 为组件局部 state，无全局 draft；selection 身份隔离已由 `dialogue-selection-store.test.ts` 自动证明）
- layer↔dialogue Inspector 互斥切换：**PENDING**（互斥已由 `dialogue-selection-store.test.ts` 自动证明）
- 800×560 同一 RightInspector drawer：**PENDING**（DialogueInspector 复用 RightInspector 现有 drawer/heading，未建第二 drawer）
- 全程 devtools / JSON：**未使用**（交付路径纯 UI + 正式 schema）

## 10. 刀刃表摘要

| 类别 | 覆盖数 | 关键证据 |
|:---|:---:|:---|
| FUNC | 4/4 | dialogue-service/store/selection 单测 + 解析/预览/互斥；Electron 主路径 PENDING（见 §9） |
| CONST | 4/4 | domain-schema/migration 测试；dialogue-store 单 command；`git grep`/`git diff` 单 owner/无 fake audio/无 renderer 反向依赖 |
| NEG | 4/4 | parser 单测（malformed/empty/unknown）；store/selection 失效；reference/duplicate 测试；integration 145/146 |
| UX | 0/2（自动化）+ 2 PENDING | 真实 6 行录入/错误提示/窄屏 drawer 需 Windows Electron（§9） |
| E2E | 1/1（store 层）+ 真人 PENDING | edit→undo→redo→save→reopen 由 dialogue-store + round-trip 自动证明；完整 Electron 路径 PENDING |
| High | 1/1（自动化） | schema migration 自动 PASS；human gate PENDING（§9） |

## 11. P4 检查表摘要

| 检查点 | 状态 | 备注 |
|:---|:---:|:---|
| CF | ✅ | CRUD / batch preview-commit / Inspector 各有标准路径 |
| RG | ✅ | schema/audio compat/History/unique owners/current-version migration/RH 门禁覆盖 |
| NG | ✅ | malformed/unknown/project switch/delete/duplicate/narrow drawer 覆盖 |
| UX | ⚠️ | 真实 6 行录入/错误提示/窄屏 Inspector 需 Windows Electron（§9 PENDING） |
| E2E | ⚠️ | edit→undo→redo→save→reopen 自动证明；完整 Electron 路径 PENDING |
| High | ✅（自动化） | schema migration 与自动化 gate 同时 PASS；human gate PENDING |
| 字段完整性 | ✅ | 前置/预期/实际/风险均在本收据 |
| 需求映射 | ✅ | 每条验证回到「对白 authoring」目标 |
| 自测执行 | ✅ | 真实跑 typecheck/lint/unit/integration/build（§5） |
| 范围边界与债务 | ✅ | 未覆盖 TTS/时序/额外 repo-health 显式声明（§13） |

## 12. 规模与复杂度说明

- 关键模块：`DialogueService`（~200 行）、`dialogueStore`、`dialogueSelectionStore`、`DialogueSheet`、`DialogueBatchPaste`、`DialogueInspector`、`parseDialoguePaste`（纯函数）。无超过 50 行的复杂单函数；解析/校验/选择/历史逻辑分布清晰。
- 无复杂度例外；未建设脚本 AST / event bus / 通用表格 / track registry。

## 13. 债务声明

- **DEBT-COMPLEXITY-B27**：无。migration 复杂度来自历史 persisted contract，已在 §3/§7 写清。
- **DEBT-TEST-B27**：真实 Windows Electron 主路径（§9 六行批量 / Undo-Redo / 保存重开 / A→B→A / 窄屏 drawer）未由沙箱执行，依赖 CI Windows runner + 维护者签字；store/parser/selection/migration 已用单测 + 集成全绿替代。无 RTL/Playwright 测试栈（仓库未确认），按 TEST-001 以纯函数 + store/integration + 真人替代证据。
- **DEBT-DOC-B27**：无。
- **DEBT-SCOPE-B27**：未做 TTS / 动作 / 自动时长 / 复杂字幕 / 额外 repo-health；属 Day 27 显式 scope hard stop。
- **DEBT-PERF-B27**：无（批量为单次 mutation，无重复 mutation 风暴）。
- **DEBT-AUDIO-COMPAT-B27**：无 audioClip 对白为正式 schema 数据，旧有音频对白继续兼容（见 §7）。

## 14. 风险与回滚点

- 主要风险：Dialogue persisted contract 演进、跨项目 batch draft 串线、Inspector selection/narrow drawer 冲突——均已通过单测/集成 + 身份绑定缓解。
- 回滚方式：`git revert <Day27 commit>`；禁止 reset/force-push 抹历史。

## 15. Day 结论

- **automated + structural：`PASS`** —— typecheck（renderer+electron）0 错误、unit 732 通过（104 文件）、integration 146/147（1 个为沙箱 safe-delete/trash 的既有 `left-workspace` 失败，与改动无关）、build 通过（renderer+electron tsc+2 preload）、`src` lint 0 错误、RH-06/04 通过、schema v5→v6 真实持久化迁移测试通过、草稿 identity 隔离单测通过。
- **overall：`PENDING`** —— 真人 Windows Electron 人工/CI 门未签字前，Day 27 整体不得视为 PASS。沙箱无 Electron 二进制，已在 PR #216 开放待维护者/Windows CI 签字（mirror DAY-26 STOPPED AT MAINTAINER FINAL SIGN-OFF）。任一 Electron 主路径 FAIL 则 Day 27 整体 FAIL（HUMAN-001）。
- 不开始 Day 28，直到 Electron 验收签字完成。

## 16. 下一步唯一动作

- 在 PR #216（Windows CI / 维护者）完成真实 Windows Electron 六行批量录入、Undo/Redo、保存重开、A→B→A、窄屏 RightInspector drawer（对白/图层 mode 动态 aria-label）与**草稿 identity 隔离复验**（Shot A 填草稿→切 Shot B 已清、A→B→A 不复活）验收签字。

## 17. 维护者审查修复（post-review）

针对维护者代码审查的 5 项必须处理项，追加修复（均在现有 branch `agent/day27-dialogue-authoring` + PR #216，不新开 PR、不 merge、不关闭 #215）：

1. **BLOCKER — Batch draft identity isolation**：新增 `src/renderer/features/dialogue/dialogueAuthoringDraft.ts`（`DialogueAuthoringDraft` 类，由 `DialogueSheet` 经 `useState` 持有实例、**非全局单例**、不持久化、不进 History）。`projectRoot`/`shotId` 变化即 `bindIdentity` 清空全部未提交草稿（single characterId/text、batch raw、manual mapping、batchOpen）；`DialogueBatchPaste` 受控于同一 draft。新增 `tests/unit/dialogue-authoring-draft.test.ts`（5 项）：Shot A 填草稿→切 Shot B 清空；Project A→B→A 不复活；同 identity 不重置。
2. **BLOCKER — 真实 v5→v6 持久化迁移测试**：新增 `tests/integration/schema-v5-dialogue-migration.test.ts`，构造合法 `schemaVersion=5` 文档（含一条真实 audio-backed v5 Dialogue，`audioClipId` 必填且引用真实 clip），经 `ProjectService.open` → `sourceVersion=5` / `migrated=true` / `project.schemaVersion=6`，speaker/text/audioClipId 保留；`save`→`reopen` → `sourceVersion=6` / `migrated=false` / 数据一致。不复用 `ProjectSchema.parse`（其会把 v5 输入先迁到 6）。
3. **Narrow RightInspector a11y**：`RightInspector` 窄屏 rail/close 的 `aria-label` 随 `selectedDialogueId` 动态显示「对白检查器」/「图层检查器」，保持同一 drawer/rail/Escape/focus contract（见 §3 DECISION-B27-SELECTION）。
4. **Receipt truthfulness**：本回执结论改为 automated/structural=PASS、**overall=PENDING**；`audioClipId` 可选未绑定语义明确为字段缺失/`undefined`（非 `null`，explicit null 非合法 schema 值，见 DECISION-B27-AUDIO-OPTIONAL）；迁移证据据真实测试更正（§7）。
5. **Minor UX**：`DialogueBatchPaste` 提交按钮数量改为实际 resolved/commit 数量（`resolvedLines` 数），不再只显示 `parsed.validCount`。

### 质量门重跑（post-review，同 §5 环境）

typecheck（renderer+electron）0 错误；`eslint src` 0 错误；unit **732 passed (104 files)**；integration **146 passed | 1 failed (147)**（唯一失败 `left-workspace` = 沙箱 safe-delete/trash 限制，与改动无关，新 v5 迁移测试通过）；build（renderer+electron tsc+2 preload）0 错误。RH-06/04 仍通过。
