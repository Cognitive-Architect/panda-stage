# Issue #1115 — thumbnail diagnostic first slice

- Issue: [#1115](https://github.com/Cognitive-Architect/panda-stage/issues/1115)
- Delivery: existing [Draft PR #1113](https://github.com/Cognitive-Architect/panda-stage/pull/1113), branch `feat/issue-1112-struct05-p1`.
- HEAD_BEFORE: `eb61e1965e5eedffa506a485c6a73abac6c07852`.
- HEAD_AFTER: the commit containing this receipt (recorded explicitly in the Issue delivery comment).
- Scope: Renderer diagnostics only; Main/Preload contracts, decoders, content-hash cache key, atomic cache writes and cache repair remain unchanged.

## Production behavior

`thumbnailStateFromResponse` retains the exact Main `error.code`, `message` and optional `relativePath`, with `failureLayer: 'backend'`. ImageAssetPicker and expression thumbnails expose the details through `title` and inspectable `data-thumbnail-error-code` / `data-thumbnail-failure-layer` attributes. Existing short labels remain, including `源文件缺失` for `ASSET_THUMBNAIL_SOURCE_MISSING`.

The Character Manager and shared Character image hook mark an actual `<img>` error after Main's ready response as `failureLayer: 'renderer-decode'`, code `RENDERER_THUMBNAIL_DECODE_FAILED`. A late decode callback cannot overwrite an existing backend failure. Cache missing/loading states do not acquire a fabricated backend error.

## Bounded Windows Electron evidence — 2026-11-15

Two actual asset records were selected from the existing local `AN06.pandastage` UAT project and copied to a new dedicated acceptance project; no corpus scan or bulk import was performed. Original project JSON and supplied source files were verified unchanged.

- PNG: `蓝2身子`, ID `7b83f589-79b8-4474-8c77-c29257eba705`. Bytes from the default Downloads directory match the UAT record SHA-256 `70731dccd947e2585905f9c0ef25b84b3e4804daa9ffb63e0958ce5af35d36e5`. The real expression image picker renders it ready, with decoded `naturalWidth=192`, `naturalHeight=256`, and no extra diagnostic click.
- FLA-derived failure: `原始人动作 fla-shape-370ef8cc9de8fd2530c3bf73`, ID `b1691434-bf8e-487b-a1f1-0bdb5d2eb676`, SVG SHA-256 `dc88cf63f781ed1beaeb1acb95af5a3eeff6deb6988e5684b81eedb06f245695`. The supplied Downloads `素材包/原始人动作.fla` SHA-256 `43aa8958e752c006c00ba177831af5c3a060985dc8796d8d17dc44f290c575a9` matches the imported Graphic Definition that references this asset.
- Exact production Main response, preserved in the Renderer and after closing/reopening the picker:

```json
{
  "code": "ASSET_THUMBNAIL_READ_FAILED",
  "message": "无法读取缩略图：无法解码图片“原始人动作-shape-fla-shape-370ef8cc9de8fd2530c3bf73.svg”并生成缩略图。",
  "relativePath": "assets/原始人动作-shape-fla-shape-370ef8cc9de8fd2530c3bf73.svg"
}
```

The real failure is in the Main thumbnail generation/read path. It is not evidence that the original FLA or SVG is corrupt. The UI still displays only `缩略图加载失败`; its title contains the exact code/message/path.

A separate controlled native `<img>` decode fault was injected into the already-ready PNG element. Its real React error handler produced `renderer-decode` / `RENDERER_THUMBNAIL_DECODE_FAILED`, without claiming backend READ_FAILED. This controlled fault is separate from the actual FLA failure.

Local evidence directory: `D:\PandaStage-Acceptance\issue1115-runtime-1794735202480\`. It contains `result.json`, `real-backend-and-png-control.png`, `controlled-renderer-decode.png` and the two-asset acceptance project. Runner: `D:\PandaStage-Acceptance\issue1115-runtime.cjs`. No owner media is committed to the repository. Native automation and inspected screenshots are not OWNER human acceptance.

## Validation

- Focused unit/UI checks: 4 files / 24 tests PASS, including all six Main error codes, short UI labels, picker reopen, actual React img error callbacks, shared hook and ready/cache controls.
- `pnpm test:unit` PASS: 423 files / 3440 tests.
- `pnpm build` PASS, including `pnpm typecheck`.
- `pnpm lint` PASS.
- `git diff --check` PASS.
- Natural CI is recorded in the Issue delivery comment once available. No manual Full CI or repository verifier sweep.

## Stop decision

The real sample now reports exact READ_FAILED. Per #1115, this slice stops at diagnosis. Second-slice recommendation: evaluate **nativeImage → FFmpeg fallback** for this READ_FAILED case in a separately authorized change. No decoder fallback is implemented here. PR #1113 stays Draft; OWNER retains Ready/Merge and human acceptance authority.
