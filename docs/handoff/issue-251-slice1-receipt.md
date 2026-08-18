# Issue #251 — FLA V1 Slice 1 delivery receipt

Status: Draft PR / Open / Unmerged. Human Windows Electron acceptance and maintainer review remain pending.

- Issue: [#251](https://github.com/Cognitive-Architect/panda-stage/issues/251)
- Draft PR: [#252](https://github.com/Cognitive-Architect/panda-stage/pull/252)
- Base: `main` at `66ce42ab47c4829515385adca4af58b65aef7134`
- Implementation branch: `agent/issue-251-fla-v1-slice1`
- Implementation HEAD: `108bc0feb8262d5fbfd97a48897afbb35fe658d1`
- Parser source pin: [`lifeart/fla-viewer@048000cc`](https://github.com/lifeart/fla-viewer/tree/048000ccab67469980b8dedd1fc2b65a02d2b164)

## Delivered boundary

The implementation adds a Panda-owned `AnimationImportIR` and strict shared
schemas. The Main process owns source selection, bounded preflight, the
ephemeral parser window, timeout/watchdog/cancel/crash handling, and a bounded
in-memory read-only inspection session. The renderer receives only sanitized
metadata, compatibility entries, deterministic media IDs, and Panda-owned
bounded PNG `Uint8Array` payloads. No Project or Asset API is called and no
archive path becomes a Project path.

The only production renderer import of parser runtime/types is the adapter at
`src/renderer/fla-import/fla-viewer-adapter.ts`. The pinned upstream closure is
kept under `src/renderer/fla-import/parser-core/` and consists of exactly:

`adpcm-decoder.ts`, `binary-fla-parser.ts`, `binary-fla-structure.ts`,
`binary-instance-decoder.ts`, `binary-shape-decoder.ts`,
`binary-timeline-decoder.ts`, `edge-decoder.ts`, `fla-parser.ts`,
`flv-parser.ts`, `ole2-reader.ts`, `path-utils.ts`, and `types.ts`.

The closure is byte-for-byte identical to the pinned source after the single
Panda build-compatibility preamble (`@ts-nocheck`); no parser logic was changed.
The preamble is excluded from normal linting so the upstream closure is not
rewritten as local cleanup.

## Limits and containment

The enforced limits are: source 256 MiB; 20,000 ZIP entries; 1 GiB expanded
archive; 64 MiB per entry; 32 MiB XML; 2,048 media; 4096×4096 and 16,777,216
pixels per image; 128,000,000 total decoded pixels; 512 MiB total RGBA;
30-second parser wall time; 5-second no-progress watchdog; 2-second cancel
grace; and recursion depth 64.

The worker BrowserWindow uses `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`, `webviewTag: false`, a unique session partition,
network denial, and navigation/window-open denial. ActionScript is detected
and reported as unsupported; it is never executed. Unsupported Slice 1
features (including vector shape, symbol/movie-clip, video, text, and
ActionScript semantics) are represented in compatibility entries rather than
silently treated as exact.

Stable error codes are declared in `src/shared/fla-import-api.ts`, including
`UNSUPPORTED_FLA_CONTAINER`, `ARCHIVE_LIMIT_EXCEEDED`, `MALFORMED_ARCHIVE`,
`MALFORMED_XFL`, `XML_LIMIT_EXCEEDED`, `PARSER_TIMEOUT`, `PARSER_CRASH`,
`MEDIA_LIMIT_EXCEEDED`, `MEDIA_DECODE_FAILED`,
`UNSUPPORTED_FEATURE_PRESENT`, and `USER_CANCELLED`.

## Third-party notice

The exact runtime parser dependencies are:

- `jszip@3.10.1` — `MIT OR GPL-3.0-or-later`
- `pako@1.0.11` — `MIT AND Zlib`

The closure's transitive notice set carried from the authorized #250 audit is:
`lie@3.3` (MIT), `immediate@3.0.6` (MIT), `readable-stream@2.3.8` (MIT),
`core-util-is@1.0.3` (MIT), `inherits@2.0.4` (ISC), `isarray@1.0.0` (MIT;
package has no license file), `process-nextick-args@2.0.1` (MIT),
`safe-buffer@5.1.2` (MIT), `string_decoder@1.1.1` (MIT),
`util-deprecate@1.0.2` (MIT), and `setimmediate@1.0.5` (MIT).

This receipt preserves the maintainer-authorized `LICENSE_INTENT_ONLY` status
from #250; it is not a new legal clearance or a license-history claim.

## Validation evidence

Commands completed on Windows:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:unit` — 118 files, 861 tests passed
- `pnpm test:integration` — 26 files, 147 tests passed
- `pnpm build`
- `pnpm exec electron scripts/verify-issue251-slice1.cjs`

The real sample was `D:\表情合集\文件.fla` with SHA-256
`84682edcd49b8fcc072ae740188677bae9d7d0fd603b8bed51a7ac4ddeb3119f` before
and after inspection. The verifier observed:

- document 1920×1080 at 30 fps;
- 158 media identities, with 158/158 valid PNG payload signatures;
- 156 placed instances and 2 library-only media;
- transparent pixels preserved in the encoded payload;
- JPEG-origin media preserved as `sourceFormat: jpg` with Panda-owned PNG bytes;
- parser window count 0 after successful inspection and 0 after cancellation;
- cancellation response `USER_CANCELLED` after the worker was observed; and
- no Project was opened and no Project/Asset API was called.

The bounded JSON evidence is also written by the verifier to
`D:\PandaStage-Acceptance\issue-251-slice1\real-sample-electron.json`.
Chromium cache-permission messages emitted by the isolated test process are
environment warnings; the verifier exited successfully.

## Human acceptance handoff

After `pnpm build`, start `pnpm dev:renderer` in one PowerShell window. In a
second PowerShell window, run:

```powershell
$env:VITE_DEV_SERVER_URL = 'http://localhost:5173/?debug=1'
pnpm exec electron dist-electron/main/index.js
```

Then use **Choose FLA and inspect** in the FLA V1 Slice 1 panel.
Select the real sample, confirm the summary and compatibility entries, verify
that the current Project/Asset state is unchanged, and exercise **Cancel
inspection** while the isolated parser window is visible. This slice is
inspection-only: it intentionally has no final import-selection UI and does
not write a Project or Asset.

Do not merge, mark Ready, or close Issue #251 from this receipt.
