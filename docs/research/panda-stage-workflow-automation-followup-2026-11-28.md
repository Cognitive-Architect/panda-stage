# Panda Stage 七组自动化生产力：后续扩展研究（2026-11-28）

## 结论与基线

本次以 OWNER 提供的《自动化优化.txt》第四节为研究范围，核对合并后的 main [`bd582b9`](https://github.com/Cognitive-Architect/panda-stage/commit/bd582b9f2968a05e625117fe2ce3efb9dafe31cc)；不重复上一轮 Review 或新建施工票。

- [#1424](https://github.com/Cognitive-Architect/panda-stage/pull/1424) 已合并，head 633a1c01，merge commit bd582b9。PR 正文及 #1410 的旧状态叙述仍有滞后，实际 PR 元数据优先。
- [#1428 回执](https://github.com/Cognitive-Architect/panda-stage/pull/1424#issuecomment-7230639182) 报告 U1–U5 已修，包括移除无依据的 300 文件计数门槛；[#1430 回执](https://github.com/Cognitive-Architect/panda-stage/pull/1424#issuecomment-7231344362) 报告 motion 范围收尾完成。当前 [getRecipeRange](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/domain/scene/scriptPerformancePlanner.ts#L272-L310) 已按预设实际帧跨度及恢复帧规划。原票仍 open 不代表代码未交付。回执报告最终 CI 成功；本研究没有独立重跑 CI 或 Windows Electron，完整 OWNER UAT 尚未确认。
- 建议优先 A（配音清单）、B（批量时间编辑），C（动作扩展）按真实脚本需求与局部合同一起做；D–F 按触发需求推进。没有为性能优化编造基准。

原则：继续复用正式 Project、领域服务、History、已有 Main 文件事务、UI/CLI 共用 planner；产物仍可编辑。开源供体以行为与算法语义为主，未审许可不直接复制；GPL 供体仅借鉴行为。

## A｜可携带配音清单（高优先级；低至中成本）

**已验证的供体。** [Ren'Py Automatic Voice](https://www.renpy.org/doc/html/voice.html#automatic-voice) 通过对白标识导出表格并按标识匹配文件名；[Yarn LineTagger](https://github.com/YarnSpinnerTool/YarnSpinner/blob/7b7a98970d824de6912369e8ba2667d323cb6905/YarnSpinner.Compiler/LineTaggers/DescriptiveLineTagGenerator.cs#L348-L372) 对新生成 ID 检查排除集合，避免冲突。应采用身份而非显示顺序，但不照搬 Ren'Py 的具体标识生成方式。

**当前接缝。** [AutoSubtitleAudioService](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/domain/services/AutoSubtitleAudioService.ts#L38-L101) 已有会话级单调 draftRowId、existingDialogueId、手选/已确认绑定、源范围；[匹配器](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/domain/services/AutoSubtitleAudioService.ts#L503-L658) 按显式手选、正式 Dialogue/Clip、已确认绑定、唯一编号顺序处理。草稿 ID 是会话级计数，不适合作为跨会话唯一 ID。

**最小方案。** 先做 UTF-8 CSV（单一外部格式），不引入项目 schema 迁移或独立配音数据库。导出/导入共用一份契约：projectId、shotId/明确镜头来源键、lineKey（已有正式 Dialogue.id；未提交行在导出清单中产生独立不碰撞的来源键，后续往返保留）、展示序号、角色、原台词、建议/实际音频文件名、源起止毫秒。允许外部配音工具按 lineKey 命名，保留现有编号匹配供普通无身份文本。清单内重复 ID、跨项目、镜头不明、角色/台词变化、同名音频均进行局部诊断；台词变更不默认认旧录音为已确认。正式 ID 仅在所属项目/镜头匹配时有效；未提交行必须凭携带的来源键恢复，而非猜测两份纯文本的对应关系。CSV 正确转义逗号、引号、换行，对表格公式注入做适当防护。音频走现有导入与真实时长验证；复用 matcher/scheduler 与一次正式提交，不另写排轴。

**验收。** 十句含两句重复台词，导出、退出、重开、插入/重排/改单句、外部换音，再导入；旧身份及未变更的音频裁切正确保留，新增/修改/歧义局部确认，缺音不阻塞合法子集，撤销与保存重开正常。无清单的旧输入仍可用。

## B｜点事件、局部关键帧、Spacer（高优先级；中成本）

**供体。** [Kdenlive 官方 Editing 文档](https://docs.kdenlive.org/en/cutting_and_assembling/editing.html) 将多项时长编辑、间隙移动和 ripple 区分；[Spacer 源码](https://github.com/KDE/kdenlive/blob/a5eba1730ac524c83b64715d1da10b158d7dbef7/src/timeline2/model/timelinefunctions.cpp#L485-L555) 先检查锁定、收集指定轨道及位置的候选，再处理组成员和可移动间隙。借鉴候选收集与整体位移行为，而非移植 C++ 或永久分组系统。

**当前接缝。** [BatchTimeEditPanel](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/renderer/features/timeline/BatchTimeEditPanel.tsx#L113-L166) 排除无区间时长的事件，并用所有非零关键帧首尾作候选；[TimelineEventBatchService](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/domain/services/TimelineEventBatchService.ts#L549-L603) 会跳过不支持的类型/无时长项。[AnimationKeyRangeControls](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/renderer/features/timeline/AnimationKeyRangeControls.tsx#L11-L48) 已用 startMs/endMs 筛选属性轨关键帧；[LayerMotionService](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/domain/services/LayerMotionService.ts#L775-L856) 有正式 retime 入口；[timelineBatchStore](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/renderer/stores/timelineBatchStore.ts#L26-L89) 是无状态适配器，提交走单一 EditorProjectStore。

**三个纵切。**
1. 将 canShift 与 canSetDuration 分开。点事件（表情/翻转/显隐）平移时保留零跨度、payload 和 ID；不统一时长。仍由对白移动派生口型，拒绝锁定层、越界及冲突。普通区间使用已有验证和共同位移。
2. 薄接当前选段的层、时间范围与真实关键帧。首版按现有 LayerMotion 支持的根运动/复合关键帧范围，不能假装支持任意独立属性轨选择；属性级选择如果会移动未选属性则局部不支持或采用现有属性编辑能力。保持零时刻基础键和范围外键；不要引入第二选区 store。
3. Spacer 首版提供播放头后、指定层/轨道（或全部可编辑层）的选集，生成同一 delta，复用跨类型批移。跨越播放头的区间、锁定层、共享配音、依赖/帧边界先明确选择或提示，不静默破坏同步、不自动切断事件。先做插入空白，再按需求做删除空白；明确授权镜头延长，不硬改镜头时长。

**验收。** 一段含对白、真实音频及口型、区间动作、表情和两段关键帧的镜头；移动选中的中间选段，范围外键不变；在播放头插入 500ms，后续已选项共同移动，未选/锁定项不误改，共享音频按现有策略，冲突无半成品，一次 Undo/Redo。24fps 位移沿已修复的合法帧边界，毫秒项沿真实毫秒约束。

## C｜剧本指令的参数与实际产物（随新动作做；中成本）

[Monogatari Action](https://github.com/Monogatari/Monogatari/blob/fea01a2e8523d2d1f73c7a8a7d26c0a5dbba4d6a/src/lib/Action.ts#L12-L79) 将语句匹配、执行、回退职责区分。本次只取职责分离，不引入生命周期框架或第二 History。

[scriptPerformancePlanner](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/domain/scene/scriptPerformancePlanner.ts#L955-L1177) 已分 character-action、recipe，基本动作在 [后续分支](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/domain/scene/scriptPerformancePlanner.ts#L1200-L1350) 走正式服务。#1430 已修正 recipe motion 的实际时间，显式整配方时长覆盖仍按 #1428 的行级诊断，不擅自开放。

下次增加确实需要的原生运镜/特效指令时，先确认目标语义（运镜为镜头目标，不是当前对白角色）；小范围共享参数校验、目标解析、实际范围和生成对象报告，候选 Project 就是预览事实源。无需求不整体重构 planner，不另建 DSL 虚拟机或执行器。

[desktopAutomationCommands](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/renderer/shell/desktopAutomationCommands.ts#L193-L224) plan/apply 各自规划；[命令 schema](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/shared/desktop-automation-api.ts#L41-L46) 没有明确冻结计划令牌。外部客户端用 apply 返回的对象身份，plan 的新 ID 仅预览。只有实际出现审阅后工程/输入变化风险时，再补 expected revision 或最小计划签名及重新预览；不建立长期计划缓存。验证同一输入 UI/CLI 语义一致，实际帧/范围与报告一致，未知参数局部诊断。

## D｜对白与动作可选跟随（按需求；中成本）

[Motion Canvas Time Events](https://motioncanvas.io/docs/time-events/) 支持命名时间事件并区分后续事件一起调整与保持；[EditableTimeEvents 源码](https://github.com/motion-canvas/motion-canvas/blob/7b91435c301d530351dcf5ebb91dd139c002e405/packages/core/src/scenes/timeEvents/EditableTimeEvents.ts#L33-L108) 分离 initialTime、targetTime、offset，按 preserveTiming 决定是否保持绝对时刻。[Panda CLI 结果](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/renderer/shell/desktopAutomationCommands.ts#L170-L185) 已暴露 directiveId、dialogueId、eventIds 和时段，但本研究未确认所有动作/配方的持久来源关系（尤其生成普通关键帧）。

先让作者明确选择“连同关联动作移动”，复用 B 的选集及统一位移。若只在当前创作会话内操作，可利用生成结果关系；需要保存重开后持续关联时再记录最小关系（正式 dialogueId、实际事件或明确可编辑关键帧段、起止锚点、偏移），先检查现有 time-link 的适用范围，不另建求值时钟。无法追溯来源的旧事件不凭时间接近自动绑定。默认自由精修不变；移动/删除对白、拆除关联、锁定/冲突明确处理。持久联动、对白长度变化时结束锚点重算及多事件依赖属于后续裁决，不能把普通平移冒充完整跟随。

## E｜素材定义复用（按重复导入需求；中至高成本）

[Blender append 依赖兼容源码](https://github.com/blender/blender/blob/87f1be6d38070d755be2679d9a38c19676634eae/source/blender/blenkernel/intern/blendfile_link_append.cc#L1248-L1283) 会因依赖不可复用取消拥有者的复用资格。不能仅凭同名或源 UUID 复用。

[Panda Phase 1](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/domain/services/ProjectResourceImportPlanner.ts#L905-L975) 对角色、动画、部件、动作及 voice profile 分配新 ID；媒体复用及磁盘真实性、回滚已通过 #1425 回执处理。先支持显示/选用一个已知目标角色来避免无意义重复导入，再按需要自动复用：最小来源记录 + 定义语义和依赖闭包兼容检查；只针对本次候选及实际依赖，不全项目 Hash。目标已编辑、依赖差异、不同角色部件/动作 ID 语义不能等价时复制新定义，继续走现有事务。重复导入同一未变更角色、修改目标角色后再导入、依赖改变、失败回滚应分别验证。不要新建实时素材服务或跨项目共享可变对象。

## F｜命名镜头模板（按复用频率；中成本）

[Godot PackedScene](https://docs.godotengine.org/en/stable/classes/class_packedscene.html) 先按所有权打包可序列化场景，再实例化层级。[Panda ShotService.duplicate](https://github.com/Cognitive-Architect/panda-stage/blob/bd582b9f2968a05e625117fe2ce3efb9dafe31cc/src/domain/services/ShotService.ts#L110-L195) 已区分 full/structure-only、过滤对白音频/生成口型、预分配各类实例 ID。已有复制能满足一部分工作；先验证频繁复用场景。

需要命名持久模板时，保存名称 + 经现有保留边界生成的结构快照 + 必要资源引用，实例化用同一 remap/正式 Shot。快照不是源镜头活链接；新实例编辑互不影响，资源定义仍按正式项目引用管理。增加持久 schema 时同步迁移、引用扫描、删除保护；删模板不删实例。跨工程版等 E/现有 WF-05 依赖导入可以满足时再做。可先考虑现有工程作为模板来源，无需立刻建立全局模板库。

## 性能及建议施工顺序

1. 用真实素材做原定 Windows 联合场景验收；不因扩展研究新增验收门禁。用真实长剧本观察输入预览耗时，若有卡顿先局部防抖/显式刷新；没有测量数据不宣称性能瓶颈。
2. A：一张可携带配音清单纵切，先不引入外部 TTS 平台或持久数据库。
3. B：点事件 → 局部关键帧 → Spacer；每个纵切独立可验收，Spacer 依赖前两项实际支持的范围。
4. C：跟随实际需要的新指令，最小共享参数合同；不以架构重构作为其他工作的前置。
5. D/E/F：分别按改稿移动频率、重复导入成本、布景复用频率选择，互不硬绑。跨工程模板才需要跨工程依赖导入。

范围：建议与代码接缝研究，不是实现规格或完工证明；优先级及 CSV 首选均为研究建议。未执行子代理（当前无可用子代理入口）、本地构建、自动化测试或 Windows UAT；仅直接读取固定基线代码、上游固定源码及官方文档。未修改业务代码、工单、PR。


---

## 进一步源码研究｜11 个候选的最小实施接缝（2026-11-28）

本节补充实施层的细节，不另建重复研究文件。固定 Panda main [`eb4a260`](https://github.com/Cognitive-Architect/panda-stage/commit/eb4a26007a38396e30402c42a7543ddc2e503ee2)（前一提交为七组 WF 合并成果，本提交为上文初研）。本节按 OWNER 原《自动化优化.txt》的 A、B1–B3、C、D、E1–E3、F1–F2 编号；上文 F 为镜头模板，对应这里 E2/E3。下列均为研究建议、非施工授权。再次直接读取 Panda 与前述固定上游源码；未运行产品、基准或测试。

### A｜配音清单：只保存身份与绑定，不建立第二对白系统

- 真实接点：[草稿会话状态](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/renderer/features/dialogue/DialogueBatchPaste.tsx#L105-L150) 中 draftRowId generator、已确认音频和手选映射都随会话管理；[AutoSubtitleAudioService](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/services/AutoSubtitleAudioService.ts#L47-L101) 已接收 existingDialogueId 与确认绑定。
- 建议首版单格式 CSV（UTF-8，可选 BOM 兼容中文表格），字段 `version,projectId,shotId,lineKey,dialogueId,ordinal,speaker,text,audioFilename,sourceStartMs,sourceEndMs`。正式对白 ID 与未提交来源键分开；未提交键由清单生成且往返保持，不能用 draft-row-1 当跨会话 ID。序号仅展示。推荐文件名为来源键而非台词文本；通过现有音频素材入口匹配，不按外部任意路径直接读取。
- 首先按身份匹配，再比较原角色/台词和源区间；改稿或音频变化局部待确认；重复、无效、跨工程/镜头键单行提示，其他合法行仍可应用。没有清单时保留原编号匹配。导出与预览不改变 Project/History；实际提交仍复用当前 matcher/scheduler/DialogueStore。
- 现成 CSV 库候选 [Papa Parse parse/unparse 官方文档](https://www.papaparse.com/docs) 支持引号、换行与 escapeFormulae；实施先查已有依赖，无则评估该库许可证与体积。对用户文本采用可逆且能明确识别的表格转义策略，不能因防公式注入而悄悄修改原台词。参考 [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection) 的表格保存再打开风险。无需自制 CSV 解析器。
- 验收：两句完全相同的台词、中文逗号/换行/引号、以公式字符开头的文本；往返、重排、单句改单、换录音及部分提交；不改其他对白，保留真实音频裁切，撤销与重开成立。

### B1/B2/B3｜沿一个批量改时服务实现，不新造时间轴

**B1 点事件。** [事件模型](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/models/timeline-event.ts#L74-L137) 已允许零时长。[批量服务](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/services/TimelineEventBatchService.ts#L283-L324) 的区间重叠判断对两个零时长事件不成立；[筛选](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/services/TimelineEventBatchService.ts#L540-L602) 会拒绝非区间及零跨度。不能只放开类型白名单：操作能力需区分 shift 与 unify-duration；为 expression/flip/visibility 增加保留 ID 与 payload 的同刻平移。同层同类目标时刻的冲突需单独检测，[表情服务](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/services/ExpressionEventService.ts#L60-L97) 的同刻 ID 排序/更新规则说明静默叠放可能改变实际生效对象。首版明确冲突并允许重选，不隐式覆盖。对白派生 mouth-pose 仍由对白服务移动。

**B2 真实选段。** [BatchTimeEditPanel](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/renderer/features/timeline/BatchTimeEditPanel.tsx#L117-L166) 当前以整层非零键首尾生成候选。[LayerMotionService](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/services/LayerMotionService.ts#L775-L866) 已提供指定 fromTimesMs 平移与选段时长规划/提交；[AnimationKeyRangeControls](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/renderer/features/timeline/AnimationKeyRangeControls.tsx#L11-L48) 已有按 track.target、property 和 start/end 的选段操作。建议首版选中图层+范围直接传已有复合根轨服务；允许仅一个非零关键帧平移（底层 retimeKeys 已支持单键，当前批量 span 门槛至少两键，可按操作区分）；统一时长至少两个键。不把属性级选区误转换为根轨选区，不改变范围外键和 0ms 基础键；独立属性级改时若后续需要，沿共享 target/property 编辑薄扩展。重复/重叠选段去重，目标同属性键冲突先预览。

**B3 Spacer。** [Kdenlive 固定源码](https://github.com/KDE/kdenlive/blob/a5eba1730ac524c83b64715d1da10b158d7dbef7/src/timeline2/model/timelinefunctions.cpp#L485-L555) 先选轨道、候选、关联组及边界；[官方 Insert Space](https://docs.kdenlive.org/en/user_interface/menu/sequence_menu.html) 允许全部轨道移动且保持原关系。Panda 首版做播放头处插入正时长空白，指定范围/当前可编辑层，调用现有 cross-type shift；为完整选集一次求共同 delta、一次 History。现有批量域仅覆盖已支持的对白/事件/根关键帧，不能宣称全轨 ripple：独立音频、相机键、接管区间、深度键、父级交接等需要独立确认正式服务并逐步接入。未纳入的类型、锁定轨、跨过插入点的长区间和共享音频显示具体局部结果，允许作者选择；不擅自截断、改相对间隔、移动 0ms 基础键。延长镜头须明确选择，使用 ShotService.setDuration 生成候选之后再执行移动，而非先改正式工程。删除空白及完整 ripple 按需求后续做。

定向验收：混合对白、口型、真实配音、点事件、选段单键/多键；同刻点冲突、范围外属性键保持、24fps 合法边界、锁定和跨插入点内容、未授权延长、一次 Undo/Redo。B1 与 B2 可并行；B3 对所宣称支持的类型依赖前两项，不硬阻塞其他能力。

### C｜以一个新增运镜指令验证参数/目标/执行/真实产物合同

[Monogatari Action 固定源码](https://github.com/Monogatari/Monogatari/blob/fea01a2e8523d2d1f73c7a8a7d26c0a5dbba4d6a/src/lib/Action.ts#L39-L79) 的匹配与应用分离值得借鉴；不移植游戏生命周期/撤销。Panda [脚本输入类型](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/scene/scriptPerformanceInput.ts#L19-L80) 与[正式 planner](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/scene/scriptPerformancePlanner.ts#L1199-L1351) 目前按角色动作、配方及基本 preset 分支执行；先选一个已有正式运镜预设作为真实纵切，再由需求扩 IK/效果，不先重写全部动作。

- 新增动作定义只需参数解析/允许字段、目标解析、正式服务调用、实际产物范围及诊断。沿既有结构化中文指令语法，保持旧文本兼容。目标类型明确区分 shot、layer/character、part；不能把镜头动作默认作用于说话者。复用[相机落键/曲线分割](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/shot-camera.ts#L331-L363)及现有运镜预设入口，不复制缓动、相机求值。UI 和 CLI 继续调用同一 planner。
- 预览取候选 Project 的真实事件/关键帧变化。结果引用可区分 event ID、相机/层运动目标与实际生成键；不要将 motion preset 写出的关键帧误报为 TimelineEvent。现有 #1430 配方帧范围修复保留，整配方自定义时长仍局部诊断，不顺手开放。
- 验收：一段对白触发运镜，正式关键帧时间/范围与预览/CLI 相符；同刻已有键或手工接管冲突明确，其他合法指令仍可执行；一次撤销；未知参数不被默默接受。

### D｜对白关联表演：先作者显式操作，再决定持久绑定

[Motion Canvas 固定实现](https://github.com/motion-canvas/motion-canvas/blob/7b91435c301d530351dcf5ebb91dd139c002e405/packages/core/src/scenes/timeEvents/EditableTimeEvents.ts#L33-L108) 区分 absolute target 与相对 offset；借鉴编辑意图而非运行时。Panda [计划结果](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/scene/scriptPerformancePlanner.ts#L142-L164) 已有 directiveId/dialogueId/eventIds；但[配方 motion 步骤](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/actions/action-recipe.ts#L65-L96) 写普通根轨关键帧，不在 eventIds 中。[既有 AnimationTimeLink](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/animation-time-link.ts#L110-L138) 专用于 animation Layer 跟随 character-action，不能假装已经是通用对白链接。

建议从生成结果携带正式产物引用开始：同会话「连同关联表演移动」复用 B，事件按 ID；关键帧按目标/属性及实际键身份或经确认的精确选段，作者后续编辑/替换致身份失效时局部提示而非猜。若确需保存重开后关联，最小持久化为 dialogueId、产物引用、start/end anchor、offset；默认不跟随，明确解除；对白长度变化时 end anchor 重算与单纯整体平移分开。不要另建播放时钟，不让移动对白默认牵动所有附近动作。先验证事件和运动预设两类生成物；删除/改对白、手工精修、同一动作重复归属、一次撤销、重开后关联恢复（仅持久版）为关键样本。

### E1｜定义复用：复用计划先决定 ID 映射，再改第二阶段

[Blender 固定源码](https://github.com/blender/blender/blob/87f1be6d38070d755be2679d9a38c19676634eae/source/blender/blenkernel/intern/blendfile_link_append.cc#L1248-L1283) 证明依赖不兼容时应取消拥有者复用资格。[Panda Phase 1](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/services/ProjectResourceImportPlanner.ts#L889-L975) 媒体已可映射到旧 ID，但动画/角色/部件/动作/voice profile 总分配新 ID；[Main 事务](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/main/services/ProjectResourceImportService.ts#L449-L523) 先验证候选后写文件、保存、失败回收。

- 首个纵切建议手工选择已有兼容定义（明确预览“复用/复制”），随后才加自动识别；不要默认按同名或仅源 UUID 合并。自动复用候选可保存轻量 provenance（源 projectId、kind、sourceDefinitionId、源版本/语义基准）并只比较候选定义及实际依赖，不扫描全库。源或目标曾编辑，内部身份或依赖不再等价就保留独立副本。
- 在 Phase 1 预先决定 source→target asset/animation/character/part/action/voice 映射；对被复用定义也必须提供部件/动作 ID 对应，否则跨角色 motionMapping 会串；复用判断沿依赖闭包递进，歧义或循环不能简单依据名称。Phase 2 对复用定义跳过创建，仍按同一映射处理新增拥有者。Main 实际媒体复用验证及回滚原样保留。
- 验收：重复导入未编辑角色、目标已精修、源依赖变化、跨角色映射、音频/动画依赖、失败回滚。第一项不新增定义，其他冲突保留独立可编辑副本；不建立全局共享可变素材库。

### E2/E3｜命名镜头模板与跨工程模板是两个纵切

[Godot PackedScene](https://docs.godotengine.org/en/stable/classes/class_packedscene.html) 的 pack 按所有权打包，instantiate 创建场景实例；[Resources](https://docs.godotengine.org/en/stable/tutorials/scripting/resources.html) 说明场景实例与资源定义可分开。Panda [ShotService.duplicate](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/services/ShotService.ts#L112-L294) 已过滤对白/口型/可选音频、重映射 layer/event/parent keys/camera overrides/time link。

- E2：先提供工程内「保存为镜头模板」「从模板新建镜头」。将现有 structure-only 的保留与实例 ID 重映射拆成一个可复用小函数（不是重写 ShotService），保存名称+结构快照+项目内资源引用。每次实例化重新分配所有实例身份，定义继续共享；模板不活链接源 Shot，编辑/删除源镜头不影响模板，删模板不删实例。若正式存入 Project，需按现有 Schema 迁移与引用扫描保护模板使用的资源（删资源先解除引用/替换）；不需要项目级大重构。验收两个独立实例，相机/父子/动作/音频策略、源删除、保存重开、撤销。
- E3：新增跨工程模板导入。先按源模板保留内容收集实际依赖，再走已有 WF-05 Main 文件事务及 Phase 1/2 ID remap，最后实例化 Shot，整个过程原子提交。**不能只把现有导入 UI 加一个模板选项：** [目前 IPC 选择 schema](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/shared/project-resource-import-api.ts#L15-L31) 与 [closure 分派](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/services/ProjectResourceImportPlanner.ts#L445-L450) 仅 character/animation/image；模板还可能需要音频、视频、字幕样式及层/事件/动作/附属时钟等引用。按实际支持的模板子集扩 closure 和 map；不支持资源局部诊断，健康模板继续可用，不悄悄丢画面或凭 ID 假设两个工程一致。源只读，依赖验证/文件拷贝/正式候选与失败回滚沿原事务，不能先提交孤立素材再失败。E3 依赖 E2 结构快照和 WF-05 对应依赖支持；E1 自动定义复用是收益增强而非硬依赖（允许新定义复制）。验收从另一工程新建模板实例、同名资源、父子/相机/动作、关闭源工程后重开和输出、导入失败无半成品。

### F1｜长剧本性能：先测 planner，再选择最小调度方式

[AutoScenePanel](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/renderer/features/shots/AutoScenePanel.tsx#L201-L243) 在 useMemo 中按输入文本、overrides、排除项、延长选项与工程计算完整 plan，已有 pinned plan 与 stale check；手选身份保留涉及旧/新文本解析。源码确认工作路径，尚无真实性能数字。

用真实长剧本测输入响应、规划时间与重复次数（短/中/长各一份代表输入即可）。React [Profiler](https://react.dev/reference/react/Profiler) 可定位渲染耗时，直接包裹 planner 记录计算时间可区分两者。优先方案：如果完整计算是同步瓶颈，短防抖整份一致输入快照或显式刷新；若只是列表渲染慢，优先 memo/React [useDeferredValue](https://react.dev/reference/react/useDeferredValue)。后者不能保证单个同步重计算被打断或减少计算次数。不要只延迟 rawInput 却立即消费新手选 overrides；只提交和当前输入/工程一致的计划，旧结果保持只读可查看，既有刷新/局部诊断保留。无测量数据不宣称卡顿已确认；先不引入 worker、复杂增量规划器或缓存系统。

### F2｜CLI 冻结计划：现有 planner 已有真正原样提交入口

[Terraform Saved Plan](https://developer.hashicorp.com/terraform/cli/commands/apply) 与[过期语义](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/run/cli) 可作为成熟 plan/apply 行为参考。[当前 CLI](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/renderer/shell/desktopAutomationCommands.ts#L193-L224) 对 plan/apply 各自规划；[响应](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/renderer/shell/desktopAutomationCommands.ts#L15-L31) 已有 revision；[ScriptPerformancePlan](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/scene/scriptPerformancePlanner.ts#L178-L219) 持有 baseProject、candidateProject 与 staleToken；[applyScriptPerformancePlan](https://github.com/Cognitive-Architect/panda-stage/blob/eb4a26007a38396e30402c42a7543ddc2e503ee2/src/domain/scene/scriptPerformancePlanner.ts#L1470-L1536) 在同 baseProject 时直接提交已生成候选，在工程不同但资源检查允许时会重新规划。故仅传 expectedRevision 可以防止部分过期，却不能保证原预览新 ID 一致。

建议可选冻结模式：script.plan 返回 opaque planId 和基线 revision；在现有 renderer 自动化生命周期中只保存最近一份已生成 plan（避免持久/无界缓存）。script.apply 可选 planId；核对已有 session/project/instanceId、revision 和 baseProject 同一快照，执行已保存 plan，不重跑 planner；确认选项如 allowPartialConfirm 按现有正式逻辑处理。计划已使用、工程切换、编辑/撤销、重新规划或进程退出时失效，明确提示重新 plan；拒绝客户端直接传任意 candidate Project。原 script.apply(text) 继续兼容。只有明确选择冻结的调用才执行严格身份检查，普通流程不额外拦截。
- 验收：plan 不改 revision/dirty/History；同快照 apply 的 shot/dialogue/event ID 与审阅结果一致；工程修改、切换、重放、重复 apply 局部返回过期，未写工程；一次 Undo；原 CLI 入口不受影响。现有 UI stale/replan 行为保留，冻结模式不扩成 Agent 平台。

### 推荐后续拆票顺序（研究建议，不自动创建）

| 候选 | 可直接开始的最小纵切 | 真实依赖 / 优先 |
|---|---|---|
| A | CSV 清单往返 + 正式配音绑定 | 独立；高 |
| B1 | 点事件平移 | 独立；高 |
| B2 | 真实选段/单键移动 | 独立；高 |
| B3 | 指定选集插入时间 | 对宣称支持的类型依赖 B1/B2；高 |
| C | 首个已有运镜预设的剧本指令 | 独立；高 |
| D | 显式对白关联表演移动 | 需要真实产物引用和对应批移支持；中 |
| E1 | 角色/动画定义兼容复用 | 独立；中 |
| E2 | 项目内命名镜头模板 | 独立；中高 |
| E3 | 跨工程模板 | E2 + WF05 实际依赖范围；中高；E1 非硬依赖 |
| F1 | 长剧本规划测量及最小调度 | 独立；根据实测 |
| F2 | 可选冻结 plan/apply | 独立；外部 Agent 使用时高 |

各项先选一个真实场景完成端到端纵切；原始 WF OWNER UAT 仍待验，不人为把其变成所有后续研究的硬阻塞。新增功能最终接入正式 Project、History、保存与输出；若 UI 正好与 ReShell 迁移交叉，按实际合流保护其入口，不重复开发旧/新两套业务。未授权不建票、不创建实施分支、不修改业务代码。当前研究仅 Markdown；未独立运行 Windows、测试或性能基准，无可用独立子代理入口，直接并行读取固定源码和官方资料。具体 schema/界面/优先级须以 OWNER 后续指派为准。
