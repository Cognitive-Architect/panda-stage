# Panda Stage｜右侧「字幕」工作区详细设计

状态：`DESIGN ACCEPTED / DOCS ONLY / IMPLEMENTATION NOT AUTHORIZED`  
日期：`2026-09-04`  
上位方案：`docs/design/RIGHT-WORKSPACE-LAYOUT-REFACTOR-PLAN-2026-09-04.md`  
关联：PR #424 / #416 / #418 / #422 / #423

> 本文记录维护者已认可的右侧「字幕」工作区 V1 详细方案。
> 本文定义职责、状态、交互、拖放合同、Canvas 同屏原则和视觉层级；
> 最终 drawer 像素宽度、精确间距、动画曲线与高保真视觉稿仍在后续视觉 pass 定标。

---

# 0. 一句话产品定义

右侧「字幕」工作区是一只 **“待安排字幕篮子”**，不是第二个字幕数据库。

用户从右侧拿一条尚未安排到时间线的字幕：

```text
找字幕
-> 看 Canvas
-> 拖到底部 Subtitle Track
-> 安排完成
```

安排完成以后：

```text
Timeline   -> 管“什么时候出现”
属性        -> 管“这条已选字幕具体怎么改”
字幕工作区   -> 管“还有什么字幕没安排 / 怎么新建”
```

核心产品目标：

> **字幕编排过程中，Canvas 与 Timeline 必须持续同时可见。**

---

# 1. 为什么必须独立成右侧 Workspace

旧结构：

```text
Bottom Workspace
  ├─ Timeline Toolbar
  ├─ Ruler / Subtitle Track / Audio Track
  └─ DialogueSheet / 待安排字幕 Task Tray
```

真人 Windows/Electron 验收已经证明：

```text
想看更多待安排字幕
-> 需要拉高 Bottom Workspace
-> Canvas 被压缩甚至接近不可见

但安排字幕恰恰需要：
-> 看 Canvas 判断画面
-> 看 Timeline 判断时间
```

因此问题不是继续调整几组 Timeline MIN/MAX 常量，而是字幕任务和 Timeline 不应该继续争同一块纵向空间。

新结构：

```text
Right Subtitle Workspace = 字幕任务来源
Bottom Timeline          = 时间目标
Canvas                   = 画面上下文
```

三者同屏完成一个连续工作流。

---

# 2. 顶层展开形态

## 2.1 Right Rail 保持存在

Collapsed：

```text
右侧 Rail
字幕
属性
工具
```

点击 `字幕`：

```text
Canvas | Subtitle Drawer | Right Rail
```

Right Rail 不消失，也不再额外生成第二条 rail。

## 2.2 Drawer 采用 dock / push，而不是覆盖 Canvas

V1 原则：

```text
字幕 Drawer 打开
-> 占用右侧一部分横向空间
-> Canvas 使用现有 fit 逻辑重新适配可用区域
-> 完整 16:9 Canvas 继续可见
```

禁止：

```text
Drawer 浮在 Canvas 上遮住画面
```

原因：本次重构的根本产品目标就是字幕编排时持续看到 Canvas。

### 极端窄宽度

如果窗口窄到物理上无法同时保证：

```text
可用 Canvas + 可用 Subtitle Drawer + Right Rail
```

应进入后续单独定义的 narrow-landscape fallback，不能在 V1 默认宽屏形态下通过覆盖 Canvas 偷空间。

---

# 3. Right Rail 字幕入口视觉语义

未来三个入口：

```text
字幕  -> MessageSquareText（优先）
属性  -> SlidersHorizontal
工具  -> Wrench
```

要求：

- 三枚图标从轮廓上即可区分；
- `字幕` 不得使用与 `属性` 相似的滑杆/控制器图标；
- 图标继续使用项目既有 Lucide 体系；
- 不为了这一枚图标引入新的 icon library。

`字幕` activity active 时：

```text
使用现有 selected surface / selected border 语义
```

不采用强发光或高饱和霓虹效果。

---

# 4. Subtitle Workspace V1 职责

## 4.1 MUST 负责

```text
待安排字幕队列
单条新建字幕
批量粘贴 / 批量创建
Untimed 字幕选择
Untimed -> Timeline 的拖放安排
空状态
必要的 arrange 错误反馈
```

## 4.2 MUST NOT 负责

```text
完整已安排字幕列表
已定时字幕的完整属性编辑
图层属性
Timeline seek / zoom / scroll
Timeline 时间几何真相
第二份字幕数据 owner
第二份 dialogue selection truth
```

## 4.3 已安排字幕职责去向

```text
Timeline
-> 显示 / 选择 timed subtitle clip

属性 Workspace
-> 编辑当前选中 timed subtitle 的属性
```

V1 不在 Subtitle Workspace 增加“全部 / 已安排 / 未安排”多标签管理器。

原因：避免形成：

```text
字幕 Workspace -> 已安排字幕编辑
属性 Workspace -> 字幕属性编辑
```

两个入口同时管理同一对象。

---

# 5. 推荐复用现有 DialogueSheet

优先扩展现有：

```text
DialogueSheet
```

增加类似：

```text
presentation = right-workspace
```

的 presentation contract。

不复制：

```text
SubtitleWorkspaceV2
DialogueSheetV2
dialogueStoreV2
```

右侧模式主要保留：

```text
pending
untimed-selected
single-add
batch-paste
empty
```

当前 `timed-selected` 的详细编辑，应逐步从 DialogueSheet 右侧模式中剥离，交由 Properties / RightInspector。

---

# 6. 默认状态｜待安排字幕队列

## 6.1 信息层级

推荐：

```text
[ MessageSquareText ] 字幕                         [ × ]

待安排字幕                                      6 条

┌──────────────────────────────────────┐
│ Panda                             ⋮⋮ │
│ 第一行测试对白                         │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ Panda                             ⋮⋮ │
│ 第二行测试对白                         │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ 未知角色                          ⋮⋮ │
│ 第三行未知角色对白                     │
└──────────────────────────────────────┘

...

[ + 新建字幕 ]
```

## 6.2 卡片只展示必要信息

卡片 V1 建议：

```text
speaker / character name
subtitle text（1～3 行可读摘要）
drag affordance
```

不要默认塞入：

```text
编辑
删除
复制
更多
安排一帧
多个 badge
```

一张卡如果塞满按钮，会把“拖动字幕”这个主任务淹没。

## 6.3 卡片交互

```text
点击卡片
-> 选择该 untimed dialogue / 进入当前待安排上下文

拖动卡片
-> 启动 pending dialogue placement
```

V1 可保留现有明确的非拖拽安排入口作为辅助路径，但视觉上不能抢过“拖到底部字幕轨”的主流程。

---

# 7. 拖拽把手 / 可拖语义

推荐在卡片右侧提供轻量 drag affordance，例如：

```text
⋮⋮
```

其职责不是新增一个复杂按钮，而是告诉新手：

> 这张字幕卡可以拿起来拖。

触摸 / 鼠标交互仍应允许现有合理手势范围，不要求用户必须精准按住 12px 小把手才可拖动。

拖拽 affordance 必须保持足够视觉可辨识度，但不应比 speaker / text 更抢眼。

---

# 8. 新建字幕状态

点击：

```text
+ 新建字幕
```

不打开独立 modal。

当前 Drawer 自身切换成 authoring state。

原因：

- Canvas 继续可见；
- Timeline 继续可见；
- 用户不会被弹窗切断工作流；
- 复用现有 DialogueAuthoringDraft / single / batch 能力。

---

# 9. 单条新建

建议结构：

```text
← 新建字幕                                      ×

[ 单条 ]    [ 批量 ]

角色
[ Panda                                      ▾ ]

字幕内容
┌──────────────────────────────────────────────┐
│ 在这里输入对白                                │
│                                              │
└──────────────────────────────────────────────┘

[ 创建字幕 ]
```

创建成功：

```text
-> 回到待安排队列
-> 新字幕进入 pending queue
-> 不自动强制安排到 Timeline
```

保持“创建”和“安排”是两个清晰步骤。

---

# 10. 批量创建

切换：

```text
单条 | 批量
```

建议结构：

```text
← 新建字幕                                      ×

[ 单条 ]    [ 批量 ]

批量对白
┌──────────────────────────────────────────────┐
│ Panda：第一句话                               │
│ Panda：第二句话                               │
│ 张三：第三句话                                 │
│                                              │
└──────────────────────────────────────────────┘

[ 批量创建 ]
```

继续复用现有批量解析 / draft / validation truth，不建立右侧专属的新业务规则。

---

# 11. Empty State

当当前 Shot 没有待安排字幕：

```text
字幕

当前没有待安排字幕

创建一条字幕后，可以把它拖到底部时间轴进行安排。

[ + 新建字幕 ]
```

要求：

- 空状态说明用户下一步能做什么；
- 不写长教程；
- 不使用大型插画抢 Canvas 注意力；
- primary action 明确。

---

# 12. 拖拽状态｜核心体验

## 12.1 用户动作

```text
Right Subtitle Workspace
pending card
      ↓
拖动
      ↓
Bottom Timeline Subtitle Track
```

整个过程中：

```text
Canvas 持续可见
Timeline 持续可见
Subtitle Drawer 持续可见
```

Drawer 不因为开始拖拽自动关闭。

---

# 13. Source Placeholder

一旦某张 pending card 进入有效拖拽：

原卡片位置保留轻量 placeholder，例如：

```text
┌ - - - - - - - - - - - - - - - - ┐
│ 正在安排…                           │
└ - - - - - - - - - - - - - - - - ┘
```

目的：

```text
保持列表几何稳定
避免拖拽开始后其余字幕卡突然重排 / 跳动
```

成功 drop 后：

```text
placeholder -> 消失
queue count -> 更新
```

取消 / invalid 后：

```text
placeholder -> 恢复原卡片
```

---

# 14. Drag Ghost

拖拽 ghost 推荐包含：

```text
speaker
subtitle text 摘要
```

视觉：

- 比原卡略轻；
- 不做巨大浮层；
- 不遮挡大量 Canvas；
- 与正常卡片保持同一视觉语言；
- 必要时显示轻量 valid / invalid 状态。

Drag ghost 应挂在 Right Workspace 与 Bottom Timeline 的共同祖先 overlay / portal 层，避免被 Drawer 的 overflow / z-index 裁切。

---

# 15. Timeline Drop Preview

进入 Subtitle Track 合法区域：

```text
显示半透明 clip preview
显示目标时间位置
```

建议沿用项目既有绿色 selected / valid 语义。

不要：

```text
整个 Timeline 发亮
整个窗口变绿
强烈动画闪烁
```

这是工具软件中的操作反馈，不是游戏技能释放。

---

# 16. Invalid Drop

例如拖到：

```text
Audio Track
非 Timeline 空白区
非法超界位置
```

反馈原则：

```text
明确但克制
```

可使用：

- ghost invalid state；
- target 不显示合法 preview；
- 简短状态提示。

Drop 后：

```text
不提交 dialogue mutation
字幕继续留在 pending queue
```

---

# 17. Escape / Cancel

拖拽期间：

```text
Escape
-> 取消 placement
-> 清理 preview
-> 清理 ghost
-> 恢复 source card
-> 合理恢复 focus
```

项目 / Shot identity 在拖拽过程中变化：

```text
自动取消
不得把 Shot A 的字幕提交到 Shot B
```

---

# 18. Cross-workspace placement coordinator

右侧迁移后 source / target 成为 sibling workspace：

```text
Right Subtitle Workspace
Bottom Timeline
```

因此应抽出一个 UI-only transient coordinator，例如：

```text
PendingDialoguePlacementProvider
usePendingDialoguePlacement
```

命名不强制。

## 18.1 Coordinator 可以拥有

```text
active dialogueId
pointerId
clientX/clientY
dropState
mappedStartMs
previewStartMs/previewEndMs
source element ref
subtitle target rect/ref
drag ghost presentation
```

## 18.2 Coordinator 绝不能成为业务 owner

禁止拥有：

```text
第二份 dialogue list
第二份 Project truth
第二份 shot truth
第二份 Timeline clock
第二份 selection truth
```

正式 owner 继续复用：

```text
editorProjectStore
dialogueStore
dialogueSelectionStore
shotStore
timelineUiStore
```

---

# 19. 拖放业务规则必须复用

迁移 UI 不允许重新发明 arrange 语义。

继续复用现有能力，包括但不限于：

```text
pending gesture 判定
drop target hit-test
X -> startMs mapping
dialogueStore.previewArrange(...)
dialogueStore.arrange(...)
integerFrameSpanMs
```

Commit 前重新确认：

```text
projectRoot 未变化
shotId 未变化
dialogue 仍然 untimed
```

否则 cancel。

---

# 20. Subtitle Workspace 与 Properties 的边界

这是 V1 必须守住的产品边界。

## 字幕 Workspace

回答：

```text
“还有什么字幕没安排？”
“我要怎么新建字幕？”
“我要把哪条字幕安排到时间轴？”
```

## 属性 Workspace

回答：

```text
“我当前选中的对象 / 字幕具体怎么改？”
```

因此：

```text
字幕 -> queue / authoring / arrangement
属性 -> selected object/dialogue properties
```

V1 不因为用户在 Timeline 选中 timed subtitle 就强制自动切换 Right Activity 到 `属性`。

Selection truth 可变化，Right active surface 不必自动跳页。

---

# 21. Bottom Timeline 在本方案中的最终形态

R2 完成后 Bottom Workspace 删除：

```text
Timeline Task Tray
DialogueSheet
待安排字幕卡
新建字幕 body
批量字幕 body
```

Bottom 只保留：

```text
Timeline Toolbar
Timecode
Zoom
Ruler
Subtitle Track
Audio Track
Playhead
Horizontal Scroll
Resize / Collapse
```

这样：

```text
Timeline = 什么时候发生
```

职责单一。

---

# 22. 视觉层级

Panda Stage 当前世界继续保持：

```text
深绿 / 近黑 surface
克制浅绿 border
低饱和 selected surface
系统 UI 字体
Lucide 图标
```

字幕 Drawer 不建立新设计语言。

建议层级：

```text
Canvas / app work surface
        ↓
Subtitle Drawer surface
        ↓
Subtitle card surface
        ↓
Selected / dragging state 用绿色语义突出
```

禁止：

- 每张卡都发光；
- 高饱和 inactive 状态；
- 大面积渐变装饰；
- 为右侧字幕页另起一种圆角 / 阴影 / icon 风格。

---

# 23. Drawer 宽度原则

目前不在文档中拍死最终 px。

但视觉目标明确：

```text
足够容纳：
- speaker
- 1～3 行字幕摘要
- drag affordance
- 单条 / 批量 authoring 表单

同时：
- 不得宽到与 Canvas 抢主角
- Drawer 打开后 Canvas 仍应完整 fit
```

最终宽度在高保真视觉稿 + Windows/Electron 真人验收中定标。

---

# 24. 滚动

待安排字幕超过 Drawer 高度：

```text
Subtitle Workspace body 内部垂直滚动
```

Header / 核心动作应保持稳定、容易找到。

不能产生：

```text
整个页面级纵向滚动
```

拖拽经过滚动列表边缘时是否支持 auto-scroll，属于 R2 实施时可验证的增强点；若现有手势迁移成本高，可先保证稳定手动滚动 + drag，不得因此扩大为复杂 drag-and-drop framework 重写。

---

# 25. 建议的 V1 状态机

右侧 Subtitle Workspace 只需围绕四类产品状态：

```text
DEFAULT_PENDING
AUTHORING
EMPTY
DRAGGING
```

其内部可继续映射现有业务/presentation 状态：

```text
pending
untimed-selected
single-add
batch-paste
empty
```

不要在 V1 再增加：

```text
ALL
TIMED_LIST
RECENT
FAVORITES
HISTORY
```

---

# 26. 关键真人验收流程

## Flow A｜默认编排

```text
打开“字幕”
-> Canvas 完整可见
-> Timeline 可见
-> 找到 pending subtitle
-> 拖到底部 Subtitle Track
-> drop preview 正常
-> 成功安排
-> pending queue 数量减少
-> Timeline 出现 timed clip
```

## Flow B｜边看画面边安排

拖动期间：

- Canvas 必须持续可见；
- 用户可以判断当前画面；
- 用户可以判断 Timeline 落点；
- Drawer 不自动关闭；
- ghost 不大面积遮挡 Canvas。

## Flow C｜新建后安排

```text
+ 新建字幕
-> 单条
-> 创建
-> 回 pending queue
-> 拖到底部 Subtitle Track
```

## Flow D｜批量

```text
+ 新建字幕
-> 批量
-> 创建多条
-> 回 pending queue
-> 队列正常滚动 / 拖放
```

## Flow E｜取消

```text
开始拖
-> Escape / 放到非法区域
-> 无 mutation
-> 卡片恢复
-> focus 合理
```

---

# 27. Accessibility / Cloud Touch 要求

保持项目现有 touch-target 合同。

重点：

- Close / Back / New Subtitle / Tab 等必须是稳定可点击目标；
- drag affordance 不能要求像素级精准操作；
- 键盘 Escape 可退出 authoring / dragging；
- Drawer 开关有明确 aria label；
- 切换 Right Activity 时 focus 不丢到 document body；
- drag-only 不应成为唯一业务路径，保留现有合理的非拖拽 arrange 辅助能力。

---

# 28. 实施建议｜放入 R2，而不是 R1

R1：

```text
RightWorkspace shell
RightActivityRail
Properties re-slot
工具右迁
字幕入口可先 skeleton
```

R2 才实施本文：

```text
DialogueSheet right-workspace presentation
Subtitle Workspace UI
Pending Dialogue Placement Coordinator
cross-workspace drag
remove Bottom Task Tray
```

这样可以把“右侧容器结构”和“字幕核心业务迁移”拆开验收，避免一张巨型 Issue 同时改 Shell + Dialogue + Timeline + Drag。

---

# 29. Validation Budget

R2 未来实施只要求与实际 touched subsystem 成比例的验证：

```text
focused DialogueSheet / Timeline drag tests
cross-workspace placement contract tests
applicable typecheck / lint / build
normal auto CI
Windows/Electron human acceptance
```

未经维护者单独授权，不因这次 UI 迁移主动运行：

```text
manual Full CI
pnpm verify:project
repo-wide verifier sweep
unrelated DayXX verifier archaeology
```

---

# 30. Definition of Done｜Subtitle Workspace V1

```text
Right Rail 显示 字幕 / 属性 / 工具
字幕图标与属性图标明显区分
Subtitle Drawer 以 dock/push 方式展开
Drawer 打开时完整 Canvas 仍可 fit
默认态显示待安排字幕队列
支持单条新建
支持批量创建
支持 pending subtitle -> Bottom Subtitle Track 拖放
拖拽期间 Canvas + Timeline + Drawer 同屏
source placeholder 稳定列表
valid / invalid preview 正常
Escape / identity change 可安全取消
Bottom Timeline 不再包含 DialogueSheet / Task Tray
已定时字幕属性继续由 Properties 管理
没有第二份 dialogue / selection / timeline truth
Windows/Electron 真人主流程 PASS
```

---

# 31. 明确暂缓项

以下不属于 Subtitle Workspace V1：

```text
完整已安排字幕列表
字幕搜索 / 收藏 / 历史
复杂过滤器
字幕数据库式管理页
自动根据 selection 强制切 Properties
跨多个 Shot 的字幕总览
复杂 auto-scroll drag framework
最终窄横屏 fallback 视觉
最终 drawer px 宽度
最终 motion curve
```

需要时以后独立演进，不作为 R2 首版进入门槛。

---

# 32. 最终设计结论

右侧「字幕」应成为：

> **一个高频、窄而专注的字幕任务抽屉。**

它不负责把所有字幕能力都吞进去，而是围绕一个最重要的工作流：

```text
创建 / 找到待安排字幕
        ↓
看着 Canvas
        ↓
拖到底部 Timeline
```

V1 产品边界保持：

```text
字幕 = 创建 + 待安排 + 安排
属性 = 当前选择怎么改
Timeline = 已安排内容什么时候出现
Canvas = 当前画面发生什么
```

这四个职责同时可见、互不抢 owner，就是本次布局重构真正要获得的产品收益。
