# Panda Stage P2 生产能力专项研究

日期：2026-11-26。性质：研究结论与待确认的最小实现建议，不是施工授权、测试回执或已锁定规格。

## 1. 范围与基线

依据 [母路线图 #1362](https://github.com/Cognitive-Architect/panda-stage/issues/1362) P2 原文：CAMERA-03 原生 Layer Depth、深度动画与视差；CAMERA-04 相机附着、屏幕空间与命中编辑；PARENT-03 角色部件/Graphic 节点挂接；PARENT-04 空控制层与组织文件夹。JOINT-01 分阶段复用联合场景。动态换父、跨层时钟联动、自动/手工按区间组合属于 P3；光学景深、完整 3D、通用骨骼蒙皮不属于本研究。

Panda 研究固定快照 [56d11d6](https://github.com/Cognitive-Architect/panda-stage/commit/56d11d601dbe390d4a8c5cbcfd98d093db0d918c)，位于 Draft 母 PR [#1370](https://github.com/Cognitive-Architect/panda-stage/pull/1370) 的 `integration/native-creation-p1`。P1 两个基础票、集成补修 #1369 和 #1365/#1366 实施已在该分支；#1371 两个收尾 P2 缺陷待施工/复审。此处的 P2 功能阶段与 P2 缺陷级别不同。母图基线 e5d4fdc 已不足以描述最新 P1 能力；不能在 main 上重复实现 P1。源 PR 与 CI、Windows 实机记录详见 #1370 正文，不把施工者回执视为本次独立实测。

上游固定版本：AniCraft [7512a9b](https://github.com/storytold/anicraft/tree/7512a9bd9d5763ae577255257da6efbd45c250cf)（MIT OR Apache-2.0，见 [Cargo.toml](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/Cargo.toml)）；Flare [073476d](https://github.com/Flare-Animate/Flare/tree/073476dfb83f097a53ded84a2332d742aa84ea8b)（BSD-3-Clause，见 [LICENSE](https://github.com/Flare-Animate/Flare/blob/073476dfb83f097a53ded84a2332d742aa84ea8b/LICENSE)）。Adobe 官方帮助作为产品行为参考；Godot 官方文档作为架构行为参考。需要移植实际代码时保留相应版权许可通知；不引入整套外部引擎。当前会话无可用独立研究子代理入口，直接逐项读取仓库和官方资料。

### P1 已有可复用接缝

- [ShotSchema](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/models/shot.ts#L133-L159) 有手工相机键和普通根层动作键时长约束；[LayerSchema](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/models/layer.ts#L406-L428) 有 parentLayerId、完整仿射 parentSpaceOffset、layerMotionTracks。当前仍无 native depth、screen attachment、part parent target 或控制层源类型。
- [shot-camera.ts](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/shot-camera.ts#L13-L58) 已提供确定性手工相机求值、旧自动模式兼容及二维相机矩阵消费。[StageRenderer](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/renderer/stage/StageRenderer.tsx#L762-L831) 当前整组 camera-world 后嵌 StageLayerSpace，并单独绘制字幕；[CanvasStage](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/renderer/features/canvas/CanvasStage.tsx#L1574-L1596) 同样有全局相机组。[StageLayerSpace](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/renderer/stage/StageLayerSpace.tsx#L6-L14) 已能将完整仿射矩阵转为 Konva Group。
- [applyLayerParenting](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/layer-parent-space.ts#L27-L77) 先求局部根变换，再按 layer id 组合父空间和 offset，检测循环及无效矩阵；[LayerService.setParent/deleteLayer](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/services/LayerService.ts#L1686-L1742) 已有当前位置保持与删除时解除关系。[layer-animation.ts](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/layer-animation.ts#L28-L58) 已将普通根层动作复用到既有轨道机制，但当前可编辑条件是已有父关系/offset/轨道，并非所有普通层天然可落键。
- [正式导出求值与绘制过滤](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/export-renderer/evaluateExportShotAtTime.ts#L13-L39) 已先求全 Shot（含隐藏父层），再按可见性过滤绘制。选中对象输出与整镜头成片已有独立合同；母 PR #1370 回执确认前者跳过镜头相机，需继续保护。
- [原 FLA 相机恢复](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/main/services/fla-static-snapshot-display-list-adapter.ts#L3028-L3130) 独立解释来源 cameraDepth/attached/depth，使用 528.25 焦距约定；[projectFlaInstance](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/shared/fla-instance-projection.ts#L15-L52) 负责 FLA 实例的一阶透视近似。两者不能被原生深度公式覆盖或重复应用。

## 2. CAMERA-03：原生深度、动态视差

### 创作收益

前景树、中景演员、远景山的原图构图不变，推拉/平移镜头后近处移动或放大更多、远处较少。深度本身可以随时间调整（例如道具由前景穿到远景）。这是 2.5D 平面投影，不含景深虚化或三维网格。

### 已核实的上游轮子

[AniCraft camera.rs L21–35、L101–137](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/doc/src/camera.rs#L21-L35) / [投影与附着](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/doc/src/camera.rs#L101-L137)：固定焦距 F=1000，深度为舞台之后的正值、之前的负值。默认相机保持原始构图。令画面中心 m、相机中心 c、倍率 z、旋转 r、深度 d、世界点 p，D=F/z+d，则输出：

`m + R(-r) * ((F+d)/D * (p-m) - F/D * (c-m))`

d=0 直接复用已有普通相机变换；D 太小时平面不再绘制。默认相机下，大小、位置不因深度改变；但深度排序仍可能改变遮挡。示例（只是上游公式推导，不是 Panda 实测）：F=1000、z=1，100px 镜头平移在 d=-400/0/1000 的平面分别产生约 166.7/100/50px 位移。z=2 时对应缩放约 6/2/1.33 倍。

[AniCraft depth_at / set_depth_key](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/doc/src/camera.rs#L188-L247) 实现标量深度键线性插值与两端保持；[draw_order](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/doc/src/camera.rs#L279-L293) 深处优先、同深度保留原顺序、被遮罩层与遮罩一起排序。[cmds_camera.rs](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/engine/src/cmds_camera.rs#L211-L294) 与 [layer_depth.rs](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/src/layer_depth.rs) 提供深度数值、关键帧、附着开关；首次非零帧落键时保留起始深度，移除最后一个键时保留当前值。[ADR 0082](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/docs/adr/0082-camera-depth-attaching-and-colour.md) 明确尚缺深度键缓动、插删帧重定时及符号内部深度，不能把这些能力算成 AniCraft 已实现。

Adobe [Layer Depth / Maintain Size](https://helpx.adobe.com/animate/desktop/workspace-and-workflow/timeline-layers.html) 与 [官方视差教程](https://helpx.adobe.com/id_id/animate/desktop/using/layer-depth.html) 证实主时间轴深度、动态补间、保持对象尺寸/位置的编辑行为。Adobe 的范围与 AniCraft 不同，不能将不同数学合同的数值上限直接混用。Flare 当前已核实的相机求值为平面相机，不把它当已核实的多平面透视实现。

### 推荐最小 Panda 合同（待确认）

1. 新增可选原生深度标量（默认 0）和同一时间网格上的深度键，先复用现有 [AnimationKeySchema/easing](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/models/animationKeys.ts#L5-L38)、[evaluateAnimationTrackAtTime](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/evaluate-animation-core.ts#L39-L76) 与时间轴交互；深度不是 XY/scale 的别名，不必扩大全部角色部件 track property。非零帧首次落键保留起点，插值端点保持，插/移/删键、撤销与时长约束一致。
2. 推荐 AniCraft rest-normalized 投影（F=1000 是可验证的原生初始候选，非必须与 FLA 一致），深度 0 精确保持 P1 相机。使用适合原生合同的有限值、分母及近裁剪规则；不照搬上游 zoom clamp 破坏 P1 手工相机范围。近裁剪仅停止该平面绘制，不能删除工程对象或停止其作为父级的求值。若后续需要独立 Maintain Size 开关，再由实际创作需求确认。
3. 默认无新深度的对象保持旧表现。深度排序只在 Shot 顶层绘制单元发生，稳定以 zIndex 解决同深度；不改变持久 zIndex，不重排 FLA 元件内部遮罩、组、节点。正式背景可参与深度投影，但原 cover 操作不应再次清除 P1 之外的动画；背景移出取景范围按既有裁剪/背景语义处理。
4. 父子空间先求值，之后每层投影。建议未显式设深度的关联子层继承父目标的有效深度，保证手持武器不会随镜头与手分离；未绑定且未设置深度为 0。显式不同深度可用于有意分层，但不是无缝物理挂接，是否在初版开放此覆盖待产品合同决定。绝不能在矩阵继承过程中偷偷将 zIndex 当空间深度。
5. 新增一个共享纯求值的分层投影/排序接缝，供现有 CanvasStage、StageRenderer、产品预览和整镜头输出消费。现有 camera-world 组只能应用一次相机；分层时应按图层有效投影替代该层的全局投影，而不是全局变换后再乘全量投影。复用 StageLayerSpace/完整仿射工具。零深度路径与既有高帧率导出采样合同保持一致。
6. UI 优先复用图层属性与现有时间轴键入口；数值/前中后景滑轨可参考 AniCraft，避免再创建一套时间轴。只在真实需要时新增全局 Layer Depth 面板。

验收建议：静止相机时三层原构图不变；100px 平移、推近、旋转产生可解释的相对视差；动态深度键可拖动、保存重开、撤销；同深度排序稳定、近裁剪不破坏隐藏/父级计算；原 FLA 内部相机与遮罩/九宫格不重复投影；对象资产导出沿既有不受镜头相机影响的合同。

## 3. CAMERA-04：附着到相机、屏幕空间与命中

### 创作收益与参考

把普通图层的标题、计分板、对话框边框、UI 图标等固定在最终屏幕上，相机平移、推拉、旋转时不跟场景移动；其自身动画仍能独立播放。Adobe [Camera > Locking a layer with camera](https://helpx.adobe.com/animate/desktop/multimedia-and-video/working-with-camera-in-animate.html) 官方支持该工作流。[AniCraft Camera::layer_view](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/doc/src/camera.rs#L133-L137) 对 attached 图层返回单位矩阵，[ADR 0082 §4,6](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/docs/adr/0082-camera-depth-attaching-and-colour.md) 描述深度不影响附着层投影、仍按深度排序；相机预览时通过各层视图逆变换进行普通 Selection 移动，其他几何工具尚不支持。不要把“预览可选中”误称为所有工具均可投影编辑。

Panda 当前 [StageRenderer](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/renderer/stage/StageRenderer.tsx#L762-L831) 字幕本就位于相机组之外；[CanvasStage](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/renderer/features/canvas/CanvasStage.tsx#L1638-L1645) 相机视角可选中，却禁用直接编辑。P2 需补齐真实的投影编辑，而非仅新增一个按钮。

### 推荐最小合同

- 增加可选空间标识 world/screen（缺省 world）；screen 对相机及深度投影为单位矩阵，仍保留图层自身位移、缩放、旋转、显隐和独立时钟。字幕现有路径不动，新增屏幕对象可复用原渲染器；建议 screen HUD 绘制在 world 之上且内部按 zIndex，既有系统字幕继续按既有叠层约定。此排序为 Panda 候选产品决定，区别于 AniCraft attached 仍按深度排序，不冒称上游规则。
- 建议以作者画面坐标作为默认屏幕布局，开启附着时不会修改底层关键帧。非默认相机姿态下开关可能改变取景位置；用户可在相机视角调整。若要求切换瞬间保持屏幕位置，可另用现有仿射补偿明确实现，而不是按整轨重写。绑定家族默认处于同一有效空间：附着根节点的后代跟随该空间；若子层要独立切换，优先解除关联/转换为同空间并保持姿态。跨空间直接绑定的语义需要另确认，不默默混用坐标，也不限制其他正常图层。
- 最终映射是 layerProjection × parentSpace × localPose。鼠标位置需先扣除编辑视口变换，再逆过实际层投影和父空间映射回局部；不能只套全局 camera inverse，尤其是非零深度和 screen 层。复用 P1 选中、拖动和 parent transformer；先实现普通命中/拖移及现有变换工具可适配的根层编辑。复杂内部节点/IK 工具暂保留世界编辑回退，能力不足局部降级。
- 独立屏幕模式可以在 CAMERA-03 前验证，不必等待另一线；组合验收需要同一共享分层投影合同。相机附着和深度字段不要求引入全局新状态。

验收建议：画面中央固定 HUD + 随镜头移动的世界演员；同 HUD 自身关键帧仍可动；旋转和非零深度时通过相机视角选中/拖动正确对象，实际修改局部根姿态；旧字幕和对象资产输出正常。保存/重开、撤销、预览及正式视频同刻一致。

## 4. PARENT-03：角色部件与 Graphic 节点挂接

### 创作收益

P1 武器绑定角色 Layer 只能跟随整个演员。P2 武器可绑定演员的手部（或小臂等稳定部件），帽子绑定头部，独立的爆炸/特效层挂在 Graphic 元件内部节点，并随其动作、IK 产生的键、源内部播放状态而动。道具仍是普通外部 Layer，能单独设置 zIndex、动作、显隐，而不是把道具图片合并进角色资源。

### 自有底座优先

- [CharacterPartBaseShape](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/models/character.ts#L304-L317) 有稳定 partId 和 source-local→Character-local 仿射 restTransform；[captureCharacterPartAnimationBasis](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/character-part-animation.ts#L44-L67) 冻结实例动画部件身份/基准/中心；[resolveLayeredCharacterPartTransforms](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/character-part-animation.ts#L78-L117) 已叠加动作及头部 followers；[visualParts.ts](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/selectors/visualParts.ts#L1622-L1737) 计算 Clip/动作、稳定中心、表情和 headDelta 后实际视觉。
- [LayerVisualPart](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/selectors/visualParts.ts#L144-L164) 有 ownerLayerId、partId、imageTransform；但 [imageTransform](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/selectors/visualParts.ts#L1199-L1243) 含 cropToSource/exportScale，不能将替换位图的像素坐标直接当成稳定挂接坐标。要从现有部件最终求值提取规范 part-local→owner-local 姿态（不随资源裁边变化），并正确消费后续头部/动作变换；同一 Character Definition 的不同实例必须独立。
- [evaluateFlaGraphicVisual](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/evaluate-fla-graphic.ts#L526-L647) 已处理节点 path、stable node identity 的轨道查找、实例 override、nested Graphic/MovieClip 内部时钟和矩阵累乘；[EvaluatedFlaGraphicNode](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/evaluate-fla-graphic.ts#L101-L117) 暴露 path/worldTransform/renderable；[正式 LayerVisual](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/selectors/visualParts.ts#L1472-L1521) 使用真实 frameOrdinal/internalTimeMs/overrides。节点 worldTransform 是 Graphic 内部坐标，不是 Shot 世界；需要处理 Definition canvas、中心锚点、节点 viewBox/裁剪与 source frame identity。
- [Graphic structure tree](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/renderer/features/properties/flaGraphicStructureTreeModel.ts#L60-L125) 已投影 occurrence path，可复用选择 UI；节点 id/path 跨帧是否稳定要按现有 stable identity 能力验证，不能把临时索引或裸 Definition 名称当跨帧绑定身份。初版允许明确支持的稳定 group/symbol/节点；无法恢复的 opaque/raster 部分不声称有可挂接内部结构。

### 外部参考和排除

[AniCraft layer parenting ADR 0113](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/docs/adr/0113-layer-parenting.md) 与 [parenting.rs](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/doc/src/parenting.rs#L95-L223) 提供递归、绑定补偿的参考，但其 rig_lead 取父层首元素，不直接等价 Panda 任意稳定 part/node 挂接。[Flare rig eval](https://github.com/Flare-Animate/Flare/blob/073476dfb83f097a53ded84a2332d742aa84ea8b/crates/foundation/flare-rig/src/eval.rs) 可参考先求骨骼姿态后消费目标 InstanceId 的思想；[Flare attachment.rs](https://github.com/Flare-Animate/Flare/blob/073476dfb83f097a53ded84a2332d742aa84ea8b/crates/foundation/flare-document/src/attachment.rs#L1-L39) 实际保存外部格式源文本及稳定 ID 关联，不是运动挂接，排除为此功能轮子。Godot [RemoteTransform2D](https://docs.godotengine.org/en/stable/classes/class_remotetransform2d.html) / [cutout animation](https://docs.godotengine.org/en/stable/tutorials/animation/cutout_animation.html) 展示独立变换与绘制顺序的参考，不需要引入运行时或重写骨骼。

### 推荐最小合同

1. 扩展 P1 稳定父目标的类型（普通 layer、character part、Graphic node），保持 parentLayerId 旧工程兼容，明确迁移与互斥表示，具体字段命名待实现规格。父目标必须包含 Shot 内 owner Layer id + 部件 id 或可稳定解析的 Graphic 实例节点身份，而非单纯 characterId/animationId。循环判定沿 owner layer 边统一处理，不允许两套并行父级关系。
2. 纯求值复用现有根层与部件/Graphic 求值：先得到局部动画、内部时间、稳定部件最终矩阵，再解析 owner 的父链，得到 targetWorld=ownerWorld × targetOwnerLocal。子层 world=targetWorld × parentSpaceOffset × childLocal。当前绑定操作复用 P1 offset 补偿公式（新父逆矩阵 × 旧父空间），t0 画面不跳，不重写已有动画。处理 #1371 预制动作 placement 的边界，避免重复叠加。
3. 最小接入可以是现有求值阶段的局部目标姿态提取与缓存，不由 Konva 临时节点位置、DOM 或素材加载时序决定正式世界。编辑器 0ms 参考姿态、产品预览/正式输出、24fps 内部 Graphic 与高帧率导出时间一致性按既有合同定向验证。不要将整个 visualParts 的资源加载失败变成全 Shot 禁止求值。
4. 目标暂时缺失/源节点换帧/部件被替换时需可解释且可 seek：推荐临时缺失只对该挂接局部退化（例如跟随 owner 根 + 独立、可重现的绑定时基准矩阵），不要依赖上次播放看到的缓存，也不要随便改绑同名节点；编辑删除/解绑时按 P1 保持当前世界姿态。当前可选择有效目标，失效保留可修复身份。具体缺失策略为待确认选择，不承诺全帧稳定。
5. 通过现有父级选择入口增加角色/Graphic 节点展开和挂接目标，舞台仍按外部普通 Layer 处理。先支持 adaptive parts（包含手/头等实际存在的可识别部件）和稳定 Graphic 节点。预制整帧动作如果没有可解析的部件姿态，不虚构手部跟踪；可局部回到根目标。角色内部任意 parentPartId 树、动态拾放、全骨骼不在此节点。

验收建议：两实例共享角色/Graphic Definition，挂接只跟正确实例；手、头或稳定节点在局部关键帧/动作/IK 后运动，道具跟随且独立旋转/播放；父级非等比缩放/镜像完整保留；嵌套 Graphic 内部时间变化、节点短暂缺失、删除与复制粘贴/镜头复制的目标重映射，保存重开、seek、预览及正式导出正确。手持物体默认与主人共享有效深度/空间，若独立深度由用户显式决定。

## 5. PARENT-04：空控制层与按需组织

### 创作收益与成熟参考

创作者可新建一个不需要导入图片的空控制对象，用它带动汽车的车身、车轮、阴影，或一组角色/特效；每个子层仍可独立运动、独立排序。[Adobe After Effects Null object layers](https://helpx.adobe.com/after-effects/desktop/work-with-layers/layer-properties/layer-properties.html) 明确空对象是可动画的不可见父层，编辑时有轮廓和控制手柄，不进入成片。[Adobe Animate layer folders](https://helpx.adobe.com/animate/desktop/workspace-and-workflow/timeline-layers.html) 则强调折叠/展开不改变舞台可见性，文件夹有独立组织用途。Panda 路线图区分组织、绘制顺序与空间关联；不照搬 Adobe 文件夹批量锁定、删除所有子层等行为。

### 已有底座和真实缺口

当前 [LayerSourceSchema](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/models/layer.ts#L272-L277) 仅 asset、character、animation、video 四种真实来源，没有资源为空的控制层。隐藏图片父层已经可控制运动且不会导出（#1366），但仍占素材，不应把透明 PNG 或隐藏虚拟素材当最终持久化方案。[Layer root motion](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/layer-animation.ts#L28-L58)、[P1 父级求值与补偿](https://github.com/Cognitive-Architect/panda-stage/blob/56d11d601dbe390d4a8c5cbcfd98d093db0d918c/src/domain/layer-parent-space.ts#L27-L77) 可复用。重要区别：刚创建的空层没有 parent/offset/keys，现有 canAuthorLayerRootMotion 条件会返回 false；必须允许它自带根层编辑/关键帧能力，而不是先绑到一个假的父级。

### 推荐最小合同

- 增加明确的无素材 Layer 源类型（如 control；命名候选），继续使用同一 Shot Layer、中心位置、旋转、缩放、根层轨道、父目标、事务。历史 schema reader 冻结，不把新源渗入旧版本；项目/IPC/schema 迁移按届时实际兼容性统一。正式背景选择自然排除无视觉来源。
- 无素材不是资源缺失：正式空间求值必须包含控制层；资源解析、准备、StageRenderer、对象图集选择和绘制入口明确无像素输出，不请求图片 URL、无假素材、无缺资源/握手超时。编辑器单独显示可命中的锚点/十字或简单控制轮廓，不将辅助标记送进成片。图层操作、运动轨、复制/粘贴与 delete detach 复用 P1；隐藏/锁定控制层不应隐式停止子层运动。
- 图层面板用“新建控制层”入口及一键选择父目标即可；不创建专门控制器编辑器或另套动画系统。空控制层本身无需深度绘制，后代有效深度/空间仍遵循 CAMERA-03/04 的共同合同。
- 组织文件夹为 PARENT-04 的按需子范围：只有复杂场景图层管理需求明确时才新增组织树/折叠。组织 id 不等于 parent target；将层收纳、折叠、移出或删除文件夹默认不改坐标、运动、可见性和 zIndex，不把文件夹变成空间控制层。建议删除文件夹保留其中图层；批量显隐/锁定/排序若有实际需求作为明确命令而非隐含副作用。初版可以仅交付空控制层并记录组织需求，再决定是否实现文件夹，不把该选择当 P2 全线发布门禁。

验收建议：无资源的控制层可从空工程创建、拖动、旋转、缩放、制作关键帧，带动车身/两轮等多层且轮子独立动画；控制标记只在编辑时出现；删除控制层保留子层及当前姿态，复制/保存重开/撤销正常；视频与透明 PNG 无控制标记或缺 URL；如果实施组织文件夹，折叠与收纳前后成片完全一致。

## 6. 联合合同、依赖与优先级建议

| 节点 | 最优先轮子 | 实际依赖/可并行性 |
| --- | --- | --- |
| CAMERA-03 | AniCraft view/depth_at/draw_order + Panda camera、key/easing、StageLayerSpace | P1 相机稳定；与 PARENT-01 的有效深度规则对齐 |
| CAMERA-04 | AniCraft identity attachment / 逆映射 + Panda camera-world 和字幕组 | 基础 screen 模式可独立；深度组合依赖 CAMERA-03；父级编辑复用 P1 |
| PARENT-03 | Panda 已有角色部件/Graphic 最终求值 + P1 仿射绑定 | P1 父子编辑稳定；与 PARENT-04 可并行，角色动作编辑复用 #1371 修复 |
| PARENT-04 | Panda P1 父级与轨道、隐藏层导出过滤 + AE Null 工作流 | P1 父子编辑稳定；不依赖 PARENT-03 |

统一数学：局部动作/源时钟 → 稳定父目标/世界矩阵 → 有效空间与深度/相机投影 → 顶层绘制排序、现有内部遮罩/合成 → 成片。编辑命中按相反方向换算。父关系、深度、绘制顺序、组织、时钟不混为一谈。

建议先让 CAMERA-03、PARENT-03、PARENT-04 的对应基础工作可并行准备（#1371 收尾与共享文件实际接缝对齐后从最新母分支开工）；CAMERA-04 优先复用 CAMERA-03 的投影接缝，基础 attached 交互可先设计验证。所有后续实施及补修继续进入 #1370 同一母 PR，阶段不单独合 main。没有必要将四节点拆成十几张纯 schema/算法/UI 水平票；可四个竖切片，文件夹若明确延期就记录，不冒称完成。具体拆票和产品选择由 OWNER 后续授权。

JOINT-01 P2：复用一份小型演出工程，三层背景和两到三键手工运镜，绑定角色一只手/小臂的独立道具，一个控制层统一移动两三个对象，一个 screen HUD。检查静止构图、移镜视差、道具不脱手、HUD 固定、子动画独立、相机视角命中、保存重开及代表性正式 MP4/透明帧（复用已有出口，不重复全格式 Windows GUI 测试）。旧 FLA 源相机/遮罩与 P1 隐藏父层/旧工程用最小相关回归，不新增全库门禁。

## 7. 结论和待决策

- 最值得搬的是 AniCraft 的原生多平面投影、深度轨道/顺序和附着层逆映射；最值得直接复用的是 Panda 的 P1 通用父子级、部件与 Graphic 求值及既有根层轨道。
- 最重要的风险不是重新实现数学，而是有效深度、screen/world、部件稳定身份与绘制/资源消费之间的合同。尽量让同一物理挂接链采用同一投影，挂接与组织解耦，避免像素裁剪、源帧换位、根层 action placement 重复叠加。
- 待 OWNER 确认的候选：原生深度单位/默认保持尺寸、子层显式不同深度是否开放、screen 层排序及切换是否保持当前取景、节点缺失的确定性退化、是否实际需要文件夹。此研究不将推荐写成已批准设计。
- 未执行代码修改、运行上游程序/Windows Electron、做新性能测试、创建实施票或修改母图/母 PR 正文。仅源码/官方资料调研，#1371 是否完成需随后独立复审。

```text
=== AUTO SAVE ===
时间：2026-11-26
做了什么（结果）：完成#1362 P2四节点专项研究，核对母PR 56d11d6、AniCraft/Flare实际源码、Adobe/Godot官方文档，形成复用与最小合同建议。
当前状态（一句话）：P2研究输入齐备，P1收尾#1371待验证，P2尚未授权施工。
下一步（唯一可执行）：确认P2关键产品合同，按四节点拆可实施工单。
风险 / 未验证（翻车点）：无独立研究子代理或实机运行；深度与父级/屏幕空间组合、跨帧稳定节点、空控制层资源边界需定向验证；建议不是已批准规格。
=================
```
