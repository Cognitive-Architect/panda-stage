# Issue #655 — Product Preview isolates Position Delete

Delivery line: Draft PR #628 / `issue-627-s09-r01`, based on `ce72647`.

`EditorShell` passes its existing Preview-open state to the Timeline. Opening
Preview immediately suppresses the Position Delete portal, dismisses its local
state, and cancels an unfinished marker gesture. A retained Delete handler cannot
write while dismissed. Closing Preview restores editing without reopening the
old popup; explicitly clicking the key can reopen it.

The editor body, top region, and Bottom workspace are inert while Preview is
open. Preview takes keyboard focus on mount. No Camera, Auto Camera, playback,
right-rail, schema, Project, or History ownership changed. No stacking-level or
coordinate adjustment was needed.

Validation:

- Focused Timeline / Position / Preview / Auto Camera tests: 8 files, 87 passed,
  including cancellation of an unfinished retime when Preview opens.
- `pnpm lint` and `pnpm build` (including typecheck) passed.
- `pnpm exec electron scripts/verify-issue655-preview-isolation.cjs` passed in
  Windows Electron. It opens a non-base key's Delete action, opens Preview,
  clicks the old action location and retained button, attempts hidden marker
  activation/focus, and proves two keys / revision 0 / Undo 0 remain unchanged.
  Preview autoplay and focus ownership are preserved. Close leaves the popup
  dismissed; explicit reopening, Escape, and normal Delete work. The deliberate
  final Delete produces one revision and one Undo entry.
- Verification manifest / CI routing contracts: 2 files, 87 passed after
  registering this new verifier with the Timeline route.
- The first production CI exposed four directly affected source contracts.
  Three Timeline host assertions now include the Preview-open prop. The
  historical BottomWorkspace hash still protects every byte except the four
  explicitly authorized modal-isolation additions. These four files / 17 tests
  passed with focused lint after adaptation; no unrelated verifier work followed.
- `git diff --check` passed. No manual Full CI or broad verifier sweep was run.

Generated screenshots and `results.json` are under
`D:\PandaStage-Acceptance\issue655-preview-isolation\`. The isolated fixture for
human re-check is `fixture.pandastage` in that directory. It was opened through
the formal application's Main/IPC path, with the non-base key's Delete action
open. `human-ready.png` records that prepared window.

Normal automatic CI and the Issue-required final Windows human re-check are
pending at submission. Automated screenshots are not human acceptance.
