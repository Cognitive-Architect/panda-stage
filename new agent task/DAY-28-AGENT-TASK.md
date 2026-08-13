# Panda Stage Agent Task — Day 28

> **源工单编号**：R-28/45  
> **执行工单编号**：B-28/45  
> **标题**：Dialogue Timing + Subtitle Track  
> **角色**：Engineer  
> **模板**：ID-59 v3.0 通用增强版  
> **路线状态**：Day 26～45 Rebaseline v1  
> **派单编写时审计基线**：`main@f126249aefb7f5379db5cbf2a48a49e62c30307e`  
> **执行基线**：必须是 **Day 26 PASS + merged 且 Day 27 PASS + merged 后的最新稳定 main**；开工时重新记录分支与 HEAD  
> **核心范围声明**：本日只把 Day 27 已能正式录入的 Dialogue 安排到时间轴上，并让编辑器 Canvas/既有 Preview 按当前时间显示对应字幕；不做 TimelineEvent 通用编辑器、动作组合、ActionPreset、波形、TTS、自动字幕或主题设计器。

---

# 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Day 28 — Dialogue Timing + Subtitle Track
- **轰炸目标**：复用 Day 26 的唯一 Timeline/time geometry、Day 27 的唯一 Dialogue authoring/selection owner，以及仓库现有 subtitle engine，把 Dialogue 从“已录入但可能未定时”推进到“可移动、可调时长、可在当前时间显示字幕”的真实产品路径。
- **任务性质**：功能开发 + 交互状态管理 + History 集成 + 现有字幕管线收敛 + 真人验收
- **输入基线**：完整读取本工单【模块2】；Day 26 / Day 27 合入后重新锁定真实 Timeline / Dialogue / playhead / Inspector owner，禁止按旧文档概念路径另建平行实现。
- **输出要求**：可执行 Dialogue timing + 可复现自动化验证 + 真实 Windows Electron 验收 + 显式债务声明 + `docs/test-receipts/DAY-28.md` 结构化收卷。
- **用户可见结果**：用户在时间轴看到对白块，拖动播放头时能清楚知道当前字幕；对白块能移动、调起点/终点，越界会被 clamp，重叠会被明确拒绝；一次拖拽只产生一次可 Undo/Redo 的正式修改。

## 通用铁律

1. **数据诚实**：测试数、warning 数、HEAD、PASS/FAIL、真人步骤必须来自真实命令或真实操作。
2. **零占位符**：禁止 fake Dialogue、fake subtitle、假播放头、临时 JSON 注入、硬编码“拖动成功”。
3. **自动化优先**：时间映射、重叠判定、clamp、History、项目/镜头身份、边界语义必须优先用自动化证明；真人 Electron 仍是最终 Gate。
4. **最小必要复杂度**：不建设通用轨道系统、ripple edit、keyframe editor、字幕主题系统、动作冲突引擎。
5. **债务透明化**：测试基础设施、历史重叠数据、字幕样式未激活字段等必须显式写 `DEBT-*`。
6. **唯一 owner**：Timeline/time geometry 复用 Day 26；Dialogue mutation/selection 复用 Day 27；subtitle timing 复用现有 shared subtitle engine；禁止第二套时钟/字幕 evaluator。
7. **身份安全**：任何 drag/resize preview 必须绑定 `projectRoot + shotId + dialogueId`；切项目/镜头/删除 Dialogue 时必须失效。
8. **真人安全门优先**：自动化全绿但真实 Electron 拖动/字幕/Undo/Redo/save-reopen 任一主路径 FAIL，则 Day 28 = FAIL。

---

# 【模块2】输入基线（完整技术背景，零占位符）

## 2.1 Git 与硬前置依赖

| 输入项 | 当前已确认事实 | 开工验证命令 / 证据 | 状态 |
|---|---|---|---|
| 派单审计坐标 | 编写本工单时 `main@f126249aefb7f5379db5cbf2a48a49e62c30307e`，该提交仅加入新版 Day 27 工单文档 | `git log --oneline -n 8` | 已确认 |
| Day 28 执行坐标 | 必须在 Day 26、Day 27 都 PASS + merge 后，以当时最新稳定 main 为准 | `git branch --show-current`；`git rev-parse HEAD`；`git log --oneline -n 10` | 开工必须重录 |
| Day 26 依赖 | Day 28 必须复用 Day 26 最终合入的 Timeline shell、playhead、time geometry / snapping owner | `cat docs/test-receipts/DAY-26.md`；`find src/renderer -maxdepth 4 -type f | grep -Ei 'timeline|playhead'` | **硬前置** |
| Day 27 依赖 | Day 28 必须复用 Day 27 最终合入的 DialogueService/store/selection/Dialogue Sheet；不得自己另造对白 authoring | `cat docs/test-receipts/DAY-27.md`；`find src -maxdepth 5 -type f | grep -Ei 'dialogue'` | **硬前置** |
| 禁止继承线 | Stage 3-B / ActionPreset / PR #177 不属于当前核心路线 | `git diff main...HEAD --name-only`；`git log --oneline main..HEAD` | 硬边界 |

### Day 28 开工阻塞规则

满足任一条，**不得进入实现**：

1. Day 26 回执不是 PASS 或代码未 merge。
2. Day 27 回执不是 PASS 或代码未 merge。
3. Timeline/playhead/time geometry 的真实 owner 仍不清楚。
4. Dialogue mutation/selection 的真实 owner 仍不清楚。
5. 为实现字幕时间编辑被迫复活 ActionPreset、通用 TimelineEvent 编辑器或 PR #177。

> 人话版：Day28 是给 Day27 写好的对白“排班”。对白本和时间轴桌子都还没交付，就别提前拿尺子量空气。🤣

## 2.2 当前正式 Dialogue 时间语义：Day 27 与 Day 28 的衔接合同

**文件**：`src/domain/models/dialogue.ts`（当前审计 main；开工后用 `nl -ba` 重锁行号）

当前正式 Dialogue 已存在：

- `startMs`
- `endMs`
- `text`
- speaker / voice / subtitle 等正式引用字段。

当前 schema 允许 `endMs >= startMs`。

新版 Day 27 工单明确允许刚录入、尚未定时的正式文本 Dialogue 使用：

```text
startMs = endMs
```

因此 Day 28 **禁止**为了字幕显示简单把整个 ProjectSchema 改成 `endMs > startMs`。

### Day 28 正式时间状态

本日把 Dialogue 分为两种正式状态：

1. **Untimed / 未定时**：`endMs === startMs`
   - 是合法 Project 数据；
   - 可以保存、重开、Undo/Redo；
   - 不产生可见字幕窗口；
   - Timeline 必须能让用户找到并安排它，不得静默丢失。
2. **Timed / 已定时**：`endMs > startMs`
   - 在 Timeline 显示为有宽度的 Dialogue clip；
   - 参与重叠检查；
   - 在 `[startMs, endMs)` 内显示字幕。

### Day 28 schemaVersion 合同

- `startMs/endMs` 已是现有 persisted 字段；
- Day 28 默认**不新增 Project persisted 字段，不因 timing UI 自动 bump schemaVersion**；
- 若开工后发现 Day27 最终实现或必要兼容确实要求 persisted shape 变化，先触发 `SCHEMA-001`，不得“顺手升版本”。

## 2.3 现有 shared subtitle engine：必须复用，不得重写

**文件**：`src/shared/preview/subtitle-engine.ts`（当前约 1–37 行）

已确认现有正式能力：

```text
SubtitleCue:
- id
- startMs integer >= 0
- endMs integer > 0
- text
```

并且：

- `SubtitleCueSchema` 要求 `endMs > startMs`；
- `SubtitleTrackSchema` **拒绝 cue overlap**；
- `evaluateSubtitleAtTime()` 使用**左闭右开**区间：

```text
startMs <= currentTimeMs < endMs
```

- 时间必须是非负整数毫秒。

### Day 28 冲突策略正式锁定

原 Day 28 源工单要求“重叠允许/禁止二选一”。结合当前 subtitle engine，本工单直接选择：

> **新 authoring 产生的 Timed Dialogue 不允许重叠。**

具体合同：

1. 两条 Timed Dialogue 若满足区间重叠 → commit 被拒绝。
2. 首尾相接合法：A `[0,1000)`，B `[1000,2000)` 不重叠。
3. Untimed Dialogue（零时长）不参与 visible overlap 判定。
4. 禁止自动 ripple、自动推开其他 clip、自动改别人时间。
5. 拒绝时 UI 给出可读错误，保留当前已提交 Project 不变。
6. 不引入通用“事件冲突引擎”。

> 人话版：餐桌一次只允许一个人拿麦克风，但上一个人 1.000 秒放下、下一个人 1.000 秒拿起完全没问题；别为了防抢麦再建一套春晚总导演系统。🤣

## 2.4 现有 Product Preview 已经会从 Dialogue 显示字幕

**文件**：`src/renderer/shell/productPreviewModel.ts`（`buildProductPreviewCues()` 区域）

已确认当前逻辑：

- 从 `shot.dialogues` 生成 `SubtitleCue[]`；
- 过滤 `endMs <= startMs` 的零/负跨度；
- 文本 trim；
- 按 `startMs` 排序。

**文件**：`src/renderer/shell/ProductPreviewOverlay.tsx`

已确认：

- Preview 有**自己的本地 `timeMs`**；
- 调 `evaluateShotAtTime(...)` 得当前渲染快照；
- 调 `evaluateSubtitleAtTime(cues, evaluatedShot.timeMs)` 找字幕；
- 将 `caption` 交给共享 `CanvasStage / StageRenderer`；
- Preview 状态是 read-only / transient，不写 Project / History / dirty。

### Day 28 关键约束

1. **不得新写第二个字幕时间判断**，例如在编辑 Canvas 里重新散写：

```ts
currentTimeMs >= dialogue.startMs && currentTimeMs < dialogue.endMs
```

若需要新的 editor helper，应收敛到现有 subtitle engine/共享 projection 上。
2. Product Preview 的本地播放时钟继续保持 Preview-local；**不能拿它当 Day26 编辑器 playhead store**。
3. Day26 编辑器 `currentTimeMs` 与 Product Preview `timeMs` 是两个不同身份的时钟：
   - Editor time：编辑 UI transient state；
   - Preview time：打开预览时的 transient session state。
4. 两边只共享**时间语义 / subtitle evaluator**，不共享 mutable clock state。
5. Day 28 必须给 Product Preview 补回归：调整 Dialogue timing 后重新预览，字幕出现/消失时间与编辑器一致。

## 2.5 当前编辑器 Canvas：静态编辑画布，不是动作播放器

**文件**：`src/renderer/features/canvas/CanvasStage.tsx`（当前约 220–520 行为核心区）

已确认当前 editor Canvas：

- 读取 `editorProjectStore / shotStore / selectionStore`；
- 使用 `buildEditorStageRenderModel(snapshot.project, shot)`；
- 直接按当前 `shot.layers` 绘制可选择/可拖拽 Konva 图层；
- 当前没有正式 editor `currentTimeMs` 输入；
- 当前没有 Dialogue 字幕 overlay；
- transformer 使用单独 Konva layer。

**文件**：`src/domain/selectors/stageRenderModel.ts`

已确认 `buildEditorStageRenderModel(project, shot)` 是**静态 editor render model**，不接收时间，不执行 timeline event evaluator。

### Day 28 Canvas 合同

Day 28 **只给 editor Canvas 增加“当前时间字幕显示”能力**：

- 读取 Day 26 的 editor `currentTimeMs`；
- 读取当前 shot 的已定时 Dialogue；
- 通过共享 subtitle evaluator 得到当前字幕；
- 在 editor Canvas 上绘制**纯视觉、`listening=false` 的字幕层**。

Day 28 **禁止**：

- 为了字幕把整个 editor Canvas 改成 `evaluateShotAtTime` 驱动；
- 顺手让 TimelineEvent / ActionPreset 动起来；
- 改写图层选择/拖拽 authority；
- 把字幕层放进 Konva hit-test authority。

### Konva 安全约束

字幕 overlay 必须满足：

1. `listening=false`；
2. 不生成可点击 hit target；
3. 不改变普通图层/background 的 pointer 命中；
4. 不遮断 Transformer 交互；
5. 视觉层次可在内容上方，但 interaction authority 仍归现有图层/Transformer。

必须补一条回归：字幕可见时，点击字幕覆盖区域下方的普通图层仍选中正确 layer，而不是字幕/背景。

## 2.6 现有共享 StageRenderer：字幕视觉已有正式 owner

**文件**：`src/renderer/stage/StageRenderer.tsx`（当前约 1–220 行）

已确认：

- `caption: string | null` 是正式输入；
- 字幕通过 `Rect + Text` 在 Konva 舞台绘制；
- 使用 `STAGE_CAPTION_SAFE_AREA`；
- 整个 Preview Stage `listening=false`。

**文件**：`src/shared/stage/layout.ts`

已确认当前唯一 caption safe area：

```text
x=250
y=890
width=1420
height=132
horizontalPadding=40
verticalPadding=20
```

**文件**：`src/domain/models/subtitle.ts`

已确认 Project 中还存在正式 `SubtitleStyleSchema`：

- `fontFamily`
- `fontSize`
- `textColor`
- `backgroundColor`
- `position`
- `align`
- `maxWidth`

### Day 28 样式范围决策

本日目标是“字幕能稳定出现/消失且可读”，**不是字幕主题系统**。

因此：

1. 不新增第二个 SubtitleStyle schema。
2. 不新增字幕样式编辑 UI。
3. Editor Canvas 的字幕视觉必须复用/抽取现有 `StageRenderer + STAGE_CAPTION_SAFE_AREA` 的 presentation owner；禁止另写一套不同的 CSS/Konva 常量。
4. 若现有 StageRenderer 尚未真正消费 `SubtitleStyleSchema` 的全部字段，Day 28 **不强制借机做完整主题实现**；保持现有可读 presentation，回执显式写 `DEBT-SUBTITLE-STYLE-B28`。
5. 如果为了避免 editor/preview 两套视觉代码，只需抽一个小型共享 caption presentation helper/component，可做；禁止扩展成 theme engine。

> 也就是说：先保证“同一句字幕别在编辑器穿黑西装、预览里穿花裤衩”，至于字体商城以后再说。🤣

## 2.7 Day 26 time geometry / snapping：只复用真实 owner

原 Day 28 要求“映射/吸附复用 Day26 time geometry”。编写本工单时 Day26 尚未实际实施，因此本工单**不猜函数名**。

### Day 28 开工必须先运行

```bash
find src/renderer -maxdepth 5 -type f | grep -Ei 'timeline|playhead|time'
git grep -n "currentTimeMs\|timeToX\|xToTime\|snap\|playhead" -- src/renderer tests
cat docs/test-receipts/DAY-26.md
```

然后在 `docs/test-receipts/DAY-28.md` 写：

- `DECISION-B28-TIME-OWNER`
- Day26 实际 geometry helper 路径
- Day26 实际 snapping 规则
- Day26 实际 editor playhead store / state owner

### Timing mutation 统一规则

所有 Dialogue 时间最终写回必须是**整数毫秒**，并使用 Day26 的实际 geometry/snapping 规则。

#### Move 整块

- 保持 `duration = endMs - startMs` 不变；
- 整体 clamp 到 `[0, shot.durationMs]`；
- 不越左边界、不越镜头尾；
- 若落点与其他 Timed Dialogue 重叠 → commit 拒绝，不自动挤别人。

#### Resize start

- start clamp 到 `[0, endMs)`；
- snap 后必须仍 `startMs < endMs`；
- 若发生 overlap → commit 拒绝。

#### Resize end

- end clamp 到 `(startMs, shot.durationMs]`；
- snap 后必须仍 `endMs > startMs`；
- 若发生 overlap → commit 拒绝。

#### Untimed → Timed

若 Dialogue 当前 `startMs === endMs`：

- 必须提供明确的“安排到时间轴”路径；
- 可从其 point-time / 当前 playhead 作为起点，但最终必须形成正跨度；
- 默认正跨度若需要一个值，**优先复用 Day26 一个 snap quantum / frame-like step 的正式定义**；若 Day26 没有可用最小步长，先写 `DECISION-B28-DEFAULT-DURATION`，禁止偷偷发明“每句 2 秒”。

## 2.8 Drag / Resize transient state 与 History 合同

现有 `EditorProjectStore.updateProject(...)` / `ProjectCommand` / `HistoryStore` 是正式 mutation 账本。

Day 28 必须保持：

### 拖拽过程中

- pointermove / mousemove 只更新 UI-local preview；
- **不写 Project**；
- **不 dirty**；
- **不 increment revision**；
- **不生成几十/几百个 History command**。

### pointerup / 明确提交时

- 计算 snap + clamp + overlap validation；
- 合法 → 一次正式 Dialogue timing mutation；
- 一次 gesture = **1 个 History command**；
- dirty=true；
- Undo 一次恢复整个 gesture 前的时间；
- Redo 一次恢复 gesture 后时间。

### 取消 / 身份切换

以下任一发生，必须丢弃 transient drag preview：

- Escape / cancel；
- 切 Project；
- 切 Shot；
- 被拖 Dialogue 已删除；
- 当前 selection 已不再指向该 Dialogue。

transient state 必须绑定：

```text
projectRoot + shotId + dialogueId
```

不得只靠“当前 selectedDialogueId”。

## 2.9 Day 27 Dialogue selection：Timeline clip 必须复用

Day 27 新版工单要求建立 Dialogue selection，并与 layer/background selection 在唯一 RightInspector 中互斥。

Day 28 不得另建 `timelineSelectionStore` 专门选 Dialogue。

### Clip selection 合同

1. 点击 Dialogue clip → 复用 Day27 Dialogue selection owner。
2. RightInspector 继续显示 Day27 speaker/text 编辑界面；Day28 不复制 Inspector。
3. 切回 Canvas layer/background → Dialogue selection 失效，沿用 Day27 规则。
4. 删除 selected Dialogue → clip/selection/drag preview 同时失效。
5. 切 Shot/Project → selection 清理。

如 Day27 最终 owner 名称与工单预期不同，以真实合入代码为准，并记录 `DECISION-B28-DIALOGUE-SELECTION-OWNER`。

## 2.10 Dialogue Track 的最小产品形态

Day 28 不是 NLE。

### 必须有

- 当前 shot 的 Dialogue lane / row；
- 每条 Timed Dialogue 有一个 block；
- block 可看到 speaker 名 + 台词摘要；
- selected / dragging / invalid-overlap 状态可区分；
- 左右 resize handle；
- move body；
- Untimed Dialogue 有明确入口/区域能被安排，不能直接消失。

### 推荐 stable selectors

如果 Day26 已有同类 selector convention，沿用它；否则至少给：

```text
data-testid="timeline-dialogue-track"
data-testid="timeline-dialogue-clip"
data-dialogue-id="..."
data-start-ms="..."
data-end-ms="..."
data-testid="timeline-dialogue-resize-start"
data-testid="timeline-dialogue-resize-end"
```

### 明确不做

- 多轨可配置系统
- drag reorder track
- ripple edit
- magnetic group move
- waveform
- keyframe
- generic event clip registry
- TimelineEvent 编辑器

## 2.11 字幕当前项解析：单一时间语义

Day 28 需要 editor Canvas 与 Product Preview 对同一 shot/time 得到相同字幕。

推荐收敛方向：

- 复用现有 `SubtitleCue` / `evaluateSubtitleAtTime`；
- 将“Dialogue → SubtitleCue” projection 收敛为单一 helper；
- Product Preview 与 editor Canvas 同时消费该 helper。

可以移动/提取当前 `buildProductPreviewCues()`，但必须保持：

1. Untimed Dialogue 不变成可见 cue；
2. Timed Dialogue 使用原 id/start/end/text；
3. 时间是整数毫秒；
4. 排序稳定；
5. 左闭右开；
6. 不出现 editor 一套 evaluator、preview 一套 evaluator。

**不要**为了“共享”创建一个带 store / React / Project mutation 的超级 SubtitleManager。

## 2.12 Legacy overlap 与 ProjectSchema 边界

当前 `SubtitleTrackSchema` 拒绝 overlap，但当前 ProjectSchema 的 Dialogue 本体并未在此审计阶段确认会全局拒绝历史 overlap。

Day 28 默认策略：

- **authoring 新提交禁止 overlap**；
- 不因本日 UI 需求直接让 ProjectSchema 拒绝所有历史 overlapping project；
- 开工先搜索现有 fixtures / tests 是否存在 overlap；
- 若历史项目确有 overlap，先记录 `DEBT-LEGACY-OVERLAP-B28` 与实际行为，不要把“修历史数据”混进 Day28。

若 Agent 判断必须将 overlap 升格为 persisted schema invariant，触发 `SCHEMA-001` 先停下说明兼容影响。

## 2.13 默认变更范围

### 允许修改：Day26 / Day27 实际 owner

开工后根据真实 main 记录并使用：

- Day26 Timeline root / Dialogue lane 接入点
- Day26 playhead/time geometry/snapping helper
- Day27 DialogueService / dialogueStore
- Day27 Dialogue selection store
- Day27 Dialogue Sheet / Inspector（仅 timing 选择联动所需小改）

### 允许修改：当前已确认现有字幕/舞台 owner

1. `src/shared/preview/subtitle-engine.ts`
2. `src/renderer/shell/productPreviewModel.ts`
3. `src/renderer/shell/ProductPreviewOverlay.tsx`（仅共享字幕 projection/回归需要）
4. `src/renderer/stage/StageRenderer.tsx`
5. `src/shared/stage/layout.ts`（仅共享 presentation 必要时）
6. `src/renderer/features/canvas/CanvasStage.tsx`
7. `src/renderer/styles.css`（仅 Timeline clip / 状态样式）

### 允许新增：最小聚焦 helper/component

根据 Day26/27 实际结构，可新增：

- `src/domain/selectors/dialogueSubtitle.ts` 或同等单一 projection helper；
- `src/renderer/features/timeline/DialogueTrack.tsx` / `DialogueClip.tsx`（若 Day26 实际目录如此）；
- 一个小型 shared caption presentation helper/component（仅为避免 editor/preview 视觉重复）。

不得因为工单写了这个文件名就无视 Day26 实际 owner；路径以合入代码为准。

### 允许修改 / 新增测试

优先扩展真实已有测试：

- `tests/unit/subtitle-engine.test.ts`
- `tests/unit/product-preview-overlay.test.ts`
- `tests/unit/editor-history.test.ts`
- Day26 timeline geometry/playhead tests
- Day27 dialogue service/store/selection tests
- canvas interaction / hit-test regression tests

可新增聚焦：

- `tests/unit/dialogue-timing.test.ts`
- `tests/unit/dialogue-track-geometry.test.ts`
- `tests/unit/dialogue-timing-history.test.ts`

### 明确禁止

- 修改 `TimelineEvent` / ActionPreset 生产语义
- settled-state / evaluator 动作组合
- waveform editor
- audio waveform decode/render
- TTS / speech synthesis
- 自动字幕生成
- 自动估算对白时长
- ripple edit / multi-select time move
- generic Track/Clip plugin framework
- 第二个 playhead store
- 第二个 subtitle evaluator
- 第二个 Project store
- 第二个 Dialogue selection store
- 第二个 RightInspector
- 为字幕让 editor Canvas 全面切到动作 evaluator

## 2.14 开工 blast-radius 搜索（必须先做）

```bash
git grep -n "evaluateSubtitleAtTime\|SubtitleTrackSchema\|SubtitleCueSchema" -- src tests
git grep -n "buildProductPreviewCues\|caption=" -- src tests
git grep -n "subtitleStyleId\|SubtitleStyleSchema\|STAGE_CAPTION_SAFE_AREA" -- src tests
git grep -n "startMs\|endMs" -- src/domain src/renderer tests | grep -Ei "dialogue|subtitle"
git grep -n "currentTimeMs\|playhead\|timeToX\|xToTime\|snap" -- src/renderer tests
git grep -n "DialogueService\|dialogueStore\|dialogueSelection" -- src tests
```

回执必须列出真实 consumer，尤其检查：

- Product Preview
- editor Canvas
- export/hidden renderer（若 grep 命中）
- Dialogue duplicate / save / migration
- Day26/27 tests

禁止只改 UI 能编译就算完成。

## 2.15 目标结果

Day 28 完成时必须同时成立：

1. Day26 Timeline/time geometry/playhead owner 保持唯一。
2. Day27 Dialogue authoring/mutation/selection owner 保持唯一。
3. Untimed Dialogue 仍合法且可找到；不会因无宽度从产品中消失。
4. Timed Dialogue clip 可选择、move、resize start、resize end。
5. 一次 move/resize gesture 只产生 1 个 History command。
6. 超出 shot 左右边界会 clamp。
7. Timed Dialogue overlap 被明确拒绝；相邻 `[A.end === B.start]` 合法。
8. 当前 editor playhead 落入 `[start,end)` 时 Canvas 显示正确字幕；到 `endMs` 立即消失/切下一句。
9. 字幕 layer 不影响 layer/background/Transformer hit-test。
10. 切 Shot 后绝不显示上一 Shot 字幕。
11. Product Preview 对同一 Dialogue timing 使用相同字幕时间语义。
12. Save→Close→Reopen 后 Dialogue start/end 一致。
13. Undo/Redo 恢复时间并同步 Timeline + Canvas 字幕。
14. 不触碰 ActionPreset / generic TimelineEvent / waveform / TTS 范围。

## 2.16 当前测试工具链事实

当前仓库已确认可用：

```text
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --check
```

仓库当前没有确认一套必须使用的独立 Playwright/component framework。

因此：

- 有现成 timeline/component 测试设施 → 用；
- 没有 → pure geometry/service/store tests + integration + 真人 Electron；
- 不存在的工具写 `N/A + 原因 + 替代证据`；
- 禁止为了 Day28 一份工单临时安装整套测试框架，除非触发 `TEST-001` 且确实无替代。

### 开工 baseline

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

**UNVERIFIED AT TASK AUTHORING**：本工单编写阶段没有替执行 Agent 声称这些命令在 Day28 的未来实际基线已 PASS。

## 2.17 文档同步

必须新建/更新：

- `docs/test-receipts/DAY-28.md`

至少记录：

- Day26 receipt / merge SHA
- Day27 receipt / merge SHA
- Day28 开工 HEAD / 收卷 HEAD
- 实际 Timeline/playhead/time geometry owner
- 实际 Dialogue mutation/selection owner
- subtitle evaluator/projection owner
- overlap policy
- Untimed/Timed contract
- drag preview / History contract
- Canvas hit-test regression
- Product Preview regression
- 自动化命令真实输出摘要
- Windows Electron 真人验收
- PASS / FAIL
- debt
- 下一步唯一动作

## 2.18 历史债务 / 高风险回归点

1. Stage 3-B 已证明“transient draft + mutable target identity”会串对象；Day28 drag preview 必须绑定 Project+Shot+Dialogue。
2. Konva 已出现过 visible scene 与 hit authority 不一致；字幕 overlay 必须 `listening=false` 并做真实点击回归。
3. Product Preview 已有自己本地 playback time；Day28 不得把 editor playhead 和 preview clock 混成一个全局状态。
4. Day27 有合法 Untimed Dialogue；Day28 不得用正时长要求反向破坏 Day27 schema。
5. shared subtitle engine 已有“不 overlap + half-open”契约；不要为了 UI 另造相反语义。
6. CI 绿不能替代真实 Windows Electron 的 drag/resize/hit-test/save-reopen。

## 2.19 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | shared subtitle engine 已存在且 reject overlap；Product Preview 已消费 Dialogue 字幕；editor Canvas 目前静态且无字幕；StageRenderer 已有 caption presentation；Day27 设计允许零时长 Untimed Dialogue |
| 待确认问题 | 1）Day26 最终 time geometry/playhead owner；2）Day27 最终 Dialogue mutation/selection owner；3）Day26 Timeline 的 clip DOM/drag pattern；4）`caption` / subtitle projection 是否还有 export/hidden consumer |
| 预期输出 | 在不新造第二时钟/第二 evaluator、不触碰 ActionPreset 的前提下完成 Dialogue timing + editor subtitle track 主路径 |
| 停止条件 | Day26/27 owner 已锁定；subtitle blast radius 已列全；half-open/no-overlap/Untimed contract 可在现有架构内成立；无需进入 generic TimelineEvent engine 即可实现 |

---

# 【模块3】工单矩阵（通用高压版）

## B-28/45｜Engineer｜Dialogue Timing + Subtitle Track

### 3.1 基础信息

- **工单编号**：B-28/45
- **角色**：Engineer
- **目标**：给正式 Dialogue 增加可操作的时间区间，并让 Timeline、Editor Canvas、Product Preview 对同一时间合同达成一致。
- **输入**：模块2中的 Day26 Timeline/playhead、Day27 Dialogue owner、shared subtitle engine、Product Preview、editor Canvas、StageRenderer。
- **依赖关系**：严格依赖 Day26 PASS+merge 与 Day27 PASS+merge；不依赖 ActionPreset/Stage3-B。

### 3.2 输出交付物

#### 核心时间交付

- Untimed/Timed Dialogue 合同落地。
- Timed Dialogue overlap authoring 禁止，half-open 相邻合法。
- Dialogue move / resize-start / resize-end 走 Day26 geometry/snapping + clamp。
- drag preview transient；pointerup 一次 History commit。

#### 核心 UI 交付

- Day26 Timeline 中的 Dialogue track / clips。
- Timed clip body move + 左右 handle。
- Untimed Dialogue 可被明确安排。
- 点击 clip 复用 Day27 Dialogue selection。
- overlap/边界错误用户能看懂。

#### 字幕交付

- editor Canvas 根据 current shot + Day26 editor time 显示当前 Dialogue 字幕。
- caption overlay `listening=false`，不改变 layer hit-test。
- Product Preview 继续复用相同 subtitle projection/evaluator。
- 不引入第二套字幕视觉 owner。

#### 必须包含

- half-open boundary tests；
- adjacency allowed / overlap rejected tests；
- clamp left/right tests；
- untimed dialogue preserved tests；
- one gesture = one History command；
- preview state not dirty tests；
- project/shot/dialogue identity cancellation tests；
- Canvas subtitle appear/disappear tests；
- subtitle-visible hit-test regression；
- Product Preview timing regression；
- Save/Reopen + Undo/Redo 真人验收。

#### 禁止包含

- generic track registry
- TimelineEvent authoring
- ActionPreset
- settled-state/evaluator work
- waveform
- TTS
- auto-duration
- ripple edit
- fake clock
- fake subtitle
- direct JSON timing mutation

#### 交付证明

```bash
git branch --show-current
git rev-parse HEAD
git log --oneline -n 10
git status --short
git diff --name-only
git diff --stat
git diff --check
git grep -n "evaluateSubtitleAtTime\|SubtitleTrackSchema\|buildProductPreviewCues" -- src tests
git grep -n "currentTimeMs\|playhead\|timeToX\|xToTime\|snap" -- src/renderer tests
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

以及真实 Windows Electron：

- 3 条首尾相接 Dialogue；
- 拖动/resize 后 Timeline + Canvas 同步；
- overlap 拒绝；
- clip 拖到镜头尾 clamp；
- Undo/Redo；
- save/reopen；
- 切 shot 清字幕；
- 字幕覆盖区域仍可正确选择其下普通 layer。

### 3.3 规模与复杂度观察

- 时间几何只允许一个 owner；不要在 DialogueTrack 复制 `timeToX/xToTime/snap`。
- overlap 检查优先纯函数/Dialogue service 内聚；不要散在 3 个 pointer handler。
- drag preview 只存必要 `{identity, draftStartMs, draftEndMs}`；不要建设全局 gesture framework。
- caption projection / presentation 如需共享，抽小 helper；不要造 SubtitleManager 大对象。
- 单函数明显 >50 行需解释，但禁止为压行数硬拆。

### 3.4 自动化质量闸门（强制）

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | TS + Renderer + Electron build 通过 | `pnpm build` | 返工 |
| FMT | 无 whitespace/error diff；仓库未确认独立 formatter 则诚实 N/A | `git diff --check` | 返工或 N/A+原因 |
| LINT | 无新增 lint error；warning 真实声明 | `pnpm lint` | 返工或 debt |
| TEST | timing/overlap/history/subtitle/hit-test/integration 有真实行为测试 | `pnpm test:unit` + `pnpm test:integration` | 返工 |
| ARCH | Timeline/playhead/Dialogue/subtitle evaluator/Inspector owner 均唯一 | `git grep` + diff/import 检查 | 返工 |
| REAL | 无 fake clock/subtitle；Windows Electron 主路径真实完成 | `pnpm dev` + human evidence | 返工 |
| DOC | DAY-28 receipt 与实际行为一致 | `git diff -- docs/test-receipts/DAY-28.md` | 返工或 DEBT-DOC |

---

# 【模块3-A】刀刃表（16项，强制命令化）

| 类别 | 检查点ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | Timed Dialogue clip 可选择、move、resize start/end | timeline/timing tests + Electron | [ ] |
| FUNC | FUNC-002 | Untimed Dialogue 不丢失，可被安排成正跨度 Timed Dialogue | service/UI tests + Electron | [ ] |
| FUNC | FUNC-003 | Editor Canvas 在 `[start,end)` 显示正确字幕，边界立即切换/消失 | subtitle tests + Electron scrub | [ ] |
| FUNC | FUNC-004 | Product Preview 对同一 timing 使用相同字幕语义 | product-preview tests + Electron preview | [ ] |
| CONST | CONST-001 | 复用 Day26 time geometry/playhead；无第二 editor clock | `git grep` + import graph | [ ] |
| CONST | CONST-002 | 复用 Day27 Dialogue mutation/selection + ProjectCommand/History | store/service/history tests | [ ] |
| CONST | CONST-003 | shared subtitle evaluator/projection 单一；无第二套时间判断 | `git grep evaluateSubtitleAtTime` + diff | [ ] |
| CONST | CONST-004 | caption overlay 不参与 Konva hit-test；不触碰 ActionPreset/TimelineEvent authoring | source + interaction test + diff | [ ] |
| NEG | NEG-001 | overlap commit 被拒绝；相邻 `A.end===B.start` 合法 | pure/service tests | [ ] |
| NEG | NEG-002 | move/resize 超左/超右 clamp；不能形成非正 timed span | geometry/service tests | [ ] |
| NEG | NEG-003 | Project/Shot/Dialogue identity 变化会取消 drag preview | store/integration + Electron | [ ] |
| NEG | NEG-004 | 字幕显示时 layer/background/Transformer 点击/拖拽无回归 | canvas interaction tests + Electron | [ ] |
| UX | UX-001 | 用户能用时间轴把 3 条对白排成首尾相接并直观看到当前字幕 | Windows Electron | [ ] |
| UX | UX-002 | overlap/越界/Untimed 状态提示可理解，不静默改其他 clip | Windows Electron + screenshot | [ ] |
| E2E | E2E-001 | timing edit→Undo→Redo→Save→Close→Reopen，Timeline/Canvas 一致 | Windows Electron + receipt | [ ] |
| High | HIGH-001 | 自动化全绿 + Canvas hit-test + 真人时间主路径同时 PASS | test output + human receipt | [ ] |

### 刀刃表铁律

1. 每项必须有真实命令输出或真人 Windows Electron 证据。
2. “看起来没重叠”“应该没拦点击”不算证据。
3. N/A 必须写原因与替代证据。
4. 同一命令覆盖多项，在 Day28 receipt 写覆盖关系。

---

# 【模块3-B】地狱红线（10项）

1. **零占位符违规**：fake clock / fake subtitle / 硬编码 Dialogue timing → 返工。
2. **验证造假**：未跑 timing/history/hit-test/Electron 却写 PASS → 返工。
3. **构建失败仍交付**：`pnpm build` FAIL 仍声称完成 → 返工。
4. **测试缺失伪完成**：half-open、overlap、clamp、gesture History、identity isolation 无证据 → 返工。
5. **假实现**：setTimeout 模拟拖动完成、直接 JSON 改 start/end、假 playhead → 返工。
6. **架构违规**：第二 playhead / subtitle evaluator / Dialogue selection / Timeline root / Project store → 返工。
7. **新增 warning/debt 不申报**：legacy overlap、style debt、测试缺口隐藏不报 → 返工。
8. **范围失控**：擅自做 ActionPreset、TimelineEvent editor、波形、TTS、自动时长、ripple edit → 立即停止。
9. **Git 历史不完整**：reset/force-push 抹历史、整包搬旧实验分支 → 返工。
10. **探索伪装确定性**：Day26/27 owner 尚未锁定就按本工单预期文件名硬施工 → 返工。

---

# 【模块4】P4 自测轻量检查表 v3.0

| 检查点 | 自检问题 | 覆盖情况 | 相关用例ID / 命令 | 备注 |
|---|---|---|---|---|
| 核心功能用例（CF） | move/resize/Untimed/字幕是否各有标准路径？ | [ ] | FUNC-001～004 | |
| 约束与回归用例（RG） | half-open/no-overlap/owner/hit-test 是否覆盖？ | [ ] | CONST-001～004 | |
| 负面路径用例（NG） | overlap/越界/身份切换/交互回归是否覆盖？ | [ ] | NEG-001～004 | |
| 用户体验用例（UX） | 3 条对白排时间和错误提示是否用户能完成？ | [ ] | UX-001～002 | |
| 端到端关键路径（E2E） | edit→undo→redo→save→reopen 是否完整？ | [ ] | E2E-001 | |
| 高风险场景（High） | hit-test + human timing gate 是否单独验证？ | [ ] | HIGH-001 | |
| 字段完整性 | 回执是否写前置/预期/实际/风险？ | [ ] | `docs/test-receipts/DAY-28.md` | |
| 需求映射 | 每条验证是否回到“Dialogue Timing + Subtitle Track”？ | [ ] | 刀刃表 | |
| 自测执行 | 是否真实跑完整质量命令 + Electron？ | [ ] | quality gates | |
| 范围边界与债务 | 未做样式编辑/TTS/动作是否明确？ | [ ] | debt ledger | |

---

# 【模块5】收卷格式（强制结构）

```markdown
## ✅ Panda Stage Day 28 / B-28/45 完成并提交

### 提交信息
- Day26 prerequisite receipt: `PASS / FAIL`
- Day26 merge SHA: `<真实 SHA>`
- Day27 prerequisite receipt: `PASS / FAIL`
- Day27 merge SHA: `<真实 SHA>`
- Day28 开工 HEAD: `<真实 SHA>`
- Day28 收卷 HEAD: `<真实 SHA>`
- Commit: `feat(timeline): ...`
- 分支: `<真实分支>`
- 变更文件: `<git diff --name-only 实际输出>`

### 本轮目标与实际结果
- 目标: Dialogue timing + subtitle track，不进入 ActionPreset/通用事件编辑。
- 实际完成: [真实项]
- 未完成/不在范围: [真实列出]

### 关键决策记录
- DECISION-B28-TIME-OWNER: [Day26 实际 playhead/geometry owner]
- DECISION-B28-DIALOGUE-OWNER: [Day27 实际 service/store owner]
- DECISION-B28-DIALOGUE-SELECTION-OWNER: [Day27 实际 selection owner]
- DECISION-B28-SUBTITLE-PROJECTION: [共享 projection/evaluator owner]
- DECISION-B28-OVERLAP: `Timed Dialogue overlap forbidden; adjacency allowed`
- DECISION-B28-UNTIMED: [start=end 的产品呈现/安排路径]
- DECISION-B28-DEFAULT-DURATION: [若使用默认正跨度，真实规则；若不需要则 N/A]
- DECISION-B28-CAPTION-PRESENTATION: [editor/preview 如何共享视觉 owner]

### Subtitle / Time Blast Radius
```bash
git grep -n "evaluateSubtitleAtTime\|SubtitleTrackSchema\|SubtitleCueSchema" -- src tests
git grep -n "buildProductPreviewCues\|caption=" -- src tests
git grep -n "currentTimeMs\|playhead\|timeToX\|xToTime\|snap" -- src/renderer tests
[真实输出摘要/涉及文件]
```

### 自动化质量检查报告
```bash
[TYPE] pnpm typecheck
[真实输出摘要]

[FMT] git diff --check
[真实输出摘要]

[LINT] pnpm lint
[真实输出摘要]

[UNIT] pnpm test:unit
[真实输出摘要]

[INTEGRATION] pnpm test:integration
[真实输出摘要]

[BUILD] pnpm build
[真实输出摘要]
```

### Timing Contract 证据
- Untimed Dialogue 保留: [PASS/FAIL]
- Timed positive span: [PASS/FAIL]
- adjacency allowed: [PASS/FAIL]
- overlap rejected: [PASS/FAIL]
- left clamp: [PASS/FAIL]
- right clamp: [PASS/FAIL]
- half-open end boundary: [PASS/FAIL]

### History / dirty 证据
- drag preview 前后 dirty/revision/history: [真实值]
- pointerup commit 后: [真实值]
- Undo 后: [真实值]
- Redo 后: [真实值]
- save 后: [真实值]

### Canvas / Preview 证据
- editor currentTimeMs→字幕: [PASS/FAIL]
- cut at exact endMs: [PASS/FAIL]
- shot switch clears caption: [PASS/FAIL]
- subtitle-visible layer hit-test: [PASS/FAIL]
- Product Preview same timing semantics: [PASS/FAIL]

### 真实 Windows Electron 验收
- 环境: Windows / Electron / 窗口尺寸 / DPI
- 3 条对白首尾相接: [PASS/FAIL]
- move/resize 与 Canvas 同步: [PASS/FAIL]
- overlap rejection: [PASS/FAIL]
- clamp at shot end: [PASS/FAIL]
- Undo/Redo: [PASS/FAIL]
- save→close→reopen: [PASS/FAIL]
- switch shot clears subtitle: [PASS/FAIL]
- subtitle area click-through to correct layer: [PASS/FAIL]
- 全程 devtools/JSON: [未使用 / 若使用则 FAIL 原因]

### 刀刃表摘要
| 类别 | 覆盖数 | 关键证据 |
|:---|:---:|:---|
| FUNC | X/4 | |
| CONST | X/4 | |
| NEG | X/4 | |
| UX | X/2 | |
| E2E | X/1 | |
| High | X/1 | |

### P4 检查表摘要
| 检查点 | 状态 | 备注 |
|:---|:---:|:---|
| CF | [ ] | |
| RG | [ ] | |
| NG | [ ] | |
| UX | [ ] | |
| E2E | [ ] | |
| High | [ ] | |

### 规模与复杂度说明
- 关键函数/模块: [真实名称]
- 是否存在复杂度例外: [无 / 有]
- 若有: [来源与必要性]

### 债务声明
- DEBT-COMPLEXITY-B28: [无 / 描述]
- DEBT-TEST-B28: [无 / 描述]
- DEBT-DOC-B28: [无 / 描述]
- DEBT-SCOPE-B28: [无 / 描述]
- DEBT-PERF-B28: [无 / 描述]
- DEBT-SUBTITLE-STYLE-B28: [无 / 描述]
- DEBT-LEGACY-OVERLAP-B28: [无 / 描述]

### 风险与回滚点
- 主要风险: 时间几何复制、drag preview 串身份、字幕 overlay 破坏 Konva hit-test、editor/preview 时间语义分叉。
- 回滚方式: `git revert <Day28 commit>`；禁止 reset/force-push 抹历史。

### Day 结论
- `PASS`: 所有强制 gate + hit-test + 真实 Windows Electron timing 主路径通过。
- `FAIL`: 任一关键 gate / human acceptance 失败，不开始 Day 29 功能开发。

### 下一步唯一动作
- [只写一条]
```

---

# 【模块6】技术熔断预案（非时间熔断）

| 熔断ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| PREREQ-001 | Day26/Day27 任一未 PASS/merge，或 owner 不明确 | 立即停止 Day28 实现，只保留调查证据 | 等前置收口 |
| ARCH-001 | Dialogue timing 必须重写通用 Timeline engine / 全局 selection / ActionPreset 才能成立 | 暂停实现，提交最小架构问题给主理人 | 拆工单或降级 |
| SCHEMA-001 | 实现要求新增 persisted timing 字段、全局禁止 legacy overlap、或再次 schemaVersion bump | 停止 UI 扩展，先列兼容影响 | 另行决策 |
| QUALITY-001 | typecheck/lint/unit/integration/build 持续失败且非一次性小问题 | 停止堆 UI，先恢复质量基线 | 返工 |
| COMPLEXITY-001 | 连续 2 次返工仍因必要 drag/geometry 状态复杂度无法保持简单 | 允许 `DEBT-COMPLEXITY-B28`，但必须说明来源/清偿点 | 有条件交付，不自动 PASS |
| TEST-001 | 当前设施无法自动驱动真实 pointer drag / Konva hit-test | 用 pure geometry + store/integration + 可复现实测替代，并声明 `DEBT-TEST-B28` | 真人证据加重 |
| PERF-001 | 拖 playhead / clip 时出现明显 Project mutation 风暴或渲染卡顿 | 停止视觉扩展，先修 transient/commit 分层 | 返工 |
| HIT-001 | 字幕可见后 layer/background/Transformer 命中出现错误 | 立即停止，优先恢复 `listening=false` / scene-hit authority | Day28 FAIL 直到修复 |
| HUMAN-001 | 自动化全绿但 Electron timing/字幕/save-reopen/hit-test 任一 FAIL | Day28 直接 FAIL | 止损 |

## 复杂度熔断条款

- 初始标准：一个既有 Timeline 的 Dialogue lane + 复用 Day27 mutation/selection + 一个共享 subtitle projection + 一个非交互 caption overlay。
- 不允许第一次实现就建设 generic track registry、gesture engine、subtitle theme system。
- 若复杂度来自 Day26 真实 geometry 或 Day27 已有 selection contract，必须写清；不能一句“时间轴复杂”带过。

---

# 【模块7】派单口令（Day 28 定制版）

启动饱和攻击集群，执行 **Panda Stage Day 28：Dialogue Timing + Subtitle Track**！

## 技术背景

- 编写工单时 main=`f126249aefb7f5379db5cbf2a48a49e62c30307e`；Day28 执行必须等待 Day26 + Day27 都 PASS/merge 后最新稳定 main。
- Day27 允许 `startMs=endMs` 的正式 Untimed Dialogue；Day28 不得把它们 schema-level 判死。
- 当前 shared subtitle engine 已定义整数毫秒、half-open `[start,end)` 与“字幕 cue 不重叠”契约。
- 当前 Product Preview 已从 `shot.dialogues` 生成 cue，并调用同一 `evaluateSubtitleAtTime()` 显示字幕。
- 当前 editor Canvas 是静态可交互 Konva 编辑面，不应为了字幕切换到 ActionPreset/evaluator 模式。
- 当前 StageRenderer 已有可读 caption presentation 与 safe area；Day28 不做主题编辑器。

## 关键约束

- Day26/27 未 PASS+merge → 不开工。
- Timed Dialogue overlap 禁止；首尾相接允许。
- Untimed `start=end` 合法但不显示字幕。
- move/resize 复用 Day26 geometry/snapping；不自己算第二套。
- drag preview transient；pointerup 一次 ProjectCommand/History。
- editor playhead 与 Product Preview clock 身份分离。
- editor/preview 共享 subtitle projection/evaluator。
- caption overlay 必须 `listening=false`，不得改变 Konva hit authority。
- 不做 ActionPreset / TimelineEvent editor / waveform / TTS / auto-duration / ripple edit。

## 质量红线

- 10 项地狱红线全部生效。
- 16 项刀刃表全部命令/证据化。
- subtitle/time blast-radius 必须先 `git grep` 再改。
- 不存在的测试工具写 `N/A + 原因 + 替代证据`。
- 自动化全绿不能替代 Windows Electron 真人 Gate。

## 工单矩阵

- `B-28/45 Engineer`：单 Agent 完成本轮；不并行修改 Timeline geometry、Dialogue timing service、Canvas hit authority，避免共享时间/交互 owner 被多个 Agent 同时改。

## 验收铁律

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

然后必须启动真实 Windows Electron 完成：

> 创建/使用至少 3 条对白 → 安排成首尾相接 → 拖 playhead 看字幕 → move/resize → 制造 overlap 并确认拒绝 → 拖到 shot 尾确认 clamp → Undo → Redo → 保存 → 关闭 → 重开 → 切 Shot 清字幕 → 字幕可见时点击其下图层仍命中正确对象。

## 收卷要求

- 必须生成 `docs/test-receipts/DAY-28.md`。
- 必须记录 Day26/27 owner、half-open/no-overlap、Untimed contract、History/dirty、hit-test、Preview 回归、真人证据。
- 结论只能 PASS / FAIL。
- FAIL 时只处理 Day28 阻塞，不开始 Day29。

Ouroboros 闭环启动，**B-28/45**，执行！ ☝️🐍♾️🔥

---

# 【模块8】通用验证命令库（本工单实际技术栈）

## Git / prerequisite

```bash
git branch --show-current
git rev-parse HEAD
git log --oneline -n 10
git status --short
cat docs/test-receipts/DAY-26.md
cat docs/test-receipts/DAY-27.md
git diff --name-only
git diff --stat
git diff --check
```

## Day26 / Day27 owner 核对

```bash
find src/renderer -maxdepth 5 -type f | grep -Ei 'timeline|playhead|dialogue'
git grep -n "currentTimeMs\|playhead\|timeToX\|xToTime\|snap" -- src/renderer tests
git grep -n "DialogueService\|dialogueStore\|dialogueSelection" -- src tests
```

## Subtitle owner / blast radius

```bash
nl -ba src/shared/preview/subtitle-engine.ts
nl -ba src/renderer/shell/productPreviewModel.ts | sed -n '1,220p'
nl -ba src/renderer/shell/ProductPreviewOverlay.tsx | sed -n '1,280p'
nl -ba src/renderer/stage/StageRenderer.tsx | sed -n '1,280p'
nl -ba src/shared/stage/layout.ts
nl -ba src/renderer/features/canvas/CanvasStage.tsx | sed -n '200,560p'
git grep -n "evaluateSubtitleAtTime\|SubtitleTrackSchema\|SubtitleCueSchema" -- src tests
git grep -n "buildProductPreviewCues\|caption=" -- src tests
git grep -n "subtitleStyleId\|SubtitleStyleSchema\|STAGE_CAPTION_SAFE_AREA" -- src tests
```

## Timing contract

```bash
git grep -n "startMs\|endMs" -- src/domain src/renderer tests | grep -Ei "dialogue|subtitle"
git grep -n "updateProject\|ProjectCommand\|History" -- src/renderer/stores tests | head -n 200
```

## 范围反查

```bash
git diff --name-only main...HEAD
git diff main...HEAD -- src/renderer/features/actions src/domain/actions src/domain/models/timeline-event.ts
```

第二条默认应为空；若出现 ActionPreset/TimelineEvent 生产语义改动，触发范围审查。

## TS / JS 质量闸门

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

## 真人验收

```bash
pnpm dev
```

Windows 测试数据继续优先使用：

```text
D:\PandaStage-Acceptance\
```

大文件不得无说明堆到 C 盘；若不可避免，Day28 receipt 写路径/用途/体积。

---

# 最终 DoD

- [ ] Day26 receipt=PASS 且代码已 merge
- [ ] Day27 receipt=PASS 且代码已 merge
- [ ] Day28 开工真实 HEAD 已记录
- [ ] Day26 实际 Timeline/playhead/time geometry owner 已锁定
- [ ] Day27 实际 Dialogue mutation/selection owner 已锁定
- [ ] subtitle/time blast radius 已完整搜索并记录
- [ ] Untimed `startMs=endMs` Dialogue 保持合法且产品可找到
- [ ] Timed `endMs>startMs` Dialogue 在 Timeline 有真实 clip
- [ ] move 复用 Day26 geometry/snapping
- [ ] resize-start / resize-end 复用 Day26 geometry/snapping
- [ ] 超边界 clamp
- [ ] Timed overlap 拒绝
- [ ] adjacency `A.end===B.start` 允许
- [ ] 时间语义为 half-open `[start,end)`
- [ ] drag preview 不写 Project、不 dirty、不刷 History
- [ ] 一次 gesture 仅 1 个 History command
- [ ] Undo/Redo 时间同步
- [ ] editor Canvas currentTimeMs 显示正确字幕
- [ ] exact endMs 不残留上一句字幕
- [ ] 切 Shot 清上一镜头字幕
- [ ] Product Preview 同一 timing 语义
- [ ] caption presentation owner 单一
- [ ] caption overlay `listening=false`
- [ ] 字幕可见时 layer/background/Transformer hit-test 无回归
- [ ] 不做 Subtitle theme editor
- [ ] 不做 ActionPreset / TimelineEvent editor / waveform / TTS / auto-duration / ripple edit
- [ ] `pnpm typecheck` PASS
- [ ] `pnpm lint` PASS 或 warning 诚实声明
- [ ] `pnpm test:unit` PASS
- [ ] `pnpm test:integration` PASS
- [ ] `pnpm build` PASS
- [ ] `git diff --check` PASS
- [ ] Windows Electron：3 条对白首尾相接 PASS
- [ ] Windows Electron：move/resize + Canvas 同步 PASS
- [ ] Windows Electron：overlap rejection PASS
- [ ] Windows Electron：shot-end clamp PASS
- [ ] Windows Electron：Undo/Redo PASS
- [ ] Windows Electron：save→close→reopen PASS
- [ ] Windows Electron：switch shot clears subtitle PASS
- [ ] Windows Electron：subtitle-visible hit-test PASS
- [ ] 16 项刀刃表完成
- [ ] P4 完成
- [ ] `docs/test-receipts/DAY-28.md` 完整
- [ ] debt 透明记录
- [ ] Day28 结论 PASS 后才允许提出 Day29
