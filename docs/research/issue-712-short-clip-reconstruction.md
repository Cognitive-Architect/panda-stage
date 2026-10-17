# Issue #712 - B5-E Short Continuous Clip Reconstruction

Date: 2026-10-06

Status: Gate 0 **GO**; Gates A and B **PASS**; Gate C maintainer motion review **PENDING**.

Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (existing Draft; no new PR)

Prerequisite: [Issue #711](https://github.com/Cognitive-Architect/panda-stage/issues/711) is closed. Its current issue body records Gate C HUMAN CONTINUITY PASS, CI PASS, and Code review PASS. The accepted frame evidence is from `D:\PandaStage-Acceptance\issue711-continuous-20261006\run-3`.

## Gate 0 - source cadence

The primary fixture is `D:\表情合集\人物倒地.fla`. Its SHA-256 was `bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d` before and after the run. The source is classified as `RECOVERY_CANDIDATE`; the production recovery normalizer adjusted `EOCD.centralDirectorySize` by 54 bytes in memory only. The original FLA was not written. The normalized archive SHA-256 is `f2ac3306754037d2b8dd792064cff6dda16803890bf5bb60cbbbf16ca89e0a9e`.

The source document is 1920x1080 at 30 FPS. The accepted #711 root Graphic has 47 frames. The requested sequence is F20 through F25, so it starts at source time `20/30 = 2/3` second and contains six frames at `1/30` second each. The implied clip duration is exactly `6/30 = 1/5` second (0.2 seconds); no playback speed was guessed.

The accepted #711 receipt records the held child Graphic in Play Once mode with 11 child frames. Root F20-F25 select child frames 0-5, one per root frame, so this nested selection does not change the 30 FPS cadence. Other root nested selections do not change the selected root-frame order.

**Gate 0: GO.** The source timing gives a uniform, bounded six-frame segment.

## Gate A - accepted states and order

The runner consumes the accepted #711 SVG/PNG evidence and verifies its hashes, statuses, controls, and nested selections. It adds no in-between states. Each accepted SVG is reframed to the 1920x1080 source stage without scaling, then rasterized with a white review matte. The accepted #711 files remain unchanged.

| Source frame | Accepted status | Stage PNG SHA-256 |
| ---: | --- | --- |
| 20 | AUTHORED | `d0de5c8b439c20b4d0fae2df099314db2545f7ad4f56355040a3894b85865e83` |
| 21 | TWEEN_RECONSTRUCTED | `7584638022309ecad0062cfb6438fa1ef6036691469dd23d753942f75df6920e` |
| 22 | AUTHORED | `b36e3b70e5302a03263b5cce611af5e699ec11bd1744db3c90ba045343f4a1a1` |
| 23 | TWEEN_RECONSTRUCTED | `91258efa9b8c039ede120de30a09b4a0d4d3ba80dee8f2e2aaf0e8a0fbe8ac77` |
| 24 | TWEEN_RECONSTRUCTED | `1a41c3685dcacb9d51098d4333cf9897c3a169e88ae89afa8838fa39cc94d97e` |
| 25 | AUTHORED | `c9af84760c1e71cfac1794d3172149905523045dfaf68b11c5b416ac24d6651f` |

Order is F20 -> F21 -> F22 -> F23 -> F24 -> F25. All six stage PNG hashes are distinct, and a repeated raster of each accepted SVG was byte-identical.

## Gate B - clip integrity

The generated review clip and its completion receipt are retained outside the repository:

- Output directory: `D:\PandaStage-Acceptance\issue712-short-clip-20261006\run-2`
- Clip: `issue712-f20-f25-30fps.mp4`
- Clip SHA-256: `ba4d1aff612e83101fcbab141e56f41eb079370043d1a9c3c473a4359b0b3ebd`
- Completion receipt: `completion-receipt.json`
- Individual full-stage SVG and PNG evidence: `stage-frame-20.svg` through `stage-frame-25.svg`, and `clip-frame-20.png` through `clip-frame-25.png`

The MP4 uses H.264/libx264, `yuv420p`, 1920x1080, 30/1 FPS, six frames, and no audio. Its track time base is `1/30000`; frame presentation timestamps are `0, 1000, 2000, 3000, 4000, 5000`, corresponding to six evenly spaced frames and a 0.2-second stream/container duration. FFprobe independently confirmed the stream dimensions, codec, frame rate, frame count, and duration. No scaling, encoder-side interpolation, output frame-rate conversion, or manual frame duplication was used.

Repeated rasterization produced identical PNG bytes. Repeated encoding produced identical probe metadata and identical MP4 bytes (`ba4d1aff612e83101fcbab141e56f41eb079370043d1a9c3c473a4359b0b3ebd`). The script removes the duplicate MP4 after comparing its hash; the primary clip and receipt remain in the output directory.

## Gate C - maintainer motion review pending

The clip is ready for review against the maintainer-approved source or material-site animation. The approved review reference has not yet been selected or confirmed in the receipt, so cadence, continuity, and effect-timing judgments remain pending. No human motion PASS is claimed here. Issue #712 remains open until the maintainer records PASS, PARTIAL, or FAIL.

## Scope and validation

The implementation is a research-only Electron runner at [`scripts/research/issue712-short-clip-reconstruction.cjs`](../../scripts/research/issue712-short-clip-reconstruction.cjs). It uses the existing sandboxed production snapshot rasterizer and a direct FFmpeg invocation at the source-derived 30 FPS. It adds no playback UI, product clip persistence, MovieClip runtime, ActionScript execution, or generalized tween behavior.

- Runner assertions passed, including accepted-state/hash checks, nested child-frame timing, repeated raster/encode determinism, output PTS/frame-count/duration, and unchanged source SHA-256.
- Independent FFprobe inspection confirmed H.264, 1920x1080, 30/1 FPS, six frames, `1/30000` time base, and 0.2-second duration.
- `node --check scripts/research/issue712-short-clip-reconstruction.cjs` passed.
- `git diff --check` passed.

Result: **source-timed F20-F25 clip ready for human motion review; Gate C remains pending.**
