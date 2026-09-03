# Panda Stage Project Launcher v1 — Visual Craft Pass Addendum

> Status: Maintainer-selected post-implementation visual refinement direction
>
> Date: 2026-09-03
>
> Parent baseline: `docs/design/project-launcher-v1-2026-09-03.md`
>
> Implementation evidence: Issue #410 / Draft PR #411
>
> Scope: presentation hierarchy, layout, typography, surface treatment, Launcher-specific visual identity
>
> This addendum refines the v1 visual craft after real Windows Electron review. It does not replace the parent product model and does not authorize Project/session/IPC/recovery/persistence redesign.

---

## 1. Why this addendum exists

Issue #410 successfully changed Project Center from a recovery/admin-style form into a coherent Project Launcher and preserved the existing project lifecycle boundaries.

Real Windows Electron review shows that the implementation has reached the correct **product skeleton**:

- current-project and no-project states are structurally distinct but belong to one Launcher family;
- `继续创作` is present for an open project;
- New/Open are direct launcher actions;
- manual path entry is demoted behind `更多打开方式`;
- Recent Projects is simplified;
- exception/recovery truth remains preserved.

The remaining gap is primarily visual craft rather than product architecture.

Current implementation reads as:

> correct launcher structure + engineering-first finishing

The target for the final v1 pass is:

> calm, authored, production-ready creative-tool launcher

The work below is therefore a **polish/refinement pass**, not a redesign.

---

## 2. Refinement law

The parent v1 product decisions remain authoritative.

This pass MUST preserve:

```text
current project exists
-> Continue Creating is the strongest task

no current project
-> New Project / Open Project / Recent Projects

exception or recovery exists
-> same Launcher shell + localized truthful recovery action
```

This pass MAY change:

- page-title hierarchy;
- visual scale and spacing;
- card/row surface treatment;
- local iconography;
- typography size/weight;
- launcher-specific decorative CSS;
- advanced-open presentation;
- visual grouping of existing truthful metadata.

This pass MUST NOT change project lifecycle semantics.

---

## 3. Visual priority order

The final refinement should be implemented and reviewed in this order:

```text
P1 — stable page identity
P1 — Hero / primary actions
P1 — Recent Projects launcher rows
P2 — Advanced Open presentation
P2 — typography / rhythm / restrained brand signature
```

Do not spend time on micro-decoration before the first three items are correct.

---

## 4. Stable page identity

### Current problem

The current implementation makes state copy such as:

```text
欢迎回来
```

or:

```text
开始创作
```

serve as the dominant page heading.

This makes the page identity visually change between Launcher states.

### Final direction

`项目` is the stable page title in every Launcher state.

Recommended hierarchy:

### Current project

```text
PANDA STAGE

项目
欢迎回来，继续你的创作
```

### No project

```text
PANDA STAGE

项目
开始创作，新建一个项目或继续最近的工作
```

### Exception / Recovery

```text
PANDA STAGE

项目
有一些内容需要你处理
```

The exact secondary sentence may adapt to actual state, but `项目` remains the stable `h1` / strongest page identity.

The state sentence is supporting context, not a second page identity.

### Acceptance

A user looking at any current/no-project/recovery screenshot should immediately recognize all three as states of the same `项目` surface.

---

## 5. Current Project Hero — make the current task visibly primary

The current-project card is structurally correct but visually too close to an emphasized list row.

The final card should behave as the Launcher hero.

### Recommended composition

```text
┌──────────────────────────────────────────────────────────────┐
│ 当前项目                                                     │
│                                                              │
│ Panda Stage MVP Project v1 Example                          │
│ [已保存]                                                     │
│ D:\...\story.pandastage                                    │
│                                           [ 继续创作  → ]    │
└──────────────────────────────────────────────────────────────┘
```

### Visual rules

- target visual height: approximately `150–170px` on the reference landscape size;
- project name is the dominant content inside the card;
- `已保存` / `有未保存更改` should read as compact status treatment, not plain text competing with the name;
- project path is real but tertiary: muted, truncated, tooltip/title allowed;
- `继续创作` should be wider and visibly more deliberate than an ordinary form button;
- a subtle right-side green radial/gradient emphasis is allowed to create a visual destination for the CTA;
- hover/focus may increase brightness slightly but should remain restrained.

### Avoid

- large raw path blocks;
- multiple status sentences explaining that the project is still open;
- dramatic neon glow;
- treating New/Open as equal to Continue when a current project exists.

---

## 6. No-project action region — replace toolbar buttons with Launcher actions

### Current problem

The production skeleton currently expresses:

```text
[ + 新建项目 ] [ 打开项目 ]
```

as compact utility buttons.

This is functionally correct but visually reads like a toolbar rather than a start decision.

### Final direction

Promote New/Open into two wide launcher action tiles/cards.

Recommended composition:

```text
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ +                            │  │ folder / open glyph          │
│ 新建项目                     │  │ 打开项目                     │
│ 从一个空白项目开始           │  │ 打开已有 Panda Stage 项目    │
└──────────────────────────────┘  └──────────────────────────────┘
```

### Hierarchy

For no-project state:

```text
新建项目 = strongest start action
打开项目 = strong secondary action
```

For current-project state, both remain secondary to `继续创作`.

### Interaction truth

Presentation may change, but callbacks remain exactly the existing:

```text
新建项目 -> existing New Project dialog/flow
打开项目 -> existing native chooser/open flow
```

No new route or business layer is authorized.

---

## 7. No-project welcome Hero — make it real or remove it

The current lightweight welcome block is useful structurally but should not remain in a half-Hero state.

Preferred v1 direction: keep it, but make it a real, restrained opening surface.

Suggested content hierarchy:

```text
从这里开始
建立你的下一段故事
<one short supporting sentence>
```

Allowed decorative treatment:

- subtle local CSS radial gradients;
- very low-contrast circles / Panda-green geometric pattern;
- existing local asset only if already appropriate.

Do not introduce:

- remote image dependency;
- new illustration infrastructure;
- fake project data;
- large mascot art that competes with the start actions.

If an appropriate local visual cannot be achieved cheaply and truthfully, omit decoration rather than add infrastructure.

---

## 8. Recent Projects — evolve from divider list to soft Launcher rows

### Current problem

The current Launcher presentation successfully removed maintenance noise, but the visual result is mainly:

```text
text
horizontal divider
button
```

This can read as an engineering list rather than a finished project launcher.

### Final direction

Use **soft rows**: more authored than a bare table, lighter than large card-per-project UI.

Recommended available row:

```text
┌──────────────────────────────────────────────────────────────┐
│ ◇  Panda Stage MVP Project v1 Example                      │
│    D:\Panda...\story.pandastage        今天 13:02          │
│                                            [打开]      ···   │
└──────────────────────────────────────────────────────────────┘
```

### Required visual hierarchy

1. project glyph + project name;
2. muted real project path and/or time;
3. one primary row action;
4. maintenance `···`.

### Project glyph

A consistent local abstract project glyph is allowed and encouraged.

It is not a thumbnail and must not imply generated project preview data.

Examples of suitable visual families:

```text
◇
▱
▣
```

or a small existing Panda Stage line icon with consistent stroke weight.

### Path

For available rows, a real truncated path may be shown as tertiary identification information.

This refines the initial v1 distillation rule: path should no longer dominate, but it is useful when users have projects with similar names.

### Hover / focus

Pointer hover may use:

- very subtle green surface lift;
- slightly brighter border;
- no layout movement.

The primary action must remain touch-visible; hover is bonus only.

---

## 9. Recent-project exception rows

Exceptions remain localized and calm.

### Missing

```text
◇ 测试工程 A
  找不到项目 · 9月1日
                               [重新定位]  ···
```

### Mismatched

```text
◇ 沙雕动画练习
  项目身份不匹配 · 8月31日
                               [重新定位]  ···
```

### Invalid

```text
◇ 旧版导入实验
  项目文件无效
                                            ···
```

Use a restrained warm warning accent.

Do not turn the row or page into a red failure surface.

Do not expose actions the authoritative business state does not support.

---

## 10. Advanced Open — preserve capability, visually demote it further

### Current problem

The existing `更多打开方式` correctly hides manual path entry by default, but when expanded it returns to a wide engineering-form composition.

### Final direction

Keep the capability but present it as a compact secondary panel.

Suggested composition:

```text
更多打开方式 ▾

┌────────────────────────────────────────────────────────┐
│ 通过项目路径打开                                       │
│                                                        │
│ [ D:\...\project.pandastage                     ]    │
│                                      [选择] [打开]     │
└────────────────────────────────────────────────────────┘
```

### Visual rules

- clearly tertiary relative to the normal Open Project chooser;
- panel should not visually span the entire Launcher without need;
- approximate desktop `max-width: 640–720px` is a reasonable starting point;
- keep validation/help copy close to the input;
- keep existing manual path semantics and tests intact.

This is an advanced route, not the visual center of the page.

---

## 11. Typography floor

Real Windows / Wuying / Cloud Touch screenshots show that excessive `11px–12px` supporting text becomes visually weak after display scaling and remote-stream compression.

Recommended visual scale for this surface:

```text
Page title:       34–40px
Hero title:       20–24px
Section title:    18–20px
Normal body:      14–15px
Secondary text:   13–14px
Tiny kicker:      11–12px only for labels such as PANDA STAGE / eyebrow
```

The exact implementation should continue to use the existing token system where practical.

Rule:

> `12px` must not become the default size for ordinary explanatory content.

Test the result at real Windows Electron scale and through the Cloud Touch usage path where practical.

---

## 12. Layout width and rhythm

The Launcher should read as one deliberate vertical composition.

Recommended desktop content width:

```text
approximately 1100–1200px max-width
```

Use this as a visual starting point rather than a hard pixel contract.

Target rhythm:

```text
Page identity
↓ generous gap
Hero / welcome
↓ clear task gap
Launcher actions
↓ clear section gap
Recent Projects
```

Avoid:

- very wide content with all visual weight parked on the left;
- unrelated one-off margins;
- excessive empty vertical acreage;
- multiple nested full-width border boxes.

The whole surface should share one optical grid.

---

## 13. Restrained Panda Stage brand signature

The final Launcher should feel authored for Panda Stage rather than category-interchangeable.

Allowed brand signature elements:

- very subtle Panda-green radial lighting in the Hero/background;
- one consistent Launcher project glyph;
- unified arrow/icon stroke language for primary actions;
- low-contrast geometric/circular background detail;
- precise use of the existing Panda-green token hierarchy.

Brand presence must remain secondary to task completion.

Do not add:

- repeated panda mascots;
- giant decorative logo;
- particle effects;
- unrelated illustration system;
- new external fonts/assets solely for this pass.

The intended effect is:

> quietly recognizable when present; noticeably generic if removed.

---

## 14. Refined state compositions

### 14.1 Current project

```text
PANDA STAGE
项目
欢迎回来，继续你的创作

[ Current Project Hero                                   ]
[ name / save state / quiet path           继续创作 -> ]

[ + 新建项目 ]   [ 打开项目 ]

最近项目
[ soft project row                                  ]
[ soft project row                                  ]
```

### 14.2 No project

```text
PANDA STAGE
项目
开始创作，新建一个项目或继续最近的工作

[ restrained welcome Hero                            ]

[ New Project action tile ] [ Open Project action tile ]

更多打开方式  (tertiary / collapsed)

最近项目
[ soft project row                                  ]
```

### 14.3 Exception / Recovery

The normal Launcher skeleton remains present.

```text
PANDA STAGE
项目

[ localized Recovery notice ]
  检测到未保存的恢复内容
  [恢复] [忽略]  查看详情

[ normal Launcher actions / current-project context ]

最近项目
[ available row ]
[ missing row      -> 重新定位 ]
[ mismatched row   -> 重新定位 ]
[ invalid row      -> no fake Open ]
```

No standalone Error Center is introduced.

---

## 15. Visual craft acceptance checklist

The Visual Craft Pass is accepted only if all of the following are true on real Windows Electron screenshots.

### Shared

- [ ] `项目` is the stable strongest page title across current/no-project/recovery states.
- [ ] the page reads as one Launcher family rather than three unrelated surfaces.
- [ ] text remains legible at real Windows / Cloud Touch usage scale.
- [ ] content width and spacing feel intentional rather than stretched/empty.
- [ ] primary/secondary/tertiary actions are visually distinguishable without explanation.
- [ ] no fake metadata, preview, thumbnail, analytics, or unsupported route is introduced.

### Current project

- [ ] Current Project Hero clearly owns the page after the stable title.
- [ ] `继续创作` reads as the strongest action.
- [ ] project name is easy to scan.
- [ ] save state is truthful and calm.
- [ ] path is useful but visually quiet.

### No project

- [ ] New/Open read as genuine start actions rather than toolbar utilities.
- [ ] New Project has the strongest no-project emphasis.
- [ ] welcome Hero feels intentional or is omitted; no half-finished decorative block.
- [ ] manual path entry remains collapsed/tertiary by default.

### Recent Projects

- [ ] rows read as Launcher objects rather than bare table lines.
- [ ] available rows remain low-noise.
- [ ] exception rows are clear without turning the page into an alarm surface.
- [ ] `···` remains touch-safe and secondary.
- [ ] long names/paths truncate without hiding identity.

### Recovery

- [ ] recovery is noticeable when present but does not redefine the whole page visually.
- [ ] Restore/Ignore/details remain truthful and usable.

---

## 16. Engineering boundaries remain frozen

This visual addendum does not authorize any change to:

- Project schema or migration;
- Project ID semantics;
- `EditorShell` session/controller ownership;
- `session.switchProject` behavior;
- clone/collision protection;
- recent-project identity validation;
- RecentProjectsService disk semantics;
- recovery detection/restore/ignore/cleanup;
- autosave scheduling;
- Main persistence;
- Preload/IPC security boundaries;
- Renderer filesystem access;
- current dirty/save truth;
- native chooser ownership.

Do not create a second Project controller/store for presentation convenience.

Do not copy visual-only concept details into product truth.

---

## 17. Implementation strategy

Apply this addendum as **one bounded Visual Craft Pass** on the existing Project Launcher implementation line.

Recommended batch:

```text
1. stable page-title hierarchy
2. Current Hero / Continue CTA
3. No-project action tiles / welcome Hero
4. Recent Projects soft rows + exception treatment
5. Advanced Open compact panel
6. typography / width / spacing / brand finishing
```

Then capture the representative states together:

```text
Current Project
No Project
Exception / Recovery
```

Review them as one family.

If defects are found, perform one consolidated correction pass and one confirmation capture.

Do not enter open-ended pixel iteration.

The finishing rule is:

> complete one coherent pass, inspect all shipped states together, fix the batch, confirm once, then stop polishing.

---

## 18. Stop gates

STOP and report if visual polish would require:

- new Project lifecycle state;
- new project metadata contract solely to fill UI;
- fake project thumbnails;
- a new Main/Preload IPC surface;
- Renderer direct filesystem access;
- recovery/autosave redesign;
- recent-project semantic changes;
- a second Project Launcher implementation PR without maintainer direction;
- global editor-style rewrites unrelated to Launcher;
- a separate Project Launcher v2 feature disguised as polish.

---

## 19. Final product target

Project Launcher v1 should finish as:

> a calm, task-first, visually authored entry surface that immediately helps a creator continue or begin work, while keeping all project safety/lifecycle complexity underneath rather than making that complexity the visual identity of the page.

The parent v1 design defines the product structure.

This addendum defines the finishing craft required before final maintainer HUMAN PASS.
