# N2-02 Preview and Formal Export UX Contract

**Status:** contract-only delivery for Issue #565
**Parent:** [N2 roadmap / Issue #562](https://github.com/Cognitive-Architect/panda-stage/issues/562)
**Predecessor:** [N2-01 audit / Issue #563](https://github.com/Cognitive-Architect/panda-stage/issues/563)
**Delivery line:** branch `issue-563-n2-01-audit`, PR #564
**Scope:** freeze user-facing behavior; do not implement N2-03 through N2-08

This document is the canonical N2-02 product contract. It describes the
behavior that later implementation issues must provide while reusing the
existing formal Preview, evaluator, Stage, media, and FFmpeg owners. It does
not authorize product-code, schema, IPC, Save As, export-service, or playback
changes in this issue.

The current-state evidence is recorded in the [N2-01 audit](../evidence/issue-563-n2-01/README.md).
The durable visual guardrails are recorded in the repository [DESIGN.md](../../DESIGN.md).

## 1. Product outcome

Panda Stage should present two creator-facing actions:

```text
Preview:
open one Preview surface
→ choose Whole Project or Current Shot
→ play / seek / stop / replay
→ close without changing editor state

Export video:
choose an output
→ automatic preflight
→ export
→ complete, cancel, or retry safely
```

The product must not turn this flow into an engineering form for codec, FPS,
FFmpeg paths, project directories, raw audio paths, or probe parameters.

## 2. Ownership and invariants

The contract preserves these owners from N2-01:

| Concern | Contract owner | Must remain true |
| --- | --- | --- |
| Preview lifecycle | Existing `EditorShell` / `ProductPreviewOverlay` owner | One Preview surface; no second overlay, player, transport store, or project/session owner. |
| Project state | Existing formal `EditorProjectStore` and `ProjectSessionController` | Preview drafts, output selection, preflight, progress, cancellation, retry, and success do not create Project revisions or History commands. |
| Shot selection | Existing `shotStore` | Range selection is Preview-local; it must not replace the editor's selected Shot. |
| Visual meaning | Formal `evaluateShotAtTime` and shared Stage renderer | Later whole-project work maps project time to shot-local time and then reuses these rules. |
| Media access | Main-owned bounded asset/file services through Preload | Renderer never reads Node.js files or creates a parallel media service. |
| Export media foundation | Existing hidden renderer, `ExportService`, `FFmpegAdapter`, FFprobe and atomic staging/commit | Later formal export connects a Project snapshot to these owners; it does not rebuild them. |
| Export task | One task owner associated with the active Project session | At most one active export exists in V1; closing its surface does not cancel it. |

The N2-01 audit remains the source of truth for what is already implemented.
This document freezes intended UX behavior; it does not upgrade source
existence into shipped whole-project capability.

## 3. Contract A — one Preview surface, two ranges

### 3.1 Range model

There is exactly one Product Preview surface with two playback ranges:

```text
Whole Project
Current Shot
```

These are two range modes on the same Preview owner. They are not two players,
two Stage renderers, two transport models, or two selection stores.

The range mode is Preview-local state. Changing it must not mutate:

- `Project` data;
- Project revision or dirty state;
- History;
- editor Shot selection;
- editor Layer selection.

### 3.2 Default range

When opened from the project-level Quick Action, Preview defaults to:

```text
Whole Project
```

The existing Current Shot capability remains available inside the same
surface. An explicit shot-context entry may request Current Shot, but it still
opens the same Preview owner and the same transport.

V1 does not convert the current time when switching ranges.

### 3.3 Minimal range controls

The range choice should be a compact, understandable control near the Preview
transport, with creator-facing labels only:

```text
整个项目    当前镜头
```

Do not expose project IDs, Shot IDs, evaluator names, frame indices, source
timestamps, or media generation tokens in the main Preview flow.

## 4. Contract B — Preview transport semantics

The existing user-facing meanings remain fixed:

| Action | Required result |
| --- | --- |
| Play | Start or resume the selected range from its current position. |
| Pause | Keep the current range and time; stop advancing. |
| Seek | Move to the selected range time and pause at that time. |
| Stop | Set the selected range time to `0` and remain stopped. |
| Replay | Set the selected range time to `0` and start playing. |
| Close | Stop Preview-owned media, discard Preview-local state, and leave Project, History, and editor selection unchanged. |

The Preview clock is not an editor clock. It must be disposed when the surface
closes or the range changes so late image/audio work cannot revive a previous
range.

### 4.1 Range switching

Switching either direction:

```text
Whole Project ↔ Current Shot
```

must:

1. pause playback;
2. invalidate range-specific image/audio work;
3. reset the newly selected range to time `0`;
4. load/render the new range through the same Preview surface;
5. leave editor selection and Project state unchanged.

There is no automatic conversion from the old range time to the new range in
V1. The newly selected range always begins at its own `0`.

### 4.2 Whole-project context

Whole Project Preview exposes only the creator-facing context needed to answer
“where am I?”:

```text
镜头 2 / 5     0:12 / 1:48
```

The context consists of:

- current Shot position and total Shot count;
- project time and project total duration;
- the selected range label.

It must not expose frame number, render phase, audio source position, object
URL, IPC channel, job ID, codec, or FFmpeg diagnostics in the primary flow.

### 4.3 Empty and unavailable states

Every unavailable range has one concise owner message with an action:

| State | Creator-facing contract |
| --- | --- |
| No shots | `没有可预览的镜头` + `先创建一个镜头，再打开预览。` |
| Required image/audio cannot be read | Identify the affected Shot/content and offer the next useful action, such as `请重新导入这段素材。` |
| Whole Project unavailable but a valid Current Shot exists | State that the whole project cannot be previewed, keep the Current Shot option available, and identify the blocking content. |
| Range switching/loading | Show one concise loading state owned by the Preview surface; do not add a second persistent status banner. |

Technical details may be available in a secondary diagnostic path, but they do
not replace the creator-facing explanation.

## 5. Contract C — formal Export entry

### 5.1 Primary action

The formal product action is:

```text
导出视频
```

It starts the output-selection flow for the active formal Project. The normal
creator path must not expose the current debug/probe parameter surface.

The formal action is one clear primary action for the idle state. It must not
compete with separate “run preflight”, “configure encoder”, or “start probe”
buttons.

### 5.2 Fixed production contract

V1 does not ask the creator to configure:

- FPS;
- width or height;
- codec;
- pixel format;
- AAC settings;
- FFmpeg or FFprobe paths;
- project-directory text fields;
- raw audio paths;
- `audioStartMs`;
- probe duration.

The established production contract is:

```text
1920×1080
24 fps
H.264 / yuv420p
AAC
MP4
```

These are product defaults and implementation constraints, not creator-facing
settings.

### 5.3 Output scope

The first formal Export action applies to the complete formal Project snapshot
in `project.shots` order. It does not export only the currently selected Shot.
Current Shot remains a Preview range, not a second Export mode in this issue.

The serial implementation may reach that product contract in stages: N2-06 can
initially support a single-shot export slice, while N2-07 adds the complete
multi-shot output. Until the multi-shot slice is implemented, a multi-shot
Project must be blocked by explicit preflight rather than truncated or silently
exported as one Shot. N2-02 does not create a separate Current Shot Export
mode.

The content boundary comes from the N2-01 audit. Required content that cannot
be represented honestly blocks export; there is no silent best-effort output.

## 6. Contract D — native output selection

### 6.1 Save As flow

Use a native Windows/Electron Save As flow behind the narrow Main/Preload
allowlist. The creator should select a destination rather than type a raw
filesystem path into the normal product UI.

Default filename:

```text
<project name>.mp4
```

The dialog filters to MP4 output while preserving normal Windows navigation.
Canceling the dialog returns to the idle product state and creates no export
task, Project revision, or History entry.

### 6.2 Existing target and commit protection

The native Save As interaction may provide the first user-facing replacement
confirmation for an existing file. That confirmation is not sufficient for
backend commit.

Main must revalidate the output target at task start and again before final
commit. If the target appears or changes after selection:

```text
do not blindly overwrite
→ keep the valid existing file intact
→ report the conflict
→ let the creator choose a destination again
```

The existing staging, cleanup, and atomic final-commit protections remain the
backend boundary. A partial, canceled, or failed artifact must not masquerade
as the selected final MP4.

### 6.3 Windows path contract

The flow must support normal Windows paths containing:

- spaces;
- Unicode;
- Chinese characters;
- reasonably long paths within the repository’s accepted path boundary.

No ASCII-only assumption is allowed in the creator-facing flow or the Main
boundary.

## 7. Contract E — automatic preflight

### 7.1 No separate preflight button

After a successful output selection:

```text
choose output
→ automatic preflight
→ PASS: start export
→ BLOCK: show actionable issues
```

There is no separate “运行预检查” button and no healthy-project confirmation
step between a passing preflight and the export task.

### 7.2 Blocking policy

For the first formal export path, preflight blocks when content cannot be
represented honestly. At minimum this includes:

- missing or unreadable required media;
- unsupported required media format;
- invalid Project references;
- unbound audio that would otherwise disappear;
- overlapping or unsupported multi-track audio;
- missing required mouth/image content when Simple Mouth is claimed;
- any other out-of-bound content from the N2-01 support boundary;
- `AudioClip.volume > 1` until a separate gain contract is approved.

V1 has no `Export Anyway` bypass for content that would be silently omitted.

The preflight result is derived from the selected Project snapshot candidate,
not from transient Preview-local state.

### 7.3 Error presentation

The primary error surface states:

```text
affected object
+
what happened
+
what the creator can do next
```

Examples:

```text
镜头 2
配音素材无法读取
→ 请重新导入这段配音
```

```text
镜头 3
有一段配音尚未绑定到对白
→ 绑定对白后再导出
```

Do not put schema paths, IPC names, internal IDs, FFmpeg arguments, staging
paths, or raw stack traces in the primary creator-facing error. Diagnostics may
be available through a separate technical details path.

### 7.4 Preflight information ownership

Preflight has one result owner. A failed item appears once in the task surface
where the creator can act on it. Do not repeat the same error in a banner, a
card, a toast, and a persistent footer.

## 8. Contract F — frozen export input and editing concurrency

### 8.1 Snapshot semantics

Starting the export task captures a frozen export input after output selection
and before expensive rendering. The snapshot includes the semantic inputs
needed to reproduce the task:

- formal Project content;
- Project revision at capture;
- Shot array order and durations;
- referenced assets and their validated identities;
- subtitle/dialogue/audio/mouth content within the support boundary;
- fixed production settings;
- selected output path and overwrite decision;
- project-root/resource context required by Main.

Export renders this frozen input, not live edits made after the task starts.
The snapshot is task state, not Project persistence and not editor History.

### 8.2 Editing while export is active

V1 policy:

```text
while an export task is active:

ALLOW
- continue editing the same open Project
- save the same open Project
- use Preview

BLOCK
- switch to another Project
- close the active Project
- start a second export task
```

During an active export, Preview reflects the current live editor state rather than the frozen export snapshot, so later edits may intentionally appear in Preview while the in-flight export continues rendering the earlier captured Project revision.

If the creator attempts a blocked operation, the product explains the direct
next action, for example:

```text
正在导出视频
→ 完成或取消导出后再切换项目
```

This is a task guard, not a second Project/session state owner.

### 8.3 History and dirty state

The following are read-only task/session operations and create no Project
revision, dirty state, or undo-history entry:

- choosing an output;
- preflight and viewing its errors;
- opening, hiding, or reopening the task surface;
- progress updates;
- canceling;
- retrying;
- viewing success or opening the output folder.

## 9. Contract G — export task surface

### 9.1 One active task

V1 supports one active export task for the active Project. A second export
action is unavailable while the first task is in any active phase:

```text
checking
rendering
encoding
muxing
cancelling
committing
```

N2 does not introduce a job queue or background-task manager.

### 9.2 Close versus cancel

Closing or hiding the Export task surface does not cancel the task:

```text
close panel
→ task continues
```

The product must retain one clear way to reopen the active task surface from
the same Project shell. Reopening shows the current state of the same task; it
does not create a new task or duplicate progress/status ownership.

Cancel is an explicit task action and is separate from closing the surface.

### 9.3 Creator-facing task states

Internal service phases may remain detailed. The primary UI presents only the
creator-facing states needed to understand and act:

| Product state | Meaning | Primary actions / copy |
| --- | --- | --- |
| Idle | No export task exists. | `导出视频` |
| Checking | The selected Project and output are being checked. | Show a concise checking state; no second preflight action. |
| Rendering | Frames/content are being rendered. | Show honest progress when a real denominator exists; otherwise show stage progress. |
| Encoding | The MP4 stream is being encoded/muxed. | Keep the task state visible; do not expose codec settings. |
| Finishing | Output protection and final commit are completing. | Keep the creator informed; cancellation is unavailable once commit begins. |
| Success | A valid final MP4 was committed. | `导出完成`, filename, `打开所在文件夹`, `完成`. |
| Failed | The task did not produce a valid final output. | State affected content/output and one useful next action; offer retry according to Section 11. |
| Cancelling | The creator requested cancellation and cleanup is running. | Neutral progress state; do not style as a crash/error. |
| Cancelled | The task ended by creator cancellation. | Neutral `已取消`; allow a new `导出视频` action. |

Do not surface every internal phase merely because the backend has one.

### 9.4 Progress honesty

Use a percentage only when it is based on real task information. If the
current phase has no reliable denominator, show the phase without inventing a
percentage. Progress must belong to the one active task and stale updates must
not revive a previous task surface.

## 10. Contract H — cancellation

Cancellation is an intentional user action and a neutral terminal path:

```text
Cancel
→ cancelling
→ cancelled
```

Cancellation is available during cancellable checking/rendering/encoding/
muxing/cleanup work according to the backend task boundary. Once final atomic
commit begins:

```text
committing / finishing
→ cancellation unavailable
```

The UI must disable or remove the Cancel action in that phase rather than
pretend that a late cancellation can undo a committed file. Existing cleanup,
temporary-directory, staging-output, and valid-final-file protections remain in
force.

Cancellation must not be shown as a red failure state. A canceled task does
not create a Project revision and does not corrupt the active Project.

## 11. Contract I — retry and snapshot identity

### 11.1 Same frozen input

If the creator chooses to retry the same failed task, the product reuses the
same frozen export input where the implementation contract permits. The retry
must not silently replace the failed snapshot with whatever live edits happen
to exist now.

The task surface may label this action:

```text
重试
```

It creates a new task execution identity, but it retains the prior snapshot
identity and rechecks output protection before committing.

### 11.2 New Project state

If the creator wants later edits to be included, the action is explicitly a
new check and new snapshot:

```text
当前项目
→ 重新检查并导出
→ 新快照
→ 新导出任务
```

When the Project revision changed after failure, the UI must distinguish
`重试原内容` from `重新检查并导出`, or otherwise make the chosen snapshot
semantics explicit. It must never silently choose live state.

### 11.3 Retry output safety

A retry re-runs target checks and creates fresh staging work. It does not reuse
an untrusted partial MP4 as a valid final artifact and does not bypass the
approved existing-target policy.

## 12. Contract J — success and failure outcomes

### 12.1 Success

The success state is compact and creator-facing:

```text
✓ 导出完成

<filename>.mp4

[打开所在文件夹]  [完成]
```

Do not make Job ID, FFmpeg arguments, codec diagnostics, staging paths, or
internal probe details part of the primary success surface.

### 12.2 Failure

A failure states what was affected, whether the Project was affected, and one
useful next action. The normal shape is:

```text
导出未完成
项目未受影响
→ 重试原内容 / 重新检查并导出 / 选择其他位置
```

The exact next action depends on whether the failure happened during preflight,
rendering, output protection, cancellation, or commit. Cancellation remains a
separate neutral state, not a failure variant.

## 13. Contract K — responsive and Cloud Touch behavior

Desktop landscape and Cloud Touch portrait/constrained layouts use the same
Preview and Export owners and the same state semantics.

### 13.1 Preview

- the same Preview surface and range modes;
- Stage remains contained and is scaled rather than cropped;
- range control and transport remain reachable;
- no horizontal-scroll dependency for the primary path;
- the same close, range-switch, and media-lifecycle behavior.

### 13.2 Export

- the same Export task state machine;
- narrow layouts collapse to a simple vertical presentation;
- primary action, current state, Cancel, and success actions remain reachable;
- resizing/orientation change does not restart or mutate the task;
- the creator is not required to see codec, path, or diagnostic metadata.

Responsive presentation is not a second product state machine and must not
change Project data, dirty state, revision, History, Shot data, or task
identity.

## 14. Design guardrails applied

This contract follows the repository red lines in [`DESIGN.md`](../../DESIGN.md):

- no schema-field-to-control mapping;
- no settings mountain for fixed production values;
- no nested Card/Box hierarchy as a substitute for information hierarchy;
- no explanatory-text wall; copy is short and action-oriented;
- one information owner for each status/error/result;
- no internal IDs, paths, codec details, or debug fields in the creator flow;
- one clear primary action per state;
- cancellation is neutral, while destructive overwrite remains explicitly
  protected;
- the existing continuous EditorShell/workspace ownership remains intact;
- desktop and Cloud Touch share owners rather than becoming separate products.

This is a behavior contract, not authorization for a visual redesign or a
repository-wide CSS cleanup.

## 15. Explicit deferred and non-goal behavior

N2-02 does not implement or authorize:

- the project-time mapper;
- whole-project playback;
- cross-shot seek or media handoff;
- export snapshot/preflight services;
- native Save As IPC;
- formal Project export rendering;
- multi-shot audio composition;
- retry/task services;
- FFmpeg behavior changes;
- schema migrations;
- a second Preview/player;
- a job queue or multi-project background export manager;
- full lip-sync recognition, BGM mixing, rig/skeleton systems, FLA rewrite,
  or general-purpose motion/action authoring;
- broad UI/CSS/design cleanup.

If implementation discovers that a schema change or a broader media contract is
required, it must stop, record the blocker and compatibility cost, and request
separate maintainer authorization.

## 16. State flow

The creator-facing flow is:

```text
idle
  │ 导出视频
  ▼
native Save As
  ├─ cancel ───────────────► idle
  └─ output selected
          ▼
       checking
       ├─ blocked ─────────► actionable preflight result
       └─ pass
          ▼
       rendering
          ▼
       encoding
          ▼
       finishing / committing
       ├─ success ─────────► success
       └─ failure ─────────► failed

checking/rendering/encoding
  └─ Cancel → cancelling → cancelled

failed
  ├─ 重试原内容 ───────────► same frozen input, new task run
  └─ 重新检查并导出 ──────► new preflight, new snapshot, new task
```

Closing the task surface is orthogonal to this flow: it hides the surface but
does not traverse to `cancelled`. Reopening returns to the current task state.

## 17. Acceptance checklist for this contract

The N2-02 contract is complete when the following are all true:

- one Preview surface with Whole Project and Current Shot ranges is defined;
- Whole Project is the project-level default;
- current-shot Preview remains supported;
- Play/Pause/seek/Stop/Replay/close meanings are frozen;
- range-switch pause/reset/invalidation behavior is frozen;
- minimal time/Shot context is frozen;
- `导出视频` is the formal primary action;
- native Save As and `<project name>.mp4` are defined;
- automatic preflight and no-force-export blocking are defined;
- `AudioClip.volume > 1` is an explicit preflight blocker until a gain contract;
- frozen snapshot semantics are defined;
- same-Project editing, Project switching, and concurrent-export policy are defined;
- closing the task surface is distinct from Cancel;
- one active export task is defined;
- cancellation is neutral and commit/finishing is non-cancellable;
- retry versus new-snapshot retry is explicit;
- overwrite and commit-time protection are explicit;
- success and failure surfaces are creator-facing and compact;
- constrained/portrait layouts use the same state machine;
- deferred/non-goal behavior is explicit;
- no N2-03 through N2-08 implementation is included;
- delivery remains on `issue-563-n2-01-audit` and in PR #564.

## 18. Handoff

After this contract is accepted, the approved serial implementation begins at:

```text
N2-PREVIEW-SER
SER-01 = N2-03 — Two-shot continuous project Preview
SER-02 = N2-04 — Cross-shot seek / stop / replay / lifecycle cleanup
```

Later implementation must reuse this contract and the N2-01 ownership map;
discovering an implementation seam does not authorize a parallel player,
second project-time source, or engineering-settings export flow.
