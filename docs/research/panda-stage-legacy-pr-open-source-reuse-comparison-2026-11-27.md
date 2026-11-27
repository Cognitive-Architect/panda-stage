# Panda Stage｜#1037 / #934 七组生产力能力：外部成熟实现复用调查

日期：2026-11-27。性质：第二轮 Research，外部轮子选型与已有源码对照。不是实施授权、全仓质量审查或实机验收。

## 0. 一句话结论

**七组能力均存在成熟的相关实现，但没有找到一个可以直接替换 Panda 整条可编辑工程生成链的成熟开源项目。** 建议保留本项目的字幕排轴、布景/表演规划、正式服务及 History；选取 Excalidraw 的布局算法、Ren'Py/Yarn Spinner 的对白身份机制、Motion Canvas 的时间锚点、OpenToonz/Blender/Godot 的资源依赖与模板语义，以及 Kdenlive 的成组时间操作。优先小块适配，不引入第二套动画、游戏、资源或时间轴引擎。

本轮最直接的代码供体是 Excalidraw（MIT/TypeScript，实际 align/distribute 及测试），最接近动画资源生产流程的是 OpenToonz（核心 BSD-3-Clause），最值得加入旧设计的能力是稳定对白身份，以及跨项目按依赖复用素材。

## 1. 基线与调查方法

- 用户提供的[上一份研究报告](https://github.com/Cognitive-Architect/panda-stage/blob/1ebb58010d09963e00b5e4b03cdddb7242ee94ba/docs/research/panda-stage-legacy-pr-1037-934-reuse-audit-2026-11-27.md)为七组需求清单与 Panda 实现基线。旧供体 #1037 HEAD a1ada25、#934 HEAD 9df4ae2；正式源码 b76b735 / Schema v47。
- 本次核对实时 main 为 1ebb580；与 b76b735 的 compare 结果仅增加上一份 Markdown，未变更业务源码。因此复用原调查的固定源码证据。仓库 [AGENTS.md](https://github.com/Cognitive-Architect/panda-stage/blob/1ebb58010d09963e00b5e4b03cdddb7242ee94ba/AGENTS.md)明确现有 Electron/React/TypeScript/Konva/Zod，唯一 Project/History、Main 负责文件与资源。
- 依据外部项目实际源码、官方文档、仓库 API 许可证元数据；关键实现链接固定到调查时查询的上游 HEAD。未安装或运行外部项目、未跑真实工程或性能对比；“更好”指源码已体现的特定能力差额或更合适的架构语义，并非整产品实测排名。当前工具环境无独立后台研究代理，直接通过 GitHub/官方资料完成调查。
- 按可复用程度区分：A=可移植具体算法或薄工具；B=提取业务/交互语义，接入 Panda；C=可选兼容或扩展方向，不进入首版；保留=本项目已有实现更适合。

## 2. 七组裁决表

| 原方向 | 最合适的外部轮子 | 复用级别与结论 |
|---|---|---|
| AS-01/02 + AUTO-05 自动字幕、配音排轴 | Ren'Py、Yarn Spinner；Manim Voiceover | B：稳定对白 ID + 可导出配音清单；保留 Panda 实际音频排轴与原子生成。词级 bookmark 为 C。 |
| AUTO-01/EF-02 对象排列 | Excalidraw；现有 Konva | A：提取双轴、成组边界、间距算法和测试。保留等高、落地站位、正式世界空间编辑。 |
| AC/AUTO-04 单/多镜头自动布景 | Ren'Py、Monogatari、OpenToonz | B：借鉴结构化布景指令、正式场景 API；沿用旧 Panda planner，扩为当前 Graphic/Character/任意合理角色数。 |
| AUTO-05/06 剧本与表演 | Monogatari、Yarn Spinner、Motion Canvas | B：动作注册、稳定台词定位、时间锚点与可选跟随重排；复用现有服务/CLI，不引入游戏运行时。 |
| EF-04 跨项目素材复用 | OpenToonz、Blender、Godot | B：依赖闭包、复制/共享语义、来源身份与安全复用；保留 EF-04 事务/回滚。 |
| AUTO-03 镜头模板 | Godot PackedScene、OpenToonz Sub-Xsheet、Kdenlive Library | B：结构快照与实例化，区分共享定义和独立实例；首版复用 Shot duplicate/remap。 |
| AUTO-02/EF-03 批量时间操作 | Kdenlive Groups/Spacer、OpenTimelineIO | B：临时选组/整体平移、时间区间/源范围思想；旧 plan/apply 已接近需求，保留并适配。OTIO 仅 C 类交换参考。 |

## 3. 自动字幕与配音：编号升级为稳定身份，现有排轴不换

**Panda 基线**：[旧匹配](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/renderer/features/dialogue/dialogueBatchPlan.ts#L171-L251)使用顺序+规范角色名；[旧生成](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/domain/services/AutoSubtitleGenerationService.ts#L281-L390)依真实音频连续创建 Dialogue/AudioClip，可明确延长镜头、整批一次提交。#1037 [multiSceneAudio](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/scene/multiSceneAudio.ts)同样按全剧本编号匹配。main [Dialogue 模型](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/models/dialogue.ts#L120-L149)已有正式身份、音轨关联、旁白类型，[DialogueService](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/DialogueService.ts)有正式创建/定时/绑定方法。

**外部源码与差异**

- Ren'Py：[voice 官方文档](https://www.renpy.org/doc/html/voice.html#automatic-voice)、[00voice.rpy](https://github.com/renpy/renpy/blob/68816dc9764fb3b4c38035268075111c10802622/renpy/common/00voice.rpy#L345-L378)支持由对白翻译标识生成音频路径，查找实际文件；可从 launcher 导出对白清单给配音。主体 MIT、包含 LGPL 等其他组件（[许可证](https://www.renpy.org/doc/html/license.html)）。这解决的是匹配身份，不是视频时间轴生成。自动生成的文本/翻译 ID 仍需注意文本改动可能改变身份，Panda 不应直接把文本 hash 当永久 ID。
- Yarn Spinner：MIT 核心，[Yarn-Spec](https://github.com/YarnSpinnerTool/YarnSpinner/blob/7b7a98970d824de6912369e8ba2667d323cb6905/Documentation/Yarn-Spec.md)有 lineID 和指令；[DescriptiveLineTagGenerator](https://github.com/YarnSpinnerTool/YarnSpinner/blob/7b7a98970d824de6912369e8ba2667d323cb6905/YarnSpinner.Compiler/LineTaggers/DescriptiveLineTagGenerator.cs#L104-L156)读取已有标签，[插入行编号策略](https://github.com/YarnSpinnerTool/YarnSpinner/blob/7b7a98970d824de6912369e8ba2667d323cb6905/YarnSpinner.Compiler/LineTaggers/DescriptiveLineTagGenerator.cs#L300-L370)考虑相邻编号与新行。其[官方本地化文档](https://docs.yarnspinner.dev/yarn-spinner-for-unity/assets-and-localization)与[音频资源约定](https://docs.yarnspinner.dev/2.4/using-yarnspinner-with-rust/components/assets)明确文本和声音可共享 line ID。
- Manim Voiceover（MIT/Python）：[tracker.py](https://github.com/ManimCommunity/manim-voiceover/blob/3dc0d95d2f1d9d0937872b3dd68c7b38c4dfc96a/src/manim_voiceover/tracker.py#L39-L115)读取最终声音时长，记录 start/end，并在有 word boundaries 时把书签文本位置映射到音频时间。缺少足够词边界时会用线性估算，不能当作真实词级对齐。Panda 首版已有真实长度，无需额外 Python 或 ASR。

**建议落地**：第一次粘贴仍支持 1_师兄.wav 这种简单旧命名；解析预览给每行稳定身份，已生成后尽量复用现有 Dialogue.id。配音清单可导出顺序/角色/台词/ID/音频名；再次导入优先显式 ID 或已经确认的关联，顺序仅作为首次匹配或显示。若纯文本重贴未携带任何身份、重复台词或角色改绑，提示受影响行重新匹配；不要猜。先在已有 DialogueService 上恢复旧 plan/generate，旁白、音频 offset 与口型事件使用当前合同。暂不新造 ID 注册中心，也不强制每句都手写 ID。若未来需要再次生成和保留来源，按真实需求决定是否持久化来源键。

验证主路径：两角色十句，插入一句后原九/十个已有匹配不串台；手动替换；按实际时长一次生成/撤销，重开后可继续编辑和正式输出。

## 4. 对象排列：最适合直接移植的 TypeScript 算法

**Panda 基线**：[quickCharacterLayout](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/layout/quickCharacterLayout.ts#L197-L278)双人可见底边落地，旧 X 34%/66%、地线 92%；[layerAlignDistribute](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/layout/layerAlignDistribute.ts#L19-L37)六动作：左中右/底边、等高、水平等间隙。旧实现对旋转、动画和画布范围有保守限制。当前 [BatchLayerControls](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/renderer/features/properties/BatchLayerControls.tsx#L49-L89)已有批选与操作基础。

**Excalidraw（MIT，TS）**：[align.ts](https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/packages/element/src/align.ts)按 x/y 和 start/center/end 计算组平移，使用 selected group 与共同 bounding box，更新绑定对象；[distribute.ts](https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/packages/element/src/distribute.ts#L20-L119)对组边界排序，正间距=(总范围-各组宽/高之和)/(组数-1)，空间不足则走中心等分策略；[align tests](https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/packages/element/tests/align.test.tsx)、[distribution tests](https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/packages/element/tests/distribute.test.tsx)为可复用测试入口。许可证：[MIT](https://github.com/excalidraw/excalidraw/blob/dabd83c4aa6b9e42d0dd0a42be62200eb8e3cce9/LICENSE)。实际代码还依赖 Excalidraw scene mutation、groups、bound arrows，不能整文件无适配拷贝。

**Konva 现有依赖**：[getClientRect](https://konvajs.org/api/Konva.Node.html#getClientRect)含相对坐标、变换、描边与阴影选项，[Objects Snapping](https://konvajs.org/docs/sandbox/Objects_Snapping.html)演示边缘/中心吸附。作为现有交互预览和对照，正式提交仍由 Panda 现有 domain 世界空间/渲染边界驱动，不以当前缩放后的屏幕像素为唯一事实源。

**裁决**：抽取 MIT 双轴数学与组策略，保留自研等高/落地/预检。一次预览和一次提交。把角色、Graphic、图像和普通图层使用统一边界合同；同一父链避免选中父子后重复移动，旋转/缩放/镜头空间按当前有效世界变换计算。动画对象以明确当前帧或基础姿态编辑语义为准。空间不足可供中心分布/扩展排列范围，明确可能重叠，不自动改变等间隙请求。局部不支持时保留其他可用操作，不重新引入旧全局硬拒绝。

首版验证：横/纵对齐、横/纵均分、不同身高等高、两角色落地，混合对象与一个父子级用例。

## 5. 单/多镜头布景与剧本表演：成熟脚本思想 + Panda 正式工程编译

**Panda 基线**：#934 [SceneCreationService](https://github.com/Cognitive-Architect/panda-stage/blob/9df4ae2ac7c7bd1b1085a00c57c901fe67eee473/src/domain/services/SceneCreationService.ts#L277-L430)已做名称解析、候选匹配、正式单 Shot；#1037 [multiSceneInput](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/scene/multiSceneInput.ts#L18-L48)旧边界 2–3 镜头/双人；[MultiSceneService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/MultiSceneService.ts#L210-L355)、[MultiSceneDialogueService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/MultiSceneDialogueService.ts#L109-L275)、[MultiScenePerformanceService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/MultiScenePerformanceService.ts#L110-L240)形成实际场景+音轨+事件链。正式 [desktop automation](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/shared/desktop-automation-api.ts#L14-L32)已有修改对白、应用预设/配方与 batch，不包含完整新建镜头/生成配音流程。

- Ren'Py [显示图像语义](https://www.renpy.org/doc/html/displaying_images.html)：scene/show/hide/with、角色图像 tag/attributes、位置/转换。比旧纯双人站位语义灵活，但目标是交互式小说，不是生成编辑器项目。
- Monogatari MIT/TypeScript：[Action.ts](https://github.com/Monogatari/Monogatari/blob/fea01a2e8523d2d1f73c7a8a7d26c0a5dbba4d6a/src/lib/Action.ts#L12-L60)区分语句匹配、执行生命周期和回退；[Scene.ts](https://github.com/Monogatari/Monogatari/blob/fea01a2e8523d2d1f73c7a8a7d26c0a5dbba4d6a/src/actions/Scene.ts#L83-L155)实际通过子动作执行背景、场景状态、人物和历史。借鉴职责与可扩展动作入口，不采用 DOM 状态存储/游戏回退运行时。核心许可见 [LICENSE](https://github.com/Monogatari/Monogatari/blob/fea01a2e8523d2d1f73c7a8a7d26c0a5dbba4d6a/LICENSE)。
- Yarn Spinner [规范](https://github.com/YarnSpinnerTool/YarnSpinner/blob/7b7a98970d824de6912369e8ba2667d323cb6905/Documentation/Yarn-Spec.md)区分台词与向宿主发命令；把表演指令从对白文本中分离。无需把完整分支剧情语言、C# 编译器或虚拟机嵌入 Panda。
- OpenToonz 核心 BSD-3-Clause：[scriptbinding_scene.cpp](https://github.com/opentoonz/opentoonz/blob/7ccd773ee646e99debd14917436550c5c3b94655/toonz/sources/toonzlib/scriptbinding_scene.cpp#L125-L201)真实通过 loadLevel/setCell 操纵正式场景，而不是把脚本变成平面视频。证明现有编辑器服务可对自动化开放；Panda 用自己的 CLI、ProjectStore 和 domain 服务，不搬 Xsheet 引擎。
- Storyboarder 是相关产品参考，但**不列为当前可直接复用的开源供体**。[README](https://github.com/wonderunit/storyboarder/blob/8b81a25c71d5f7ca46e8d5b8e3d4f7b3968f95c2/README.md)支持 Fountain 剧本，[fountain-data-parser](https://github.com/wonderunit/storyboarder/blob/8b81a25c71d5f7ca46e8d5b8e3d4f7b3968f95c2/src/js/fountain-data-parser.js)归纳场景/人物/地点并估算时长，[fountain-scene-id-util](https://github.com/wonderunit/storyboarder/blob/8b81a25c71d5f7ca46e8d5b8e3d4f7b3968f95c2/src/js/fountain-scene-id-util.js)插入场景 ID，[board.js](https://github.com/wonderunit/storyboarder/blob/8b81a25c71d5f7ca46e8d5b8e3d4f7b3968f95c2/src/js/models/board.js#L62-L81)让板时长至少覆盖音频长度。不过当前仓库 API 无 SPDX license，安装 [EULA](https://github.com/wonderunit/storyboarder/blob/8b81a25c71d5f7ca46e8d5b8e3d4f7b3968f95c2/build/license_en.txt#L45-L71)有分发/修改限制及组件单独许可；调查到该 HEAD 不应整体复制其源码。这里只参考公开功能思路，具体文件若要复用另查明确许可。其 repo API pushed_at 为 2024-03-17；维护性也弱于本轮其他候选。
- Motion Canvas MIT/TypeScript：[Time Events 官方文档](https://motion-canvas.io/docs/time-events/)及 [EditableTimeEvents](https://github.com/motion-canvas/motion-canvas/blob/7b91435c301d530351dcf5ebb91dd139c002e405/packages/core/src/scenes/timeEvents/EditableTimeEvents.ts)通过命名事件、initial/target/offset 将动作与可拖动时间点分离，修改一个延时可联动后续事件或保留其它时间。其编程动画时间重算不是 Panda 的正式时间轴编辑方式，但“命名时间锚点”很适合对白驱动表演。

**裁决**：一个已有纯规划链，扩展简单文本合同。逐步支持 scene/背景/出场/位置、对白绑定、动作名与参数、相对对白起点或结束的时间偏移。编排时使用稳定行 ID 而非全剧本序号单独充当身份，仍显示序号方便作者。先把指令解析为普通 Shot/Layer/Dialogue/AudioClip/Event/Clip 计划，再调用现有 create/apply；普通已生成动作保持可独立编辑。若真实场景需要“台词移动时动作跟随”，优先使用已有时间关联/批量编辑机制或显式重排选项，暂不增加默认持久化强耦合。用户或 AI 都通过同一服务/CLI，不新造运行时。

推荐先走已存在的中文输入，单镜头与多镜头共用 resolver、布局、音频匹配。旧 composite-only、图片-only、2–3 镜头、固定双人是试验限制；从真实需要的素材种类与人物数逐步扩，不以旧限制阻塞整体。Fountain 等通用剧本导入仅未来候选，不要求用户改写为英文 DSL。先验证一组可编辑两镜头场景及真实配音、三种已有动作，导出可听可看。

## 6. 跨工程素材：OpenToonz + Blender/Godot 的成熟依赖复用

**Panda 基线**：[ProjectResourceImportService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/main/services/ProjectResourceImportService.ts#L231-L395)已有只读来源、目标事务、ID 重映射和失败回滚，[依赖准备](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/main/services/ProjectResourceImportService.ts#L405-L704)面向旧图片角色；当前 [ProjectService](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/main/services/ProjectService.ts#L185-L237)整工程模板复制，未等价覆盖选择性导入。当前 Graphic Definition、角色部件、表情/嘴型、动作、音视频等可能形成共享依赖。

- **OpenToonz**：[官方 Sub-Xsheet 文档](https://opentoonz.readthedocs.io/en/latest/working_in_xsheet.html#loading-a-scene-as-a-sub-xsheet)支持从另一场景导入可编辑分层动画、将资源放入当前项目、名称冲突时选择保留/覆盖/重命名，复制引用与独立 Clone 有区别。[iocommand.cpp](https://github.com/opentoonz/opentoonz/blob/7ccd773ee646e99debd14917436550c5c3b94655/toonz/sources/toonz/iocommand.cpp#L652-L890)有 ChildLevelResourceImporter，处理 level/palette/sound、导入 child scene；[sceneresources.cpp](https://github.com/opentoonz/opentoonz/blob/7ccd773ee646e99debd14917436550c5c3b94655/toonz/sources/toonzlib/sceneresources.cpp#L591-L720)通过资源 processor 与 import strategy 处理类型和路径；[subscenecommand.cpp](https://github.com/opentoonz/opentoonz/blob/7ccd773ee646e99debd14917436550c5c3b94655/toonz/sources/toonz/subscenecommand.cpp#L1288-L1303)复制列和 FX。核心 [BSD-3-Clause](https://github.com/opentoonz/opentoonz/blob/7ccd773ee646e99debd14917436550c5c3b94655/LICENSE.txt)，第三方另查。其 Sub-Xsheet 内音频输出限制也表明不能照搬其时间/音频模型。
- **Blender**：[Asset Browser 4.4](https://docs.blender.org/manual/en/4.4/editors/asset_browser.html)区分 Link、Append、Append (Reuse Data)：独立实例可以共享数据，跨文件引入依赖且追踪来源。[blendfile_link_append.cc](https://github.com/blender/blender/blob/87f1be6d38070d755be2679d9a38c19676634eae/source/blender/blenkernel/intern/blendfile_link_append.cc#L1180-L1450)实际遍历间接依赖、处理本地 ID 复用及依赖变化。GPL 系列，仅借鉴设计；不要复制其 C++ 资源加载器进许可未核对的 Panda。
- **Godot MIT**：[ResourceUID](https://docs.godotengine.org/en/stable/classes/class_resourceuid.html)用稳定标识保留资源移动/改名后的引用，[ResourceLoader](https://docs.godotengine.org/en/stable/classes/class_resourceloader.html)提供依赖查询，实际 [resource_loader.cpp](https://github.com/godotengine/godot/blob/7c97c297793ce4711679491d34693a5719a79ebe/core/io/resource_loader.cpp#L1348-L1356)委托格式 loader 发现依赖。这支持按资源类型分工，不意味着它自带 Panda FLA 导入逻辑。

**裁决**：保留 EF-04 事务、路径安全和回滚，以当前正式模型的引用扫描为基础，按选中资源递归找依赖、去重、分配必要新 ID、统一重映射，再走现有 Main 文件事务。源工程只读；默认独立复制资源，复用目标中可确认同源且未冲突的定义时使用已有身份/版本/内容证据，不能按同名强行复用，也不要求新做全量 Hash。不要首版实现跨文件实时链接、全局资产服务器或引用同步。未来若真实需要同一素材多次导入再加入轻量来源映射。正式角色、Graphic 实例/定义和媒体使用当前导入契约；缺失依赖标出实际受影响的条目，支持其它选中资源独立导入。

首版：真实 Graphic 角色、背景、道具跨工程导入；同一共享依赖只引入一次；源不变、目标可独立编辑、保存重开，失败不留半批。

## 7. 镜头模板：区分定义与实例，不复制整工程

Panda 旧 [saveAsTemplate/createFromTemplate](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/ShotService.ts#L209-L251)已能保存结构、实例化清空对白/音频，但默认相机；当前 [ShotService.duplicate](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/ShotService.ts#L89-L170)复制图层、对白、音轨、事件并重映射父级等，已有更合适的基础。

- Godot [PackedScene](https://docs.godotengine.org/en/stable/classes/class_packedscene.html)把拥有的节点打包为可实例化的场景资源，不等同整个项目复制。参考 owner boundary，保留共享资源定义、重新创建实例身份。
- OpenToonz [Sub-Xsheet](https://opentoonz.readthedocs.io/en/latest/working_in_xsheet.html#using-sub-xsheets)支持共享引用与独立 clone、存取场景结构；模板默认独立于源模板后续编辑更适合 Panda 首版。
- Kdenlive [Library](https://docs.kdenlive.org/en/project_and_asset_management/library.html)存储跨项目的片段/转场组合，实际 [librarywidget.cpp](https://github.com/KDE/kdenlive/blob/a5eba1730ac524c83b64715d1da10b158d7dbef7/src/library/librarywidget.cpp#L235-L319)有保存选择和插入项目入口；[Sequence](https://docs.kdenlive.org/en/cutting_and_assembling/sequence.html)区分 nested 引用与从选择复制的新 Sequence。注意 Library 文件可引用外部媒体路径，不能把这个方式当作自包含依赖包。Kdenlive GPL-3.0 系列，借鉴交互。

**裁决**：优先现有 Shot duplicate + “仅布景/动作”选项，保留相机、父子链、关键帧/效果并移除/处理与旧对白音频耦合的事件。确有重复调用需要再持久化命名模板，先用当前资源引用与实例 ID 规则。暂不增加嵌套 Shot evaluator、实时跨项目链接或模板继承树。

## 8. 批量时间：成熟 NLE 的临时组 + 旧 Panda 业务规划

Panda 旧 [moveMany](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/DialogueService.ts#L421-L550)预检整批对白/配音平移；[TimelineEventBatchService](https://github.com/Cognitive-Architect/panda-stage/blob/a1ada257e564bdf1deb3a78cbf5344d56394bceb/src/domain/services/TimelineEventBatchService.ts#L174-L295)整体移时和统一时长。当前 [DialogueService](https://github.com/Cognitive-Architect/panda-stage/blob/b76b7352d8b8354fa3e085e4dc74c82e0980eab3/src/domain/services/DialogueService.ts#L446-L497)单条 move，关键帧/动作/口型已扩展。旧具体事件语义需适配，原子方案值得保留。

- Kdenlive [Editing](https://docs.kdenlive.org/en/cutting_and_assembling/editing.html)的 Spacer 临时选择组并移时、Group 操作和 ripple/insert 等模式；实际 [timelinefunctions.cpp](https://github.com/KDE/kdenlive/blob/a5eba1730ac524c83b64715d1da10b158d7dbef7/src/timeline2/model/timelinefunctions.cpp#L485-L783)处理临时组、轨道范围、group move、失败撤销与恢复组关系，[groupsmodel.cpp](https://github.com/KDE/kdenlive/blob/a5eba1730ac524c83b64715d1da10b158d7dbef7/src/timeline2/model/groupsmodel.cpp#L82-L114)处理组成员与 AV 关系。[GroupsModel ID 映射](https://github.com/KDE/kdenlive/blob/a5eba1730ac524c83b64715d1da10b158d7dbef7/src/timeline2/model/groupsmodel.cpp#L712-L749)支持复制组结构。借鉴“临时选区与正式持久分组分开”、“保持同组相对间距”，不复制 GPL C++ 或另造全功能剪辑器。
- OpenTimelineIO（Apache-2.0）：[Timeline Structure](https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html)有 Timeline/Track/Clip/Gap/Transition 等编辑交换语义；[trackAlgorithm.cpp](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/36e8d4c8fd5d55f0e0aefea07bc1e626ea3a2794/src/opentimelineio/trackAlgorithm.cpp#L20-L109)区分轨道时间与 source range，裁剪时维护源区间并处理不支持的转场裁切。可用作未来交换/区间测试参考，不是完整 NLE，也不包含 Panda 的角色、动画曲线或统一时长逻辑。首版不替换毫秒/帧率合同、不引入 OTIO runtime。

**裁决**：恢复旧批量计划/预览/提交，将 Dialogue+AudioClip+关联口型视为必要联动组，保持音频 source offset 和原时长。动作批量移时/统一时长走现有各类型正式变更规则；若长度改变需明确关键帧/缓动如何随动，不能只改 event end 造成视觉错误。默认整体移动选中条目；需要腾挪后续内容时可增加明确的 ripple 操作。保留一次 Undo，避免为选区临时操作持久化“组系统”。

## 9. 实施建议：七组不变，优先级按产品收益与复用难度

| 顺序 | 实施工作组 | 最少必要复用 | 首个可见结果 |
|---|---|---|---|
| 1 | AS 自动字幕 | #934 plan/generate + Ren'Py/Yarn 稳定身份 | 十句真实音频一键排轴；插入新句不串台 |
| 2 | 布局 | Excalidraw 双轴/组/间距算法 + 旧等高/站位 + Konva | 角色、Graphic、道具可对齐等高均分 |
| 3 | 布景 | #934/#1037 scene planner + Ren'Py/Monogatari 指令语义 | 一段结构文本生成可编辑镜头 |
| 4 | 剧本表演 | AUTO-05/06 + Yarn 指令 + Motion Canvas 锚点思想 + 当前 CLI | 多镜头带配音/字幕/普通动作，一次应用后可编辑 |
| 5 | 资源复用 | EF-04 + OpenToonz 导入策略/Blender 依赖复用/Godot 稳定身份 | 另一个工程选择性导入角色、背景、道具 |
| 6 | 镜头模板 | 当前 Shot duplicate + PackedScene/Sub-Xsheet/Library 语义 | 可复制无旧台词配音的场景结构 |
| 7 | 批量时间 | AUTO-02/EF-03 + Kdenlive 分组与临时移时 | 保持间距批移字幕+配音、动作时段批改 |

可并行做 2/5/7；3、4自然复用1与2。原本已经有更成熟的相机、Pose/角色动作和复制功能，不因本报告复活旧引擎。词级锚点、跨项目共享实时链接、OTIO/Fountain 交换、新剧本语言、完整 LLM agent、独立通用资源库都为按需候选，不是本批施工要求。许可证：MIT/BSD/Apache 供体复用时保留适用版权与许可声明；Ren'Py、OpenToonz 的第三方文件另查；GPL 供体本轮取行为/思路而非代码，Storyboarder 当前权利不明不直接复制。代码复用以实际目标文件许可为准。

## 10. 归档与边界

本轮没有关闭 #1037/#934、创建 issue、改业务代码、运行外部产品或新增验收门禁。建议 OWNER 确认新轮子取舍后，在届时最新 main 规划实现；旧 PR 作为可回查供体，明确吸收/放弃后再关闭。未发现更优整体替代，不宣称市场所有项目均已穷尽。

```text
=== AUTO SAVE ===
时间：2026-11-27
做了什么（结果）：以旧 PR 七组需求为基线，调查实际外部源码/官方文档/许可证，形成七组复用裁决、优先顺序与最小产品场景。
当前状态（一句话）：自研业务底座保留，通用布局直接适配外部算法，身份/自动化/资产/时间操作借鉴成熟设计。
下一步（唯一可执行）：OWNER 确认七组外部复用方案及取舍。
风险 / 未验证（翻车点）：未运行产品或做性能对照；上游许可需落实到复用文件；未做旧工程迁移；未建立新实施票。
=================
```
