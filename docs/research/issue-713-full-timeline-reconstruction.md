# Issue #713 — Full Timeline Reconstruction

- Issue: [#713](https://github.com/Cognitive-Architect/panda-stage/issues/713)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677)
- Prerequisite: #712 is CLOSED.
- Result: Gates 0–C are complete; Gate D is **PENDING_MAINTAINER**.

## Source and method

The locked source is `D:\表情合集\人物倒地.fla`, SHA-256
`bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d`.
The before/after hashes match. The production recovery classifier identified a
recovery candidate and normalized only `EOCD.centralDirectorySize` by 54 bytes
in memory. The source file was not rewritten; the normalized archive passed
strict validation.

The root Graphic is `肌肉男-cilisucai.com11 3`: frames F0–F46, 47 frames at
30 FPS, stage 1920×1080, exact duration 47/30 seconds. The root has 12 visible
layers and 68 authored spans: 55 motion spans and 13 `none` spans. Span starts
are 0, 14, 20, 22, 25, and 30.

Gate 0 inspected the source archive and every root span. Its scan found 15
Graphic symbols, no MovieClip symbols, an empty `<scripts/>` container, no
MotionObject/MotionPath/Ease/DOMTween-family metadata, and no disallowed motion
attributes. Every motion endpoint retains one visible Graphic target with a
stable library identity and finite affine matrices. Sparse matrix fields use
the production reader’s XFL defaults (`a`/`d` = 1; other fields = 0).

## Gate 0 — interval capability map

| Root interval | Per-layer source semantics | Nested body Graphic | Gate 0 result |
| --- | --- | --- | --- |
| F0–F13 | Layer 0 is empty and held; layers 1–11 each have a duration-14 transform-only motion span. | Not present yet. | 11 `NEEDS_BOUNDED_EXTENSION` (duration 14), 1 `SUPPORTED` held empty layer. |
| F14–F19 | Layer 0 remains empty and held; layers 1–11 each have a duration-6 transform-only motion span. | Not present yet. | 11 `NEEDS_BOUNDED_EXTENSION` (duration 6), 1 `SUPPORTED` held empty layer. |
| F20–F21 | Layer 0 holds the body instance transform; layers 1–11 have duration-2 motion spans. | Play Once selects child frames 0–1. | 11 `SUPPORTED`, 1 `SUPPORTED` held parent transform. |
| F22–F24 | Layer 0 holds the body instance transform; layers 1–11 have duration-3 motion spans. | Play Once selects child frames 2–4. | 11 `SUPPORTED`, 1 `SUPPORTED` held parent transform. |
| F25–F29 | Layer 0 holds the body instance transform; layers 1–11 have duration-5 motion spans ending at the F30 held key. | Play Once selects child frames 5–9. | 11 `NEEDS_BOUNDED_EXTENSION` (duration 5), 1 `SUPPORTED` held parent transform. |
| F30–F46 | All 12 root layers are held `none` spans. | F30 selects child frame 10; F31–F46 continue holding child frame 10. | 12 `SUPPORTED` held states. |

Across all 55 motion spans, the authored starts use the same bounded metadata:
`tweenType="motion"`, `motionTweenSnap="true"`, and `keyMode="22017"`.
Transforms contain only affine matrices and optional finite transformation
points; no easing or motion-path metadata appears. The endpoint at F30 starts
the next held span (`keyMode="15872"`), which describes F30’s outgoing state.
The incoming F25–F30 motion is defined by F25 and its authored endpoint matrix.
Animate’s `selected` and `centerPoint3D*` attributes are authoring metadata; the
renderer consumes the matrices and does not serialize those attributes.

The final Gate 0 counts are 35 `SUPPORTED`, 33 `NEEDS_BOUNDED_EXTENSION`, 0
`BLOCKED`, and 0 `NO_GO`. The smallest production extension is limited to the
source’s additional authored durations 5, 6, and 14; the accepted duration set
is explicit (`2`, `3`, `5`, `6`, `14`). Source attributes, transforms, easing,
and target identity remain fail-closed outside that subset.

### Play Once after the child timeline ends

The body instance is a Graphic with `loop="play once"`, default first frame 0,
no authored `lastFrame`, and 11 child frames. It advances F20→child 0 through
F30→child 10, then holds child 10 for F31–F46. This matches Adobe’s documented
Play Once behavior: after one pass, a Graphic instance stays at its last frame
for the rest of its parent span ([Adobe Animate: Graphic Looping](https://helpx.adobe.com/animate/desktop/using/elements.html)).
The selector now clamps only the default-bound Play Once selection to the last
child frame and labels post-end selections `play-once-hold-last-frame`.

## Gate A — all 47 requested states

The shared production adapter, nested Graphic selector, and display-list
resolver resolved every root frame. Repeated same-address resolution produced
identical frame-context, nested-selection, and display-list hashes.

| State | Frames | Count |
| --- | --- | ---: |
| `AUTHORED` | F0, F14, F20, F22, F25, F30 | 6 |
| `TWEEN_RECONSTRUCTED` | F1–F13, F15–F19, F21, F23–F24, F26–F29 | 25 |
| `HELD` | F31–F46 | 16 |
| `BLOCKED` | none | 0 |

All 47 production PNGs were rendered twice; every repeated PNG was byte-
identical. The six F20–F25 stage PNGs also match the accepted #712 artifact
hashes exactly.

## Gate B — review artifacts

The full evidence map records the status, source time, nested selections,
composition, hashes, and individual artifact paths for every frame. Six
chronological contact sheets cover the required intervals. All individual SVG
and PNG frames are retained outside the repository; recommended checkpoints
F0, F5, F10, F14, F19, F20, F25, F30, F35, F40, and F46 are linked in the map.

Final artifacts are in:

`D:\PandaStage-Acceptance\issue713-full-timeline-20261006\reconstruction-run-1\`

- `completion-receipt.json` — full Gate 0–D receipt and clip probe.
- `evidence-map.json` — all 47 states and checkpoint previews.
- `interval-00-13.png`, `interval-14-19.png`, `interval-20-21.png`, `interval-22-24.png`, `interval-25-29.png`, `interval-30-46.png` — interval contact sheets.
- `full-frame-00.svg`/`.png` through `full-frame-46.svg`/`.png` — per-frame source-derived evidence.
- `issue713-full-timeline-f0-f46-30fps.mp4` — complete review clip.
- `repeat-check.mp4` — byte-identical second encode.

The final Gate 0 receipt is at
`D:\PandaStage-Acceptance\issue713-full-timeline-20261006\gate0-run-5\gate0-receipt.json`.
The reproducible source census and full reconstruction runners are
[`issue713-full-timeline-gate0.cjs`](../../scripts/research/issue713-full-timeline-gate0.cjs)
and [`issue713-full-timeline-reconstruction.cjs`](../../scripts/research/issue713-full-timeline-reconstruction.cjs).

## Gate C — full source-timed clip

The clip contains exactly 47 source-derived PNG states in F0→F46 order at
30/1 FPS. `ffprobe` independently reports H.264/yuv420p, 1920×1080, 47 frames,
time base 1/30000, 1000 time-base ticks between presentation timestamps, and
duration 1.566667 seconds (47/30 seconds). It has no audio. The second encode
has the same probe metadata and SHA-256 as the first. Encoding used one PNG per
source frame, `-vsync 0`, no filters, no output `-r`, and no manual frame
duplication.

Clip SHA-256:
`91313c3896c9a743bb0cde46c17ec1b42b4837e572991365b9d905ed7ad8d62e`.

## Gate D — maintainer full-motion review

**PENDING_MAINTAINER.** The clip and contact sheets are ready for review. The
approved source/material-site animation reference has not been recorded in the
receipt, so no human PASS, PARTIAL, or FAIL is claimed. Do not close Issue #713
or mark mother PR #677 Ready based on the automated reconstruction alone.

## Validation

- Focused unit tests: 16 passed across the adapter and nested selector suites.
- Integration tests: 189 passed across 38 files.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed. Vite reported existing empty legacy CSS imports and a
  large-chunk advisory; neither affected the build result.
- `git diff --check`: passed.
- Full source-specific Electron reconstruction, repeated raster check,
  #712 control comparison, FFmpeg encode, and ffprobe checks: passed.
- Mother PR #677 CI on commit `ab29094`: passed, including typecheck, lint,
  unit tests, integration tests, build, manifest-selected subsystem regression,
  and the final CI result ([run #37417928248](https://github.com/Cognitive-Architect/panda-stage/actions/runs/37417928248)).

No Full CI or repository-wide verifier sweep was run manually. The mother PR’s
automated risk-based route completed successfully. Gate D remains pending
maintainer review against the approved source/material-site animation.
