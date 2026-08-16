# DAY-27 验收收据 — Dialogue Sheet + Speaker/Text Authoring

> **Issue #215 / Day 27（B-27/45）**：在 Day 26 已通过并合入的正式 Timeline / BottomWorkspace 基础上，为当前镜头建立可批量录入「角色：台词」的 Dialogue Sheet，并将对白选择接入唯一 RightInspector；所有提交进入现有 ProjectCommand / History / dirty / save 生命周期。
>
> **最终结论（2026-08-16 maintainer sign-off）**：`automated/structural = PASS`；**`overall = PASS`**。真实 Windows Electron 主路径已由 maintainer 完成人工复验；Day 27 后续布局阻塞 Issue #220 已修复并关闭；PR #216 最终 head `688a56357443558bdf2a75ac360f38a13de73828` 的 GitHub CI run `31931893006` 结论为 **SUCCESS**，PR #216 已 merge。Day 28 前置门禁现已满足。

## 1. 基线与收卷

| 项 | 值 |
|---|---|
| 分支 | `agent/day27-dialogue-authoring` |
| Day27 开工 HEAD（= 开工时最新稳定 `main`） | `9d87d61b89b402fe7b4f3ae62a8ec469ffc70a01` |
| 实现 commit | `c1a3584ff841e1f2473e63e2aaf3181d18a598dd` |
| Day26 PR #200 merge SHA（硬前置） | `e4eeb551721864b0c2f3e2596d35d3d1dc2de323`（已确认在 HEAD 祖先链中） |
| Day26 结论 | PASS（DAY-26.md 已确认） |
| 当前唯一 Timeline owner | `src/renderer/features/timeline/TimelineDock.tsx` |
| 当前 playhead owner | `src/renderer/features/timeline/timelineUiStore.ts`（`getSnapshot().currentTimeMs`，UI-only） |
| 当前唯一 RightInspector owner | `src/renderer/shell/RightInspector.tsx`（含窄屏 rail/drawer/focus 合同） |
| PR #216 最终 head | `688a56357443558bdf2a75ac360f38a13de73828` |
| PR #216 merge commit | `6092109c2c73dc8e056a41bd94fbfc1dfa87d31a` |
| PR #216 最终状态 | **MERGED** |
| Issue #215 | **CLOSED / completed** |
| Day27 布局 blocker #220 | **CLOSED / completed** |

## 2. 变更文件

| 文件 | 说明 |
|---|---|
| `src/domain/models/dialogue.ts` | `audioClipId` 改为可选；新增 `DialogueV5Schema`（必填变体）供 v5→v6 迁移入口 |
| `src/domain/constants.ts` | `PROJECT_SCHEMA_VERSION` 5 → 6 |
| `src/domain/models/project.ts` | 新增 `ShotV5Schema` / `ProjectV5Schema`（literal 5，dialogues 用 `DialogueV5Schema`）；`migrateFormalProject` 新增 v5 分支 |
| `src/domain/services/DialogueService.ts`（新增） | 纯 Project→Project mutation：`create` / `createMany` / `update` / `remove`；point-time 为普通入参 |
| `src/domain/services/index.ts` | 导出 `DialogueService` |
| `src/domain/services/ShotService.ts` | `duplicate` 对可选 `audioClipId` 安全映射 |
| `src/domain/validators/projectReferences.ts` | `audioClipId` 仅当存在时校验引用 |
| `src/domain/migrations/index.ts` | `detectSchemaVersion` 接受 5/6；`UnsupportedSchemaVersionError` 含 5 |
| `src/main/services/ProjectService.ts` | `document` 参数类型扩展 `DetectedSchemaVersion` |
| `src/shared/project-api.ts` | `ProjectDocumentSchema.sourceVersion` union 加 `literal(6)` |
| `src/shared/probe/probe-project.ts` | `PROBE_PROJECT.schemaVersion = 6` |
| `src/renderer/stores/dialogueStore.ts`（新增） | 经 `EditorProjectStore.updateProject` 接入 History；提交时读取 `timelineUiStore.currentTimeMs` |
| `src/renderer/stores/dialogueSelectionStore.ts`（新增） | 绑定 `projectRoot+shotId` 身份；与 layer selection 互斥 |
| `src/renderer/features/dialogue/parseDialoguePaste.ts`（新增） | 纯函数解析 `角色名：台词`；支持 unknown/ambiguous/malformed/invalid 分类 |
| `src/renderer/features/dialogue/DialogueSheet.tsx`（新增） | Timeline 内对白表：列表 + 单条新增 + 批量粘贴入口 |
| `src/renderer/features/dialogue/DialogueBatchPaste.tsx`（新增） | 解析→预览→未知角色手动映射→一次 commit |
| `src/renderer/features/dialogue/DialogueInspector.tsx`（新增） | 唯一 RightInspector 内对白编辑器 |
| `src/renderer/features/timeline/TimelineDock.tsx` | 挂载 `DialogueSheet` |
| `src/renderer/shell/RightInspector.tsx` | 有对白选择时显示 `DialogueInspector`，否则显示原 layer/background inspector |
| `src/renderer/styles.css` | Day 27 dialogue sheet / batch / inspector 样式；后续 Issue #220 修复 bottom workspace 内部滚动/裁切 |
| `tests/unit/dialogue-service.test.ts`（新增） | create/update/remove/createMany + 错误/边界 + save/reopen 往返 |
| `tests/unit/dialogue-paste.test.ts`（新增） | 正常/非法/未知/歧义/正文含冒号/空行/大小写 |
| `tests/unit/dialogue-selection-store.test.ts`（新增） | 双向互斥 / 越界 / 镜头切换 / 项目切换失效 |
| `tests/unit/dialogue-store.test.ts`（新增） | point-time 捕获 / clamp / 批量单 command / update / remove |
| `tests/unit/dialogue-authoring-draft.test.ts`（post-review 新增） | Shot/Project identity 切换时未提交草稿失效 |
| `tests/integration/schema-v5-dialogue-migration.test.ts`（post-review 新增） | 真实 persisted v5→v6 migration / save→reopen |
| `tests/contract/issue220-dialogue-layout.test.ts`（Issue #220） | 锁定 Dialogue/Batch Paste 在 Timeline 内滚动且底部控件不再被裁切 |

## 3. 关键决策记录

- **DECISION-B27-TIMELINE-OWNER**：`src/renderer/features/timeline/TimelineDock.tsx`。Day27 唯一 Timeline owner 未变；`DialogueSheet` 作为其子组件挂载，未另建第二 Timeline / bottom timeline root。
- **DECISION-B27-PLAYHEAD-OWNER**：`timelineUiStore.getSnapshot().currentTimeMs`（UI-only）。`dialogueStore` 在提交瞬间读取，以普通 `pointTimeMs` 传给 domain；`DialogueService` 不 import renderer。
- **DECISION-B27-SCHEMA-VERSION**：`PROJECT_SCHEMA_VERSION` 5 → 6。新增 `ProjectV5Schema` 作为 v5→v6 显式迁移入口，禁止只改常量。
- **DECISION-B27-AUDIO-OPTIONAL**：`audioClipId` 正式**可选**；未绑定音频语义是字段缺失 / `undefined`，不是 `null`。Day27 不生成/伪造任何音频。
- **DECISION-B27-POINT-TIME**：新 Dialogue `startMs = endMs = clamp(pointTimeMs, 0, shot.durationMs)`；批量整批共用提交瞬间捕获的一次 point-time。
- **DECISION-B27-SELECTION**：dialogue ↔ layer 在 Inspector 严格互斥；两种 selection 均绑定 `projectRoot + shotId`，切换即失效。
- **DECISION-B27-BATCH-HISTORY**：批量粘贴预览阶段不改 Project / dirty / revision / History；只有「提交」把整批作为 **1 个 History command** 写入，一次 Undo 撤销整批。
- **DECISION-B27-LAYOUT**：Issue #220 后，外层 BottomWorkspace 布局契约不扩张；TimelineDock 内部承担必要滚动，固定 Timeline header/ruler/history 不被内容挤掉，Dialogue/Batch Paste 的底部控件始终可通过内部滚动访问。

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

所有 consumer 已逐项核查：`audioClipId` 可选化后全部安全；无遗留悬空引用路径。

## 5. 自动化质量检查报告

Day 27 开发/post-review 阶段真实执行过的质量门包括：

```text
tsc --noEmit                                -> PASS
tsc -p tsconfig.electron.json --noEmit      -> PASS
eslint src                                  -> PASS
vitest unit                                 -> 732 passed (post-review阶段)
vitest integration                          -> 新 v5 migration PASS；沙箱曾受 Electron/safe-delete 环境限制
renderer + electron + 2 preload build       -> PASS
git diff --check                            -> PASS
```

随后 Issue #219/#220 收尾后，PR #216 最终 head `688a56357443558bdf2a75ac360f38a13de73828` 触发 GitHub CI run `31931893006`：

```text
workflow: CI
run number: 413
run attempt: 2
status: completed
conclusion: success
head: 688a56357443558bdf2a75ac360f38a13de73828
```

因此最终自动化门结论为 **PASS**。

## 6. Repository Health 门禁

- **RH-06**：生产代码未新增 legacy `src/shared/domain` import。PASS。
- 本 PR **未改变** `package.json` 顶层 `verify:*` 集合（未新增 `verify:day27` 等）。
- **RH-04**：`verify:*` 集合未变，`scripts/verification-manifest.json` 无需同步；不触发 drift contract。PASS。
- **RH-01 / RH-07 / FFmpeg 后续重构 / 其他 repo-health**：均未借 Day 27 越界执行。
- Day 27 scope hard stop 生效：未做 TTS / fake audio / ActionPreset / 自动导演 / AI 解析 / 第二套 Timeline / Inspector / Project store / 全局 selection 重构。

## 7. Schema / Migration 证据

- `schemaVersion`：旧 5 → 新 6。
- 当前旧版本显式 parser/migration 入口：`ProjectV5Schema` + `migrateFormalProject` 的 v5 分支。
- **真实 v5→v6 持久化迁移测试**：`tests/integration/schema-v5-dialogue-migration.test.ts` 构造合法 `schemaVersion=5` 文档，经 `ProjectService.open` → `sourceVersion=5` / `migrated=true` / `project.schemaVersion=6`；`save`→`reopen` → `sourceVersion=6` / `migrated=false` / 数据一致。
- 无 `audioClipId` Dialogue 在新版本合法；带 `audioClipId` 旧 Dialogue 继续兼容且引用校验不放水。
- Issue #217/#218 后的唯一 persisted migration pipeline 已在 Day27 sync（Issue #219）中保留：`migrateProject(...)` 为持久化迁移入口，`ProjectSchema` 仅校验当前 v6。

## 8. History / dirty 证据

- 批量预览阶段不调用 `updateProject`，dirty/revision/history 不变。
- 批量 commit 共用一次 point-time，整批进入 **1 个 History command**。
- commit 后 dirty=true / revision +1；Undo 整批撤销；Redo 恢复。
- maintainer 真人复验中，批量 6 条提交后 Dialogue 数量正确增加，History 只增加 1 条；Undo/Redo 实际可用。
- save 后 dirty=false；关闭/重开后对白仍存在，speaker/text 保留。

## 9. 真实 Windows Electron 验收（PASS — 2026-08-16 maintainer sign-off）

Day 27 的沙箱阶段无法执行真实 Electron，因此此前正确记录为 PENDING。最终在真实 Windows Electron 中完成维护者复验，结果如下：

- **宽屏/正常窗口布局**：Dialogue Sheet 与输入控件可见可用；Issue #220 修复后不再被 BottomWorkspace 底边裁切；内容过高时走内部滚动。**PASS**
- **窄屏布局**：Dialogue 区域可滚动，底部新增/批量/Undo/Redo 控件保持可达；RightInspector narrow drawer 可正常打开/关闭。**PASS**
- **单条新增对白**：选择角色 + 输入文本 + 新增成功。**PASS**
- **单条 Undo / Redo**：新增后撤销、重做均正常。**PASS**
- **批量粘贴 ≥6 行**：能解析角色/文本；未知角色行能识别并进入手动映射流程。**PASS**
- **批量提交与 History**：一次提交写入 6 条 Dialogue，History 仅增加 1 条；Undo/Redo 整批行为正确。**PASS**
- **save → close → reopen**：已保存对白重开后仍存在。**PASS**
- **Project A→B→A 草稿 identity 隔离**：A 中未提交草稿切到 B 不串入；返回 A 不错误复活。**PASS**
- **Dialogue / layer selection contract**：自动化回归保持 PASS；真人窄屏/Inspector 使用未发现回归。**PASS**
- **全程 devtools / JSON**：未作为交付手段使用；验收走正式 UI。

### Issue #220 布局 blocker 收口

真实 Electron 首轮验收发现 Dialogue Sheet 底部控件被 Timeline/BottomWorkspace 裁切，因此 Day27 当时保持 PENDING，并创建 Issue #220。修复后：

- root cause：BottomWorkspace 固定高度 + `overflow:hidden`，TimelineDock 内部没有正确滚动区域；
- fix：保持外层布局 owner 不变，把溢出收敛到 TimelineDock 内部滚动；
- regression：增加 focused contract，宽/窄/resize 场景经自动化 + 真人复验；
- Issue #220 已 **closed/completed**。

## 10. 刀刃表摘要

| 类别 | 覆盖数 | 关键证据 |
|:---|:---:|:---|
| FUNC | 4/4 | dialogue-service/store/selection 单测 + 真人新增/批量/Inspector 主路径 PASS |
| CONST | 4/4 | schema/migration、单 History command、单 owner、无 fake audio |
| NEG | 4/4 | malformed/unknown/project switch/delete/duplicate + 真实草稿隔离 |
| UX | 2/2 | 宽屏 + 窄屏真实 Windows Electron PASS；Issue #220 已闭环 |
| E2E | 1/1 + 真人 PASS | add/batch→Undo/Redo→save→reopen→project switch 全链路已复验 |
| High | 1/1 | schema migration + final CI + human gate 全部 PASS |

## 11. P4 检查表摘要

| 检查点 | 状态 | 备注 |
|:---|:---:|:---|
| CF | ✅ | CRUD / batch preview-commit / Inspector 标准路径成立 |
| RG | ✅ | schema/audio compat/History/unique owners/current migration/RH 门禁覆盖 |
| NG | ✅ | malformed/unknown/project switch/delete/duplicate/narrow drawer 覆盖 |
| UX | ✅ | 宽/窄屏 + 内部滚动 + BottomWorkspace 布局真人 PASS |
| E2E | ✅ | edit/add/batch→undo/redo→save/reopen→A↔B 真人 PASS |
| High | ✅ | migration、CI、human gate 全 PASS |
| 字段完整性 | ✅ | 前置/预期/实际/风险均在本收据 |
| 需求映射 | ✅ | 验证回到「对白 authoring」目标 |
| 自测执行 | ✅ | typecheck/lint/unit/integration/build + final GitHub CI |
| 范围边界与债务 | ✅ | 未覆盖 TTS/时序/额外 repo-health 显式声明 |

## 12. 规模与复杂度说明

- 关键模块：`DialogueService`、`dialogueStore`、`dialogueSelectionStore`、`DialogueSheet`、`DialogueBatchPaste`、`DialogueInspector`、`parseDialoguePaste`。
- 无通用轨道系统 / event bus / ActionPreset 复活；Issue #220 只做局部布局滚动收敛，没有演变为 repo-wide CSS 重构。

## 13. 债务声明

- **DEBT-COMPLEXITY-B27**：无。
- **DEBT-TEST-B27**：沙箱无真实 Electron 是开发阶段环境限制；最终已由 Windows Electron maintainer re-acceptance 补齐，不再阻塞 Day 27。仓库仍无 RTL/Playwright 大型 UI 栈，本日没有为单一功能引入新框架。
- **DEBT-DOC-B27**：无；本文件已于最终 maintainer sign-off 后更新。
- **DEBT-SCOPE-B27**：TTS / 动作 / 自动时长 / 复杂字幕 timing 等仍属后续 Day 范围，不是 Day 27 缺口。
- **DEBT-PERF-B27**：无（批量为单次 mutation，无重复 mutation 风暴）。
- **DEBT-AUDIO-COMPAT-B27**：无 audioClip 对白为正式 schema 数据，旧有音频对白继续兼容。

## 14. 风险与回滚点

- 主要风险曾包括 Dialogue persisted contract 演进、跨项目 batch draft 串线、Inspector selection/narrow drawer 冲突、BottomWorkspace 裁切；均已通过 migration/identity/selection/layout 回归 + 真人 Windows 验收闭环。
- 回滚方式：对对应 Day27/Issue219/Issue220 commit 使用 `git revert`；禁止 reset/force-push 抹历史。

## 15. Day 结论

- **automated + structural：`PASS`** —— schema v5→v6、History/dirty、selection/draft identity、RH-04/RH-06、build/typecheck/lint/unit/integration 与最终 GitHub CI 均有真实证据。
- **Windows Electron human gate：`PASS`** —— 单条新增、批量粘贴/未知角色处理、Undo/Redo、单 History command、保存重开、A→B→A 草稿隔离、宽/窄布局、BottomWorkspace 内部滚动与 RightInspector narrow drawer 已完成真人复验。
- **overall：`PASS`**。
- PR #216 已 merge；Issue #215 / #219 / #220 已完成收口。
- **Day 28 可以开始。**

## 16. 下一步唯一动作

- 以 PR #216 merge 后的最新稳定 `main` 为基线，重新读取并校准 `new agent task/DAY-28-AGENT-TASK.md`；确认 Day28 仍准确复用 Day26 Timeline/time geometry、Day27 Dialogue mutation/selection owner 与现有 subtitle engine 后，再创建 Day28 执行 Issue。

## 17. 维护者审查与历史 CI 记录（合并前历史）

以下记录用于保留 Day27 在最终 PASS 之前的真实过程，不代表当前状态。

1. **Batch draft identity isolation**：新增 `dialogueAuthoringDraft.ts` 与单测；projectRoot/shotId 变化清空未提交草稿。
2. **真实 v5→v6 持久化迁移测试**：新增 `schema-v5-dialogue-migration.test.ts`，经真实 `ProjectService.open/save/reopen` 验证。
3. **Narrow RightInspector a11y**：窄屏 rail/close 的 `aria-label` 随 dialogue/layer mode 动态变化。
4. **Receipt truthfulness**：开发阶段正确记录 `overall=PENDING`，未把沙箱无法执行的 Electron 验收伪报为 PASS。
5. **Minor UX**：Batch Paste 提交按钮显示实际 resolved/commit 数量。

历史 CI run `31885841720` 曾因 `verify:character`/环境类回归红灯；后续迁移管线整合、verifier 同根因修复与 Day27 sync 完成后，再进入 Issue #220 布局真人验收。该历史红灯已被最终 head 的成功 CI supersede。

## 18. 最终 maintainer 收口（2026-08-16）

- Issue #217 / PR #218：迁移职责收敛完成并先行合并到 main；Day27 随后通过 Issue #219 同步到该单一迁移架构。
- Issue #219：Day27 v6 migration / verifier / Timeline 折叠等冲突完成同步，PR #216 保持未提前 merge，等待真人验收。
- Issue #220：真实 Windows Electron 首轮发现 Dialogue bottom controls clipping；最小布局修复完成，maintainer 在宽/窄布局中重新验证 authoring / batch / undo-redo / save-reopen / draft isolation / drawer。
- PR #216 final head：`688a56357443558bdf2a75ac360f38a13de73828`。
- Final CI：run `31931893006`，attempt 2，`conclusion=success`。
- PR #216 merge commit：`6092109c2c73dc8e056a41bd94fbfc1dfa87d31a`。
- Issue #215：closed / completed。
- Issue #220：closed / completed。
- **FINAL: DAY27 = PASS.**
