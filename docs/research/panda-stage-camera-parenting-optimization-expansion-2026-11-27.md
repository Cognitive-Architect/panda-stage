# Panda Stage 运镜与父子级：优化及后续扩展专项研究

日期：2026-11-27。性质：实施研究与推荐合同，非已经实现、验收通过或 OWNER 批准的规格。

## 0. 结论、范围与证据基线

输入为 OWNER 提供的《镜头扩展与优化(1).txt》（2026-11-26 母 PR #1370 全量源码对照 review），重点覆盖其第五节四项优化、第六节五项扩展，及其中重复 Shot 求值候选。#1387 的动态头部挂接修复 [PR #1389](https://github.com/Cognitive-Architect/panda-stage/pull/1389) 已合并，研究业务基线为 [main f65c95a](https://github.com/Cognitive-Architect/panda-stage/commit/f65c95aa15d71d06c9295db7b2ef69b6d274704d)，Schema v46。本轮目标是减少重复计算和创作操作，不重建相机、父级系统或时间轴。

上游固定源码：
- AniCraft [7512a9b](https://github.com/storytold/anicraft/tree/7512a9bd9d5763ae577255257da6efbd45c250cf)：MIT OR Apache-2.0；主要复现深度滑条、retiming、父链列、批量绑定。沿用此前许可证核对，实际移植按文件头保留版权/许可。
- Flare [073476d](https://github.com/Flare-Animate/Flare/tree/073476dfb83f097a53ded84a2332d742aa84ea8b)：BSD-3-Clause；主要复用既有插键、曲线与纯相机求值设计，Panda 已具备同类能力。
- OpenShot v4.0.0 [a653b03](https://github.com/OpenShot/openshot-qt/tree/a653b03e1b21ed8d7b6707d47a754c5a6d642a19)：只借鉴数据化预设思想；[预设源码文件头](https://github.com/OpenShot/openshot-qt/blob/a653b03e1b21ed8d7b6707d47a754c5a6d642a19/src/classes/animation_presets.py#L1-L33) 明示 GPL-3.0-or-later，不能将其实现或预设表整段移植进 Apache-2.0 Panda。
- Motion Canvas [e735a99](https://github.com/motion-canvas/motion-canvas/tree/e735a995aa738ca682feb4204a39ee7db7b5d279)（v3.17.2）、Godot [4c311cb](https://github.com/godotengine/godot/tree/4c311cbee68c0b66ff8ebb8b0defdd9979dd2a41)（4.4-stable）、lottie-web [846dbf2](https://github.com/airbnb/lottie-web/tree/846dbf2a5c40df245db4307490cecae02b9dcca4)（v5.12.2）：本轮实际读相关源码，只作为行为/数学参考，不增加依赖或复制代码；如后续实质移植另核对具体许可证及通知。选择固定版本为便于复核，不声称是各项目最新版本。

下文将直接复用（Panda）、可适配（上游纯数学/交互）、行为参考明确区分。附件中的 1/8 次 Graphic 求值为此前实验，不是本轮重新量测结果；本轮查证当前源码仍存在相应调用。无独立研究子代理入口，直接读主来源。未修改业务代码、未运行测试/实机、未创建施工票。

## 1. OPT-01：一次父空间求值共用挂接目标

### 已有实现与可复现轮子
- AniCraft [rig_spaces / rig_resolve](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/doc/src/parenting.rs#L157-L199) 为同帧父空间递归分配局部 memo，避免重复解析父链。注意它缓存的是父空间，不是直接实现 Panda 多部件/Graphic 挂接目标缓存；不能照搬其首对象 rig_lead。
- Panda [applyLayerParenting](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/layer-parent-space.ts#L125-L219) 已缓存当前时刻的 bindings、local、world、spaces、depth、cameraSpace；但 L183-L190 的每个挂接子级调用 [resolveLayerAttachmentLocalMatrix](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/layer-attachment.ts#L298-L321)，后者查找 [resolveLayerAttachmentTargets](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/layer-attachment.ts#L225-L295) 生成的目标，Graphic 路径会再次 evaluateFlaGraphicVisual 并枚举身份。8 个子级指同一 owner 的既有实验为 8 次内部 Graphic 求值，不等于 8 倍总帧性能。

### 推荐合同
在单次 applyLayerParenting 调用内，为实际被引用的 owner Layer 实例惰性构建 targetKey→owner-local matrix 映射（必要时为已有 resolver 增加可传入的当次 lookup），兼容 character-part 与 graphic-node identityPath，保留旧 nodePath 证明/升级逻辑。按 owner 实例而非 animationId/characterId 缓存；同一素材不同实例可能有不同时间、部件姿态与覆盖。单个目标缺失仍使用该子级自己的 ownerLocalFallback；不把某个子级的 fallback 缓存成共享目标。缓存失败也局部处理，不能误绑定另一目标。无需跨帧缓存/全局 invalidation。

[#1389 修复后的共享对话投影](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/selectors/temporalRender.ts#L554-L584) 会在有头动、当前有效挂接时重新执行父空间求值。头动前后两次调用各自创建缓存，禁止把头动前的部件矩阵复用给头动后。保留实际局部姿态、完整 affine、隐藏父层、动态换父、独立时钟、有效深度/空间，输出与原求值一致。

验收：复用现有真实 Graphic/角色夹具，在同一次调用内 1/8 个子级（含不同目标、缺失目标）对应同一 owner 的目标枚举/Graphic 求值为一次；另一个 owner 独立计算。比较实际世界矩阵，覆盖不同实例/内部时间、随机 seek、#1387 头动前后及缺失恢复。只记录实际调用次数及代表性场景耗时（如有）；不设未经测量的 FPS 门禁。

### OPT-01B：重复 Shot 求值（次优先、单独小切片）
[ExportRendererApp L198-L236](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/export-renderer/ExportRendererApp.tsx#L198-L236) 先 evaluateShotAtTime 取规范化 timeMs 来挑字幕，再在正式输出调用 [evaluateExportShotAtTime](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/export-renderer/evaluateExportShotAtTime.ts#L12-L39)，后者重新求值且包含 Graphic 作者帧时间。优先把相同的 Shot 请求时间规范化提成轻量纯 helper（或复用既有等价入口），直接据此选择字幕，正式分支只需一次正式基础求值再对话投影；legacy probe 保留原语义。不得把无 graphicFrameTimeMs 的普通求值直接作为高帧率输出的基底。
[prepareSpeakerFocusCamera/targetAt](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/resolve-speaker-focus-camera.ts#L65-L199) 已有按边界准备和二分计划；intentAt 需正常可见性，targetAt 某些父级/深度场景需 includeShake:false。先量测同一准备过程/请求内参数完全相同的重复调用，才决定局部复用；不同 Shake、Graphic 作者时间、对话头动阶段不能混用。避免引入大型 Shot cache 或按历史顺播。相关自动跟拍、手工接管、高帧率及对象输出回归即可。建议先消除正式导出中确定的字幕取时重复求值，追焦次级优化如无明确收益可延期。

## 2. OPT-02：接管区间/交接点直接拖动 + 选择同步

### 可复现轮子
AniCraft [Motion Editor](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/src/motion_editor.rs#L1-L68) 明确时间/数值拖动轴锁、4 点阈值、吸附帧、邻键限制、每手势一次撤销；[retime_limit / move_keys](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/doc/src/motion/retime.rs#L40-L98) 计算共同 delta 的可行范围。[ADR 0083](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/docs/adr/0083-motion-editor-and-timeline-retiming.md) 描述移动整 span、拖边拉伸及选中键的语义。只借鉴拖动及限位，不照搬其 span 自有 keys 拉伸合同。

Panda [ShotCameraLane](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/renderer/features/timeline/ShotCameraLane.tsx#L30-L125) 已有相机/深度键 pointer capture、draft 和邻键限位；接管条目前仅定位/删除。[updateShotCameraOverride / moveShotCameraOverride](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/shot-camera.ts#L386-L457) 已实现半开区间更新、整段移动、越界/重叠检查。[ShotCameraControls](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/renderer/features/canvas/ShotCameraControls.tsx#L60-L75) 私有 selectedOverrideId 与时间轴点击未统一。[timelineUiStore](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/renderer/features/timeline/timelineUiStore.ts#L127-L218) 已有不写入 Project 的时间轴会话状态；[LayerService.moveParentKey](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/services/LayerService.ts#L1895-L1941) 已有重算补偿及循环防护（以实际当前文件为准）。

### 推荐合同
- 接管条主体拖动整段，左右边缘拖动边界；复用现有时间几何、帧网格、对话/位置键手势、domain move/update 服务，拖动局部 draft，释放后一次提交，取消/切镜头/工程 revision 变化/非法重叠保留原数据；边界不超过 Shot 时长、相邻段及最小有效长度。保留数字输入、键盘定位/删除。UI 用当前项目 DESIGN.md，尽量少文案。
- **关键取舍：现有相机键是全 Shot 共用轨，不属于某个 override。首发拖动只改变手工接管窗口与混合权重，保持全部手工键时间不变，与现有数字输入同一合同。** 不隐式拉伸/移动全局 keys，不宣称等于移动整段相机动画。若未来需要一同拖动键，设计明确的所选键批量移动操作，不能猜归属。
- 接管选择保存为当前 Shot 的会话 selectedOverrideId，时间轴和属性面板共用；删除、切 Shot/Project 及时清理。单纯选择/seek 不写项目/历史。当前播放头所在段可作为无显式选择时的默认。
- 当前选中 Layer 显示 parentKeys 轻量标记（可复用现有键样式），拖动直接调用 moveParentKey；保留「移到播放头」、删除、重新对齐、静态与动态区别。让已有服务判断循环/重叠/不可逆等本次操作错误，不造另一套换父数学。

验收：两个接管区间点选同步、整段拖移/两端调整、合法相邻区间、冲突回退；相机键完全不受窗口拖移影响，Undo/Redo 一次。拖动交接键后时间与补偿正确，原位置不形成循环；锁定/切 Shot/取消不提交，随机 seek/成片语义保持。两个垂直 UI 切片可独立完成，非必须彼此等待。

## 3. OPT-03：直接复现 AniCraft 视差深度滑条

### 真实上游实现
[AniCraft layer_depth.rs L21-L33](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/src/layer_depth.rs#L21-L33) 把线性滑条映射到 parallax=F/(F+d)，而不是深度 d；[L129-L157](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/src/layer_depth.rs#L129-L157) 绘制零深度标记、拖动 live update、结束手势。Panda [constants](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/constants.ts#L1-L4) 深度范围 -500..10000，[camera-projection](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/camera-projection.ts#L8-L53) 原生 F=1000，正好可用相同的静止归一化平移响应。

令 pN=F/(F+dMin)，pF=F/(F+dMax)。
- depth→slider：u=(pN-F/(F+d))/(pN-pF)
- slider→depth：d=F/(pN-u*(pN-pF))-F
- 当前参数 pN=2，pF≈0.090909，零深度位于 52.38%，-250 约 34.92%，+1000 约 78.57%，+10000 为 100%。这是按参考视差量分配滑条空间，当前相机倍率不同仍由真实投影求值，不承诺所有倍率的像素变化完全线性。

### Panda 落地
复用 [LayerDepthControl](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/renderer/features/properties/LayerDepthControl.tsx#L15-L52) 的合法范围、锁定与提交逻辑，[setLayerDepth / setLayerDepthKey](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/layer-depth.ts#L26-L66) 的静态/动画键语义。使用 Panda 自身焦距/深度常量，不复制另一份数字；共享小型纯映射函数。选中层加一条近→远滑条，零点标记、精确数字仍在；拖动使用现有局部预览/draft 模式，结束一次更新，不为每次 pointer move 创建历史。现有静态输入空值为继承的语义不能丢。
动态父关系可能显式 inherit/preserve，当前有效深度不一定等于 layer.depth；滑条显示当前实际深度和来源，继承状态明确由作者转为独立深度或当前段保留（复用可用编辑服务，避免静默改变全轨）。有深度键时编辑当前帧键；屏幕空间深度不参与世界投影，保留已有数据，按现有适用状态局部处理。不得为了不支持某种继承组合而禁止所有深度操作。负深度的近裁剪仍采用正式投影规则，不改 FLA 源焦距。

验收：正反映射、端点/零点、拖动实时构图、一次撤销、数值与滑条同步、已有深度键/继承/动态换父、锁定/取消；镜头移动时三层视差及 HUD 正常，保存重开。范围/精度以原模型为准，不复制上游无关多层面板。

## 4. OPT-04：相机缓动曲线可视化与编辑

### 可复现轮子
AniCraft [Motion Editor](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/src/motion_editor.rs#L1-L12) 和 [Ease Editor](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/src/ease_editor.rs#L133-L212) 提供图形预设、曲线手柄、一次撤销；[ADR 0081](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/docs/adr/0081-ease-presets-and-custom-eases.md) 明确预设是纯函数，应用时复制数值。Flare [camera editor](https://github.com/Flare-Animate/Flare/blob/073476dfb83f097a53ded84a2332d742aa84ea8b/crates/editing/flare-editor/src/camera.rs#L31-L118) 提供插入/拆分相机键的已有参考，Panda 已实现保曲线，不改该合同。

Panda [AnimationCurvePanel](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/renderer/features/timeline/AnimationCurvePanel.tsx#L89-L191) 已有实际曲线采样、SVG 手柄、带 revision/instance 的 draft；[L246-L267](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/renderer/features/timeline/AnimationCurvePanel.tsx#L246-L267) 有单次提交。[evaluateAnimationEase / sliceAnimationCurve](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/evaluate-animation-core.ts#L39-L55) 支持曲线时间 window；[ShotCameraControls](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/renderer/features/canvas/ShotCameraControls.tsx#L191-L215) 目前主要数字和下拉。

### 推荐合同
抽取最小共享曲线图形/手势组件或局部复用现有逻辑，给相机当前关键帧到下一键的真实 easing 画图；用 evaluateAnimationEase 实际采样，不直接画原始 bezier 当成切窗后的曲线。普通 cubic 曲线可拖动手柄并沿用 setShotCameraKey 更新插值，不重复修改其他键；现有数值入口保留。现有 AnimationCurveDraft 针对 layer 且 CanvasStage 对 cameraView 有特殊分支，复用 draft 的生命周期/校验而非假装它已经支持相机，最小增加相机草稿消费，保证取景预览随变更。
含 window 的曲线打开/查看/取消保持原数据；若为可精确转换的 cubic 子段，可用已有或少量 Bézier 子段提取数学生成等价规范化手柄；其他非等价形状直接展示真实采样并由用户显式选择替换为新曲线，不在打开面板时丢 window。首发优先真实可视化与普通手柄编辑，不建设多段自定义曲线编辑器、全属性独立相机通道或新的 easing engine。可在同一组件后续扩展接管的入/出过渡曲线，但不强制先做。

验收：线性、缓入缓出、普通自定义 cubic、插键后的 curve.window、step；查看不产生 revision，实际图形对应求值，拖动一次 Undo、取消不写入；编辑保持同一相机键和其它属性，不退回纯 manual、不破坏连续角度与多圈旋转、混合接管和正式输出。

## 5. EXT-01：批量挂接及空控制层

### 可复现轮子
[AniCraft engine parenting.rs L28-L108](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/engine/src/parenting.rs#L28-L108) 的 layer.set_parent/layer.remove_parent 接受 layers[]，逐层 keep-world，属于一次命令/撤销；[L134 后](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/crates/engine/src/parenting.rs#L134-L155) 为编辑前后空间准备。Panda [LayerService.setParent](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/services/LayerService.ts#L1827-L1864) 保留 affine 补偿且不重写局部轨道；[LayerSelectionStore](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/renderer/stores/selectionStore.ts#L36-L65) 当前主要是单个 selectedLayerId，不必为此重做全局选择系统。

### 推荐合同
先在现有父级/图层区域提供局部复选（选择同 Shot 多个子层，目标为空控制层或普通可用父层），支持批量绑定/解除；有现成空控制层创建服务时可顺手提供创建控制层并绑定的单一事务。原 active Layer/部件选择仍存在。首发以静态基础关系为主；对有动态交接键的对象明确当前操作是改基础绑定还是在当前帧建立动态键，保留未来段，不偷偷清空历史。动态批量可直接复用已有 setParentKey，若交付成本偏大则局部延期，不影响普通对象批量绑定。

选中层彼此有父子关系时，不能简单依次用变化后的现场算原世界姿态；在一次事务中从原快照捕获各目标需要的补偿基准，再以最终关系求值，复用既有 keep-world、循环及目标可逆检查。独立子层可顺序调用现有纯服务，最终一次 updateProject；不必新造编辑引擎。不允许新父也是被绑定到自己的选中层；锁定/背景等按现有合同处理，预览受影响的层，不提交半截非法状态。批量撤销一次恢复原数据，保留 zIndex、深度/空间、独立动作及 FLA 目标身份。

验收：多选车轮/道具/特效挂同一 controller，当前帧世界矩阵保持，随后随控制层移动且局部动作独立；包含已关联的父子对、无效目标、已锁层和取消，批量提交仅一次历史记录、保存重开正常。后续扩展为统一父链 UI 时可共用入口，但不设前置门禁。

## 6. EXT-02：可开关的父链视图

### 真实上游
[AniCraft src/parenting.rs L1-L77](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/src/parenting.rs#L1-L77) 在 Layers 列增加窄父级列、按祖先层数安排点位、可开关并存到 preferences；[L88-L115](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/src/parenting.rs#L88-L115) 用 drag/drop 或菜单选父，[L118-L173](https://github.com/storytold/anicraft/blob/7512a9bd9d5763ae577255257da6efbd45c250cf/src/parenting.rs#L118-L173) 列候选/画连线。这是最接近 Panda 需求的现成 UI，适配 React/CSS/SVG，不移植 egui。

### 推荐合同
现有图层列表增加可开关窄列，用节点/连线表示**当前播放头生效的**父关系；复用 resolveLayerParentBindingAtTime，只查关系、不做完整矩阵/Graphic 求值来画图。优先只展示可见列表中的相关线，长链压缩宽度，滚动/重排保持行对齐，选中对象高亮关联链。隐藏、锁定、控制层保持既有图层语义，父链不是目录树，不改变绘制顺序或选中对象动作。部件目标名称/失效用已有 tooltip/选择入口，不增加大量常驻文案。静态/动态区别明确，点击/拖点选父复用现有合法目标、setParent/setParentKey/keep-world，动态模式必须明确，不能像 AniCraft（固定关系）那样把整条轨改掉。先实现只读可视化+点击已有入口，低成本再加拖点；无新 Project 字段。

验收：A→控制层→子层与随时间 A→B 的交接，播放头变化即时更新关系；开关、滚动、折叠或选中不污染项目历史；实际绑定/解绑沿既有事务且不改变 zIndex。不能用静态缩进假装动态层级。

## 7. EXT-03：可编辑运镜预设

### 可复现轮子
[OpenShot animation_presets.py L35-L59](https://github.com/OpenShot/openshot-qt/blob/a653b03e1b21ed8d7b6707d47a754c5a6d642a19/src/classes/animation_presets.py#L35-L59) 明确把预设保存为属性的相对帧/数值/可选缓动数组，应用时应缩放到实际区间；本轮核实的是预设表和数据合同，未追完整 OpenShot 应用调用链，不抄 GPL 数据与代码。[Motion Canvas Camera.ts L132-L194](https://github.com/motion-canvas/motion-canvas/blob/e735a995aa738ca682feb4204a39ee7db7b5d279/packages/2d/src/lib/components/Camera.ts#L132-L194) reset/centerOn 将目标位置、时间及 timing function 转成基本相机属性变化，[L212-L224](https://github.com/motion-canvas/motion-canvas/blob/e735a995aa738ca682feb4204a39ee7db7b5d279/packages/2d/src/lib/components/Camera.ts#L212-L224) 有沿路径运动的扩展候选，当前不需要。
Panda [user-motion-presets.ts L19-L67](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/user-motion-presets.ts#L19-L67) 已有相对帧、相对位移、比例缩放、范围捕获和切曲线；[L76-L87](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/user-motion-presets.ts#L76-L87) 有重叠冲突保护。现有模型是对象 TRS 轨道，不直接把相机当对象。借鉴其数据形式与事务；实际生成 [ShotCameraKey](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/models/shotCamera.ts#L5-L16)，调用现有 [setShotCameraKey](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/shot-camera.ts#L277-L309)。

### 推荐合同
首发内置少量参数化预设：推近/拉远、水平或垂直平移、从 A 构图移到 B、回全景。以当前相机姿态/作者指定起止构图为基础，持续时间、目标/幅度、已有缓动可调。用帧相对位置映射当前 Shot 作者帧网格，生成普通 centerX/Y、zoom、rotationDeg key 数据。选择目标对象时按应用时指定端点采样，考虑最终世界位置与深度；结果展开为普通键，不产生永久自动跟随或新运行时。保留手工多圈旋转/zoom 正值语义，未指定旋转时继承。
首发不要求新增持久化运镜模板格式；内置配方足够，已有普通键可再改。后续真实需求再做捕获/保存自定义相机区间，按现有用户运动预设范式。
应用前检查区间内现有键和边界冲突；优先空闲区间，允许明确覆盖选择，不静默删除。普通相机轨终点姿态自然保持到后续键，若需要恢复原构图可加明确的恢复键，不能声称改变区间末端值仍绝对不影响邻段。插入边界保持已有曲线，改变值是显式意图。Hybrid 复用现有选中接管段或明确创建段；不把纯自动整镜头静默改成 manual。一次事务生成全部键/必要区间，撤销一次恢复。

验收：从不同起始构图应用推近、平移、A→B；生成后在已有轨道移动/改键/改曲线，删除配方本身不影响作品。空闲段/冲突提示、时长/帧网格、混合模式、Undo/Redo 和正式输出一致。使用 Panda 自己的参数及曲线，不搬外部表或引擎。

## 8. EXT-04：自动构图跟随目标及留白

### 可复现轮子
[Godot Camera2D](https://github.com/godotengine/godot/blob/4c311cbee68c0b66ff8ebb8b0defdd9979dd2a41/scene/2d/camera_2d.cpp#L124-L170) 分离 zoom/anchor/margin 与目标位置，[L211-L250](https://github.com/godotengine/godot/blob/4c311cbee68c0b66ff8ebb8b0defdd9979dd2a41/scene/2d/camera_2d.cpp#L211-L250) 在生成画面矩形时加入 offset；可参考其构图控制，不能直接复制游戏逐帧 smoothing/dead-zone 的状态依赖。Motion Canvas centerOn 同样分离目标与缩放。Panda [speaker focus](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/resolve-speaker-focus-camera.ts#L11-L45) 目前固定 zoom=1.5、250ms transition、stage clamp；[targetAt](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/resolve-speaker-focus-camera.ts#L65-L112) 对有父/深度对象求正式世界位置，排除 Shake。现有 [solveCameraCenterForWorldPoint](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/camera-projection.ts#L56-L82) 把世界点投影到画布中心，可泛化到作者指定的画面点。

### 推荐合同
首发 Shot 可选自动构图参数：跟拍倍率（默认 1.5，初版沿用自动 zoom>=1 边界）、画面目标位置归一化 (u,v)（默认 0.5,0.5，可选居中/左三分/右三分与自由微调）。跟随源仍默认唯一可见说话者，保留旧 full-stage fallback、250ms 过渡和不追逐 Shake。目标位置以输出画布而非工作视口为准，适配分辨率。若实际角色根锚点不合构图，后续同一切片可增加明确稳定部件目标（按角色实例/partId，有效时复用部件矩阵，缺失回退 root），不猜名称，不强制自动人脸识别，也不追逐说话头动造成抖动。

二维无旋转自动相机推导：M 为画布中心，W 为世界锚点，S 为所希望的屏幕位置。r=F+d，q=r/(F/z+d)，p=F/r。现有投影为 S=M+q*(W-M-p*(C-M))，故 C=M+(W-M-(S-M)/q)/p。d=0 时 p=1,q=z；S=M 恢复现有中心解。使用 Panda 原投影参数/近裁剪判定共享 helper，随后保留 stage clamp；触及边界时允许实际目标位置偏离设定留白，不强行为了居中越界。screen HUD、近裁剪及缺目标按原 fallback；手工及混合手工部分不受设置影响。保持确定性 seek，无新增状态滤波器。

验收：默认值与旧模式完全一致；给不同深度/父关系的演员设置倍率和左/右留白，未触 clamp 时目标落到指定位置，边界时按原规则；说话人切换、HUD、Shake、混合接管、保存和正式成片正确。仅在新增可选持久化字段时进行必要兼容 reader/schema 演进，与其它持久化任务协作。

## 9. EXT-05：动作时间关联的相对偏移

### 可复现轮子
[lottie-web CompElement.prepareFrame](https://github.com/airbnb/lottie-web/blob/846dbf2a5c40df245db4307490cecae02b9dcca4/player/js/elements/CompElement.js#L41-L68) 从父时刻减 layer.st 计算子层局部时间；[RenderableElement.checkLayerLimits](https://github.com/airbnb/lottie-web/blob/846dbf2a5c40df245db4307490cecae02b9dcca4/player/js/elements/helpers/RenderableElement.js#L48-L62) 将可见区间和源起点分开。这是轻量纯时间映射参考，不是角色动作事件绑定成品。
Panda [resolveLayerAnimationTimeLink](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/animation-time-link.ts#L53-L92) 已通过 sourceLayerId+eventId 返回具体事件 [startMs,endMs)，[LayerAnimationTimeLinkSchema](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/models/layer.ts#L523-L536) 当前仅该关联身份；[pretrack](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/evaluate-shot-at-time.ts#L525-L563) 将活动窗口、默认源时钟起点、Graphic 显式区间/帧事件分别消费；[source elapsed](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/evaluate-shot-at-time.ts#L217-L282) 支持作者帧时间与连续采样；[shotVisualSampleTimes](https://github.com/Cognitive-Architect/panda-stage/blob/f65c95aa15d71d06c9295db7b2ef69b6d274704d/src/domain/export-preparation.ts#L152-L182) 已对有效联动边界采样。

### 推荐合同
首发一个有符号偏移（建议 offsetMs 默认为 0，UI 可按作者帧步进）。明确偏移的是整个关联活动窗口，而不是源 firstFrame：若源动作 [s,e)，偏移 δ 后为 [s+δ,e+δ)，源动画默认从新窗口起点推进，保持时长。挥拳 1–2 秒、偏移 +200ms 则特效 1.2–2.2 秒；-200ms 则 0.8–1.8 秒。若需要只延后起播且仍与原动作同刻结束，另作为未来独立 start/end 合同，避免第一版一个字段有双重含义。
在现有 resolver 集中返回偏移后的窗口，沿用具体 event.id，动作移动/裁切时自然重新计算。窗口越过 Shot 边界时只裁可见/导出采样区间，不重置已经推进的源时钟；完全在 Shot 外的有效关联仍为有效但不显示，不误判 broken 并恢复独立动画。真正源失效时保持既有独立播放回退。若采用帧偏移，须用同一作者帧规则计算符号偏移，不把负值传给会钳成 0 的 snapToFrame；既有 24fps 作者帧与 60fps 连续采样逻辑保留。
继续遵守 once/loop/single-frame、源范围/firstFrame、hold/hide；显式 Graphic playback/frame 事件仍在 Shot 作者时间上按既有优先级，偏移默认起点/活动窗口，不重写这些事件。根层/深度、父关系、嘴型、音频、字幕不变。导出资源收集按新的有效区间与实际作者采样边界，处理窗口跨零及延后首次出现；同镜头复制保留有效引用，整 Shot 复制保持 remap，跨 Shot 按原清理规则。仅必要的 schema 兼容、属性数值及可理解的区间显示；不做任意时间网络/速度同步。

验收：0/正/负偏移、两次同动作不同 event ID、移动/裁切、跨零/完全越界、无效源回退及解除；偏移后首次出现资源正确，源播放模式及独立根动作不变，空间换父不改时间来源，保存/复制/Undo/Redo、随机 seek 和 24/60fps 输出一致。

## 10. 推荐施工拆分与真实收益

以下为候选顺序，不是新增工单或硬阻塞：
| 建议顺序 | 垂直切片 | 理由 |
|---|---|---|
| A | OPT-01 挂接目标单次缓存 | 既有实验与现有调用证明重复；收益可直接统计 |
| A | OPT-01B 正式导出重复求值（自动追焦按量测再做） | 已定位确定冗余，保持作者时间/Shake 差异 |
| A | OPT-02A 相机接管条拖动与选择同步 | 现成 domain service 与手势 |
| A | OPT-02B 交接键时间轴拖动 | moveParentKey 已实现，无新数据 |
| A | OPT-03 视差深度滑条 | 最直接可适配上游数学与 UI |
| A | OPT-04 相机曲线 | 复用现有真实采样及手势 |
| B | EXT-01 批量挂接 | 明确减少重复操作，优先扩展 |
| B | EXT-03 运镜预设 | 可直接复用已有键轨，优先扩展 |
| B | EXT-02 父链视图 | 多人物交接可视化，与批量入口共享但可独立 |
| B | EXT-04 自动构图 | 小型可选参数，沿用相机逆投影 |
| B | EXT-05 时间偏移 | 小型可选字段，沿用联动窗口/资源收集 |

A/B 是推荐投入先后，不表示全部 A 完成才允许 B 开工。没有必要人为阻塞各票；同批协调涉及 LayerService/父空间、相机轨/时间轴草稿、选择会话、必要 schema 的真实接缝。以最新 main 为新一轮基础，不再向已合并 #1370/#1389 追加提交。后续母路线图/统一集成 PR 是否建立由 OWNER 决定。

最小联合样例：复用 P3 的双角色、Graphic 道具、三层深度、HUD、空控制层、自动+手工接管。多挂接对象调用次数及姿态等价；用批量挂接、预设、拖动、深度滑条及曲线调整构图，父链随交接时间改变；可选自动留白及剑光延时，检查代表性预览/正式成片，记录操作次数变化和实际耗时（如可获得）。优先复用现有测试夹具、正式 Electron 输出及现有 AGENTS.md 验证矩阵；不手动 Full CI/verify:project、不重复全格式验收或加无关门禁。性能收益与人工体验分别记录；旧 FLA 投影、v46 兼容、#1385 和 #1389 回归保持。延期的组织文件夹、真实 FLA 跨源关键帧身份恢复、全 3D、多机位、任意时钟网络均不借此扩展。

```text
=== AUTO SAVE ===
时间：2026-11-27
做了什么（结果）：依据附件与main f65c95a，核对AniCraft、Flare、OpenShot、Motion Canvas、Godot、lottie-web实际源码；完成四类优化、五类扩展及重复Shot求值候选的最小实施研究。
当前状态（一句话）：研究完成，具备新一轮优化/扩展路线图和拆票输入。
下一步（唯一可执行）：由OWNER确定本轮交付范围，按垂直切片创建施工Issue。
风险 / 未验证（翻车点）：本轮未独立量测实际帧率或运行GUI；缓存阶段隔离、接管窗口/全局键区别、继承深度编辑、curve.window及偏移资源采样需定向验证；不引入GPL实现或其他上游引擎。
=================
```
