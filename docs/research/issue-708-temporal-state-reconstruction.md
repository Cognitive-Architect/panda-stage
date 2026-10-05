# Issue #708 — Deterministic Temporal State Reconstruction

Date: 2026-10-05

Status: prototype ready for maintainer visual review; Issue #708 remains open

Mother PR: #677 (existing draft)

## Result

The shared source-display pipeline produced three complete source-derived character states from `人物倒地.fla` at root Graphic frames 20, 22, and 25. The selected outputs differ, each repeat-rendered byte-for-byte, and repeat identically in a second Electron process. The same build also reproduces the B5-A state and Black #703 controls.

The output reads as one falling character with source-authored smoke/effect shapes. Frame 22 and frame 25 have substantial smoke coverage. This is an agent inspection of Panda's output only; it does not prove Animate correspondence. Maintainer visual review against an approved Animate-visible state or independent reference is **PENDING**. The prototype is not marked GO and Issue #708 must remain open until that review is recorded.

## Source and hierarchy census

- Primary source: `D:\表情合集\人物倒地.fla` (210,955 bytes).
- Source SHA-256 before and after both runs: `bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d`.
- The existing recovery classifier identified a recovery candidate. The production helper adjusted only `EOCD.centralDirectorySize` by 54 bytes in memory; the normalized archive SHA-256 is `f2ac3306754037d2b8dd792064cff6dda16803890bf5bb60cbbbf16ca89e0a9e`. No bytes were written to the FLA.
- Stage: `1920 × 1080`; Scene `场景 1` has one authored frame and contains the Graphic instance `肌肉男-cilisucai.com11 3`.
- Scene instance address: `issue708-scene:场景 1@0/layer-0-frame-0/0`.
- Scene instance transform `(a,b,c,d,tx,ty)`: `(1.02131652832031,0,0,1.02131652832031,246.4,279.8)`.
- Root Graphic: 47 frames, 12 visible layers, 68 authored spans: 55 `motion`, 13 `none`, and 0 `shape` spans. Union of authored span starts: `0, 14, 20, 22, 25, 30`.
- The selected `motion` spans contain source matrices but no `MotionObject`, `MotionPath`, or `Ease` tags. Their interior states are not interpolated here.
- The source has 15 Graphic symbols and no MovieClip symbols. The document script container is empty; no script execution was added.

At each requested time, the runner resolves the root Graphic's authored frame context, applies the Scene's source transform through a generic group wrapper to each existing painter-ordered layer, then uses the same nested selector, display-list resolver, SVG builder, and sandboxed hidden rasterizer used by B5-A. The wrapper carries the Scene instance transform; it does not assemble fixture parts or choose their poses.

## Probes

The request coordinate is the root Graphic frame. These are authored span starts, so the prototype does not need an in-between state.

| Probe | Parent state | Nested state | Composition/output | Visual review |
| --- | --- | --- | --- | --- |
| A | Root `@20`: layer 0 keyframe span `[20,47)` (`none`); layers 1–11 keyframe spans `[20,22)` (`motion`). | Body instance `肌肉男-cilisucai.com11 1/肌肉男-cilisucai.com11 2`, address `issue708-root:肌肉男-cilisucai.com11 3@20/layer-0-frame-20/0`, Play Once candidate selects child `@0` of 11. Other 11 root instances select frame 0; `肌肉男-cilisucai.com11 9` is Single Frame with omitted `firstFrame`, tentatively selecting frame 0. | 25 shapes, 0 bitmaps, 14 expanded symbols, 71 nodes; `994 × 440`. SVG `16a869f1a2bac96ebf5c50e96e96071db7fe7013aefe44970513037253c93a4d`; PNG `61547c34bf3e5ccb234bf3b315a8c80bf7524f605ee60fb6e580699870b366d6`. | Agent sees a coherent falling character and smoke effect. Maintainer: **PENDING**. |
| B | Root `@22`: layer 0 is held from `[20,47)`; layers 1–11 keyframe spans `[22,25)` (`motion`). | Same body source address, child `@2` of 11. Other 11 root instances select frame 0; `肌肉男-cilisucai.com11 9` tentatively selects Single Frame `@0`. | 25 shapes, 0 bitmaps, 14 expanded symbols, 71 nodes; `649 × 391`. SVG `8e87f04ae85dd3de9d374ebcccac883aa725fff775dd07fb115cbaebebe0aa52`; PNG `95ef1f30a4ce5c2c545a9863449e5452b14203cf5469d78ec5d51054ea65afb2`. | Agent sees a changed falling pose under smoke. Maintainer: **PENDING**. |
| C | Root `@25`: layer 0 is held from `[20,47)`; layers 1–11 keyframe spans `[25,30)` (`motion`). | Same body source address, child `@5` of 11. Other 11 root instances select frame 0; `肌肉男-cilisucai.com11 9` tentatively selects Single Frame `@0`. | 25 shapes, 0 bitmaps, 14 expanded symbols, 71 nodes; `727 × 518`. SVG `01153b8cb1f649d71209e3aea7934cfcb5bb728c261505fa6937a013c1c0a8a9`; PNG `5bddf50266c5445c41d9937e8e62601057de1d230a9f85244d174cf60d1e22c7`. | Agent sees the character lying down with distributed smoke shapes. Maintainer: **PENDING**. |

The Scene root transform above applies to all three probes. The nested body instance has the same source transform at all three times: `(-4.44100952148438,-2.80485534667969,-3.9571533203125,6.2655029296875,1203.2,660.9)`. Its containing source span begins at frame 20; elapsed parent frames 0, 2, and 5 therefore yield candidate child frames 0, 2, and 5.

Each matrix below is the source-authored local matrix `(a,b,c,d,tx,ty)` read from the respective parent span. The source address for a row is `issue708-root:肌肉男-cilisucai.com11 3@<requested>/layer-<index>-frame-<span-start>/0`; for layer 0, `<span-start>` remains 20 at all three requested times.

| Layer | Source instance | Frame 20 matrix | Frame 22 matrix | Frame 25 matrix |
| ---: | --- | --- | --- | --- |
| 11 | `肌肉男-cilisucai.com11 14` | `(-0.765823364257812,0.642990112304688,-0.642990112304688,-0.765823364257812,613.75,447.65)` | `(-0.934814453125,0.354995727539062,-0.354995727539062,-0.934814453125,1036,498.7)` | `(0.134765625,0.990798950195312,-0.990798950195312,0.134765625,995.75,525.1)` |
| 10 | `肌肉男-cilisucai.com11 16` | `(-0.818695068359375,0.574142456054688,-0.574142456054688,-0.818695068359375,631.9,398.6)` | `(-0.962066650390625,0.2725830078125,-0.2725830078125,-0.962066650390625,1069.3,458.35)` | `(0.0483245849609375,0.998748779296875,-0.998748779296875,0.0483245849609375,964,483.55)` |
| 9 | `肌肉男-cilisucai.com11 11` | `(0.422882080078125,0.906173706054688,-0.906173706054688,0.422882080078125,627,558.4)` | `(0.1009521484375,0.994873046875,-0.994873046875,0.1009521484375,1012.05,607.65)` | `(0.1009521484375,0.994873046875,-0.994873046875,0.1009521484375,1012.05,587.25)` |
| 8 | `肌肉男-cilisucai.com11 4` | `(-0.494918823242188,0.868881225585938,-0.868881225585938,-0.494918823242188,356.7,447.35)` | `(-0.753387451171875,0.657485961914062,-0.657485961914062,-0.753387451171875,793.4,413.8)` | `(0.440078735351562,0.897872924804688,-0.897872924804688,0.440078735351562,670.45,579.6)` |
| 7 | `肌肉男-cilisucai.com11 5` | `(-0.78131103515625,0.624069213867188,-0.624069213867188,-0.78131103515625,450.1,555.85)` | `(-0.943206787109375,0.33203125,-0.33203125,-0.943206787109375,845.85,547)` | `(0.0765838623046875,0.996978759765625,-0.996978759765625,0.0765838623046875,812.7,563.45)` |
| 6 | `肌肉男-cilisucai.com11 6` | `(-0.3863525390625,0.92230224609375,-0.92230224609375,-0.3863525390625,324.5,556.05)` | `(-0.66845703125,0.743667602539062,-0.743667602539062,-0.66845703125,727.2,505.8)` | `(0.139083862304688,0.990203857421875,-0.990203857421875,0.139083862304688,663.75,631.3)` |
| 5 | `肌肉男-cilisucai.com11 7` | `(-0.611923217773438,0.790878295898438,-0.790878295898438,-0.611923217773438,442.1,619.95)` | `(-0.838180541992188,0.545303344726562,-0.545303344726562,-0.838180541992188,817.2,604.85)` | `(-0.121963500976562,0.992477416992188,-0.992477416992188,-0.121963500976562,797.5,626.15)` |
| 4 | `肌肉男-cilisucai.com11 8` | `(0.422882080078125,0.906173706054688,-0.906173706054688,0.422882080078125,503.2,609.05)` | `(0.1009521484375,0.994873046875,-0.994873046875,0.1009521484375,878.5,614.7)` | `(0.1009521484375,0.994873046875,-0.994873046875,0.1009521484375,878.5,594.3)` |
| 3 | `肌肉男-cilisucai.com11 10` | `(-0.906173706054688,0.422882080078125,-0.422882080078125,-0.906173706054688,643.5,562.7)` | `(-0.994873046875,0.1009521484375,-0.1009521484375,-0.994873046875,1026.2,617.1)` | `(0.144454956054688,0.989471435546875,-0.989471435546875,0.144454956054688,996.2,651.75)` |
| 2 | `肌肉男-cilisucai.com11 15` | `(-0.969955444335938,0.24322509765625,-0.24322509765625,-0.969955444335938,648.9,534.1)` | `(-0.995941162109375,-0.0896759033203125,0.0896759033203125,-0.995941162109375,1040.75,591.9)` | `(-0.0459136962890625,0.998886108398438,-0.998886108398438,-0.0459136962890625,970.4,638.3)` |
| 1 | `肌肉男-cilisucai.com11 9` (Single Frame, omitted firstFrame) | `(0.422882080078125,0.906173706054688,-0.906173706054688,0.422882080078125,817.35,349.05)` | `(0.1009521484375,0.994873046875,-0.994873046875,0.1009521484375,1260.7,472.6)` | `(0.1009521484375,0.994873046875,-0.994873046875,0.1009521484375,1260.7,452.2)` |
| 0 | `肌肉男-cilisucai.com11 1/肌肉男-cilisucai.com11 2` (Play Once) | `(-4.44100952148438,-2.80485534667969,-3.9571533203125,6.2655029296875,1203.2,660.9)` | same as frame 20 | same as frame 20 |

The nested children of `肌肉男-cilisucai.com11 16` also resolve at child frame 0 for every probe: layer-0 element 0 (`肌肉男-cilisucai.com11 13`) matrix `(1,0,0,1,30.8,47.2)` and element 1 (`肌肉男-cilisucai.com11 12`) matrix `(1,0,0,1,18.4,120.15)`. Their full nested source addresses are recorded in each external completion receipt.

## Timing classification

| Rule or feature | Classification for this evidence |
| --- | --- |
| Root parent frame selection at authored span starts 20, 22, and 25 | **PROVEN from source structure**. No frame lies inside an interpolated span for these requests. |
| Source matrices and layer order at those span starts | **PROVEN for the resolved source state**. Existing adapter and B5-A resolver are reused; all values are read from XFL. |
| Loop Graphic with a one-frame child | **PROVEN constant state for these instances**. Every phase selects the sole available frame 0. |
| Play Once with omitted `firstFrame`, relative to the containing span start | **UNKNOWN pending Animate/reference review**. The prototype uses candidate child frames 0, 2, 5 and fails closed if a request advances beyond the child frame count. It does not implement post-end clamping. |
| Single Frame with omitted `firstFrame` | **UNKNOWN pending Animate/reference review**. The prototype tentatively selects frame 0 for the two-frame `肌肉男-cilisucai.com11 9`. |
| Loop wrap, explicit Loop bounds, nonzero-origin Loop with a multi-frame child | **UNSUPPORTED; fail-closed**. |
| Tween-interior interpolation, shape tween, MovieClip timeline, ActionScript | **UNSUPPORTED; not implemented**. |

No hand-tuned intermediate pose, fixture-specific interpolation constant, or image repair was used. The only distinct state changes come from selecting source-authored root spans and nested source frames, then applying their source matrices.

## Determinism and controls

For each probe, two PNG rasterizations inside each process have identical hashes. Runs 1 and 2 were also byte-identical across separate Electron processes:

| Root frame | SVG SHA-256 (both runs) | PNG SHA-256 (both runs) | Repeat render |
| ---: | --- | --- | --- |
| 20 | `16a869f1a2bac96ebf5c50e96e96071db7fe7013aefe44970513037253c93a4d` | `61547c34bf3e5ccb234bf3b315a8c80bf7524f605ee60fb6e580699870b366d6` | identical |
| 22 | `8e87f04ae85dd3de9d374ebcccac883aa725fff775dd07fb115cbaebebe0aa52` | `95ef1f30a4ce5c2c545a9863449e5452b14203cf5469d78ec5d51054ea65afb2` | identical |
| 25 | `01153b8cb1f649d71209e3aea7934cfcb5bb728c261505fa6937a013c1c0a8a9` | `5bddf50266c5445c41d9937e8e62601057de1d230a9f85244d174cf60d1e22c7` | identical |

All three requested times have different SVG and PNG hashes, so the temporal request does not collapse to one static state. Source bytes match before/after both runs.

The accepted B5-A primary state was rebuilt on the same Main/renderer build at `性感修仙女-cilisucai.com/性感修仙女-cilisucai.com1@0`. It reproduced SVG `e10664bb1002b304f3ef0452ad58fa004a284c80fed555e2eff0e36ed327a817` and PNG `d754bd0046c2f19c05a4f9a826b4a1b374c5b727c2e70516ae98012070f20e1a`; the source remained unchanged.

Black #703 control was also rerun against the unchanged source, normalized archive, and reference image. H1 Graphic-loop outputs for parent frames 0/6/7 and H2 fixed-frame controls for 6/7 matched the recorded hashes; repeat SVG/PNG hashes matched for frames 0/6/7. Input hashes remained `a328a163dd212f0369e27b30e5078178fd42744954203fdad6a9cd06f3b171fa` (FLA), `681237abb7b32e79ce89ff8e283b0573b4bf170c6b85830828c7a10911bc7a33` (normalized archive), and `7c53292222edcd183bb0d40ee647435ef860f9894cd4203150317364ca679eac` (reference). Artifacts are under `D:\PandaStage-Acceptance\issue708-black-control-20261005\`.

## Scope and validation

- Source FLA mutation: **NO**. Project mutation: **NONE**.
- Manual intermediate repair: **NO**.
- MovieClip runtime, ActionScript execution, playback UI, ActionClip model, Character schema: **NONE added**.
- The selector remains an internal Main service with no production UI caller; this slice adds no renderer or persisted model changes.
- `pnpm exec vitest run tests/unit/fla-nested-graphic-frame-selector.test.ts`: **11 passed**.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build`: **passed**.
- `pnpm test:unit`: **341 files, 2,395 tests passed**.
- `pnpm test:integration`: **38 files, 189 tests passed**; its configured build also passed.

## Artifacts and reproduction

Run 1 outputs and receipt are under `D:\PandaStage-Acceptance\issue708-temporal-20261005\run-1\`; run 2 is under `...\run-2\`. Both completion receipt files have SHA-256 `e6bd56cdd13cb099020337b2ce2b4a31f9e62382b37926959029e4fd0ed23996`. The receipt records every active nested Graphic source address, child frame, selection rule, transform, and output dimension.

From the repository root, after `pnpm build`, use a fresh external output directory:

```powershell
pnpm exec electron scripts/research/issue708-temporal-state-reconstruction.cjs `
  --source 'D:\表情合集\人物倒地.fla' `
  --expected-sha256 bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d `
  --root-symbol-name '肌肉男-cilisucai.com11 3' `
  --out 'D:\PandaStage-Acceptance\issue708-temporal-20261005\run-3'
```

The runner refuses repository-local output, refuses to overwrite changed evidence files, checks source hash invariance, and uses the existing sandboxed hidden renderer (`sandbox=true`, `contextIsolation=true`, `nodeIntegration=false`).

## Required completion receipt

```text
Issue: #708 Stage B5-B Deterministic Temporal State Reconstruction
parents: #696 / #701
evidence: #694 / #706 / #707
mother PR: #677 (existing draft; no new PR)

primary fixture: D:\表情合集\人物倒地.fla
source hash before/after: bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d / unchanged

animation hierarchy: Scene 1@0 -> 肌肉男-cilisucai.com11 3 (47 frames, 12 visible layers) -> 11 per-layer Graphics + nested body Graphic; symbol 16 has 2 nested leaves
changing-property census: 55 motion spans / 13 none; 12 source matrices differ across selected parent span starts; 0 shape tween spans; no motion path/easing metadata

probe A: root Graphic@20; body child@0; 25 shapes / 14 expanded symbols; PNG 61547c34bf3e5ccb234bf3b315a8c80bf7524f605ee60fb6e580699870b366d6
probe B: root Graphic@22; body child@2; 25 shapes / 14 expanded symbols; PNG 95ef1f30a4ce5c2c545a9863449e5452b14203cf5469d78ec5d51054ea65afb2
probe C: root Graphic@25; body child@5; 25 shapes / 14 expanded symbols; PNG 5bddf50266c5445c41d9937e8e62601057de1d230a9f85244d174cf60d1e22c7
human visual: PENDING maintainer review against approved Animate/reference evidence

proven semantics: source-authored keyframe selection; source matrices/layer order; one-frame Loop constant state
unknown semantics: omitted firstFrame defaults for Play Once and Single Frame; Animate/reference correspondence
unsupported semantics: tween interiors, shape tween, Loop wrap/bounds, nonzero-origin multi-frame Loop, MovieClip runtime, ActionScript
determinism: PASS inside each process and across run-1/run-2; each requested time has distinct hashes
controls: B5-A #707 and Black #703 rerun hashes match; source/archive/reference inputs unchanged

source mutation: NO
manual in-between repair: NO
MovieClip runtime added: NO
script execution added: NO
product playback UI added: NO

result: PENDING MAINTAINER VISUAL REVIEW (GO not claimed; no unverified capability is called supported)
exact unmet gate: approved Animate-visible/independent reference comparison and maintainer PASS/FAIL
next single action: maintainer reviews the three run-1 PNGs against Animate/reference evidence and records PASS or FAIL
```
