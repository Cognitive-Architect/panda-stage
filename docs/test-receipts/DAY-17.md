# Day 17 — Asset Metadata Extraction + Thumbnail Cache

## Coordinates

- Work order: `B-17/45`
- Branch: `feat/day-17-asset-metadata`
- Baseline SHA: `3d23a1b0c4fbb06d83d973c5d5974888f6ba0fdc`
- Result SHA: recorded after commit
- Result: PASS

## Decisions

- `DECISION-001`: reuse the packaged
  `@ffmpeg-installer/win32-x64@4.1.0` FFmpeg GPLv3 sidecar for asynchronous
  thumbnail decode/scale. No new native module or package was added.
- `DECISION-002`: reuse the packaged
  `@ffprobe-installer/win32-x64@5.1.0` GPL-3.0 sidecar for real audio
  duration; persist `Math.round(durationSeconds * 1000)` only when positive
  and finite.
- `DECISION-003`: cache names are
  `v1-max256-<lowercase-sha256>.png`. Hash changes invalidate by selecting a
  new key; missing/corrupt entries rebuild lazily; the cache can be deleted
  wholesale.
- Thumbnail policy: maximum edge 256 px, aspect ratio retained, no upscale,
  FFmpeg autorotation enabled, RGBA PNG output preserves transparency.
- Image safety: encoded raster dimensions above 40,000,000 pixels produce
  `ASSET_IMAGE_TOO_LARGE` and skip decode.

## Real outputs

| Evidence | Result |
|---|---|
| PNG | 16×12; real 16×12 RGBA PNG thumbnail |
| JPG | 18×14; real 18×14 RGBA PNG thumbnail |
| Bound | real 512×300 PNG → 256×150 `thumbnail-bounded.png` |
| MP3 | 313 ms from FFprobe |
| WAV | 250 ms from FFprobe |
| Cache key | SHA-256 + schema v1 + 256px policy |
| PNG thumbnail | `docs/evidence/day-17/thumbnail-png.png` |
| JPG thumbnail | `docs/evidence/day-17/thumbnail-jpg.png` |
| Machine evidence | `docs/evidence/day-17/results.json` |

The evidence run deleted all external source copies before metadata
extraction. Healthy extraction left every project asset byte hash unchanged.
Deleting the PNG cache regenerated it. An injected cache write failure returned
a warning and the project reopened successfully.

The evidence also persisted asset-specific structured errors for a disguised
PNG and corrupt WAV, reopened the project after both, then proved a
10,000×5,000 PNG header is warned and skipped before decode. Measured healthy
operations were recorded per asset in `results.json`, together with
Main-process RSS. FFmpeg decode runs out of process.

## Automated gates

| Gate | Result | Evidence |
|---|---|---|
| TYPE | PASS | `pnpm typecheck` |
| LINT | PASS | `pnpm lint` |
| FMT | N/A | repository has no Prettier dependency/config; TypeScript style is enforced by ESLint |
| UNIT | PASS | 40 files / 224 tests |
| INTEGRATION | PASS | 6 files / 52 tests |
| BUILD | PASS | `pnpm build` |
| DIST | PASS | NSIS package built; packaged FFmpeg/FFprobe sidecars executed and reported pinned versions |
| M1 | PASS | `pnpm verify:m1` |
| DAY 16 | PASS | `pnpm verify:day16` |
| DAY 17 REAL | PASS | `pnpm verify:day17` |
| ARCH | PASS | media reads/spawn occur only in Main; Preload exposes one validated method |

## Blade table

| ID | Result | Authoritative evidence |
|---|---|---|
| FUNC-001 | PASS | real PNG 16×12 and JPG 18×14 integration/evidence |
| FUNC-002 | PASS | real FFprobe MP3 313 ms and WAV 250 ms |
| FUNC-003 | PASS | real 512×300 PNG produces a 256×150 thumbnail |
| FUNC-004 | PASS | cache file deletion followed by non-hit rebuild |
| CONST-001 | PASS | domain schema requires positive integer milliseconds |
| CONST-002 | PASS | key/path assertions include full SHA-256 |
| CONST-003 | PASS | serialized `project.json` contains no thumbnail/cache path |
| CONST-004 | PASS | before/after SHA-256 for all healthy project assets |
| NEG-001 | PASS | corrupt PNG → `ASSET_METADATA_INVALID_IMAGE` |
| NEG-002 | PASS | corrupt WAV → `ASSET_METADATA_INVALID_AUDIO` |
| NEG-003 | PASS | injected write failure → warning, project still opens |
| NEG-004 | PASS | 50M-pixel header → warning and no decoder invocation |
| UX-001 | PASS | errors contain asset name and project-relative path |
| UX-002 | PASS | IPC result discriminates `ready`, `error`, and warning codes |
| E2E-001 | PASS | import → metadata → atomic save → reopen |
| HIGH-001 | PASS | external source deletion + cache deletion still rebuilds |

## Scope and debt

- No asset grid, waveform, reference deletion, character UI, video import, or
  Renderer file-system access was added.
- `DEBT-PERF-B17-001`: declared, non-blocking. Peak FFmpeg child RSS is not
  sampled directly; Main RSS and elapsed time are recorded. The 40M-pixel
  preflight deterministically prevents oversized inputs from starting decode,
  and normal decode stays in a child process.
- `DEBT-PACKAGING-B17-001`: closed for Day 17. No new dependency was added;
  the NSIS build contains executable FFmpeg/FFprobe sidecars at
  `resources/media/`, and their GPL license obligations remain the baseline.
- Thumbnails are cache only. Their absence never blocks project open.
