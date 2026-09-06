# Day29 PR #233 恢复三阶段开工计划

> 状态：**PLAN ONLY / DOCS ONLY**  
> 记录日期：2026-09-06（+08:00）  
> 当前基线：`main@d6fc615031cc30fa189538f224147ff1737ab270`  
> 历史来源：PR #233 `agent/day29-audio-mouth-preview`，最终参考 HEAD `d7185eb2af3234405bbe5150522bc6a0928cb092`

## 1. 目的

PR #233 在旧基线上完成过对白音频绑定、音频 metadata 分析、单镜头有声 Product Preview、简单 Mouth 投影以及多轮验收修复。之后 `main` 已继续演进，完成 FLA 工作区、Project Launcher、右侧 Workspace、字幕工作区、Timeline 几何和编辑画布等结构变化。

本计划的目的不是把旧 PR 重新整车开回来，而是：

1. 以**当前 main** 为唯一施工地基；
2. 把 #233 中仍有价值的最终能力迁回当前架构；
3. 按 **Audio → Preview → Mouth** 三阶段串行恢复；
4. 每阶段独立收敛、独立验收，避免一次性恢复 45 个旧改动文件；
5. 保留当前 UI / Store / Timeline / FLA owner，不把后续架构退回 Day29 时代。

本文件只记录恢复施工合同，**不授权立即修改产品代码**。真正开工前需要另开明确的 implementation Issue / PR，并以当时最新 `main` 重新确认基线。

---

## 2. 已知审计结论

对 PR #233 与当前 main 的恢复审计得到：

- Day29 PR 实际改动：**45 files，+4947 / -222**；
- 文件关系：**18 个双方都改过、14 个 main 未漂移、13 个 Day29 新增**；
- 迁移建议：**18 个直接移植候选、20 个需要适配、7 个应放弃旧接法并重新接当前 owner**；
- 因此 Day29 不是“全部过时”，但也不适合把旧 UI / Store / CSS / manifest 整体覆盖回来。

推荐路线：

```text
current main
  ↓
新的恢复 implementation 分支 / Draft PR
  ↓
Phase 1 — Audio
  ↓
Phase 2 — Preview
  ↓
Phase 3 — Mouth
  ↓
集成验收
  ↓
Ready / merge decision
```

默认采用**一个新的 Draft implementation PR + 三个清晰阶段**。如果某一阶段实际膨胀到不适合继续共用一个 PR，再由维护者决定是否拆成串行 PR；不要一开始就并行开三条互相争抢同一批文件的施工线。

---

## 3. 全局恢复规则

### 3.1 当前 main 是 owner，旧 #233 是零件仓库

迁移应读取 #233 最终版本中的有效逻辑、测试和历史验收场景，但不得为了“方便 cherry-pick”恢复旧页面结构。

以下当前 owner 必须保持：

- `EditorProjectStore` 继续是正式 Project / dirty / revision 的单一 renderer owner；
- `DialogueService` / `dialogueStore` 继续承接对白正式 mutation；
- 当前 `AssetLibrary` 继续承接素材与 FLA 工作流；
- 当前 `DialogueInspector` / Properties 呈现继续承接对象编辑入口；
- 当前 Right Workspace、Timeline、Canvas 与 LM-004 几何合同不回退；
- Preview 继续复用正式 evaluator / Stage renderer，不创建第二套场景树或第二主时钟。

### 3.2 不按 24 个历史提交机械重放

恢复单位是“最终能力增量”，不是旧 PR 的历史提交顺序。历史提交只作为溯源坐标；如果一个旧提交同时包含 Audio、Preview、Mouth 内容，应按本计划重新拆取，而不是整包 cherry-pick。

### 3.3 “帮我找空位”与“拖到这里”必须分开

Day29 的 first-legal-gap 能力值得保留，但不能破坏当前字幕跨工作区拖拽：

- 一键“安排一帧”且没有显式 `startMs`：允许自动寻找第一个合法空档；
- 用户明确拖到某个时间位置：必须尊重该显式落点与当前 overlap 拒绝规则；
- Preview timing 与最终 commit 必须使用同一套 resolver 语义，禁止“预览在 A，松手跑到 B”。

### 3.4 验证采用最小充分原则

遵守仓库根 `AGENTS.md`：

- 不手动触发 Full CI；
- 不默认运行 `pnpm verify:project` 或历史 verifier 全扫；
- 每阶段只运行与改动范围相称的 targeted tests / core checks / 必要 Electron verifier；
- 正常自动 CI 由仓库路由决定；
- 发现无关历史失败时记录为 unrelated debt，停止扩张。

---

## 4. Phase 1 — Audio

### 4.1 阶段目标

先恢复“配音能可靠进入项目并绑定到对白”的完整产品链：

```text
导入真实音频
→ metadata 分析得到真实时长
→ 当前属性页可选择并绑定到 Dialogue
→ timing / binding 合法
→ Undo / Redo / Save / Reopen 后关系仍成立
```

本阶段完成后，**不宣称 Product Preview 已经能发声**；那是 Phase 2 的交付。

### 4.2 计划恢复内容

1. Windows 开发态媒体工具定位与错误区分；
2. 音频 metadata 自动串行分析、失败状态和 Retry；
3. 受真实源时长约束的 Dialogue ↔ AudioClip 绑定；
4. Dialogue timing 调整时绑定关系与 AudioClip 区间的正确处理；
5. first-legal-gap 算法按 3.3 节重新接入当前 timing resolver；
6. 在**当前可达的 Properties / Dialogue Inspector 呈现**增加绑定入口；
7. 预先接好后续 Preview 所需的安全音频读取 API / Main / Preload / types，但本阶段不把播放能力算作完成。

### 4.3 禁止事项

- 不恢复旧 `AssetLibrary` 整体 JSX；
- 不恢复旧 `DialogueInspector` 整体 return；
- 不覆盖当前 `DialogueService.arrange()` / `previewArrange()` 语义；
- 不新建第二 Project Store；
- 不放宽 Main / Preload / hash / path / MIME / source-duration 安全检查。

### 4.4 阶段验收

至少证明：

- 正常 MP3 / WAV 可分析并进入 Ready；
- metadata 失败可 Retry；
- 缺少合法时长的音频不能伪装成可绑定；
- 字幕窗口可以长于真实音频，不用假静音补齐；
- 绑定后移动 / 调整 Dialogue 不丢关系；
- Undo / Redo / Save → Close → Reopen 正确；
- 当前字幕拖拽的 Preview 与最终落点不被 first-gap 逻辑破坏；
- 当前 FLA 素材工作流无回退。

阶段结束条件：上述能力收敛后停止，不顺手进入 Preview UI 改造。

---

## 5. Phase 2 — Preview

### 5.1 阶段目标

在当前正式 Product Preview 中恢复真实对白播放，并明确 Pause / Seek / Resume / Stop / Replay 的产品语义。

```text
正式 Preview 主时钟
→ shared subtitle winner
→ 当前 Dialogue 的绑定 AudioClip
→ 单一 audio element 从属播放
```

完成后应能正常听完整镜头，不创建新的 Preview 数据树，不污染 Project / History。

### 5.2 计划恢复内容

1. Day29 的单 audio element transport；
2. master time → audio source offset 映射；
3. Pause / Seek / Resume / Stop / Replay；
4. 失效令牌 / stale read 防止旧声音“诈尸”；
5. Preview 从已有受控 `readCanvasImage` 使用原图，而不是把 256px thumbnail 放大；
6. 最终的 canvas-first Preview shell、紧凑 transport、独立 Stop / Replay；
7. 保留 modal Single-Shot Preview，不为了旧 Gate 改成非模态。

### 5.3 开工即修的已知缺口：dispose 后迟到 URL

旧 `productPreviewAudio.ts` 存在一个需要优先修复的生命周期边界：

```text
开始异步读取音频
→ 用户关闭 Preview / dispose
→ 读取结果之后返回
→ 旧逻辑仍可能创建 object URL
→ 播放虽然被阻止，但迟到 URL 可能没有被 revoke
```

最小修复要求：

- dispose 后的成功 / 失败回调不得再写入已销毁 transport；
- 若 URL 已在迟到回调中创建，应立即 revoke；
- dispose 后不再向已消失的界面发 warning；
- 增加 `pending read → dispose → resolve` 的针对性测试。

不把这个问题升级成新音频引擎重写。

### 5.4 阶段验收

至少证明：

- 3 条真实 Dialogue + 3 条真实 Audio 可按顺序播放；
- 字幕比声音长时，声音自然结束而字幕可继续显示；
- Pause 立即停声；
- Seek / Resume 从正确源偏移继续；
- Stop 回到 0 并保持停止；
- Replay ×5 无叠音 / 鬼音；
- 播放中关闭 Preview 后无后台残留声音；
- “读取未完成就关闭”不会产生迟到资源泄漏；
- Preview 操作不产生 dirty / History；
- Canvas / Right Workspace / Timeline 当前几何没有被旧 CSS 回退。

阶段结束条件：有声 Preview 稳定后停止；Mouth 仍按普通图显示也算 Phase 2 PASS。

---

## 6. Phase 3 — Mouth

### 6.1 阶段目标

只恢复 Day29 的**简单嘴型投影**：当前说话角色在绑定音频有效区间内切换到 `mouthOpenAssetId`，声音结束后恢复普通图。

这不是自动音素识别，也不是音频包络驱动的复杂嘴型系统。

### 6.2 计划恢复内容

1. Preview 预加载当前镜头相关角色的合法 mouth image；
2. 复用 `projectProductPreviewMouth` 思路，在正式 evaluator 结果之后做只读投影；
3. 使用 shared subtitle winner 确定当前 Dialogue 身份；
4. 只有绑定 AudioClip 的真实播放区间内张嘴；
5. 字幕尾部但声音已结束时恢复普通图；
6. 无 `mouthOpenAssetId` / 无合法 mouth asset 时安静降级，不 crash。

### 6.3 阶段验收

至少证明：

- A 说话时只 A 张嘴；
- B 说话时只 B 张嘴；
- 非当前说话角色不跟随张嘴；
- 无 mouth asset 时声音 / 字幕正常、普通图 fallback；
- 声音结束而字幕仍显示时嘴型已恢复；
- legacy overlap 场景只跟随 shared subtitle winner；
- Close / Stop / Replay 后 mouth 状态不会残留；
- 真人 Windows/Electron mouth 专项完成，而不是拿历史 pending receipt 当新 PASS。

阶段结束条件：Simple Mouth 产品合同通过。复杂唇形、背景音、多轨混音、导出端同步不自动纳入本阶段。

---

## 7. 历史来源索引

实施时以 #233 **最终状态**为主要代码来源，以下历史提交只用于定位能力来源：

| 来源 | 主要价值 | 计划阶段 |
|---|---|---|
| `523d068…` / #234 | 双角色 speaking isolation | Mouth |
| `6a1462a…` / #235 | 音频导入后 metadata / Retry | Audio |
| `fd7831e…`、`fa365e3…` / #236 | Windows 媒体工具路径与错误分类 | Audio |
| `908053d…` / #238 | first legal gap | Audio（重新接 current resolver） |
| `a9ce236…` / #240 | 独立 timing、有声/高清 Preview、Replay | 按能力拆到 Audio / Preview |
| `80ad446…` / #241 | 图标 transport | Preview |
| `234ca9e…` / #242 | 独立 Stop 与最终 Preview shell | Preview |
| `d7185eb…` | Day29 最终源码固定锚点 | 全阶段 |

不得因为历史提交编号清晰，就整串机械 cherry-pick。

---

## 8. implementation 交付建议

真正恢复时，默认建议：

- 从当时最新 `main` 新建恢复 branch；
- 新开一个 **Draft implementation PR**；
- PR 内按 Audio / Preview / Mouth 三个阶段形成清晰 commit / receipt 边界；
- 每阶段完成后先验该阶段，不带病叠下一阶段；
- 只有当实际 review 体量证明一个 PR 不合适时，再经维护者决定拆为串行 PR。

旧 PR #233 保留为历史来源，不在本计划 PR 中 force-push、rebase、Ready、merge 或关闭。

---

## 9. 止损条件

出现任一情况时，停止受影响施工并回报，不继续扩大范围：

1. 为恢复旧能力必须恢复旧 Task Tray / 旧 Properties / 旧 Canvas shell；
2. 需要新造第二 Project Store、第二 Preview evaluator 或第二主时钟；
3. Preview timing 与最终 commit 落点不一致；
4. 必须放宽路径 / hash / trusted sender / Preload allowlist 才能继续；
5. 为让 targeted validation 变绿开始修改无关历史 verifier；
6. 当前阶段仍有功能失败，却准备继续叠下一阶段；
7. 发现必须改变 Project schema 才能继续——此时先单独报告必要性与迁移成本，等待授权。

---

## 10. Definition of Done（整个恢复计划）

三阶段全部结束后，只有同时满足以下条件，才可认为 Day29 恢复完成：

- Audio：真实导入、metadata、绑定、独立 timing、Undo/Redo、持久化通过；
- Preview：真实有声播放、Pause/Seek/Resume/Stop/Replay、高清完整画面、read-only 与异步清理通过；
- Mouth：双角色隔离、missing-mouth fallback、字幕尾部恢复、overlap winner 通过；
- 当前 Right Workspace / Subtitle Workspace / Timeline / Canvas / FLA 结构无回退；
- targeted tests + 当前政策要求的 core checks + 正常 CI 通过；
- Windows/Electron 需要的真人验收完成；
- 未把历史 #233 的旧 PASS 直接冒充为新组合版本 PASS。

---

## 11. 当前状态

```text
planning document = RECORDED
implementation authorization = NOT GRANTED BY THIS DOCUMENT
product code changed = NO
PR #233 changed = NO
Full CI manually triggered = NO
next action = maintainer decides when to open Phase 1 Audio implementation work
```
