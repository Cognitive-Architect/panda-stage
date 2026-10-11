# Issue #754 current-head recensus

- **Status:** `PARTIAL_PENDING_OWNER_REVIEW`
- **Run head:** `902c820cd33f83d3aca9a7802979924e320b7013` on `issue-676-p0-c01-display-list-resolver`
- **Parent PR:** [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677), still open and draft
- **Evidence captured:** 2026-10-11 (Asia/Shanghai)

This is a read-only recensus of the frozen 28-file corpus at the run head. It compares the #732 and #745 machine baselines and the #734 character truth table. The machine receipt records every file, candidate transition, source hash, temporal result, and current Scene/root candidate. It does not claim owner visual acceptance or a pose count.

- [Machine receipt](receipt.json)
- [Review image index](#visual-review-index)
- [Issue #734 character baseline](../../research/issue-734-stage-b5-v0-character-truth-table.md)
- [Issue #735 bounded linear-stroke research](../../research/issue-735-bounded-linear-stroke-research.md)
- [Issue #718 blue topology research](../../research/issue-718-j0-shape-fill-topology.md)
- Accepted Hanfu control: [#747 image](../issue-747/hanfu-full-character.png)
- Accepted BlueWhite control: [#752 image](../issue-752/bluewhite-full-character.png)

## #764 bounded attribution — 2026-10-12

**Disposition: `PARTIAL`; primary classification: `CATALOG_OR_CLASSIFICATION_DRIFT`. No `HUMAN VISUAL PASS` is recorded.** Confidence is high that the new fail-closed gate is the immediate cause of the same-target preview block. Whether the two text nodes belong in the intended character image, and whether the old raster is source-complete, remain unproven. This read-only follow-up aligns the old and current root by source path, original and normalized source hashes, authored symbol/frame, and render-target identity. Candidate ID prefixes are run-specific and are not used as the identity proof.

| Same-target state | #734 evidence | #754 evidence |
| --- | --- | --- |
| Source | `D:\表情合集\新人物\黑袍大师兄（四视角）.fla`; SHA-256 `3ae497bf13e1af8fdfb755cf70cf16d3e94176ea463d5621ae011c83dec53456` | Same path and original SHA before/after. In-memory archive normalization yields the same `dc9521129674b919787ef383f2c66a67801e57e3e1a9986fbf0a0acd6512956a`; no source bytes were written. |
| Root `大师兄-cilisucai.com1 @ 0` | `C734-85AF59526B7E24D43637D3A0`, target `fla-render-target-a359144ad4e8c5781d66336b50673fc53a8ede14824b58fa17bf394ffb2c7d1b`; rendered 438×958, 97 resolved nodes / 44 shapes / 5 expanded symbols. PNG SHA-256 `92783f6fb5d7a8803769443f3b2a1bc44b3aaab4df7a073e2e5ac7e4c23c607d`; SVG SHA-256 `dca50e894a72572086c29fcb45e825942c00be4676346041f5b5c690e430923c`. | Same root candidate and target are catalog-exposed, but `BLOCKED`; no same-target PNG/SVG was produced. Receipt reason: `Visible display content is outside the supported static preview subset (graphic(大师兄-cilisucai.com1)/layer[2]:图层_1/element[0]:symbol(大师兄-cilisucai.com4))`. |
| Selected child `大师兄-cilisucai.com4 @ 0` | `C734-AF4509074CF293E0E6914543`, same child target `fla-render-target-15ef4fc676d709bbc511e96b8f3adfde3dd35a3842c33991ace74d9e0bbd724f`; rendered 389×745, 40 nodes / 20 shapes, PNG SHA-256 `45f23d1957e117b33debfed91fae83f467a196edc723ae88167fdb6c6e6c9d3f`. | `B4-3B0DA15A82D03CA33092B583` maps to that same child by normalized source hash + owner path + frame + target ID. `DISCOVERED_UNSUPPORTED`, `UNKNOWN_SEMANTIC`, no PNG; receipt reason is the generic unsupported-subset message for `graphic(大师兄-cilisucai.com4)`. |

The source `com1@0` instance on layer 2, element 0 names `com4`, has `symbolType="graphic"` and `loop="single frame"`; it omits `firstFrame`. The current selector therefore chooses `com4@0` with rule `single-frame-default-first-frame-zero`. This rules out a different root selection. See the [selector](../../../src/main/services/fla-nested-graphic-frame-selector.ts#L338), [adapter guard](../../../src/main/services/fla-static-snapshot-display-list-adapter.ts#L565), and [candidate catalog propagation](../../../scripts/research/issue706-cross-corpus-electron-probe.cjs#L78).

The first source node that trips the current guard is inside `com4@0`: `frame[0]/elements/DOMGroup[1]/members/DOMGroup[0]/members/DOMStaticText[0]`; a second `DOMStaticText[1]` follows. Both have no `visible="false"` or `isVisible="false"` attribute and carry static text (`oovo96-` and `oovo96`). The same two nodes are present in frames 1, 2, and 6; frames 3–5 have none. The current receipt does not expose that leaf name; its raw error remains the generic unsupported-subset reason above. Commit [`ce1a177`](https://github.com/Cognitive-Architect/panda-stage/commit/ce1a177097876dcf549b4b3e394faaabac590945) changed unknown visible `DOM*` children from ignored (`continue`) to an explicit fail-closed display reason. The catalog resolves `com4` at frame 0 and marks that render target `previewSupported=false`; the probe carries that target-level flag to its authored-frame rows. Thus the `#745→#754` frame 0–5 transitions share this catalog gate: frame 0 blocks the root, while frames 1–5 are not selected by `com1`'s single-frame instance. Frames 3–5 contain no unsupported display node themselves but inherit the target-level block; the #754 probe did not attempt separate SVG renders for those rows. Their status changes are collateral candidate classification changes, not five additional causes of the root loss. The #745 PNG hashes equal the #734 hashes for frames 0, 2, 3, and 5; frames 1 and 4 differ, so the evidence does not claim six identical old rasters. The current frame 6 row is outside the #745→#754 six-transition set.

The old reviewable root image is `D:\PandaStage-Acceptance\issue734-character-static-repeats-20261008-v1\character-02\repeat.png`, SHA-256 `92783f6fb5d7a8803769443f3b2a1bc44b3aaab4df7a073e2e5ac7e4c23c607d`. The old Scene sheet with three coherent figures is `D:\PandaStage-Acceptance\issue734-character-static-20261008-v1\character-02\review-sheet-01.png`, SHA-256 `6d2f70c9f296f29b4e5d819dac370f9f2e9838dfc321493a41d19c3c967be23d`. Current same-target failure is preserved in [the receipt](receipt.json); the existing [current review image](review/02-blackrobe-current-root-review.png) shows only the separate `com6` hair fragment and blank frame, not a `com1` replacement. The old renderer skipped the two text nodes, so their visual role and whether the old full-body image is source-complete remain unverified. For importability, the #734 repeat receipt records `projectMutation=NONE` (preview only, no commit API); the current static-snapshot importer requires a supported checked preview before commit ([import guard](../../../src/renderer/fla-import/FlaStaticSnapshotReview.tsx#L938)). Thus this FLA root is blocked from import through the current snapshot path; whether a previously imported copy exists in a project library was not inspected. Existing #747 and #752 accepted-control root hashes still match the #754 outputs; this is a bounded text-content classification issue, not evidence of a general renderer outage.

**One next action:** owner decides whether those two `DOMStaticText` nodes belong in the character preview; if so, open one bounded implementation issue for this exact nested-Graphic static-text case. No code, FLA, new JSON/PNG path, verification manifest, or CI policy was changed for this attribution.

## Corpus and static summary

All 28 files parsed successfully. The source inventory and SHA-256 values match the #732 and #745 evidence, and the before/after check found all 28 source files unchanged. No source bytes were written; archive normalization was in-memory only.

The static pass examined 620 authored-state candidates: 546 unique renders, 69 exact duplicate candidates in 30 groups, 5 blank candidates, and 815 unsupported candidates. There were no renderer failures. These are machine candidate counts, not counts of complete characters or poses.

### Per-file ledger

`Unique/candidates` is unique rendered output divided by authored-state candidate count. `Dupes` is duplicate candidates/groups. Temporal progress counts only receipt-verified frames; a complete technical receipt does not establish visual coherence.

| Fixture | File | Static unique/candidates | Unsupported / blank / dupes | Temporal probe |
| --- | --- | ---: | ---: | --- |
| effect-01 | `飞奔.跑.fla` | 4/5 | 1 / 0 / 0/0 | Complete, 4/4 |
| effect-02 | `尴尬.fla` | 42/43 | 1 / 0 / 0/0 | Complete, 42/42 |
| effect-03 | `内心独白.fla` | 0/5 | 2 / 0 / 3/1 | Complete, 57/57 |
| effect-04 | `人物死亡消失.fla` | 47/49 | 1 / 1 / 0/0 | Complete, 48/48 |
| effect-05 | `生气.fla` | 6/7 | 1 / 0 / 0/0 | Complete, 6/6 |
| effect-06 | `手忙脚乱.fla` | 0/13 | 1 / 0 / 12/3 | Complete, 12/12 |
| effect-07 | `水花.fla` | 20/22 | 1 / 1 / 0/0 | Complete, 45/45 |
| effect-08 | `叹气.fla` | 9/11 | 1 / 1 / 0/0 | Complete, 39/39 |
| effect-09 | `吐血.fla` | 9/11 | 1 / 1 / 0/0 | Complete, 28/28 |
| effect-10 | `直播间.fla` | 3/7 | 2 / 0 / 2/1 | Blocked, 0/1,741; frame 1 requires unsupported motion-tween interpolation |
| prop-11 | `草药 仙草 灵植 (1).fla` | 21/21 | 0 / 0 / 0/0 | Static only |
| prop-12 | `草药 仙草 灵植.fla` | 27/27 | 0 / 0 / 0/0 | Static only |
| prop-13 | `储物袋.fla` | 2/2 | 0 / 0 / 0/0 | Static only |
| prop-14 | `飞舟、飞船.fla` | 2/2 | 0 / 0 / 0/0 | Static only |
| prop-15 | `莲台.fla` | 2/2 | 0 / 0 / 0/0 | Static only |
| prop-16 | `炼丹炉.fla` | 2/2 | 0 / 0 / 0/0 | Static only |
| prop-17 | `石碑.fla` | 2/2 | 0 / 0 / 0/0 | Static only |
| character-18 | `汉服修仙女.fla` | 27/35 | 8 / 0 / 0/0 | Complete, 30/30 |
| character-19 | `黑袍大师兄（四视角）.fla` | 21/42 | 18 / 1 / 2/1 | Receipt complete, 2/2; frame 1 output is blank 1×1 |
| character-20 | `红伞蝶衣（四视角）.fla` | 21/28 | 7 / 0 / 0/0 | Complete, 30/30 |
| character-21 | `蓝白古装男.fla` | 28/40 | 12 / 0 / 0/0 | Complete, 25/25 |
| character-22 | `蓝发修仙女.fla` | 51/709 | 646 / 0 / 12/5 | No temporal product root; catalog identity gap |
| character-23 | `魔修.fla` | 82/128 | 40 / 0 / 6/3 | No temporal product root; unsupported nested content |
| character-24 | `浅蓝修仙女.fla` | 19/32 | 13 / 0 / 0/0 | No temporal product root; unsupported linear stroke Style 3 |
| character-25 | `青绫修仙女（四视角）.fla` | 26/68 | 22 / 0 / 20/10 | Partial; 74 frames verified across four shorter timelines; the 762-frame target has 96 output PNGs but no complete receipt or clip (836 requested in all) |
| character-26 | `修仙大长老（三视角）.fla` | 22/33 | 7 / 0 / 4/2 | Complete, 30/30 |
| character-27 | `修仙男.fla` | 26/46 | 18 / 0 / 2/1 | No temporal product root; unsupported linear stroke Style 4 |
| character-28 | `修仙宗门圣女（四视角）.fla` | 25/43 | 12 / 0 / 6/3 | Clean retry complete, 30/30; H.264 clip decoded by FFmpeg |

## Comparison with #745

Candidate IDs added/removed: **0/0**. There were **30** status transitions: 8 rendered-to-unsupported, 4 unsupported-to-rendered, and 18 label-only transitions. Common candidates rendered in both runs have unchanged PNG hashes; the same five candidates remain blank. Attempted candidates changed from 624 to 620, while unsupported candidates changed from 811 to 815.

The eight rendered-to-unsupported transitions occur in `直播间.fla`, `黑袍大师兄（四视角）.fla`, and `浅蓝修仙女.fla`. Four unsupported-to-rendered transitions are in Hanfu. No regression was observed in either previously owner-accepted V1 control: the current Hanfu root PNG matches the #747 image hash, and the current BlueWhite root PNG matches the #752 image hash. The black-robe change remains a material baseline loss for owner review; this comparison does not dismiss it.

## 11-character root and pose ledger

The root counts below are machine-discovered Scene or depth-zero Graphic candidates in the receipt. A rendered row is only a candidate for visual review. It is not a complete-character or pose count. Loose accessories and head/hair fragments are excluded from pose counts. No human-validated pose count is asserted; every row is awaiting owner review.

| Fixture | Root candidate ledger | Temporal evidence | Visual review |
| --- | --- | --- | --- |
| character-18 · Hanfu | 2 candidates: Scene and `修仙女…com1`; the latter is 332×673. Its PNG SHA-256 exactly matches the #747 accepted control. | 30/30; 1 authored frame and 29 held frames. | [01 · Hanfu](review/01-hanfu-current-root-review.png) |
| character-19 · Black robe | 4 candidates: Scene and `大师兄…com1` are blocked by nested unsupported content; two `大师兄…com6` rows render at 386×412 and 1×1. The latter is blank. | Receipt says 2/2, but frame 1 is blank; this is not a complete coherent-character result. #734 previously reported three coherent views. | [02 · Black robe](review/02-blackrobe-current-root-review.png) |
| character-20 · Red umbrella | 9 candidates: Scene; `修仙女…/元件 2` at 708×988; `元件 12` has a catalog identity gap; the `披帛` and tween rows are loose components. | 30/30. | [03 · Red umbrella](review/03-red-umbrella-current-root-review.png) |
| character-21 · BlueWhite | 2 candidates: Scene and `蓝衣修士…com1` at 349×994. The root PNG hash exactly matches the #752 accepted control. | 25/25. | [04 · BlueWhite](review/04-bluewhite-current-root-review.png) |
| character-22 · Bluehair | 2 candidates: the Scene render is 1280×720 and contains prominent red blocks; the authored `神女…com809` identity is absent from the product catalog. | No temporal root. | [05 · Bluehair Scene](review/05-bluehair-scene-red-block-review.png) |
| character-23 · Magic | 2 root candidates (Scene and `魔修…com1`) are blocked by unsupported nested content whose leaf includes a linear stroke. A separately rendered hair/head fragment is not a character root. | No temporal root. | [06 · supported fragment](review/06-moxiu-supported-fragment.png) |
| character-24 · Light Blue | 2 candidates (Scene and `修仙女…com2`) are blocked by linear stroke Style 3. Other component renders are not a complete root. | No temporal root. | [07 · component sheet](review/07-lightblue-component-contact-sheet.png) |
| character-25 · Qingling | 35 Scene/depth-zero candidate rows are recorded. The current Scene/root candidates render, but this machine count is not a view count. | Four shorter timelines verify 74 frames. The 762-frame target produced 96 PNGs without a complete receipt or clip; those 96 are not counted as verified frames. | [08a](review/08-qingling-root-scene-review-1.png) · [08b](review/08-qingling-root-scene-review-2.png) · [08c](review/08-qingling-root-scene-review-3.png) |
| character-26 · Elder | 3 candidates: Scene, `元件 1` at 503×875, and `老者…com2` at 484×816. #734 reported two coherent figures; a third view was not established. | 30/30. | [09 · Elder](review/09-elder-root-review.png) |
| character-27 · Male | 2 candidates: Scene and `白发修仙男…com1`; both fail closed on unsupported linear stroke Style 4. A separate `.com6` head/hair fragment is not a complete character. | No temporal root. | [10 · head/hair fragment](review/10-male-white-hair-fragment.png) |
| character-28 · Saint | 3 candidates: Scene, `修仙女…com1` at 678×963, and `修仙女…com3` at 377×470. #734 reported three coherent views; a fourth was not established. | Clean isolated retry: 30/30; 1 authored and 29 held frames; clip produced and decoded. | [11 · Saint](review/11-saint-root-review.png) |

## Root-cause distinctions

- **Open fill:** the current Hanfu root resolves 30/30 and matches the accepted #747 image. Qingling current static/root candidates render and four shorter timelines complete, while the 762-frame timeline is partial. Male's current first blocker is linear stroke, not the frozen open-fill blocker. This does not establish that every open-fill case is fixed.
- **Blue topology:** #718 J0 remains **NO-GO**. Its topology FLA is outside this 28-file corpus; this run adds no topology rule or new evidence for changing that decision.
- **Linear stroke and missing defaults:** Magic, Light Blue, and Male remain fail-closed at current root candidates. The #735 evidence records Hairline on Magic and omitted stroke/default fields on Light Blue. No missing value is inferred or guessed.
- **Bluehair:** the current Scene image still has visible source-authored red blocks, and the actual authored root remains absent from the product catalog. Visual intent is unresolved.
- **Missing views:** filenames and candidate-row totals do not establish pose counts. Owner review must identify which rendered candidates are coherent views; loose parts do not count.

## Provisional next-work ranking for owner decision

This ordering is evidence-based input for the owner; it is **not accepted priority or authorization to expand implementation scope**.

1. Reconcile the Black robe root loss against the #734 three-view baseline and inspect the blocked `.com1` path.
2. Decide a narrowly bounded #755 evidence/implementation scope for linear-stroke Hairline and omitted defaults, using the #735 research and fail-closed cases.
3. Resolve Bluehair's missing product-catalog root and source-authored red-block visual intent; consider #757 for that bounded work.
4. Establish which actual candidates represent additional authored views before setting a pose target; consider #758 only after owner review.
5. Keep Blue topology at #756 **NO-GO** unless fresh evidence covers the out-of-corpus source and changes the current conclusion.

Owner visual review and priority acceptance are still pending. No `HUMAN VISUAL PASS` is recorded.

## Visual review index

The images are current-head probe outputs for inspection, not pre-approved product assets. The Hanfu and BlueWhite accepted controls are linked above; all other candidate rows require visual judgment.

| Image | Review target |
| --- | --- |
| [01 · Hanfu root](review/01-hanfu-current-root-review.png) | Current Scene/root candidates; compare with #747 control |
| [02 · Black robe](review/02-blackrobe-current-root-review.png) | Current near-root outputs and blank 1×1 frame |
| [03 · Red umbrella](review/03-red-umbrella-current-root-review.png) | Scene/root candidates and loose component rows |
| [04 · BlueWhite root](review/04-bluewhite-current-root-review.png) | Current Scene/root candidates; compare with #752 control |
| [05 · Bluehair Scene](review/05-bluehair-scene-red-block-review.png) | Red-block appearance and missing catalog root |
| [06 · Magic fragment](review/06-moxiu-supported-fragment.png) | Supported fragment only; not a complete character |
| [07 · Light Blue components](review/07-lightblue-component-contact-sheet.png) | Component renders while the root remains blocked |
| [08a · Qingling](review/08-qingling-root-scene-review-1.png) · [08b](review/08-qingling-root-scene-review-2.png) · [08c](review/08-qingling-root-scene-review-3.png) | Current Scene/root candidate sheets |
| [09 · Elder](review/09-elder-root-review.png) | Current Scene/root candidate sheet |
| [10 · Male fragment](review/10-male-white-hair-fragment.png) | White-haired head/hair fragment only |
| [11 · Saint](review/11-saint-root-review.png) | Current Scene/root candidate sheet |
