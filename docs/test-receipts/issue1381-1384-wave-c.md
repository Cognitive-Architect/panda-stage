# AN Wave C 首批交付与验证记录

工单范围为 #1381–#1384。交付分支为 `fix/issue-1262-a00`，首批代码截至 `29149ea018abf6bc3006d390a994c208f3cade17`。集成 PR 保持 Draft。 [PR #1265](https://github.com/Cognitive-Architect/panda-stage/pull/1265)

## 已提交范围

| 工单 | 已提交 | 待完成或待验 |
| --- | --- | --- |
| #1381 | 图片批量改名、用途和关键词、未引用候选。图层批量改名、Graphic 安全复制、锁定、解锁、删除和中性动画中心点重置。属性曲线面板支持选段复制、显示冲突数量并确认覆盖的粘贴、内部落键和删除，以及现有移动、拉伸、保持。粘贴保护区段外的帧与稀疏属性。动画片段沿用选中实例的源帧范围与播放设置。#1376 的失效属性草稿有两轨 Undo 回归。 | 主线 v46 的文字、颜色、视频和音频组合待授权集成后验证。物理批量清库、定义独立复制、文件夹树、多层转元件、复杂播放类型转换和有动画时的保姿态换轴保留在候选池。 |
| #1382 | 数值面板与舞台控制点同步，支持新建和固定两端的 X/Y 区段替换。只写既有属性轨。定向回归覆盖非中心 pivot、旋转缩放、原曲线边界切片和草稿失效。 | 现代 Graphic 样本在 500ms 的舞台、保存重开、产品预览和正式 MP4 画面一致。另一个迁移后的结构素材在 Bake 前后均出现产品预览首帧无法显示。 |
| #1383 | 编辑舞台与产品预览共用实例效果草稿，支持混合、模糊、外发光、剪影、描边和局部区域羽化。取消可恢复原画面，保留工程与 History。 | 效果字段与迁移需协调 Schema，确认写入、清除持久化效果与正式导出待接通。黑幕、带硬遮罩的实机组合和 C03 分屏/转场待定。真实时域运动模糊保留待实际样本。 |
| #1384 | 角色动作模板提供瞬移、发抖、晃动，以及绑定头部的点头、摇头、抬低头、丝滑摇头。复用原生 Move/Shake 事件与分件动作。现有表情可带淡变切换，已有整体烘焙动作可作区段外观并在结束时恢复。 | 已检视的古装及短身分件素材缺少适用的独立双腿组合，短腿和长腿的实景走跑待具备可校准髋、膝、脚的两套素材。新烘焙外观入口、角色模板正式输出和 OWNER UAT 待验。 |

## 验证记录

- 本地自动化通过 TypeScript 检查和本轮修改文件 ESLint。范围回归包含选段缓动、轨道边界、批量操作依赖、素材引用和角色模板。图层运动、缓动持久化、角色动作历史、图片元数据共四个定向集成文件通过，19 个用例。
- Windows Electron 使用真实 Graphic 与角色，两个画布宽度对应 1065px、1920px，拖动后数值同步。预览草稿保留 revision，确认生成普通 X/Y 关键帧。已绑定头部的角色完成丝滑摇头预览和确认。验收目录为 `D:/PandaStage-Acceptance/issue-1384/run-u9GdVY`。
- Windows Electron 的现代 Graphic 样本确认保存、重开和三端一致性。500ms 代表帧的四边像素偏差均小于 3 个逻辑像素，正式 MP4 使用既有导出流程。验收目录为 `D:/PandaStage-Acceptance/issue-1384/run-ykkZFr` 和 `D:/PandaStage-Acceptance/issue-1384/preview-exact-KMGupd`。
- Windows Electron 批量操作覆盖两个真实 Graphic 实例和两张图片。复制沿用定义，Clip track 写到新 Layer ID。两条图层经删除确认后，一次 Undo 恢复。验收目录为 `D:/PandaStage-Acceptance/issue-1384/run-DQv9bw`。
- Windows Electron 效果采样的原始重叠 RGB 为 `[140,144,116]`，正片叠底为 `[39,104,111]`，描边外侧为 `[148,64,96]`，发光外侧为 `[78,149,188]`，模糊外侧为 `[72,133,166]`。取消后画面恢复，revision 为 0。验收目录为 `D:/PandaStage-Acceptance/issue-1384/effects-3fx62d`。
- Windows Electron 产品预览的正片叠底采样与编辑舞台一致，均为 `[39,104,111]`，效果草稿取消后 revision 仍为 0。验收目录为 `D:/PandaStage-Acceptance/issue-1384/effects-79VKzL`。
- GitHub 报告 PR 与主线冲突，本轮提交尚无自动 CI 结果。分支为 v41，主线 `06b565f` 为 v46，已包含 #1370 的手动相机、父子级与动画时间联动成果。只读试合显示冲突位于镜头求值、LayerMotionService、LayerService、CanvasStage 和 layerStore。主线兼容与 Schema 版本待集成负责人授权协调。
- OWNER UAT 待验。

工单来源见 [#1381](https://github.com/Cognitive-Architect/panda-stage/issues/1381)、[#1382](https://github.com/Cognitive-Architect/panda-stage/issues/1382)、[#1383](https://github.com/Cognitive-Architect/panda-stage/issues/1383) 和 [#1384](https://github.com/Cognitive-Architect/panda-stage/issues/1384)。
