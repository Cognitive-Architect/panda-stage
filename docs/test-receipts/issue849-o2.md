# Issue #849 O2 PNG worker comparison

Decision: **ROLLBACK_NO_VALUE**

- Base O1: `3a05e3efba6e08bc52dc45f732f242a0f116b794`
- Candidate: `75b9a60f60b6db3b69ae8d15c4df40d3148a9cff` on `issue-849-exp-opt-o2`
- Modes: A `explicit-sync + legacy-blob`; B `explicit-sync + worker-png`
- Frozen Project SHA-256: `b91af6cb4ca25669df809e7b67e5425f6d5899f25323e3d653de8c16fd156b2e`
- Frozen candidate SHA-256: `a1316f0ececc859e4aeeb475da76e4c444ea756b659d285a5250cebccda403eb`
- Media/font/render inputs identical: true
- MP4 SHA-256: A `dc0fdac992c4e1b4f32026f5b6a7fbc1fdbe054e9dd1e816cc3166131d60d36a`; B `dc0fdac992c4e1b4f32026f5b6a7fbc1fdbe054e9dd1e816cc3166131d60d36a`
- Frames: 108/108; decoded RGBA hashes identical: true
- MP4: both H.264/yuv420p 1920 x 1080 @ 24 fps, 108 frames, AAC 48 kHz
- Decoded PCM identical: true (SHA-256 A `9be431fdb45541345f8f772664c2ba4d283fe7033126943dd25566ef9ba820a7`, B `9be431fdb45541345f8f772664c2ba4d283fe7033126943dd25566ef9ba820a7`)

## Performance

- Performance-only gate: O2_PASS. Job wall: A 64932 ms; B 14580 ms; net change 77.55% faster
- Request to PNG: A n=108, p50=72.29999995231628 ms, p95=1066.7000000476837 ms, max=1742.7000000476837 ms; B n=108, p50=55.299999952316284 ms, p95=82.29999995231628 ms, max=108.29999995231628 ms
- PNG encode: A n=108, p50=29.299999952316284 ms, p95=1029.5999999046326 ms, max=1723.5 ms; B n=108, p50=18.700000047683716 ms, p95=23.700000047683716 ms, max=25.200000047683716 ms
- Snapshot: B n=108, p50=14.399999856948853 ms, p95=17.5 ms, max=22.5 ms
- Transfer dispatch: B n=108, p50=0.09999990463256836 ms, p95=0.10000014305114746 ms, max=0.20000004768371582 ms
- Worker return: B n=108, p50=0.2999999523162842 ms, p95=0.40000009536743164 ms, max=9.400000095367432 ms (round trip n=108, p50=19 ms, p95=24.699999809265137 ms, max=29.90000009536743 ms)
- First frame request to PNG: A 1039.5999999046326 ms; B 51.69999980926514 ms
- Shot transition request to PNG peak: A 1302.2000000476837 ms; B 62.799999952316284 ms
- Main frame-ready: A n=108, p50=73.28709999999955 ms, p95=1067.6779000000006 ms, max=1743.5553 ms; B n=108, p50=56.22519999999986 ms, p95=83.34940000000006 ms, max=109.38250000000016 ms
- Rendering phase: A 57676.613399999995 ms; B 6635.585299999999 ms
- Hidden renderer private-memory peak: A 132575232 bytes; B 1039667200 bytes (delta 907091968 bytes)
- Worker hidden renderer private memory: start 101109760 bytes; median 946610176 bytes; end 1039667200 bytes; peak 1039667200 bytes (7.84x A peak). Review limit: peak and median at or below 2x A peak; status EXCEEDED.
- Hidden renderer working-set peak: A 226861056 bytes; B 1128521728 bytes

## Safety and limits

- No-clobber, cancellation, source immutability, staging cleanup, and hidden window cleanup: pass for both runs.
- Worker: one per formal Job, one frame in flight; cancellation Worker stopped via hidden-renderer-destroyed.
- Decision: retain R0 timeout fallback and O1; roll back R1 Worker PNG because hidden renderer memory exceeded the guardrail.
- Human visual acceptance: NOT_RUN; editor UI click-to-complete: NOT_MEASURED; GitHub CI: CI_NOT_REPORTED.
- Raw MP4 and synthetic fixture assets remain under the external acceptance directory and are not committed.

## Measurement history

- `legacy-blob`: STOP; the initial memory sampler recorded no hidden renderer samples.
- `legacy-blob-r2`: PASS on an earlier verifier commit; superseded by the final same-commit A/B pair.
- `worker-png`: STOP after the primary 108-frame export completed; the verifier missed the Worker termination console event during cancellation teardown. The corrected verifier accepted hidden renderer destruction as the stop evidence.

See the companion JSON for per-frame hashes, stage timing distributions, memory samples, and cleanup receipts.
