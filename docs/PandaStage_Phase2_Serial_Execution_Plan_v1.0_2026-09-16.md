# Panda Stage｜Phase 2 Serial Execution Plan v1.0
## Wave 2 之后：18 个逻辑 P2 × 133 Section × 110 Segment → 6 张串行实施 Issue

- 日期：2026-09-16
- 仓库：`Cognitive-Architect/panda-stage`
- 父路线图：GitHub #529
- Canonical：`PandaStage_Phase2_Canonical_Section_Map_v1.1_2026-09-16.md`
- 上一版执行调度：`PandaStage_Phase2_Execution_Wave_Map_v1.0_2026-09-16.md`
- 当前 rolling implementation PR：#542 / `agent/issue-541-p2-01`
- 当前 Wave 2 实施单：#547
- 状态：**SERIAL EXECUTION PLAN；在 #547 Wave 2 完成后启用。**

> **v1.0 决策：Wave 2 之后不再把“双 Codex / 双车道并发”当目标。剩余 Phase 2 默认使用单 Codex、单 active Issue、单 rolling PR 的串行施工模型。**
>
> 6 张新 Issue 只是 execution wrapper。Canonical 的 P2 身份、Section、Segment、Owner、原始顺序、receipt、STOP gate 全部保留。

人话：以后不再为了“看起来并行”请两个搬家师傅抢同一扇门。一个师傅按顺序搬 6 大车即可，但每个房间的箱子仍然单独贴标签、单独点数、单独验收。

---

## 0. 权威关系与适用范围

本文件只决定 **Wave 2 之后怎么把剩余 Batch 包成 6 张串行实施 Issue，以及它们按什么顺序执行**。

权威优先级：

1. **Canonical v1.1**：Section / Segment / Owner / original order / migration mode / STOP gate 的唯一事实源。
2. **本 Serial Execution Plan v1.0**：Wave 2 之后的 Issue 包装、串行顺序、checkpoint 与 handoff 规则。
3. **Execution Wave Map v1.0**：保留 B01～B15 的 Batch 定义、风险说明和历史调度背景；其“双车道 / 一 Batch 一 PR / Gate 0 必须先 merge”执行机械已被后续 maintainer rolling-single-PR 决策取代。
4. **Active implementation Issue / live PR #542 metadata**：施工当下的 live HEAD、实际 receipt、验证结果和例外，以实时 GitHub 状态为准。

如果本文件与 Canonical 的 Section/Owner/顺序发生冲突，**无条件以 Canonical 为准，并停止施工包装层继续扩张。**

---

## 1. 当前状态与启用 Gate

### 已完成 / 已进入 rolling PR 的部分

在本计划设计时，Phase 2 已经完成或进入 rolling implementation 的逻辑范围包括：

- P2-01：保序校验接续 + Tools view-mode pilot；
- B01：P2-02 + P2-03；
- B06：P2-12 + P2-13 + P2-14；
- Wave 2 / #547：B04 → B03，即 P2-08 + P2-09 → P2-06 + P2-07，正在实施。

### 本计划启用条件

本计划从 #547 退出后启用。

#547 的退出条件至少包括：

- B04 targeted validation PASS；
- B03 targeted validation PASS；
- P2-06 / P2-07 / P2-08 / P2-09 四份逻辑 receipt 独立存在；
- real product-entry/order reconstruction 无 missing / duplicate / silent reorder；
- maintainer Human Visual Acceptance 已记录为 PASS，或 maintainer 明确记录视觉验收延后；
- 自动 CI 可继续异步运行，**不作为下一张串行 Issue 的启动等待门槛**；
- 不手动触发 Full CI；
- 不手动运行 `pnpm verify:project`。

### Wave 2 之后的剩余量

Wave 2 完成后，Canonical 剩余：

- **18 个逻辑 P2**；
- **133 个 Section**；
- **110 个候选保序 Segment**；
- **6 张串行 execution Issue**。

完整覆盖校验：

```text
剩余逻辑 P2：
P2-04, P2-05,
P2-10, P2-11,
P2-15, P2-16, P2-17, P2-18, P2-19,
P2-20, P2-21,
P2-22, P2-23, P2-24,
P2-25, P2-26,
P2-27, P2-28

= 18 个逻辑 P2
```

```text
133 remaining Sections
+ 已完成 / Wave2 覆盖的 46 Sections
= Canonical 179 Sections
```

---

## 2. 新的默认施工模型

### 2.1 单 Codex / 单 active Issue

默认只保持 **1 张正在施工的 implementation Issue**。

不以同时开启多个 Codex 为目标；如果一个 Codex 可以在同一 Issue 内安全地按 checkpoint 串行完成多个 Batch，就优先采用这种方式。

### 2.2 单 rolling PR

除非 maintainer 以后显式改变策略，6 张 Issue 默认继续提交到：

- PR #542
- branch `agent/issue-541-p2-01`

不因为进入下一张串行 Issue 就自动创建新的实现 PR、stacked PR 或 child PR。

PR #542 默认继续保持 Draft / Open / Unmerged，直到 maintainer 单独决定其 disposition。

### 2.3 一个 Issue 可以装多个 Batch，但不能混账

允许：

```text
一个 Serial Issue
├─ Batch A
│  ├─ P2-x receipt
│  └─ P2-y receipt
└─ Batch B
   ├─ P2-z receipt
   └─ P2-w receipt
```

不允许：

```text
Serial Issue PASS
→ 里面所有 P2 自动算 PASS
```

每个 Canonical P2 仍必须有自己的：

- Section / Segment 范围；
- local boundary receipt；
- migration mode；
- original-order evidence；
- targeted validation；
- human acceptance 或明确 N/A；
- exceptions / STOP 记录。

### 2.4 每个内部 Batch 都有 checkpoint

同一 Issue 内从前一个 Batch 进入下一个 Batch 时：

1. 前一个 Batch targeted validation PASS；
2. commit 到 rolling PR；
3. 重新读取 live PR #542 HEAD；
4. 后一个 Batch 用最新 tree 做 local preflight；
5. 若共享 Source Slice / 邻接 Section 被前一步改变，重新固化 boundary / predecessor / successor；
6. 再开始生产写入。

### 2.5 自动 CI 是异步 evidence，不是施工红绿灯

- targeted validation 是 Batch 完成前的硬要求；
- 自动 CI 正常触发即可；
- 不要求每个内部 Batch 都原地等待 GitHub Actions 跑完才继续；
- 不手动升级成 Full CI；
- 不手动运行 `pnpm verify:project`；
- 若自动 CI 暴露**与当前改动真实相关**的失败，则必须修正后才能把该 Issue 记为完成。

---

## 3. 六张串行 Issue 总表

> `SER-xx` 只是本计划里的 execution wrapper ID，不是新的 Canonical P2 编号。

| Serial Issue | 内部顺序 | 覆盖逻辑 P2 | Sections | Segments | 风险 | 主要目的 |
|---|---|---|---:|---:|---|---|
| **SER-01 Feature Completion A** | B05 → B02 | P2-10,11 → P2-04,05 | 31 | 23 | 🟡 | 收完 Dialogue Properties / Subtitle Style，再收 Character Workspace / Settings |
| **SER-02 Feature Completion B** | B09 → B07 → B08 | P2-22,23,24 → P2-20 → P2-25,26 | 30 | 27 | 🟡 | 收完 FLA 全链、项目生命周期、Debug/Gate 与 Global/Base |
| **SER-03 Timeline Geometry** | B10 | P2-15 | 12 | 11 | 🔴 | Timeline / resize / Audio trim / JS↔CSS geometry |
| **SER-04 Host Geometry** | B11 | P2-16,17 | 21 | 18 | 🔴 | Left Resource + Right Workspace / Inspector host |
| **SER-05 Shell Closeout** | B12 → B13 | P2-18 → P2-19,21 | 21 | 20 | 🔴→🟡 | Editor Shell skeleton 后收 Quick/History/Tools remainder |
| **SER-06 Compat + Closure** | B14 → B15 | P2-27 → P2-28 | 18 + Closure | 11 | 🔴 | ORDERED_COMPAT 收容 + Phase 2 最终总对账 |

合计：

- 6 张 Serial Issue；
- 18 个逻辑 P2；
- 133 Sections；
- 110 Segments；
- 0 个 Canonical P2 被删除或合并掉身份。

推荐总链：

```text
#547 Wave 2
B04 → B03
       ↓
SER-01
B05 → B02
       ↓
SER-02
B09 → B07 → B08
       ↓
SER-03
B10
       ↓
SER-04
B11
       ↓
SER-05
B12 → B13
       ↓
SER-06
B14 → B15
       ↓
Phase 2 DONE
```

---

# 4. SER-01｜Feature Completion A
## B05 → B02｜Dialogue Properties / Subtitle Style → Character Workspace / Settings

### 4.1 范围

**B05：P2-10 + P2-11｜12 Sections｜9 Segments**

- P2-10：Dialogue Properties + bound-audio duration；
- P2-11：Subtitle Style controls + narrow-container adaptation。

**B02：P2-04 + P2-05｜19 Sections｜14 Segments**

- P2-04：Character base / list / detail navigation；
- P2-05：Character settings / expression workspace。

总计：**31 Sections / 23 Segments / 4 logical P2**。

### 4.2 为什么这样排

B05 在 Wave 2 的 Dialogue Authoring 之后自然接续：

```text
P2-08 Dialogue workspace
  ↓
P2-10 Dialogue properties
  ↓
P2-11 Subtitle style
```

B02 则完成 B01 已铺好的 CharacterIdentity / ImagePicker 后续消费者：

```text
P2-02 / P2-03 shared foundations
  ↓
P2-04 Character workspace
  ↓
P2-05 Settings / Expression
```

把这两条 Feature 内部链在进入 Timeline/Host/Shell 前一次收完，可以让后面的 B10/B11 只处理 geometry / host 责任，不再回头搬 feature internals。

### 4.3 内部 checkpoint

```text
Checkpoint 1
B05 / P2-10
→ receipt + targeted validation

Checkpoint 2
B05 / P2-11
→ receipt + targeted validation
→ B05 commit

Checkpoint 3
refresh live #542 HEAD
→ B02 local preflight

Checkpoint 4
B02 / P2-04
→ receipt + targeted validation

Checkpoint 5
B02 / P2-05
→ receipt + targeted validation
→ B02 commit
```

逻辑 checkpoint 顺序**不授权按 P2 编号重新排序 CSS**。每个 Section 仍按 Canonical global order 留在其真实 traversal 位置。

### 4.4 特殊 handoff：S14 / S15

B05 与 B02 都会继续碰 S14 / S15 later-cascade 区域。

尤其：

```text
S15-18  P2-11 Subtitle Style
S15-19  P2-04 Character
S15-20  P2-04 Character
S15-21  P2-11 Subtitle Style
S15-22  P2-04 Character
```

因此 B02 开始写生产 CSS 前，必须在 B05 commit 后重新解析：

- S14-15；
- S15-02 / S15-05；
- S15-19 / S15-20 / S15-22；
- 以及受 B05 remainder reconstruction 影响的 predecessor / successor。

### 4.5 Human Visual 验收面

B05：

- Dialogue Properties 横/竖；
- 文本 / 开始时间 / 时长秒数；
- 说话人；
- 无音频 / 已绑定 / 清除 / 时长滑块 / 应用；
- 字号 / 颜色 / 描边开关 / 描边粗细 / 描边颜色 / 位置；
- 420px window media 与 300px container query 分开验收。

B02：

- Character empty / selected / rename / detail；
- 返回 / 关闭 / 工作区切换；
- 360 / 700 / 701px；
- zoom / flip / pending apply；
- mouth ImagePicker / clear；
- default / normal / editing expression card；
- #528 card-in-place edit 不跨列。

### 4.6 Exit Gate

SER-01 完成后：

- P2-04 / 05 / 10 / 11 四份 receipt 齐；
- B05 / B02 targeted validation PASS；
- touched surfaces maintainer acceptance 已记录；
- B10 的 Dialogue-side 前置满足；
- B11 的 Character + Dialogue host 前置满足。

---

# 5. SER-02｜Feature Completion B
## B09 → B07 → B08｜FLA 全链 → Project Lifecycle → Debug/Gate + Global/Base

### 5.1 范围

**B09：P2-22 + P2-23 + P2-24｜12 Sections｜11 Segments**

- FLA Review / Raster / Status；
- Render / Static Snapshot；
- Frame Sequence。

**B07：P2-20｜10 Sections｜9 Segments**

- Project entry；
- recent projects；
- new / close；
- recovery。

**B08：P2-25 + P2-26｜8 Sections｜7 Segments**

- Debug/Gate preview surfaces；
- native/global helpers / sr-only / eyebrow/h1。

总计：**30 Sections / 27 Segments / 6 logical P2**。

### 5.2 为什么这样排

B09 在 Wave 2 的 Assets 完成后立刻具备完整前置：

```text
P2-06 Assets
  ↓
P2-22 Review / Raster / Status
  ↓
P2-23 Render / Snapshot
  ↓
P2-24 Frame Sequence
```

B07 / B08 没有给 Timeline/Shell 主链制造新的 feature dependency，但应在进入 geometry 区之前清掉，避免高风险 Shell 验收完成以后再回来动 global/base 或 project/debug 基础。

### 5.3 内部 checkpoint

```text
B09
P2-22 → P2-23 → P2-24
→ 每个 P2 独立 receipt
→ B09 targeted validation
→ commit

refresh live #542 HEAD

B07 / P2-20
→ receipt + targeted validation
→ commit

refresh live #542 HEAD

B08
P2-25 + P2-26
→ 独立 receipt
→ targeted validation
→ commit
```

由于 B09 / B07 / B08 共享多个 Source Slice（尤其 S01 / S03 / S04 / S05 / S06），每次进入下一 Batch 前必须基于 live tree 重新做 local preflight，不能复用前一 Batch 开始前的 stale byte range。

### 5.4 特殊纪律

FLA：

- S13 `@media(max-width:900px)` mixed outer block 不在 B09 拆；
- P2-23 的 S13-04 可搬，但 S13-05 继续留给 B14；
- Review / Render / Sequence 三个 P2 receipt 分开。

Project Lifecycle：

- `#412 → #410` 源码真实顺序保持；
- Recovery shared classes 不按名称粗暴归一。

Debug / Global：

- static absence 不能证明 debug/gate surface 死代码；
- generic selector 发现未知消费面时 STOP；
- 不借 P2-26 重画主题或统一 native controls。

### 5.5 Human Visual / N/A

B09：走真实 FLA 入口可达到的 Review / Raster / Status / Render / Sequence 状态。

B07：无项目 / 已打开项目 / 新建 / 关闭确认 / Recent / Recovery。

B08：

- 有真实 gate/debug 入口或 fixture 的表面做对应检查；
- 正常导航不可达的 probe surface 不伪造 PASS，记录 assembly / gate evidence；
- Global/Base 抽查启动页 / Editor / FLA 三类真实表面。

### 5.6 Exit Gate

SER-02 完成后：

- P2-20 / 22 / 23 / 24 / 25 / 26 六份 receipt 齐；
- Feature-level relocation 基本收完；
- B14 的 FLA 前置 P2-23/P2-24 已满足；
- 后续进入 geometry / host / shell 高风险区。

---

# 6. SER-03｜Timeline Geometry
## B10｜P2-15

### 6.1 范围

- 12 Sections；
- 11 Segments；
- owner：`timeline`, `shell-timeline`；
- Source：S01 / S07 / S08 / S09 / S11 / S12 / S13 / S14。

### 6.2 为什么必须单独一张 Issue

P2-15 不再只是“画面 CSS”。

它同时触碰：

- Timeline core；
- BottomWorkspace resize boundary；
- collapsed / expanded height；
- AudioClip trim；
- pending placement；
- JS ↔ CSS geometry contract。

`BottomWorkspace` 会注入并读取 Timeline 相关 CSS custom properties / live geometry，所以这里属于 behavior-adjacent CSS。

### 6.3 必验合同

- collapsed 50px；
- expanded 162..324px 及真实可用上限；
- 48px toolbar；
- 双轨布局；
- zoom / horizontal scroll；
- pending dialogue drag-in；
- AudioClip trim handle / selected overflow；
- portrait / landscape Timeline；
- `timelineUiStore` 不改；
- `BottomWorkspace` JS↔CSS contract 不改。

### 6.4 Serial Gate

SER-03 开始前必须已经满足：

- Wave 1 B06 / P2-13 Canvas；
- Wave 2 P2-08 Dialogue；
- SER-01 P2-10 Dialogue Properties。

### 6.5 Exit Gate

在进入 SER-04 前：

- P2-15 receipt 完整；
- targeted geometry validation PASS；
- real-entry reconstruction PASS；
- maintainer Timeline Human Visual Acceptance PASS，或显式记录 defer；
- 不用等待自动 CI 才创建下一 Issue，但任何已知相关真实失败必须在 SER-03 关闭前解决。

---

# 7. SER-04｜Host Geometry
## B11｜P2-16 + P2-17

### 7.1 范围

- 21 Sections；
- 18 Segments；
- P2-16：Left Resource host / activity rail；
- P2-17：Right Workspace / Inspector host。

### 7.2 为什么必须单独一张 Issue

Left Resource 与 Right Inspector 都不仅是“边栏外观”。

`BottomWorkspace` 会读取：

- Resource rail 的 computed `min-height / gap`；
- Inspector handle 的 computed `min-height / height`；

并把这些值参与 Timeline live max-height 计算。

所以这里相当于搬两把“程序拿来量尺寸的尺子”。

### 7.3 责任边界

P2-16 只搬 host constraints，不重新搬：

- Assets internals；
- Shots internals；
- Character internals。

P2-17 只搬 Right host constraints，不重新搬：

- Dialogue feature internals；
- Subtitle controls；
- Layer Properties internals；
- Tools feature internals。

### 7.4 B11 内部允许降级拆段

若 21 Section preflight 暴露过大的冲突面，允许在**同一 GitHub Issue** 内使用：

```text
B11-A checkpoint = P2-16 Left Resource Host
B11-B checkpoint = P2-17 Right Workspace Host
```

不要求因此再开两张 GitHub Issue。

但是这只是 execution checkpoint；实际 CSS relocation 仍按 Canonical global order，不得把所有 P2-16 物理排序到 P2-17 前面。

### 7.5 Human Visual / Geometry 验收

- Assets / Shots / Characters 三类 Resource page 的 open/close/header/detail/scroll；
- portrait / landscape；
- Resource rail button dimensions；
- Dialogue / Properties / Tools right workspace open/close；
- focus return；
- embedded landscape / independent portrait properties；
- 1050px 前后；
- empty / selected / protected background；
- Timeline 可用高度没有因左右 host relocation 漂移。

### 7.6 Exit Gate

- P2-16 / P2-17 receipt 分开；
- targeted host + geometry checks PASS；
- maintainer acceptance 记录；
- B12 / P2-18 Shell skeleton 的全部前置满足。

---

# 8. SER-05｜Shell Closeout
## B12 → B13｜Editor Shell Skeleton → Quick/History/Tools Remainder

### 8.1 范围

**B12 / P2-18：9 Sections / 8 Segments**

- Editor shell / layout skeleton；
- portrait / landscape geometry；
- top overlay/flow；
- main canvas height；
- left/right/bottom workspace composition。

**B13 / P2-19 + P2-21：12 Sections / 12 Segments**

- Quick drawer / History；
- Tools home / action preset host / remaining tools shell。

总计：**21 Sections / 20 Segments / 3 logical P2**。

### 8.2 内部顺序

```text
B12 / P2-18
→ local preflight
→ relocation
→ targeted shell geometry validation
→ commit

refresh live #542 HEAD

B13
P2-19 + P2-21
→ local preflight
→ relocation
→ targeted shell utility validation
→ commit
```

### 8.3 B12 特殊合同

- `editor-body` live geometry 保持；
- portrait / landscape switch；
- overlay / flow；
- canvas height；
- Resource / Right / Timeline 三方组合；
- recovery overlay / quick drawer z-index 不互挡；
- 不顺手重构 Shell DOM；
- 不顺手统一 breakpoint。

### 8.4 B13 特殊合同

P2-19：

- quick drawer expand/collapse；
- dirty / saving / failed；
- save icon；
- undo / redo；
- reduced-motion；
- 不复活旧 compact / bottom history entrance。

P2-21：

- Tools home；
- Action Preset；
- back；
- empty / selected / locked / background disabled；
- 不重复迁移 P2-01 view-mode pilot；
- 不给 action preset 制造不存在的新 base styles。

### 8.5 Exit Gate

- P2-18 / 19 / 21 三份 receipt 齐；
- B12/B13 targeted PASS；
- Shell + quick/history/tools touched surfaces acceptance 已记录；
- P2-27 的 Shell prerequisite P2-18 满足；
- Phase 2 只剩 ORDERED_COMPAT + Closure。

---

# 9. SER-06｜Compat + Closure
## B14 → B15｜P2-27 ORDERED_COMPAT → P2-28 Final Reconciliation

### 9.1 范围

**B14 / P2-27：18 Sections / 11 Segments**

- Legacy Task surfaces；
- mixed media/container/shared-condition units；
- retained compatibility blocks。

**B15 / P2-28：0 Section / Closure only**

- real-entry final reconciliation；
- complete receipt / acceptance audit；
- Phase 2 closure。

### 9.2 B14 是进入 B15 的硬 Gate

不允许：

```text
B14 做到一半
→ 顺手开始 Closure
```

正确顺序：

```text
B14 complete
→ P2-27 receipt complete
→ ORDERED_COMPAT targeted validation
→ reachable surfaces acceptance / unreachable surfaces N/A + assembly evidence
→ commit
→ refresh live #542 HEAD
→ B15 closure
```

### 9.3 P2-27 的四条铁律

1. Legacy Task 保留，不复活、不删除。
2. S13 `@media(max-width:900px)` mixed block 不在 Phase 2 首轮拆。
3. 完整 media/container/shared-selector 条件块按原位保序。
4. 没有真实入口的表面记录 `N/A + assembly evidence`，不能伪造 Human Visual PASS。

### 9.4 B15 / P2-28 只能做什么

B15 只做总对账：

- Canonical 179 Section 全部可追踪；
- 147 canonical Segment 的去向可解释；
- real product-entry traversal 顺序等价；
- missing = 0；
- duplicate = 0；
- silent reorder = 0；
- legacy paths / remainder paths 的最终状态有解释；
- P2-01～P2-27 每个逻辑 P2 都有 receipt；
- 每个真实验收面都有 maintainer acceptance 或明确 N/A；
- tests/verifier 仍读取真实产品样式入口；
- 未证实死代码零删除；
- 未偷渡 Phase 3 dedup / redesign；
- 未偷渡 Phase 4 deletion。

### 9.5 B15 明确禁止

- 再搬一个“最后漏掉”的新 feature Section；
- 用 closure 当技术债清理；
- selector rename；
- override normalization；
- DOM/state/store/IPC 改动；
- “既然都到最后了”手动跑 Full CI；
- 手动 `pnpm verify:project`。

如果 closure 发现真实缺口：

> **记录缺口 → 回到对应 P2/Batch 修复 → 再重新进入 Closure。**

不能在 P2-28 里无账施工。

### 9.6 Phase 2 最终 Exit Gate

- B01～B14 全部完成；
- P2-01～P2-27 receipt 全部可追踪；
- P2-28 reconciliation PASS；
- 179 Section 恰好一处；
- real-entry global order 等价；
- no silent missing / duplicate / reorder；
- Human Visual / N/A evidence 齐；
- maintainer 明确接受 Phase 2 closure。

---

## 10. 六张 Issue 的依赖关系：Canonical blocker 与 Serial predecessor 分开记

后续正式 Issue 必须同时写两种依赖：

### Canonical blocker

表示产品/责任层真正必须先完成的 P2/Batch。

### Serial predecessor

表示本计划为了保持单车道、降低协调成本而规定的前一张包装 Issue。

两者不能混为一谈。

例如 SER-03：

```text
Canonical blockers:
- P2-08
- P2-10
- P2-13

Serial predecessor:
- SER-02
```

SER-03 在理论 DAG 上并不依赖 SER-02 的 Project/Debug 部分，但本计划仍把它排在 SER-02 后面，因为我们选择**单车道、先清 feature，再进 geometry**。

---

## 11. 每张未来 Serial Issue 的统一派单模板

### Parent / Authority

- #529 roadmap；
- Canonical v1.1；
- 本 Serial Execution Plan；
- rolling PR #542；
- 前一 Serial Issue receipt / exit state。

### Live Starting State

必须从 GitHub 读取并记录：

- live PR #542 HEAD；
- immediate parent commit；
- 当前 manifest / product entry；
- 上一 Batch 已注册 relocation。

不把规划文档里写死的旧 SHA 当 live authority。

### Internal Order

明确：

- Batch A；
- Batch A checkpoint；
- refresh live HEAD；
- Batch B；
- Batch B checkpoint；
- 如有 Batch C，重复。

### Independent Accounting

每个 P2：

- Section IDs；
- Segment IDs；
- owner；
- migration mode；
- boundary receipt；
- target paths；
- targeted validation；
- human acceptance / N/A；
- exceptions。

### Validation

默认：

```text
local boundary preflight
+ real product-entry/order verification
+ Batch-specific contract/tests
+ typecheck/lint/unit/build only where current route requires
+ touched-surface maintainer acceptance
+ normal automatic CI
```

默认禁止：

- manual Full CI；
- manual `pnpm verify:project`；
- unrelated historical verifier sweep；
- 为“更稳一点”扩大到无关技术债。

---

## 12. 全局 STOP Gates

任意一张 Serial Issue / 任意内部 Batch 命中以下条件，停止当前生产写入：

- pinned blob / anchor / Section boundary 无法与 Canonical 对齐；
- 一个完整 media/container/shared-selector 必须被拆开才能继续；
- source order 只能靠排序、额外 override 或 selector 重写才能恢复；
- 相对 URL / keyframes / CSS variables / `!important` 语义改变但无明确 mapping；
- 发现新的 runtime/programmatic consumer，导致既定验收面不完整；
- 必须改 DOM / state / store / IPC / business behavior / copy / breakpoint meaning；
- programmatic geometry contract 无法证明等价；
- 自动 conflict resolution 会合并两个原本独立的 canonical Section；
- work 正在滑向 Phase 3 dedup/redesign；
- work 正在滑向 Phase 4 deletion。

STOP 后唯一动作：

> 记录 receipt / evidence gap → 保留当前可复现节点 → 重新定义该 Batch 的局部实施边界。

不靠扩大范围硬顶过去。

---

## 13. 为什么不是 1 张超级 Issue，也不是继续 8 个 Wave

### 不做 1 张超级 Issue

因为后半段存在明显风险台阶：

```text
Feature CSS
  ↓
Timeline geometry
  ↓
Host geometry
  ↓
Shell geometry
  ↓
ORDERED_COMPAT
  ↓
Closure
```

如果全部塞进一张巨型 Issue，Timeline/Host/Shell 出现问题时难以建立清晰止损点。

### 不继续 8 个旧 Wave

旧 Wave Map 的“双车道”设计是为了减少墙钟时间，但实战后 maintainer 已明确：

- 多 Codex 并发不是目标；
- 同一 Issue 串行多个 Batch 可以接受；
- rolling PR 不需要每个 Batch 套一个新 PR；
- 自动 CI 不需要成为 Batch 间等待门槛。

所以 6 张 Issue 是当前更合适的中间粒度：

- 比 18 个逻辑 P2 / 8 个旧 Wave 清爽；
- 比 1 张超级 Issue 更容易 checkpoint / stop / review；
- 不牺牲 Canonical receipt 完整性。

---

## 14. Just-in-time Issue 发布规则

默认**不一次性创建 6 张 implementation Issue**。

建议：

```text
当前 Issue 接近 exit
→ 创建下一张 Serial Issue
→ 标记 ready-for-agent
→ 当前 Issue 完成
→ Codex 进入下一张
```

这样 GitHub 上始终只有一个明确的 implementation frontier，不会出现 5 张下游 Issue 同时挂着 `ready-for-agent` 但其实前置没完成。

第一个可创建的后续 Issue：

> **SER-01：B05 → B02**

但只有在 #547 满足本文件第 1 节启用 Gate 后才正式进入生产写入。

---

## 15. Out of Scope

本计划不改变：

- Canonical 28 P2 身份；
- 179 Section / 147 Segment；
- owner registry；
- migration mode；
- destination mapping；
- product visual values；
- DOM / state / store / IPC；
- Phase 3 dedup / redesign；
- Phase 4 legacy deletion。

本计划也不授权：

- merge #542；
- mark #542 Ready；
- auto-merge；
- self-merge；
- manual Full CI；
- manual `pnpm verify:project`。

---

## 16. Integrity Receipt

### Packaging coverage

- Serial Issue count：6
- Remaining logical P2 after Wave 2：18
- Remaining Sections：133
- Remaining Segments：110

### Per wrapper

```text
SER-01 = 31 Sections / 23 Segments / 4 P2
SER-02 = 30 Sections / 27 Segments / 6 P2
SER-03 = 12 Sections / 11 Segments / 1 P2
SER-04 = 21 Sections / 18 Segments / 2 P2
SER-05 = 21 Sections / 20 Segments / 3 P2
SER-06 = 18 Sections / 11 Segments / 2 P2 (其中 P2-28 = 0 Section)
```

```text
Sections:
31 + 30 + 12 + 21 + 21 + 18 = 133

Segments:
23 + 27 + 11 + 18 + 20 + 11 = 110

Logical P2:
4 + 6 + 1 + 2 + 3 + 2 = 18
```

### Boundary note

这份 Integrity Receipt 只证明**串行包装覆盖完整**，不等于 133 个剩余 Section 已经完成 live anchor / byte / runtime 等价验证。

每张 Serial Issue 仍必须做自己的 local preflight。

---

## 17. AUTO SAVE v1.1

```text
=== AUTO SAVE v1.1 ===
时间：2026-09-16
阶段：写作 / Phase 2 串行执行计划
本次变化 Delta：
将 Wave 2 之后剩余的 18 个逻辑 P2 / 133 Section / 110 Segment，重新包装为 6 张单车道串行实施 Issue。

做了什么（结果）：
- 保留 Canonical v1.1 的全部 P2 / Section / Segment / Owner / STOP gate。
- Execution Wave Map v1.0 的 B01～B15 定义继续复用。
- 后续双车道/一Batch一PR机械被单 Codex + 单 active Issue + rolling PR 模式取代。
- 定义 6 张 Serial Issue：
  SER-01 B05→B02
  SER-02 B09→B07→B08
  SER-03 B10
  SER-04 B11
  SER-05 B12→B13
  SER-06 B14→B15
- 每个内部 Batch 保留 checkpoint、live HEAD refresh、targeted validation。
- 每个 logical P2 保留独立 receipt / human acceptance / N/A。
- B10/B11/B12/B14 保留高风险 STOP / geometry gate。
- B14 完成是进入 B15 Closure 的硬 Gate。
- 定义 just-in-time Issue 发布策略，不一次性制造 6 张 ready-for-agent 工单。

当前状态（一句话）：
Wave 2 后的 Phase 2 执行路线已收敛为 6 张串行实施 Issue；文档启用点是 #547 Wave 2 达到退出 Gate。

下一步（唯一可执行）：
等待 #547 Wave 2 完成并验收；随后基于本计划创建 SER-01（B05→B02）正式实施 Issue。

止损条件（触发即停）：
任一 Serial Issue 包装导致 Canonical P2 的独立 receipt / STOP / acceptance 无法单独记录，立即拆小，不为了保持“6张”硬合。

反话闸门（反例/代价/需要的证据）：
- 串行减少协调成本，但不保证墙钟时间最短。
- Issue 数量减少不能换成 receipt 粒度减少。
- Geometry/Host/Shell 风险必须靠真实 targeted + human acceptance 证明，不能靠“前面都没坏”推断。

风险 / 未验证（翻车点）：
- #547 仍在实施，Wave 2 最终 live HEAD / receipt 尚待落地。
- 剩余 B1 evidence Section 仍需各自 active Issue 做 local resolution。
- B11 21 Section 可能在 preflight 后需要同 Issue 内 B11-A/B11-B checkpoint。

置信度（0-5）：
5：18 P2 / 133 Section / 110 Segment 包装完整性。
5：6 Issue 串行依赖结构。
4.5：SER-01/SER-02 的中型组合粒度。
5：B10/B11/B14 高风险单独 checkpoint。
=================
```
