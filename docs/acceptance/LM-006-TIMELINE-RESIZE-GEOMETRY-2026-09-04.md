# LM-006｜Cloud Touch 横屏时间轴缩放几何重新定标

状态：`CONFIRMED`  
严重度：`P2`  
区域：`Main Editor / Bottom Workspace / Timeline Resize / Left Rail`  
实机环境：`Windows + Electron / Cloud Touch landscape`

## 一句话结论

当前时间轴自由调高/调低的能力本身可以保留，但 Stage A 的旧最小/最大高度已经不适配 Stage B-E 之后的真实内容密度：**拉高会挤到左侧工具栏，拉低会把时间轴内部压瘪。**

推荐重新定标为：

```text
固定：Timeline Toolbar
固定：Ruler + Subtitle/Audio Track Stack
弹性：Task Tray
边界：同时保护 Canvas 和左右侧栏
```

不要再让所有内部内容跟着 Bottom Workspace 一起无差别挤压/拉伸。

---

## 真人实机现象

### A. 拉到较高位置时：左侧 UI 与时间轴“撞车”

维护者实机截图显示，当 Bottom Workspace 被向上拉到较高位置时：

- 左侧 `项目工具` 入口继续向下占据空间；
- 时间轴顶部 `收起时间轴 / timecode` 同时进入同一区域；
- 两组本来属于不同 workspace 的 UI 发生视觉/空间碰撞。

这说明当前 timeline max-height clamp 只保护了部分 Canvas 空间，但没有充分保护左侧 rail 的最小可用高度。

### B. 拉到较低位置时：Timeline 内部出现“瘪瘪的、大小不一”

维护者实机截图显示，当 Bottom Workspace 向下压缩到浅高度时：

- Toolbar、Ruler、字幕/音频轨道、Task Tray 同时争抢有限高度；
- 局部元素视觉高度和间距失衡；
- 轨道区、待安排字幕区呈现被硬塞进一个过薄容器的感觉。

这不是单一字体或 padding 问题，而是 expanded minimum 与当前 Timeline 信息架构不再匹配。

---

## 仓库现状核验

### Stage A 当前高度常量

`timelineUiStore.ts` 当前仍定义：

```text
TIMELINE_EXPANDED_MIN_HEIGHT = 132
TIMELINE_EXPANDED_DEFAULT_HEIGHT = 168
TIMELINE_EXPANDED_MAX_HEIGHT = 420
TIMELINE_MIN_CANVAS_HEIGHT = 240
```

最大高度主要通过：

```text
body + bottom - TIMELINE_MIN_CANVAS_HEIGHT
```

推导。

因此它重点保护 Canvas floor，却没有把当前左侧 rail / 其它 editor-body 固定 UI 的真实最小高度作为同等级约束。

### Stage B-E 已经增加了更高的真实内容底线

Cloud Touch landscape CSS 当前至少包含：

```text
Timeline Toolbar        ~48px
Ruler + Track surface  ~112px
Task Tray               min-height: 76px
```

仅这三块理论上已经超过旧 `132px` expanded minimum；此外还有 separator、Task Tray header / padding 等真实占位。

所以旧 `132px` 已经接近一个“数学上塞不下当前完整信息架构”的 pseudo-collapsed state。

### 原 Stage A 验收意图

Issue #378 原本明确要求：

- expanded minimum 不能缩成 unusable pseudo-collapsed state；
- maximum 不能把 Canvas 消灭；
- `RightInspector / left rail remain stable while Timeline resizes`；
- 真正需要很小高度时使用显式 `收起时间轴`，而不是把 expanded state 无限压扁。

当前真人实机状态说明这些几何约束需要在 Stage B-E 完成后重新校准。

### Stage E 的设计原则也支持重新定标

Issue #382 明确要求：

```text
Shallow expanded:
- Toolbar / Ruler / Tracks remain usable
- Task Tray active state remains identifiable
- primary action/back route remains reachable

Large:
- use extra room meaningfully
- do not vertically stretch buttons/rows/cards into oversized controls
```

因此正确方向不是让所有 Timeline 子元素随父高度等比例“变胖/变瘦”，而是保持核心时间表面稳定，把剩余高度交给 Task Tray。

---

## 推荐设计方向

## 1. 核心时间表面固定高度，不参与挤压

建议把 Timeline 视觉结构明确分成：

```text
[ Resize grip ]
[ Toolbar ]                  固定
[ Ruler + Subtitle/Audio ]   固定
[ Task Tray ]                弹性
```

具体原则：

- Toolbar 高度稳定；
- Ruler / Subtitle lane / Audio lane 高度稳定；
- 播放头、时间刻度、字幕块不随 Bottom Workspace 高度被纵向拉伸；
- Task Tray 吃掉剩余空间。

这样拖动 Timeline 时，用户会感知为“给字幕任务区更多/更少工作空间”，而不是“把整台时间轴像橡皮泥一样捏扁”。

## 2. 重新设定 expanded minimum

不建议继续使用 `132px` 作为当前 Stage B-E 后的 expanded minimum。

建议从真人目标机上重新校准一个“真正可用”的展开底线，初始评估可以从：

```text
约 240–260px
```

区间开始实机试验，而不是直接把该数值视为最终真理。

产品原则：

```text
想要更矮
-> 点击“收起时间轴”

想保持 expanded
-> 最低也要保证核心 Timeline + 最小 Task Tray 是正常 UI
```

即：**Collapse 承担“小”，Resize 承担“工作区大小调整”。**

## 3. 最大高度不能只保护 Canvas，也要保护 Left Rail

当前最大高度的思路应从：

```text
只保证 Canvas >= 240
```

升级为：

```text
editorBodyMin = max(
  canvasMinimum,
  leftRailMinimum,
  rightSideMinimum
)

TimelineMax = availableHeight - editorBodyMin
```

实现可以通过现有 live geometry 测量或一个明确的 shell min-height contract 完成。

目标不是追求公式漂亮，而是确保：

- 时间轴拉到顶，左侧 `镜头 / 素材 / 角色 / 项目工具` 仍不撞到 Bottom Workspace；
- 右侧属性入口也不被挤坏；
- Canvas 仍有实际操作空间。

## 4. Task Tray 是唯一弹性区

建议 Task Tray：

- 中等/大高度：展示更多待安排字幕、Timed editor 或 authoring 内容；
- 浅高度：保留标题/返回/主要动作，内部 body 自己滚动；
- Pending 卡片保持稳定卡片高度，不因为 Timeline 变高就变成大长方块；
- 不因为 Timeline 变低就把卡片压成不一致的扁条。

如果需要 container query，阈值应跟新的 minimum/medium/large 重新标定，而不是继续围绕旧 132px min 做补丁。

## 5. 可选：增加轻微的“磁吸档位”，但不强制

如果后续实机觉得自由拖动太容易停在尴尬高度，可以增加非常轻的 snap：

```text
Compact working
Normal
Large
```

用户仍可自由拖动，只是在接近常用高度时有一点磁吸。

这不是 LM-006 的 MUST，先把 min/max 和内部稳定结构修正确更重要。

---

## 推荐视觉状态

### 最低 Expanded

```text
Toolbar                 正常
Ruler + 两条 Track      正常
Task Tray               紧凑标题 + 必要内容/内部滚动
```

禁止：

```text
轨道变矮
文字撞在一起
卡片高度随机缩水
```

### Normal（主工作态）

```text
Canvas 仍占主导
Timeline 信息完整
Task Tray 有一排舒服的 Pending 卡片 / 编辑内容
```

这是默认高度最应该优化的状态。

### Maximum

```text
Timeline 获得更多任务编辑空间
但 Left Rail 不碰 Timeline
Canvas 仍可操作
按钮/卡片不因为空间多而纵向拉胖
```

---

## 实施边界

### MUST

- 保留单一 `BottomWorkspace` owner；
- 保留单一 `timelineUiStore` height owner；
- 保留 resize grip；
- 保留 collapse / reopen；
- 重定标 min / max；
- max 必须保护 left rail；
- core Toolbar/Ruler/Tracks 不随高度压扁；
- Task Tray 使用剩余高度；
- resize 不 dirty Project / 不写 History / 不触碰 Project schema。

### MUST NOT

- 为解决碰撞创建第二套 Timeline；
- 通过提高 global max 让 Timeline 吃掉 Canvas；
- 让 left rail 自己盖在 Timeline 上作为“解决方案”；
- 为适配浅高度无限缩小字体和触控目标；
- 删除显式 collapse 来替代 resize；
- 顺手改 Timeline time geometry / subtitle mutation semantics。

---

## 建议验收

至少真人检查三个高度：

```text
MIN / NORMAL / MAX
```

### MIN

- Toolbar 正常；
- Ruler 正常；
- Subtitle / Audio lane 正常；
- Task Tray 标题和主要动作可达；
- 卡片不被压扁；
- 若内容放不下，局部滚动而不是全体缩形。

### NORMAL

- Canvas 仍是视觉主角；
- Timeline 日常操作舒服；
- Pending Tray / Timed 编辑态都不拥挤。

### MAX

- `镜头 / 素材 / 角色 / 项目工具` 与时间轴绝不碰撞；
- Right Inspector / handle 保持正常；
- Canvas 仍有意义；
- Timeline 不产生新的页面级滚动陷阱。

### 状态回归

- resize -> collapse -> reopen 恢复合理高度；
- 横向时间轴滚动正常；
- seek/playhead 正常；
- Pending drag-to-place 正常；
- Timed subtitle edit 正常；
- 窗口 resize 后 max/min 自动回到合法范围。

---

## 与其它 LM 的关系

- `LM-004`：解决 Canvas 套娃/viewport controls，占用同一整体工作区，但 owner 不同；建议单独 Issue。
- `LM-005`：产品改为 Cloud Touch-only 后，LM-006 可直接以 Cloud Touch landscape 为唯一横屏产品基线，不再为 Desktop 分支额外设计一套 resize contract。

建议实施顺序：

```text
LM-005 Cloud Touch-only route
-> LM-006 Timeline geometry rebaseline
-> LM-004 Canvas flatten / controls relocation（可并行评估，但不要混成一坨 PR）
```

---

## 当前结论

这不是“拖拽范围再调几个 px”能长期解决的问题。

真正需要的是一次 **post-Stage-E Timeline geometry rebaseline**：

> 核心时间表面固定，Task Tray 弹性；expanded minimum 回到真正可用，maximum 同时保护 Canvas + Left Rail。

这样才能同时解决维护者观察到的两端问题：

```text
拉高 -> 不撞车
拉低 -> 不压瘪
```
