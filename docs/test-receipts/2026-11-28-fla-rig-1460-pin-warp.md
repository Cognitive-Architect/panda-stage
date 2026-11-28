# FLA-RIG 1460 回执（R-D / R06 位图控制点变形独立小样）

> 依据 #1460（父 #1447，优先级 7 / R-D），分支 `feat/1460-rd`，基线为集成 HEAD `336a8df`。
> 本票只交付"单片位图袖子/辫子"范围的独立小样；**不声称**完整 AN Asset Warp、全身绑定或产品化。

## 结论

- **已实现**：普通位图图层的控制点网格（`pinWarp` 可选字段）、两姿态及任意帧插值、画布拖动控制点、Canvas 2D 分片仿射贴图，且编辑画布 / 预览 / 导出共用同一个正式求值产出的 mesh。
- **未实现（明确边界）**：仅支持 `source.kind === 'asset'` 的普通位图内容图层；背景、角色、FLA Graphic、视频、蒙皮/骨树/物理、AN 导入、软边/alpha 变形均不在本票范围，遇到时局部降级为原图。
- Schema 仍 **v47**，仅新增可选字段，无迁移、无新 npm 依赖、无第二场景树/新运行时；未推送、未开 PR、未合并、未关票。
- 非 pin-warp 图层走原有路径（单测断言 evaluated Layer 上不出现 `pinWarp` 键、序列化结果不含该字段）。

## 改动文件

- `src/domain/models/pinWarp.ts`（新）：`pinWarp` 可选字段的持久化读取 Schema（宽容）与写入用 `PinWarpAuthoringSchema`（严格）、上下界常量。
- `src/domain/pin-warp.ts`（新）：确定性网格、rigid MLS（Schaefer 2006）、姿态插值、合法性校验、种子/编辑纯函数、`evaluateLayerPinWarp`。
- `src/domain/models/layer.ts`：`LayerSchema` 增加可选 `pinWarp`（v47 加法，无迁移）。
- `src/domain/models/index.ts`、`src/domain/index.ts`：导出新模型/几何模块。
- `src/domain/evaluate-shot-at-time.ts`：`EvaluatedLayer.pinWarp`（valid/invalid）在唯一正式求值中解析一次。
- `src/domain/services/LayerService.ts`：`bindPinWarp` / `clearPinWarp` / `setPinWarpPin` / `addPinWarpPose` / `removePinWarpPose` / `setPinWarpMeshDensity` / `resetPinWarpPose` / `reseedPinWarp`，含镜头时长/帧网格/姿态一致性校验，一次调用一次提交。
- `src/renderer/stores/layerStore.ts`：对应 store 包装，一次手势一次 `updateProject`（一次撤销）。
- `src/renderer/features/canvas/editorTemporalCanvasModel.ts`：0:00 基础编辑视图透传正式求值的 `pinWarp`。
- `src/renderer/stage/pinWarpCanvas.ts`（新）：每三角形 clip → 仿射 → 整图 `drawImage`；`resolvePinWarpDrawPlan`（warp / plain 唯一分派）。
- `src/renderer/stage/PinWarpImage.tsx`（新）：react-konva `Shape` 场景绘制，消费同一 mesh。
- `src/renderer/stage/StageRenderer.tsx`：共享 Stage/Preview/Export 在 `pin-warp` 计划下走分片贴图，否则保持原 `KonvaImage` 路径；新增 `data-pin-warp-layer-ids` 诊断。
- `src/renderer/features/canvas/SelectableLayer.tsx`：warped 位图与控制器委托给 hook 子组件（保持该组件原有"纯函数式"可测性）。
- `src/renderer/features/canvas/PinWarpEditorLayer.tsx`（新）：编辑器 warped 渲染 + 拖动预览（同一纯函数重算，未提交不写工程）。
- `src/renderer/features/canvas/PinWarpPins.tsx`（新）：按**求值后**位置绘制的可拖控制点（阻止冒泡，避免触发图层位移）。
- `src/renderer/features/canvas/CanvasStage.tsx`：单层接线，选中图层时显示控制点；一次拖放提交 `setPinWarpPin`；新增 `data-pin-warp-*` 诊断。
- `src/renderer/features/properties/PinWarpControl.tsx`（新）：Inspector「控制点变形」面板（启用/移除、网格行/列、记录/删除/重置当前姿态、重置控制点）。
- `src/renderer/shell/RightInspector.tsx`：挂载该面板。
- `tests/unit/pin-warp.test.ts`、`tests/unit/pin-warp-renderer.test.ts`（新，共 21 条）。

## Mesh / MLS / 插值做法与不变量

- 网格：`mesh.columns × mesh.rows` 覆盖该图层图片的 `localRect`（层本地像素，原点为图片中心，与 `resolveLayerVisualParts` 的 `localRect` 一致）；顶点行优先、稳定序号；每格两个三角形、对角交替（AniCraft `warp.rs` 同款），无隐含状态 → 相同输入永远产生逐字节相同的顶点/三角形。
- MLS：Schaefer et al. 2006 §2.3 rigid MLS，权重 `1/|p−v|²`，闭式旋转+平移、无迭代、无收敛；点与某个 rest pin 重合时直接取该 pin 的 `at`（同 AniCraft）。若主解数值不可用则回退 `1/|p−v|⁴`，最后回退恒等，绝不输出 NaN。
- 插值：只由作者姿态决定——时间点精确命中取该姿态；相邻姿态间逐坐标线性插值；首姿态前/末姿态后保持；每次从 rest 重算，不累积。
- 非法输入（重复 rest pin、坐标非有限、pin 数量不一致、零面积三角形、非法 rect/网格、姿态时间非严格递增）统一返回 `status: 'invalid'` + 原因；消费者据此画原图。允许"翻面"（负面积三角形），仅在 mesh 上记录 `flippedTriangleCount` 供诊断，绘制按仿射照常镜像，不崩、不出 NaN。
- 写入侧：`PinWarpAuthoringSchema` + `validatePinWarpForShot` 校验 pin 数量 2–32、姿态 ≤64、时间严格递增且在镜头时长内、落在项目帧网格（24fps 的整数毫秒帧）上；服务拒绝非法写入。读取侧保持宽容，坏数据只在本地降级（不阻断整工程打开）。
- 一次拖动=一次撤销：拖动中只在 React 局部 draft 里用同一纯函数预览；pointer-up 才 `layerStore.setPinWarpPin`（一次 `updateProject`）。同值拖动被服务端 no-op，不产生历史；拖动取消（未产生改变）不写工程。

## 透明边 / 接缝 / 翻面 / 命中 / 导出的验证方式与结果

| 项 | 做法 | 证据 |
| --- | --- | --- |
| 透明边 | 每三角形 clip 后以"整图 + 精确仿射"绘制，不做源子矩形采样，避免双线性采样越界导致的暗边 | 代码不变量 + 渲染器契约测试（`drawImage(image, 0, 0)`、图像对象同一）；**像素级暗边对照 NOT RUN** |
| 三角接缝 | 相邻三角形按 `seamOverlap`（0.5–2 本地单位，随网格尺寸）向质心外扩后再 clip，重叠区只重复真实图像像素 | 网格/绘制契约测试断言每三角形一次 clip；**半透明像素跨接缝是否二次混色 NOT RUN** |
| 翻面 | 允许负面积三角形并把数量记录在 `flippedTriangleCount`；零面积才判无效 | 单测覆盖零面积→invalid；翻面渲染 TO BE VERIFIED（真实画布 NOT RUN） |
| 命中 | 控制点按**求值后**（`at`）位置绘制/命中；图层选择命中仍沿原图片矩形（warped 轮廓不参与逐像素命中，属已知边界） | 代码路径 + 契约测试断言控制点来自 evaluated pins |
| 导出/Stage/Preview 一致 | 三者同一 `EvaluatedLayer.pinWarp`、同一 `resolvePinWarpDrawPlan`、同一 `PinWarpImage`/`pinWarpCanvas` 绘制 | 单测 + 源码契约断言；**Stage/Preview/Export 像素对照 NOT RUN**（避免以 headless 结果冒充实机） |
| 两实例独立 / 随机 seek / 保存重开 / 撤销 | 单测 | `pin-warp.test.ts` 全部通过 |

## 成本观察（headless、CPU-only；真实 Canvas/GPU 未测）

用临时 vitest 探针（不提交）在 1920×1080 图片 rect 上测得：

- `evaluatePinWarpMesh` 4×3 网格/6 pins ≈ **0.0205 ms/op**；24×24/6 pins ≈ **0.66 ms/op**；24×24/32 pins ≈ **2.47 ms/op**。
- `resolvePinWarpPoseAtTime`（2 姿态）≈ **0.0004 ms/op**。
- `evaluateShotAtTime` 基线 ≈ 0.0224 ms/op；再加 1 个 4×3 warped 图层 ≈ 0.0751 ms/op（含新增图层本身，非纯增量）。
- 24×24 求值 mesh：625 顶点 / 1152 三角形 / JSON 约 **60 KB**；默认 4×3 为 20 顶点 / 24 三角形，JSON 约 **1.5–2 KB** 量级（顶点×3 数组×2 数值）。
- 每帧每 warped 图层 Canvas 2D 绘制调用形态：**24 次**（4×3）或 **1152 次**（24×24）`clip+transform+drawImage`。

判断依据：默认 4×3–8×6 的 1–2 个位图柔性图层，Canvas 2D 局部三角贴图在求值与调用数上都属于可接受量级，本小样不构成切换到局部 GPU 的必要性；当需要多图层全身 warp、更高密度（≈24×24 起每帧千次绘制调用）、软边/alpha 或逐像素级效果时，Canvas 路径的 per-triangle 调用与每帧重建成本会成为瓶颈，届时再评估局部 GPU（WebGL）。本结论仅为小样量级判断，不等于性能基准或产品化结论。

## 验证（本 worktree，顺序执行）

| Gate | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm exec eslint <changed files>` | PASS（0 error / 0 warning） |
| 新增定向：`vitest run tests/unit/pin-warp.test.ts tests/unit/pin-warp-renderer.test.ts` | **21 passed / 2 files** |
| 定向回归：`stage-render-model`、`canvas-layers`、`canvas-layer-interaction`、`layer-parenting`、`layer-stores` + 新增 2 文件 | **99 passed / 7 files** |
| `pnpm test:unit`（全量） | **4653 passed / 556 files / 0 fail**（较集成基线 4632/554 增加 21 条、2 文件） |
| 定向集成：`layer-coverage-mask-persistence`、`layer-placement-lifecycle`、`history-lifecycle`（`vitest.integration.config.ts`） | **8 passed / 3 files / 0 fail** |
| `pnpm build` | PASS |
| `git diff --check` | PASS |

## 未验证（NOT RUN）

- 真实 Windows Electron 中的拖动手感/性能、Stage/Preview/Export 像素对照、透明边与接缝的像素级检查、翻面视觉效果。
- AN2023 A/B（无 AN Asset Warp 导入）、UAT、OWNER 验收。
- Windows 高 DPI/缩放下的控制点命中尺寸（仅按视图缩放做近似）。
- 镜头缩略图：仍绘制未变形原图，未接 pin-warp（明确不在本票范围）。
- 真实 Canvas 绘制耗时、GPU 路径、内存峰值（仅记录 mesh 数据量级）。

## 已知边界/风险

- `pinWarp` 数据在图片素材替换/改尺寸后仍按旧素材像素坐标解释（网格 rect 用当前 `localRect`，pin 坐标不自动重标），属可接受的本地降级边界。
- 编辑器控制点命中尺寸按视图缩放近似，极端父级/相机空间下可能偏小或偏大。
- 半透明像素正好落在三角形接缝上时，接缝外扩重叠可能导致轻微二次混色（未做像素验证）。
- 旧构建不保证能读取含新字段的工程（与集成线其余加法字段同一发布兼容问题，未在本票改变策略）。
