# Panda Stage Project Launcher v1

> Status: Maintainer-selected design direction
>
> Date: 2026-09-03
>
> Scope: Project Center / Start Screen presentation and interaction hierarchy only
>
> Implementation authority remains in existing project lifecycle code. This document does not authorize Project schema, IPC, persistence, recovery, autosave, or session-controller redesign.

---

## 1. Why this redesign exists

Panda Stage already has working project lifecycle capability: create, open, recent projects, project switching, recovery, dirty state, and return-to-editor behavior.

The current Project Center exposes those capabilities as a recovery/admin-style form surface. The problem is not missing functionality. The problem is that the page does not behave like a creative-tool launcher.

The current experience gives similar visual weight to:

- current-project state;
- return to editor;
- raw project path entry;
- Browse;
- Open Project;
- New Project;
- recent projects;
- maintenance/safety copy.

This creates a high-friction first impression and makes the user read the page before knowing what to do.

Project Launcher v1 changes the product hierarchy without changing project truth.

---

## 2. Job and audience

### User

A beginner or individual creator opening Panda Stage on Windows, or temporarily leaving the editor to enter Project Center.

### Surface mode

Operate.

The user is not here to inspect project metadata. They are here to resume or begin creative work.

### Primary job

The page must answer, immediately:

```text
What should I do next?
```

The answer depends on current state:

```text
current project exists
-> Continue creating

no current project
-> Open a recent project, create a new project, or open another project
```

---

## 3. Maintainer-selected product decisions

The following decisions are frozen for v1.

### Decision A — Continue Creating is primary when a project is open

If `currentProject` exists, the strongest action on the page is:

```text
继续创作
```

This replaces the current low-emphasis framing of `返回编辑器` as a generic utility action.

Semantics remain identical: it returns to the already-open editor session. It must not reopen, reload, or recreate the project.

### Decision B — Raw project-path input is demoted

The default launcher must not expose a full raw-path text field as a primary control.

Normal flow:

```text
打开项目
-> native/system directory chooser
-> existing project-open validation/session flow
```

Manual path entry may remain available as an advanced/secondary path if preserving it is required by existing workflows or tests, but it must not dominate the first viewport.

### Decision C — Recent Projects becomes a clean launcher list

Recent projects should prioritize:

- project name;
- last-opened time;
- current availability/status only when meaningful;
- one obvious primary action.

Maintenance actions such as remove-record and relocation belong in contextual or secondary controls.

---

## 4. Core structural thesis

Project Center should become a **creative launcher**, not a project-management dashboard.

The page should visually read in this order:

```text
1. Panda Stage / Project Launcher identity
2. Current project / Continue Creating (when present)
3. New Project + Open Project
4. Recent Projects
5. Recovery or exceptional state only when needed
```

The layout should intentionally remove the current impression of:

```text
large form
inside large form
plus maintenance list
```

---

## 5. Recommended landscape composition

### State A — Current project exists

```text
┌──────────────────────────────────────────────────────────────┐
│ PANDA STAGE                                                  │
│ 项目                                                         │
│                                                              │
│  欢迎回来                                                    │
│  继续你的创作                                                │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 当前项目                                               │  │
│  │ Panda Stage MVP Project v1 Example                    │  │
│  │ 已保存 / 有未保存更改                                 │  │
│  │                                      [ 继续创作 ]      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  [ + 新建项目 ]     [ 打开项目 ]                            │
│                                                              │
│  最近项目                                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Project A                         昨天 22:41   [打开] ···│ │
│  ├────────────────────────────────────────────────────────┤  │
│  │ Project B                         8月29日      [打开] ···│ │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### State B — No current project

```text
┌──────────────────────────────────────────────────────────────┐
│ PANDA STAGE                                                  │
│ 项目                                                         │
│                                                              │
│  开始创作                                                    │
│  新建一个项目，或继续最近的工作                              │
│                                                              │
│  [ + 新建项目 ]     [ 打开项目 ]                            │
│                                                              │
│  最近项目                                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Project A                         昨天 22:41   [打开] ···│ │
│  ├────────────────────────────────────────────────────────┤  │
│  │ Project B                         8月29日      [打开] ···│ │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

These diagrams describe hierarchy, not pixel dimensions.

---

## 6. Primary actions

### 6.1 Continue Creating

Visible only when `currentProject` exists.

User-facing label:

```text
继续创作
```

This is the strongest action on the page.

It must call the existing return-to-editor callback and must not mutate project state.

### 6.2 New Project

User-facing label:

```text
新建项目
```

This remains a first-class launcher action and opens the existing New Project flow/dialog.

The launcher redesign does not authorize changing creation semantics, validation, default resolution/FPS, or overwrite handling.

### 6.3 Open Project

User-facing label:

```text
打开项目
```

Default behavior should open the existing native/system directory chooser.

The current path-validation and project-open flow must remain authoritative after selection.

### 6.4 Manual path entry

Manual path entry is not part of the v1 primary hierarchy.

If retained, it should live behind a secondary entry such as:

```text
更多打开方式
```

or inside an Open Project sub-surface.

Do not remove this capability if an existing accepted workflow, test contract, or accessibility requirement still depends on it without an explicit implementation decision.

---

## 7. Current-project card

When a project is already open, the current-project card is a compact launch card, not a project metadata panel.

### Required content

- project name;
- save state: `已保存` or `有未保存更改`;
- `继续创作` primary action.

### Optional secondary content

- truncated project path, only if useful and visually quiet;
- path may be exposed via tooltip/title or secondary details rather than full-width code text.

### Remove from primary hierarchy

Avoid treating these as headline content:

- full raw filesystem path;
- static explanatory sentence saying the project remains open;
- duplicated status labels.

The project being open is already communicated by the card and Continue Creating action.

---

## 8. Recent Projects model

The current RecentProjectsService truth must be preserved.

Supported states remain:

```text
available
missing
mismatched
invalid
```

The launcher must not flatten these states into fake availability.

### 8.1 Available project

Primary row content:

```text
Project Name
last opened time
[打开]
[···]
```

Do not show a permanent `可用` label unless visual testing proves it materially improves comprehension. Normal availability should be quiet.

### 8.2 Missing project

Primary row content:

```text
Project Name
找不到项目
[重新定位]
[···]
```

The exceptional state should be visible because action changes.

### 8.3 Mismatched project

Primary row content:

```text
Project Name
项目身份不匹配
[重新定位]
[···]
```

Do not allow normal Open if existing identity validation says the record is not authoritative.

### 8.4 Invalid project

Primary row content:

```text
Project Name
项目文件无效
[···]
```

Only expose actions that current business logic actually supports.

### 8.5 Maintenance menu

`···` owns low-frequency maintenance actions such as:

```text
从最近项目移除
```

The safety truth remains:

> Removing a recent-project record does not delete the project from disk.

But this explanation should appear contextually in the maintenance menu or confirmation copy, not as a permanent banner consuming launcher space.

---

## 9. Empty recent-project state

If no recent projects exist, do not render an empty bordered list.

Preferred copy:

```text
还没有最近项目
新建或打开项目后，会显示在这里。
```

The primary New/Open actions above remain the obvious route forward.

No illustration is required for v1.

---

## 10. Recovery state

Recovery is exceptional and important, but it must not define the visual identity of the entire Project Launcher.

If a recovery candidate exists, preserve the existing authoritative recovery actions:

```text
检测到未保存的恢复内容
[恢复]
[忽略]
[查看详情]
```

Recommended placement:

```text
Launcher identity
-> Recovery notice
-> Current project / primary actions
-> Recent projects
```

or immediately adjacent to the affected project context if implementation can do so without business-layer redesign.

The launcher redesign does not authorize changing recovery detection, restore, ignore, cleanup, autosave, or recovery-file semantics.

---

## 11. Status and feedback

The current page uses broad persistent status outputs for operations.

V1 should reduce passive status noise while preserving actionable feedback.

Guideline:

- loading/busy state: show local feedback on the relevant row/action;
- open/create failure: show the error near the action or launcher section that caused it;
- successful navigation/open does not require a persistent success sentence if the resulting screen already proves success;
- recent-project maintenance feedback may remain local to Recent Projects.

Do not hide genuine errors merely to make the page visually quieter.

---

## 12. Visual direction

### Preserve

Use the current Panda Stage design world:

- dark charcoal / deep green surfaces;
- restrained Panda-green actions;
- existing typography family;
- existing radius and border token system;
- touch-safe control sizes;
- high-contrast primary text and quiet secondary text.

Do not introduce a separate startup-theme universe.

### Change

The new launcher should feel more spacious and intentional than the current recovery-form composition.

Prefer:

- one stable page canvas rather than multiple large nested bordered boxes;
- stronger headline hierarchy;
- one focal current-project/hero region;
- clean horizontal action grouping;
- recent-project rows with generous spacing;
- separators or low-contrast grouping instead of cards around every sentence;
- restrained borders.

### Avoid

- dashboard KPI styling;
- oversized path/code blocks;
- glassmorphism for its own sake;
- huge decorative gradients;
- fake project thumbnails;
- generic template-gallery look;
- visible maintenance instructions when no maintenance is happening;
- green buttons everywhere with equal weight.

---

## 13. Interaction hierarchy

### Current project exists

Priority order:

```text
1. Continue Creating
2. New Project / Open Project
3. Open another recent project
4. Recent-project maintenance
5. Manual path entry
```

### No current project

Priority order:

```text
1. New Project / Open Project
2. Open recent project
3. Recent-project maintenance
4. Manual path entry
```

The exact relative visual strength of New vs Open may remain balanced in v1. Neither should visually compete with Continue Creating when a current project exists.

---

## 14. Navigation-state unification

`ProjectCenterScreen` and `StartScreen` should present the same launcher family.

V1 should avoid maintaining two unrelated visual systems for:

```text
cold start
vs
project already open -> Project Center
```

They are two states of the same surface.

This does not require deleting existing component boundaries. Implementation may preserve `ProjectCenterScreen -> StartScreen` composition and converge presentation through shared components/classes.

---

## 15. Responsive / Cloud Touch rules

Primary target remains Windows Electron landscape, including Aliyun Wuying / mobile Cloud Touch usage.

### Required

- primary buttons remain at least current touch-safe target sizes;
- `···` maintenance control is touch-safe;
- project rows do not rely on hover-only affordances;
- text truncation never hides the project name entirely;
- recent-project list owns bounded vertical scrolling when content exceeds the viewport;
- root page should not create accidental nested full-page scrolling conflicts with the Editor Shell rules.

### Narrow landscape behavior

When width is constrained:

- current-project card may stack its action below or beside metadata;
- New/Open actions may remain side by side when safe, otherwise stack;
- recent-project action cluster may collapse to one primary action + `···`.

Do not create a separate mobile product architecture in this issue.

---

## 16. Product truth / engineering boundaries

The redesign is intentionally presentation-first.

### MUST preserve

- `EditorShell` remains the single project-session/controller owner;
- existing project open/switch callbacks remain authoritative;
- project clone/collision validation remains authoritative;
- recent-project identity validation remains authoritative;
- current `available / missing / mismatched / invalid` truth remains authoritative;
- recovery candidate detection/restore/ignore remains authoritative;
- dirty/save state remains authoritative;
- New Project dialog/business flow remains authoritative;
- Renderer must not gain direct filesystem access;
- existing Preload/Main IPC boundaries remain unchanged unless a separate issue explicitly authorizes change.

### MUST NOT silently introduce

- a second project session controller;
- direct filesystem operations in the launcher;
- auto-opening the most recent project without user intent;
- deletion of disk projects from Recent Projects maintenance;
- fake project thumbnails/previews;
- project metadata not currently available from authoritative state;
- bypasses around recovery, clone identity, dirty-state, or switching protection.

---

## 17. Recommended component direction

This is guidance, not a mandatory file map.

Potential presentation decomposition:

```text
ProjectLauncher
├─ ProjectLauncherHeader
├─ CurrentProjectHero          [currentProject only]
├─ ProjectLauncherActions      [New / Open]
├─ RecoveryCandidateNotice     [conditional]
└─ RecentProjectsPanel         [launcher presentation]
```

Existing business components may be adapted instead of replaced if they can satisfy the hierarchy cleanly.

`RecentProjectsPanel` already supports a compact presentation and contextual maintenance menu; implementation should reuse that logic where possible rather than creating a second recent-project business component.

---

## 18. Acceptance states

A high-fidelity blueprint and later implementation must cover at least:

### P1 — Current project / saved

```text
currentProject != null
currentProject.dirty = false
```

Expected:

- Continue Creating strongest;
- project name visible;
- `已保存` quiet;
- New/Open secondary;
- Recent Projects below.

### P2 — Current project / dirty

```text
currentProject.dirty = true
```

Expected:

- `有未保存更改` visible but not alarmist;
- Continue Creating remains primary;
- launcher does not silently discard or reload state.

### P3 — No current project + recent projects

Expected:

- New/Open primary entry region;
- Recent Projects immediately useful;
- no fake empty current-project card.

### P4 — No recent projects

Expected:

- simple empty copy;
- New/Open remain obvious;
- no empty maintenance chrome.

### P5 — Missing recent project

Expected:

- Missing state visible;
- primary corrective action = Relocate;
- normal Open unavailable.

### P6 — Mismatched recent project

Expected:

- identity mismatch visible;
- current safety rules preserved;
- no normal Open bypass.

### P7 — Recovery candidate

Expected:

- Recovery notice visible and actionable;
- Restore/Ignore truth preserved;
- Launcher does not become a recovery-admin dashboard.

### P8 — Busy/error

Expected:

- relevant actions disable/feedback truthfully;
- errors remain readable;
- global launcher layout remains stable.

---

## 19. High-fidelity blueprint acceptance checklist

The landscape blueprint is accepted only if all answers are yes:

- Can a beginner identify the primary next action in under a few seconds?
- When a project is already open, is Continue Creating clearly dominant?
- Are New Project and Open Project obvious without exposing a raw path form?
- Does Recent Projects read like a launcher rather than a database table?
- Are missing/mismatched/invalid project states still truthful and actionable?
- Are maintenance actions visually secondary?
- Is the permanent safety/explanatory copy materially reduced?
- Does the page feel like the same Panda Stage product as the editor and FLA Workbench?
- Are all core actions Cloud Touch-safe?
- Does the design require no new project-lifecycle or filesystem authority?

---

## 20. V1 implementation recommendation

Recommended first implementation slice:

```text
Renderer presentation only
```

Primary targets likely include:

- `src/renderer/shell/ProjectCenterScreen.tsx`
- `src/renderer/shell/StartScreen.tsx`
- `src/renderer/shell/NewProjectEntry.tsx`
- `src/renderer/features/welcome/RecentProjectsPanel.tsx`
- relevant launcher CSS / shared UI primitives

The exact whitelist must be determined from live code when the implementation issue is opened.

Do not authorize Main/Preload/domain changes by default.

---

## 21. Validation expectation for implementation

At minimum:

```text
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

Also run focused existing tests/verifiers covering:

- project open flow;
- project create flow;
- project session/switching;
- recent projects list / relocate / remove;
- recovery candidate behavior;
- Renderer shell state.

Real Windows Electron human acceptance must cover the states in Section 18.

Visual automation cannot replace the final human launcher review.

---

## 22. V1 -> V2 evolution

V1 intentionally uses only existing truth.

Possible future improvements, only when backed by new authoritative data/contracts:

- real project thumbnail/cover generated from project content;
- richer project metadata such as shot count or last edited shot;
- pinned/favorite projects;
- recent-project search when the list grows beyond the current small range;
- explicit advanced Open Project surface for power-user path workflows;
- project templates if the creation model later supports real template semantics.

Do not fake any of these in V1.

---

## 23. Final frozen summary

Project Launcher v1 is defined by three product moves:

```text
Current project exists
-> Continue Creating is primary

Open Project
-> native chooser first; raw path is secondary/advanced

Recent Projects
-> clean launcher list; maintenance behind contextual controls
```

Everything else serves those moves.

The redesign changes the front desk, not the project engine.
