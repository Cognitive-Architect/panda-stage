# Subtitle Editing Visual Convergence

> Design-only reference for Panda Stage subtitle editing surfaces after PR #377 Stage A-E implementation.
>
> Status: design freeze / implementation source.
>
> Production code is intentionally unchanged by this document.

![Subtitle Editing Visual Convergence](./assets/subtitle-editing-visual-convergence.jpg)

## 1. Why this design exists

PR #377 completed the landscape Timeline workspace redesign program and established a coherent Task Tray model:

```text
Stage A — resizable Bottom Workspace
Stage B — Timeline shell / track stack
Stage C — compact Pending Subtitle Tray
Stage D — Pending drag-to-place
Stage E — unified Task Tray states / hardening
```

The Stage E real-device acceptance confirmed the core interaction contract:

```text
replacement, not stacking
```

Pending, Untimed selection, Timed editing, Single Add, Batch Paste, and Empty now behave as one Task Tray that changes state instead of stacking worksheets.

The remaining problem is visual rather than architectural: three subtitle-editing surfaces still present the same underlying domain with noticeably different control styling, spacing, hierarchy, and density.

The three target surfaces are:

1. **Timed subtitle detail in the landscape Task Tray**
2. **Single Add / Batch Paste subtitle authoring**
3. **Landscape right-side subtitle Properties / Inspector**

The goal of this design is to converge those surfaces into one recognizable subtitle-editing visual language without changing business semantics.

---

## 2. Design thesis

The three surfaces should feel like variants of the same editing system:

```text
Timed Detail
= primary / spacious subtitle editor

Authoring
= creation-focused variant of the same visual grammar

Right Properties
= compact quick-inspect / quick-edit variant
```

They should share:

- the same field styling;
- the same spacing rhythm;
- the same status chips;
- the same label hierarchy;
- the same timing presentation;
- the same action hierarchy;
- the same semantic danger treatment;
- the same Panda Stage dark emerald visual language.

They should **not** become three independently styled forms.

---

## 3. Shared subtitle editing grammar

All three surfaces should follow the same conceptual order:

```text
1. Identity / Context
2. Main Content
3. Timing / Placement
4. Secondary Metadata
5. Actions
```

### 3.1 Identity / Context

Examples:

```text
已安排字幕 · Panda · 已定时
新建字幕 · 单条
新建字幕 · 批量粘贴
字幕属性 · Panda · 已定时
```

Context should be visible quickly but not dominate the workspace.

### 3.2 Main Content

The dialogue line is the primary editable content.

The textarea/input should therefore receive more visual weight than speaker or audio metadata.

### 3.3 Timing / Placement

For Timed subtitles, timing is a first-class editing concept:

```text
开始
结束
持续
```

For new Untimed subtitles, placement context is presented instead:

```text
当前播放头
将创建为未定时字幕
```

### 3.4 Secondary Metadata

Speaker and audio status remain useful, but should not compete visually with dialogue text and timing.

### 3.5 Actions

Actions should follow semantic priority:

```text
destructive        secondary        primary
删除字幕            取消 / 返回       新增 / 应用 / 保存
```

---

## 4. Visual system

### 4.1 Surfaces

Use layered dark surfaces rather than raw white form controls.

Preferred hierarchy:

```text
app background
-> workspace surface
-> grouped field/card surface
-> active input surface
```

Borders should remain subtle and consistent with the existing Panda Stage dark-green language.

### 4.2 Inputs

Avoid native-looking bright white inputs in landscape subtitle editing.

Inputs should use:

- dark fill;
- restrained green focus treatment;
- shared radius;
- consistent padding;
- readable muted placeholders;
- clear but non-glowing focus state.

### 4.3 Green accent

Green indicates:

- selected/current state;
- primary action;
- active tab;
- successful / established status such as `已定时`.

Do not paint every enabled control green.

### 4.4 Red / danger

`删除字幕` remains visibly destructive but low-frequency.

It should not compete with the main editing action.

### 4.5 Spacing

Prefer a small number of meaningful groups rather than many loose labels scattered across a large black area.

The design should reduce the “admin form floating in empty space” feeling currently visible at large Bottom Workspace heights.

---

# 5. Surface A — Timed Subtitle Detail

## 5.1 Role

This is the **primary precision-editing surface** after a Timed subtitle is selected on the Timeline.

It should remain inside the Stage E Task Tray replacement model.

## 5.2 Target hierarchy

Header:

```text
← 返回待安排字幕
已安排字幕
Panda
[已定时]
```

Body:

```text
left / primary                  right / timing

台词                            时间
[dialogue textarea]             开始 00:00.167
                                结束 00:00.459
角色                            持续 00:00.292
[Panda ▾]                       [应用时间]

音频
未绑定音频
```

Footer:

```text
[删除字幕]                            [保存并返回 / existing action]
```

Exact action copy must follow existing production capabilities; the concept image is not permission to invent new business behavior.

## 5.3 Design decisions

- Give dialogue copy the largest editable region.
- Group start/end/duration in one compact Timing card.
- Keep speaker below the primary content rather than visually competing with it.
- Reduce unbound audio to a secondary status row.
- Keep destructive action separated from primary editing actions.
- Preserve internal scrolling at shallow workspace heights.
- Use extra vertical height to reveal more content, not to stretch controls.

## 5.4 Explicit non-goal

Do not add new frame-step timing features merely because a concept mockup could visually accommodate them.

Existing Timeline drag/resize and existing timing mutation remain authoritative.

---

# 6. Surface B — Subtitle Authoring Shell

## 6.1 Role

This surface owns subtitle creation in Stage E Task Tray authoring states.

The shell remains one workspace with two mutually exclusive modes:

```text
[单条] [批量粘贴]
```

## 6.2 Single Add target

Header:

```text
字幕任务
新建字幕
创建新的未定时字幕或批量导入。
                                          ×
```

Body:

```text
[单条] [批量粘贴]

台词内容                        创建位置
[textarea]                      当前播放头
                                00:00.000
角色（说话人）                  将创建为
[Panda ▾]                       未定时字幕
```

Supporting hint:

```text
普通 Enter 换行，Ctrl/Cmd + Enter 提交
```

Footer:

```text
                                  [取消] [新增字幕]
```

## 6.3 Batch Paste target

Batch Paste should use the same shell, same tabs, same button language, and same spacing system.

Only the body changes.

Recommended body hierarchy:

```text
批量文本
[multiline input]

解析 / 统计 / unknown speaker feedback

                                  [取消] [提交 existing action]
```

## 6.4 Design decisions

- Do not present Single Add and Batch Paste as two unrelated pages.
- Keep the active tab obvious but restrained.
- Keep authoring fields dark and product-native.
- Keep long pasted content inside one clear internal scroll owner.
- Keep the footer actions visually stable and reachable.
- Preserve existing authoring draft, validation, and mutation semantics.

---

# 7. Surface C — Landscape Subtitle Properties

## 7.1 Role

The right-side subtitle inspector is a **secondary quick-inspect / quick-edit route**.

It should be a compact variant of Surface A, not a separate design system.

## 7.2 Target hierarchy

```text
字幕属性                                      ×

Panda                                      [已定时]
Day28未定时测试01

台词
[compact textarea]

时间
开始 00:00.167
结束 00:00.459
持续 00:00.292
[应用时间]

角色（说话人）
[Panda ▾]

音频
未绑定音频

[删除字幕]
```

## 7.3 Design decisions

- Preserve narrow-sidebar density.
- Prioritize scanning and small adjustments.
- Avoid turning the inspector into a full duplicated worksheet.
- Keep the Timed Task Tray as the primary spacious editor.
- Use the same field, timing, status, and danger vocabulary as Surface A.
- Keep selected Timeline clip state visually linked to the inspector context.

---

# 8. Relationship between Task Tray and Properties

The two Timed subtitle editing routes should share one business truth while serving different spatial roles:

```text
Task Tray Timed Detail
-> primary, spacious, focused editing

Right Properties
-> compact, secondary, contextual editing
```

They must not introduce:

- a second selected dialogue owner;
- a second Timed subtitle draft;
- a second timing mutation path;
- a second copy of dialogue business state.

Presentation may differ; ownership must not.

---

# 9. Architecture boundaries

This proposal is presentation-only.

Preserve the existing authoritative owners established by the Timeline/Dialogue work, including the current equivalents of:

```text
DialogueSheet
DialogueInspector
dialogueSelectionStore
DialogueAuthoringDraft
DialogueBatchPaste
TimelineDock
Timeline time geometry
shotStore
EditorProjectStore
```

Prefer existing UI primitives/tokens where available rather than creating parallel subtitle-only component systems.

The design should reuse or converge around existing primitives such as field wrappers, buttons, tabs, tokens, spacing, radius, and status treatments.

---

# 10. Mutation boundaries

Pure visual polish must not change Project/History semantics.

Examples that remain presentation-only:

```text
field layout
card grouping
input styling
status chip styling
action placement
section hierarchy
internal scroll behavior
compact vs spacious presentation
```

Existing actions remain authoritative for:

```text
edit dialogue text
apply timing
change speaker
add subtitle
batch add subtitles
delete subtitle
```

No new Project schema, autosave, IPC, Main, or Preload behavior is authorized by this design.

---

# 11. Recommended implementation sequence

Implement as three separately reviewable polish stages after the design is accepted:

## Stage A — Timed Subtitle Task Tray Polish

Use Surface A as the visual mother template.

Goals:

- dark field system;
- dialogue/timing hierarchy;
- compact timing card;
- speaker/audio secondary hierarchy;
- action footer cleanup;
- shallow/medium/large height behavior.

## Stage B — Subtitle Authoring Shell Polish

Apply the same visual grammar to:

```text
Single Add
Batch Paste
```

Preserve current authoring truth and validation.

## Stage C — Landscape Subtitle Properties Polish

Compress the Surface A grammar into the right-side inspector.

Keep Properties a secondary route.

---

# 12. Acceptance direction

## Shared visual acceptance

- [ ] All three surfaces clearly belong to one subtitle editing system.
- [ ] No raw white/native-looking form-control island remains in the landscape target.
- [ ] Dialogue text and timing have stronger hierarchy than secondary metadata.
- [ ] Status chips, labels, inputs, buttons, and danger actions use one consistent language.
- [ ] No unnecessary giant empty black area dominates the Task Tray at large height.
- [ ] Controls remain readable and touchable in Cloud Touch landscape.

## Functional regression

- [ ] Stage E replacement-not-stacking remains intact.
- [ ] Pending / Untimed / Timed / Single / Batch / Empty state transitions remain intact.
- [ ] Stage D drag-to-place remains intact.
- [ ] Timed clip move/resize remains intact.
- [ ] Shot switching does not reintroduce stale selection state.
- [ ] Bottom Workspace resize/collapse remains intact.
- [ ] Project/History semantics remain unchanged.

## Human target

Primary visual acceptance target:

```text
Windows Electron
-> Aliyun Wuying
-> Redmi K60 Ultra
-> Cloud Touch landscape
-> approximately 2712 x 1220
```

Automated evidence supports regressions but does not replace visual human acceptance for this polish program.

---

# 13. Explicit non-goals

This design does **not** authorize:

- new subtitle business features;
- frame-step controls unless separately specified;
- smart scheduling;
- Timeline time-geometry rewrite;
- new drag-to-place semantics;
- Timed clip move/resize rewrite;
- new dialogue selection owner;
- new authoring draft owner;
- new subtitle data model;
- Project/schema changes;
- IPC/Main/Preload changes;
- portrait redesign;
- unrelated Timeline or Canvas redesign.

Stop and report if visual implementation appears to require any of those changes.

---

# 14. Design source and context

This design was created after real-device Stage E acceptance of the PR #377 Timeline redesign program.

Relevant context:

```text
PR #319 — cumulative adaptive UI implementation line
PR #350 — portrait Timeline six-state direction
PR #358 — previous portrait-oriented Properties dialogue inspector polish
PR #370 — landscape contextual Properties inspector design
PR #377 — landscape Timeline workspace redesign A-E
Issue #382 — Stage E unified Task Tray implementation / acceptance
```

Important landscape observation:

The earlier subtitle Properties polish primarily targeted portrait presentation. The Cloud Touch landscape subtitle inspector still has a distinct presentation path and therefore requires its own visual convergence pass.

---

# 15. Core rule

> **Three entry points, one subtitle editing language.**
>
> Improve presentation without creating new business truth.
