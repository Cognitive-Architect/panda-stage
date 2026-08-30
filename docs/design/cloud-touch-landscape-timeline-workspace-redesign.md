# Cloud Touch Landscape Timeline Workspace — Redesign Direction

> Status: design-only proposal; no production code changes
>
> Target: Panda Stage / Cloud Touch landscape / reference viewport approximately 2712 × 1220
>
> Design mode: Impeccable Shape / Operate
>
> Implementation reference: Draft PR #319, live HEAD at design freeze: `3f66fe5d10020b8d71b46dcbc6a1e93e163cbcee`
>
> Related design/implementation references: PR #350, Issues #351 / #359 / #373 / #374 / #375 / #376

---

## 1. Why this redesign exists

The current bottom workspace already contains useful Timeline behavior, but its landscape composition mixes two different jobs into one vertically competing surface:

1. **Timeline editing** — ruler, playhead, zoom, subtitle lane, audio lane, timed clips.
2. **Subtitle task work** — pending/Untimed subtitles, selection detail, timed subtitle editing, single add, batch paste.

Today those jobs are stacked together inside the bottom workspace. At shallow height the real Timeline becomes very small; when the subtitle task area expands, it can consume a large part of the screen and compete directly with Canvas.

The redesign therefore does **not** start from “make the Timeline prettier”. It starts from a clearer product model:

> **Timeline answers “when does this happen?”**
>
> **Task Tray answers “what still needs to be placed or edited?”**

Canvas remains the dominant authoring surface.

---

## 2. Product decisions frozen by maintainer

Three product-level decisions are frozen for the first implementation direction.

### 2.1 V1 is intentionally lightweight

Panda Stage should **not** become Premiere / Animate / After Effects in the first pass.

V1 visible tracks remain focused on the real current product needs:

```text
Timeline
├── Subtitle track
└── Audio track
```

However, the layout and ownership model must avoid assumptions that make later multi-track expansion painful.

Future possibilities may include:

```text
Timeline
├── Subtitle
├── Audio
├── Character      (future)
├── Action         (future)
├── Image          (future)
└── ...
```

This is an **extension seam**, not authorization to implement future tracks now.

### 2.2 Untimed subtitle placement should become direct manipulation

Primary intended interaction:

```text
Pending subtitle
    -> drag
    -> subtitle lane
    -> drop at desired time
    -> becomes Timed
```

The user should not need to understand `startMs`, `endMs`, timeline geometry, or scheduling terminology to perform the common action.

### 2.3 Bottom workspace height should be freely resizable

The Timeline should no longer be limited to one fixed expanded height.

The user can drag the upper edge of the bottom workspace:

```text
Canvas
│
│
├──────────── resize handle ────────────
│ Timeline workspace
│
└───────────────────────────────────────
```

This gives the user three natural modes without inventing three stored modes:

- **collapsed** — focus almost entirely on Canvas;
- **medium height** — edit Canvas while arranging subtitles;
- **large height** — focus on Timeline/task work.

The existing explicit collapse/reopen control remains useful and should be preserved.

---

## 3. Design thesis

The landscape Timeline should become:

> **a freely resizable, lightweight multi-track container whose V1 focuses on subtitles and audio; Untimed subtitles enter the Timeline by drag-to-place from a compact Pending Tray; the internal structure remains extensible without exposing future complexity prematurely.**

Success means a beginner can understand the surface through direct spatial relationships:

- the green subtitle block appears where the subtitle happens;
- dragging the block moves when it happens;
- resizing the block changes how long it lasts;
- an Untimed line sitting in the Pending Tray has not been placed yet;
- dragging that line onto the subtitle track places it.

---

## 4. Existing production truth to preserve

The redesign must build on the current owners rather than creating a parallel Timeline system.

Current key production owners include:

```text
BottomWorkspace
TimelineDock
timelineUiStore
DialogueSheet
DialogueClip
dialogueSelectionStore
DialogueInspector
DialogueAuthoringDraft
DialogueBatchPaste
shotStore
EditorProjectStore
```

Current real Timeline behavior already includes:

- current-shot duration;
- ruler ticks;
- playhead;
- seek by pointer;
- zoom;
- horizontal scroll;
- collapse/expand;
- subtitle lane;
- audio lane;
- Timed subtitle clips;
- existing Timed clip move/resize behavior elsewhere in the current Timeline flow;
- Untimed / Timed distinction;
- subtitle authoring states;
- dialogue selection ownership.

These are assets, not disposable legacy.

The redesign should replace presentation and add narrowly required interaction, not rewrite the Timeline engine.

---

## 5. Target information architecture

The new landscape bottom workspace is divided into four layers.

```text
┌──────────────────────────────────────────────────────────────┐
│ 1. Timeline Toolbar                                          │
├──────────────────────────────────────────────────────────────┤
│ 2. Time Ruler                                                │
├──────────────────────────────────────────────────────────────┤
│ 3. Track Stack                                               │
│    Subtitle                                                  │
│    Audio                                                     │
│    future track slots                                        │
├──────────────────────────────────────────────────────────────┤
│ 4. Task Tray / Pending Subtitle Tray                         │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 Timeline Toolbar

Owns only global Timeline controls/status such as:

- collapse/reopen;
- current time / duration;
- zoom out / zoom value / zoom in;
- other future truly-global Timeline controls only when justified.

It must remain compact and stable while the body resizes.

### 5.2 Time Ruler

Owns time geometry only:

- ticks;
- labels;
- playhead origin/alignment;
- seek surface.

It should not become a home for subtitle task buttons.

### 5.3 Track Stack

V1 shows:

- Subtitle track;
- Audio track.

Track labels remain fixed on the left while timed content scrolls horizontally.

Future tracks may be inserted vertically without redesigning the whole bottom workspace.

### 5.4 Task Tray

The lower task region is no longer a second giant page under the Timeline.

Default state becomes a **compact Pending Subtitle Tray** located close to the subtitle track so the drag distance is short and the relationship is obvious.

---

## 6. Resizable Bottom Workspace

### 6.1 Interaction

A dedicated resize handle sits on the upper edge of the bottom workspace.

Expected pointer sequence:

```text
pointer down on handle
-> capture pointer
-> vertical pointer move adjusts Timeline height
-> clamp to allowed range
-> pointer up commits UI height
```

Mouse and touch use the same Pointer Events path where practical.

### 6.2 Height ownership

Timeline height is **UI/session state**, not Project data.

Preferred ownership:

```text
timelineUiStore
```

or another field under the existing single Timeline UI owner if the store is refactored.

Changing height must not:

- dirty Project;
- increment Project revision;
- add History;
- change current Shot;
- change dialogue/layer selection;
- invoke IPC/Main/Preload persistence.

### 6.3 Clamp rules

The workspace needs a minimum and maximum.

Minimum must keep the essential Timeline reopen/toolbar path usable and must not collapse the interaction surface into an unusable strip.

Maximum must preserve a meaningful Canvas region; dragging upward must not erase Canvas from the working layout.

The final limits should be derived from the real editor body/device height rather than treating one fixed pixel constant as universally correct.

### 6.4 Collapse relationship

Free resize does not replace collapse.

```text
resizable expanded state <-> explicit collapsed state
```

Collapse remains a fast “give space back to Canvas” action.

Reopening should restore a sensible previous expanded height if this can be done without introducing a second conflicting owner.

---

## 7. Timeline Toolbar direction

Recommended first-glance structure:

```text
[⌃ 收起]   00:00.000 / 00:03.000                 [−] 1× [+]
```

Rules:

- do not make every icon a green button;
- current time is status, not a CTA;
- zoom is a compact tool cluster;
- collapse has clear touch affordance;
- global controls do not move when track content scrolls.

The toolbar should feel more like a lightweight editor strip than a card header.

---

## 8. Track Stack direction

### 8.1 V1 visible tracks

```text
字幕  | timed subtitle clips...
音频  | audio clips...
```

### 8.2 Future-track compatibility

V1 should **not** build a plugin registry or generic NLE framework.

Instead, avoid brittle assumptions such as:

- exactly two lanes forever;
- lane heights hard-coded by `nth-child`;
- subtitle/audio-specific layout rules controlling the entire track container;
- track labels embedded into unrelated time geometry.

A future implementation may eventually use a small track descriptor contract, but that abstraction should only be introduced when it reduces real duplication.

The design requirement today is simply:

> adding a third real track later should not require rebuilding the Timeline shell.

---

## 9. Pending Subtitle Tray

### 9.1 Default landscape presentation

Instead of a tall vertical task list consuming the bottom half of the app, the landscape default should be a compact tray.

Example:

```text
待安排字幕  9
[Panda · 第一句测试对白] [Panda · 第二句测试对白] [李狗蛋 · ...] →
```

Preferred landscape behavior:

- compact one-row cards/chips;
- horizontal scrolling for overflow;
- speaker + one-line dialogue preview;
- clear Untimed identity without repeating large explanatory paragraphs;
- count is immediately visible;
- `＋ 新建字幕` remains reachable but does not dominate.

### 9.2 Why horizontal in landscape

The tray is a source for drag-to-place.

Placing it directly below the track stack reduces pointer travel:

```text
Pending Tray
     ↑ drag a line
Subtitle Track
```

It also prevents the queue from visually becoming more important than the actual Timeline.

### 9.3 Long content

Long subtitle text should truncate in the tray.

Full text remains available when selected/edited; tray cards are for scanning and placement, not precision editing.

---

## 10. Drag-to-place — core V1 interaction

### 10.1 Primary flow

```text
Untimed subtitle card
-> pointer/touch drag starts after a real drag threshold
-> lightweight drag ghost follows pointer
-> Subtitle lane becomes valid drop target
-> ghost snaps visually to mapped time
-> release commits placement
-> subtitle becomes Timed
```

### 10.2 Drag threshold

A normal tap/click must remain distinguishable from drag.

Do not start drag on every `pointerdown` immediately; this would make selection and scrolling unreliable on Cloud Touch.

### 10.3 Drag ghost

The drag preview should show enough identity to prevent mistakes:

```text
Panda · 第一行测试对白
```

It should be lighter than a committed subtitle clip and clearly temporary.

### 10.4 Drop target

Only the real Subtitle lane is a valid V1 placement target.

When the pointer is over a valid area:

- lane receives a subtle drop highlight;
- preview position maps to Timeline time;
- the ghost should indicate its expected initial span.

Do not imply Audio or future tracks can receive subtitle cards.

### 10.5 Placement semantics

V1 should remain intentionally simple.

Desired semantic target:

```text
drop horizontal position -> subtitle start time
initial duration -> reuse the existing one-frame/default arrangement rule
```

Do not invent:

- smart scheduling;
- nearest free slot search;
- automatic ripple;
- automatic lane creation;
- automatic conflict resolution.

If the drop would violate current overlap/business constraints, the operation should not silently move somewhere else.

### 10.6 Invalid drop

Preferred behavior:

```text
invalid target / conflict
-> preview shows invalid state
-> release does not commit
-> card returns/remains in Pending Tray
-> concise explanation is shown near the relevant task surface
```

The user should not lose the Untimed dialogue.

### 10.7 Existing `安排一帧` capability

Drag-to-place becomes the primary interaction, but the existing one-frame arrangement path can remain as a secondary/fallback route where useful for:

- keyboard accessibility;
- precise “place at playhead” workflow;
- migration safety during staged implementation.

It should no longer need to dominate every default queue row visually.

---

## 11. Scroll and gesture ownership

This redesign introduces a real gesture-risk area and must be explicit about ownership.

### 11.1 Horizontal Timeline scroll

Existing horizontal Timeline scrolling remains.

Dragging a Pending subtitle must not accidentally become horizontal scroll after the drag gesture is committed.

### 11.2 Pending Tray horizontal scroll

The Pending Tray also needs overflow scrolling.

Therefore touch interaction must distinguish:

- horizontal tray scroll;
- card tap;
- card drag-to-place.

A small drag threshold / directional intent rule may be required.

### 11.3 Workspace vertical resize

Resize only starts from the dedicated resize handle.

Dragging ordinary Timeline/tray content vertically must not resize the workspace.

### 11.4 Existing Timed clip gestures

Do not regress:

- clip selection;
- clip move;
- clip start resize;
- clip end resize;
- pointer capture/cancel behavior.

Untimed drag-to-place is an additional gesture path, not a replacement for Timed clip manipulation.

---

## 12. Task Tray state model

The lower Task Tray should behave as **one focused task surface** rather than stack multiple editors below the tracks.

Recommended states:

```text
A. Pending default
B. Untimed selected / placement context
C. Timed subtitle selected / precision edit
D. Single Add
E. Batch Paste
F. Empty
```

This reuses the current DialogueSheet state concepts instead of creating a second subtitle state machine.

### A. Pending default

Shows compact Pending Tray.

### B. Untimed selected

May expose lightweight detail/fallback action without expanding into a full inspector.

Drag remains primary.

### C. Timed selected

The Task Tray can switch from Pending cards to the existing Timeline-side precision editor for the selected Timed subtitle.

The key rule is **replacement, not stacking**: selecting a Timed subtitle should not create a second giant sheet under an already-large pending list.

### D / E. Authoring

`＋ 新建字幕` may continue opening the existing mutually exclusive Single / Batch authoring modes.

When authoring is open, it occupies the Task Tray role rather than stacking below another full Pending list.

### F. Empty

If no Untimed subtitles exist:

```text
暂无待安排字幕        [＋ 新建字幕]
```

Keep it compact.

---

## 13. Visual direction

The Timeline must inherit the visual language already accepted in the surrounding landscape editor:

- near-black / deep green surfaces;
- restrained Panda green;
- selected/active state more important than generic enabled state;
- thin separators instead of nested cards;
- touch-friendly targets;
- compact Lucide icon treatment;
- low-noise ruler/ticks;
- clips carry content color, not every control.

Avoid:

- every button filled green;
- large nested cards inside the Timeline;
- giant explanatory paragraphs in normal state;
- permanent admin-style forms beneath the tracks;
- decorative track complexity for features that do not exist.

---

## 14. Responsive height behavior

The surface should make good use of the user-controlled height.

### Shallow expanded height

Prioritize:

1. Toolbar
2. Ruler
3. Subtitle / Audio lanes
4. single-row compact Pending Tray

### Medium height

Allow more breathing room and clearer clip labels, but do not inflate controls merely because space exists.

### Large height

Use extra space for:

- more visible vertical track capacity;
- larger task editor when a Timed subtitle / authoring state is active;
- more Pending content without stealing Canvas permanently.

Do not simply stretch fixed rows vertically.

---

## 15. Accessibility / touch requirements

- resize handle must have a meaningful accessible label/role where practical;
- collapse remains keyboard reachable;
- Pending cards remain selectable without drag;
- drag-to-place needs a non-drag fallback for keyboard users;
- drag ghost is not the only carrier of placement meaning;
- focus must not disappear when a drag is cancelled;
- track labels remain readable at Cloud Touch scale;
- important controls keep the existing 44/48px class of hit-target expectations;
- no hover-only critical action.

---

## 16. Data / mutation boundaries

### UI-only state

The following should remain session/UI state:

- Timeline expanded/collapsed;
- Timeline height;
- zoom;
- horizontal scroll;
- transient drag ghost/drop preview;
- active authoring draft before commit.

These must not create Project dirty/revision/History entries.

### Project mutation

Only the actual committed subtitle placement/edit should mutate Project according to the existing authoritative dialogue/Timeline ownership.

A cancelled drag must not mutate Project.

---

## 17. Explicit non-goals for the first redesign program

Do not use this redesign to add:

- full NLE multi-track editing;
- character/action/image tracks;
- track visibility/mute/solo systems;
- track reordering;
- keyframes;
- animation curves;
- magnetic snapping framework beyond what current product rules require;
- smart subtitle scheduling;
- nearest-free-slot search;
- ripple edit;
- automatic conflict solving;
- a second Timeline owner;
- a second dialogue selection owner;
- new Project schema solely for UI height;
- IPC/Main/Preload changes solely for Timeline presentation;
- a rewrite of existing time geometry;
- a rewrite of Timed clip move/resize before evidence requires it.

---

# 18. Recommended staged implementation plan

This redesign is intentionally too large for one implementation Issue.

Each stage should be implemented, automatically validated, and visually/interaction tested on the real Windows Electron -> Wuying -> Redmi landscape path before the next stage expands scope.

## Stage A — Resizable bottom-workspace foundation

### Goal

Make Timeline height freely adjustable without changing Timeline business behavior.

### Scope

- add dedicated resize handle;
- add one authoritative UI height state under the existing Timeline UI owner;
- clamp min/max;
- preserve explicit collapse/reopen;
- Canvas receives freed/taken vertical space correctly;
- mouse + touch pointer behavior;
- no drag-to-place yet;
- no track redesign yet.

### Proof

- resize is smooth;
- no accidental resize from Timeline content;
- collapse/reopen remains reliable;
- Project/History remain untouched;
- Canvas never disappears;
- real Redmi/Wuying touch works.

---

## Stage B — Timeline shell / track-stack visual architecture

### Goal

Separate Toolbar / Ruler / Track Stack / Task Tray visually and structurally while preserving existing behavior.

### Scope

- refine toolbar;
- make ruler ownership clearer;
- make Subtitle/Audio lanes a coherent track stack;
- create Task Tray boundary;
- preserve current Timed clip geometry/seek/zoom/scroll;
- no Pending drag commit yet.

### Proof

- Timeline reads as one editor, not stacked cards;
- track labels and content align;
- zoom/seek/playhead remain exact;
- shallow/medium/large height all remain readable.

---

## Stage C — Pending Subtitle Tray

### Goal

Replace the tall landscape pending queue with the compact drag-source tray.

### Scope

- one-row horizontal Pending cards/chips;
- count;
- speaker + truncated copy;
- horizontal overflow;
- `＋ 新建字幕` entry;
- retain current selection / one-frame fallback behavior;
- no drag-to-place mutation yet if risk warrants separating it.

### Proof

- 1 / 9 / 30+ Pending items remain usable;
- scrolling does not accidentally select;
- Task Tray no longer dominates the workspace;
- existing authoring states remain reachable.

---

## Stage D — Drag-to-place

### Goal

Allow an Untimed subtitle to be dragged directly onto the Subtitle track.

### Scope

- gesture threshold;
- drag ghost;
- valid Subtitle-lane target;
- time mapping from drop X;
- existing/default initial duration rule;
- invalid/conflict state;
- cancel/recovery;
- Project commit only on valid drop;
- retain accessible fallback.

### Proof

- tap vs scroll vs drag are distinguishable;
- Wuying/Redmi drag is stable;
- dropping at different X positions produces correct start times;
- invalid drops never lose data;
- Timed move/resize still works.

---

## Stage E — Unified Task Tray states / hardening

### Goal

Make Pending / Timed edit / Single Add / Batch Paste feel like states of one task surface instead of stacked worktables.

### Scope

- state transitions reuse existing DialogueSheet truth;
- Timed editor replaces tray content when active;
- authoring modes replace tray content while open;
- clean back/close transitions;
- empty state;
- overflow/long copy/error hardening;
- no new subtitle owner.

### Proof

- no stale state when switching shots;
- authoring draft rules remain correct;
- selection remains single-owner;
- no hidden giant sheet competes with Canvas;
- all major states work at real resizable heights.

---

## 19. Program-level human acceptance path

Every stage should include the real target path:

```text
Windows Electron
-> Aliyun Wuying
-> Redmi K60 Ultra
-> Cloud Touch landscape
-> approximately 2712 × 1220
```

Important real-device checks across the program:

- resize handle reachability;
- resize smoothness;
- Canvas/Timeline space balance;
- horizontal Timeline scroll;
- Pending Tray scroll;
- Pending card drag;
- drag ghost visibility under touch;
- drop accuracy;
- Timed clip move/resize;
- zoom/seek/playhead;
- authoring state transitions;
- no accidental double gesture;
- no white screen / overflow trap / unreachable control.

---

## 20. Stop-loss rules

Stop the current stage and report rather than expanding scope if any implementation starts requiring:

- a second Timeline engine/owner;
- a second dialogue selection owner;
- Project schema changes just to support workspace height;
- wholesale time-geometry rewrite;
- rewriting Timed drag/resize without a demonstrated blocker;
- smart scheduling / auto conflict resolution;
- speculative future track features;
- broad Canvas architecture replacement;
- IPC/Main/Preload changes for presentation-only state.

The rule for this program is:

> **make the cockpit better without rebuilding the engine unless evidence proves the engine is the blocker.**

---

## 21. Concept sketch — target landscape relationship

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                               Canvas                                       │
│                                                                            │
│                                                                            │
├─────────────────────── drag to resize height ──────────────────────────────┤
│ [⌃]  00:00.000 / 00:03.000                                  [−] 1× [+]  │
├────────┬───────────────────────────────────────────────────────────────────┤
│        │ 00:00        00:01        00:02        00:03                     │
│ 字幕   │ [第一句────]        [第二句──────]                               │
│ 音频   │ [────────────── BGM ─────────────────────────────]               │
├────────┴───────────────────────────────────────────────────────────────────┤
│ 待安排字幕  9                                             [＋ 新建字幕]   │
│ [Panda · 卧槽！] [Panda · 还有这种好事？] [李狗蛋 · ...]  →             │
└────────────────────────────────────────────────────────────────────────────┘
```

During drag:

```text
Pending card
   └──────────────► Subtitle lane
                     ┊░░ ghost preview ░░┊
                     ↑ drop here
```

---

## 22. Follow-up design artifacts

This document freezes the **product / interaction direction**, not final pixel measurements.

Before each implementation stage, a focused visual concept may still be produced for the stage being implemented, especially:

- Stage A resize handle / shallow-expanded appearance;
- Stage B full Timeline shell;
- Stage C Pending Tray cards;
- Stage D drag ghost / valid-invalid drop states;
- Stage E Timed editor / authoring states at variable height.

Those artifacts may refine spacing and presentation, but must not silently violate the frozen product decisions and ownership boundaries in this document.

---

## 23. Final design contract summary

```text
V1 PRODUCT:
lightweight / beginner-first / subtitle + audio

FUTURE:
layout must permit additional tracks without exposing them now

BOTTOM WORKSPACE:
freely resizable + explicit collapse
height = UI/session state

TIMELINE IA:
Toolbar
Ruler
Track Stack
Task Tray

UNTIMED SUBTITLE PRIMARY ACTION:
drag Pending card -> Subtitle track -> valid drop commits timing

TIMED SUBTITLE:
existing direct manipulation remains authoritative

PENDING UI:
compact landscape tray, not a giant permanent worksheet

GESTURE PRINCIPLE:
tap / scroll / drag / resize must have distinct ownership

ARCHITECTURE:
reuse current Timeline / dialogue owners
no parallel engine

IMPLEMENTATION:
A resize foundation
B shell / tracks
C Pending Tray
D drag-to-place
E unified task states / hardening
```
