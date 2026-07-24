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

Main owns the scheduler and filesystem:

- `autosave.track` starts or refreshes the single project session after Main
  confirms the root's on-disk project ID.
- `autosave.update` supplies the latest dirty snapshot and integer revision.
- `autosave.stop` clears the project timer and waits for an in-flight write.
- clean state and already-snapshotted revisions do not write.
- repeated ticks while a write is active join that write; they never overlap.

Recovery detection belongs after a successful explicit project open. A restore
loads only into `EditorProjectStore` and remains dirty. Ignore validates but
retains the file. The user-facing Save recovered project action is the only
path that commits recovered content to `project.json`.

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
