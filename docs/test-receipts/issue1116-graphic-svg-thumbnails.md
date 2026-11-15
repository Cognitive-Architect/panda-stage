# Issue #1116 — generated FLA SVG picker route

- Issue: [#1116](https://github.com/Cognitive-Architect/panda-stage/issues/1116).
- Existing mother [Draft PR #1113](https://github.com/Cognitive-Architect/panda-stage/pull/1113); branch `feat/issue-1112-struct05-p1`.
- HEAD_BEFORE: `f7f432c2582667fa8846e9f6ec7c51fd09fff676`.
- HEAD_AFTER: the commit containing this receipt; its full SHA is recorded in the Issue delivery comment.
- Implements the updated Issue and [v2 research](../research/thumbnail-pipeline-v2-svg-routing.md). The earlier uncommitted SVG data URL experiment was removed.

## Production delta

The generated-FLA-SVG identity expression was moved unchanged from `AssetCanvasImageService` into one shared selector. Both Main and the card adapter require `image/svg+xml` and either `flaGraphicFrame` or a formal `fla-graphic` structure reference with `opaque + shape + fallbackScope=subtree + fallbackAssetId`. No name/path heuristic grants SVG ownership.

Character Manager and the shared Character/avatar thumbnail hook route these assets through the existing `readCanvasImage` API and `CanvasImageResourceSession`: checked bytes → Blob with the returned MIME → ObjectURL → HTMLImageElement. Card `<img>` elements reuse that session's decoded source URL. The existing session owns in-flight deduplication, hash/context reconciliation and URL revocation. Its implementation is unchanged.

Main keeps the existing path, size, safe-generated-SVG and actual-content-hash checks. For generated SVGs only, a missing source now returns `ASSET_CANVAS_IMAGE_SOURCE_MISSING`, with the relative project path; other generated SVG read/hash errors also retain the path. The existing resolver's lexical/realpath containment checks still precede source reading. PNG/JPEG Canvas error behavior is unchanged.

The adapter preserves exact Canvas backend codes, messages and relative paths in the #1115 thumbnail diagnostics. A Main-ready image that fails decoding remains `renderer-decode / RENDERER_THUMBNAIL_DECODE_FAILED`. Source missing still displays `源文件缺失`.

`AssetThumbnailService`, `ThumbnailService`, FFmpeg generation, `CacheService`, PNG cache keys/schema, `PngThumbnailValidator`, and the PNG-only thumbnail data URL contract are unchanged. No SVG rasterizer, nativeImage fallback, new dependency, persistent raster alias or generic MIME router was introduced.

## Bounded Windows Electron evidence — 2026-11-15

Original source: local `AN06.pandastage`. Only the requested actual Shape, the actual frame asset needed by its Definition, and the PNG control were copied into a dedicated acceptance project. The bounded fixture retains the original Shape node/reference, frame metadata and source identities; unrelated structure nodes are omitted. No `flaGraphicFrame` field was added to the Shape. Original project JSON and downloaded FLA/PNG bytes were verified unchanged.

The supplied `Downloads/素材包/原始人动作.fla` matches the imported Definition source SHA-256 `43aa8958e752c006c00ba177831af5c3a060985dc8796d8d17dc44f290c575a9`.

| Sample | Before | After in the real expression ImageAssetPicker |
| --- | --- | --- |
| `原始人动作 fla-shape-370ef8cc9de8fd2530c3bf73`, ID `b1691434-bf8e-487b-a1f1-0bdb5d2eb676` | #1115 exact `ASSET_THUMBNAIL_READ_FAILED` | Canvas Image ready; `blob:` SVG; decoded 177×242; 15832 painted pixels. Blob bytes match original SHA-256 `dc88cf63f781ed1beaeb1acb95af5a3eeff6deb6988e5684b81eedb06f245695`. |
| Original Graphic frame ID `99a868ab-8e5b-48d6-bcf8-c6bdef78d4f3` | Internal frame SVG | Canvas Image ready; `blob:` SVG; decoded 252×448; 75995 painted pixels; original source hash preserved. |
| `蓝2身子`, ID `7b83f589-79b8-4474-8c77-c29257eba705` | PNG ready | Existing thumbnail API and PNG data URL; decoded 192×256; actual PNG still invokes FFmpeg. |

The real IPC trace contains SVG reads through `asset-canvas-image:read` and the PNG through `asset-thumbnail:read`. The observed FFmpeg invocations contain only the PNG source, with zero SVG input. Closing/reopening the picker preserves the preview and creates no new SVG ObjectURL. Switching out of the Character drawer revokes both SVG URLs (2 created, 2 revoked).

Local evidence: `D:\PandaStage-Acceptance\issue1116-runtime-1794740169931\result.json` and `shape-and-png-after.png`. Runner: `D:\PandaStage-Acceptance\issue1116-runtime.cjs`. The native run exits 0. Owner media is not committed. Native automation and inspected screenshots are not OWNER human acceptance.

## Validation

- Focused unit/UI: 7 files / 57 tests PASS. Coverage includes frame/Shape identity, unowned SVG rejection, paths/hash/size, existing safe-SVG rejection (script/foreignObject/external href), accepted internal references/embedded PNG, backend diagnostics, ready/decode separation, stable resource reuse, hash/context release, late responses and unmount revoke. Existing raster/cache and Canvas session tests also pass.
- Focused disk integration: 2 tests PASS, reopening both frame and Shape through fresh project/Canvas Image services without modifying project JSON.
- `pnpm build` PASS, including typecheck; `pnpm lint` PASS; `git diff --check` PASS.
- `pnpm test:unit` PASS: 425 files / 3457 tests. `pnpm test:integration` PASS: 47 files / 218 passed, 1 skipped.
- Natural CI is recorded in the Issue delivery comment after completion. No manual Full CI or repository verifier sweep.

PR #1113 stays Draft. OWNER retains human acceptance and Ready/Merge authority.
