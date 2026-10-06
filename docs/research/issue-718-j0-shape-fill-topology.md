# Issue #718 — Stage B5-J: Shape Fill / Tessellation Prerequisite for #717 (J0)

- Issue: [#718](https://github.com/Cognitive-Architect/panda-stage/issues/718)
- Parents: [#696](https://github.com/Cognitive-Architect/panda-stage/issues/696) / [#701](https://github.com/Cognitive-Architect/panda-stage/issues/701)
- Evidence: #691 / #692 / #717
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT)
- Baseline head: `f24b8976cb785f738e94434dfe09d19228e0a93c`
- Scope executed: **J0 only (research-only forensic census). No production behavior changed. J1+ not started.**

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
| `fla-shape-fe5042fde5e3ee95ae29cc47` | Scene `场景 1`, `…com6` | `7d28f3a9eb45…` | `MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED` |
| `fla-shape-6feb4f839ea05ee66927676e` | `…com8` | `7d28f3a9eb45…` (**same shape content**) | `MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED` |
| `fla-shape-2ecb2c1c3a63233bdfec877c` | `…com7` | `d5acaf6fc333…` | `AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH` |
| `fla-shape-e004b0295db44aac6b530d61` | `元件 1` | `5ee65d34b51f…` | `MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED` |
| `fla-shape-99ff012c139a78f9a1b5dd0f` | `元件 2` | `0b34e71905f0…` | `PENDING_J3_GRADIENT` |

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

### Classification (exactly one per failing shape)

| classification | shapes |
| --- | ---: |
| `AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH` | 8 |
| `MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED` | 7 |
| `PENDING_J3_GRADIENT` (gradient deferred to J3) | 1 |

- `MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED` — the failure is a non-manifold branch junction: the
  model has no rule for a vertex shared by 3+ authored edges, so a boundary walk dead-ends there.
- `AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH` — the failure is an open chain whose closure is **not declared by
  the source**: the only authored geometry joining the tips carries no fill-side ownership, so choosing
  a side would invent semantics rather than parse them. Per the Issue's core safety rule this stays
  fail-closed.

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

`D:\PandaStage-Acceptance\issue718-j0-shape-forensic-20261006\run-12\`

- `j0-shape-forensic.json` — source identity, per-root production verdicts, per-shape content-addressed
  audit (styles, edges with `fillStyle0`/`fillStyle1`/`strokeStyle`, decoded endpoints, per-style
  segments/components/endpoints/orientation, closure evidence, classification), gradient forensic, the
  full rule sweep, and the controls' sweep.
- `completion-receipt.txt`, `completion-receipt.json`.
- `run-13\` — byte-identical repeat run (determinism).

Runner: [`scripts/research/issue718-j0-fill-topology-forensic.cjs`](../../scripts/research/issue718-j0-fill-topology-forensic.cjs)
(reuses only the production `dist-electron` modules; writes outside the repository; refuses to
overwrite; never widens a check; never invents connector geometry).

## Required completion receipt

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

## Next action

Keep PR #677 in draft. J0 stopped at its gate: no source-proven fill rule exists for Blue, so J1 must
not start. Blue coherent reassembly remains blocked by the vector-shape capability gap; do not weaken
the contract to force a `CLEAR_FOR_717`, and do not resume #717 at I1.
