# Panda Stage FLA Workbench — Stage G Terminal States Design Model v1

Date: 2026-09-02  
Status: **Maintainer design baseline / docs-only**  
Product mode: **Operate**  
Design method: **Impeccable Shape + Distill**  
Design ancestry: PR #389, PR #401  
Implementation research baseline: PR #393 @ `2347a809cab3b452289cad15b19c987fe06b6227`

---

## 1. Purpose

This document freezes the product and presentation model for **Stage G — Confirm / Commit / Success** in the Panda Stage FLA Workbench.

Stage G is the terminal layer of the current FLA workflow. Its purpose is not to introduce a new parser, renderer, commit engine, or top-level route. The existing implementation already owns mature commit behavior for:

- direct raster / bitmap import;
- Static Snapshot import;
- Frame Sequence import;
- duplicate reuse;
- safe naming;
- Project revision checks;
- stale preview / stale sequence rejection;
- file writes and rollback;
- post-save consistency checks;
- Project / Renderer store synchronization.

The product problem is therefore narrower:

> **After the user has chosen valid content, Stage G must make the final commit feel deliberate, understandable, safe, and finished.**

Today, the business actions are real, but their terminal presentation is fragmented. Success often appears as one more status line appended to a still-complex workbench. Error handling also risks treating materially different failures as the same generic “retry” case.

Stage G should converge those terminal experiences without replacing the independent B / D / E business owners underneath.

---

## 2. What Stage G is — and is not

Stage G is a **cross-cutting terminal presentation layer** over existing routes.

It is not a fourth top-level FLA route.

Current routing remains:

```text
inspection failed
→ blocked

success + media.length > 0
→ v1-raster-review

success + media.length === 0
→ v2r-target-discovery
```

Stage G is reached from existing usable flows when the user has a legitimate commit candidate.

Conceptually:

```text
Stage B raster selection
        │
        └─ confirmed selection intent
                 │
                 ▼
              Stage G

Stage D Static Snapshot
        │
        └─ latest accepted preview
                 │
                 ▼
              Stage G

Stage E Frame Sequence
        │
        └─ latest accepted sequence
                 │
                 ▼
              Stage G
```

The three entry authorities are intentionally different.

That difference must remain.

---

## 3. Core architecture decision

### Decision G-A — Do not create one universal Stage G business state machine

The existing B / D / E state owners encode different business truths.

#### Direct Raster / Stage B

The user explicitly confirms a frozen selection intent before commit.

Current conceptual state flow:

```text
ready
→ confirmed
→ committing
→ success
```

Changing selection after confirmation invalidates the old confirmation and returns the route to the selection step.

#### Static Snapshot / Stage D

There is no independent business `confirmed` state equivalent to Stage B.

Commit authority is the **latest accepted preview** pinned by request identity and preview metadata.

Conceptually:

```text
select target/frame
→ preview
→ preview-ready
→ committing
→ committed
```

The Main process rejects stale candidates with `STALE_PREVIEW` before file mutation.

#### Frame Sequence / Stage E

There is no Stage-B-style confirmation state here either.

Commit authority is the **latest accepted sequence**, pinned by request identity, range, and per-frame metadata.

Conceptually:

```text
select target/range
→ render sequence
→ preview-ready
→ committing
→ committed
```

The Main process rejects stale candidates with `STALE_SEQUENCE` before file mutation.

### Frozen consequence

Do **not** replace these three owners with:

```text
UniversalStageGStateMachine
ready
confirmed
committing
success
error
```

That would erase real differences in commit authority.

Stage G should unify **presentation language**, not business ownership.

Plain-language analogy:

> Three restaurants may use the same receipt design without sharing one kitchen, one cash register, and one accounting ledger.

---

## 4. Current business truth discovered in code

### 4.1 Direct Raster commit

Relevant implementation families:

- `FlaCompatibilityReviewSession.tsx`
- `fla-asset-commit-api.ts`
- `FlaAssetCommitService.ts`
- renderer commit adapter / Asset Library callback
- `EditorProjectStore`

The Raster commit response already owns authoritative summary facts:

```text
selectedCount
importedCount
duplicateCount
renamedCount
```

The Main commit path already owns:

```text
Project revision validation
session validation
source identity validation
deduplication
safe filename allocation
commit journal
temporary write
finalize
Project save
consistency verification
rollback on failure
```

This is mature commit infrastructure. Stage G must not replace it.

### 4.2 Static Snapshot commit

Relevant implementation families:

- `FlaStaticSnapshotReview.tsx`
- `fla-static-snapshot-api.ts`
- `FlaStaticSnapshotCommitService.ts`
- renderer commit adapter / Asset Library callback
- `EditorProjectStore`

The successful response already owns:

```text
status = imported | duplicate
targetFileName
renamed
duplicateOfAssetId
asset metadata
```

The Main commit path already checks:

```text
latest accepted preview
preview metadata identity
source identity
Project revision
bounded PNG validity
SHA-256 deduplication
safe filename allocation
Project save
post-save Project/file/hash consistency
```

The accepted preview is released only after a successful commit.

### 4.3 Frame Sequence commit

Relevant implementation families:

- `FlaFrameSequenceReview.tsx`
- `fla-frame-sequence-api.ts`
- `FlaFrameSequenceCommitService.ts`
- renderer commit adapter / Asset Library callback
- `EditorProjectStore`

The successful response already owns:

```text
requestedFrameCount
importedCount
duplicateCount
renamedCount
netNewImageAssetCount
ordered per-frame result mapping
```

The Main commit path already checks:

```text
latest accepted sequence
confirmed request identity
per-frame echoed metadata
per-frame bounded PNG validity
per-frame deduplication
safe filename allocation
Project transaction
post-save Project/file/hash consistency
rollback / cleanup on failure
```

The accepted sequence is released only after successful commit.

### 4.4 Renderer / Project synchronization

The three successful routes eventually synchronize through the existing Asset Library / Project Store path.

An important existing boundary is revision-aware Project reconciliation:

- when the renderer Project has not changed during commit, the Main-saved Project can be accepted directly;
- when the user has made newer edits while the commit was in flight, the store preserves current edits and reconciles imported assets instead of overwriting the newer renderer state with an older snapshot.

Stage G must not weaken, replace, or bypass this behavior.

---

## 5. Product thesis — complexity should fall as the task finishes

Stage G is an **Operate** surface.

The user is not here to study implementation details. They want to know:

1. Did Panda accept my final action?
2. Is it still working?
3. Did it finish?
4. What exactly happened?
5. If it failed, what should I do next?

The terminal experience should become progressively calmer:

```text
selection / review     ████████
commit-ready           █████
G1 importing           ███
G2 success             ██
```

This is a deliberate product rule:

> **The closer the user is to completion, the less interface they should need.**

Successful completion should not leave the user staring at the same dense selection controls plus one new status line.

---

## 6. Stage G visual-state model

Stage G should be presented through three material terminal states:

```text
G1 — Importing
G2 — Success
G3 — Error / recovery
```

These labels are design / implementation terminology. They do not need to appear literally in user-facing UI.

The three states share a stable FLA Workbench identity, but the amount of visible task UI changes deliberately.

---

# 7. G1 — Importing

## 7.1 User job

Understand that the final commit has started, avoid contradictory interaction, and wait without being shown invented progress.

## 7.2 Entry

G1 begins only after an existing route has produced a legitimate commit candidate and the user activates its final import action.

Examples:

```text
B
confirmed selection
→ Import N items
→ G1

D
latest accepted preview
→ Import current frame
→ G1

E
latest accepted sequence
→ Import frame sequence
→ G1
```

## 7.3 Presentation direction

The workbench should visibly enter a commit-in-progress mode.

Preferred behavior:

- preserve the recognizable FLA Workbench shell;
- freeze task-changing controls;
- reduce the visual authority of old selection / preview controls;
- show one clear importing status;
- keep only truthful source / commit-context facts that help orientation;
- use restrained state motion only if it communicates waiting.

Conceptual examples:

### Raster

```text
正在导入 67 项位图素材…
Panda Stage 正在安全写入项目。
```

### Snapshot

```text
正在导入当前帧…
小黑子 · 第 12 帧
```

### Sequence

```text
正在导入 24 帧序列…
范围 0–23
```

Exact copy can be refined later. The product law is more important than the literal sentence.

## 7.4 No fake commit percentage

The current commit APIs do not expose authoritative percentage progress for the final write / Project commit operation.

Therefore G1 must **not** invent:

```text
32%
67%
92%
```

or a determinate progress bar that implies real backend measurement.

This is separate from Stage E sequence **rendering**, where a real `completedFrameCount / totalFrameCount` progress channel exists.

Do not reuse render progress to fake commit progress.

Allowed:

- an indeterminate but restrained activity indicator;
- honest text such as `正在导入…`;
- route-owned real facts such as requested item/frame count.

## 7.5 No invented commit cancellation

Current final commit paths do not expose a general user-facing “cancel commit and safely unwind immediately” contract.

Therefore G1 must not add a fake `取消导入` action merely for symmetry.

If a later business slice adds an authoritative cancellable commit contract, the presentation may be revisited separately.

## 7.6 Interaction lock

Existing behavior already blocks close / task mutation during `committing` in relevant surfaces.

Stage G presentation must preserve that business truth.

Do not permit:

- changing selected raster items;
- changing Snapshot target / frame;
- changing Sequence target / range;
- rerendering while final commit is active;
- starting a second simultaneous commit from the same candidate.

## 7.7 Accessibility

The importing state should use a polite live region for meaningful status changes.

Do not create repetitive announcements on decorative animation ticks.

---

# 8. G2 — Success

## 8.1 User job

Know that the operation is complete, understand the few outcome facts that matter, and leave the workflow confidently.

## 8.2 Core presentation law

> **Success is a terminal receipt, not another line on the existing editor.**

When commit succeeds, the old task controls have completed their job.

Therefore the primary work area should simplify aggressively.

The Workbench shell may remain for continuity, but the selection / target / frame / range / filmstrip controls should no longer dominate the page.

Conceptually:

```text
┌─────────────────────────────────────────────────────────────┐
│ FLA 素材工作台                                  source.fla  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                           ✓                                 │
│                                                             │
│                      素材导入完成                            │
│                                                             │
│               meaningful authoritative receipt              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                         [ 返回素材库 ]      │
└─────────────────────────────────────────────────────────────┘
```

This is a state transformation inside the same product context, not a new top-level FLA route.

## 8.3 One primary action

The default success state should expose one obvious next action:

```text
返回素材库
```

Do not add speculative secondary actions such as:

- `继续导入另一个 FLA` unless an existing owned operation supports it cleanly;
- `打开文件夹` unless product policy already owns that action;
- `复制路径` unless there is a real recurring user need;
- `再次导入` by default.

The success screen is for closure, not feature accumulation.

## 8.4 Success color

Use the existing Panda Stage visual system.

Green / accent should be reserved for:

- success state marker;
- the most important successful result where useful;
- the one primary exit action.

Do not turn the whole page bright green.

Do not use celebration confetti, fireworks, scorekeeping, or exaggerated reward language.

This is a production tool.

## 8.5 Do not retain obsolete workflow progress

During Raster selection, the header progress context:

```text
选择素材 → 确认选择 → 导入素材
```

is useful.

After G2 success, repeating three completed green checkmarks is unnecessary if the completion receipt already clearly communicates finality.

Prefer removing / demoting progress UI in the success composition.

## 8.6 Success facts are route-specific

The **receipt structure** should be shared where useful; the **facts** must remain authoritative to each route.

Do not force all three routes to say only:

```text
导入成功
```

### G2-B — Direct Raster receipt

Authoritative facts available today:

```text
selectedCount
importedCount
duplicateCount
renamedCount
```

Preferred hierarchy:

```text
✓ 素材导入完成

新增 61 项
复用已有素材 6 项
重命名 2 项        (only when > 0)

共处理 67 项

[返回素材库]
```

Rules:

- hide zero-value secondary facts when they add no useful information;
- do not make `0 项新增` sound like failure when every item was legitimately reused;
- if all items are duplicates, lead with a positive reuse outcome.

Example all-duplicate treatment:

```text
✓ 已完成

67 项均已存在于素材库
已复用已有素材，没有创建重复文件
```

### G2-D — Static Snapshot receipt

Authoritative facts available today:

```text
status = imported | duplicate
targetFileName
renamed
```

The Workbench must distinguish a new asset from a reused duplicate.

#### New asset

```text
✓ 当前帧已导入

小黑子-frame0012.png

[返回素材库]
```

#### Duplicate / reused

```text
✓ 已复用已有素材

小黑子-frame0012.png
没有创建重复文件

[返回素材库]
```

Do not use generic `已导入：filename.png` for the duplicate case.

If `renamed=true`, the final authoritative `targetFileName` is the truth shown to the user. A small bounded note such as `已自动避免重名` may be shown if it improves understanding.

Do not expose internal IDs or SHA hashes in the primary success composition.

### G2-E — Frame Sequence receipt

Authoritative summary facts available today:

```text
requestedFrameCount
importedCount
duplicateCount
renamedCount
netNewImageAssetCount
```

Preferred hierarchy:

```text
✓ 帧序列导入完成

新增 20 帧
复用已有素材 4 帧
重命名 2 帧        (only when > 0)

共处理 24 帧
范围 0–23

[返回素材库]
```

All-duplicate treatment should remain positive and explicit:

```text
✓ 帧序列已处理

24 帧均复用了已有素材
没有创建重复文件
```

The Workbench and outer Asset Library status should use the same beginner-facing language family. Avoid the current mixed-language outcome where the Workbench is Chinese while a parent status reports English prose.

## 8.7 Source immutability / recovery copy

Do not automatically repeat `原 FLA 文件没有被修改` in every success receipt solely because it is true.

It may remain as quiet supporting status where it materially reassures the user, especially when recovery was applied earlier.

Avoid repeating the same immutability truth in multiple permanent locations.

---

# 9. G3 — Error / recovery

## 9.1 User job

Understand what failed, know whether the current candidate is still valid, and receive exactly one truthful next action.

## 9.2 Core law

> **Not every commit error is “Retry”.**

The current APIs expose typed error codes with materially different meanings.

Stage G must not flatten them into:

```text
导入失败，请重试
[重试]
```

if the same request is already known to be stale, invalid, or unsafe to repeat.

## 9.3 Error presentation classes

G3 should visually converge errors into a small number of product classes while preserving authoritative technical codes underneath.

The following model is design guidance. Implementation must verify each route's exact owned recovery operation before wiring actions.

---

### G3-A — Candidate stale / no longer commit-eligible

Examples:

```text
STALE_PREVIEW
STALE_SEQUENCE
```

These errors mean the previously visible candidate is no longer the authoritative commit candidate.

The UI must **revoke the old candidate's visible import eligibility**.

#### Snapshot

Preferred message:

```text
当前预览已失效

为了避免导入错误的帧，请重新生成当前帧预览。

[重新预览]
```

The old `导入当前帧` action must not remain active against the same stale preview.

#### Sequence

Preferred message:

```text
当前帧序列已失效

请重新生成序列后再导入。

[重新生成]
```

The old `导入帧序列` action must not remain active against the same stale sequence.

This is a UX correctness rule, not a request to weaken or replace Main stale guards.

Main remains authoritative.

---

### G3-B — Project revision stale

Example:

```text
STALE_PROJECT_REVISION
```

The current commit request was built from an out-of-date Project revision.

A blind immediate retry of the exact same request is not a legitimate recovery because it still carries the old base revision.

Preferred product treatment:

```text
项目在导入期间发生了变化

Panda 没有使用旧项目状态继续写入。
请先回到最新项目状态，再重新完成导入。
```

The exact action depends on existing owned refresh / reopen behavior.

Implementation must not invent Project-revision mutation inside Stage G.

If the current product has no safe inline refresh operation, prefer a clear return / reopen path over a fake `重试` button.

---

### G3-C — Candidate may remain usable, operation did not complete

Examples may include bounded generic failures such as:

```text
ASSET_COMMIT_FAILED
COMMIT_BUSY
```

The candidate may still exist after these failures because accepted preview / sequence / inspection session release happens on successful commit.

However, Stage G must not assume every generic failure is guaranteed to succeed on immediate retry.

Allowed treatment:

```text
没有完成导入

当前选择/预览仍然保留。

[重新尝试]
```

only where the route verifies that the candidate is still current and the same commit operation is still valid.

If that cannot be proven, fall back to the safer route-specific recovery action.

---

### G3-D — Input / target / range no longer valid

Representative typed errors include:

```text
SESSION_NOT_FOUND
SOURCE_MISMATCH
TARGET_UNSUPPORTED
TARGET_OUT_OF_RANGE
RANGE_OUT_OF_BOUNDS
BUDGET_EXCEEDED
```

These should not be presented as generic transient failures.

The recovery action should return the user to the earliest valid step required by the error truth:

- re-inspect source;
- choose another supported target;
- adjust frame / range;
- regenerate preview / sequence;
- return to Asset Library if the session is no longer valid.

Do not expose these raw enum labels in primary UI.

---

### G3-E — Commit aftermath is not safely confirmed

High-severity examples:

```text
ROLLBACK_FAILED
JOURNAL_RECOVERY_FAILED
```

and any response where residual file paths are materially reported.

This is qualitatively different from an ordinary retry-safe failure.

Preferred product treatment:

```text
⚠ 导入未能安全完成

Panda Stage 没能确认所有导入痕迹都已安全恢复。
建议暂时不要继续导入这个 FLA。

[查看技术详情]

[返回素材库]
```

Rules:

- do not offer an eager primary `重试` action;
- keep raw residual paths out of the default primary scan path;
- preserve exact residual path / diagnostic detail under progressive technical disclosure where appropriate;
- do not claim `项目没有被修改` unless current authoritative truth supports that claim;
- do not weaken rollback / journal behavior to simplify the UI.

This is the one Stage G error class allowed to carry stronger warning authority because the safety outcome itself is uncertain.

---

## 9.4 Error color and hierarchy

Do not make every G3 state a full red screen.

Suggested severity behavior:

```text
candidate stale / project stale / ordinary recoverable failure
→ restrained warning / error treatment inside the Workbench context

rollback / recovery uncertainty
→ stronger dedicated warning composition
```

Severity should also be conveyed through:

- what controls remain available;
- which old candidate actions disappear;
- how much of the workbench is occupied by the message;
- whether the user is allowed to continue normally.

Do not rely on color alone.

---

# 10. Shared presentation model — what may be unified

Stage G may share a presentation adapter / receipt model that converts route-specific authoritative responses into a stable visual vocabulary.

Conceptually:

```text
Raster commit response ───────┐
Snapshot commit response ─────┼─→ Stage G presentation adapter
Sequence commit response ─────┘
                                      │
                                      ├─ importing copy
                                      ├─ success receipt
                                      └─ error recovery model
```

A shared receipt model might conceptually own presentation facts such as:

```text
route
headline
outcome kind
processed count
imported count
reused count
renamed count
final filename
frame / range context
primary next action label
severity
```

This is an implementation direction, not a requirement to create one exact TypeScript interface.

The key boundary is:

> **Share formatting and composition, not commit authority.**

---

# 11. What must remain route-owned

The following remain under existing business owners:

### Raster

- selection set;
- confirmation intent;
- selected media IDs;
- explicit selection-confirmation boundary;
- raster commit request and response contract.

### Snapshot

- selected target / frame;
- latest accepted preview authority;
- stale-preview guard;
- snapshot commit request and response contract.

### Sequence

- selected target / range;
- latest accepted sequence authority;
- sequence generation progress / cancellation;
- stale-sequence / latest-request guard;
- 24-frame cap;
- sequence commit request and response contract.

### Shared lower layers

- Main Project transactions;
- temp/final file writes;
- deduplication;
- safe naming;
- rollback / journal recovery;
- post-save consistency checks;
- EditorProjectStore reconciliation.

---

# 12. Information hierarchy for terminal states

Stage G should prioritize information in this order:

## G1 Importing

1. operation is actively committing;
2. what is being committed;
3. quiet source/context identity;
4. nothing else unless actionable.

## G2 Success

1. success / completion;
2. meaningful result facts;
3. one next action;
4. optional secondary reassurance.

## G3 Error

1. what kind of recovery situation the user is in;
2. whether the current candidate is still valid;
3. one truthful next action;
4. technical detail only when needed.

---

# 13. Deletion-first rules

Stage G implementation should remove obsolete task complexity rather than re-boxing it.

On success, strongly consider removing / demoting:

- raster grid;
- selection filters;
- pagination;
- target lists;
- frame inputs;
- sequence range controls;
- filmstrip;
- preview regeneration controls;
- compatibility detail unrelated to the final outcome;
- completed progress rails;
- repeated read-only / source-immutability statements;
- developer diagnostics.

The user should not need a completed shopping cart after checkout.

Do not delete facts required to understand the authoritative result.

---

# 14. Motion

Stage G may use restrained motion to communicate state transition.

Allowed examples:

- 150–250 ms fade / crossfade from active Workbench to receipt;
- subtle indeterminate importing indicator;
- short success-state transition.

Avoid:

- celebration choreography;
- long page-transition sequences;
- fake progress animation;
- decorative motion unrelated to state.

Motion must remain secondary to task clarity.

---

# 15. Touch / Cloud-PC requirements

Primary target remains the accepted landscape environment:

```text
Windows Electron
→ Aliyun Wuying
→ Redmi K60 Ultra
→ Cloud Touch landscape
```

Consequences:

- primary actions remain touch-safe;
- G3 disclosure controls cannot be tiny desktop-only links;
- success receipt should not require precise pointer interaction;
- long Chinese / ASCII source and resulting filenames must truncate safely;
- no nested scrolling traps in terminal states;
- technical detail disclosure should not become the primary scroll owner unless explicitly opened.

---

# 16. Language consistency

Stage G should use one beginner-facing language family across:

- Workbench terminal state;
- Asset Library post-import status;
- route-specific success adapter.

Do not produce cases where:

```text
Workbench: 已新增 20 帧素材，复用已有素材 4 帧。
Asset Library: Imported 20 frame(s); reused 4 existing asset(s).
```

unless the whole product has intentionally switched locale.

The authoritative facts may come from separate route adapters, but the user-facing phrasing should feel like one Panda Stage product.

---

# 17. Exact facts vs friendly copy

Friendly copy must never override response truth.

Examples:

### Correct

```text
status=duplicate
→ 已复用已有素材
```

### Incorrect

```text
status=duplicate
→ 已导入新素材
```

### Correct

```text
renamed=true
→ show authoritative final targetFileName
```

### Incorrect

```text
renamed=true
→ keep showing a preferred filename that was not actually written
```

### Correct

```text
STALE_PREVIEW
→ current preview no longer import-eligible
```

### Incorrect

```text
STALE_PREVIEW
→ keep old import CTA enabled and ask the user to press it again
```

---

# 18. Stage G blueprint matrix

The next high-fidelity artifact should cover at least these material states:

```text
G1-A  Importing — Direct Raster
G1-B  Importing — Render route representative state

G2-A  Success — Raster mixed imported/reused
G2-B  Success — Snapshot imported
G2-C  Success — Snapshot duplicate/reused
G2-D  Success — Sequence mixed imported/reused

G3-A  Recoverable generic commit failure
G3-B  STALE_PREVIEW / requires re-preview
G3-C  STALE_SEQUENCE / requires re-generation
G3-D  STALE_PROJECT_REVISION / cannot blind-retry same request
G3-E  ROLLBACK_FAILED / recovery uncertainty
```

A single presentation sheet may visually combine representative G1/G2/G3 states, but implementation acceptance must still cover the route-specific business truths above.

---

# 19. High-fidelity acceptance questions

Before opening a Stage G implementation issue, the blueprint should allow the maintainer to answer **yes** to all of the following:

1. Does G1 clearly communicate “the final commit has started” without fake percentage progress?
2. Does G1 avoid presenting a fake cancel action that the backend does not own?
3. Does G2 feel materially calmer than the selection / preview states?
4. On G2, are old controls gone or visually retired rather than still competing with the result?
5. Does Raster success distinguish imported / reused / renamed counts using real response data?
6. Does Snapshot success distinguish `imported` from `duplicate`?
7. Does Sequence success report meaningful new/reused frame outcomes without dumping per-frame internals by default?
8. Is there one obvious primary action after success?
9. Does G3 distinguish stale candidate, stale Project, ordinary failure, and rollback/recovery uncertainty?
10. Does a stale preview / sequence visibly lose its old import eligibility?
11. Are developer error codes and residual paths progressively disclosed instead of dumped into the primary UI?
12. Does the design preserve B / D / E independent business owners?
13. Does the design avoid inventing new parser, renderer, Project, or commit capabilities?
14. Can a Cloud Touch user operate the terminal states comfortably?
15. Does the success / error language remain consistent with the rest of Panda Stage?

---

# 20. Suggested implementation sequence after blueprint approval

This document does **not** authorize implementation by itself.

After maintainer approval of the high-fidelity blueprint, a Stage G implementation issue should preferably sequence work as:

```text
0. re-fetch exact PR #393 HEAD
1. add / consolidate shared terminal presentation formatting only
2. implement G1 importing presentation without business-owner changes
3. implement G2 success receipt for Raster
4. implement G2 success receipt for Snapshot
5. implement G2 success receipt for Sequence
6. implement typed G3 recovery presentation
7. add stale-candidate local eligibility invalidation where required
8. run B / D / E real Electron commits and regressions
9. stop for maintainer visual acceptance
```

If the Stage G implementation issue finds that a proposed presentation requires a new business capability, stop and split that decision explicitly.

---

# 21. Validation expectations for future implementation

Future Stage G implementation should use real Windows Electron evidence for at least:

## Raster

```text
confirmed selection
→ importing
→ success
```

with a mixed imported / duplicate fixture if available.

Verify:

- summary matches authoritative response;
- Project/store asset counts match;
- source FLA unchanged;
- success state is terminal;
- no stale selection controls remain dominant.

## Snapshot

Test both:

```text
new asset
existing duplicate
```

Verify:

- wording differs correctly;
- final filename is authoritative;
- stale preview cannot remain import-eligible after `STALE_PREVIEW`.

## Sequence

Test:

```text
mixed imported/reused sequence
```

Verify:

- requested / imported / reused counts match response;
- range remains truthful;
- `MAX_SEQUENCE_FRAMES = 24` unchanged;
- stale sequence cannot remain import-eligible after `STALE_SEQUENCE`.

## Error aftermath

At least one typed error path should prove that the next action changes according to error meaning rather than rendering one generic retry control.

High-severity rollback / recovery uncertainty should be tested with controlled fault injection where existing test infrastructure already supports it; do not create unsafe production behavior merely to make a screenshot.

---

# 22. Explicit non-goals / stop gates

Stage G work must STOP if implementation would require changing any of the following without a separately approved engineering decision:

- top-level FLA routing;
- parser or parser closure;
- strict preflight / recovery security policy;
- ActionScript behavior;
- Static Snapshot renderer semantics;
- Frame Sequence renderer semantics;
- Project schema;
- Asset commit ownership;
- Main Project transaction model;
- journal / rollback semantics;
- deduplication semantics;
- safe filename allocation;
- EditorProjectStore revision reconciliation;
- Raster selection confirmation semantics;
- Snapshot latest-preview authority;
- Sequence latest-request / latest-sequence authority;
- source FLA immutability;
- sequence `MAX_SEQUENCE_FRAMES = 24`;
- F2 production reachability;
- mixed bitmap + rendered-content route policy;
- V2-S semantic import.

Stage G must not weaken safety to achieve visual consistency.

---

# 23. CI / delivery policy for future implementation

The existing FLA Workbench delivery policy remains in force:

- implementation continues on PR #393 unless the maintainer explicitly changes topology;
- PR #393 remains Draft / Open / Unmerged during normal slice implementation;
- use automatic CI risk routing;
- Targeted / Focused automatic PASS is sufficient during Draft development when selected;
- do not manually dispatch Full CI merely for extra confidence;
- formal exact-head Ready / Full validation remains required before eventual merge.

This document PR is docs-only and does not itself change PR #393.

---

# 24. Final frozen design laws

Stage G v1 is governed by these laws:

### Law 1 — Receipt, not debug status

A successful commit should become a deliberate terminal receipt rather than one more line under the old controls.

### Law 2 — Complexity falls toward completion

As the task finishes, UI complexity should decrease.

### Law 3 — Share presentation, not authority

Raster, Snapshot, and Sequence may share terminal visual language, but keep their existing commit owners and stale guards.

### Law 4 — No fake progress

Do not invent final commit percentages without authoritative backend progress.

### Law 5 — No fake cancel

Do not expose commit cancellation unless a real safe cancellation contract exists.

### Law 6 — Success copy follows authoritative result truth

Imported, reused, renamed, filename, count, and range must come from real responses.

### Law 7 — Not every error is Retry

A stale candidate, stale Project revision, generic failure, and rollback uncertainty must not collapse into one error CTA.

### Law 8 — Stale means no longer import-eligible

When Main says a preview or sequence is stale, the old candidate must visibly lose import authority.

### Law 9 — Recovery uncertainty earns stronger spatial authority

Only materially unsafe / unresolved commit aftermath may take over more of the terminal workbench.

### Law 10 — One next action

Every terminal state should make the next legitimate action obvious and avoid competing CTAs.

---

## 25. Human-readable summary

Stage G is the FLA Workbench's checkout and receipt layer.

The kitchens already work.

The remaining job is to make checkout feel like a finished product:

```text
G1
I pressed Import.
Panda is working.
Do not let me change the order mid-checkout.
Do not show fake percentages.

G2
It finished.
Tell me what was added, reused, or renamed.
Then give me one clean way back to the Asset Library.

G3
It did not finish.
Tell me whether the old candidate is still valid.
Give me the one recovery action that is actually truthful.
If rollback itself is uncertain, stop pretending this is a normal retry case.
```

That is the complete Stage G design thesis for the next blueprint and implementation phases.
