# CA-01-FIX-03 F0 diagnosis and 21-frame result

This sanitized report records the bounded F0 diagnosis and the 21-frame check for Issue #922. It contains no source artwork, exported frame, video, or owner machine path.

## Baseline and D0

- Branch: `codex/issue-918-com8-proof`; baseline HEAD: `b9b99cf87c82522cca9b19162c8f56b08c7b96ce`; base `main`: `7bd6168d9774b9047d98a2e61fdad631bc8472b2`.
- Target: 21 frames at 25 FPS / 840 ms. The source SHA-256 before and after each real-file probe was `0D4AECBC159990CE54B9D0D8C31EA0F3354CD7ED86DF77BAC19A562DFC761FA2`.
- Fresh pre-fix D0 reproduced `PART_REASSEMBLY_PIXEL_MISMATCH` at F0: 6,606 differing pixels, maximum channel delta 112, mean absolute channel delta 0.7551, at 224×238 pixels. The difference bounds were x=4..219 and y=4..233 across 22 connected regions.

## D1: `ROOT_CAUSE_PROVEN`

- F0 has two visible source occurrences, one in each of two visible source layers. Both have identity scale/rotation, distinct authored translations, draw order 0 then 1, and no mask dependency.
- A vector composite rebuilt from only those two source occurrences resolved the same 10 display nodes and matched the native F0 PNG byte-for-byte. A direct source-over composite of their full-viewport PNGs also matched F0 byte-for-byte. This proves F0 source coverage and rules out a missing occurrence or a repeated part transform as its cause.
- The old reassembly SVG placed already-rasterized 224×238 full-viewport PNGs in the fractional source `viewBox`, then rasterized the SVG again. This second projection produced the F0 difference. Pixel-space stacking at the integer output grid removes that F0 difference without changing the strict comparison.
- Pre-fix F0 channel deltas: red 5,206 pixels / max 60; green 5,209 / max 61; blue 5,249 / max 64; alpha 4,630 / max 112. Of all changed pixels, 5,820 were at or within one pixel of a partial-alpha edge; 786 were outside that edge band; zero differed while fully transparent in both images. The private heatmap and exact region report are in the D1 owner-local evidence run.

## D2: bounded change

- Reassembly now stacks full-viewport PNGs in `viewBox="0 0 width height"` at integer x/y=0 and output-pixel width/height. The authored source draw order and existing SVG byte budget remain in force.
- Added a synthetic transparent-overlay fixture test that checks pixel-grid placement, draw order, and rejection of non-integer output dimensions. The original image comparison remains strict pixel equality.

## D3: 21-frame check

- The native full-frame render still matches the prior same-source reference on 21/21 frames. This is not an independent Adobe Animate 2023 comparison.
- After the bounded change, strict part-reassembly equality is 2/21: F0 and F20 match; F1–F19 differ. The first residual is F1 with 34 pixels and max channel delta 3. The largest per-frame difference count is F8 with 473 pixels (max channel delta 2); the largest channel delta is F5 at 15 across 94 pixels. Summed differing-pixel counts across frames are 2,997.
- Two source-address candidates retain 21 states each, with consistent normalized source-occurrence identities, authored layer order, frame visibility, and per-frame transforms. The ActionClipDraft and private 21-frame playback demo were generated for review; no formal character/action data was written.
- A same-rasterizer comparison found a second, bounded cause: the isolated-part path rounds the fractional SVG `viewBox` to six decimals in `replaceSvgViewport`, while the full source SVG keeps full precision. At F1 and F5 the vector inner drawing markup is byte-identical; only the outer `viewBox` differs. Full source SVG rendering matches native exactly, while the rounded isolated SVG differs by 34/3 and 46/15 respectively.
- This is a second precision issue outside the single-root-cause fix authorized by this ticket. No further repair was attempted. Strict 21-frame acceptance remains blocked pending owner direction.

## Validation and verdict

- Focused unit: 2 passed. `pnpm typecheck`: PASS. `pnpm lint`: PASS. `pnpm build`: PASS; Vite reported existing empty legacy CSS imports and large-chunk notices.
- Integration: NOT_RUN; the change is limited to a read-only research reassembly helper and its unit test. Full unit and historical broad verifiers: NOT_RUN.
- The two configured unit-test timeouts recorded on the prior #921 baseline were not rerun or reclassified here.
- Product verdict: `STILL_BLOCKED`; no `GO_PART_TRACK` or `GO_FRAME_PARTS_ONLY` claim. Next owner action: decide whether to authorize a separate fix for isolated-part `viewBox` precision or defer strict visual acceptance.
- Owner-local evidence labels: `run-20261102-922-d0-r1`, `run-20261102-922-d1-vectorthreeway`, `run-20261102-922-d3-r1`, and `run-20261102-922-d3-same-rasterizer`. Artwork and absolute paths remain local.
