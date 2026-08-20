# Issue #257 — FLA V1 Slice 3 asset-commit receipt

Status: PR #252 remains Draft / Open / Unmerged. Slice 3 implementation and
bounded automated evidence are complete. Maintainer Windows human acceptance
is still pending; this receipt does not claim human PASS.

- Issue: [#257](https://github.com/Cognitive-Architect/panda-stage/issues/257)
- Existing Draft PR: [#252](https://github.com/Cognitive-Architect/panda-stage/pull/252)
- Implementation branch: `agent/issue-251-fla-v1-slice1`
- Actual start HEAD: `3b30fd68433f936cae5b8cf45bb98c5e1f99ca2d`
- Implementation commit: `59863e8ecd0681b621faeb5ce84da035268c3e46`
- Final pushed HEAD: recorded in the exact-HEAD PR receipt comment after the
  receipt commit; PR state remains unchanged.

## Delivered boundary

This change implements only the raster-materialization boundary:

```text
accepted Slice 2 selection
-> explicit commit action
-> Main-owned strict PNG batch plan
-> journaled stage/finalize
-> one revision-guarded Project save
-> ordinary ImageAsset response
```

Renderer sends only `sessionId`, stable selected media IDs, Project snapshot/
identity, `baseRevision`, count, and explicit confirmation. The request schema
has no byte, source-path, target-path, or arbitrary destination fields. Main
looks up the Panda-owned encoded PNG bytes from the existing FLA session and
keeps the absolute `.fla` path Main-only.

The resulting records are ordinary `ImageAsset`s. No FLA Asset kind, FLA
provenance field, Project schema change, timeline/layer/shot/vector/text/
ActionScript import, parser-boundary change, or global Asset rewrite was added.

## Commit and recovery behavior

- All selected IDs and the current Project/revision/session identity are
  validated before writes.
- Every selected encoded payload is independently PNG-validated, hashed from
  the actual bytes, mapped through the existing Asset naming/sanitization and
  duplicate rules, and planned before finalization.
- A bounded Panda-owned journal is written and synced under
  `recovery/.fla-asset-commit-journal.json` before final Asset paths are made.
- Unique temporary files are staged and synced, then finalized without
  overwriting existing files. The Project is saved once through the existing
  revision/CAS path.
- Post-save Project/file/hash consistency is checked before the journal is
  cleared and the session is released.
- Failure at planning, journal write/sync, staging write/sync, finalization,
  save, or post-save consistency rolls back all newly-created files and leaves
  pre-existing duplicate Assets untouched.
- Project-open recovery removes incomplete staged/finalized artifacts and
  reconciles a durable `project-saved` journal only when the Project and target
  file hashes agree.

The Renderer applies a successful response once through the existing
`EditorProjectStore`; duplicate-only results do not create a second mutation.

## Real Windows Electron evidence

The bounded real-sample evidence is at:

`D:\PandaStage-Acceptance\issue-257-slice3\real-electron-asset-commit.json`

The run used `D:\表情合集\文件.fla`, Electron `43.1.1`, Node `24.18.0`, and
the source SHA-256 remained
`84682edcd49b8fcc072ae740188677bae9d7d0fd603b8bed51a7ac4ddeb3119f` before and
after the operation.

Recorded result:

- review: 158 cards and 158 thumbnails; 156 PNG-origin and 2 JPEG-origin
  media; transparent media and `a1.png` were present;
- representative selection: transparent raster, `a1.png`, and the JPEG-origin
  `QQ图片20210120232010.jpg`; explicit commit was absent before confirmation;
- commit: 3 ordinary PNG `ImageAsset`s, 0 duplicate reuse, success summary
  shown, controls locked during success;
- JPEG-origin target became `QQ图片20210120232010.png`; alpha, dimensions,
  SHA-256, relative paths, and PNG bytes were verified;
- unselected media were absent, the source `.fla` was not copied as an Asset,
  and the recovery journal was cleared;
- explicit save acknowledged revision 1, then Save → Close → Reopen retained
  all three Assets and all three thumbnail IPC reads returned `ready`.

The optional all-158 commit stress run was not performed; the real run reviewed
all 158 items and committed the required representative subset. Failure
injection, restart recovery, stale revision, duplicate/collision, and reserved
name coverage is in the focused unit suite rather than manual sabotage of the
real sample.

The evidence run used `PANDA_STAGE_ACCEPTANCE_NO_SANDBOX=1` because this local
Electron 43 environment intermittently hangs hidden renderers with its normal
GPU/sandbox launch. That is an acceptance-environment launch workaround only;
it does not change the product parser or commit policy. A later repeat from the
same machine also showed an environment-only preflight `stat/read` hang before
the parser boundary; an independent Electron IPC preflight completed in about
60 ms, and the recorded passing evidence above remains the bounded real run.

## Automated validation

Passed in the dedicated acceptance checkout:

- `pnpm typecheck` (included in `pnpm build`)
- `pnpm lint`
- `pnpm build`
- focused Slice 3 command: 8 files, 51 tests passed;
- `pnpm test:integration`: 26 files, 147 tests passed;
- `git diff --check`
- `node --check scripts/verify-issue257-slice3.cjs`
- `scripts/verification-manifest.json` parses and routes the new
  `verify:issue257-slice3` entry; manifest count is 48.

Full unit baseline: 122/123 files and 887/888 tests passed. The sole failure
is the untouched `tests/contract/issue197-timeline-collapse-space.test.ts`,
whose strict LF-sensitive regex cannot find `.bottom-workspace` in the current
CRLF CSS; it reproduces standalone and is outside this Slice 3 scope. It was
not weakened or modified.

## Focused failure and regression coverage

The tests cover identifier-only request rejection, zero selection, PNG
validation, duplicate reuse, same-name/different-byte hash collision naming,
reserved-name sanitization, no-overwrite behavior, stale revision zero
mutation, journal write/sync failure, staging write/sync failure, finalization
postcondition failure, Project save failure, post-save consistency failure,
interrupted-journal recovery, durable Project-saved reconciliation, and
renderer response idempotence. Existing ordinary PNG/JPG Asset import and the
Slice 1/2 contracts are covered by the integration and focused suites above.

## Maintainer Windows human acceptance — pending

At the final pushed HEAD, maintainer must still execute the Issue #257 H1–H13
checklist with the real sample:

1. Open a normal Project and enter `Import FLA...`.
2. Confirm the compatibility review appears before mutation.
3. Select at least three representative items, including transparent,
   non-default-size, and JPEG-origin media where practical.
4. Execute the explicit commit/import action.
5. Confirm selected items appear as ordinary existing-library image Assets.
6. Confirm unselected FLA media are absent.
7. Confirm transparent alpha survives normal Panda preview/use.
8. Confirm JPEG-origin media is a valid Panda PNG-backed Asset.
9. Confirm the source `.fla` is unchanged and not an Asset.
10. Confirm ordinary PNG/JPG import still works afterward.
11. Save the Project, close it, and reopen it.
12. Confirm imported Assets and thumbnails still render without the parser
    session or source FLA.
13. Record the human result at the exact HEAD; keep PR #252 Draft/Open/
    Unmerged and do not close Issue #257.

Automated rollback, restart-recovery, and stale-revision evidence is provided
above; the maintainer does not need to manually sabotage a 97th file.

Known residual risks are reserved for Slice 4: no timeline/frame semantics,
symbols/MovieClips, vectors/shapes, text, masks/filters/blend modes, or
ActionScript execution are included here.
