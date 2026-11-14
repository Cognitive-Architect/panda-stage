# CI-LEAN-02 bounded inventory

Scope: the eight aggregators at START_HEAD
`8778d28bd307c7b0caf02017159fba96fe448cc6` and their direct children only.
No whole-script-directory or historical Issue audit was performed.

| Command | KEEP TEST | KEEP MANUAL | RETIRE | Reason |
| --- | --- | --- | --- | --- |
| `pnpm test:unit` | yes | | | Existing Vitest unit + contract entry; unchanged business coverage. |
| `pnpm test:integration` | yes | | | Existing formal integration entry; retained once in Core. |
| `verify:project` | | | yes | Historical multi-diagnostic wrapper with repeated builds. |
| `verify:assets` | | | yes | Historical wrapper repeating build/integration. |
| `verify:character` | | | yes | Redundant alias for the day19 diagnostic. |
| `verify:shot` | | | yes | Bundles Shot acceptance scenarios. |
| `verify:canvas` | | | yes | Historical multi-diagnostic wrapper repeating build/integration. |
| `verify:history` | | | yes | Redundant alias for the day24 diagnostic. |
| `verify:editor` | | | yes | Historical editor acceptance bundle. |
| `verify:timeline` | | | yes | Historical timeline acceptance bundle. |
| `verify:day13` | | yes | | Real Electron IPC/project lifecycle. |
| `verify:day14` | | yes | | Native close decisions and recovery UI. |
| `verify:m1` | | yes | | Real Unicode filesystem, atomic-save faults, recovery, relocation and close outcomes. |
| `verify:issue73` | | yes | | Dirty project switching in Electron. |
| `verify:issue76` | | yes | | Creation, product preview and recovery runtime. |
| `verify:issue102-task1` | | yes | | Project Center startup and lazy editor loading. |
| `verify:issue102-task3` | | yes | | Dirty/revision roundtrip and project switching runtime. |
| `verify:day16` | | yes | | Asset import runtime and filesystem integration. |
| `verify:day17` | | yes | | Actual packaged FFmpeg/FFprobe, thumbnails, media hashes and failure paths. |
| `verify:day18` | | yes | | Heavy resource library UI interactions. |
| `verify:issue396-stage-d` | | yes | | Zero-raster FLA workbench, stale target invalidation and explicit commit. |
| `verify:day19` | | yes | | Character composition in Electron. |
| `verify:day20` | | yes | | Shot management in Electron. |
| `electron scripts/verify-issue608-shot-thumbnail.cjs` | | yes | | Production thumbnail pixels and read-only revision checks; existing alias `verify:issue608-shot-thumbnail`. |
| `verify:day21` | | yes | | Real Canvas rendering and editing. |
| `verify:day22` | | yes | | Selection and transform runtime. |
| `verify:day23` | | yes | | Layer controls; its existing body also runs verify-issue47.cjs. |
| `verify:issue579` | | yes | | Live scrub, zero/nonzero time and blur-race write guard. |
| `verify:issue602` | | yes | | Composite Body/Face rendered pixels and shared selection. |
| `verify:issue606` | | yes | | Atomic product preview, readiness and fallback runtime. |
| `verify:day24` | | yes | | History gestures and lifecycle in Electron. |
| `verify:issue102-task2` | | yes | | Clean/dirty editor shell lifecycle. |
| `verify:issue102-task4` | | yes | | Editor core actions in Electron. |
| `verify:issue109-resource-workspace` | | yes | | Real workspace layout, focus and touch. |
| `verify:issue197` | | yes | | Timeline collapse and DOM layout. |
| `verify:issue199` | | yes | | Timeline seek/scrub geometry. |
| `verify:issue207` | | yes | | Empty timeline runtime gate. |

All 27 direct diagnostic items retain their concrete scripts and existing
narrow aliases. Their real runtime/filesystem/media assertions justify manual
use; none is merely a replacement for a removed Core test. No assertion needs
migration because no concrete diagnostic file is deleted. Nine manual aliases
no longer prepend the entire integration suite; they retain the build needed
for dist-electron/runtime imports. This does not claim all historical scripts
are current or rerun: use a specific diagnostic only when the active feature
requires it, and record its result in that Issue.

For example, `pnpm verify:day17` builds and runs the media diagnostic locally.
The existing thumbnail alias similarly provides its build prerequisite.
These commands are outside daily CI and merge gates. The standard test
entries remain registered by [vitest.config.ts](../../vitest.config.ts) and
[vitest.integration.config.ts](../../vitest.integration.config.ts); their
commands and test assets are unchanged.

The eight package aliases and matching ledger rows are deleted. Full CI had
no independent heavy task beyond Core plus those aggregators, so
`.github/workflows/full-ci.yml` is deleted. Suite selection code, metadata and
contracts are removed; the command ledger remains for its real consumers.
