# Panda Stage：人物结构之外的能力缺口与发展建议

日期：2026-10-19。性质：代码对照研究与产品路线建议；本 PR 仅交付文档。

## 1. 核心判断

**接下来最值得补的是“交付闭环”和“创作复用”，然后才是更多高级效果。** Panda Stage 已有多镜头预览、位置关键帧、对白/字幕、BGM/SFX 编辑与预览、动作预设、FLA 工作台，不能再按 8 月报告的起点安排开发。但这些能力之间仍有明显断点：真实项目尚未接通正式整片导出；连续帧尚未成为镜头内动画资产；重复搭场景、排对白、套动作仍缺可复用的产品流程。

建议优先做三件事：

1. 沿 #562 补齐正式项目导出，用真实短片证明“预览看到、听到的内容能够交付”。复用 #665 的混音候选，不重造编码器。
2. 沿 #685 / #801 打通结构化输入到可编辑草稿，并沿 #593 增加项目内预制镜头，减少重复劳动。
3. 将已有动作生成与 FLA 帧序列分别发展为“可复用动作”和“可播放素材”，共享主时间语义，但保留两者不同的编辑能力。

人物部件、连接点、父子跟随、头部正式渲染和肢体姿势已由 [人物结构报告 PR #802](https://github.com/Cognitive-Architect/panda-stage/pull/802)覆盖，本报告不重复设计。本文中的状态、动作、说话对象，主要讨论现有完整图层、道具和镜头的编排；将来接入多部件时再复用对应合同。

## 2. 研究依据与证据边界

### 2.1 两份输入报告

| 输入 | 本次使用的内容 | 如何处理时效 |
| --- | --- | --- |
| 《沙雕动画生产系统黑话大扫盲》2026-08-29 | §12 生产流程、§13 概念边界、§15 状态/动作/时间轴/导入模型、§17 时间与素材风险 | 用作需求与概念依据；不把行业软件能力当作 Panda 已实现能力 |
| 《Panda Stage 后续延展综合可行性报告》2026-08-29 | “现在能做、做不到”“行业概念如何落地”“推荐路线”“主要风险” | 原基线是 `24b4128`，PR #319/#233、Schema v5/v6、无摄像机等描述是历史快照，逐项以当前代码重判 |

第二份上传文件虽以 `.md` 命名，实际是保存网页的 MHTML；本次解码 HTML 正文阅读，没有把样式、脚本或网页控制文本当成报告内容。原文件均未修改，未把整份报告或素材包复制进仓库。

原始输入 SHA-256：

- 黑话报告：`2732a30770343dcee75a53350198479599aa6d329638642da6731779358ffe9c`
- 综合可行性报告：`3f5b572006c630ef87ffa9e99a652891682c472eae9e410ddc9f6de29528ce42`

### 2.2 本次冻结基线

| 对象 | 实时核验结果 | 本文如何使用 |
| --- | --- | --- |
| `main` | `79b2b381cc1e60fcfa139919e7e32b3024f7d17a`；正式 Schema v8 | 当前主路径的代码事实基线 |
| A 线 PR #665 | HEAD `cad124d2500844ba2ec979e04a6d79ecad7f4628`；Open / Draft / Unmerged | A04 多轨导出混音是候选实现，不能写成 main 已交付 |
| B 线 PR #791 | HEAD `eecb35aa5c67f9085012c8e37a611ddca21ec1c7`；Open / Draft / Unmerged | T06 进度修复及 T05 嵌套 Graphic 选帧修复仍在候选分支 |
| #562 | Open；最新登记 Gate B `NOT_ATTESTED` | 正式整片交付仍有实施和验收缺口 |
| #801 | 自动创作 AC-01～AC-09 为规划，首刀 AC-01 未派单 | 复用已有路线，不另立“自动导演”总路线 |

PR 正文有历史段落，不能直接拿其中旧 HEAD 或“尚未施工”覆盖实时 metadata 与较新回执。例如 #635/#660 的旧冲突描述不代表 #665 今天仍冲突；#791 较早的 T05 待验文字也不覆盖最新局部视觉 PASS。B 线 T05 已获 OWNER 四视角视觉 PASS，T06 有限定 GUI 豁免；T07/T04 暂缓不能写成修复。最新 #804 为 T01-C01 只读复测工单，不据此推定修复完成。上述状态不改变 A/B 原有交付门禁。[R1][R2][R3][R4]

本文区分四类缺口：**待接线**（底座已有）、**待产品化**（模型/流程尚缺）、**候选待集成**、**待验收/待测量**。代码与测试阅读证明实现边界，本轮没有运行 Windows Electron、真实导出或素材视觉复测，不宣称新的产品 PASS；“未发现”限于列明的正式模型和入口，不是对所有实验脚本的全仓不存在证明。

## 3. 先纠正两份报告中的历史起点

| 8 月报告中的判断 | 2026-10-19 代码事实 | 真正还缺什么 |
| --- | --- | --- |
| 多镜头主时钟与连续预览待建设 | `mapProjectTime` 已存在；ProductPreviewOverlay 已有当前镜头/全项目范围、跨镜头映射和资源交接 | 正式 Export 消费同一合同，以及整片交付验收 [E1][E2] |
| 音频预览只能围绕单对白 | AudioClip 已有 dialogue/bgm/sfx；独立轨编辑、Web Audio 多源播放与 0..2 gain 已存在 | 候选混音接入正式 Export；跨镜头铺乐与音量包络仍非现有合同 [E3][E4] |
| 没有关键帧编辑 | Position 已有 Base/Key/Hold 与时间轴编辑；仍以 MoveEvent 存储 | 旋转等属性扩展、动作保存复用、冲突规则；不要重写已有 Position [E5] |
| 没有运镜能力 | 已有对白驱动的说话人聚焦；1.5 倍、250ms 转场，运行时求值 | 会话模式尚非持久化导演意图；没有正式 CameraTrack [E6] |
| 需要新增批量对白入口 | 已有 `角色：台词` 粘贴、异常提示、手动角色映射和一次 History 提交 | 标签与角色身份解耦、自动排时、多镜头分配、提示词与生成计划 [E7] |
| FLA 只是很早期的解析实验 | 已有导入工作台、静态确认提交、连续帧审阅播放及原子图片入库 | 帧序列正式播放对象、源时间映射、能力说明、真实素材兼容范围 [E8][R3] |
| 所有复用能力从零开始 | Shot 已可复制并 remap 内部 ID；8 个 ActionPreset 可生成事件 | 持久模板、用户动作库、依赖管理与跨项目搬运 [E9][E10] |
| 项目保存/恢复待补 | 已有 Project/History/Main 文件服务与迁移机制 | 新能力纳入已有事务、恢复、依赖校验和目标设备验收；不另造保存系统 [E11] |

## 4. 能力缺口总表

优先级是建议的产品价值排序，不是工期承诺或对已有 A/B 施工顺序的覆盖。P0 影响交付；P1 提升常用创作效率；P2 扩大表达/复用；P3 按真实需求再立项。依赖满足的草稿能力可以独立验收，无需把全部功能绑在一个大版本。

| 编号 | 用户还不能顺畅完成的事 | 缺口类型 | 优先级 | 现有承接点 |
| --- | --- | --- | --- | --- |
| G01 | 把自己完整工程正式导出为音画一致、可播放的 MP4 | 待接线 + 候选待集成 + 待验收 | P0 | #562；#635/#660/#665 |
| G02 | 粘贴整理好的故事，得到可编辑、可撤销的镜头和字幕草稿 | 待产品化；部分入口已有 | P1 | #685；#801 |
| G03 | 一次搭好场景，之后按模板复用，且修改互不污染 | 待产品化 | P1 | #593；ShotService.duplicate |
| G04 | 保存自己的短动作，给别的对象套用、变速、循环 | 待产品化；已有生成底座 | P1 → P2 | ActionPreset；与 #695 对齐边界 |
| G05 | 导入一段原动画后直接放入镜头，拖动游标仍正确播放 | 待产品化 + 兼容/验收 | P1（受既有 V3 门禁约束） | #750/#759/#760 |
| G06 | 对口型、音效、停顿和配音节奏做可靠微调 | 部分产品化 + 时间语义扩展 | P2；基础对齐可提前 | AudioClip/Dialogue；#635；#801 AC-07 |
| G07 | 用名称找到“门打开/关闭、爆炸、室内背景”等可用素材，并安全复用 | 待产品化；分类/来源底座已有 | P1 小范围 → P2 | 现有 Asset 库；#801 资源匹配 |
| G08 | 保存推拉/定格等导演意图，让重开与输出保持一致 | 待持久化/接线 + 属性扩展 | P2；Export 模式合同随 G01 | 自动聚焦；Position；#801 AC-09 |
| G09 | 使用遮罩、逐帧特效、转场和发布规格 | 新能力，按样片拆分 | P2 → P3 | 现有 Stage/事件；G05/G01 |
| G10 | 知道素材为什么不能用、什么内容不能导出、复杂项目是否超预算 | 部分待产品化 + 待测量 | P0 随交付；持续建设 | FLA 诊断；资源状态；#784/#786 |

## 5. G01：成片交付是最明确的第一缺口

### 当前事实

`src/renderer/App.tsx` 中的导出入口调用 `export.startProbe`；`FullProbeExportRequestSchema` 仍要求探针时长 3～5 秒、固定 24fps，并传单音频路径。隐藏 ExportRenderer 使用 `PROBE_PROJECT` / `PROBE_SHOT` / `PROBE_SUBTITLE_CUES`，没有消费用户工程的正式导出快照。因此缺口**不仅是给已有导出增加一个按钮，也不仅是补一次真人验收**。[E12]

与此同时，编码、逐帧就绪、取消、临时输出、最终提交保护已经存在。#665 新增的混音计划沿用 AudioClip 的 offset、时间和 gain，但它仍处于探针服务合同中，不能自动推导成完整工程的多镜头导出。[E13]

### 最小补法

沿 #562 既有 N2-EXPORT-BASE-SER → N2-EXPORT-FULL-SER → Gate B 执行，开工时只补仍缺的部分：

1. **冻结只读导出快照。** 明确工程 revision、镜头顺序、素材身份、字幕、支持能力和预览运镜模式；导出期间的后续编辑不偷偷改变已开始的输出。
2. **预检实际依赖。** 未就绪/丢失的图片音频、越界时间、不支持的内容应定位到镜头和对象；不能输出探针画面、静默丢声音后仍报成功。
3. **逐帧接正式工程。** 复用 `mapProjectTime`，将项目时间映射到 Shot-local time，再调用正式 evaluator、口型投影、字幕与 Stage；音频时间统一加镜头前缀，不另写一套时间解释。
4. **接任务生命周期。** 复用编码/取消/暂存保护；正式产品提供进度、输出位置、失败后重试和文件保护。取消不是断点续导，第一版无需承诺断点恢复。

自动聚焦当前只在会话中启用。G01 必须明确“导出采用哪一种视图”：第一版可把当前明确选择冻结进导出快照，并在预检中展示；若尚不支持该模式，应明确阻断或让用户主动选择已支持模式，不能默默导出全景。永久保存运镜编辑属于 G08，不强迫 G01 等待完整 CameraTrack。

### 验收建议

两个真实项目各约 30 秒、至少三个镜头：包含对白、字幕尾部、位置动作、静态表情、BGM 与重叠音效；至少一份有静音区间。做整片预览、保存重开、正式 UI 导出、外部播放器看听，以及取消/失败/重试。检查镜头边界前后、音频 offset、0..2 gain、字幕尾部与最终时长；容差在实施合同中冻结，不能遇到失败再放宽。若使用未交付的结构能力，单独增加其依赖，基础闭环可先用已支持素材。

## 6. G02/G03：先让用户少搭场景、少排重复内容

### 6.1 结构化剧本与字幕草稿

现有 parser 把“语法正确且能匹配现有 Character”才认作 `valid`；不认识的旁白标签需要人工角色映射。`DialogueService.createMany` 则把整批对白建在同一个捕获时间点，`startMs === endMs`，是**未排时队列**，不是自动按阅读时长生成字幕块。[E7]

所以应保留批量入口和原子提交，把缺口拆开：

- **#685 字幕输入：** 解析先形成 `speakerLabel + text + sourceLine` 草稿，语法是否有效与角色是否匹配分开；优先展示异常，提供外部整理提示词。旁白/内心独白如何进入正式 Dialogue 必须单独定合同，因为当前 `characterId` 和 `voiceProfileId` 仍必填，不能只改 UI 放行。
- **#801 自动布景：** 按既定 AC-01 用已有背景和角色生成一个普通镜头，随后才增加真正可变输入与候选选择。名称用于搜索，确认后的 ID 用于执行；不靠素材文件名猜内容。
- **#801 V1 排时：** 规则估时只能叫“草稿时间”；有配音后再对齐。不能把文字长度推算包装成精准音频同步。跨镜头对白分配与同名标签复用确认应复用上述解析事实。

保持一次确认、一次提交/撤销；草稿预览不改变 dirty/revision；预览后项目变化必须重新校验。AC-01 的技术闭环不能冒充整个自动创作已可用。本报告不要求为此接入在线模型、自动 TTS 或任意小说理解。[R5]

### 6.2 项目内预制镜头

`ShotService.duplicate` 已覆盖 layer/audio/dialogue/event ID 和背景引用 remap，是可靠复用起点；但 Project 模型没有 ShotTemplate 集合或独立模板存储合同。[E9]

按 #593 先交付项目内快照模板：保存背景、站位、层级、镜头时长和已支持事件；默认排除具体对白/音频。模板与生成镜头互不反向更新，删除原镜头后模板仍有效。被排除内容的间接依赖也要检查，不能留下引用已删除对白的后续运镜/提示点。

验收用“双人对话场景”生成三个镜头：修改一个不影响其余；ID 不串；保存重开一致；删除被模板使用的素材有明确依赖处理。跨项目打包留到 G07，不让 V1 一次承担素材复制、路径迁移和全局资源库。

## 7. G04/G05：动作复用与动画素材是两种缺口

### 7.1 现有动作生成器 → 用户动作库

8 个 ActionPreset 已有左/右入场、移动、放大强调、抖动、表情切换、淡入/淡出；应用后追加 TimelineEvents，没有持久化动作定义/实例。当前 7 类事件没有 rotation 事件；`rotationDeg` 是 Layer 静态值。Position 已有专门关键帧编辑，不能据此说“所有关键帧都不存在”，也不能假设 Scale/Opacity 具有同等编辑能力。[E5][E10][E14]

建议从完整图层的一个“入场 → 停顿 → 抖一下”短片段开始：

| 概念 | 建议职责 | 第一版取舍 |
| --- | --- | --- |
| GeneratedMotion | 保存预设种类、参数与生成版本 | 当前预设继续生成普通事件，先支持再次使用同一参数 |
| MotionClip 定义 | 一组相对时间/相对位移的已支持事件 | 项目内保存命名片段；不保存源 layerId 作为目标绑定 |
| 应用计划 | 目标图层、起点、时长换算和冲突预览 | 确认后展开成普通事件，生成后可独立编辑；暂不做活链接实例 |

后续再增加循环次数、时间缩放和旋转轨。非线性 Move 在当前 Position chain 中可成为 playback-only，动作应用不能偷偷覆写为线性；重叠、相同时间、事件跨度、帧对齐和片尾取值需要显式规则。定义更新不自动改变已生成镜头。

第一版验收同一个片段应用到两个完整图层：位移相对各自站位，事件 ID 独立、撤销一次生效、已有动画冲突可解释。跨角色表情 ID 需要显式映射；不认识的状态应阻断对应通道。肢体 Pose/Action track 仍由 #695/#802 承接。

### 7.2 连续帧 → 正式可播放素材

FLA 工作台能审阅连续帧并播放；正式提交将每帧转成普通 ImageAsset、按 hash 复用、一次事务保存。`AssetSchema` 只有 image/audio，Layer source 只有 asset/character，Project 没有序列定义；帧序列入库不等于一段动画已加入镜头。上限仍为每次 24 帧。[E8]

沿 #759/#760 承接，而非另开平行导入器。所需最小合同是：

- **序列定义：** 源 FPS、有序帧身份、有效范围、共同画布/原点、依赖图片；重复像素可复用同一图片，但两个相同画面的时间项不能被去重删除。
- **镜头内使用：** 起始时间、源 offset、播放速率、once/loop/hold 明确语义；在请求时间纯求值，不使用一个脱离项目的自走播放器。
- **导入与生命周期：** 沿用既有事务/预算/取消；保存重开保留顺序；换素材、重导入、删除依赖不能悄悄重排序列。
- **交付说明：** 烘焙序列可调播放，但不能再编辑内部肢体；可编辑事件动作与栅格动画在 UI 和能力说明中区别展示。

**必须预先解决的时间细节：** #759 的样本为 47 帧 / 30fps，源时长约 1.5667 秒；当前项目输出为 24fps。若保时长采样，按现有 ceil 帧数规则约输出 38 帧，而不是让 MP4 同时保留 47 个独立画面。保留源帧资源与源时间身份、按项目时间重采样、编码时长的取整差异要分别验收。若要求每一源帧都在最终视频出现，应另定 30fps 输出合同；不能偷偷拉长动画或虚报“47/47 导出”。这是待实现的合同决策，不是现有功能。

扩大 24 帧限制必须与像素、内存、耗时和取消预算一起证明，不只改常量。#713 的研究视频 PASS 不等于 #759 产品 PASS；#760 的第二类真实样本也不能由一份素材的成功代替。[R6]

## 8. G06：声音、对白与表演节奏

现在已经有音频裁剪、offset、音量、独立 BGM/SFX 和多源预览，不应再开一个“从零多轨音频”项目。真正剩下的是：[E3][E4][E15]

| 缺口 | 用户影响 | 有界下一步 |
| --- | --- | --- |
| 波形/节奏提示点、批量对齐与草稿排时 | 停顿、音效峰值、句尾更多依赖反复试听 | 先做一份真实配音的可视对齐；只读波形缓存不是另一套正式音频数据 |
| 简易口型仅为 320ms 周期、前 160ms 张嘴 | 音频内部停顿仍可能张嘴；没有多嘴型识别 | 保留 Simple Mouth 兜底，先定义手工/导入 MouthCue 和静音区间，再评估自动分析 |
| Dialogue 绑定 characterId，未明确当前说话实例 | 同角色多次出场时，口型会作用于匹配该角色的图层；自动聚焦遇多个可见实例会回全景 | 单独定义可选 occurrence/layer 目标；旧项目保留原规则，歧义让作者确认；这是编排身份，不是增加身体结构 |
| 只有 clip 固定 gain，没有包络/自动压低背景音乐合同 | 对白下 BGM 的起落需要更细控制 | 先做淡入淡出或少量音量关键点；Preview/Export 共用求值，不先建完整混音台 |
| 音频归 Shot 所有，没有 Project-global BGM 合同 | 一首歌跨多个镜头连续铺放不自然 | 第一版可生成分镜头 clip 并保持 source offset 连续；若做全局轨须独立生命周期与时间合同，不能当 #635 已包含 |

这些是能力建议，并未本轮运行性能或听感测量。自动口型分析、强制对齐与 TTS 是不同能力；`VoiceProfile` 的 locale/rate/pitch 字段不证明合成服务存在。近期优先已有音频入库、时间调整和可编辑结果，与 #801 AC-07 对齐。

## 9. G07：素材需要“能找、能解释、能搬走”的语义层

### 9.1 当前不是空白素材库

已有缩略图/元数据状态、图片与音频分类、去重、资源引用检查；FLA 静态快照记录源文件 basename/hash、target、选帧和预览 hash。这些应继续复用。[E8][E16]

但分类目前主要靠引用关系：属于 Character 的图片归角色，其余图片归“背景”。这不证明它是背景，更不能证明它是“花园”；道具、前景、特效可能被混入同一类。Asset 尚无统一的语义标签、作者/许可说明、素材包依赖或可播放能力清单。[E16]

### 9.2 分三步补，不先建素材商城

1. **作者可确认的分类/标签。** 先支持背景、道具、特效等用途与名称别名，保留“未分类”；自动创作只把标签当候选证据，不能把模糊匹配直接当授权绑定。
2. **最小 ImportManifest。** 记录来源/hash、导入器版本、目标与帧范围、源 FPS、实际输出能力、降级/不支持原因、依赖 ID；作者/许可作为可选说明，未知就标未知，不伪造授权结论。保留现有 flaSnapshot，不为一个来源重复两套真相。
3. **跨项目素材/模板包。** 在项目内复用稳定后，显式打包依赖闭包，做 hash 去重与 ID remap；缺文件有重定位/替换预览，替换影响范围可见；全过程可回退。现有项目相对路径是基础，但不等于跨项目依赖迁移已实现。

通用 StateSet 第一刀可选“门：开/关”或“爆炸：前/后”这类完整图片状态，保留稳定 optionId、名称、缩略图和默认状态；这样不用等待肢体结构也能验证状态选择价值。现有 expressions 作为兼容入口，不能立即全量迁移所有素材为一个庞大通用对象。[E14][E16]

## 10. G08/G09：导演能力与发布能力的边界

### 10.1 自动聚焦之后才是可编辑运镜

当前 `autoCameraEnabled` 存在 EditorShell 的 React 会话状态；Camera plan 是 runtime-only，Shot Schema 没有 camera 字段。其目标选择来自对白，固定焦距/转场并不等于作者可以保存一段推、拉、摇移。[E6]

建议依次补“固定构图/自动聚焦模式的持久化意图”及少量 camera key；开始只支持 center/zoom 与清晰的插值，字幕保持屏幕空间、背景裁切和边界夹取有明确规则。G01 先解决快照模式一致性，G08 再解决保存重开后的导演编辑。

旋转动画、Scale/Opacity 更直接的关键帧 authoring、片段整体挪时/留白、局部回放区间也值得做，但从真实“入场—停顿—反应”镜头选一个最费时的动作验证，不一次引入完整曲线编辑器、贝塞尔路径、洋葱皮和所有快捷键。Position 的现有数据与播放兼容边界必须保留。[E5][E14]

### 10.2 特效与遮罩按表达需求拆分

前景图片、层级、透明度、抖动已经能完成一部分低成本效果。模型未声明 MaskTrack、滤镜/混合效果栈或镜头转场对象；FLA 解析中出现相关字段也不表示 Stage 已支持作者编辑和正式输出。[E17]

优先顺序建议：普通前景/特效素材整理 → G05 序列特效 → 一种真实需要的遮罩或转场。不要把“爆炸效果”默认等同于必须新建粒子引擎；也不要把换图片硬称为通用遮罩。跨镜头交叠转场会改变当前镜头时间边界与音频混合，应单独立项。

### 10.3 竖屏输出不是竖屏界面

正式 Project 当前固定 1920×1080 / 24fps，Export 合同也锁定尺寸/FPS。窗口自适应或竖向布局不能证明能输出 9:16 视频。[E18]

先完成稳定横屏 MP4，再基于发布目标决定 9:16/1:1、字幕安全区与裁切预览。改变工程画幅要覆盖背景 cover、坐标、镜头、字幕、导出与旧项目迁移；仅做输出裁切则须明确是裁切，不宣称已支持任意画布。透明输出、可独立交付的字幕文件、更多编码规格都可记录需求，但不应阻塞第一条完整交付路径。

## 11. G10：把可靠性变成用户可理解的能力

保存、恢复、导入事务、资源缓存和失败路径已有实现；缺口应是**新功能接入这些机制，以及真实规模下的可用性证据**，不能写成“需要从零增加稳定性”。

建议维护一个简洁的支持说明与样本台账，区分：可静态导入、可连续帧审阅、可在镜头播放、可编辑内部结构、可正式导出。每项带来源、版本和证据，界面主要告诉用户“能做什么/下一步怎么办”，复杂诊断展开查看。#784/#786 继续负责 B 线事实，不复制另一个互相漂移的进度总账。

新增导出预检应引用同一能力事实。素材导入成功不自动表示动作可播放；单张静态视觉 PASS 也不证明整个源文件兼容。性能方面先测导入等待、预览 seek、切镜头卡顿、峰值内存和取消后资源释放；这些是待建立的测量目标，不是本轮发现了全部性能故障。

建议第一组基准为三个镜头的 30 秒样片及 #759 的源时间动画样本，记录设备、输入 hash、范围、耗时和失败原因。小范围通过后才扩大镜头/素材数量，不直接承诺“百镜头不卡”或无限帧导入。

## 12. 推荐执行顺序与可验收切片

本表是后续拆票建议，不创建新 Issue，也不覆盖既有单刀授权和母 PR 策略。多个能力没有硬依赖时可分别规划；它不是要求立刻并发施工。

| 顺序/切片 | 具体结果 | 依赖与既有入口 | 退出标准 |
| --- | --- | --- | --- |
| S0 正式导出最小闭环 | 当前真实单镜头经正式 UI 导出，再扩三镜头 | #562；复用已有编码器和 A04 候选；不提前合并 #665 | 输出实际项目画面/字幕/声音；预检和失败保护有效 |
| S1 Gate B 交付 | 两份真实短片的预览、输出和恢复验收 | S0；#562 既有阶段顺序 | OWNER 看听与异常接受；自动结果和人验分开记录 |
| S2 自动布景首刀 | 固定背景+角色→普通可编辑镜头 | #801 AC-01；无需等待全部 FLA/高级结构 | 一次撤销/重做、保存重开、失败零残留 |
| S3 字幕与故事草稿 | #685 标签解析改进；按 #801 逐步多镜头/排时 | 先冻结正式 Dialogue 的身份策略 | 三镜头十句对白无遗漏；估时标为草稿；异常不静默吞掉 |
| S4 项目内镜头模板 | 双人场景保存并生成三份独立镜头 | #593；现有 duplicate/remap | 原镜头删除不损坏模板；生成结果互不污染 |
| S5 短动作复用 | 一个已有事件片段应用到两个完整图层 | G04；与 #695 分清部件通道边界 | 目标/时间正确，冲突显式，结果仍可编辑 |
| S6 源动画入镜头 | #759 指定样本的序列定义、使用与输出 | #750 既有 V2 退出与单独 GO；G01 输出能力 | 源时间映射、seek、保存、输出证据；#760 另验泛化 |
| S7 素材语义与节奏 | 最小 manifest/用途标签、一个音频对齐问题 | G07/G06；按真实返工原因选一刀 | 有可复现省时收益；支持边界可解释 |
| S8 导演与发布扩展 | 可保存运镜、旋转/节奏编辑、某一种新画幅或效果 | 相应基础已验证后分别派单 | 新内容 Preview/Export 一致，旧项目不回退 |

**若下一步只能选一项：建议先补 #562 的正式导出快照与单镜头产品入口。** 它直接消除“工程做出来却无法正式交付”的断点。若当前人力正在按 A/B 既定顺序施工，可先准备该切片的真实验收工程；不要把本建议理解为把新功能塞进 #665 或 #791。

## 13. 如何判断发展方向真的有效

不使用 8 月报告的成熟度数字作为今天的评分，也不估算没有测量依据的 ROI。每个候选能力记录同一组前后对照：

| 维度 | 建议观察方式 | 通过条件 |
| --- | --- | --- |
| 可交付 | 从工程打开到正式输出并在播放器看听 | 支持范围内内容无声/画面遗漏为零；遇不支持内容能定位 |
| 省时 | 同一段故事、同一资源，比较手工与新流程总耗时 | 包含整理输入、等待、检查和返修；未省时就先修流程，不加新命令 |
| 可编辑 | 生成后调整站位、对白、时间再保存 | 普通编辑入口可继续使用，不是只能观看的结果 |
| 安全修改 | 当前会话撤销/重做、失败重试、保存重开 | 不污染已有内容、不产生半批对象；不承诺跨重启保留 History |
| 兼容 | 固定旧工程与真实素材样本 | 记录所支持家族与版本；未知不冒充通过 |
| 可理解 | 观察用户能否解释“为什么没生成/没导出” | 原因指向可操作对象；不要求用户理解内部帧号或服务名称 |

暂不建议投入：完整 Animate 克隆、任意 ActionScript 执行、独立嵌套时钟、完整 DAW、云协作/素材商城、大规模主题重写。两份报告和本次代码证据都不足以把这些推到关键路径；后续有真实需求再单独研究。

## 14. 证据索引与本 PR 验证

以下源码链接固定到核验 SHA。Issue/PR 链接是动态状态入口，执行前应重新读取，尤其不要复制其历史段落当作最新状态。

- [E1 项目时间映射](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/selectors/projectTime.ts)；[对应测试](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/tests/unit/project-time-mapper.test.ts)。
- [E2 正式预览](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/renderer/shell/ProductPreviewOverlay.tsx)；[预览合同测试](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/tests/unit/product-preview-overlay.test.ts)。
- [E3 音频数据](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/models/audio.ts)；[统一时间/gain](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/audio-contract.ts)；[独立音频持久化测试](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/tests/integration/standalone-audio-persistence.test.ts)。
- [E4 多源预览音频](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/renderer/shell/productPreviewAudio.ts)。
- [E5 Position chain](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/position-chain.ts)；[项目编辑合同测试](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/tests/unit/position-project-service.test.ts)。
- [E6 自动聚焦](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/resolve-speaker-focus-camera.ts)；[会话模式所有者](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/renderer/shell/EditorShell.tsx)。
- [E7 粘贴解析](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/renderer/features/dialogue/parseDialoguePaste.ts)；[批量入口](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/renderer/features/dialogue/DialogueBatchPaste.tsx)；[对白服务](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/services/DialogueService.ts)；[Dialogue 模型](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/models/dialogue.ts)。
- [E8 连续帧提交](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/main/services/FlaFrameSequenceCommitService.ts)；[24 帧及预算合同](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/shared/fla-frame-sequence-api.ts)；[原子提交/图片复用测试](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/tests/unit/fla-frame-sequence-commit.test.ts)。
- [E9 镜头复制与 remap](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/services/ShotService.ts)；[Project 模型](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/models/project.ts)。
- [E10 动作预设](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/actions/ActionPreset.ts)；[追加事件](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/actions/applyPresetEvents.ts)。
- [E11 仓库所有权与验证规则](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/AGENTS.md)；[EditorProjectStore](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/renderer/stores/EditorProjectStore.ts)。
- [E12 探针 UI](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/renderer/App.tsx)；[Export 合同](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/shared/export-types.ts)；[隐藏渲染器](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/export-renderer/ExportRendererApp.tsx)；[现有导出服务](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/main/services/ExportService.ts)。
- [E13 #665 混音计划（候选）](https://github.com/Cognitive-Architect/panda-stage/blob/cad124d2500844ba2ec979e04a6d79ecad7f4628/src/domain/export-audio-mix-plan.ts)；[候选导出接线](https://github.com/Cognitive-Architect/panda-stage/blob/cad124d2500844ba2ec979e04a6d79ecad7f4628/src/main/services/ExportService.ts)。
- [E14 时间轴事件](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/models/timeline-event.ts)；[正式求值器](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/evaluate-shot-at-time.ts)。
- [E15 口型投影](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/selectors/temporalRender.ts)；[Character/VoiceProfile 模型](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/models/character.ts)。
- [E16 Asset/来源模型](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/models/asset.ts)；[素材分类](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/renderer/stores/assetLibrarySelectors.ts)。
- [E17 Shot 模型](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/models/shot.ts)；[Layer 模型](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/models/layer.ts)；[正式 Stage](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/renderer/stage/StageRenderer.tsx)。
- [E18 正式 Schema/画幅/FPS 常量](https://github.com/Cognitive-Architect/panda-stage/blob/79b2b381cc1e60fcfa139919e7e32b3024f7d17a/src/domain/constants.ts)。
- [R1 #665 A 线](https://github.com/Cognitive-Architect/panda-stage/pull/665)、[#635 音频合同](https://github.com/Cognitive-Architect/panda-stage/issues/635)、[#660 混音](https://github.com/Cognitive-Architect/panda-stage/issues/660)。
- [R2 #791 B 线](https://github.com/Cognitive-Architect/panda-stage/pull/791)、[#784 技术总账](https://github.com/Cognitive-Architect/panda-stage/issues/784)、[#786 顺序](https://github.com/Cognitive-Architect/panda-stage/issues/786)、[#804 T01-C01](https://github.com/Cognitive-Architect/panda-stage/issues/804)。
- [R3 #775 FLA 产品工作台](https://github.com/Cognitive-Architect/panda-stage/issues/775)、[#750 FLA 交付路线](https://github.com/Cognitive-Architect/panda-stage/issues/750)。
- [R4 #562 正式预览/导出与 Gate B](https://github.com/Cognitive-Architect/panda-stage/issues/562)。
- [R5 #685 结构化字幕](https://github.com/Cognitive-Architect/panda-stage/issues/685)、[#801 自动创作路线](https://github.com/Cognitive-Architect/panda-stage/issues/801)、[#593 预制镜头](https://github.com/Cognitive-Architect/panda-stage/issues/593)、[#695 Action/Pose](https://github.com/Cognitive-Architect/panda-stage/issues/695)。
- [R6 #759 原动画产品接线](https://github.com/Cognitive-Architect/panda-stage/issues/759)、[#760 第二类真实样本](https://github.com/Cognitive-Architect/panda-stage/issues/760)。

本 PR 验证范围：仅新增本 Markdown；检查差异空白、固定 SHA 链接的源码目标、引用编号、当前状态和两份输入 hash。阅读相关测试用于理解合同，未运行产品测试或全仓 verifier，未触发 Full CI，未替代 OWNER 真人验收。后续实施按 [AGENTS.md](../../AGENTS.md) 的最小适用验证矩阵执行。
