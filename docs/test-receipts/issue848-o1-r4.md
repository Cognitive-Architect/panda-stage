# Issue #848 O1 controlled acceptance receipt (R4)

**Result: `O1_PASS` for the scoped explicit-draw change and the >=50% same-input target.** The 30-second Job aspiration was not reached. This was an automated Windows Electron run through the official Preload API and real formal Export Job; editor UI click-to-completion time was not measured.

- Implementation commit: `f21ef98` (`feat(export): add synchronous O1 formal frame capture`)
- Isolated branch: `issue-848-exp-opt-o1`
- Base: `c6c356f660001af694bb706cc7553974ff8d1cfc` (reviewed PR #817 formal-export baseline)
- Full frame-by-frame comparison: [issue848-o1-r4-comparison.json](issue848-o1-r4-comparison.json)
- Comparison JSON SHA-256: `713f562ab28f7a2c7ae5fdde5f65c8bb44ec52ba7a4c3e026c869868a7ea7146`
- Local acceptance root: `D:\PandaStage-Acceptance\issue848-o1` (MP4s and raw receipts remain outside Git)

## Implementation boundary

Formal export now defaults to a hidden-renderer-only explicit draw mode. After React/Konva commits the exact requested frame and required images/fonts are ready, each output scene layer is synchronously drawn and checked against that frame's render token before PNG capture. A single-layer Stage captures its already drawn native output canvas; a multi-layer Stage composites all layers. Preview keeps the legacy scheduled-draw behavior. `PANDA_STAGE_EXPORT_DRAW_MODE=legacy-raf` selects the rollback path for formal Jobs. An explicit-draw frame failure fails and cleans up that Job; the next Job can use the legacy path.

No public IPC or Preload contract changed. PR #817 was not modified, rebased, merged, or marked Ready. No #844/#845 measurement-tool repair, Full CI, `pnpm verify:project`, or repository-wide verifier sweep was run.

## Frozen input

Both Jobs exported the same formal snapshot and source assets. The verifier checked input fingerprints before and after each Job and compared the frozen-candidate fingerprints across A/B.

- Fixture: 3 shots, 4.5 seconds, 108 frames, 1920x1080 at 24 fps; composite character, movement, opacity, face/mouth changes, subtitles, speaker-focus camera, and dialogue audio.
- Project revision 7, `dirtyAtCapture=false`; project file SHA-256: `7e0ced05eaf533545b68abefad428b81cbb54140d23ba795663bed7e506f26da`.
- Formal Project snapshot SHA-256: `aa1d1406a398f454c0e314fe14c60cc5fcbdf87d1bb1eba6893adcb3f7f52ed8`.
- Formal frozen-candidate SHA-256 (Project, media manifest, camera and render settings): `eb65c78680093e033a5d091826063c6a82bca5a7976fff0de2ac81010cb63f89`.
- Render settings: 1920x1080, 24 fps; camera: `speaker-focus`.
- Six source files, identical in both frozen manifests:
  - Background PNG: `36a4e881d8a3adc7248c59040d10d729a793b580172a306d8ad2a419a1ed1a69`
  - Character body PNG: `21e3342c4fcf8846c3a737def589f82c8261ba1830b65686de3e40364e25bf2e`
  - Normal face PNG: `26d5986563ec84424d0fee6c03b04ac3c5338317cf593288e9ebae22564bf9d7`
  - Open-mouth PNG: `38aa72f22b0d498920e4903f81eee04edba89f65a67292994a1de31b36ac373a`
  - Dialogue WAV: `77e2f6cd51e20b607168d2cdd18756cc6c6f506f1d12ccd29259ce7fbe8064f6`
  - Angry face PNG: `488a916ce15eb89a7097a6097aacdbb884e1ac06dde13af6c9bb1894aea0585b`
- Windows Arial regular SHA-256: `c9b76220a5be42ead4733611e417cd65c5fd8aeaa33eb56576ac378a37d130a1`; Arial bold SHA-256: `766f06ac8761f82f25d032a220e89438f6064591af9915061f20b949efdedf69`.

The comparison JSON records both run IDs and Job IDs, the complete media manifest and font fingerprints, project and candidate hashes, both 108-frame hash arrays, FFprobe values, PCM digest, per-Job safety results, and raw-receipt hashes.

## Controlled A/B results

| Measurement | Legacy rAF | Explicit sync |
| --- | ---: | ---: |
| Actual selected formal Job mode | `legacy-raf` | `explicit-sync` |
| ExportService Job elapsed | 210.080 s | 62.789 s |
| Rendering phase (recomputed from progress transitions) | 202.010 s | 55.604 s |
| Stage readiness gate, median / p95 | 966.9 / 969.2 ms | 0.3 / 0.5 ms |
| Main frame-ready, median / p95 | 1999.4 / 2001.7 ms | 66.0 / 1066.8 ms |
| PNG encoding, median / p95 | 1011.8 / 1013.5 ms | 28.2 / 1028.7 ms |

The explicit-sync Job saved 147.291 seconds (**70.11%**) and met the >=50% target. The readiness-gate median fell by 99.97%. The sync PNG-encoding p95 remains about 1.03 seconds, so there is a long-tail frame cost. The 30-second aspiration was not met.

## Output equivalence and safety

- Both MP4s probe as H.264/yuv420p, 1920x1080, 24 fps, 108 frames, 4.5 seconds, AAC mono 48 kHz.
- All 108 decoded RGBA frame hashes match across all three shots; mismatch count 0. Aggregate ordered-frame-hash SHA-256 for each mode: `72c52e7ac7ececaee8c3f3f17010ba75a1bf1cee461616718900a773980d0488`.
- Decoded audio matches byte-for-byte: 216,000 mono samples at 48 kHz; 864,000 bytes; SHA-256 `9be431fdb45541345f8f772664c2ba4d283fe7033126943dd25566ef9ba820a7`.
- Each Job accepted cancellation after one rendered frame, reached `cancelled`, created no final output for the cancelled Job, and completed cancellation cleanup in under 5 seconds.
- In each run, no-clobber rejected an existing output and preserved its hash. Frame Job directories, frozen media, staging files, and hidden render window were removed. Project and source-media fingerprints remained unchanged.

## Validation and limits

All listed commands exited 0: `pnpm install --frozen-lockfile`; `pnpm typecheck`; `pnpm lint`; `pnpm test:unit` (361 files, 2711 passed); `pnpm test:integration` (38 files, 189 passed); `pnpm build`; `pnpm issue848:o1-legacy`; `pnpm issue848:o1-sync`; the R4 `scripts/compare-issue848-o1.cjs` run; both CJS `node --check` commands; and `git diff --check`. The two focused Electron commands each produced 108/108 formal frames and passed cancellation, no-clobber, and cleanup checks.

Earlier attempts were preserved under the acceptance root: an initial verifier STOP exposed a mode-recording race; an R2 export used `Stage.toCanvas()` and was excluded as an invalid performance baseline; an R3 STOP caught an incorrect Konva canvas accessor before any frame was emitted. The final R4 harness uses Konva 10's `getNativeCanvasElement()` for single-layer drawn-output capture. The raw R4 receipts also contain an old phase-summary undercount; the committed comparison JSON recomputes durations from all progress-update timestamps. The verifier source now uses the corrected phase calculation and labels API timing accurately.

Editor UI click latency and owner visual review were not run. UI click timing is therefore `NOT_MEASURED`; `apiStartToCompleteMs` is reported separately in the JSON. This receipt does not claim PR #817 integration, merge readiness, or DL-07 Gate B acceptance. Merge authorization remains `NOT_GRANTED`.
