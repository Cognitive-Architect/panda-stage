# Panda Stage 云电脑移动编辑器 Main-ready UI 实施 Issue 规格 v0.1

> 状态：`ISSUE SPEC / DOCS ONLY`
>
> 日期：2026-08-24
>
> 实施基线：[`main@3c47a4ee8af07e834338b223fcb3260a4c6dddbc`](https://github.com/Cognitive-Architect/panda-stage/commit/3c47a4ee8af07e834338b223fcb3260a4c6dddbc)
>
> 设计来源：[`PR #306`](https://github.com/Cognitive-Architect/panda-stage/pull/306) `@31718ada6e7a7e531b1ef86d8f7ee1b61902e42e`
>
> 目标环境：Windows / Electron 通过阿里无影云电脑串流至 Redmi K60 Ultra，优先手机横屏与竖屏触控使用。
>
> 权限边界：本文把当前 `main` 可立即实施的 UI 工作整理为六份可建票规格。本文和承载本文的文档 PR 本身不授权生产代码修改；每个实施 Issue 仍需单独创建、确认范围并交付独立 PR。

## 1. 背景与目标

PR #306 已归档 Panda Stage 云电脑手机编辑器的横屏、竖屏、左右栏、字幕和 FLA 概念蓝图。当前产品实现则存在一条明确的集成边界：

- `main` 已拥有 Day26 的 Timeline / BottomWorkspace / 窄屏 Inspector 基础、Day27 的 Dialogue authoring、Day28 的 Dialogue timing / Subtitle track，以及 PR #274 的 FLA V1.5；
- Day29 Dialogue Audio / Mouth / Product Preview 仍位于 PR #233；
- FLA V2-R 单帧 / 帧序列仍位于 PR #285；
- FLA V1.5-C compatibility recovery 仍位于并行 Draft 链；
- PR #306 是设计归档，不是已交付生产界面。

因此本规格不把整套 UI 重构写成一个巨型 Issue，也不把未合并 Draft 当作 `main` 已有能力。目标是先交付六个可以从当前 `main` 安全起步、能独立验收、并为后续字幕 / 素材 / FLA 集成降低冲突的基础 Issue。

## 2. 设计事实来源

### 2.1 上位设计文档

- [PR #306：云电脑移动编辑器设计归档](https://github.com/Cognitive-Architect/panda-stage/pull/306)
- [云电脑手机编辑器布局方案 v0.1](https://github.com/Cognitive-Architect/panda-stage/blob/31718ada6e7a7e531b1ef86d8f7ee1b61902e42e/docs/design/cloud-mobile-editor-layout-v0.1.md)
- [横屏交互与工作流蓝图 v0.2](https://github.com/Cognitive-Architect/panda-stage/blob/31718ada6e7a7e531b1ef86d8f7ee1b61902e42e/docs/design/cloud-mobile-editor-interaction-blueprints-v0.2.md)
- [竖屏工作区与流程蓝图 v0.3](https://github.com/Cognitive-Architect/panda-stage/blob/31718ada6e7a7e531b1ef86d8f7ee1b61902e42e/docs/design/cloud-mobile-editor-portrait-workflows-v0.3.md)

### 2.2 本批实施直接引用的蓝图

- [横屏 v0.1 主界面](https://github.com/Cognitive-Architect/panda-stage/blob/31718ada6e7a7e531b1ef86d8f7ee1b61902e42e/docs/design/cloud-mobile-editor-landscape-v0.1.jpg)
- [竖屏 v0.1 主界面](https://github.com/Cognitive-Architect/panda-stage/blob/31718ada6e7a7e531b1ef86d8f7ee1b61902e42e/docs/design/cloud-mobile-editor-portrait-v0.1.jpg)
- [横屏镜头抽屉 v0.2](https://github.com/Cognitive-Architect/panda-stage/blob/31718ada6e7a7e531b1ef86d8f7ee1b61902e42e/docs/design/cloud-mobile-editor-master-shot-drawer-v0.2.jpg)
- [横屏属性检查器 v0.2](https://github.com/Cognitive-Architect/panda-stage/blob/31718ada6e7a7e531b1ef86d8f7ee1b61902e42e/docs/design/cloud-mobile-editor-master-properties-drawer-v0.2.jpg)
- [竖屏镜头工作区 v0.3](https://github.com/Cognitive-Architect/panda-stage/blob/31718ada6e7a7e531b1ef86d8f7ee1b61902e42e/docs/design/cloud-mobile-editor-portrait-master-shot-workspace-v0.3.jpg)
- [竖屏属性工作区 v0.3](https://github.com/Cognitive-Architect/panda-stage/blob/31718ada6e7a7e531b1ef86d8f7ee1b61902e42e/docs/design/cloud-mobile-editor-portrait-master-properties-workspace-v0.3.jpg)

这些图片冻结的是信息层级、空间关系和触控意图，不是生产截图，也不是像素级验收基准。实际断点和尺寸必须由 UI-M0 的真实无影视口证据校准。

## 3. 当前仓库事实与并行线冲突

| 线路 | 当前状态 | 对本批 UI 的影响 |
| --- | --- | --- |
| `main` | `3c47a4ee…`，PR #274 已合并 | 六个 Main-ready Issue 的唯一代码起点 |
| [PR #233](https://github.com/Cognitive-Architect/panda-stage/pull/233) | Open / Draft / Unmerged / non-mergeable | 修改 Asset Library、Dialogue Inspector、Product Preview、StageRenderer 和全局 styles；完整素材 / 字幕 / 预览 UI 暂缓 |
| [PR #285](https://github.com/Cognitive-Architect/panda-stage/pull/285) | Open / Draft / Unmerged | 修改 AssetLibrary、FLA review、Main / Preload / IPC；FLA 单帧和帧序列 UI 暂缓 |
| [PR #303](https://github.com/Cognitive-Architect/panda-stage/pull/303) | Open / Draft / Unmerged | 修改 FlaCompatibilityReviewSession 与 FLA service；实际 FLA 工作间接线暂缓 |
| [PR #306](https://github.com/Cognitive-Architect/panda-stage/pull/306) | Open / Draft / design archive | 作为设计来源引用；实施代码不得从该文档分支堆叠 |

已知高冲突文件包括：

```text
src/renderer/styles.css
src/renderer/features/assets/AssetLibrary.tsx
src/renderer/features/dialogue/DialogueInspector.tsx
src/renderer/shell/ProductPreviewOverlay.tsx
src/renderer/stage/StageRenderer.tsx
src/renderer/fla-import/FlaCompatibilityReviewSession.tsx
```

本批 Issue 必须通过“新增基础层、复用唯一 owner、限制业务接线”的方式绕开这些并行线，不能靠复制第二套组件来躲冲突。

## 4. 六个 Issue 的关系

```text
UI-M0  Main 基线与真实视口合同
  ↓
UI-M1  视觉令牌与触控基础组件
  ↓
UI-M2  横竖屏自适应 EditorShell
  ├─ UI-M3  Canvas + Shot 工作区
  ├─ UI-M4  通用 RightInspector + 竖屏底部抽屉
  └─ UI-M5  TimelineDock + BottomWorkspace 响应式重构
```

- UI-M0、UI-M1、UI-M2 应顺序交付；
- UI-M3、UI-M4、UI-M5 在 UI-M2 稳定后可以并行；
- 每个 Issue 对应一个独立 PR；
- 不建立横屏 / 竖屏两套组件或两套 Store；
- 若实施时 `main` 已前进，必须重新获取 live SHA 和并行 PR 文件重叠，禁止机械沿用本文的旧坐标。

## 5. 全局实施不变量

### 5.1 单一生产 Owner

```text
EditorShell      = ProjectSessionController 唯一生命周期 owner
CanvasStage      = 唯一生产画布 owner
RightInspector   = 唯一生产检查器 owner
TimelineDock     = 唯一生产时间轴 owner
BottomWorkspace  = TimelineDock + HistoryControls owner
EditorProjectStore = Project / dirty / revision 唯一 renderer owner
```

响应式布局只能改变这些 owner 的摆放、可见状态和容器形态，不能复制第二套 Canvas、Inspector、Timeline、History 或 Project store。

### 5.2 UI / Session 状态不得进入 Project

下列状态属于临时 UI / session state：

- 当前横屏 / 竖屏布局模式；
- 当前工作区标签；
- 左侧抽屉开关；
- Inspector 抽屉档位；
- Timeline 展开、缩放和滚动；
- Canvas viewport 的平移与缩放；
- 当前选中但未提交的界面草稿。

它们不得因为切换、旋转、seek、zoom、scroll、selection 或抽屉拖动而写入 `project.json`、增加 `dirty` / `revision` 或生成 History。

### 5.3 触控与可访问性底线

- 图标按钮真实命中区不小于 44 × 44 CSS px；
- 关键按钮 / 输入框建议 48–56 CSS px 高；
- 正文 14–16 px，辅助文本不低于 13 px；
- 所有关键动作必须可由单击 / 单触完成；
- 不把关键能力仅放在 hover、右键、双击或数像素精细拖拽中；
- 保留键盘焦点样式、语义化按钮和可读 accessible name；
- 横向 Timeline 拖动与纵向页面滚动必须有方向锁或等价的手势隔离。

### 5.4 样式迁移策略

由于 PR #233 正在修改 `src/renderer/styles.css`，本批禁止在第一个 PR 中整文件搬迁或全局重排：

1. 新 token / primitive 样式优先放入独立文件；
2. `styles.css` 只增加最小、稳定的入口；
3. 新布局使用明确的作用域类名，避免无界全局选择器；
4. 不为了“干净”重排无关旧规则；
5. 等并行 PR 落地后再单独决定是否做旧 CSS 收口。

### 5.5 临时发布控制

新壳层应通过外层、session-only 的内部开关或等价的受控入口逐步接线：

- 开关关闭时维持当前生产布局；
- 开关开启时复用同一组生产 owner；
- 不把开关写入 Project；
- 不允许旧壳层和新壳层同时挂载相同 owner；
- 最终真机验收完成后必须另行决定切默认与删除临时开关，不能永久养两套壳。

---

# Issue UI-M0：冻结 Main 基线与云电脑真实视口合同

## 建议标题

`chore(ui): freeze main baseline and cloud-mobile viewport contract`

## 问题背景

PR #306 的图片使用目标手机物理分辨率和概念尺寸表达布局，但生产 Electron 页面真正收到的 CSS viewport 会同时受以下因素影响：

- Redmi K60 Ultra 物理方向；
- 阿里无影客户端的串流缩放；
- Windows 显示缩放（当前设计目标包含 125%）；
- Electron 内容区和系统窗口框架；
- 软键盘出现后的可用高度；
- 远程触控到鼠标 / pointer 事件的映射。

没有这份基线，后续断点只能靠看图猜，最终很容易在“设计稿很帅、真机只剩半个按钮”的经典环节翻车。

## 目标结果

建立一份可重复的布局事实与回归入口，回答：

1. 当前 `main` 的编辑器 owner 和关键 DOM selector 是什么；
2. 目标手机横屏 / 竖屏实际可用 CSS viewport 是多少；
3. 哪些操作属于 UI state，且切换后不得污染 Project / History；
4. 后续 Issue 应使用哪些统一的视口 profile 和验收截图位点。

## In scope

- 开工前重新获取 live `main` SHA，并记录 merge-base；
- 建立横屏 / 竖屏 viewport profile 记录模板；
- 记录至少以下字段：

| 字段 | 说明 |
| --- | --- |
| `devicePhysicalPx` | 手机物理分辨率与方向 |
| `windowInnerCssPx` | Electron `window.innerWidth / innerHeight` |
| `devicePixelRatio` | Electron renderer 实际 DPR |
| `windowsScale` | Windows 显示缩放 |
| `cloudClientScale` | 无影客户端可观察的缩放设置 |
| `softKeyboardVisible` | 软键盘出现前后高度 |
| `pointerMode` | touch / pointer / mouse 映射事实 |

- 为当前单一 owner 建立或补齐 DOM contract：
  - EditorShell；
  - LeftWorkspace；
  - CanvasWorkspace / CanvasStage；
  - RightInspector；
  - BottomWorkspace；
  - TimelineDock；
  - HistoryControls；
- 建立 `wide → narrow → wide` 与 `landscape → portrait → landscape` 的基线步骤；
- 建立 `Project / dirty / revision / History` 前后对照模板；
- 记录 PR #233、#285、#303 的当前重叠文件，作为后续实施前重新审计清单。

## Out of scope

- 不修改生产布局；
- 不实现视觉 token；
- 不实现新组件或新工作区；
- 不宣称 headless screenshot 等于真实无影触控验收；
- 不修改 Project schema、Store、IPC 或持久化逻辑。

## 建议文件范围

```text
docs/design/** 或 docs/test-receipts/**（基线与人工记录）
tests/contract/**（必要的 DOM / ownership 合同）
tests/integration/**（仅当现有 harness 能无生产改动覆盖布局 round-trip）
```

若必须修改 `src/**` 才能“测到”基线，应停止并解释原因；测量 Issue 不应偷渡生产重构。

## 自动化验收

- owner selector 唯一且仍挂载真实生产组件；
- UI state 操作不改变 Project snapshot、dirty、revision 或 History；
- 当前宽 / 窄布局现有回归保持通过；
- 测试不依赖固定机器绝对路径或私有截图；
- 新测试进入已有 CI route，未知路径保持 fail-closed。

## 真人验收

在真实 Redmi K60 Ultra + 阿里无影 + Windows Electron 中分别记录：

1. 横屏首次进入编辑器；
2. 竖屏首次进入编辑器；
3. 横转竖再转横；
4. 打开 / 关闭窄屏 Inspector；
5. 展开 / 折叠 Timeline；
6. 聚焦一个文本输入，使软键盘出现并关闭；
7. 保存前后确认只有真实项目编辑改变 dirty / History。

## Definition of Done

- [ ] live `main` SHA 与并行 PR 坐标已记录；
- [ ] 横竖屏实际 CSS viewport / DPR / Windows scale 已记录；
- [ ] owner / DOM contract 自动化通过；
- [ ] UI state 无 Project / History 污染证据通过；
- [ ] 人工证据与自动化证据分开标注；
- [ ] `UI_M0_BASELINE_FROZEN = true`。

## 依赖与阻塞边

- 前置依赖：无；
- 阻塞：UI-M1、UI-M2；
- 若 live `main` 不再是本文 SHA：更新本 Issue 坐标后再实施，不需要强行回到旧 SHA。

---

# Issue UI-M1：视觉令牌与触控基础组件

## 建议标题

`feat(ui): add cloud-mobile visual tokens and touch primitives`

## 问题背景

当前全局 `styles.css` 同时承担基础颜色、按钮、编辑器壳层和具体业务组件样式。继续直接往里面堆横屏、竖屏、抽屉和触控规则，会扩大 PR #233 的重叠面，也会让后续每个 UI Issue 重复定义颜色、间距和命中区。

## 目标结果

提供一套最小、可复用、可被后续 Main-ready Issue 直接采用的视觉和触控基础层，同时保持旧 UI 行为与业务语义不变。

## In scope

### Token

- 应用背景、工作面、浮层、边框；
- 主文字、次级文字、禁用文字；
- 竹绿色主操作 / 当前态；
- 琥珀色警告 / 实验态；
- 红色危险状态；
- 4 / 8 / 12 / 16 / 24 px 间距等级或等价的收敛尺度；
- 小 / 中 / 大圆角；
- 正文、辅助文字、区块标题；
- 44 / 48 / 56 px 触控尺寸；
- focus ring、disabled、pressed、selected 状态。

### 最小 primitives

- `Button`：primary / secondary / danger；
- `IconButton`：可见图标 + accessible name + 44px 命中区；
- `SegmentedTabs` 或等价单选工作区控件；
- `Field`：label / description / error；
- `Stepper`：减、精确值、加；
- `PanelSurface` / `SectionHeader`；
- 仅在 UI-M2 确实需要时加入 Drawer / Sheet 的纯展示 primitive，不提前实现完整状态机。

组件名称可根据现有目录约定调整，但不得创建一个与现有业务组件平行的“大而全设计系统”。

## 首个真实消费者

至少选择一个低冲突、语义稳定的现有表面作为真实消费者，例如 `CompactProjectBar` 的一组按钮或 UI-M2 所需的工作区标签。不得只提交无人使用的抽象组件仓库。

## Out of scope

- 不全量迁移 `styles.css`；
- 不重绘 Asset Library、Dialogue Inspector、FLA Review 或 Product Preview；
- 不改变按钮实际业务回调、禁用条件或 History 行为；
- 不加入动画框架、复杂主题切换或 Project 持久化设置；
- 不以 token 化为理由重新排版整个编辑器。

## 建议文件范围

```text
src/renderer/ui/**                 （若当前仓库无同类目录，可建立最小目录）
src/renderer/styles/tokens.css     （或符合现有约定的等价路径）
src/renderer/styles/primitives.css （或等价路径）
src/renderer/styles.css            （仅最小 import / bridge）
src/renderer/shell/CompactProjectBar.tsx（可选首个消费者）
tests/unit/** 或 tests/contract/**
```

实施前必须确认当前仓库是否已有可复用基础组件；发现已有 owner 时优先扩展，不重复造轮子。

## 自动化验收

- 每个交互 primitive 均有正常 / disabled / selected / focus 合同；
- `IconButton` 无可访问名称时测试失败；
- 最小触控命中区有稳定 class / style contract；
- 首个真实消费者的业务回调和禁用逻辑保持不变；
- 旧编辑器不因样式 import 出现全局视觉回归；
- typecheck、lint、unit、build 通过。

## 真人验收

- 鼠标和触控都能稳定命中按钮；
- 125% Windows 缩放下正文和辅助文字可读；
- 当前态不能只靠微弱颜色差异判断；
- Tab / Shift+Tab 导航和 focus ring 可见；
- 禁用按钮不会看起来像仍可执行的主操作。

## Definition of Done

- [ ] 最小 token 集已落地并记录语义；
- [ ] primitives 有一个真实生产消费者；
- [ ] 未全量迁移或重排 legacy CSS；
- [ ] PR #233 的 `styles.css` 重叠被控制在最小范围；
- [ ] 自动化与人工触控验收通过；
- [ ] `UI_M1_TOUCH_FOUNDATION_PASS = true`。

## 依赖与阻塞边

- 前置依赖：UI-M0；
- 阻塞：UI-M2、UI-M3、UI-M4、UI-M5。

---

# Issue UI-M2：横竖屏自适应 EditorShell

## 建议标题

`feat(ui): add adaptive cloud-mobile editor shell`

## 问题背景

桌面三栏布局在手机竖屏中没有足够宽度，而简单压缩会让画布、Inspector 和 Timeline 同时失去可用性。PR #306 已确定：横屏使用按需抽屉 / 检查器，竖屏使用单工作区切换；这需要一个明确的壳层状态机，而不是继续堆媒体查询。

## 目标结果

在不复制生产 owner 的前提下，让同一个 EditorShell 支持：

- 横屏：项目栏 + 左工具入口 + 按需左抽屉 + 中央画布 + 按需右 Inspector + BottomWorkspace；
- 竖屏：项目栏 + 工作区标签 + 单一主工作区 + 底部摘要 / BottomWorkspace；
- 方向与宽度变化后恢复合法状态；
- 任一时刻只有一个纵向主滚动 owner。

## 壳层状态合同

建议最小状态概念如下，实际命名可按现有代码收敛：

```ts
type EditorWorkspace = 'canvas' | 'shots' | 'assets' | 'properties' | 'timeline';
type SidePanel = 'shots' | 'assets' | null;
type InspectorDetent = 'closed' | 'half' | 'full';
```

约束：

- 横 / 竖屏由可用内容区域推导，不写入 Project；
- portrait 只暴露一个当前主工作区；
- landscape 在空间不足时不得让左右两栏和完整 Timeline 同时挤压 Canvas；
- `assets` 工作区可以承载现有 LeftWorkspace / ResourceActivityDock，但本 Issue 不修改 `features/assets/**` 内部；
- Inspector 内容仍来自唯一 RightInspector；
- Canvas 和 Timeline 的 Store 状态在工作区切换后恢复，不因临时卸载而重置项目状态。

## In scope

- EditorShell 外层布局和受控 rollout 入口；
- CompactProjectBar 的移动端空间优先级；
- 横屏左入口与 portrait 工作区标签；
- panel open / close、workspace selection、orientation round-trip；
- 单滚动所有权与 overflow 合同；
- 为 UI-M3 / M4 / M5 提供明确 slot；
- 屏幕阅读器和键盘可到达的工作区切换；
- CSS 作用域和断点由 UI-M0 的实际 viewport 数据确定。

## Out of scope

- 不重写 Asset Library 内部；
- 不重写 CanvasStage、RightInspector、TimelineDock 业务内容；
- 不实现字幕音频、Product Preview transport 或 FLA workflow；
- 不增加第二个 ProjectSessionController；
- 不把 layout mode 保存进 `project.json`；
- 不创建第二套路由 / Store 来维持旧壳层。

## 建议文件范围

```text
src/renderer/shell/EditorShell.tsx
src/renderer/shell/CompactProjectBar.tsx
src/renderer/shell/LeftWorkspace.tsx
src/renderer/shell/CanvasWorkspace.tsx
src/renderer/shell/RightInspector.tsx（仅容器接线，内容留给 UI-M4）
src/renderer/shell/BottomWorkspace.tsx（仅 slot，内容留给 UI-M5）
src/renderer/styles/**
tests/unit/editor-*.test.ts
tests/integration/editor-shell-*.test.ts
tests/contract/dom-selectors*.test.ts
```

## 自动化验收

- 每种布局只挂载一份 CanvasStage / RightInspector / TimelineDock / HistoryControls；
- landscape / portrait 的工作区状态转换是确定性的；
- `wide → narrow → wide` 后 owner、selection 和 Timeline UI 状态可恢复；
- workspace / panel / orientation 变化不产生 dirty / revision / History；
- 隐藏工作区不保留可误触的焦点元素；
- 旧壳层关闭与新壳层开启不会同时挂载相同 owner；
- typecheck、lint、unit、integration、build 通过。

## 真人验收

1. 横屏打开镜头入口、关闭、再打开属性入口；
2. 竖屏在画布 / 镜头 / 素材 / 属性 / 时间轴间循环；
3. 在素材工作区只验证现有内容可达，不评判其最终视觉；
4. 横转竖再转横，项目选择与当前 Shot 不丢失；
5. 主内容没有双层纵向滚动争抢；
6. 顶栏保存 / 预览等现有动作不被项目名挤掉；
7. 关闭实验入口后旧生产布局仍可用。

## Definition of Done

- [ ] 横屏和竖屏使用同一个 EditorShell；
- [ ] 单一 owner 合同自动化通过；
- [ ] orientation round-trip 自动化与真机通过；
- [ ] 单滚动所有权成立；
- [ ] layout state 不污染 Project / History；
- [ ] 业务组件内部未越界重构；
- [ ] `UI_M2_ADAPTIVE_SHELL_PASS = true`。

## 依赖与阻塞边

- 前置依赖：UI-M0、UI-M1；
- 阻塞：UI-M3、UI-M4、UI-M5；
- PR #233 / #285 无需先合并，但实施前必须重新检查 `EditorShell` / `styles.css` 重叠。

---

# Issue UI-M3：Canvas 与 Shot 工作区重构

## 建议标题

`feat(ui): adapt canvas and shot workspace for cloud-mobile touch`

## 问题背景

Canvas 是编辑器的主任务面，Shot 是决定当前上下文的高频集合。它们可以完全基于当前 `main` 的 CanvasStage、shotStore 和 Shot 能力实施，不需要等待 Day29、FLA V2-R 或素材库并行线。

## 目标结果

- 横屏：镜头入口打开左抽屉，Canvas 保持最大连续区域；
- 竖屏：镜头变为全宽工作区，保留紧凑 Canvas 上下文；
- 回到 Canvas 后 viewport、当前 Shot 和 Layer selection 合法恢复；
- 选择 / 移动 / 缩放工具适配触控；
- Shot 操作仍使用现有 Project / History 语义。

## In scope

### Canvas

- 复用唯一 CanvasWorkspace / CanvasStage；
- Canvas 在抽屉、工作区和方向变化后重新测量；
- 保持 contain / viewport transform 与项目 1920 × 1080 逻辑画布合同；
- 横屏工具条与竖屏大触控工具区；
- 选择、移动、缩放模式的当前态清晰可读；
- subtitle overlay 仍保持 click-through，不阻断底层 Layer selection；
- 画布缩放 / 平移保持 session-only。

### Shot

- 横屏镜头抽屉；
- 竖屏镜头全宽工作区或设计蓝图规定的等价单工作区；
- Shot card 显示缩略图、名称、时长和当前态；
- 新增、选择和既有排序能力保持可达；
- 拖动排序时锁定纵向滚动，结束后恢复；
- 当前 Shot 切换继续触发现有 selection / viewport reconciliation。

## Out of scope

- 不重构 Asset Library、角色库或 FLA 入口；
- 不改变 Shot / Layer domain schema；
- 不改变 Canvas 渲染器或 subtitle evaluator；
- 不添加第二个 Canvas 或离屏编辑模型；
- 不为概念图伪造尚不存在的播放 / 动画能力；
- 不顺手调整 ProductPreviewOverlay 或 PR #233 的 mouth / audio 行为。

## 建议文件范围

```text
src/renderer/shell/CanvasWorkspace.tsx
src/renderer/shell/LeftWorkspace.tsx
src/renderer/features/canvas/**
src/renderer/features/shots/**
src/renderer/styles/**
tests/unit/canvas-*.test.ts
tests/unit/shot-*.test.ts
tests/integration/shot-*.test.ts
tests/integration/editor-shell-*.test.ts
```

Store / domain 文件默认不在范围内。若发现当前 main 存在阻断布局的真实 store bug，应先提交证据并单独授权，不得借 UI Issue 扩大为 domain 重构。

## 自动化验收

- 只有一个 CanvasStage；
- Canvas 重测不会产生 Project mutation；
- landscape / portrait round-trip 后 current Shot、Layer selection、viewport 合法；
- Shot 新增 / 选择 / 排序继续遵守既有 one-command History 合同；
- subtitle overlay 仍不拦截底层选择；
- 无效选择按现有 reconciliation 清理；
- typecheck、lint、unit、integration、build 通过。

## 真人验收

1. 横屏打开镜头抽屉并选择三个不同 Shot；
2. 拖动一次 Shot 排序并 Undo / Redo；
3. 竖屏进入镜头工作区，选择 Shot 后返回 Canvas；
4. Canvas 选择一个普通 Layer，分别执行移动与缩放；
5. 横竖切换后 Canvas 不出现零尺寸、过度裁切或无法点击；
6. Timeline / Inspector 不因 Canvas 重测永久消失；
7. 保存 / 重开后只有真实 Shot / Layer mutation 持久化。

## Definition of Done

- [ ] 横屏镜头抽屉与竖屏镜头工作区完成；
- [ ] Canvas 单 owner 和重测合同通过；
- [ ] touch 工具命中区达标；
- [ ] Shot mutation / History 语义未改变；
- [ ] Asset / Dialogue / FLA 并行线未被越界修改；
- [ ] 真实无影横竖屏验收通过；
- [ ] `UI_M3_CANVAS_SHOT_PASS = true`。

## 依赖与阻塞边

- 前置依赖：UI-M2；
- 可与 UI-M4、UI-M5 并行；
- 不阻塞于 PR #233 / #285，但必须避开 StageRenderer / AssetLibrary 的并行修改。

---

# Issue UI-M4：通用 RightInspector 与竖屏底部抽屉

## 建议标题

`feat(ui): adapt the single right inspector into landscape drawer and portrait sheet`

## 问题背景

当前 RightInspector 已是 Layer property 与 DialogueInspector 的单一容器，并已有窄屏 drawer 基础。竖屏需要把同一个 owner 变为可折叠底部检查器，而不是复制一套 mobile inspector。

## 目标结果

- 横屏：RightInspector 作为按需右侧检查器；
- 竖屏：同一个 RightInspector 内容进入 `closed / half / full` 三档底部抽屉；
- Layer / background / invalid / locked / Dialogue selection 状态继续走现有权威选择；
- 抽屉档位和滚动仅是 UI state；
- 当前 Layer property 的 History 语义不变。

## In scope

- RightInspector 外层容器、标题、关闭入口和 section 布局；
- portrait bottom sheet 三档高度与拖动 / 离散按钮替代；
- sheet 内部作为当前页面唯一纵向滚动 owner；
- LayerTransformPanel、LayerOrderControls、LayerBackgroundControl 的触控间距；
- selection 变化后的合法打开 / 收起行为；
- keyboard focus trap / Escape / 返回行为；
- DialogueInspector 仅作为现有内容被承载，不在本 Issue 改字段或 Day29 语义。

## 属性提交语义

PR #306 蓝图中的“取消 / 应用”表达底部动作区意图，但当前 main 的 Layer property 使用既有 mutation / History 合同。本 Issue 明确：

- 不引入新的 staged property draft；
- 不把即时 mutation 偷换为整页 Apply；
- 每个既有有效操作保持原 History 行为；
- no-op 不得制造 dirty / revision / History；
- 若未来要实现事务型“取消 / 应用”，必须另开 domain / UX Issue。

## Out of scope

- 不修改 DialogueInspector 字段、音频绑定或 Product Preview；
- 不修改 exact integer millisecond timing 规则；
- 不创建 `MobileRightInspector` 或第二个 selection store；
- 不改变 Layer transform / order / background 的 domain 服务；
- 不让 sheet detent 写入 Project；
- 不允许背景、Layer 和 Dialogue 同时拥有多个选择真相。

## 建议文件范围

```text
src/renderer/shell/RightInspector.tsx
src/renderer/features/properties/**（仅展示 / 触控适配）
src/renderer/styles/**
tests/unit/right-inspector*.test.ts
tests/integration/right-inspector*.test.ts
tests/unit/canvas-*.test.ts（仅必要的 property / selection 回归）
```

`src/renderer/features/dialogue/DialogueInspector.tsx` 默认不在修改范围内。

## 自动化验收

- RightInspector 只有一个生产实例；
- Layer / background / invalid / locked / Dialogue 状态仍由现有 selector 决定；
- detent / scroll / open / close 不改变 Project / History；
- `wide → narrow → wide` 后选择与 inspector 内容恢复；
- exact integer timing 和 Dialogue / Layer selection 互斥回归保持通过；
- 关闭 sheet 后焦点返回触发它的控件或等价合法位置；
- typecheck、lint、unit、integration、build 通过。

## 真人验收

1. 横屏选择普通 Layer，编辑位置 / 缩放 / 旋转；
2. 选择背景、锁定 Layer 和无效 selection，确认文案与可用动作正确；
3. 竖屏在 closed / half / full 三档切换；
4. sheet 内容较长时只有 sheet 主内容纵向滚动；
5. 关闭后 Canvas 恢复可操作空间；
6. 选择 Dialogue 时现有 DialogueInspector 仍可达，但不要求 Day29 字段；
7. Undo / Redo 和 Save / Reopen 只反映真实 property mutation。

## Definition of Done

- [ ] 横屏右栏与竖屏同 owner sheet 完成；
- [ ] detent 与滚动合同通过；
- [ ] property mutation / History 语义未改变；
- [ ] DialogueInspector 未被越界重构；
- [ ] wide / narrow / orientation round-trip 通过；
- [ ] `UI_M4_INSPECTOR_SHEET_PASS = true`。

## 依赖与阻塞边

- 前置依赖：UI-M2；
- 可与 UI-M3、UI-M5 并行；
- 完整字幕 Inspector 视觉仍阻塞于 PR #233 的集成决定。

---

# Issue UI-M5：TimelineDock 与 BottomWorkspace 响应式重构

## 建议标题

`feat(ui): adapt timeline and bottom workspace for cloud-mobile touch`

## 问题背景

当前 main 的 TimelineDock 权威能力是 seek、zoom、scroll、collapse、Dialogue clip，以及 BottomWorkspace 中的 HistoryControls。它尚不拥有 PR #306 蓝图所画完整五键播放 transport，也不拥有 Day29 的 audio / Product Preview transport。

本 Issue 必须改善当前能力的布局和触控，不得因为概念图存在就伪造尚未落入 `main` 的播放能力。

## 目标结果

- 横屏 Timeline 在有限高度中仍能读 ruler、playhead 和 Dialogue clip；
- portrait 提供可用的 Timeline 工作区 / 摘要模式；
- collapse 真正释放空间给 Canvas；
- zoom、scroll、seek 和 clip selection 适合触控；
- HistoryControls 仍由 BottomWorkspace 单独承载且始终可达；
- 为未来 transport 预留稳定布局边界，但不创建第二个 clock 或假播放按钮。

## In scope

- TimelineDock responsive ruler / track / label / clip layout；
- portrait Timeline 工作区和非当前工作区的紧凑时间摘要；
- collapse 后外层高度真正缩小；
- zoom `- / value / +` 的大命中区；
- playhead seek 与 Dialogue clip selection 的手势隔离；
- 横向 Timeline scroll 与纵向页面 / sheet scroll 的方向锁；
- Untimed Dialogue marker 仍可见、可选，视觉宽度不回写 persisted timing；
- 当前 main 已有的 Dialogue move / resize 触控热区适配；
- BottomWorkspace 与 HistoryControls 的响应式布局。

## 明确不实现的 transport 能力

当前 main 没有完整编辑器播放 transport，因此本 Issue不得新增：

- Play / Pause master clock；
- Previous / Next 语义；
- 音频轨播放；
- Product Preview Replay / Stop；
- mouth projection；
- 看似可点但没有权威行为的五键假按钮。

如果存在仅调用当前 `timelineUiStore.seek()` 的“回到起点 / 跳到终点”离散辅助按钮，可以在不创建新时钟、不增加 Project mutation且测试充分的前提下实现；其余五键 transport 等相应能力进入 `main` 后另行授权。

## Out of scope

- 不修改 Dialogue / AudioClip 独立 timing；
- 不增加第二个 subtitle evaluator；
- 不修改 domain service、Project schema 或 History core；
- 不把 zoom / scroll / seek / selection 持久化；
- 不重构 PR #233 ProductPreviewOverlay；
- 不用无限增加 BottomWorkspace 高度解决裁切。

## 建议文件范围

```text
src/renderer/features/timeline/**
src/renderer/shell/BottomWorkspace.tsx
src/renderer/features/editor/HistoryControls.tsx（仅布局接线）
src/renderer/styles/**
tests/unit/features/timeline/**
tests/contract/*timeline*.test.ts
tests/contract/day26-*.test.ts
tests/integration/editor-shell-*.test.ts
```

Dialogue domain / store 默认不在范围内；若现有 timing 行为阻断布局验收，先证明是 main bug，再另行授权。

## 自动化验收

- TimelineDock 和 HistoryControls 各只有一个生产实例；
- expanded / collapsed 外层高度合同成立；
- seek / zoom / scroll / clip selection 不 dirty、不 revision、不 History；
- Untimed marker 的视觉最小宽度不回写 timing；
- exact integer inspector timing 与 pointer frame-snap 的现有边界保持；
- no-op move / resize 不产生 History；
- `wide → narrow → wide` 后 ruler、clip、History 可达；
- typecheck、lint、unit、integration、build 通过。

## 真人验收

1. 横屏展开 / 折叠 Timeline，确认 Canvas 获得和归还空间；
2. 反复 zoom in / out 和横向滚动；
3. 点击 ruler seek，拖动一个现有 Dialogue clip；
4. 只点击 resize handle 不移动，确认 no-op；
5. 竖屏进入 Timeline 工作区并返回 Canvas；
6. 横向拖 Timeline 时页面不跟着纵向乱跑；
7. HistoryControls 未被裁切，Undo / Redo 仍对应真实 mutation；
8. 页面没有伪造的 Play / Pause 或幽灵音频。

## Definition of Done

- [ ] Timeline / BottomWorkspace 横竖屏布局完成；
- [ ] collapse 真实释放空间；
- [ ] touch seek / zoom / scroll / clip 交互通过；
- [ ] UI-only 操作无 Project / History 污染；
- [ ] 未越权实现 Day29 transport / audio / mouth；
- [ ] `UI_M5_TIMELINE_BOTTOM_PASS = true`。

## 依赖与阻塞边

- 前置依赖：UI-M2；
- 可与 UI-M3、UI-M4 并行；
- 完整五键 transport、音频轨和字幕音频关系阻塞于后续能力进入 `main`。

---

## 6. 暂缓但应保留在总控中的后续 Issue

以下内容已有 PR #306 蓝图，但不属于当前 Main-ready 六票：

| 后续方向 | 当前阻塞 | 解除条件 |
| --- | --- | --- |
| 素材工作区完整重构 | PR #233 / #285 同时修改 AssetLibrary | 相关分支集成到 live base，并重新审计文件重叠 |
| 字幕正常编辑、待安排、批量粘贴完整视觉 | PR #233 修改 DialogueInspector / store / Preview / styles | Day29 集成路线确定；保留 Dialogue / AudioClip 独立 timing |
| FLA 全屏工作间与直接图片 / 安全阻断 | PR #303 / #285 修改同一 FLA review | C3/C4/V2-R live topology 收敛；复用一个 FlaCompatibilityReviewSession |
| FLA 单帧 / 帧序列 | PR #285 与 Issue #294 人工门禁 | 能力进入目标 base；帧序列仍按实验态和预算约束呈现 |
| 完整五键 transport / audio track | 当前 main 无权威 master clock / audio transport | 对应能力合并，并明确单时钟 owner |
| 最终云电脑真机收口 | 依赖所有目标工作区 | 横竖屏功能集完成后执行总体验收，不用自动截图替代真人 |

暂缓不等于取消。它表示这些设计已归档，但生产实现必须等待权威能力与集成基线就绪。

## 7. 每个实施 PR 的统一交付格式

每个 Issue / PR 至少记录：

```text
source_issue
design_source = PR #306 + exact design HEAD
implementation_base = live main SHA
parallel_pr_overlap_checked = yes/no + paths
single_owner_invariants
project/history mutation assessment
automated_validation
windows_electron_human_acceptance
known_limits
stage_final_commit
```

PR 描述必须区分：

- 自动化 PASS；
- headless / browser screenshot 证据；
- 真实 Windows Electron；
- 真实阿里无影 + Redmi K60 Ultra 触控。

不得把前三者写成最后一项已经通过。

## 8. 全局停止条件

出现以下任一情况，应停止当前 Issue 并回到总控重新拆分：

- 为做响应式布局需要复制第二个 Canvas / Inspector / Timeline / Store；
- UI state 开始进入 Project、dirty、revision 或 History；
- 必须重写 PR #233 / #285 / #303 的并行历史；
- 一个 Issue 同时改动 Editor shell、Dialogue 语义、FLA security 和 Project schema；
- 设计稿中的能力在当前 main 不存在，却被实现为没有权威行为的假按钮；
- 为通过 CI 而降低 unknown-route、security、IPC 或 acceptance gate；
- 自动截图被用来替代明确要求的真实无影触控验收；
- 旧壳层和新壳层永久并存，开始形成两套产品 owner。

## 9. 当前决策

```yaml
cloud_mobile_ui_main_ready:
  design_source:
    pr: 306
    head: 31718ada6e7a7e531b1ef86d8f7ee1b61902e42e

  implementation_baseline:
    branch: main
    sha_at_planning: 3c47a4ee8af07e834338b223fcb3260a4c6dddbc
    re_fetch_before_each_issue: true

  ready_now:
    - UI-M0 baseline_and_viewport_contract
    - UI-M1 visual_tokens_and_touch_primitives
    - UI-M2 adaptive_editor_shell
    - UI-M3 canvas_and_shot_workspace
    - UI-M4_single_inspector_and_portrait_sheet
    - UI-M5_timeline_and_bottom_workspace

  blocked_until_integration:
    - asset_workspace_full_redesign
    - subtitle_audio_preview_workflow
    - fla_fullscreen_product_workflow
    - fla_static_snapshot_and_frame_sequence
    - complete_transport_and_audio_track
    - final_end_to_end_cloud_device_acceptance

  implementation_order:
    - UI-M0
    - UI-M1
    - UI-M2
    - [UI-M3, UI-M4, UI-M5]

  production_code_authorized_by_this_document: false
```

下一步：仓库所有者审阅并合并本规划文档后，按 UI-M0 → UI-M1 → UI-M2 的顺序创建和授权真实实施 Issue；UI-M3 / M4 / M5 在壳层稳定后分别开票。