# Issue #718 — Stage B5-J: Shape Fill / Tessellation Prerequisite for #717 (J0)

- Issue: [#718](https://github.com/Cognitive-Architect/panda-stage/issues/718)
- Parents: [#696](https://github.com/Cognitive-Architect/panda-stage/issues/696) / [#701](https://github.com/Cognitive-Architect/panda-stage/issues/701)
- Evidence: #691 / #692 / #717
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT)
- Baseline head: `f24b8976cb785f738e94434dfe09d19228e0a93c`
- Scope executed: **J0 only (research-only forensic census). No production behavior changed. J1+ not started.**
- Corrective: **Issue [#719](https://github.com/Cognitive-Architect/panda-stage/issues/719)** —
  classification-semantics cleanup only (C1/C2/C4), baseline `56392e2ce43ff34ce2d31aa8148bf5e03e96efe1`.
  The census numbers are unchanged; only the **classification model** and the **gradient enum** were
  corrected, and all evidence was regenerated in a fresh `issue719-…` directory.

> Serial contract: J1 may start only if J0 identifies at least one reusable, source-proven fill rule.
> This document is the J0 evidence and gate decision for that boundary.

## Result

**J0 = NO-GO for J1.** No bounded, source-proven fill rule was identified.

`蓝衣修仙男（补面需求）.fla` contains **103 distinct DOMShape definitions**; **16 fail** the production
static-reassembly path (15 on fill topology, 1 on the gradient matrix). Every candidate closure rule
either leaves the failures unchanged, or **regresses the accepted real controls** — so no rule may
graduate to J1.

| rule (in-memory only) | Blue failing | `黑衣修仙男` | `飞行中旋转` | `性感修仙女` |
| --- | ---: | ---: | ---: | ---: |
| **baseline (= production)** | **16** | **0** | **0** | **0** |
| emit boundary for `fillStyle0 === fillStyle1` edges | 74 ✗ | 40 ✗ | 1 ✗ | 46 ✗ |
| endpoint tolerance join 1e-6 / 1e-3 / 0.05 | 16 (no help) | 0 | 0 | 0 |
| reuse an authored neighbour segment at the open tip | 16 (no help) | 0 | 0 | 0 |
| reuse authored **unstyled** (`fillStyle0=fillStyle1=strokeStyle=0`) edges | 83 ✗ | 51 ✗ | 0 | 83 ✗ |

Two independent closure oracles agree on every row: a **mirror of the production directed walk** and a
**permissive Eulerian-cycle criterion** produce identical counts, so the residual is a real geometry
gap, not an artifact of the production angle-selection heuristic.

## Method and source integrity

- Inspected the real FLA through the shared production `dist-electron` modules only (C3 recovery
  classifier → XFL display-list adapter → display-list resolver → static-snapshot SVG builder).
- **Per-shape production verdict**: each shape definition was composed through the production builder in
  an isolated synthetic single-shape display list, so the exact `TARGET_UNSUPPORTED` / `RENDER_FAILED`
  verdict is production's, not a re-implementation's.
- **Parity assertion (PASS)**: an independent mirror of the production edge decoder + fill-boundary
  builder (`decodeEdgesWithStyleChanges`, `reconstructFills`, `stitchFillBoundary`) was run over every
  shape definition; its pass/fail verdict equals production's for **103 / 103** definitions. The mirror is
  therefore validated and is used only to expose the topology production collapses into one message.
- Read-only. The recovery classifier identified the malformed-archive EOCD case and the existing helper
  normalized it **in memory only**; the original file was never written. SHA-256 identical before/after.
- Two identical runs produced byte-identical census artifacts and receipts.

### Census caveat: shape-id aliasing

A production shape id is `sha256(scope + "\0" + displayListPath)`. Two different roots can place
different `DOMShape` XML at the same path, so **18 ids are shared by two distinct shape definitions**.
An id-keyed audit therefore both double-counts and can hold the wrong content. This census is
**content-addressed** (deduped by SHA-256 of the shape XML); root verdicts were captured with a fresh
isolated load per root so each failing id maps to its own block.

| | value |
| --- | --- |
| Primary fixture | `D:\表情合集\蓝衣修仙男（补面需求）.fla` |
| SHA-256 before / after | `3fdb31478c6e5fe3ffca30f27fe69d9b3ba8f29f4bcf28eb39b9ce1b0fa3fdf2` / unchanged |
| Classifier state | `RECOVERY_CANDIDATE` → in-memory normalize (`deltaBytes = 54`, original not written) |
| Stage / fps | 1280×720 / 30 (`creatorInfo: Adobe Animate`) |
| Library symbols / shape registrations / **distinct shapes** | 11 / 178 / **103** |
| id-collision groups | 18 |

## Coverage of the #717 failures

All five shape ids reported by #717 are covered by the census (and are among the 16 failing definitions):

| #717 shape id | root that reported it | failing definition | classification |
| --- | --- | --- | --- |
| `fla-shape-fe5042fde5e3ee95ae29cc47` | Scene `场景 1`, `…com6` | `7d28f3a9eb45…` | `AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH` |
| `fla-shape-6feb4f839ea05ee66927676e` | `…com8` | `7d28f3a9eb45…` (**same shape content**) | `AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH` |
| `fla-shape-2ecb2c1c3a63233bdfec877c` | `…com7` | `d5acaf6fc333…` | `AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH` |
| `fla-shape-e004b0295db44aac6b530d61` | `元件 1` | `5ee65d34b51f…` | `AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH` |
| `fla-shape-99ff012c139a78f9a1b5dd0f` | `元件 2` | `0b34e71905f0…` | `UNKNOWN` (deferredTo `J3`) |

## Failure mechanism (J0)

For a given fill style, production orients each authored edge by its declared side
(`fillStyle1` forward, `fillStyle0` reversed) and stitches the resulting directed segments into closed
contours. A failure means the produced segment set does **not** form closed directed contour(s).

Two topology classes explain all 15 fill failures (46 failing styles in total):

| class | count | meaning |
| --- | ---: | --- |
| open chain (a path with exactly 2 undirected endpoints) | 29 | the boundary is an open polyline |
| non-manifold branch (an authored vertex shared by 3+ edges) | 20 | the boundary graph has a T-junction the walk cannot resolve |

For each open chain the census tests what authored geometry, if any, joins the two tips:

| connector found at the open tip pair | count |
| --- | ---: |
| an authored edge with **no fill/stroke ownership** (`fillStyle0=fillStyle1=strokeStyle=0`) | 16 |
| **no authored segment at all** | 13 |
| an edge already owned by this style that still does not close the directed walk | 2 |

Findings that **exclude** the obvious hypotheses:

- **Not endpoint tolerance.** Merging endpoints at 1e-6, 1e-3, or the authored coordinate quantum
  (0.05) changes nothing (16 → 16). The tips are not near-coincident.
- **Not `fillStyle0 === fillStyle1`.** Those edges are skipped by design; emitting them makes the
  fixture far worse (16 → 74) and breaks all three accepted controls (0 → 40 / 1 / 46).
- **Not contour orientation / reversal.** The dual (forward `fillStyle1`, reversed `fillStyle0`)
  construction already handles reversal; the mirror reports **zero** closed-undirected-but-unbalanced
  components, i.e. no component is closed purely by an orientation error.
- **Not shared-boundary duplication.** Reverse-duplicate edge pairs between adjacent styles are
  abundant and already handled (132–227 per large shape).
- **Gradient:** the failing `FillStyle 24` is `<LinearGradient>` with two `GradientEntry` children and
  **no `<matrix>` child at all**. `matrixWrapperCount = 0`, `matrixBlockCount = 0`,
  `matrixTagCount = 0`, zero matrix attributes: the Matrix is genuinely absent from the source, not
  dropped by the adapter. Whether any source-proven default exists is the J3 question; it is **not**
  assumed identity here.

### Classification (corrected by #719 — exactly one per failing shape)

The classification model was corrected by issue #719. Two changes; **no census data changed**:

1. **C1 — gradient uses a frozen enum.** `PENDING_J3_GRADIENT` was a workflow destination, not a J0
   classification, and is not in the frozen enum. The gradient shape is now `UNKNOWN`, with
   `deferredTo: J3` recorded as **metadata only**. No sixth enum value was added.
2. **C2 — no majority vote.** The previous rule picked the larger of {branch junctions, open chains}.
   A larger count never erases a source ambiguity. The corrected rule is conservative semantic
   precedence: any unresolved open-chain ambiguity → `AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH`; else any
   non-manifold branch junction → `MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED`; else `UNKNOWN`.
   Sub-reason counts are retained separately per shape.

| classification (frozen #718 enum) | #718 J0 | corrected (#719) |
| --- | ---: | ---: |
| `AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH` | 8 | **11** |
| `MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED` | 7 | **4** |
| `CURRENT_IMPLEMENTATION_BUG` | 0 | 0 |
| `MALFORMED_SOURCE` | 0 | 0 |
| `UNKNOWN` | 0 | **1** |
| *(retired)* `PENDING_J3_GRADIENT` | 1 | — |

Sub-reason tally over the 16 failing shapes: `openChains = 29`, `branchJunctions = 20`,
`missingGradientMatrix = 1` (`deferredTo: J3`).

Three shapes moved `MODEL_INCOMPLETE → AMBIGUOUS` under the corrected precedence, because each contains
both non-manifold branch junctions **and** unresolved open chains: the larger branch count previously hid
the open-chain ambiguity. Two of them are #717 shapes (`7d28f3a9eb45`, `5ee65d34b51f`).

- `MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED` — every unresolved component is a non-manifold branch
  junction: the model has no rule for a vertex shared by 3+ authored edges, so a boundary walk dead-ends
  there, and there is **no** open-chain ambiguity.
- `AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH` — the failure includes an open chain whose closure is **not declared
  by the source**: the only authored geometry joining the tips carries no fill-side ownership, so choosing
  a side would invent semantics rather than parse them. Per the Issue's core safety rule this stays
  fail-closed.
- `UNKNOWN` — the source is a gradient whose `<matrix>` child is genuinely absent; whether that is a legal
  default or a malformed source cannot be decided without external truth (deferred to J3).

## J0 counterfactuals (every candidate rule answered)

| candidate rule | source fact authorizing it | invented geometry | accepted controls regress | verdict |
| --- | --- | --- | ---: | --- |
| side-aware edge reversal | `fillStyle0`/`fillStyle1` orientation | NO | NO | already implemented (no change) |
| shared fill-boundary reuse | reserved edges between adjacent styles | NO | NO | already implemented (no change) |
| multiple closed subpaths under one FillStyle | independent authored runs | NO | NO | already implemented (no change) |
| emit boundary for `fillStyle0 === fillStyle1` edges | none — both sides are the same fill | YES (interior seam becomes a boundary) | **YES** (0 → 40 / 1 / 46) | **REJECTED** |
| endpoint tolerance join / nearest-tip snapping | none — Tips are not near-coincident | YES (fabricated connector) | untested (rule has no effect) | **REJECTED** (STOP gate 1/2) |
| reuse unstyled (`fillStyle0=fillStyle1=strokeStyle=0`) edges | none — the edge declares no fill | YES (invented fill-side ownership) | **YES** (0 → 51 / 0 / 83) | **REJECTED** |
| alternate contour orientation rules | none proven | n/a | n/a | **REJECTED** — mirror shows no purely-orientation failure |

Invariant held: `visible fill geometry = authored Edge geometry only`. No connector segment was ever
added to production; the two rules that would have added geometry were measured and rejected.

**J0 gate: not passed** — no reusable, source-proven fill rule identified. Per the serial contract,
**J1 does not start**.

## Gate position

- **J0 complete.** J1 / J2 / J3 / J4 / J5 **NOT_STARTED**.
- No production file changed; no test or gate lowered; no `Full CI` triggered; no source mutation;
  no tween interpolation, MovieClip runtime, Script execution, product UI, or persisted schema.
- Source fixture byte-identical before/after.

## Evidence

`D:\PandaStage-Acceptance\issue718-j0-shape-forensic-20261006\run-12\` (original #718 J0 run)

- `j0-shape-forensic.json` — source identity, per-root production verdicts, per-shape content-addressed
  audit (styles, edges with `fillStyle0`/`fillStyle1`/`strokeStyle`, decoded endpoints, per-style
  segments/components/endpoints/orientation, closure evidence, classification), gradient forensic, the
  full rule sweep, and the controls' sweep.
- `completion-receipt.txt`, `completion-receipt.json`.
- `run-13\` — byte-identical repeat run (determinism).

`D:\PandaStage-Acceptance\issue719-j0-classification-corrective-20261007\run-1\` (corrected #719 re-run)

- Same artifacts, regenerated with the corrected classification model (`schemaVersion
  issue718-j0-shape-forensic/2`). `run-2\` is a byte-identical repeat run (determinism).
- The prior #718 evidence is **not overwritten**.

Runner: [`scripts/research/issue718-j0-fill-topology-forensic.cjs`](../../scripts/research/issue718-j0-fill-topology-forensic.cjs)
(reuses only the production `dist-electron` modules; writes outside the repository; refuses to
overwrite; never widens a check; never invents connector geometry).

## Issue #718 receipt (as originally filed)

> The classification fields in this receipt were superseded by issue #719 (see below); the census
> numbers are unchanged.

```text
Issue: Stage B5-J Shape Fill / Tessellation Prerequisite for #717
parents: #696 / #701
evidence: #691 / #692 / #717
mother PR: #677
baseline head: f24b8976cb785f738e94434dfe09d19228e0a93c

J0:
Blue failing shape count: 16 of 103 distinct shape definitions (15 SHAPE_FILL_TOPOLOGY, 1 GRADIENT_MATRIX)
shape addresses: content-addressed; 18 shape ids alias 2 distinct definitions each; the 5 #717 ids map to
  7d28f3a9eb45 (fe5042/6feb4f), d5acaf6fc333 (2ecb2c), 5ee65d34b51f (e004b0), 0b34e71905f0 (99ff01)
topology classes: open chain 29 / non-manifold branch 20; tip connectors: no-fill-ownership 16, none 13,
  same-style-not-closing 2
source-proven candidate rule: NONE
invented geometry required: NO (no rule implemented; the two geometry-adding rules were measured and rejected)
gradient source finding: FillStyle 24 <LinearGradient> has NO <matrix> child in source (not adapter-dropped)
result: NO-GO — J1 not started

J1: frozen supported fill contract: NOT_STARTED
J2: production files changed: NONE; result: NOT_STARTED
J3: gradient matrix classification: PENDING (source Matrix genuinely absent; no source-proven default found yet)
J4: source mutation: NO; determinism: PASS (byte-identical repeat); result: NOT_STARTED
J5 #717 rerun: NOT_STARTED

#717 decision: NO_ADVANCE (J0 gate not passed; no bounded rule advances Blue without regressing controls)

PR #677 remains Draft: YES
Full CI manually triggered: NO

final result:
- NO-GO at J0. Blue's fill-topology blocker is neither a tolerance, same-style, orientation, nor
  shared-boundary artifact. It needs an Animate fill-tessellation semantic (non-manifold junction
  resolution + fill-side ownership for unstyled closing edges) that the source does not declare, so any
  closure rule would invent geometry or regress `黑衣修仙男` / `飞行中旋转` / `性感修仙女`.
- The gradient blocker is separate: the source FillStyle 24 genuinely omits the gradient `<matrix>`.

next single action:
Maintainer decision — either (a) accept J0 NO-GO and keep Blue unsupported under the current bounded
model, or (b) authorize a NEW bounded research slice that first establishes external truth for Animate's
fill-tessellation semantics (e.g. a reference raster of the exact Blue shape) before any J1 contract is
frozen. Do not resume #717 at I1.
```

## Issue #719 corrective receipt

```text
Issue: #719 J0 Classification Corrective
parent: #718
mother PR: #677
baseline: 56392e2ce43ff34ce2d31aa8148bf5e03e96efe1

C1 gradient:
old classification: PENDING_J3_GRADIENT (not in the frozen #718 enum — a workflow destination)
new classification: UNKNOWN
deferredTo: J3 (metadata only; not a classification value)
evidence: FillStyle 24 is <LinearGradient> with two GradientEntry children and NO <matrix> child in
  source (matrixWrapperCount = matrixBlockCount = matrixTagCount = 0; adapter did not drop it). A legal
  default vs a malformed source cannot be proven without external truth.

C2 mixed topology:
old rule: classification = branchComponents > openChains ? MODEL_INCOMPLETE : AMBIGUOUS (majority vote)
new rule: any unresolved open chain -> AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH;
  else any non-manifold branch junction -> MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED; else UNKNOWN
ambiguity precedence: source ambiguity (open-chain, no declared fill-side ownership) dominates a
  numerically larger count of model-incomplete branch junctions
sub-reasons preserved: YES — openChains / branchJunctions retained per shape (tally: openChains=29,
  branchJunctions=20)

new classification tally:
AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH: 11
MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED: 4
CURRENT_IMPLEMENTATION_BUG: 0
MALFORMED_SOURCE: 0
UNKNOWN: 1
(total 16 = unchanged; 3 shapes moved MODEL_INCOMPLETE -> AMBIGUOUS; gradient moved into UNKNOWN)

source-proven candidate rule: NONE
J0 result: NO-GO (recomputed from the rule sweep, not hard-coded)
J1 started: NO
#717 decision: NO_ADVANCE

files changed: scripts/research/issue718-j0-fill-topology-forensic.cjs,
  docs/research/issue-718-j0-shape-fill-topology.md
production files changed: NO
source mutation: NO (sha256 identical before/after)
targeted eslint: PASS (scripts/research/issue718-j0-fill-topology-forensic.cjs)
git diff --check: clean
deterministic repeat: PASS (run-1 vs run-2 byte-identical for all three artifacts)

PR #677 remains Draft: YES
Full CI manually triggered: NO

final result:
- J0 remains NO-GO. The corrective changed only the classification model and the gradient enum; no census
  number changed (103 distinct shapes, 16 failing, 29 open chains, 20 branch junctions, same rule sweep).
- Preserved: tolerance does not help; same-style emission regresses controls; unstyled-edge reuse
  regresses controls; orientation/reversal is not the missing rule; shared-boundary duplication is
  already handled; no production change; no source mutation; J1..J5 not started.

next single action:
Maintainer decision — either (a) accept J0 NO-GO and keep Blue unsupported under the current bounded
model, or (b) authorize a NEW bounded research slice that first establishes external truth for Animate's
fill-tessellation semantics (e.g. a reference raster of the exact Blue shape) before any J1 contract is
frozen. Do not resume #717 at I1.
```

## Next action

Keep PR #677 in draft. J0 stopped at its gate: no source-proven fill rule exists for Blue, so J1 must
not start. Blue coherent reassembly remains blocked by the vector-shape capability gap; do not weaken
the contract to force a `CLEAR_FOR_717`, and do not resume #717 at I1.
