# Issue #260 — FLA V1 Slice 4 candidate receipt

Status: automated Slice 4 candidate work is recorded below. Final exact-HEAD
Windows maintainer acceptance and the one-shot Ready/Full gate remain pending;
this receipt does not claim a human PASS, change PR state, or close an Issue.

## Delivery identity

- Issue: [#260](https://github.com/Cognitive-Architect/panda-stage/issues/260)
- PR: [#252](https://github.com/Cognitive-Architect/panda-stage/pull/252)
- Branch: `agent/issue-251-fla-v1-slice1`
- Actual start HEAD: `9b50166b928c30a850b73cd0b402b3ad89a3cd14`
- Final candidate HEAD: pending the implementation/receipt push; no human PASS
  is claimed for the current local candidate
- PR policy: Draft / Open / Unmerged until the final acceptance gate

## Parser provenance and bounded closure

The shipped parser remains `lifeart/fla-viewer@048000ccab67469980b8dedd1fc2b65a02d2b164`.
The exact 12-file parser-core inventory, the single permitted `@ts-nocheck`
build preamble, direct runtime imports, and Vite built-entry packaging are
recorded in `resources/licenses/FLA-PARSER-NOTICE.txt`. No viewer/player,
exporter, muxer, or floating upstream dependency was added.

## Notice and residual risk

Packaged notice: `resources/licenses/FLA-PARSER-NOTICE.txt`.
Update policy: `docs/handoff/issue-260-fla-parser-policy.md`.
The upstream result remains `LICENSE_INTENT_ONLY`; the exact #250 maintainer
risk decision is preserved and no stronger grant is claimed.

## Parser-only dependency audit

The exact production subset is `jszip@3.10.1` and `pako@1.0.11` plus the
11-node transitive closure listed in the notice. The disposable parser-only
package was audited with:

```text
npm audit --omit=dev --audit-level=high
result: 0 high / 0 critical (and 0 moderate / 0 low)
```

No unrelated application-wide audit finding is promoted into this FLA task.

## #259 bounded UX disposition

The two-step boundary remains intact: `确认选择` records a read-only intent;
the separate confirmed-state action row now shows the selected count, explains
that no Asset exists yet, and presents a prominent `导入这 N 项` primary CTA.
The action row is outside the single review-body scroll and stacks safely in
the narrow Windows layout. #259 remains open until the maintainer re-checks
this exact candidate; it is not closed by automated evidence.

## Cleanup and recovery audit

Existing Slice 1–3 and #258 evidence remains the authority for parser-window,
object-URL, session, staging, journal, rollback, restart-recovery, source
immutability, and Save/Close/Reopen behavior. The final candidate reran the
real Electron boundary, review, commit, and all-158 paths. The resulting
evidence shows parser-window cancellation cleanup, read-only review before
mutation, successful-journal cleanup, source immutability, and Save/Close/
Reopen thumbnail reads. Focused unit/integration coverage remains in
`tests/unit/fla-parser-window-manager.test.ts`,
`tests/unit/fla-import-preflight.test.ts`,
`tests/unit/fla-asset-commit.test.ts`,
`tests/integration/recovery-lifecycle.test.ts`,
`tests/integration/asset-metadata-revision-safety.test.ts`, and
`tests/integration/asset-import.test.ts`. Any new cleanup failure is a release
blocker rather than a reason to broaden the architecture.

## Validation record

Current local candidate command results:

- `pnpm typecheck` — PASS.
- `pnpm lint` — PASS.
- Focused FLA/contract/unit run: 9 files, 55 tests — PASS.
- `pnpm test:integration` — 26 files, 147 tests — PASS.
- `pnpm build` — PASS; built `dist/renderer/fla-parser.html`, the hashed
  `flaParser` bundle, and `dist-electron/preload/fla-parser.js`.
- Built artifact smoke — PASS; all three `fla-parser.html` asset references
  resolve, the parser bundle is present (228,851 bytes), and the FLA preload
  bundle is present (140,014 bytes).
- `pnpm exec electron scripts/verify-issue251-slice1.cjs` — PASS; real sample
  1920×1080 @ 30 fps, 158 media, 156 placed, 2 library-only, 158/158 payload
  integrity, parser windows 0 after success and cancellation, source SHA
  unchanged.
- `pnpm exec electron scripts/verify-issue253-slice2.cjs` — PASS; 158 cards /
  thumbnails, compatibility taxonomy, portal/scroll behavior, read-only
  selection and zero Asset/Project mutation.
- `pnpm exec electron scripts/verify-issue257-slice3.cjs` — PASS; strict
  3-item import, 3 ordinary PNG Assets, source not imported, journal cleared,
  and Save→Close→Reopen thumbnail reads ready.
- `pnpm exec electron scripts/verify-issue260-slice4.cjs` — PASS; details are
  recorded below as a separate stress result.
- `git diff --check` — PASS; only the repository's existing LF/CRLF conversion
  warnings were emitted.
- Verification manifest — PASS; 49 manifest gates, 49 `verify:*` scripts, and
  the `issue260-slice4` route is present.

The full unit baseline was `123` files / `892` tests: `891` passed and one
untouched Issue #197 contract failed because its narrow-layout CSS extraction
could not find the existing `.bottom-workspace` block. No Issue #197 test or
that CSS block was changed by Slice 4. This unrelated baseline failure remains
reported rather than suppressed.

The parser-only production subset audit used exact `jszip@3.10.1` and
`pako@1.0.11`, with 14 production dependency nodes and no high, critical,
moderate, or low advisories. The complete bounded inventory and notice
identities are in `resources/licenses/FLA-PARSER-NOTICE.txt`.

## All-158 stress result

Evidence: `D:\PandaStage-Acceptance\issue-260-slice4\real-electron-asset-commit.json`.

- Classification: `STRESS_PASS`.
- Real sample: `D:\表情合集\文件.fla`; source SHA unchanged.
- Selected: 158; imported: 158; reused duplicates: 0; renamed collisions: 0.
- Commit wall time: 2,262 ms.
- Peak/observable failure: none observed; peak memory was not instrumented.
- Project Asset count: 158.
- Save→Close→Reopen: PASS; 158/158 reopened thumbnail reads were `ready`.
- Commit journal: cleared; source `.fla`: not imported as an Asset.

## Final Windows acceptance handoff

Run the compact end-to-end smoke on the exact pushed final candidate using
`D:\表情合集\文件.fla`: review before mutation; 1920×1080 at 30 fps; 158 media,
156 placed, 2 library-only; confirm a small subset without mutation; perform
the explicit import; verify ordinary Assets/canvas/PNG-JPG regression;
Save → Close → Reopen; cancel a fresh review; and verify the source SHA is
unchanged. Record the maintainer's result here before changing PR readiness.
The final candidate is not yet human-PASSed; PR #252 must remain Draft/Open/
Unmerged and #259 must remain open pending that maintainer re-check.

## Residual V1 limitations

Raster-only import; no timeline semantic import; no Symbol/MovieClip semantic
import; no tween import; no native vector/shape import; no text import; no
mask/filter/blend-mode fidelity; ActionScript is never executed; legacy binary
FLA is not a product promise; upstream license evidence remains intent-only
under the #250 maintainer-approved risk decision.
