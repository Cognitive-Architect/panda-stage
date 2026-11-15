# Panda Stage 缩略图链路专项调研 v2：真实 SVG 故障后的源码级复查

> 日期：2026-11-15
>
> 基线：Draft PR #1113 / HEAD `a8f053fb4326f3f9a6b3408fb55f8fcbebbdb59c`
>
> 目的：在 #1115 真机诊断已经拿到真实失败证据后，重新检查 Panda 自己的现有能力，并补充 KDE / GNOME / Penpot / Excalidraw / draw.io / VS Code 等开源实现，修正旧报告里“READ_FAILED 后优先考虑 nativeImage”的泛化判断。

## 0. 结论先行

这轮最大的结论不是“再找到一个 SVG decoder”，而是发现 **Panda 自己已经有一条可复用的安全 SVG 资源链**：

`AssetCanvasImageService -> Uint8Array + mimeType -> Blob -> ObjectURL -> HTMLImageElement`

这条链已经支持 `image/svg+xml`，并且对 Panda 生成的 FLA SVG 做了更严格的安全校验、尺寸/哈希校验和资源生命周期管理。

因此 #1116 的最佳方向应从“新增 SVG data URL 通道”进一步收敛为：

**FLA Graphic SVG 缩略图复用现有 Canvas Image 安全读取/解码语义；PNG/JPEG 继续走 ThumbnailService。**

外部成熟项目也给出高度一致的架构答案：

- KDE KIO：按 MIME 类型选择专用 thumbnail creator，SVG 有独立 `SvgCreator`；
- GNOME：thumbnail factory 按 MIME 选择 thumbnailer，并有通用 fallback 与失败缓存；
- Penpot：矢量文档缩略图直接调用自己的渲染器 / WASM / OffscreenCanvas，而不是塞给通用图片 decoder；
- draw.io / VS Code：对内部可控 SVG 广泛直接使用 `data:image/svg+xml`；
- Electron `nativeImage`：官方跨平台格式仍主要是 PNG/JPEG，不是 SVG 解法。

所以新的核心原则是：

> **缩略图 owner 可以统一，但 decoder / renderer 不应该统一。按资产 MIME / 语义选择现成渲染路径。**

---

## 1. v1 报告哪些结论仍然成立，哪些已经被真机证据推翻

### 1.1 仍然成立

旧报告对 Panda 基础架构的判断是正确的：

- `CacheService` 已经是 content-hash keyed；
- 写缓存已有 temp + sync + rename；
- 同 target 写入有 `activeWrites` 去重；
- `PngThumbnailValidator` 对 Panda-owned cache 做严格校验；
- 坏 cache 会删掉并尝试重建；
- LightCraft 值得借的是“源内容、派生缓存、失败层分开”，而不是整套照搬。

这些都不需要推倒重来。

### 1.2 #1115 已经证伪的旧假设

旧报告当时只看到“一批原始人动作缩略图失败”，因此把“某批旧 FLA 派生 PNG 被 FFmpeg 解码失败”列为重要候选，并提出：如果最终拿到 `READ_FAILED`，再试 `nativeImage -> FFmpeg`。

#1115 真机以后，这个假设已经过期：

- 正常对照「蓝2身子」PNG：ready；
- 真实失败 code：`ASSET_THUMBNAIL_READ_FAILED`；
- 真实失败文件：`assets/原始人动作-shape-...svg`；
- Main/backend 已经失败，Renderer `<img>` decode 不是根因；
- Natural CI #1692 SUCCESS。

因此这不是“普通 PNG/JPEG decoder 只有 FFmpeg 一条腿”导致的当前故障，而是：

**Panda 正式生产 `image/svg+xml` ImageAsset，但 thumbnail pipeline 没有按格式分流，仍把 SVG 送进 FFmpeg raster thumbnail 路径。**

---

## 2. Panda 自己其实已经有 SVG 轮子

### 2.1 领域模型：FLA Graphic frame 天生就是 SVG

`src/domain/models/asset.ts` 明确要求：

- `flaGraphicFrame` 必须是 `image/svg+xml`；
- 必须有 SHA-256。

也就是说 SVG 不是“边缘异常素材”，而是当前元件产品路线的正式资产格式。

### 2.2 写盘前已经做安全验证

`FlaGraphicInstanceCommitService` 在正式提交每个 Graphic frame 之前会：

- 验证 UTF-8 SVG bytes；
- 校验 byteLength 与 SHA；
- 调用 `isSafeGeneratedFlaSvg()`；
- 检查单文件大小上限；
- 再原子写入 `assets/*.svg`。

所以这些 SVG 不是任意用户上传 XML，而是 Panda 生成、校验、哈希后持久化的内部视觉资产。

### 2.3 SVG 本身是 self-contained

`fla-static-snapshot-svg-builder.ts` 对 bitmap 依赖会内嵌为：

`<image ... href="data:image/png;base64,..." />`

其余引用使用内部 `#id`，最终输出单个 `<svg>`。

因此当前 FLA Graphic SVG 不依赖任意磁盘相对路径或网络资源即可显示。

### 2.4 更关键：Canvas Image 链已经正式支持这些 SVG

`AssetCanvasImageService` 已经识别：

- `image/png`；
- `image/jpeg`；
- Panda generated `image/svg+xml`。

对 generated FLA SVG，它还会重新调用 `isSafeGeneratedFlaSvg()`，然后校验真实文件 SHA，再返回：

- `mimeType`；
- `width / height`；
- `byteLength`；
- 原始 `bytes`。

Renderer 的 `CanvasImageResourceSession` 已经完成下一半：

`bytes -> new Blob({ type: mimeType }) -> URL.createObjectURL() -> new Image()`

并且具备：

- `assetId + sha` 资源身份；
- in-flight 去重；
- asset/hash/context 变化时重新读取；
- 旧 ObjectURL 回收；
- `onload / onerror` 分层；
- session dispose 时 revoke。

### 新结论

**#1116 最值得复用的轮子不是新库，而是 Panda 自己已经产品化的 Canvas Image SVG 路径。**

---

## 3. 新增开源源码对照

### 3.1 KDE KIO：SVG 就应该有 SVG 专用 thumbnailer

仓库：`KDE/kio-extras`，调查 revision：`df5f6be239070df2bc073e18e234631fbcf5c42d`。

关键文件：

- `thumbnail/svgcreator.cpp`
- `thumbnail/svgthumbnail.json`
- `thumbnail/CMakeLists.txt`

KDE 没有把 SVG 和 JPEG、EXR、Krita、OpenDocument 全塞进一个通用 generator。

`svgthumbnail.json` 直接声明：

- MIME：`image/svg+xml` / `image/svg+xml-compressed`；
- `CacheThumbnail: true`。

`SvgCreator` 则使用 `QSvgRenderer`：

1. 验证 SVG 是否可渲染；
2. 按 target size 保持宽高比；
3. 创建透明 QImage；
4. 专门渲染 SVG；
5. 返回统一 ThumbnailResult。

而且 KDE 还给 `svgthumbnail` 接了 fuzz target。

**值得 Panda 抄的不是 Qt 代码，而是 MIME-aware routing：SVG 资产进入 SVG renderer，统一 thumbnail owner 负责缓存和错误。**

源码：
- https://github.com/KDE/kio-extras/blob/df5f6be239070df2bc073e18e234631fbcf5c42d/thumbnail/svgcreator.cpp
- https://github.com/KDE/kio-extras/blob/df5f6be239070df2bc073e18e234631fbcf5c42d/thumbnail/svgthumbnail.json

### 3.2 GNOME：MIME thumbnailer + generic fallback + failed-thumbnail cache

仓库：`GNOME/gnome-desktop`，revision：`2e9bf76aad453b02e93ae05bca92d04575f6e7d4`。

`GnomeDesktopThumbnailFactory` 的职责非常明确：

- 根据 content type 找合适 thumbnailer；
- 专用 thumbnailer 失败后，可以尝试 gdk-pixbuf fallback；
- 成功 thumbnail 进入统一 cache；
- 失败也会写 fail cache；
- 源文件 mtime 改变后，成功/失败缓存都会失效并重新判断。

这带来两个对 Panda 有价值的结论：

1. **格式路由应该发生在 thumbnail owner 内，而不是要求一个 decoder 吃所有格式。**
2. 如果未来真的存在“同一个坏源每次打开 Picker 都重新拉一次昂贵 decoder”的问题，可借 GNOME 做按 content identity 失效的 failed-thumbnail cache；但这属于 V2，不是 #1116 必做。

源码：
- https://github.com/GNOME/gnome-desktop/blob/2e9bf76aad453b02e93ae05bca92d04575f6e7d4/libgnome-desktop/gnome-desktop-thumbnail.c

### 3.3 Penpot：矢量文档预览优先走领域 renderer

仓库：`penpot/penpot`，revision：`dc340f74af935e6aaa9a1d730a5b0f5d624bf647`。

Penpot 的 thumbnail worker 不把设计稿先伪装成普通图片交给通用 decoder，而是：

- 选择 thumbnail frame / 可见对象；
- 用 WASM renderer 初始化 OffscreenCanvas；
- 用领域模型算 viewport；
- render-sync；
- 最后才把 canvas 输出为缩略图 blob。

这与 Panda Graphic 的正确方向高度一致：

> **既然系统已经理解这种矢量对象，就优先复用自己的正式视觉 renderer / resource path，而不是绕一圈交给 FFmpeg 猜格式。**

源码：
- https://github.com/penpot/penpot/blob/dc340f74af935e6aaa9a1d730a5b0f5d624bf647/frontend/src/app/worker/thumbnails.cljs

### 3.4 draw.io / VS Code：内部可控 SVG 直接作为浏览器 image resource 是成熟做法

draw.io 多处直接使用 `data:image/svg+xml` 作为 image source；VS Code 也大量把内部生成的 SVG data URI 用于图标、mask、canvas/image decode 测试。

这说明“让 Chromium 直接显示内部 SVG image resource”本身不是野路子。

参考：
- https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/src/main/webapp/mxgraph/src/util/mxImageBundle.js
- https://github.com/microsoft/vscode/blob/3ea3ca1d231cae6826355b86b03635ebf0d93068/src/vs/workbench/contrib/notebook/browser/view/renderers/webviewPreloads.ts

不过 Panda **不必因此选择 data URL**，因为项目内部已经有更好的 `Blob + ObjectURL` 路径。

### 3.5 Electron / Web 平台边界

Electron 官方 `nativeImage` 当前跨平台明确支持 PNG/JPEG，Windows 额外支持 ICO；没有把 SVG 列为跨平台 nativeImage 输入格式。

因此 `nativeImage` 仍可以作为未来 raster PNG/JPEG 的成熟备用 decoder，但**不能再被写成 #1116 的 SVG 主方案**。

另一方面，浏览器 `<img>` 原生支持 SVG。MDN 对 SVG image context 还明确说明：

- JavaScript 禁止执行；
- 外部资源不能加载（内联 data URI 可用）；
- SVG 作为 image 时处于非交互、安全模式。

Panda 的 `isSafeGeneratedFlaSvg()` 又进一步禁止：

- DOCTYPE / ENTITY；
- script；
- foreignObject / iframe / object / embed；
- inline event handler；
- javascript:；
- 非 `#internal` 或 `data:image/png;base64` 的 href。

所以对 **Panda-generated SVG** 使用 `<img>` / Blob ObjectURL 具有双层约束：浏览器 image sandbox + Panda 自己的生成/校验合同。

平台文档：
- https://www.electronjs.org/docs/latest/api/native-image
- https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image

---

## 4. 方案重新排序

| 方案 | 复用度 | 风险 | 评价 |
|---|---:|---:|---|
| 所有 SVG 继续交 FFmpeg | 低 | 高 | 已被真实样本证明失败 |
| SVG -> nativeImage -> FFmpeg | 低 | 高 | nativeImage 官方不承诺 SVG，方向错误 |
| Thumbnail API 新增 SVG base64 data URL | 中 | 中 | 能做，但有 4/3 base64 膨胀、8.5MB schema 上限，并重复已有资源链 |
| 新引入 sharp/resvg/librsvg rasterize | 低 | 中 | 能做但当前明显过度工程 |
| **复用 AssetCanvasImageService + Blob/ObjectURL 语义** | **最高** | **低** | **当前推荐** |

### 为什么 Blob/ObjectURL 比新 data URL 更合适

当前 `AssetThumbnailReadResponse` 的 ready contract 只接受 `data:image/png;base64,...`，最大约 8.5MB。

而现有 Canvas Image API 已经：

- 允许 `image/svg+xml`；
- 用 Uint8Array 传输；
- 最大 64MB；
- Renderer 用 Blob/ObjectURL，不需要 base64；
- 已管理 revoke 生命周期。

所以直接扩 thumbnail API 为“大 SVG data URL”虽然能快速跑通，但等于绕开自己已有的成熟轮子。

---

## 5. 对 #1116 的更新建议

当前 #1116 的产品目标不需要改：**FLA Graphic SVG 缩略图要恢复显示，PNG 路线不回归。**

但实现优先级应更新为：

### 推荐 V1

1. 识别 `asset.flaGraphicFrame && asset.mimeType === 'image/svg+xml'`。
2. 复用现有 Canvas Image 的 source validation / SHA / safe-generated-SVG 语义读取 SVG bytes。
3. Renderer 继续使用现有 Blob/ObjectURL + `<img>` 解码模式。
4. 只为 Picker/thumbnail surface 建立最小资源 owner；优先复用 `CanvasImageResourceSession` 或抽一个极小的通用 Blob image resource helper。
5. PNG/JPEG 仍走 `readThumbnail()` / FFmpeg / PNG cache，不改变。

### 如果直接复用 CanvasImageResourceSession 造成耦合太大

允许做一个薄适配，但必须继续复用：

- `isSafeGeneratedFlaSvg()`；
- 现有 project/asset/hash/path 校验；
- `Blob(bytes, { type: mimeType }) + URL.createObjectURL()`；
- object URL revoke 生命周期。

不要复制一份新的 SVG security parser。

### 不建议作为第一实现

- 把 64MB SVG base64 塞进 thumbnail `dataUrl`；
- 新建 SVG rasterizer；
- 改 CacheService 让 SVG 也强制生成 PNG；
- 为了一个 SVG 问题改全部 ImageAsset decoder。

---

## 6. 新版最小验收矩阵

### 必测 1：真实失败 SVG

`原始人动作 fla-shape-370ef8cc9de8fd2530c3bf73`

- before：`ASSET_THUMBNAIL_READ_FAILED`；
- after：Picker 直接看到真实 Shape/人脸预览；
- 关闭 Picker、重新打开仍正常。

### 必测 2：PNG 正常对照

`蓝2身子`

- 继续走 raster thumbnail；
- 行为、尺寸、错误层均不回归。

### 必测 3：安全边界

至少覆盖：

- SVG hash mismatch -> 继续拒绝；
- 脚本/foreignObject/外部 href -> `isSafeGeneratedFlaSvg()` 拒绝；
- 正常内部 `#ref` + 内嵌 PNG -> 正常显示。

### 必测 4：资源生命周期

- 相同 asset+sha 不重复创建无限资源；
- asset/hash/context 改变后旧 ObjectURL 可回收；
- unmount / session dispose 后 revoke。

不需要：

- 4,409 全量素材扫描；
- 新数据库；
- LRU 重构；
- 人工 Full CI；
- 海量截图。

---

## 7. V2 才值得考虑的能力

### 7.1 MIME-aware thumbnail router

如果以后还出现 GIF、WebP、SVGZ、特殊文档等类型，可以借 KDE/GNOME 把 thumbnail owner 正式做成：

`mime/asset semantic -> creator`

但现在只需要一条 SVG bounded route，不提前造 plugin framework。

### 7.2 Failed-thumbnail cache

如果未来确认坏素材每次打开 Picker 都重复启动昂贵处理，可借 GNOME：

- 失败结果按 content identity 缓存；
- source hash/mtime 变化后自动失效；
- 避免同一个确定失败的 source 不断重试。

当前 #1115 已经能精确显示错误，所以这个优化并不紧急。

### 7.3 大素材库调度

继续保留旧报告关于 LightCraft 的结论：只有在可见候选明显造成抖动时，再考虑小并发池、LRU、worker、过期任务取消。

---

## 8. 最终判断

v1 报告的核心方法论——**先诊断，再复用成熟轮子，不重写缩略图系统**——被 #1115 证明是对的。

但真实证据让“轮子”发生了变化：

**旧判断：** READ_FAILED -> 先考虑 Electron nativeImage。

**新判断：** 先看 MIME / asset semantic；本次是 Panda-generated SVG -> 复用现有 Canvas Image SVG resource path。

这次新增开源调查又进一步支持这个方向：KDE、GNOME、Penpot 都没有要求一个通用 decoder 吃所有格式，而是根据 MIME/领域对象分流到专门的 thumbnail/render path。

所以 Panda 当前最小正确架构可以收敛成：

```text
ImageAsset
  |
  +-- PNG/JPEG
  |     -> AssetThumbnailService
  |     -> existing cache
  |     -> FFmpeg (future raster fallback can reconsider nativeImage)
  |
  +-- Panda-generated FLA SVG
        -> existing safe Canvas Image read semantics
        -> bytes + image/svg+xml
        -> Blob/ObjectURL
        -> Chromium <img>
```

用做饭比喻：v1 只知道“这批菜在切菜机里卡住了”，所以准备找第二台切菜机；#1115 把袋子拆开后才发现里面压根不是土豆，是一叠面皮。现在最合理的不是再买一台更贵的切菜机，而是把面皮送去我们厨房里**本来就有的蒸笼**。🤣

---

## Sources / revisions

- Panda Stage PR #1113 HEAD `a8f053fb4326f3f9a6b3408fb55f8fcbebbdb59c`
- Issue #1115: https://github.com/Cognitive-Architect/panda-stage/issues/1115
- Issue #1116: https://github.com/Cognitive-Architect/panda-stage/issues/1116
- KDE kio-extras `df5f6be239070df2bc073e18e234631fbcf5c42d`
- GNOME gnome-desktop `2e9bf76aad453b02e93ae05bca92d04575f6e7d4`
- Penpot `dc340f74af935e6aaa9a1d730a5b0f5d624bf647`
- Excalidraw `3a317b55f508815d10a4c12acca99df30f026521`
- draw.io `c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3`
- Electron nativeImage docs: https://www.electronjs.org/docs/latest/api/native-image
- MDN SVG as an image: https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image
