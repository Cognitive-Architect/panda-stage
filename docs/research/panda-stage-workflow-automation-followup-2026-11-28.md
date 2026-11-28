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
