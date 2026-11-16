# #1128 Character Motion 交互收敛

2026-11-16；基线 `c5f813b`，继续提交到 [Draft 母 PR #1123](https://github.com/Cognitive-Architect/panda-stage/pull/1123)。
**实现及自动化已就绪，OWNER 的 60 秒盲操作复验待本人回填。**

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
