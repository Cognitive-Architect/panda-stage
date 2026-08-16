# Panda Stage Agent Task — Day 28

> **源工单编号**：R-28/45  
> **执行工单编号**：B-28/45  
> **标题**：Dialogue Timing + Subtitle Track  
> **角色**：Engineer  
> **模板**：ID-59 v3.0 通用增强版  
> **路线状态**：Day 26～45 Rebaseline v1  
> **原始编写审计基线（历史）**：`main@f126249aefb7f5379db5cbf2a48a49e62c30307e`  
> **派单前校准输入基线（2026-08-16）**：`main@7357552c4cd82ad622b13d0eab083c673903863a`；该提交为 Day 27 maintainer acceptance receipt 收卷，Day 27 产品 merge commit 为 `6092109c2c73dc8e056a41bd94fbfc1dfa87d31a`  
> **执行基线**：Day 26 / Day 27 已满足 PASS + merged；执行 Agent 开工时仍必须重新记录当时最新稳定 `main` 的分支与 HEAD，禁止把上述校准输入基线当成未来固定 HEAD  
> **核心范围声明**：本日只把 Day 27 已能正式录入的 Dialogue 安排到时间轴上，并让编辑器 Canvas / 既有 Product Preview 按当前时间显示对应字幕；不做 TimelineEvent 通用编辑器、动作组合、ActionPreset、波形、TTS、自动字幕或主题设计器。

---

# 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Day 28 — Dialogue Timing + Subtitle Track
- **轰炸目标**：复用 Day 26 已合入的唯一 Timeline/time geometry、Day 27 已合入的唯一 Dialogue authoring/selection owner，以及仓库现有 subtitle engine，把 Dialogue 从“已录入但可能未定时”推进到“可移动、可调时长、可在当前时间显示字幕”的真实产品路径。
- **任务性质**：功能开发 + 交互状态管理 + History 集成 + 现有字幕管线收敛 + 真人验收
- **输入基线**：完整读取本工单【模块2】；已确认 owner 作为开工事实，执行 Agent 只需在最新 `main` 上验证其未漂移，不得重新发明平行 owner。
- **输出要求**：可执行 Dialogue timing + 可复现自动化验证 + 真实 Windows Electron 验收 + 显式债务声明 + `docs/test-receipts/DAY-28.md` 结构化收卷。
- **用户可见结果**：用户在时间轴看到对白块，拖动播放头时能清楚知道当前字幕；对白块能移动、调起点/终点，越界会被 clamp，重叠会被明确拒绝；一次拖拽只产生一次可 Undo/Redo 的正式修改。

## 通用铁律

1. **数据诚实**：测试数、warning 数、HEAD、PASS/FAIL/PENDING、真人步骤必须来自真实命令或真实操作。
2. **零占位符**：禁止 fake Dialogue、fake subtitle、假播放头、临时 JSON 注入、硬编码“拖动成功”。
3. **自动化优先**：时间映射、重叠判定、clamp、History、项目/镜头身份、边界语义必须优先用自动化证明；真人 Electron 仍是最终 Gate。
4. **最小必要复杂度**：不建设通用轨道系统、ripple edit、keyframe editor、字幕主题系统、动作冲突引擎。
5. **债务透明化**：测试基础设施、历史重叠数据、字幕样式未激活字段、长文本 cue 截断等必须显式写 `DEBT-*`。
6. **唯一 owner**：Timeline/time geometry 复用 Day 26；Dialogue mutation/selection 复用 Day 27；subtitle timing 复用现有 shared subtitle engine；禁止第二套时钟/字幕 evaluator。
7. **身份安全**：任何 drag/resize preview 必须至少绑定 `projectRoot + shotId + dialogueId`；切项目/镜头/删除 Dialogue 时必须失效。
8. **真人安全门优先**：自动化全绿但真实 Electron 拖动/字幕/Undo/Redo/save-reopen 任一主路径 FAIL，则 Day 28 = FAIL。
9. **Issue #220 布局合同不得回归**：新增 Dialogue Track 只能在现有 BottomWorkspace/Timeline 内部布局合同上生长；不得再次把底部控件挤出窗口。
10. **状态诚实**：自动化/结构性全绿但 maintainer 真人验收尚未签字时，`automated/structural = PASS`，但 `overall = PENDING`；只有真人 Gate 通过后才可 `overall = PASS`。

---

# 【模块2】输入基线（完整技术背景，零占位符）

## 2.1 Git 与硬前置依赖

| 输入项 | 当前已确认事实 | 开工验证命令 / 证据 | 状态 |
|---|---|---|---|
| 派单前校准输入坐标 | `main@7357552c4cd82ad622b13d0eab083c673903863a`；此提交是 Day27 maintainer acceptance receipt 收卷 | `git log --oneline -n 10` | 已确认 |
| Day 28 执行坐标 | 执行 Agent 开工时重新读取最新稳定 `main`；不得假设仍等于校准输入坐标 | `git branch --show-current`；`git rev-parse HEAD`；`git log --oneline -n 10` | 开工必须重录 |
| Day 26 依赖 | PR #200 已 merged；merge SHA=`e4eeb551721864b0c2f3e2596d35d3d1dc2de323`；Timeline/time owner 已合入 | `cat docs/test-receipts/DAY-26.md`；`git merge-base --is-ancestor e4eeb551 HEAD` | **PASS + merged** |
| Day 27 依赖 | PR #216 已 merged；final head=`688a56357443558bdf2a75ac360f38a13de73828`；merge SHA=`6092109c2c73dc8e056a41bd94fbfc1dfa87d31a`；最终 receipt commit=`7357552c...` | `cat docs/test-receipts/DAY-27.md`；`git merge-base --is-ancestor 6092109c HEAD` | **PASS + merged** |
| Day27 布局 blocker | Issue #220 已 completed/closed；修复已在 PR #216 final head 中，新增 `tests/contract/issue220-dialogue-layout.test.ts` 锁定内部滚动/不裁切合同 | `git log --oneline --all --grep='issue-220'`；读取 contract test | **硬回归门** |
| 禁止继承线 | Stage 3-B / ActionPreset / PR #177 不属于当前核心路线 | `git diff main...HEAD --name-only`；`git log --oneline main..HEAD` | 硬边界 |

### Day 26 / Day 27 当前唯一 owner（派单前已锁定）

**Day 26 Timeline / time owner：**

- Timeline 产品根：`src/renderer/features/timeline/TimelineDock.tsx`
- editor playhead / UI-only time：`src/renderer/features/timeline/timelineUiStore.ts` → `timelineUiStore.getSnapshot().currentTimeMs`
- 时间几何：`src/renderer/features/timeline/timeGeometry.ts`
- 实际函数：`computePixelsPerMs()`、`timeToPx()`、`pxToTime()`、`snapToFrame()`、`clampTime()`、`frameDurationMs()`
- FPS：`PROJECT_FPS = 24`

**Day 27 Dialogue owner：**

- domain mutation：`src/domain/services/DialogueService.ts`
- renderer commit bridge：`src/renderer/stores/dialogueStore.ts`
- Dialogue selection：`src/renderer/stores/dialogueSelectionStore.ts`
- authoring UI：`src/renderer/features/dialogue/DialogueSheet.tsx`
- 唯一 Timeline 容器仍是 `TimelineDock.tsx`

> 开工可以重新 `git grep` 验证上述 owner 没漂移，但**不得把“重新搜索”理解成“重新设计 owner”**。

### Day 26 receipt 历史状态备注

`docs/test-receipts/DAY-26.md` 内保留了部分收卷当时的“PR #200 Draft/Open”历史快照；这不代表当前 GitHub 状态。当前事实以 PR #200 已 merged、merge SHA `e4eeb551...` 为准。执行 Agent 不得因历史快照误判 Day26 未合入。

### Day 28 开工阻塞规则

满足任一条，**不得进入实现**：

1. 最新 `main` 不包含 Day26 merge `e4eeb551...`。
2. 最新 `main` 不包含 Day27 merge `6092109c...`。
3. 上述 Timeline/playhead/time geometry owner 在最新 main 已发生实质漂移，但原因与替代 owner 未记录。
4. 上述 Dialogue mutation/selection owner 在最新 main 已发生实质漂移，但原因与替代 owner 未记录。
5. 为实现字幕时间编辑被迫复活 ActionPreset、通用 TimelineEvent 编辑器或 PR #177。
6. 新 Dialogue Track 无法在 Issue #220 的 BottomWorkspace 内部滚动合同中成立，必须重新扩大/改写底部根布局才可工作。

> 人话版：Day28 现在不是“桌子有没有”问题了，桌子和对白本都交付了。开工先确认桌子还在原地，然后就在这张桌子上排班，别突然又去木工房造第二张。🤣

## 2.2 当前正式 Dialogue 时间语义：Day 27 与 Day 28 的衔接合同

**文件**：`src/domain/models/dialogue.ts`

当前正式 Dialogue 已存在：

- `startMs`
- `endMs`
- `text`
- speaker / voice / subtitle 等正式引用字段。

当前 schema 允许 `endMs >= startMs`。Day 27 的正式 authoring 已把新 Dialogue 写为：

```text
startMs = endMs = clamp(currentTimeMs, 0, shot.durationMs)
```

因此 Day 28 **禁止**为了字幕显示简单把整个 ProjectSchema 改成 `endMs > startMs`。

### Day 28 正式时间状态

1. **Untimed / 未定时**：`endMs === startMs`
   - 是合法 Project 数据；
   - 可以保存、重开、Undo/Redo；
   - 不产生可见字幕窗口；
   - Timeline 必须能让用户找到并安排它，不得静默丢失。
2. **Timed / 已定时**：`endMs > startMs`
   - 在 Timeline 显示为有宽度的 Dialogue clip；
   - 参与新 authoring 的 overlap 检查；
   - 在 `[startMs, endMs)` 内显示字幕。

### Day 28 schemaVersion 合同

- `startMs/endMs` 已是现有 persisted 字段；
- 当前正式 schemaVersion=6；
- Day 28 默认**不新增 Project persisted 字段，不因 timing UI 自动 bump schemaVersion**；
- 若实现确实要求 persisted shape 变化，先触发 `SCHEMA-001`，不得“顺手升版本”。

## 2.3 现有 shared subtitle engine：必须复用，不得重写

**文件**：`src/shared/preview/subtitle-engine.ts`

已确认：

```text
SubtitleCue:
- id
- startMs integer >= 0
- endMs integer > 0
- text: trim + 1..500 chars
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

> **新 authoring 产生的 Timed Dialogue 不允许重叠。**

1. 两条 Timed Dialogue 若满足区间重叠 → timing commit 被拒绝。
2. 首尾相接合法：A `[0,1000)`，B `[1000,2000)` 不重叠。
3. Untimed Dialogue（零时长）不参与 visible overlap 判定。
4. 禁止自动 ripple、自动推开其他 clip、自动改别人时间。
5. 拒绝时 UI 给出可读错误，保留当前已提交 Project 不变。
6. 不引入通用“事件冲突引擎”。

### Legacy overlap 重要边界

`SubtitleTrackSchema` 的“不重叠”是 subtitle track contract，**不能被偷换成“所有历史 ProjectSchema 从此全局拒绝 overlap”**。

- 新的 move/resize/安排 commit：必须在 Dialogue timing mutation 路径中拒绝 overlap。
- 历史项目：Day28 不负责清洗所有 legacy overlap。
- **禁止**为了省事，把当前 shot 所有历史 Dialogue projection 直接交给 `SubtitleTrackSchema.parse()`，从而让历史项目仅因既有 overlap 无法打开/预览/编辑。
- 如果实际发现历史 overlap，记录 `DEBT-LEGACY-OVERLAP-B28`、真实读取/显示行为与后续清偿点。

> 人话版：新来的不许抢麦，但不能因为仓库里十年前有人抢过麦，就把整家 KTV 门焊死。🤣

## 2.4 现有 Product Preview 已经会从 Dialogue 显示字幕

**文件**：`src/renderer/shell/productPreviewModel.ts`（`buildProductPreviewCues()`）

当前真实逻辑：

- 从 `shot.dialogues` 生成 `SubtitleCue[]`；
- 过滤 `endMs <= startMs`；
- `text.trim().slice(0, 500)`；
- 过滤空文本；
- 按 `startMs` 排序。

**注意长度合同：**

- Project `NonEmptyTextSchema` 允许 Dialogue 文本最多 10,000 字符；
- `SubtitleCueSchema` 最大 500 字符；
- 现有 Product Preview 已选择“字幕 projection 最多 500 字符”。

Day 28 必须**保留这条既有产品行为**：不要为了 editor Canvas 字幕把 `SubtitleCueSchema` 扩到 10,000，也不要让 editor 与 preview 一个截断、一个不截断。若需要共享 helper，应把“trim + max 500”收敛成单一 projection owner。

**文件**：`src/renderer/shell/ProductPreviewOverlay.tsx`

已确认：

- Preview 有自己的本地 `timeMs`；
- 调 `evaluateShotAtTime(...)` 得当前渲染快照；
- 调 `evaluateSubtitleAtTime(cues, evaluatedShot.timeMs)` 找字幕；
- 将 `caption` 交给共享 `CanvasStage / StageRenderer`；
- Preview 状态是 read-only / transient，不写 Project / History / dirty。

### Day 28 关键约束

1. **不得新写第二个字幕时间判断**；editor 必须复用 shared evaluator/projection。
2. Product Preview 的本地播放时钟继续 Preview-local；**不能拿它当 editor playhead store**。
3. editor `currentTimeMs` 与 Preview `timeMs` 是两个不同身份的时钟，只共享时间语义，不共享 mutable clock state。
4. Day 28 必须给 Product Preview 补回归：调整 Dialogue timing 后重新预览，字幕出现/消失时间与编辑器一致。
5. Dialogue→SubtitleCue 的 500 字符 projection 上限在 editor/preview 一致。

## 2.5 当前编辑器 Canvas：静态编辑画布，不是动作播放器

**文件**：`src/renderer/features/canvas/CanvasStage.tsx`

已确认当前 editor Canvas：

- 读取 `editorProjectStore / shotStore / selectionStore`；
- 使用 `buildEditorStageRenderModel(snapshot.project, shot)`；
- 直接按当前 `shot.layers` 绘制可选择/可拖拽 Konva 图层；
- 当前没有正式 editor `currentTimeMs` 输入；
- 当前没有 Dialogue 字幕 overlay；
- Transformer 使用单独 Konva layer。

### Day 28 Canvas 合同

Day 28 **只给 editor Canvas 增加“当前时间字幕显示”能力**：

- 读取 `timelineUiStore` 的 editor `currentTimeMs`；
- 读取当前 shot 的已定时 Dialogue；
- 通过共享 subtitle evaluator 得到当前字幕；
- 在 editor Canvas 上绘制**纯视觉、`listening=false` 的字幕层**。

禁止：

- 为了字幕把整个 editor Canvas 改成 `evaluateShotAtTime` 驱动；
- 顺手让 TimelineEvent / ActionPreset 动起来；
- 改写图层选择/拖拽 authority；
- 把字幕层放进 Konva hit-test authority。

### Konva 安全约束

字幕 overlay 必须：

1. `listening=false`；
2. 不生成可点击 hit target；
3. 不改变普通图层/background 的 pointer 命中；
4. 不遮断 Transformer 交互；
5. 视觉层次可在内容上方，但 interaction authority 仍归现有图层/Transformer。

必须补回归：字幕可见时，点击字幕覆盖区域下方的普通图层仍选中正确 layer。

## 2.6 现有共享 StageRenderer：字幕视觉已有正式 owner

**文件**：`src/renderer/stage/StageRenderer.tsx`

已确认：

- `caption: string | null` 是正式输入；
- 字幕通过 `Rect + Text` 绘制；
- 使用 `STAGE_CAPTION_SAFE_AREA`；
- Preview Stage `listening=false`。

**文件**：`src/shared/stage/layout.ts`

当前唯一 caption safe area：

```text
x=250
y=890
width=1420
height=132
horizontalPadding=40
verticalPadding=20
```

**文件**：`src/domain/models/subtitle.ts`

Project 中还有正式 `SubtitleStyleSchema`：`fontFamily/fontSize/textColor/backgroundColor/position/align/maxWidth`。

### Day 28 样式范围决策

1. 不新增第二个 SubtitleStyle schema。
2. 不新增字幕样式编辑 UI。
3. Editor Canvas 字幕视觉复用/抽取现有 `StageRenderer + STAGE_CAPTION_SAFE_AREA` presentation owner；禁止另写一套不同常量。
4. 现有 StageRenderer 尚未消费全部 SubtitleStyle 字段时，Day 28 不强制做完整主题实现；写 `DEBT-SUBTITLE-STYLE-B28`。
5. 可抽小型 shared caption presentation helper/component；禁止扩展成 theme engine。

## 2.7 Day 26 time geometry / snapping：真实 owner 已锁定

### 正式 owner

```text
src/renderer/features/timeline/timeGeometry.ts
- frameDurationMs()
- snapToFrame()
- clampTime()
- computePixelsPerMs()
- timeToPx()
- pxToTime()

src/renderer/features/timeline/timelineUiStore.ts
- currentTimeMs
- seek()
- zoom / scrollPx / expanded
```

### Renderer / Domain 职责边界（必须遵守）

- **Renderer/UI**：pointer x ↔ time、pixelsPerMs、scroll offset、frame snap、drag preview。
- **Domain/Dialogue mutation**：接收最终整数毫秒，验证 shot/dialogue 身份、正跨度、边界、overlap，并产生纯 `Project → Project` 结果。
- `DialogueService` **不得 import renderer/timeGeometry/timelineUiStore**。
- `dialogueStore` 负责把 renderer 已解析好的正式 timing mutation 送入 `EditorProjectStore.updateProject(...)`，一次 gesture 一次 History command。

> 也就是说：尺子在厨房外面量菜，领域层只收“切成 42mm”这种最终订单；不能把整把尺子塞进锅里煮。🤣

### Timing mutation 统一规则

所有 Dialogue 时间最终写回必须是**整数毫秒**。

#### Move 整块

- 保持 `duration = endMs - startMs` 不变；
- UI 使用 Day26 `pxToTime + snapToFrame` 得候选；
- 整体 clamp 到 `[0, shot.durationMs]`；
- 不越左边界、不越镜头尾；
- 若与其他 Timed Dialogue overlap → commit 拒绝，不自动挤别人。

#### Resize start

- start clamp 到 `[0, endMs)`；
- snap 后必须 `startMs < endMs`；
- overlap → commit 拒绝。

#### Resize end

- end clamp 到 `(startMs, shot.durationMs]`；
- snap 后必须 `endMs > startMs`；
- overlap → commit 拒绝。

#### Untimed → Timed：默认正跨度正式锁定

Day27 允许 Untimed Dialogue 恰好创建在 `shot.durationMs`，所以 Day28 必须定义镜头尾行为，不能留给实现“临场发挥”。

- 默认正跨度取 **Day26 的 1 个 frame quantum**，由 `frameDurationMs()/snapToFrame()` 推导，**禁止硬编码“2 秒”**。
- 最终 persisted 值必须是整数毫秒。
- 若 point-time/当前 playhead 后方容得下 1 frame：从该点向右安排 1 frame。
- 若 Dialogue 位于/贴近镜头尾、向右不足 1 frame：**固定 `endMs = shot.durationMs`，向左回填 1 frame quantum**，保证正跨度且不越界。
- 然后再执行 overlap validation；不能为了成功安排而自动推开别的 Dialogue。
- 在 receipt 记录 `DECISION-B28-DEFAULT-DURATION` 的真实推导值/边界行为。

## 2.8 Drag / Resize transient state 与 History 合同

现有 `EditorProjectStore.updateProject(...)` / `ProjectCommand` / `HistoryStore` 是正式 mutation 账本。

### 拖拽过程中

- pointermove 只更新 UI-local preview；
- **不写 Project**；
- **不 dirty**；
- **不 increment revision**；
- **不生成连续 History command**。

### pointerup / 明确提交时

- Renderer 计算 snap + clamp 候选；
- Dialogue timing mutation 层做正式合法性 + overlap validation；
- 合法 → 一次正式 Project mutation；
- 一次 gesture = **1 个 History command**；
- dirty=true；
- Undo/Redo 各一次恢复整个 gesture 前/后状态。

### 取消 / 身份切换

Escape/cancel、切 Project、切 Shot、Dialogue 删除、selection 不再指向该 Dialogue → 丢弃 transient preview。

transient state 至少绑定：

```text
projectRoot + shotId + dialogueId
```

若沿用 Day27 selection context 的 `projectId`，可一并绑定；禁止只靠“当前 selectedDialogueId”。

## 2.9 Day 27 Dialogue selection：Timeline clip 必须复用

正式 owner：`src/renderer/stores/dialogueSelectionStore.ts`。

1. 点击 Dialogue clip → `dialogueSelectionStore.select(dialogueId)`。
2. RightInspector 继续显示 Day27 DialogueInspector；Day28 不复制 Inspector。
3. 切回 Canvas layer/background → Dialogue selection 按 Day27 互斥规则失效。
4. 删除 selected Dialogue → clip/selection/drag preview 同时失效。
5. 切 Shot/Project → selection 清理。
6. **禁止**另建 `timelineSelectionStore` 专门选 Dialogue。

## 2.10 Dialogue Track 的最小产品形态 + Issue #220 布局/指针合同

### 必须有

- 当前 shot 的 Dialogue lane / row；
- Timed Dialogue block：speaker 名 + 台词摘要；
- selected / dragging / invalid-overlap 状态可区分；
- 左右 resize handle + move body；
- Untimed Dialogue 有明确入口/区域可安排，不能因零宽度消失。

### Timeline 横向几何唯一性

Dialogue Track **必须与 ruler 共用同一套横向时间几何**：

- 相同 `pixelsPerMs`；
- 相同 zoom；
- 相同 scroll offset / 可视时间窗口；
- 相同 `timeToPx/pxToTime/snapToFrame` owner。

实现可以在 DOM 上用 sibling/overlay/lane 组织，但禁止出现“ruler 滚了，clip 没滚”或“两边各算一套 pixelsPerMs”。

### Pointer 事件硬合同

当前 Day26 ruler track 的 `onPointerDown` 会直接 seek playhead。Day28 新增 clip/handle 后必须证明：

- 点击/拖动 Dialogue clip **不会冒泡成 ruler seek**；
- resize handle **不会顺便移动 playhead**；
- clip selection / move / resize 与 ruler seek 权限边界明确；
- 只有用户明确操作 ruler/playhead 时才 seek editor time。

需要 focused regression，至少证明“拖 clip 后 Dialogue time 变化，但 `currentTimeMs` 没被同一 pointer gesture 意外改写”。

### Issue #220 布局硬合同

PR #216 final head 已把：

- `.timeline-dock` 设为内部纵向滚动容器；
- Timeline header sticky；
- ruler / History controls 不收缩；
- Dialogue authoring 作为内部可滚动内容；
- BottomWorkspace 外层边界维持固定合同。

Day28 新 Dialogue Track **不得**：

- 重新把 bottom controls 挤出 Electron 窗口；
- 用扩大 `.bottom-workspace` 最大高度掩盖问题；
- 引入第二个 page-level vertical scroll；
- 破坏 wide / narrow / wide resize 后的可达性。

必须扩展/复用 `tests/contract/issue220-dialogue-layout.test.ts`，并在真人 Windows Electron 复验宽/窄布局。

### 推荐 stable selectors

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

## 2.11 字幕当前项解析：单一时间语义 + 单一文本 projection

Day 28 需要 editor Canvas 与 Product Preview 对同一 shot/time 得到相同字幕。

推荐：

- 复用 `SubtitleCue` / `evaluateSubtitleAtTime`；
- 将“Dialogue → SubtitleCue” projection 从现有 `buildProductPreviewCues()` 收敛为单一 shared helper；
- Product Preview 与 editor Canvas 同时消费该 helper。

可以移动/提取 `buildProductPreviewCues()`，但必须保持：

1. Untimed Dialogue 不变成可见 cue；
2. Timed Dialogue 保留原 `id/startMs/endMs`；
3. text 与当前 Product Preview 一致：`trim` 后最多 **500 字符**；
4. 时间是整数毫秒；
5. 排序稳定；
6. 左闭右开；
7. 不出现 editor 一套 evaluator、preview 一套 evaluator。

**不要**为了“共享”创建带 store / React / Project mutation 的超级 SubtitleManager。

### Shared helper 放置边界

优先放在 `src/shared/preview/` 或现有 shared subtitle 相关位置，例如：

```text
src/shared/preview/dialogue-subtitle.ts
```

可以从 shared helper 读取 domain 类型；**不要**为了共享 subtitle projection 让 domain service 反向 import renderer/shared preview UI 逻辑。

## 2.12 Legacy overlap 与 ProjectSchema 边界

Day 28 默认：

- **新 authoring timing commit 禁止 overlap**；
- ProjectSchema 不因本日 UI 需求全局拒绝历史 overlap；
- shared projection 不用 `SubtitleTrackSchema.parse()` 把 legacy overlap 变成“项目打不开”；
- 开工搜索 fixtures/tests 是否存在 overlap；
- 若存在，记录 `DEBT-LEGACY-OVERLAP-B28` 与实际行为。

若必须把 overlap 升格为 persisted schema invariant → `SCHEMA-001`，先停下说明兼容影响。

## 2.13 默认变更范围

### 已锁定 owner，可按需修改

- `src/renderer/features/timeline/TimelineDock.tsx`
- `src/renderer/features/timeline/timeGeometry.ts`（优先复用，不鼓励改合同）
- `src/renderer/features/timeline/timelineUiStore.ts`（不得引入 persisted time）
- `src/domain/services/DialogueService.ts`
- `src/renderer/stores/dialogueStore.ts`
- `src/renderer/stores/dialogueSelectionStore.ts`
- `src/renderer/features/dialogue/DialogueSheet.tsx`
- 唯一 RightInspector 相关文件（仅 timing selection 联动所需小改）

### 字幕/舞台 owner

1. `src/shared/preview/subtitle-engine.ts`
2. `src/renderer/shell/productPreviewModel.ts`
3. `src/renderer/shell/ProductPreviewOverlay.tsx`
4. `src/renderer/stage/StageRenderer.tsx`
5. `src/shared/stage/layout.ts`
6. `src/renderer/features/canvas/CanvasStage.tsx`
7. `src/renderer/styles.css`

### 允许新增最小聚焦 helper/component

- `src/shared/preview/dialogue-subtitle.ts` 或同等 shared projection helper；
- `src/renderer/features/timeline/DialogueTrack.tsx` / `DialogueClip.tsx`；
- 小型 shared caption presentation helper/component。

### 测试

优先扩展：

- `tests/unit/subtitle-engine.test.ts`
- `tests/unit/product-preview-overlay.test.ts`
- Day26 timeline geometry/playhead tests
- Day27 dialogue service/store/selection tests
- canvas interaction/hit-test tests
- **`tests/contract/issue220-dialogue-layout.test.ts`**

可新增：

- `tests/unit/dialogue-timing.test.ts`
- `tests/unit/dialogue-track-geometry.test.ts`
- `tests/unit/dialogue-timing-history.test.ts`
- focused pointer-propagation / ruler-seek regression。

### 明确禁止

- 修改 TimelineEvent / ActionPreset 生产语义
- settled-state / evaluator 动作组合
- waveform editor / audio waveform decode
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
git grep -n "currentTimeMs\|playhead\|timeToPx\|pxToTime\|snapToFrame\|computePixelsPerMs" -- src/renderer tests
git grep -n "DialogueService\|dialogueStore\|dialogueSelectionStore" -- src tests
git grep -n "issue220-dialogue-layout\|timeline-dock\|timeline-ruler-scroll" -- tests src/renderer/styles.css
```

回执必须列出真实 consumer，尤其检查：Product Preview、editor Canvas、export/hidden renderer（若命中）、Dialogue duplicate/save/migration、Day26/27 tests、Issue #220 layout contract。

## 2.15 目标结果

Day 28 完成时必须同时成立：

1. Day26 Timeline/time geometry/playhead owner 保持唯一。
2. Day27 Dialogue authoring/mutation/selection owner 保持唯一。
3. Untimed Dialogue 合法且可找到。
4. Timed Dialogue clip 可选择、move、resize start/end。
5. 一次 gesture = 1 个 History command。
6. 超出 shot 边界 clamp。
7. Timed overlap 拒绝；adjacency 合法。
8. editor Canvas 在 `[start,end)` 显示正确字幕；exact `endMs` 立即切换/消失。
9. 字幕 layer 不影响 layer/background/Transformer hit-test。
10. 切 Shot 不显示上一 Shot 字幕。
11. Product Preview 使用同一 projection/evaluator 与 500 字符文本合同。
12. Save→Close→Reopen 后 Dialogue start/end 一致。
13. Undo/Redo 同步 Timeline + Canvas 字幕。
14. Dialogue Track 与 ruler 共享 pixelsPerMs/scroll/time geometry。
15. clip/resize gesture 不意外 seek playhead。
16. Issue #220 wide/narrow/internal-scroll 布局不回归。
17. 不触碰 ActionPreset / generic TimelineEvent / waveform / TTS。

## 2.16 当前测试工具链事实

```text
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
git diff --check
```

仓库没有确认必须使用的独立 Playwright/component framework。

- 有现成测试设施 → 用；
- 没有 → pure geometry/service/store/contract/integration + 真人 Electron；
- 不存在的工具写 `N/A + 原因 + 替代证据`；
- 禁止只为 Day28 临时安装整套测试框架，除非触发 `TEST-001`。

开工 baseline：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

**UNVERIFIED AT TASK AUTHORING**：执行 Agent 必须跑真实命令，不得把历史绿灯当本轮绿灯。

## 2.17 文档同步 + 状态模型

必须新建/更新：`docs/test-receipts/DAY-28.md`。

至少记录：

- Day26 receipt / merge SHA
- Day27 receipt / merge SHA
- Day28 开工 HEAD / 收卷 HEAD
- Timeline/playhead/time geometry owner
- Dialogue mutation/selection owner
- subtitle evaluator/projection owner
- overlap policy
- 500-char cue projection policy
- Untimed/Timed/default-duration contract
- ruler/clip shared scroll geometry
- pointer gesture 与 ruler seek 隔离证据
- Issue #220 layout regression
- drag preview / History contract
- Canvas hit-test regression
- Product Preview regression
- 自动化真实输出
- Windows Electron 真人验收
- debt
- 下一步唯一动作

### Day28 状态只能按以下三态记录

```text
automated/structural = PASS | FAIL
overall = PENDING | PASS | FAIL
```

- 自动化/结构全绿，但真人 Windows Electron 尚未签字 → `automated/structural=PASS` + `overall=PENDING`。
- 真人 Gate 通过 → `overall=PASS`。
- 任一关键自动化或真人主路径失败 → `overall=FAIL`。
- **PENDING 不是 FAIL，也不是“偷偷 PASS”**；PENDING 时不得开始 Day29。

## 2.18 历史债务 / 高风险回归点

1. Stage 3-B 已证明 transient draft + mutable target identity 会串对象；drag preview 必须绑定身份。
2. Konva 有 visible scene 与 hit authority 风险；字幕 overlay 必须 `listening=false`。
3. Product Preview 有本地 playback time；不得和 editor playhead 合并。
4. Day27 有合法 Untimed Dialogue；不得反向破坏 schema。
5. shared subtitle engine 已有 half-open/no-overlap 语义；不要另造相反 evaluator。
6. **Issue #220 刚修过底部裁切**；Day28 往 Timeline 塞新 lane 是高风险回归点。
7. Day26 ruler `pointerdown` 会 seek；Dialogue clip pointer 必须隔离，防“拖字幕顺便拖播放头”。
8. Dialogue 文本最大 10,000，而 SubtitleCue 最大 500；projection 必须保持现有 500 行为一致。
9. CI 绿不能替代真实 Windows Electron drag/resize/hit-test/save-reopen/layout。

## 2.19 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | Day26 owner 已锁定为 `TimelineDock/timeGeometry/timelineUiStore`；Day27 owner 已锁定为 `DialogueService/dialogueStore/dialogueSelectionStore`；Issue #220 layout fix 已合入；shared subtitle engine reject overlap + half-open；Product Preview 已消费 Dialogue 字幕；editor Canvas 目前静态且无字幕 |
| 待确认问题 | 1）新增 Dialogue lane 最适合嵌在 ruler scroll 内还是同 scroll owner 的 sibling；2）subtitle projection 是否还有 export/hidden consumer；3）现有测试设施能否自动驱动 pointer capture/propagation |
| 预期输出 | 不新造第二时钟/第二 evaluator、不破坏 #220、不触碰 ActionPreset，完成 Dialogue timing + editor subtitle track 主路径 |
| 停止条件 | owner 无漂移；blast radius 已列全；shared scroll/pointer/no-overlap/Untimed contract 可在现有架构成立 |

---

# 【模块3】工单矩阵（通用高压版）

## B-28/45｜Engineer｜Dialogue Timing + Subtitle Track

### 3.1 基础信息

- **工单编号**：B-28/45
- **角色**：Engineer
- **目标**：给正式 Dialogue 增加可操作的时间区间，并让 Timeline、Editor Canvas、Product Preview 对同一时间合同达成一致。
- **依赖关系**：Day26 PASS+merge 与 Day27 PASS+merge 已满足；不依赖 ActionPreset/Stage3-B。
- **当前校准输入 main**：`7357552c...`；真正开工 HEAD 另录。

### 3.2 输出交付物

#### 核心时间交付

- Untimed/Timed 合同落地。
- overlap authoring 禁止，half-open adjacency 合法。
- move/resize 复用 Day26 `pxToTime/timeToPx/snapToFrame/computePixelsPerMs`。
- Untimed 默认 1-frame 正跨度；shot-end 向左回填。
- drag preview transient；pointerup 一次 History commit。

#### 核心 UI 交付

- Day26 Timeline 中的 Dialogue track/clips。
- Timed clip body move + 左右 handle。
- Untimed Dialogue 可明确安排。
- 点击 clip 复用 Day27 Dialogue selection。
- Dialogue lane 与 ruler 共用横向 scroll/time geometry。
- clip/handle pointer 不冒泡触发 ruler seek。
- Issue #220 内部滚动/底部控件可达性保持。

#### 字幕交付

- editor Canvas 根据 current shot + editor `currentTimeMs` 显示当前 Dialogue 字幕。
- caption overlay `listening=false`。
- Product Preview + editor 共用 subtitle projection/evaluator。
- text projection 与现有 Preview 一致：trim + max 500。
- 不引入第二套字幕视觉 owner。

#### 必须包含

- half-open boundary；
- adjacency allowed / overlap rejected；
- clamp left/right；
- untimed preserved + shot-end arrangement；
- one gesture = one History command；
- project/shot/dialogue identity cancellation；
- clip gesture does not seek playhead；
- ruler/clip shared scroll geometry；
- Canvas subtitle appear/disappear；
- subtitle-visible hit-test；
- Product Preview timing + 500-char projection regression；
- Issue #220 layout regression；
- Save/Reopen + Undo/Redo 真人验收。

#### 禁止包含

- generic track registry
- TimelineEvent authoring
- ActionPreset
- settled-state/evaluator work
- waveform
- TTS
- auto-duration by text/audio estimation
- ripple edit
- fake clock/subtitle
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
git grep -n "currentTimeMs\|playhead\|timeToPx\|pxToTime\|snapToFrame\|computePixelsPerMs" -- src/renderer tests
git grep -n "issue220-dialogue-layout\|timeline-dock\|timeline-ruler-scroll" -- tests src/renderer/styles.css
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

真实 Windows Electron：

- 3 条首尾相接 Dialogue；
- 安排一条位于 shot end 的 Untimed Dialogue；
- move/resize 后 Timeline + Canvas 同步；
- overlap 拒绝；
- clip 拖到镜头尾 clamp；
- clip drag/resize 不意外 seek playhead；
- zoom/横滚后 ruler 与 clips 对齐；
- Undo/Redo；
- save/reopen；
- 切 shot 清字幕；
- 字幕覆盖区域正确 click-through；
- wide / narrow / wide 下底部 controls 仍可达。

### 3.3 规模与复杂度观察

- 时间几何只有 `timeGeometry.ts` 一个 owner；不要复制 `timeToPx/pxToTime/snapToFrame`。
- overlap 检查内聚到 Dialogue timing mutation；不要散在 3 个 pointer handler。
- drag preview 只存必要 identity + draftStartMs/draftEndMs；不要建全局 gesture framework。
- caption projection/presentation 如需共享，只抽小 helper。
- #220 布局不要用“再加高度”解决。
- 单函数明显 >50 行需解释，但禁止为压行数硬拆。

### 3.4 自动化质量闸门（强制）

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | TS + Renderer + Electron build 通过 | `pnpm build` | 返工 |
| FMT | 无 whitespace/error diff | `git diff --check` | 返工 |
| LINT | 无新增 lint error；warning 真实声明 | `pnpm lint` | 返工或 debt |
| TEST | timing/overlap/history/subtitle/pointer/integration 有真实行为测试 | unit + integration | 返工 |
| ARCH | Timeline/playhead/Dialogue/subtitle/Inspector owner 唯一 | `git grep` + diff/import | 返工 |
| LAYOUT | Issue #220 内部滚动/底部可达性不回归 | contract test + Windows wide/narrow | 返工 |
| REAL | Windows Electron 主路径真实完成 | `pnpm dev` + human evidence | 未签字=PENDING；失败=FAIL |
| DOC | DAY-28 receipt 与实际一致 | receipt diff | 返工或 DEBT-DOC |

---

# 【模块3-A】刀刃表（16项，强制命令化）

| 类别 | 检查点ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | Timed clip 可选择、move、resize start/end | timing tests + Electron | [ ] |
| FUNC | FUNC-002 | Untimed 不丢失；含 shot-end 情况可安排成正跨度 | service/UI + Electron | [ ] |
| FUNC | FUNC-003 | Canvas 在 `[start,end)` 显示字幕，exact end 切换/消失 | subtitle tests + Electron | [ ] |
| FUNC | FUNC-004 | Product Preview 与 editor 共用 timing + 500-char projection | preview tests + Electron | [ ] |
| CONST | CONST-001 | 复用 Day26 time geometry/playhead；ruler+clip 共用 pixelsPerMs/scroll；无第二 clock | grep + geometry tests | [ ] |
| CONST | CONST-002 | 复用 Day27 Dialogue mutation/selection + ProjectCommand/History | store/service/history | [ ] |
| CONST | CONST-003 | shared subtitle evaluator/projection 单一；无第二时间判断 | grep + diff | [ ] |
| CONST | CONST-004 | caption overlay 不参与 Konva hit-test；不触碰 ActionPreset/TimelineEvent | source + interaction | [ ] |
| NEG | NEG-001 | overlap commit 拒绝；adjacency 合法；legacy overlap 不被 ProjectSchema 意外判死 | pure/service/fixture tests | [ ] |
| NEG | NEG-002 | move/resize clamp；clip/handle gesture 不意外 seek playhead | geometry/pointer + Electron | [ ] |
| NEG | NEG-003 | Project/Shot/Dialogue identity 变化取消 drag preview | store/integration + Electron | [ ] |
| NEG | NEG-004 | 字幕显示时 layer/background/Transformer 点击/拖拽无回归 | canvas interaction + Electron | [ ] |
| UX | UX-001 | 3 条对白首尾相接；zoom/scroll 后 ruler 与 clip 对齐 | Windows Electron | [ ] |
| UX | UX-002 | overlap/Untimed 提示可理解；#220 wide/narrow 底部控件仍可达 | Electron + screenshot | [ ] |
| E2E | E2E-001 | edit→Undo→Redo→Save→Close→Reopen，Timeline/Canvas 一致 | Electron + receipt | [ ] |
| High | HIGH-001 | 自动化全绿 + #220 layout + hit-test + 真人 timing 同时通过才 overall PASS | test + human receipt | [ ] |

### 刀刃表铁律

1. 每项必须有真实命令输出或真人证据。
2. “看起来没重叠/应该没拦点击/应该没挤掉”不算证据。
3. N/A 必须写原因与替代证据。
4. 同一命令覆盖多项，在 receipt 写映射。

---

# 【模块3-B】地狱红线（10项）

1. fake clock / fake subtitle / 硬编码 timing → 返工。
2. 未跑 timing/history/pointer/hit-test/Electron 却写 PASS → 返工。
3. build FAIL 仍声称完成 → 返工。
4. half-open/overlap/clamp/History/identity/#220 无证据 → 返工。
5. setTimeout 模拟拖动、直接 JSON 改 start/end、或 clip pointer 顺带触发 ruler seek → 返工。
6. 第二 playhead / subtitle evaluator / Dialogue selection / Timeline root / Project store → 返工。
7. 用 `SubtitleTrackSchema.parse()` 把 legacy overlap 变成历史项目全局打不开，或隐藏 cue-500/style/test debt → 返工。
8. 擅自做 ActionPreset、TimelineEvent editor、波形、TTS、自动时长、ripple edit → 立即停止。
9. reset/force-push 抹历史、整包搬旧实验分支 → 返工。
10. 已锁定 owner 明明存在，却无证据另起平行实现或复制 time geometry → 返工。

---

# 【模块4】P4 自测轻量检查表 v3.0

| 检查点 | 自检问题 | 覆盖情况 | 相关用例ID / 命令 | 备注 |
|---|---|---|---|---|
| 核心功能用例（CF） | move/resize/Untimed/字幕是否各有标准路径？ | [ ] | FUNC-001～004 | |
| 约束与回归用例（RG） | half-open/no-overlap/owner/shared-scroll/hit-test 是否覆盖？ | [ ] | CONST-001～004 | |
| 负面路径用例（NG） | overlap/越界/pointer seek/身份切换/交互回归是否覆盖？ | [ ] | NEG-001～004 | |
| 用户体验用例（UX） | 3 条对白排时间、zoom/scroll、#220 布局和错误提示是否可用？ | [ ] | UX-001～002 | |
| 端到端关键路径（E2E） | edit→undo→redo→save→reopen 是否完整？ | [ ] | E2E-001 | |
| 高风险场景（High） | #220 + hit-test + human timing gate 是否单独验证？ | [ ] | HIGH-001 | |
| 字段完整性 | receipt 是否写前置/预期/实际/风险？ | [ ] | `docs/test-receipts/DAY-28.md` | |
| 需求映射 | 每条验证是否回到 Dialogue Timing + Subtitle Track？ | [ ] | 刀刃表 | |
| 自测执行 | 是否真实跑完整质量命令 + Electron？ | [ ] | quality gates | |
| 范围边界与债务 | 未做样式/TTS/动作/legacy cleanup 是否明确？ | [ ] | debt ledger | |

---

# 【模块5】收卷格式（强制结构）

```markdown
## Panda Stage Day 28 / B-28/45 收卷

### 提交信息
- Day26 prerequisite: `PASS + merged`
- Day26 merge SHA: `e4eeb551721864b0c2f3e2596d35d3d1dc2de323`
- Day27 prerequisite: `PASS + merged`
- Day27 final head: `688a56357443558bdf2a75ac360f38a13de73828`
- Day27 merge SHA: `6092109c2c73dc8e056a41bd94fbfc1dfa87d31a`
- Day28 开工 HEAD: `<真实 SHA>`
- Day28 收卷 HEAD: `<真实 SHA>`
- Commit: `<真实 commit>`
- 分支: `<真实分支>`
- 变更文件: `<git diff --name-only 实际输出>`

### 状态
- automated/structural: `PASS / FAIL`
- maintainer Windows Electron: `PENDING / PASS / FAIL`
- overall: `PENDING / PASS / FAIL`

### 本轮目标与实际结果
- 目标: Dialogue timing + subtitle track，不进入 ActionPreset/通用事件编辑。
- 实际完成: [真实项]
- 未完成/不在范围: [真实列出]

### 关键决策记录
- DECISION-B28-TIME-OWNER: `TimelineDock + timelineUiStore + timeGeometry`
- DECISION-B28-TIME-FUNCTIONS: `computePixelsPerMs/timeToPx/pxToTime/snapToFrame/clampTime/frameDurationMs`
- DECISION-B28-DIALOGUE-OWNER: `DialogueService + dialogueStore`
- DECISION-B28-DIALOGUE-SELECTION-OWNER: `dialogueSelectionStore`
- DECISION-B28-SUBTITLE-PROJECTION: [共享 projection/evaluator owner]
- DECISION-B28-CUE-TEXT-LIMIT: `trim + max 500`
- DECISION-B28-OVERLAP: `new authoring overlap forbidden; adjacency allowed; no global legacy schema rejection`
- DECISION-B28-UNTIMED: [产品呈现/安排路径]
- DECISION-B28-DEFAULT-DURATION: `1 Day26 frame quantum; shot-end left-fill`
- DECISION-B28-LAYOUT-220: [如何保持内部滚动/底部可达性]
- DECISION-B28-POINTER-SEEK: [clip/handle 如何与 ruler seek 隔离]
- DECISION-B28-CAPTION-PRESENTATION: [editor/preview 共享视觉 owner]

### Subtitle / Time Blast Radius
[真实 grep 输出摘要]

### 自动化质量检查报告
- typecheck: [真实]
- diff-check: [真实]
- lint: [真实]
- unit: [真实]
- integration: [真实]
- build: [真实]
- issue220 layout contract: [真实]

### Timing Contract 证据
- Untimed preserved: [PASS/FAIL]
- shot-end Untimed arrangement: [PASS/FAIL]
- positive span: [PASS/FAIL]
- adjacency: [PASS/FAIL]
- overlap rejected: [PASS/FAIL]
- legacy overlap compatibility: [PASS/FAIL/DEBT]
- left/right clamp: [PASS/FAIL]
- half-open exact end: [PASS/FAIL]

### Timeline geometry / pointer 证据
- ruler + clips shared pixelsPerMs/scroll: [PASS/FAIL]
- zoom/scroll alignment: [PASS/FAIL]
- clip click does not seek: [PASS/FAIL]
- move/resize does not seek: [PASS/FAIL]

### History / dirty 证据
- drag preview 前后 dirty/revision/history: [真实值]
- pointerup commit 后: [真实值]
- Undo/Redo/save 后: [真实值]

### Canvas / Preview 证据
- editor currentTimeMs→字幕: [PASS/FAIL]
- cut at exact endMs: [PASS/FAIL]
- shot switch clears caption: [PASS/FAIL]
- subtitle-visible layer hit-test: [PASS/FAIL]
- Product Preview same timing semantics: [PASS/FAIL]
- cue text >500 handling identical editor/preview: [PASS/FAIL]

### Issue #220 布局回归
- contract test: [PASS/FAIL]
- wide: [PASS/FAIL]
- narrow: [PASS/FAIL]
- wide→narrow→wide: [PASS/FAIL]
- bottom controls reachable: [PASS/FAIL]

### 真实 Windows Electron 验收
- 环境: Windows / Electron / 窗口尺寸 / DPI
- 3 条对白首尾相接: [PASS/FAIL]
- move/resize 与 Canvas 同步: [PASS/FAIL]
- overlap rejection: [PASS/FAIL]
- shot-end clamp/default duration: [PASS/FAIL]
- Undo/Redo: [PASS/FAIL]
- save→close→reopen: [PASS/FAIL]
- switch shot clears subtitle: [PASS/FAIL]
- subtitle click-through: [PASS/FAIL]
- ruler/clip pointer isolation: [PASS/FAIL]
- #220 wide/narrow layout: [PASS/FAIL]
- devtools/JSON direct mutation: [未使用 / 若使用则说明并不得作为验收证据]

### 债务声明
- DEBT-COMPLEXITY-B28: [无 / 描述]
- DEBT-TEST-B28: [无 / 描述]
- DEBT-DOC-B28: [无 / 描述]
- DEBT-SCOPE-B28: [无 / 描述]
- DEBT-PERF-B28: [无 / 描述]
- DEBT-SUBTITLE-STYLE-B28: [无 / 描述]
- DEBT-SUBTITLE-TEXT-LIMIT-B28: [无 / 描述]
- DEBT-LEGACY-OVERLAP-B28: [无 / 描述]

### Day 结论
- automated/structural 失败 → `overall=FAIL`
- automated/structural PASS 但 maintainer 未签字 → `overall=PENDING`
- 真人关键路径 FAIL → `overall=FAIL`
- 全部强制 gate + maintainer 真人 PASS → `overall=PASS`

### 下一步唯一动作
- [只写一条]
```

---

# 【模块6】技术熔断预案（非时间熔断）

| 熔断ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| PREREQ-001 | 最新 main 不含 Day26/Day27 merge 或 owner 实质漂移无解释 | 停止 Day28，只保留调查证据 | 等前置/重新校准 |
| ARCH-001 | timing 必须重写通用 Timeline engine / 全局 selection / ActionPreset 才成立 | 暂停并报告 | 拆工单或降级 |
| SCHEMA-001 | 要新增 persisted timing 字段、全局禁止 legacy overlap、或 schemaVersion bump | 停止 UI 扩展 | 另行决策 |
| QUALITY-001 | typecheck/lint/unit/integration/build 持续失败 | 停止堆 UI | 先恢复基线 |
| COMPLEXITY-001 | 连续 2 次返工仍无法保持简单 drag/geometry 状态 | 允许记录 debt，但不自动 PASS | 有条件交付 |
| TEST-001 | 无法自动驱动 pointer/Konva hit-test | pure geometry + store/contract + 真人替代，并声明 debt | 真人证据加重 |
| PERF-001 | 拖 playhead/clip 出现 Project mutation 风暴或明显卡顿 | 停止视觉扩展 | 先修 transient/commit |
| POINTER-001 | clip/handle gesture 会触发 ruler seek 或 currentTimeMs 意外变化 | 立即停止 | Day28 FAIL 直到隔离 |
| LAYOUT-001 | 新 Track 让 #220 裁切/不可达问题复发 | 禁止扩大 BottomWorkspace 掩盖；先修内部布局 | Day28 FAIL 直到修复 |
| HIT-001 | 字幕可见后 layer/background/Transformer 命中错误 | 恢复 listening=false / hit authority | Day28 FAIL |
| HUMAN-001 | 自动化绿但 Electron timing/字幕/save-reopen/hit-test/layout 任一 FAIL | overall=FAIL | 止损 |

---

# 【模块7】派单口令（Day 28 定制版）

启动饱和攻击集群，执行 **Panda Stage Day 28：Dialogue Timing + Subtitle Track**！

## 技术背景

- 派单前校准输入 main=`7357552c4cd82ad622b13d0eab083c673903863a`；执行时重新记录最新 stable main。
- Day26 PR #200 已 merge：`e4eeb551...`；真实 time owner 是 `TimelineDock + timelineUiStore + timeGeometry`。
- Day27 PR #216 已 merge：final head `688a563...`，merge `6092109c...`；真实 Dialogue owner 是 `DialogueService + dialogueStore + dialogueSelectionStore`。
- Issue #220 已 completed，底部 Timeline/Dialogue 区当前依靠内部纵向滚动 + sticky header + 固定 ruler/history 保持控件可达；Day28 不得回归。
- Day27 允许 `startMs=endMs` 的正式 Untimed Dialogue，包括 point-time 位于 shot end 的情况。
- shared subtitle engine 已定义整数毫秒、half-open `[start,end)`、cue max 500、SubtitleTrack no-overlap。
- Product Preview 已从 Dialogue 生成 cue 并用 `evaluateSubtitleAtTime()`。
- editor Canvas 是静态可交互 Konva 编辑面；Day28 只加字幕 overlay，不把它改成动作播放器。

## 关键约束

- 开工先确认当前 HEAD 包含 Day26/27 merge。
- Timed Dialogue 新 authoring overlap 禁止；adjacency 允许；不全局判死 legacy overlap。
- Untimed 合法但不显示字幕；默认安排跨度=Day26 1 frame；shot-end 向左回填。
- move/resize 复用 `timeToPx/pxToTime/snapToFrame/computePixelsPerMs`。
- Dialogue Track 与 ruler 共用 scroll/time geometry。
- clip/handle pointer 不得触发 ruler seek。
- renderer 算 geometry/snap；domain 做最终 timing 合法性/overlap；domain 不 import renderer。
- drag preview transient；pointerup 一次 ProjectCommand/History。
- editor playhead 与 Product Preview clock 身份分离。
- editor/preview 共享 subtitle projection/evaluator，文本 projection trim + max 500。
- caption overlay `listening=false`。
- #220 wide/narrow/internal-scroll 合同必须回归验证。
- 不做 ActionPreset / TimelineEvent editor / waveform / TTS / text-based auto-duration / ripple edit。

## 质量红线

- 10 项地狱红线全部生效。
- 16 项刀刃表全部命令/证据化。
- subtitle/time/layout blast-radius 必须先 `git grep` 再改。
- 不存在的测试工具写 `N/A + 原因 + 替代证据`。
- 自动化全绿但真人没签字：`overall=PENDING`，不能写 PASS。

## 工单矩阵

- `B-28/45 Engineer`：单 Agent 完成本轮；不并行改 Timeline geometry、Dialogue timing service、Canvas hit authority，避免共享 owner 被多个 Agent 同时改。

## 验收铁律

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

真实 Windows Electron：

> 至少 3 条对白 → 安排首尾相接 → 处理 shot-end Untimed → 拖 playhead 看字幕 → move/resize → 制造 overlap 并确认拒绝 → clip 到 shot 尾 clamp → 验证 clip gesture 不 seek → zoom/横滚看 ruler/clip 对齐 → Undo → Redo → 保存 → 关闭 → 重开 → 切 Shot 清字幕 → 字幕可见时点击其下图层 → wide/narrow/wide 检查 #220 底部控件可达。

## 收卷要求

- 生成 `docs/test-receipts/DAY-28.md`。
- 必须记录 Day26/27 owner、half-open/no-overlap/legacy 边界、Untimed/default-duration、History、shared scroll、pointer seek 隔离、500-char projection、#220、hit-test、Preview 回归、真人证据。
- `automated/structural=PASS` 但真人未签字时 `overall=PENDING`。
- 只有 `overall=PASS` 才允许 Day29。

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
git merge-base --is-ancestor e4eeb551721864b0c2f3e2596d35d3d1dc2de323 HEAD
git merge-base --is-ancestor 6092109c2c73dc8e056a41bd94fbfc1dfa87d31a HEAD
git diff --name-only
git diff --stat
git diff --check
```

## Day26 / Day27 owner 核对

```bash
find src/renderer -maxdepth 5 -type f | grep -Ei 'timeline|playhead|dialogue'
git grep -n "currentTimeMs\|playhead\|timeToPx\|pxToTime\|snapToFrame\|computePixelsPerMs\|frameDurationMs" -- src/renderer tests
git grep -n "DialogueService\|dialogueStore\|dialogueSelectionStore" -- src tests
```

## Subtitle owner / blast radius

```bash
nl -ba src/shared/preview/subtitle-engine.ts
nl -ba src/renderer/shell/productPreviewModel.ts | sed -n '1,220p'
nl -ba src/renderer/shell/ProductPreviewOverlay.tsx | sed -n '1,280p'
nl -ba src/renderer/stage/StageRenderer.tsx | sed -n '1,280p'
nl -ba src/shared/stage/layout.ts
nl -ba src/renderer/features/canvas/CanvasStage.tsx | sed -n '200,620p'
git grep -n "evaluateSubtitleAtTime\|SubtitleTrackSchema\|SubtitleCueSchema" -- src tests
git grep -n "buildProductPreviewCues\|caption=" -- src tests
git grep -n "subtitleStyleId\|SubtitleStyleSchema\|STAGE_CAPTION_SAFE_AREA" -- src tests
```

## Timing / History / Pointer contract

```bash
git grep -n "startMs\|endMs" -- src/domain src/renderer tests | grep -Ei "dialogue|subtitle"
git grep -n "updateProject\|ProjectCommand\|History" -- src/renderer/stores tests | head -n 200
git grep -n "onPointerDown\|onPointerMove\|onPointerUp\|setPointerCapture\|releasePointerCapture" -- src/renderer/features/timeline tests
```

## Issue #220 layout contract

```bash
nl -ba tests/contract/issue220-dialogue-layout.test.ts
git grep -n "timeline-dock\|timeline-header\|timeline-ruler-scroll\|bottom-workspace\|dialogue-sheet" -- src/renderer/styles.css tests
```

## 范围反查

```bash
git diff --name-only main...HEAD
git diff main...HEAD -- src/renderer/features/actions src/domain/actions src/domain/models/timeline-event.ts
```

第二条默认应为空；出现 ActionPreset/TimelineEvent 生产语义改动 → 范围审查。

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

Windows 测试数据继续优先：

```text
D:\PandaStage-Acceptance\
```

大文件不得无说明堆 C 盘；若不可避免，receipt 写路径/用途/体积。

---

# 最终 DoD

- [ ] 开工 HEAD 已记录，且包含 Day26 merge `e4eeb551...`
- [ ] 开工 HEAD 已记录，且包含 Day27 merge `6092109c...`
- [ ] Day26 owner 保持 `TimelineDock/timelineUiStore/timeGeometry`
- [ ] Day27 owner 保持 `DialogueService/dialogueStore/dialogueSelectionStore`
- [ ] subtitle/time/layout blast radius 已搜索并记录
- [ ] Untimed `start=end` 合法且产品可找到
- [ ] shot-end Untimed 可按 1-frame 左回填规则安排
- [ ] Timed `end>start` 在 Timeline 有真实 clip
- [ ] move/resize 复用 Day26 geometry/snapping
- [ ] ruler 与 clips 共用 pixelsPerMs/scroll/zoom
- [ ] clip/handle gesture 不意外 seek playhead
- [ ] 超边界 clamp
- [ ] 新 authoring overlap 拒绝
- [ ] adjacency `A.end===B.start` 允许
- [ ] legacy overlap 未被无意升级成 ProjectSchema 全局拒绝
- [ ] half-open `[start,end)`
- [ ] drag preview 不写 Project、不 dirty、不刷 History
- [ ] 一次 gesture 仅 1 个 History command
- [ ] Undo/Redo 时间同步
- [ ] editor Canvas currentTimeMs 显示正确字幕
- [ ] exact endMs 不残留上一句
- [ ] 切 Shot 清上一镜头字幕
- [ ] Product Preview 同一 timing evaluator/projection
- [ ] editor/preview cue text projection 都是 trim + max 500
- [ ] caption presentation owner 单一
- [ ] caption overlay `listening=false`
- [ ] 字幕可见时 layer/background/Transformer hit-test 无回归
- [ ] Issue #220 contract test PASS
- [ ] Windows wide/narrow/wide 底部控件可达，无裁切回归
- [ ] 不做 Subtitle theme editor
- [ ] 不做 ActionPreset / TimelineEvent editor / waveform / TTS / auto-duration / ripple edit
- [ ] `pnpm typecheck` PASS
- [ ] `pnpm lint` PASS 或 warning 诚实声明
- [ ] `pnpm test:unit` PASS
- [ ] `pnpm test:integration` PASS
- [ ] `pnpm build` PASS
- [ ] `git diff --check` PASS
- [ ] Windows Electron：3 条对白首尾相接 PASS
- [ ] Windows Electron：shot-end Untimed 安排 PASS
- [ ] Windows Electron：move/resize + Canvas 同步 PASS
- [ ] Windows Electron：overlap rejection PASS
- [ ] Windows Electron：shot-end clamp PASS
- [ ] Windows Electron：clip pointer 不 seek PASS
- [ ] Windows Electron：zoom/scroll ruler-clip 对齐 PASS
- [ ] Windows Electron：Undo/Redo PASS
- [ ] Windows Electron：save→close→reopen PASS
- [ ] Windows Electron：switch shot clears subtitle PASS
- [ ] Windows Electron：subtitle-visible hit-test PASS
- [ ] Windows Electron：#220 wide/narrow/wide layout PASS
- [ ] 16 项刀刃表完成
- [ ] P4 完成
- [ ] `docs/test-receipts/DAY-28.md` 完整
- [ ] debt 透明记录
- [ ] 自动化全绿但真人未签字时：`overall=PENDING`
- [ ] 只有 `overall=PASS` 后才允许提出 Day29
