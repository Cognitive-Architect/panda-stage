# FLA Workbench Landscape Design Direction v1

Date: 2026-08-31  
Status: **Maintainer-confirmed design direction**  
Companion inventory: `docs/design/fla-workbench-seven-state-inventory-2026-08-31.md`  
Baseline: `main@24b412881f28df926f262975682924d5d1faec28`

## 1. Purpose

This document freezes the first confirmed product-design direction for the existing Panda Stage FLA Workbench.

The task is **visual / information-architecture convergence of an already functional workbench**. It is not deeper FLA research and does not authorize parser, renderer, schema, security, or semantic-import expansion.

The current FLA stack already owns the required business truth for:

- inspection / safe blocking;
- direct raster review and explicit import;
- static snapshot target + frame preview and explicit import;
- bounded frame-sequence rendering and explicit import;
- compatibility / fidelity messaging;
- duplicate/reuse outcomes;
- stale preview / stale sequence guards.

The redesign should make those existing capabilities feel like one coherent product rather than a vertical accumulation of implementation slices.

---

## 2. Confirmed maintainer decisions

The following decisions are approved and should be treated as the design baseline for the next blueprint phase.

### Decision A — Landscape first

The first redesign target is the **landscape FLA Workbench**, aligned with the current Windows Electron / Aliyun Wuying / Redmi K60 Ultra Cloud Touch review environment.

Portrait is explicitly deferred until the landscape information architecture and interaction hierarchy are accepted.

This is sequencing, not a declaration that portrait is unimportant.

### Decision B — Snapshot and Sequence share one presentation shell

State D (Static Snapshot) and State E (Frame Sequence) should be presented as two sibling user intents inside one Render Workbench:

```text
select renderable content
        ↓
[ Single frame ] [ Frame sequence ]
        ↓
mode-specific controls
        ↓
preview
        ↓
explicit import
```

Important boundary:

> Visual unification does **not** authorize merging the existing R1 / R2 business owners or state machines.

The product may present one shared target-selection concept while implementation continues to preserve the existing authoritative Snapshot and Sequence owners underneath.

If achieving a shared presentation requires replacing stale guards, commit contracts, renderer ownership, or state authority, stop and redesign the presentation layer instead.

### Decision C — Compatibility information is progressively disclosed

Compatibility information should no longer occupy equal primary visual weight with the user's import task.

Severity is separated into three product levels:

```text
F1  warning but usable
F2  one target unavailable, other work may continue
F3  whole-file Safe Blocked
```

Target behavior:

- F1 is concise and low-to-medium emphasis, with details available on demand;
- F2 is shown locally beside the unavailable target;
- F3 owns a dedicated blocking state and does not expose fake import / preview actions.

Safety truth is preserved. Only presentation priority changes.

---

## 3. Product mode

This surface is an **Operate** interface.

The user arrives to complete a task, not to study FLA internals.

Primary success criterion:

> A beginner can tell what Panda found, what they can use right now, what the current preview represents, and what action creates Project assets — without understanding XFL / DOM / renderer internals.

The workbench should disappear into the task.

---

## 4. Core interaction thesis

The redesign should use **one stable workbench shell** with state-dependent content instead of treating every implementation slice as a separate mini-tool.

At every moment the surface should answer four questions in this order:

1. **What file am I working with?**
2. **What usable content did Panda find?**
3. **What am I choosing / previewing now?**
4. **What is the one next action?**

Everything else is supporting information.

---

## 5. Proposed landscape topology

The preferred composition for the high-fidelity blueprint phase is:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ FLA Workbench header                                  [Cancel/Close] │
│ source identity · concise status                                    │
├───────────────────────┬──────────────────────────────────────────────┤
│                       │                                              │
│ CONTENT / SELECTION   │ PREVIEW / REVIEW                             │
│                       │                                              │
│ What Panda found      │ Large visual focus                           │
│ Target / media list   │ Frame or sequence preview                    │
│ Relevant filters      │ Local warning / fidelity feedback            │
│                       │                                              │
├───────────────────────┴──────────────────────────────────────────────┤
│ secondary status / details                    PRIMARY TASK ACTION     │
└──────────────────────────────────────────────────────────────────────┘
```

This is a structural thesis, not a frozen pixel specification.

### Header owns

- `FLA` workbench identity;
- source filename;
- concise inspection / recovery state when relevant;
- one close / cancel action.

### Content / selection region owns

Depending on route:

- direct raster assets;
- renderable target selection;
- lightweight selection counts;
- Single frame / Frame sequence mode choice for zero-raster render content.

### Preview / review region owns

- bitmap visual scan when appropriate;
- one large static snapshot preview;
- sequence filmstrip / selected-frame review;
- mode-local controls;
- fidelity feedback associated with the thing being previewed.

### Bottom action region owns

- the current primary CTA;
- concise commit / progress / completion feedback;
- secondary actions only when they are necessary to the current state.

---

## 6. Information hierarchy

The workbench should enforce the following priority order.

### Level 1 — Usable content

What can the user actually take from this FLA now?

Examples:

- bitmap thumbnails;
- renderable target names;
- the current static preview;
- the current rendered sequence.

### Level 2 — Current task controls

What does the user need to choose or adjust to complete the current operation?

Examples:

- selected assets;
- selected target;
- frame index;
- frame range;
- preview / generate;
- confirmation / import.

### Level 3 — Actionable risk

What materially changes the expected result?

Examples:

- degraded fidelity;
- unavailable target;
- filename collision / duplicate reuse outcome;
- validation preventing sequence generation.

### Level 4 — Engineering / file facts

Useful but not part of the primary scan path:

- stage dimensions / fps;
- scene count;
- symbol count;
- layer count;
- frame count;
- target filename;
- source reference;
- `not-present` compatibility entries.

These facts should remain available through compact summaries / details rather than competing with the primary task.

---

## 7. Primary-action rule

Each state should visually expose **one primary CTA**.

Green / accent treatment is reserved for:

- the current selection;
- the current mode;
- the one next meaningful action;
- semantic success / progress where appropriate.

Do not style every button as primary.

Examples:

```text
State A        -> Cancel is secondary; scanning state is primary content.
State B ready  -> Confirm selected items.
State B confirm-> Import selected items.
State D select -> Preview current frame.
State D preview-> Import current frame.
State E select -> Generate frame sequence.
State E ready  -> Import frame sequence.
State F3       -> Return to Asset Library / Close.
State G        -> Return to Asset Library or continue from a clear completion state.
```

This does not change the existing explicit-confirmation / explicit-commit semantics.

---

# 8. State-by-state target direction

## State A — Inspecting / Reading FLA

### User job

Wait for Panda to inspect the source and understand that nothing has been changed yet.

### Target treatment

- Keep the full Workbench shell visible instead of showing a large empty modal.
- Use a deliberate loading / skeleton state in the content region.
- Show one concise truth:
  - `正在检查 FLA`
  - `不会修改原文件或项目素材`
- Keep real cancel available.
- Do not expose speculative progress percentages if the current backend does not own real percentage progress.

### Remove / demote

- duplicate loading prose;
- large unused whitespace;
- engineering detail before inspection succeeds.

---

## State B — Direct Raster Review / Many Bitmap Assets

### User job

Quickly scan images, select what is useful, and import it.

### Target treatment

- Make thumbnails the dominant visual element.
- Keep default selected state truthful.
- Make the entire card selection affordance obvious and touch-safe.
- Default card content should prioritize:
  - thumbnail;
  - asset name;
  - selected / unselected state.
- Secondary details move to a compact metadata/detail treatment:
  - dimensions / source format;
  - source reference;
  - `已使用` / `仅素材库`;
  - target filename;
  - filename warnings.
- Selection count becomes lightweight workbench feedback, not the visual hero.
- `全选` / `清空` remain useful utilities but should not compete with the primary CTA.

### Primary CTA sequence

```text
choose assets
-> Confirm N items
-> Import N items
```

The two-step business truth remains intact; only the presentation should feel like one coherent action flow.

---

## State C — Direct Raster Review + Rich Structural Metadata

### User job

Still select bitmap assets.

### Target treatment

Use the same visual architecture as State B.

Rich FLA structure appears as secondary context, for example conceptually:

```text
Also detected: 27 symbols · 37 layers · 88 frames   [Details]
```

Exact copy is not frozen yet.

### Hard boundary

Do not add a Render / Extract frame action for media-positive files only because structure exists.

`media.length > 0` remains the current raster business route.

---

## State D — Zero Raster / Static Snapshot

### User job

Choose one renderable content target, choose a frame, see the real result, then import that frame.

### Target treatment

- Remove the irrelevant parent raster `0 / 0` selection toolbar from the zero-raster presentation.
- Use the unified Render Workbench target-selection region.
- Expose a visible sibling mode control:

```text
[ Single frame ] [ Frame sequence ]
```

- Single-frame mode owns:
  - selected target;
  - previous / current / next frame control;
  - `Preview current frame`;
  - large preview area;
  - local fidelity note;
  - `Import current frame` only after valid preview.
- The preview should be the visual focal point once available.
- Changing target / frame must visibly return the state to “preview required”.

### Preserve

- stale preview invalidation;
- preview-before-import;
- unsupported-target honesty;
- ordinary ImageAsset output.

---

## State E — Zero Raster / Frame Sequence

### User job

Choose one renderable target, choose a bounded range, generate it, review the frames, then import the latest accepted sequence.

### Target treatment

Use the same unified target-selection region as State D in presentation.

Sequence mode owns:

- start frame;
- end frame;
- calculated frame count;
- 24-frame hard-cap feedback;
- `Generate frame sequence`;
- real progress and Cancel while rendering;
- ordered filmstrip / frame review;
- `Re-render` as a secondary action;
- `Import frame sequence` as primary only for the latest valid result.

### Filmstrip principle

Replace the current raw vertical image accumulation with a bounded review composition.

Conceptually:

```text
[01] [02] [03] [04] [05] ...
          ↑ selected / focus frame

larger selected-frame preview when useful
```

The exact interaction is deferred to blueprint validation.

### Preserve

- inclusive range truth;
- 24-frame cap;
- local validation before IPC;
- stale / late response rejection;
- range-change invalidation;
- re-render invalidation;
- latest accepted sequence as the only commit candidate.

---

## State F — Compatibility / Unsupported / Safe Blocked

### F1 — Warning but usable

Target presentation:

- concise status near the relevant work area;
- one summary such as “部分内容可能与原 FLA 有差异”;
- detailed compatibility list collapsed / secondary by default;
- no five equal-weight status cards dominating the page.

Do not hide material fidelity warnings.

### F2 — One target unavailable

Target presentation:

- keep the target visible;
- mark it locally as unavailable;
- show the real reason in local secondary text / detail;
- allow other supported targets to continue normally.

### F3 — Whole-file Safe Blocked

Target presentation:

- dedicated blocking composition inside the same Workbench shell;
- plain beginner-facing explanation;
- explicitly state when the source was not modified where current truth supports it;
- no fake media selection, preview, or import actions;
- one clear exit action.

This state may use stronger warning/error emphasis because the user's task is genuinely blocked.

---

## State G — Confirm / Commit / Success

### User job

Understand exactly what will be created, then know whether the import completed and what happened.

### Target treatment

Do not add another full page merely for confirmation unless later blueprint testing proves it necessary.

Prefer the stable Workbench shell with a bottom action region whose state changes deliberately:

```text
ready
-> confirmed
-> importing
-> success / error
```

### Direct raster

Preserve selection-confirmation before commit.

### Static snapshot

Preserve valid-preview requirement before commit.

### Frame sequence

Preserve latest-accepted-sequence requirement before commit.

### Success treatment

Completion should feel terminal and calm, not like another status line appended to a debug page.

Show only meaningful outcome facts, such as:

- imported count;
- duplicate / reused count;
- resulting filename for one snapshot;
- clear return to Asset Library.

---

# 9. Compatibility disclosure rule

The redesign should not interpret “demote compatibility” as “hide compatibility”.

Use progressive disclosure based on actionability:

```text
Can user continue normally?
  yes -> keep warning concise, details available

Is one target unavailable?
  yes -> show reason beside that target

Is the whole FLA blocked?
  yes -> dedicated blocking state
```

`未出现 / not-present` is normally diagnostic context, not a primary workflow card.

---

# 10. Touch / Cloud-PC constraints

Landscape blueprints should be validated against the current real target:

```text
Windows Electron
-> Aliyun Wuying
-> Redmi K60 Ultra
-> Cloud Touch landscape
```

Design consequences:

- important controls must remain touch-safe;
- avoid tiny desktop-only disclosure affordances;
- target/media rows must tolerate long Chinese / source names;
- one deliberate primary scroll owner;
- no nested wheel/touch scroll traps;
- primary preview must not be squeezed by permanently expanded technical detail;
- selection utilities and mode switches must remain reachable without stealing preview space.

---

# 11. What remains untouched

This design direction does **not** authorize changes to:

- top-level content routing;
- parser or parser closure;
- preflight / recovery security policy;
- static snapshot renderer semantics;
- frame sequence renderer semantics;
- Project schema;
- Asset commit ownership;
- R1 stale-preview guard;
- R2 stale-sequence / latest-request guards;
- sequence 24-frame cap;
- ActionScript behavior;
- V2-S semantic import;
- mixed bitmap + rendered-content import;
- PR #319 Ready / merge state.

---

# 12. Blueprint matrix for the next step

The next design artifact should render the confirmed direction across these visual states:

```text
A1 Inspecting
B1 Raster review / many assets
B2 Raster selection confirmed / commit available
C1 Raster review + rich structure summary
D1 Render Workbench / Single frame / no preview yet
D2 Render Workbench / Single frame / preview ready
E1 Render Workbench / Sequence / range selecting
E2 Render Workbench / Sequence rendering progress
E3 Render Workbench / Sequence preview ready
F1 Soft compatibility warning
F2 Target unavailable
F3 Safe Blocked
G1 Importing
G2 Import success
G3 Import error / retry-safe state
```

The seven-state inventory remains the business/state reference; this expanded matrix exists only to ensure the high-fidelity design covers material visual transitions.

---

# 13. Acceptance questions for high-fidelity review

A blueprint should not be accepted merely because it looks more modern.

Maintainer review should be able to answer **yes** to all of the following:

1. Can I immediately tell whether Panda found bitmap assets or renderable content?
2. Is the actual content / preview visually more important than file diagnostics?
3. In every state, is there only one obvious next primary action?
4. In zero-raster mode, are Single frame and Frame sequence clearly sibling intents rather than two stacked tools?
5. Can I understand warning vs one-target-unavailable vs whole-file-blocked without reading technical internals?
6. Are preview and import still visibly different actions?
7. Does changing a frame / range make it obvious that the old preview/result is no longer the import candidate?
8. Can a Cloud Touch user operate the primary path without tiny controls or nested scrolling?
9. Are technical facts still available without dominating the default view?
10. Has the design avoided inventing any capability that current code does not own?

---

# 14. Implementation consequence

After visual approval, implementation should be split into narrow presentation issues rather than one FLA rewrite.

Likely implementation slices may include:

- Workbench shell / hierarchy;
- direct-raster card density + selection toolbar;
- zero-raster Render Workbench presentation bridge;
- Single frame presentation;
- Frame sequence filmstrip / controls;
- compatibility severity presentation;
- commit / success / error treatment;
- landscape Cloud Touch hardening.

Exact tickets are deferred until blueprints are accepted.

---

## Status marker

```text
FLA_WORKBENCH_DIRECTION_V1=MAINTAINER_CONFIRMED
LANDSCAPE_FIRST=true
PORTRAIT_DEFERRED=true
SNAPSHOT_SEQUENCE_SHARED_PRESENTATION=true
R1_R2_BUSINESS_OWNER_MERGE=false
COMPATIBILITY_PROGRESSIVE_DISCLOSURE=true
SAFE_BLOCKED_STRONG_STATE=true
ONE_PRIMARY_CTA_PER_STATE=true
PRODUCTION_CODE_CHANGED=false
READY_FOR_LANDSCAPE_HIGH_FIDELITY_BLUEPRINT=true
```
