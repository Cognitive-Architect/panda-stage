# Panda Stage 父子级关联专项研究（2026-11-26）

## 结论与取样范围

固定 main `472f1c5373ab40437f4454cc2009ca080b94b0ff`，业务基线仍为 `bd38ac3a`。承接[三大核心能力专项研究](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/docs/research/panda-stage-core-workflows-2026-11-26.md)。本次只查父子关系的组织、空间运动继承、时间控制、角色绑定、源 FLA 还原与原生创作边界。

**结论：源 FLA 中的嵌套结构与受限 Rig 父子运动有正式求值代码；人物内部有角色根、专用脸/头跟随及刚性手臂链；Panda 的普通 Shot 图层仍没有通用、可编辑的父子变换关系。父子级关联与手动运镜可以成为后续创作能力的重点。** 这是源码与现有回归合同的研究结论，不代表当前主线真实素材或独立实机验收通过。未运行 Electron/Animate、未重跑测试、未启动独立后台代理。

## 1. 普通 Shot 图层：当前主要是平铺列表

- [Layer 基础模型](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/models/layer.ts#L119-L153) 的 x/y 是舞台视觉中心，含 scaleX/Y、rotationDeg、opacity、visible、zIndex、locked、flipX、startTimeMs。[当前严格 LayerSchema](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/models/layer.ts#L377-L403) 扩展了源帧、播放、Graphic 实例覆盖、源范围和动画 clip，没有通用 parentLayerId、分组/空对象 source 或跨 Layer 约束字段。
- [当前 ShotSchema](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/models/shot.ts#L126-L134) 是 layers 数组。[evaluateShotAtTime](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/evaluate-shot-at-time.ts#L801-L850) 按 zIndex 排序、按单个 layerId 查找事件并求值；[编辑舞台 selector](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/selectors/stageRenderModel.ts) 消费平铺层。没有发现普通 Layer 之间递归 world transform 的正式路径。
- [clip ownership](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/models/layer.ts#L313-L350) 要求轨道和 basis target.layerId 等于所属层。单独角色 clip 可以有多部件轨道，但不是任意多普通 Layer 的父子绑定。[LayerService](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/services/LayerService.ts) 提供图层创建、变换、重排、实例和动画编辑；其中 parentPath 等是 FLA 内部子树路径，不是 Shot 图层 parenting。
- 因此不能把共同播放头、层级顺序、批量设置、相同动画 Definition 或 React/Konva 渲染 Group 当作通用产品父子关系。普通独立人物层、武器层、特效层不能仅靠一个父子绑定令武器随人物移动，同时保有自己的局部动画。当前可通过预先在 FLA 中嵌套、将符合条件的素材拆成同一角色部件、独立关键帧等办法解决部分需求。

## 2. FLA：两种有实质实现的父子关系，以及组织层级

### 2.1 元件容器和嵌套变换

[正式 Graphic 结构](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/models/flaGraphicStructure.ts#L95-L177) 的 group / symbol 节点存 localTransform、children 或 nestedDefinitionId；symbol 有播放方式、源帧与父帧跨度、色变和 blend。 [正式 Graphic 求值](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/evaluate-fla-graphic.ts#L540-L650) 先求当前节点自己的 timeline 轨道/实例覆盖，再 compose(parentEffectiveWorld, localTransform)，递归把有效世界矩阵交给后代；遮罩也依据父矩阵求值。子节点可以在父节点运动同时拥有自己的动画轨道、局部变换及内部选帧。
- [内部 Timeline 模型](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/models/flaGraphicTimeline.ts)、[时间轴编辑器](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/renderer/features/timeline/FlaGraphicInternalTimelineBar.tsx) 支持可编辑目标的变换关键帧；[结构树](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/renderer/features/properties/FlaGraphicStructureTree.tsx) 和 [ChildTransform](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/renderer/features/properties/FlaGraphicChildTransform.tsx) 为受支持的现有层级提供编辑入口。
- 这不是只会截图；现有结构父级的变换确实向下传播。它仍限于 Graphic 内部结构与支持的节点，复杂效果可能局部 opaque 或整帧 fallback；未发现可把任意两个 Shot Layer 拖入此树建立通用绑定，也不宣称可任意改造所有源层级。

### 2.2 源 Animate 图层 Rig（同一时间轴上的兄弟层绑定）

历史 [#730](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/docs/research/issue-730-parent-layer-index-semantics.md)、[#731](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/docs/research/issue-731-rig-parenting-reconstruction.md) 曾调查真实 向右走.fla，确认不能简单忽略 DOMFrame.parentLayerIndex。它们是旧基线研究，不是今日未实现的结论。

当前 [Rig parent 解析](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/main/services/fla-static-snapshot-display-list-adapter.ts#L2227-L2266) 用 DOMFrame.parentLayerIndex 匹配 DOMLayer.layerRiggingIndex，检查合法父层、唯一、非自身；与 DOMLayer.parentLayerIndex 的文件夹/遮罩/引导层含义明确分开。

[Classic Motion 父层求值](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/main/services/fla-static-snapshot-display-list-adapter.ts#L2369-L2414) 取父级在子起点、末点及当前帧的矩阵。[递归求值](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/main/services/fla-static-snapshot-display-list-adapter.ts#L2442-L2560) 把子关键帧从世界空间转换为父局部，插值后乘当前父矩阵；[held/Object Motion 修正](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/main/services/fla-static-snapshot-display-list-adapter.ts#L2560-L2629) 使用父当前矩阵 × 父起始矩阵逆 × 子原变换。已有循环检测、缓存和深度边界（MAX_RIG_PARENT_DEPTH=8，源解析限制）。[回归测试 #1061](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/tests/unit/fla-static-snapshot-display-list-adapter.test.ts#L1727-L1965) 覆盖随父旋转、三层 Rig、静止子跟随父变化、静止父不扰动子、重复求值缓存、深度限制。
- 支持有边界：同一 Classic Motion 区段的父级改变在源码中明确拒绝；某些父层 Shape Tween、Motion Guide、缺帧/不可逆矩阵等不支持。不要把 Animate 任意动态重新绑定宣传为已实现。
- 这是**源 FLA 恢复**中的真正父子运动计算，不等于在 Panda 中可自由创建、改绑、解除跨普通图层的持久 Rig。源解析后的节点可按结果恢复图像/结构；当前正式 Graphic schema 无同级 Rig 父层字段，因此不保证原 Rig 约束在入库后可重新编辑。
- 2.5D 枢轴叠加存在上轮已知修复分支 [#1358](https://github.com/Cognitive-Architect/panda-stage/pull/1358)；固定主线未包含该补修，不将其当作已交付。

### 2.3 Folder、Mask 和 guide 层

[sourceLayerHierarchy](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/main/services/fla-static-snapshot-display-list-adapter.ts#L1135-L1195) 解析文件夹祖先可见性、真正的 Mask 父关系；C01 与 S01-D 还处理跨深度投影和遮罩（[#1258](https://github.com/Cognitive-Architect/panda-stage/pull/1258)、[#1307](https://github.com/Cognitive-Architect/panda-stage/pull/1307)）。这些是组织/可见性/裁剪语义，不等同于父运动矩阵继承。Panda 当前普通层也没有一套通用持久图层文件夹模型。

## 3. 人物：有局部跟随，不是通用骨架树

| 当前关系 | 机制与边界 |
| --- | --- |
| 角色根 → 所有部件 | 角色整体舞台变换 + 角色局部各 Part restTransform；整体移动/缩放/旋转可带动整个角色。 |
| FLA 子树部件 → 自己内部的子节点 | Graphic 内部层级仍可按结构求值，限支持范围。 |
| 脸/嘴绑定 | faceBinding 指向 targetPartId / replacePartIds 和 placement；嘴型指定脸或独立嘴部目标。这是专用视觉替换。 |
| 头部跟随 | headMotionBinding 指定部件列表；分层身体动作的 headAnchorPartId 产生前后矩阵 delta，乘到脸嘴/头部 follower 上，脸嘴保持自身演出。 |
| 手臂 IK | 2–3 节刚性链、关节与角度限位，按末端目标计算角度和位移，再对各部件写入当前关键帧。不是运行时通用多链约束，也不自动跟随任意手持道具 Layer。 |
| 动作映射 | 跨角色源/目标部件、镜像、位移比例和支点偏移，复制/生成目标动作，不是持久父子关联。 |

依据：[角色 Part 模型](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/models/character.ts#L304-L318) 中 restTransform 是 source-local → Character-local，不是 parent-part-local；[face/head binding](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/models/character.ts#L520-L541)；[分层动作跟随](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/character-part-animation.ts#L70-L117)、[单 Part 运动](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/character-part-animation.ts#L144-L176)；[角色视觉消费](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/selectors/visualParts.ts)；[CharacterArmChainSchema](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/models/character.ts#L946-L955)、[IK 写键](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/services/CharacterArmIkService.ts#L118-L155)。

Part 无通用 parentPartId。不是说没有任何层级/骨骼能力：角色整体和专用跟随已实现；但任意躯干→上臂→小臂→手→道具、挂接对象到任意角色关节、自动继承独立部件运动的通用可编辑树尚未形成。Composite node id 的 root/body/face/head 枚举也不代表所有节点都支持独立动画；[当前 capability](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/character-node-animation.ts#L50-L67) 明确是 Composite face 与 Adaptive part:*。

## 4. 动画时间：共享时刻 != 父子时钟

- [源 Graphic 规则](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/shared/fla-graphic-playback.ts) 与 [内部时间求值](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/evaluate-fla-graphic.ts#L397-L439) 支持在父帧跨度内按子起止帧、循环、单帧、正反向等选择画面；嵌套 MovieClip 独立时钟与 stop() 按 #1258 支持子集。子动画可以跟随父元件时间语义，或按元件类型独立。
- 普通 Layer 的起点、sourceRange、loop/once/hold/hide 分别存储，所有层使用 Shot 当前时间，不存在另一个 Layer 作为时钟源的字段。
- [循环 UI](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/renderer/features/properties/AnimationSourceLoopControls.tsx) 有“同步至图层”；[applySourceLoop](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/services/LayerService.ts#L1602-L1638) 实际按 zIndex 连续范围，只给相同 animationId、未锁定、有 playback 的层写相同循环范围与 loop，遇不匹配停止。它不改 startTimeMs，不保证不同起点同相，更不是持续父子链接。
- [动作配方](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/domain/actions/action-recipe.ts) 把若干动作按 offsetMs 施加于当前目标，是一次编排；不是父动画开始/结束触发任意子动画的规则。
- 推荐产品上明确区分：空间 parenting 默认只继承空间，孩子自己的时间继续；需要同步、暂停/循环或触发子动画时再提供单独的时间关联，不把它强行绑成一种语义。

## 5. 建议的最小补齐路线（尚未实施/未建票）

| 优先 | 功能 | 最小可行范围 |
| --- | --- | --- |
| 1 | 普通图层父子变换 | 可指定同 Shot 父层；父位移/旋转/缩放继承，子保留独立局部变换和自己的动画；绑定/解除默认保持当前画面位置（keep world pose）；拒绝实际有害的循环、自指、失效父关系；删除父层默认解绑定保留子层；绘制顺序仍独立。 |
| 2 | 部件/元件节点挂接 | 基于同一变换求值语义，将道具挂到角色手部、头部或受支持 Graphic 节点；使用已有稳定 partId 或 nodePath，不为第一版另造通用骨骼系统。 |
| 3 | 图层组织 | 需要时提供可折叠文件夹/空控制层；组织与变换绑定可独立，避免“把层拖进文件夹就改变运动”的隐式行为。 |
| 4 | 动态重绑/时间关联 | 真实需求出现后再补拾取/放下（关键帧切换父层）、子动画同步/触发等；先不全做。 |

复用优先：[shared affine matrix](https://github.com/Cognitive-Architect/panda-stage/blob/472f1c5373ab40437f4454cc2009ca080b94b0ff/src/shared/affine-matrix.ts)、Graphic world/local 组合、Rig 的 parent pose delta 和循环检测经验、角色头部 follower 的变换组合、统一 evaluateShotAtTime 和正式消费路径。不要将 FLA XML 特定求值器直接移植成原生 Project 数据模型，也不要建第二套动画时钟。对普通层中心坐标和非均匀缩放造成的 shear，实施时应显式处理；第一版可以对无法精确表达的编辑提供局部降级，而非全局限制。重绑、拖动、保存重开、Undo/Redo 和导出复用既有事务与测试。

产品场景：人物整体移动时武器跟随，武器自身仍发光；汽车移动时轮子跟随，轮子独立旋转；身体倾斜时头和手跟随；头部动画时帽子跟随内部头部而不是整个角色。相比另造全骨骼系统，前两项先解决高频纸片人制作任务。手动运镜与 parenting 是两个独立但互相增益的能力；已有图层层级不等于相机关键帧。

## 验证与存档

本轮仅静态源码与回归合同研究。未独立跑测试、复现历史 向右走.fla、复审未合并 PR 或执行 Windows GUI；不把现有回归测试名称当当前实测结果。按 Research 目录惯例新增本文，不修改业务代码、Issue 或 PR。

```text
=== AUTO SAVE ===
时间：2026-11-26
做了什么（结果）：固定 main 472f1c5，核对普通Layer/Shot/Clip模型、FLA嵌套与源Rig、角色专用跟随/IK、循环批量设置及相关回归；明确通用父子关系缺口与最小补齐顺序。
当前状态（一句话）：源FLA与角色专用层级已有基础，Panda原生跨图层及任意部件父子绑定尚未形成通用能力。
下一步（唯一可执行）：若进入设计，先确定普通图层父子绑定的最小产品合同：绑定/解绑保持画面、继承空间、子动画独立。
风险 / 未验证（翻车点）：未跑实机或测试；源Rig动态换父受限；2.5D枢轴补修未纳入固定主线；不将批量循环同步或源FLA还原当原生父子编辑。
=================
```
