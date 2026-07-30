# Panda Stage 编辑工作区参考图生成记录

> 生成日期：2026-07-30
>
> 生成方式：Codex 内置 Image Gen
>
> 用例分类：`ui-mockup`
>
> 最终图片：[panda-stage-editor-workspace-reference.png](./panda-stage-editor-workspace-reference.png)
>
> SHA-256：`A956A1D166B6448399A414BAC298D3B0864C6C9F55AC245F5D3840BEE34CF901`

## 输入参考

1. [现状 1366×768 基线](../baseline-1366x768.png)：现有深绿色品牌气质与长页面问题参考；
2. [现有熊猫角色](../../../public/probe/panda-character.png)：舞台主体参考。

输入图片只用于视觉方向与内容 grounding，不代表最终参考图中的所有生成内容可以作为正式发布资产。

## 首次生成提示词

```text
Use case: ui-mockup
Asset type: high-fidelity visual reference for a Windows Electron desktop animation editor design specification
Input images: Image 1 is the current Panda Stage UI baseline and palette reference; Image 2 is the existing panda character artwork to place on the canvas. Preserve the product identity and panda subject, but redesign the interface structure completely.

Primary request: Create one realistic, production-quality main editing workspace for Panda Stage, a beginner-friendly 2D cutout animation editor. The screen must look implementable, calm, professional, and optimized for long editing sessions. It must clearly solve the current problem of every component being stacked in one long scrolling page.

Target dimensions: exactly 1440 x 1024 desktop application content. No browser chrome, no Windows title bar, no device frame, no outer presentation card.

Layout: a full-bleed fixed desktop workspace with these precise regions: compact 52px top command bar; 48px activity rail; 248px left navigation dock; large central canvas workspace; 300px right contextual inspector; 232px bottom timeline dock spanning the center; 24px status bar. Root page never scrolls. Use lightweight dividers and surface shifts instead of card grids.

Top command bar: small circular panda brand mark and text "Panda Stage"; project name "春日小剧场" with a small unsaved dot; compact undo and redo icon buttons; clear actions "保存", "预览", and a warm accent primary button "导出". Keep the hierarchy quiet and dense.

Activity rail: simple monochrome line icons for "镜头", "素材", "角色" with only one selected state. Left navigation dock shows the selected "镜头" tool, a compact search/add row, and three shot rows with modest thumbnails and labels "镜头 01", "镜头 02", "镜头 03"; do not make every row a card.

Central workspace: one and only one 16:9 stage, centered on a dark neutral pasteboard. Use the panda from Image 2 as the selected character, standing on a simple warm illustrated bamboo landscape. Show a subtle transform bounding box and corner handles. Put a small floating canvas toolbar for fit, 50%, 100%, and zoom controls. Do not place forms beneath the canvas.

Right contextual inspector: tabs "属性", "动作", "对白", with "属性" selected. Show grouped, compact controls for position X/Y, scale, rotation, opacity, flip, layer order and lock. Use aligned labels and fields; no giant cards. Provide a small section title "Panda · 角色图层".

Bottom timeline dock: permanent horizontal timeline with transport controls, timecode "00:07.12", ruler, a warm yellow playhead, and tracks labeled "动作", "对白", "音频". Show a few compact clips with clear selection and waveform. Include collapse and resize affordances without clutter.

Status bar: concise text for saved state, current shot, current time, and background task status.

Visual system: deep graphite and forest surfaces derived from Image 1, but with clearer neutral hierarchy. Palette anchors: near-black #0B100E, work surface #111815, raised surface #17211C, divider #2B3932, primary text #F3F1E8, secondary text #A8B4AD, mint brand accent #5FDC9A, selected mint surface #1D4A35, warm bamboo yellow #F2C45E for playhead and the primary export action, danger #EF716B. No pure white panels. Use 6px and 10px corner radii, 1px borders, very restrained shadows. Typography should resemble Inter plus a clean CJK system sans; body 14–16px, readable and crisp.

Interaction states visible in this single frame: selected shot row, selected panda layer with transform handles, active inspector tab, selected timeline clip, unsaved indicator, enabled export button. Use consistent focus/selection language.

Composition: focused primary screen, not a feature inventory. Keep the canvas visually dominant. Favor spacing, alignment, typography, and simple separators. Avoid crowding; no clipped content. Avoid cards inside cards. Avoid excessive badges, gradients, glassmorphism, neon glow, skeuomorphism, oversized headings, huge rounded containers, multiple canvases, long vertical page scrolling, or decorative dashboards.

Text constraints: render only the explicitly named Chinese labels and project/app names where practical; keep all text readable and do not invent marketing copy. No watermark, no unrelated logos, no extra UI outside the application.
```

## 定向修正提示词

首次结果中 TopBar 显示未保存圆点，但 StatusBar 显示“已保存 2 分钟前”，语义互相冲突，因此做了一次只改保存状态的定向编辑：

```text
Use case: precise-object-edit
Input image: the immediately previous Panda Stage desktop editor UI mockup is the edit target.
Primary request: change only the bottom-left save-state indicator in the status bar. Replace the green check icon and the text "已保存 2 分钟前" with a small warm bamboo-yellow dot and the exact Chinese text "有未保存更改".
Constraints: preserve every other pixel-level aspect of the mockup as closely as possible: same 1440×1024 composition, layout, colors, canvas artwork, panels, timeline, controls, labels, spacing, typography, and selected states. Do not change any other text or icon. Do not add UI. No watermark.
```

## 使用限制

- 该图片是信息架构和视觉气质参考，不是当前实现截图；
- 原始生成输出为 1487×1058，设计坐标仍以 1440×1024 为基准；
- 正式实现以 `DESIGN.md` 的 Token、组件状态、响应式和可访问性合同为准；
- 生成式 Logo、竹林、镜头缩略图、波形和图标形状不是正式品牌/内容资产；
- 不得把 PNG 作为应用背景或直接从图片取色替代 Design Token。
