# Issue #851 O2-F01 PNG worker comparison

Decision: **O2-F01_PASS**

- Base O1: `3a05e3efba6e08bc52dc45f732f242a0f116b794`
- Safe rollback baseline: `143d74c258764fede19cbd1ceb5435d6d6acaf90`
- Candidate: `114e9050b2a2329017e74d0c4b161cccf4b22c15` on `issue-851-o2-f01`
- Modes: A `explicit-sync + legacy-blob`; B `explicit-sync + worker-png`
- Frozen Project SHA-256: `b91af6cb4ca25669df809e7b67e5425f6d5899f25323e3d653de8c16fd156b2e`
- Frozen candidate SHA-256: `a1316f0ececc859e4aeeb475da76e4c444ea756b659d285a5250cebccda403eb`
- Media/font/render inputs identical: true
- MP4 SHA-256: A `dc0fdac992c4e1b4f32026f5b6a7fbc1fdbe054e9dd1e816cc3166131d60d36a`; B `dc0fdac992c4e1b4f32026f5b6a7fbc1fdbe054e9dd1e816cc3166131d60d36a`
- Frames: 108/108; decoded RGBA hashes identical: true
- MP4: both H.264/yuv420p 1920 x 1080 @ 24 fps, 108 frames, AAC 48 kHz
- Decoded PCM identical: true (SHA-256 A `9be431fdb45541345f8f772664c2ba4d283fe7033126943dd25566ef9ba820a7`, B `9be431fdb45541345f8f772664c2ba4d283fe7033126943dd25566ef9ba820a7`)

## Performance

- Performance-only gate: PERFORMANCE_PASS. Job wall: A 64891 ms; B 13027 ms; net change 79.92% faster
- Request to PNG: A n=108, p50=67.70000004768372 ms, p95=1065.5999999046326 ms, max=1736.1000001430511 ms; B n=108, p50=48.40000009536743 ms, p95=67.60000014305115 ms, max=108.79999995231628 ms
- PNG encode: A n=108, p50=29 ms, p95=1028.7999999523163 ms, max=1717 ms; B n=108, p50=14.399999856948853 ms, p95=15.600000143051147 ms, max=22 ms
- Snapshot: B n=108, p50=13.900000095367432 ms, p95=14.700000047683716 ms, max=21 ms
- Transfer dispatch: B n=108, p50=0 ms, p95=0.10000014305114746 ms, max=0.20000004768371582 ms
- Worker return: B n=108, p50=0.2999999523162842 ms, p95=0.40000009536743164 ms, max=14.200000047683716 ms (round trip n=108, p50=14.600000143051147 ms, p95=16 ms, max=28.200000047683716 ms)
- First frame request to PNG: A 1038.1000001430511 ms; B 51.80000019073486 ms
- Shot transition request to PNG peak: A 1316.2999999523163 ms; B 56.09999990463257 ms
- Main frame-ready: A n=108, p50=68.65130000000136 ms, p95=1066.5874000000003 ms, max=1736.9677999999994 ms; B n=108, p50=49.331099999999424 ms, p95=68.86869999999999 ms, max=109.72310000000016 ms
- Rendering phase: A 57592.1527 ms; B 5799.4853 ms
- Hidden renderer private memory A start/median/peak/end: 100823040/119332864/138260480/116264960 bytes; 126 samples.
- Hidden renderer private memory B start/median/peak/end: 96329728/160043008/167280640/160047104 bytes; peak/A-peak 1.21x; median/A-peak 1.16x; gate PASS.
- Private-memory trend: A NO_SUSTAINED_UPWARD_GROWTH (126 samples, 15441920 bytes endpoint change); B NO_SUSTAINED_UPWARD_GROWTH (23 samples, 63717376 bytes endpoint change, slope 5761064.737793852 bytes/sec); B quarter medians 131141632, 146014208, 160043008, 160045056 bytes.
- Trend rule: 500 ms process samples are split into four time buckets; B is flagged for sustained growth when all bucket medians are nondecreasing and first-to-last growth reaches max(64 MiB, 25% of the first bucket).
- Hidden renderer working set A start/median/peak/end: 159989760/212434944/230207488/210108416 bytes; B 168435712/253743104/259600384/253751296 bytes.
- Working-set trend: A NO_SUSTAINED_UPWARD_GROWTH (126 samples, 50118656 bytes endpoint change); B NO_SUSTAINED_UPWARD_GROWTH (23 samples, 85315584 bytes endpoint change, slope 7713886.43761302 bytes/sec); B quarter medians 202862592, 239550464, 253743104, 253749248 bytes.

## Safety and limits

- No-clobber, cancellation, source immutability, staging cleanup, and hidden window cleanup: pass for both runs.
- Worker: one per formal Job, one frame in flight; cancellation Worker stopped via hidden-renderer-destroyed.
- Decision: O2-F01_PASS; retain the reused Worker path.
- Human visual acceptance: NOT_RUN; editor UI click-to-complete: NOT_MEASURED; GitHub CI: CI_NOT_REPORTED.
- Raw MP4 and synthetic fixture assets remain under the external acceptance directory and are not committed.

## Measurement evidence

- Memory sampler preflight: PASS, 3 samples from hidden renderer PID 8044; receipt SHA-256 `a0f1c1b1190df097a0ae06b5b5ddab0f2db422cdf45fd1cb6d44f64c40c76bd7`.

See the companion JSON for per-frame hashes, stage timing distributions, memory samples, and cleanup receipts.
