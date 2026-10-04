# Issue #702 — 黑衣修仙男多姿态源状态普查

Issue: #702 · Parent roadmap: #701 · Mother PR: #677
执行日期：2026-10-04 · 范围：只读研究；未改 FLA 或生产代码。

## 结论

参考图中的 A、D、E 有可复现的完整角色状态来源：

- A：Scene「场景 1」frame 0，唯一实例「元件 1」frame 0。
- D：「补间 2」frame 8。
- E：「补间 2」frame 9。

B、C 的躯干姿态分别对应「补间 2」frame 6、7 的 body-only 输出，但参考图包含头部。根角色「元件 1」把「补间 1 / 补间 2 / 补间 3」作为三个子 Graphic 实例；源 XML 没有为「补间 2」实例记录 firstFrame=6 或 7。当前生产 target API 只能选择根 Scene/Graphic frame，不能传嵌套 frame override。没有证据证明 B/C 的完整组合已由源文件显式编码，因此二者保持 UNKNOWN / PENDING MAINTAINER REVIEW。

完整机器收据：[issue-702-black-multi-pose-census.json](issue-702-black-multi-pose-census.json)，包含全部 29 个 Graphic authored states、Scene 锚点、source span、嵌套实例输入、变换/可见性、分类、SVG/PNG 哈希和可见 bounds。

## 来源与复现

| 项目 | 结果 |
| --- | --- |
| FLA | 黑衣修仙男.fla；3,503,255 bytes |
| FLA SHA-256（前 / 后） | A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA / 相同 |
| 生产归一化 archive SHA-256 | 681237ABB7B32E79CE89FF8E283B0573B4BF170C6B85830828C7A10911BC7A33 |
| 本地精确参考图 | 是；黑衣修仙男（截图）.jpg |
| 参考图 SHA-256（前 / 后） | 7C53292222EDCD183BB0D40EE647435EF860F9894CD4203150317364CA679EAC / 相同 |
| 生产诊断路径 | FlaImportService inspect → 现有 XFL display adapter / target catalog / SVG builder → FlaStaticSnapshotWindowManager sandbox PNG |
| Sandbox | parser 与 snapshot 窗口均为 sandbox=true、contextIsolation=true、nodeIntegration=false |

验收目录：D:\PandaStage-Acceptance\issue702-black-census-20261004\
其中保存了完整 JSON、全部 SVG/PNG、A–E 与候选状态 contact sheet、参考图副本及对比图。二进制图像没有提交到仓库。

## Scene、Library 与 Timeline

Scene 尺寸为 1920×1080，只有「场景 1」frame 0。唯一可见图层放置「元件 1」，localTransform 为 identity，tx=759.05、ty=112.6。Library 有 9 个 DOMSymbolItem，全部是 Graphic 且均从 Scene 可达；production catalog 有 10 个 target（1 Scene + 9 Graphics）。

| Library item | Timeline / authored spans | 观察 |
| --- | --- | --- |
| 元件 1 | 30 frames；3 层各 1 个 span，索引 0、duration 30；仅状态索引 0 | 唯一完整前向角色锚点；在 [0,30) 持有同一状态。子实例为补间 1/2/3，均 loop，未写 firstFrame。 |
| 补间 2 | 1927 frames；12 个 authored starts，索引 0–11；span 类型均为 none | frame 0–10 各持续 1 帧；frame 11 持有到 endExclusive=1927。frame 8–10 是完整角色候选；0–7、11 的独立输出是未含头部的身体/服装状态。 |
| 元件 2 | 21 frames；20 spans（16 motion、4 none）；状态索引 0/5/10/15/20 | 腿部组合组件，不是完整姿态。只渲染 authored starts；没有运行 motion tween 插值。 |
| 补间 1 | 1 frame / 1 span | 独立头部组件。 |
| 补间 3 | 1 frame / 1 span | 独立头发组件。 |
| 辣妈风美女-cilisucai.com/...13 | 6 frames / 6 spans | 小型手部/手势组件；被补间 2 的部分状态以显式 firstFrame 输入引用。 |
| 辣妈风美女-cilisucai.com/...14 | 1 frame / 1 span | 独立头发/头部组件。 |
| 补间 4、补间 5 | 各 1 frame / 1 span | 分别为手机道具组件、靴/腿部组件。 |

「元件 1」的 30-frame timeline 不是 30 个角色姿态。「补间 2」的 1927-frame timeline 也不是 1927 个姿态：它包含 12 个 authored states，最后一个状态占 1916 帧。完整 XFL 元素计数和逐状态跨度见 JSON。

## A–E 对照

| 参考标签 | Source address | 完整角色渲染 | 结果 |
| --- | --- | --- | --- |
| A | Scene target「场景 1」@0 →「元件 1」@0；target ID 和 Scene 实例变换见 JSON | 是；PNG 1920×1080 | 匹配；HIGH。SVG SHA-256 为 F78FF2AF1894F595A5D3BA5844B9E9603D3E515BCBA4E89713F7D7EB41A4AFFF。 |
| B | 「补间 2」@6 | 仅身体组件可渲染；缺少参考中的头部组合 | body silhouette 候选；完整地址 UNKNOWN，待维护者确认。 |
| C | 「补间 2」@7 | 仅身体组件可渲染；缺少参考中的头部组合 | body silhouette 候选；完整地址 UNKNOWN，待维护者确认。 |
| D | 「补间 2」@8 | 是；独立 Graphic state | 匹配；HIGH。 |
| E | 「补间 2」@9 | 是；独立 Graphic state | 匹配；HIGH。 |

「补间 2」@10 是另一个不同的完整角色状态，当前没有匹配到 A–E。B/C 的 component PNG 和全部完整角色候选都保存在验收目录；本研究没有合成未由现有源实例地址表达的新画面。

## 分类与重复状态

- FULL_CHARACTER_STATE：Scene/「元件 1」@0，以及「补间 2」@8、@9、@10。
- COMPONENT_ASSET：「补间 1/3」、两个嵌套素材、手机/靴组件、「元件 2」，以及「补间 2」@0–7、@11 的身体/服装输出。
- TEMPORAL_ACTION_CANDIDATE：「补间 2」@0–7 的连续身体/手势变化；「元件 2」含 16 个 motion spans。该标签只表示后续需区分时间序列与静态姿态，不代表已支持 tween playback。
- DUPLICATE_OR_HELD_STATE：「元件 1」@0 在 [0,30) 持有；「补间 2」@11 在 [11,1927) 持有。它们是持有范围，不是额外姿态。
- UNKNOWN：B/C 的完整头部 + 身体组合地址。

Scene 锚点加 29 个 Graphic authored-state 输出共 30 个样本。30 个 SVG 哈希和 30 个 PNG 哈希均唯一；每个 PNG 重复渲染后字节级 SHA-256 相同。样本中未发现 exact SVG/PNG duplicate group；这不代表未抽样的 tween 中间帧也已比较。

## Stage B2 建议

B2 可安全使用已确认的 Scene/Graphic target identity、authored state starts、嵌套 firstFrame 输入、held ranges 与 exact output hashes。B2 不应把 timeline frameCount 当姿态数量，不应把「补间 2」的每一帧都称作完整角色，也不应把「元件 2」或头/手/道具组件提升为角色姿态。当前 production renderer 不支持 tween interpolation。

下一步建议：B2 先在现有 production target 路径上研究有界的嵌套 Graphic state-address enumeration；将 B/C 作为未解 probe，只有找到可复现的源地址并由维护者确认后，才把它们归为完整姿态。

## 变更边界

- 黑衣修仙男.fla 与参考图均未改变。
- 无 production code、parser、renderer、schema、UI 或 tween runtime 变更。
- 本交付只在母 PR #677 分支记录研究 Markdown 与 JSON；没有新开 PR。
- 本研究未运行测试；Markdown 交付按仓库规则只做链接、内容与 diff whitespace 检查。
