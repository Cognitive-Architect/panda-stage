# Panda Stage successor-agent handoff

Last verified: 2026-08-10 16:01:01 +08:00 (Asia/Shanghai)
Repository: Cognitive-Architect/panda-stage
Verified main HEAD: `55ddf166d5f63cba61196fbb79b92e402171a21c`
Status: **YELLOW — Stage 4 is complete, but M3 remains NO-GO because Stage 3-B human acceptance is incomplete; #159 is also still an unfinished read-only audit.**

This document is a current-state handoff, not a product plan. Re-check live
GitHub state and the current `main` before acting. Older receipts are evidence
of the result they recorded, not permission to extend scope.

## 1. Current fact state

### Repository and checkout

- Recommended checkout: `D:\panda-stage-main`.
- Repository: [`Cognitive-Architect/panda-stage`](https://github.com/Cognitive-Architect/panda-stage).
- `main == origin/main` was verified after `git fetch origin main` at the full
  SHA `55ddf166d5f63cba61196fbb79b92e402171a21c`.
- The `main` working tree was clean before this docs-only branch was created.
  Do not use `git reset`, `git clean`, or `git stash` to repair an unfamiliar
  checkout.
- The local `.workbuddy/` directory is not repository content. It contains
  only local WorkBuddy/Codex memory, launch helpers, artifacts, and reports;
  it remains in place and is ignored only by the local
  `.git/info/exclude` entry. Do not delete it or move this rule to
  `.gitignore`.

### Live open work

| Item | Live state | Meaning for the successor agent |
| --- | --- | --- |
| [Issue #127](https://github.com/Cognitive-Architect/panda-stage/issues/127) | OPEN | Stage 3-B owner migration is not human-accepted to completion. The latest receipt says B1/B2 PASS, B3/B4 BLOCKED, B5–B12 NOT RUN. |
| [PR #128](https://github.com/Cognitive-Architect/panda-stage/pull/128) | OPEN, non-Draft, unmerged, `CONFLICTING` | Head is `906a4adb1211597781ecb5d1828da80acf392792`; it has not been changed or merged. Its PR body was written against the old base `40388b7508db0ba882beb3925364c2532b20fbb0`, so do not treat that validation as a current-main validation. |
| [Issue #129](https://github.com/Cognitive-Architect/panda-stage/issues/129) | OPEN | Only C3 remains open: the Layer A ActionPreset draft → switch to Layer B → Apply scenario is transferred to #127/PR #128 and is **NOT VERIFIED**. |
| [Issue #141](https://github.com/Cognitive-Architect/panda-stage/issues/141) | OPEN | ActionPreset preview/parameter/timing/object-semantics UX debt. It is not a license to expand PR #128. |
| [Issue #159](https://github.com/Cognitive-Architect/panda-stage/issues/159) | OPEN | Only a read-only ActionPreset preview/render gap audit is authorized. The body currently ends mid-sentence at “继续做 B3/B4 类验收之前” and has no comments; anything beyond that cutoff is `UNVERIFIED`. |
| [Issue #160](https://github.com/Cognitive-Architect/panda-stage/issues/160) | OPEN while this receipt is being delivered | Docs-only successor-agent handoff. No production code or functional PR work is authorized here. |

Other open items are backlog or deferred hardening, not current M3 gates:

- [#149](https://github.com/Cognitive-Architect/panda-stage/issues/149) and
  [#150](https://github.com/Cognitive-Architect/panda-stage/issues/150) are
  P2/P3 Electron security/resilience hardening with no confirmed active
  exploit or data-loss incident.
- [#151](https://github.com/Cognitive-Architect/panda-stage/issues/151) is
  future cost-bounded packaged-CI automation; the current release was still
  manually verified by `pnpm dist` plus `pnpm verify:gate-a`.
- [#152](https://github.com/Cognitive-Architect/panda-stage/issues/152) is a
  pre-schema-v6 migration consolidation trigger, explicitly not a Stage 4
  blocker.
- [#153](https://github.com/Cognitive-Architect/panda-stage/issues/153) is
  P3 direct PNG-thumbnail-validator test hardening, not a Stage 4 blocker.
- [#106](https://github.com/Cognitive-Architect/panda-stage/issues/106) and
  Draft PRs [#75](https://github.com/Cognitive-Architect/panda-stage/pull/75)
  and [#107](https://github.com/Cognitive-Architect/panda-stage/pull/107)
  describe the frozen Day 26–45 planning line. They are not permission to
  start Day 26–45 implementation.

### Completed work that constrains the current state

| Delivery | Why it happened and final result | Human / automated evidence | Constraint now |
| --- | --- | --- | --- |
| [PR #143](https://github.com/Cognitive-Architect/panda-stage/pull/143), merged as `4ed24bdd0a7415aebf0d0c94884e3d5ccf463963` | Bounded Stage 3-C HistoryControls → BottomWorkspace owner migration. It did not modify ActionPreset, domain, evaluator, IPC, or PR #128. | CI receipt is in the PR. It does not turn Stage 3-B into PASS. | Keep Stage 3-B and Stage 3-C as separate acceptance boundaries. |
| [PR #145](https://github.com/Cognitive-Architect/panda-stage/pull/145), merged as `3f5731857913a883e2954578310018faac310c0b` | Isolated revision diagnostics from resource headings so debug output cannot alter product/resource UI. | Automated checks plus the subsequent integrated Stage 4 receipt; Debug-mode Windows acceptance was reported PASS. | Do not reintroduce diagnostic UI into product surfaces. |
| [PR #146](https://github.com/Cognitive-Architect/panda-stage/pull/146), merged as `b53f9795083273640d3fed4db298dcc6b1607083` | Diagnoses missing asset sources without deleting dangling records or silently writing repairs. | Real Windows Electron R1–R9 PASS; integrated receipt records the missing-source/healthy-asset S4-4 confirmation. | Missing-source diagnosis must remain non-destructive. |
| [PR #148](https://github.com/Cognitive-Architect/panda-stage/pull/148), merged as `3f96d343085a455183584257aba61cb699e0e86b` | Fail-safe native close while renderer autosave synchronization is unacknowledged. | Integrated N1–N5 human acceptance PASS is recorded in [Issue #144](https://github.com/Cognitive-Architect/panda-stage/issues/144). | Cancel/save/discard/native-close behavior remains a Main-owned safety contract. |
| [PR #158](https://github.com/Cognitive-Architect/panda-stage/pull/158), merged as current main `55ddf166d5f63cba61196fbb79b92e402171a21c` | Isolated Gate renderer IPC and made packaged Gate A preview DPI-invariant. | Repository-owner normal-product Windows acceptance PASS is recorded in [Issue #157](https://github.com/Cognitive-Architect/panda-stage/issues/157); packaged Gate A also passed. | Gate renderer isolation is not the editor ActionPreset preview implementation. |

The closure receipts are [Issue #130](https://github.com/Cognitive-Architect/panda-stage/issues/130),
[Issue #144](https://github.com/Cognitive-Architect/panda-stage/issues/144),
[Issue #156](https://github.com/Cognitive-Architect/panda-stage/issues/156), and
[Issue #157](https://github.com/Cognitive-Architect/panda-stage/issues/157).
They record:

- Stage 4: **PASS**;
- S4-1–S4-12: **PASS**;
- current core quality, 19/19 applicable gates, fresh distribution, and
  strengthened packaged Gate A: **PASS**;
- Stage 3-B / #127 / PR #128: still incomplete;
- M3: **NO-GO**;
- Day 26–45: **FROZEN**.

### Automated versus human evidence

Automated evidence currently includes typecheck, lint, unit/integration tests,
build, the applicable Electron verifiers, `pnpm dist`, and packaged Gate A.
The final integrated receipt reports unit `89 files / 633 tests`, integration
`24 files / 140 tests`, and 19/19 applicable gates PASS. The latest `main` CI
run is [31352476602](https://github.com/Cognitive-Architect/panda-stage/actions/runs/31352476602)
and completed successfully.

Human evidence is separate: Debug acceptance for #145, R1–R9 for #146,
native-close N1–N5 for #148, normal product acceptance for #158, and the
maintainer's S4-1–S4-12 confirmation. None of those is evidence that the
unmerged Stage 3-B ActionPreset workflow is human-accepted.

## 2. Distribution facts

The currently present local artifacts are under `release/` and were hash-
checked against the final-main receipts:

| Artifact | SHA-256 |
| --- | --- |
| `release/Panda-Stage-0.1.0-Windows-x64.exe` | `A428C77544FCAFA814521F72C645758F9B70D82DCF7DEAA7596EA38A5F8CAC3F` |
| `release/win-unpacked/Panda Stage.exe` | `B5794A11979947951D367CF4D1C1D42BFF1D9E63951AA672AB4F41700DC21AFF` |
| `release/win-unpacked/resources/media/ffmpeg.exe` | `C8ABC49E7BE62DDE8E12972AF373959E0076A7B8DC8040EB45978E0608F8781E` |
| `release/win-unpacked/resources/media/ffprobe.exe` | `F28C4751E7367205267025AAF0FCFC921E34D9B7EDAA46BD9C8ABAF367FC9051` |

Use `Panda Stage.exe` from `release/win-unpacked` for a quick packaged
acceptance launch. Use the NSIS installer only when installer behavior itself
is in scope. The release directory is a generated local artifact, not a
replacement for GitHub receipts.

## 3. Current blockers and unfinished work

### Issue #141 UX debt

The live Issue #141 human receipt records these concrete observations in
Windows Electron:

1. Applying an ActionPreset produces mainly a brief visual flash rather than
   a clear, complete, repeatable preview.
2. `移动到` requires manual target X/Y entry.
3. Default parameters expose engineering units such as milliseconds,
   amplitude, frequency, and scale factor.
4. The UI does not give enough time context: playhead, start, end, overlap, or
   a clear way to replay one action.
5. The distinction between generic layer actions, character-only expression
   actions, and formal backgrounds is not sufficiently understandable to a
   normal creator.

The minimum product direction recorded by #141 is stable repeatable preview,
human-friendly parameters/target selection, minimal time context, and clear
object semantics. It is not a request to create a full Premiere-style
timeline, and it is not a PR #128 blocker-fix authorization.

### Issue #159 authorization and evidence gap

The only currently visible authorization in #159 is a **read-only
implementation audit** of the ActionPreset preview/render gap. It does not
authorize production edits, a #141 implementation, a timeline rewrite, or a
new playback system. The Issue body is incomplete and has no receipt comments;
therefore the exact expected audit checklist and final conclusion are
`UNVERIFIED` beyond the text that is visible.

### Why Stage 3-B, #127, and PR #128 cannot be declared PASS

The latest #127 acceptance receipt says:

```text
B1 PASS
B2 PASS
B3 BLOCKED
B4 BLOCKED
B5–B12 NOT RUN
Stage 3-B Human Acceptance = BLOCKED
```

The blocker is observability and workflow clarity, not proof that the domain
event write failed. Until a maintainer records a complete human acceptance,
keep Issue #127 open, keep PR #128 open/unmerged, and do not mark it Ready or
merge it. PR #128's current live head is the untouched
`906a4adb1211597781ecb5d1828da80acf392792`.

### M3 and deferred work

Stage 4 is PASS, but the final integrated closure receipt explicitly keeps M3
NO-GO solely because Stage 3-B/#127/PR #128 is incomplete. Day 26–45 remains
frozen. Issues #149–#153 and #106 are backlog/deferred scope as described in
Section 1; do not present them as current M3 acceptance failures or start them
while this freeze remains.

## 4. ActionPreset / #141 takeover context

### Current main chain

The current `main` implementation has this observable path:

```text
LegacyCompatibilityActivity (left compatibility entry)
→ LegacyWorkspace
→ ActionPresetPanel
→ PresetParameterForm
→ actionPresetStore.apply
→ EditorProjectStore / shotStore / selectionStore snapshot
→ createPresetEvents
→ validatePresetApplication
→ applyPresetEvents
→ editorProjectStore.updateProject
→ HistoryStore + revision/dirty state
→ save project.json / timelineEvents
```

The current formal files are:

- [`ActionPresetPanel.tsx`](../src/renderer/features/actions/ActionPresetPanel.tsx)
  — eight buttons, local active preset/form state, and status feedback;
- [`actionPresetStore.ts`](../src/renderer/features/actions/actionPresetStore.ts)
  — selection/shot/lock/background guards and the single project write path;
- [`ActionPreset.ts`](../src/domain/actions/ActionPreset.ts) and
  [`createPresetEvents.ts`](../src/domain/actions/createPresetEvents.ts)
  — preset definitions and TimelineEvent creation;
- [`applyPresetEvents.ts`](../src/domain/actions/applyPresetEvents.ts) and
  [`timeline-event.ts`](../src/domain/models/timeline-event.ts)
  — validated persistence model;
- [`evaluate-shot-at-time.ts`](../src/domain/evaluate-shot-at-time.ts)
  — formal time evaluator;
- [`ProductPreviewOverlay.tsx`](../src/renderer/shell/ProductPreviewOverlay.tsx)
  — read-only product preview that evaluates the loaded project over time;
- [`stageRenderModel.ts`](../src/domain/selectors/stageRenderModel.ts) and
  [`features/canvas/CanvasStage.tsx`](../src/renderer/features/canvas/CanvasStage.tsx)
  — current editor canvas path.

The current `CanvasStage` calls `buildEditorStageRenderModel(project, shot)`,
which constructs render instructions from the base layer fields. It does not
call `evaluateShotAtTime` for the editor's current timeline position. The
formal evaluator is used by the read-only Product Preview path and by the
ActionPreset event factory when it needs the state at an event's start time.

This gives a precise boundary:

- **Known working:** the event factory, validation, project update, history,
  revision/dirty semantics, serialization, and formal evaluator have direct
  unit/integration coverage.
- **Known human fact:** the owner saw a short flash and could not reliably
  observe a complete action after Apply.
- **High-confidence hypothesis, not yet an audit receipt:** the normal editor
  canvas's base-layer render path does not visibly replay the newly persisted
  timeline event, which explains why writing an event and seeing a stable
  action can diverge. #159 must confirm the actual runtime boundary before any
  fix is designed.
- **Not yet verified:** whether the parameter draft is invalidated or remains
  correctly bound when a user changes from editable Layer A to editable Layer B
  before Apply. Do not infer a PASS from source-level tests.

The exact C3 scenario to add when human acceptance resumes is:

```text
select editable Layer A
→ open Move To
→ enter a recognizable draft target (for example x=400, y=300)
→ before Apply, switch selection to editable Layer B
→ press Apply if the UI still permits it
```

Required invariant: the draft is invalidated/closed or remains explicitly
bound to Layer A; it must never silently apply to Layer B or create unintended
Layer-B history/revision. Repeat across project A → B if the form remains
mounted. This is the transferred #129 C3 item, currently NOT VERIFIED.

Do not build a complete Timeline/Premiere-style system merely because this gap
exists. The minimum #141 direction is stable repeatable preview, friendly
parameters, and clear object semantics; the implementation boundary must be
chosen after the read-only #159 audit.

## 5. Windows Electron acceptance method

### Test data and launch modes

Use disposable project data under `D:\PandaStage-Acceptance\`. Do not use a
user's real project for destructive close/save tests.

Normal source mode uses the real package script:

```powershell
pnpm install
pnpm dev
```

There is no current `dev:debug` or `dev:gate-a` package script. The source
flags are parsed from the URL by [`useDebugFlag.ts`](../src/renderer/shell/useDebugFlag.ts):

```powershell
# PowerShell window A
pnpm dev:renderer

# PowerShell window B, after port 5173 is ready
pnpm build:electron
$env:VITE_DEV_SERVER_URL = 'http://localhost:5173/?debug=1'
pnpm exec electron dist-electron/main/index.js
```

Replace `?debug=1` with `?gateA=1` for the visible source Gate-A probe. The
debug flag mounts the debug probe surface; `gateA=1` suppresses the product
surface and mounts `StagePreview`. These are source UI modes, not substitutes
for the packaged Gate A verifier.

For packaged acceptance:

```powershell
pnpm dist
pnpm verify:gate-a
```

The verifier uses `release/win-unpacked/Panda Stage.exe`, bundled
`resources/media/ffmpeg.exe` and `ffprobe.exe`, and writes machine evidence
under `docs/evidence/gate-a/`. It sets its own packaged Gate-A environment;
do not guess a second manual packaged protocol. To launch the unpacked product
visibly, run `release\win-unpacked\Panda Stage.exe` after `pnpm dist`.

### What must be visibly checked by a person

Headless tests, source assertions, screenshots, and green CI do not replace a
visible Windows Electron acceptance. For ordinary product and Stage 4
regressions, use this minimum sequence:

1. Create/open a disposable project and make a recognizable edit.
2. Exercise Undo and Redo and confirm the intended layer/background state.
3. Save, close, reopen, and confirm the edit persists.
4. Make another dirty edit and use native close **Cancel**; the window and edit
   must remain.
5. Repeat native close with **Save**; close is allowed only after a successful
   save, and reopening must show the saved edit.
6. Repeat with **Discard**; reopening must show the last formally saved state.
7. Open/close a clean project; no dirty prompt should appear.
8. Exercise background protection, ordinary layer movement, layer selection,
   and locked-layer behavior.
9. During any autosave sync/error state, a disappearing window or unacknowledged
   mutation is FAIL.

For Stage 3-B specifically, B1/B2 are already recorded PASS, while B3/B4 are
BLOCKED and B5–B12 are NOT RUN. Do not silently convert this document into a
new acceptance receipt. When the owner explicitly resumes it, record the
target-switch C3 scenario above in addition to action visual result, timing,
Undo/Redo, Save/Reopen, invalid/background/locked guards, and project A → B → A
isolation.

Supported narrow-window/layout checks may use a real visible Electron window
at the repository's covered sizes (1280×720, 1024×720, 800×720, and 800×560),
or an equivalent visible Windows session when a cloud desktop cannot resize
the window directly; record that limitation. Screenshot-only or headless
evidence cannot replace interaction, persistence, native-close, or visual
ActionPreset/playback acceptance.

## 6. Run, test, CI, and packaging commands

The authoritative script list is [`package.json`](../package.json). Current
core commands are:

```powershell
pnpm install
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dist
pnpm verify:gate-a
pnpm dev
```

The current repository has no standalone `verify:day25`; ActionPreset
coverage is in the existing domain/action unit tests, action-preset history
integration tests, editor-shell/right-inspector contracts, and the normal CI
chain. Applicable repository gates are the scripts named `verify:day13`,
`verify:day14`, `verify:day16` through `verify:day24`, `verify:m1`,
`verify:issue73`, `verify:issue76`, `verify:issue102-task1` through
`verify:issue102-task4`, and `verify:issue109-resource-workspace`.

The CI classifier and docs-only fast path are defined in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). A Markdown-only
handoff change under `docs/` receives whitespace, docs-only scope, and
relative-link validation. A production/configuration/test change is not a
docs-only change and must not be hidden inside this handoff.

Useful direct evidence paths are [`docs/test-receipts/M3.md`](./test-receipts/M3.md),
[`docs/test-receipts/GATE-A.md`](./test-receipts/GATE-A.md),
[`docs/handoff/HANDOFF-M3-STAGE-1B-2026-08-01.md`](./handoff/HANDOFF-M3-STAGE-1B-2026-08-01.md),
and [`docs/decisions/M3-FAILURE-REPORT.md`](./decisions/M3-FAILURE-REPORT.md).
They are historical receipts; reconcile them with live GitHub and current main
before relying on a claim.

## 7. Governance boundaries and stop-loss

For the successor agent:

- Do not treat Draft, Open, non-Draft, or Unmerged as Ready or merged.
- Do not use CI green as a substitute for real Windows Electron acceptance.
- Do not merge, mark Ready, or close an Issue/PR without explicit maintainer
  authority and the required receipt.
- Do not unfreeze Day 26–45 or declare M3 PASS while Stage 3-B remains
  incomplete.
- Do not modify PR #128 merely to make this handoff easier to write.
- Do not implement #141 while #159 is only authorized as a read-only audit.
- Do not modify production code, tests, schema, timeline/evaluator, IPC,
  preload, assets, or package scripts under Issue #160.
- If local files, GitHub state, and older documents disagree, re-check the
  current GitHub object, current `main`, and reproducible receipts; record the
  full SHA and source of the conclusion.
- Preserve `.workbuddy/` and its local-only `.git/info/exclude` rule. Never
  copy its state into repository documentation or `.gitignore`.

Stop immediately if live main/open PR/open Issue differs materially from this
document, if a production edit appears necessary, if a high-cost full matrix
would be needed only to fill a documentation gap, or if a conclusion cannot
be separated from historical speculation. Record the conflict, verified fact,
missing evidence, and maintainer decision required; do not fill the gap with
an assumption.

## 8. New agent's first hour

1. `git fetch origin main`.
2. Verify `git ls-remote origin refs/heads/main` against the local full SHA.
3. Verify `git status --short --branch` and preserve any unknown user work.
4. Read this handoff end to end.
5. Re-read live [#141](https://github.com/Cognitive-Architect/panda-stage/issues/141),
   [#159](https://github.com/Cognitive-Architect/panda-stage/issues/159),
   [#127](https://github.com/Cognitive-Architect/panda-stage/issues/127), and
   [#128](https://github.com/Cognitive-Architect/panda-stage/pull/128).
6. List current open Issues/PRs and check whether #129 C3 has moved from
   NOT VERIFIED.
7. Execute only the one authorized next action in Section 9.
8. Do not continue from an old screenshot, old SHA, stale worktree, or a
   historical plan without a fresh live-state check.

## 9. The one recommended next action

As of the verification above, the single next action is:

> **Execute Issue #159's read-only ActionPreset preview/render gap audit: trace and document the current runtime boundary and minimum safe fix boundary, then post a factual receipt before deciding any #141 implementation or resuming Stage 3-B human acceptance.**

No production code change, PR #128 merge, M3 declaration, or Day 26–45 work is
part of that next action.
