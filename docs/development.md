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
