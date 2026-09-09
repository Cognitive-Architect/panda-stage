# N1-03 — Issue #462 remaining-friction triage

Status: **document-only triage**  
Source ledger: **#462 — N1 field trial: real-production friction & dissatisfaction ledger**  
Date: **2026-09-09**

## 1. Purpose

N1-02 has produced enough real-production evidence to stop sampling and enter a repair pass.

Issue #462 contains **14 historical finding comments**. One of those findings — subtitle timing input — has already been selected for an immediate fix under **#463 / PR #464** and has received positive Windows Electron human acceptance for the new `Start + Duration -> derived End` interaction.

This document therefore classifies the **remaining 13 findings** only.

This PR is intentionally documentation-only:

- no renderer changes;
- no CSS changes;
- no schema changes;
- no issue is closed here;
- no implementation authorization is implied beyond the repair plan below.

The goal is to turn a pile of real complaints into implementation-sized batches without losing any finding or creating one giant cleanup PR.

---

## 2. Inventory: the remaining 13 findings

| ID | #462 comment | Finding | Primary nature |
|---|---:|---|---|
| F01 | `5596419027` | Subtitle empty state is visually too heavy | UX / empty state |
| F02 | `5596420787` | Character empty state is visually too heavy | UX / empty state |
| F03 | `5596492018` | Asset selection lacks recognizability; text-only selection forces filename memorization | Friction / asset selection |
| F04 | `5596675727` | Save control does not visibly activate enough when project is dirty | Feedback / state legibility |
| F05 | `5596823889` | Character Detail layout / information architecture is fragmented and inconsistent | UX / IA / redesign |
| F06 | `5597170001` | Subtitle list needs exactly two micro-polish changes | UI polish |
| F07 | `5597342499` | Successful asset-import feedback is noisy and repetitive | Copy / feedback |
| F08 | `5599418056` | Default subtitle black translucent mask should be removed | Visual output |
| F09 | `5599420879` | There is no user-facing subtitle-style editing entry | Missing product capability |
| F10 | `5599517554` | Voice selector has redundant empty-state copy above the control | Copy / UI cleanup |
| F11 | `5599520433` | Subtitle Properties spacing and section-title typography are inconsistent | Layout / visual consistency |
| F12 | `5599569516` | Bound-audio duration summary uses engineering-style `片段 00:03.168` instead of human-readable seconds | Copy / consistency |
| F13 | `5600417392` | When an asset is later bound to a character, old ordinary-image layers remain identity-ambiguous with no reminder | Identity / migration hint |

### Excluded from the 13

The historical #462 finding `5597478802` (editable duration with auto-calculated end time) is intentionally excluded from this repair inventory because it has already been split into **#463 / PR #464** and human-tested separately.

It must not be reimplemented by any repair issue generated from this document.

---

## 3. Classification by root cause

### Class A — Subtitle editing micro-polish

**Findings: F06, F10, F11, F12**

These are all small presentation/copy problems around the day-to-day subtitle editing workflow. They do not require a new domain model or a redesign of the subtitle system.

#### F06 — Subtitle list: only two approved changes

Keep the current list structure. Change only:

1. move `自动加入` to the right; make the button text slightly smaller and centered;
2. replace the icon to the left of `可手动拖入` with the circular `i` information icon from the accepted reference.

Do **not** turn this into a subtitle-list redesign.

#### F10 — Voice empty-state copy

When no voice is bound, remove the redundant pair:

- `还没有配音`
- `为这条字幕选择角色配音。`

The `选择配音` control already communicates the next action.

#### F11 — Subtitle Properties visual rhythm

Unify the top dialogue block with the later sections:

- add normal spacing between the speaker/dialogue heading and its input;
- align section-title typography (`时间`, `角色`, `配音`) in size/weight/line-height;
- do not change interaction logic.

#### F12 — Human-readable audio duration

Change the bound-audio summary from the engineering-style representation:

```text
片段 00:03.168
```

to the same human-oriented seconds language already used in the Asset Library, for example:

```text
音频 3.17 秒
```

Underlying millisecond precision must remain unchanged.

**Triage:** ready for a focused small implementation issue.

---

### Class B — Lightweight feedback and empty-state cleanup

**Findings: F01, F02, F04, F07**

The shared problem is not missing functionality. The product already knows the state, but the visual/message treatment is either too heavy or too weak.

#### F01 + F02 — Empty states

Subtitle and Character empty states should become lighter editor states rather than large welcome-page-style blocks.

They should be reviewed together because both exhibit the same product smell:

> very little state information occupies a disproportionately large amount of editor space.

The implementation should preserve a clear next action while reducing visual weight and dead space.

#### F04 — Dirty Save affordance

The system already knows when the project has unsaved changes. The Save control should make that state visible at rest instead of relying on hover/tooltips.

Target state language:

```text
saved  -> quiet

dirty  -> visibly active

saving -> lightweight activity

failed -> explicit readable error
```

Do not solve this with color alone if a state also needs readable error semantics.

#### F07 — Import-success feedback

Success should be concise, for example:

```text
已导入：文件名.mp3
```

or for batch import:

```text
已导入 3 个素材
```

Remove redundant `imported` / `已准备好` repetition. Failure and partial-failure detail must remain explicit.

**Triage:** ready for small fixes, but keep empty-state work separate from Save/import feedback if the touched components do not overlap materially.

---

### Class C — Subtitle visual-output capability

**Findings: F08, F09**

These two findings are related but should **not** be collapsed into one mandatory implementation PR.

#### F08 — Remove the default black translucent mask

The current default subtitle presentation places a large dark translucent strip behind the text, obscuring a meaningful portion of the stage.

N1 product direction:

- default presentation should not use the current large black mask;
- the change should not accidentally delete the underlying ability to support styled subtitle backgrounds in the future.

Before implementation, choose the smallest safe behavior:

- default-transparent/no-mask presentation while preserving style semantics; or
- an equivalent renderer treatment that removes the N1 default mask without corrupting persisted style data.

This is a small visual-output change with a compatibility consideration, not a reason to redesign the whole subtitle renderer.

#### F09 — Add a real subtitle-style editing entry

Repository inspection during N1 confirmed that subtitle style data already exists below the UI for concepts such as font family, font size, text/background color, position, alignment, and maximum width, while the current creator-facing Subtitle Properties UI does not expose a style editor.

This is therefore a **missing product capability**, not just polish.

A first useful surface should prioritize the controls a creator actually needs:

- font;
- font size;
- text color;
- background on/off or background styling;
- position;
- alignment.

Do not automatically expose every internal field simply because it exists.

**Triage:** F08 can be repaired earlier; F09 needs a small design pass before implementation.

---

### Class D — Asset / character identity and recognizability

**Findings: F03, F13**

These findings share a deeper root problem:

> the application understands asset identity, character identity, expression identity, and ordinary image-layer identity better than the user can see them.

#### F03 — Recognizable asset selection

Text-only selectors force the creator to remember filenames such as `1-1`, `30-1`, or similarly named character images.

Candidate solutions already captured by #462:

- thumbnail/visual picker;
- user-facing rename/alias;
- a frame-picker-like visual browsing pattern;
- or a small combination of the above.

For the first repair, prefer the smallest solution that lets the user identify the actual picture at selection time. A visual picker/thumbnail has the most direct relationship to the observed failure mode; rename/alias can remain a later extension if visual selection alone solves the problem.

#### F13 — Old ordinary-image layer after later character binding

N1 reproduced this sequence:

```text
image imported
-> image dragged into shot as ordinary image layer
-> same image later becomes a character/base/expression asset
-> old shot layer remains ordinary asset identity
-> old layer does not participate in character Mouth/expression behavior
-> delete old layer and drag the now-character expression again
-> Mouth works normally
```

The code is not required to auto-convert old layers. Auto-conversion could be wrong because the user may intentionally be using the image as a plain picture.

The missing product affordance is a lightweight identity reminder, for example:

> 这个素材现在已属于角色「右蓝毛」，镜头中还存在 1 个早期普通图片图层。需要转换为角色图层吗？

A future conversion action must preserve visible authored state such as transform and z-order.

**Triage:** related product theme, but implement as two separate issues unless the same asset-picker surface can naturally own both.

---

### Class E — Character Detail information-architecture redesign

**Finding: F05**

This is the only remaining finding that clearly exceeds “cleanup”.

Current Character Detail stacks and mixes:

- identity/name;
- expression preview/management;
- default presentation;
- mouth configuration;
- destructive actions;
- a separate expression-management subpage.

The observed problem is not one oversized button. It is the lack of one predictable editing model.

Two valid directions remain open:

1. move toward the mature grouped Properties pattern (`基础 / 表情 / 默认表现 / 嘴型 / 高级`); or
2. design a dedicated Character Detail navigation model if the generic Properties pattern is a poor fit for visual expression management.

Do **not** solve this by adding more cards/headings to the existing long page.

**Triage:** needs a design/shape pass before implementation. Keep it out of a quick-polish PR.

---

## 4. Recommended repair issues

The 13 findings should **not** become 13 unrelated PRs, and they should also **not** become one giant cleanup PR.

Recommended issue boundaries:

### R1 — Subtitle UI micro-polish

Owns: **F06, F10, F11, F12**

Why together:
- small visual/copy changes;
- same high-frequency subtitle editing surface;
- no schema/domain changes expected.

Expected risk: low.

### R2 — Editor empty-state cleanup

Owns: **F01, F02**

Why together:
- same empty-state design smell;
- can establish one lightweight editor-empty-state pattern without redesigning entire workspaces.

Expected risk: low to medium (visual acceptance matters).

### R3 — State-feedback cleanup

Owns: **F04, F07**

Why together:
- both are state-legibility/message-density problems;
- implementation should be small and independent of domain data.

Expected risk: low.

### R4 — Remove default subtitle mask

Owns: **F08**

Keep separate from the style editor so a small visual fix is not blocked by a larger capability design.

Expected risk: low to medium because existing subtitle-style persistence/render semantics must not be accidentally broken.

### R5 — Subtitle style controls V1

Owns: **F09**

Needs a short design decision before coding: which small set of creator-facing controls belongs in V1 and where they live.

Expected risk: medium.

### R6 — Visual asset picker / recognizability

Owns: **F03**

Prefer visual recognition first; do not automatically turn this into a full asset-renaming system unless evidence shows thumbnails are insufficient.

Expected risk: medium.

### R7 — Character-binding legacy-layer reminder

Owns: **F13**

First useful version may be reminder-only. A conversion action is optional follow-up and should preserve transform/z-order if implemented.

Expected risk: medium because identity semantics must remain explicit.

### R8 — Character Detail IA redesign

Owns: **F05**

Design first, implementation second.

Expected risk: medium to high relative to the other findings because it changes a multi-function editing surface.

---

## 5. Suggested repair order

### Wave A — cheap, high-confidence cleanup

1. **R1 — Subtitle UI micro-polish**
2. **R3 — State-feedback cleanup**
3. **R2 — Editor empty-state cleanup**
4. **R4 — Remove default subtitle mask**

Goal: remove the repeated small irritants first and quickly improve the current N1 workflow without introducing new systems.

### Wave B — workflow clarity / identity

5. **R6 — Visual asset picker / recognizability**
6. **R7 — Character-binding legacy-layer reminder**

Goal: reduce mistakes and “same image, different identity” confusion discovered during real production.

### Wave C — real capability / redesign

7. **R5 — Subtitle style controls V1**
8. **R8 — Character Detail IA redesign**

Goal: add missing creator control and clean up the largest remaining editing surface only after the small repairs have settled.

---

## 6. What not to do

Across all repair issues:

- do not reopen or reimplement #463 timing work;
- do not create one mega-PR for all 13 findings;
- do not manually trigger Full CI / heavy full-project verification without maintainer authorization;
- use minimum sufficient validation proportional to each change;
- do not expand a small copy/CSS fix into unrelated historical verifier cleanup;
- do not auto-migrate old ordinary image layers merely because the asset later gains character identity;
- do not expose every internal subtitle-style field just because the domain model contains it;
- do not treat the Character Detail redesign as a prerequisite for small subtitle/feedback fixes.

---

## 7. Definition of Done for this triage document

This document is complete when:

- all remaining 13 #462 findings are represented exactly once;
- the completed/selected subtitle-timing finding is explicitly excluded;
- each finding has a clear root-cause class;
- proposed implementation issues have bounded ownership;
- dependencies and “do not expand” constraints are recorded;
- no production code is changed by this PR.

After review, the next step is to create the implementation issues from **R1-R8**, starting with Wave A.
