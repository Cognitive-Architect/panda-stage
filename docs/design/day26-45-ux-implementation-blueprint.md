# Panda Stage Day 26～45 前端与交互技术实施蓝图

> 文档类型：后续开发实施合同 / UX 架构蓝图
> 基线分支：`fix/m3-editor-shell`
> 基线提交：`50ef69686997825fc02a61455ef534fef7bcf4ad`
> 编写日期：2026-07-30
> 适用范围：Day 26～45
> 主要目标：把当前“纵向功能展板”收敛为连续桌面编辑器，后续功能不得继续堆到一个超长页面中
> 状态：设计与实施参考；不代表 M3 已通过，也不自动解除 Day 26～45 的既有冻结条件

---

## 0. 先读结论

Day 26 以后，Panda Stage 的前端必须遵守下面六条硬规则：

1. **根页面永不滚动。** `html / body / #root / EditorShell` 的尺寸等于窗口可用区，纵向滚动只能发生在左侧列表、右侧检查器或弹窗内容中。
2. **中央舞台永远是主角。** 画布不再夹在素材库、角色、镜头和动作表单之间；编辑状态下，中央区域始终保留一个且只有一个 `CanvasStage`。
3. **一个任务只露出一组工具。** 素材、角色、镜头通过左侧活动导航互斥显示；图层属性、动作、对白参数通过右侧上下文检查器互斥显示。
4. **时间相关能力全部进入底部 Dock。** 播放头、刻度、事件条、对白条、音频条、缩放和轨道均进入可折叠/可调高的底部时间轴，禁止追加到 `LegacyWorkspace` 末尾。
5. **操作状态与项目数据分离。** 面板开关、宽度、时间轴高度、当前页签、临时播放时间不能设置项目 `dirty`，也不能写入 `project.json` 或 History。
6. **迁移时删除旧入口，不用隐藏副本保兼容。** 每个业务模块只能有一个生产实例。旧 Gate 要迁移导航和 selector owner，不能靠 `display:none`、屏外 DOM 或双挂载蒙混过去。

目标工作区：

```text
┌──────────────────────────── EditorTopBar ────────────────────────────┐
│ 项目/保存       撤销重做       预览控制                 导出/状态    │
├──────┬────────────────┬─────────────────────────┬────────────────────┤
│活动栏│ 左侧导航 Dock  │      Canvas Workspace   │  Context Inspector │
│      │ 镜头/素材/角色 │  单一舞台 + 画布工具栏  │ 属性/动作/对白     │
│      │                │                         │                    │
├──────┴────────────────┴─────────────────────────┴────────────────────┤
│ Timeline Dock：播放头 / 刻度 / 动作轨 / 对白轨 / 音频轨 / 缩放      │
├──────────────────────────── Status Bar ──────────────────────────────┤
│ 保存状态 / 当前镜头 / 当前时间 / 后台任务 / 可恢复错误              │
└──────────────────────────────────────────────────────────────────────┘
```

这不是把现有长页面“压窄一点”，而是改变组件的**同时可见关系、选择关系和滚动所有权**。

---

## 1. 文档权威性与来源优先级

### 1.1 为什么要说明优先级

仓库中的旧计划与修订后的 Agent Task 已出现编号语义差异。例如：

- `DAILY_PLAN.md` 的 Day 26 仍写“动作预设编译器”；
- 当前 `agent task/DAY-26-AGENT-TASK.md` 已改为“时间轴外壳”；
- 动作预设已经在 Day 25 分支中实现；
- 当前生产代码又已经完成 Stage 1A 固定 Shell，但正式模块迁移仍未发生。

后续 Agent 若只机械读取一份旧计划，很容易重复实现功能、建立第二套目录或把时间轴继续塞进长页面。

### 1.2 实施时的权威顺序

| 优先级 | 来源 | 用途 |
|---:|---|---|
| 1 | 当次用户指令、已批准 Issue、当前 Day Agent Task | 决定本次唯一目标和范围 |
| 2 | 当前分支的生产代码、schema、Store、IPC 和现行测试 | 决定真实接口与不可破坏合同 |
| 3 | 本文档 | 决定 Day 26～45 的 UI 布局、交互与迁移方式 |
| 4 | `ROADMAP.md` | 决定产品边界、里程碑和最终验收标准 |
| 5 | `DAILY_PLAN.md` | 提供原始阶段意图；与新 Agent Task 冲突时不得覆盖新任务书 |

### 1.3 当前状态边界

- 当前编辑器 Stage 1A 骨架已实现，但仍处于人工验收边界；
- `LegacyWorkspace` 仍是过渡容器，不是最终产品布局；
- M3、PR 和后续开发状态必须以当时 GitHub/Issue 的真实状态为准；
- 本文只准备技术路线，**不因文档完成而宣称 M3 PASS，也不授权越过 Gate**。

### 1.4 Agent Task 路径必须映射到真实仓库

Day 26～45 的任务书包含一些概念路径和旧文件名。实施前必须先做路径核对，不能照着任务书另建一棵平行架构：

| 任务书中的写法 | 当前仓库真实位置/处理方式 | 实施规则 |
|---|---|---|
| `src/features/*` | `src/renderer/features/*` | React 产品功能必须落在 Renderer 目录 |
| `src/stores/*` | `src/renderer/stores/*` | UI/会话 Store 沿用现有外部 Store 模式 |
| `electron/main/*` | `src/main/*` | 文件、进程、窗口和 FFmpeg 逻辑只进 Main |
| `shared/*` | `src/shared/*` | IPC/schema 等共享合同放这里；纯产品 domain 先检查现有 `src/domain/*` owner |
| `PANDA_STAGE_ROADMAP.md` | `ROADMAP.md` | Day 45 引用的是旧文件名，不得再创建同义 Roadmap |
| `src/domain/*` | 已存在，且另有兼容性的 `src/shared/domain/*` | 先查 export 与生产调用链，再决定落点，不复制 evaluator/schema |

路径判断顺序固定为：生产 import 图 → 现有 barrel export → 测试 owner → 任务书概念路径。若任务书路径与真实代码冲突，Evidence 中记录映射决定。

---

## 2. 当前前端基线审计

### 2.1 当前真实组件树

当前生产组合可简化为：

```text
EditorShell
├─ StartScreen [无项目]
└─ EditorLayout [已打开项目]
   ├─ EditorTopBar
   ├─ EditorBody
   │  ├─ LeftPlaceholder
   │  ├─ LegacyWorkspace [唯一纵向滚动区]
   │  │  ├─ ActionPresetPanel
   │  │  ├─ CanvasStage
   │  │  └─ ProjectRecoveryPanel
   │  │     ├─ RecentProjectsPanel
   │  │     ├─ AssetLibrary
   │  │     ├─ CharacterManager
   │  │     ├─ ShotManager
   │  │     └─ CanvasStage
   │  └─ RightPlaceholder
   └─ BottomPlaceholder
```

这带来几个已经可以从源码直接证明的问题：

- `LegacyWorkspace` 把所有业务模块按 DOM 顺序纵向拼接；
- `ProjectRecoveryPanel` 的名字与职责已经不匹配，它实际承载素材、角色、镜头和画布；
- `CanvasStage` 仍有两个实例；
- `HistoryControls` 通过两个 `CanvasStage` 间接出现两次；
- 左侧、右侧、底部虽然已有 Grid 位置，但仍只是占位符；
- 用户要跨越大量无关表单，才能从镜头列表走到画布或动作面板；
- 模块内部各自拥有标题、状态输出、空状态和操作栏，叠加后形成重复视觉层级；
- CSS 主要依靠单个超长 `styles.css` 和模块最小高度，进一步放大中央纵向滚动。

### 2.2 “长页面”不是 CSS 高度问题

根因不应被误诊为“某几个 `margin` 太大”。真正问题是：

1. **信息架构错误**：素材、角色、镜头、画布、动作属于不同任务，却同时呈现。
2. **选择上下文割裂**：左边选择镜头、中央选择图层、下方编辑动作，本应共享上下文，却在长页面不同位置分别维护。
3. **重复挂载**：同一舞台和历史控制存在多个生产实例，视觉与 Store 订阅都可能分叉。
4. **滚动所有权错误**：中央工作区承担了全产品的纵向滚动，画布会离开视口。
5. **状态反馈分散**：每个模块用自己的 `<output>`，用户难以判断当前消息属于保存、素材、图层还是导出。
6. **渐进披露缺失**：高级参数、空状态、说明文案和主要操作同时占位。

因此禁止以下“伪优化”：

- 只把字号和间距缩小；
- 给所有 `<section>` 加折叠面板，但仍全部挂在一个滚动列中；
- 保持双挂载，用 CSS 隐藏一个实例；
- 只增加左侧导航，但点击后仍滚动定位长页面；
- 把时间轴追加到 `LegacyWorkspace` 最底部；
- 通过恢复 `window` 根滚动让旧 Gate 暂时通过。

### 2.3 必须保留的现有合同

重构 UI 不等于重写业务底座。以下合同必须继续成立：

- `EditorShell` 是唯一产品入口；
- `ProjectSessionController` 仍由 `EditorShell` 唯一持有；
- project open/switch 继续执行生产 IPC、Recovery 检测和 Dirty Guard；
- `EditorProjectStore` 是项目快照、dirty、revision 与 History 的唯一账本；
- `shotStore`、`selectionStore`、`layerStore`、`characterStore` 继续围绕同一项目实例工作；
- 预览与导出继续共享 domain evaluator / renderer；
- Renderer 不直接访问 `fs` 或 `child_process`；
- 所有项目时间保持整数毫秒；
- 项目切换后所有项目局部草稿必须切换上下文，不得出现 A→B→A 串值；
- Recovery、保存、最近项目、中文路径、Gate A 与 Day 13～25 业务能力不能因布局迁移退化。

---

## 3. 目标信息架构

### 3.1 顶层状态

顶层只保留三个互斥产品状态：

```ts
type ApplicationRegion =
  | { kind: 'start' }
  | { kind: 'editor'; projectRoot: string }
  | { kind: 'fatal-project-error'; projectRoot?: string };
```

- `start`：新建、打开、最近项目、演示项目入口；
- `editor`：固定五区工作区；
- `fatal-project-error`：只用于当前项目无法继续工作的不可恢复错误，不把普通字段错误升级为整页错误。

`debug=1` 与 `gateA=1` 继续作为正交诊断覆盖层，不进入产品导航。

### 3.2 Editor Shell 区域职责

| 区域 | 始终可见 | 内容 | 允许滚动 | 不允许承载 |
|---|---|---|---|---|
| TopBar | 是 | 项目标识、保存、撤销/重做、预览、导出、全局状态 | 否 | 大表单、最近项目完整列表 |
| ActivityRail | 是 | 镜头、素材、角色三个主活动入口 | 否 | 业务详情 |
| NavigationDock | 可折叠 | 当前活动的列表、搜索、创建/导入入口 | 仅内部纵向 | 画布、属性大表单 |
| CanvasWorkspace | 是 | 单一 Canvas、画布工具栏、空状态 | 不做页面纵向滚动 | 素材管理、角色管理、时间轴 |
| InspectorDock | 可折叠 | 根据选中对象显示属性、动作或对白编辑 | 仅内部纵向 | 完整列表、第二个 Canvas |
| TimelineDock | 可折叠/调高 | 刻度、播放头、轨道、片段和时间缩放 | 横向为主；轨道区必要时纵向 | 素材网格、项目入口 |
| StatusBar | 是 | 保存/时间/任务/错误摘要 | 否 | 长日志、确认表单 |

### 3.3 左侧活动导航

MVP 默认三个活动：

```ts
type PrimaryActivity = 'shots' | 'assets' | 'characters';
```

默认选择 `shots`。点击活动时只替换 `NavigationDock` 的内容，不滚动画布、不修改项目、不创建 History。

#### 镜头活动

- 顶部：搜索（镜头超过 10 个后启用）、新增、复制；
- 主体：镜头缩略图、名称、时长、拖拽顺序；
- 底部：项目总时长；
- 选中镜头后，右侧检查器显示镜头设置；中央画布切换到该镜头；底部时间轴切换到该镜头。

#### 素材活动

- 顶部：导入按钮、分类切换、搜索；
- 主体：紧凑缩略图网格；
- 导入进度用任务条/Toast 表示，不常驻一整块“安全素材导入”表单；
- 选中素材时，详情进入右侧检查器；
- 拖到画布仍使用现有 MIME 与项目内相对路径合同。

#### 角色活动

- 主体：角色列表和小型表情预览；
- 新建角色通过轻量弹窗或 Dock 内短表单；
- 角色默认属性、表情映射、张嘴图进入右侧检查器；
- 不把角色列表、角色基本设置和全部表情编辑器同时纵向展开。

### 3.4 右侧上下文检查器

右侧不是固定“属性全集”，而是由选择上下文决定：

```ts
type InspectorContext =
  | { kind: 'none' }
  | { kind: 'shot'; shotId: string }
  | { kind: 'asset'; assetId: string }
  | { kind: 'character'; characterId: string }
  | { kind: 'layer'; shotId: string; layerId: string }
  | { kind: 'timeline-event'; shotId: string; eventId: string }
  | { kind: 'dialogue'; shotId: string; dialogueId: string }
  | { kind: 'audio-clip'; shotId: string; clipId: string };
```

上下文优先级：

1. 时间轴片段选择；
2. 画布图层选择；
3. 左侧列表实体选择；
4. 当前镜头；
5. 无选择空状态。

右侧页签只在上下文支持时出现：

| 上下文 | 页签 |
|---|---|
| 图层 | 属性 / 动作 / 层级 |
| TimelineEvent | 事件参数 / 冲突说明 |
| Dialogue | 对白 / 字幕 / 音频 |
| 角色 | 基础 / 表情 / 嘴型 |
| 镜头 | 基础 / 背景 |
| 素材 | 详情 / 引用 |

高级字段使用可折叠 `InspectorSection` 渐进披露；关键字段默认展开。折叠状态属于 UI 偏好，不进入项目 JSON。

### 3.5 中央画布

中央区域固定包含：

```text
CanvasWorkspace
├─ CanvasToolbar
│  ├─ fit / 100% / zoom- / zoom+
│  ├─ 坐标与缩放摘要
│  └─ 可选 guide 开关
├─ CanvasViewport
│  └─ CanvasStage [唯一实例]
└─ CanvasEmptyState / DropFeedback / SelectionOverlay
```

设计要求：

- 画布尽量占据最大矩形；
- 16:9 舞台始终完整可见或在用户主动放大后由 CanvasViewport 自身平移/滚动；
- 时间轴高度变化只改变显示比例，不改变 1920×1080 逻辑坐标；
- 左右 Dock 开合时使用 `ResizeObserver` 重新计算 fit scale，不写回项目；
- 图层选择框、拖放幽灵、参考线与舞台共享坐标转换；
- 禁止在 Preview 模式另挂第二个 Stage；同一个 Stage 切换交互能力和求值输入。

### 3.6 底部时间轴

Timeline Dock 是 Day 26 以后时间功能的唯一产品入口：

```text
TimelineDock
├─ TimelineToolbar
│  ├─ play / pause / stop
│  ├─ current time / duration
│  ├─ snap toggle
│  └─ zoom controls
├─ TimelineViewport
│  ├─ TimelineRuler
│  ├─ TimelinePlayhead
│  ├─ LayerEventTracks
│  ├─ DialogueTrack
│  └─ AudioTracks
└─ ResizeHandle
```

时间轴交互约束：

- 默认高度 216 px，可在 160～窗口高度 45% 之间调整；
- 折叠后保留 40～44 px Transport Bar；
- 横向缩放只改变 `pixelsPerSecond`；
- 播放头、滚动位置、缩放和 Dock 高度不设置 dirty；
- 拖动事件/对白片段才修改项目并进入 History；
- 拖动过程中使用临时预览值，pointer up 只提交一个合并命令；
- 当前时间永远是整数毫秒；
- 时间轴与画布使用同一个当前镜头、当前选择和 PreviewStore。

### 3.7 最近项目与项目切换

最近项目不再放在编辑器长页面中。目标位置：

- StartScreen：完整最近项目列表；
- EditorTopBar：项目名按钮打开轻量 Project Popover，包含“切换项目”“打开其他项目”“回到开始页”；
- Recovery Candidate：继续使用紧凑 Banner，仅在有候选时出现；
- Dirty Guard：所有切换入口继续走统一 Save / Discard / Cancel。

禁止在 Editor 内常驻完整 `RecentProjectsPanel`。

---

## 4. 布局尺寸与响应式合同

Panda Stage 是 Windows 桌面工具，不追求手机布局，但必须在当前窗口最小值 `800×560` 到常见 `1920×1080` 之间保持可操作。

### 4.1 尺寸 Token

```css
:root {
  --topbar-height: 52px;
  --statusbar-height: 24px;
  --activity-rail-width: 44px;
  --navigation-dock-default: 252px;
  --navigation-dock-min: 216px;
  --navigation-dock-max: 360px;
  --inspector-dock-default: 304px;
  --inspector-dock-min: 264px;
  --inspector-dock-max: 420px;
  --timeline-default-height: 216px;
  --timeline-min-height: 160px;
  --timeline-collapsed-height: 42px;
}
```

这些是推荐初值，不是业务数据。最终数值必须用真实 Electron 截图在 100% / 125% / 150% Windows 缩放下验证。

### 4.2 断点策略

| 可用宽度 | 行为 |
|---:|---|
| `>= 1280` | 左右 Dock 同时显示；活动栏常驻；完整 TopBar |
| `1000～1279` | 左右 Dock 仍可并存，但采用较小默认宽度；次要文字按钮可变成图标 + Tooltip |
| `800～999` | 左 Dock 与右 Inspector 改为互斥覆盖式 Dock；中央舞台不被压到不可用；TopBar 收起项目路径和次要文案 |

高度策略：

| 可用高度 | 行为 |
|---:|---|
| `>= 720` | 时间轴默认 216 px |
| `600～719` | 时间轴默认 176 px |
| `560～599` | 时间轴默认折叠；用户展开时覆盖部分舞台，而不是把舞台挤出视口 |

### 4.3 滚动所有权

必须用自动化断言以下关系：

```text
document.documentElement.scrollHeight === document.documentElement.clientHeight
document.body.scrollHeight === document.body.clientHeight
EditorShell.scrollHeight === EditorShell.clientHeight
CanvasWorkspace 不承担产品纵向滚动
NavigationDockContent 可纵向滚动
InspectorDockContent 可纵向滚动
TimelineTrackViewport 可横向滚动
```

同一 wheel 事件不得同时滚动两个嵌套纵向容器。Dock 标题和主要操作使用 sticky header，但避免超过两层 sticky。

---

## 5. 视觉系统与样式工程

### 5.1 视觉方向

保留当前深色、绿色品牌感，但从“每个模块都是一张大卡片”改成桌面编辑器的层级：

- 最深色：应用背景；
- 中间色：Dock 与工作区；
- 浅一层：输入、列表项、选中态；
- 品牌绿只用于主操作、选中态和焦点，不作为所有边框；
- 警告、错误、成功使用独立语义色；
- 去掉 Day 编号、Gate 编号和工程术语等开发痕迹。

### 5.2 推荐 Design Tokens

```css
:root {
  --color-app-bg: #0b100e;
  --color-surface-1: #111813;
  --color-surface-2: #17211a;
  --color-surface-3: #1d2a21;
  --color-border-subtle: rgb(177 207 185 / 14%);
  --color-border-strong: rgb(177 207 185 / 30%);
  --color-text-primary: #edf5ef;
  --color-text-secondary: #b3c2b8;
  --color-text-muted: #839188;
  --color-accent: #63c982;
  --color-accent-hover: #79d995;
  --color-accent-soft: rgb(99 201 130 / 14%);
  --color-danger: #f07d7d;
  --color-warning: #e9bd62;
  --color-success: #69cf8a;
  --color-info: #76b7e8;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --focus-ring: 0 0 0 3px rgb(99 201 130 / 32%);
}
```

需要用对比度工具验证实际颜色。正文与背景目标至少 `4.5:1`，大字和非文本控件至少 `3:1`。

### 5.3 字体与密度

- UI 字体：`Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif`；
- 正文默认 13～14 px；
- Dock 标题 13～14 px / 600；
- 重要时间码使用 tabular numerals；
- 普通控件高度 32 px，主按钮 34～36 px；
- 图标按钮视觉尺寸 16～18 px，点击区域不小于 32×32 px；
- 表单行用 8 px 垂直节奏，不再用大卡片间距把每个字段撑成文章。

### 5.4 最小 UI Primitive

不要在 Day 26 引入庞大 Design System，但应建立一组轻量复用件：

```text
src/renderer/ui/
├─ Button.tsx
├─ IconButton.tsx
├─ SegmentedControl.tsx
├─ PanelHeader.tsx
├─ InspectorSection.tsx
├─ EmptyState.tsx
├─ StatusBadge.tsx
├─ InlineMessage.tsx
├─ Tooltip.tsx
├─ Dialog.tsx
└─ ToastRegion.tsx
```

规则：

- 所有按钮至少有可访问名称；
- 只使用一套图标来源；若增加图标依赖，必须可 tree-shake 且记录许可证；
- Tooltip 只补充解释，不承载必须信息；
- Dialog 使用 Portal、焦点圈定、Escape 和焦点恢复；
- Toast 有 `aria-live`，成功消息自动消失，错误消息必须可读并可关闭；
- 业务组件不重复造按钮、标题和状态颜色。

### 5.5 CSS 文件拆分

当前 `styles.css` 已同时承担根布局和全部功能样式。建议渐进拆分：

```text
src/renderer/styles/
├─ tokens.css
├─ reset.css
├─ shell.css
├─ utilities.css
├─ components.css
├─ timeline.css
├─ inspector.css
└─ onboarding.css
```

迁移规则：

1. 先复制语义不变的 Token 和 Shell 规则；
2. 每迁移一个组件，同时删除旧 selector，禁止保留两份互相覆盖；
3. 不在一个 Day 中“顺便格式化”全部旧 CSS；
4. 禁止 `!important` 作为正常层级策略；
5. 所有 Grid/Flex 子项显式设置 `min-width: 0` / `min-height: 0`；
6. 使用 CSS 变量表达可调 Dock 尺寸，不通过 React 每帧写大量 inline style；
7. ResizeHandle 更新变量时使用 `requestAnimationFrame` 节流。

---

## 6. 交互设计合同

### 6.1 选择与焦点

- 左侧选中镜头会更新当前镜头、舞台和时间轴；
- 画布选中图层会打开右侧“属性”上下文；
- 时间轴选中事件或对白会覆盖图层检查器上下文，但不清除当前图层 ID；
- 按 Escape 的优先级：关闭弹窗 → 关闭浮层 → 取消拖动 → 清除片段选择 → 清除图层选择；
- 切镜头时清除不属于新镜头的 layer/event/dialogue 选择；
- 切项目时重置所有项目局部 UI 状态，保留纯偏好（Dock 宽度、主题等）。

### 6.2 表单提交语义

不同字段不能全部使用同一种“保存”语义：

| 字段类型 | 提交方式 | History |
|---|---|---|
| Toggle / 单选 | 立即提交 | 一次命令 |
| Slider / 画布拖动 | 拖动中临时预览，pointer up 提交 | 连续操作合并一次 |
| 短文本 | Enter / blur 提交；Escape 还原 | 一次命令 |
| 多字段创建表单 | 明确“创建/应用” | 成功后一次命令 |
| 非法数字草稿 | 保留输入并显示就地错误，不写 Store | 无 |

面板切换、选区变化或项目切换不得静默丢失尚未提交的有效草稿。建议建立按上下文 key 管理的 Draft：

```ts
type DraftKey =
  `${string /* projectRoot */}:${string /* entity kind */}:${string /* id */}`;
```

草稿至少在组件生命周期内由 `DraftStore` 或表单 Controller 持有，而不是依赖长页面永不卸载。项目切换后必须清理旧项目 Draft。

### 6.3 Dirty、保存与状态反馈

- 只有项目模型发生变化才设置 dirty；
- 播放头、Dock、选中态、缩放、搜索、页签不设置 dirty；
- TopBar 只保留一个全局“保存整个项目”入口；
- 模块内按钮使用“应用变换”“创建角色”“更新对白”等动作名，不再出现多个“保存”；
- 保存中：按钮禁用并显示进度；
- 保存成功：状态条短暂显示“已保存 HH:mm:ss”；
- 保存失败：保持 dirty，显示原因、影响和下一步；
- 自动保存错误不覆盖正式保存错误；
- 项目切换继续使用统一 Dirty Guard，不另造 Web `confirm()`。

### 6.4 空状态

空状态只给下一步，不写技术说明：

- 无镜头：“创建第一个镜头”；
- 无素材：“导入 PNG、JPG、MP3 或 WAV”；
- 镜头无图层：“从素材栏拖入背景或角色”；
- 未选图层：“选择舞台上的角色以编辑属性”；
- 时间轴无事件：“从右侧动作面板添加预设”；
- 无对白：“添加第一句对白”。

每个空状态最多一个主操作和一个次要帮助链接。

### 6.5 错误与确认

| 场景 | UI |
|---|---|
| 字段非法 | 字段下方 inline error，焦点留在字段 |
| 导入部分失败 | Toast 摘要 + 可展开详情 |
| 删除被引用素材 | Modal，列出引用位置；默认取消 |
| 删除镜头/角色 | Modal 或可撤销删除；说明影响 |
| 保存/切换失败 | 保持当前项目和 dirty，错误 Banner/Modal |
| 导出校验失败 | Export Dialog 内问题列表，可跳转到对象 |
| 后台非阻塞失败 | StatusBar + Toast |
| 致命项目错误 | 独立错误页，提供回到开始页与日志位置 |

所有错误文案遵守“发生了什么 / 有什么影响 / 下一步怎么做”三段式。

### 6.6 键盘与可访问性

最低键盘合同：

| 快捷键 | 行为 |
|---|---|
| `Ctrl+S` | 保存整个项目 |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做 |
| `Space` | 非输入焦点时播放/暂停 |
| `Home` / `End` | 播放头到镜头首/尾 |
| `Delete` | 删除当前可删除选择 |
| `Escape` | 按优先级退出当前临时状态 |
| `1 / 2 / 3`（可选） | 聚焦镜头 / 素材 / 角色活动 |

要求：

- ActivityRail 使用 `aria-current` 或 tabs 语义；
- Timeline clip、镜头和素材卡都有明确可访问名称；
- 拖拽功能必须有按钮/键盘等价路径；
- 焦点不可被画布 `preventDefault` 无差别吞掉；
- 打开/关闭 Dialog 或 Dock 后恢复合理焦点；
- Windows 150% 缩放下焦点环和文本不被裁切。

---

## 7. 状态架构

### 7.1 三类状态必须分开

| 类型 | 示例 | 所有者 | 是否进入项目 JSON | 是否进入 History |
|---|---|---|---|---|
| 项目状态 | 镜头、图层、事件、对白、素材引用 | `EditorProjectStore` + domain service | 是 | 是 |
| 会话状态 | 当前镜头、图层/片段选择、播放状态 | shot/selection/preview stores | 否 | 否 |
| UI 偏好 | 活动页、Dock 宽度、折叠状态、时间轴高度 | `WorkspaceUiStore` | 否 | 否 |

禁止为了方便，把会话或 UI 偏好塞进 ProjectSchema。

### 7.2 WorkspaceUiStore 建议接口

沿用当前 `useSyncExternalStore` 风格即可，不强制在 Day 26 新增 Zustand 依赖：

```ts
interface WorkspaceUiSnapshot {
  primaryActivity: 'shots' | 'assets' | 'characters';
  navigationDockOpen: boolean;
  inspectorDockOpen: boolean;
  inspectorTab: 'properties' | 'actions' | 'order' | 'dialogue';
  timelineOpen: boolean;
  timelineHeightPx: number;
  navigationWidthPx: number;
  inspectorWidthPx: number;
  compactMode: boolean;
}

interface WorkspaceUiStore {
  getSnapshot(): WorkspaceUiSnapshot;
  subscribe(listener: () => void): () => void;
  setPrimaryActivity(activity: PrimaryActivity): void;
  setDockOpen(dock: 'navigation' | 'inspector' | 'timeline', open: boolean): void;
  resizeDock(dock: 'navigation' | 'inspector' | 'timeline', pixels: number): void;
  resetForProjectSwitch(): void;
}
```

第一阶段只需内存状态。若后续持久化面板尺寸，写入 app userData 的设置文件或受控设置 IPC；不得写进项目，也不得由 Renderer 直接操作文件系统。

### 7.3 预览状态

PreviewStore 至少包含：

```ts
interface PreviewSnapshot {
  mode: 'editing' | 'shot-preview' | 'project-preview';
  transport: 'stopped' | 'playing' | 'paused' | 'seeking';
  currentTimeMs: number;
  activeShotId: string | null;
  durationMs: number;
}
```

- `currentTimeMs` 是整数；
- rAF 只读取主时钟并触发渲染；
- AudioContext 是项目预览主时钟；
- 停止、切镜头、切项目和卸载必须释放音频节点；
- Preview 状态不进入 History；
- 同一 `StageRenderer` 消费静态编辑态或 evaluator 结果。

### 7.4 选择状态收敛

不建议让每个新功能再创建互不知情的 `selectedXxxId`。Day 28 前应提供统一只读派生层：

```ts
interface EditorSelectionSnapshot {
  shotId: string | null;
  layerId: string | null;
  timelineItem:
    | { kind: 'event'; id: string }
    | { kind: 'dialogue'; id: string }
    | { kind: 'audio'; id: string }
    | null;
  navigationEntity:
    | { kind: 'asset' | 'character' | 'shot'; id: string }
    | null;
}
```

可以继续复用现有 store，先用 selector/controller 聚合；不要求一次性重写 Store。

---

## 8. 组件迁移矩阵

| 当前组件 | 目标区域 | 目标实例数 | 迁移策略 | 最晚完成 |
|---|---|---:|---|---|
| `LegacyWorkspace` | 删除 | 0 | 所有子模块迁出后删除容器与旧滚动 Gate | Day 26 |
| `ProjectRecoveryPanel` | 删除/改名为纯组合前拆除 | 0 | 最近项目回 StartScreen，业务模块分别迁入 Dock | Day 26 |
| `CanvasStage` | CanvasWorkspace | 1 | 保留现有 Store/domain，删除第二挂载 | Day 26 |
| `HistoryControls` | TopBar | 1 | 与保存、预览同级；保留快捷键 | Day 26 |
| `ShotManager` | NavigationDock + Inspector | 1 个逻辑入口 | 列表与编辑器拆成 presenter，选择共享 | Day 26 |
| `AssetLibrary` | NavigationDock + Inspector | 1 个逻辑入口 | 网格留左，详情与引用进右，导入变紧凑操作 | Day 26 |
| `CharacterManager` | NavigationDock + Inspector | 1 个逻辑入口 | 列表留左，角色/表情设置进右 | Day 26 |
| `ActionPresetPanel` | Inspector “动作”页签 | 1 | 仅图层选中时可用 | Day 26 |
| `LayerPositionPanel` | Inspector “属性” | 1 | 合并重复字段与状态输出 | Day 26 |
| `LayerTransformPanel` | Inspector “属性” | 1 | 与位置、透明度分组 | Day 26 |
| `LayerOrderControls` | Inspector “层级” | 1 | 删除、锁定、层级集中 | Day 26 |
| `RecentProjectsPanel` | StartScreen / ProjectPopover | 1 个可见入口 | Editor 中不常驻完整列表 | Day 26 |
| `TimelineShell` | TimelineDock | 1 | 新功能直接进入正式 Dock | Day 26 |
| `DialogueEditor` | Inspector | 1 | 选择对白片段时显示 | Day 28 |
| `PreviewControls` | TopBar + TimelineToolbar | 1 套 Controller | 两处可有按钮代理，但状态源只能一个 | Day 29 |
| `ExportDialog` | Modal Portal | 1 | 不进入工作区滚动树 | Day 34 |
| `FirstRunGuide` | StartScreen + 非阻塞 Coach Marks | 1 | 可跳过，不遮死界面 | Day 36 |

迁移过程中可先拆 presenter 与容器，但不能同时保留旧完整 Manager 和新完整 Manager 两棵可交互树。

### 8.1 每个 UI 组件的交付卡

Day 26 以后，任何新增或迁移的产品组件都必须在任务描述或 PR 中填写下面这张交付卡。缺少 owner 的组件默认不准挂载：

| 字段 | 必须回答的问题 |
|---|---|
| Host region | 属于 TopBar、左侧、中央、右侧、底部、StatusBar 还是 Dialog？ |
| Invocation | 用户从哪个可见入口打开？是否依赖当前选择？ |
| Exit | 如何关闭/返回？关闭后焦点回到哪里？ |
| Visibility | 与哪些组件互斥，在哪些状态下不挂载？ |
| Scroll owner | 谁拥有横向/纵向滚动？是否会推动根页面？ |
| Focus contract | 初始焦点、Tab 顺序、Escape、拖拽的键盘等价路径是什么？ |
| State owner | 字段属于项目数据、项目会话、UI 偏好、瞬时任务还是表单草稿？ |
| Persistence | 是否进 `project.json`、History、app settings，还是仅内存？ |
| Small window | 800×560 下折叠、抽屉或 overflow menu 的行为是什么？ |
| Empty/error/busy | 无选择、无数据、失败、长任务分别显示什么？ |
| Cardinality | 生产 DOM 中允许几个实例？谁拥有全局监听器？ |
| Evidence | 哪个 unit/component/Electron 测试和哪张截图证明合同？ |

`LegacyWorkspace` 只能作为迁移前的兼容桥，不能成为未来功能的 host region。**从 Day 26 起，任何新功能都不得再向它追加一个纵向产品 `<section>`。**

---

## 9. Day 26～45 分日实施方案

本节以当前 `agent task/DAY-26-AGENT-TASK.md`～`DAY-45-AGENT-TASK.md` 为编号基准，不采用旧 `DAILY_PLAN.md` 中已发生位移的功能编号。

### Day 26 — 正式工作区迁移 + Timeline Shell

#### 目标

在不改变项目模型和时间语义的前提下，完成长页面退场，并把时间轴直接安装到底部正式 Dock。**如果 Timeline 仍挂在 LegacyWorkspace 内，本日不得判完成。**

#### 开工前能力预检

修订后的任务链默认 Day 25 已经能生成 TimelineEvent，但旧 `DAILY_PLAN.md` 曾把“通用事件条编辑”安排在后续日程，修订版 Day 26～29 又没有清晰 owner。若不先补这张表，Day 30 Gate B 可能在最后一天才发现“能生成事件，却不能在时间轴选择、改时长或删除”：

| 能力 | 当前基线证据 | Day 26 决策 | Gate 依赖 |
|---|---|---|---|
| 八个动作预设生成合法事件 | `src/domain/actions/*`、`ActionPresetPanel`、对应 unit/integration tests | 迁入 Inspector，不重复实现 | Gate B 必须 |
| 事件 schema 与整数毫秒 | `src/domain/models/timeline-event.ts`、validator tests | 保持现有 domain owner | Gate B/C 必须 |
| 事件列表/clip 可视化 | 当前没有正式 Timeline owner | Day 26 至少实现只读 clip、选择与空状态 | Gate B 必须 |
| 事件选择后参数编辑 | 修订任务书没有明确日 owner | 指定给 Day 27/28 的 Inspector slice，或建立阻塞 Issue | Gate B 必须 |
| 改开始/结束时间、删除事件 | 不能从动作预设入口完整覆盖 | Day 26 定义 command/History 合同，最晚 Day 28 完成 | Gate B 必须 |
| clip 拖动/缩放与冲突提交 | Day 27 才定义冲突语义 | Day 26 只显示候选位置；Day 27 后才能提交 | Gate B 必须 |
| 预览 seek 与事件结果联动 | Day 29 才有项目预览 | Day 26 提供稳定 playhead，Day 29 接 PreviewStore | Gate B 必须 |
| Dialogue/audio clip 编辑 | Day 28 明确负责 | 不提前塞入 Day 26，占位轨道不得冒充完成 | Gate B 必须 |

开工 Evidence 必须把每行标为 `implemented / missing / assigned / blocked`，附 owner、测试和目标 Day。未分配的 Gate B 必需能力会直接阻塞 Day 30，不得用手改 JSON 代替。

#### 建议切片

1. `WorkspaceUiStore`、Shell tokens 和五区 Grid；
2. 左侧 ActivityRail / NavigationDock；
3. 单一 CanvasWorkspace 与右侧 Inspector；
4. 移除旧双挂载与 LegacyWorkspace；
5. Timeline 几何纯函数；
6. Timeline ruler/playhead/toolbar；
7. Dock resize、折叠与 800×560 降级；
8. Gate selector/navigation 迁移。

#### 关键文件

```text
src/renderer/shell/EditorShell.tsx
src/renderer/shell/WorkspaceLayout.tsx
src/renderer/shell/ActivityRail.tsx
src/renderer/shell/NavigationDock.tsx
src/renderer/shell/InspectorDock.tsx
src/renderer/shell/TimelineDock.tsx
src/renderer/shell/StatusBar.tsx
src/renderer/stores/workspaceUiStore.ts
src/renderer/features/timeline/*
src/renderer/styles/*
```

Agent Task 中写的 `src/features/*` 是目标示意；当前仓库真实路径位于 `src/renderer/features/*`，禁止另建第二套平行 UI 根。

#### UI/UX DoD

- 1366×768 首屏可同时看到 TopBar、舞台、左右工具和折叠/展开时间轴；
- `LegacyWorkspace` 数量为 0；
- `CanvasStage` 与 `HistoryControls` 各为 1；
- 根页面 scrollTop 永远为 0；
- 镜头/素材/角色切换无需滚动；
- 播放头变化不设置 dirty；
- 改时间轴缩放和 Dock 尺寸不修改项目；
- 800×560 仍能选择镜头、编辑画布、打开检查器和控制时间轴；
- 原 Day 13～25 业务 Gate 迁移后保持真实操作，不使用隐藏 DOM。

#### 证据

- 800×560、1200×760、1366×768、1920×1080 截图；
- Windows 100% / 150% 缩放截图；
- DOM cardinality 与 scroll ownership JSON；
- Timeline geometry / snap / frame mapping tests；
- Dock 交互与 dirty 不变测试；
- 实际点击镜头→选图层→动作→时间轴的录屏。

### Day 27 — 确定性 Timeline Evaluator

#### 前端位置

Day 27 以纯 domain 为主，不新增产品区域。冲突结果只通过：

- Inspector 事件参数页的 inline error；
- Timeline clip 的冲突外观；
- StatusBar 的简短摘要。

不得增加“Evaluator 调试长页面”。

#### 交互要求

- 非法重叠在创建/拖动提交前阻止；
- 拖动时允许预览候选位置，但冲突时保持最后合法值；
- shake 是基础位置的附加偏移，Inspector 不把 shake 后位置写回 x/y；
- 同时刻离散事件显示稳定排序说明；
- 错误片段可被键盘聚焦，并提供跳转到 Inspector。

#### DoD 补充

- evaluator 重复 100 次一致；
- Preview 和 hidden export 静态/运行证据证明共享同一 evaluator；
- 时间轴片段冲突状态不依赖数组偶然顺序；
- 错误色之外还有图标/文本，不只靠颜色。

### Day 28 — 对白、字幕、音频与嘴型

#### UI 归属

- Dialogue clip：TimelineDock 的 Dialogue Track；
- 新增对白：TimelineToolbar 或轨道空状态；
- DialogueEditor：右侧 Inspector；
- 字幕：中央唯一 Stage；
- 音频状态：对白检查器与轨道片段；
- 嘴型：domain evaluator / StageRenderer，不新增独立页面。

#### Inspector 信息结构

```text
对白
├─ 角色
├─ 文本
├─ 开始 / 时长
├─ 音频
├─ 字幕 [开关]
│  ├─ 位置（MVP 固定安全区为默认）
│  ├─ 字号
│  └─ 描边
└─ 高级
   └─ 重叠优先级说明（只读）
```

#### 交互要求

- 拖动对白条只在 pointer up 提交一个 History；
- 选中对白时舞台和音频预览定位到 startMs；
- 超长字幕在舞台上实时预览两行安全区，不缩成不可读小字；
- 无音频仍显示字幕，无嘴图仍可播放；
- 对白重叠用稳定 z-order 和角色嘴型规则；
- 切换 Inspector 页签不丢未提交文本。

#### DoD 补充

- 3 句对白完整键盘编辑；
- 无音频、无嘴图、空文本、长文本都不产生白屏；
- 项目保存重开后文本、时间、音频和样式一致；
- 1366×768 时不需要滚动整个页面才能完成“添加对白→分配音频→预览”。

### Day 29 — 项目级连续预览

#### UI 归属

- TopBar：预览当前 / 预览全部主入口；
- TimelineToolbar：播放、暂停、停止、时间码；
- CanvasWorkspace：同一 Stage 切换为预览态，编辑 handles 暂时禁用；
- StatusBar：当前镜头、总时间、音频解锁/错误；
- 不创建全屏第二棵产品 DOM；沉浸预览可用同一 Stage 的布局模式。

#### 状态机

```text
editing
  ├─ play shot ─→ shot-preview
  └─ play all  ─→ project-preview

preview
  ├─ pause/resume
  ├─ seek
  ├─ stop ─→ editing@0
  └─ end  ─→ editing@0（默认决定）
```

默认结束后回到 0 ms 并恢复编辑手柄；若任务最终选择停在末尾，必须全局一致并更新测试。

#### UX DoD

- 播放时清楚显示当前镜头和总时间；
- seek 后旧音频立即停止；
- 切镜头无上一镜头图层/字幕残影；
- 连续播放结束后焦点返回播放按钮；
- 重播 5 次不会叠音或增长 AudioContext/节点；
- 30 秒漂移证据可复核。

### Day 30 — Gate B：无代码 30 秒编辑闭环

除了原 Agent Task 的业务验收，必须采集可用性证据：

| 指标 | 记录方式 |
|---|---|
| 首次找到素材导入入口耗时 | 从打开空项目到首次点击 |
| 创建第一个镜头耗时 | 操作录像时间戳 |
| 完成一次“选层→动作→预览”点击数 | 逐步记录 |
| 添加一句对白耗时 | 从新增到首次正确预览 |
| 因界面找不到入口造成的回退次数 | 录像标注 |
| 根页面滚动次数 | 目标必须为 0 |
| Dock 切换次数 | 记录，不强行美化 |
| 误触保存/删除/切项目次数 | 记录原因 |
| 未理解文案 | 原文 + 当时意图 |

Gate B 若业务可用但仍必须在长页面查找控件，应判 UX 不达标并进入问题清单，不能只因最终视频能播放就忽略。

### Day 31 — Export Validator 与不可变 Snapshot

本日主要是 Main/domain 工作。前端只准备结构化校验结果协议，不提前伪造导出进度。

#### UX 合同

- 导出按钮打开配置 Dialog；
- 点击“开始导出”后先进入 `validating`；
- 校验问题按“缺素材 / 引用错误 / 时间冲突 / 输出路径”分组；
- 每个问题包含对象名称、影响和“定位”操作；
- “定位”关闭或最小化 Dialog，选中对应镜头/图层/对白并打开正确 Inspector；
- 校验失败不产生隐藏窗口、temp 或 FFmpeg；
- 修复后可直接重新验证。

### Day 32 — 多镜头导出调度与背压

不增加新的工作区 UI。开发诊断信息进入 job log，不放进用户页面。

前端只消费：

```ts
interface ExportProgress {
  jobId: string;
  phase: 'validating' | 'rendering';
  completedFrames: number;
  totalFrames: number;
  fraction: number;
}
```

- UI 进度按“已写入帧”更新；
- IPC 推送节流，界面不因每帧消息重渲染；
- 切项目/编辑项目不影响已创建的 snapshot；
- 导出进行时允许查看项目，但涉及关闭应用/再次导出时给出明确状态。

### Day 33 — 多音频混音与最终编码

本日不做混音台。Export Dialog 只显示阶段从 rendering 到 encoding。

用户可见信息：

- 正在混合音频/编码视频；
- 缺失或损坏的具体音频名称；
- 无音频项目使用的明确策略；
- 输出格式摘要：1080p / 24 FPS / H.264 + AAC；
- 失败后的下一步，不显示整条 FFmpeg 命令。

技术日志保留参数数组、filter graph、stderr 和 jobId，并按现有隐私规则脱敏。

### Day 34 — Export UX、取消、错误与恢复

#### Dialog 页面

```text
配置
  → 校验
  → 渲染帧
  → 编码音频/视频
  → 收尾
  → 完成
```

同一 Dialog 根据状态切换内容，禁止把六个阶段同时纵向铺开。

#### 关键交互

- 配置态：输出位置、文件名、固定输出参数摘要；
- 进行态：阶段名、总体进度、当前/总帧、已用时间、取消；
- 失败态：原因、影响、建议、查看日志、重新导出；
- 取消态：显示正在清理，清理完成后才能重新开始；
- 完成态：打开文件、打开所在文件夹、关闭；
- 关闭 Dialog 不等于取消；进行中点击关闭需明确选择；
- 重复点击取消是幂等操作；
- 正式输出只在成功时存在。

#### 可访问性

- Dialog 打开后焦点落在标题/首字段；
- 进行态用 `aria-live=polite` 报阶段，不逐帧朗读百分比；
- 失败态焦点移到错误摘要；
- 完成/取消后恢复到导出按钮；
- 取消确认默认焦点为“继续导出”。

### Day 35 — Gate C：确定性 30 秒生产导出

除原有编码、关键帧、漂移、取消、内存证据外，补充：

- 导出 Dialog 全状态截图；
- 取消后 UI 能立即再次导出的录屏；
- 失败信息是否能定位具体素材；
- 导出期间主窗口是否保持响应；
- 进度是否单调且阶段含义准确；
- 800×560 和 1366×768 下 Dialog 是否裁切；
- 键盘可完成配置、开始、取消、关闭。

Gate C FAIL 时冻结后续发布工作，不用视觉调整掩盖技术失败。

### Day 36 — Demo Project 与首次使用引导

#### StartScreen 结构

```text
StartScreen
├─ PrimaryActions
│  ├─ 新建项目
│  ├─ 打开项目
│  └─ 打开演示项目
├─ RecentProjects
└─ GettingStarted
```

首次引导采用可跳过的四步 Checklist，不采用遮住全屏且不能退出的教程：

1. 导入一个素材；
2. 创建或选择角色；
3. 创建镜头并拖到舞台；
4. 添加动作/对白并预览。

Checklist 从真实项目状态派生，不写进 ProjectSchema。用户跳过后不再强制弹出，可从帮助菜单重新打开。

演示模板复制必须走 Main Service，取消目录选择不产生半成品，安装目录模板保持只读。

### Day 37 — 自动回归与视觉/交互护栏

把 Day 26 已建立的 runtime component 层扩展成正式回归矩阵，并引入 Playwright Electron E2E；本日不是第一次验证 DOM 交互。

#### Unit

- workspace reducer/store；
- selection priority；
- time geometry、snap、format；
- inspector context mapping；
- responsive mode decision；
- draft key/reset；
- export state/progress。

#### Component

- Activity 切换只出现一个主 Manager；
- Inspector 根据选择切换；
- Timeline 操作不设置 dirty；
- Draft 在页签切换后不串项目；
- Dialog focus/escape/aria；
- EmptyState 与错误消息。

#### Electron E2E

- 800×560、1200×760、1366×768 三档；
- 根无滚动；
- 单一 Canvas/History/Timeline；
- 镜头→图层→动作→播放；
- 素材导入→拖放；
- 对白→字幕→音频；
- 保存重开；
- 导出短探针；
- 失败自动保存 screenshot、trace、renderer console、main log。

不得用直接写 Store/JSON 代替 UI E2E。

### Day 38 — Windows 打包与窗口体验

前端/窗口专项：

- 记录并恢复上次窗口大小与最大化状态（属于 app settings，不属于项目）；
- 首次启动默认尺寸在主显示器 work area 内；
- 最小 800×560 下布局仍可操作；
- 100% / 125% / 150% DPI；
- 中文 Windows 用户名；
- 安装目录只读时主题、图标和 Demo 资源仍可加载；
- 系统字体缺失时使用明确 fallback；
- 导出/错误 Dialog 不跑到屏幕外；
- 多显示器移除后窗口回到可见区域。

不在本日顺手加入自动更新、登录或遥测。

### Day 39 — 用户/开发/架构文档

本文应成为 `docs/architecture.md` 与用户指南的输入之一，但发布文档必须描述**当时真实实现**，不能照抄未来蓝图冒充已完成。

用户指南按任务编排，而不是按组件清单：

1. 建项目；
2. 准备素材与角色；
3. 组织镜头；
4. 在舞台摆位；
5. 添加动作与对白；
6. 预览；
7. 保存、恢复与导出。

每个步骤标注所在区域（左侧/中央/右侧/底部），避免“往下滚找到某某卡片”的旧说明。

### Day 40 — RC1 与功能冻结

RC 日不再调整布局或视觉。只有 P0 修复能进入：

- 焦点陷阱导致无法完成流程；
- 关键操作在支持窗口尺寸下不可见；
- 导出/保存状态误导用户；
- 误操作导致数据损失；
- 屏幕阅读/键盘路径完全阻断关键流程。

其余视觉 polish 进入 Backlog，保证 RC 证据对应同一 commit 和安装包。

### Day 41 — Sample A 真实生产验证

在原任务耗时表中增加 UX 摩擦分类：

```text
NAVIGATION    找不到入口 / 来回切 Dock
DISCLOSURE    需要的字段被藏太深或无关字段过多
FEEDBACK      不知道操作是否成功
ERROR         错误不知如何修复
DRAFT         切换上下文后输入丢失或串值
PRECISION     时间/坐标难以准确输入
PERFORMANCE   切换、拖动、播放卡顿
ACCESSIBILITY 键盘/缩放/焦点阻断
```

每条问题保留录像时间戳、预期、实际、绕路和净损耗分钟数。

### Day 42 — 只修真实 P0

只有 Sample A 证据中的真实 P0 可进入修复。UX P0 典型判定：

- 无法在不改代码/JSON 的情况下完成样片；
- 操作造成项目数据丢失或写错项目；
- 关键按钮在支持窗口/DPI 下不可达；
- 播放/导出状态让用户执行危险冲突操作；
- 键盘焦点困住用户，无法完成主流程。

“颜色不够漂亮”“间距想再调”不是 P0。本日禁止借机重做 Design System。

### Day 43 — Sample B 与效率对比

除总时长外，按同口径比较：

- Navigation 切换次数；
- 完成一个镜头的平均操作数；
- 一句对白的平均处理时间；
- 预览后返工次数；
- 错误恢复时间；
- 保存/导出等待与主动操作时间；
- 可复用素材/角色带来的收益；
- Day 42 修复贡献与熟练度贡献。

不删除变慢项目，不用更简单脚本制造改善。

### Day 44 — 韧性测试中的 UI 恢复

每个故障除进程/文件证据外，还要确认：

- UI 不永久停在 busy；
- 当前项目和 dirty 状态正确；
- 错误关闭后可以再次保存/预览/导出；
- Dock、选择和时间轴没有因错误进入不可能状态；
- 恢复候选 Banner 不遮挡整个编辑器；
- 连续 10 次导出/取消后，Toast、Dialog 和后台订阅数量不增长；
- 最近项目失效路径能定位或移除；
- 磁盘错误不清空有效表单和项目。

### Day 45 — GO / INTERNAL ONLY / NO-GO

最终决策不能用“页面更多、组件更多”证明价值。UX 证据至少回答：

1. 两条真实样片能否不改代码/JSON 完成？
2. 第二条在同复杂度下是否更快？
3. 关键流程是否仍需记忆隐藏入口或反复滚动？
4. 用户能否理解保存、恢复、预览、导出状态？
5. 800×560～1920×1080 与常见 DPI 是否稳定？
6. 开放 P0/P1 是否有明确规避和证据？
7. 后续三个目标是否直接减少出片时间或失败风险？

下一阶段最多三个目标，视觉偏好不能挤掉真实生产阻塞。

---

## 10. 测试与验收矩阵

### 10.0 Day 26 就建立运行时 UI 测试层

当前 `vitest.config.ts` 与 `vitest.integration.config.ts` 都使用 `environment: 'node'`。现有不少“组件测试”验证的是源码字符串、纯 service 或 Store，而不是浏览器中真实渲染后的焦点、可见性、Tab 切换和滚动。这类测试能保护接口，却不能证明本蓝图最关键的 UX 合同。

不要等到 Day 37 才补运行时测试。Day 26 建议有意识地加入并锁定以下开发依赖：

- `jsdom`；
- `@testing-library/react`；
- `@testing-library/user-event`；
- `axe-core` 或等价的可访问性断言适配；
- Day 37 再正式加入 `@playwright/test`，覆盖 Electron 跨进程主路径。

同时新增独立 `vitest.component.config.ts` 和 `test:component` script，避免把所有 unit test 被动切换到 DOM 环境。当前 `package.json` **尚未包含**上述依赖、Playwright 或 `test:e2e`，所以任务书不得把它们写成“已存在工具”。

| 层级 | 从哪一天开始 | 证明什么 | 不能替代什么 |
|---|---:|---|---|
| Pure unit | Day 26 | reducer、几何、selector、evaluator、validator | 真实 DOM 与焦点 |
| Runtime component | Day 26 | 互斥面板、焦点、草稿、Dialog、ARIA、scroll owner | Electron IPC/窗口 |
| Integration | 持续 | Store/service/IPC 合同与持久化 | 用户可见布局 |
| Electron smoke/gate | 每个相关 Day | 真实窗口、preload、Konva、保存/恢复、跨进程流 | 完整回归矩阵 |
| Playwright Electron E2E | Day 37 正式化 | 键鼠主路径、截图、trace、窗口尺寸矩阵 | domain 边界穷举 |

Day 26 的最小 component suite 至少渲染 `WorkspaceLayout`，证明：

1. shots/assets/characters 同时只显示一个；
2. 切换 Activity 不卸载唯一 Canvas；
3. Inspector 跟随选择变化；
4. Timeline 折叠、调高和 seek 不设置 dirty；
5. 800×560 模式下侧栏切换与焦点恢复正确；
6. DOM 中 Canvas、History、Timeline 的 cardinality 符合合同。

### 10.1 “不再是长页面”的硬指标

| ID | 指标 | 通过标准 |
|---|---|---|
| UX-LAYOUT-001 | 根滚动 | editor 状态 root scrollWidth/Height 不超过 clientWidth/Height |
| UX-LAYOUT-002 | 单一画布 | 产品树中 `CanvasStage === 1` |
| UX-LAYOUT-003 | 单一历史 | `HistoryControls === 1` |
| UX-LAYOUT-004 | 单一 Timeline | `TimelineDock === 1` |
| UX-LAYOUT-005 | 互斥 Manager | shots/assets/characters 完整 Manager 同时可见不超过 1 |
| UX-LAYOUT-006 | 中央视图常驻 | 切左/右 Dock 不卸载或复制 Stage |
| UX-LAYOUT-007 | 滚动边界 | 仅 Dock content 和 Timeline viewport 拥有滚动 |
| UX-LAYOUT-008 | 最小窗口 | 800×560 可完成镜头选择、图层编辑、时间跳转 |
| UX-LAYOUT-009 | DPI | 100% / 125% / 150% 无控件裁切 |
| UX-LAYOUT-010 | 无隐藏副本 | 不存在 `display:none` 或屏外可交互旧产品树 |

### 10.2 交互硬指标

| ID | 场景 | 通过标准 |
|---|---|---|
| UX-STATE-001 | UI 偏好 | 面板切换/缩放/时间轴高度不 dirty |
| UX-STATE-002 | 项目切换 | A→B→A 选择、草稿、播放时间不串值 |
| UX-STATE-003 | 拖动 | 连续拖动合并为一条 History |
| UX-STATE-004 | Preview | seek/stop/切镜头无叠音和残影 |
| UX-STATE-005 | 保存 | 全局保存入口唯一，失败保持 dirty |
| UX-STATE-006 | 错误 | 文案含原因、影响、下一步 |
| UX-STATE-007 | Dialog | 焦点进入、圈定、Escape、恢复正确 |
| UX-STATE-008 | 键盘 | 主路径不依赖鼠标拖拽唯一入口 |
| UX-STATE-009 | 导出 | 失败/取消后可再次启动 |
| UX-STATE-010 | Recovery | Banner 紧凑、恢复后 Dirty、保存后 Clean |

### 10.3 性能预算

先记录真实基线，再将下列目标作为 Gate：

- Activity 切换到内容可交互：p95 `< 100 ms`；
- Inspector 上下文切换：p95 `< 100 ms`；
- 画布拖动：目标 `>= 55 FPS`，不得因 Inspector 表单全树重渲染明显掉帧；
- Timeline 拖动播放头：目标 `>= 55 FPS`；
- IPC 进度更新：用户态最多约 10 次/秒；
- 100 个素材卡时 Dock 滚动无明显输入阻塞；
- 连续 20 次 Activity/Dock 切换，订阅和事件监听数量稳定；
- 连续 5 次 Preview，AudioContext/AudioNode 数量回落。

若机器性能不足，必须记录硬件、采样方法和实际值，不能用主观“感觉顺滑”代替。

### 10.4 视觉回归

Day 37 起固定截图矩阵：

```text
800x560    compact / timeline collapsed
1024x640   compact dock
1200x760   default launch
1366x768   primary acceptance
1920x1080  large desktop
```

每档至少覆盖：

- 无项目 StartScreen；
- 已打开空项目；
- 选中图层；
- 打开 Timeline；
- 选中 Dialogue；
- Export Dialog validating/rendering/failed/completed；
- Recovery Banner；
- 150% DPI。

视觉差异测试应屏蔽动态时间码和文件路径，但不能把整个面板 mask 掉。结构/尺寸断言必须独立存在，不能只靠像素截图。

### 10.5 Roadmap A1～A22 追踪

下表防止逐日任务全部“完成”后，Roadmap 的端到端验收仍有孤儿能力。主负责日不是唯一测试日；后续 Gate 必须再次验证。

| 验收项 | 能力 | 主负责日 | 最终证据 |
|---|---|---|---|
| A1 | 项目生命周期 | Day 37 / 40 / 44 | 新建、保存、关闭、重开 E2E 与磁盘快照 |
| A2 | 中文路径 | Day 35 / 38 / 44 | 中文/空格项目、素材、输出安装态测试 |
| A3 | 自动保存与恢复 | Day 37 / 44 | crash/recovery/ignore/save 回归 |
| A4 | 素材导入 | Day 30 / 37 / 40 | PNG/JPG/MP3/WAV UI 主路径 |
| A5 | 角色表情 | Day 28 / 30 / 40 | 两表情建立、切换、预览与重开 |
| A6 | 镜头管理 | Day 30 / 40 | 五镜头创建、排序、持久化 |
| A7 | 画布摆放 | Day 26 / 30 / 40 | 移动、缩放、翻转、层级和单 Canvas 证据 |
| A8 | 撤销重做 | Day 26 / 30 / 37 | 20 步、连续拖动合并、唯一快捷键 owner |
| A9 | 对白字幕 | Day 28 / 30 / 40 | 6～8 句对白、字幕边界与截图 |
| A10 | 音频同步 | Day 29 / 35 / 44 | startMs、30 秒漂移与反复预览无叠音 |
| A11 | 移动动画 | Day 27 / 30 / 35 | A→B 插值、关键帧与预览/导出一致 |
| A12 | 表情切换 | Day 27 / 28 / 30 | 稳定离散排序与边界帧 |
| A13 | 抖动 | Day 27 / 30 / 35 | 确定性、叠加、结束归零 |
| A14 | 嘴巴动画 | Day 28 / 30 | 对白区间固定频率开合与结束闭合 |
| A15 | 动作预设 | Day 26 预检 / 30 | 预设→合法事件→History→保存重开 |
| A16 | 完整预览 | Day 29 / 30 | 五镜头连续播放、seek/stop/切换 |
| A17 | 视频导出 | Day 31～35 | 1080p/24 FPS/H.264 MP4 与媒体探针 |
| A18 | 预览导出一致 | Day 27 / 29 / 35 | 同 evaluator/renderer 与关键帧差异 `<1%` |
| A19 | 导出取消 | Day 34 / 35 / 44 | 幂等取消、临时文件清理、可立即重试 |
| A20 | 演示项目 | Day 36 / 40 | 安装态打开、预览、导出 |
| A21 | 自动化测试 | Day 27 / 37 | schema/evaluator/interpolator/migration/conflict + UI E2E |
| A22 | 构建打包 | Day 38 / 40 | Windows 安装、启动、资源、卸载/重装 |

每个 Day 的 Evidence Index 应反向列出本次覆盖的 A 编号。Day 45 的 GO 决策必须逐行链接到同一 RC commit/安装包的证据，不能只引用“CI 绿色”。

### 10.6 质量命令必须与仓库工具一致

当前仓库有 TypeScript、ESLint、Vitest 和项目 Gate，但没有安装 Prettier，也没有 Prettier 配置。虽然部分 Agent Task 模板写了 `pnpm exec prettier`，在工具正式引入前应这样记录：

```text
typecheck    pnpm typecheck
lint         pnpm lint
unit         pnpm test:unit
integration  pnpm test:integration
format       N/A（未安装 Prettier）；使用 ESLint + git diff --check
gate         运行本日与受影响旧日的真实 verify 脚本
```

若决定引入 Prettier，必须在一个明确提交中加入固定依赖、配置、ignore、script 与一次受控格式化；不得临时下载一个未锁版本后把“命令成功”当作仓库质量门。

---

## 11. Gate 与旧测试迁移策略

### 11.1 原则

旧 Gate 验证的是业务能力，不是旧 DOM 位置。迁移时：

1. 保留业务断言；
2. 用稳定 `data-testid` 或可访问角色找到新 owner；
3. 增加必要的 Activity/Dock 导航；
4. 断言目标真实可见且位于活动 viewport；
5. 删除 Legacy nested-scroll fallback；
6. 禁止 skip、异常吞噬、选择隐藏副本或放宽结果。

### 11.2 Selector owner 建议

| 能力 | 新 owner / selector |
|---|---|
| Editor layout | `[data-testid="editor-workspace"]` |
| Activity rail | `[data-testid="activity-rail"]` |
| Navigation Dock | `[data-testid="navigation-dock"]` |
| Canvas | `[data-testid="project-canvas-stage"]` |
| Inspector | `[data-testid="inspector-dock"]` |
| Timeline | `[data-testid="timeline-dock"]` |
| History | `[data-testid="history-controls"]` |
| Action presets | `[data-testid="action-preset-panel"]` |
| Dialogue inspector | `[data-testid="dialogue-inspector"]` |
| Export Dialog | `[data-testid="export-dialog"]` |
| Recovery | `[data-testid="recovery-candidate-banner"]` |

测试应优先 `getByRole` / accessible name；`data-testid` 用于布局容器、画布和跨语言稳定定位。

### 11.3 Cardinality Guard

建立源码与 Electron 双层断言：

```text
EditorShell       = 1
ProjectController = 1
CanvasStage       = 1
HistoryControls   = 1
TimelineDock      = 1
ExportDialog      <= 1
LegacyWorkspace   = 0
```

这应取代 Stage 1A 的“双 Canvas / 双 History 授权基线”。

### 11.4 旧 selector 必须原子迁移

现有 `scripts/verify-day13.cjs`～`verify-day24.cjs`、`verify-issue73.cjs` 与 contract tests 大量依赖：

- `.recovery-open-row`、`.recovery-panel`、`.recent-projects-list`；
- `.asset-library`、`.asset-card`、`.shot-manager-heading`；
- `.project-canvas` 与 `scrollIntoView()`；
- `[data-testid="project-canvas-stage"]`、`project-canvas-viewport`；
- `[data-testid="layer-transform-panel"]`、`layer-order-controls`；
- `[data-testid="history-controls"]`、`action-preset-panel`；
- `editor-top-bar`、`active-project-path` 与 Recovery Banner。

迁移 PR 必须为每个 selector 做出三选一决定：

1. **保留**：语义 owner 未改变，selector 挂到唯一新实例；
2. **迁移**：先把脚本改成“打开对应 Activity/Inspector → 按角色或稳定 test ID 操作”，再删除旧 selector；
3. **删除**：仅当对应产品能力或断言被批准移除，并有替代验收。

布局迁移、脚本迁移和 contract baseline 更新应在同一可回滚切片内完成。禁止让旧脚本因 `querySelector()` 总取第一实例而“偶然通过”，也禁止在新布局旁保留不可见旧节点。特别是当前 `editor-shell-layout.test.ts` 对双 Canvas/History 的过渡授权，必须被单实例 contract 原子替换。

---

## 12. 推荐文件结构

```text
src/renderer/
├─ shell/
│  ├─ EditorShell.tsx
│  ├─ EditorTopBar.tsx
│  ├─ WorkspaceLayout.tsx
│  ├─ ActivityRail.tsx
│  ├─ NavigationDock.tsx
│  ├─ CanvasWorkspace.tsx
│  ├─ InspectorDock.tsx
│  ├─ TimelineDock.tsx
│  ├─ StatusBar.tsx
│  └─ workspace-layout.ts
├─ features/
│  ├─ assets/
│  │  ├─ AssetBrowser.tsx
│  │  └─ AssetInspector.tsx
│  ├─ characters/
│  │  ├─ CharacterBrowser.tsx
│  │  └─ CharacterInspector.tsx
│  ├─ shots/
│  │  ├─ ShotBrowser.tsx
│  │  └─ ShotInspector.tsx
│  ├─ properties/
│  │  └─ LayerInspector.tsx
│  ├─ actions/
│  │  └─ ActionInspector.tsx
│  ├─ timeline/
│  ├─ dialogue/
│  ├─ preview/
│  ├─ export/
│  └─ onboarding/
├─ stores/
│  ├─ workspaceUiStore.ts
│  ├─ editorSelection.ts
│  ├─ previewStore.ts
│  └─ timelineViewportStore.ts
├─ ui/
└─ styles/
```

这里的 Browser/Inspector 拆分首先是**视图职责拆分**，不是复制 Store 或 domain service。旧 Manager 可在迁移期变成无状态组合器，再被删除。

---

## 13. 分支、提交与回滚建议

### 13.1 Day 26 不宜做成一个巨型提交

建议至少拆成：

1. `refactor(ui): establish workspace layout and ui-only state`
2. `refactor(ui): migrate editor modules out of legacy workspace`
3. `feat(timeline): add ruler playhead snapping and dock`
4. `test(ui): lock workspace cardinality scrolling and breakpoints`

每个提交均应可构建、可测试，并说明回滚边界。

### 13.2 不使用长期双树 Feature Flag

为了回滚，不要在生产中长期保留：

```text
if (workspaceV2) <NewTree /> else <LegacyTree />
```

两棵树会重新引入 Store 订阅、双挂载和 Gate 选择歧义。回滚依靠清晰 commit/revert；短期实验只允许在独立分支，不进入合并后的产品路径。

### 13.3 每日提交边界

- domain 与 UI 可以分 commit，但同一 Day DoD 未全过不能进入下一 Day；
- 不把 Day 27 evaluator 混入 Day 26 layout commit；
- Gate B/C、Sample、Resilience 以证据为主，不顺手重构；
- RC 后功能冻结；
- 文档必须链接真实证据，不写“理论通过”。

---

## 14. 风险、止损与默认决策

| 风险 | 默认决策 | 止损条件 |
|---|---|---|
| Dock 太多挤压舞台 | 800～999 宽度下左右 Dock 互斥覆盖 | 舞台可用宽度低于 360 px |
| 条件卸载导致草稿丢失 | keyed DraftStore + 明确提交语义 | A→B→A 串值或无提示丢输入 |
| Timeline 抢占高度 | 可调高、可折叠、低高度默认折叠 | 560 高度下画布不可操作 |
| Inspector 字段继续变长 | 上下文页签 + InspectorSection | 单上下文仍需穿越多个无关模块 |
| Gate 依赖旧 DOM | 迁移导航，不保留隐藏副本 | Gate 只能通过点击不可见 DOM |
| Store 大重写扩大范围 | 先聚合 selector/controller，不一次性换框架 | 为布局改动触碰 ProjectSchema |
| 视觉重构拖慢功能 | 小型 primitives + token，不建大型组件库 | UI 基建超过一个 Day 且无可验收流程 |
| Preview 另挂 Stage | 同一 CanvasStage 切 mode | 运行时 CanvasStage >1 |
| Export 信息过多 | 单 Dialog 状态切换 + 日志外置 | 用户必须阅读 FFmpeg stderr 才能处理 |
| 新手引导遮挡 | 可跳过 Checklist/coach mark | 引导阻断正常编辑 |

默认产品决策：

- 不引入 React Router：这是单窗口编辑器，Activity/Inspector/Timeline 是会话状态，不是网页 URL；
- 不在 Day 26 引入完整第三方 UI 框架；
- 暂不做可停靠任意布局系统，使用固定五区 + 三个 resize handle；
- 暂不做多工作区、自定义快捷键、主题市场；
- 先保证 1366×768 与 800×560，再做更精细大屏利用；
- 所有新的 UI 动画遵守 `prefers-reduced-motion`，过渡以 120～180 ms 为宜。

---

## 15. 后续 Agent 开工检查表

每个 Day 开工前回答：

- [ ] 当前 M3/上一 Gate 是否真的通过并已获授权？
- [ ] 当前 Agent Task 是否与旧 Daily Plan 编号冲突？
- [ ] 本日 UI 属于左侧、中央、右侧、底部、TopBar、Dialog 中哪一个 owner？
- [ ] 是否正在创建第二个 Canvas、History、Preview Controller 或 Project Controller？
- [ ] 新状态属于项目、会话还是 UI 偏好？
- [ ] 新交互会不会错误设置 dirty？
- [ ] 面板卸载会不会丢草稿或串项目？
- [ ] 是否增加了根页面或中央区域纵向滚动？
- [ ] 800×560、1366×768、150% DPI 如何验收？
- [ ] 键盘和拖拽等价路径是什么？
- [ ] 错误是否说明原因、影响和下一步？
- [ ] 旧 Gate 是迁移真实导航，还是在操作隐藏副本？
- [ ] 证据路径、命令输出、截图和回滚点是什么？

任一项答不清，先补合同或最小复现，不继续堆组件。

---

## 16. 本蓝图完成定义

后续实施只有同时满足以下条件，才算真正解决了用户指出的“所有组件堆一页”：

- 正式产品树不存在 `LegacyWorkspace`；
- 素材、角色、镜头不再同时纵向显示；
- CanvasStage、HistoryControls、TimelineDock 各只有一个；
- 根页面与中央工作区无纵向滚动；
- 左侧、右侧、底部有明确 owner 和滚动边界；
- Timeline、Dialogue、Preview、Export 按本文区域落位；
- UI 偏好与项目 dirty/History 分离；
- A→B→A 项目切换不串选择、草稿和播放状态；
- 800×560～1920×1080、100%～150% DPI 有真实截图/交互证据；
- Day 13～25 业务 Gate 在新导航下继续真实通过；
- Day 26～45 每日功能与证据没有靠隐藏 DOM、双挂载或弱化断言完成；
- Gate B 的 30 秒项目可以不滚整页、不改代码完成；
- Sample B 的制作效率数据能够证明工作流有真实改善，而不只是界面更“像软件”。

达到这些条件后，Panda Stage 才从“功能都存在”迈到“用户能持续完成作品”。
