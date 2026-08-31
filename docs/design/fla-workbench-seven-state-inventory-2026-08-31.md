# FLA Workbench Seven-State Inventory

Date: 2026-08-31  
Baseline: `main@24b412881f28df926f262975682924d5d1faec28`  
Scope: **current-state inventory only**. No production code change, no renderer/parser expansion, no V2-S semantic import.

## Purpose

This document freezes the current FLA Workbench behavior before visual / information-architecture redesign.

The immediate product task is **not** deeper FLA research. Panda Stage already has working FLA inspection, direct-raster review/import, static-frame rendering/import, bounded frame-sequence rendering/import, compatibility reporting, recovery notices, and safe blocking.

The current problem is presentation: these capabilities were accumulated incrementally and the workbench now reads like an engineering review surface rather than a coherent beginner-facing product workflow.

The redesign should therefore preserve current business owners and truth while improving layout, hierarchy, copy, state communication, and Cloud Touch usability.

---

## 1. Authoritative current routing

`src/renderer/fla-import/fla-content-route.ts` currently owns only three top-level routes:

```text
inspection failed
-> blocked

inspection succeeded + media.length > 0
-> v1-raster-review

inspection succeeded + media.length === 0
-> v2r-target-discovery
```

Important consequence:

> A file with one or more directly importable bitmap items always uses the existing raster-review route, even when it also contains rich scenes, symbols, layers, frames, or tweens.

There is currently **no mixed bitmap + render-target product mode**.

---

# State A — Inspecting / Reading FLA

## Trigger

`FlaCompatibilityReviewSession.phase === 'inspecting'`

## Current visible content

```text
导入前检查
FLA 兼容性预览
[取消]

正在读取所选 FLA。预览过程中不会修改项目或素材。
正在检查源文件…
```

## Current user actions

- Cancel / close inspection.

## Business invariants to preserve

- Inspection does not mutate Project or Asset state.
- Cancel remains real and must not create Project state.

## Presentation debt

- Large modal with very little hierarchy or progress affordance.
- Reads like a status dump rather than a deliberate scanning state.

---

# State B — Direct Raster Review / Many Bitmap Assets

## Trigger

Successful inspection with `ir.media.length > 0`.

## Initial selection behavior

All direct bitmap media are selected by default.

## Current top actions

```text
已选择：N / N
[全选] [清空] [确认选择]
```

`确认选择` creates selection intent only. It does **not** mutate the Project.

After confirmation the workbench exposes a second explicit action:

```text
已确认 N 项
确认选择仅保留选择信息；点击导入后才会创建普通图片素材。
[导入这 N 项]
```

## Current media-card information

Each `FlaReviewMediaCard` may show:

- selected / unselected state;
- thumbnail;
- source media name;
- source reference;
- dimensions;
- source format;
- `已使用` vs `仅素材库`;
- target filename;
- filename / collision warnings.

The full card is keyboard/click selectable.

## Business invariants to preserve

- Selection is independent from commit.
- Explicit confirmation is required before commit.
- Commit remains the only point where Project assets are created/reused.
- Existing dedup / name handling / authoritative commit response remains unchanged.

## Presentation debt

- Selection toolbar has stronger visual weight than the actual media content.
- Cards expose too many engineering/detail fields at once.
- Thumbnail + asset choice should be primary; source reference / target filename are currently visually over-promoted.
- Compatibility summary competes with the core selection task.

---

# State C — Direct Raster Review + Rich Structural Metadata

## Trigger

Same route as State B: `media.length > 0`, but the FLA also contains meaningful structural counts such as scenes, symbols, layers, frames, or tweens.

## Important current truth

**This is not a separate business route.**

Examples may show:

```text
素材 1
场景 1
元件 27
图层 37
帧 88
```

but Panda still renders the direct-raster grid rather than opening R1/R2 render-target workflows.

## Current structural summary

Read-only data can include:

- 场景
- 元件, including Graphic / MovieClip / Button breakdown
- 图层
- 帧
- 补间, when present

## Business invariants to preserve

- Do not invent a mixed semantic/render-import path during visual redesign.
- Structural facts are currently informational only for media-positive files.

## Presentation debt

- Rich technical metadata consumes substantial space without changing the user's primary task.
- A redesign should distinguish “useful file facts” from “things you can act on now”.

---

# State D — Zero Raster + Static Snapshot Workflow

## Trigger

Successful inspection with `media.length === 0`, routed to `v2r-target-discovery`.

The parent review shows the zero-raster diagnostic and mounts `FlaStaticSnapshotReview`.

## Snapshot phases

```text
loading
selecting
previewing
preview-ready
committing
committed
error
```

## Current flow

```text
load renderable-target catalog
-> auto-select first preview-supported target
-> choose target
-> choose frame
-> preview current frame
-> inspect real PNG preview + fidelity note
-> import current frame
```

## Current controls

- target radio list;
- unsupported targets remain visible but disabled with a reason;
- previous frame;
- numeric frame input;
- next frame;
- `预览当前帧`;
- preview image;
- compatibility / fidelity note;
- `导入当前帧` only after a valid preview;
- return.

## Business invariants to preserve

- Preview never mutates the Project.
- Changing target/frame invalidates the prior preview.
- Import is disabled until a valid current preview exists.
- Unsupported targets must remain honestly unsupported.
- Imported output remains an ordinary Panda ImageAsset.

## Presentation debt

- Parent raster toolbar still shows `已选择：0 / 0`, `全选`, `清空`, disabled `确认选择` even though there are no raster assets.
- Render-target choice, frame choice, preview, warnings, and import are vertically stacked with weak task hierarchy.
- Current frame controls look like raw form controls rather than a media-workbench transport.

---

# State E — Zero Raster + Frame Sequence Workflow

## Trigger

Same zero-raster route as State D.

## Important current truth

`FlaStaticSnapshotReview` and `FlaFrameSequenceReview` are mounted **side by side in code / sequentially in the same zero-raster surface**, rather than being one product mode switch.

Each component currently owns its own catalog loading and selected target state.

## Sequence phases

```text
loading
selecting
rendering
preview-ready
committing
committed
cancelled
error
```

## Current flow

```text
choose renderable target
-> choose inclusive start/end frame
-> validate bounded range
-> generate frame sequence
-> live progress
-> ordered image preview
-> re-render OR import sequence
```

## Current controls and limits

- target radio list;
- start frame numeric field;
- end frame numeric field;
- calculated frame count;
- hard maximum: 24 frames per sequence;
- `生成帧序列`;
- live `completed / total` progress;
- real cancel while rendering;
- `重新生成` after preview;
- `导入帧序列` only for the latest accepted sequence;
- ordered frame image previews;
- return.

## Existing validation messages include

- start/end must be integers;
- frame numbers cannot be negative;
- start cannot be later than end;
- end cannot exceed available target range;
- selected frame count cannot exceed 24.

## Business invariants to preserve

- Preview/render does not mutate the Project.
- Range changes invalidate prior commit eligibility.
- Re-render invalidates the prior commit candidate.
- Stale / late responses cannot become commit-eligible.
- Import requires the latest accepted sequence.
- Existing bounded resource model remains unchanged.

## Presentation debt

- Snapshot and Sequence duplicate catalog/target-selection presentation.
- Current sequence preview is essentially a list of images rather than a coherent filmstrip/review surface.
- The workbench does not visually communicate “single frame vs sequence” as two sibling user intents.

---

# State F — Compatibility / Unsupported / Safe Blocked

This should be treated as three severity levels in redesign.

## F1 — Soft compatibility warning

Existing compatibility vocabulary:

```text
完全兼容
部分兼容
暂不支持
未知
未出现
```

Warnings are produced for:

- 部分兼容
- 暂不支持
- 未知

This does not necessarily block the whole FLA.

## F2 — Individual render target unavailable

A catalog target may remain visible with:

```text
暂不可预览：<reason>
```

or equivalent sequence wording.

Other targets may remain fully usable.

## F3 — Whole-file Safe Blocked

Failed/ambiguous inspection never enters raster or V2-R product routes.

Existing beginner-facing messages include cases such as:

```text
此 FLA 文件的压缩包元数据不一致，已被当前安全规则拒绝导入。
```

and:

```text
这个 FLA 的文件结构存在 Panda 目前无法安全处理的兼容性问题，原文件没有被修改。
```

The generic fallback is:

```text
FLA 检查失败，请关闭后重试。
```

## Business invariants to preserve

- Soft warning, target-level unsupported, and hard safe-blocked states must not be conflated.
- Visual redesign must never make unsupported content appear fully supported.
- Safe-blocked files must not expose fake import/preview actions.

## Presentation debt

- Current compatibility summary gives five categories equal visual prominence.
- “Not present” is especially noisy for a primary workflow surface.
- Severity is insufficiently differentiated.

---

# State G — Confirm / Commit / Success

This is a cross-cutting terminal state rather than one FLA content route.

## Direct raster

Commit is available only after selection confirmation.

Success copy currently reports imported and duplicate/reused counts.

## Static snapshot

Import is available only after a valid current preview.

Success currently reports the created/reused ordinary image asset filename.

## Frame sequence

Import is available only for the latest accepted rendered sequence.

Current beginner-facing success variants include:

```text
已新增 N 帧素材。
新增 0 帧，复用已有素材 N 帧。
已新增 X 帧素材，复用已有素材 Y 帧。
```

## Business invariants to preserve

- Explicit commit remains distinct from preview/review.
- Commit status must lock or invalidate stale editing actions as it does today.
- Project/store synchronization remains owned by existing adapters.

## Presentation debt

- Success/error states currently appear inside the same accumulated vertical surface.
- Completion should feel like the end of a task, not another line added to a debug report.

---

# Current information inventory

The present review surface can expose all of the following categories at once:

```text
modal title / cancel
inspection/recovery note
selection toolbar
selection confirmation state
commit action/status
source file facts
document/stage facts
media counts
structural counts
five compatibility counters
compatibility warning details
bitmap cards
zero-raster diagnostic
snapshot catalog + target list + frame controls + preview + fidelity note
sequence catalog + target list + range controls + validation + progress + preview images
commit/success/error copy
```

This explains the current visual debt: the page primarily reflects implementation slices rather than user task hierarchy.

---

# Design-safe optimization opportunities

These are presentation opportunities only; they are **not implementation authorization**.

1. Give the workbench one clear shell and one clear primary task per state.
2. Hide the raster selection toolbar entirely when `media.length === 0`.
3. Demote structural / compatibility metadata behind concise summaries or expandable details where safe.
4. Keep media cards thumbnail-first and move secondary engineering facts out of the primary scan path.
5. Present Snapshot and Sequence as sibling user intents, while preserving their existing independent business owners underneath.
6. Replace raw vertical sequence images with a bounded filmstrip/review composition.
7. Visually distinguish:
   - warning but usable;
   - one target unavailable;
   - entire file blocked.
8. Give commit/success/error a deliberate task-completion treatment.
9. Preserve one top-level review scroll owner and avoid nested wheel traps.
10. Keep existing beginner-facing truth: preview/review is read-only; Project mutation occurs only after explicit import.

---

# Non-goals / stop gates

This inventory does **not** authorize:

- parser changes;
- renderer changes;
- security boundary changes;
- relaxed preflight;
- ActionScript execution;
- V2-S semantic import;
- Project schema changes;
- new FLA semantic objects;
- a mixed bitmap + rendered-content route;
- changing the 24-frame sequence cap;
- changing stale-preview / stale-sequence guards;
- merging R1/R2 business owners only for visual neatness;
- modifying PR #319 delivery state.

If visual redesign requires any of the above, stop and open a separately scoped product/architecture decision.

---

# Proposed next design step

Use these seven visual/task states as the blueprint matrix:

```text
A  Inspecting
B  Raster Review — many bitmap assets
C  Raster Review — rich structural metadata
D  Zero Raster — Static Snapshot
E  Zero Raster — Frame Sequence
F  Compatibility / Unsupported / Safe Blocked
G  Confirm / Commit / Success
```

For each state, future high-fidelity design should explicitly map every visible CTA to an existing action/phase in current code. No speculative buttons.

Recommended first deliverable:

> one landscape FLA Workbench information-architecture proposal, followed by high-fidelity state blueprints before implementation issues are opened.

---

# Source owners sampled

Primary current owners inspected for this inventory:

```text
src/renderer/fla-import/FlaCompatibilityReviewSession.tsx
src/renderer/fla-import/FlaStaticSnapshotReview.tsx
src/renderer/fla-import/FlaFrameSequenceReview.tsx
src/renderer/fla-import/fla-content-route.ts
src/renderer/fla-import/fla-review.ts
src/renderer/fla-import/fla-frame-sequence-review-state.ts
src/renderer/features/assets/AssetLibrary.tsx
src/shared/fla-import-diagnostics.ts
src/shared/fla-static-snapshot-api.ts
src/renderer/fla-import/formatFlaFrameSequenceCommitResult.ts

tests/unit/fla-c4-content-routing.test.ts
tests/unit/fla-frame-sequence-review.test.ts
tests/unit/fla-import-contracts.test.ts
```

---

## Status marker

```text
FLA_WORKBENCH_CURRENT_STATE_INVENTORY=COMPLETE
PRODUCTION_CODE_CHANGED=false
FLA_BUSINESS_LOGIC_CHANGED=false
FLA_SECURITY_BOUNDARY_CHANGED=false
READY_FOR_INFORMATION_ARCHITECTURE_DESIGN=true
```
