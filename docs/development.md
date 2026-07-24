# Development guide

## Project lifecycle

Project folders must end in `.pandastage`. Creation has a deliberately strict
policy: the target must not exist. This prevents a new project from silently
merging with unrelated files.

The renderer can request only three operations through `window.pandaStage`:

```ts
await window.pandaStage.project.create({
  projectRoot: 'D:\\Projects\\demo.pandastage',
  metadata: { name: 'Demo' },
});

await window.pandaStage.project.open({
  projectRoot: 'D:\\Projects\\demo.pandastage',
});

await window.pandaStage.project.save({
  projectRoot: 'D:\\Projects\\demo.pandastage',
  project,
});
```

Each response is a discriminated union. Check `response.ok` before reading
`response.value`; failures provide a stable `code`, readable `message`, and
the affected `projectRoot`. Request and response objects are runtime-validated
in both Preload and Main IPC boundaries.

`project.save` is update-only. The target must already contain a readable,
supported, schema-valid `project.json`, and its project ID must equal the
incoming project's ID. A mismatch returns `PROJECT_ID_MISMATCH`; use
`project.create` for a new directory rather than trying to save into an empty
`.pandastage` directory.

Do not add filesystem access to renderer code. Add project business rules to
`ProjectService`, and keep all project-file operations in
`ProjectFileSystemService`. There must remain only one implementation of the
temporary-write, sync, close, and same-directory rename protocol.

## Verification

Run the complete Day 12 checks:

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

The integration suite uses real temporary directories, including Chinese,
spaces, and emoji. Its fault injection hooks belong at the filesystem
boundary and cover failure before temporary creation, after sync, and before
the atomic replace. These hooks are for deterministic verification; production
uses the service with no injected faults.

## Autosave and recovery development

Use `EditorProjectStore` as the only dirty/revision source. Opening a formal
project starts clean at revision 0. Every in-memory edit or restore increments
the revision and marks dirty; an explicit successful formal save marks clean.
Do not create component-local dirty flags.

Use `saveCurrentProject()` for Renderer formal-save acknowledgement. It captures
the revision from the request snapshot before awaiting IPC and passes that same
revision to `EditorProjectStore.markSaved()`. A stale acknowledgement must not
replace newer memory state; a future acknowledgement must throw.

Main owns the scheduler and filesystem:

- `autosave.track` starts or refreshes the single project session after Main
  confirms the root's on-disk project ID.
- `autosave.update` supplies the latest dirty snapshot and integer revision.
- `autosave.stop` clears the project timer and waits for an in-flight write.
- clean state and already-snapshotted revisions do not write.
- repeated ticks while a write is active join that write; they never overlap.
- formal save and recovery writes must receive the same
  `ProjectOperationCoordinator`; the key is the resolved project root.
- keep formal write, recovery cleanup, and `markFormalSaved` in that shared
  critical section. Do not introduce a global save lock.

Recovery detection belongs after a successful explicit project open. A restore
loads only into `EditorProjectStore` and remains dirty. Ignore validates but
retains the file. The user-facing Save recovered project action is the only
path that commits recovered content to `project.json`.

Use `ProjectSessionController` for project changes. Prepare the new open,
temporary autosave session, and recovery candidate before stopping the old
session or changing `EditorProjectStore`. Any pre-commit failure must stop the
temporary session and leave the old store/session usable. A same-path reopen
while dirty must remain blocked. After `project.open`, compare Main's returned,
resolved root with the current root before calling `autosave.track`; this second
check is required for `.` and `..` path aliases.

Run Day 13 verification:

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm verify:day13
```

`verify:day13` launches the built Electron renderer, verifies the frozen
autosave/recovery API surface and absence of `window.require`, renders a
candidate with project name and timestamp, and writes evidence under
`docs/evidence/day-13/`.

## Recent projects and close-guard development

- Construct `RecentProjectsService` with
  `path.join(app.getPath('userData'), 'recent-projects.json')`; never point it
  inside a `.pandastage` directory.
- Record successful create/open/save documents. Configuration failure is
  logged but does not turn a successful project open into a failed open.
- Missing, mismatched, and invalid records must remain visible. Removal is an
  explicit IPC action.
- Recent-project listing must parse/migrate/validate `project.json` and compare
  its ID with the record. Opening a recent entry must use the dedicated Main
  request with `expectedProjectId`; do not route it through ordinary open.
- Relocation must open the selected directory and compare project IDs before
  updating the record. Do not rewrite asset paths or project JSON.
- Ordinary recent `record()` must reject a different project ID already stored
  at the same normalized path.
- Use `PathService` for new Main-process path equality and normalization logic.
- Keep the close prompt in Electron Main. Renderer does not receive filesystem
  or process access.
- Discard must stop scheduling, wait for the project recovery write, clean and
  verify recovery under the shared project-root coordinator, and only then
  allow close. A cleanup failure must keep the window open.
- Run shutdown cleanup on `will-quit`, not before the dirty close decision.

Day 14 verification:

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm verify:day13
pnpm verify:day14
```

`verify:day14` renders available and missing recent projects in a real Electron
window, reopens an available entry through the frozen Preload API, verifies the
relocation/remove actions and close-choice labels, and writes evidence under
`docs/evidence/day-14/`.

## M1 project lifecycle gate

Day 15 closes M1 with a reproducible Windows lifecycle gate:

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm verify:day13
pnpm verify:day14
pnpm verify:m1
```

`verify:m1` uses real Unicode/space/emoji directories and exercises
create/save/reopen, an injected atomic-save failure, crash recovery without
formal-file replacement, directory movement, recent-project relocation,
relative asset portability, and save/cancel/discard close outcomes. It writes
machine-readable evidence and an operation log under `docs/evidence/m1/`.

GitHub Actions must run both unit and integration suites. The workflow also
runs `verify:m1` on `main`, `chore/**`, `feat/**`, and `fix/**` pushes and on
pull requests, so a branch can obtain CI evidence without requiring a PR.

## Secure asset import development

Keep external file paths inside Main. Renderer code may only use the frozen
`assets.choose` and `assets.importDropped` APIs; a dropped DOM `File` is
resolved to a native path only in Preload with Electron `webUtils`.

`AssetImportService` is the transaction coordinator:

- inspect extension, declared MIME, and binary media structure before copying;
- hash sources and existing project assets with streaming SHA-256;
- return explicit `imported`, `duplicate`, `rejected`, or `failed` results;
- preserve Unicode/spaces and resolve same-name conflicts without overwrite;
- copy through the asset filesystem service, then save the full validated
  project once through `ProjectService.transact`;
- register each formal target as a rollback candidate before any copied-media,
  Asset, or Project validation;
- roll back all request-owned files on internal construction/save failure and
  report exact residual paths if deletion fails.

`AssetImportFileSystemCleanupError` can only be handled at the
`copyIntoAssetsAtomically()` call site. Do not inspect for it in hash, media
inspection, or later model branches. Internal cleanup that removes both the
formal target and temporary name remains an ordinary per-file copy failure;
only non-empty residual paths are promoted to operation-level rollback
failure. Renderer must display every returned path and leave project, dirty,
and revision state untouched.

The active `AutosaveService` session is Main's revision authority. An import
must match its full project snapshot and revision before candidate inspection,
again after candidate processing, and immediately before save. A mismatch
returns `ASSET_IMPORT_STALE_REVISION` before a stale request can copy anything.
The error includes the authoritative snapshot for an explicit refresh/retry,
but Renderer must not apply it automatically over dirty edits. Tests must
start concurrent requests before the first completes; sequential calls alone
do not prove the conflict boundary.

Do not add absolute source paths or hashes to `ProjectSchema`. Stored asset
paths stay project-relative, and hashes are recomputed from project-owned files
for deduplication. Imported audio has no fabricated duration; it cannot be
placed on a timeline until a later metadata workflow supplies `durationMs`.

Generate the small synthetic fixtures and run Day 16 verification with:

```powershell
pnpm assets:generate-day16-fixtures
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm verify:day16
```

The fixtures are generated locally by the pinned FFmpeg development binary and
contain no third-party media. `verify:day16` launches the built Electron UI,
checks the constrained Preload surface and visible import result, then writes
`docs/evidence/day-16/results.json` and `asset-import.png`.
