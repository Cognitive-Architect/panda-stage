# Issue #856 O2 PNG worker comparison

Decision: **O2-F01_PASS**

- Base O1: `3a05e3efba6e08bc52dc45f732f242a0f116b794`
- Safe rollback baseline: `143d74c258764fede19cbd1ceb5435d6d6acaf90`
- Candidate: `47564eefd29696253c742af03ea9be2bfca8de48` on `issue-856-o5-30s-ab`
- Sample provenance: `GENERATED_30S_PROJECT` (source Issue #827, sample-1)
- Generated sample Project SHA-256: `1b77c9dee0a29881028523a1abfbc4bc19a08b954a7d49ec7a2ed8416b5ee59f`; generator receipt SHA-256: `ced00f036c87ac364567dfdbf18bab89b03ba2483be6ba33980817420ea0e85d`
- Modes: A `explicit-sync + legacy-blob`; B `explicit-sync + worker-png`
- Frozen Project SHA-256: `1b77c9dee0a29881028523a1abfbc4bc19a08b954a7d49ec7a2ed8416b5ee59f`
- Frozen candidate SHA-256: `1afa0fae5b7d24c9dfb270bc787a99791a7bc033114f1670ca95b8cba18ce8b5`
- Media/font/render inputs identical: true
- MP4 SHA-256: A `13ade8edb852595642cc89b7a7b8a60906c060df2b0722770564b07b4afccf4a`; B `13ade8edb852595642cc89b7a7b8a60906c060df2b0722770564b07b4afccf4a`
- Frames: 720/720; decoded RGBA hashes identical: true
- MP4: both H.264/yuv420p 1920 x 1080 @ 24 fps, 720 frames, AAC 48 kHz
- Decoded PCM identical: true (SHA-256 A `60f9dd834f731e0e2df3fd1e21504a62547de5cc7b141e3ec77b173b2cc4f181`, B `60f9dd834f731e0e2df3fd1e21504a62547de5cc7b141e3ec77b173b2cc4f181`)

## Performance

- Performance-only gate: PERFORMANCE_PASS. Job wall: A 147741 ms; B 32926 ms; net change 77.71% faster
- Request to PNG: A n=720, p50=16.90000009536743 ms, p95=999.7000000476837 ms, max=1995.7000000476837 ms; B n=720, p50=16.299999952316284 ms, p95=28.5 ms, max=40.40000009536743 ms
- PNG encode: A n=720, p50=16 ms, p95=998.7999999523163 ms, max=1994.2000000476837 ms; B n=720, p50=12.799999952316284 ms, p95=14.700000047683716 ms, max=28.100000143051147 ms
- Snapshot: B n=720, p50=2.5 ms, p95=12.200000047683716 ms, max=17.5 ms
- Transfer dispatch: B n=720, p50=0 ms, p95=0.10000014305114746 ms, max=0.3000001907348633 ms
- Worker return: B n=720, p50=0.20000004768371582 ms, p95=0.40000009536743164 ms, max=13.499999761581421 ms (round trip n=720, p50=13 ms, p95=15 ms, max=28.5 ms)
- First frame request to PNG: A 1018.2000000476837 ms; B 33.59999990463257 ms
- Shot transition request to PNG peak: A 17.09999990463257 ms; B 21.299999952316284 ms
- Main frame-ready: A n=720, p50=17.667799999995623 ms, p95=1000.4176999999981 ms, max=1996.5946000000113 ms; B n=720, p50=16.947699999998804 ms, p95=29.34310000000005 ms, max=52.42290000000003 ms
- Rendering phase: A 129115.7664 ms; B 14852.578800000001 ms
- Hidden renderer private memory A start/median/peak/end: 101076992/106987520/132825088/106987520 bytes; 291 samples.
- Hidden renderer private memory B start/median/peak/end: 100786176/152207360/182820864/120369152 bytes; peak/A-peak 1.38x; median/A-peak 1.15x; gate PASS.
- Private-memory trend: A NO_SUSTAINED_UPWARD_GROWTH (291 samples, 5910528 bytes endpoint change); B NO_SUSTAINED_UPWARD_GROWTH (62 samples, 19582976 bytes endpoint change, slope 637819.626746572 bytes/sec); B quarter medians 148049920, 150292480, 152207360, 152207360 bytes.
- Trend rule: 500 ms process samples are split into four time buckets; B is flagged for sustained growth when all bucket medians are nondecreasing and first-to-last growth reaches max(64 MiB, 25% of the first bucket).
- Hidden renderer working set A start/median/peak/end: 160161792/200704000/222617600/200712192 bytes; B 159981568/242823168/271323136/214155264 bytes.
- Working-set trend: A NO_SUSTAINED_UPWARD_GROWTH (291 samples, 40550400 bytes endpoint change); B NO_SUSTAINED_UPWARD_GROWTH (62 samples, 54173696 bytes endpoint change, slope 1764443.0837377454 bytes/sec); B quarter medians 230588416, 240891904, 242823168, 242823168 bytes.

## Safety and limits

- No-clobber, cancellation, source immutability, staging cleanup, and hidden window cleanup: pass for both runs.
- Worker: one per formal Job, one frame in flight; cancellation Worker stopped via hidden-renderer-destroyed.
- Decision: O2-F01_PASS; retain the reused Worker path.
- Human visual acceptance: NOT_RUN; editor UI click-to-complete: NOT_MEASURED; GitHub CI: CI_NOT_REPORTED.
- Raw MP4 and synthetic fixture assets remain under the external acceptance directory and are not committed.

## Measurement evidence

- Memory sampler preflight: PASS, 3 samples from hidden renderer PID 15060; receipt SHA-256 `3ea3ede0add1c136eeadd03e95b906b3dfa0410057a7e5b341d4e3b79015ece6`.

See the companion JSON for per-frame hashes, stage timing distributions, memory samples, and cleanup receipts.
