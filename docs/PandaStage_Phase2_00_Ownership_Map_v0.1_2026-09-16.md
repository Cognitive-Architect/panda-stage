# Panda Stage｜Phase 2 / 00：Ownership Map
## 样式归属地图 v0.1

日期：2026-09-16  
仓库：`Cognitive-Architect/panda-stage`  
父路线图：#529  
研究快照：`69d765f71c647ec746303568d400d662981e5b52`（PR #540 的 Phase 1 最终分片版本）  
文件性质：**供评审的模块级归属地图；不是逐规则自动搬迁清单；尚未批准生产修改。**

> **核心结论：先给样式明确维护责任，再按原有先后关系迁移。一个模块可以拥有多个有序样式段，不能为了文件分类整齐而改变生效顺序。**
>
> 人话：给箱子贴“厨房”“卧室”的标签，不等于可以把菜谱的下锅顺序也重新排一遍。

---

## 1. 背景、目标与本轮边界

#529 对第二阶段的定义是：在安全拆分的基础上，按真实职责而不是任意行号组织样式；功能负责内部布局，外壳负责工作区几何；不明确或跨领域的规则留在有标识的兼容层，未确认使用情况与行为之前不能删除。[E01]

本图回答三件事：

1. 这组样式主要由哪个代码模块维护，哪些页面只是使用它？
2. 现有 S01–S16 中哪些区域涉及该模块，哪里有外壳/功能/共享组件交叉？
3. 下一批可以怎样缩小范围、保留原顺序，并让现有校验继续检查真实产品代码？

本轮只读 GitHub 源码并生成地图，没有修改仓库、开新工单、提交 PR、触发构建或 CI，也没有运行 Windows 应用。

### 1.1 三类信息不混用

| 标记 | 含义 |
|---|---|
| 已核对事实 | 从本快照的真实文件、组件输出、导入或目录中直接看到 |
| 本图建议 | 目标目录、分批方法、兼容段保留方式和首批试点；不是仓库已经实施或已经批准的规则 |
| 待核对 | 全部消费者、准确搬迁边界、完整覆盖关系、运行时可达性等尚缺证据的部分 |

**覆盖边界：16 个分片全部纳入导航索引，各片的代表性区域与关键组件已核对；没有完成 32,816 行逐规则归属、全量选择器匹配或完整样式覆盖关系图。** 因此本图不报告“已分类百分比”“死样式数量”或“已证明所有规则都可安全移动”。

本图已经能支撑模块责任评审和一个有边界的实施试点；不应把全仓穷举设为每次开工的前置条件，也不应把本图直接喂给脚本盲搬整个仓库。

### 1.2 基线与交付状态

| 项目 | 记录 |
|---|---|
| 本轮研究提交 | `69d765f71c647ec746303568d400d662981e5b52` |
| 来自 | PR #540 / `agent/issue-539-p1-08` |
| 调查开始时 PR 状态 | 已准备审查、仍开放、未合并 |
| 前七批合并后的 main 基线 | `f1c49620e49119ff22b711c1c9aaccf3dfd7946e` |
| Phase 1 原始源码参照 | `35fe7963a50e7bd9be68f1e39d12833c99bb4436` |
| 原始有效载荷范围 | L3–L32818，共 32,816 行，分为 16 片 |
| 当前入口 | `src/renderer/styles.css`：2 条基础导入 + S01–S16 共 16 条分片导入 |
| 本轮对 CI 的处理 | 使用既有阶段状态作为背景；没有重新运行或宣称重新验证 CI |

PR 快照与源码入口分别见 [E02]、[E04]；原始行号来自 [E03]。本图锁定提交，不把等待合并中的分支误写成当前 main。之后若代码提交变化，先比较新增差异，再决定哪些地图条目需要更新，不必无差别重做整份盘点。

---

## 2. 归属判定方法

### 2.1 “归谁管”分三个问题

**元素由谁产生？** 看实际组件生成的结构，不看按钮上的中文名称或 class 前缀猜测。

**谁决定放在哪里？** 子组件可以来自一个功能模块，但外壳可能决定其宽度、停靠位置和滚动区域。

**这条声明改的是谁的责任？** 修改全工作区高度，与修改一张表情卡里的缩略图高度，是不同层级的工作。

本图中的 owner 是**代码模块的维护责任**，不是指定某位开发者。

### 2.2 采用的判定顺序（本图建议）

- 原生元素/根节点的基础规则归基础层；保留现有公用基础，不趁机重做主题。
- 组件内部排布、图片、文字和状态归组件所在功能。
- 外壳的工作区宽高、停靠、导航与跨区滚动安排归外壳。
- 宿主对被嵌入组件的特殊布局归“宿主整合段”，同时记录被影响的组件；不要复制组件基础样式。
- 一条规则跨多个责任、或一个条件块混装多个功能且无法证明可拆时，先整块保留原位置，并记录待解原因。

**重要限制：长选择器的第一个祖先不自动拥有整条规则；最后一个类名也不自动拥有整条规则。** 需要同时看元素生产者、承载关系与声明作用。[E26][E27][E31][E40]

### 2.3 证据等级

| 等级 | 本图用法 | 不能据此宣称 |
|---|---|---|
| A | 代表性规则与相关组件输出/实际装配已有直接证据 | 所有同前缀规则、所有消费者均已核对 |
| B | 样式、目录或导入关联已确认，逐条生产者/边界仍需补齐 | 已完成可执行搬迁范围 |
| A/B | 一个模块内部分内容直接核对，部分仍是关联级 | 整个模块等同 A 级 |
| 保留项 | 跨域/顺序/条件/可达性问题尚未解决 | 可以删除、放到最后或随便找一个 owner |

以上等级描述证据完整度，不是“模块代码质量评分”。

---

## 3. 模块级归属总表

**路径说明：** `styles/...` 均以 `src/renderer/` 为根，是本图建议的样式组织位置，**不是已经存在的目录，也不是推荐加载次序**。同一目录内可以有多个保留原始位置的片段。表中“出现分片”包括已读代表性段与地图明确提示的相关区域，不是该模块全部规则的穷举。

| 编号 / 维护责任 | 实际代码归属或关联 | 代表性样式 / 出现分片 | 建议样式位置 | 证据 |
|---|---|---|---|---|
| **O00 已有公用视觉基础** | `styles/tokens.css`<br>`styles/primitives.css`<br>`ui/` | 现有公用基础保持<br>未给出完整分布 | `原路径保持` | B；[E01] [E04] [E05] |
| **O01 全局基础与原生控件** | `styles/legacy-slices/01-shell-import-review-base.css` | `:root`、`*`、`html, body, #root`<br>S01 | `styles/base/native-foundation/` | A；[E20] [E04] |
| **O02 编辑器外壳与工作区** | `shell/EditorShell.tsx`<br>`shell/ResourceActivityDock.tsx`<br>`shell/BottomWorkspace.tsx`<br>其余见结构化台账 | `.editor-shell`、`.editor-layout`、`.resource-activity-*`<br>S01、S06、S07、S10、S12 | `styles/shell/workspaces/` | B；[E07] [E20] [E26] [E29] [E31] [E41] |
| **O03 右侧工作区与属性容器** | `shell/RightWorkspace.tsx`<br>`shell/RightInspector.tsx`<br>`shell/PortraitPropertiesSections.tsx` | `.right-workspace*`、`.right-activity-rail*`、`.right-inspector*`<br>S01、S07、S08、S11、S15 | `styles/shell/right-workspace/` | A/B；[E40] [E07] [E20] [E27] [E30] [E54] |
| **O04 工具页宿主** | `shell/ProjectToolsDrawer.tsx`<br>`shell/LegacyWorkspace.tsx` | `.project-tools-view-mode-*`、`.project-tools-action-presets-view`、`.project-tools-drawer*`<br>S10、S11 | `styles/shell/tools/` | A；[E30] [E42] |
| **O05 项目入口与最近项目** | `shell/StartScreen.tsx`<br>`shell/ProjectCenterScreen.tsx`<br>`shell/NewProjectEntry.tsx`<br>其余见结构化台账 | `.project-center-*`、`.project-launcher-*`、`.launcher-*`<br>S01、S03、S04、S05 | `styles/shell/project-entry/ + styles/features/welcome/` | A/B；[E03] [E20] [E23] [E56] [E50] |
| **O06 项目恢复与保存提示** | `features/recovery/`<br>`shell/RecoveryCandidateBanner.tsx`<br>`shell/CompactProjectBar.tsx` | `.recovery-*`、`.clean-state`、`.dirty-state`<br>S01、S05 | `styles/features/recovery/ + styles/shell/project-status/` | B；[E06] [E07] [E20] [E56] [E50] |
| **O07 素材库** | `features/assets/AssetLibrary.tsx`<br>`features/assets/AssetGrid.tsx`<br>`features/assets/AssetCard.tsx`<br>其余见结构化台账 | `.asset-library*`、`.asset-grid`、`.asset-card*`<br>S01、S05、S07、S09 | `styles/features/assets/` | A/B；[E20] [E24] [E26] [E03] [E48] |
| **O08 画布内部** | `features/canvas/CanvasStage.tsx`<br>`features/canvas/CanvasViewport.tsx`<br>`features/canvas/CanvasToolbar.tsx`<br>其余见结构化台账 | `.project-canvas*`、`.canvas-viewport*`、`.canvas-logical-stage`<br>S06 | `styles/features/canvas/` | B；[E25] [E41] [E06] |
| **O09 镜头管理** | `features/shots/` | `.shot-manager*`、`.shot-list*`、`.shot-editor*`<br>S05 | `styles/features/shots/` | B；[E55] [E56] [E06] |
| **O10 角色工作区与表情** | `features/characters/CharacterManager.tsx`<br>`features/characters/CharacterList.tsx`<br>`features/characters/CharacterEditor.tsx`<br>其余见结构化台账 | `.character-workspace-*`、`.character-settings-*`、`.character-default-*`<br>S05、S10、S15、S16 | `styles/features/characters/workspace/` | A/B；[E55] [E29] [E34] [E35] [E44] [E45] |
| **O11 角色身份公用组件** | `features/characters/CharacterIdentity.tsx`<br>`features/dialogue/DialogueBatchPaste.tsx` | `.character-identity-*`、`.character-avatar-fallback*`<br>S15 | `styles/features/characters/identity/` | A/B；[E34] [E46] [E54] |
| **O12 图片选择器组件** | `features/characters/ImageAssetPicker.tsx`<br>`features/characters/CharacterEditor.tsx` | `.image-asset-picker-*`、`.image-asset-picker-inline`<br>S14、S16 | `styles/features/characters/image-picker/` | A；[E33] [E35] [E43] [E45] |
| **O13 台词与字幕任务编辑** | `features/dialogue/DialogueSheet.tsx`<br>`features/dialogue/DialogueInspector.tsx`<br>`features/dialogue/DialogueBatchPaste.tsx` | `.dialogue-sheet*`、`.dialogue-authoring-*`、`.dialogue-batch-*`<br>S02、S08、S09、S12、S13、S14、S15 | `styles/features/dialogue/` | A/B；[E10] [E40] [E28] [E31] [E32] [E33] [E46] [E54] |
| **O14 字幕样式控件与渲染** | `features/subtitles/SubtitleStyleControls.tsx`<br>`features/subtitles/SubtitleRenderer.tsx` | `.dialogue-subtitle-style-*`<br>未给出完整分布 | `styles/features/subtitles/` | B；[E11] [E47] |
| **O15 时间轴内部与片段** | `features/timeline/TimelineDock.tsx`<br>`features/timeline/DialogueClip.tsx`<br>`features/timeline/AudioClip.tsx`<br>其余见结构化台账 | `.timeline-*`、`.dialogue-clip*`<br>S01、S11、S12、S13 | `styles/features/timeline/` | B；[E13] [E20] [E30] [E31] [E32] |
| **O16 图层属性控件** | `features/properties/LayerPositionPanel.tsx`<br>`features/properties/LayerTransformPanel.tsx`<br>`features/properties/LayerBackgroundControl.tsx`<br>其余见结构化台账 | `.layer-position-*`、`.layer-transform-*`、`.layer-background-*`<br>S01、S06、S08、S11 | `styles/features/properties/` | B；[E12] [E20] [E25] [E27] [E30] |
| **O17 动作预设** | `features/actions/ActionPresetPanel.tsx`<br>`features/actions/PresetParameterForm.tsx` | `.action-preset-*`<br>S11 | `styles/features/actions/` | B；[E06] [E30] [E42] |
| **O18 撤销重做/历史控件** | `features/editor/HistoryControls.tsx`<br>`features/editor/useHistoryShortcuts.ts` | `.history-controls`<br>S01 | `styles/features/editor/history/` | B；[E09] [E20] |
| **O19 FLA 审查与渲染工作台** | `fla-import/FlaCompatibilityReviewSession.tsx`<br>`fla-import/FlaRenderWorkbench.tsx`<br>`fla-import/FlaStaticSnapshotReview.tsx`<br>其余见结构化台账 | `.fla-review-*`、`.fla-render-*`、`.fla-snapshot-*`<br>S01、S02、S03、S04、S13 | `styles/features/fla-import/` | B；[E08] [E20] [E21] [E22] [E03] [E32] |
| **O20 预览与调试/验收表面** | `App.tsx`<br>`shell/ProductPreviewOverlay.tsx`<br>`stage/StagePreview.tsx` | `.gate-preview-overlay`、`.debug-probe-surface`、`.app-header`<br>S01、S05 | `styles/shell/preview/ + styles/legacy/probes/` | A/B；[E07] [E20] [E56] [E49] |

### 3.1 各模块边界说明

**O00｜已有公用视觉基础。** 保留 tokens、primitives 与 ui 现有实现；本阶段不统一所有按钮。这里只确认入口与公用基础存在；没有审计或授权重写其内部规则。 [E01] [E04] [E05]

**O01｜全局基础与原生控件。** 根节点、盒模型、页面基础、原生按钮基础状态。全局基础本来就跨组件；须保留它相对 tokens/primitives 与后续覆盖的位置，不把旧绿色按钮重做成统一组件。 [E20] [E04]

**O02｜编辑器外壳与工作区。** 主布局、左右工作区、资源容器、底部区域及外壳可用空间。其中 CanvasWorkspace 的实际输出已直接核对；其他外壳路径已确认但未逐规则配对。触及 feature 子控件的选择器另记宿主整合责任。 [E07] [E20] [E26] [E29] [E31] [E41]

**O03｜右侧工作区与属性容器。** 右侧导航、属性抽屉边框/宽度/开合、空态与承载关系。RightWorkspace 装配已直接核对；图层控件内容不全归外壳，字幕编辑也不因放在属性页就改归 properties。 [E40] [E07] [E20] [E27] [E30] [E54]

**O04｜工具页宿主。** 画布模式按钮、工具页入口/导航及动作预设的承载布局。工具页负责展示与导航；canvasViewportStore 仍拥有视口模式，动作预设内部控件仍归 actions。S11 开头视图模式组适合首批候选。 [E30] [E42]

**O05｜项目入口与最近项目。** 启动页组合、当前项目卡与最近项目子面板。StartScreen 已直接核对；它使用 recovery-panel 类但不是所有恢复界面。入口组合归 shell，最近列表内部归 welcome；S03 其余范围由地图提示，待逐段确认。 [E03] [E20] [E23] [E56] [E50]

**O06｜项目恢复与保存提示。** 项目恢复提示内容；外壳内的放置另由外壳负责。目录/样式存在已确认，具体子规则需补元素生产者。不要把 FLA 导入恢复终态或 StartScreen 的复用类整个搬入此处。 [E06] [E07] [E20] [E56] [E50]

**O07｜素材库。** 素材导入展示、网格/卡片、详情预览、分类和分页。AssetGrid→AssetCard 已直接核对；竖/横屏资源容器的排版另有 shell 整合层。ImageAssetPicker 不因名字含 asset 自动归此模块。 [E20] [E24] [E26] [E03] [E48]

**O08｜画布内部。** 画布舞台、视口、适应/实际尺寸、拖放提示和选择反馈。已核对 CSS 与 CanvasWorkspace→CanvasStage 装配；未逐一展开全部 canvas 子组件。外壳给画布分多少空间不归内部视口单独决定。 [E25] [E41] [E06]

**O09｜镜头管理。** 镜头列表、缩略图、创建和详情的内部布局。S05 基础已读；其他分片里的镜头覆盖尚需全量定位。资源容器同时作用镜头/角色的规则先保留整条组合，不盲拆。 [E55] [E56] [E06]

**O10｜角色工作区与表情。** 角色列表/详情、设置页、表情列表与卡内编辑。角色设置及表情页装配已直接核对。图片选择器基础、身份选择基础分开登记，宿主特有布局仍由本模块负责。 [E55] [E29] [E34] [E35] [E44] [E45]

**O11｜角色身份公用组件。** 角色头像、身份选择器及通用选中/空态展示。共享是消费关系，不是复制规则或迁移到 ui 的授权。批量台词的引用已核对；台词宿主对身份控件的尺寸约束应另记 dialogue 整合责任。 [E34] [E46] [E54]

**O12｜图片选择器组件。** 未配置、已选、候选列表、卡内变体的通用展示。更换文案由选择器内部生成；清除按钮由 CharacterEditor 通过 selectedAction 注入。后者不应被错算成选择器自己的内置按钮。 [E33] [E35] [E43] [E45]

**O13｜台词与字幕任务编辑。** 单条/批量创建、待安排列表、已安排台词的文本/时间/角色/配音编辑。右侧“字幕”实际挂接 DialogueSheet；属性中的台词编辑仍有 dialogue 内容责任。以 dialogue 命名的样式控件或轨道块可能由别的模块产生，不能按前缀全收。 [E10] [E40] [E28] [E31] [E32] [E33] [E46] [E54]

**O14｜字幕样式控件与渲染。** 字号/颜色/描边/位置控件、画面上字幕的渲染。已直接核对 SubtitleStyleControls 输出 dialogue-subtitle-style-*，但完整 CSS 分布尚未穷举；渲染器的内部 CSS/行内样式还需检查，不虚构一个已有大样式块。 [E11] [E47]

**O15｜时间轴内部与片段。** 标尺、轨道、播放头、台词块/音频块、拖拽反馈。类名前缀 dialogue-clip 不能直接给 dialogue。底部工作区高度由 shell 协作；任务容器里的台词内容另归 dialogue；S13 混合条件块暂不能独立抽离。 [E13] [E20] [E30] [E31] [E32]

**O16｜图层属性控件。** 位置、大小/旋转、背景、图层顺序、锁定/删除等内部展示。已确认模块目录与代表性规则；右侧抽屉的整体宽度/滚动仲裁仍属 shell，不能把两个层级合成一个“属性 owner”。 [E12] [E20] [E25] [E27] [E30]

**O17｜动作预设。** 动作卡与参数表单内部展示。S11 所见主要是工具宿主对动作面板的覆盖，不足以穷举动作基础样式；先补完整定位。不要把业务状态挪进工具页。 [E06] [E30] [E42]

**O18｜撤销重做/历史控件。** HistoryControls 内部内容与按钮，外壳嵌入方式另记。features/editor 当前目录不能被当作主外壳的万能收纳处。顶部栏/底部区域对历史控件的覆盖是宿主整合样式。 [E09] [E20]

**O19｜FLA 审查与渲染工作台。** 导入审查、渲染目标/预览/详情、各阶段和终态展示。目标仅是样式的逻辑分组；不把解析器挪到 features。导入失败恢复终态仍归 FLA；S13 末尾同时含台词与音频轨的 900px 块必须单独保留。 [E08] [E20] [E21] [E22] [E03] [E32]

**O20｜预览与调试/验收表面。** 产品预览外壳、调试/验收专用结构的展示责任。App 中仍有真实输出与挂接；普通导航看不见不等于死代码。产品预览和调试预览不能按 preview 前缀合并；可达性未运行验证。 [E07] [E20] [E56] [E49]

---

## 4. S01–S16 全部来源索引

下面的行号是 **Phase 1 固定原文中的行号**，不是现在每个分片的本地行号，更不是 Phase 2 的已批准切口。准确切口要由后续单批预检产生。[E03]

“全部索引”表示没有遗漏任何一个分片编号；**不表示已逐条分析了每片的所有规则**。

| 来源 | 原文范围 / 行数 | 主要内容与候选责任 | 当前处置与核对深度 |
|---|---|---|---|
| **S01** | L3–L1951<br>1,949 行 | 全局基础；编辑器骨架；左右工作区；时间轴基础；项目/恢复；调试；FLA 基础<br>责任：O01, O02, O03, O05, O06, O07, O15, O18, O19, O20 | 不能整片改名 base.css；原生按钮、外壳与 FLA 基础混在一起。<br>本轮：完整内容阅读，未逐选择器穷举。[E20] |
| **S02** | L1952–L3916<br>1,965 行 | FLA 门户/审查/位图工作台；地图还标示台词工作区穿插<br>责任：O19, O13 | FLA 前段可定位；台词边界及其余段需实施时补齐，不把整片归 FLA。<br>本轮：代表性前段 + 地图概览。[E21] [E03] |
| **S03** | L3917–L6019<br>2,103 行 | FLA 导入终态；项目入口相关序列<br>责任：O19, O05 | 导入终态里的 recovery 不等同项目恢复；动画定义应与引用保留顺序。<br>本轮：前 220 行 + 地图概览。[E22] [E03] |
| **S04** | L6020–L8038<br>2,019 行 | 项目启动页后续；FLA 渲染工作台<br>责任：O05, O19 | 项目入口与 FLA 分别定位，不按 Launcher 文件名整个搬。<br>本轮：前 120 行 + 地图概览。[E23] [E03] |
| **S05** | L8039–L9839<br>1,801 行 | 素材库；角色基础；镜头基础；资源宿主适配；最近项目/恢复；预览<br>责任：O07, O10, O09, O02, O05, O06, O20 | 素材文件名严重低估混合程度；资源容器同时作用镜头/角色的组合规则需单独登记。<br>本轮：素材前段 + 角色/镜头/恢复等后段。[E24] [E55] [E56] |
| **S06** | L9840–L11883<br>2,044 行 | 画布内部；图层属性起点；地图列有竖屏基础<br>责任：O08, O16, O02 | canvas-workspace 外壳与 canvas-viewport 内部不能混为一个 owner。<br>本轮：前 260 行 + 地图概览。[E25] [E41] [E03] |
| **S07** | L11884–L13801<br>1,918 行 | 竖屏素材；资源工作区宿主；属性区前段<br>责任：O07, O02, O03 | 长 selector 同时有模式属性与功能节点；须看被修改元素及声明，不按首个祖先归外壳。<br>本轮：前 150 行 + 地图概览。[E26] [E03] |
| **S08** | L13802–L17819<br>4,018 行 | 属性容器与图层控件；竖屏台词创建/待安排<br>责任：O03, O16, O13 | 前段一条规则隐藏多个子组件标题，属于宿主整合，不是逐组件基础规则。<br>本轮：前 140 行 + 地图概览。[E27] [E03] |
| **S09** | L17820–L19783<br>1,964 行 | 竖屏台词精确编辑；横屏素材序列<br>责任：O13, O07, O02 | timeline 命名的字幕身份条也可能由台词编辑表面产生；不可按词归时间轴。<br>本轮：前 160 行 + 地图概览。[E28] [E03] |
| **S10** | L19784–L21802<br>2,019 行 | 横屏角色列表/详情/表情；资源宿主；工具页开头<br>责任：O10, O02, O04 | 角色局部变量及其引用必须成套盘点；不把 resource 祖先前缀当作素材库 owner。<br>本轮：前 130 行 + 地图概览。[E29] [E03] |
| **S11** | L21803–L23799<br>1,997 行 | 工具视图模式；动作预设宿主；属性空态/选中态；时间轴开头<br>责任：O04, O17, O03, O16, O15, O02 | 工具视图模式连续规则组可作首批候选；后面的动作宿主与属性/时间轴不随包搬走。<br>本轮：前 210 行 + 地图概览。[E30] [E42] [E03] |
| **S12** | L23800–L25876<br>2,077 行 | 横屏时间轴任务容器；待安排台词列表与操作<br>责任：O15, O13, O02 | 外壳→时间轴任务容器→台词内容三层组合；跨域不是死代码判据。<br>本轮：前 145 行 + 地图概览。[E31] [E03] |
| **S13** | L25877–L27997<br>2,121 行 | 已安排台词任务后续；FLA 渲染尾段；900px 混合条件块<br>责任：O13, O19, O15 | 末尾一个完整条件块同时含 FLA、台词属性、音频轨；先作为混合兼容单元保留。<br>本轮：L1780–2121 + 地图概览。[E32] [E03] |
| **S14** | L27998–L29794<br>1,797 行 | 台词列表/操作/属性后补规则；图片选择器<br>责任：O13, O12 | 选择器基础与台词属性相邻但不同 owner；不能仅因最新批次就优先统一外观。<br>本轮：L1330–1550 + 地图概览。[E33] [E03] |
| **S15** | L29795–L31795<br>2,001 行 | 角色身份基础/后补；台词/批量/属性宿主整合；角色工作区后续<br>责任：O11, O13, O03, O10 | 已看到身份基础后又出现 #496 覆盖及台词宿主规则；不能整个归角色。<br>本轮：L1–140、L400–760 + 地图概览。[E34] [E54] [E03] |
| **S16** | L31796–L32818<br>1,023 行 | 角色设置后补；张嘴图操作；420px 条件；表情卡内编辑；选择器卡内变体<br>责任：O10, O12 | 通用 inline 变体与表情宿主约束交错；保留其顺序与模式条件。<br>本轮：L850–1023 + 地图概览。[E35] [E03] |
---

## 5. 已确认的关键接缝：这些地方不能按名称搬

### 5.1 右边叫“字幕”，代码里不只一个“字幕模块”

`RightWorkspace.tsx` 生成右侧导航和容器；点击“字幕”时装入的是 `DialogueSheet`，点击“属性”装入 `RightInspector`，点击“工具”装入 `ProjectToolsDrawer`。[E40]

另一方面，真正的 `SubtitleStyleControls.tsx` 在 `features/subtitles/` 下，却输出 `dialogue-subtitle-style-*` 类名。[E47]

因此本图划分为：

| 实际事情 | 主责任 |
|---|---|
| 右侧三个入口及整个面板放哪里 | O03 外壳 |
| 台词创建、批量粘贴、文本/时间/配音编辑 | O13 台词编辑 |
| 字号、文字色、描边、位置等样式控件内部 | O14 字幕控件 |
| 时间轴上的台词块、音频块和拖拽反馈 | O15 时间轴 |

时间轴目录本身有 `DialogueClip.tsx` 和 `AudioClip.tsx`。[E13] **不能把 `.dialogue-*` 一次性全搬入 dialogue，也不能把所有“字幕”界面全搬入 subtitles。**

人话：门牌上写“字幕”，里面也分接待台、编辑桌和成品展示，不是同一个柜子。

### 5.2 图片选择器现在由“角色”模块提供，不是素材库的同义词

`ImageAssetPicker.tsx` 位于 `features/characters/`，接收图片素材和缩略图数据，并生成已选行、候选列表以及普通/卡内两种展示。[E43]

本图建议：

- `.image-asset-picker-*` 的组件基础和通用卡内变体归 O12。
- `.character-expression-workspace ... .image-asset-picker-inline ...` 属于表情宿主对选择器的整合约束，登记 O10 + 关联 O12。
- 资产数据/缩略图来自素材模块，并不意味着选择器内部界面要改归素材库。
- 现阶段不移动 TSX，不抽出新公用组件，不统一所有“更换/清除”按钮；那是第三阶段的工作。[E01][E35]

### 5.3 “更换”和“清除”甚至不是同一个组件生成的

真实结构可概括为：

```text
CharacterEditor（角色设置）
└─ ImageAssetPicker（选择器）
   ├─ 已选图片按钮
   │  └─ “更换 / 收起”文字
   └─ selectedAction 插槽
      └─ CharacterEditor 提供的“清除”按钮
```

“更换/收起”由选择器内部的 `image-asset-picker-selected-action` 文本生成；“清除”是角色编辑器创建的 `.character-mouth-clear` 按钮，经 `selectedAction` 传入。[E43][E45]

所以 O12 管选择器行与插槽的布局合同，O10 管角色“清除张嘴图”按钮的特有表现。**不能因为截图里挨在一起，就把全部操作定义成选择器自己的按钮。**

这条映射会直接帮助后续第三阶段的统一视觉试点，但本轮只记录，不执行统一。

### 5.4 角色身份组件有跨模块消费者

`DialogueBatchPaste.tsx` 实际从角色模块导入 `CharacterAvatar`、`CharacterIdentityPicker` 等。[E46]

S15 又存在台词宿主对身份选择器的整合规则，例如：

```css
.dialogue-authoring-speaker-field .character-identity-picker
.dialogue-batch-character-picker .character-identity-options
```

同时还存在属性摘要配合头像的布局。[E54]

因此：

**共享身份组件基础归 O11；批量/单条台词中的容器要求归 O13；右侧属性容器本身的整合归 O03。** 一份基础、多处消费，不复制成三份“差不多的角色选择器”。

### 5.5 S13 的 900px 条件块是跨域整块，不是“纯 FLA 文件尾巴”

本次直接阅读了 S13 的末段。其一个 `@media (max-width: 900px)` 中实际依次包含：

```text
FLA 渲染工作台窄屏规则
→ #441 台词属性规则
→ 音频轨选中/裁剪手柄/错误展示
→ 台词解绑配音等规则
→ 外层条件闭合
```

证据见 [E32]。Phase 1 原文该块到 L27996 才闭合。[E03]

本图将其登记为 **H01：跨域条件兼容单元**。首轮按原位置整块保留，不从中间按功能抽几条，更不能搬出外层条件后让窄屏规则变成全窗口规则。

这里也不判断旧 900px 范围是否产品上合理；改条件属于另一个需求。

### 5.6 工具页“管显示”，不代表它接管画布/动作状态

`ProjectToolsDrawer.tsx` 读取已有 `canvasViewportStore`，生成“适应窗口 / 实际尺寸”按钮；动作预设视图则承载 `LegacyWorkspace`，源码注释也明确保留动作预设的原业务 owner。[E42]

所以 O04 可以拥有两颗按钮的容器样式，但不能创建第二个画布模式状态；动作内部样式也不能因为出现在“工具”里就全部交给 shell。

**建议第一批只选择 S11 开头的视图模式连续规则组作为试点，不选择整个 S11。** [E30]

### 5.7 “恢复”“编辑器”“预览”三个名字也会误导

**恢复：** `StartScreen.tsx` 的项目入口使用 `.recovery-panel` 类；FLA 的 Stage G 又有导入失败恢复终态。[E50][E22] 两者都不能按 recovery 字符统一归项目恢复。

**编辑器：** 当前 `features/editor` 目录是 `HistoryControls.tsx` 与快捷键相关文件，不是 `EditorShell` 的替代目录。[E09]

**预览/调试：** `App.tsx` 仍构造 `.app-header`、`.ipc-check`、`.export-probe`，并向外壳提供调试表面和 `StagePreview`。[E49] 正常操作看不见这些内容，不能推导为可以删除。

---

## 6. 建议的目录模型与顺序策略

### 6.1 目录只表达责任，不承诺“一模块一文件”

以下是**建议模型**，尚未在仓库创建：

```text
src/renderer/styles/
  tokens.css                 # 已有，保持
  primitives.css             # 已有，保持
  base/
    native-foundation/
  shell/
    workspaces/
    right-workspace/
    tools/
    project-entry/
    project-status/
    preview/
  features/
    assets/
    canvas/
    shots/
    characters/
      workspace/
      identity/
      image-picker/
    dialogue/
    subtitles/
    properties/
    timeline/
    actions/
    editor/history/
    welcome/
    recovery/
    fla-import/              # 样式逻辑目录；不移动现有 fla-import 解析/业务代码
  legacy/
    ordered-mixed/           # 尚未证明可拆的跨域连续段
    probes/                  # 按证据保留的历史/调试展示
```

上述文件夹不应一次性全部创建。只在实际迁移到该责任时建立有内容的目录，避免造一座空的目录博物馆。

### 6.2 推荐先保序，不先按模块重新排序

假设原来的顺序是：

```text
角色基础 A
→ 台词宿主适配 B
→ 角色后补 C
```

安全的第一步可以是：

```text
导入 characters/某个有序段-A.css
→ 导入 dialogue/某个有序段-B.css
→ 导入 characters/某个有序段-C.css
```

不应未经证明就变为：

```text
导入 characters/全部角色规则.css（A + C）
→ 导入 dialogue/全部台词规则.css（B）
```

后一种已经把 C 与 B 的相对顺序反转。**每个文件本身没丢字，也不能证明最终生效关系没变。**

这里的 A/B/C 是说明例子，不是可执行文件名。正式批次应记录完整规则段的原始位置、来源与目标，不能用字母例子直接创建生产文件。

### 6.3 兼容层不能默认为“全放最后”

#529 给出 `legacy-overrides.css` 的目标示意，本质要求是模糊/跨域规则有清楚位置与责任。[E01]

本图建议初期允许多个**有序兼容段**，保留各自原始位置。是否最终收敛为一个兼容文件，要在相对顺序证明成立之后决定。不能为了目录漂亮，把未知规则都挪到末尾，悄悄提高它们的覆盖优先级。

### 6.4 18 条 import 是第一阶段的成果，不是第二阶段永远不许变化的数字

第二阶段若需要保留交错顺序，导入数量可能改变；真正必须守住的是：

**入口仍只负责加载；顺序清楚；每段只加载一次；加载结果可证明；没有恢复成一大坨功能正文。**

不要为了凑 18 条导入而套一层现有读取器看不懂的嵌套导入，也不要切成每条规则一个文件。优先使用有意义的连续规则组，分片数量随证据决定。

---

## 7. 兼容与待确认台账

以下是本轮发现的工作项类别，不是对全部遗留规则逐条计数。

| 编号 | 具体问题 | 当前处置 | 解除条件 |
|---|---|---|---|
| **H01 S13 混合 900px 条件块** | 同一 @media (max-width: 900px) 内存在 FLA 渲染、台词属性及音频轨选中/裁剪规则。 [E32] | 保留整体与原加载位置 | 记录完整外层条件与首尾；证明整体移动不改变相对顺序。拆分条件块不属于首批默认动作。 |
| **H02 外壳与功能控件整合规则** | 资源面板、属性抽屉、时间轴任务容器会约束多个子控件。 [E20] [E26] [E27] [E31] [E40] | 逐段判定整合 owner | 确认元素生产者、承载组件与实际声明作用；指定一个整合 owner 和受影响模块，不用多人共同负责代替结论。 |
| **H03 多模块共享一条选择器列表** | S01/S05 有素材/镜头/角色同处一条逗号选择器列表的声明。 [E20] [E56] | 不自动拆成多条 | 先保留完整规则；若要拆开，单独证明相对位置、条件和行为仍等价，不能按所属模块一分了之。 |
| **H04 同类规则先后覆盖链** | 身份摘要、角色设置、图片选择器存在基础规则、上下文适配与后补覆盖。 [E34] [E54] [E35] | 待全量定位相对位置 | 记录在真实加载序列中的原始先后，不只核对每个文件内容哈希。完整覆盖关系图本轮未建立。 |
| **H05 调试/历史界面可达性** | App 仍输出调试探针并向 EditorShell 提供 gatePreview；一般页面未展示不代表无消费者。 [E20] [E49] | 未执行运行时核对；不得删除 | 结合门控路径和已有相关测试核对，不为截图恢复新入口；未覆盖状态原样登记。 |
| **H06 读取器和校验器仍绑定 Phase 1 文件形态** | 读取器单层展开连续 import；校验器要求16分片的旧路径/原始范围与精确文本。 [E51] [E52] | 首个实施批次需最小适配 | 保留 Phase 1 证据；让现有校验根据获批的 Phase 2 段映射读取真实入口，不删旧断言或让测试只读归档副本。 |
| **H07 继承、局部变量、资源路径和动画引用** | 素材与角色基础有局部 CSS 变量，FLA 终态有动画引用及 @keyframes。 [E24] [E29] [E22] | 随触达范围补齐依赖 | 记录定义/使用上下文与引用资源的新旧目标；不把“前批没风险”当成本批无需扫描的依据。 |
| **H08 尚未逐规则定位的剩余源码** | 本地图覆盖全部16片的导航级范围，但不是全部32,816行的逐规则归属清单。 [E03] | 原样留在已知顺序的兼容段 | 每批只补该批准确首尾、消费者和顺序证据；未分析代码不强行归类，不报告虚构覆盖率。 |
| **H09 窗口条件和显式模式属性交叉** | 已读样式同时使用720、900、700/701、420px条件与 landscape/portrait 属性。 [E20] [E26] [E32] [E35] [E54] | 保持原条件；可达性另记 | 仅对触达条件记录实际内容视口与模式；不能用截图宽度或“竖屏”两个字替代条件是否命中的证据。 |
---

## 8. 现有工具如何接上第二阶段

### 8.1 不能直接拿第一阶段校验器接受改名后的文件

当前 `verify-css-split.cjs` 检查：

- 入口前两条基础导入；
- manifest 中各分片目标路径与排列；
- 每片与原文精确范围一致；
- 未搬尾段与重建文本一致。[E52]

因此第二阶段开始把某片拆进职责目录后，旧“16 个指定文件路径”的合同需要**有记录地接续**，不能靠删校验或改几个 expected 值混过去。

**本图建议：** 第一批在既有校验体系中增加最小的“原始规则段→新路径→原位置”映射；保留 Phase 1 的原文基线和历史证据。让校验继续检查当前生产入口真正加载的文件，而不是只检查一套不再被产品加载的归档样式。

只为本次路径/段映射扩展，不新造通用 CSS 平台，不无限追加检查。

### 8.2 当前源码读取辅助函数不是通用浏览器导入解析器

`readOrderedStylesheetSource()` 的实际行为是：

1. 从入口第一行开始读取连续的简单 `@import`；
2. 遇到第一条不匹配的行停止收集导入；
3. 前两条基础 import 保留为文本；
4. 后续导入文件只展开一层，直接拼接文件内容，不递归解析它们内部的 import。[E51]

因此下面两种设计**不能直接假设与现有验证兼容**：

```text
在入口 import 中间随意夹注释/空行
在新文件内再写一串 @import，形成嵌套目录页
```

这些结构可能被浏览器正常理解，但现有测试读取器未必读取到同一批规则。第一批要么保持其当前可理解的入口形态，要么把必要的小范围能力补齐并加针对性测试。

### 8.3 最小充分的迁移证据

建议每个获批规则段保留下列字段；JSON 附件中的模块行尚未填准确切口，不能直接执行：

| 字段 | 必须说明什么 |
|---|---|
| 段编号 | 可追踪的稳定编号 |
| 来源提交、文件、完整首尾 | 确定是哪段真实源码，不是只写一个 class 前缀 |
| 原始次序 | 在实际入口展开序列中的位置 |
| 主 owner / 宿主与消费者 | 谁负责、在哪里被使用、哪些组合关系受影响 |
| 外层条件 | media、模式属性等上下文 |
| 新路径 | 本批获准创建/修改的目标 |
| 触达依赖 | 前后覆盖、局部变量、资源路径、动画引用等 |
| 校验与人工界面 | 本批真正需要的检查 |
| 状态/例外 | 候选、保留、预检通过、验收通过；任何例外明确记录 |

对采用保序策略的批次，优先证明**真实生产入口展开序列**与迁移前一致，而不是把段先按原序号重新排序后才比较——后一种会掩盖实际加载换序。

若未来某批确实需要重新排列功能样式，应另立明确范围和行为证据，不能把本图当作“顺序随便调”的授权。

### 8.4 验证预算与停手线

本图不触发测试。后续实施单应根据触达范围、当时的 AGENTS 与 CI 路由，列出最小充分验证。已核对仓库存在 `build:renderer`、`typecheck`、`lint`、单元/集成测试等命令；其中 `build:renderer` 对应 `vite build`。[E53]

首批重点是入口/段映射、直接受影响的读取测试、构建与工具页实机对照。所需的缺失/重复/换序/条件丢失等负例尽量补在现有相关测试里，不为每项检查再建一整套框架。

禁止未经授权手动全量 CI、`pnpm verify:project`、历史验证脚本套餐，或为了修一个读取失败开始追查不相关的旧债。正常仓库自动 CI 照常运行。[E05][E01]

---

## 9. 建议的实施批次

这是本图建议的 7 个后续批次主题，**尚未创建 GitHub Issue，也不是承诺必须恰好 7 个 PR**。有高耦合时拆小；无实质内容时合并记录，不为凑编号造工作。

P2-00 的交付就是本地图，不再另开一个只写“研究已完成”的任务。

### P2-01｜最小校验接续 + 工具页视图模式试点

**范围：** S11 开头 project-tools-view-mode-* 连续完整规则组；准确边界由本批现有预检确认。

**不做：** 不迁动作预设内部、不顺带搬全部属性或时间轴，不宣布整个工具模块已迁完。

**本批过关证据：** 同样的规则在同样的序列位置换路径；真实入口重建相等；工具页适应窗口/实际尺寸选中与切换展示无变化。

### P2-02｜素材与镜头：先内部后宿主适配

**范围：** 先定位卡片、网格、详情/镜头列表完整段；外壳整合规则单列。

**不做：** 不重做缩略图、导入/删除逻辑或跨模块通用卡片。

**本批过关证据：** 素材/镜头各自能按 owner 找到完整段；未迁跨域段位置保持，列表/详情/滚动与拖入反馈正常。

### P2-03｜角色工作区、身份组件与图片选择器

**范围：** 分别登记角色内容、共享身份/选择器基础及台词/表情宿主约束。

**不做：** 不做 Phase 3 按钮视觉统一、不复制身份或选择器基础、不把清除按钮错误归为选择器内置。

**本批过关证据：** 角色与台词中的消费者一起检查；空/已选/展开、设置和单卡编辑保持；基础→适配→后补顺序保留。

### P2-04｜台词任务与字幕样式控件

**范围：** 台词列表/创建/精确编辑与 SubtitleStyleControls 分开；宿主整合另记。

**不做：** 不凭 dialogue 前缀收走时间轴块或字幕样式控件；不改台词业务。

**本批过关证据：** 创建/批量/待安排/精确编辑与字幕样式控件保持，跨模块身份选择不复制。

### P2-05｜画布、图层属性、时间轴和外壳接缝

**范围：** 先区分内部显示与外壳宽高/滚动责任；按接缝划小批，不一单搬完。

**不做：** 不同时重做左右栏/时间轴结构，不改存储或拖拽状态。

**本批过关证据：** 适应/实际尺寸、属性折叠、时间轴开合、切换/焦点及相关宽窄条件保持。

### P2-06｜项目入口、恢复、工具动作与预览剩余

**范围：** 分别处理入口组合、最近项目、恢复提示、动作内部和预览/调试存量。

**不做：** 不按 recovery/preview 类名前缀吞并全部规则，不恢复废弃入口。

**本批过关证据：** 真实生产入口与已有可达状态保持；调试/历史未覆盖项列明，不当作死代码删除。

### P2-07｜FLA 工作台与兼容层收口

**范围：** 分审查、渲染、终态定位；H01 等跨域段在未获证明前保持整块与原顺序。

**不做：** 不碰解析器/导入事务；不把混合900px块扔进最后一个 FLA 文件。

**本批过关证据：** 工作台/滚动/终态及触达断点保持；剩余兼容段可定位、有责任和未解原因；形成 Phase 2 总回执。

### 9.1 推荐先从 P2-01 开始的原因

S11 开头的工具视图模式规则与 `ProjectToolsDrawer` 的实际输出已经对应，页面就是用户熟悉的“适应窗口 / 实际尺寸”两颗按钮，适合作为**边界较清楚的首个候选**。[E30][E42]

这不是宣称它在全仓绝对风险最低；本批开工仍需查清准确边界、相同规则的其他出现位置和必要前后依赖。其余动作/属性/时间轴内容不自动纳入。

第一批应同时带来真实小范围迁移和最小校验接续，避免“又研究一轮、产品代码一行没动”的无限前置工作。

### 9.2 与尚未合并的 PR #540 如何衔接

这份地图可以直接在固定的 #540 快照上评审，不需要空等 CI。

后续生产施工若 #540 仍未合并，可选择明确标注依赖 #540 的独立后续分支/PR；若已经合并，则从合并后基线开始。**这是需在实施单明确的协作选择，不由本图自动替用户选择或执行。**

无论哪种方式，都不把第二阶段生产修改直接塞回已经验收的 #540 来省事。固定父提交；父提交变动时只核对差异影响；不将未合并内容误称为 main 已交付。

---

## 10. 阶段验收与非目标

### 10.1 P2-00 本图的完成情况

| 交付项 | 本轮结果 |
|---|---|
| 真实阶段基线 | 已固定 #540 提交，不混用 main |
| 全部16片导航索引 | 已给出范围、主要主题、候选 owner、核对深度 |
| 模块责任表 | 已给出21个职责条目，包括冻结的公用基础 |
| 关键跨域关系 | 已给出实际代码证据与9类待确认/兼容问题 |
| 安全实施方向 | 给出保序分段、最小工具接续、首批试点与后续主题 |
| 逐规则自动搬迁清单 | 未提供；本图不批准自动搬迁 |
| 产品运行/构建/测试 | 本轮未执行，不把历史通过当作本轮测试 |
| GitHub写入 | 未创建 Issue/PR、未修改代码或路线图 |

### 10.2 第二阶段最终退出标准

沿用 #529 的四个目标：主要区域有 owner；新样式不再默认堆进入口；兼容/覆盖层清楚且可计量；维护者能快速找到规则所在模块。[E01]

本图建议最终回执再明确：

- 已归属区域能列出**真实新路径与原始来源**，不是只给旧分片加好听的名字。
- 每个保留兼容段有原始位置、关联责任、保留原因和解除条件；不要求为了“清零”强行搬走。
- 实际加载顺序与条件、资源目标均有证据，重要界面完成对应人工检查。
- 新 UI 应去哪里增加样式有简短说明，不重建一个巨型入口文件。
- 只有真实统计后才报告规则/行数/覆盖率；本次21个职责条目与9类问题不等于源码数量。

### 10.3 本阶段仍不包含

不重做界面，不统一全部按钮，不更换深蓝主题，不修改字幕/角色业务，不随手去重，不删除“看起来没用”的历史规则，不改组件结构来迁就 CSS。

“按真实责任组织”也不是“把相同前缀全搬进一个文件”。第三阶段共享视觉合同和第四阶段存量清理仍另行实施。[E01]

---

## 11. 建议的唯一下一步

**评审采用本图的责任划分后，创建 P2-01：现有校验工具最小接续 + 工具页视图模式连续规则组迁移。**

实施单只授权该试点与必要测试接线，要求精确段清单、保序证明、工具页人工验收；不要一次性派出全部后续主题。

---

## 附录 A｜证据索引

所有仓库文件链接固定到研究提交；#529 和 #540 是本轮读取的路线图/状态入口，后续内容可能继续变化。
“文件链接”不表示全文逐条审计，具体阅读范围见正文第4节与结构化台账。

| 编号 | 证据 |
|---|---|
| [E01] | 父路线图 #529：Phase 2 定义、边界、退出条件 |
| [E02] | PR #540：调查开始时的状态与研究提交 |
| [E03] | Phase 1 Section Map：分片范围与原始顺序 |
| [E04] | 当前真实样式入口：18 条 import |
| [E05] | 仓库 AGENTS：模块职责与验证预算 |
| [E06] | 功能目录：实际存在的 12 个一级目录 |
| [E07] | 外壳目录：工作区、项目入口、属性抽屉等 |
| [E08] | FLA 前端目录：位于 features 之外 |
| [E09] | 编辑器功能目录：历史控件，不等同于整个编辑器外壳 |
| [E10] | 台词编辑目录：列表、批量粘贴、属性编辑 |
| [E11] | 字幕目录：渲染器与字幕样式控件 |
| [E12] | 图层属性目录：背景、顺序、位置、变换 |
| [E13] | 时间轴目录：轨道、台词块、音频块、待安排交互 |
| [E20] | S01 代表性样式证据 |
| [E21] | S02 代表性样式证据 |
| [E22] | S03 代表性样式证据 |
| [E23] | S04 代表性样式证据 |
| [E24] | S05 代表性样式证据 |
| [E25] | S06 代表性样式证据 |
| [E26] | S07 代表性样式证据 |
| [E27] | S08 代表性样式证据 |
| [E28] | S09 代表性样式证据 |
| [E29] | S10 代表性样式证据 |
| [E30] | S11 代表性样式证据 |
| [E31] | S12 代表性样式证据 |
| [E32] | S13 代表性样式证据 |
| [E33] | S14 代表性样式证据 |
| [E34] | S15 代表性样式证据 |
| [E35] | S16 代表性样式证据 |
| [E40] | 右侧工作区真实装配：字幕、属性、工具 |
| [E41] | 画布外壳只承载 CanvasStage |
| [E42] | 工具页真实输出与状态来源 |
| [E43] | 图片选择器：普通/卡内变体、已选按钮、注入操作 |
| [E44] | 角色编辑器：表情/设置页签与默认变换区 |
| [E45] | 清除按钮由 CharacterEditor 注入选择器 |
| [E46] | 批量台词跨模块使用角色身份组件 |
| [E47] | 字幕样式控件实际输出 dialogue-subtitle-style-* |
| [E48] | 素材网格输出与 AssetCard 委托 |
| [E49] | App 中仍挂接的调试与验收预览结构 |
| [E50] | 项目启动页组合 RecentProjectsPanel，并复用 recovery-panel 类 |
| [E51] | 现有等价源码读取辅助函数：连续 import、单层展开 |
| [E52] | 现有 Phase 1 校验器：精确路径、分片原文与顺序约束 |
| [E53] | 实际存在的构建/测试命令 |
| [E54] | S15：身份组件与台词/属性宿主适配、700/701px 与后续覆盖 |
| [E55] | S05：角色基础与镜头基础 |
| [E56] | S05：资源宿主组合、最近项目、恢复与预览交界 |
| [E57] | 素材模块文件目录核对 |
| [E58] | 画布模块文件目录核对 |
| [E59] | 动作模块文件目录核对 |

## 附录 B｜结构化台账使用说明

同名 `.json` 附件包含：

- 基线和本轮不执行事项；
- 职责登记表；
- 16 个来源分片；
- 兼容/待确认台账；
- 建议批次；
- 来源链接与最小规则段字段。

**`approved_for_automatic_relocation = false`。** 它给 Codex 保存上下文和编写实施单使用，不是可以直接运行的切割脚本配置。模块条目的 `exact_relocation_ranges` 保持为空，避免把尚未验证的行号装成已经批准的切口。

本轮仅校验了交付物自身：JSON 可解析、编号与证据引用一致、16个原文范围连续且行数合计32,816。没有把这些文档检查冒充为产品 CSS 重建或 Windows 验收。

## 自动存档

```text
=== AUTO SAVE v1.1 ===
时间：2026-09-16
阶段：归纳 / 写作
本次变化 Delta：Phase 2 从阶段定义推进为有源码证据的模块级 Ownership Map v0.1。
做了什么（结果）：
- 固定研究提交 69d765f71c647ec746303568d400d662981e5b52。
- 产出21个职责条目、16片来源索引、9类兼容/待确认项、7个建议批次主题。
- 明确元素生产者、宿主责任与加载顺序分开记录。
- 记录选择器/清除按钮分属不同生产者、台词与字幕控件分属不同模块、
  S13混合900px块，以及现有读取器/校验器的第二阶段接续要求。
- 生成Markdown正文与JSON规划台账；未修改GitHub仓库或触发测试。
当前状态（一句话）：P2-00模块级地图已交付供评审；不等同逐规则自动搬迁清单。
下一步（唯一可执行）：评审采用本图后，为工具页视图模式规则组创建P2-01正式实施单。
止损条件：若要凭类名前缀批量迁移、改变条件/顺序、削弱现有校验或混入视觉改造，停止该批。
反话闸门：模块关联证据不证明每条规则可移动；每批仍需准确边界、实际加载序列与对应人工验收。
风险 / 未验证：完整逐规则消费者与覆盖图未建立；运行时可达性未重验；#540后续提交变化须核对影响。
置信度（0-5）：4（模块级职责与已读关键接缝）；自动搬迁尚未批准。
=================
```


[E01]: https://github.com/Cognitive-Architect/panda-stage/issues/529
[E02]: https://github.com/Cognitive-Architect/panda-stage/pull/540
[E03]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/docs/PandaStage_Phase1_Section_Map_v1.0_2026-09-15.md
[E04]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles.css
[E05]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/AGENTS.md#L1-L200
[E06]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features
[E07]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/shell
[E08]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/fla-import
[E09]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/editor
[E10]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/dialogue
[E11]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/subtitles
[E12]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/properties
[E13]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/timeline
[E20]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/01-shell-import-review-base.css
[E21]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/02-review-workbench-dialogue.css#L1-L600
[E22]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/03-terminal-launcher-sequence.css#L1-L220
[E23]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/04-launcher-render-workbench.css#L1-L120
[E24]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/05-asset-library-stage-sequence.css
[E25]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/06-canvas-portrait-foundation.css#L1-L260
[E26]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/07-portrait-assets-inspector-start.css#L1-L150
[E27]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/08-inspector-portrait-dialogue.css#L1-L140
[E28]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/09-portrait-timed-landscape-assets.css#L1-L160
[E29]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/10-landscape-characters-tools-start.css#L1-L130
[E30]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/11-tools-inspector-timeline-start.css#L1-L210
[E31]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/12-landscape-task-tray.css#L1-L145
[E32]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/13-timed-render-media-tail.css#L1780-L2121
[E33]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/14-dialogue-polish-image-picker.css#L1330-L1550
[E34]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/15-character-identity-workspace-start.css#L1-L140
[E35]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/16-character-settings-final-polish.css#L850-L1023
[E40]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/shell/RightWorkspace.tsx
[E41]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/shell/CanvasWorkspace.tsx
[E42]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/shell/ProjectToolsDrawer.tsx
[E43]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/characters/ImageAssetPicker.tsx
[E44]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/characters/CharacterEditor.tsx#L430-L680
[E45]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/characters/CharacterEditor.tsx#L685-L760
[E46]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/dialogue/DialogueBatchPaste.tsx#L1-L80
[E47]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/subtitles/SubtitleStyleControls.tsx#L95-L245
[E48]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/assets/AssetGrid.tsx
[E49]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/App.tsx
[E50]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/shell/StartScreen.tsx#L1-L180
[E51]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/tests/helpers/read-stylesheet-source.ts
[E52]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/scripts/verify-css-split.cjs#L425-L545
[E53]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/package.json#L1-L125
[E54]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/15-character-identity-workspace-start.css#L400-L760
[E55]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/05-asset-library-stage-sequence.css#L700-L1150
[E56]: https://github.com/Cognitive-Architect/panda-stage/blob/69d765f71c647ec746303568d400d662981e5b52/src/renderer/styles/legacy-slices/05-asset-library-stage-sequence.css#L1151-L1801

[E57]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/assets
[E58]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/canvas
[E59]: https://github.com/Cognitive-Architect/panda-stage/tree/69d765f71c647ec746303568d400d662981e5b52/src/renderer/features/actions
