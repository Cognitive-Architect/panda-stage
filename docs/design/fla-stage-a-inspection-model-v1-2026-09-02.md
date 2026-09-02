# FLA Stage A — Inspection Model v1

Date: 2026-09-02

Status: **Research/design baseline — docs only**

Implementation status: **Not started by this document**

Research branch examined: `agent/issue-392-fla-v1-1`

Research exact HEAD: `e5b8fec69c445117035c0f028bfe4bcda093aca4`

Docs branch base: `main@f601b54a04134a6d96f59ec03d4a8daa0974c16b`

Related baselines: PR #389 (seven-state FLA model), PR #393 (current stacked FLA implementation branch), PR #401 (Stage F severity model).

---

## 1. Purpose

This document freezes the current understanding of **Stage A / Inspecting** before any visual or implementation optimization begins.

Stage A is not merely a loading screen. It is the product-facing transition over an existing inspection pipeline that already owns file selection, bounded source reading, strict preflight validation, compatibility-recovery gating, isolated parsing, IR validation, session creation, cancellation and final routing.

The goal of this document is to prevent later UI work from accidentally inventing progress, weakening safety boundaries, exposing parser internals, or treating user cancellation as a file failure.

This document changes **no production behavior**.

---

## 2. Stage A product job

The user job is deliberately narrow:

> "I chose an FLA. Panda is checking whether it can safely understand enough of the file to send me to the correct next workbench."

Stage A therefore has three terminal outcomes only:

```text
                 Stage A / Inspecting
                         |
                 正在检查 FLA
                         |
          +--------------+--------------+
          |              |              |
       SUCCESS          CANCEL         FAILURE
          |              |              |
          v              v              v
      B/C or D/E      Asset Library      F3
```

### Product invariant A-1

**Stage A MUST NOT become a separate confirmation or success page.**

A successful inspection should hand off directly to the correct downstream workbench.

### Product invariant A-2

**User cancellation is not a compatibility or safety failure.**

`USER_CANCELLED` must not be presented as F3 / Safe Blocked.

---

## 3. Verified current pipeline

The current code path is:

```text
AssetLibrary / open FLA review
  -> FlaInspectionLifecycle.start()
  -> window.pandaStage.fla.chooseAndInspect(requestId)
  -> Main-owned native file chooser
  -> bounded source read
  -> strict preflight
       -> pass: continue
       -> reject: recovery classifier
            -> RECOVERY_CANDIDATE only:
                 normalize Panda-owned in-memory copy
                 run the same strict preflight again
            -> REJECT / AMBIGUOUS: stop
  -> isolated parser BrowserWindow
  -> parser/adaptor emits Panda-owned AnimationImportIR
  -> schema validation + source identity validation
  -> Main retains successful inspection session
  -> Renderer receives final FlaInspectionResponse
  -> route by authoritative result
```

The established routing invariant remains:

```text
inspection failed -> blocked
success + media.length > 0 -> v1-raster-review
success + media.length === 0 -> v2r-target-discovery
```

Stage A does not own the downstream B/C/D/E business rules; it only hands off the authoritative inspection result.

---

## 4. Strict preflight is already substantial

The Main-owned preflight currently validates, among other things:

- bounded source size;
- source readability and file identity;
- ZIP/XFL container structure;
- local/central ZIP record consistency;
- unsafe, duplicate or ambiguous archive paths;
- encrypted entries;
- unsupported compression methods;
- ZIP64 / multi-disk forms outside the accepted envelope;
- entry-count and expanded-size budgets;
- per-entry and XML-size budgets;
- XML balancing and nesting depth;
- `DOMDocument.xml` presence;
- forbidden external XML resources / `DOCTYPE` / `ENTITY` style constructs;
- ActionScript-related content detection for later compatibility reporting.

### Product consequence

Stage A SHOULD communicate only the user-relevant fact that Panda is checking the file safely.

Stage A SHOULD NOT surface a checklist of archive/XML/parser internals in the normal UI.

Engineering facts remain engineering facts unless a later diagnostic surface explicitly needs them.

---

## 5. Compatibility recovery remains behind the inspection boundary

A strict-preflight rejection does not automatically permit repair.

Current recovery logic is gated by the recovery classifier. Only a `RECOVERY_CANDIDATE` can be normalized, and normalization is performed on a **Panda-owned in-memory copy**.

The normalized copy must then pass the **same strict production validator** before the parser is allowed to see it.

The original source is not rewritten by this process.

### Product consequence

Stage A MUST NOT claim:

```text
正在修复你的 FLA
```

A safer Stage A message is simply:

```text
正在检查 FLA
```

If a later successful state has authoritative recovery evidence, that downstream state may explain that Panda handled a compatibility issue and that the original source was not modified.

---

## 6. Isolated parser boundary is existing infrastructure, not Stage A UI scope

The FLA parser runs in a hidden isolated Electron BrowserWindow with a hardened boundary including sandboxing, context isolation, disabled Node integration, isolated partitioning, navigation/window restrictions and parser lifecycle timeouts/watchdogs.

The parser manager owns:

- worker-ready timeout;
- parser wall-time limit;
- no-progress watchdog;
- cancellation/termination grace;
- worker crash / malformed message handling.

### Product consequence

Stage A optimization SHOULD NOT rewrite or bypass this parser boundary.

Any parser/sandbox/security change discovered during UI work is a **stop gate** and must be split into its own engineering decision.

---

## 7. Internal parser progress exists, but it is not a product progress API

The parser currently emits raw progress strings such as:

```text
Extracting archive...
Parsing document...
Loading symbols... (3/27)
Loading images...
Encoding bitmap 8/67
Loading audio...
Loading videos...
Building timeline...
```

These messages travel from the isolated parser worker to Main and are currently consumed to refresh the parser no-progress watchdog.

The main Renderer FLA API does **not** currently expose an authoritative Stage A progress subscription.

The current progress payload is effectively:

```text
sessionId + message:string
```

It is not a stable product contract containing typed phases, current/total values or percentages.

### Stop gate A-Progress

Stage A v1 MUST NOT parse raw worker strings into product states, for example:

```text
if message includes "Loading images" -> show "Step 3/5"
```

Stage A v1 MUST NOT invent:

- percentages;
- `2/5` / `3/5` product steps;
- a fake overall scan count;
- parser-log-derived product phase names.

If richer progress is later desired, create a separate **Panda-owned typed inspection progress contract** first.

That contract must represent the whole inspection pipeline, not only parser-worker activity, because pre-parser work already includes source read, strict preflight, optional recovery classification/normalization and post-normalization strict validation.

---

## 8. Source basename is not currently available to Stage A Renderer state

The current Renderer-side inspection operation is centered on the request identity and final response. Native file selection occurs in Main, and the authoritative source identity arrives with the completed inspection result.

Therefore a presentation-only Stage A implementation does not currently have a reliable selected filename to show while inspection is in progress.

### Stop gate A-SourceIdentity

Stage A v1 SHOULD NOT display a guessed or synthetic filename during inspection.

If product design later requires:

```text
正在检查：foo.fla
```

then selected-source identity must first be added as an explicit Panda-owned handoff/contract from Main to Renderer.

---

## 9. Confirmed semantic gap: `USER_CANCELLED` versus F3

### Current code path

When the user opens the native file chooser and cancels without selecting a file, Main returns a bounded inspection response with:

```text
ok: false
error.code: USER_CANCELLED
```

Current review-session handling maps a non-`ok` inspection response into the error/blocked presentation path, while the Stage F3 component does not special-case `USER_CANCELLED`.

This creates a semantic mismatch:

```text
user chose "Cancel"
!=
Panda determined the FLA is unsafe/unreadable
```

### Required Stage A rule

`USER_CANCELLED` MUST be treated as a clean dismiss/return to the asset library, with no F3 Safe Blocked message.

### Expected terminal behavior

```text
Native picker cancel
  -> USER_CANCELLED
  -> close/dismiss FLA Workbench
  -> return to Asset Library
  -> no error banner
  -> no Safe Blocked state
```

By contrast, genuine inspection failures may continue to hand off to F3 according to the existing authoritative error model.

### Implementation acceptance requirement

A future Stage A implementation must add test coverage for native chooser cancellation and prove that `USER_CANCELLED` cannot render the F3 blocked composition.

---

## 10. Existing Workbench cancel lifecycle is stronger than the chooser-cancel handoff

The existing Renderer lifecycle already protects important cancellation races:

- repeated starts remain single-flight;
- stale results after cancel/reopen do not overwrite a new live operation;
- request and session identities can both be cancelled;
- if a session arrives after the UI operation has already been cancelled, cleanup can still cancel/release that session;
- repeated reopen is supported.

These lifecycle protections SHOULD be preserved.

Stage A optimization should not replace them with ad-hoc local component flags.

---

## 11. Cancellation responsiveness during synchronous preflight needs validation

This is a **risk / open validation item**, not a confirmed production bug.

Verified facts:

- bounded source read accepts an `AbortSignal`;
- parser stage has an explicit cancellation/termination mechanism;
- `preflightFlaBytes(...)` is synchronous and does not currently accept an `AbortSignal` or yield to the event loop while validating archive/XML contents.

Potential consequence:

On a large or complex but still in-budget FLA, cancellation requested while synchronous preflight is executing may not be observed until that synchronous work returns control to the event loop.

### Status

```text
CANCEL_RESPONSIVENESS_DURING_SYNC_PREFLIGHT = NEEDS_VALIDATION
```

### Stop gate A-CancelLatency

Do not expand Stage A UI scope into a preflight architecture rewrite without measured evidence.

First validate cancellation latency using representative upper-bound/large fixtures on Windows Electron. If user-visible blocking is proven, split a dedicated engineering issue.

---

## 12. Recommended Stage A v1 presentation boundary

Stage A v1 should be intentionally simple.

### SHOULD contain

- the shared FLA Workbench shell;
- a clear inspection state such as `正在检查 FLA`;
- one restrained indeterminate activity indicator;
- a concise trust statement such as `不会修改原文件或当前项目` where truthful in the inspection state;
- a real Cancel action tied to the existing lifecycle;
- direct success handoff into B/C/D/E;
- clean dismissal for `USER_CANCELLED`;
- genuine failure handoff into F3.

### SHOULD NOT contain

- a success/summary interstitial;
- a percentage;
- fake numbered stages;
- raw parser progress text;
- parser/package/security jargon;
- a guessed filename;
- a fake retry action without retry semantics;
- Project mutation;
- source-file mutation;
- new parser/recovery/security behavior disguised as UI polish.

---

## 13. Stage A vNext — explicitly out of v1 scope

The following may be valuable later, but each requires an explicit engineering contract before design depends on it:

### A. Typed product progress

Possible future Panda-owned semantic phases could include concepts such as:

```text
source-read
safe-preflight
parse
adapt
finalize
```

Exact names and semantics are not frozen here.

Requirements before implementation:

- phases must be stable and Panda-owned;
- the contract must cover the complete inspection lifecycle;
- UI must not derive semantics from raw parser strings;
- cancellation/stale-operation behavior must remain authoritative.

### B. Early source identity

If Stage A must show the selected file name while still inspecting, Main must explicitly hand a bounded source identity to Renderer before the final inspection result.

### C. Preflight cancellation responsiveness

Only after measured evidence demonstrates problematic latency should synchronous preflight be reconsidered for cancellation checkpoints/yielding/worker isolation.

---

## 14. Test/acceptance matrix for future Stage A implementation

A Stage A implementation should not be considered complete until at least these behaviors are proven:

| Case | Expected result |
| --- | --- |
| Native picker opened, user cancels | clean dismiss to Asset Library; never F3 |
| Inspection succeeds with `media.length > 0` | direct handoff to raster review path |
| Inspection succeeds with `media.length === 0` | direct handoff to render-target discovery path |
| Strict/recovery/parser genuine failure | blocked/F3 according to existing authority |
| User cancels active inspection | operation cancelled; UI closes cleanly |
| Old result arrives after cancel/reopen | stale result ignored/cleaned; new operation remains authoritative |
| Repeated start / StrictMode-equivalent behavior | single-flight |
| Stage A v1 visual | no fake percentage/steps/raw parser log |
| Stage A v1 inspection state | no Project/source mutation |
| Large/complex fixture cancellation | measure latency; record evidence before deciding on architecture change |

Windows Electron maintainer acceptance should include both native chooser cancellation and active-inspection cancellation as distinct cases.

---

## 15. Recommended implementation sequencing after design approval

Do not create implementation work from this document automatically. After the Stage A visual direction is accepted, the recommended sequence is:

```text
1. Freeze high-fidelity Stage A visual blueprint.
2. Create one Stage A v1 implementation issue for presentation + USER_CANCELLED handoff correction + tests.
3. Keep raw-progress / early-basename / preflight-cancel architecture out of that issue.
4. If later evidence requires those capabilities, create separate engineering issues.
```

The Stage A implementation should continue to accumulate on the current FLA implementation topology defined by the maintainer/PR policy at the time the issue is created; do not assume this docs PR changes branch topology.

---

## 16. Frozen Stage A design laws

1. **Stage A is an inspection transition, not a destination.**
2. **Success moves forward automatically; it does not ask the user to confirm that inspection succeeded.**
3. **Cancel means cancel, not Safe Blocked.**
4. **Only display progress that Panda actually owns as a stable contract.**
5. **Raw parser messages are engineering telemetry, not product copy.**
6. **Do not show source identity before Renderer authoritatively has it.**
7. **Inspection remains read-only with respect to Project and original source.**
8. **Do not weaken strict preflight, recovery gates, parser isolation or existing routing under a UI ticket.**
9. **Measured evidence is required before turning the synchronous-preflight cancellation risk into an architecture project.**
10. **Keep Stage A visually calm: the user should feel that Panda is checking the file, not performing a security audit in front of them.**

---

## 17. Plain-language model

A useful mental model is a restaurant receiving an unfamiliar sealed ingredient package:

- the front desk says only **"正在检查"**;
- the kitchen performs the detailed packaging/safety checks out of sight;
- if the package can be understood, the user is taken directly to the appropriate preparation workbench;
- if the user decides not to hand over a package, the process simply ends;
- if the package genuinely cannot be handled safely, only then does the blocked state take over;
- the front desk must not invent **"63% complete"** merely because it overheard a cook saying **"I am cutting vegetables"**.

That is the Stage A product model this document freezes.

---

## 18. Maintainer-selected landscape visual direction — Quiet Inspection Chamber

The preferred landscape direction for the Stage A high-fidelity blueprint is a **quiet inspection chamber inside the existing FLA Workbench shell**.

The purpose is to make Stage A feel like the first state of the same product surface used by B/D/E/F/G, rather than a temporary engineering status modal.

### 18.1 Structural thesis

```text
┌──────────────────────────────────────────────────────────────┐
│ FLA WORKBENCH                         检查中       [取消]    │
├───────────────────┬──────────────────────────────────────────┤
│                   │                                          │
│  waiting content  │             indeterminate               │
│  structure        │             scan core                   │
│                   │                                          │
│                   │             正在检查 FLA                │
│                   │       不会修改原文件或当前项目            │
│                   │                                          │
├───────────────────┴──────────────────────────────────────────┤
│                  检查完成后自动进入下一步                     │
└──────────────────────────────────────────────────────────────┘
```

This is a structural direction, not a frozen pixel specification.

### 18.2 Information hierarchy

Stage A should intentionally contain very little information:

1. `正在检查 FLA` — primary state;
2. one Panda-green indeterminate scan core — primary visual;
3. `不会修改原文件或当前项目` — trust statement;
4. `FLA WORKBENCH` + low-emphasis `检查中` — surface identity;
5. `取消` — secondary action;
6. an optional extremely low-emphasis waiting layout, only if it cannot be mistaken for discovered content.

The current repeated loading hierarchy should be removed/demoted:

```text
导入前检查
FLA 兼容性预览
正在读取所选 FLA
正在检查源文件…
```

The inspection state should tell the user once, clearly, what is happening.

### 18.3 Scan-core motion

Prefer a product-specific indeterminate activity mark rather than a generic spinner:

- small Panda-green center/core;
- two or three very low-contrast rings;
- slow scanning sweep / rotation;
- restrained breathing / glow;
- never fills to completion;
- never implies a percentage or numbered stage.

The visual meaning is only:

> Panda is active and inspection is still running.

It must not imply how much work is complete.

### 18.4 Workbench continuity

Keep the normal FLA Workbench shell visible during Stage A.

Preferred transition:

```text
Stage A inspecting
-> same shell wakes into B/C/D/E content
```

Do not insert:

```text
检查完成
[继续]
```

Likewise, genuine failure should allow F3 to take over the same Workbench content area instead of appearing as an unrelated error tool.

### 18.5 Waiting-content rule

A very low-emphasis skeleton or placeholder layout may be used only to preserve spatial continuity with the downstream Workbench.

Hard rule:

> It must clearly read as an empty waiting layout, never as evidence that Panda has already discovered real assets or targets.

If high-fidelity review shows that the placeholder reads as fake discovered content, remove it and use a quiet empty pane instead.

### 18.6 Cancel treatment

`取消` remains visually secondary but must remain touch-safe for the real Windows Electron / Aliyun Wuying / Redmi K60 Ultra Cloud Touch landscape environment.

Do not style Cancel as the green primary CTA. The scanning state is the primary content.

Both user-visible cancellation cases converge on the same outcome:

```text
native picker cancel
or
active inspection cancel
-> close/dismiss Workbench
-> Asset Library
-> no error banner
-> never F3
```

A cancellation-success toast is unnecessary merely to repeat the action the user just performed.

### 18.7 Safety communication

Do not expose detailed engineering checks in the normal Stage A surface.

Avoid UI such as:

```text
✓ ZIP structure
✓ XML security
✓ ActionScript scan
✓ parser isolation
```

One truthful trust statement is enough. Stage A should feel like a creative-tool inspection state, not antivirus software.

### 18.8 Motion and tone

Allowed:

- slow scan-core rotation / sweep;
- subtle breathing;
- faint radial glow consistent with the existing dark-green Panda Stage visual world;
- soft content reveal when the authoritative next Workbench is ready.

Avoid:

- particle effects;
- fake terminal output;
- animated file trees;
- rapidly changing numbers;
- fake `AI analysing` theatrics;
- cyber-security scanner aesthetics.

### 18.9 High-fidelity acceptance questions

The landscape blueprint is accepted only if all are true:

- it visibly belongs to the same FLA Workbench family as B/D/E/F/G;
- a beginner can tell Panda is still working without fake progress;
- the surface feels calm rather than empty or debug-like;
- `取消` is obvious and touch-safe without becoming the main visual action;
- the trust statement communicates safety without exposing security internals;
- any waiting structure does not imply real assets have already been discovered;
- Stage A can transition directly into B/C/D/E without a success page;
- genuine failure can transition into F3 inside the same shell;
- the design depends on no new filename/progress/parser contract.

### 18.10 Next artifact

Produce one Stage A / Inspecting **landscape high-fidelity blueprint** using this direction.

After maintainer visual acceptance, freeze the final blueprint and open the Stage A v1 implementation issue for only:

- presentation convergence;
- `USER_CANCELLED` clean-dismiss correction;
- required tests / Windows Electron acceptance.

This direction does not authorize production behavior changes beyond the already-frozen Stage A v1 scope.