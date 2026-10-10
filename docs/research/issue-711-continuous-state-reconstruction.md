# Issue #711 — B5-D Continuous State Reconstruction

Date: 2026-10-06

Status: Gate 0 **GO-WITH-BOUNDED-EXTENSION**; Gate A resolved all six requested states; Gate B contact sheet generated; Gate C maintainer continuity review **PENDING**.

Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (existing Draft; no new PR)

Primary fixture: `D:\表情合集\人物倒地.fla`

## Source and Gate 0 census

The source SHA-256 was `bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d` before and after both runs. The production classifier identified a recovery candidate; its existing `EOCD.centralDirectorySize` correction was applied in memory only (`+54` bytes). The normalized archive SHA-256 was `f2ac3306754037d2b8dd792064cff6dda16803890bf5bb60cbbbf16ca89e0a9e`. The FLA was not written.

The root Graphic has 47 frames and 12 visible layers. Layer 0 is held over `[20,47)` with `tweenType="none"`; its body Graphic uses `Play Once`. It remains unchanged at F20–F25. The 11 remaining visible layers each contain one Graphic target. For each target the authored spans are:

| Layer | Graphic target | F20 span | F22 span | F25 span |
| ---: | --- | --- | --- | --- |
| 1 | `肌肉男-cilisucai.com11 9` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |
| 2 | `肌肉男-cilisucai.com11 15` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |
| 3 | `肌肉男-cilisucai.com11 10` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |
| 4 | `肌肉男-cilisucai.com11 8` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |
| 5 | `肌肉男-cilisucai.com11 7` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |
| 6 | `肌肉男-cilisucai.com11 6` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |
| 7 | `肌肉男-cilisucai.com11 5` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |
| 8 | `肌肉男-cilisucai.com11 4` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |
| 9 | `肌肉男-cilisucai.com11 11` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |
| 10 | `肌肉男-cilisucai.com11 16` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |
| 11 | `肌肉男-cilisucai.com11 14` | `[20,22)` motion, duration 2 | `[22,25)` motion, duration 3 | `[25,30)` motion, duration 5 |

All three keyframes use the same motion metadata keys (`index`, `duration`, `tweenType`, `motionTweenSnap`, `keyMode`); both tween intervals have `motionTweenSnap="true"` and `keyMode="22017"`. Each target identity stays the same across the boundaries. The full per-layer source matrices, center points, transformation points, and frame attributes are in the Gate 0 receipt at `D:\PandaStage-Acceptance\issue711-continuous-20261006\gate0-current-source-build\gate0-receipt.json` (SHA-256 `276f41c96c4bfb8037dfe97506202bea4f5e8e50d30ea28e2be6730f70e5737b`). The previous accepted matrix tables are also recorded in [#709 research](issue-709-tween-interior-reconstruction.md) and [#708 research](issue-708-temporal-state-reconstruction.md).

The held layer-0 body Graphic uses Play Once over an 11-frame child timeline. Production selection advances from child F0 at root F20 through child F5 at root F25; F23 and F24 select child F3 and F4. The other root motion targets use their source Loop/Single Frame modes, recorded per probe in the completion receipt.

The archive scan covered 15 library XML files and 94 `DOMFrame` elements. It found no `MotionObject`, `MotionPath`, `Ease`, `DOMTween`, `AnimationCore`, or `PropertyContainer` tags, and no disallowed easing/path/rotation attributes. Every active start/end matrix passed the existing positive, no-skew transform decomposition at F21 progress `1/2` and F23/F24 progress `1/3` and `2/3` (33 recorded interpolation proofs). Adobe documents that a motion-tween span has one target, supports position/rotation/scale, and that easing changes property rates; interpreting the absent ease/path records as the bounded linear property path remains an inference pending Gate C review. See [Adobe motion tween spans and properties](https://helpx.adobe.com/uk/animate/desktop/animation/creating_a_motion_tween_animation.html) and [Adobe Motion Editor easing](https://helpx.adobe.com/animate/desktop/animation/editing-motion-tween-using-motion.html).

### Gate 0 decision

**GO-WITH-BOUNDED-EXTENSION.** The 22→25 interval uses the same target identity, motion metadata, and bounded source matrices as the accepted 20→22 interval. The exact difference is its authored span duration: 3 frames instead of 2. The existing adapter already computes progress from the authored span duration but had a duration-2-only metadata gate. A small extension to duration 3 is sufficient: F23 uses progress `1/3`; F24 uses progress `2/3`. No easing, path, shape tween, or new runtime is needed.

Before the extension, a fresh Main/Preload build resolved F21 and rejected F23/F24 at active layer 1 because duration-3 metadata fell outside the bounded subset. After the extension, all three interiors resolve. The strict transformationPoint-equality rule from #710 was not added; #710 is closed as NOT_PLANNED and its maintainer decision says pivot differences alone do not disprove the accepted matrix-derived path.

## Gate A — F20–F25 results

| Frame | Status | PNG SHA-256 | Control |
| ---: | --- | --- | --- |
| 20 | AUTHORED | `61547c34bf3e5ccb234bf3b315a8c80bf7524f605ee60fb6e580699870b366d6` | Matches accepted #708 output |
| 21 | TWEEN_RECONSTRUCTED | `fcbbf077a1097144a0a0f757c84f0a5ffcbc7664c4ed949b1c9ff8066605f827` | Matches accepted #709 HUMAN VISUAL PASS output |
| 22 | AUTHORED | `95ef1f30a4ce5c2c545a9863449e5452b14203cf5469d78ec5d51054ea65afb2` | Matches accepted #708 output |
| 23 | TWEEN_RECONSTRUCTED | `918530785341522371459036743e58e47cde44c84cd5a052efff4daa28d0da92` | New, derived from F22/F25 source matrices at `1/3` |
| 24 | TWEEN_RECONSTRUCTED | `fc0d4bbf9d3ed41435a317acbf4ff94452369e128f9209fbaf805d6bfe4cf62d` | New, derived from F22/F25 source matrices at `2/3` |
| 25 | AUTHORED | `5bddf50266c5445c41d9937e8e62601057de1d230a9f85244d174cf60d1e22c7` | Matches accepted #708 output |

All six PNG hashes are distinct, and each repeated render matched byte-for-byte. The four accepted controls (F20/F21/F22/F25) match their prior output hashes. Each resolved frame has an individual SVG and PNG under `D:\PandaStage-Acceptance\issue711-continuous-20261006\run-3\`. The completion receipt includes nested Graphic selections for every requested frame and 33 source-matrix-to-derived-matrix records.

## Gate B — temporal contact sheet

The deterministic contact sheet is a 3×2 row-major sequence, F20→F21→F22 / F23→F24→F25. Every cell includes a frame number and status. No frame is blocked, so there are no blocker reasons to display.

- PNG: `D:\PandaStage-Acceptance\issue711-continuous-20261006\run-3\temporal-contact-sheet.png`
- PNG SHA-256: `308eb8fee04f1ad24421145834def2690215f8fb74ed16acb5a52d6266b668eb`
- SVG SHA-256: `6ce7956830b5bad4b244863710b06e8f1acecc064ebfc16a0b5b1c8e4f16002f`
- Completion receipt: `D:\PandaStage-Acceptance\issue711-continuous-20261006\run-3\completion-receipt.json` (SHA-256 `e3de09471969dd67c69421b0f1c5e2de1c63723f25d8fa4e7f713ad4a07eaaba`)

## Gate C — maintainer review pending

The Issue-specific evidence folders and primary fixture folder do not contain an approved F20–F25 source-video or Animate capture. The generated sheet proves that Panda produced six deterministic states through the shared production path; it does not prove source continuity. Maintainer review against the approved source animation is still required, including explicit F23 and F24 comparison. Record the outcome as PASS / PARTIAL / FAIL before closing #711 or treating this sequence as a prerequisite for a later slice.

## Validation and scope

- Focused adapter test: `pnpm exec vitest run tests/unit/fla-static-snapshot-display-list-adapter.test.ts` — **5 passed**; covers duration 2, duration 3 at `1/3` and `2/3`, and duration 4 fail-closed.
- `pnpm typecheck` — **passed**.
- `pnpm lint` — **passed**.
- `pnpm test:unit` — **342 files, 2,404 tests passed**.
- `pnpm test:integration` — **38 files, 189 tests passed**; its configured build ran typecheck, renderer build, and Electron build.
- Electron production-path runner — **passed**; source SHA unchanged; no project commit API called.

The production change only extends the existing transform-only metadata gate to source-authored spans of duration 3. The regression still fails closed at duration 4. There is no fixture-name branch, manual transform or image repair, transformation-point equality gate, MovieClip runtime, script execution, or product playback UI.

Reproduce from the repository root after `pnpm build` with a new external output directory:

```powershell
pnpm exec electron scripts/research/issue711-continuous-state-reconstruction.cjs `
  --source 'D:\表情合集\人物倒地.fla' `
  --expected-sha256 bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d `
  --root-symbol-name '肌肉男-cilisucai.com11 3' `
  --out 'D:\PandaStage-Acceptance\issue711-continuous-20261006\run-next'
```

Result: **F20–F25 reconstructed and evidence retained; HUMAN CONTINUITY PASS remains pending maintainer review.**
