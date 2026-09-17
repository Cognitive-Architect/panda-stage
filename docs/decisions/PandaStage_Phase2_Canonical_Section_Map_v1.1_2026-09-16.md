# Panda Stage｜Phase 2 Canonical Section Map v1.1
## 28 张实施单 × 179 Section × 147 保序 Segment｜唯一派单基线

- 日期：2026-09-16
- 仓库：`Cognitive-Architect/panda-stage`
- 锁定提交：`fb5f91ecb8ee3ecdcea9bf2f242526feb3597859`
- 父路线图：#529
- 来源 A：22-Issue `Phase 2 Dispatch Section Map v1.0`
- 来源 B：28-Issue `Phase 2 Section Map v1.0`
- 状态：**CANONICAL PLANNING MAP；不是自动批量迁移许可。**
- `approved_for_automatic_relocation = false`

> **v1.1 最终决策：采用 28 张 Issue 作为正式实施粒度；保留 179 个有序 Section 与 147 个候选连续 Segment。**
>
> 22 单版不作废，它降级为“管理/责任模型”：把 `DIRECT / HOST_INTEGRATION / ORDERED_COMPAT`、Producer→Host→Consumer、Compatibility Ledger 和 STOP Gate 合并进 28 单骨架。

人话：28 单版负责回答“到底分几车、每车装哪些箱子”；22 单版负责回答“这箱东西是谁家的、能不能直接搬、谁还拿它当尺子用”。v1.1 把两张单子订在一起，以后只认这一份。

---

## 0. Canonical 决策与不变项

- 28 tickets are the implementation granularity; the old 22-ticket map remains traceability/management context only.
- 179 Sections remain one total ordered chain; no sorting by feature, owner or historical Issue number.
- 147 Segments are candidate physical groups, not an instruction to create 147 files immediately.
- tokens.css and primitives.css remain existing base predecessors during Phase 2.
- Every production relocation requires the active Issue's local anchor/receipt preflight.
- DIRECT moves component-owned rules; HOST_INTEGRATION moves host constraints without duplicating bases; ORDERED_COMPAT keeps unsafe mixed/legacy units intact and in order.
- Phase 2 does not redesign visuals, deduplicate, delete legacy CSS, alter DOM/state/store/IPC, or normalize historical overrides.
- Do not manually trigger Full CI / pnpm verify:project unless explicitly authorized; use issue-scoped minimum sufficient validation plus normal required CI.

### 三种迁移模式

| 模式 | 含义 | 人话 |
|---|---|---|
| `DIRECT` | 组件/功能自产规则，可按已证明边界直接归位 | 自己家的锅搬回自己厨房 |
| `HOST_INTEGRATION` | 宿主对孩子的尺寸/布局/模式约束，不复制孩子的基础规则 | 柜子摆在客厅哪儿归房东管，柜子内部结构仍归柜子自己 |
| `ORDERED_COMPAT` | 跨域 media/container、旧表面、共享 selector 或覆盖链不能安全首轮拆 | 一袋混装零件先整袋贴标签保留，别为了分类把螺丝撒一地 |

`DIRECT+HOST_INTEGRATION` / `DIRECT+COMPAT` 是一张 Issue 同时包含两类责任时的组合标记；P2-28 `CLOSURE` 只对账，不再借机搬新功能。

---

## 1. 证据边界：现在能说什么，不能说什么

- 16/16 Source Slice 已读；总 CSS 正文 **32,816 行**。
- 已登记 **179 个 Section**，形成 **147 个候选连续 Segment**。
- 当前有 **3 个 Slice / 48 个 Section** 带本地机器边界回执。
- 其余 Section 是锁定提交上的远端锚点审阅结果，正式生产写入前必须由当前 Issue 的 preflight 本地固化。
- 尚未宣称：所有动态 class/DOM 命中穷举、所有 computed-style 最终赢家矩阵、Windows 全量回归。
- 因此：**范围地图已经完整；全量机器/运行时证明尚未完成。** 两句话不能偷换。

### Evidence Tier

| Tier | 含义 | 能做什么 |
|---|---|---|
| `B2_LOCAL_BOUNDARY_VERIFIED` | 已在锁定原文解析到行/字节 receipt | 可以作为本 Issue 施工切口输入，但仍需 targeted runtime/验收 |
| `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` | 锚点已审阅，未有本地精确 receipt | **只能派单/预检，不能盲写生产 CSS** |
| `R0_NOT_REVALIDATED_IN_THIS_MAP` | 运行时/Windows/最终 computed winner 未穷举 | 不得据此删“看起来没用”的规则 |

---

## 2. 最终 28 张正式实施单

| Issue | 范围 | Mode | Sections | 前置 | 22版追溯 |
|---|---|---|---:|---|---|
| **P2-01** | 保序校验接续与工具页画布模式试点 | `DIRECT+VERIFICATION` | 1 | — | 22:P2-01 |
| **P2-02** | 共享图片选择器 | `DIRECT` | 2 | P2-01 | 22:P2-07, 22:P2-17 |
| **P2-03** | 角色身份、缩略图图标及字幕宿主适配 | `DIRECT+HOST_INTEGRATION` | 7 | P2-01 | 22:P2-07, 22:P2-15 |
| **P2-04** | 角色基础、列表与详情导航 | `DIRECT` | 12 | P2-03 | 22:P2-08, 22:P2-17 |
| **P2-05** | 角色设置与表情编辑工作区 | `DIRECT+HOST_INTEGRATION` | 7 | P2-02, P2-04 | 22:P2-17 |
| **P2-06** | 素材导入、素材库与详情 | `DIRECT` | 5 | P2-01 | 22:P2-05 |
| **P2-07** | 镜头列表、创建、详情与缩略图 | `DIRECT` | 7 | P2-01 | 22:P2-06 |
| **P2-08** | 字幕工作区、待安排与单条创建 | `DIRECT+HOST_INTEGRATION` | 9 | P2-03 | 22:P2-14, 22:P2-15 |
| **P2-09** | 批量台词识别与提交 | `DIRECT` | 3 | P2-08 | 22:P2-14 |
| **P2-10** | 字幕属性与绑定音频时长 | `DIRECT+HOST_INTEGRATION` | 10 | P2-03, P2-08 | 22:P2-14, 22:P2-15 |
| **P2-11** | 字幕样式控件与窄容器适配 | `DIRECT+HOST_INTEGRATION` | 2 | P2-10 | 22:P2-16 |
| **P2-12** | 图层位置、变换、外观与层序 | `DIRECT` | 9 | P2-01 | 22:P2-12 |
| **P2-13** | 画布内部与视口 | `DIRECT` | 2 | P2-01 | 22:P2-10 |
| **P2-14** | 产品预览浮层 | `DIRECT` | 1 | P2-13 | 22:P2-21 (product-preview portion) |
| **P2-15** | 时间轴、拉伸边界与音频裁剪 | `DIRECT+HOST_INTEGRATION` | 12 | P2-08, P2-10, P2-13 | 22:P2-13 |
| **P2-16** | 左资源宿主与活动栏 | `HOST_INTEGRATION` | 9 | P2-05, P2-06, P2-07 | 22:P2-09 |
| **P2-17** | 右工作区与属性抽屉宿主 | `HOST_INTEGRATION` | 12 | P2-09, P2-11, P2-12 | 22:P2-11 |
| **P2-18** | 编辑器布局与工作区骨架 | `HOST_INTEGRATION` | 9 | P2-14, P2-15, P2-16, P2-17 | 22:P2-03 |
| **P2-19** | 顶部快捷抽屉与撤销重做适配 | `DIRECT+HOST_INTEGRATION` | 7 | P2-18 | 22:P2-03, 22:P2-04 (quick-action portion) |
| **P2-20** | 项目入口、最近项目与恢复 | `DIRECT+HOST_INTEGRATION` | 10 | P2-01 | 22:P2-04 |
| **P2-21** | 工具页剩余与动作预设宿主 | `DIRECT+HOST_INTEGRATION` | 5 | P2-01, P2-13, P2-17 | 22:P2-18 |
| **P2-22** | FLA审查、位图选择与终态 | `DIRECT` | 7 | P2-06 | 22:P2-19 |
| **P2-23** | FLA渲染工作台与静态快照 | `DIRECT` | 4 | P2-22 | 22:P2-20 |
| **P2-24** | FLA帧序列审查 | `DIRECT` | 1 | P2-23 | 22:P2-20 (frame-sequence portion) |
| **P2-25** | 调试与验收预览表面 | `DIRECT+COMPAT` | 5 | P2-01 | 22:P2-21 (debug/gate portion) |
| **P2-26** | 全局基础与零散辅助样式 | `DIRECT+COMPAT` | 3 | P2-01 | 22:P2-02 |
| **P2-27** | 旧任务表面与跨域条件保留段 | `ORDERED_COMPAT` | 18 | P2-15, P2-18, P2-23, P2-24 | 22:P2-15 (legacy task portion), 22:P2-22 (ordered compatibility portion) |
| **P2-28** | 真实入口总对账与Phase 2收口 | `CLOSURE` | 0 | P2-01, P2-02, P2-03, P2-04, P2-05, P2-06, P2-07, P2-08, P2-09, P2-10, P2-11, P2-12, P2-13, P2-14, P2-15, P2-16, P2-17, P2-18, P2-19, P2-20, P2-21, P2-22, P2-23, P2-24, P2-25, P2-26, P2-27 | 22:P2-22 (closure portion) |

### 为什么最终采用 28，而不是 22

- 共享 ImagePicker 与 CharacterIdentity/Thumbnail 的消费者和验收面不同，值得拆开。
- Dialogue 的单条创建 / Batch / Properties+Audio / SubtitleStyle 是不同失败状态和宿主，拆开比一个大 Dialogue 工单安全。
- Product Preview 与 Debug/Gate 是产品表面和验收探针两种东西，不再放一单。
- FLA Review/Status、Render/Snapshot、Frame Sequence 是三种工作面。
- Legacy Task / Mixed Conditions 的“保留施工”与最终 Phase 2 对账职责完全不同，因此 P2-27 与 P2-28 分离。

---

## 3. 每张 Issue 的 canonical 派单卡

### P2-01｜保序校验接续与工具页画布模式试点

- **Mode：** `DIRECT+VERIFICATION`
- **Owner：** shell-tools, verification
- **Source：** S11
- **Section：** S11-01
- **Segment：** G097
- **Blocked by：** 无
- **22版追溯：** 22:P2-01

**聚焦验收：** 只搬 S11-01；校验实际入口、文件指纹、完整规则与全序。两个模式按钮可切换，动作预设未受影响。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**程序/测试消费者补充：**
- stores/canvasViewportStore.ts and action-preset state are behavior owners; CSS relocation must not modify them

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-02｜共享图片选择器

- **Mode：** `DIRECT`
- **Owner：** image-picker
- **Source：** S14, S16
- **Section：** S14-14, S16-07
- **Segment：** G124, G147
- **Blocked by：** P2-01
- **22版追溯：** 22:P2-07, 22:P2-17

**聚焦验收：** 嘴部与表情两处入口；未配置/已选/错误/禁用/展开/inline；清除注入位置不变。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-03｜角色身份、缩略图图标及字幕宿主适配

- **Mode：** `DIRECT+HOST_INTEGRATION`
- **Owner：** character-identity, thumbnail-status, dialogue-identity-host
- **Source：** S15
- **Section：** S15-01, S15-03, S15-04, S15-06, S15-12, S15-14, S15-15
- **Segment：** G126, G128, G129, G131, G133, G135, G136
- **Blocked by：** P2-01
- **22版追溯：** 22:P2-07, 22:P2-15

**聚焦验收：** 角色列表/详情、单条/批量字幕、字幕属性/右摘要；空与选中等高；34px 头像不被42/36px基础覆盖。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-04｜角色基础、列表与详情导航

- **Mode：** `DIRECT`
- **Owner：** characters-workspace
- **Source：** S05, S07, S10, S15, S16
- **Section：** S05-02, S05-06, S05-07, S05-08, S07-15, S10-02, S15-02, S15-05, S15-19, S15-20, S15-22, S16-03
- **Segment：** G034, G038, G071, G090, G127, G130, G140, G142, G144
- **Blocked by：** P2-03
- **22版追溯：** 22:P2-08, 22:P2-17

**聚焦验收：** 空列表、选中、改名、详情返回/关闭、两个工作区切换；360/700/701px边界不换序。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-05｜角色设置与表情编辑工作区

- **Mode：** `DIRECT+HOST_INTEGRATION`
- **Owner：** characters-settings, characters-expression
- **Source：** S10, S14, S16
- **Section：** S10-03, S14-15, S16-01, S16-02, S16-04, S16-05, S16-06
- **Segment：** G091, G125, G143, G145, G146
- **Blocked by：** P2-02, P2-04
- **22版追溯：** 22:P2-17

**聚焦验收：** 缩放/翻转/待应用、嘴部选图/清除、默认/普通/编辑表情卡；#528卡内编辑不跨列。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-06｜素材导入、素材库与详情

- **Mode：** `DIRECT`
- **Owner：** assets
- **Source：** S01, S05, S07, S09
- **Section：** S01-18, S05-01, S07-02, S07-14, S09-08
- **Segment：** G017, G033, G058, G070, G088
- **Blocked by：** P2-01
- **22版追溯：** 22:P2-05

**聚焦验收：** 横竖屏图片/音频、空态、搜索、分类、分页、详情、缺失图和导入结果；拖入画布仍可用。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-07｜镜头列表、创建、详情与缩略图

- **Mode：** `DIRECT`
- **Owner：** shots
- **Source：** S05, S07, S08, S09, S15
- **Section：** S05-03, S05-05, S07-13, S08-07, S09-05, S09-06, S15-17
- **Segment：** G035, G037, G069, G078, G086, G138
- **Blocked by：** P2-01
- **22版追溯：** 22:P2-06

**聚焦验收：** 横屏快捷操作/创建、竖屏详情、无缩略图/ready、切镜头；顺序与背景不变。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-08｜字幕工作区、待安排与单条创建

- **Mode：** `DIRECT+HOST_INTEGRATION`
- **Owner：** dialogue-workspace
- **Source：** S02, S06, S14, S15
- **Section：** S02-04, S06-11, S14-01, S15-07, S15-08, S15-09, S15-10, S15-11, S15-13
- **Segment：** G021, G053, G113, G132, G134
- **Blocked by：** P2-03
- **22版追溯：** 22:P2-14, 22:P2-15

**聚焦验收：** 空/待安排/已选/单条创建；可手动拖入/自动加入/删除、提交按钮和单条sticky页脚保持。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-09｜批量台词识别与提交

- **Mode：** `DIRECT`
- **Owner：** dialogue-batch
- **Source：** S14, S15
- **Section：** S14-02, S14-06, S15-16
- **Segment：** G114, G118, G137
- **Blocked by：** P2-08
- **22版追溯：** 22:P2-14

**聚焦验收：** 合法/未知/歧义/映射/错误；结果页纵向滚动、映射选择与批量非sticky页脚保持。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-10｜字幕属性与绑定音频时长

- **Mode：** `DIRECT+HOST_INTEGRATION`
- **Owner：** dialogue-properties
- **Source：** S08, S09, S12, S14
- **Section：** S08-02, S09-02, S12-06, S12-07, S14-03, S14-05, S14-07, S14-08, S14-12, S14-13
- **Segment：** G073, G083, G106, G115, G117, G119, G123
- **Blocked by：** P2-03, P2-08
- **22版追溯：** 22:P2-14, 22:P2-15

**聚焦验收：** 横竖属性：文本宽度、开始+时长秒数、说话人、无音频/绑定/清除/时长滑块与应用；不改毫秒数据。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-11｜字幕样式控件与窄容器适配

- **Mode：** `DIRECT+HOST_INTEGRATION`
- **Owner：** subtitle-style
- **Source：** S15
- **Section：** S15-18, S15-21
- **Segment：** G139, G141
- **Blocked by：** P2-10
- **22版追溯：** 22:P2-16

**聚焦验收：** 字号、颜色、描边开关、描边粗细/颜色和位置；开关前后不跳；420px窗口和300px容器分开验收。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-12｜图层位置、变换、外观与层序

- **Mode：** `DIRECT`
- **Owner：** layer-properties
- **Source：** S06, S07, S08, S11
- **Section：** S06-02, S06-04, S07-10, S08-12, S08-13, S08-14, S11-05, S11-06, S11-07
- **Segment：** G045, G047, G066, G081, G100
- **Blocked by：** P2-01
- **22版追溯：** 22:P2-12

**聚焦验收：** 横竖屏选中/未选中、背景/锁定保护、位置/大小/旋转、透明度、层序/删除；共享summary规则不被拆。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-13｜画布内部与视口

- **Mode：** `DIRECT`
- **Owner：** canvas
- **Source：** S06, S07
- **Section：** S06-01, S07-11
- **Segment：** G044, G067
- **Blocked by：** P2-01
- **22版追溯：** 22:P2-10

**聚焦验收：** 适应/实际尺寸、pan、放置/选中、逻辑坐标、竖屏时间轴上下文；不得删功能包装层。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**程序/测试消费者补充：**
- stores/canvasViewportStore.ts owns fit/actual-size state used by the canvas/tools surface

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-14｜产品预览浮层

- **Mode：** `DIRECT`
- **Owner：** product-preview
- **Source：** S06
- **Section：** S06-09
- **Segment：** G051
- **Blocked by：** P2-13
- **22版追溯：** 22:P2-21 (product-preview portion)

**聚焦验收：** 打开/播放/关闭预览、横竖比例、字幕显示、缺失图；不碰debug/gateA预览。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-15｜时间轴、拉伸边界与音频裁剪

- **Mode：** `DIRECT+HOST_INTEGRATION`
- **Owner：** timeline, shell-timeline
- **Source：** S01, S07, S08, S09, S11, S12, S13, S14
- **Section：** S01-12, S07-07, S08-04, S09-03, S11-08, S11-09, S12-03, S12-04, S12-09, S13-03, S14-04, S14-09
- **Segment：** G012, G063, G075, G084, G101, G102, G104, G108, G110, G116, G120
- **Blocked by：** P2-08, P2-10, P2-13
- **22版追溯：** 22:P2-13

**聚焦验收：** 收起50px、展开162..324px及实际可用上限、48px工具栏、双轨等分、缩放/横滚/拖入/裁剪；左右栏几何读取不变。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**程序/测试消费者补充：**
- features/timeline/timelineUiStore.ts owns expanded/height state used by BottomWorkspace and TimelineDock
- shell/BottomWorkspace.tsx injects --timeline-expanded-height/min/max-height and reads live geometry
- shell/BottomWorkspace.tsx provides JS↔CSS geometry contract for Timeline resize

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-16｜左资源宿主与活动栏

- **Mode：** `HOST_INTEGRATION`
- **Owner：** shell-resources
- **Source：** S01, S05, S06, S07, S09, S10
- **Section：** S01-08, S05-04, S06-16, S07-01, S07-04, S07-12, S09-07, S10-01, S10-05
- **Segment：** G008, G036, G057, G060, G068, G087, G089, G093
- **Blocked by：** P2-05, P2-06, P2-07
- **22版追溯：** 22:P2-09

**聚焦验收：** 三种资源页的开合/头部/详情/滚动与横竖适配；活动栏按钮尺寸供时间轴测量，不得误改。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**程序/测试消费者补充：**
- shell/BottomWorkspace.tsx reads live resource rail computed min-height/gap as a Timeline max-height floor

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-17｜右工作区与属性抽屉宿主

- **Mode：** `HOST_INTEGRATION`
- **Owner：** shell-right
- **Source：** S01, S02, S06, S07, S08, S11
- **Section：** S01-07, S02-03, S02-05, S06-13, S07-03, S07-05, S07-16, S08-01, S08-03, S08-08, S11-03, S11-04
- **Segment：** G007, G020, G022, G055, G059, G061, G072, G074, G079, G099
- **Blocked by：** P2-09, P2-11, P2-12
- **22版追溯：** 22:P2-11

**聚焦验收：** 字幕/属性/工具开合与焦点返回，横屏embedded/竖屏独立属性；1050px前后及空/选中/背景保护。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**程序/测试消费者补充：**
- shell/BottomWorkspace.tsx reads the inspector rail handle computed min-height/height as a Timeline max-height floor

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-18｜编辑器布局与工作区骨架

- **Mode：** `HOST_INTEGRATION`
- **Owner：** shell-layout
- **Source：** S01, S06, S07, S14
- **Section：** S01-02, S01-04, S01-06, S01-10, S06-12, S06-14, S06-15, S07-06, S14-11
- **Segment：** G002, G004, G006, G010, G054, G056, G062, G122
- **Blocked by：** P2-14, P2-15, P2-16, P2-17
- **22版追溯：** 22:P2-03

**聚焦验收：** 横竖切换、顶部overlay/flow、主画布高度、左右抽屉和时间轴组合；恢复浮层与快捷抽屉不互挡。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**程序/测试消费者补充：**
- shell/BottomWorkspace.tsx reads editor-body geometry when calculating live Timeline height bounds

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-19｜顶部快捷抽屉与撤销重做适配

- **Mode：** `DIRECT+HOST_INTEGRATION`
- **Owner：** shell-quick-actions, history
- **Source：** S01, S06, S07, S08, S10, S14
- **Section：** S01-05, S01-13, S06-03, S07-09, S08-06, S10-04, S14-10
- **Segment：** G005, G013, G046, G065, G077, G092, G121
- **Blocked by：** P2-18
- **22版追溯：** 22:P2-03, 22:P2-04 (quick-action portion)

**聚焦验收：** 展开/收起、dirty/saving/failed、保存图标、撤销重做、reduced-motion；不复活旧compact或底部历史入口。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-20｜项目入口、最近项目与恢复

- **Mode：** `DIRECT+HOST_INTEGRATION`
- **Owner：** project-entry, project-recovery
- **Source：** S01, S03, S04, S05, S06, S10
- **Section：** S01-03, S01-16, S01-17, S03-06, S04-01, S05-09, S05-10, S06-08, S06-10, S10-07
- **Segment：** G003, G015, G016, G028, G039, G040, G050, G052, G095
- **Blocked by：** P2-01
- **22版追溯：** 22:P2-04

**聚焦验收：** 无项目/已打开项目、新建/关闭确认、最近列表/维护、恢复卡；#412在#410前的真实次序保持。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-21｜工具页剩余与动作预设宿主

- **Mode：** `DIRECT+HOST_INTEGRATION`
- **Owner：** shell-tools
- **Source：** S01, S10, S11
- **Section：** S01-09, S01-11, S10-06, S10-08, S11-02
- **Segment：** G009, G011, G094, G096, G098
- **Blocked by：** P2-01, P2-13, P2-17
- **22版追溯：** 22:P2-18

**聚焦验收：** 工具主页/动作预设/返回、空选中/锁定/背景禁用；不重复搬P2-01试点，也不为actions制造不存在的新基础样式。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**程序/测试消费者补充：**
- stores/canvasViewportStore.ts and action-preset state are behavior owners; CSS relocation must not modify them

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-22｜FLA审查、位图选择与终态

- **Mode：** `DIRECT`
- **Owner：** fla-review, fla-raster, fla-status
- **Source：** S01, S02, S03
- **Section：** S01-19, S02-01, S02-02, S03-01, S03-02, S03-03, S03-04
- **Segment：** G018, G019, G023, G024, G025, G026
- **Blocked by：** P2-06
- **22版追溯：** 22:P2-19

**聚焦验收：** 门户、检查页、位图选择、警告分级、成功/部分成功/失败/取消；路由、滚动和终态按钮原样。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-23｜FLA渲染工作台与静态快照

- **Mode：** `DIRECT`
- **Owner：** fla-render
- **Source：** S03, S04, S13
- **Section：** S03-05, S04-03, S04-05, S13-04
- **Segment：** G027, G030, G032, G111
- **Blocked by：** P2-22
- **22版追溯：** 22:P2-20

**聚焦验收：** render路由目标/预览/详情三栏、选择/搜索/滚动、静态快照、1080px适配；media900共享块仍在原位。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-24｜FLA帧序列审查

- **Mode：** `DIRECT`
- **Owner：** fla-sequence
- **Source：** S04
- **Section：** S04-02
- **Segment：** G029
- **Blocked by：** P2-23
- **22版追溯：** 22:P2-20 (frame-sequence portion)

**聚焦验收：** 帧序列列表/预览/选帧/播放/导入状态；维持与render/snapshot的实际前后覆盖关系。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-25｜调试与验收预览表面

- **Mode：** `DIRECT+COMPAT`
- **Owner：** debug-preview
- **Source：** S01, S05, S06
- **Section：** S01-14, S01-15, S05-11, S05-13, S06-05
- **Segment：** G014, G041, G043, G048
- **Blocked by：** P2-01
- **22版追溯：** 22:P2-21 (debug/gate portion)

**聚焦验收：** App保留debugSurface/gateA装配；用现有轻量条件入口或组件fixture确认，不跑全历史验收套餐。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**程序/测试消费者补充：**
- App / gate/debug flags can conditionally mount probe surfaces; normal navigation absence is not dead-code proof

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-26｜全局基础与零散辅助样式

- **Mode：** `DIRECT+COMPAT`
- **Owner：** base-global
- **Source：** S01, S04, S05
- **Section：** S01-01, S04-04, S05-12
- **Segment：** G001, G031, G042
- **Blocked by：** P2-01
- **22版追溯：** 22:P2-02

**聚焦验收：** 原生button三态、根节点、字体、sr-only、eyebrow/h1；抽查启动页/编辑器/FLA三类，不做全局主题重画。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-27｜旧任务表面与跨域条件保留段

- **Mode：** `ORDERED_COMPAT`
- **Owner：** legacy-task, mixed
- **Source：** S06, S07, S08, S09, S11, S12, S13
- **Section：** S06-06, S06-07, S07-08, S08-05, S08-09, S08-10, S08-11, S08-15, S09-01, S09-04, S11-10, S12-01, S12-02, S12-05, S12-08, S13-01, S13-02, S13-05
- **Segment：** G049, G064, G076, G080, G082, G085, G103, G105, G107, G109, G112
- **Blocked by：** P2-15, P2-18, P2-23, P2-24
- **22版追溯：** 22:P2-15 (legacy task portion), 22:P2-22 (ordered compatibility portion)

**聚焦验收：** 旧TaskTray完整保留但不恢复入口；四个跨域条件块整块、原位、原条件。没有入口记N/A+装配证据，不记视觉PASS。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

### P2-28｜真实入口总对账与Phase 2收口

- **Mode：** `CLOSURE`
- **Owner：** integration
- **Source：** —
- **Section：** —（总对账单）
- **Segment：** —
- **Blocked by：** P2-01, P2-02, P2-03, P2-04, P2-05, P2-06, P2-07, P2-08, P2-09, P2-10, P2-11, P2-12, P2-13, P2-14, P2-15, P2-16, P2-17, P2-18, P2-19, P2-20, P2-21, P2-22, P2-23, P2-24, P2-25, P2-26, P2-27
- **22版追溯：** 22:P2-22 (closure portion)

**聚焦验收：** 每个原始字节恰好一处；真实入口遍历顺序一致；旧路径退出且测试读真实产品样式；关联手测回执齐，未证实死代码零删除。

**改动合同：** CSS relocation plus minimum source-reader/manifest/CI path integration only. No DOM, data, product copy, state, or visual redesign.

**STOP：** STOP if a pinned blob/anchor no longer matches, a section cannot remain condition-complete and order-equivalent, a relative resource path changes without an explicit mapping, a new runtime/programmatic consumer changes the acceptance surface, or the work would require DOM/state/visual-value/deletion changes.

---

## 4. 四层责任模型：以后不再只问“这个 class 谁在用”

```text
Producer
  ↓
Host
  ↓
UI / Runtime Consumers
  ↓
Programmatic / Test Consumers
```

### v1.1 新增的关键程序消费者

- `BottomWorkspace.tsx` 会读取左 Resource rail 的 computed `min-height/gap`，把它当 Timeline 最大高度下限的一部分。
- `BottomWorkspace.tsx` 会读取右 Inspector handle 的 computed `min-height/height`。
- `BottomWorkspace.tsx` 会读取 `editor-body` 实际几何，并向 CSS 注入 `--timeline-expanded-height/min/max-height`。
- `read-stylesheet-source.ts` 当前按生产 `styles.css` 顶部**连续简单 import**做一层展开；P2-01 不得把验证改成只读脱离产品入口的归档副本。

人话：CSS 有些地方不是“刷墙颜色”，而是程序拿来量家具高度的尺子。搬样式时如果只看画面没变，却把尺子刻度换了，时间轴照样可能坏。

### 22版管理级 Producer / Host / Consumer 交叉表（保留为解释层）

| Surface | Owner | Producer | Host | Consumer / State | 22版Issue |
|---|---|---|---|---|---|
| Tools view-mode | O04 | ProjectToolsDrawer | RightWorkspace | canvasViewportStore (state owner) | P2-01 |
| Action presets | O17 | ActionPresetPanel, PresetParameterForm | LegacyWorkspace → ProjectToolsDrawer → RightWorkspace | selection/shot/actionPreset stores | P2-18 |
| Resource host | O02 | ResourceActivityDock | EditorShell/LeftWorkspace | AssetLibrary; ShotManager; CharacterManager | P2-09 |
| Assets | O07 | AssetLibrary, AssetGrid, AssetCard, AssetDetails | ResourceActivityDock | FlaCompatibilityReviewSession is launched from AssetLibrary but keeps O19 | P2-05 |
| Shots | O09 | ShotManager, ShotList, ShotEditor, ShotCreateForm, ShotQuickActions | ResourceActivityDock | shotStore | P2-06 |
| Character workspace | O10 | CharacterManager, CharacterList, CharacterEditor, ExpressionEditor | ResourceActivityDock | ImageAssetPicker / Identity shared children | P2-08/P2-17 |
| Character identity | O11 | CharacterIdentity.tsx | Character + Dialogue hosts | DialogueSheet, DialogueInspector, DialogueBatchPaste; character surfaces | P2-07 |
| Image picker | O12 | ImageAssetPicker.tsx | CharacterEditor / ExpressionEditor | selectedAction injection belongs to host | P2-07 + P2-17 host adapters |
| Right shell | O03 | RightWorkspace, RightInspector, PortraitPropertiesSections | EditorShell | DialogueSheet; DialogueInspector; Layer controls; ProjectToolsDrawer | P2-11 |
| Properties | O16 | LayerPositionPanel, LayerTransformPanel, LayerBackgroundControl, LayerOrderControls | RightInspector | selection/layer stores | P2-12 |
| Dialogue | O13 | DialogueSheet, DialogueBatchPaste, DialogueInspector | RightWorkspace / RightInspector / Timeline | CharacterIdentity + SubtitleStyleControls shared children | P2-14/P2-15 |
| Subtitle controls | O14 | SubtitleStyleControls | DialogueInspector | SubtitleRenderer is Konva and not a DOM CSS consumer | P2-16 |
| Timeline | O15 | TimelineDock, DialogueClip, AudioClip | BottomWorkspace / EditorShell | PendingDialoguePlacement; DialogueSheet task presentation | P2-13/P2-15 |
| History | O18 | HistoryControls | CompactProjectBar/BottomWorkspace presentation | historyStore | P2-03 |
| Canvas | O08 | CanvasStage, CanvasViewport, CanvasToolbar | CanvasWorkspace / EditorShell | SubtitleRenderer is a Konva child | P2-10 |
| FLA review/terminal | O19 | CompatibilityReviewSession, StageA, StageF, StageG | AssetLibrary launch surface | render children remain O19 but separate issue | P2-19 |
| FLA render | O19 | FlaRenderWorkbench, StaticSnapshotReview, FrameSequenceReview | CompatibilityReviewSession | terminal state embedded | P2-20 |
| Project lifecycle | O05/O06 | ProjectCenterScreen, StartScreen, RecentProjectsPanel, RecoveryCandidateBanner, CompactProjectBar | EditorShell | project/recovery/session stores | P2-04 |
| Preview/debug | O20 | App, ProductPreviewOverlay, StagePreview, FlaImportDebugSurface | EditorShell | gate/debug flags | P2-21 |

---

## 5. Owner Registry（28版细粒度责任层）

| Owner | 职责 | Default Mode | Target dir | Programmatic/Test consumer |
|---|---|---|---|---|
| `base-global` | 全局基础与原生控件 | `DIRECT+COMPAT` | `src/renderer/styles/base/native-foundation` | — |
| `shell-layout` | 编辑器几何与工作区骨架 | `HOST_INTEGRATION` | `src/renderer/styles/shell/layout` | shell/BottomWorkspace.tsx reads editor-body geometry when calculating live Timeline height bounds |
| `shell-resources` | 左资源宿主与活动栏 | `HOST_INTEGRATION` | `src/renderer/styles/shell/resources` | shell/BottomWorkspace.tsx reads live resource rail computed min-height/gap as a Timeline max-height floor |
| `shell-right` | 右工作区、属性抽屉与宿主整合 | `HOST_INTEGRATION` | `src/renderer/styles/shell/right-workspace` | shell/BottomWorkspace.tsx reads the inspector rail handle computed min-height/height as a Timeline max-height floor |
| `shell-tools` | 工具页及动作预设宿主 | `HOST_INTEGRATION` | `src/renderer/styles/shell/tools` | stores/canvasViewportStore.ts and action-preset state are behavior owners; CSS relocation must not modify them |
| `shell-quick-actions` | 顶部快捷抽屉与旧紧凑栏适配 | `HOST_INTEGRATION` | `src/renderer/styles/shell/quick-actions` | — |
| `project-entry` | 项目入口、最近项目与开关项目对话框 | `DIRECT+HOST_INTEGRATION` | `src/renderer/styles/shell/project-entry` | — |
| `project-recovery` | 项目恢复内容与状态展示 | `DIRECT+HOST_INTEGRATION` | `src/renderer/styles/features/recovery` | — |
| `assets` | 素材导入、库与详情 | `DIRECT` | `src/renderer/styles/features/assets` | — |
| `shots` | 镜头列表、创建、详情与缩略图 | `DIRECT` | `src/renderer/styles/features/shots` | — |
| `characters-workspace` | 角色基础、列表、身份与导航 | `DIRECT` | `src/renderer/styles/features/characters/workspace` | — |
| `characters-expression` | 表情编辑器与卡内编辑 | `DIRECT+HOST_INTEGRATION` | `src/renderer/styles/features/characters/expression` | — |
| `characters-settings` | 角色设置及其表情/选择器整合 | `DIRECT+HOST_INTEGRATION` | `src/renderer/styles/features/characters/settings` | — |
| `character-identity` | 共享角色身份组件 | `DIRECT` | `src/renderer/styles/features/characters/identity` | — |
| `image-picker` | 共享图片选择器 | `DIRECT` | `src/renderer/styles/features/characters/image-picker` | — |
| `dialogue-identity-host` | 字幕和属性中的身份宿主适配 | `HOST_INTEGRATION` | `src/renderer/styles/features/dialogue/identity-adapters` | — |
| `dialogue-workspace` | 台词任务、待安排和单条创建 | `DIRECT+HOST_INTEGRATION` | `src/renderer/styles/features/dialogue/workspace` | — |
| `dialogue-batch` | 批量台词识别与提交 | `DIRECT` | `src/renderer/styles/features/dialogue/batch` | — |
| `dialogue-properties` | 台词属性与绑定音频时长 | `DIRECT+HOST_INTEGRATION` | `src/renderer/styles/features/dialogue/properties` | — |
| `subtitle-style` | 字幕样式控件 | `DIRECT+HOST_INTEGRATION` | `src/renderer/styles/features/subtitles/controls` | — |
| `layer-properties` | 图层位置、变换、外观与层序 | `DIRECT` | `src/renderer/styles/features/properties` | — |
| `canvas` | 画布内部视口与交互几何 | `DIRECT` | `src/renderer/styles/features/canvas` | stores/canvasViewportStore.ts owns fit/actual-size state used by the canvas/tools surface |
| `product-preview` | 产品预览浮层 | `DIRECT` | `src/renderer/styles/shell/product-preview` | — |
| `timeline` | 时间轴、字幕/音频片段与放置反馈 | `DIRECT` | `src/renderer/styles/features/timeline` | features/timeline/timelineUiStore.ts owns expanded/height state used by BottomWorkspace and TimelineDock<br>shell/BottomWorkspace.tsx provides JS↔CSS geometry contract for Timeline resize |
| `shell-timeline` | 时间轴拉伸外边界 | `HOST_INTEGRATION` | `src/renderer/styles/shell/timeline-boundary` | shell/BottomWorkspace.tsx injects --timeline-expanded-height/min/max-height and reads live geometry |
| `history` | 撤销重做基础及旧底部宿主 | `DIRECT+HOST_INTEGRATION` | `src/renderer/styles/features/editor/history` | — |
| `fla-review` | FLA 审查入口、门户与检查页 | `DIRECT` | `src/renderer/styles/features/fla-import/review` | — |
| `fla-raster` | FLA 位图选择与浏览器 | `DIRECT` | `src/renderer/styles/features/fla-import/raster` | — |
| `fla-status` | FLA 终态与问题分级 | `DIRECT` | `src/renderer/styles/features/fla-import/status` | — |
| `fla-render` | FLA 渲染工作台与静态快照 | `DIRECT` | `src/renderer/styles/features/fla-import/render` | — |
| `fla-sequence` | FLA 帧序列审查 | `DIRECT` | `src/renderer/styles/features/fla-import/sequence` | — |
| `debug-preview` | 调试、验收预览与导出探针 | `DIRECT+COMPAT` | `src/renderer/styles/compat/debug-preview` | App / gate/debug flags can conditionally mount probe surfaces; normal navigation absence is not dead-code proof |
| `legacy-task` | 旧/备用台词任务表面保留 | `ORDERED_COMPAT` | `src/renderer/styles/compat/retained-task-surfaces` | — |
| `mixed` | 跨领域条件整块保留 | `ORDERED_COMPAT` | `src/renderer/styles/compat/mixed-conditions` | — |
| `thumbnail-status` | 共享缩略图状态图标 | `DIRECT` | `src/renderer/styles/features/characters/thumbnail-status` | — |

---

## 6. Compatibility Ledger v1.1

| ID | 问题 | 当前处置 | 解除条件 |
|---|---|---|---|
| **H01** S13 mixed 900px outer block | FLA render + Dialogue Properties + AudioClip trim/error + unlink rules share one `@media(max-width:900px)` | ORDERED_COMPAT whole block | Only split after proving equivalent outer-condition reconstruction and ordering. |
| **H02** Shell-feature integration selectors | Resource/Right/Timeline host selectors constrain child controls. | Assign one host owner; record affected feature; do not copy bases. | Producer + host + declaration role all confirmed. |
| **H03** Shared comma selector lists | S01/S05 include Assets/Shots/Characters in one declaration list. | Keep declaration intact initially. | Split only with equivalence proof. |
| **H04** Base→host→later override chains | CharacterIdentity/ImagePicker/Character/Dialogue have explicit later overrides. | Keep each segment in original order, even if same target directory. | Production expanded order equality. |
| **H05** Debug/history reachability | App still statically produces debug/gate/probe surfaces. | Keep; mark runtime reachability separately. | Existing gate/test evidence or explicit removal issue in Phase4. |
| **H06** Phase1 reader/verifier path binding | Reader: consecutive simple imports, one-level expansion; verifier knows 16 old paths/ranges. | P2-01 minimal continuation; never weaken old assertions. | New segment map verifies production entry. |
| **H07** Variables/resources/keyframes/JS constants | `--asset-library-*`, `--character-*`, FLA keyframes, launcher image URL, Timeline JS/CSS max-height contract. | Migrate dependencies with section or preserve reference order. | Definition-before-use / resource target / JS-CSS contract proof. |
| **H08** Residual / dynamic consumers | Static code can miss dynamically composed class strings or gated paths. | Do not call dead code from static absence alone. | Runtime/targeted test evidence, normally Phase4 for deletion. |
| **H09** Window + mode + container condition cross | 1100/1050/900/820/720/700/701/620/480/420 etc plus landscape/portrait/cloud-touch + container/shallow-height. | Preserve exact outer condition and original nesting. | Targeted viewport/presentation checks when section touched. |
| **H10** Programmatic geometry consumers | BottomWorkspace reads computed geometry from Resource rail, Right Inspector handle and editor-body, and injects Timeline CSS custom properties. | Treat affected CSS as behavior-adjacent; add cross-review edges among P2-15/P2-16/P2-17/P2-18 and preserve measured min-height/gap/height semantics. | Targeted resize/geometry acceptance demonstrates the same live bounds after relocation. |
| **H11** Current Timeline surface vs retained legacy task surfaces | Current TimelineDock mounts toolbar/ruler/tracks/playhead/clips/pending placement; retained old task/tray selectors are not assumed to be the current product surface. | Route legacy-task Sections to P2-27 ORDERED_COMPAT; preserve source/order without reviving or deleting the old surface. | A separate Phase 4 reachability/removal task proves all relevant runtime/test presentations. |
| **H12** 147 Segments are a preservation model, not a file-count mandate | The 28-ticket map derives 147 contiguous same-owner/same-ticket segments from the 179-section order. | Create only files required by the active Issue; merge adjacent segments only when exact order/condition equivalence is proven. | Any physical-file consolidation preserves production traversal and section expansion exactly. |

### 这里最不能踩的三条

1. **S13 mixed 900px 外层块不能首轮拆。** FLA / Dialogue / Audio 在同一 at-rule 下时，外壳就是边界的一部分。
2. **Legacy Task 不等于“死代码”。** 当前 TimelineDock 不挂旧 Task Tray，只能得出“当前产品表面不是它”，不能直接得出“所有测试/备用 presentation 永不使用”。
3. **147 Segment ≠ 147 个必须创建的 CSS 文件。** Segment 是保序模型；每个 Issue 只创建当批需要的物理文件。

---

## 7. 关键 Cascade / Coverage 链

### 时间轴容器和最终几何

`S01-12 → S07-07 → S08-04 → S09-03 → S11-08 → S11-09 → S12-04 → S12-08 → S13-03`

横/竖条件不是同一分支。S12提供容器定义，S13继续覆盖横屏几何；不能随旧Tray一起删除。

### 音频选中和裁剪把手

`S01-12 → S13-05 → S14-04 → S14-09`

900px内旧定义和外部最终定义各保留；选中溢出、把手位置/触达大小、拖动状态属于同一验收。

### 字幕属性横竖及秒输入

`S06-11 → S08-02 → S09-02 → S12-06 → S12-07 → S13-05 → S14-03 → S14-07 → S14-12 → S14-13`

覆盖链含宿主 :has、media900与later高优先级选择器；不存在一条全局“后写就赢”捷径。

### 单条sticky与批量非sticky页脚

`S02-04 → S14-02 → S14-06 → S15-10 → S15-13 → S15-16`

单条/批量不是统一页脚；广域单条规则与后面的批量例外要同时保留。

### 角色工作区反复合并与修正

`S10-02 → S15-19 → S15-20 → S15-22 → S16-01 → S16-02 → S16-04 → S16-05 → S16-06`

Issue编号不单调。#528编辑卡原列、#527缩放翻转均分与嘴部整行是后补效果。

### 角色身份及字幕宿主

`S15-01 → S15-03 → S15-04 → S15-05 → S15-06 → S15-07 → S15-12 → S15-14`

42/38/36/34px各有匹配范围；34px !important不能因后有通用尺寸就删。

### 普通与inline图片选择器

`S14-14 → S14-15 → S16-01 → S16-04 → S16-05 → S16-06 → S16-07`

内置更换和注入清除的DOM owner不同；尾部泛用inline与表情宿主交织，作为整合段。

### 字幕样式容器

`S15-18 → S15-21`

container-type:inline-size 与后续300px容器查询配对；420px是窗口media，不能互换。

### 镜头完整分布

`S05-03 → S05-05 → S07-13 → S08-07 → S09-05 → S09-06 → S15-17`

ready缩略图去边框晚于列表/占位基础；窄屏/详情/创建均为使用面。

### 素材库与宿主

`S01-18 → S05-01 → S07-02 → S07-04 → S07-14 → S09-07 → S09-08`

同一素材组件被左右布局状态约束；库内部和资源头部owner不同。

### 快捷抽屉和外壳

`S01-05 → S08-06 → S10-04 → S14-10 → S14-11`

历史紧凑栏与当前quick drawer不等价；keyframes/reduced-motion及恢复浮层z-index同时核对。

### 全局基础

`S01-01 → S04-04 → S05-12 → S06-06 → S06-07`

tokens/primitives在前，native button在后；基础与功能覆盖次序也不能为了整理主题而改变。

### 项目入口修正顺序

`S01-03 → S01-16 → S01-17 → S03-06 → S04-01 → S05-09 → S06-08 → S06-10 → S10-07`

共享recovery类不是恢复功能独占；#412→#410为源码事实，保持。

### FLA审查、位图和终态

`S01-19 → S02-01 → S02-02 → S03-01 → S03-02 → S03-03 → S03-04`

审查门户/检查页/位图与终态共享祖先，不能按fla前缀归一大块后重排。

### FLA渲染与序列

`S03-05 → S04-02 → S04-03 → S04-05 → S13-04 → S13-05`

序列规则在部分静态快照基础之前；最终render媒体块含别的功能，仍留同一条件。

### 图层内部与属性宿主

`S06-02 → S06-04 → S07-10 → S08-01 → S08-03 → S08-12 → S08-13 → S08-14 → S11-05 → S11-06 → S11-07`

普通、compact、portrait、landscape、背景/锁定保护并存；多目标组合声明整条迁移。

### 旧任务体与当前容器的分界

`S11-10 → S12-01 → S12-02 → S12-03 → S12-04 → S12-05 → S12-08 → S13-01 → S13-02`

旧任务体目前无当前TimelineDock挂载；容器和部分drop surface却仍影响当前轨道，不按旧注释整批删。

---

## 8. S01–S16｜179 Section 完整有序台账

**协议：** Section 使用半开区间 `[start_anchor, next_start)`；同片最后一段到 EOF。锚点只匹配顶层 CSS 节点。物理行号会漂移，正式施工仍以 pinned blob + anchor + order + condition 为主键。

### S01｜`src/renderer/styles/legacy-slices/01-shell-import-review-base.css`

- Phase 1 原文范围：L3–L1951；当前片 1949 行
- Git blob：`9d7e9d39c97a610afd0877bbff60b4b5071f766c`
- 本地 SHA/边界已验证：YES

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 1 | `S01-01` | `base-global` | P2-26 | `DIRECT+COMPAT` | `BOF` | `S01-02` | `G001` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 2 | `S01-02` | `shell-layout` | P2-18 | `HOST_INTEGRATION` | `.app-shell` | `S01-03` | `G002` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 3 | `S01-03` | `project-entry` | P2-20 | `DIRECT+HOST_INTEGRATION` | `.project-center-screen` | `S01-04` | `G003` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 4 | `S01-04` | `shell-layout` | P2-18 | `HOST_INTEGRATION` | `.editor-layout` | `S01-05` | `G004` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 5 | `S01-05` | `shell-quick-actions` | P2-19 | `HOST_INTEGRATION` | `.compact-project-bar` | `S01-06` | `G005` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 6 | `S01-06` | `shell-layout` | P2-18 | `HOST_INTEGRATION` | `.editor-layout > .recovery-panel` | `S01-07` | `G006` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 7 | `S01-07` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `.right-inspector` | `S01-08` | `G007` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 8 | `S01-08` | `shell-resources` | P2-16 | `HOST_INTEGRATION` | `.left-workspace` | `S01-09` | `G008` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 9 | `S01-09` | `shell-tools` | P2-21 | `HOST_INTEGRATION` | `.legacy-compatibility-activity` | `S01-10` | `G009` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 10 | `S01-10` | `shell-layout` | P2-18 | `HOST_INTEGRATION` | `Issue #436 LM-004: visually flatten` | `S01-11` | `G010` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 11 | `S01-11` | `shell-tools` | P2-21 | `HOST_INTEGRATION` | `.legacy-workspace` | `S01-12` | `G011` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 12 | `S01-12` | `timeline` | P2-15 | `DIRECT` | `.bottom-workspace` | `S01-13` | `G012` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 13 | `S01-13` | `history` | P2-19 | `DIRECT+HOST_INTEGRATION` | `.bottom-workspace > .history-controls` | `S01-14` | `G013` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 14 | `S01-14` | `debug-preview` | P2-25 | `DIRECT+COMPAT` | `.gate-preview-overlay, .debug-probe-surface` | `S01-15` | `G014` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 15 | `S01-15` | `debug-preview` | P2-25 | `DIRECT+COMPAT` | `.export-probe` | `S01-16` | `G014` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 16 | `S01-16` | `project-recovery` | P2-20 | `DIRECT+HOST_INTEGRATION` | `.recovery-panel` | `S01-17` | `G015` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 17 | `S01-17` | `project-entry` | P2-20 | `DIRECT+HOST_INTEGRATION` | `.recent-projects-panel` | `S01-18` | `G016` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 18 | `S01-18` | `assets` | P2-06 | `DIRECT` | `.asset-import-panel` | `S01-19` | `G017` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 19 | `S01-19` | `fla-review` | P2-22 | `DIRECT` | `.fla-review-session` | `EOF` | `G018` | `B2_LOCAL_BOUNDARY_VERIFIED` |

### S02｜`src/renderer/styles/legacy-slices/02-review-workbench-dialogue.css`

- Phase 1 原文范围：L1952–L3916；当前片 1965 行
- Git blob：`ef1b2d04f2ebae95e502ef4e679935021111354a`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 20 | `S02-01` | `fla-review` | P2-22 | `DIRECT` | `BOF` | `S02-02` | `G018` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 21 | `S02-02` | `fla-raster` | P2-22 | `DIRECT` | `Issue #390:` | `S02-03` | `G019` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 22 | `S02-03` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `Issue #426 R1:` | `S02-04` | `G020` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 23 | `S02-04` | `dialogue-workspace` | P2-08 | `DIRECT+HOST_INTEGRATION` | `Issue #428 R2:` | `S02-05` | `G021` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 24 | `S02-05` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `@media (max-width: 1050px)` | `EOF` | `G022` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S03｜`src/renderer/styles/legacy-slices/03-terminal-launcher-sequence.css`

- Phase 1 原文范围：L3917–L6019；当前片 2103 行
- Git blob：`d5a21a3b73c3d79931660c3fc6e05e7f75f4d4f0`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 25 | `S03-01` | `fla-status` | P2-22 | `DIRECT` | `BOF` | `S03-02` | `G023` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 26 | `S03-02` | `fla-review` | P2-22 | `DIRECT` | `Issue #407:` | `S03-03` | `G024` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 27 | `S03-03` | `fla-raster` | P2-22 | `DIRECT` | `.fla-raster-selection-header` | `S03-04` | `G025` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 28 | `S03-04` | `fla-status` | P2-22 | `DIRECT` | `Issue #402 / #403 Problem 1:` | `S03-05` | `G026` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 29 | `S03-05` | `fla-render` | P2-23 | `DIRECT` | `Issue #397:` | `S03-06` | `G027` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 30 | `S03-06` | `project-entry` | P2-20 | `DIRECT+HOST_INTEGRATION` | `Issue #412` | `EOF` | `G028` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S04｜`src/renderer/styles/legacy-slices/04-launcher-render-workbench.css`

- Phase 1 原文范围：L6020–L8038；当前片 2019 行
- Git blob：`3217d3f17e01d8f6b8aeb0767e081b25d1d251a3`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 31 | `S04-01` | `project-entry` | P2-20 | `DIRECT+HOST_INTEGRATION` | `BOF` | `S04-02` | `G028` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 32 | `S04-02` | `fla-sequence` | P2-24 | `DIRECT` | `Issue #399:` | `S04-03` | `G029` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 33 | `S04-03` | `fla-render` | P2-23 | `DIRECT` | `Issue #396:` | `S04-04` | `G030` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 34 | `S04-04` | `base-global` | P2-26 | `DIRECT+COMPAT` | `.sr-only` | `S04-05` | `G031` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 35 | `S04-05` | `fla-render` | P2-23 | `DIRECT` | `@media (max-width: 1080px)` | `EOF` | `G032` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S05｜`src/renderer/styles/legacy-slices/05-asset-library-stage-sequence.css`

- Phase 1 原文范围：L8039–L9839；当前片 1801 行
- Git blob：`3b0acf0b8d49e6685fed258279f9ef5ece90a432`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 36 | `S05-01` | `assets` | P2-06 | `DIRECT` | `BOF` | `S05-02` | `G033` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 37 | `S05-02` | `characters-workspace` | P2-04 | `DIRECT` | `.character-manager` | `S05-03` | `G034` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 38 | `S05-03` | `shots` | P2-07 | `DIRECT` | `.shot-manager` | `S05-04` | `G035` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 39 | `S05-04` | `shell-resources` | P2-16 | `HOST_INTEGRATION` | `.resource-activity-panel .shot-workspace, .resource-activity-panel .character-workspace` | `S05-05` | `G036` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 40 | `S05-05` | `shots` | P2-07 | `DIRECT` | `.shot-create-view` | `S05-06` | `G037` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 41 | `S05-06` | `characters-workspace` | P2-04 | `DIRECT` | `.resource-activity-panel .character-workspace` | `S05-07` | `G038` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 42 | `S05-07` | `characters-workspace` | P2-04 | `DIRECT` | `.character-name-edit-row` | `S05-08` | `G038` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 43 | `S05-08` | `characters-workspace` | P2-04 | `DIRECT` | `.resource-activity-panel .expression-list li` | `S05-09` | `G038` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 44 | `S05-09` | `project-entry` | P2-20 | `DIRECT+HOST_INTEGRATION` | `.recent-projects-heading, .recent-projects-list li, .recent-projects-actions` | `S05-10` | `G039` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 45 | `S05-10` | `project-recovery` | P2-20 | `DIRECT+HOST_INTEGRATION` | `.recovery-heading-row, .recovery-open-row, .recovery-status-row, .recovery-prompt-content, .recovery-prompt-actions` | `S05-11` | `G040` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 46 | `S05-11` | `debug-preview` | P2-25 | `DIRECT+COMPAT` | `.preview-panel` | `S05-12` | `G041` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 47 | `S05-12` | `base-global` | P2-26 | `DIRECT+COMPAT` | `.eyebrow` | `S05-13` | `G042` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 48 | `S05-13` | `debug-preview` | P2-25 | `DIRECT+COMPAT` | `.day-badge` | `EOF` | `G043` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S06｜`src/renderer/styles/legacy-slices/06-canvas-portrait-foundation.css`

- Phase 1 原文范围：L9840–L11883；当前片 2044 行
- Git blob：`ed97a6f5b421d0fd2dfc68bd337d36734dfccb0c`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 49 | `S06-01` | `canvas` | P2-13 | `DIRECT` | `BOF` | `S06-02` | `G044` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 50 | `S06-02` | `layer-properties` | P2-12 | `DIRECT` | `.layer-position-panel` | `S06-03` | `G045` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 51 | `S06-03` | `history` | P2-19 | `DIRECT+HOST_INTEGRATION` | `.history-controls` | `S06-04` | `G046` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 52 | `S06-04` | `layer-properties` | P2-12 | `DIRECT` | `.layer-transform-panel h3, .layer-transform-panel p, .layer-order-controls h3, .layer-order-controls p` | `S06-05` | `G047` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 53 | `S06-05` | `debug-preview` | P2-25 | `DIRECT+COMPAT` | `.transport-bar` | `S06-06` | `G048` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 54 | `S06-06` | `mixed` | P2-27 | `ORDERED_COMPAT` | `@media (max-width: 1100px)` | `S06-07` | `G049` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 55 | `S06-07` | `mixed` | P2-27 | `ORDERED_COMPAT` | `@media (max-width: 720px)` | `S06-08` | `G049` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 56 | `S06-08` | `project-entry` | P2-20 | `DIRECT+HOST_INTEGRATION` | `.new-project-button` | `S06-09` | `G050` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 57 | `S06-09` | `product-preview` | P2-14 | `DIRECT` | `Stage 1B` | `S06-10` | `G051` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 58 | `S06-10` | `project-entry` | P2-20 | `DIRECT+HOST_INTEGRATION` | `.close-project-button` | `S06-11` | `G052` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 59 | `S06-11` | `dialogue-workspace` | P2-08 | `DIRECT+HOST_INTEGRATION` | `Day 27` | `S06-12` | `G053` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 60 | `S06-12` | `shell-layout` | P2-18 | `HOST_INTEGRATION` | `UI-M2 adaptive shell.` | `S06-13` | `G054` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 61 | `S06-13` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `Issue #371:` | `S06-14` | `G055` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 62 | `S06-14` | `shell-layout` | P2-18 | `HOST_INTEGRATION` | `.editor-layout[data-shell-mode='portrait']` | `S06-15` | `G056` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 63 | `S06-15` | `shell-layout` | P2-18 | `HOST_INTEGRATION` | `Issue #327:` | `S06-16` | `G056` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 64 | `S06-16` | `shell-resources` | P2-16 | `HOST_INTEGRATION` | `The dock already owns the concise` | `EOF` | `G057` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S07｜`src/renderer/styles/legacy-slices/07-portrait-assets-inspector-start.css`

- Phase 1 原文范围：L11884–L13801；当前片 1918 行
- Git blob：`1fa93bd66efe97283e14834e74cd17ea1a6a9b73`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 65 | `S07-01` | `shell-resources` | P2-16 | `HOST_INTEGRATION` | `BOF` | `S07-02` | `G057` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 66 | `S07-02` | `assets` | P2-06 | `DIRECT` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .resource-activity-dock[data-active-activity='assets'] .asset-library` | `S07-03` | `G058` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 67 | `S07-03` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `Issue #329:` | `S07-04` | `G059` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 68 | `S07-04` | `shell-resources` | P2-16 | `HOST_INTEGRATION` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .resource-activity-dock[data-active-activity='assets'] .resource-activity-heading h2` | `S07-05` | `G060` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 69 | `S07-05` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .right-inspector-drawer` | `S07-06` | `G061` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 70 | `S07-06` | `shell-layout` | P2-18 | `HOST_INTEGRATION` | `Issue #330:` | `S07-07` | `G062` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 71 | `S07-07` | `timeline` | P2-15 | `DIRECT` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .editor-layout[data-active-workspace='timeline'] > .bottom-workspace[data-presentation='portrait'] .timeline-dock` | `S07-08` | `G063` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 72 | `S07-08` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .editor-layout[data-active-workspace='timeline'] .dialogue-sheet-timeline` | `S07-09` | `G064` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 73 | `S07-09` | `history` | P2-19 | `DIRECT+HOST_INTEGRATION` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .editor-layout[data-active-workspace='timeline'] > .bottom-workspace[data-presentation='portrait'] > .history-controls` | `S07-10` | `G065` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 74 | `S07-10` | `layer-properties` | P2-12 | `DIRECT` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .right-inspector-section .layer-transform-panel form` | `S07-11` | `G066` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 75 | `S07-11` | `canvas` | P2-13 | `DIRECT` | `Keep the Timeline's Canvas context visible` | `S07-12` | `G067` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 76 | `S07-12` | `shell-resources` | P2-16 | `HOST_INTEGRATION` | `Issue #331:` | `S07-13` | `G068` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 77 | `S07-13` | `shots` | P2-07 | `DIRECT` | `Shot drawer: keep the existing` | `S07-14` | `G069` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 78 | `S07-14` | `assets` | P2-06 | `DIRECT` | `Assets drawer: use the existing` | `S07-15` | `G070` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 79 | `S07-15` | `characters-workspace` | P2-04 | `DIRECT` | `Characters drawer: the existing` | `S07-16` | `G071` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 80 | `S07-16` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `Issue #332:` | `EOF` | `G072` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S08｜`src/renderer/styles/legacy-slices/08-inspector-portrait-dialogue.css`

- Phase 1 原文范围：L13802–L17819；当前片 4018 行
- Git blob：`eea0e2b9c11a2d51837257f88349a395865fbc84`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 81 | `S08-01` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `BOF` | `S08-02` | `G072` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 82 | `S08-02` | `dialogue-properties` | P2-10 | `DIRECT+HOST_INTEGRATION` | `.editor-layout[data-shell-mode='landscape'] .right-inspector-drawer .dialogue-inspector-context-summary` | `S08-03` | `G073` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 83 | `S08-03` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `Issue #338:` | `S08-04` | `G074` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 84 | `S08-04` | `timeline` | P2-15 | `DIRECT` | `Issue #339:` | `S08-05` | `G075` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 85 | `S08-05` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .editor-layout[data-active-workspace='timeline'] .dialogue-sheet-timeline` | `S08-06` | `G076` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 86 | `S08-06` | `shell-quick-actions` | P2-19 | `HOST_INTEGRATION` | `Issue #340:` | `S08-07` | `G077` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 87 | `S08-07` | `shots` | P2-07 | `DIRECT` | `Issue #341:` | `S08-08` | `G078` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 88 | `S08-08` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `Issue #346:` | `S08-09` | `G079` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 89 | `S08-09` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `Issue #357:` | `S08-10` | `G080` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 90 | `S08-10` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `Issue #354:` | `S08-11` | `G080` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 91 | `S08-11` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `Issue #352:` | `S08-12` | `G080` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 92 | `S08-12` | `layer-properties` | P2-12 | `DIRECT` | `Issue #348:` | `S08-13` | `G081` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 93 | `S08-13` | `layer-properties` | P2-12 | `DIRECT` | `Issue #347:` | `S08-14` | `G081` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 94 | `S08-14` | `layer-properties` | P2-12 | `DIRECT` | `Issue #349:` | `S08-15` | `G081` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 95 | `S08-15` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `Issue #351:` | `EOF` | `G082` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S09｜`src/renderer/styles/legacy-slices/09-portrait-timed-landscape-assets.css`

- Phase 1 原文范围：L17820–L19783；当前片 1964 行
- Git blob：`8dcd3d48de155e1ccd4165ef1af135ec4f772307`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 96 | `S09-01` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `BOF` | `S09-02` | `G082` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 97 | `S09-02` | `dialogue-properties` | P2-10 | `DIRECT+HOST_INTEGRATION` | `Issue #358:` | `S09-03` | `G083` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 98 | `S09-03` | `timeline` | P2-15 | `DIRECT` | `Issue #359:` | `S09-04` | `G084` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 99 | `S09-04` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .editor-layout[data-active-workspace='timeline'] .dialogue-secondary-action, .editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .editor-layout[data-active-workspace='timeline'] .dialogue-authoring-open` | `S09-05` | `G085` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 100 | `S09-05` | `shots` | P2-07 | `DIRECT` | `Issue #360:` | `S09-06` | `G086` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 101 | `S09-06` | `shots` | P2-07 | `DIRECT` | `Issue #362:` | `S09-07` | `G086` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 102 | `S09-07` | `shell-resources` | P2-16 | `HOST_INTEGRATION` | `Issue #363:` | `S09-08` | `G087` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 103 | `S09-08` | `assets` | P2-06 | `DIRECT` | `.editor-layout[data-shell-mode='landscape'] .resource-activity-dock-landscape[data-active-activity='assets'] .asset-library[data-asset-library-presentation='landscape']` | `EOF` | `G088` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S10｜`src/renderer/styles/legacy-slices/10-landscape-characters-tools-start.css`

- Phase 1 原文范围：L19784–L21802；当前片 2019 行
- Git blob：`a1776f28e9325e121de67e7862ff09b58020ec00`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 104 | `S10-01` | `shell-resources` | P2-16 | `HOST_INTEGRATION` | `BOF` | `S10-02` | `G089` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 105 | `S10-02` | `characters-workspace` | P2-04 | `DIRECT` | `.editor-layout[data-shell-mode='landscape'] .resource-activity-dock-landscape[data-active-activity='characters'] .character-manager[data-character-presentation='landscape']` | `S10-03` | `G090` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 106 | `S10-03` | `characters-expression` | P2-05 | `DIRECT+HOST_INTEGRATION` | `Issue #366:` | `S10-04` | `G091` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 107 | `S10-04` | `shell-quick-actions` | P2-19 | `HOST_INTEGRATION` | `Issue #368:` | `S10-05` | `G092` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 108 | `S10-05` | `shell-resources` | P2-16 | `HOST_INTEGRATION` | `.editor-shell[data-editor-shell-layout='landscape'] .editor-layout[data-shell-mode='landscape'] .resource-activity-dock-landscape .resource-activity-rail > button` | `S10-06` | `G093` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 109 | `S10-06` | `shell-tools` | P2-21 | `HOST_INTEGRATION` | `.project-tools-drawer` | `S10-07` | `G094` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 110 | `S10-07` | `project-entry` | P2-20 | `DIRECT+HOST_INTEGRATION` | `.recent-project-maintenance-menu` | `S10-08` | `G095` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 111 | `S10-08` | `shell-tools` | P2-21 | `HOST_INTEGRATION` | `.project-tools-action-preset-card` | `EOF` | `G096` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S11｜`src/renderer/styles/legacy-slices/11-tools-inspector-timeline-start.css`

- Phase 1 原文范围：L21803–L23799；当前片 1997 行
- Git blob：`acf90acc825c7ffe2ffcdadc56451ad62083b9d3`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 112 | `S11-01` | `shell-tools` | P2-01 | `DIRECT+VERIFICATION` | `BOF` | `S11-02` | `G097` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 113 | `S11-02` | `shell-tools` | P2-21 | `HOST_INTEGRATION` | `.project-tools-action-presets-view` | `S11-03` | `G098` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 114 | `S11-03` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `Issue #372:` | `S11-04` | `G099` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 115 | `S11-04` | `shell-right` | P2-17 | `HOST_INTEGRATION` | `Issue #373:` | `S11-05` | `G099` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 116 | `S11-05` | `layer-properties` | P2-12 | `DIRECT` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape'] .right-inspector-drawer .right-inspector-section > .layer-transform-panel[data-compact='true']` | `S11-06` | `G100` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 117 | `S11-06` | `layer-properties` | P2-12 | `DIRECT` | `Issue #374:` | `S11-07` | `G100` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 118 | `S11-07` | `layer-properties` | P2-12 | `DIRECT` | `Issue #376:` | `S11-08` | `G100` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 119 | `S11-08` | `shell-timeline` | P2-15 | `HOST_INTEGRATION` | `Issue #378:` | `S11-09` | `G101` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 120 | `S11-09` | `timeline` | P2-15 | `DIRECT` | `Issue #379:` | `S11-10` | `G102` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 121 | `S11-10` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape'] .bottom-workspace[data-resizable='true'] .timeline-task-tray` | `EOF` | `G103` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S12｜`src/renderer/styles/legacy-slices/12-landscape-task-tray.css`

- Phase 1 原文范围：L23800–L25876；当前片 2077 行
- Git blob：`7b113bca5e3c40cde2a7e001770dc511ad32bca1`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 122 | `S12-01` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `BOF` | `S12-02` | `G103` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 123 | `S12-02` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `Issue #380:` | `S12-03` | `G103` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 124 | `S12-03` | `timeline` | P2-15 | `DIRECT` | `Issue #381:` | `S12-04` | `G104` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 125 | `S12-04` | `timeline` | P2-15 | `DIRECT` | `Issue #382:` | `S12-05` | `G104` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 126 | `S12-05` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape'] .bottom-workspace[data-resizable='true'] .timeline-task-tray` | `S12-06` | `G105` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 127 | `S12-06` | `dialogue-properties` | P2-10 | `DIRECT+HOST_INTEGRATION` | `Issue #387:` | `S12-07` | `G106` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 128 | `S12-07` | `dialogue-properties` | P2-10 | `DIRECT+HOST_INTEGRATION` | `Issue #388:` | `S12-08` | `G106` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 129 | `S12-08` | `mixed` | P2-27 | `ORDERED_COMPAT` | `At the accepted Stage A shallow heights,` | `S12-09` | `G107` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 130 | `S12-09` | `timeline` | P2-15 | `DIRECT` | `.editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape'] .bottom-workspace[data-resizable='true'] .timeline-pending-drop-notice` | `EOF` | `G108` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S13｜`src/renderer/styles/legacy-slices/13-timed-render-media-tail.css`

- Phase 1 原文范围：L25877–L27997；当前片 2121 行
- Git blob：`080bcb247827a760899211fe93b33db7cd39bd7e`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 131 | `S13-01` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `BOF` | `S13-02` | `G109` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 132 | `S13-02` | `legacy-task` | P2-27 | `ORDERED_COMPAT` | `Issue #386:` | `S13-03` | `G109` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 133 | `S13-03` | `timeline` | P2-15 | `DIRECT` | `Issue #422 + #432 R3-A:` | `S13-04` | `G110` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 134 | `S13-04` | `fla-render` | P2-23 | `DIRECT` | `Issue #398 final cascade:` | `S13-05` | `G111` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 135 | `S13-05` | `mixed` | P2-27 | `ORDERED_COMPAT` | `@media (max-width: 900px)` | `EOF` | `G112` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S14｜`src/renderer/styles/legacy-slices/14-dialogue-polish-image-picker.css`

- Phase 1 原文范围：L27998–L29794；当前片 1797 行
- Git blob：`46f0564fbefa6233325982c7010dd5c20dd4f4bc`
- 本地 SHA/边界已验证：NO

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 136 | `S14-01` | `dialogue-workspace` | P2-08 | `DIRECT+HOST_INTEGRATION` | `BOF` | `S14-02` | `G113` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 137 | `S14-02` | `dialogue-batch` | P2-09 | `DIRECT` | `Issue #447:` | `S14-03` | `G114` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 138 | `S14-03` | `dialogue-properties` | P2-10 | `DIRECT+HOST_INTEGRATION` | `.dialogue-properties-identity-editor` | `S14-04` | `G115` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 139 | `S14-04` | `timeline` | P2-15 | `DIRECT` | `.timeline-audio-clip.selected` | `S14-05` | `G116` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 140 | `S14-05` | `dialogue-properties` | P2-10 | `DIRECT+HOST_INTEGRATION` | `@media (max-width: 420px)` | `S14-06` | `G117` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 141 | `S14-06` | `dialogue-batch` | P2-09 | `DIRECT` | `.editor-shell[data-editor-shell-layout='landscape'] .dialogue-sheet-right-workspace .dialogue-authoring-batch .dialogue-authoring-footer` | `S14-07` | `G118` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 142 | `S14-07` | `dialogue-properties` | P2-10 | `DIRECT+HOST_INTEGRATION` | `Issue #448 A:` | `S14-08` | `G119` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 143 | `S14-08` | `dialogue-properties` | P2-10 | `DIRECT+HOST_INTEGRATION` | `Issue #448 B:` | `S14-09` | `G119` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 144 | `S14-09` | `timeline` | P2-15 | `DIRECT` | `.timeline-audio-trim-handle` | `S14-10` | `G120` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 145 | `S14-10` | `shell-quick-actions` | P2-19 | `HOST_INTEGRATION` | `Issue #454:` | `S14-11` | `G121` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 146 | `S14-11` | `shell-layout` | P2-18 | `HOST_INTEGRATION` | `Issue #456/#486:` | `S14-12` | `G122` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 147 | `S14-12` | `dialogue-properties` | P2-10 | `DIRECT+HOST_INTEGRATION` | `Issue #463:` | `S14-13` | `G123` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 148 | `S14-13` | `dialogue-properties` | P2-10 | `DIRECT+HOST_INTEGRATION` | `Issue #468:` | `S14-14` | `G123` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 149 | `S14-14` | `image-picker` | P2-02 | `DIRECT` | `Issue #492:` | `S14-15` | `G124` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |
| 150 | `S14-15` | `characters-settings` | P2-05 | `DIRECT+HOST_INTEGRATION` | `.character-mouth-state > .image-asset-picker` | `EOF` | `G125` | `B1_REMOTE_ANCHOR_REVIEWED_NEEDS_LOCAL_RESOLUTION` |

### S15｜`src/renderer/styles/legacy-slices/15-character-identity-workspace-start.css`

- Phase 1 原文范围：L29795–L31795；当前片 2001 行
- Git blob：`b78e0ccecb56336509a1eb78b0e592604c840a6c`
- 本地 SHA/边界已验证：YES

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 151 | `S15-01` | `character-identity` | P2-03 | `DIRECT` | `BOF` | `S15-02` | `G126` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 152 | `S15-02` | `characters-workspace` | P2-04 | `DIRECT` | `.character-list-items button` | `S15-03` | `G127` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 153 | `S15-03` | `dialogue-identity-host` | P2-03 | `HOST_INTEGRATION` | `.dialogue-authoring-speaker-field .character-identity-picker, .dialogue-inspector-speaker-section .character-identity-picker, .dialogue-properties-speaker-section .character-identity-picker` | `S15-04` | `G128` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 154 | `S15-04` | `character-identity` | P2-03 | `DIRECT` | `@media (max-width: 700px)` | `S15-05` | `G129` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 155 | `S15-05` | `characters-workspace` | P2-04 | `DIRECT` | `@media (min-width: 701px)` | `S15-06` | `G130` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 156 | `S15-06` | `character-identity` | P2-03 | `DIRECT` | `Issue #496:` | `S15-07` | `G131` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 157 | `S15-07` | `dialogue-workspace` | P2-08 | `DIRECT+HOST_INTEGRATION` | `The New Dialogue hierarchy` | `S15-08` | `G132` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 158 | `S15-08` | `dialogue-workspace` | P2-08 | `DIRECT+HOST_INTEGRATION` | `Issue #498:` | `S15-09` | `G132` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 159 | `S15-09` | `dialogue-workspace` | P2-08 | `DIRECT+HOST_INTEGRATION` | `Issue #500:` | `S15-10` | `G132` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 160 | `S15-10` | `dialogue-workspace` | P2-08 | `DIRECT+HOST_INTEGRATION` | `Issue #501:` | `S15-11` | `G132` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 161 | `S15-11` | `dialogue-workspace` | P2-08 | `DIRECT+HOST_INTEGRATION` | `Pending recovery:` | `S15-12` | `G132` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 162 | `S15-12` | `character-identity` | P2-03 | `DIRECT` | `@media (max-width: 520px)` | `S15-13` | `G133` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 163 | `S15-13` | `dialogue-workspace` | P2-08 | `DIRECT+HOST_INTEGRATION` | `Issue #502:` | `S15-14` | `G134` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 164 | `S15-14` | `character-identity` | P2-03 | `DIRECT` | `.character-identity-picker-summary > .character-identity-picker-chevron` | `S15-15` | `G135` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 165 | `S15-15` | `thumbnail-status` | P2-03 | `DIRECT` | `Issue #503:` | `S15-16` | `G136` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 166 | `S15-16` | `dialogue-batch` | P2-09 | `DIRECT` | `Issue #505:` | `S15-17` | `G137` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 167 | `S15-17` | `shots` | P2-07 | `DIRECT` | `Issue #508:` | `S15-18` | `G138` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 168 | `S15-18` | `subtitle-style` | P2-11 | `DIRECT+HOST_INTEGRATION` | `Issue #521:` | `S15-19` | `G139` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 169 | `S15-19` | `characters-workspace` | P2-04 | `DIRECT` | `Issue #524:` | `S15-20` | `G140` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 170 | `S15-20` | `characters-workspace` | P2-04 | `DIRECT` | `Issue #525:` | `S15-21` | `G140` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 171 | `S15-21` | `subtitle-style` | P2-11 | `DIRECT+HOST_INTEGRATION` | `@container (max-width: 300px)` | `S15-22` | `G141` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 172 | `S15-22` | `characters-workspace` | P2-04 | `DIRECT` | `Issue #523:` | `EOF` | `G142` | `B2_LOCAL_BOUNDARY_VERIFIED` |

### S16｜`src/renderer/styles/legacy-slices/16-character-settings-final-polish.css`

- Phase 1 原文范围：L31796–L32818；当前片 1023 行
- Git blob：`ac8b1e6390abe334158ce6b4c3399908ef6e664c`
- 本地 SHA/边界已验证：YES

| Ord | Section | Owner | Issue | Mode | Start anchor | End excl. | Segment | Evidence |
|---:|---|---|---|---|---|---|---|---|
| 173 | `S16-01` | `characters-settings` | P2-05 | `DIRECT+HOST_INTEGRATION` | `BOF` | `S16-02` | `G143` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 174 | `S16-02` | `characters-settings` | P2-05 | `DIRECT+HOST_INTEGRATION` | `Issue #524 cascade:` | `S16-03` | `G143` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 175 | `S16-03` | `characters-workspace` | P2-04 | `DIRECT` | `Issue #525 final responsive override:` | `S16-04` | `G144` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 176 | `S16-04` | `characters-settings` | P2-05 | `DIRECT+HOST_INTEGRATION` | `Issue #526:` | `S16-05` | `G145` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 177 | `S16-05` | `characters-settings` | P2-05 | `DIRECT+HOST_INTEGRATION` | `Issue #527:` | `S16-06` | `G145` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 178 | `S16-06` | `characters-expression` | P2-05 | `DIRECT+HOST_INTEGRATION` | `Issue #528:` | `S16-07` | `G146` | `B2_LOCAL_BOUNDARY_VERIFIED` |
| 179 | `S16-07` | `image-picker` | P2-02 | `DIRECT` | `.image-asset-picker-inline` | `EOF` | `G147` | `B2_LOCAL_BOUNDARY_VERIFIED` |

---

## 9. 147 Segment 物理模型

Segment 只把**原序中紧邻、同 owner、同 Issue**的 Section 组成建议物理单元；不要先按功能排序再合并。

| Segment | Owner | Issue | Sections | Destination |
|---|---|---|---|---|
| `G001` | `base-global` | P2-26 | S01-01 | `src/renderer/styles/base/native-foundation/s01-01--native-foundation.css` |
| `G002` | `shell-layout` | P2-18 | S01-02 | `src/renderer/styles/shell/layout/s01-02--root-frame.css` |
| `G003` | `project-entry` | P2-20 | S01-03 | `src/renderer/styles/shell/project-entry/s01-03--project-center-start.css` |
| `G004` | `shell-layout` | P2-18 | S01-04 | `src/renderer/styles/shell/layout/s01-04--editor-grid.css` |
| `G005` | `shell-quick-actions` | P2-19 | S01-05 | `src/renderer/styles/shell/quick-actions/s01-05--legacy-compact-bar.css` |
| `G006` | `shell-layout` | P2-18 | S01-06 | `src/renderer/styles/shell/layout/s01-06--recovery-host-and-body.css` |
| `G007` | `shell-right` | P2-17 | S01-07 | `src/renderer/styles/shell/right-workspace/s01-07--inspector-and-layer-host.css` |
| `G008` | `shell-resources` | P2-16 | S01-08 | `src/renderer/styles/shell/resources/s01-08--resource-host-base.css` |
| `G009` | `shell-tools` | P2-21 | S01-09 | `src/renderer/styles/shell/tools/s01-09--legacy-compatibility.css` |
| `G010` | `shell-layout` | P2-18 | S01-10 | `src/renderer/styles/shell/layout/s01-10--canvas-host.css` |
| `G011` | `shell-tools` | P2-21 | S01-11 | `src/renderer/styles/shell/tools/s01-11--legacy-workspace-placeholder.css` |
| `G012` | `timeline` | P2-15 | S01-12 | `src/renderer/styles/features/timeline/s01-12--bottom-and-track-base.css` |
| `G013` | `history` | P2-19 | S01-13 | `src/renderer/styles/features/editor/history/s01-13--bottom-history-host.css` |
| `G014` | `debug-preview` | P2-25 | S01-14, S01-15 | `src/renderer/styles/compat/debug-preview/s01-14--gate-probe-and-transport.css` |
| `G015` | `project-recovery` | P2-20 | S01-16 | `src/renderer/styles/features/recovery/s01-16--recovery-panel-base.css` |
| `G016` | `project-entry` | P2-20 | S01-17 | `src/renderer/styles/shell/project-entry/s01-17--recent-panel-base.css` |
| `G017` | `assets` | P2-06 | S01-18 | `src/renderer/styles/features/assets/s01-18--asset-import-base.css` |
| `G018` | `fla-review` | P2-22 | S01-19, S02-01 | `src/renderer/styles/features/fla-import/review/s01-19--review-base.css` |
| `G019` | `fla-raster` | P2-22 | S02-02 | `src/renderer/styles/features/fla-import/raster/s02-02--raster-workbench-and-shared-header.css` |
| `G020` | `shell-right` | P2-17 | S02-03 | `src/renderer/styles/shell/right-workspace/s02-03--right-workspace.css` |
| `G021` | `dialogue-workspace` | P2-08 | S02-04 | `src/renderer/styles/features/dialogue/workspace/s02-04--right-workspace-queue-authoring.css` |
| `G022` | `shell-right` | P2-17 | S02-05 | `src/renderer/styles/shell/right-workspace/s02-05--right-workspace-width-1050.css` |
| `G023` | `fla-status` | P2-22 | S03-01 | `src/renderer/styles/features/fla-import/status/s03-01--terminal-g.css` |
| `G024` | `fla-review` | P2-22 | S03-02 | `src/renderer/styles/features/fla-import/review/s03-02--inspection-a.css` |
| `G025` | `fla-raster` | P2-22 | S03-03 | `src/renderer/styles/features/fla-import/raster/s03-03--raster-browser-tail.css` |
| `G026` | `fla-status` | P2-22 | S03-04 | `src/renderer/styles/features/fla-import/status/s03-04--severity-f.css` |
| `G027` | `fla-render` | P2-23 | S03-05 | `src/renderer/styles/features/fla-import/render/s03-05--render-bounded-v11.css` |
| `G028` | `project-entry` | P2-20 | S03-06, S04-01 | `src/renderer/styles/shell/project-entry/s03-06--launcher-412.css` |
| `G029` | `fla-sequence` | P2-24 | S04-02 | `src/renderer/styles/features/fla-import/sequence/s04-02--sequence-e-and-scroll.css` |
| `G030` | `fla-render` | P2-23 | S04-03 | `src/renderer/styles/features/fla-import/render/s04-03--render-shell-and-snapshot-d.css` |
| `G031` | `base-global` | P2-26 | S04-04 | `src/renderer/styles/base/native-foundation/s04-04--sr-only.css` |
| `G032` | `fla-render` | P2-23 | S04-05 | `src/renderer/styles/features/fla-import/render/s04-05--render-responsive-tail.css` |
| `G033` | `assets` | P2-06 | S05-01 | `src/renderer/styles/features/assets/s05-01--asset-library-base.css` |
| `G034` | `characters-workspace` | P2-04 | S05-02 | `src/renderer/styles/features/characters/workspace/s05-02--characters-base.css` |
| `G035` | `shots` | P2-07 | S05-03 | `src/renderer/styles/features/shots/s05-03--shots-base.css` |
| `G036` | `shell-resources` | P2-16 | S05-04 | `src/renderer/styles/shell/resources/s05-04--shot-character-shared-host.css` |
| `G037` | `shots` | P2-07 | S05-05 | `src/renderer/styles/features/shots/s05-05--shot-create-host.css` |
| `G038` | `characters-workspace` | P2-04 | S05-06, S05-07, S05-08 | `src/renderer/styles/features/characters/workspace/s05-06--character-resource-host.css` |
| `G039` | `project-entry` | P2-20 | S05-09 | `src/renderer/styles/shell/project-entry/s05-09--recent-projects-base.css` |
| `G040` | `project-recovery` | P2-20 | S05-10 | `src/renderer/styles/features/recovery/s05-10--recovery-status-and-prompt.css` |
| `G041` | `debug-preview` | P2-25 | S05-11 | `src/renderer/styles/compat/debug-preview/s05-11--preview-panel.css` |
| `G042` | `base-global` | P2-26 | S05-12 | `src/renderer/styles/base/native-foundation/s05-12--eyebrow-and-h1.css` |
| `G043` | `debug-preview` | P2-25 | S05-13 | `src/renderer/styles/compat/debug-preview/s05-13--stage-preview-base.css` |
| `G044` | `canvas` | P2-13 | S06-01 | `src/renderer/styles/features/canvas/s06-01--canvas-internals.css` |
| `G045` | `layer-properties` | P2-12 | S06-02 | `src/renderer/styles/features/properties/s06-02--position-background-base.css` |
| `G046` | `history` | P2-19 | S06-03 | `src/renderer/styles/features/editor/history/s06-03--history-base.css` |
| `G047` | `layer-properties` | P2-12 | S06-04 | `src/renderer/styles/features/properties/s06-04--transform-order-base.css` |
| `G048` | `debug-preview` | P2-25 | S06-05 | `src/renderer/styles/compat/debug-preview/s06-05--transport-hidden-stage.css` |
| `G049` | `mixed` | P2-27 | S06-06, S06-07 | `src/renderer/styles/compat/mixed-conditions/s06-06--responsive-1100.css` |
| `G050` | `project-entry` | P2-20 | S06-08 | `src/renderer/styles/shell/project-entry/s06-08--new-project-dialog.css` |
| `G051` | `product-preview` | P2-14 | S06-09 | `src/renderer/styles/shell/product-preview/s06-09--product-preview.css` |
| `G052` | `project-entry` | P2-20 | S06-10 | `src/renderer/styles/shell/project-entry/s06-10--close-confirm.css` |
| `G053` | `dialogue-workspace` | P2-08 | S06-11 | `src/renderer/styles/features/dialogue/workspace/s06-11--dialogue-base.css` |
| `G054` | `shell-layout` | P2-18 | S06-12 | `src/renderer/styles/shell/layout/s06-12--adaptive-shell.css` |
| `G055` | `shell-right` | P2-17 | S06-13 | `src/renderer/styles/shell/right-workspace/s06-13--legacy-landscape-inspector-handle.css` |
| `G056` | `shell-layout` | P2-18 | S06-14, S06-15 | `src/renderer/styles/shell/layout/s06-14--portrait-layout.css` |
| `G057` | `shell-resources` | P2-16 | S06-16, S07-01 | `src/renderer/styles/shell/resources/s06-16--portrait-shot-header.css` |
| `G058` | `assets` | P2-06 | S07-02 | `src/renderer/styles/features/assets/s07-02--portrait-assets-content.css` |
| `G059` | `shell-right` | P2-17 | S07-03 | `src/renderer/styles/shell/right-workspace/s07-03--portrait-inspector-host.css` |
| `G060` | `shell-resources` | P2-16 | S07-04 | `src/renderer/styles/shell/resources/s07-04--portrait-assets-hidden-title.css` |
| `G061` | `shell-right` | P2-17 | S07-05 | `src/renderer/styles/shell/right-workspace/s07-05--portrait-inspector-drawer.css` |
| `G062` | `shell-layout` | P2-18 | S07-06 | `src/renderer/styles/shell/layout/s07-06--portrait-timeline-host.css` |
| `G063` | `timeline` | P2-15 | S07-07 | `src/renderer/styles/features/timeline/s07-07--portrait-track-internals.css` |
| `G064` | `legacy-task` | P2-27 | S07-08 | `src/renderer/styles/compat/retained-task-surfaces/s07-08--portrait-dialogue-original.css` |
| `G065` | `history` | P2-19 | S07-09 | `src/renderer/styles/features/editor/history/s07-09--portrait-bottom-history.css` |
| `G066` | `layer-properties` | P2-12 | S07-10 | `src/renderer/styles/features/properties/s07-10--portrait-layer-forms.css` |
| `G067` | `canvas` | P2-13 | S07-11 | `src/renderer/styles/features/canvas/s07-11--portrait-timeline-canvas.css` |
| `G068` | `shell-resources` | P2-16 | S07-12 | `src/renderer/styles/shell/resources/s07-12--landscape-resource-rail.css` |
| `G069` | `shots` | P2-07 | S07-13 | `src/renderer/styles/features/shots/s07-13--landscape-shots-original.css` |
| `G070` | `assets` | P2-06 | S07-14 | `src/renderer/styles/features/assets/s07-14--landscape-assets-original.css` |
| `G071` | `characters-workspace` | P2-04 | S07-15 | `src/renderer/styles/features/characters/workspace/s07-15--landscape-characters-original.css` |
| `G072` | `shell-right` | P2-17 | S07-16, S08-01 | `src/renderer/styles/shell/right-workspace/s07-16--landscape-inspector-host.css` |
| `G073` | `dialogue-properties` | P2-10 | S08-02 | `src/renderer/styles/features/dialogue/properties/s08-02--landscape-inspector-original.css` |
| `G074` | `shell-right` | P2-17 | S08-03 | `src/renderer/styles/shell/right-workspace/s08-03--portrait-properties-flatten.css` |
| `G075` | `timeline` | P2-15 | S08-04 | `src/renderer/styles/features/timeline/s08-04--portrait-track-polish.css` |
| `G076` | `legacy-task` | P2-27 | S08-05 | `src/renderer/styles/compat/retained-task-surfaces/s08-05--portrait-dialogue-flat.css` |
| `G077` | `shell-quick-actions` | P2-19 | S08-06 | `src/renderer/styles/shell/quick-actions/s08-06--portrait-compact-history.css` |
| `G078` | `shots` | P2-07 | S08-07 | `src/renderer/styles/features/shots/s08-07--portrait-shot-detail.css` |
| `G079` | `shell-right` | P2-17 | S08-08 | `src/renderer/styles/shell/right-workspace/s08-08--portrait-empty-properties.css` |
| `G080` | `legacy-task` | P2-27 | S08-09, S08-10, S08-11 | `src/renderer/styles/compat/retained-task-surfaces/s08-09--portrait-authoring.css` |
| `G081` | `layer-properties` | P2-12 | S08-12, S08-13, S08-14 | `src/renderer/styles/features/properties/s08-12--portrait-appearance.css` |
| `G082` | `legacy-task` | P2-27 | S08-15, S09-01 | `src/renderer/styles/compat/retained-task-surfaces/s08-15--portrait-pending-base-and-final.css` |
| `G083` | `dialogue-properties` | P2-10 | S09-02 | `src/renderer/styles/features/dialogue/properties/s09-02--portrait-properties-precision.css` |
| `G084` | `timeline` | P2-15 | S09-03 | `src/renderer/styles/features/timeline/s09-03--portrait-track-icons.css` |
| `G085` | `legacy-task` | P2-27 | S09-04 | `src/renderer/styles/compat/retained-task-surfaces/s09-04--portrait-pending-polish.css` |
| `G086` | `shots` | P2-07 | S09-05, S09-06 | `src/renderer/styles/features/shots/s09-05--landscape-shot-quick-actions.css` |
| `G087` | `shell-resources` | P2-16 | S09-07 | `src/renderer/styles/shell/resources/s09-07--landscape-asset-header.css` |
| `G088` | `assets` | P2-06 | S09-08 | `src/renderer/styles/features/assets/s09-08--landscape-asset-visual.css` |
| `G089` | `shell-resources` | P2-16 | S10-01 | `src/renderer/styles/shell/resources/s10-01--character-detail-header.css` |
| `G090` | `characters-workspace` | P2-04 | S10-02 | `src/renderer/styles/features/characters/workspace/s10-02--landscape-character-workbench.css` |
| `G091` | `characters-expression` | P2-05 | S10-03 | `src/renderer/styles/features/characters/expression/s10-03--landscape-expression-workbench.css` |
| `G092` | `shell-quick-actions` | P2-19 | S10-04 | `src/renderer/styles/shell/quick-actions/s10-04--landscape-compact-history.css` |
| `G093` | `shell-resources` | P2-16 | S10-05 | `src/renderer/styles/shell/resources/s10-05--landscape-rail-polish.css` |
| `G094` | `shell-tools` | P2-21 | S10-06 | `src/renderer/styles/shell/tools/s10-06--tools-drawer.css` |
| `G095` | `project-entry` | P2-20 | S10-07 | `src/renderer/styles/shell/project-entry/s10-07--recent-maintenance.css` |
| `G096` | `shell-tools` | P2-21 | S10-08 | `src/renderer/styles/shell/tools/s10-08--tools-action-launcher.css` |
| `G097` | `shell-tools` | P2-01 | S11-01 | `src/renderer/styles/shell/tools/s11-01--view-mode-pilot.css` |
| `G098` | `shell-tools` | P2-21 | S11-02 | `src/renderer/styles/shell/tools/s11-02--action-preset-host.css` |
| `G099` | `shell-right` | P2-17 | S11-03, S11-04 | `src/renderer/styles/shell/right-workspace/s11-03--landscape-empty-properties.css` |
| `G100` | `layer-properties` | P2-12 | S11-05, S11-06, S11-07 | `src/renderer/styles/features/properties/s11-05--landscape-layer-controls.css` |
| `G101` | `shell-timeline` | P2-15 | S11-08 | `src/renderer/styles/shell/timeline-boundary/s11-08--resize-boundary.css` |
| `G102` | `timeline` | P2-15 | S11-09 | `src/renderer/styles/features/timeline/s11-09--landscape-track-foundation.css` |
| `G103` | `legacy-task` | P2-27 | S11-10, S12-01, S12-02 | `src/renderer/styles/compat/retained-task-surfaces/s11-10--landscape-tray-host-original.css` |
| `G104` | `timeline` | P2-15 | S12-03, S12-04 | `src/renderer/styles/features/timeline/s12-03--pending-placement-and-overlays.css` |
| `G105` | `legacy-task` | P2-27 | S12-05 | `src/renderer/styles/compat/retained-task-surfaces/s12-05--landscape-task-body.css` |
| `G106` | `dialogue-properties` | P2-10 | S12-06, S12-07 | `src/renderer/styles/features/dialogue/properties/s12-06--landscape-properties-quick-inspect.css` |
| `G107` | `mixed` | P2-27 | S12-08 | `src/renderer/styles/compat/mixed-conditions/s12-08--shallow-container-220.css` |
| `G108` | `timeline` | P2-15 | S12-09 | `src/renderer/styles/features/timeline/s12-09--pending-drop-notice.css` |
| `G109` | `legacy-task` | P2-27 | S13-01, S13-02 | `src/renderer/styles/compat/retained-task-surfaces/s13-01--landscape-timed-384-385.css` |
| `G110` | `timeline` | P2-15 | S13-03 | `src/renderer/styles/features/timeline/s13-03--final-resize-flex-422-432.css` |
| `G111` | `fla-render` | P2-23 | S13-04 | `src/renderer/styles/features/fla-import/render/s13-04--render-final-398.css` |
| `G112` | `mixed` | P2-27 | S13-05 | `src/renderer/styles/compat/mixed-conditions/s13-05--render-dialogue-audio-media900.css` |
| `G113` | `dialogue-workspace` | P2-08 | S14-01 | `src/renderer/styles/features/dialogue/workspace/s14-01--pending-hints-443.css` |
| `G114` | `dialogue-batch` | P2-09 | S14-02 | `src/renderer/styles/features/dialogue/batch/s14-02--batch-447.css` |
| `G115` | `dialogue-properties` | P2-10 | S14-03 | `src/renderer/styles/features/dialogue/properties/s14-03--properties-447.css` |
| `G116` | `timeline` | P2-15 | S14-04 | `src/renderer/styles/features/timeline/s14-04--audio-trim-447.css` |
| `G117` | `dialogue-properties` | P2-10 | S14-05 | `src/renderer/styles/features/dialogue/properties/s14-05--properties-width420.css` |
| `G118` | `dialogue-batch` | P2-09 | S14-06 | `src/renderer/styles/features/dialogue/batch/s14-06--batch-footer-host.css` |
| `G119` | `dialogue-properties` | P2-10 | S14-07, S14-08 | `src/renderer/styles/features/dialogue/properties/s14-07--properties-spacing-448a.css` |
| `G120` | `timeline` | P2-15 | S14-09 | `src/renderer/styles/features/timeline/s14-09--audio-trim-448b.css` |
| `G121` | `shell-quick-actions` | P2-19 | S14-10 | `src/renderer/styles/shell/quick-actions/s14-10--quick-drawer-454.css` |
| `G122` | `shell-layout` | P2-18 | S14-11 | `src/renderer/styles/shell/layout/s14-11--top-overlay-456-486.css` |
| `G123` | `dialogue-properties` | P2-10 | S14-12, S14-13 | `src/renderer/styles/features/dialogue/properties/s14-12--timing-seconds-463.css` |
| `G124` | `image-picker` | P2-02 | S14-14 | `src/renderer/styles/features/characters/image-picker/s14-14--image-picker-base-492.css` |
| `G125` | `characters-settings` | P2-05 | S14-15 | `src/renderer/styles/features/characters/settings/s14-15--mouth-picker-host.css` |
| `G126` | `character-identity` | P2-03 | S15-01 | `src/renderer/styles/features/characters/identity/s15-01--identity-base-495.css` |
| `G127` | `characters-workspace` | P2-04 | S15-02 | `src/renderer/styles/features/characters/workspace/s15-02--character-list-and-summary-495.css` |
| `G128` | `dialogue-identity-host` | P2-03 | S15-03 | `src/renderer/styles/features/dialogue/identity-adapters/s15-03--dialogue-identity-adapters.css` |
| `G129` | `character-identity` | P2-03 | S15-04 | `src/renderer/styles/features/characters/identity/s15-04--identity-width700.css` |
| `G130` | `characters-workspace` | P2-04 | S15-05 | `src/renderer/styles/features/characters/workspace/s15-05--character-list-width701.css` |
| `G131` | `character-identity` | P2-03 | S15-06 | `src/renderer/styles/features/characters/identity/s15-06--identity-compact-496.css` |
| `G132` | `dialogue-workspace` | P2-08 | S15-07, S15-08, S15-09, S15-10, S15-11 | `src/renderer/styles/features/dialogue/workspace/s15-07--new-dialogue-hierarchy.css` |
| `G133` | `character-identity` | P2-03 | S15-12 | `src/renderer/styles/features/characters/identity/s15-12--identity-width520.css` |
| `G134` | `dialogue-workspace` | P2-08 | S15-13 | `src/renderer/styles/features/dialogue/workspace/s15-13--new-dialogue-header-footer-502.css` |
| `G135` | `character-identity` | P2-03 | S15-14 | `src/renderer/styles/features/characters/identity/s15-14--identity-chevron-final.css` |
| `G136` | `thumbnail-status` | P2-03 | S15-15 | `src/renderer/styles/features/characters/thumbnail-status/s15-15--shared-thumbnail-status-503.css` |
| `G137` | `dialogue-batch` | P2-09 | S15-16 | `src/renderer/styles/features/dialogue/batch/s15-16--batch-final-505.css` |
| `G138` | `shots` | P2-07 | S15-17 | `src/renderer/styles/features/shots/s15-17--ready-thumbnail-final-508.css` |
| `G139` | `subtitle-style` | P2-11 | S15-18 | `src/renderer/styles/features/subtitles/controls/s15-18--subtitle-style-base-521.css` |
| `G140` | `characters-workspace` | P2-04 | S15-19, S15-20 | `src/renderer/styles/features/characters/workspace/s15-19--character-detail-polish-524.css` |
| `G141` | `subtitle-style` | P2-11 | S15-21 | `src/renderer/styles/features/subtitles/controls/s15-21--subtitle-style-container300.css` |
| `G142` | `characters-workspace` | P2-04 | S15-22 | `src/renderer/styles/features/characters/workspace/s15-22--character-workspace-consolidated-523.css` |
| `G143` | `characters-settings` | P2-05 | S16-01, S16-02 | `src/renderer/styles/features/characters/settings/s16-01--character-settings-and-expression-523.css` |
| `G144` | `characters-workspace` | P2-04 | S16-03 | `src/renderer/styles/features/characters/workspace/s16-03--character-rename-final-width360.css` |
| `G145` | `characters-settings` | P2-05 | S16-04, S16-05 | `src/renderer/styles/features/characters/settings/s16-04--character-settings-polish-526.css` |
| `G146` | `characters-expression` | P2-05 | S16-06 | `src/renderer/styles/features/characters/expression/s16-06--expression-inline-final-528.css` |
| `G147` | `image-picker` | P2-02 | S16-07 | `src/renderer/styles/features/characters/image-picker/s16-07--image-picker-inline-and-host.css` |

---

## 10. P2-01 的特殊地位：它是“秤的校准”，不是 Full CI 开关

P2-01 同时承担：

- 固化当批 pinned blob / anchor / 行字节 receipt；
- 让 reader / manifest / verifier 继续读取**产品真实加载入口**；
- 验证真实 Segment 顺序，不允许排序后再比较；
- 试搬 S11-01 view-mode pilot；
- 证明后续 Issue 可以复用这套最小接续，而不是每单重造验证平台。

它**不授权**：Full CI、`pnpm verify:project`、全仓历史 verifier 套餐、通用 CSS bundler、递归 import 平台重写。

---

## 11. 每张实施 Issue 必须回填的 Receipt

```yaml
issue: P2-xx
section_ids: [Sxx-yy]
baseline_commit: fb5f91ecb8ee3ecdcea9bf2f242526feb3597859
source_blob_sha: ...
start_anchor: ...
end_anchor_exclusive: ...
local_boundary:
  start_line: ...
  end_line: ...
  start_byte: ...
  end_byte_exclusive: ...
  sha256: ...
migration_mode: DIRECT | HOST_INTEGRATION | ORDERED_COMPAT
original_order:
  predecessor: ...
  successor: ...
outer_conditions: []
producer_paths: []
host_paths: []
ui_runtime_consumers: []
programmatic_test_consumers: []
dependencies:
  css_variables: []
  keyframes: []
  resource_urls: []
  js_geometry_contracts: []
target_segments: []
target_paths: []
validation:
  targeted_commands: []
  human_surfaces: []
  normal_required_ci: pending|pass|blocked
exceptions: []
```

---

## 12. DoD / STOP / 范围门禁

### DoD

- 当批所有 Section 的本地精确切口已固化；锚点/指纹匹配。
- 产品真实入口展开后，无缺失、无重复、无换序，条件外壳不丢。
- 目标 Segment 确实被产品加载，不拿脱离产品的归档副本自证。
- 相对 URL / keyframes / CSS vars / `!important` / selector list / data/ARIA 条件原样保持，或有逐项映射证据。
- 涉及 Timeline / Left rail / Right Inspector / Editor body 时，检查对应 programmatic geometry contract。
- 只跑本 Issue 最小充分验证 + 正常 required CI；人工验收按真实入口/真实状态执行。

### STOP

- blob / anchor / Section 顺序与锁定地图不匹配；
- 必须拆开一个完整 media/container/shared selector 才能继续；
- 搬家导致相对资源地址语义改变但没有映射；
- 发现新的程序消费者或真实产品状态，导致原验收面不完整；
- 需要改 DOM、状态、store、IPC、断点含义、视觉值、文案；
- 想靠追加“最终 override”掩盖搬迁错误；
- 想顺手去重、删除旧规则或提前做 Phase 3/4。

---

## 13. Open Evidence Gaps（保留，不粉饰）

- Resolve all anchors against all 16 pinned blobs before approving complete automated relocation.
- Enumerate all static token/import/JS measurement/test consumers locally; lexical hits are not proven selector matches.
- Review dynamic class/attribute construction, generic selectors, URL resources, animation references and CSSOM readers.
- Use actual product-entry traversal for equivalence; never sort segments before comparison.
- Runtime/Windows and computed-style winners not measured; preserve baseline semantics, do not fix unrelated legacy anomalies.

---

## 14. v1.0 → v1.1 变更摘要

### 28单版保留
- 28 个正式实施批次与依赖 DAG。
- 179 个 Section 全序链。
- 147 个候选连续 Segment。
- Source/anchor/destination/local receipt/consumer registry/cascade chains。
- 旧 Task surface 与 mixed conditions 单独进入 P2-27，P2-28 只做 closure。

### 从22单版并入
- `DIRECT / HOST_INTEGRATION / ORDERED_COMPAT` 迁移语义。
- Producer → Host → UI/Runtime → Programmatic/Test 四层责任模型。
- H01–H09 Compatibility Ledger，并扩为 H01–H12。
- 明确“宿主约束不能吞组件基础”“共享 selector 不拆”“Phase 2 不做视觉/去重/删除”。
- 最小充分验证、禁止擅自 Full CI、STOP gate 与 Section Receipt。

### v1.1 新纠正
- Timeline 旧 Task 表面不再假定为当前产品 Timeline；保留但不复活、不删除。
- Left Resource / Right Inspector / Editor body CSS 纳入 BottomWorkspace 的程序测量依赖。
- 147 Segment 被明确为**保序模型**，不再被误读为“必须立刻创建 147 文件”。

---

## 15. Integrity Receipt

- **baseline_match_22_vs_28：** True
- **source_lines_match：** True
- **ticket_count：** 28
- **section_count：** 179
- **segment_count：** 147
- **ordered_edges：** 178
- **ticket_ids_unique：** True
- **section_ids_unique：** True
- **section_order_contiguous_1_to_179：** True
- **all_section_ticket_refs_valid：** True
- **all_section_owner_refs_valid：** True
- **dependency_graph_acyclic：** True
- **note：** This validates the fused planning ledger's internal consistency only; it is not runtime/CSS semantic verification.

> 这份 Integrity Receipt 只证明 **v1.1 台账内部自洽**，不等于证明 32,816 行 CSS 已完成运行时等价迁移。

---

## 16. AUTO SAVE v1.1

```text
=== AUTO SAVE v1.1 ===
时间：2026-09-16 11:57 +08:00
阶段：归纳 / 写作 / Phase 2 canonical map 融合
本次变化 Delta：
将 22-Issue Dispatch Map 与 28-Issue Section Map 融合为唯一 Canonical v1.1。

做了什么（结果）：
- 采用 28 张 Issue 作为正式实施粒度。
- 保留 179 Section / 147 Segment / 178 条相邻顺序边。
- 保留 28版 owner/anchor/destination/evidence/consumer/cascade 台账。
- 并入 22版 DIRECT / HOST_INTEGRATION / ORDERED_COMPAT 迁移模式。
- 并入 Producer → Host → UI/Runtime → Programmatic/Test 四层责任模型。
- H01-H09 扩展为 H01-H12，新增程序几何消费者、Legacy Task 与 Segment 文件数量门禁。
- P2-27 明确保留 Legacy Task / mixed conditions；P2-28 只负责最终真实入口总对账。
- 生成 canonical Markdown 与机器可读 JSON。
- 对融合台账执行内部一致性校验：28 tickets、179 sections、147 segments、178 order edges、依赖无环。
- 未修改生产仓库，未创建 GitHub Issue/PR，未运行 build/test/CI。

当前状态（一句话）：
Phase 2 已有唯一 canonical v1.1 派单基线，但生产迁移尚未开始。

下一步（唯一可执行）：
基于 canonical v1.1 起草并创建 P2-01：保序校验接续 + S11-01 Tools view-mode pilot。

止损条件：
若 P2-01 preflight 发现 pinned blob/anchor/入口顺序与 v1.1 不符，停止生产写入并先更新 Section receipt。

反话闸门：
v1.1 是完整派单地图，不是“全运行时穷举完成”的证明；147 Segment 也不是强制 147 文件。

风险 / 未验证：
- 仍只有 3 个 Slice / 48 个 Section 有本地精确边界回执。
- 动态 class、全部 runtime DOM、所有 computed winner 未穷举。
- Windows 产品回归本轮未执行。

置信度（0-5）：
5：融合结构、编号、Section/Segment/依赖账本内部一致性。
4.5：责任模型与迁移门禁。
4：剩余 Section 的精确施工切口，需各单 preflight 本地固化。
=================
```
