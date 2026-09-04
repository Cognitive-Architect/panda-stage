# Panda Stage 实机问题实施拆分计划（LM-001 ~ LM-006）

> 来源：Draft PR #416 真人实机问题收口台账。
>
> 当前阶段只记录实施拆分，不创建 implementation Issue，不开始修改产品代码。

## 结论

当前 6 个已确认实机问题建议拆成 **4 个 implementation Issue**：

```text
Issue A — LM-001 + LM-002 + LM-003
Issue B — LM-005
Issue C — LM-006
Issue D — LM-004
```

推荐执行顺序：

```text
A. 小型 UI polish
        ↓
B. Cloud Touch-only 产品路线收口
        ↓
C. Timeline geometry rebaseline
        ↓
D. Canvas flatten + viewport controls relocation
        ↓
Windows / Electron 真人最终验收
        ↓
回填 #416：FIXED / PASS / remaining limits
```

---

## Issue A｜Editor UI 小型视觉收口

包含：

```text
LM-001 — Project Launcher / No Project
LM-002 — Main Editor / Top Toolbar
LM-003 — Right Properties Handle
```

### 目标

一次处理三个低风险 presentation polish：

1. 修正 No Project 下“最近项目”空状态卡视觉重心；
2. 删除顶部工具栏常驻“已保存”展示，但保留真实保存状态/保存逻辑；
3. 右侧“属性”把手改成更稳定的 icon + label 视觉组合。

### 为什么合并

三项共同特点：

- 严重度均为 P3；
- 都属于 presentation / spacing / hierarchy；
- 不应改变业务能力；
- 单独拆三张工单会增加派单、CI、验收成本，却没有带来明显的风险隔离收益。

### MUST

- 不改变 Launcher 项目状态逻辑；
- 不改变保存 truth / dirty state；
- 不改变 Properties drawer 展开/收起业务行为；
- 真人实机复验三处视觉结果。

### MUST NOT

- 借 polish 名义重构 Launcher；
- 删除 saved/dirty 状态 owner；
- 缩小属性把手实际可点击区域。

---

## Issue B｜LM-005：Cloud Touch-only Editor Route

包含：

```text
LM-005 — 移除 Editor Device Mode，只保留 Cloud Touch 自适应 UI
```

### 目标

当前阶段停止维护公开的：

```text
Auto
Desktop
Cloud Touch
```

三路线选择。

产品只走：

```text
Cloud Touch
├─ landscape
└─ portrait
```

### 为什么单开

这不是菜单视觉删减，而是产品路线和 Adaptive Editor Shell presentation routing 收口。

如果只隐藏选择器、不收口默认 Auto / Desktop 分支，宽屏 Windows 仍可能偷偷进入 Desktop composition，因此必须作为独立 P2 变更处理。

### 推荐实施策略

优先小步收口：

```text
- 删除用户可见 Device Mode selector
- EditorShell 固定走 Cloud Touch route
- 横屏 -> landscape
- 竖屏 -> portrait
- 收口已有 deviceMode gate
```

先不要在同一 Issue 里强制做所有 dead-code 清扫。

### MUST

- 横/竖屏 Cloud Touch 都可用；
- 不再由宽度触发 Desktop UI；
- 不修改 Project schema / autosave / Project data；
- 真人验收窗口横竖变化和主要 workspace。

### MUST NOT

- 把 Cloud Touch-only 误做成 landscape-only；
- 一刀删除响应式壳子；
- 顺手重写整个 EditorShell。

---

## Issue C｜LM-006：Timeline Geometry Rebaseline

包含：

```text
LM-006 — Cloud Touch 横屏时间轴缩放几何重新定标
```

详细设计：

`docs/acceptance/LM-006-TIMELINE-RESIZE-GEOMETRY-2026-09-04.md`

### 目标

解决时间轴两端问题：

```text
拉高 -> Left Rail / Timeline 撞车
拉低 -> Toolbar / Ruler / Tracks / Task Tray 被压瘪
```

### 推荐结构

```text
固定：Timeline Toolbar
固定：Ruler + Subtitle/Audio Track Stack
弹性：Task Tray
```

重新校准 expanded min / max：

- min 必须保证 expanded Timeline 真正可用；
- max 同时保护 Canvas、Left Rail、Right Side；
- 想要极小高度继续使用显式 Collapse，不把 expanded state 压成 pseudo-collapsed。

### 为什么单开

涉及 BottomWorkspace / Timeline height owner / container-query presentation contract，是独立的 P2 shell geometry 问题。

### MUST

- 保留单一 BottomWorkspace owner；
- 保留单一 timelineUiStore height owner；
- resize / collapse / reopen 正常；
- min / normal / max 真人验收；
- Timeline 核心 seek / zoom / horizontal scroll / subtitle drag/edit 不回归。

### MUST NOT

- 通过缩字体/触控目标解决浅高度；
- 让 Timeline 覆盖 Left Rail；
- 为高度再造第二份状态。

---

## Issue D｜LM-004：Canvas Flatten + Viewport Controls Relocation

包含：

```text
LM-004 — 扁平化 Canvas 视觉层级
       + 将 viewport mode controls 迁入 Project Tools
```

### 目标

两项动作：

```text
A. Canvas shell visual flattening
B. 适应窗口 / 50% / 1:1 控件迁入“项目工具”
```

同时坚持：

```text
single source of truth = existing canvasViewportStore
```

### 为什么单开

它同时碰到 Canvas workspace presentation、viewport controls surface、Project Tools 入口，但不能改变 Canvas transform / coordinate ownership。

### 推荐放在 LM-006 之后

LM-004 与 LM-006 会共同影响中央工作区的垂直空间分配。

先通过 LM-006 确定 Timeline 合法高度边界，再调整 Canvas shell，更容易避免：

```text
Canvas 调完
-> Timeline 又改高度
-> Canvas 再返工
```

### MUST

- 去掉多余可见 box / border / inset；
- 保留必要 transform / scroll / coordinate wrapper；
- Project Tools 只提供新的控制入口；
- 三种 viewport mode 继续操作现有 canvasViewportStore；
- fit / 50% / actual、滚动、拖拽落点、window resize 真人回归。

### MUST NOT

- 因“去套娃”删除 CanvasViewport 功能结构；
- 在 Project Tools 创建第二套 zoom state；
- 把 LM-006 Timeline geometry 顺手混入本 Issue。

---

## 为什么不是 1 个 Issue

不推荐：

```text
“Fix LM-001 ~ LM-006”
```

因为这会同时横跨：

```text
Launcher
Top Bar
Properties Handle
Adaptive Shell
Timeline
Canvas
Project Tools
```

一旦发生回归，很难定位、回滚和独立验收。

---

## 为什么不是 6 个 Issue

LM-001 ~ LM-003 都是低风险 presentation polish，拆成三张会带来不必要的：

```text
派单成本
分支/PR 成本
CI 成本
真人验收往返成本
```

而风险隔离收益很小，因此聚合成一个 UI polish slice 更合理。

---

## 依赖 / 顺序理由

### B 在 C/D 前

LM-005 先把产品路线收口到 Cloud Touch，后续 Timeline / Canvas 不再需要围绕一个当前不准备维护的 Desktop 产品路线继续做双份设计。

### C 在 D 前

LM-006 先明确 Bottom Workspace 的合法 MIN / NORMAL / MAX，LM-004 再基于稳定的剩余空间整理 Canvas。

### A 可以最先做

LM-001~003 基本不依赖 B/C/D，可以作为低风险热身刀先收掉。

---

## 最终验收模型

四个 implementation Issue 都完成后，回到 #416 做一次统一 Windows / Electron 真人验收。

最低检查：

```text
Launcher
Top Toolbar
Properties Handle
Cloud Touch landscape
Cloud Touch portrait
Timeline MIN / NORMAL / MAX
Timeline collapse/reopen
Canvas fit / 50% / actual
Project Tools
左右侧栏
窗口 resize / 横竖变化
```

只有真人验收通过后，才将对应 LM 标为 FIXED / PASS。

---

## 当前状态

```text
PLAN ONLY
NO IMPLEMENTATION ISSUES CREATED
NO PRODUCT CODE CHANGED
#416 REMAINS DRAFT / OPEN
```

下一步在维护者明确下令后，才按该计划创建 4 张 implementation Issue。
