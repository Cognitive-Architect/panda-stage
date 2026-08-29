# Landscape Contextual Properties Inspector — Stage A–C Design Spec

> Status: design-only proposal; no production code changes
>
> Target: Cloud Touch landscape editor, reference viewport 2712 × 1220
>
> Design direction: Option A — Compact Edge Handle + Contextual Drawer
>
> Design method: Impeccable-informed hierarchy, progressive disclosure, touch reachability, state legibility, and minimal visual noise.
>
> Design source: PR #306 cloud-mobile editor direction.
>
> Implementation context reviewed: active PR #319 (`agent/issue-318-ui-m1`) currently owns the adaptive shell and a single `RightInspector`. This document does not claim those changes are merged into `main`.

## 1. Problem statement

The current landscape Properties experience has three presentation problems:

1. The collapsed Properties affordance is visually too tall for a control whose only job is to open the inspector.
2. The open-but-empty state still exposes section shells that have little immediate value before an object is selected.
3. The selected-object state contains the right capabilities, but the information hierarchy can be made more task-oriented: first identify the selected object, then expose high-frequency transform controls, then disclose lower-frequency appearance and layer controls.

The goal of this pass is not to redesign the property engine. It is to make the existing property capabilities read like a modern contextual inspector.

## 2. Scope

This design freezes three landscape presentation states:

- **Stage A — Collapsed / Compact Edge Handle**
- **Stage B — Open / No Selection**
- **Stage C — Open / Selected Object**

### In scope

- rail/handle size and placement;
- drawer open/close behavior;
- empty-state content;
- selected-object identity summary;
- section hierarchy and disclosure order;
- touch target, spacing, scrolling, focus and keyboard behavior;
- acceptance criteria for 2712 × 1220 Cloud Touch landscape.

### Out of scope

This proposal MUST NOT:

- create a second selection owner;
- change `selectionStore`, `dialogueSelectionStore`, `shotStore`, or `EditorProjectStore` ownership;
- change Project schema, dirty/revision rules, autosave, History or IPC;
- change transform math, coordinate semantics, layer ordering semantics, background protection, delete semantics, or locking semantics;
- merge or redesign Layer/Dialogue domain models;
- start a broad rewrite of `RightInspector`, `LayerTransformPanel`, `LayerBackgroundControl`, or `LayerOrderControls`;
- treat PR #319 as already merged product behavior.

The implementation should be presentation-first and reuse the existing single inspector surface.

---

# Stage A — Collapsed / Compact Edge Handle

## Job

Keep Properties discoverable and easy to hit without dedicating a full-height vertical rail to one action.

## Proposed layout

```text
Canvas viewport                                             right edge
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│                                                       ┌──────────┐ │
│                                                       │    ‹     │ │
│                                                       │   属性   │ │
│                                                       │    ⚙     │ │
│                                                       └──────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

The icon is optional if the existing visual system looks cleaner with text + chevron only. The critical change is **short handle, large hit area, no full-height decorative rail**.

## Geometry

Recommended target geometry at the 2712 × 1220 reference viewport:

- visual width: **52–60 px**;
- visual height: **132–168 px**;
- minimum interactive hit target: **52 × 132 px**;
- vertically centered in the usable Canvas/right-edge region rather than pinned to the top;
- right offset: aligned to the adaptive shell edge, not layered over the Canvas scrollbar;
- corner radius: consistent with existing Panda Stage compact surfaces (about 12–14 px visual language);
- text may remain vertical if that matches the left-edge resource handle, but the button itself must no longer span the entire inspector height.

The exact final pixel values remain subject to real Wuying/Redmi acceptance. The design intent is compactness, not a magic fixed number.

## Interaction

- Tap/click anywhere on the handle opens the drawer.
- `Enter` / `Space` opens it when focused.
- `aria-expanded` reflects drawer state.
- `aria-controls` points to the real inspector drawer.
- The handle remains a single button, not separate text/icon click zones.
- The handle MUST NOT depend on hover.

## Open transition

When the drawer opens:

- the edge handle disappears or becomes non-interactive;
- the drawer owns the right-side surface;
- focus moves into the drawer using the existing focus-management contract;
- an explicit close control is visible inside the drawer.

When the drawer closes:

- focus returns to the edge handle;
- selection remains unchanged;
- Project/dirty/revision/History remain unchanged.

## Visual relationship with Canvas scrollbar

The Properties handle and Canvas scrollbar must read as two different controls.

Required outcome:

- scrollbar remains a thin scrolling affordance;
- Properties becomes a discrete floating/edge button;
- no two adjacent full-height green vertical shapes that visually compete with each other.

---

# Stage B — Open / No Selection

## Job

Tell the user what to do next, then get out of the way.

## Proposed layout

```text
┌───────────────────────────────┐
│ 属性                       × │
│                               │
│             ◇                 │
│                               │
│        未选择对象             │
│                               │
│ 点击画布中的角色、图片或      │
│ 其他可编辑对象，这里会显示    │
│ 位置、大小和图层设置。        │
│                               │
└───────────────────────────────┘
```

## Content rules

When no layer/object is selected:

- show **one empty state only**;
- hide the empty shells for `变换`, `外观`, and `图层`;
- do not show disabled controls merely to preview future capabilities;
- do not show a primary CTA that duplicates the obvious Canvas action;
- keep the copy short and beginner-readable.

Recommended copy:

- heading: `未选择对象`
- body: `点击画布中的角色、图片或其他可编辑对象，这里会显示位置、大小和图层设置。`

Alternative accepted body if implementation needs to align with existing terminology:

- `点击画布中的角色、图片或背景，即可调整位置、缩放、外观与图层顺序。`

Do not show both versions.

## State persistence

If the user has the inspector open and then clears selection:

- the inspector **stays open**;
- the content switches to this empty state;
- it MUST NOT auto-collapse.

Rationale: panel-open state is a user workspace preference; selection is object context. Clearing one should not silently mutate the other.

## Empty-state visual hierarchy

- icon: small, low-contrast decorative guidance only;
- heading: 18–20 px equivalent hierarchy;
- body: 13–15 px equivalent hierarchy;
- centered or near-centered in the available empty area;
- no stacked cards beneath it;
- no large green blocks.

## Accessibility

- empty state uses `aria-live="polite"` or equivalent status semantics;
- icon is decorative (`aria-hidden=true`);
- heading/body are connected through `aria-labelledby` / `aria-describedby` where practical;
- the drawer close control remains reachable before/after the empty-state content.

---

# Stage C — Open / Selected Object

## Job

Answer three questions in this order:

1. **What did I select?**
2. **What do I most often need to change?**
3. **Where are the less-frequent controls?**

## Proposed structure

```text
┌──────────────────────────────────┐
│ 属性                           × │
│                                  │
│ [缩略图]  Panda neutral           │
│          图片                     │
│                                  │
│ 变换                              │
│ 位置                              │
│ X [ 395.3 ]    Y [ 587.3 ]       │
│                                  │
│ 缩放                              │
│ [ − ]        100 %        [ + ]  │
│                                  │
│ 旋转                              │
│ [ − ]          0°         [ + ]  │
│                                  │
│ [水平翻转]       [重置变换]       │
│                  [应用变换]       │
│                                  │
│ 外观                           ›  │
│ 图层                           ›  │
└──────────────────────────────────┘
```

The exact arrangement of secondary transform actions may wrap based on final width, but the hierarchy should remain unchanged.

## 3.1 Object identity summary

Immediately below the inspector heading:

- show thumbnail when available;
- show selected layer name;
- show a compact type label such as `角色`, `图片`, `音频`, or `背景`;
- avoid repeating verbose guidance text if the selected state is normal and editable.

Recommended height: **56–72 px**.

This identity summary is not a new owner. It is a presentation projection of the current selected layer + current Project snapshot.

## 3.2 Transform section — default open

`变换` is the primary working section and should be open by default.

Required control order:

1. Position — X / Y
2. Scale
3. Rotation
4. Flip / reset / apply actions

### Position

- X and Y remain the current authoritative center coordinates;
- landscape presentation may round display precision for readability only if the underlying draft/commit semantics remain unchanged;
- do not relabel center coordinates as top-left coordinates.

### Scale

- percentage presentation is preferred in compact UI;
- step buttons remain large enough for touch;
- existing min/max domain bounds remain authoritative.

### Rotation

- keep degree display;
- step controls may reuse the existing ±15° behavior;
- exact numeric input remains available.

### Actions

Recommended hierarchy:

- `应用变换` = primary filled action;
- `水平翻转` = secondary;
- `重置变换` = secondary;
- locked/background constraints continue to disable or protect actions according to existing behavior.

Do not create a new commit model. Existing blur/action/submit semantics remain the source of truth.

## 3.3 Appearance section — collapsed by default

`外观` is a secondary section.

Default state: collapsed.

When opened, show only controls that are actually relevant to the selected context.

Examples from current capabilities:

- object opacity;
- current-shot background management where applicable.

The implementation should avoid presenting impossible controls solely to keep every object type visually identical.

## 3.4 Layer section — collapsed by default

`图层` is a secondary section.

Default state: collapsed.

When opened, it may include the existing capabilities:

- up / down;
- front / back;
- lock / unlock;
- delete where permitted;
- protected-background explanation where applicable.

Destructive operations should remain visually separated from ordinary ordering controls.

## 3.5 Contextual filtering rule

The inspector should prefer **show relevant controls** over **show everything disabled**.

This is a presentation rule only. It does not authorize a new capability schema.

Implementation guidance:

- reuse existing layer/background state and existing component capability checks;
- hide a section/control only when its current support can be determined from existing authoritative state;
- if support cannot be safely inferred without new domain work, keep the existing section behavior rather than inventing a new capability system in this pass.

---

## 4. State transition contract

```text
Stage A  Collapsed
   │ tap Properties handle
   ▼
Stage B  Open / No Selection
   │ select editable object on Canvas
   ▼
Stage C  Open / Selected Object
   │ clear selection
   └──────────────────────────────► Stage B

Stage B or C
   │ close drawer / Escape
   ▼
Stage A
```

Additional rules:

- selecting another object in Stage C stays in Stage C and updates identity + controls in place;
- selecting a dialogue may continue to switch the single RightInspector into its existing dialogue mode; this proposal does not redefine dialogue ownership;
- orientation changes follow the adaptive shell owner; this document freezes only landscape presentation.

---

## 5. Scroll ownership

Landscape Properties MUST have one clear vertical scroll owner.

Recommended rule:

- drawer body owns vertical scrolling;
- individual `变换`, `外观`, and `图层` sections do not get their own vertical scrollbars;
- Canvas scrollbar remains independent and visually separate;
- opening long `外观` or `图层` content extends the drawer document flow rather than creating nested scroll wells.

Nested horizontal scrolling should not be introduced in the inspector.

---

## 6. Touch, focus, and keyboard requirements

- handle width: at least 52 px recommended at target viewport;
- primary button/control height: about 44–52 px minimum interaction target;
- section summaries must be fully clickable, not just the chevron;
- `Escape` closes the landscape drawer when appropriate;
- closing returns focus to the handle;
- opening moves focus to the drawer/heading area;
- selected/expanded/focus states must not rely on color alone;
- hidden handle while drawer is open must not retain keyboard focus;
- no hover-only affordances.

---

## 7. Visual language

The inspector should continue the existing Panda Stage dark-green visual world.

### Keep

- dark translucent surfaces;
- soft green accent;
- thin separators;
- rounded corners;
- restrained iconography;
- compact Chinese labels.

### Reduce

- giant bordered cards inside giant bordered cards;
- full-height rails for single actions;
- repeated instructional copy in every section;
- permanently visible low-frequency controls;
- disabled UI used as decoration.

### Hierarchy target

```text
Inspector heading
    ↓
Selected object identity
    ↓
Transform — open, primary work
    ↓
Appearance — collapsed, secondary
    ↓
Layer — collapsed, secondary
```

---

## 8. Current implementation mapping

The active PR #319 already contains useful building blocks that a future implementation can reuse instead of inventing new owners:

- `src/renderer/shell/RightInspector.tsx`
  - single inspector surface;
  - narrow/landscape drawer state;
  - rail handle;
  - focus return on close;
  - selected-layer identity summary;
  - transform / appearance / layer compact sections;
  - dialogue takeover of the same inspector surface.

- `src/renderer/features/properties/LayerTransformPanel.tsx`
  - compact X/Y, percentage scale, rotation steppers, flip/reset/apply;
  - existing draft and commit semantics.

- `src/renderer/features/properties/LayerBackgroundControl.tsx`
  - opacity and background management using existing owners.

- `src/renderer/features/properties/LayerOrderControls.tsx`
  - ordering, lock state, delete, and background protection.

The intended future implementation is therefore **a presentation refinement of the existing owner topology**, not a new property subsystem.

Because PR #319 is still Draft/Open/Unmerged, an implementation issue created from this design MUST first re-check the live branch/base and choose whether to stack on the active UI line or wait for its integration. It must not copy the same owners independently onto `main`.

---

## 9. Acceptance criteria

### Stage A — Collapsed

PASS when:

- Properties is represented by a compact right-edge handle, not a full-height rail;
- the handle is easy to hit on Redmi/Wuying Cloud Touch;
- Canvas scrollbar remains visually distinct;
- opening the inspector does not change selection or Project state;
- keyboard focus does not strand on a hidden handle.

### Stage B — Open / No Selection

PASS when:

- the drawer remains open with no selected object;
- only one clean empty state is shown;
- empty `变换 / 外观 / 图层` shells are not visible;
- copy clearly tells a beginner to select an object on Canvas;
- clearing selection from Stage C returns here without auto-closing.

### Stage C — Open / Selected Object

PASS when:

- selected object identity is immediately visible;
- Transform is open by default;
- X/Y, scale, rotation and existing transform actions remain functional with unchanged semantics;
- Appearance and Layer are secondary collapsed sections by default;
- protected/locked/background behavior remains correct;
- selecting another object updates the same inspector in place;
- no new Project/selection/history owner is introduced.

### Real-device acceptance

Final UX acceptance must be performed in the real target path:

- Windows Electron;
- Aliyun Wuying cloud desktop;
- Redmi K60 Ultra landscape streaming;
- reference target around 2712 × 1220;
- mouse and touch checks where available.

Automated/unit/headless checks may prove contracts, but they do not replace this human acceptance.

---

## 10. Stop-loss rules

Stop the implementation and re-scope if any of the following becomes necessary:

- changing Project schema;
- introducing a new inspector store or selection owner;
- changing transform coordinate meaning;
- changing History grouping semantics;
- changing background protection semantics;
- duplicating `RightInspector` because the active UI branch is unmerged;
- broad refactoring of unrelated shell/components;
- weakening an existing test/gate to make the visual change pass.

The correct fallback is to ship a smaller presentation-only refinement, not expand this stage into an inspector-system rewrite.

---

## 11. Recommended implementation split after design approval

This design can later be implemented as three small passes:

1. **A — Compact Edge Handle**
   - rail geometry, placement, open/close/focus behavior.

2. **B — Empty State Simplification**
   - single empty state, remove empty section shells, preserve drawer-open state.

3. **C — Selected Object Hierarchy**
   - identity summary, Transform-first hierarchy, Appearance/Layer progressive disclosure.

Each pass should keep the current owner topology and have its own focused acceptance evidence.

## 12. Design decision summary

Chosen direction: **Option A — Compact Edge Handle + Contextual Drawer**.

The final mental model is intentionally simple:

- **closed:** a small Properties handle;
- **open + nothing selected:** one calm instruction;
- **open + object selected:** identity first, transform second, details on demand.

That is the entire Stage A–C contract.
