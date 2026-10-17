# Issue #717 — Stage B5-I: Coherent Character Reassembly Generalization (Blue Cultivator)

- Issue: [#717](https://github.com/Cognitive-Architect/panda-stage/issues/717)
- Parents: [#696](https://github.com/Cognitive-Architect/panda-stage/issues/696) / [#701](https://github.com/Cognitive-Architect/panda-stage/issues/701)
- Evidence: #706 (`wave1-static-character-b`), #707
- Parallel frozen timing line: #715 / #716 (PARTIAL; not used by this slice)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT)
- Baseline head: `299599ee1e852a5024983346359dd6de0d861554`
- Scope executed: **I0 only (read-only census). No production behavior changed. I1+ not started.**

> Serial contract: I0 must select exactly one `SAFE_STATIC_REASSEMBLY` complete-character target
> before any I1–I5 work. This document is the I0 evidence and receipt for that gate.

## Result

**I0 = BLOCKED — `reason = NO_SAFE_STATIC_COMPLETE_STATE`.**

No complete-character state in `蓝衣修仙男（补面需求）.fla` composes through the current production
static-reassembly path. Every scene-level character root fails closed inside the production SVG
builder on **vector shape semantics**, not on transform, timing, or nesting:

| Character root (referenced by Scene frame 0) | Production compose outcome | Blocker family |
| --- | --- | --- |
| Scene `场景 1` frame 0 | `TARGET_UNSUPPORTED` | `SHAPE_FILL_TOPOLOGY` |
| `…com2/…com6` | `TARGET_UNSUPPORTED` | `SHAPE_FILL_TOPOLOGY` |
| `元件 1` | `TARGET_UNSUPPORTED` | `SHAPE_FILL_TOPOLOGY` |
| `元件 2` | `RENDER_FAILED` | `GRADIENT_MATRIX` |

The only states that render are individual **components** (`com3`, `com4`, `com5`, `com9`, `com10`,
`com11`), which the Issue explicitly forbids combining into an invented target. Per the I0 selection
rule the census stops rather than fabricating a composite.

## Method and source integrity

- Inspected the real FLA through the shared production modules under `dist-electron`: the C3
  recovery classifier, the XFL display-list adapter, the nested/display-list resolver, and the
  static-snapshot SVG builder. No check was widened, no source repaired, no fixture-name branch added.
- Read-only. The recovery classifier identified the malformed-archive EOCD case (central-directory
  size short by 54 bytes) and the existing helper normalized it **in memory only**; the original file
  was never written.
- Two identical runs. The I0 census artifact, receipt, and every per-candidate classification were
  deterministic (byte-identical output directories).

| | value |
| --- | --- |
| Primary fixture | `D:\表情合集\蓝衣修仙男（补面需求）.fla` |
| SHA-256 before / after | `3fdb31478c6e5fe3ffca30f27fe69d9b3ba8f29f4bcf28eb39b9ce1b0fa3fdf2` / unchanged |
| Classifier state | `RECOVERY_CANDIDATE` → in-memory normalize (`deltaBytes = 54`, original not written) |
| Stage / fps | 1280×720 / 30 (`creatorInfo: Adobe Animate`) |
| Library symbols | 11 (all `graphic`; 0 MovieClip, 0 ActionScript payload) |
| Scene timelines | 1 (`场景 1`, 1 authored frame, `keyMode 9728`) |

## Source reference graph

The library is a fully connected tree (no orphan symbols):

```text
(SCENE) 场景 1 @ frame 0
├── 修仙男-cilisucaicom2/修仙男-cilisucaicom6            (30f, 3 layers, held)
│   ├── 修仙男-cilisucaicom2/修仙男-cilisucaicom11        (1f)
│   ├── 修仙男-cilisucaicom2/修仙男-cilisucaicom7         (1f)
│   └── 修仙男-cilisucaicom2/修仙男-cilisucaicom8         (333f)
│       ├── 修仙男-cilisucaicom2/修仙男-cilisucaicom1/修仙男-cilisucaicom3 (21f, motion)
│       │   ├── 修仙男-cilisucaicom2/修仙男-cilisucaicom1/修仙男-cilisucaicom4 (1f)
│       │   └── 修仙男-cilisucaicom2/修仙男-cilisucaicom1/修仙男-cilisucaicom5 (1f)
│       └── 修仙男-cilisucaicom2/修仙男-cilisucaicom9     (6f)
│           └── 修仙男-cilisucaicom2/修仙男-cilisucaicom10 (1f)
├── 元件 1
└── 元件 2
```

The three Scene instances are the character roots; everything else is a nested component.

## Per-candidate census (I0)

`HELD_OR_AUTHORED` = selected frame is an authored/held state; `TWEEN_START_AUTHORED` = selected
frame is the authored start keyframe of a motion span (no interpolation needed).

| Candidate | Root? | Frames | Frame class | Nested timing | Classification | Compose outcome |
| --- | :---: | ---: | --- | --- | --- | --- |
| `(SCENE) 场景 1` | ✔ | 1 | HELD_OR_AUTHORED | default Loop, no first/last | **UNSUPPORTED_SEMANTIC** | `open fill boundary` |
| `…com6` | ✔ | 30 | HELD_OR_AUTHORED | default Loop, no first/last | **UNSUPPORTED_SEMANTIC** | `open fill boundary` |
| `元件 1` | ✔ | 1 | HELD_OR_AUTHORED | (no nested) | **UNSUPPORTED_SEMANTIC** | `open fill boundary` |
| `元件 2` | ✔ | 1 | HELD_OR_AUTHORED | (no nested) | **UNSUPPORTED_SEMANTIC** | malformed/missing gradient matrix |
| `…com7` | | 1 | HELD_OR_AUTHORED | (no nested) | UNSUPPORTED_SEMANTIC | `open fill boundary` |
| `…com8` | | 333 | HELD_OR_AUTHORED | (no nested) | UNSUPPORTED_SEMANTIC | `open fill boundary` |
| `…com3` | | 21 | TWEEN_START_AUTHORED | default Loop, no first/last | COMPONENT_ONLY | OK (4 shapes, 206×287) |
| `…com4` | | 1 | HELD_OR_AUTHORED | (no nested) | COMPONENT_ONLY | OK (2 shapes, 115×282) |
| `…com5` | | 1 | HELD_OR_AUTHORED | (no nested) | COMPONENT_ONLY | OK (2 shapes, 124×274) |
| `…com9` | | 6 | HELD_OR_AUTHORED | (no nested) | COMPONENT_ONLY | OK (1 shape, 66×65) |
| `…com10` | | 1 | HELD_OR_AUTHORED | (no nested) | COMPONENT_ONLY | OK (7 shapes, 410×899) |
| `…com11` | | 1 | HELD_OR_AUTHORED | (no nested) | COMPONENT_ONLY | OK (2 shapes, 282×428) |

Summary: 12 candidates · 4 complete-character roots · **0 safe static complete roots** ·
6 component-only · 6 unsupported-semantic · 0 temporal-dependent ·
blocker families `{SHAPE_FILL_TOPOLOGY: 5, GRADIENT_MATRIX: 1}`.

## Why this is a vector-shape gap, not a transform/timing/nesting gap

The Issue's authorized production scope (and its pressure point) is transform-sensitive
reassembly: parent→child transform composition, registration/origin, nested ownership/address,
painter order. The Blue blocker is none of those:

- **Nested timing is already the proven default case.** Scene frame 0 instances (`com6`, `元件 1`,
  `元件 2`) and the `com6` children are all `loop` with no `firstFrame`/`lastFrame`, at containing
  span start 0 — the zero-origin, no-wrap default Loop that #703/#707 proved. The resolver
  succeeds (`resolved.ok = true`) for every candidate. **No #715 unresolved timing semantic is
  used**, and no Loop wrap / animated-firstFrame behaviour is required.
- **Transforms compose without error.** The display list resolves with the source-authored
  transforms intact (e.g. Scene `com6` local `(a=0.839, d=0.839, tx=402.4, ty=80.75)`; `com6`
  children `com11`/`com8`/`com7` at `(38.75,49.7)`/`(177.45,403.05)`/`(141.15,168.15)`). The
  failure is not raised by, and cannot be fixed by, transform composition.
- **The failure is shape-local.** The builder decodes each shape's edges and stitches fill
  contours in **shape-local space** (`buildStyleAwareShapeRepresentation` → `reconstructFills`),
  then applies each node's `worldTransform` only at SVG emit time. A group/instance transform
  therefore cannot open or close a fill boundary.
- **The gap is explicit XFL shape data.** The failing shapes are large multi-region Animate
  shapes; e.g. `com6`'s `fe5042…` has 25 fill styles, 480 edges, and fill references that do not
  stitch into closed contours. The builder fails closed with `TARGET_UNSUPPORTED` (open fill
  boundary) / `RENDER_FAILED` (malformed gradient matrix) rather than guessing.

Fixing this would require a new **shape-tessellation** capability (implicit/ambiguous fill
contour closure, plus a gradient-matrix fallback). That is a different capability family from the
transform/registration/nesting/painter-order changes this Issue authorizes, and is analogous to
the Issue's own "full filter/effect engine" STOP example. It is therefore **not** implemented here.

The archive authors no other unsupported effect family (0 filters, 0 masks, 0 blend modes, 0
bitmap/text instances, 0 MovieClip, and a single empty `<scripts/>` with no payload), so I4.5
fidelity risk is limited to the vector-shape blockers above.

Consistent with #706's recommendation — "keep TRANSFORM/UNKNOWN_SEMANTIC fail-closed until a
reusable cause is established" — this census establishes a *reusable cause* (`SHAPE_FILL_TOPOLOGY`)
and leaves it fail-closed.

## Gate position

- **I0 complete. I1 not started** — no `SAFE_STATIC_REASSEMBLY` complete-character target exists, so
  per the I0 selection rule the census stops (`BLOCKED: NO_SAFE_STATIC_COMPLETE_STATE`).
- No production file changed; no test/gate lowered; no `Full CI` triggered; no source mutation;
  no tween interpolation, MovieClip runtime, Script execution, product UI, or persisted schema.
- Source fixture byte-identical before/after.

## Evidence

`D:\PandaStage-Acceptance\issue717-b5i-blue-reassembly-20261006\run-1\`

- `i0-census.json` — source identity, reference graph, per-candidate structure + transforms +
  production resolve/compose outcome, summary, selection.
- `completion-receipt.txt`, `completion-receipt.json`.

Runner: [`scripts/research/issue717-blue-reassembly-census.cjs`](../../scripts/research/issue717-blue-reassembly-census.cjs)
(reuses only the production `dist-electron` modules; writes outside the repository; refuses to
overwrite; never widens a check).

## Required completion receipt

```text
Issue: Stage B5-I Coherent Character Reassembly Generalization — Blue Cultivator
parents: #696 / #701
evidence: #706 / #707
parallel frozen timing line: #715 / #716
mother PR: #677
baseline head: 299599ee1e852a5024983346359dd6de0d861554

primary fixture:
path: D:\表情合集\蓝衣修仙男（补面需求）.fla
SHA-256 before: 3fdb31478c6e5fe3ffca30f27fe69d9b3ba8f29f4bcf28eb39b9ce1b0fa3fdf2
SHA-256 after:  3fdb31478c6e5fe3ffca30f27fe69d9b3ba8f29f4bcf28eb39b9ce1b0fa3fdf2

I0:
candidate states: 12 (1 Scene + 11 library Graphics)
safe static candidates: 0
temporal-dependent candidates: 0
unsupported candidates: 6 (Scene, com6, com7, com8, 元件 1, 元件 2)
component-only candidates: 6 (com3, com4, com5, com9, com10, com11)
selected target: (none)
result: BLOCKED — reason NO_SAFE_STATIC_COMPLETE_STATE (blocker families SHAPE_FILL_TOPOLOGY:5, GRADIENT_MATRIX:1)

I1:
source address: NOT_REACHED
parent/root address: NOT_REACHED
frame/state: NOT_REACHED
active instances: NOT_REACHED
nested chain: NOT_REACHED
layer order: NOT_REACHED
unsupported semantics: SHAPE_FILL_TOPOLOGY (open fill boundary); GRADIENT_MATRIX (malformed/missing gradient matrix)
result: NOT_STARTED

I2:
hierarchy reconstruction: NOT_STARTED
production seam: existing display-list resolver / SVG builder (unchanged)
source provenance complete: n/a
result: NOT_STARTED

I3:
transform semantics encountered: none blocking (source transforms compose; failure is shape-local)
translation: source-authored, composes (Scene com6 tx=402.4 ty=80.75; 元件1 tx=99.35; 元件2 tx=723.8)
scale: source-authored (Scene com6 a=d=0.839035034179688)
rotation: not blocking
matrix composition: resolves without error (resolved.ok = true for every candidate)
registration/origin: not blocking
unknown transform semantics: NONE observed
manual repair: NO
fixture-specific production branch: NO
result: NOT_STARTED (no safe target)

I4:
SVG: NOT_PRODUCED (blocked at I0)
PNG: NOT_PRODUCED (blocked at I0)
manifest: NOT_PRODUCED
transform receipt: NOT_PRODUCED
repeat-run determinism: census PASS across two identical runs
result: BLOCKED at I0

I4.5:
filters: 0 (none authored in the whole archive)
masks: 0
blend modes: 0
other fidelity blockers: SHAPE_FILL_TOPOLOGY, GRADIENT_MATRIX (block compose before fidelity review)
full visual PASS eligible: NO
result: BLOCKED

I5:
human visual review: NOT_REACHED (no coherent artifact exists)
result: NOT_REACHED

#707 regression: unaffected (no production change)
#713 regression where relevant: unaffected (no production change)
#715 unresolved timing semantics used: NO
source mutation: NO
tween interpolation added: NO
MovieClip runtime added: NO
ActionScript added: NO
product UI added: NO

focused tests: none (research script only; no production behavior changed)
normal required CI: not triggered

final result:
- BLOCKED: BLUE COHERENT STATIC REASSEMBLY has NO_SAFE_STATIC_COMPLETE_STATE —
  exact capability gap = production shape fill-topology stitching (open fill boundary)
  plus gradient-matrix fallback; both are outside the Issue-authorized transform scope.

next single action:
Maintainer decides whether to open a separate bounded Shape-Tessellation issue
(open/ambiguous fill contour closure + gradient-matrix fallback) as the prerequisite for Blue
coherent reassembly, or to re-scope B5-I onto a different character fixture whose complete
state renders under the current shape semantics.
```

## Next action

Keep PR #677 in draft. Blue coherent reassembly cannot proceed until the vector shape
fill-topology gap is resolved under a separate bounded decision; alternatively B5-I can be
re-pointed at a character fixture whose complete state already renders. Do not mark PR #677
Ready/merge, and do not fabricate a Blue composite from components.
