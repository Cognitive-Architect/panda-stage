# Issue #730 — `parentLayerIndex` frame metadata semantics

## Outcome

**`PARENT_LAYER_INDEX_REQUIRES_PARENTING_SEMANTICS`**

The `向右走.fla` blocker is caused by `parentLayerIndex` on both tween endpoint
frames. The frame pair otherwise fits the currently bounded duration-5 motion
family. However, Adobe documents per-keyframe layer parenting and inherited
parent transforms, and this fixture's frame values align with animated parent
layers' `layerRiggingIndex` values. Treating the attribute as inert metadata is
therefore not justified. The in-memory shadow probe proves only that the local
interpolation gate can build the child tween after an exact one-attribute
allowlist change; it does not implement or validate parenting composition.

No production files or FLA files were changed. No metadata authorization was
granted. Keep the production adapter fail-closed for this frame metadata.

## Scope and evidence inputs

- Issue: [#730](https://github.com/Cognitive-Architect/panda-stage/issues/730)
- Implementation parent: [#729](https://github.com/Cognitive-Architect/panda-stage/issues/729)
- Evidence record: [#720](https://github.com/Cognitive-Architect/panda-stage/issues/720)
- Accepted control: [#713](https://github.com/Cognitive-Architect/panda-stage/issues/713)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677), open and Draft
- Baseline: `709757f162b34612621c7a235b35e883399617c7` on
  `issue-676-p0-c01-display-list-resolver`
- Source: `D:\表情合集\向右走.fla`, SHA-256
  `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098`
- Control: `D:\表情合集\人物倒地.fla`, SHA-256
  `bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d`
- Read-only harness:
  [`issue730-parent-layer-index-forensics.cjs`](../../scripts/research/issue730-parent-layer-index-forensics.cjs)
- Detailed machine output and completion receipt were written outside the
  checkout under
  `D:\PandaStage-Acceptance\issue730-parent-layer-index-audit-run2-20261007\`.

The harness checked the fixture hashes before and after the run and scanned all
14 local FLA files. Two runs of the same harness revision produced identical
JSON SHA-256 `6F0E224222187A846652B1FE2E62EE634D86C2E7A5E4863BD61823E352D22A21`
and completion receipt SHA-256
`60D5C83E47BE84D95A1E2D0823649D71D4740AFA68ED5B062C6D86167AC2B31E`.

## S0 — Reproduce the #729 blocker

The production resolver deterministically reproduced the existing blocker:

- Requested root frame: `图层转元件_278`, F1, `NESTED_SELECTOR`.
- Resolved ancestors: root → `便衣道士-cilisucai.com1/便衣道士-cilisucai.com22@1`
  → `便衣道士-cilisucai.com1/便衣道士-cilisucai.com18@207`.
- First blocked child: `便衣道士-cilisucai.com1/便衣道士-cilisucai.com26`,
  layer 1, selected child frame F1; outgoing span F0→F5, duration 5.
- `sourceAddress`:
  `nested:nested:issue729-r4:图层转元件_278@1/layer-0-frame-0/0->便衣道士-cilisucai.com1/便衣道士-cilisucai.com22@1/layer-1-frame-0/0->便衣道士-cilisucai.com1/便衣道士-cilisucai.com18@207/layer-0-frame-206/0`
- Production error: `Graphic frame 1 requires unsupported motion tween interpolation on layer 1: source metadata falls outside the bounded transform-only subset`.

The root has 30 requested frames; 3 resolve and 27 are blocked. The resolver
currently composes ancestor symbol transforms, but has no same-timeline sibling
rig-parent composition path.

## S1 — Predicate matrix

The pair was evaluated against each predicate in
`isBoundedMotionFramePair()` in
[`fla-static-snapshot-display-list-adapter.ts`](../../src/main/services/fla-static-snapshot-display-list-adapter.ts).
Only the two frame-attribute checks fail; each endpoint has one additional
attribute, `parentLayerIndex`.

| Predicate | Current expectation | Real value | Status | Decisive? |
| --- | --- | --- | --- | --- |
| Allowed start `DOMFrame` attributes | `index`, `duration`, `tweenType`, `motionTweenSnap`, `keyMode` | Those five plus `parentLayerIndex` | **FAIL** | **Yes** |
| Allowed end `DOMFrame` attributes | Same explicit allowlist | Those five plus `parentLayerIndex` | **FAIL** | **Yes** |
| Duration membership | `{2, 3, 5, 6, 14, 29}` | `5` | PASS | No |
| Start/end index relationship | `end = start + duration` | `0→5` | PASS | No |
| `tweenType` | Start is `motion`; end is a valid motion endpoint | Both `motion` | PASS | No |
| `motionTweenSnap` | Motion endpoints use `true` | Both `true` | PASS | No |
| `keyMode` | Motion endpoints use `22017` | Both `22017` | PASS | No |
| Unsupported motion metadata | No easing, path, rotation, filter, color, shape, or unknown motion metadata | None observed | PASS | No |
| Endpoint element count/type | One `DOMSymbolInstance` per endpoint | One Graphic instance at each endpoint | PASS | No |
| Visibility | Endpoint instance is visible | Both `visible=true` | PASS | No |
| Same Graphic/library identity | Stable identity and `symbolType=graphic` | Both `便衣道士-cilisucai.com1/便衣道士-cilisucai.com24` | PASS | No |
| Matrix parseability | One finite affine Matrix per endpoint | Both finite; see F0/F5 matrices below | PASS | No |
| `transformationPoint` | Zero or one finite Point | One at each endpoint: `(57.45, 8.8)` | PASS | No |
| Instance attribute allowlist | Known attributes and stable semantic identity | Known attributes; identity stable | PASS | No |
| Downstream transform-only guard/interpolator | Transform-only context builds through production interpolation | Exact one-attribute shadow builds F1; production interpolator builds F1–F4 | PASS under shadow | No |

```text
DECISIVE_FAIL_PREDICATES = [
  "Allowed start DOMFrame attributes",
  "Allowed end DOMFrame attributes"
]
```

## S2 — Local corpus census

The read-only scan covered 14 FLAs and 880 XML entries. It found 62 total
`parentLayerIndex` occurrences: 60 on `DOMFrame` and 2 on `DOMLayer`; values
were `0` 32 times and `1` 30 times. The 54 `motion` frame occurrences and 8
absent/non-motion occurrences include the two `DOMLayer` entries.

| FLA | Occurrences | Details |
| --- | ---: | --- |
| `向右走.fla` | 10 | All `DOMFrame`; five value `0`, five value `1`; all motion. |
| `向左冲.fla` | 10 | All `DOMFrame`; five value `0`, five value `1`; all motion. |
| `向左点头.fla` | 10 | All `DOMFrame`; five value `0`, five value `1`; all motion. |
| `性感修仙女.fla` | 10 | All `DOMFrame`; values split 5/5; 8 motion, 2 with no `tweenType`. |
| `性感泳装女（补面需求）.fla` | 10 | All `DOMFrame`; values split 5/5; 8 motion, 2 with no `tweenType`. |
| `黑衣修仙男.fla` | 10 | All `DOMFrame`; values split 5/5; 8 motion, 2 with no `tweenType`. |
| `飞行中旋转.fla` | 2 | Both `DOMLayer`, value `0`. |
| `人物倒地.fla` (#713 control) | 0 | No occurrences. |
| `剑.fla` | 0 | No occurrences. |
| `文件.fla` | 0 | No occurrences. |
| `沙雕表情大全（免费分享，短剧慎用）.fla` | 0 | No occurrences. |
| `炼丹房.fla` | 0 | No occurrences. |
| `蓝衣修仙男（补面需求）.fla` | 0 | No occurrences. |
| `跑步.fla` | 0 | No occurrences. |

In `向右走.fla`, all ten occurrences are in
`LIBRARY/便衣道士-cilisucai.com1/便衣道士-cilisucai.com26.xml`. On layer
ordinal 1 (`元件_10`), frames 0, 5, 10, 15, and 20 carry value `1`. On layer
ordinal 3 (`元件_11`), the same frame indexes carry value `0`. The F20 records
have no `duration`; the other four keys on each layer have duration 5.
Each child layer repeats the same value on all five listed keyframes; in
particular, the blocked F0/F5 pair has `1` on both endpoints. No endpoint
reparenting occurs within that span. The matched candidate parent layers are
separate animated Graphic layers, not guide/folder/mask layers.

## S3 — Structure and transform relevance

`com26` has five layers. The two child layers and candidate rig layers are:

| DOM layer ordinal | Name | Role found in this archive |
| ---: | --- | --- |
| 0 | `补间_19` | No matching rig index observed. |
| 1 | `元件_10` | Child Graphic `com24`; its keyframes carry `parentLayerIndex=1`. |
| 2 | `补间_21` | Animated Graphic `com14`; `layerRiggingIndex=1`. |
| 3 | `元件_11` | Child Graphic `com25`; its keyframes carry `parentLayerIndex=0`. |
| 4 | `补间_22` | Animated Graphic `com15`; `layerRiggingIndex=0`. |

Thus, the repeated frame-level values match the `layerRiggingIndex` of the
corresponding animated Graphic layers: `元件_10` → `补间_21`, and `元件_11` →
`补间_22`. Direct ordinal lookup would point elsewhere. This is strong
serialization evidence, but the exact mapping from this XFL field to Animate's
runtime parenting model remains an inference rather than a schema guarantee.

| Hypothesis | Evidence for | Evidence against / limit | Finding |
| --- | --- | --- | --- |
| H1: editor/layer-hierarchy metadata only | It is serialized on frames and no Panda frame-level consumer was found. | Adobe documents per-keyframe parenting with inherited transforms; values match animated rig-layer indexes. | Not supported as metadata-only. |
| H2: identifies a parent whose transform affects the child | `parentLayerIndex` values match `layerRiggingIndex` on animated Graphic parent candidates; both local matrices change during F0–F5; Adobe describes inherited parent transforms. | Exact raw-field mapping and composition/pivot formula are not independently proven for this XFL version. | Strongest hypothesis; requires parenting semantics. |
| H3: guide/motion-guide parenting | No guide layer or path metadata was observed on the matched layers or child tween. | The census does not establish every possible guide encoding in other files. | No supporting evidence in this fixture. |
| H4: participates directly in tween interpolation or target resolution | It is present on both tween endpoints and may affect evaluated display transforms through parenting. | No source says it changes the tween interpolation function; production interpolation can build the child's local matrices without composing a parent. | Direct interpolation effect unproven; parent transform semantics remain relevant. |
| H5: serialization residue safe to ignore for this bounded span | The child span otherwise passes the bounded local transform predicates. | Repeated values align with animated parent layers, and Adobe documents per-keyframe parent transform inheritance. | Not safe to ignore on current evidence. |

Panda currently composes ancestor symbol transforms, but does not compose
same-timeline sibling rig-parent transforms. Removing a real parenting
relationship would therefore be expected to change inherited composition if
the field mapping is correct; the exact visual result remains unverified.

For the blocked `元件_10` child and `补间_21` parent, both local transforms
change across F0→F5:

| Frame | Child `(a,b,c,d,tx,ty)` | Parent `(a,b,c,d,tx,ty)` |
| ---: | --- | --- |
| F0 | `(1, 0, 0, 1, -28.3, 70.65)` | `(1, 0, 0, 1, 165, 139.95)` |
| F1 | `(0.979049, -0.203488, 0.203488, 0.979049, -24.25, 81.3)` | `(0.994971, 0.100140, -0.100140, 0.994971, 157.49, 136.25)` |
| F5 | `(0.519348, -0.854401, 0.854401, 0.519348, -8.05, 123.9)` | `(0.876831, 0.480774, -0.480774, 0.876831, 127.45, 121.45)` |

These are independently sampled local matrices. No combined child/parent
matrix is claimed because the exact pivot and propagation formula for this
serialized version has not been established.

## S4 — Consumer search and external semantics

Repository search found no production consumer of frame-level
`DOMFrame.parentLayerIndex` or `layerRiggingIndex`. The parser reads
`parentLayerIndex` from `DOMLayer` and uses that field to build mask relations
([`fla-parser.ts`](../../src/renderer/fla-import/parser-core/fla-parser.ts));
that is a distinct element location. The current display-list resolver
composes nested symbol transforms, not same-timeline rig-parent transforms.

Adobe's [Animate timeline layer documentation](https://helpx.adobe.com/animate/desktop/workspace-and-workflow/timeline-layers.html)
describes layer parenting as a per-keyframe relationship in which a child
inherits parent position and rotation; the relationship can change at later
keyframes. It also describes scale, skew, and flip propagation in newer
Animate versions. This is **DIRECT_ADOBE** evidence for parenting semantics,
but it does not document the exact raw XFL `DOMFrame.parentLayerIndex` mapping
in this fixture.

The [JPEXS XFL converter](https://github.com/jindrapetrik/jpexs-decompiler/blob/master/libsrc/ffdec_lib/src/com/jpexs/decompiler/flash/xfl/XFLConverter.java#L4918-L4983)
emits `parentLayerIndex` on `DOMLayer` while reconstructing clip-depth masks.
That is **SOURCE_CODE** evidence for a different element/role and does not
justify ignoring the frame-level attribute here. The fixture's repeated
frame-level values and matched rig indexes are **SERIALIZATION_EVIDENCE**.

No independent Adobe runtime render was run for this fixture (**RUNTIME_EVIDENCE:
NOT RUN**). The remaining unknowns are the exact serialized-version matrix and
pivot propagation formula and pixel-level parity in Panda. The classification
does not treat either as settled.

## S5 — Compare the accepted #713 duration-5 control

The selected control is `人物倒地.fla`, Graphic
`肌肉男-cilisucai.com11 3`, layer 1 (`元件_1`), F25→F30. It has no frame-level
`parentLayerIndex` occurrences. The outgoing frame is duration 5, motion,
snap=true, keyMode=22017; the endpoint begins a held span with keyMode=15872 and
duration 17. Both endpoints contain the same visible Graphic, have a finite
matrix and point, and pass the existing production interpolator. F26 resolves
to translation `(1288.99, 452.2)`.

The #713 control establishes that duration 5 is supported for the existing
bounded transform-only family. It does not establish that the `com26` pair is
equivalent: the latter has `parentLayerIndex` on both endpoint frames, and its
F5 endpoint is itself the start of the next motion span (snap=true,
keyMode=22017, duration 5). The control's F30 endpoint instead begins a held
span. The one-attribute difference is exactly what the shadow isolates, but
the semantic layer relationship is an additional behavior question.

```text
COM26_VS_ACCEPTED_DURATION5_DIFF = parentLayerIndex + other semantic differences
```

The local tween predicates otherwise match the accepted transform-only family;
the additional semantic differences are the candidate parent relationship and
the com26 F5 next-motion role versus the control's F30 held-span role.

## S6 — Exact one-attribute in-memory shadow

The harness loaded the compiled production adapter into a separate in-memory
module and added only `parentLayerIndex` to
`BOUNDED_MOTION_FRAME_ATTRIBUTES`. It asserted the original five allowlist
members, asserted exactly one added source occurrence, and verified the
compiled adapter hash was unchanged. Under that shadow:

- `buildGraphicFrameContext()` for child F1 succeeds.
- No bounded-pair blockers remain.
- The existing production interpolator builds the child F1–F4 transforms.
- Parent and child local transforms are sampled for F0–F5, and the parent
  matrix changes across the span.
- `向右走.fla`, `人物倒地.fla`, and all 14 corpus FLA hashes remain unchanged.

This is a **mechanical compatibility** result only. The shadow neither composes
parent transforms nor establishes correct display-list output. It provides no
authorization to change the production allowlist.

## S7–S8 — Boundary and classification

**Candidate authorization: none for frame-level `parentLayerIndex` alone.**
Any future support needs a separately scoped Animate layer-parenting/rig
contract that defines per-keyframe parent identity, parent transform
composition, pivot behavior, and interaction with the child tween. Until then,
keep the current bounded adapter strict: do not add this attribute to the
allowlist, ignore unknown frame metadata, infer that equal endpoint values
cancel its semantics, or implement sibling-layer composition as part of this
research task.

Final classification: **`PARENT_LAYER_INDEX_REQUIRES_PARENTING_SEMANTICS`**.

Recommended next action: if this FLA family must render, authorize a separate
research and implementation path for Animate layer-parenting semantics. Keep
the current adapter fail-closed in the meantime.

The negative checks are explicit: an innocuous-sounding name does not prove
inertness; equal values on both endpoints do not cancel runtime semantics; a
passing shadow proves only local gate compatibility; accepted duration 5 does
not authorize new metadata; and an open-source writer for `DOMLayer` does not
prove that frame-level `DOMFrame.parentLayerIndex` is ignored.

## Validation and completion receipt

The focused research checks passed:

```powershell
node --check scripts/research/issue730-parent-layer-index-forensics.cjs
pnpm exec eslint scripts/research/issue730-parent-layer-index-forensics.cjs
git diff --check
```

The harness was run twice against the same source and corpus; both output pairs
were byte-identical by SHA-256 as recorded above. No production source,
production tests, fixture, issue, or PR state was changed by the research.
Manual Full CI and `pnpm verify:project` were not run.

The machine-readable completion receipt is at
`D:\PandaStage-Acceptance\issue730-parent-layer-index-audit-run2-20261007\completion-receipt.txt`.
