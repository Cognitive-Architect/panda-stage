# Issue #650 — #611 pre-acceptance hardening receipt

Serial baseline: PR #628 branch `issue-627-s09-r01` at `3f394008d91d1e4b8d93dc9233d002f8d7a0d698`. #611 C04 Windows human acceptance remains pending.

## F01 — Camera hot path

The pure domain API now separates `prepareSpeakerFocusCamera(project, shot)` from `evaluateSpeakerFocusCamera(plan, shotLocalTimeMs)`. Preparation projects shared Dialogue cues, resolves the winner and unique visible speaker at all cue/visibility boundaries, and folds each transition's exact in-flight starting view once. Requested-time evaluation uses a binary search for the current transition, then evaluates only the current speaker's dynamic main Position. The Preview memoizes the plan for its current immutable Project/Shot while Speaker Focus is ON. No mutable playback history, new clock, Project write, or persisted Camera state was added.

`tests/unit/speaker-focus-camera.test.ts` retains the V0 behavior cases and adds an 80-Dialogue / many-boundary fixture. The test verifies prepared-plan parity at sampled times, repeated seek stability, more than 100 transitions, and zero further reads of the Shot's Dialogue/event schedule after preparation. Position and Shake remain covered separately by the existing focused tests.

## F02 — Preview contract tests

`tests/unit/speaker-focus-preview-contract.test.ts` now parses TSX structurally. It identifies the `speakerFocus` state binding and its `false` initializer specifically, and tests that a deliberate `true` mutation fails. The outer Konva Group is identified by `name="camera-world"`; the test requires the world layer map inside that group and Subtitle/diagnostic Text as direct siblings outside it. A synthetic nested-Character-Group mutation with Subtitle inside the Camera group is rejected. The existing read-only Project/History/dirty contract remains checked.

## Validation

- Focused Camera/Preview/Stage tests: 5 files, 36 tests passed.
- `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` (324 files / 2185 tests), and `pnpm build`: passed.
- `git diff --check`: passed.
- No manual Full CI or `pnpm verify:project` was run.

Human Camera visual acceptance belongs to #611 C04 and is still pending; this repair does not claim PASS or change V0 product semantics.
