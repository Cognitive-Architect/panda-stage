# Panda Stage 三大核心能力专项研究 — FLA 兼容性、播放/运镜、人物编辑（2026-11-26）

## 结论与口径

固定 main `2876700de658196811c3c5e10ebe99b99a984ef2`（上一轮能力普查文档提交；业务基线 bd38ac3a）。本轮深入三个实际工作流，不重复统计全部 47 切片。结论：FLA 格式语义覆盖与局部恢复进步最大；播放的共享时间求值基础扎实；人物编辑已有从拆件、组装到分层演出、姿势/动作复用的正式路径；Panda 自有运镜仍以对白说话者聚焦为主，不能与导入 Animate 相机的画面保真混为一谈。

研究采用固定源码、真实 GitHub PR 元数据与原验收回执。未运行 Windows/Electron/Animate、未重新采集真实素材通过率或性能指标。下面的“已有”指固定主线已有实现；“优先”及场景价值属于产品判断，而非实测评分。三个待合并补修 PR 单独列出，不混入主线能力。

## 1. FLA 素材兼容性

### 1.1 入口与实际工作流

- [预检](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/main/services/fla-import-preflight-service.ts#L319-L327) 接受 ZIP-based FLA；XFL 文件夹/stub 支持参照 [#1258](https://github.com/Cognitive-Architect/panda-stage/pull/1258) B03。老式 OLE2 容器在当前入口仍拒绝，按此前项目范围不再扩展。
- [统一工作台](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/fla-import/FlaUnifiedWorkbench.tsx) 有候选预览、搜索、多选、批量导入、复用及失败/未尝试的分项回执。候选存在、可预览与可正式导入是不同状态。
- [Graphic 结构树](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/properties/FlaGraphicStructureTree.tsx#L201-L272) 支持结构导航和明确范围内的变换、区域/填充/路径节点编辑；复杂位图填充等有保护边界。可将选中的子树或独立区域加入角色零件，[创建角色入口](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/properties/FlaGraphicStructureTree.tsx#L415-L490)。
- [结构模型](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/models/flaGraphicStructure.ts) 保留 symbol、opaque 子节点、颜色、混合模式、可编辑文字及覆盖信息。S02-A/B 将复杂静态/动态子树局部隔离，健康兄弟仍可保留结构；不安全的隔离仍可整帧降级：[ #1314](https://github.com/Cognitive-Architect/panda-stage/pull/1314)、[#1318](https://github.com/Cognitive-Architect/panda-stage/pull/1318)。不能承诺任意源元件完整编辑或无损 FLA 往返。

### 1.2 功能矩阵

| 源特性 | 当前可恢复范围 | 主要边界 |
| --- | --- | --- |
| ZIP FLA / XFL | 正式读取、素材发现、稳定源快照 | 非任意容器 |
| 矢量、位图、渐变 | 已有 shape 绘制、可变粗细笔触、Hermite 宽度轮廓 | 特殊几何/填充以实际素材诊断为准 |
| Graphic | 嵌套、独立实例、指定帧范围、结构及局部覆盖 | 复杂节点可能局部或整帧降级 |
| MovieClip | 确定性独立时间、有限 stop()、父停子继续 | 任意 ActionScript/互动运行时不支持 |
| Classic / Object Motion | 平移旋转缩放、曲线、Bounce/Spring 与四 Wave，恒定 Classic 滤镜、多参数 Object Motion 滤镜 | 高级显式 RGBA 动画、任意补间组合仍有缺口 |
| Shape Tween | 明确配对的多轮廓/内孔、多样式、纯色/线宽/渐变双端插值 | 任意形状匹配、复杂位图和动态笔触不是全覆盖 |
| Folder / Mask | 祖先可见性、遮罩关系、跨深度投影对齐 | 不支持组合可局部诊断 |
| 文字 | CJK/Latin、多 run 显示、字距、上下标、旋转；支持单 run 实例替换 | 富文本/带滤镜文字完整编辑未完成 |
| 滤镜/色变 | Blur/Glow/DropShadow、Inner/Knockout Glow、颜色矩阵子集、静态 RGBA | 常见 AdjustColor 四参数、高级滤镜及高级色变动画未补齐 |
| Blend | Multiply、Screen、Add | Overlay 等其他模式未正式支持 |
| 相机/景深/2.5D | 源 Camera 变换、深度视差、附着层、遮罩及实例仿射投影 | 多 Camera、任意 Matrix3D/完整透视不支持 |
| 声音 | 内嵌 MP3、受支持 PCM/ADPCM；主场景及确定性嵌套声音恢复 AudioClip，event/stream/start/stop/有限 repeat | 无限 loop/任意脚本音钟有诊断 |
| 内嵌视频 | ISO MP4/MOV 提取、正式视频层、PTS 选帧、音轨/导出；主要验证短 MP4 | 原视频实例摆位及嵌套时钟未完整恢复；原生 WebM 输入未接，首次顺序解码可能等待 |

来源：[A/B/C #1258](https://github.com/Cognitive-Architect/panda-stage/pull/1258)、[R+S #1321](https://github.com/Cognitive-Architect/panda-stage/pull/1321)、[E #1351](https://github.com/Cognitive-Architect/panda-stage/pull/1351)；[运动求值](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/main/services/fla-object-motion.ts)、[显示列表](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/main/services/fla-static-snapshot-display-list-adapter.ts)、[混合模式合同](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/shared/fla-blend-mode.ts)、[声音时间线](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/fla-sound-timeline.ts)、[视频入口](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/main/services/fla-native-video.ts)、[正式视频层](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/models/layer.ts#L259-L272)。

### 1.3 真实兼容率：复用历史语料，不从功能清单猜百分比

仓库 [#732 跨类别普查](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/docs/research/issue-732-cross-category-capability-census.md) 固定旧基线 1e7091c4，28 份真实 FLA：11 人物/7 道具/10 特效。当时 28/28 成功解析，21 份动态文件中 14 份完成时间序列重建（15 个独立根时间线），567/1435 authored states 产出候选预览。预览比例不是视觉正确率；缺独立参考和维护者签收，因此严格 Product Ready 0/28 也不是“全部不能用”。当时阻塞：open-fill、线性笔触填充、运动补间范围及候选根遗漏。当前引擎有大量实质升级，但本轮未获得同一批语料的当前复测，不宣称历史每个阻塞已解决或编造新兼容百分比。

产品判断：人物/道具复用收益高；特效恢复覆盖提升明显；完整场景复用需重点观察组合、媒体和源实例恢复。优先用现有 28 份真实语料定点回放，按解析/画面/时间/编辑四层记录，先抽代表性样本，不额外制造全库门禁。

## 2. 动画播放与运镜

### 2.1 播放已经分成三层

1. **FLA 内部时钟**：[Graphic 选帧](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/shared/fla-graphic-playback.ts) 实现 loop、play once、single frame、loop reverse、play once reverse；[嵌套时间](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/main/services/fla-nested-graphic-frame-selector.ts) 与 #1258 涵盖确定性 MovieClip 独立时钟、stop() 等。五种是源 Graphic 求值语义，不等于 Panda 所有图层的 UI 都有五个按钮。
2. **Panda 实例与动作时间**：[动画播放设置](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/properties/AnimationPlaybackControls.tsx#L315-L427) 支持开始时间、单次/循环、终点定格/隐藏、循环同步；[源循环控件](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/properties/AnimationSourceLoopControls.tsx) 指定源帧范围。#1247/#1252/#1255 交付普通 Graphic 当前时刻点图落键、实例连续区间同步和隐藏/恢复边界。用户可以对现成素材选帧，不必重做整段动画。
3. **项目时间与正式输出**：[evaluateShotAtTime](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/evaluate-shot-at-time.ts)、[temporalRender](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/selectors/temporalRender.ts) 把图层动作、角色表情/嘴型/身体动作、Graphic 内部时钟和视频 PTS 放进同一 Shot 时间求值。[Product Preview](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/shell/ProductPreviewOverlay.tsx) 有镜头/全片范围、播放暂停、拖动定位、音频准备与镜头切换；[视频时钟](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/shared/fla-video-clock.ts) 让视频帧基于时间而非自由运行播放器。正式输出共用模型。不是声明复杂工程已无掉帧或超时。

### 2.2 Panda 原生动画创作

[AnimationKey 合同](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/models/animationKeys.ts) 支持位置偏移 X/Y、旋转、缩放 X/Y 的五个属性轨道，linear/ease-in/ease-out/ease-in-out/step 和明确范围的自定义 Bézier（控制点归一化），[曲线面板](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/timeline/AnimationCurvePanel.tsx) 可调整区段并正式提交；[用户运动预设](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/user-motion-presets.ts) 可捕获选段、应用和恢复边界；[#1247](https://github.com/Cognitive-Architect/panda-stage/pull/1247) 还记录动画源片段、操作配方、音频波形/擦听/音量动作及回归。源 Animate 的 Wave、弹簧或滤镜求值不意味着 Panda 自己已经提供同样的完整创作面板。当前 [项目常量](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/constants.ts) 仍是 1920×1080、24fps 工程网格；[输出 profile](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/shared/export-output-profile.ts) 独立支持 720/1080p 与 24/30/60fps（GIF 24/30），不能把 60fps 输出当作 60fps 原生创作时间轴。

### 2.3 运镜必须区分两种

| | Panda 自己的自动运镜 | FLA 源场景相机恢复 |
| --- | --- | --- |
| 功能 | 固定全景 / 对白说话者聚焦 | 读取原 __Camera__、位置、缩放、旋转和支持的补间 |
| 时钟 | Shot 对白 cue、角色唯一且可见、角色主位置跟随 | 原 Scene 帧跨度/Classic Motion/Object Motion |
| 画面 | 1.5x 聚焦、250ms 平滑过渡、无唯一目标回全景、画布边界限制 | 图层深度、相机深度、视差比例、附着相机层、裁剪/遮罩 |
| 产品入口 | 编辑器会话自动运镜开关、产品预览、正式导出 | FLA Scene 求值及其恢复画面路径 |
| 编辑边界 | 尚无通用手工相机关键帧/多段摄影路径及自由构图模型证据 | 源相机的保真求值，不是把相机转换为 Panda 原生可编辑相机轨道 |

依据：[说话者相机](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/resolve-speaker-focus-camera.ts)、[EditorShell](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/shell/EditorShell.tsx)、[预览](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/shell/ProductPreviewOverlay.tsx#L480-L650)、[正式出口相机模式 schema](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/shared/export-preparation-types.ts#L84-L90) 只有 static/speaker-focus；[隐藏导出 renderer](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/export-renderer/ExportRendererApp.tsx#L227-L235) 使用同一求值。[源相机恢复](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/main/services/fla-static-snapshot-display-list-adapter.ts#L2980-L3119) 明确处理逆相机变换、源深度、528.25 焦距约定、层级附着和单相机边界。[异深度遮罩 #1307](https://github.com/Cognitive-Architect/panda-stage/pull/1307)。完整三维相机未实现，2.5D 实例也不是光学景深模糊。

产品建议：两人对话和自动跟拍已是实用起点。下一阶段最小原生运镜可在现有 CameraView、纯时间求值和出口链上增加按 Shot 保存的 centerX/centerY/zoom 关键帧、平滑曲线与手动/自动模式。优先只实现推拉摇移和构图，不造新的 3D 摄影系统。此为建议而非已经立项或交付。

## 3. 人物编辑

### 3.1 角色资源与组装

[角色正式模型](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/models/character.ts) 有 single-image、composite 和 adaptive-parts 三种形式。简单角色可使用图片/表情；组合角色可分别配置身体、脸、可选头部和支点；自适应分件角色可使用普通图片或 FLA Graphic 子节点/区域。 [角色编辑入口](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/characters/CharacterEditor.tsx)、[组装工作台](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/characters/CharacterAssemblyWorkbench.tsx) 有换素材、改名、显隐、精调等。 [从 Graphic 创建分件角色](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/fla-import/createAdaptiveCharacterFromGraphic.ts) 尝试从原作者姿势恢复部件相对布局，并复用已保存布局；不保证任意素材自动识别完整人体或自动绑定骨骼。

### 3.2 表情、说话、嘴型

- [角色嘴型模型](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/models/character.ts#L818-L859) 支持静止/张嘴/咧嘴/圆嘴/闭嘴五类声学映射、可选图像或 Graphic 来源、脸/独立嘴部目标，素材循环或可编辑口型模式。具体 [口型编辑器](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/characters/MouthPoseSetEditor.tsx) 已存在。
- [PCM 口型分析](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/main/services/analyze-mouth-pose-pcm.ts#L33-L90) 用 RMS 能量、静音阈值和共振峰近似生成口型草稿，参考 AniCraft 轻量方法。不是逐音素、逐汉字的精确语音识别。可编辑草稿比只循环张闭嘴更可控。
- #1247 的 PROD-01、06 支持独立说话来源、脸嘴与身体动作分离及头部跟随；[temporalRender](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/selectors/temporalRender.ts) 存在说话头部轻微运动与正式时间投影。

### 3.3 角色演出、姿势和跨角色复用

| 功能 | 当前能力/限制 | 证据 |
| --- | --- | --- |
| 角色整体及部件动作 | 位置、旋转、X/Y 缩放，关键帧/默认姿势，选择部件明确落键 | [动画目标](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/models/animationCore.ts)、[人物动作属性](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/properties/CharacterMotionInspectorSection.tsx) |
| 角色动作库 | 整帧动画动作与分层身体动作并存；独立脸嘴、头部跟随 | [模型](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/models/character.ts#L861-L917)、[#1247](https://github.com/Cognitive-Architect/panda-stage/pull/1247) |
| 身体姿势库 | 捕获最终局部变换，参考支点校准，预览缩略图、点选确认并落键；缺件可局部跳过 | [姿势服务](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/services/CharacterBodyPoseService.ts)、[#1253](https://github.com/Cognitive-Architect/panda-stage/issues/1253) |
| 手臂 IK | 单个角色模型的 2–3 节刚性手臂链、关节角限位、拖末端求角度；当前动作占用手臂时已有明确作用域限制 | [手臂模型](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/models/character.ts#L946-L955)、[IK 服务](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/services/CharacterArmIkService.ts) |
| 跨角色动作映射 | 两个 adaptive-parts 角色之间，按名称建议映射、人工指定部件、镜像、位移缩放和支点偏移、预览确认 | [映射服务](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/domain/services/CharacterMotionMappingService.ts)、[映射控件](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/renderer/features/properties/CharacterMotionMappingControl.tsx) |
| 原 FLA IK/Rig | 对受支持的源姿态矩阵和父层传播求值，保持源画面 | [显示列表 adapter](https://github.com/Cognitive-Architect/panda-stage/blob/2876700de658196811c3c5e10ebe99b99a984ef2/src/main/services/fla-static-snapshot-display-list-adapter.ts)；不能等同于原生通用骨骼编辑器 |

意义：角色拆件不再只是做出一个可摆放的角色；可以把表情/说话、身体姿势和动作组合起来，再保存和迁移到另一角色。重复做短片收益明显。当前仍非完整人体骨骼、网格蒙皮/软体变形、全自动多角色动作重定向或任意角色一键绑定；先用真实角色验证编辑体验与切换姿势的成本。

## 4. 最新七项补修状态（本轮新增发现）

固定主线仍是 E 集成业务内容，七个已知 P2 的修复已经分别有三个 Open/Draft PR，尚未 merge；逐个读取 PR 元数据和对应 run：

| PR | 修复回执 | CI |
| --- | --- | --- |
| [#1358](https://github.com/Cognitive-Architect/panda-stage/pull/1358) | 原生 centerPoint3DZ、IK/Rig 枢轴、Scale9 自身/父级缩放分离；执行者记录 Windows 构造 FLA 的 Stage/Preview/PNG（枢轴另有数值回归） | [45732969139](https://github.com/Cognitive-Architect/panda-stage/actions/runs/45732969139) success |
| [#1359](https://github.com/Cognitive-Architect/panda-stage/pull/1359) | Inner Glow 保持源 alpha、零 alpha 矢量原 RGB 恢复；执行者记录 Electron 像素与正式导出 | [45732805608](https://github.com/Cognitive-Architect/panda-stage/actions/runs/45732805608) success |
| [#1357](https://github.com/Cognitive-Architect/panda-stage/pull/1357) | 旋转视频显示尺寸、切换工程解码生命周期；执行者记录 Windows 合成视频闭环与受控竞态 | [45733348625](https://github.com/Cognitive-Architect/panda-stage/actions/runs/45733348625) success |

这是比上轮能力普查更新的开发进度，依据实施者回执和 CI，不代表独立 review 通过或真实 Animate A/B/OWNER UAT 完成。当前不修改 PR、合并状态或工单。

## 5. 下一步建议（产品收益排序）

1. 用一份有多部件、复杂效果、对白/动作的真实 FLA，完成导入→结构/局部编辑→角色组装→姿势和动作→嘴型→预览/导出的完整工作流。优先复用历史语料和已有样本，记录真正卡住的环节。
2. 从既有 28 份真实语料逐步更新兼容普查，按可解析、画面正确、时间正确、可编辑四层分列，不能用 CI 测试条数代替兼容率。
3. 基于现有相机和时间求值先补原生手动运镜关键帧；人物编辑优先改善拆件到绑定的步骤与实际角色动作复用体验，按生产任务再决定扩展多肢体 IK，不先扩为大型骨架系统。

```text
=== AUTO SAVE ===
时间：2026-11-26
做了什么（结果）：固定 main 2876700，专项核对 FLA 导入与结构恢复、三层时间求值、原生/源相机、三类角色与分件/嘴型/动作复用源码；核对历史28份语料和新三张补修PR/CI。
当前状态（一句话）：FLA语义覆盖广、播放正式消费链已形成、角色创作与复用具备主体能力；自有手动运镜仍是明显短板；七项P2已有Draft修复回执且CI绿，未合并。
下一步（唯一可执行）：用一份代表性真实FLA和角色完成从导入到实际演出与成片的完整流程。
风险 / 未验证（翻车点）：未复跑实机、真实素材语料、独立A/B或性能；未做新三张PR的独立review；源动画/相机恢复不等于原生编辑能力；仅新增研究文档。
=================
```
