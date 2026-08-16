# Panda Stage Day 28 / B-28/45 收据

## 提交信息

- Issue: [#221](https://github.com/Cognitive-Architect/panda-stage/issues/221)
- Canonical task: `new agent task/DAY-28-AGENT-TASK.md`
- Canonical task blob at start: `d4fed90def124ce83e00f90307854ce2c51938b2`
- Baseline: `origin/main@90bb37cb975147ca7d17efdd8d9d00a1993bdd34`
- Branch: `agent/day28-dialogue-timing-subtitle-track`
- Implementation commit: `2ffcab586c93972a355ab1f2e5370d8162fd8eac`
- Day 26 prerequisite: merged and present (`e4eeb551721864b0c2f3e2596d35d3d1dc2de323`)
- Day 27 prerequisite: merged and present (`6092109c2c73dc8e056a41bd94fbfc1dfa87d31a`)

## 状态

- `automated/structural`: `PASS` for the Day28 source/test scope; repository-wide `pnpm lint` is separately recorded as environment-contaminated below.
- Maintainer Windows Electron acceptance: `PENDING`.
- Overall: `PENDING`.
- No human H1-H8 result is inferred from automation or from application startup.

## 本轮目标与实际结果

本轮把 Day27 已持久化的 Dialogue 接入现有 Timeline/time geometry 和现有 shared subtitle projection，形成可移动、可调时长、可预览的 Dialogue Track。实际完成：

- `DialogueService` 支持正时长默认窗口、移动、左右边缘 resize、整数毫秒 clamp、相邻窗口和新 authoring overlap rejection；精确 adjacency 合法，legacy zero-duration/overlap 仍可载入和评估。
- `DialogueClip` 复用 `TimelineDock`、`timelineUiStore` 和 `timeGeometry`，支持 pointer capture、frame snap、边界 clamp、单次 pointerup commit；clip/handle pointer 会停止向 ruler seek 传播。
- `DialogueEditor` 支持 speaker/text、start/end、subtitle style、audio attachment、长字幕提示和错误回显；写入仍经 `dialogueStore` 与 `EditorProjectStore`，没有新增 Project/History store。
- Editor Canvas 和 Product Preview 复用 shared dialogue/subtitle timing 语义；字幕 projection 统一 trim + max 500 字符，确定性换行最多两行，并在编辑器给出可见 warning。
- 共享 `SubtitleRenderer` 使用现有 safe area；字幕 Konva layer `listening=false`，不夺取普通 layer、Transformer 或背景的 hit-test。
- 增加 per-character deterministic mouth motion：只对当前 speaking character 使用已配置 mouth-open image asset；无 asset 时回退，不生成伪造资源。
- 增加只读 audio source IPC 和 `AudioScheduler`：单一活动 source、整数毫秒同步、1x playback、无 implicit stretch、无 mixing；audio clip 会随 dialogue 移动/缩短但保留原始 source duration 语义。
- 保留 Issue #220 的 BottomWorkspace/Timeline 内部滚动和 64px ruler contract；未创建第二 Timeline、第二 playhead、第二字幕 evaluator 或通用 TimelineEvent/ActionPreset editor。

## Owner 与关键决定

- `DECISION-B28-TIME-OWNER`: `TimelineDock` + `timelineUiStore` + `timeGeometry`；未复制时间几何或 playhead。
- `DECISION-B28-DIALOGUE-OWNER`: `DialogueService` + `dialogueStore`；Dialogue selection 继续由既有 `dialogueSelectionStore` 所有。
- `DECISION-B28-SUBTITLE-PROJECTION`: `src/shared/preview/subtitle-engine.ts` 的 evaluator/contract，加上 `subtitle-layout.ts` 的确定性展示 projection；未创建第二套字幕时间判断。
- `DECISION-B28-CAPTION-PRESENTATION`: `SubtitleRenderer` 是共享展示 owner，接入 `StageRenderer` 和 editor `CanvasStage`。
- `DECISION-B28-TIME`: persisted timing 仍为整数毫秒，visible cue 使用 half-open `[startMs, endMs)`；UI 按现有 24 FPS frame quantum snap。
- `DECISION-B28-DEFAULT-DURATION`: 新 authoring 默认 `1000ms`；靠近 shot end 时向左回填并 clamp 到 shot 边界，显式移动/resize 不自动 ripple 其他对白。
- `DECISION-B28-OVERLAP`: 新 timed authoring 拒绝区间 overlap，`A.endMs === B.startMs` 合法；zero-duration legacy Dialogue 不参加 visible overlap 判定，历史 overlap 不被全局 schema 拒绝。
- `DECISION-B28-CUE-TEXT-LIMIT`: editor/preview 使用同一 trim + max 500 projection；过长内容确定性最多两行，并保留清晰编辑 warning。
- `DECISION-B28-AUDIO`: source duration 与 dialogue duration 取最小 clip duration，`playbackRate=1`，不 mixing、不自动拉伸；dialogue timing 变化只移动/截短绑定 clip。
- `DECISION-B28-MOUTH`: 250ms deterministic cycle，前 125ms open；只作用于 speaking character，不改变非 speaking character。
- `DECISION-B28-POINTER`: clip body/handle 采用 pointer capture + `stopPropagation`，drag/resize preview 不写 Project，pointerup 才产生一次 Project/History command。
- `DECISION-B28-LAYOUT-220`: 新 track 嵌入现有 TimelineDock 内滚动区，保留 ruler/header/history 的既有 owner 和底部控件可达性。

## 实际变更文件

实现 commit `2ffcab5` 的 Day28 文件分组如下；历史 `docs/evidence/*`、`.workbuddy`、诊断脚本等既有工作树内容未暂存、未提交。

- Domain: `src/domain/constants.ts`, `src/domain/evaluate-shot-at-time.ts`, `src/domain/index.ts`, `src/domain/models/subtitle.ts`, `src/domain/services/DialogueService.ts`, `src/domain/evaluators/*`。
- Main/Preload/IPC: `src/main/index.ts`, `src/main/ipc/register-asset-library-ipc-handlers.ts`, `src/main/services/AssetAudioSourceService.ts`, `src/preload/index.ts`, `src/shared/asset-audio-api.ts`, `src/shared/ipc/channels.ts`。
- Renderer: `src/renderer/features/canvas/CanvasStage.tsx`, `src/renderer/features/dialogue/*`, `src/renderer/features/preview/AudioScheduler.ts`, `src/renderer/features/subtitles/SubtitleRenderer.tsx`, `src/renderer/features/timeline/DialogueClip.tsx`, `src/renderer/features/timeline/TimelineDock.tsx`, `src/renderer/global.d.ts`, `src/renderer/shell/ProductPreviewOverlay.tsx`, `src/renderer/shell/productPreviewModel.ts`, `src/renderer/stage/CanvasStage.tsx`, `src/renderer/stage/StageRenderer.tsx`, `src/renderer/stores/dialogueStore.ts`, `src/renderer/styles.css`。
- Shared/tests: `src/shared/preview/subtitle-engine.ts`, `src/shared/preview/subtitle-layout.ts`, `tests/contract/issue221-day28.test.ts`, and the Day28 dialogue/audio/subtitle evaluator unit tests.

## 自动化与结构化验证

| 检查 | 结果 | 证据 |
|---|---|---|
| `pnpm typecheck` | PASS | renderer + Electron TypeScript checks exit 0 |
| `pnpm exec eslint src tests` | PASS | Day28 production source/test scope exit 0 |
| `pnpm test:unit` | PASS | 112 files, 764 tests |
| `pnpm test:integration` | PASS | 26 files, 147 tests；含 build，退出 0 |
| `pnpm build` | PASS | renderer 303 modules，Electron/preload build exit 0；仅有 chunk-size warning |
| `git diff --check` | PASS | 无 diff-check error |
| Issue #220 contract | PASS | `tests/contract/issue220-dialogue-layout.test.ts` 在 unit gate 中通过，现有 64px ruler/layout contract 未改写 |
| 完整 `pnpm lint` | BLOCKED / not a Day28 source failure | 既有 `.workbuddy/artifacts/*` 与 `scripts/diag-preload.cjs` 产生 1031 errors；这些文件不在 Day28 commit，未删除、未修改、未通过 exclude/ignore 隐藏 |

integration 运行时出现的 `asset-thumbnail:read No handler registered` 和 Windows GPU cache 日志属于既有 Electron integration fixture/environment noise；命令最终 exit 0，未作为功能 PASS 证据单独使用。

## Timing、字幕、交互与持久化证据

- Untimed `startMs === endMs` 仍合法、可保存/重开且不直接生成 visible subtitle；Timeline authoring 可找到并安排它。
- Positive span、shot-end default/backfill、left/right clamp、exact adjacency、overlap rejection 和 half-open exact end 均有 service/evaluator/store tests。
- Legacy timed/untimed loadability 与 legacy overlap compatibility 保持；未把所有历史 Dialogue 投入 `SubtitleTrackSchema.parse()` 的 no-overlap gate。
- Product Preview 的本地 `timeMs` 与 editor playhead 身份分离；两者共享 cue semantics，不共享 mutable clock state。
- Canvas 字幕 overlay 使用 `listening=false`；contract test 锁定 subtitle-visible 区域仍不夺取下层 layer hit-test。
- Dialogue timing mutation、audio attachment、save/reopen path 均覆盖 unit/integration contracts；audio source 通过 project-owned `assets` 路径和 hash 校验读取。
- Drag preview 不更新 dirty/revision/history；pointerup 单次提交，Undo/Redo 通过既有 `EditorProjectStore` history owner。

## Windows Electron 真人验收

已用最新 build 启动真实 Windows Electron，当前窗口信息如下：

- Window title: `Panda Stage`
- Main process: responsive，窗口句柄有效
- Renderer: `file:///D:/panda-stage-main/dist/renderer/index.html`
- Acceptance root: `D:\PandaStage-Acceptance\issue221\`
- DevTools/JSON 未作为验收操作或 PASS 证据；仅用于启动/响应性诊断。

以下项目仍等待 maintainer 在正式 UI 中逐项执行并签字，当前全部为 `PENDING`：

- 三条对白的首尾相接排列、Timeline clip 显示与拖动。
- move/resize 与 Canvas/Preview 字幕同步、shot-end 默认与 clamp。
- overlap 拒绝、精确 adjacency、错误回显且 Project 不变。
- clip/handle pointer 不触发 ruler seek；zoom/横向滚动后 ruler 与 clip 对齐。
- 单次 drag/resize 的 Undo/Redo、save → close → reopen。
- 切换 shot 清理旧字幕、字幕可见时下层 layer/Transformer 仍可点选。
- 字幕最多两行/长文本 warning、audio 无 stretch、mouth 只作用于 speaking character。
- Issue #220 wide → narrow → wide 布局、内部滚动和底部控件可达性。

## 债务与范围边界

- `DEBT-TEST-B28`: 自动化不能替代真实 Windows pointer/Konva/DPI/布局验收；需 maintainer 真人记录。
- `DEBT-LINT-ENV-B28`: 仓库完整 lint 被既有 `.workbuddy/artifacts` 与 `scripts/diag-preload.cjs` 污染；没有扩大 Day28 范围去修复或隐藏它们。
- `DEBT-SUBTITLE-STYLE-B28`: 复用现有 `SubtitleStyle`，本轮未做完整 subtitle theme/style editor。
- `DEBT-SCOPE-B28`: 未实现 TTS、waveform/mixing、ActionPreset、通用 TimelineEvent editor、自动文本时长、ripple edit、第二 Timeline 或第二 Project store。

## 结论

Day28 的实现、测试和 build 已完成，Day28 scope 的 source/test gates 有证据；完整仓库 lint 的环境污染已如实记录。Windows Electron 已启动并响应，但 maintainer 尚未完成真人验收，因此 `overall = PENDING`，不得据此关闭 Issue #221、合并 PR 或把真人项目标记为 PASS。
