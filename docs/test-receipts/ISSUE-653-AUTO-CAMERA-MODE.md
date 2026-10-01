# Issue #653 — 自动运镜 session mode

Baseline: PR #628 branch `issue-627-s09-r01` at `c44a587`. Windows human acceptance is pending.

## Implementation

- `EditorShell` owns one session-only OFF-by-default mode. Both the landscape right-rail toggle and Product Preview mirror read/write it. Closing Preview preserves it; successful project switch, recent-project switch, and close reset it. No Project, History, schema, or persisted preference path was added.
- The right rail keeps 字幕 / 属性 / 工具 as navigation in its existing `<nav>`. A separate, labeled mode group below a divider exposes `自动运镜` with `aria-pressed` and a video-camera icon. It does not open the right workspace. Portrait keeps the Preview mirror without a new toolbar.
- Preview's Camera plan is derived from the shared mode on mount, before the existing readiness-gated auto-play effect can start playback. The in-Preview control uses the same state and the user-facing copy is `自动运镜`.
- The historical Phase 2 CSS host slice remains byte-exact; the local rail extension is a later imported stylesheet. The old whole-file `EditorShell` freeze was narrowed to its Quick/History/Tools ownership assertions because #653 intentionally changes that shell.

## Automated validation

- Focused shell/Preview/Camera and compatibility tests: 6 files / 45 tests passed; focused follow-up historical-contract suite: 4 files / 17 tests passed.
- `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` (325 files / 2195 tests after the route assertion), `pnpm test:integration` (37 files / 188 tests), `pnpm build`, and `git diff --check`: passed.
- The initial automatic CI unknown-path guard identified the new test file; `043a5c8` registered it under the existing editor-shell risk route, and its focused routing/manifest tests (2 files / 87 tests) passed.
- No manual Full CI, `pnpm verify:project`, or repository-wide historical verifier sweep was run.

This receipt is automated evidence only. The Windows owner must confirm the landscape one-click flow, first auto-play Camera behavior, and live mirror/close/reopen behavior before #653 can be called human-accepted.
