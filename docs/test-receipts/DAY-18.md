# Day 18 — Categorized Asset Library + Reference-Safe Deletion

## Coordinates

- Work order: `B-18/45`
- Branch: `feat/day-18-asset-library-ui`
- Baseline SHA: `433106c598581c1f9d9bb8ca4ba00570582db97d`
- Result SHA: `23e6cf7d4e07ef19c4b544d7f247434c509e9037`
- Issue #33 hardening SHA: `c1e6e2e7c1a417a19c80d524ec0a3608e00e2f10`
- Result: PASS

## Actual result

- The library presents character images, backgrounds, and audio as three
  explicit categories, with per-category counts, an import entry, a
  scrollable thumbnail grid, empty states, selection, and a details panel.
- Image cards use only cache-derived PNG data URLs obtained through Main IPC.
  Project-relative original paths are never assigned to `img.src`. Missing
  thumbnails show a stable placeholder and a metadata rebuild button.
  Main accepts a cached thumbnail only after validating its PNG chunks, CRCs,
  complete bounded inflate stream, scanline filters, positive dimensions, and
  256px edge limit. A Renderer decode error downgrades only that card to the
  rebuildable missing state.
- Selected details include the name, media type, dimensions or duration,
  project-relative path, path ownership status, and human-readable references.
- The custom drag payload is strictly
  `{ version: 1, assetId, type }` under
  `application/x-panda-stage-asset`. It contains neither a file path nor a
  serialized `Asset`.
- `scanAssetReferences(project, assetId)` is a pure domain function covering
  character base/expression images, direct shot background/layer sources,
  shot audio clips, and dialogue-to-audio-clip references.
- Main validates the exact project snapshot and revision, scans references,
  stages the asset and hash-addressed thumbnail by same-directory rename, then
  repeats the full snapshot comparison and reference scan. A final synchronous
  commit guard repeats that comparison at the atomic project replacement
  boundary. Only then does Main save the model and finalize deletion.
  Stage/save/stale failures roll staged files back before returning an error.
- The Renderer mutates its store only after a successful structured Main
  response. A stale success can merge only when newer Renderer edits do not
  introduce a reference to the deleted asset.

## Deletion protocol

1. Renderer asks for explicit user confirmation and sends the current
   `Project`, `baseRevision`, project root, and asset ID.
2. Main checks the trusted sender and strict Zod IPC contract.
3. `AssetDeleteService` obtains the project coordinator lock, opens the disk
   project, and compares project identity with the Main-owned autosave snapshot.
4. Main rejects stale/mismatched/not-found requests before moving a file.
5. `ReferenceScanner` runs against the authoritative current snapshot. Any
   reference returns `ASSET_DELETE_REFERENCED` plus structured locations.
6. For an unreferenced asset, Main stages the real asset and optional thumbnail.
   Before commit it re-reads the Main autosave snapshot, compares the project
   identity, revision, and complete Project value, and scans references again.
   Any difference returns `ASSET_DELETE_STALE_REVISION` with
   `currentProject/currentRevision` after restoring both files.
7. The same comparison runs synchronously after the temporary `project.json`
   has been flushed and immediately before atomic replacement. With no change,
   Main saves at `baseRevision + 1` and removes the staged files.
8. Project save acknowledgement synchronizes the formal project, recovery
   state, Main snapshot, and Renderer store. Cleanup residuals remain visible
   and actionable rather than being hidden.

## Real outputs

| Evidence | Result |
|---|---|
| 100-item category | 100 background cards; independent grid scrolling |
| Scroll + selection observation | 28.3 ms in the recorded Electron run |
| Thumbnail source audit | 0 non-data image sources |
| Missing cache | understandable placeholder plus `重建` action |
| Truncated PNG cache | valid signature plus truncated body → `missing`, no data URL |
| Oversized PNG cache | valid 257×1 PNG → `missing`, no data URL |
| Browser decode failure | failed card becomes selected missing placeholder; healthy cards remain ready |
| Revision race | revision 3 staged delete + revision 4 edit → stale and complete rollback |
| Drag payload | exactly version, asset ID, and `background-image` type |
| Referenced delete | Main blocks; exact Opening/Background location remains visible |
| Unreferenced delete | count 100 → 99; success status confirms file/cache/model sync |
| Machine evidence | `docs/evidence/day-18/results.json` |
| Screenshots | `docs/evidence/day-18/*.png` |

The real filesystem integration test creates a `.pandastage` directory,
project file, asset file, thumbnail cache, dirty recovery snapshot, Main
autosave state, and Renderer store. A successful deletion asserts the asset,
cache entry, model record, and recovery snapshot are all gone at revision 4.
Injected cache-stage and atomic-project-save failures assert all before/after
hashes are identical. Issue #33 additionally blocks after staging and at the
atomic replacement boundary, advances Main and Renderer to dirty revision 4,
and proves the formal project, recovery, asset, cache hashes, and revision 4
stores are preserved with zero `.asset-delete` or temporary project files.

## Temporary image classification contract

- An image referenced by a `Character` base image or expression is currently
  classified as **角色图片**. Every other image is classified as **背景图片**.
- Therefore a newly imported character image that has not yet been bound to a
  `Character` temporarily appears under backgrounds.
- Day 19 character creation must not depend on the circular assumption that an
  image is already classified as a character image before it can be selected
  to create a character.
- Issue #33 adds no Asset-purpose field, Character CRUD, character editor, or
  other Day 19 behavior.

## Automated gates

| Gate | Result | Evidence |
|---|---|---|
| TYPE | PASS | `pnpm typecheck` |
| LINT | PASS | `pnpm lint` |
| FMT | N/A | repository has no Prettier dependency/config; ESLint enforces the repository TypeScript style |
| UNIT / COMPONENT | PASS | 48 files / 253 tests |
| INTEGRATION | PASS | 8 files / 66 tests |
| BUILD | PASS | `pnpm build` |
| M1 | PASS | `pnpm verify:m1` |
| DAY 16 | PASS | `pnpm verify:day16` |
| DAY 17 | PASS | `pnpm verify:day17` |
| DAY 18 REAL/UI | PASS | `pnpm verify:day18` |
| ARCH | PASS | no Renderer FS import; deletion and thumbnail reads are Main-only, trusted-sender, strict IPC operations |
| CI | PASS | GitHub Actions run `30142914642` passed all gates on the Issue #33 result/evidence head |

## Blade table

| ID | Result | Authoritative evidence |
|---|---|---|
| FUNC-001 | PASS | three-category component/selector tests and UI screenshot |
| FUNC-002 | PASS | component tests and selection/details Electron evidence |
| FUNC-003 | PASS | strict drag schema/unit test and real `DataTransfer` evidence |
| FUNC-004 | PASS | real filesystem deletion integration test |
| CONST-001 | PASS | static audit: Renderer has no Node/FS dependency |
| CONST-002 | PASS | pure scanner unit test proves input remains unchanged |
| CONST-003 | PASS | cache path absence asserted after real deletion |
| CONST-004 | PASS | DOM audit reports only bounded PNG data URLs |
| NEG-001 | PASS | referenced background integration test preserves all hashes |
| NEG-002 | PASS | character/layer/audio/dialogue scanner unit cases |
| NEG-003 | PASS | stage/save fault injection leaves model and files unchanged |
| NEG-004 | PASS | missing-thumbnail component and Electron evidence |
| UX-001 | PASS | empty-state component test and import entry screenshot |
| UX-002 | PASS | structured Main reference appears as human-readable UI warning |
| E2E-001 | PASS | open → browse → select → drag → block reference → delete unused |
| HIGH-001 | PASS | 100-card Electron scroll/selection/drag observation under 1 second |

## Issue #33 completion audit

| Requirement | Result | Evidence |
|---|---|---|
| Commit-time revision/full-project validation | PASS | `AssetDeleteService.assertCommitSnapshot` before save and atomic replacement guard |
| Commit-time reference rescan | PASS | same guard invokes the pure scanner on the latest Main snapshot |
| Any staged-delete revision change is stale | PASS | reference and unrelated-edit controlled integration races |
| Stale preserves project/recovery/asset/cache | PASS | before/after SHA-256 state equality |
| Stale leaves no delete/temp residue | PASS | directory assertions for `.asset-delete` and `.tmp` |
| Normal 3 → 4 deletion stays synchronized | PASS | real filesystem/Main/Renderer integration path |
| Real PNG content and dimensions validated | PASS | chunk/CRC/inflate/filter/dimension validator and unit tests |
| Signature + truncated body is missing | PASS | deterministic cached-byte service test and machine gate |
| Over-256 cache is missing | PASS | fully generated 257×1 PNG service test |
| Renderer decode error falls back | PASS | component callback test and real Electron `error` event |
| Fallback exposes rebuild | PASS | component and Electron DOM/screenshot assertions |
| Other cards remain ready | PASS | component and Electron image-count/healthy-card assertions |
| Temporary category rule documented | PASS | contract section above |
| Existing 100-item UI behavior retained | PASS | updated Day 18 Electron Gate |
| M1/Day16/Day17/Day18 regressions | PASS | all four gates rerun against `c1e6e2e7c1a417a19c80d524ec0a3608e00e2f10` in an isolated worktree |

## Decisions and debt

- `DECISION-001`: keep reference discovery in one pure domain scanner. UI
  preview and Main authority share the same implementation, while Main always
  rescans the latest validated snapshot.
- `DECISION-002`: use reversible same-directory renames as the deletion staging
  boundary. The model is saved only after both asset/cache staging operations
  succeed and two Main-owned commit checks pass; save/stale failures roll them
  back.
- `DECISION-004`: validate cache PNGs in-process without decoding originals.
  The validator bounds input to 6 MB and decoded scanlines to at most a
  256×256 PNG, rejects structural/CRC/zlib/filter errors, and avoids spawning
  100 media subprocesses for the library grid.
- `DECISION-003`: retain a simple CSS grid because the real 100-item interaction
  completed in 28.3 ms. Thumbnail decoding stays out of Renderer; virtualization
  is not justified at this scale.
- `DEBT-PERF-B18-001`: none blocking. The recorded number measures DOM scroll,
  selection, and two animation frames on the CI-style Electron fixture; it is
  not a low-end-device benchmark.
- `DEBT-TEST-B18-001`: none blocking. Automated screenshots replace a video
  recording and preserve the same drag/reference/delete states as reviewable
  evidence.
- Scope remained limited to the asset library. No character CRUD, layer
  creation, canvas placement, tags, timeline behavior, or full-text search was
  introduced.

## Rollback

- Revert the implementation commit recorded above, then revert the Day 18
  evidence/receipt commit.
