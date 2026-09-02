# Panda Stage FLA Workbench — Stage F Compatibility Severity Model v1

Date: 2026-09-02  
Status: **Maintainer-confirmed conceptual design baseline**  
Companion design baseline: PR #389 — `docs(fla): inventory current workbench seven-state baseline`  
Current implementation research snapshot: PR #393 @ `81e46a0a76988eb4ab44600ab3c9cb25c8dcc2cd`  
Main snapshot used for this docs branch: `f601b54a04134a6d96f59ec03d4a8daa0974c16b`

## 1. Purpose

This document freezes the Stage F product model for Panda Stage's FLA Workbench so that compatibility behavior is not left to conversational memory.

Stage F is not a fourth top-level FLA business route. It is a severity model that explains how compatibility / unsupported / safety facts should be presented across the existing Workbench routes.

The three product levels are:

```text
F1  warning but usable
F2  one target unavailable, other work may continue
F3  whole-file Safe Blocked
```

The design goal is not to make warnings prettier. It is to make severity legible through **what part of the interface the problem is allowed to occupy**.

The governing principle is:

> Small problems get small spatial authority. Only a whole-file block may take over the whole work area.

This preserves safety truth while preventing low-severity compatibility information from overwhelming the user's actual import task.

---

## 2. Product mode and user question

Stage F belongs to the FLA Workbench's **Operate** mode.

The user is not trying to study FLA internals. The surface must answer, in this order:

1. Can I keep working?
2. If not, what exactly is unavailable?
3. What is the next valid action?
4. Where can I inspect more technical detail if I need it?

Internal labels `F1`, `F2`, and `F3` are design / engineering shorthand only. They must never appear as user-facing product copy.

---

## 3. Severity model at a glance

| | F1 | F2 | F3 |
|---|---|---|---|
| Product meaning | Usable with caveat | One target unavailable | Whole file cannot continue |
| Can user continue? | Yes | Yes, with other supported targets | No |
| Spatial authority | One concise local warning | One target row + local detail | Entire Workbench content area |
| Target list | Normal | Unavailable target stays visible | Hidden / not applicable |
| Preview / review | Normal | Other supported targets continue | Not exposed |
| Import action | Normal task CTA remains primary | Normal task CTA remains primary for supported targets | No preview/import CTA |
| Visual emphasis | Low-to-medium | Medium and local | Strong blocking treatment |
| Primary user message | “There may be differences.” | “This target cannot be used.” | “This FLA cannot be safely processed.” |
| Default detail level | Summary + disclosure | Local reason + disclosure | Beginner-facing reason + optional detail |

The severity distinction must be conveyed primarily by **layout scope and interaction availability**, not only by changing yellow to red.

---

# 4. F1 — Warning but usable

## 4.1 Product meaning

F1 means Panda has detected a compatibility or fidelity limitation, but the current task remains valid.

Examples from the current compatibility data model include facts such as:

- timeline placement imported only partially / inspection-only;
- ActionScript detected but never executed;
- Symbol / MovieClip semantics not imported by the raster-only path;
- basic tween semantics not imported;
- vector / video / text semantics outside the current raster-only contract;
- unresolved or unknown references that do not invalidate the entire current route.

An `unsupported` compatibility entry does **not** automatically mean whole-file Safe Blocked.

A file may contain unsupported semantics while still exposing usable raster assets or supported render targets.

## 4.2 Presentation contract

F1 should stay close to the affected work area and remain visually secondary to the user's task.

Target shape:

```text
⚠ 部分内容可能与原 FLA 有差异        [查看 2 项说明]
```

The default surface should communicate only:

- what the user should expect;
- whether they can continue.

Detailed compatibility facts belong under progressive disclosure.

## 4.3 What F1 must NOT become

Do not restore a primary dashboard containing five equal-weight compatibility status cards such as:

```text
exact
partial / degraded
unsupported
unknown
not-present
```

`not-present` and other diagnostic facts are engineering context, not primary workflow content.

Do not repeat the same F1 warning in the left list, center preview, right details, and footer simultaneously.

The same ordinary warning should normally have one authoritative visible location.

## 4.4 Visual rule

Use restrained amber / warm warning emphasis rather than a large warning-colored surface.

If the user can continue, the normal task CTA (`预览`, `生成`, `确认`, `导入`) remains more visually prominent than the compatibility warning.

---

# 5. F2 — One target unavailable, other work may continue

## 5.1 Product meaning

F2 means Panda knows that a target exists, but that target cannot currently be previewed / rendered safely or correctly enough to expose as a normal usable target.

Other supported targets remain usable.

The unavailable target must **not silently disappear** from the user's mental model if Panda has already discovered its identity.

Target presentation concept:

```text
● 肌肉男                      11 帧
○ 便衣道士                     7 帧
⊘ 爆炸特效                    暂不可预览
○ 熊猫头                       4 帧
```

## 5.2 Local interaction contract

An unavailable target should:

- remain visible in the target list;
- be excluded from normal preview/render selection authority;
- expose a real beginner-facing reason locally;
- preserve access to other supported targets;
- never escalate the entire Workbench into F3 solely because one target is unavailable.

Preferred detail behavior:

```text
爆炸特效

暂不可预览

这个目标使用了 Panda 当前还不能安全渲染的内容。
其他可用目标不受影响。

[更多说明]
```

Avoid modal error dialogs for ordinary F2 inspection.

## 5.3 Current code readiness

At the PR #393 research snapshot, the shared contract already supports:

```text
previewSupported: false
unsupportedReason: <required reason>
```

The Stage D / Stage E UI also contains presentation paths for unsupported entries, including disabled normal selection and local reason/status handling.

However, current production `buildRenderableTargetCatalog()` research found a material reachability gap:

- discovered graphic-symbol / scene targets are currently emitted as `previewSupported: true`;
- targets that are not discovered as renderable are generally absent from the catalog rather than emitted as visible unavailable entries;
- current unit coverage proves the contract accepts `previewSupported=false + unsupportedReason`, but does not prove the production catalog naturally emits such an entry.

Therefore:

> **F2 presentation is design-approved, but production reachability remains an engineering confirmation gate.**

This distinction must not be erased in future implementation issues.

## 5.4 F2 implementation stop gate

Do not expand parser / renderer semantics under the label of “UI polish” merely to make an F2 demo reachable.

If real F2 support requires broadening target discovery or renderer capability, stop and open a narrow engineering decision / reachability issue first.

A synthetic fixture may prove the presentation contract, but synthetic reachability is not evidence that production discovery already owns the same truth.

---

# 6. F3 — Whole-file Safe Blocked

## 6.1 Product meaning

F3 means inspection / security / compatibility processing has failed at the whole-file boundary and Panda cannot safely continue into a normal content route.

This is the only Stage F state allowed to take over the full Workbench content area.

Top-level routing remains unchanged:

```text
inspection failed
→ blocked

inspection success + media.length > 0
→ v1-raster-review

inspection success + media.length === 0
→ v2r-target-discovery
```

Stage F does not create a new fourth route.

## 6.2 Existing safety foundation

Current code research confirms a strict fail-closed foundation already exists around F3, including controls for examples such as:

- malformed / ambiguous archive structure;
- unsafe archive paths;
- encrypted entries;
- unsupported ZIP container conditions;
- XML structure / nesting limits;
- disallowed external XML resources;
- resource / expansion budgets;
- missing required XFL structure;
- parser / inspection failure conditions.

A bounded compatibility-recovery path may inspect an immutable in-memory copy after a strict rejection, but it does not grant permission to weaken the strict validator.

Where recovery is eligible:

```text
strict validation rejects
        ↓
recovery classifier
        ↓
RECOVERY_CANDIDATE only
        ↓
normalize Panda-owned in-memory copy
        ↓
run the same strict production validator again
        ↓
PASS → parser may continue
FAIL / REJECT / AMBIGUOUS → blocked
```

The recovery contract records in-memory normalization and does not rewrite the user's original FLA.

## 6.3 F3 presentation contract

Keep the recognizable FLA Workbench shell, but replace the normal content / preview / target UI with a dedicated blocked composition.

Conceptually:

```text
FLA 工作台
<source.fla> · 只读

                [blocking icon]

        这个 FLA 暂时无法安全处理

文件结构存在 Panda 当前无法安全确认的问题，
因此已停止继续读取。

✓ 原文件没有被修改

[为什么会这样？]

                                      [返回素材库]
```

Exact copy must remain grounded in the diagnostic truth available for the current failure.

## 6.4 What disappears in F3

When the whole file is blocked, do not expose fake or contradictory task controls:

- no raster media selection;
- no render target list;
- no `[单帧] [帧序列]` mode switch;
- no frame / range controls;
- no preview action;
- no sequence generation;
- no import action.

Do not offer a fake `Retry` unless the underlying failure state genuinely owns a retry path that may produce a different valid outcome.

## 6.5 User-facing language

Prefer beginner-facing copy such as:

- `这个 FLA 暂时无法安全处理`
- `Panda 已停止继续读取`

Do not surface developer identifiers such as archive field names, EOCD internals, parser package names, raw error codes, hashes, or internal filesystem details in the primary UI.

Developer detail may remain in logs / diagnostics where already supported.

---

# 7. Four Stage F design laws

The following are frozen design rules for future Stage F blueprints and implementation issues.

## Law 1 — Internal levels stay internal

`F1`, `F2`, and `F3` are internal severity labels only.

Never show them to users.

## Law 2 — Put the warning beside the thing it affects

Compatibility information should be as local as possible.

- file-wide soft caveat → one Workbench-level F1 summary;
- target-specific problem → target-local F2 state;
- whole-file failure → F3 blocking composition.

Do not distribute one warning across unrelated parts of the screen.

## Law 3 — If work may continue, the task stays visually primary

For F1 and F2:

> the normal useful task CTA must remain more prominent than the warning.

Do not let a compatibility banner visually overpower `预览当前帧`, `生成帧序列`, or another legitimate next action when that action is still valid.

## Law 4 — Only F3 may take over the Workbench

F3 is the only state that may replace the normal content / preview / import surface with a dedicated blocking composition.

F3 must not leave fake task affordances visible.

---

# 8. Color is secondary to spatial authority

Do not treat Stage F as a simple color scale:

```text
yellow → orange → red
```

Severity must be readable even in monochrome or low-color environments.

Primary hierarchy mechanism:

```text
F1 → small local summary
F2 → affected target + local detail
F3 → whole content area
```

Color supplements this hierarchy rather than creating it.

This also protects accessibility: critical state distinctions must not depend only on color.

---

# 9. Relationship to existing FLA Workbench states

Stage F overlays / intersects existing work rather than replacing the seven-state model.

Examples:

```text
Stage B / C
└─ may carry F1 compatibility warnings

Stage D / E
├─ may carry F1 fidelity warnings
└─ may carry F2 unavailable target entries

Inspection / preflight
└─ may terminate as F3 whole-file Safe Blocked
```

An `unsupported` compatibility fact inside a successful inspection does not by itself imply F3.

F3 authority comes from the whole-file inspection / safety outcome, not from the word `unsupported` appearing anywhere in the compatibility list.

---

# 10. Existing-code evidence snapshot

This section records the code research basis at PR #393 HEAD `81e46a0a76988eb4ab44600ab3c9cb25c8dcc2cd`.

The snapshot is evidence, not a promise that these file locations will never move.

### F1 evidence

- `src/renderer/fla-import/fla-review.ts`
  - compatibility status set and beginner labels;
  - warning filtering for `degraded / unsupported / unknown`.
- `src/renderer/fla-import/fla-viewer-adapter.ts`
  - builds compatibility facts for raster, timeline placement, ActionScript, symbols, tweens, vector/video/text and unknown references.
- current Raster / Snapshot / Sequence review surfaces already contain progressively disclosed compatibility / fidelity presentation.

### F2 evidence

- shared static-snapshot catalog contract supports `previewSupported` and requires `unsupportedReason` for unavailable entries;
- Stage D / Stage E presentation paths already know how to avoid using unsupported entries as normal render choices;
- production `buildRenderableTargetCatalog()` currently emits discovered renderable target entries as supported and has not yet been proven to emit a natural unavailable entry.

### F3 evidence

- `src/main/services/fla-import-preflight-service.ts`
  - strict source/archive/XML/resource safety checks.
- `src/main/services/FlaImportService.ts`
  - strict inspection, recovery classifier integration, second strict validation, fail-closed response.
- `src/main/services/fla-recovery-classifier.*`
  - `STRICT_VALID / RECOVERY_CANDIDATE / REJECT / AMBIGUOUS` classification model and in-memory normalization contract.
- `src/shared/fla-import-diagnostics.ts`
  - beginner-facing diagnostic copy without developer jargon.
- current content routing preserves `blocked / v1-raster-review / v2r-target-discovery` only.

---

# 11. Implementation boundaries

Stage F visual convergence does **not** authorize changes to:

- top-level FLA routing;
- strict preflight policy;
- recovery eligibility rules;
- parser closure / parser semantics;
- Static Snapshot renderer semantics;
- Frame Sequence renderer semantics;
- R1 / R2 ownership;
- stale-preview or stale-sequence guards;
- Project schema / Asset commit ownership;
- source FLA immutability;
- sequence 24-frame cap;
- ActionScript execution policy;
- V2-S semantic import;
- mixed bitmap + rendered-content business mode.

A UI implementation must stop if it requires weakening one of these boundaries.

---

# 12. Recommended implementation sequencing

Do not assume the three levels have equal engineering risk.

Recommended sequencing:

```text
F1 presentation convergence
→ low risk; existing business truth already reachable

F3 Safe Blocked product composition
→ moderate UI work; security boundary already mature

F2 presentation
→ first prove production reachability
→ if missing, split a narrow target-discovery decision issue
→ only then implement real production unavailable-target UX
```

F1 and F3 should not be blocked on F2 if their own presentation work is otherwise ready.

---

# 13. High-fidelity blueprint acceptance questions

Future Stage F blueprints should pass these questions before implementation:

1. Can a user distinguish “continue normally”, “this one target is unavailable”, and “the whole file is blocked” without reading engineering terminology?
2. Does F1 remain visibly secondary to a valid task CTA?
3. Does F2 keep the unavailable target visible without stopping other supported targets?
4. Does F3 remove all fake preview / render / import affordances?
5. Does the same ordinary warning appear only once in the default scan path?
6. Is meaningful risk visible without expanding a detail panel?
7. Are developer diagnostics available without being forced into the beginner-facing surface?
8. Does the design preserve the existing Stage D/E Workbench shell rather than inventing another mini-app?
9. Can the three severity levels still be understood without relying only on color?
10. Is F2 explicitly marked as reachability-dependent until production evidence exists?

---

# 14. Next design artifact

The next visual artifact should render **three landscape high-fidelity states** using the accepted Panda Stage FLA Workbench visual language:

```text
F1 — warning but usable
F2 — one target unavailable, other targets continue
F3 — whole-file Safe Blocked
```

The F2 blueprint may be designed now, but it must carry the engineering note:

```text
PRODUCT REACHABILITY — NEEDS CONFIRMATION
```

until a production catalog path is proven to emit a real unavailable target with an authoritative reason.

---

# 15. Short version

```text
F1
有点问题，但能继续
→ 给 warning 一条小板凳

F2
这个目标不能用，但其他目标能继续
→ 只封这一行，别封整个 Workbench

F3
整个文件无法安全继续
→ 这时 warning 才有资格坐主席台，接管整个工作区
```

That is the Stage F severity model.
