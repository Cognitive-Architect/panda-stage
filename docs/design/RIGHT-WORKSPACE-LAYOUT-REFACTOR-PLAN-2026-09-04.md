# Panda Stage｜右侧工作区 + 纯 Timeline 布局重构方案

状态：`PLAN ONLY / DOCS ONLY`  
日期：`2026-09-04`  
研究基线：

```text
main = de8d4ddced439a2846af39a503ef38985fc53e29
in-flight implementation = PR #418 @ e5581090de19d727111a73af976f9eeb9778b8e8
related = #416 / #422 / #423
```

> 本文只定义信息架构、owner 边界、迁移顺序和验收合同。
> 视觉尺寸、图标、间距、抽屉宽度、动画和最终高保真样式暂不定稿，后续单独补视觉设计。

---

## 1. 背景 / 为什么需要这次重构

LM-006（#422 / #423）通过真人 Windows + Electron 验收暴露了一个比“Timeline 高度范围”更根本的问题。

当前 Cloud Touch landscape 的 Bottom Workspace 同时承担：

```text
Timeline Toolbar
Ruler
Subtitle Track
Audio Track
Subtitle Task Tray / DialogueSheet
```

这导致两个工作流目标互相打架：

```text
想看更多待安排字幕
-> 拉高 Timeline
-> Bottom Workspace 占用更多垂直空间
-> Canvas 被明显压缩

但：
拖“待安排字幕”到字幕轨
-> 用户需要同时观察 Canvas + Timeline
-> Canvas 恰恰被拉高后的 Bottom Workspace 挤掉
```

这不是单纯把 `MIN / MAX` 再调几个 px 能长期解决的问题，而是：

> **字幕工作区与 Timeline 被放在了同一个垂直容器里，职责和空间需求发生冲突。**

---

## 2. 当前仓库结构核验

### 2.1 左侧真正的资源活动只有三类

当前 `ResourceActivityDock.tsx` 的正式 `ACTIVITIES` 是：

```text
shots       -> 镜头
assets      -> 素材
characters  -> 角色
```

`项目工具` 并不是第四种资源 activity；它通过 `projectToolsContent / projectToolsOpen` 额外挂在同一 rail 上。

因此从信息架构上看，左侧天然适合收口为：

```text
左侧 = 资源来源
镜头 / 素材 / 角色
```

### 2.2 Project Tools 本身已经是 presentation-level launcher

`ProjectToolsDrawer.tsx` 已明确把自身定义为 presentation-level launcher。

它组合现有：

```text
ProjectRecoveryPanel
LegacyWorkspace / Action Presets
```

真实业务 owner 并不属于 LeftWorkspace 本身。

所以项目工具右迁应遵循：

```text
移动 presentation surface
!=
迁移 / 复制业务状态 owner
```

### 2.3 当前 BottomWorkspace 是“Timeline + 字幕任务区”混合 owner

`BottomWorkspace.tsx` 只正式挂一个 `TimelineDock`。

但 `TimelineDock.tsx` 内部进一步直接渲染：

```text
<section className="timeline-task-tray">
  <DialogueSheet ... />
</section>
```

因此视觉上看到的“待安排字幕”并不是独立 Workspace；它现在是 TimelineDock 的下半部分。

### 2.4 字幕拖放协调逻辑目前也住在 TimelineDock

当前从待安排字幕拖到字幕轨的流程主要由 `TimelineDock.tsx` 协调：

```text
读取 pending dialogue source
-> pointer gesture 判定
-> subtitle lane target hit-test
-> X 坐标映射为 startMs
-> dialogueStore.previewArrange(...)
-> 显示 drag ghost / drop preview
-> dialogueStore.arrange(...)
```

这也是迁移 Subtitle Workspace 时最大的工程边界。

不能只把 `<DialogueSheet />` 从底部剪切到右边，因为 source 和 target 将变成两个 sibling workspace。

### 2.5 RightInspector 已经拥有“属性 / 字幕属性”能力

当前 `RightInspector.tsx` 已订阅：

```text
selectionStore
dialogueSelectionStore
```

当有 dialogue selection 时，它已经可以呈现 `字幕属性`；否则呈现普通图层 `属性`。

因此新的“字幕工作区”必须与“字幕属性”明确分工，不能在右侧再造两个做同一件事的入口。

---

# 3. 目标信息架构

## 3.1 顶层结构

推荐把 Cloud Touch landscape 收口成：

```text
┌─────────────────────────────────────────────────────┐
│                    Top Project Bar                  │
├─────────┬───────────────────────────────┬───────────┤
│ Left    │                               │ Right     │
│ Rail    │                               │ Rail      │
│         │                               │           │
│ 镜头    │                               │ 字幕      │
│ 素材    │            Canvas             │ 属性      │
│ 角色    │                               │ 项目工具  │
│         │                               │           │
├─────────┴───────────────────────────────┴───────────┤
│                     Timeline                        │
│ Toolbar / Ruler / Subtitle Track / Audio Track      │
└─────────────────────────────────────────────────────┘
```

语义分区：

```text
左侧：我有什么资源
中间：我正在做什么画面
右侧：我如何编辑 / 编排
底部：什么时候发生
```

这不仅形成视觉 3 + 3 对称，也让功能分类变得稳定。

---

# 4. 各 Workspace 职责

## 4.1 Left Resource Workspace

保留：

```text
镜头
素材
角色
```

职责：资源浏览、创建、导入、选择。

不再承担：

```text
项目工具
字幕任务
```

### Owner 原则

继续复用：

```text
LeftWorkspace
ResourceActivityDock
ShotManager
AssetLibrary
CharacterManager
```

不创建第二套资源状态。

---

## 4.2 Right Subtitle Workspace

这是本次新增的正式右侧 Workspace。

它负责“有哪些字幕任务 / 如何创建和安排字幕”，而不是负责“这个已选字幕的属性是什么”。

### V1 建议职责

```text
待安排字幕队列
单条新建字幕
批量粘贴 / 批量创建
Untimed 字幕的安排入口
从待安排字幕拖到底部 Subtitle Track
空状态
```

### 不应复制的职责

```text
已定时字幕的属性编辑
角色 / 图层通用属性
Timeline time geometry
Timeline seek / zoom / scroll
```

已定时字幕的具体属性继续由右侧 `属性` Workspace / RightInspector 负责。

### 推荐复用

优先把现有 `DialogueSheet` 改造成可重用 presentation：

```text
presentation = right-workspace
```

而不是复制一个 `SubtitleWorkspaceV2` 再复制 dialogueStore 逻辑。

建议让 DialogueSheet 在右侧模式主要呈现：

```text
pending
untimed-selected
single-add
batch-paste
empty
```

当前 `timed-selected` 的详细编辑职责应逐步收口给 Properties，避免右侧出现：

```text
字幕 Workspace -> timed editor
属性 Workspace -> 字幕属性
```

两个入口重复编辑同一个 timed dialogue。

---

## 4.3 Right Properties Workspace

继续复用现有 `RightInspector` 业务投影：

```text
图层属性
背景属性
锁定态
字幕属性
```

但建议将“Right Rail / Drawer chrome”和“Inspector 内容”解耦。

### 推荐结构

```text
RightWorkspace
  ├─ RightActivityRail
  └─ RightActivitySurface
       ├─ SubtitleWorkspace content
       ├─ RightInspector content
       └─ ProjectToolsDrawer content
```

`RightWorkspace` 只拥有：

```text
active right activity
open / close presentation state
focus return / Escape presentation behavior
```

它不拥有：

```text
selectionStore
dialogueSelectionStore
Project data
Properties mutation
```

`RightInspector` 可以增加一个 embedded / content-only presentation，复用现有订阅和编辑逻辑，而不再自己额外绘制第二条 right rail。

---

## 4.4 Right Project Tools Workspace

把当前左侧：

```text
项目工具
```

迁入右侧第三个 activity。

继续复用：

```text
ProjectToolsDrawer
ProjectRecoveryPanel
LegacyWorkspace / Action Presets
```

### 迁移原则

```text
LeftWorkspace 不再 owner projectToolsOpen
RightWorkspace 负责右侧 presentation selection
ProjectToolsDrawer 业务内容不复制
```

### 与 LM-004 的关系

原 LM-004 计划将：

```text
适应窗口
50%
1:1
```

迁入“项目工具”。

因此 **Project Tools 应先确定最终位于右侧**，然后 LM-004 再把 viewport controls 直接迁进最终位置。

避免：

```text
先把 controls 搬到左侧项目工具
-> 再把项目工具整体搬右
-> 二次返工
```

---

## 4.5 Bottom Timeline Workspace

重构后 Bottom Workspace 只负责时间维度：

```text
Timeline resize / collapse
Timeline Toolbar
Timecode
Zoom
Ruler
Subtitle Track
Audio Track
Playhead
Timeline horizontal scroll
```

应移除：

```text
Timeline Task Tray
底部 DialogueSheet
待安排字幕卡片
底部字幕 authoring body
```

### 产品收益

Task Tray 移走以后，Timeline 不再需要通过巨大 MAX 高度给字幕任务区腾空间。

因此 #422 / #423 的最终 MIN / NORMAL / MAX 可以重新简化为更克制的纯 Timeline contract。

不要默认继承当前：

```text
210 / 280 / 420
```

这些高度是“Timeline + Task Tray”组合时期的阶段性结果。

迁移完成后应重新实机定标。

---

# 5. 最关键工程问题：跨 Workspace 字幕拖放

## 5.1 现状

当前 source 与 target 都在 `TimelineDock` 内：

```text
DialogueSheet pending card
↓
TimelineDock pointer coordinator
↓
Subtitle lane
```

迁移后变成：

```text
Right Subtitle Workspace
        │
        │ drag pending dialogue
        ↓
Bottom Timeline Subtitle Track
```

因此需要把“拖放协调”从单一 TimelineDock DOM 内局部逻辑提升为跨 sibling workspace 的 presentation coordination。

---

## 5.2 推荐：抽出一个 UI-only Pending Dialogue Placement Coordinator

可以用 hook / controller / context 实现，命名不强制，例如：

```text
usePendingDialoguePlacement
PendingDialoguePlacementController
PendingDialoguePlacementProvider
```

但必须保持它是 **transient UI coordinator**，不是新的业务 store。

### 它可以拥有

```text
当前正在拖哪条 dialogueId
pointerId / clientX / clientY
当前 dropState
mappedStartMs
previewStartMs / previewEndMs
短暂 drag ghost / drop message
source element focus restore
subtitle target geometry ref
```

### 它不能拥有

```text
Dialogue 数据真相
Project 数据真相
新的字幕列表
新的 Timeline 时间
新的 selection truth
```

正式 owner 继续是：

```text
editorProjectStore
dialogueStore
dialogueSelectionStore
shotStore
timelineUiStore
```

---

## 5.3 拖放合同保持不变

迁移 UI 后应继续复用现有：

```text
isPendingDialoguePlacementGesture
isPointInsidePendingDropTarget
mapPendingDropXToStartMs
dialogueStore.previewArrange
dialogueStore.arrange
integerFrameSpanMs
```

### Source contract

右侧 Pending card 在 pointer gesture 成立后提供：

```text
dialogueId
projectRoot
shotId
characterName
text
sourceElement
```

### Target contract

Bottom Timeline Subtitle Lane 提供：

```text
DOMRect
pixelsPerMs
durationMs
```

### Commit 前必须继续重验 identity

```text
projectRoot 未变化
shotId 未变化
dialogue 仍然 untimed
```

否则取消 drop，不提交脏 mutation。

### Drag overlay

建议 drag ghost / status layer 放在 EditorShell 或 Right+Bottom 的共同祖先级 overlay，避免：

```text
右侧 drawer overflow / z-index
-> 把 ghost 裁掉
```

这只是 presentation layer，不应变成新的业务 owner。

---

# 6. 右侧 Workspace 的交互原则

## 6.1 三个 activity

建议语义顺序：

```text
字幕
属性
项目工具
```

理由：

```text
字幕      -> 高频编排入口
属性      -> 当前 selection 的上下文编辑
项目工具  -> 低频项目级辅助入口
```

最终图标、rail 宽度、抽屉宽度、间距后续视觉设计确定。

---

## 6.2 Right Workspace 只允许一个 surface 同时展开

推荐：

```text
点击 字幕
-> 打开 / 切换到 Subtitle Workspace

点击 属性
-> 打开 / 切换到 Properties

点击 项目工具
-> 打开 / 切换到 Project Tools

再次点击当前 activity
-> 可关闭 drawer，保留 rail
```

避免三个独立 drawer 同时叠加在 Canvas 上。

---

## 6.3 Properties 与 Subtitle Workspace 不自动互抢焦点

V1 建议不要因为选择了一条 timed dialogue 就强行把用户从“字幕”页跳到“属性”页。

原则：

```text
selection truth 可以变化
right active surface 不必自动变化
```

用户需要具体编辑已选字幕时再进入 Properties。

如果后续真人验收证明自动切换更顺，再单独设计，不在第一版强制加入。

---

# 7. 推荐实施拆分

不建议把整个重构塞进一张巨型 implementation Issue。

建议分成 3 个可独立验收的 implementation slice。

## Phase R1｜Right Workspace Shell + Project Tools relocation

目标：

```text
左侧收口为 镜头 / 素材 / 角色
新增统一 Right Activity Rail
Right activities = 字幕 / 属性 / 项目工具
项目工具从左迁右
Properties 重挂到统一 Right Workspace
Subtitle 可以先只有占位 / skeleton，不迁业务
```

### R1 DoD

- Left Rail 只有 3 个资源入口；
- Right Rail 形成 3 个 activity；
- Project Tools 功能无回归；
- Properties 功能无回归；
- 只有一个右侧 drawer/surface owner；
- 不复制业务 state。

---

## Phase R2｜Subtitle Workspace migration + cross-workspace drag

目标：

```text
DialogueSheet 从 Bottom Timeline 迁到 Right Subtitle Workspace
抽出 Pending Dialogue Placement Coordinator
右侧 pending subtitle 可拖到底部 Subtitle Track
底部删除 Task Tray
```

### R2 DoD

- 待安排字幕队列在右侧；
- 新建 / 批量字幕在右侧；
- Pending -> Timeline drag 正常；
- drop preview / invalid / Escape / focus restore 正常；
- Canvas 在整个拖拽期间持续可见；
- Bottom Timeline 不再渲染 DialogueSheet；
- `dialogueStore` / `dialogueSelectionStore` 仍为唯一业务 truth。

---

## Phase R3｜Pure Timeline geometry rebaseline

目标：

基于“纯 Timeline”重新校准：

```text
MIN
NORMAL
MAX
collapse / reopen
```

### 核心变化

不再为 Task Tray 预留空间。

MAX 的产品目标从：

```text
给字幕任务区更多工作空间
```

变为：

```text
只给 Timeline 本身必要的更大操作空间
且 Canvas 必须持续有意义地可见
```

### R3 DoD

- Timeline MIN / NORMAL / MAX 真人 Windows/Electron 合理；
- Canvas 在字幕编排流程中持续可见；
- 不再出现“为了看字幕列表把 Canvas 挤没”的死循环；
- #422 已解决的 rail collision 不回归。

---

# 8. 与 LM-004 / Canvas Flatten 的推荐顺序

推荐新顺序：

```text
#418 / LM-006 当前阶段性验收
        ↓
R1 Right Workspace shell
        ↓
R2 Subtitle Workspace + drag migration
        ↓
R3 Pure Timeline geometry rebaseline
        ↓
LM-004 Canvas flatten + viewport controls relocation
        ↓
统一 Windows/Electron 真人验收
```

原因：

1. 先把 Project Tools 定到最终右侧位置；
2. 再把 Subtitle Task Tray 从底部移走；
3. 再根据最终 Bottom Timeline 内容重新定高度；
4. 最后 LM-004 才基于稳定空间做 Canvas flatten，并把 viewport controls 直接放入最终右侧 Project Tools。

这样可以明显减少返工。

---

# 9. 明确 Scope 边界

## MUST

- 左侧收口为镜头 / 素材 / 角色；
- 右侧形成字幕 / 属性 / 项目工具；
- 底部最终只保留 Timeline；
- Canvas 在字幕编排工作流中持续可见；
- 复用现有业务 owner；
- 跨区拖放复用现有 arrange / preview / time mapping；
- Project Tools 右迁只迁 presentation；
- Properties 继续使用现有 selection / mutation truth；
- 迁移后重新真人校准 Timeline geometry。

## MUST NOT

- 复制 dialogueStore；
- 复制 dialogueSelectionStore；
- 创建第二套 Timeline clock；
- 创建第二套 Project Tools 业务 owner；
- 创建第二套 Properties mutation path；
- 改 Project schema；
- 改 autosave / History 语义；
- 因布局迁移重写 dialogue arrange 业务规则；
- 在本轮顺手做 LM-004 Canvas transform/coordinate 重构；
- 在没有视觉稿之前拍死最终 rail width / drawer width / icon / spacing。

---

# 10. 验收场景

## 10.1 基础布局

```text
Left: 镜头 / 素材 / 角色
Right: 字幕 / 属性 / 项目工具
Bottom: pure Timeline
```

三个区域不重复 owner。

## 10.2 字幕主流程

```text
打开右侧“字幕”
-> Canvas 保持可见
-> 找到待安排字幕
-> 拖到底部字幕轨某时间点
-> 拖拽期间可同时看 Canvas 与 Timeline
-> valid preview 正常
-> drop 成功
-> Timeline 出现 timed subtitle
```

## 10.3 Invalid / cancel

- 拖到音频轨 / 空白区域 -> 不提交；
- 当前 Shot / Project 变化 -> 不提交；
- Escape -> 取消；
- drag ghost 不被 right drawer overflow 裁切；
- focus 恢复合理。

## 10.4 Properties

- 选择 Canvas 图层 -> Properties 正常；
- 选择 timed subtitle -> Properties 可显示字幕属性；
- 切换 Subtitle / Properties 不改变 selection truth；
- 不产生第二份字幕编辑 truth。

## 10.5 Project Tools

- 右侧 Project Tools 可打开 / 关闭；
- Recovery / Recent / Action Presets 行为不变；
- 左侧彻底不再出现 Project Tools；
- 后续 LM-004 viewport controls 有明确最终落点。

## 10.6 Timeline

- Task Tray 不再存在于 Bottom Workspace；
- Toolbar / ruler / subtitle / audio / seek / zoom / scroll 正常；
- resize / collapse / reopen 正常；
- MAX 不撞左右 rail；
- 不需要通过巨大 Timeline 来获得字幕工作区空间。

---

# 11. 验证预算

本方案未来实施时应继续遵守“最小充分验证”。

每个 Phase 只跑与实际 touched subsystem 对应的：

```text
focused unit / integration / contract
applicable typecheck / lint / build
normal automatic CI route
Windows/Electron human acceptance
```

除非 active Issue 明确要求或维护者单独授权，不应为了 UI 迁移主动执行：

```text
manual Full CI
pnpm verify:project
repo-wide verifier sweep
unrelated DayXX historical verifier archaeology
```

---

# 12. 风险与待补视觉设计

## 风险 A：右侧 Drawer 太宽会水平压缩 Canvas

待视觉设计确定：

```text
rail width
drawer width
Canvas 是否缩放 / 覆盖 / 推挤
minimum landscape width
```

本文不拍死。

## 风险 B：跨 sibling drag 的 pointer capture / z-index

这是 R2 的主要工程风险。

必须在真实 Electron 中验证：

```text
Right drawer -> Timeline
pointer capture
hit-test
ghost overlay
scroll
Escape
focus restore
```

## 风险 C：Subtitle Workspace 与 Properties 职责重叠

V1 必须坚持：

```text
Subtitle Workspace = queue / authoring / arrangement
Properties = selected object/dialogue properties
```

后续如果产品希望增加 timed subtitle list，再单独设计信息架构，不应顺手复制 Inspector。

## 待补视觉稿

后续单独产出：

```text
Right 3-button rail collapsed state
Subtitle drawer open
Properties drawer open
Project Tools drawer open
cross-workspace subtitle drag state
pure Timeline MIN / NORMAL / MAX
narrow landscape fallback
```

---

# 13. 最终结论

推荐采用：

```text
Left  = 镜头 / 素材 / 角色
Center = Canvas
Right = 字幕 / 属性 / 项目工具
Bottom = pure Timeline
```

这次重构的核心价值不是“左右各三个按钮更对称”，而是：

> **把资源、画面、编辑上下文、时间四类职责重新放回各自稳定的空间。**

尤其字幕编排从“底部 Task Tray 挤 Canvas”改成“右侧字幕工作区 + 底部时间轴”，可以直接解决真人验收暴露出的核心冲突：

```text
拖字幕时必须同时看 Canvas
```

工程上应坚持：

```text
迁 presentation
不复制 owner
```

推荐后续实施顺序：

```text
R1 Right Workspace shell
-> R2 Subtitle Workspace + cross-workspace drag
-> R3 Pure Timeline rebaseline
-> LM-004 Canvas flatten / viewport controls relocation
```

视觉设计在实施 Issue 创建前或 R1 开工前补齐即可。