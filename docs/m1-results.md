# M1 project-system result

M1 closes on Day 14 with an evidence-backed local project lifecycle:

- create, edit, atomic save, close, and reopen;
- v0 migration entry and corrupt/future JSON errors;
- 30-second dirty-only recovery and crash restoration;
- application-level recent projects with missing-path retention;
- save/discard/cancel close protection;
- real Unicode directory relocation with recovery and relative assets intact.

## Evidence

| Requirement | Evidence | Result |
|---|---|---|
| Unicode create/save/reopen | `tests/integration/project-lifecycle.test.ts` | PASS |
| v0 migration | `tests/integration/project-lifecycle.test.ts` | PASS |
| corrupt/future JSON | `tests/integration/project-lifecycle.test.ts` | PASS |
| crash recovery | `tests/integration/recovery-lifecycle.test.ts` | PASS |
| moved project + relative asset | `tests/integration/day14-lifecycle.test.ts` | PASS |
| recovery after move | `tests/integration/day14-lifecycle.test.ts` | PASS |
| cancel then save close | `tests/integration/unsaved-close-lifecycle.test.ts` | PASS |
| save failure keeps window | `tests/integration/unsaved-close-lifecycle.test.ts` | PASS |
| recent-project UI and reopen | `docs/evidence/day-14/ui-results.json` | PASS |

The real relocation test renames a `.pandastage` directory containing Unicode,
spaces, a relative `assets/...` file, and a recovery snapshot. The old recent
entry remains `missing`; after identity-checked relocation, the new root is
`available`, the asset is readable, and the recovery snapshot is detected.

## M1 remaining items

- No functional M1 acceptance item remains open.
- `DEBT-PLATFORM-B14-001`: Windows local-drive, case, slash, dot-segment,
  trailing-separator, Unicode, and UNC normalization are covered. A live
  authenticated network share was not available, so UNC I/O is not claimed.
- `DEBT-TEST-B14-001`: native MessageBox labels and controller outcomes are
  automated, but the operating-system modal itself is not screenshot-driven.
  The real Electron recent-project UI is captured separately.

M2 asset-library behavior remains intentionally out of scope.
