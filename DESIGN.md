# Panda Stage DESIGN.md

> Version: v0.1
>
> Status: Active design guidance
>
> Scope: Panda Stage product UI / UX / visual system
>
> This document records durable design principles, shared visual contracts, and design red lines that are supported by the current product, existing shared UI foundation, accepted responsive work, or validated implementation evidence.
>
> It is a design governance document, not authorization for a product-wide redesign.

---

## 1. What this document is

`DESIGN.md` is the repository-level design contract for Panda Stage.

It exists to answer questions such as:

- What kind of product experience should Panda Stage provide?
- What information deserves to be visible in the main interface?
- What should be shared across features, and what should remain local?
- When should an existing primitive or token be reused?
- When is a new shared visual contract justified?
- How should desktop and Cloud Touch remain consistent without becoming two products?
- What UI anti-patterns must coding agents avoid by default?

This document does **not** attempt to describe every historical screen pixel by pixel.

It records durable rules. Exact implementation values remain owned by the relevant source files.

### Authority

For current task scope and implementation authorization:

> the active Issue / PR is authoritative.

For durable UI / UX principles:

> `DESIGN.md` is the shared repository-level design reference.

For exact shared visual values and primitive behavior:

> `src/renderer/styles/tokens.css`, `src/renderer/styles/primitives.css`, and `src/renderer/ui/*` are implementation sources of truth.

For feature-specific geometry and composition:

> the owning feature stylesheet remains authoritative.

For historical stage-specific design detail:

> `docs/design/*` is supporting context, not an automatic override of the current product or active Issue.

---

## 2. Product design direction

Panda Stage is a Windows Electron editor for individual creators making short 2D cutout animation from characters, backgrounds, dialogue, audio, shots, and simple motion.

Its primary interface mode is:

> **Operate — help the creator finish a task.**

Panda Stage is not a marketing page and should not optimize for visual spectacle at the expense of editing efficiency.

The preferred order is:

1. understandable;
2. usable;
3. consistent;
4. visually clear;
5. polished.

Decoration, explanation, abstraction, and design-system purity are secondary to helping the creator complete the current task.

---

## 3. Core design principles

### 3.1 Task first

The user should be able to understand, with minimal effort:

- where they are;
- what is selected;
- what they can do next;
- whether an action succeeded;
- whether an action is destructive;
- what information actually matters to the current editing decision.

Important controls should not compete with decorative UI or engineering detail.

### 3.2 Canvas is the visual center of the editor

When editing animation, the canvas is the primary creative work surface.

Resources, properties, inspectors, drawers, panels, and timeline controls exist to support the creative task rather than visually overpower it.

A layout change should not consume canvas visibility unless the task genuinely requires that tradeoff.

### 3.3 Prefer fewer concepts

Panda Stage should remain approachable to individual creators.

Prefer:

```text
clear label
+ clear state
+ clear action
```

over:

```text
title
+ subtitle
+ helper text
+ duplicate status
+ technical metadata
+ another confirmation line
```

Do not introduce a concept merely because the underlying data model contains a field for it.

### 3.4 Consistency is a tool, not a goal by itself

Things that perform the same visual role should normally look related.

Things that only happen to look similar do not automatically need the same component, token, or CSS rule.

Do not unify UI merely to increase the amount of shared code.

### 3.5 Shared appearance, local geometry

A component family may share:

- border treatment;
- surface treatment;
- selected state;
- hover treatment;
- visual role;
- semantic color.

Individual consumers may still retain their own:

- height;
- width;
- grid;
- surrounding layout;
- companion actions;
- responsive geometry.

This principle was validated by the first Phase 3 shared-visual-contract pilot.

> Share the skin when appropriate. Do not force unrelated skeletons to become identical.

### 3.6 Progressive disclosure over permanent complexity

Information, controls, and technical detail should become visible when they are needed.

Rare, advanced, diagnostic, or engineering-facing information should not permanently occupy the primary creative interface simply because it may be useful someday.

---

# 4. Design red lines — MUST NOT

These are repository-level anti-pattern guardrails.

They are deliberately stronger than ordinary style preferences.

They do not mean that forms, cards, helper text, status feedback, or technical information are forbidden in all circumstances. They mean those patterns must earn their place through a real user task.

## Red line 01 — 禁止表单史山

> Panda Stage 是创作工具，不是后台管理系统，也不是填工商年报。

### MUST NOT

- 把领域模型 / schema 里的每个字段机械映射成 `label + input`。
- 因为“字段存在”就给用户增加输入框、下拉框、开关或设置项。
- 把本来可以通过点击、拖动、缩略图、卡片、Stepper 或直接操作完成的创作行为，退化成“填写参数表单”。
- 暴露内部 ID、schema 字段、技术 flag、实现术语，仅仅因为代码里有这些东西。
- 为了“功能完整”添加当前工作流并不需要的控件。
- 让一个本来简单的创作动作变成一长列字段、说明和确认按钮。

### Preferred direction

优先按用户任务和创作动作组织 UI，而不是按数据结构组织 UI。

视觉概念优先使用视觉选择和直接操作：

- 表情 → 看图选择；
- 素材 → 缩略图选择；
- 工作区 → 明确导航；
- 时间位置 → 时间轴操作；
- 常用数值 → Stepper / 直接操作；
- 画布对象 → 选中后在上下文中调整。

在新增字段前先问：

1. 用户真的需要修改它吗？
2. 它需要一直可见吗？
3. 输入文字真的是最合适的交互吗？
4. 能不能通过视觉选择或直接操作完成？
5. 这项控件是在帮助完成任务，还是只是在暴露实现细节？

如果答案不清楚，默认不要新增字段。

---

## Red line 02 — 禁止套娃卡片 / Box 套 Box

> 不要为了“看起来有结构”，把每一层内容都再包一层框。

### MUST NOT

- 无明确语义层级时连续使用 panel / card / bordered box 套娃。
- 仅为了分组而给已经处于明确容器中的内容再加视觉外框。
- 用边框数量代替信息层级。
- 让画布、属性、资源、表情等区域出现“框里套框、框里再套框”的视觉噪声。
- 因为一个区域看起来有点空，就再增加一个有边框的容器。

### Preferred direction

优先使用：

- spacing；
- alignment；
- typography；
- separator；
- background hierarchy；
- content grouping；

来表达层级。

只有当容器本身具有真实的交互、状态、选择、滚动、边界或所有权意义时，才值得增加明确的 card / panel surface。

---

## Red line 03 — 禁止满屏解释性废话

> 用户来做动画，不是来读操作说明书。

### MUST NOT

- 标题、副标题、helper text、placeholder、tooltip 重复表达同一件事。
- 因为空间有空余就添加解释文字。
- 把一句能说完的话拆成多层说明。
- 用技术术语解释普通创作者并不需要理解的内部机制。
- 让说明文字抢占画布、资源区、时间轴或主要操作区域。
- 用永久说明文案弥补一个本来就应该更直观的交互。

### Preferred direction

需要说明时，只回答用户此刻真正可能产生的问题。

优先让：

```text
标签说明它是什么
状态说明现在怎样
动作说明能做什么
```

而不是再添加一段文字解释界面本身。

---

## Red line 04 — 禁止信息堆叠 / 重复提示

> 同一件事说一遍就够了。状态、结果和内容不应在相邻区域反复重复。

### MUST NOT

- 在同一视区内连续重复同一状态、同一文件名、同一结果或同一确认信息。
- 已经有明确结果卡片时，再额外保留永久状态条重复说明同一事实。
- 把一次性成功反馈长期占据主工作区。
- 同一信息同时出现在标题、状态条、提示条、卡片正文等多个层级，除非每一处承担明确不同的任务。
- 为了“让用户更放心”而用多个长期提示重复确认已经完成的动作。

### Preferred direction

建立单一信息 owner：

- 一次性结果 → 短暂反馈；
- 当前状态 → 留在最接近该对象的位置；
- 持久内容 → 由真正承载该对象的列表 / 卡片 / 详情展示。

设计目标不是“多提醒一次更保险”，而是：

> **一条信息只在最合适的位置出现一次。**

---

## Red line 05 — 保持界面信息最小必要 / 禁止工程信息前台化

> 用户进入一个界面，是为了完成当前任务，不是为了查看程序内部状态。

### MUST NOT

- 在主界面默认展示普通创作者不需要理解的工程化信息，例如内部 ID、schema 字段、存储路径、路径状态、源文件存在性、技术 flag、调试状态等。
- 在上下文已经明确的情况下继续显示“当前选中”“已选素材”“正在查看”等重复性身份说明。
- 因为某条数据“可以显示”就默认把它放到详情页。
- 让技术元数据与真正影响创作决策的信息处于同一视觉层级。
- 把排障、诊断或开发者信息长期暴露在普通创作工作流中。

### Preferred direction

主界面只保留当前任务真正需要的信息。

以素材详情为例，优先回答：

- 这是什么素材；
- 它长什么样；
- 类型 / 尺寸等是否会影响当前创作；
- 当前是否被项目使用；
- 用户现在可以执行什么动作。

项目内路径、路径状态、源文件存在性等信息如果确实有排障价值，应优先放到：

- 可折叠的“更多信息 / 技术信息”；
- 专门的诊断入口；
- 调试模式；

而不是默认占据主要详情区域。

判断标准：

> **如果删掉这条信息，普通创作者仍然可以正确完成当前任务，那它通常不应该默认出现在主界面。**

---

## 4.1 Red-line interpretation

以上红线禁止的是**不必要的堆积**，不是机械禁止某种 UI 形式。

允许：

- 真正需要精确输入的表单；
- 具有明确语义和交互边界的卡片；
- 能解决真实困惑的 helper text；
- 高风险操作所需的明确确认；
- 在不同上下文承担不同职责的状态信息；
- 面向诊断或高级用户的技术信息入口。

不允许默认形成这样的链条：

```text
data model
→ every field becomes a control
→ every control gets a card
→ every card gets explanation text
→ every result gets another status banner
→ creator workflow becomes an admin panel
```

Panda Stage 应主动避免这种方向。

---

## 5. Visual language

Panda Stage 当前采用深色编辑器界面，并使用偏竹青 / 绿色的强调体系。

共享语义值的实现来源是：

`src/renderer/styles/tokens.css`

设计文档应尽量引用语义角色，而不是复制具体 RGB / px 数值。

### 5.1 Surface hierarchy

当前共享语义包含：

- app surface；
- work surface；
- panel surface；
- overlay surface。

新增表面前，优先复用已有语义层级。

不要为了“层次感”不断制造新的深绿色 / 黑绿色背景。

### 5.2 Text hierarchy

当前共享角色包含：

- primary text；
- secondary text；
- muted text；
- section heading；
- compact metadata / eyebrow。

真正影响当前操作的信息应比说明性信息更醒目。

Muted text 不应成为重要信息的默认样式。

### 5.3 Accent and semantic states

绿色用于正常的 active / selected / focus 家族。

Warning 与 danger 是独立语义，不应与普通强调混用。

Danger styling 应只用于真正具有破坏性的动作，而不是为了“让按钮更显眼”。

---

## 6. Spacing, radius, type and touch foundation

共享基础值由 `tokens.css` 管理。

当前基础包括：

- 收敛的 spacing scale；
- small / medium / large / pill radius 角色；
- 适合编辑器的紧凑字号层级；
- icon / regular / emphasized touch target 角色。

新共享 UI 应优先复用这些值，而不是随手造一个“差不多”的新数值。

但：

> local geometry may remain local.

如果某个功能布局确实需要特殊尺寸，可以保留局部值。

不要为了一个局部需求去污染全局 token。

---

## 7. Shared UI primitives

当前共享 primitive 位于：

`src/renderer/ui/`

包括：

- `Button`
- `IconButton`
- `SegmentedTabs`
- `Field`
- `Stepper`
- `PanelSurface`
- `SectionHeader`
- `DecorativeIcon`

共享样式主要由：

`src/renderer/styles/primitives.css`

负责。

### Primitive rule

当语义角色真正匹配时，优先使用已有 primitive。

不要仅仅因为两个控件“看起来像按钮”，就强制迁移到同一个 primitive。

行为、所有权和交互语义优先于代码复用率。

### Button roles

当前 Button primitive 支持：

- primary；
- secondary；
- danger。

视觉角色与尺寸是两个不同维度。

例如：

> danger ≠ 小红按钮
>
> danger = destructive semantic role

Icon-only action 必须拥有明确 accessible name。

---

## 8. Component-family visual contracts

Component-family contract 位于：

```text
global primitive
        ↑
family contract
        ↑
feature-local styling
```

之间。

适用于多个真实 consumer 属于同一家族，但仍需要不同本地几何的场景。

### 新建 family contract 的基本条件

通常应同时满足：

1. 至少两个真实 consumer；
2. 有清晰的共同视觉角色；
3. 重复样式是有意的一致性，而不是偶然数值相同；
4. 各 consumer 的几何 / composition 仍需要本地所有权；
5. negative-control 检查证明 unrelated UI 未受影响。

如果只有一个 consumer：

> 保持 local。

如果 unrelated UI 跟着一起变化：

> contract 太宽，应收窄。

### Scope promotion rule

共享范围按证据逐级扩大：

```text
local
→ family
→ global
```

只有证据足够时才向外提升。

不要从 global 开始设计。

---

## 9. Proven family contract — Selected Asset Surface

Phase 3 的首个 pilot 已验证 `ImageAssetPicker` 家族可以共享 selected-asset surface 外观，同时保留各 consumer 的本地 geometry。

共享角色包括：

- selected border；
- selected border hover state；
- surface radius；
- selected background；
- hover / focus background treatment。

已验证的真实消费场景包括：

- Character Settings 中已配置的 mouth image surface；
- Expression card 中的 inline image picker。

其中：

- Character Settings 保留 Picker + Clear 的 compound geometry；
- inline Expression picker 保留自己的 compact dimensions；
- unrelated Tools / Timeline / identity / delete controls 不应继承该 family surface。

### Rule

不要因为另一个控件也使用绿色边框，就把 `ImageAssetPicker` family contract 提升成 global Button 或应用级 token。

当前证据只证明：

> 这套 contract 属于 ImageAssetPicker family。

更大范围的共享必须由新的真实证据证明。

---

## 10. Interaction states

交互控件应根据真实角色覆盖必要状态。

常见状态包括：

- normal；
- hover；
- active / pressed；
- focus；
- selected；
- disabled；
- empty / unconfigured；
- warning / conflict；
- danger。

不是所有组件都需要所有状态。

状态存在是因为交互需要，而不是为了补齐理论 checklist。

### Focus

键盘交互控件必须可达，并应提供足够清楚的 focus feedback。

已有历史控件的弱 focus 表现可以作为非阻塞债务记录，但：

> 不应把弱 focus 当成新 UI 的设计目标。

---

## 11. Empty, conflict and disabled states

Unavailable、empty、conflict、disabled 不是同一个概念。

它们不应被统一成一个“灰掉的框”。

例如 asset-selection UI：

- unconfigured = 尚未绑定素材；
- conflict = 当前候选因为明确产品规则不能使用；
- disabled = 当前动作不可执行。

这些含义应能通过文字、状态和交互共同理解，而不是只靠颜色猜。

---

## 12. Information hierarchy and copy

Panda Stage 应优先使用短、具体、接近创作者语言的 UI 文案。

### Prefer verbs for actions

例如：

- 保存
- 清除
- 应用
- 取消
- 更换
- 导入
- 创建

### Prefer recognizable nouns for destinations

例如：

- 镜头
- 素材
- 角色
- 图层
- 属性
- 时间轴

### Avoid engineering vocabulary in normal creator UI

除非某个技术概念本身就是创作工作流的一部分，否则不要默认展示内部实现术语。

Helper text 必须回答一个真实问题，而不是重复 label。

### One-information-owner rule

同一事实应有一个主要展示位置。

避免：

```text
状态条说一次
提示框再说一次
卡片标题再说一次
卡片正文再说一次
```

如果用户已经通过上下文明白“我正在看这个对象”，就不要继续重复“当前选中 / 已选素材 / 正在查看”。

---

## 13. Editor layout ownership

Panda Stage 使用一个连续的 `EditorShell`。

概念上的主要 owner 包括：

```text
EditorShell
├── Resource workspace
├── Canvas workspace
├── Properties / Inspector
└── Timeline / Bottom workspace
```

布局改造不得为了视觉方便复制业务 owner。

不要为了做一套新布局，再造一套 Project / History / Resource / Inspector 状态。

UI composition 可以变化，业务所有权保持稳定。

---

## 14. Desktop and Cloud Touch

Wide desktop 是正式 editor baseline 之一。

Cloud Touch 适配相同的 product owners，而不是创建第二套产品。

### Landscape

- Canvas 保持 dominant center；
- resources / properties 可以通过 rail / drawer 等方式出现；
- 不应为了展开辅助工作区而无必要地遮住关键创作上下文。

### Portrait

- 一次突出一个主要 workspace；
- inactive workspace 不应留在正常 focus / touch path 中；
- 用已有导航表达 workspace 切换，而不是同时把所有面板挤进小屏。

### Responsive-state rule

方向或 workspace presentation 的变化本身不得修改：

- Project data；
- dirty state；
- revision；
- History；
- Shot data；
- 持久化业务状态。

Responsive layout 是 presentation state，不是 project content。

---

## 15. Touch interaction

Cloud Touch 场景应优先使用已有 shared target roles。

触控目标不能因为桌面版“视觉上塞得下”就随意缩小。

Touch comfort 是 UI contract 的一部分。

在触控界面中应避免：

- 极小点击目标；
- 过密动作排列；
- 需要高精度鼠标操作才能完成的基本任务；
- hover 才能理解的唯一信息。

---

## 16. Accessibility baseline

新共享 UI 应尽可能保留原生语义。

当前最低期望包括：

- interactive controls 可通过键盘到达；
- focus 可见；
- icon-only actions 有明确 accessible name；
- Field label 与 control 正确关联；
- help / error relationship 可被辅助技术理解；
- disabled state 不只通过颜色表达；
- inactive adaptive workspace 不留在正常交互路径中。

Accessibility 应属于组件 contract，而不是最后再补的装饰性修复。

---

## 17. CSS ownership

目标 styling ownership 模型：

```text
styles/
├── tokens.css
├── primitives.css
├── base/
├── shell/
├── features/
└── compatibility / legacy layers where still required
```

### Ownership rule

- tokens → reusable semantic values；
- primitives → reusable primitive presentation；
- shell → application / workspace geometry；
- features → feature-specific layout and composition；
- family contracts → scoped to their real component family；
- compatibility CSS → only while legacy behavior genuinely requires it。

`src/renderer/styles.css` 应保持 entry / import role，而不是重新变成 feature-style dumping ground。

---

## 18. When to create a global token

不要因为同一个 literal value 出现两次，就立刻创建 global token。

Token 应表示 durable semantic role。

好的理由：

> 多个无关 family 明确共享同一个语义角色。

弱理由：

> 两段 CSS 刚好用了相同 RGB 值。

证据不足时，从 local 或 family scope 开始。

---

## 19. When not to refactor UI

默认不要把以下事情绑成一个任务：

- CSS ownership migration + redesign；
- component migration + behavior change；
- visual cleanup + broad class rename；
- shared-contract work + global theme change；
- feature implementation + unrelated legacy cleanup；
- 一个小 UI 修复 + 全仓 design-system migration。

小问题不自动授权大改造。

设计规范也不是重构许可证。

---

## 20. Human acceptance

Source-level equality 不能替代真实 UI 验收。

有意义的视觉变化应在真实 Windows Electron 产品中检查其受影响表面。

Focused acceptance 通常应覆盖：

- expected consumer；
- 至少一个相关 interaction state；
- geometry 未被破坏；
- 重要业务状态仍可识别；
- shared rule 修改时，代表性 unrelated controls 未变化。

人验范围应与改动范围成比例。

不要把一个小 UI change 扩大成无限期全产品视觉巡检。

---

## 21. Validation philosophy

UI 验证遵循 minimum sufficient validation。

典型 renderer UI 工作通常使用：

```text
targeted source / contract tests
+ relevant unit tests
+ renderer build / required build
+ normal automatic CI
+ focused Windows Electron human acceptance
```

未经 maintainer 明确授权，不要因为一个小 design change 主动升级到：

- manual Full CI；
- `pnpm verify:project`；
- repo-wide historical verifier sweep；
- unrelated technical-debt investigation。

---

## 22. Known limitations of v0.1

本文件不声称当前全部历史 UI 已经符合统一设计系统。

当前仍可能存在：

- legacy feature-local visual values；
- compatibility CSS；
- 历史控件未使用 `renderer/ui` primitives；
- focus feedback 偏弱的旧控件；
- 信息冗余、表单化、Box 套 Box 等历史 UI；
- ImageAssetPicker 之外尚未被真实 pilot 证明的 component-family contract。

这些问题的存在：

> **不自动授权全仓整改。**

优先在真实产品任务、明确授权的设计工作、或后续经过 maintainer 批准的专项中逐步改善。

---

## 23. Non-goals

`DESIGN.md` 不授权：

- 全量视觉重设计；
- 新主题或 Dark Navy 实施；
- 把所有按钮迁移到 `Button.tsx`；
- 把所有 local value 提升为 global token；
- 删除看起来重复但用途未验证的 legacy CSS；
- 为了视觉一致性改变业务行为；
- 重做所有历史界面；
- 因为发现一条红线被违反，就自动启动全仓 UI 清理；
- 用 design-system 工作无限拖延产品功能开发。

Panda Stage 应逐步变得更一致，而不是暂停产品开发去追求理论上的完美设计系统。

---

## 24. Design decision rule

新增或修改 UI 时，先判断问题属于哪一层。

### A. Single local need

只影响一个明确 surface / feature？

> 保持 local。

### B. Real component family

多个真实 consumer 有同一种视觉角色，但 geometry 各自不同？

> 考虑 family-scoped contract。

### C. Durable cross-family semantic role

多个无关 family 都明确共享同一个语义？

> 再考虑 global token / primitive。

始终遵循：

```text
local
→ family
→ global
```

而不是：

```text
看起来重复
→ 立刻全局统一
```

---

## 25. Design review checklist for new UI work

在交付一个新的或明显修改过的 UI surface 前，至少快速问一遍：

### Purpose

- 这个界面当前最主要的任务是什么？
- 最重要的动作是否一眼可见？

### Information

- 有没有用户其实不需要看的工程信息？
- 有没有同一事实重复出现？
- 有没有“为了说明而说明”的文字？

### Structure

- 有没有表单史山？
- 有没有 Box 套 Box？
- 能不能用 spacing / typography / separator 替代多余外框？

### Interaction

- 视觉概念是否优先使用视觉操作？
- destructive action 是否明确？
- focus / disabled / selected / conflict 状态是否能理解？

### Scope

- 这是 local、family 还是 global 问题？
- 是否正在因为一个小改动扩大成设计系统重构？

### Acceptance

- 真机里是否仍然好用？
- unrelated controls 是否保持不变？

---

## 26. Maintenance and evolution

`DESIGN.md` 应随着真实产品经验迭代，而不是一次性冻结成永久真理。

新增 durable rule 的优先证据顺序：

1. maintainer 明确产品判断；
2. 真实 UI implementation；
3. 多 consumer 使用证据；
4. Windows Electron 人工验收；
5. 反例 / negative-control 检查；
6. 再记录为长期 design contract。

不要把尚未经过真实使用验证的个人偏好直接升级为全局规则。

### Red-line evolution

新的 design red line 应由 maintainer 明确确认后加入。

Coding agents 不应仅凭一次局部观察自动创造新的全局禁止项。

### v0.1 current proven decisions

第一版记录以下已确认方向：

- Panda Stage 是 operation-first creator tool；
- Canvas 是核心创作工作区；
- Desktop 与 Cloud Touch 复用相同业务 owner；
- shared primitives 已存在，应按语义匹配使用；
- visual role 与 physical size 分离；
- shared appearance 不要求 shared geometry；
- component-family contract 应从窄范围开始；
- Selected Asset Surface 是首个已验证 family contract；
- unrelated UI 不应被 family-level rule 波及；
- Windows Electron human acceptance 仍是重要 UI 交付证据；
- design-system 工作不得成为无限期产品开发前置条件；
- 第一批 5 条 design red lines 是全局 MUST NOT guardrails。

---

## 27. Quick reference

### Panda Stage 应该更像

- 创作工具；
- 编辑器；
- 视觉优先；
- 任务导向；
- 简洁但不是空洞；
- 有共享规则但不过度抽象；
- 对新手友好，但不靠满屏说明文字实现“友好”。

### Panda Stage 不应该变成

- 后台管理系统；
- 参数填写器；
- Box 套 Box 展览馆；
- 操作说明书；
- 技术诊断面板常驻版；
- 为了 design system 而 design system 的无限重构工程。

---

## 28. First-version design red lines

```text
01. 禁止表单史山
02. 禁止套娃卡片 / Box 套 Box
03. 禁止满屏解释性废话
04. 禁止信息堆叠 / 重复提示
05. 保持界面信息最小必要 / 禁止工程信息前台化
```

These red lines are part of the durable design guidance of Panda Stage v0.1.

They should guide future UI work without being interpreted as automatic authorization to rewrite historical UI.
