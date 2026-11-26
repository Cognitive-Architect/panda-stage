# Panda Stage P3 高级创作专项研究

日期：2026-11-26。性质：基于源码和官方资料的研发建议，不是已批准规格或施工验收回执。

## 1. 研究范围与固定基线

依据 [母路线图 #1362](https://github.com/Cognitive-Architect/panda-stage/issues/1362) P3 三个节点：CAMERA-05 自动跟随与手工运镜按区间组合；PARENT-05 动态换父、拾取放下及交接；PARENT-06 可选动画时间关联与联动。JOINT-01 按阶段复用真实演出场景。P3 重点是时间上的控制关系，而非重建 P1/P2 空间底座。

本次固定 [Panda 056a4c3](https://github.com/Cognitive-Architect/panda-stage/commit/056a4c3ca5e354c0508561999039b82b0dfdbc09)（Schema v45），位于 [Draft 母 PR #1370](https://github.com/Cognitive-Architect/panda-stage/pull/1370) 的 `integration/native-creation-p1`。P1 #1363–#1366/#1369/#1371 和 P2 #1372–#1375/#1377 已有实施及复审记录；#1377 最新自动 CI [45788284782](https://github.com/Cognitive-Architect/panda-stage/actions/runs/45788284782) 成功、[施工方联合实测回执](https://github.com/Cognitive-Architect/panda-stage/issues/1377#issuecomment-7187535366) 已有。人工 GUI / OWNER UAT 与真实多关键帧 FLA 身份连续性仍待验，组织文件夹按约定延期。不将这些状态写成重新独立实测。本研究不触及未授权的旧 FLA 源恢复、全 3D、通用骨骼、通用脚本/事件运行时、多机位或高级相机特效。

上游固定参考：AniCraft [7512a9b](https://github.com/storytold/anicraft/tree/7512a9bd9d5763ae577255257da6efbd45c250cf)（[MIT OR Apache-2.0](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/Cargo.toml)）；Flare [073476d](https://github.com/Flare-Animate/Flare/tree/073476dfb83f097a53ded84a2332d742aa84ea8b)（[BSD-3-Clause](https://github.com/Flare-Animate/Flare/blob/073476dfb83f097a53ded84a2332d742aa84ea8b/LICENSE)）。官方 Adobe、Unity、Blender、Godot 文档是产品行为及数学参考，并非可直接复制的 Panda 实现。按实际移植范围核对许可与版权通知，不引入整套外部引擎。本会话无独立研究子代理入口，直接阅读主来源完成。

## 2. CAMERA-05：自动跟随与手工运镜组合

### 已有底座与真实缺口

- [ShotCameraSchema](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/models/shotCamera.ts#L5-L26) 只有 static / speaker-focus / manual 三种整 Shot 模式，持久化一条手工相机键轨。
- [evaluateManualCamera / prepareShotCamera](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/shot-camera.ts#L21-L54) 已分别消费手工曲线及自动计划，只有整镜头模式分派；[编辑键](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/shot-camera.ts#L74-L139) 的 setShotCameraKey 会强制写 manual，moveShotCameraKey 也只允许 manual，组合模式要修这些真实接缝，不重新写关键帧编辑器。
- [自动相机目标](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/resolve-speaker-focus-camera.ts#L65-L112) 消费父链及有效深度后的世界锚点，保留 1.5x、250ms、不追逐 Shake、边界 clamp、屏幕/近裁剪回退。[自动计划](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/resolve-speaker-focus-camera.ts#L143-L199) 已按边界构造过渡并二分查找，任意 seek 不需要顺播重演。[camera-projection.ts](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/camera-projection.ts) 是 P2 共享投影数学。
- 产品预览 [ProductPreviewOverlay](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/renderer/shell/ProductPreviewOverlay.tsx#L522-L522) 和正式输出 [ExportRendererApp](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/export-renderer/ExportRendererApp.tsx#L229-L229) 已消费 prepareShotCamera；但 [CanvasStage](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/renderer/features/canvas/CanvasStage.tsx#L404-L410) 仍仅 manual 时 evaluateManualCamera，[ShotCameraControls](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/renderer/features/canvas/ShotCameraControls.tsx#L50-L66) 只在 manual 展示对应入口。P3 应统一组合模式消费，不让编辑器、成片分歧。

### 可参考的成熟实现

- [Flare camera_at / camera_view](https://github.com/Flare-Animate/Flare/blob/073476dfb83f097a53ded84a2332d742aa84ea8b/crates/foundation/flare-eval/src/camera.rs#L8-L37) 在时间区间求值手工相机并插值；[AniCraft camera.rs](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/doc/src/camera.rs#L1-L35) 使用特殊相机层和确定性帧求值。两者是现有 P1/P2 的复用参考，本次未找到固定版本中直接可搬的 speaker-focus 与手工接管组合。
- [Unity Cinemachine Timeline 2.6]（https://docs.unity3d.com/ja/Packages/com.unity.cinemachine%402.6/manual/CinemachineTimeline.html）描述时间轴覆盖相机控制，并在时间轴控制结束后归还；[CinemachineBrain.SetCameraOverride]（https://docs.unity3d.com/ja/Packages/com.unity.cinemachine%402.6/api/Cinemachine.CinemachineBrain.SetCameraOverride.html）提供 A/B 相机及权重，且 Timeline override 高于普通相机优先级；[CinemachineBlend]（https://docs.unity3d.com/ja/Packages/com.unity.cinemachine%402.6/api/Cinemachine.CinemachineBlend.html）以归一化时间曲线确定权重。借鉴区间接管/归还和单一最终相机状态，不引入虚拟相机栈或游戏帧更新。
- [Adobe Camera]（https://helpx.adobe.com/animate/desktop/multimedia-and-video/working-with-camera-in-animate.html）作为已有运镜工作流参考，不据此宣称 Animate 提供 Panda 的说话人自动相机。

### 推荐最小合同（待 OWNER 确认）

1. 保留现有三个整镜头模式语义。新增明确的组合模式（字段命名候选 hybrid），以 speaker-focus 为默认，支持在同 Shot 持久化不重叠的手工覆盖区间 `[startMs,endMs)`，区间之外自动相机照常演化。每区间可设入/出过渡时长及现有 easing（默认可沿用 250ms，0 为明确硬切）；短区间按长度缩短过渡，不出现权重反转。初版不做加法偏移、多虚拟相机或任意混合栈。
2. 在任意 t 分别求 A(t)=自动相机、M(t)=手工相机；由覆盖区间边界得权重 w(t)，对 centerX/Y、zoom、rotation 一次插值，输出一个 CameraView。示意 w=min(入场权重,出场权重)，在入/出用既有 easing，完整接管时 w=1。zoom 保持正值；角度在交接处选择相邻等价角以避免无意转圈，但保留手工轨已明确作者的多圈旋转，不能每帧随意取模后丢掉旋转意图。过渡时不再次对手工部分施加自动 clamp；屏幕层仍单位投影，深度及排序继续用 P2 正式公式。
3. 复用一条现有手工键轨；创建接管区间时按需要采样切换位置并建立边界键，保证新建时可从当前构图开始编辑；明确区间内曲线与其他区间的边界行为。现有手工关键帧不被覆盖/删除，只在区间启用。新增/移动/删除键须保留 hybrid 模式，不能让 setShotCameraKey 退回整镜头 manual。
4. 扩展现有相机时间轴/属性入口：组合模式、手工接管段、增删移区间、过渡时长及已有相机键编辑。世界相机工具与相机视角直接编辑仍复用 P2 投影逆映射。至少让混合模式的舞台、产品预览、正式输出共用 prepareShotCamera；旧 static/auto/manual、旧 session fallback 和选中对象资产输出不改变。旧纯自动的舞台预览是否同步扩展可作为最小同源接入，不改其作者坐标编辑默认。
5. 相机只消费最终世界状态。动态父关系及联动时间若在同批接入，应通过正式 Shot 求值自然得到，不从相机反向改写场景。无需新建相机求值运行时。

验收建议：自动跟拍 A→手工全景/推近/旋转→自动跟拍 B；入/出连续、显式硬切、短区间、多个不重叠区间、保存重开与 Undo/Redo；同一时刻任意 seek、顺序播放、舞台、产品预览及整镜头输出一致。包含非零有效深度演员、屏幕 HUD、旧自动无唯一说话人回退、手工 zoom<1 与多圈旋转；已有 FLA 源投影和对象资产输出不退化。

## 3. PARENT-05：动态换父、拾取放下与交接

### 上游证据及自家轮子

- Adobe [Timeline layers / Layer parenting]（https://helpx.adobe.com/se/animate/desktop/workspace-and-workflow/timeline-layers.html）明确 parenting 是子图层关键帧的属性，可在关键帧解除或改父；新版传播 scale/skew/flip。这是动态关系的直接产品行为参考。
- [AniCraft ADR 0113 §Not yet](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/docs/adr/0113-layer-parenting.md#L131-L135) 明确仍是一整条时间轴单一父级，动态换父未实现。[静态 keep-world](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/docs/adr/0113-layer-parenting.md#L64-L91)、[递归父空间](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/doc/src/parenting.rs#L95-L223) 可参考，不能冒称已有动态换父轮子。
- Blender [Child Of Constraint / Set Inverse]（https://docs.blender.org/manual/en/3.6/animation/constraints/relationship/child_of.html）通过可动画 influence 切换父约束，Set Inverse 抵消新父变换。其全部变换通道开启时采用矩阵乘法；借鉴离散交接和逆矩阵补偿，不引入 Blender 多约束/加权混合或复制 GPL 代码。
- Panda [LayerService.setParent/deleteLayer/duplicateLayer](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/services/LayerService.ts#L1731-L1881) 已在当前时刻保世界姿态，使用固定 parentSpaceOffset，解除时保留有效深度和空间；但修改的是整个 Layer，不是某一段。[layer-parent-space](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/layer-parent-space.ts#L16-L107) 的候选选择、循环检测、深度/空间继承均读取静态 parentLayerId。[layerAttachmentWorldMatrix](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/layer-parent-space.ts#L110-L121) 已包含部件最终姿态及角色动作 placement。
- [layer-attachment.ts](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/layer-attachment.ts) 已支持普通分件目标、Graphic identityPath/ownerLocalFallback。#1377 复审记录的源 FLA 地址含关键帧 span/元素索引边界仍存在（[source address](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/main/services/fla-static-snapshot-display-list-adapter.ts#L3297-L3303)）。P3 使用可靠既有目标，不假称所有跨 FLA 源关键帧都能稳定追踪。

### 推荐最小合同（待确认）

1. 原有静态父关系保留为首个动态键之前的基础状态；新增可选的离散父目标键序列（例如 parentKeys），每项包括帧网格 timeMs、显式 parent owner 或 null、可选部件/Graphic 目标及完整 affine 补偿、必要的空间/深度保持信息。null 表示该段解除；键从该时刻起生效，直到下个键。没有动态键的工程原行为不变。保持一个当前有效父目标，不做多父权重、物理抓取或重写全条历史轨迹。
2. 统一解析每个 Layer 在 t 的 active parent state，再复用 applyLayerParenting 的图遍历、最终部件矩阵、有效深度/空间和原生动作轨。新关系必须在同一 Shot；显式切换不覆盖原静态数据。循环检查以该时刻有效边为准，并针对候选改动区间内相关切换边界检查；不可将不同时刻的边合成一张静态图而误判合理交接。无效关系只局部降级。
3. 交接时以同一 t0 的局部姿态求旧关系和新父目标世界矩阵，不以 t0-1 的采样位置冒充 t0 旧状态。令旧有效父空间 S_old(t0) 已包含旧补偿，新目标最终世界矩阵 P_new(t0)，则新常量 C_new=inv(P_new(t0)) × S_old(t0)。解除时 P_new=I，C_new=S_old(t0)。新段 S(t)=P_new(t)×C_new，子层 W(t)=S(t)×L(t)，因此边界 W_new(t0)=W_old(t0)，子层局部键不重写。保留完整 shear、flip、非等比缩放以及 P1/#1371 动作补偿。不可逆目标只拒绝本次无法保持姿态的操作。
4. 常量补偿在新增/换目标或移动相应交接键时以目标时间重新求取。编辑既有父运动会改变创作意图，建议保留已记录的其他段补偿，提供对当前交接键重新保持姿态的轻量操作；不得在每次播放从历史帧重演或自动重写整条旧轨。对删除/移动交接键明确检查下一交接点并可定向重新对齐。若产品要求自动维护后续交接点，先验证实际需要，再在编辑事务中更新受影响键，不变成运行时全历史求值。此为需确认的编辑语义。
5. P2 组合边界：在相同有效 world/screen 和深度的父目标间，可同时保持世界与成片姿态。解绑应复用 #1377 冻结当前继承深度/空间的合同，应用于新段，不改写之前的段或独立深度轨。换父若有效深度不同，世界保持不自动保证相机投影保持；推荐默认同平面交接，对跨深度提供明确保留当前深度/采用新父深度的选择（保留深度可出现和新父不同视差；采用新深度允许构图变化），不能假装两者同时成立。初版跨 world/screen 仅在明确转换后进行，局部提示，不阻止正常同空间交接。真正的跨空间保屏幕姿态另有逆投影需求，不提前扩展。
6. UI 复用 [LayerParentControl](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/renderer/features/properties/LayerParentControl.tsx)、舞台选父和既有时间轴；区分“静态绑定”与“在此帧切换父级”，提供绑定/解绑/交接键增删移、当前有效目标及简单时间标记。不要另建骨骼编辑器。已有 [canAuthorLayerRootMotion](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/layer-animation.ts#L28-L30)、LayerStore、舞台变换及背景转换等需要识别动态关系（不能只检查静态 parentLayerId）。子层独立动画、显隐、zIndex 不因换父自动改变。
7. 删除父层应处理所有引用它的段；对当前有效段复用当前时刻 keep-world，其他受影响段以各段边界冻结可求得的姿态/深度并明确已解除，不保证完整旧世界轨迹仍然播放。镜头复制映射所有段 owner id；同镜头复制保持有效引用；跨镜头复制初版可沿 P1 规则在复制时刻解除外部父目标并冻结当前有效空间、深度（明确不把外镜头动态关系带入）。切换成背景时同时清理动态父关系，保留 #1371 既有清理语义。Shot 时长及帧网格校验、Undo/Redo、保存重开与旧 reader 一起接入。

验收建议：道具先独立置于桌面，t1 绑定 A 手部（无跳变），t2 绑定 B 手部（无跳变），t3 放下回到独立空间；每段子级独立旋转或播放，先前区间没有被新键重写。包括非等比/镜像、空控制层、稳定 Graphic 目标暂时缺失、深度继承与解绑、同一时刻的多层关系循环/合法跨时交接、删除/复制/移动交接键、保存重开/撤销，以及随机 seek 和正式输出。使用真实手部可稳定识别的分件角色做主场景；真实 FLA 作为定向补充，不把全 FLA 身份恢复当 P3 门禁。

## 4. PARENT-06：可选动画时间联动

### 真实现状

- [Layer playback schema](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/models/layer.ts#L108-L120) 具备 once/loop/single-frame、hold/hide；[resolveAnimationPlaybackFrameState](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/evaluate-shot-at-time.ts#L196-L294) 把 Shot 时刻和起点转换为源帧与内部时间，保护 24fps 网格与连续时间；[resolveAnimationSegmentFrame / findGraphicPlaybackAtTime](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/evaluate-shot-at-time.ts#L343-L432) 支持源范围及半开播放区间。已有 Graphic 内部嵌套时间和 [源 Graphic 播放](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/shared/fla-graphic-playback.ts) 保留。
- [TimelineEvent schema](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/models/timeline-event.ts#L197-L263) 已有角色动作区间、Graphic 帧切换和 graphic-playback（startMs/endMs/playbackStartMs/range/firstFrame/playback）。每个事件有稳定 event.id、layerId；[正式求值](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/evaluate-shot-at-time.ts#L830-L879) 已按 Shot 时刻选择 character-action，按事件开始时间取得动作内部时间；[pretrack](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/evaluate-shot-at-time.ts#L519-L549) 通过区间解析 Graphic 源时钟，并以 graphic-playback 优先于 graphic-frame。
- [LayerService.applySourceLoop](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/services/LayerService.ts#L1636-L1671) 只是给连续相同 animationId 的图层复制 range/loop，不是持续的时间联系。空间父级在 [evaluateShotAtTime](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/evaluate-shot-at-time.ts#L964-L969) 局部求值之后消费，不接管子级时钟。
- [export-preparation](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/export-preparation.ts#L151-L167) 依赖视觉变化采样点识别素材，[addShotAnimationMedia](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/export-preparation.ts#L350-L388) 从可见动画收集资源。联动造成新的出现区间时必须采样实际有效边界，否则会出现可见子层缺素材。 [evaluateExportShotAtTime](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/export-renderer/evaluateExportShotAtTime.ts#L21-L33) 为高帧率导出传入 Graphic 作者帧时间；不能将所有时钟粗暴覆盖为新的源时间。

### 外部参考

- Adobe [Symbol instances / looping]（https://helpx.adobe.com/animate/desktop/multimedia-and-video/symbol-instances.html）说明 Graphic 受所处时间轴驱动，而 Movie Clip 有独立时间轴；Loop/Play Once/Single Frame 为显式播放设置。[Flare graphic_playback.rs](https://github.com/Flare-Animate/Flare/blob/073476dfb83f097a53ded84a2332d742aa84ea8b/crates/presentation/flare-animate/src/workspace/graphic_playback.rs#L8-L35) 也将播放设置限制在 Graphic 实例，并用事务修改。这些是源播放/独立时钟的参考，而不是跨普通 Layer 的现成联动系统。
- Unity [Timeline Control Clip]（https://docs.unity3d.com/ja/2019.1/Manual/TimelineControlClipProperties.html）和 [Animation Clip]（https://docs.unity3d.com/cn/2019.2/Manual/TimelineAnimationClipProperties.html）将活动区间、源偏移和速度明确分离，可借鉴确定性的时间映射，不需要引入 PlayableGraph。
- Godot [AnimationTree]（https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html）区分独立推进与循环相位同步，适合作为未来不同长度循环同步的行为参考；[AnimationNodeTimeSeek]（https://docs.godotengine.org/en/stable/classes/class_animationnodetimeseek.html）展示运行时 seek 命令，但该命令是一次性运行状态，Panda 导出不采用此类必须先顺播触发的机制。

### 优先推荐的高频用例（待确认）

第一版只实现“随指定动作区间启动/停止附属动画”，例如挥剑动作开始时独立的剑光 Graphic 从指定源帧开始播放，动作结束时消失。移动角色动作区间时剑光自动随之移动。该用例既能证明持续时间关系，又可直接复用现有事件/源范围/播放模式。初版无需归一化不同素材的循环相位、任意倍速网络、触发器图或脚本。若 OWNER 明确希望同步两个不同长度的循环，再增加一项独立可选 phase 模式（0..1 的源循环进度映射到目标源范围，单独规定 once/hold 边界），不作为初版必需能力。

1. 可选持久化时间关联指向同 Shot 的具体源 Layer + 动作 event.id（首发可只支持 character-action）；目标为有正常 source playback 的独立 Animation/Graphic Layer。不能指向模糊角色名称或仅 actionId（同一动作可以出现多次）。空间父关系与时间来源独立：可以挂接手部但跟另一指定动作联动；换父不自动换时间来源。默认无联动的旧图层保持独立。
2. 每次采样由当前工程解析源事件 [start,end)，目标局部源时钟取 `t-start`（首帧/源范围继续走现有 resolver）；不是播放时发一次信号。区间之外采用明确的停止/隐藏合同（首发推荐隐藏特效；解除联动后恢复原独立设置）。区间内继续遵守目标 once/loop/single-frame 和 hold/hide。已有 graphic-playback / graphic-frame 若在有效区间内显式编排，保留原有优先级；联动只为默认播放提供活动窗口/起点，不重写旧事件。该规则应在 UI 与验收明确；若需要启动偏移，以现有 source firstFrame 优先，不先做通用 time remap。
3. 只改变附属动画源时钟和联动显隐；不能用源动作时间替换整个 Shot 的 t，也不修改根层关键帧、字幕/音频、角色口型、源动画内部 Graphic/MovieClip 合同。源事件移/裁后按最新范围直接求值，暂停自然停在同一帧；重播和随机 seek 一致。源删除/失效时对该特效局部回到独立播放（保留原配置和可修复引用），不让全工程拒绝打开/导出；UI 表明关联失效。首发只允许明确的源动作区间，不建立任意时间链或循环依赖。
4. 复用现有播放属性和时间轴选择事件，提供一个“跟随动作”开关与明确来源、解除入口，不建图编辑器。镜头复制需预先建立 event ID 映射（[ShotService.duplicate](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/services/ShotService.ts#L87-L139) 当前逐个生成新 event.id），同时映射源 Layer ID；同镜头复制保持有效引用，跨镜头复制解除无效外部关联。将有效活动边界加入现有导出资源采样，无需全帧重复扫描。
5. 如选用 timeline event 新字段或类型，注意历史 ShotV41–V45 使用共享 TimelineEventSchema；若扩展相机模式，历史 ShotV43–V45 同样引用共享 ShotCameraSchema。冻结旧版本读者，按 P3 同批协调必要 schema 版本及 IPC/migration，不为每票独立搭一套迁移系统。[Shot schema](https://github.com/Cognitive-Architect/panda-stage/blob/056a4c3ca5e354c0508561999039b82b0dfdbc09/src/domain/models/shot.ts#L127-L189)。

验收建议：同一角色动作分别在 1–2s 和 4–5s 两次出现，剑光只关联选定的一次；拖动/裁切该动作后特效活动范围自动更新；区间内循环、单次保持/隐藏、外部停止、暂停/恢复/直接 seek；独立播放与独立空间绑定不被改变；换父后时间来源保持明确。删除源后局部回退、复制/保存/撤销以及 24/60fps 输出时钟与延后首次出现的资源准备正确。

## 5. 联合接缝与推荐实施顺序

| 节点 | 优先复用 | 真实协作 |
| --- | --- | --- |
| CAMERA-05 | prepareShotCamera、P1 手工轨道、自动过渡、P2 camera-projection；Cinemachine 区间接管思路 | 可独立实现，消费最新正式世界状态 |
| PARENT-05 | P1 keep-world、P2 part/identityPath、完整矩阵、有效深度/空间 | 扩展有效父状态的统一读取；与 CAMERA-05 正式求值对齐 |
| PARENT-06 | 角色动作事件、Graphic 播放区间、现有源帧求值与资源准备 | 首发只关联明确动作，不依赖动态父级；与 PARENT-05 保持空间/时间解耦 |
| JOINT-01 | 既有 P2 联合场景、真实 Electron 正式输出服务 | 复用一次代表性组合验证，非新增发布门禁 |

统一顺序：Shot 时刻 → 可选源时间关联/局部动作 → 当前有效父边/最终部件和世界姿态 → 一个最终相机 → 深度与屏幕空间投影、排序、资源消费及成片。相机与父边不反向驱动源时钟。P3 三张垂直切片可同批施工，协调共享 Shot/Layer/schema、时间轴、正式求值及保存/复制接缝，无需互相等待 Issue 关闭或阶段合 main；全部继续提交母 PR #1370。后续实施须以母分支最新 HEAD 为起点。

JOINT-01 建议短场景：A 与 B 对话，A 拿起桌上道具并挥动，剑光随选定动作区间启动；中途手工全景表现交接，B 接过道具，自动恢复跟拍 B，最后放下。复用 P2 三层背景、固定 HUD、空控制层/隐藏父级；同一份工程检查任意 seek、边界矩阵/深度、独立源时钟、保存重开、代表性 MP4/透明 PNG，以及必要的编辑工具。真实 FLA 跨源关键帧身份连续性单列实际能力边界，不强制扩大兼容范围。保留 #1371/#1377 及旧源 FLA、选中对象输出的相关定向回归，不重复全格式 GUI 或引入无关门禁。CI、施工实测、复审与 OWNER UAT 分层记录。

## 6. 结论及待确认

优先采用已有 Panda 轮子，Cinemachine/Adobe/Blender 提供明确的时间区间接管与离散换父范式，Unity/Adobe/Flare 提供时间源及区间播放参考。没有证据表明固定上游版本可直接搬来完整 P3。需 OWNER 确认：手工接管段及默认过渡、动态父边编辑后的再对齐规则、跨深度/空间交接的初版范围、时间联动首发是否仅做动作启动/停止（推荐是）。组织文件夹仍按原约定延期；不把非必要高级相位/速度、多约束、多机位、相机特效加进 P3。

本次仅研究和归档，不创建实施 Issue、不修改业务代码、不改母路线图及母 PR 正文、不运行 Windows Electron 或上游应用、不声称新增功能通过。母 PR 的进度勾选待后续同步。

```text
=== AUTO SAVE ===
时间：2026-11-26
做了什么（结果）：依据#1362完成P3三节点专项源码/官方资料研究，固定Panda 056a4c3与上游版本，提出最小实现及联合场景建议。
当前状态（一句话）：P3研究输入齐备，待确认推荐合同并拆施工票。
下一步（唯一可执行）：按CAMERA-05、PARENT-05、PARENT-06三个垂直节点创建实施Issue。
风险 / 未验证（翻车点）：无独立研究子代理/实机；混合相机过渡、动态父边时序和跨深度保持、源事件生命周期及延后资源加载待定向验证；真实FLA身份边界及OWNER UAT尚待验。
=================
```
