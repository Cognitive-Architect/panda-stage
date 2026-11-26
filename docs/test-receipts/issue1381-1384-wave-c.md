# AN Wave C 首批交付与验证记录

工单范围为 #1381–#1384。交付分支为 `fix/issue-1262-a00`，首批代码截至 `29149ea018abf6bc3006d390a994c208f3cade17`。集成 PR 保持 Draft。 [PR #1265](https://github.com/Cognitive-Architect/panda-stage/pull/1265)

## 已提交范围

| 工单 | 已提交 | 待完成或待验 |
| --- | --- | --- |
| #1381 | 图片批量改名、用途和关键词、未引用候选。图层批量改名、Graphic 安全复制、锁定、解锁、删除和中性动画中心点重置。属性曲线面板支持选段复制、显示冲突数量并确认覆盖的粘贴、内部落键和删除，以及现有移动、拉伸、保持。粘贴保护区段外的帧与稀疏属性。动画片段沿用选中实例的源帧范围与播放设置。#1376 的失效属性草稿有两轨 Undo 回归。 | 主线 v46 的文字、颜色、视频和音频组合待授权集成后验证。物理批量清库、定义独立复制、文件夹树、多层转元件、复杂播放类型转换和有动画时的保姿态换轴保留在候选池。 |
| #1382 | 数值面板与舞台控制点同步，支持新建和固定两端的 X/Y 区段替换，可按选段重新拟合控制点。只写既有属性轨。定向回归覆盖非中心 pivot、旋转缩放、原曲线边界切片和草稿失效。 | 现代 Graphic 样本在 500ms 的舞台、保存重开、产品预览和正式 MP4 画面一致。另一个迁移后的结构素材在 Bake 前后均出现产品预览首帧无法显示。 |
| #1383 | 编辑舞台与产品预览共用实例效果草稿，支持混合、模糊、外发光、剪影、描边和局部区域羽化。取消可恢复原画面，保留工程与 History。独白黑幕使用可覆盖画布的已导入不透明黑图，按区段放在最上层角色下方，结束自动收起。 | 效果字段与迁移需协调 Schema，确认写入、清除持久化效果与正式导出待接通。带硬遮罩的实机组合和 C03 分屏/转场待定。真实时域运动模糊保留待实际样本。 |
| #1384 | 角色动作模板提供瞬移、发抖、晃动，以及绑定头部的点头、摇头、抬低头、丝滑摇头。复用原生 Move/Shake 事件与分件动作。现有表情可带淡变切换，已有整体烘焙动作可作区段外观并在结束时恢复。短腿走跑写入原生分件动作，位移版附加普通 Move 事件。 | 短腿素材已完成原地走路与带位移跑步。长腿素材仍待确认可编辑的双腿分件或完整走跑动作。新烘焙外观入口、头身动作的正式输出和 OWNER UAT 待验。 |

## 验证记录

- 本地自动化通过 TypeScript 检查和本轮修改文件 ESLint。范围回归包含选段缓动、轨道边界、批量操作依赖、素材引用和角色模板。图层运动、缓动持久化、角色动作历史、图片元数据共四个定向集成文件通过，19 个用例。
- Windows Electron 使用真实 Graphic 与角色，两个画布宽度对应 1065px、1920px，拖动后数值同步。预览草稿保留 revision，确认生成普通 X/Y 关键帧。已绑定头部的角色完成丝滑摇头预览和确认。验收目录为 `D:/PandaStage-Acceptance/issue-1384/run-u9GdVY`。
- Windows Electron 的现代 Graphic 样本确认保存、重开和三端一致性。500ms 代表帧的四边像素偏差均小于 3 个逻辑像素，正式 MP4 使用既有导出流程。验收目录为 `D:/PandaStage-Acceptance/issue-1384/run-ykkZFr` 和 `D:/PandaStage-Acceptance/issue-1384/preview-exact-KMGupd`。
- Windows Electron 批量操作覆盖两个真实 Graphic 实例和两张图片。复制沿用定义，Clip track 写到新 Layer ID。两条图层经删除确认后，一次 Undo 恢复。验收目录为 `D:/PandaStage-Acceptance/issue-1384/run-DQv9bw`。
- Windows Electron 效果采样的原始重叠 RGB 为 `[140,144,116]`，正片叠底为 `[39,104,111]`，描边外侧为 `[148,64,96]`，发光外侧为 `[78,149,188]`，模糊外侧为 `[72,133,166]`。取消后画面恢复，revision 为 0。验收目录为 `D:/PandaStage-Acceptance/issue-1384/effects-3fx62d`。
- Windows Electron 产品预览的正片叠底采样与编辑舞台一致，均为 `[39,104,111]`，效果草稿取消后 revision 仍为 0。验收目录为 `D:/PandaStage-Acceptance/issue-1384/effects-79VKzL`。
- Windows Electron 使用真实组合角色通过表情淡变的预览、一次确认、保存重开、产品预览和正式 MP4。500ms 完成表情切换时画面全黑，1000ms 恢复显示角色。确认前 revision 保持，保存后的角色定义与原定义一致。验收目录为 `D:/PandaStage-Acceptance/issue-1384/appearance-MtUdOw`。
- 短腿样本来自本地 AN06。复制到验收工程后，仅显示第 5/4/7 和第 9/8/25 号部件，Windows Electron 中可独立渲染两侧的大腿、小腿和脚。源角色未改动。验收目录为 `D:/PandaStage-Acceptance/issue-1384/legs-XY7u8g`。长腿候选调查仅找到黑衣素材的腿部组合时间轴，尚无独立关节或完整走跑的证据。
- Windows Electron 在真实短腿角色上分配两侧大腿、小腿、脚及脚部跟随部件，完成原地走路和带位移跑步的预览、一次确认和保存。每段保存为 20 条原生属性轨，走路首尾关键帧值一致。跑步一周期位移约 66.94 个逻辑像素，支撑段按作者帧采样，脚部横向漂移约 0.05 个逻辑像素。验收目录为 `D:/PandaStage-Acceptance/issue-1384/legs-e08wyp`。五套长腿外观候选的验收接触表显示腿与身体或服装组合，待找到有独立髋、膝、脚分件的素材。
- Windows Electron 使用真实组合角色、黑图及下层红色图层验证独白黑幕。预览时工程 revision 不变，一次应用后保存重开与产品预览均能显示黑幕。正式 MP4 在区段内的采样为 `[0,0,0]`，结束帧恢复下层红色 `[252,0,0]`，角色定义保持一致。验收目录为 `D:/PandaStage-Acceptance/issue-1384/blackout-hZi5YX`。
- GitHub 报告 PR 与主线冲突，本轮提交尚无自动 CI 结果。分支为 v41，主线 `06b565f` 为 v46，已包含 #1370 的手动相机、父子级与动画时间联动成果。只读试合显示冲突位于镜头求值、LayerMotionService、LayerService、CanvasStage 和 layerStore。主线兼容与 Schema 版本待集成负责人授权协调。
- OWNER UAT 待验。

工单来源见 [#1381](https://github.com/Cognitive-Architect/panda-stage/issues/1381)、[#1382](https://github.com/Cognitive-Architect/panda-stage/issues/1382)、[#1383](https://github.com/Cognitive-Architect/panda-stage/issues/1383) 和 [#1384](https://github.com/Cognitive-Architect/panda-stage/issues/1384)。

## #1386 定点收尾

- 源码与施工方定向验证。批量中心点的按钮与 History 文案已恢复。位置、旋转双轨中，Undo 移除旋转轨后，曲线面板保留失效提示，普通关键帧时间、数值、插值、贝塞尔手柄及选段改时均无法写入备用位置轨。回归比对 Project、revision 与 History，显式重选后可编辑，18 个缓动预设与直接应用仍可用。头部模板只选可编辑的显式绑定部件。独立身体跟随锚点不再成为候选。组合回归覆盖现有表情切换、张嘴、身体及同角色另一实例。
- 本地自动化。相关缓动面板 8 项、基础模板 3 项、头部与脸嘴组合 1 项、走跑 1 项、批量改时／Graphic v2 复制／曲线路径 3 项、舞台缓存签名 28 项通过。改动 TypeScript 文件的定向 ESLint、`pnpm typecheck` 与含类型检查的 `pnpm build` 通过。
- 施工方 Windows Electron。修复前，AN06「朱孝天女儿」在 1958ms 仍屈腿，2000ms 突然切回站姿。原生分件动作现在以静止姿势进入与退出，起步与收步保留膝踝连接及原有循环节拍。样本用非中心大腿 pivot，分别在正向和镜像下完成原地走路、带位移跑步、保存重开及 1500ms 产品预览。正向正式 MP4 完成，抽取 42ms、1500ms、2000ms 三张代表帧。验收目录为 `D:/PandaStage-Acceptance/issue-1386/gait-boundary-WzJZT6`、`D:/PandaStage-Acceptance/issue-1386/legs-xyyM1q` 与 `D:/PandaStage-Acceptance/issue-1386/legs-F6aHN7`。
- 真实短腿样本的正式求值补验。正向和镜像分别覆盖原地／位移走与跑，共 8 组。首帧腿部局部矩阵连续，结束前 1ms 至结束帧的局部平移变化小于 1 个逻辑像素。重复周期同相位值相等。走／跑位移的支撑段横向漂移分别约 0.025／0.048 个逻辑像素。原地模式按设计保留跑步机式脚部运动。回执为 `D:/PandaStage-Acceptance/issue-1386/short-leg-mode-matrix.json`。
- 交付及待验。GitHub 仍报告母 PR 与主线冲突，无自动精简 CI 结果。主线 v46 的相机、坐标、迁移及 Graphic 复制／生成组合待授权集成后验收。主线已存在 Graphic 内部 blend、颜色及遮罩能力，尚无等价的全 Layer 实例正式效果字段。C04 的提交、清除持久化、Undo/Redo、正式 MP4／PNG 及结构 Graphic 组合待 Schema 协调。现有独白黑幕回执仍有效。OWNER UAT 待执行。

### #1386 长腿样本

- 使用本机 Adobe Animate 样本 `LayerParenting_Walkcycle.fla`。验收副本重封 ZIP，原归档与原始图稿保持原样。复用 Panda Stage 的 FLA 显示列表与 SVG 生成，按原始大腿、小腿、脚踝与鞋的比例搭建中性站姿。该回执覆盖 Panda Stage 对这些真实分件生成的动作，原 FLA 父子链与动画曲线的导入保真另属导入流程。
- 源码与本地正式求值。对真实分件样本测试正向／镜像、原地／带位移、走／跑共 8 种组合。左大腿使用非中心 pivot，连续双周期的同相位通道一致。首帧腿部局部矩阵连续，收步前 1ms 至结束帧局部平移变化最大 0.47 个逻辑像素。带位移的走／跑每周期约 138.16／244.91 个逻辑像素，采样支撑段脚横向漂移最大为 0.093／0.165 个逻辑像素。原地模式根位移为 0。回执为 `D:/PandaStage-Acceptance/issue-1386/long-leg-mode-matrix.json`。
- 施工方 Windows Electron。真实长腿素材的正向、镜像样本均在编辑器中配置 8 个腿部部件，预览、应用原地走路及带位移跑步，保存重开后核对动作和收步，并在产品预览定位到 1500ms。非中心 pivot 下正向／镜像各跑一周期，根位移为 +244.91／−244.91 个逻辑像素，支撑段脚横向漂移约 0.165 个逻辑像素。正向正式 MP4 已完成，42ms、1500ms、2000ms 代表帧可解码。验收目录为 `D:/PandaStage-Acceptance/issue-1386/long-leg-dlx6Kq` 和 `D:/PandaStage-Acceptance/issue-1386/long-leg-NogDXp`。

- C06 外观组合补验。定向测试覆盖现有身体分件动作播放期间进行表情淡变，750ms 切换时透明度为 0，875ms 恢复至 50% 且现有张嘴提示生效，1000ms 恢复完整显示新表情。身体动作、角色定义和另一实例保持一致。
