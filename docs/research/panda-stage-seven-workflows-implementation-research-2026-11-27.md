# Panda Stage｜七组生产力能力：源码级实现与移植路线研究

日期：2026-11-27
性质：Research 第三轮。把已选定的七组复用方向落实到当前真实接口、建议算法、调用顺序、最小产品交付与兼容风险。不是 OWNER 最终需求冻结、实施票、业务代码变更或 UAT 结果。

## 0. 结论与实时基线

七组都可以基于当前 Panda 实现，不需要新增外部大型引擎。真正建议取代码的是 Excalidraw 的排列数学、测试，以及旧 Panda 两个 PR 的业务 planner；其它成熟项目主要提供已验证的身份、命令、时间、依赖、模板语义。优先复用当前正式服务，不移植旧 Shell、旧 evaluator、旧 v18 Schema 或旧导出链。

- [前一轮开源选型报告](https://github.com/Cognitive-Architect/panda-stage/blob/1630cf5859c7ce6ddd584d3aa503e59e44fbafcc/docs/research/panda-stage-legacy-pr-open-source-reuse-comparison-2026-11-27.md)；[历史 PR 复用审查](https://github.com/Cognitive-Architect/panda-stage/blob/1ebb58010d09963e00b5e4b03cdddb7242ee94ba/docs/research/panda-stage-legacy-pr-1037-934-reuse-audit-2026-11-27.md)。
- 调查时实时 main = [3319df7](https://github.com/Cognitive-Architect/panda-stage/commit/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1)。相对旧调查 b76b735 已前进 17 commits；实际 diff 涉及父子级批量操作、运镜曲线/预设、自动构图、时间关联偏移、正式渲染、相关测试与文档清理。已经重新读取最新 LayerService、ShotService、父子空间、动画变换与提交接口。施工应再次检查届时 HEAD，不机械地 checkout 本快照。
- 旧代码供体 [#1037](https://github.com/Cognitive-Architect/panda-stage/pull/1037) 固定 a1ada25；[#934](https://github.com/Cognitive-Architect/panda-stage/pull/934) 固定 9df4ae2。上游链接沿用第二轮已核对的 commit。没有把旧分支合并到 main。
- [AGENTS.md](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/AGENTS.md)：唯一 EditorProjectStore/History；正式 domain 变更；Main 负责文件；IPC 双边校验。研究方案服从这几个既有约束。
- 下文新增类型名/函数名为建议示意，不声称已存在。实际函数均链接源码。未执行编译、Windows 验收、性能实验，未启动独立后台 agent（当前环境没有该能力）；通过 GitHub 直接读取主线和旧供体实际代码。许可证遵从前一轮报告，Excalidraw MIT 代码与测试移植时保留声明；GPL 供体借鉴行为，不复制源码。

## 1. 总体接线：只保留一个工程事实源

输入（UI 或现有 CLI） → 解析/匹配 → 纯 plan（普通数据、预览） → 现有正式领域服务生成候选 Project → 当前快照与实际引用校验 → 一次 updateProject → 现有时间轴、画布、播放、保存和导出。

[EditorProjectStore.updateProject](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/renderer/stores/EditorProjectStore.ts#L175-L195) 已解析正式 schema、调和 Graphic 覆盖、忽略无变化、产生一个 History command。对 01/02/03/04/06/07，候选 Project 可以通过已有纯 service 局部组合，不要在循环内触发 N 次 Store 更新。交互预览不写 Project。凡涉及文件的 05 单独沿用现有 Main transaction 和 renderer operation lease（第 6 节）。
 
UI 只扩展现有工具/时间轴/资源入口；ReShell 是独立研发线，届时按实际 Shell 和 DESIGN.md 接线。不复制旧布局、工具抽屉、状态所有者。没有必要为了七组功能增加一个通用编译框架、事件总线、Agent 平台、数据库或插件系统。

## 2. 01｜自动字幕与配音（AS-01/02、AUTO-05 音频部分）

### 2.1 实际供体与入口

| 源码 | 拿什么 |
|---|---|
| [#934 dialogueBatchPlan](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/renderer/features/dialogue/dialogueBatchPlan.ts#L171-L251) | 编号、角色名、音频可用性匹配；同编号歧义处理；保留手动选择 |
| [#934 AutoSubtitleGenerationService](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/domain/services/AutoSubtitleGenerationService.ts#L110-L390) | 真实时长顺序排轴、已有字幕冲突、镜头延长、正式生成及结果检查 |
| [#1037 multiSceneAudio](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/scene/multiSceneAudio.ts) | 全剧本顺序与显式配音匹配合同；和上面合成一个匹配函数，不维护两个 |
| [Ren'Py 00voice.rpy](https://github.com/renpy/renpy/blob/68816dc9764fb3b4c38035268075111c10802622/renpy/common/00voice.rpy#L345-L378) / [Yarn Spinner LineTagGenerator](https://github.com/YarnSpinnerTool/YarnSpinner/blob/7b7a98970d824de6912369e8ba2667d323cb6905/YarnSpinner.Compiler/LineTaggers/DescriptiveLineTagGenerator.cs#L104-L156) | ID 优先的配音身份；Yarn 对插入行的标签生成思想 |
| [main parseDialoguePaste](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/renderer/features/dialogue/parseDialoguePaste.ts) / [DialogueBatchPaste](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/renderer/features/dialogue/DialogueBatchPaste.tsx) | 现有中文台词解析、角色匹配、旁白、批量预览入口 |
| [main DialogueService](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/DialogueService.ts#L46-L68) | createMany 已接受 speakerType 与可选 characterId；旧仅 Character 逻辑必须更新 |

### 2.2 最小可行实现

1. 从现有 parseDialoguePaste 生成有序草稿行（draftRowId、文本、speakerType/characterId、可选已有 Dialogue.id、候选 audioAssetId）。草稿 ID 只在本次编辑中稳定；插入、删除和重排时保留未变更行的已有选择。首次编号规则仍为 1_角色名.wav，Unicode 名称规范沿用旧实现，直接用资产 ID 保存选中结果，不以文件名充当外键。
2. ID 匹配优先级：明确已有 Dialogue.id 与对应资产/导入清单 > 同一草稿已确认的 audioAssetId > 首次编号+角色名唯一匹配 > 人工选择。用户明确选择同一个音频再次使用时允许生成不同 AudioClip（不能把猜测当确认）。无 ID 的全新文本重复粘贴不是自动同步旧工程；重复台词和不确定对应关系只提示受影响行。已有对白的换音频与新建区分，避免重复生成。可输出配音清单（序号、角色、文本、稳定 ID、推荐文件名）；首版不为了 ID 新增 schema，生成后用现有 Dialogue.id。若之后需要跨工程/跨会话追踪尚未生成的剧本行，再单独讨论持久来源键。
3. 用 Ready 音频的真实 durationMs 与用户选择的源范围计算计划。设起点 P，某行播放长度 d = sourceEndMs - sourceStartMs，startMs = P，endMs = P+d，下一行 P=endMs。例：1800、2400、1600 ms → [0,1800)、[1800,4200)、[4200,5800)。AudioClip.offsetMs 为明确选择的源起点，默认 0；未 ready 的行保留草稿，允许其它明确选中的有效行先生成，不把缺素材当全产品硬门禁。不要静默估时、压缩配音或帧取整吞尾音。
4. 计划检查当前已定时字幕的真实区间和镜头边界。需延长时展示所需时长并确认。用 [ShotService.create/setDuration](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/ShotService.ts#L33-L94) 及当前服务。
5. 生成阶段可沿用 [createMany](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/DialogueService.ts#L230-L251) → [setTiming/bindAudio](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/DialogueService.ts#L311-L397) 的旧组合，全部作用于内存候选，不调用 store 逐条提交；但当前 bindAudio 有 one-frame placeholder 自动延长、源长度裁剪和已有 clip 复用行为，必须确认计划与最后 Dialogue/AudioClip 的区间完全一致。若此组合不能稳定表达指定源 offset 或极短合法音频，优先在 DialogueService 内增加薄的批量 timed-create 方法复用其校验/ID/音轨创建逻辑，而不是绕开正式服务复制整个旧实现。最后仅提交一次。
6. UI 使用当前工具入口或现有字幕批量页面扩展：每行一个角色/音频匹配与时长，支持修改，主按钮“生成字幕与配音”。保留原纯字幕批量添加；不加第二套字幕渲染。配音后现有口型、说话者跟焦与字幕输出继续用普通正式数据。

### 2.3 验收与建议范围

两角色十句真实音频、插入新句保持已有绑定、旁白、人工替换一条音频、必要时延长、一次撤销/恢复、保存重开与正式成片可听。额外词级标记/TTS/ASR 暂不施工。测试复用旧 plan/generate 与现有 DialogueService 测试。此组是 04 的共享音频排轴依赖。

## 3. 02｜通用对象排列（AUTO-01、EF-02）

### 3.1 可复用代码及当前接入点

- MIT [Excalidraw align.ts](https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/packages/element/src/align.ts)：按 x/y + start/center/end 计算组平移；[distribute.ts](https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/packages/element/src/distribute.ts#L20-L119)：共同边界、组中心排序、等间隙、负间隙时中心等分；[align tests](https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/packages/element/tests/align.test.tsx)、[distribute tests](https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/packages/element/tests/distribute.test.tsx)。提取纯矩形数学与测试，不搬 scene mutation、白板箭头绑定或其 store。复用时保留 [MIT LICENSE](https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/LICENSE).
- 旧 Panda [等高和水平布局](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/layout/layerAlignDistribute.ts#L300-L498)、[双人站位](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/layout/quickCharacterLayout.ts#L197-L278)；旧 gap < 0 拒绝、旋转/动画限制不要当产品永久限制。
- 当前 [selectionStore](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/renderer/stores/selectionStore.ts#L64-L82)、[BatchLayerControls](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/renderer/features/properties/BatchLayerControls.tsx#L11-L89) 已有多选、单次提交及可编辑过滤。
- 当前 [evaluateShotAtTime](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/evaluate-shot-at-time.ts#L834)、[resolveLayerVisualParts](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/selectors/visualParts.ts#L1401-L1434) 返回真实可见组合的 combinedLocalBounds / ownerTransform / Graphic 结果；[evaluatedLayerWorldMatrix](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/layer-parent-space.ts#L277-L292) 处理父空间与本地 pose；[affine-matrix](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/shared/affine-matrix.ts) 已有矩阵乘/逆。Konva [getClientRect](https://konvajs.org/api/Konva.Node.html#getClientRect) 与 [Objects Snapping](https://konvajs.org/docs/sandbox/Objects_Snapping.html) 用于预览/参考线，不把屏幕缩放后 bbox 变成新的事实源。

### 3.2 实现算法

建议恢复一个薄的 layout planner（名字可用 layerAlignDistribute），输入当前 Shot、选中 layer IDs、参考对象、轴/操作、时间与现有 autoKey 状态，输出每个编辑根对象的目标变换和局部不支持原因。

A. 测量：使用当前帧正式 evaluator 与可见部件边界，按实际 ownerTransform 和父级世界矩阵映射矩形四角，再求 min/max。处理角色动作替换/Graphic 当前帧与有效可见性；不要把 combinedLocalBounds 直接当世界矩形，也不要重复乘 owner 变换。画布吸附可用 Konva，但正式位置由当前 domain 计算。第一版的世界空间与屏幕固定空间需分开；混合空间用明确投影转换，或先分组操作，不默默混用。
B. 选组：使用有效父子关系（包含当前时间的 parentKeys），选择父与子时只移动父级根一次，计算整个参与组的可见边界；单独选择子对象则对父级世界矩阵取逆，把世界目标位移转换为该子自身编辑空间。父链内部挂点需使用当前有效 attachment transform。矩阵不可逆时标明该对象无法求解，其余对象仍可规划。锁定对象可作参考，不直接改变；已锁定的后代不得因批量操作违背现有父级编辑语义。
C. 对齐：组边界为 B，参考边界 R，dx = R.minX - B.minX（左），或 R.centerX - B.centerX（中），或 R.maxX - B.maxX（右）；y 同理。默认对齐到选区整体边界；需要以指定对象为基准时保留旧 reference 入口。
D. 均分：n>=3，按组轴中心排序，计算 gap=(总轴跨度-各组轴宽度总和)/(n-1)，固定两端（正常不重叠场景），逐组递增 cursor，目标 min = cursor；Y 轴同理。如果 gap<0，提供参考 Excalidraw 的“中心等分（可能重叠）”或扩大排列范围，避免悄悄把等间隙命令换掉；检测边界由同一组同时控制两端的退化情况，直接按明确中心范围求解。等高按参考可见高度/当前可见高度统一乘原 scaleX/scaleY，保持比例；从可见底边重新计算平移。双人站位复用 34%/66%、92% 地线作为可调整默认比例，而不是固定像素；可泛化到多个对象。
E. 写入：不能直接改 layer.x/y 或把所有 scaleX/scaleY 当单一 scale。当前 [PositionProjectService.applyBaseBoundLayerChange](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/PositionProjectService.ts#L218-L266) 会同步基础变换、clip basis、Position chain；[LayerService.updateTransform](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/LayerService.ts#L918-L958) 的旧式 scale 参数会同时写两轴，非等比对象优先用支持双轴的正式 patch。对当前帧使用 [LayerMotionService.applyTransform](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/LayerMotionService.ts#L565-L690)，它已处理 autoKey、相对基准、pivot 和旧事件控制。用当前已有画布拖动的坐标转换规则接线，不在 planner 另发明。遇到现有事件控制且 autoKey 关闭时，明确允许开启自动关键帧/改基础姿态，不突破已有变换约束。 
F. 一次 Apply：先在候选 Project 计算预览，再使用 BatchLayerControls 的一次 updateProject 提交；使用前一快照/选择/时间核验，跳过无变化。无需新布局 Store。

### 3.3 最小验收

横纵六向对齐、横纵均分、等高、双人底边站位；至少一个混合角色/Graphic/道具组、旋转/镜像、父子同时选中与单选子、已有关键帧对象，结果和画布一致，撤销一次恢复。保留 Konva 吸附作为后续自然增强，不要求新拖拽系统。

## 4. 03｜自动布景（#934 AC、#1037 AUTO-04）

### 4.1 取旧代码而不是旧引擎

[旧 SceneCreationService](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/domain/services/SceneCreationService.ts#L277-L430)、[SceneCreationPanel](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/renderer/features/shots/SceneCreationPanel.tsx#L710-L902) 有实际资源匹配、主画布只读预览与生成；[multiSceneInput](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/scene/multiSceneInput.ts#L18-L48)、[MultiSceneService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/MultiSceneService.ts#L210-L355) 有结构化多镜头计划。旧 [sceneResources](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/scene/sceneResources.ts#L50-L108) 限制 composite + image 背景，旧双人和 2–3 镜头是实验合同，应适配当前能力。

外部 [Ren'Py 显示图像指令](https://www.renpy.org/doc/html/displaying_images.html) 提供 scene/show/hide/位置的语义；[OpenToonz Scene::loadLevel/setCell](https://github.com/opentoonz/opentoonz/blob/7ccd773ee646e99debd14917436550c5c3b94655/toonz/sources/toonzlib/scriptbinding_scene.cpp#L125-L201) 提供脚本创建正式场景的参考。都不需要把其运行时搬到 Panda。

### 4.2 建议实施顺序

1. 沿用中文输入（镜头、背景、出场、站位），单镜头是数组长度 1 的同一条计划路径；多个块由 --- 分隔。内部最小 SceneDraft：name、可选 durationMs、background 候选、cast 数组（显示名称、选定角色 ID、可选位置/尺度）、可选道具。允许单人、多人、无人物纯景，根据实际镜头需求安排；初版有双人落地默认和手工位置，不做自动构图 AI。缺背景允许使用现有空背景，无法匹配的角色可手工选择或明确跳过。
2. 对照当前资产身份建立 resolver，按正式资源类型检索，名字仅做建议，最终固定 characterId/animationId/assetId。不要从旧 composite-only 筛选器复制硬限制；角色表情/动作选项沿用角色现有定义。
3. 用 [ShotService.create](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/ShotService.ts#L70-L94) 创建正式 Shot，保留现有默认字幕样式和时长校验。用 [AssetDropPayload](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/assetDropPayload.ts) 与 [LayerService.createFromAsset](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/LayerService.ts#L477-L542) 放置图片、普通角色表情、动画 Graphic；adaptive 角色走 [createFromAdaptiveCharacter](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/LayerService.ts#L718-L744)；背景走 [setBackground](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/LayerService.ts#L745-L766) 处理可渲染图片/元件背景和锁定。不要直接构造旧 Layer 或强制所有对象先成为 Character。
4. 用 02 布局算法安排角色和道具，输出实际图层。模板仅可作为可选输入，不阻塞此组。单镜头默认时长按现有普通创建规则/用户指定，若有 01 音频计划则以需要的实际时长为准。 
5. 使用候选 Project 通过现有画布只读预览（旧 #934 预览生命周期可参考；当前已有 recipe.preview 的候选 project 通路，实际多镜头 preview 路由需薄适配）。不要为了预览先提交再 Undo。切工程或所引用资源变化时重新解析；用户确认后只提交一次，切换选中新镜头。多镜头可以整批应用或明确选择可用的镜头，失败不留下意外半批。
6. 恢复一处工具入口，不在左右两套面板重复摆同样的自动布景。预览使用当前主画布，资源替换沿用现有资源选择组件；不搬旧 portrait 布局。

最小验收：一个单镜头、两个连续镜头，含普通图片背景与实际 Graphic、分件角色；名称歧义手选、缺一个素材时其它镜头仍可生成；取消无工程修改，提交后可编辑/撤销/导出。

## 5. 04｜剧本与表演编排（AUTO-05/06）

### 5.1 复用来源

[旧 MultiSceneDialogueService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/MultiSceneDialogueService.ts#L109-L275) 与 [MultiScenePerformanceService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/MultiScenePerformanceService.ts#L110-L240) 组合布景、全剧本配音与动作；[旧 performance 指令定义](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/scene/multiScenePerformance.ts#L12-L91) 已有左/右入场、移动、放大、抖动、表情、淡入淡出；[真实旧示例](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/renderer/features/shots/multiScenePerformanceExample.ts)。 
[Monogatari Action.ts](https://github.com/Monogatari/Monogatari/blob/fea01a2e8523d2d1f73c7a8a7d26c0a5dbba4d6a/src/lib/Action.ts#L12-L60) 的职责分离；[Motion Canvas EditableTimeEvents](https://github.com/motion-canvas/motion-canvas/blob/7b91435c301d530351dcf5ebb91dd139c002e405/packages/core/src/scenes/timeEvents/EditableTimeEvents.ts#L33-L104) 名称/原始时间/目标时间/偏移思路。仅借鉴，不引入游戏运行时或新的 timeline evaluator。

### 5.2 具体实现

建议用原简洁中文文本，内部解析为普通数据结构；不先开发新 DSL、脚本解释器或自动写代码执行。示例（新增时间锚点为建议语法，需以后确定；首版可使用旧格式）：

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

A. 解析器将各块的对白、表演指令分开；沿用 03 场景 planner 与 01 音频 planner。表演的 1/2/3/4 在本次解析预览绑定到稳定 draftRowId，生成正式 Dialogue 后记录 ID 映射。编辑后保留可明确对应的绑定；无身份重新粘贴时不猜。第一版默认对白起点触发，持续时间使用现有动作预设参数；可加“对白末尾”“起点+毫秒”等明确选项，但不强制所有动作跟随对白。
B. 候选阶段按镜头逐个规划资产/角色/时间 → 正式场景 → 正式 Dialogue/AudioClip → 动作参数解析与合法位置校验。对同一角色多个属性的动作可同时发生；同属性覆盖冲突使用现有 action validator，提供受影响行的修正方式。动作超出镜头时预览指出需扩展或修改参数，不偷偷缩短配音。缺失动作允许生成其它已确认内容。
C. 直接调用当前 [applyPresetEvents](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/actions/applyPresetEvents.ts) 与 [desktopAutomationCommands](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/renderer/shell/desktopAutomationCommands.ts#L51-L93) 中现有 createPresetEvents/validatePresetApplication/applyPresetEvents、action recipe 服务。用户已有分层角色动作可用 [CharacterActionEventService](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/CharacterActionEventService.ts)；换表情、关键帧、相机预设等按已有正式 API 逐个接入。首版先贯通旧八种动作预设+一个现有角色动作/配方，之后按实际创作补 IK、运镜与特效，不在首版假称任意自然语言动作都能解析。已生成动作必须能继续普通编辑。
D. UI 和 CLI 共用同一 plan/apply 函数。现有 [desktop-automation-api](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/shared/desktop-automation-api.ts#L14-L33) 仅 state/dialogue.update/preset.apply/recipe.apply/undo/preview/batch/sequence，当前 batch 按最多 32 个现有 edit 生成一次正式提交，[executeDesktopAutomation](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/renderer/shell/desktopAutomationCommands.ts#L95-L135) 已有 session 检查、候选与 updateProject。建议在完整 UI 纵切跑通后增加一个结构化的 script.plan/apply（候选名，不是已存在 API），使用现有 session 和 request size/timeout，返回行级结果及已生成身份。不要新增任意 eval、任意文件权限或第二 socket；也不要强制把长剧本拆成几十个外部调用造成半成品，按已选中的镜头批次处理。
E. 时间联动：初版使用解析时的稳定 ID + 绝对正式时间（生成完后仍独立可编辑）。如作者明确选择“对白和关联表演一起移动”，优先在 07 复用当前已存在的时间关联/事件规则；需要长期保存 anchor 时才增加显式数据合同、迁移与引用验证。Motion Canvas 的 named time event 思路是参考，不把所有动画重新计算成程序运行结果，不把生成器隐藏成正式渲染源。

### 5.3 验收

两镜头四句至十句真实配音；自动布景、音轨、字幕与三种实际动作；一次应用，手工改一个关键帧/相机，保存重开，导出。再验证同一结构输入经 CLI 得到等价结果（非 UUID 字符串强相等）；失败不把未确认计划写入工程。首版不要求 AI/TTS/ASR 或泛用编剧系统。

## 6. 05｜跨项目素材复用（EF-04）

### 6.1 供体与当前事务入口

- [旧 ProjectResourceImportService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/main/services/ProjectResourceImportService.ts#L231-L395) 有来源检查、准备依赖、ID 重映射、文件复制、目标事务和失败回滚；[依赖实现](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/main/services/ProjectResourceImportService.ts#L405-L704) 针对旧图片角色。
- OpenToonz [ChildLevelResourceImporter](https://github.com/opentoonz/opentoonz/blob/7ccd773ee646e99debd14917436550c5c3b94655/toonz/sources/toonz/iocommand.cpp#L652-L890)、[SceneResources](https://github.com/opentoonz/opentoonz/blob/7ccd773ee646e99debd14917436550c5c3b94655/toonz/sources/toonzlib/sceneresources.cpp#L591-L720) 的资源类型策略；Blender [append dependency/reuse](https://github.com/blender/blender/blob/87f1be6d38070d755be2679d9a38c19676634eae/source/blender/blenkernel/intern/blendfile_link_append.cc#L1180-L1450) 的依赖递归/身份复用；[Godot ResourceLoader](https://github.com/godotengine/godot/blob/7c97c297793ce4711679491d34693a5719a79ebe/core/io/resource_loader.cpp#L1348-L1356) 与 [ResourceUID](https://docs.godotengine.org/en/stable/classes/class_resourceuid.html) 的资源身份思想。OpenToonz 可参考 BSD 核心；Blender GPL 只参考语义。
- 当前 [ProjectService.open](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/main/services/ProjectService.ts#L247-L286) 会调用 onProjectOpened；不能直接用它读取来源工程并假设无会话副作用。当前 [transact](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/main/services/ProjectService.ts#L305-L327) 已拥有目标 root 的独占 coordinator、原子 save；[AssetImportFileSystemService](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/main/services/AssetImportFileSystemService.ts#L92-L185) 已有原子复制与 rollbackImportedFile；[FlaGraphicInstanceCommitService](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/main/services/FlaGraphicInstanceCommitService.ts#L887-L946) 已有当前 revision 检查、文件和工程保存失败回滚的成熟实际路径。
- [EditorProjectStore.acquireProjectOperationLease/acceptSavedProjectCommand](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/renderer/stores/EditorProjectStore.ts#L225-L289) 可在 Main 保存成功后承认一次 History command。不能先 Main 写盘、再 renderer 用陈旧快照覆盖。

### 6.2 数据流（最小依赖闭包，不造资产数据库）

用户在目标工程 B → 选择另一个 Panda 工程 A（Main） → 只读迁移/解析 source project（复用现有 readProjectFile + migrateProject，必要时抽取薄 read-only helper，不触发 open-session 回调、不自动保存 A） → 列出可导入角色/图片/Graphic/动画 → 用户勾选 → 计算计划（选中资源、递归必要依赖、实际文件、可确认复用项、缺失项） → 选择名称冲突处理 → 一次 Main commit → B 素材库刷新。

依赖收集必须以当前模型为准：
 
| 入口 | 应递归覆盖（按实际字段与现有服务读取） |
|---|---|
| 普通图片/音频/视频 Asset | 元数据、项目内合法相对路径、必需媒体文件；生成缩略图等可重建缓存按现有规则 |
| Character | 角色部件、脸/嘴型/表情、VoiceProfile、Graphic visualSource、引用的动画/角色动作素材；部件/表情/动作内部 ID 属于角色的身份关系 |
| Animation / FLA Graphic | 帧资源、结构 Definition/subtree、内部 timeline/符号引用、bitmap/fallback 媒体、必要 source-backed 数据 |
| Reusable animation segment / action recipe（按需） | 仅在用户选中或实际依赖时带上其动画、预设或绑定所需定义，不把所有项目库作为必需依赖 |

当前 [referenceScanner](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/validators/referenceScanner.ts) 已识别多类 asset/animation/character 引用，但它主要做反向扫描（谁引用某 asset），并非一个可直接返回完整导入闭包的服务。复用其中已有类型/选择逻辑、当前 validators 与 source-backed schema，再写必要的前向 collect。不能只看当前帧的 visual resource.required 就遗漏其它帧；[visualParts resources](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/selectors/visualParts.ts#L198-L229) 可作交叉核对。[FLA Structure](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/models/flaGraphicStructure.ts#L8-L16) 的稳定 node/source identity 与共享 symbol 引用必须保持。先为实际选择项收集，不做全项目无关 hash/逐帧渲染。

建议实现：visited set + 按类型和源 ID 的映射；同一个依赖只收集一次。分两步分配目标 project-level IDs，再复制/重写所有正式引用，避免递归环和共享定义被重复复制。内部结构 ID 若为 definition 局部/sourceAddress，不要全局字符串替换；若现有 schema 要求重映射，则同时更新引用、override、part/动作 track/attachment identity。目标已有可证明一致且兼容的资源允许复用现有 ID，不能仅凭同名或同 UUID 在不同工程就认定内容一致。名称冲突默认生成可辨别名称；首版默认独立复制来源定义，必要文件去重使用已有文件/元数据证据，不新做全仓 Hash。不支持的资源项列出影响的实际依赖，可独立导入其它已完整的项目。

### 6.3 事务与文件处理

1. 来源文件在 Main 使用现有安全项目路径规则（避免越出 assets、符号链接逃逸或源/目标同路径），不允许 renderer 直接读 fs。来源只读；若用户选择旧 #1037 自定义 v18 私有工程，其历史 schema 与正式 v18 不同，提示需按需迁移，先不为不存在的工程编写大规模兼容器。
2. 预览无写盘。提交时获取当前 renderer lease / revision，Main 复核 source 和 target 实际选择是否仍有效，目标事务以当前权威 Project snapshot 为基准，避免从旧磁盘内容丢掉未保存编辑。现有 FLA commit 是接线参考，不扩大全局锁。
3. 只复制计划中的实际文件，经已有 AssetImportFileSystemService 生成不冲突的目标相对路径；记录本次新文件，复用文件不进入清理列表。建立完整目标 Project 候选并用现有 ProjectSchema/reference validator 检查；文件和项目任一失败回滚本次改动，旧数据不动。
4. Main 保存成功后走现有 acceptSavedProjectCommand 或相同已验证的响应接线，release lease；renderer 只认可一次提交。现有接口能记录一次工程撤销，但物理资源文件 Undo/Redo 的生命周期需沿用已有资产政策：不可在 Undo 时直接删除 Redo 还需要的文件，也不宣称旧 EF-04 已提供物理文件撤销。按正式资源删除/回收方式处理，不造新垃圾回收系统。
5. IPC 沿用 shared schema、Preload allowlist、trusted Main sender、项目会话校验。UI 只增加“从其他工程导入”与选材列表/必要冲突提示；不添加跨项目实时引用、常驻素材服务器、自动同步或复制整个工程。

最小验收：先支持一套实际 Graphic 角色（含必要部件/表情/动作、bitmap 资源），一张背景、一个道具，依赖共享去重，B 独立编辑不影响 A；保存重开；目标保存失败时无本次残留文件/错误引用。若某种高阶资源不支持，先报告并隔离，不阻止完整选项。此组独立于 01–04。

## 7. 06｜镜头模板（AUTO-03）

### 7.1 具体复用

[旧 ShotService.saveAsTemplate/createFromTemplate](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/ShotService.ts#L209-L251) 保存结构、清除对白音轨，但重建默认相机。[当前 ShotService.duplicate](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/ShotService.ts#L95-L178) 已经统一创建镜头、layer/dialogue/audioClip/event IDs，重映射 parentLayerId、parentKeys、animationTimeLink、motion owner、background 和口型 dialogueId。它比旧 remap 适合当前 v47。 
借鉴 [Godot PackedScene](https://docs.godotengine.org/en/stable/classes/class_packedscene.html) 的节点归属与实例化、[OpenToonz Sub-Xsheet](https://opentoonz.readthedocs.io/en/latest/working_in_xsheet.html) 的保存与独立 clone、[Kdenlive Library](https://github.com/KDE/kdenlive/blob/a5eba1730ac524c83b64715d1da10b158d7dbef7/src/library/librarywidget.cpp#L235-L319) 的组合复用入口。三者的数据模型不直接引入。

### 7.2 先跑通结构复制，再决定命名模板库

1. 把当前 ShotService.duplicate 扩为明确复制模式（普通完整复制保持原行为；新增“仅布景/动作”模式）。最好共用其现有 remap 步骤，不是复制后再人工删除一堆条目。建议首版至少保留背景、人物、道具、图层顺序、角色定义、静态变换、动画轨/父子/深度、视觉效果、手工相机及自动构图模式；保留资源身份引用，实例 ID 新建。
2. 结构复制默认移除对白及对应 role=dialogue AudioClip，以及与被移除对白绑定的 mouth-pose 等事件。BGM/SFX 是否保留应有明确选项（建议第一版“仅布景/动作”默认不带音频，另可选保留非对白声音）。不静默复制原集配音。独立手工表情/身体动作可保留。旧 audio 驱动已烘焙普通 keys 的效果是否保留按其当前数据语义决定，不能猜测来源。 
3. 先按保留集合构建 ID map，再重映射 layer/event 及其关联。若 animationTimeLink 指向被删除的事件/音轨等，应显式解除、保留当前可编辑独立播放基准或提供选项，而非留下失效引用。当前 [ShotCameraSchema](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/models/shotCamera.ts#L25-L57) 还有 override ID、曲线、autoFraming，模板实例复制时要核对其 ID 作用域及新相机引用。不要把旧 v18 默认相机搬回来。
4. 如需真正保存可复用命名镜头模板而不依赖源 Shot：使用现有模板/资源库入口增加简单项目内结构快照，项目级资源定义共享、每个实例新 ID、模板与实例后续编辑独立。可先以普通镜头列表中“复制结构”满足首个创作需求，再在实际需要保存/命名/删除模板时加入新的可选正式字段；参考 [现有项目级 preset/segment/recipe schema](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/models/project.ts#L690-L745) 的方式，按当时最新 schema 做必要迁移和引用扫描（模板也算资源引用，不能删除仍被模板使用的素材）。不引入 nested Shot evaluator、模板继承、全局模板数据库。跨项目模板可等 05 资源闭包成熟后按同一策略扩展，不作为本组首版阻塞依赖。

验收：有多层父子级、Graphic、动作、相机和对白的真实镜头，生成新的结构镜头；无原对白配音，视觉结构和应保留动作正确，两个镜头独立编辑，普通复制行为不变；若交付命名模板，另验证重开后实例化、删除模板不会删除已生成实例。

## 8. 07｜批量时间编辑（AUTO-02、EF-03）

### 8.1 精准接入

[旧 DialogueService.moveMany](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/DialogueService.ts#L421-L550) 已用同一快照计划多条对白整体移动；[旧 TimelineEventBatchService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/TimelineEventBatchService.ts#L186-L295) 已用 plan/apply 统一事件移时/时长。Kdenlive [Spacer](https://github.com/KDE/kdenlive/blob/a5eba1730ac524c83b64715d1da10b158d7dbef7/src/timeline2/model/timelinefunctions.cpp#L485-L783)、[GroupsModel](https://github.com/KDE/kdenlive/blob/a5eba1730ac524c83b64715d1da10b158d7dbef7/src/timeline2/model/groupsmodel.cpp#L82-L114) 展示临时选择组和失败恢复；借鉴行为即可，不复制 GPL C++。
当前 [DialogueService.move](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/DialogueService.ts#L446-L464) 单句会独立 clamp，且检查其它字幕；直接循环会导致中间状态重叠、每句移动距离不同。当前 [replaceShot](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/DialogueService.ts#L835-L861) 仅把一个 moved 对象交给 [reconcileDialogueMouthPoses](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/mouthPoses.ts#L150-L178)，后者用单个 dialogueId/deltaMs 平移口型并核对音频 source clock。这是多句批移植的明确改造点。

### 8.2 对白/配音批移

1. 复用现有 [dialogueSelectionStore](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/renderer/stores/dialogueSelectionStore.ts) 及 timeline selection，临时选区属于 session，不写进项目。普通 Shift/Ctrl 多选与动作批量选区按现有时间轴手势适配，不新建永久通用 Group 系统。
2. 捕获选区中已定时的 Dialogue + 必要关联 AudioClip + 以 dialogueId 绑定的 MouthPoseEvent；保留原时长、相对间距、audio offset/volume。计算整体允许 delta 范围：下界=max(-start_i)，上界=min(shot.durationMs-end_i)，覆盖所有需要移动的真实时间段；同一组只有一个 delta。边界处统一限制或提示延长，绝不对每条分别 clamp。
3. 从原始 shot 一次性算最终候选区间。选中项之间原间距不变；只需核查与未选项、正式音轨与事件约束的实际冲突，合法结果一次替换。不要逐句调用 move 依赖执行顺序。例：A [0,1000)、B [1000,2500) 整体 +500 → A [500,1500)、B [1500,3000)，顺序移 A 会与旧 B 冲突；应同时计划最终结果。
4. 关联音轨所有者：按现有单句服务的共享 clip/绑定规则处理；同一个 clip 被多个选中对白共享时只处理一次，如果还有未选对白引用它，不直接移动未选对白的声音，必要时拆分引用（沿用现有 ID/ownership 合同）或显式将关联行加入选择。无音频对白仍可批移。
5. 将 reconcileDialogueMouthPoses 的 moved 参数薄扩为支持每个 dialogueId 的 delta map（兼容现有单句调用），从原始 shot 到最终 shot 调和一次，避免逐个调和时误删其他口型。保留其中 sourceClock 与 clip trim 检查。已存在的明确时间关联/挂接事件用当前合同处理；不存在的表演锚点不猜测绑定。
6. 一次 updateProject，失败不提交。首版只移动已选内容，Kdenlive 式 ripple（所有后续内容整体腾挪）可在明确请求后增加独立选项，不默认推走其它轨道。

### 8.3 动作批移与统一时长

1. 恢复旧 TimelineEventBatchService 的输入与候选规划思路，优先支持当前模型中明确区间的 move/scale/opacity/shake/character-action/其他已支持独立事件。先列出当前类型的时间字段和约束，而不是把历史 event enum 全量搬回来；参考 [当前 timeline-event 模型](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/models/timeline-event.ts) 与 [PositionProjectService](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/PositionProjectService.ts)。 
2. 移时保持长度和事件参数；统一时长为 newEnd=start+duration，需明确是否改变已有动作播放速度/相位。对于真正关键帧选段使用当前 [LayerMotionService](https://github.com/Cognitive-Architect/panda-stage/blob/3319df7c58e2b5147bcfdc3191fd933db4c9fdb1/src/domain/services/LayerMotionService.ts) 现有 retime/applyKeys 路径，不以改事件 end 冒充关键帧变速。必要时按相对比例映射选段中 keys，再按现有 frame grid 处理碰撞；保留 easing/曲线。角色动作与 Graphic playback 等应调用各正式类型的时间编辑规则，避免原生 time-link offset 和已绑定动作失效。
3. 复用现有 timeline event validator、位置链/图层关联、相机 override 和当前动画时钟；明确首版支持哪些区间类型，未支持类型保持不动并给出局部原因。对话与动作跨类型混合选择时先只做保持相对间隔的整体移动；不开发“所有轨道一套超通用事件重写器”。
4. 对齐现有时间轴多选 UI，提供批量平移、统一时长两个直接操作，候选可预览；一次撤销。暂不引入 OTIO、重新实现 NLE 轨道系统或自动时间拉伸引擎。

验收：批移三条带配音对白（包含有源 offset/口型）、同时移动相邻区间不假冲突，选区中有未绑定声音也可用；动作批移/统一时长后播放与导出相同，遇到现有约束保持其它功能可用；一次 Undo/Redo。

## 9. 施工依赖与分组建议（不是 Issue）

| 组 | 最先交付的纵切 | 依赖 | 推荐复用 |
|---|---|---|---|
| 01 | 真实音频一键排轴 | 无新组 | 旧 AS + 稳定 ID + DialogueService |
| 02 | 横纵对齐/均分/等高/站位 | 无新组 | Excalidraw 数学 + 当前变换服务 |
| 03 | 一/多镜头自动布景 | 02 布局子集 | 旧 scene planner + 当前 Shot/Layer |
| 04 | 剧本→可编辑表演 | 01、03 | 旧 AUTO-05/06 + 当前动作/CLI |
| 05 | 选材跨项目导入 | 无新组 | EF-04 + 当前事务/资源引用 |
| 06 | 仅布景/动作复制→按需命名模板 | 无新组 | 当前 Shot remap；05 后可扩跨工程 |
| 07 | 整体批移/统一动作时长 | 无新组 | 旧 batch plan + 当前事件/口型/时钟 |

可并行 01/02/05/06/07；03 只依赖布局子集，不需要等 02 的所有高级行为；04 在 01/03 纵切通畅后推进。07 的长期对白表演联动可复用 04 的显式身份，不作为普通批移阻塞。最终合流建议用一份代表性短片：从另一个工程导入角色和背景，创建/复制镜头，排台词和真实声音、自动编排表演、批量调整后输出。每个纵切只跑仓库现有规定的必要定向验证，不增加全仓巡检、额外硬门禁或多套重复验收。按用户需求确认后再拆票/施工，不直接把旧母 PR 整体合并。

## 10. 本轮实质发现与不确定点

- 当前 Dialogue.bindAudio 有自动延长 one-frame placeholder，旧 AS plan 不能不经检查直接搬；当前口型调和只支持单个 moved 对象，批移必须由原始/最终快照一次处理。
- 当前 PositionProjectService 同步动画基准；新父级 attachment/time-link 让布局和模板必须走正式变换与 ID remap，不能直改 x/y、简单复制字段。
- 当前 ProjectService.open 会触发 onProjectOpened，跨工程选择来源应实现薄只读读取；反向 referenceScanner 不是前向依赖闭包；已有 FLA 事务/operation lease 可避免重新造文件事务与会话系统。
- 尚未实际运行这些适配，具体 API 命名、模板字段、默认 BGM 策略、是否持久化表演 anchor 是建议，不是已确定事实；优先最小实用实现再按真实创作扩展。本轮只归档研究报告，不改业务代码、创建 Issue、关闭 #1037/#934 或影响 ReShell。

```text
=== AUTO SAVE ===
时间：2026-11-27
做了什么（结果）：基于实时 main 3319df7、旧 PR 和已选开源供体，逐项定位七组源码复用、当前接线接口、关键算法、事务与最小验收。
当前状态（一句话）：七组已有施工级技术路径，等待 OWNER 确认并拆票。
下一步（唯一可执行）：按本报告与前两轮研究确认范围，形成以最新 main 为基线的统一研发路线和实施票。
风险 / 未验证（翻车点）：未运行编译、外部产品、实机或 UAT；布局坐标适配、音频边界、跨工程引用闭包与文件撤销需实作验证；命名模板与持久 anchor 为建议范围。
=================
```
