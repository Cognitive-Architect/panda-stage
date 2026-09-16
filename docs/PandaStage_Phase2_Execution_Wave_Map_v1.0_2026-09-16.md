# Panda Stage｜Phase 2 Execution Wave Map v1.0
## 27 个剩余逻辑 P2 → 15 个施工 Batch｜最多双车道并行

- 日期：2026-09-16
- 仓库：`Cognitive-Architect/panda-stage`
- 父路线图：GitHub #529
- 上位事实输入：`PandaStage_Phase2_Canonical_Section_Map_v1.1_2026-09-16.md`
- P2-01：GitHub Issue #541 / Draft PR #542
- 文档性质：**Phase 2 执行层调度图；不重定义 Canonical Section/Owner/Segment 边界。**
- 默认最大并行写入车道：**2**
- 默认合并策略：**同一 Wave 内允许并行开发，但 PR 必须串行合并；第二条车道在第一条合并后刷新 main 并重跑最小保序验证。**

> 核心结论：保留 P2-02～P2-28 的逻辑身份与独立 receipt，但把实际施工包装为 15 个 Batch。  
> 人话：账本仍按 27 个房间记，搬家公司不需要 27 趟车；能一车安全装走的就一起装，但每个房间的箱子仍要分开点数。

---

## 0. 当前 Gate 0：P2-01

P2-01 已完成实现、Review、账本修正与自动 Targeted CI，但 PR #542 仍按 maintainer 要求保持 Draft / Open / Unmerged。

**Gate 0 规则：**

- 在 #542 合并进 `main` 之前，不启动后续 Batch 的生产写入。
- 可以提前做只读 preflight / 研究，但不要从旧 main 直接写后续迁移。
- #542 合并后，后续所有 Batch 从新的 live `main` 起步。
- P2-01 提供的真实产品入口、semantic relocation manifest、保序 reconstruction / verifier 能力作为后续 Batch 的验证地基。
- 不重新发明第二套迁移框架。

---

## 1. 为什么从 27 张逻辑单压成 15 个 Batch

Canonical v1.1 仍保留 28 个逻辑 P2，因为它们代表不同 Owner、Section 边界和验收面；本执行图只改变“怎么包装施工”。

本图不把 27 张逻辑单删除，而是：

```text
Canonical P2 identity / Section / Segment / receipt
                保持不变
                     ↓
        Execution Batch 负责施工包装
                     ↓
           一个 Batch 一个 Draft PR
```

每个 Batch 中如果包含多个 P2：

- 仍分别记录每个 P2 的 Section / Segment / receipt；
- 不允许用“Batch PASS”替代某个 P2 的失败状态；
- 不按 P2 编号重排 CSS，始终按 Canonical global order 搬迁；
- 任一内部 P2 命中 STOP gate，允许把该 P2 从 Batch 拆出，不拖着整批硬做。

---

## 2. 15 个 Execution Batch 总表

| Batch | 覆盖逻辑 P2 | Sections | 主要范围 | Batch 前置 | 并行建议 |
|---|---|---:|---|---|---|
| **B01** | P2-02 + P2-03 | 9 | ImagePicker + CharacterIdentity / Thumbnail / Dialogue identity host | P2-01 merged | 🟢 优先双开 |
| **B02** | P2-04 + P2-05 | 19 | Character workspace + settings / expression | B01 | 🟡 中型 |
| **B03** | P2-06 + P2-07 | 12 | Assets + Shots | P2-01 merged | 🟢 可并行 |
| **B04** | P2-08 + P2-09 | 12 | Dialogue workspace + batch authoring | B01 | 🟢 可并行 |
| **B05** | P2-10 + P2-11 | 12 | Dialogue properties/audio + subtitle style | B04 | 🟢 可并行 |
| **B06** | P2-12 + P2-13 + P2-14 | 12 | Layer properties + Canvas + Product Preview | P2-01 merged | 🟢 优先双开 |
| **B07** | P2-20 | 10 | Project entry / recent / recovery | P2-01 merged | 🟢 独立业务面 |
| **B08** | P2-25 + P2-26 | 8 | Debug/Gate preview + global/base helpers | P2-01 merged | 🟡 小批兼容 |
| **B09** | P2-22 + P2-23 + P2-24 | 12 | FLA review → render → frame sequence | B03 | 🟢 完整功能链 |
| **B10** | P2-15 | 12 | Timeline / resize geometry / audio trim | B05 + B06 | 🔴 高风险，建议主车道 |
| **B11** | P2-16 + P2-17 | 21 | Left Resource host + Right Workspace host | B02 + B03 + B05 + B06 | 🔴 大宿主批，默认单跑 |
| **B12** | P2-18 | 9 | Editor shell/layout skeleton | B10 + B11 | 🔴 单跑 |
| **B13** | P2-19 + P2-21 | 12 | Quick/History + Tools remainder | B12 | 🟡 Shell utility 收尾 |
| **B14** | P2-27 | 18 | Legacy Task + mixed conditions ORDERED_COMPAT | B09 + B12 | 🔴 单跑 |
| **B15** | P2-28 | 0 | Real-entry closure / Phase 2 final reconciliation | B01～B14 全部完成 | 🔴 最后单跑 |

**完整性：**

- 剩余逻辑 P2：27 个
- 剩余 Section：178 个
- Execution Batch：15 个
- P2-01 已覆盖另外 1 个 Section
- 178 + 1 = Canonical 179 Section

---

## 3. Batch 说明与内部边界

### B01｜角色共享基础
**覆盖：P2-02 + P2-03｜9 Sections**

一起做的原因：

- ImagePicker、CharacterIdentity、Thumbnail status 都是 Character / Dialogue 共享地基；
- P2-05、P2-04、P2-08 都会消费这些共享层；
- 先把共享组件归位，后面的角色和字幕工作区减少重复搬迁。

验收至少分别保留：

- P2-02：普通 / inline ImagePicker、未配置 / 已选 / 错误 / 禁用 / 清除注入；
- P2-03：角色列表 / 详情 / Dialogue 单条 / Batch / Inspector 身份状态、34px 等 later override。

**禁止：** 顺手进入角色 Settings / Expression 或 Dialogue 工作区业务 CSS。

---

### B02｜角色工作区
**覆盖：P2-04 + P2-05｜19 Sections｜依赖 B01**

一起做的原因：

- Character list/detail 与 Settings/Expression 是同一角色工作台的连续真实验收面；
- P2-05 本来就依赖 P2-02 + P2-04；
- 一次 Windows 验收可以覆盖列表 → 详情 → 设置 → 表情 → ImagePicker 宿主。

注意：

- B02 体量中等偏大；
- 360 / 700 / 701px、later cascade、#528 卡内编辑必须保持；
- 如果 preflight 发现 Settings host adapter 与 Workspace final cascade 无法在一批内保持清晰 receipt，拆回 P2-04 / P2-05，不硬合。

---

### B03｜素材 + 镜头
**覆盖：P2-06 + P2-07｜12 Sections**

一起做的原因：

- 两者都消费 ResourceActivityDock；
- Source Slice 分布高度交叉；
- 后续 B11 左资源宿主同时依赖角色 / 素材 / 镜头全部内部样式先稳定。

验收分账：

- Assets：图片 / 音频 / 空态 / 搜索 / 分类 / 详情 / 缺图 / 导入；
- Shots：创建 / 列表 / 详情 / quick actions / thumbnail ready / missing。

---

### B04｜字幕创作
**覆盖：P2-08 + P2-09｜12 Sections｜依赖 B01**

一起做的原因：

- 单条创建与 Batch Authoring 属于同一个 Dialogue authoring 工作面；
- CharacterIdentity 已由 B01 先归位；
- 单条 sticky footer 与 Batch non-sticky footer 可在同一次验收里专门对照，防止误统一。

---

### B05｜字幕属性
**覆盖：P2-10 + P2-11｜12 Sections｜依赖 B04**

一起做的原因：

- SubtitleStyleControls 的宿主就是 DialogueInspector / properties；
- P2-11 本身依赖 P2-10；
- 420px window media 与 300px container query 必须分别保留，不可“顺便统一”。

验收：

- 文本 / 时间 / 音频绑定 / 清除 / 时长应用；
- 字号 / 颜色 / 描边 / 位置；
- 横屏 / 竖屏 / 窄窗口 / 窄容器。

---

### B06｜图层属性 + 画布 + 产品预览
**覆盖：P2-12 + P2-13 + P2-14｜12 Sections**

一起做的原因：

- 都属于画布交互侧；
- P2-14 只有一个 Section 且依赖 P2-13；
- P2-12 与 P2-13 的主要 Source Slice 集中在 S06/S07/S08/S11，适合一个有界 PR。

**边界：**

- Product Preview ≠ Debug/Gate Preview；后者留给 B08。
- 不改 canvasViewportStore、selection/layer state、DOM 或视觉值。

---

### B07｜项目生命周期
**覆盖：P2-20｜10 Sections**

保持单独：

- New / Close / Recent / Recovery 本身已有足够体量；
- #412 → #410 的源码真实顺序不能因“项目入口归一”被重排；
- 与其他 Batch 合并的收益低于扩大验收面的成本。

---

### B08｜Debug/Gate + Global/Base
**覆盖：P2-25 + P2-26｜8 Sections**

一起做的原因：

- 两者体量都小；
- 都不是主业务表面；
- 都需要“保留但不借机重画主题 / 删探针”的 COMPAT 纪律。

**注意：** base-global 改动必须保持全局 order；发现 generic selector 实际影响超出已知面时 STOP。

---

### B09｜FLA 全链
**覆盖：P2-22 + P2-23 + P2-24｜12 Sections｜依赖 B03**

一起做的原因：

- Review → Raster/Status → Render/Snapshot → Frame Sequence 是完整真实用户链；
- 三个逻辑 P2 的边界仍分别记账；
- S13 的 900px mixed outer block不在这里拆，仍留 B14。

---

### B10｜Timeline 核心
**覆盖：P2-15｜12 Sections｜依赖 B05 + B06**

必须保持单独：

- 同时涉及 Timeline core、BottomWorkspace resize boundary、AudioClip trim；
- 存在 JS↔CSS geometry contract；
- 会读取/依赖后续左右宿主几何；
- Source 跨 S01/S07/S08/S09/S11/S12/S13/S14。

这是 Phase 2 的高风险 Batch 之一，不跟 B11/B12/B14 同时合并。

---

### B11｜左右宿主
**覆盖：P2-16 + P2-17｜21 Sections｜依赖 B02 + B03 + B05 + B06**

一起做的原因：

- Left Resource 与 Right Inspector 都被 BottomWorkspace 当作实时几何输入；
- 统一做可以做一次完整的“左右栏 → Timeline 可用高度”验收；
- 两者都是纯 HOST_INTEGRATION，不能吞 Feature base。

**默认单跑。**

如果 preflight 显示 21 Section 的冲突面过大，允许回退为：

- B11-A = P2-16
- B11-B = P2-17

这是本地图预先批准的唯一“无须重做全图”的 Batch 拆分。

---

### B12｜Shell 骨架
**覆盖：P2-18｜9 Sections｜依赖 B10 + B11**

必须单独：

- 顶层 Editor geometry；
- 横/竖布局、overlay/flow、主画布高度、左右抽屉与 Timeline 组合；
- BottomWorkspace 会读 editor-body 几何。

这里不是“顺便整理 Shell”的机会，只做 relocation。

---

### B13｜Shell utility 收尾
**覆盖：P2-19 + P2-21｜12 Sections｜依赖 B12**

一起做的原因：

- Quick/History 与 Tools remainder 都属于 Shell utility；
- 这时 Right/Canvas/Shell 基础都已归位；
- P2-21 不再重复 P2-01 已搬的 view-mode pilot。

验收分开记：

- History / quick drawer / reduced-motion；
- Tools home / Action Preset / 返回 / disabled/locked/background。

---

### B14｜ORDERED_COMPAT 收容
**覆盖：P2-27｜18 Sections｜依赖 B09 + B12**

必须单独：

- Legacy Task surfaces 不复活、不删除；
- mixed media/container/shared conditions整块保留；
- S13 `@media(max-width:900px)` 不首轮拆；
- 无真实入口的状态记 `N/A + assembly evidence`，不能伪造视觉 PASS。

---

### B15｜Phase 2 Closure
**覆盖：P2-28｜0 Section｜依赖 B01～B14 全部完成**

只做总对账：

- 179 Section / 147 canonical Segment 的去向可追踪；
- 真实产品 entry traversal 顺序等价；
- missing = 0；
- duplicate = 0；
- 旧路径退出状态有解释；
- 每个逻辑 P2 都有 receipt / human acceptance 或明确 N/A；
- 不在 Closure 里顺手再搬新规则。

---

## 4. 推荐执行 Waves（最多双车道）

这里的“双车道”指**同时最多两个生产写分支**，不是同时 merge。

### Wave 0｜Gate
- P2-01 / PR #542 maintainer 决定并 merge
- 重新读取 live main
- 后续 Batch 全部从新的 live main 起步

### Wave 1
- Lane A：**B01**
- Lane B：**B06**
- Source Slice 交集：**0**
- 这是最适合验证“双车道是否真的省时间”的第一对。

### Wave 2
- Lane A：**B03**
- Lane B：**B04**
- Source Slice 交集：`S15`
- 允许并行开发；串行 merge；第二个合并者 refresh main 后必须重跑 real-order reconstruction。

### Wave 3
- Lane A：**B02**
- Lane B：**B09**
- Source Slice 交集：**0**

### Wave 4
- Lane A：**B05**
- Lane B：**B07**
- Source Slice 交集：**0**

### Wave 5
- Lane A：**B10**
- Lane B：**B08**
- Source Slice 交集：`S01`
- B10 为主车道；若 preflight 显示 Timeline geometry 风险扩大，B08 延后，不为凑双车道强并行。

### Wave 6
- **B11 单跑**
- 21 Sections + 左右几何读取，避免与其他 CSS write PR 交叉。

### Wave 7
- **B12 单跑**
- Shell geometry gate。

### Wave 8
- **B13 单跑**
- Shell utility 收尾。

### Wave 9
- **B14 单跑**
- ORDERED_COMPAT，禁止并行自动解冲突。

### Wave 10
- **B15 单跑**
- Closure / reconciliation only。

---

## 5. 双车道合并纪律

每个 Wave 的两个 Batch 都从**同一个已合并 live main**创建分支。

允许：

```text
main M0
├─ Batch A branch
└─ Batch B branch
```

不允许两个 PR 同时点 merge。

正确流程：

```text
A / B 并行开发
→ 各自 targeted validation
→ maintainer 分别验收
→ 先合并一个
→ 第二个刷新到新的 main
→ 重新做最小 post-refresh 校验
→ 再合并第二个
```

第二个 PR 刷新后至少重新核对：

- live starting head；
- 自己负责的 Section anchor / source receipt 是否仍匹配；
- semantic relocation manifest 无重复；
- 真实 `styles.css` traversal 顺序；
- missing / duplicate / reorder；
- 本 Batch targeted contract；
- 正常自动 CI。

**STOP：**

- refresh 后同一 Section 字节被另一 Batch 改过；
- anchor 消失或 end boundary 发生语义变化；
- manifest 冲突无法仅靠两个 Batch 的已知 entries 解释；
- 自动解冲突会把两个独立 Section 合成一个新顺序；
- 必须通过添加“final override”才能恢复画面。

---

## 6. Batch PR / Receipt 协议

### 一 Batch 一 Draft PR

标题建议：

```text
P2-Bxx: <batch title> (covers P2-xx + P2-yy)
```

PR 描述必须列出：

- 覆盖哪些 Canonical P2；
- 每个 P2 的 Sections / Segments；
- Batch 起始 live main HEAD；
- 本 Batch 的 target paths；
- 独立验收矩阵；
- targeted commands；
- 自动 CI；
- `MANUAL_FULL_TRIGGERED=false`；
- `VERIFY_PROJECT_MANUALLY_RUN=false`。

### 多 P2 仍分 receipt

例如 B01：

```text
Batch B01
├─ P2-02 receipt
└─ P2-03 receipt
```

不能只留下：

```text
B01 PASS
```

否则 P2-28 无法回答 179 Section 的完整去向。

---

## 7. 验证预算

默认每 Batch：

```text
local boundary preflight
+ real product-entry/order verification
+ Batch-specific contract/tests
+ build only where current path requires
+ touched surfaces Windows acceptance
+ normal automatic CI
```

默认禁止：

- 手动 Full CI；
- 手动 `pnpm verify:project`；
- 全仓历史 verifier sweep；
- 为“更稳一点”扩大到无关技术债；
- 在 Batch 里做 Phase 3 视觉统一；
- 删除“看起来已经没用”的 legacy CSS。

若自动 CI 根据仓库政策选择更宽 route，让自动 CI 自己处理，不手动升级。

---

## 8. 并行风险等级

### 🟢 Green
可作为双车道成员：

- 依赖已经满足；
- 主要 Owner 不同；
- Source Slice 无交集或只有一个明确独立 Section 交集；
- 不共享 programmatic geometry contract；
- 不是 ORDERED_COMPAT。

### 🟡 Yellow
可并行，但第二个合并者必须做严格 refresh：

- 有少量 Source Slice 交集；
- 或包含 global / debug / shell utility；
- 但 Section 边界清楚、验收面独立。

### 🔴 Red
默认单跑：

- Timeline geometry；
- 左右宿主大批；
- Editor shell geometry；
- ORDERED_COMPAT；
- Final closure；
- 任何 preflight 暴露共享 outer condition / unresolved programmatic consumer 的 Batch。

---

## 9. Canonical 与 Wave Map 的权威关系

如果两份文档发生冲突：

1. **Section / Segment / Owner / original order / STOP gate：以 Canonical v1.1 为准。**
2. **哪些逻辑 P2 打包成同一次施工、最大并行数、Wave 顺序：以本 Wave Map 为准。**
3. Wave Map 无权改变 CSS 责任归属。
4. 若要改变 Canonical Section 边界，必须单独记录证据并更新 canonical / receipt，不得靠 Batch 包装偷换。
5. 若某 Batch 过大，可以拆小；不允许为了“保持 15”而违反 STOP gate。

---

## 10. 退出标准

Phase 2 Execution Wave Map 完成不代表 Phase 2 完成。

Phase 2 真正完成需要：

- B01～B14 全部完成；
- 每个逻辑 P2-02～P2-27 都有独立 receipt；
- B15 / P2-28 完成真实入口总对账；
- 所有 179 Section 恰好一处；
- global order 等价；
- no silent duplicate / missing / reorder；
- 无 Phase 3 / Phase 4 偷渡；
- maintainer 明确接受 Phase 2 closure。

---

## 11. AUTO SAVE v1.1

```text
=== AUTO SAVE v1.1 ===
时间：2026-09-16 15:18 +08:00
阶段：写作 / Phase 2 执行并行化

本次变化 Delta：
把 Canonical v1.1 剩余 P2-02～P2-28 的 27 个逻辑工单，正式重组为 15 个 Execution Batch，并定义最多双车道的 Wave / merge / receipt 纪律。

做了什么（结果）：
- 保留全部 27 个逻辑 P2 身份。
- 保留每个 P2 独立 receipt。
- 剩余 178 Section 全覆盖到 15 个 Batch。
- 定义 B01～B15。
- 定义 Gate 0：P2-01 / PR #542 必须先由 maintainer 决定并 merge。
- 定义推荐双车道 Waves。
- 定义同 Wave 并行开发、串行 merge、第二车道 post-merge refresh。
- 定义 Green / Yellow / Red 并行风险等级。
- B11 预先允许在证据不足时回退拆为 P2-16 / P2-17。
- 明确 B14 ORDERED_COMPAT 与 B15 Closure 必须单跑。
- 未改变 Canonical Section / Owner / Segment 边界。
- 未 merge PR #542。
- 未修改产品代码。
- 未触发任何测试 / CI。

当前状态（一句话）：
Phase 2 已从“27张逐单串行”升级为“15个施工Batch + 最多双车道并行”的执行方案。

下一步（唯一可执行）：
将本 Wave Map 发布到 GitHub 作为 Phase 2 execution-control 文档，并以其为后续 Batch 派单包装规则。

止损条件：
若 Batch 包装导致任何 Canonical P2 的独立 receipt、STOP gate 或验收状态无法单独记录，立即拆回更小施工单元。

反话闸门：
减少 GitHub / PR 数量不是目标本身；
真正目标是减少重复验收和等待时间，同时不破坏 CSS global order 与责任账本。

风险 / 未验证：
- 双车道节省程度尚未经过 B01+B06 实战测量。
- 所有 write PR 仍共享 styles.css / semantic relocation manifest。
- B11 21 Sections 可能在 preflight 后需要拆分。

置信度（0-5）：
5：27→15覆盖完整性与依赖关系。
5：P2身份/receipt不应合并丢失。
4.5：推荐 Wave 配对与冲突控制。
4：真实双车道吞吐收益，待第一波实测。
=================
```
