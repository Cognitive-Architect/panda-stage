# Issue #258 — FLA Slice 3 finalized-journal recovery repair

Status: PR #252 remains Draft / Open / Unmerged. This is a bounded repair on
the existing FLA V1 Slice 3 branch. Automated evidence is complete; maintainer
Windows H1-H13 human acceptance for the parent Slice 3 remains pending. This
receipt does not claim human PASS and does not close Issue #257.

- Issue: [#258](https://github.com/Cognitive-Architect/panda-stage/issues/258)
- Existing Draft PR: [#252](https://github.com/Cognitive-Architect/panda-stage/pull/252)
- Branch: `agent/issue-251-fla-v1-slice1`
- Actual start HEAD: `102ea6e53d7ca59b78c0b826ff30db6d8268ebf4`
- Repair commit: `bba6cd5` (`Fix finalized FLA journal recovery`)

## Root cause

The Project save and the journal phase update are separate durable writes. A
crash after `transaction.save(nextProject)` but before the journal advanced
from `finalized` to `project-saved` left a valid Project and valid finalized
PNG files behind. Recovery previously trusted the phase name alone and deleted
those files as incomplete output.

## Repair boundary

`FlaAssetCommitJournalService` now uses the bounded current journal, durable
Project, and exact target-file hashes:

- `finalized` and `project-saved` entries are considered committed only when
  every entry has the recorded Asset ID, `assets/<targetFileName>` path, and
  SHA-256 in the Project, and the target file has the recorded SHA-256;
- matching late-phase entries preserve the finalized files, remove stale
  temporary files, and clear the journal;
- an old Project with no journal Asset references cleans operation-owned target
  and temporary files and clears the journal;
- missing/changed target files, Project identity/path/hash mismatches, foreign
  journal identity, duplicate journal identities, and partially durable
  entries fail with bounded recovery failure without deleting a validated
  Project-owned target file;
- earlier `planned`/`staged` phases retain their rollback behavior and reject a
  target already owned by the durable Project.

No Project schema, parser/IR behavior, Asset transaction architecture, timers,
retries, global rescans, or broad reconciliation was introduced.

## Focused regression coverage

The unit suite explicitly simulates the missing crash window:

1. Commit a valid Slice 3 selection so the Project and PNG files are durable.
2. Recreate the journal at `phase = finalized` with the recorded IDs, paths,
   and hashes.
3. Add stale temporary files and invoke restart recovery.
4. Verify all Project Assets and target PNG hashes remain, temporary files and
   the journal are cleared, and the Project reopens unchanged.

The same test file also covers finalized old-Project cleanup plus late-phase
missing-target, changed-hash, and Project path/identity mismatch failures.

## Validation

Passed in the dedicated Windows acceptance checkout:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- focused FLA/contracts: 8 files, 53 tests passed;
- focused Project/Asset integration: 3 files, 26 tests passed;
- `git diff --check` and staged diff check.

No Full CI was triggered, per Issue #258. The existing parent PR remains
Draft/Open/Unmerged and no Issue/PR acceptance state was changed.
