# Cloud-mobile UI-M2 adaptive EditorShell

This document records the UI-M2 implementation authorized by Issue #320. It
is layered on the accepted UI-M1 foundation in PR #319 at
`57a812b26a6f998cdb9cb5bee9b58b3f152e16f8`; it does not introduce a second
editor shell or a second visual/control system.

## Composition

The responsive mode is session-only and derived from the available viewport.
The existing 1100px responsive seam is preserved as the cloud-mobile boundary:
portrait takes precedence when height exceeds width, narrow landscape enters the
M2 composition, and wider landscape remains the established desktop baseline.
This third baseline mode is not a second shell; it prevents the adaptive stage
from changing the existing wide-editor contract used by legacy Electron gates.

For the cloud-mobile compositions:

- landscape keeps `CompactProjectBar`, a lightweight left resource rail, the
  same `CanvasWorkspace` as the dominant center, an on-demand resource drawer,
  an on-demand `RightInspector` drawer, and the existing `BottomWorkspace`;
- portrait keeps the same owners but exposes one primary workspace through the
  UI-M1 `SegmentedTabs`: Canvas, Shots, Assets, Properties, or Timeline;
- the resource owner remains one `ResourceActivityDock`, with the portrait
  Assets selection requesting its existing Asset Library view;
- Properties reuses the existing `RightInspector`, and Timeline reuses the
  existing `BottomWorkspace`/`TimelineDock` owner.

Portrait slots that are not selected use the native `hidden` attribute and
`aria-hidden`, so their controls are not in the normal focus or touch path.
Landscape drawer open/close focus behavior continues to be owned by the
existing ResourceActivityDock and RightInspector components.

## State and ownership boundaries

`adaptiveEditorShell.ts` owns only viewport-derived layout mode and the
session-only workspace selection. It does not import Project, History, IPC,
Preload, or Main Process owners. Orientation and workspace transitions do not
call `updateProject`, change `dirty`/`revision`, or add History entries.

The existing production owners remain unique:

```text
EditorShell
├── one LeftWorkspace / ResourceActivityDock
├── one CanvasWorkspace / CanvasStage
├── one RightInspector
└── one BottomWorkspace / TimelineDock / HistoryControls
```

The shell uses one primary vertical scroll owner in portrait. Feature-level
horizontal or content scrolling remains local to the existing feature where
the feature requires it.

## PR #233 overlap boundary

The live PR #233 overlap audit found direct overlap in `src/renderer/styles.css`
and in PR #233's asset/dialogue/preview business surfaces. UI-M2 adds only a
scoped, additive block at the end of `src/renderer/styles.css` and does not
copy or rewrite PR #233 business behavior. `EditorShell`,
`LeftWorkspace`, `RightInspector`, and `BottomWorkspace` remain the shell
owners for this stage. Any later integration must re-check the live changed
files before editing shared style or shell surfaces again.

## Validation and acceptance

The focused automated coverage is in
`tests/unit/editor-shell-adaptive.test.ts`. It covers viewport mode
derivation, orientation round-trip state, owner cardinality, hidden-slot
focus safety, cross-owner state boundaries, and the portrait scroll contract.

Required local checks for this renderer shell change are:

```text
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

Real Windows Electron plus Wuying/Redmi acceptance remains a separate human
gate. The maintainer must verify the Issue #320 landscape, portrait,
round-trip, scroll, touch, and focus checklist before the closeout marker is
set. Passing M2 does not authorize Ready, Full CI, merge, or a new PR; PR #319
must remain Draft/Open/Unmerged for the later separately authorized UI stages.

## Issue #321 corrective: explicit Cloud Touch mode

Issue #320 human acceptance exposed that the Auto width heuristic cannot
identify a phone held in landscape when Wuying keeps the maximized Electron
window wider than 1100px. The corrective keeps Auto's existing heuristic but
adds a session-only `Auto | Desktop | Cloud Touch` selector in the existing
CompactProjectBar `More` menu.

`Desktop` always selects the established desktop composition. `Cloud Touch`
selects the existing M2 portrait shell when `height > width`, otherwise the
existing M2 landscape shell. The 1100px seam is not consulted in Cloud Touch.
The selection is owned by `EditorShell` and is not Project data: it does not
write `project.json`, dirty/revision, History, current Shot, selection, or
Timeline/playhead state.

Issue #321 automated coverage adds explicit-mode precedence and wide-window
Cloud Touch orientation cases. Real Windows Electron plus Wuying/Redmi
acceptance is still required; this corrective must not set the final
`UI_M2_ADAPTIVE_SHELL_PASS` marker, mark PR #319 Ready, run the final Full
gate, merge, or close the remaining Issue #320 human checklist by itself.
