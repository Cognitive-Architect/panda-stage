# Issue #714 — Dual-Fixture Full-Timeline Generalization

- Issue: [#714](https://github.com/Cognitive-Architect/panda-stage/issues/714)
- Parent roadmaps: [#696](https://github.com/Cognitive-Architect/panda-stage/issues/696) / [#701](https://github.com/Cognitive-Architect/panda-stage/issues/701)
- Prerequisite: #713 (ACCEPTED / CLOSED)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677)
- Baseline head: `a78fc87a5aeebd99c73a28d8e1bf0d83d65dc1b5`
- Result: Gate 0 / 0B / A complete. Gate B / C / D are **NOT_RUN** (no fixture resolved). Gate E = **NO GENERALIZATION CLAIM**.

## What was asked

Run the first dual-fixture full-timeline generalization pressure test after #713
against two additional real temporal FLAs, `向右走.fla` and `跑步.fla`, using
the **shared production reconstruction path** only — no fixture-name branches,
no pose/timing repair, no manual frame duplication. The question is whether the
#713 seam survives two more real FLAs, and if not, whether the exact first new
semantic boundary can be pinned without hiding it.

## Source and method

Both fixtures are read-only real-corpus inputs. They were hashed before and
after work and the hashes match. The production recovery classifier reported a
recovery candidate for both and normalized only `EOCD.centralDirectorySize`
(54 bytes) in memory; the source files were never rewritten, and the in-memory
normalized archives passed strict validation.

| | 向右走.fla | 跑步.fla |
| --- | --- | --- |
| SHA-256 | `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098` | `bbcbb4796c1a3704dff77ed9b387fe0414fa6849ddef5b2805f4ff05c455aa70` |
| Size | 638,607 B | 170,867 B |
| DOMDocument FPS / stage | 30 / 1280×720 | 30 / 1920×1080 |
| Scene timeline | 1 frame | 1 frame |
| Scene root Graphic | `图层转元件_278` (loop) | `便衣道士-cilisucai.com1/便衣道士-cilisucai.com22` (loop) |
| Root frames / visible layers | 30 / 1 | 16 / 7 |
| Root authored spans | 2 (1 motion + 1 none) | 53 (46 motion + 7 none) |
| Root motion durations | {29} | {1, 3, 4} |
| Library symbols (graphic / movieclip) | 28 / 0 | 31 / 0 |

Both archives contain a single empty `<scripts/>` container (no ActionScript),
no MovieClip, no shape tween, no mask layers, no bitmaps/text, no easing or
motion-path metadata, and no reverse playback. Both do contain real
`<filters>` (`BlurFilter blurX="6" blurY="6" quality="3"`) inside the
`便衣道士-cilisucai.com4/…6/…15` symbols — see the blocker catalog.

The reproducible census runner is
[`issue714-dual-fixture-generalization.cjs`](../../scripts/research/issue714-dual-fixture-generalization.cjs).
It reuses only `dist-electron` production modules, writes all evidence outside
the repository, and never widens a check.

## Gate 0 — per-fixture capability census

### 向右走.fla (walk-right)

The Scene holds a single root Graphic `图层转元件_278` with one 30-frame layer:
a transform-only motion span F0→F29 (`duration 29`) followed by one held `none`
span at F29. The root motion span fails the bounded motion family twice: the
authored duration `29` is outside the accepted set `{2, 3, 5, 6, 14}`, and its
terminal keyframe uses `keyMode="9728"` (outside the accepted terminal family
`{15872, motion-snap/22017}`).

Root interval capability: 1 `SUPPORTED` (the held `none` span), 1
`NEEDS_BOUNDED_EXTENSION` (the duration-29 / keyMode-9728 motion span), 0
`BLOCKED`, 0 `NO_GO`.

Nested census (15 instances). The next boundary is nested playback:

- `便衣道士…18` — a **407-frame** Graphic bound with `loop` **and an authored
  `firstFrame="206"`**, inside `…22`. The production selector only accepts
  `loop` with no authored `firstFrame`, origin span start 0, and no wrap; this
  is a generic Loop offset and fails `UNSUPPORTED_TIMING`.
- `便衣道士…2` and `…3` — 1-frame Graphics with **no `loop` attribute** (mode
  missing) and a `BlurFilter`.

### 跑步.fla (run)

The Scene root Graphic `便衣道士…22` has 7 visible layers and 53 spans: 46
motion spans and 7 `none` spans over 16 frames, with span starts at every frame
0–15. Root motion durations are {1, 3, 4}; `4` is outside the accepted set.
Three failure families appear across the root spans:

- **duration `4`** outside `{2, 3, 5, 6, 14}` — 9 spans;
- **terminal keyframe `keyMode="9728"`** — 3 spans;
- **animated nested `firstFrame`** — 8 spans. On these motion spans the nested
  Graphic instance's `firstFrame` differs between the start and end keyframes
  (`3 → 7 → 11 → 15`), i.e. the source animates which child frame the nested
  Graphic shows across the tween. The production adapter requires all
  non-authoring instance attributes to stay identical between endpoints, so
  these fail `ENDPOINT_INSTANCE_ATTRIBUTES_ANIMATED`.

Root interval capability: 36 `SUPPORTED`, 9 `NEEDS_BOUNDED_EXTENSION`, 8
`BLOCKED`, 0 `NO_GO`.

Nested census (31 instances): three 1-frame Graphics (`便衣道士…2`, `…3`) have
**no `loop` attribute** (mode missing) and carry a `BlurFilter`. All other
nested instances use `loop` with no `firstFrame` at origin and are accepted by
the bounded selector.

## Gate 0B — cross-fixture structural comparison

| | 向右走.fla | 跑步.fla | #713 人物倒地 (control) |
| --- | --- | --- | --- |
| root frame count | 30 | 16 | 47 |
| FPS | 30 | 30 | 30 |
| stage | 1280×720 | 1920×1080 | 1920×1080 |
| authored span starts | 0, 29 | 0…15 | 0, 14, 20, 22, 25, 30 |
| motion durations | {29} | {1, 3, 4} | {2, 3, 5, 6, 14} |
| tween families | motion, none | motion, none | motion, none |
| nested Graphic modes | loop, loop+firstFrame, (missing) | loop, (missing) | play once |
| Play Once | absent | absent | present (default-bound hold-last) |
| Loop | dominant (88 loop / 9 single frame) | dominant (81 loop) | absent |
| MovieClip | none | none | none |
| shape tween | none | none | none |
| easing / motion path | none | none | none |
| scripts (with payload) | none | none | none |
| effects | BlurFilter ×3 | BlurFilter ×3 | none |
| first unsupported semantic | nested Loop + `firstFrame=206` | nested playback mode missing | — |

**Classification: `PARTIALLY_DIFFERENT`.** Both new fixtures share the #713
construction family — a single-frame Scene whose root Graphic owns the
timeline, built from a nested Graphic cutout rig with no MovieClip, shape
tween, script, or easing/path metadata. But they differ from the accepted #713
boundary in material temporal semantics: nested playback is **Loop / absent**
instead of **Play Once**, root motion durations differ, terminal keyframes use
`keyMode 9728`, `跑步` **animates nested `firstFrame`**, and both carry a
`BlurFilter` effect that the accepted #713 fixture did not. This is a new
temporal boundary, not a near-identical semantic family.

## Gate A — requested root states

Every root frame of both fixtures was requested through the shared production
path (adapter → nested Graphic selector → display-list resolver), twice per
frame.

| Fixture | Requested | AUTHORED | TWEEN_RECONSTRUCTED | HELD | BLOCKED |
| --- | ---: | ---: | ---: | ---: | ---: |
| 向右走 | 30 | 0 | 0 | 0 | 30 |
| 跑步 | 16 | 0 | 0 | 0 | 16 |

- **向右走** — first blocker **F0**, stage `NESTED`, code `UNSUPPORTED_TIMING`:
  `Nested Graphic playback mode or bounds are outside the proven boundary
  (loop=loop, firstFrame=206)`.
- **跑步** — first blocker **F0**, stage `NESTED`, code `UNSUPPORTED_TIMING`:
  `Nested Graphic playback mode or bounds are outside the proven boundary
  (loop=(missing), firstFrame=(missing))`.

No neighboring-frame substitution, pose repair, hand-tuned transform, or
fixture-name branch was used; the fixtures simply fail the existing fail-closed
checks. The full per-frame status map with exact blocker messages is retained
in `gate-a-*.json`.

## Gate B / C / D — not run

No fixture resolved, so no source-derived raster state exists:

- **Gate B** — no per-frame SVG/PNG can be produced; the per-frame status/blocker
  map is retained instead (`gate-a-1-walk-right.json`, `gate-a-2-run.json`).
- **Gate C** — no source-timed clip is generated (required only for a fully
  resolved fixture).
- **Gate D** — maintainer full-motion review is not applicable without a clip.

## Gate E — generalization conclusion

**`NO GENERALIZATION CLAIM`.** Both fixtures block at Gate A on semantics that
are explicitly outside the accepted #713 boundary, and neither reaches a
trustworthy reconstruction result. This round adds no evidence that the
reconstruction path generalizes beyond one real fixture, and it must not be
reported as universal FLA compatibility.

## Blocker catalog (exact first semantics)

**Bounded-extension candidates** (same transform-only family, one authored
constant missing):

1. **Additional authored motion duration** — `29` (向右走), `4` (跑步).
2. **Additional terminal endpoint family** — `keyMode="9728"` at the end
   keyframe (both fixtures).

**Outside the bounded policy — requires a separate maintainer decision**:

3. **Generic nested Graphic Loop** — `loop` with an authored `firstFrame`
   (`向右走`, `…18` @ `firstFrame=206`, 407-frame child) and/or wrap/non-zero
   origin. The accepted boundary only supports origin-0, no-wrap Loop. The
   Issue lists "generic Loop wrap" as not graduated and "broad Loop/reverse
   runtime" as STOP.
4. **Missing nested playback mode** — `便衣道士…2` / `…3` carry no `loop`
   attribute; the source does not state the intended mode, so the semantics
   cannot be inferred without inventing intent.
5. **Animated nested `firstFrame`** — `跑步` motion spans keyframe the nested
   Graphic's `firstFrame` over time; this is a new temporal semantic outside the
   proven subset.
6. **BlurFilter effect** — both fixtures contain `BlurFilter` inside
   `便衣道士…4/…6/…15`. The production adapter does not validate filters on
   authored symbol frames, so this is a **latent silent-fidelity risk**: a frame
   could resolve while dropping the blur. It is recorded as an unsupported
   effect, not repaired.

Per the Issue's bounded-extension policy, none of 3–6 may be implemented inside
this Issue without a separate bounded decision; items 1–2 alone would not unblock
either fixture because the nested Loop / missing-mode blockers already stop
every frame.

## Regression controls

- #713 `人物倒地.fla` path: untouched (no production change was made).
- No source mutation; both fixtures hash-identical before/after.
- No fixture-specific branch; no manual pose/transform/timing repair.
- No MovieClip runtime, no ActionScript, no playback UI added.

## Validation

- `eslint` on the new research runner: passed.
- Runner executed end-to-end against both fixtures: passed; source hashes
  unchanged; receipts written to a fresh external directory.

No production source changed, so no build/typecheck/unit/integration gates were
affected. No Full CI or repository-wide verifier sweep was run.

## Evidence

External evidence directory (outside the repository):

`D:\PandaStage-Acceptance\issue714-dual-fixture-20261006\run-1\`

- `gate0-1-walk-right.json` — full Gate 0 census for `向右走.fla`.
- `gate0-2-run.json` — full Gate 0 census for `跑步.fla`.
- `gate-a-1-walk-right.json`, `gate-a-2-run.json` — per-frame Gate A status maps.
- `gate0b-comparison.json` — cross-fixture comparison table.
- `completion-receipt.json`, `completion-receipt.txt` — round receipt.

## Next single action

Report the exact first blocker per fixture to the maintainer. Do **not**
implement Loop / animated-`firstFrame` / `keyMode 9728` / BlurFilter support
inside this Issue without a separate bounded decision, and do not open a broad
follow-up automatically.
