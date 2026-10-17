# Issue #745 — coordinate-bearing slash decoder

## Result

**PASS — BOUNDED FIX**

- `DECODER_FIXED`: **PASS**. A verified `/ x y` now decodes to a straight line and consumes both coordinate operands. Bare or malformed slash commands fail closed.
- `OPEN_FILL_RECOVERED`: **PASS for the three selected full-FLA FillStyle 1 targets**. All three moved from `BLOCKED / TARGET_UNSUPPORTED` to deterministic `RENDERED` results with balanced endpoint graphs.
- `CHARACTER_VISUAL_PASS`: **NOT ESTABLISHED**. Panda contact sheets were produced and inspected. The available Adobe Animate oracle failed to capture the same three target Shapes because its exact library-item lookup did not find them, so this evidence does not claim Panda/Animate visual equivalence or human whole-character acceptance.

This verdict is limited to the slash-decoding fix and the three measured target fills. Other unsupported assets remain in the three FLAs; the 28-FLA run does not claim visual acceptance for every candidate.

## Real target Shapes

The production-backed Issue #739 differential was rerun before and after the change on the same full source FLAs. Each selected FillStyle 1 changed from an imbalanced, blocked boundary to a balanced, rendered boundary; repeated output hashes were stable.

| Full FLA | Source SHA-256 | Boundary before → after | Result |
| --- | --- | ---: | --- |
| 汉服修仙女.fla | `6AF14990029D4CED2C4E305721321835180C1BF041178A8799E1D14A1F62E535` | 84 → 87 | `BLOCKED` → `RENDERED` |
| 青绫修仙女（四视角）.fla | `D0958D4432DECBF6C54566BA15A2F5E97BD88C82D75DCB2F84603E9B2273F0E4` | 59 → 61 | `BLOCKED` → `RENDERED` |
| 修仙男.fla | `565C5609A7610EF64ED9F98B09D98DD82D5A45255ADB4D3D410A5A365E0EF4A5` | 23 → 24 | `BLOCKED` → `RENDERED` |

Panda generated contact sheets from the actual full FLAs. The source hashes remained unchanged; all three probes parsed successfully, produced no blank previews, and had zero render failures.

| Full FLA | Rendered candidates | Unsupported | Contact sheet |
| --- | ---: | ---: | --- |
| 汉服修仙女.fla | 23 | 12 | [Panda contact sheet](panda-hanfu-contact-sheet.png) |
| 青绫修仙女（四视角）.fla | 46 | 22 | [Panda contact sheet](panda-qingling-contact-sheet.png) |
| 修仙男.fla | 28 | 18 | [Panda contact sheet](panda-male-contact-sheet.png) |

The target-specific Animate oracle entries are `CAPTURE_FAILED`: Animate could not find the requested library items `修仙女-cilisucai.com2`, `元件 2`, and `白发修仙男-cilisucai.com4` by exact name. Existing Animate screenshots show the historical control, not these target Shapes. The currently open Animate document had unsaved state; it was left untouched.

## Frozen D-A / D-B fixtures and controls

- The D-A Edge 0 commands `!19217 12872/19207 12777` and `!18666 13131/18705 13183` are asserted as the two source-authored lines in the focused tests. Their expected endpoints are `(960.85,643.6) → (960.35,638.85)` and `(933.3,656.55) → (935.25,659.15)`; FillStyle0 direction is checked separately.
- D-A/M2 SHA-256: `5A501D1F787707A3965BECC31E2E5B8F5DDC519B25369E16EF68E72AF674EB5D`.
- D-B explicit-line twin SHA-256: `2ADC8598EE0B4747E95E48F83BA8FE57617E2B189F922B90943EB72C5BAC50A0`.
- Both archives remained external and unchanged. D-A's FillStyle 1 has a balanced 24-segment boundary after the change. Its whole shape remains blocked by a separate open FillStyle 2. D-B remains blocked at FillStyle 1. These minimized fixtures establish the local command correction; they do not establish a universal fill repair.
- The Issue #737 historical oracle and known-good closed-fill control remained `RENDERED`, balanced, deterministic, and byte-identical to their before-run SVG hashes.
- The 28-FLA run also rendered 30 candidates from the known-good character `黑袍大师兄（四视角）.fla` and both candidates from the known-good prop `石碑.fla`; neither had a render failure.

The full per-target, D-A/D-B, control, and Animate-capture ledger is in [target-renders.json](target-renders.json).

## 28-FLA regression corpus

The frozen 28-source manifest was rerun after the change. All 28 parser probes completed with unchanged source hashes. Rendered candidate count increased from 567 to 624; unsupported count decreased from 868 to 811. There were 57 `UNSUPPORTED` → `RENDERED` transitions, zero reverse transitions, zero added or removed candidates, and zero render failures. Improvements appeared in 汉服修仙女.fla, 魔修.fla, 青绫修仙女（四视角）.fla, and 修仙男.fla.

Three baseline probes initially reported a hidden-window cleanup exit error after producing complete receipts. Those three baseline cases were retried and their completed receipts were included in the comparison. All after-change probes exited successfully. Per-file transition details are in [28-fla-differential.json](28-fla-differential.json).

## Validation

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/unit/fla-static-snapshot-edge-command-semantics.test.ts tests/unit/fla-xfl-signed-fixed-point.test.ts` | 33 tests passed |
| `pnpm test:integration` | 38 files, 189 tests passed; the script also ran typecheck and renderer/Electron builds |
| `pnpm lint` | Passed |
| `pnpm build` | Passed; existing empty legacy CSS imports and large-chunk warnings remain |
| `pnpm test:unit` | 343 files and 2,462 tests passed |

Two existing render-session FLA fixtures used bare slash endings as close-path markers. They now encode the return-to-origin line explicitly, keeping those fixtures valid under the verified slash grammar.

The focused decoder suite was first run against the old implementation: 11 of 22 tests failed on slash semantics before the production change was applied. After the parser fix, the focused slash and signed-fixed-point tests passed 33/33; the render-session fixtures were then updated to valid explicit closures and the full 2,462-test unit suite passed.
