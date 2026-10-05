# Issue #709 — B5-C Tween Interior Reconstruction

Date: 2026-10-05

Status: Gate 0 GO; Gate A prototype complete; Gate B pending approved reference review

Mother PR: #677 (existing draft; no new PR)

## Gate 0 decision

**GO — the authored frame 20 → frame 22 interval is a bounded transform-only motion tween.** The decision is limited to root Graphic frame 21 in this interval. It does not authorize arbitrary motion paths, custom easing, shape tweening, or other spans.

The source-derived candidate semantics are:

- Root layers 1–11 each have one Graphic target in a `motion` span `[20,22)`, with a matching target at the next authored keyframe 22. Layer 0 is held from `[20,47)` and is not tweened.
- Each changing target has a source-authored 2D matrix at frames 20 and 22. The 11 matrices have positive determinant, equal orthogonal columns, no skew, and unit scale within XFL fixed-point precision. Translation and rotation change; scale does not materially change.
- There is no authored frame or property keyframe at 21. The only interior coordinate is halfway through this two-frame span, so default un-eased property progress is `0.5`.
- The archive contains no `MotionObject`, `MotionPath`, `Ease`, `DOMTween`, `AnimationCore`, or `PropertyContainer` elements. The active `DOMFrame` records have `motionTweenSnap="true"` and `keyMode="22017"`, with no easing, rotation-direction, extra-rotation, or acceleration attributes. Rotation is encoded by the start/end matrices; there is no source record for additional turns.
- Each target also stores `centerPoint3DX/Y` and a local `transformationPoint`. The display-list adapter uses the authored `<Matrix>` as the visible affine transform; center-point and transform-point records are retained as source evidence and are not treated as separate render transforms.
- The unchanged layer 0 contains a `Play Once` Graphic beginning at frame 20. At root frame 21 it selects child frame 1. That child frame is an authored, non-tweened `DOMShape` frame.

Adobe describes motion tweens as property-keyframed spans and lists 2D position, rotation, skew, and scale as tweenable properties. Its Motion Editor documentation says ease curves alter the rate of change of a property. Adobe also documents a zero-strength ease as no easing. Applying those rules to this archive is an inference from the missing ease/path records and the two authored endpoint matrices; the frame-21 result still requires the separate visual acceptance in Gate B. References: [motion tween properties and spans](https://helpx.adobe.com/animate/desktop/animation/motion-tween-animation.html), [Motion Editor property curves and easing](https://helpx.adobe.com/animate/desktop/animation/editing-motion-tween-using-motion.html), and [ease strength zero](https://helpx.adobe.com/animate/desktop/animation/bone-tool-animation.html).

The prototype therefore interpolates only the bounded affine transform properties represented by these matrices: position, 2D rotation, and the near-unit uniform scale. It rejects skew, reflection, malformed matrices, custom easing/path data, mismatched targets, and requests outside the source span. It does not interpolate the six matrix coefficients directly, because doing so would shrink a rotating object between its keyframes.

## Source and archive evidence

- Primary source: `D:\表情合集\人物倒地.fla` (210,955 bytes).
- SHA-256 before and after census: `bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d`.
- The production recovery classifier reports `RECOVERY_CANDIDATE`. The existing production normalizer adjusts only `EOCD.centralDirectorySize` by 54 bytes in memory; normalized archive SHA-256: `f2ac3306754037d2b8dd792064cff6dda16803890bf5bb60cbbbf16ca89e0a9e`. The FLA was not written.
- Root Graphic: `肌肉男-cilisucai.com11 3`, 47 frames, 12 visible layers. This matches the accepted #708 source census.
- Source archive scan: 15 library XML files and `DOMDocument.xml`; 94 `DOMFrame` nodes. The full XML scan found zero `MotionObject`, `MotionPath`, `Ease`, `DOMTween`, `AnimationCore`, and `PropertyContainer` elements.

### Active root spans and endpoint matrices

Matrices use the XFL order `(a,b,c,d,tx,ty)`.

| Layer | Graphic target | Frame 20 span / tween | Frame 20 matrix | Frame 22 span / tween | Frame 22 matrix |
| ---: | --- | --- | --- | --- | --- |
| 0 | `肌肉男-cilisucai.com11 1/肌肉男-cilisucai.com11 2` | `[20,47)` / `none` (held) | `(-4.44100952148438,-2.80485534667969,-3.9571533203125,6.2655029296875,1203.2,660.9)` | held from `[20,47)` | same |
| 1 | `肌肉男-cilisucai.com11 9` | `[20,22)` / `motion` | `(0.422882080078125,0.906173706054688,-0.906173706054688,0.422882080078125,817.35,349.05)` | `[22,25)` / `motion` | `(0.1009521484375,0.994873046875,-0.994873046875,0.1009521484375,1260.7,472.6)` |
| 2 | `肌肉男-cilisucai.com11 15` | `[20,22)` / `motion` | `(-0.969955444335938,0.24322509765625,-0.24322509765625,-0.969955444335938,648.9,534.1)` | `[22,25)` / `motion` | `(-0.995941162109375,-0.0896759033203125,0.0896759033203125,-0.995941162109375,1040.75,591.9)` |
| 3 | `肌肉男-cilisucai.com11 10` | `[20,22)` / `motion` | `(-0.906173706054688,0.422882080078125,-0.422882080078125,-0.906173706054688,643.5,562.7)` | `[22,25)` / `motion` | `(-0.994873046875,0.1009521484375,-0.1009521484375,-0.994873046875,1026.2,617.1)` |
| 4 | `肌肉男-cilisucai.com11 8` | `[20,22)` / `motion` | `(0.422882080078125,0.906173706054688,-0.906173706054688,0.422882080078125,503.2,609.05)` | `[22,25)` / `motion` | `(0.1009521484375,0.994873046875,-0.994873046875,0.1009521484375,878.5,614.7)` |
| 5 | `肌肉男-cilisucai.com11 7` | `[20,22)` / `motion` | `(-0.611923217773438,0.790878295898438,-0.790878295898438,-0.611923217773438,442.1,619.95)` | `[22,25)` / `motion` | `(-0.838180541992188,0.545303344726562,-0.545303344726562,-0.838180541992188,817.2,604.85)` |
| 6 | `肌肉男-cilisucai.com11 6` | `[20,22)` / `motion` | `(-0.3863525390625,0.92230224609375,-0.92230224609375,-0.3863525390625,324.5,556.05)` | `[22,25)` / `motion` | `(-0.66845703125,0.743667602539062,-0.743667602539062,-0.66845703125,727.2,505.8)` |
| 7 | `肌肉男-cilisucai.com11 5` | `[20,22)` / `motion` | `(-0.78131103515625,0.624069213867188,-0.624069213867188,-0.78131103515625,450.1,555.85)` | `[22,25)` / `motion` | `(-0.943206787109375,0.33203125,-0.33203125,-0.943206787109375,845.85,547)` |
| 8 | `肌肉男-cilisucai.com11 4` | `[20,22)` / `motion` | `(-0.494918823242188,0.868881225585938,-0.868881225585938,-0.494918823242188,356.7,447.35)` | `[22,25)` / `motion` | `(-0.753387451171875,0.657485961914062,-0.657485961914062,-0.753387451171875,793.4,413.8)` |
| 9 | `肌肉男-cilisucai.com11 11` | `[20,22)` / `motion` | `(0.422882080078125,0.906173706054688,-0.906173706054688,0.422882080078125,627,558.4)` | `[22,25)` / `motion` | `(0.1009521484375,0.994873046875,-0.994873046875,0.1009521484375,1012.05,607.65)` |
| 10 | `肌肉男-cilisucai.com11 16` | `[20,22)` / `motion` | `(-0.818695068359375,0.574142456054688,-0.574142456054688,-0.818695068359375,631.9,398.6)` | `[22,25)` / `motion` | `(-0.962066650390625,0.2725830078125,-0.2725830078125,-0.962066650390625,1069.3,458.35)` |
| 11 | `肌肉男-cilisucai.com11 14` | `[20,22)` / `motion` | `(-0.765823364257812,0.642990112304688,-0.642990112304688,-0.765823364257812,613.75,447.65)` | `[22,25)` / `motion` | `(-0.934814453125,0.354995727539062,-0.354995727539062,-0.934814453125,1036,498.7)` |

Every motion span at its start has `duration="2"`, `tweenType="motion"`, `motionTweenSnap="true"`, and `keyMode="22017"`. The next authored frame at 22 starts a new `duration="3"` motion span for the same target. The 11 shortest signed endpoint-angle changes are all approximately `+19.222°`; XFL fixed-point rounding accounts for the small per-layer differences. Translation deltas are source-specific and recorded by the endpoint matrices above.

Nested timing at root frame 21:

- Layer 0's Play Once target selects child frame 1 of 11. Child Graphic frame 1 is an authored `none` span `[1,2)` containing one `DOMShape`.
- The 11 root motion targets are Graphic instances. Ten have one-frame Loop children; one has a two-frame Single Frame child fixed to frame 0. Their selected child frames remain source-derived and constant for this interval.
- `肌肉男-cilisucai.com11 16` has two nested one-frame Loop symbols; both remain at child frame 0.

## Gate A — prototype results

The production timeline resolver remains fail-closed for tween interiors. The research prototype created frame 21 from the source-authored frame 20 and frame 22 contexts, applied one generic transform-only interpolation helper to the 11 bounded matrices, and passed the concrete context through the same nested Graphic selector, display-list resolver, SVG builder, and hidden rasterizer used by #708.

No FLA-specific condition will be added to the production resolver. No color/effect, shape, vector morph, custom path, easing, or MovieClip semantics will be inferred.

Two independent Electron runs produced identical SVG and PNG hashes for frames 20, 21, and 22. Repeated PNG renders within each run were also identical. Frame 20 and frame 22 PNGs match the accepted #708 controls; the accepted #707 coherent-character control also reproduced.

| Output | PNG SHA-256 | SVG SHA-256 |
| --- | --- | --- |
| Frame 20 control | `61547c34bf3e5ccb234bf3b315a8c80bf7524f605ee60fb6e580699870b366d6` | `13ffe09c924fc67d654b06252067c10f2d8e3f6938cdefcc3fd6c2d0f4a0e524` |
| Frame 21 prototype | `fcbbf077a1097144a0a0f757c84f0a5ffcbc7664c4ed949b1c9ff8066605f827` | `394c157f6515850b5de2ccf2bae83d23f6b9671ca9e49401a20b8d7189dc0b08` |
| Frame 22 control | `95ef1f30a4ce5c2c545a9863449e5452b14203cf5469d78ec5d51054ea65afb2` | `1f706703499caaf7afd53984b5141c5c7d0510c891f1710f270d552dcf859c19` |

The #707 PNG control was `d754bd0046c2f19c05a4f9a826b4a1b374c5b727c2e70516ae98012070f20e1a`, matching its accepted receipt. Both runs kept the primary FLA SHA-256 unchanged at `bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d`.

External evidence is under `D:\PandaStage-Acceptance\issue709-tween-20261005\run-1` and `run-2`; the #707 control is under `D:\PandaStage-Acceptance\issue709-b5a-control-20261005\run-1`.

## Gate B — pending

No Adobe Animate command is available on `PATH` in this environment. The local `预览.png` is a 300×300 collage of unrelated face assets, not an approved reference for `人物倒地.fla`. Maintainer comparison against an Animate-visible or otherwise approved frame-21 reference is still required before the tween semantic can be called proven.

## Required completion receipt

```text
Issue: Stage B5-C Tween Interior Reconstruction
parents: #696 / #701
prerequisites: #707 / #708
mother PR: #677 (existing draft; no new PR)

primary fixture: 人物倒地.fla
source hash before/after: bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d / unchanged

target interval: 20 -> 21 -> 22
active layers:
bounded property semantics:
Gate 0: GO / BLOCKED / NO-GO

Gate A:
frame 20 control: PASS; `61547c34bf3e5ccb234bf3b315a8c80bf7524f605ee60fb6e580699870b366d6`
frame 21 output: prototype PNG `fcbbf077a1097144a0a0f757c84f0a5ffcbc7664c4ed949b1c9ff8066605f827`; Gate B pending
frame 22 control: PASS; `95ef1f30a4ce5c2c545a9863449e5452b14203cf5469d78ec5d51054ea65afb2`
interpolated properties: X/Y translation, 2D rotation, positive orthogonal X/Y scale
source derivation: endpoint `<Matrix>` values; progress `(21 - 20) / 2 = 0.5`
determinism: two independent runs and repeated renders match
#707 regression: PASS; `d754bd0046c2f19c05a4f9a826b4a1b374c5b727c2e70516ae98012070f20e1a`
#708 regression: PASS; frames 20 and 22 hashes match accepted results
CI: PASS on the existing mother PR; [GitHub Actions run 37286641748](https://github.com/Cognitive-Architect/panda-stage/actions/runs/37286641748) completed focused core quality and manifest-selected subsystem regression successfully

Gate B:
reference source: not available in this environment
maintainer visual result: PENDING

source mutation: NO
manual interpolation constants: NO
manual image/pose repair: NO
MovieClip runtime added: NO
script execution added: NO
playback UI added: NO

result: Gate A prototype ready; Gate B human visual acceptance remains pending
```
