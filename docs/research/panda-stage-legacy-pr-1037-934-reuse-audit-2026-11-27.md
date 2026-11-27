# Panda Stage｜历史 Draft PR #1037 / #934 能力时效性与复用价值调查

日期：2026-11-27。性质：只读源码调查、能力盘点与建议；不是新施工授权、全量缺陷审查或 OWNER UAT。

## 1. 结论

两份 Draft 都有尚未完整进入 main 的生产力价值，不能只因分支过时就认定无用。**不整体合并旧分支，不复活旧 v18 Schema、Pose evaluator、相机时钟或旧 Shell。** 优先从旧代码提取纯规划、解析、匹配、事务与测试，接入当前 main 的正式服务。建议将单镜头自动字幕、单/多镜头布景、剧本表演统一为一条可分阶段交付的结构化创作工作流。

## 2. 固定证据

| 对象 | 固定 HEAD | 范围 |
|---|---|---|
| main | [b76b735](https://github.com/Cognitive-Architect/panda-stage/commit/b76b7352d8b8354fa3e085e4dc74c82e0980eab3)，v47 | 当前正式能力 |
| [#1037](https://github.com/Cognitive-Architect/panda-stage/pull/1037) | [a1ada25](https://github.com/Cognitive-Architect/panda-stage/commit/a1ada257e564bdf1deb3a78cbf5344d56394bceb) | 71 commits / 238 changed files；旧 v18；相对 main 独有 71 commits、落后 502 |
| [#934](https://github.com/Cognitive-Architect/panda-stage/pull/934) | [9df4ae2](https://github.com/Cognitive-Architect/panda-stage/commit/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473) | 35 commits / 63 changed files；相对 main 独有 35 commits、落后 560 |

检查了两份 PR 的实际提交列表、全部变更文件路径、当前 main 递归源码树、关键旧/新服务及历史 Review。#1037 最终 [EF Review](https://github.com/Cognitive-Architect/panda-stage/pull/1037#pullrequestreview-5821825305) 记载 Targeted CI [42557722576](https://github.com/Cognitive-Architect/panda-stage/actions/runs/42557722576) PASS，OWNER UAT 未开始。#934 正文停留在 AS Phase A；实际提交 2f1bcaa 实现 Phase B，046ea7e 合入自动布景，9df4ae2 修复会话交接。旧 [#997 Review](https://github.com/Cognitive-Architect/panda-stage/pull/934#pullrequestreview-5809216918) 的切镜头预览问题在最终源码有显式 previewPlanShotId 校验和清理（[代码](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/renderer/features/shots/SceneCreationPanel.tsx#L371-L482)); 本轮未重跑历史测试、未独立验证所有旧缺陷、未验收实际效果。路径不存在或当前入口未发现属于此固定版本的调查结论，不宣称所有间接替代都已排除。

## 3. #934：两个真实可移植模块

| 能力 | 旧分支实际实现 | main 对照 / 判断 |
|---|---|---|
| AS-01 字幕配音核验 | [dialogueBatchPlan](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/renderer/features/dialogue/dialogueBatchPlan.ts#L171-L251) 按编号+规范角色名匹配配音，支持手选、异常预览、真实时长。 | [DialogueBatchPaste](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/renderer/features/dialogue/DialogueBatchPaste.tsx#L69-L100) 已有角色解析和批量创建待排字幕；不重复移植解析和普通字幕入口。音频匹配与核验是新增价值。 |
| AS-02 B 生成 | [AutoSubtitleGenerationService](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/domain/services/AutoSubtitleGenerationService.ts#L281-L390) 从播放头连续排轴，校验音频、重叠和明确延长镜头；复用 createMany/setTiming/bindAudio，最终检查 Dialogue/AudioClip 的身份与时间；[store](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/renderer/stores/dialogueStore.ts#L61-L97) 只提交一次，检查项目/版本/镜头/播放头。 | 当前 [DialogueService](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/DialogueService.ts) 已有单项正式服务，但未发现同等批量音频排轴入口。高价值，优先适配，不是 ASR/TTS。旧版全批重复音频拒绝、纯角色 ID 等政策按现实需求重审，旁白需用现有 speaker 合同。 |
| AC 单镜头布景（#857/#997） | [SceneCreationService](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/domain/services/SceneCreationService.ts#L277-L430) 解析镜头/背景/出场，按名称解析/手选，创建可编辑 Shot 和图层；[SceneCreationPanel](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/renderer/features/shots/SceneCreationPanel.tsx#L710-L902) 有中央画布只读预览与确认。 | 当前 [ShotService](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/ShotService.ts) 与 [LayerService](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/LayerService.ts) 提供底层创建及背景契约，未见相同结构化布景入口。保留工作流和匹配逻辑；与 #1037 AUTO-04 共用一个规划器，不单独复制旧 SceneCreationService 整体。 |

## 4. #1037：AUTO-01~08、EF-01~04 逐项裁决

| 原编号 | 价值 / 当前差额 | 建议与来源 |
|---|---|---|
| AUTO-01 快速双人站位 | 选两个现有角色实例，按可见底边落地，X 位置为画布 34%/66%，地平线 92%。main 的矩形/径向/路径阵列复制同源对象，不能替代不同角色站位。 | **保留**，融入对齐与布景。旧 [quickCharacterLayout](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/layout/quickCharacterLayout.ts#L197-L278)；main [LayerService](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/LayerService.ts#L2391-L2650)。用当前有效世界空间、画布尺寸和 visual bounds；不硬搬固定 1920×1080 或全部旋转拒绝。 |
| AUTO-02 批量对白/配音平移 | 多条已有 Dialogue 连同关联配音整体平移，间距/时长不变、先预检再单次提交。main 有单句 move、文本查替与批量新建，未见同等 moveMany。 | **保留** [旧 DialogueService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/DialogueService.ts#L421-L550) / [当前 DialogueService](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/DialogueService.ts#L446-L497)。复用现有音频时钟、旁白、口型段联动、History，别逐句产生多条撤销。 |
| AUTO-03 镜头模板 | 项目内独立保存镜头结构，实例化时重新分配图层/事件身份，清空对白和 AudioClip；旧版默认相机。main 整工程模板复制完整工程及素材；镜头 duplicate 会复制对白与音轨。 | **保留差异**：项目内镜头结构模板，优先尝试复制镜头并选择仅布景/动作的轻量路径；确需持久命名库再加入模板数据。参考 [旧 ShotService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/ShotService.ts#L209-L251)、[现 ShotService](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/ShotService.ts#L89-L170)、[整工程模板](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/main/services/ProjectService.ts#L185-L237)。新复制需保留/重映射父级、事件、深度、效果、相机及稳定资源引用。 |
| AUTO-04 多镜头静态布景 | 结构化文本生成 2–3 镜头，图片背景、双人固定站位、按名字识别/人工选材，真正创建可编辑图层。 | **核心保留**。 [parser](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/scene/multiSceneInput.ts#L18-L48)、[MultiSceneService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/MultiSceneService.ts#L210-L355)、[资源筛选](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/scene/sceneResources.ts#L50-L108)。旧角色仅 composite，背景仅 image，必须换成 main Layer/Graphic/Character 3.0 的有效能力；局部降级而非全批拒绝不支持角色。与 #934 单镜头共享同一计划，先一镜头贯通再扩展多镜头。 |
| AUTO-05 多镜头对白/配音 | 全剧本编号、统一说话者绑定、音频名匹配、镜头按真实音频排轴；复用 AUTO-04 和 AS 生成服务。 | **高优先保留** [multiSceneAudio](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/scene/multiSceneAudio.ts)、[MultiSceneDialogueService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/MultiSceneDialogueService.ts#L109-L275)；统一 #934 的匹配与生成，不建第二套。 |
| AUTO-06 表演编排 | 文本显式指令按全局对白序号触发左/右入场、移动、放大、抖动、换表情、淡入/淡出，生成普通 TimelineEvent。 | **高价值扩展** [指令定义](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/scene/multiScenePerformance.ts#L12-L91)、[规划](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/MultiScenePerformanceService.ts#L110-L240)、[可执行文本示例](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/renderer/features/shots/multiScenePerformanceExample.ts)。现有 [desktop automation API](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/shared/desktop-automation-api.ts#L14-L32) 支持修改已有对白、应用预设/配方、批次执行，不包括新建分镜和音轨；扩展现有正式服务与协议即可，不建第二套 AI Agent/runtime。 |
| AUTO-07A 音量开闭嘴 | 40ms RMS 音量窗口、80ms 关闭保持、音频源时间查表；旧版直接用二值声音门控制开/闭嘴。 | **仅保留差额候选**。main 已有静音停顿、五类可编辑口型、声音分析、音量驱动动作。 [旧 envelope](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/selectors/audioEnvelope.ts#L43-L140) 与 [main Simple Mouth/静音](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/selectors/temporalRender.ts#L280-L345)；Simple Mouth 当前仍使用周期开口，静音分析分支针对动画说话来源。若普通二图角色需要更自然开闭，用现有 PCM/静音分析补门控；不恢复独立解码/时钟/旧 export 音频传输。 |
| AUTO-07B 手工相机 | 静态/追焦/手工轨道、编辑预览输出。 | **已被超越**：main [shot-camera](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/shot-camera.ts) 有连续角度、多键、Hybrid 接管、深度与附着等，旧相机模型/求值/面板不移植。 |
| AUTO-08 D1 同角色部件动作预设 | 保存旧 poseAnimation 全轨、固定 pivot/rest/image mapping；只向同角色无 pose 的实例应用。 | **核心替代**：main [saveLayeredCharacterAction / upsertCharacterActionEvent](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/CharacterActionEventService.ts#L29-L109) 已可捕获选段/部件轨并以动作事件复用；[CharacterActionSchema](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/models/character.ts#L876-L917) 有部件 pivot 校准字段，[身体姿势](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/CharacterBodyPoseService.ts) 与跨角色映射另有正式实现。旧 [preset](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/PartPoseActionPresetService.ts#L91-L229) 的旧基准兼容、完整可编辑键落入目标的使用差异可按需保留思想，不复活 partPosePresets/poseAnimation。D2 旧票未实现。 |
| EF-01 复制角色实例 | 静态复制、偏移 24px、不复制 TimelineEvents；集成后也保留旧 pose。 | **通用复制已替代** [main duplicateLayer](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/LayerService.ts#L2328-L2387) 已处理身份、Clip、事件、父级、深度、跨镜头。区别是旧功能不带事件；若实用，增加现有复制的“仅外观/不带动作”选项，不造新 Character 专用复制引擎。 |
| EF-02 多对象对齐/等高/均分 | 左/中/右、底边对齐、等高、水平等间隙。基于真实渲染 bounds，预览后一次提交。 | **优先保留** [六个操作](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/layout/layerAlignDistribute.ts#L19-L37) 及纯 [planner](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/layout/layerAlignDistribute.ts#L391-L498)。main [BatchLayerControls](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/renderer/features/properties/BatchLayerControls.tsx#L49-L89) 已有多选、改名/复制/锁定/中心点/删除，但无这些排列动作。扩展现有批选及正式变换，不照搬旧抽屉。 |
| EF-03 动作事件批量移时/统一时长 | move/scale/opacity/shake 等旧 TimelineEvent 的区间整体平移、统一时长，冲突预检/单次提交。 | **保留差额** [TimelineEventBatchService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/TimelineEventBatchService.ts#L174-L295)。main 已有 Track/Key 选段改时，但不是同一类数据；复用当前区间编辑与事件联动。按实际类型逐步扩展，不先统一重写所有动画事件。 |
| EF-04 跨项目选择性导入 | 只读来源、选择角色/背景/道具、依赖闭包、ID 重映射、文件复制/事务/失败回滚。旧版支持三类图片角色，不复制镜头/时间轴/音频。 | **高优先保留** [ProjectResourceImportService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/main/services/ProjectResourceImportService.ts#L231-L395)、[依赖与准备](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/main/services/ProjectResourceImportService.ts#L405-L704)。main 整项目复制并不等于选择性跨项目素材复用。用现有 ProjectService/资源导入/文件系统/引用扫描接线，补 FLA Graphic Definition/subtree、共享素材、动作/嘴型/稳定 ID、必要音视频依赖；旧版只图片的闭包不能直接搬。先支持普通图片和一种真实 Graphic 角色，复杂类型局部提示。保留原子性、安全路径和失败回滚，不承诺旧版没有的文件 Undo。 |

## 5. 统一路线建议（不是建票）

建议按实际用户产能拆成七组，直接从当时最新 main 实施，保留独立可交付性：

1. **自动字幕与配音排轴**：#934 AS 与 #1037 AUTO-05 音频匹配共享。输入两角色十句、按真实长度核对、一次应用/撤销，保存重开和成片可听。
2. **对象排列**：AUTO-01 + EF-02 同一布局规划模块；现有多选接入左中右/底边/等高/均分；现有相机/父子世界空间按实际场景处理。
3. **单/多镜头自动布景**：#934 AC + AUTO-04；同一个 planner 支持一镜头及批量，复用布局和正式图层生成。
4. **多镜头剧本与表演**：AUTO-05/06，组合 1/3，输出普通可编辑 Shot、Dialogue、AudioClip、Event/Clip。先用旧结构化文本示例，随后让现有桌面 CLI 支持真正创建/编排，逐步扩展配方、现成动作和运镜能力；不先新建 LLM 或复杂 agent 系统。
5. **跨项目素材复用**：EF-04；在第二个工程导入一个角色、一个背景、一个道具及其必要依赖，源工程不变、目标可编辑。
6. **镜头模板**：AUTO-03；优先简单的无对白/音频结构复制，再按创作需要升级命名模板。
7. **批量时间操作**：AUTO-02/EF-03；保留对白+配音+关联口型，动作区间批量平移与统一时长，复用现有 History。

按真实需求选择简单音量开闭嘴差额与仅外观复制选项。C5-KF、旧 Pose/Clip 结构、旧相机、旧页面和重复的预设引擎不再迁移。AUTO-08 D1 不是恢复旧引擎的理由。

示例（旧 AUTO-06 支持的结构，非本轮新功能；角色/资源需真实匹配）：

```text
镜头：宗门大厅
背景：宗门大厅
出场：师兄、小师妹
站位：双人对话
对白：
师兄：听我解释。
小师妹：你又偷懒了！
表演：
1｜抖动
2｜表情｜生气
---
镜头：花园
背景：花园
出场：师兄、小师妹
站位：双人对话
对白：
小师妹：快去修炼。
师兄：知道了。
表演：
3｜淡入
4｜移动｜x=1260｜y=760
```

音频按 1_师兄、2_小师妹、3_小师妹、4_师兄匹配。示例只说明数据合同，未实际执行；动作时长/冲突仍按现有合法输入检查。旧 parser 一次 2–3 镜头、仅双人站位，这是试验限制，不应直接成为正式产品硬限制。建议先复用简单文本合同，扩到实际短片需要的任意合理镜头数、多角色、现有素材种类；不急于引入通用剧本语言。

## 6. 兼容、风险与旧分支处置

- 两旧分支均非 main 祖先；提交独有不等于功能全新。v47 已有严格历史 reader。旧 #1037 的 v18 是 shotTemplates/partPosePresets/旧 camera/pose 的另一套历史合同，[main 真正 v17/v18](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/models/project.ts#L215-L227) 是另一条演进线。不得用旧 schema 覆盖新 reader 或把 schemaVersion 改成 47 假迁移。若 OWNER 实际保有旧 Draft 工程，另用最小明确识别与转换测试按需迁移；本次未验证旧私有工程。
- 旧布景只接受合成角色和图片背景，直接复制将丢掉当前 Graphic/部件能力。使用当前创建/渲染/资源合同，按对象局部处理。
- 字幕生成复用当前 DialogueService 时重新核对带 offset 的 AudioClip、旁白、口型事件、镜头时长与角色动作；不要重建已存在的数据模型。
- 历史旧 UI / portrait / renderer 接线不移植，ReShell 仍独立。
- 保留 #1037 / #934 OPEN 作为供体索引，直到 OWNER 确定取舍并记录到后续路线。明确移植或放弃后，可关闭旧 PR；保留原提交与分支，不重复合并。此调查不创建实施 Issue，不改两 PR、不启动施工、不做新的源码质量审查或产品运行验证。

## AUTO SAVE
```text
=== AUTO SAVE ===
时间：2026-11-27
做了什么（结果）：对照 main b76b735、#1037 a1ada25、#934 9df4ae2；读取 PR 全部变更路径、提交、历史 Review、核心服务与 main 对应源码。形成七组复用候选及已替代能力清单。
当前状态（一句话）：两个老 Draft 有实质可复用的生产力能力，但不适合整体合并。
下一步（唯一可执行）：OWNER 确认保留范围及施工优先顺序，之后以当前 main 为基线复用。
风险 / 未验证（翻车点）：未运行 Windows/CI 或真实素材 UAT；旧 v18 工程迁移与全部能力替代性未穷尽；旧 PR 不关闭、不合并。
=================
```
