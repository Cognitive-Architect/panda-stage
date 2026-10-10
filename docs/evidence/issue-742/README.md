# Issue #742 — Minimal D/B/F experiment

Date: 2026-10-09<br>
Baseline: `0cdcf825571b415be03e49f3349499b6181a6b92`<br>
Verdict: **H — INSUFFICIENT / STOP**

## Findings

- **D — not established.** Raw XFL contrast survived: D-A has one `/` close marker and D-B has one explicit closing segment. Panda rendered both as deterministic three-segment closed boundaries. The post-save D-A fixture does not pass the Animate visual gate: its PNG is empty and its captured contour is `noFill`, while D-B shows the filled triangle. The pair is therefore not visually equivalent, so this run cannot support or reject a production close-path defect.
- **B — weakened for this minimal triangle.** B-A assigns its directed edge to `fillStyle0`; B-B assigns the reversed edge to `fillStyle1`. Both screenshots are pixel-identical, both Panda runs are deterministic and rendered, and both produce the same three-segment boundary. This does not classify the remaining real V0 character failures.
- **F — deferred.** The required valid D/B A/B families were not both established. No Animate-derived Region semantic is inferred from this run.

The next step is to redesign D-A so its Raw XFL close-marker contrast survives while Animate still produces the same filled image as D-B. Keep the experiment isolated from production. Revisit F only after a valid D comparison and the existing B result are reviewed.

## Evidence

The [sanitized receipt](receipt.json) records the fixture hashes, host provenance, repeatability, Panda results, and decisions without local user-document paths. The [source lock](source-lock.json) and [authoring manifest](authoring-manifest.json) accompany the isolated FLA fixtures.

Animate 2023 was `23.0.0.407`, SHA-256 `0F869BD383E679611C6F85D887F72FE636B16403A5B98F79DF87F6F563ED3838`, Authenticode `HashMismatch` (`UNTRUSTED / MODIFIED`). The executable hash, version, signature state, host process, and window state remained stable for the experiment. The degraded signature did not block the experiment because the required controls passed.

The patched D-A was first saved by Animate, then exactly one `Edge@edges` value in `DOMDocument.xml` changed from:

```text
!1900 1800|5300 1800!5300 1800|3600 4400!3600 4400|1900 1800
```

to:

```text
!1900 1800|5300 1800|3600 4400/
```

The original Animate-created FLA is retained as [D-A-authored-close-animate-created.fla](fixtures/D-A-authored-close-animate-created.fla). The patched FLA is [D-A-authored-close.fla](fixtures/D-A-authored-close.fla). The patch changed only `DOMDocument.xml`; the archive retained seven members. The patched D-A hash is `63A807AF95ABC2ADD2C1F6EAABBE61B8527C21C00B5C5A92824C9064ED1FAA1E`.

### Animate captures

Run02 and run03 were stable for all five fixture topologies and screenshot pixels. The user’s pre-existing Animate document was restored after every capture, the open-document count remained 9, and its file timestamp did not change.

| D close-path pair, run03 | Animate capture |
| --- | --- |
| D-A, patched close marker | ![D-A Animate output is empty](animate/run03/D-A-authored-close.png) |
| D-B, explicit closing segment | ![D-B filled triangle](animate/run03/D-B-explicit-close.png) |

| B fill-side pair, run03 | Animate capture |
| --- | --- |
| B-A, source `fillStyle0` | ![B-A filled triangle](animate/run03/B-A-clockwise-explicit.png) |
| B-B, source `fillStyle1` | ![B-B filled triangle](animate/run03/B-B-counterclockwise-explicit.png) |

Run02 screenshots are retained under [`animate/run02/`](animate/run02/); the full run receipts and host-provenance receipts remain in the external attempt folder `D:\PandaStage-Acceptance\issue742-repair-contract-20261009-attempt03`.

### Compensating controls

- The #737 historical Animate control was captured twice from a byte-identical external copy. Both topologies matched the accepted #739 baseline.
- The current Panda #737 control rendered deterministically: 160 raw edge records, 277 subsegments, and a balanced, closed FillStyle1 boundary of 98 segments.
- The trivial explicit-closed triangle control rendered in Panda and matched D-B’s Animate pixels.
- The combined control receipt reported `COMPENSATING_CONTROLS_PASS`.

## Validation

- `pnpm test:integration` — PASS, 38 files / 189 tests.
- Research CJS syntax checks and focused ESLint — PASS.
- Both JSFL syntax checks and the host PowerShell parse — PASS.
- `node scripts/research/issue742-xfl-panda-differential.cjs --preflight` — PASS at the recorded baseline.
- Fixture hash checks, Panda determinism, repeated Animate captures, and the #737 compensating controls — PASS.

The verification manifest registers only `docs/evidence/issue-742/**` to the existing Draft CI policy self-tests; a contract check keeps neighboring Issue evidence paths fail-closed. No production behavior files were changed. The research helpers are [here](../../../scripts/research/issue742-xfl-panda-differential.cjs); the full authored fixture, patch, capture, and control helpers are alongside it in `scripts/research/`.
