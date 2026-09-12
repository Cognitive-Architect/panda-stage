# R6 — Visual Recognition / Visual Picker Plan

> Planning document only. This file records the agreed R6 shape so later implementation does not collapse into one oversized PR or forget follow-up slices.

## Status

- Planning baseline: `main@7e9a5c30726cadeeac9761546622940a143efedc`
- Source context: N1 real-production friction ledger #462 and the later R6 thumbnail-entry audit.
- This document **does not authorize implementation by itself**.
- R6 implementation should be issued in bounded slices after each prior slice is accepted.

## Product problem

Panda Stage already has thumbnail infrastructure in several places, but multiple creator-facing selection flows still force the user to identify visual content from filenames or names alone.

R6 is therefore not "add small pictures everywhere". It has three different jobs:

1. **R6.1 — Image asset visual selection**: choose an image asset by looking at the image, not by memorizing filenames.
2. **R6.2 — Character visual identity**: identify a Character by avatar / default expression while preserving Character identity semantics.
3. **R6.3 — Composite-content thumbnails**: show a rendered/representative view of a Shot or FLA render target, which requires generation/invalidation research before implementation.

Legacy compatibility remains tracked separately and must not block the main creator workflow.

---

# R6 structure

```text
R6 — Visual Recognition / Visual Picker

R6.1  图片素材看图选
       A01-A06

R6.2  角色身份看图认
       A07-A11

R6.3  合成内容缩略图
       A12-A15
       <- research first, implementation only after evidence

Legacy
       L01
       <- tracked, does not block the main line
```

The three slices may share visual language, but they do **not** share the same domain identity:

- R6.1 selects `assetId`.
- R6.2 selects `characterId`.
- R6.3 represents rendered/composite output, not a single existing image asset.

Do not merge those identities merely because all three may display an image.

---

# R6.1 — Image Asset Visual Picker

## Job

Replace filename-first image selection with a lightweight image-first picker in the Character workflow.

The user should be able to choose the intended image without remembering names such as `001-final-2.png`.

## Scope — A01-A06

1. **A01** — Character Create / normal expression image.
2. **A02** — Character Create / angry expression image.
3. **A03** — Character Create / optional mouth-open image.
4. **A04** — Add Expression / choose image asset.
5. **A05** — Edit Expression / replace image asset.
6. **A06** — Character Detail / choose or replace mouth-open image.

## Intended interaction

Use one lightweight, feature-local `ImageAssetPicker`-style component/pattern for these six actions rather than six unrelated picker implementations.

### Collapsed state

Show the current choice as a compact visual row/card:

```text
[thumbnail]  asset-name.png
             800 x 1200
                         Change
```

### Expanded state

Show image candidates as a bounded visual grid/list where:

- image is the primary recognizer;
- filename remains secondary evidence;
- dimensions remain available as supporting metadata;
- current selection is obvious;
- the picker does not turn into a full Asset Library replacement.

Prefer an in-context expansion / small overlay over a large application-wide modal unless implementation evidence proves otherwise.

## Existing infrastructure to reuse

Do **not** rebuild thumbnail generation or IPC.

`CharacterManager` already:

- collects project `ImageAsset`s;
- calls the existing thumbnail reader;
- stores existing `ThumbnailState` values;
- passes the thumbnail map into Character list/detail/expression surfaces.

Reuse existing thumbnail states and fallback semantics:

- loading;
- ready;
- thumbnail/cache missing;
- source missing;
- error.

## Business rules that must survive

### Normal vs angry

The initial normal and angry expressions must continue to use different assets.

The picker may make the existing rule easier to understand (for example, disable or clearly mark the already-used candidate), but must not change the underlying Character creation rule.

### Mouth-open image

Mouth remains optional.

The picker must preserve an explicit `未配置 / 暂不配置` choice and must not silently make mouth configuration required.

### Expression replacement semantics

Current expression image replacement applies immediately. R6.1 must not accidentally change that persistence/editing behavior while replacing the visual selector.

## Likely implementation area

```text
src/renderer/features/characters/CharacterList.tsx
src/renderer/features/characters/ExpressionEditor.tsx
src/renderer/features/characters/CharacterEditor.tsx
src/renderer/features/characters/CharacterManager.tsx   # only if necessary
src/renderer/... scoped styles
+ one lightweight feature-local image picker component if reuse justifies it
```

Do not extract a repository-wide generic picker framework merely because several Character call sites need the same visual selector.

## Human acceptance

Use a deliberately hostile test project with roughly 20–30 image assets and similar filenames.

A human should be able to:

- create a Character by recognizing the normal and angry images without relying on filenames;
- clearly see which image is currently selected;
- avoid accidentally choosing the same image for normal and angry;
- leave the mouth image unconfigured;
- add a new expression by image recognition;
- replace an expression image while understanding current vs replacement asset;
- replace/clear the mouth image;
- continue operating when one thumbnail is loading, missing, source-missing, or errored;
- survive long filenames without broken layout;
- complete the intended flow in both relevant landscape/default presentations.

## R6.1 stop gates

STOP if implementation starts doing any of the following:

```text
rebuilding thumbnail IPC/backend
building a global Digital Asset Manager
adding tag/folder/rename/search-platform work
changing Character schema/domain semantics
changing persistence/migration behavior
redesigning Character Detail IA (R8)
refactoring all legacy + modern + Asset Library surfaces at once
manually triggering Full CI / pnpm verify:project without maintainer authorization
```

---

# R6.2 — Character Visual Identity

## Job

When the user is selecting or identifying a Character, show the Character's visual identity instead of requiring name-only recognition.

This is a Character picker/identity problem, **not** an image-asset picker problem.

## Scope — A07-A11

1. **A07** — New Dialogue / select speaker Character.
2. **A08** — Dialogue Properties / replace speaker Character.
3. **A09** — Batch Dialogue / map unresolved or ambiguous speaker to a Character.
4. **A10** — Portrait/default Character list / add the avatar already present in landscape.
5. **A11** — Portrait/default Character detail expression summary / add visual expression summaries already present in the visual landscape path.

## Intended identity model

Use the Character's default expression image as its visual avatar.

Do **not** introduce a second independent "character avatar asset" field as part of R6.2.

The visible image is identification assistance; selection still returns/operates on `characterId`.

## Intended interaction

For Character choice controls, prefer a compact avatar + name list rather than an image-asset grid.

Example:

```text
[avatar] 张三
         默认：普通

[avatar] 李四
         默认：普通
```

Reason: users are choosing an identity/person, not browsing a large raw asset pool.

## Reuse target

Where practical, introduce one small Character-avatar/Character-picker presentation that can be reused by:

- single Dialogue authoring;
- Dialogue Properties speaker replacement;
- batch speaker mapping.

Do not force CharacterList/CharacterEditor into the same component if their layout needs are different; shared identity rules matter more than creating one giant universal component.

## A10 / A11 parity rule

R6.2 should close the obvious landscape vs default/portrait recognizability gap:

- if landscape Character list identifies Characters with avatars, the active default/portrait path should not regress to name-only identification;
- if landscape Character Detail shows expression thumbnails, the active default/portrait summary should not remain filename-only unless there is a strong layout constraint.

This is parity work, not R8 Character Detail redesign.

## Human acceptance

Using several Characters with similar names or similar imported filenames:

- new Dialogue speaker selection is recognizable by avatar + name;
- Dialogue Properties speaker replacement is recognizable by avatar + name;
- batch mapping is recognizable without memorizing names;
- selected values remain Characters, not raw image assets;
- default-expression changes update future visual identity correctly without adding a second avatar model;
- portrait/default Character list and expression summary no longer lose the useful visual identity available in landscape;
- no Dialogue timing, voice binding, Character persistence, or Character domain behavior changes.

## R6.2 stop gates

STOP if implementation starts doing any of the following:

```text
returning assetId where the workflow owns characterId
adding a new persistent avatar field without separate authorization
redesigning Dialogue authoring or Subtitle Properties broadly
mixing R7 legacy-layer conversion/reminders into this work
redesigning Character Detail IA (R8)
rewriting thumbnail backend only to serve Dialogue
manually triggering Full CI / pnpm verify:project without maintainer authorization
```

---

# R6.3 — Composite Preview Research

## Job

Determine whether Panda Stage should show real rendered/representative thumbnails for composite content whose preview is **not** equivalent to one existing project image asset.

R6.3 is research-first because forcing implementation before the generation strategy is known can expand a UI repair into rendering/cache infrastructure work.

## Scope — A12-A15

### Shot

1. **A12** — Shot list / replace numeric thumbnail placeholder with a real Shot visual if a safe source exists.
2. **A13** — Shot detail / same composite thumbnail question.

Current Shot thumbnail is a numbered placeholder, not a real scene image.

### FLA

3. **A14** — FLA static snapshot / render-target list recognizability.
4. **A15** — FLA frame-sequence / render-target list recognizability.

Current FLA target candidates are text-first; a real image appears only after a target/frame preview is generated.

## Research questions — Shot

Answer before implementation:

1. What exactly should a Shot thumbnail represent?
2. Is there an existing safe renderer/snapshot result that can be reused?
3. If not, is a dedicated snapshot path required?
4. Which project changes invalidate a Shot thumbnail?
5. Where should a thumbnail/cache live?
6. Can generation be lazy and bounded?
7. What is the fallback when rendering fails?

## Research questions — FLA

Answer before implementation:

1. Can a representative image be obtained cheaply without weakening current FLA safety limits?
2. Which frame represents a target: frame 0, selected frame, first non-empty frame, or another rule?
3. Can candidate previews be lazy-rendered rather than eagerly rendering every target?
4. What maximum work budget is acceptable for one target list?
5. How is cache validity tied to the current inspection/session/source?
6. What should unsupported targets display?
7. Does the existing right-side explicit Preview already solve enough of the problem that list thumbnails would not justify their cost?

## Research output

R6.3 should end with a written disposition, not an automatic implementation commit.

Possible results:

```text
A. cheap + safe -> open a bounded Shot thumbnail implementation issue
B. cheap + safe -> open a bounded FLA target preview implementation issue
C. expensive / architecture-heavy -> move to the owning Shot or FLA roadmap
D. low product value -> accept current limitation and record why
```

Shot and FLA do not need the same answer.

## R6.3 safety boundary

Do not:

- bypass FLA preview/support checks;
- expand ActionScript/JSFL execution;
- auto-start FLA R3;
- eagerly render an unbounded number of targets merely to decorate a list;
- create a new persistent cache/schema before evidence requires it;
- treat a raw source bitmap as if it were a composite Shot/FLA preview.

---

# Legacy — tracked, non-blocking

## L01

`Compatibility tools / Action Preset / Switch Expression` still uses expression-name-only selection.

Disposition:

- keep it recorded;
- do not let L01 block R6.1 or R6.2;
- after the main R6 path is accepted, reassess whether L01 can adopt an existing visual identity component at very low cost;
- otherwise keep it in Legacy backlog.

Important: this is different from forgetting the entry. It is an explicit scope decision.

Also note that some components named `Legacy...` are still used by active default/portrait workflows. A filename/class name alone is **not** sufficient evidence that a path may be skipped.

---

# Explicitly already covered / do not rebuild

The audit found existing real-image presentation in multiple places, including:

- Asset Library image cards and image details;
- landscape Character list/avatar;
- landscape Character Detail/avatar and expression summaries;
- Expression cards and current-expression preview;
- landscape current mouth image;
- current-object summary in Properties;
- FLA bitmap candidate grid/details;
- FLA generated current-frame preview;
- FLA generated frame-sequence thumbnail strip.

R6 should reuse those product truths and infrastructure rather than replacing them merely for consistency.

---

# Explicit non-goals

R6 does **not** authorize:

- asset rename/tag/folder systems;
- global DAM / Asset Manager redesign;
- application-wide search overhaul;
- AI image naming;
- new thumbnail IPC/backend without evidence;
- Character schema/migration changes;
- R7 Character-binding legacy-layer conversion/reminder work;
- R8 Character Detail IA redesign;
- Subtitle style work (R5);
- FLA R3 / V2-S expansion;
- project-cover generation;
- video-track thumbnail systems that do not yet exist;
- broad timeline redesign;
- unrelated historical verifier cleanup.

---

# Delivery order

```text
R6.1 — Image Asset Visual Picker
  |
  v
Windows Electron human acceptance
  |
  v
R6.2 — Character Visual Identity
  |
  v
Windows Electron human acceptance
  |
  v
R6.3 — Composite Preview Research
  |
  v
explicit maintainer decision on implementation / defer / accept limit
```

Do **not** implement `R6.1 + R6.2 + R6.3 + Legacy` as one mega-PR.

Each implementation slice should begin from current `main` or a newer successor after the prior slice is merged/accepted.

---

# Issue / PR strategy

Expected planning split:

1. **Implementation Issue — R6.1 Image Asset Visual Picker**
   - owns A01-A06;
   - bounded Character workflow changes;
   - targeted tests + normal CI + Windows human receipt.

2. **Implementation Issue — R6.2 Character Visual Identity**
   - owns A07-A11;
   - Dialogue character picking + active portrait/default Character recognizability parity;
   - targeted tests + normal CI + Windows human receipt.

3. **Research Issue — R6.3 Composite Preview Research**
   - owns A12-A15;
   - no automatic production implementation;
   - returns evidence and a disposition for Shot and FLA separately.

4. **Legacy L01**
   - tracked separately;
   - only scheduled after main-line R6 if cost/value justifies it.

This planning file is the durable map; individual Issues own execution authorization and acceptance details.

---

# Validation policy

Follow the repository's maintainer execution constraints:

- minimum sufficient validation proportional to the touched slice;
- targeted tests / regression checks for changed behavior;
- normal required automatic CI after push;
- Windows Electron human acceptance for the creator-facing visual slices.

Do **not** manually trigger:

```text
Full CI
pnpm verify:project
repo-wide historical verifier sweeps
unrelated migration / debt cleanup
```

unless the maintainer explicitly authorizes it.

If unrelated debt appears, record it and stop expanding scope.

---

# R6 completion semantics

R6 should not be declared complete merely because thumbnails render.

The primary product outcome is:

> The creator can recognize what they are choosing from the visual information that naturally belongs to that object, instead of memorizing filenames or internal identifiers.

At minimum:

- R6.1 must make image selection visual-first across A01-A06;
- R6.2 must make Character identification visual across A07-A11 while preserving `characterId` semantics;
- R6.3 must have an explicit evidence-based disposition for A12-A15, even if the correct answer is defer/accepted-limit;
- L01 must remain recorded with an explicit disposition rather than disappearing from the plan.

That is the R6 roadmap contract.
