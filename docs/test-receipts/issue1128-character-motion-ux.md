# #1128 Character Motion 交互收敛

2026-11-16；基线 `c5f813b`，继续提交到 [Draft 母 PR #1123](https://github.com/Cognitive-Architect/panda-stage/pull/1123)。
**实现及自动化已就绪，OWNER 的 60 秒盲操作复验待本人回填。**

以下第一轮记录对应 `ccc7074`；当前 UI 以文末“第三轮 §12.6”及 Issue 的 OWNER 最新裁决为准。

## 实现与边界

- 所有可选 Adaptive Parts Layer 提供既有 Part hit target；Canvas 点击直接选择 Layer + Part，不依赖先开下拉。切换选择、时间、项目和 undo 后继续使用现有 selectionStore。
- 备用 selector、Inspector、Timeline 共用只读名称映射：优先 displayName；空名及旧技术占位名 Image/Graphic 使用“部件 N”。不修改持久化名称或 target identity。
- 直接拖本体移动；四角方形手柄等比缩放；选框上沿连接旋转手柄和 rotate cursor。pivot 是低权重、不可交互的十字。缩放与旋转仍围绕原 target-local pivot，不改 Core。
- Part 选择时 RightInspector 显示 Part 变换 adapter，替换灰掉的 Layer 字段；返回“角色整体”恢复原 Inspector。没有重写 Layer Inspector。
- Inspector 与 Stage 同用 CharacterMotionGesture → CharacterMotionService → EditorProjectStore.updateProject。输入草稿不写项目；Enter / 离开表单提交一次；Escape / 时间与上下文变化取消。只提交实际编辑的字段，uniform scale 同比写 scaleX/Y。
- 自动关键帧 ON/OFF 合同保持；已有 Clip 的 OFF 仍编辑 Library 默认姿势。若 Library 已移除该 Part，OFF 明确阻断并引导开启自动关键帧，冻结 Clip 仍可编辑。
- 中文“自动关键帧”，只使用 ON/OFF tooltip；删除顶部独立 ◆/◇。真实 Timeline marker 仍由 Property Keys 聚合，并高亮当前时间。
- 未修改 domain、schema、evaluator、Main、Preload 或 IPC；未新增 Pose / Composite persisted state。

实际鼠标验证发现切换出 composite cache 后 hit graph 可能仍为空。现有 cache ref 在 children commit 后刷新 Part 命中图；验证脚本只读取命中图，不替生产刷新。没有加入人工等待或降低验证要求。

## 自动化

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm exec electron scripts/verify-issue1126-character-motion.cjs --issue1128
```

- 全量 unit：433 files / 3577 PASS；此后补充 Inspector uniform-scale / Library 移除场景，Inspector 6/6 PASS。最终 HEAD 的完整结果以自动 Core CI 为准。
- 相关六份 unit：78 PASS（补充最后一例前）；覆盖双 source 的 60 次 pointer move 不写历史、一次提交一步 Undo、stale context、上下文同步、OFF、校验失败、回到 Layer。
- integration：51 files / 231 PASS + 1 环境 skip。
- typecheck、lint、build、diff whitespace PASS；新文件和最终小改动另做 targeted lint/unit。
- Electron 最终 PASS：`D:/PandaStage-Acceptance/issue1128/2026-11-16T05-36-57.148Z`。
- 自动化使用真实 Electron 鼠标与键盘、生产 Canvas / RightInspector / Timeline / stores，图片读取为 harness mock。包括两种 Part 从无选择状态直接点击、四处上下文一致、Inspector Enter 一步 Undo/Redo、等比 scale、OFF 不写 Clip、返回 Layer 隐藏 Part handles、Image/Graphic move/rotate/scale 和 Undo/Redo。
- 包含 result.json、Part Inspector 截图、before/after 图。截图前等待真实素材 readiness 和绘制帧，不以任意延时制造视觉成功。

测试沿用既有 focused harness/verifier，仅适配移除的圆点 / 独立菱形并补本票交互；没有新建截图 diff 基础设施、额外 Full CI 或历史 verifier sweep。

## OWNER 最小复验

独立项目：`D:/PandaStage-Acceptance/issue1128/OWNER.pandastage`。

已用构建后的真实 Electron Main/Preload 打开独立验收配置，窗口标题：`Panda Stage（V0 UX 60-second UAT）`。
未覆盖之前 OWNER 的项目或运行窗口。

只给任务，不提供手柄操作指导：

> 选 Part → 500ms → 自动关键帧 → 移动 / 旋转 / 缩放 → Undo。

对 Image / Graphic 做最小复验，并确认属性栏跟随当前对象。
OWNER 回填 `PASS` 或 `FAIL + 卡住的动作`；自动化不能代签“无需指导”的真人体验。

待该结果及 Core CI 回填后更新 #1128 DoD。#1123 保持 Draft，不 Ready / Merge，不自行关闭待接受 Issue。

## 第二轮 §12.5：Inspector 单一归属与成熟 Transform pattern

基线 `ccc7074`；OWNER 第二轮裁决覆盖旧顶部方案。

- Canvas 不再渲染 Part selector / 自动关键帧，也删除了对应的额外 grid 行规则。没有悬浮工具条或空占位。
- 控件薄迁移为 [CharacterMotionInspectorSection](../../src/renderer/features/properties/CharacterMotionInspectorSection.tsx)，仅由 RightInspector 承载；“动作关键帧”和“变换”使用同级 details/summary。角色整体模式也保留此备用 selector。
- Part Transform 沿用成熟 compact 的 control row、X/Y 双列、scale/rotation stepper、unit suffix 与 action row；增量分别为 10% 和 15°，缩放范围仍取 CharacterPart 的已有常量。只提供“重置变换 / 应用变换”，没有 flip/opacity。
- 所有动作仍使用 CharacterMotionGesture → CharacterMotionService。stepper 可合并当前 pending input 后只提交一条命令；Enter、字段 blur、应用不会重复写同一草稿；重置按当前时间/Auto-Key 提交 neutral values，不清除/重建 Clip。revision 刷新仅重读 UI draft，保留字段 DOM 与键盘焦点。
- 只删除指定的 compact Layer 常驻说明及唯一使用的 Info 图标；锁定/背景保护提示和错误路径保留。Part 不新增替代教程。

本地检查：typecheck、lint、build、diff check PASS；433 files / 3581 unit PASS；51 files / 231 integration PASS +1 环境 skip。
为说明删除做的两个旧测试修正均直接对应本票：改验说明缺席，并保留锁定反馈断言。没有扩展历史 verifier 链。

Focused Electron 仍使用上文同一命令；第二轮 PASS 目录：

`D:/PandaStage-Acceptance/issue1128/2026-11-16T06-39-16.129Z`

新增实际鼠标/键盘证据：Canvas 内控件数为 0、Inspector 单一 owner、选 Part 前后 viewport 高度差小于 1px；pending X + scale step 一条 History，rotation step、Apply 去重、Reset/Undo、uniform scale 与 OFF 同路。保留 Image/Graphic move/rotate/scale、上下文与回到 Layer 的全部既有回归。

本轮独立 OWNER 项目为 `D:/PandaStage-Acceptance/issue1128-round2/OWNER.pandastage`，窗口标题 `Panda Stage（V0 UX Round 2）`。
保留旧验收项目与窗口状态；本轮只给任务：选 Part → 自动关键帧 → 500ms → 移动/旋转/缩放 → Undo。
OWNER 第二轮盲验与当前 push 的自动 lean Core CI 结果待回填；未手动 Full CI / verify:project。

## 第三轮 §12.6：身份、动作行、分隔线与背景反馈

基线 `416cf53`。本轮仅落实 OWNER 的四处最终 polish，未改变 Animation Core、选择 owner 或 authoring facade。

- Part 大身份卡改成无边框的 40px thumbnail + 对象行，部位名为主、实例名为次。现有 `getRightInspectorLayerSummary` 将 Image 或 Graphic 的已有帧素材交给同一个 `useRightInspectorThumbnail`；已存在 Clip 时优先冻结 source，缺图使用现有 Layers3 图标。没有新缩略图生成或缓存系统。
- 标题为“动作”；新增关联 selector 的“部位”label，与 Part Transform 的 44px label 列对齐。selector 最大 96px，窄列可收缩，长名 ellipsis + 完整 title。按钮使用现有 DecorativeIcon/Lucide Plus，保留 toggle/aria-pressed/selected 状态。
- 删除 Part action row 的本地 divider；在其现有局部 inline variant 中关闭共享样式的 borderTop/paddingTop，以 form 的 12px gap 分隔。普通 Layer 的 shared divider 未变。
- 背景选中且可编辑时，identity、Transform、Appearance 不再渲染说明段落。选择/设为/清除/填充背景的成功由当前对象和按钮状态表达；不常驻成功文字。背景 Transform 成功也保持静默。异常路径继续显示，锁定提示收为“背景已锁定。”；未重做背景管理逻辑。

继续使用上文已有验证命令。本地 typecheck、lint、build、diff check PASS；433 files / 3585 unit PASS；51 files / 231 integration PASS +1 环境 skip。新增 unit 覆盖冻结缩略图来源，以及桌面/横屏/竖屏背景正常态、重复选择成功、失败保留和 locked 反馈。旧 copy 断言仅按本票变更更新。

Focused Electron 最终 PASS：`D:/PandaStage-Acceptance/issue1128/2026-11-16T07-48-20.829Z`。

沿用生产 Canvas / RightInspector / Timeline / stores 和 mock 图片 reader；增加 Cloud Touch landscape 样式上下文，实际检查 40px identity、label 对齐、selector 收缩/ellipsis/title、Plus、Part border 为 0、普通 Layer divider 非零、无横向溢出、背景正常及成功静默、锁定反馈保留。保留 Image/Graphic 直接选中、500ms authoring、stepper/Reset/Apply、一步 History、Seek、Undo/Redo 与 OFF 回归。截图和 result.json 同目录；没有新建 diff gate。Windows 显示缩放会将普通 1px 边框量化为 0.666667 CSS px，验收检查实际边框存在，不要求固定量化值。

新独立真实 Main/Preload OWNER 项目：`D:/PandaStage-Acceptance/issue1128-round3/OWNER.pandastage`，已打开窗口 `Panda Stage（V0 UX Round 3）`。旧项目保持原样。OWNER 最终视觉/操作结果与本轮 push 的自动 lean Core CI 尚待回填，自动化不代签真人 PASS；#1123 保持 Draft。

#1127 的素材定位补充：用户再次确认默认下载目录的素材包；现有 `素材包.zip` 包含“原始人动作.fla”，此前未检出 BitmapFill。真实含 bitmap fill 的替代 FLA 及诊断已记录在 [V0-04 receipt](issue1127-animation-v0.md#d真实-bitmap-fill-诊断尚未产品验收)。数据层诊断不代表 D 的产品局部 fallback 已验收，本轮不补 renderer。
