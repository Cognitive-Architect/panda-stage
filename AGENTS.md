# Panda Stage Agent Instructions

This file applies to the repository root and all of its subdirectories unless a
more specific `AGENTS.md` is added later.

## Repository purpose

Panda Stage is a Windows Electron desktop editor for short 2D cutout
animations. The stack is Electron, React, TypeScript, Vite, Konva/
react-konva, Zod, Vitest, ESLint, and pnpm.

## Repository map

- `src/main/` — Electron Main Process, trusted IPC handlers, project and asset
  services, autosave/recovery, export, FFmpeg, and window lifecycle.
- `src/preload/` — the sandbox-compatible, allowlisted `contextBridge` APIs for
  the main and hidden renderers.
- `src/renderer/` — React UI. `shell/` composes the Project Center and editor
  layout; `features/` contains resource, canvas, inspector, recovery, and
  action UI; `stores/` contains the single renderer editing stores.
- `src/domain/` — the current formal project model, schema, migrations,
  selectors, services, validators, geometry, and action-preset domain logic.
- `src/history/` — in-memory command history and project replay commands.
- `src/shared/` — IPC/API contracts and shared rendering/probe contracts.
  `src/shared/domain/` is a legacy probe compatibility model, not the current
  formal editor-domain entry point.
- `tests/` — unit, integration, contract, and Electron verifier support.
- `scripts/` — focused Electron verifiers, gates, fixture generation, and
  distribution helpers.
- `docs/`, `ROADMAP.md`, `DAILY_PLAN.md`, and `agent task/` — architecture,
  planning, work-order, handoff, and historical evidence material.

## Stable architecture and ownership invariants

- `EditorProjectStore` is the renderer's single owner of the formal `Project`
  snapshot, `dirty`, and `revision`. Persisted edits go through the domain
  services and `updateProject`; do not create a second project/session store.
- The store's `HistoryStore` owns undo/redo history. History is renderer
  session state and must not be serialized into `project.json`.
- `shotStore` owns the current Shot selection and `selectionStore` owns the
  current Layer selection. These are session-only selections and must be
  reconciled when the project or shot changes; they are not project data.
- `EditorShell` is the only construction and lifecycle owner of
  `ProjectSessionController`. Project open, recent-project open, switch,
  close, autosave coordination, and recovery candidate state flow through that
  owner.
- Main Process owns project-file access, formal save, autosave scheduling,
  recovery files, asset filesystem work, and external-process export. Use the
  existing `ProjectOperationCoordinator` for operations that share a project
  root.
- Renderer code must not access Node.js, `fs`, `path`, or child processes.
  Cross-process capabilities go through the narrow Preload allowlist and the
  existing IPC contracts.
- IPC channel names and request/response schemas are centralized under
  `src/shared/`. Validate payloads at both Preload and Main boundaries, and
  preserve Main's trusted-sender checks.
- Read-only inspection and UI draft state must not create a project revision,
  dirty state, or history entry. Do not duplicate a controller or store merely
  to render a panel.
- The formal editor path uses `src/domain/`. Legacy probe code under
  `src/shared/domain/` may remain for historical verifiers, but it is not a
  reason to route new production editor code through that compatibility model.

## Working rules for agents

- Before editing, read the applicable Issue/PR, current Git status and branch,
  the relevant implementation, and the tests or verifier that define the
  behavior.
- Keep changes minimal and within the authorized file/scope list. Do not turn
  a documentation or focused migration task into a cleanup or redesign.
- Preserve unknown user worktree changes. Never use `git reset`, `git clean`, or
  `git stash` to resolve work whose origin is unclear; do not delete unknown
  files, worktrees, or branches.
- Do not force-push. Do not merge, mark Ready, or close an Issue/PR that still
  requires the repository owner's acceptance.
- Do not lower a test, gate, verifier, IPC, or security check to obtain a green
  result. A headless/static result is not evidence of human Windows Electron
  acceptance.
- When scope conflicts, data-safety concerns, unexpected tracked changes, or
  an unclear delivery authority appears, stop the affected operation and
  report the concrete conflict before expanding scope.
- For documentation, verify every command against the current `package.json`,
  every repository-relative link against the checkout, and every architecture
  claim against current code. Treat daily receipts and old handoffs as
  evidence, not automatic descriptions of the current implementation.

## Validation matrix

Use only scripts that exist in the current `package.json`.

| Change | Minimum validation |
| --- | --- |
| Markdown-only change | `git diff --check`; check repository-relative links, command names, stale current-state claims, and authorized file scope. |
| Unit-only change | `pnpm test:unit`; add `pnpm typecheck` and `pnpm lint` when TypeScript or linted source is touched. |
| Renderer/domain production change | `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, and `pnpm build`; add `pnpm test:integration` for cross-feature or persistence behavior. |
| Main/Preload/IPC/autosave/recovery change | `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build`, plus the most specific applicable Electron verifier. |
| Full delivery or PR gate | Run the core checks above and the relevant `verify:*` gate from `package.json`; report any environment-limited human acceptance separately. |

The core repository commands are:

```powershell
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

## Windows and acceptance notes

- The product target is Windows Electron. PowerShell syntax and Windows path
  behavior are normal supported scenarios.
- Use a dedicated large temporary acceptance location such as
  `D:\PandaStage-Acceptance\` rather than putting large test data in the
  repository.
- Keep filesystem paths project-relative in persisted project data and route
  filesystem access through Main. Do not describe automated or headless checks
  as a substitute for a required real Electron acceptance run.

## Documentation navigation

- `README.md` is the human-facing repository entry point.
- `AGENTS.md` is the stable coding-agent guidance and must not become a daily
  status log.
- `docs/architecture.md`, `docs/development.md`, and `docs/ipc.md` contain
  architecture and engineering contracts; reconcile them with current code
  when a version-specific section differs.
- `ROADMAP.md` and `DAILY_PLAN.md` describe product planning, not proof that a
  planned stage is currently shipped.
- `agent task/` contains historical and planned daily work orders.
- `docs/design/` and `docs/handoff/` contain design decisions and handoffs;
  use them when the task names them and confirm their claims against current
  code and the active Issue/PR.
- `docs/test-receipts/` and `docs/evidence/` are historical validation
  records. They are useful evidence but do not automatically define current
  product capability.
- The active Issue or PR is the source of truth for the current task, scope,
  and delivery status when it differs from older documentation.
