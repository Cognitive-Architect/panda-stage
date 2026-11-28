# FLA-RIG 1471 回执（#1459/#1460 柔性变形五项集中补修）

> 依据 #1471（R-D 补修：4×P2 + 1×P3）。同一集成线 `integration/fla-rig-1448-1458`，续 PR #1463。
> 开工基线 `0434ba7`；本回执只记录实际验证，未执行项标 NOT RUN。

## 结论摘要

- **五项全部确认成立并已修复**：R1/R2/R3 为渲染与边界接线，R4 为镜头时长检查，R5 为 History 噪声。
- 未新增依赖、无 Schema 变更（仍 v47）、无第二渲染链；未变形/未蒙皮路径保持逐字节一致。
- 未合并、未转 Ready、未关闭 #1471 与 #1459/#1460。

## 提交

| 项 | 提交 | 合并 |
| --- | --- | --- |
| R2 变形矢量蒙皮边界 | `d9d3cd0` | `8681102`（B 组） |
| R4 镜头内容末尾纳入 Pin Warp 尾姿态 | `afcbf6e` | `8681102` |
| R5 插值帧净零拖动 no-op | `1725478` | `8681102` |
| R1 半透明接缝单次写入 + rest 走普通路径 | `6f4c371` | `ac7668f`（A 组） |
| R3 网格进入合成缓存签名 + 变形绘制边界 | `6f4c371` | `ac7668f` |

## R1 · 半透明 Pin Warp 接缝二次混色（P2）

- **根因**：每个三角形在扩张 clip 下以 `source-over` 直接画到目标，相邻三角形刻意重叠 → 接缝像素被写两次（50% alpha 两次叠加 ≈0.75/192 而非 0.5/128），group opacity 也被逐片复合；rest 姿态同样走三角形路径，与普通图片不是逐像素一致。
- **修复**：① 严格 rest/identity 网格（目标顶点 = UV + rect，1e-6）走普通图片路径（含编辑器：一次无 clip、无 transform 的 `drawImage`）；② 非 rest 先逐三角形以 `globalCompositeOperation='copy'` 画进透明 scratch（重叠**覆盖**而非累加），再一次性 blit 到目标 —— 每个目标像素恰好一次 `source-over`；③ scratch 通过注入式工厂抽象（默认按设备像素比分配合尺寸单项复用 + clearRect），无法创建或 >24MP 时回退旧的直绘路径，几何不丢；④ 保留「扩张 clip + 整图精确仿射」以维持无暗边/无裂缝。
- **测试**：rest 与普通图片 draw 记录逐字节相同；50% alpha 接缝只写一次（模型 0.5 而非 0.75）；接缝覆盖仍在；设备像素比与无 scratch 回退；翻面/退化跳过。

## R2 · 矢量蒙皮沿用旧 `localRect`（P2）

- **根因**：LBS 重写区域几何后 Part 仍用 authored rest `localRect`，合成缓存与效果画布按 `visualBounds` 裁剪，伸出旧框的袖子被裁。
- **修复**：仅在当帧确实变形（`deformed === true`）时，用既有 `measureFlaGraphicSubtreeBounds`（与光栅器同一套矢量范围工具）重算边界并写入运行时 `localRect`/`combinedLocalBounds`；rest、fallback、非蒙皮 Part 边界逐字节不变。
- **证据**：双部件角色骨骼 A=45°/B=-30°，rest `localRect={-20,0,140,100}`；500/750/1000ms 重算 x=-25.57/-37.24/-47.60，底部 108.31/109.01/107.63；1000ms clip 空间内容 minX=-507.60，修复前 `combinedLocalBounds.x=-480`（裁 27.6px），修复后 -507.60 完整覆盖。`fixedCharacterCenter`、图层 x/y、Part `imageTransform`、命中原点均不变；随机 seek 与保存重开边界一致。

## R3 · 合成缓存签名忽略变形网格（P2）

- **根因**：`createStageCompositeCacheSignature` 只含 transform/effects/bounds；两个姿态 transform 与 bounds 相同时命中同一 effects 缓存（特效冻结），且缓存 rect 用 rest 边界会裁掉超出原图的变形。
- **修复**：签名新增求值后的 Pin Warp 指纹（invalid → status/reason；valid → rect/密度/三角形数/seamOverlap/千分位顶点与 UV）；变形图层使用 `pinWarpMeshDrawBounds`（目标顶点包围盒 + seamOverlap），`resolvePinWarpDrawBounds` 为 Stage/Preview/Export 与编辑器共用的唯一规则；无 warp 图层签名省略该 key、bounds 原样返回（测试断言与改动前字符串一致）。

## R4 · 镜头缩短漏检 Pin Warp 尾姿态（P2）

- **根因**：`maximumContentEndMs` 未含 `pinWarp.poses`，3000ms 镜头可缩到 1000ms，随后任何 Pin 写入都因整组姿态超时而失败。
- **修复**：把各图层 Pin Warp 姿态时间并入既有内容末尾计算，沿用既有缩短策略与文案（`SHOT_CONTENT_OUT_OF_RANGE`：「镜头内容延伸到 2000ms，时长不能缩短到 1000ms。」）；不新增读档硬门禁。
- **证据**：3000→1000 被既有规则拒绝；删除尾姿态或把时长调回 2000ms 后编辑恢复且合法姿态保留；1000ms 镜头存 2000ms 姿态仍可打开并在 0/1500ms 求值有效（局部降级）。

## R5 · 插值帧净零拖动仍写姿态与 History（P3）

- **根因**：`setPinWarpPinAtTime` 在无精确时刻姿态时无条件 auto-key。
- **修复**：写前比较请求点与当帧求值 pin，净零（`1e-6` 图像像素）返回同一 `pinWarp` 引用 → 服务与 Store 跳过工程更新与 History；显式「记录当前姿态」不变。
- **证据**：插值帧净零拖动后 revision/undoCount/姿态数均不变、project 引用不变；真实拖动恰好 1 次更新 / 1 个姿态 / 1 条 Undo；显式记录仍插键。

## 验证（集成线最终状态，顺序执行）

| Gate | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS（0 error） |
| `pnpm lint` | PASS（0 error） |
| `pnpm test:unit` | **4710 passed / 559 files，0 fail**（较 #1459/#1460 后 4688 增加 22 条） |
| `pnpm test:integration` | **305 passed / 7 skipped / 68 files，0 fail**（新增 1 条镜头生命周期回归） |
| `pnpm build` | PASS |

保留回归：#1459/#1460 的两实例独立、rest 不变、随机 seek、保存重开、无效绑定局部降级合同均仍通过。

## 未验证（NOT RUN，不得写作 PASS）

- 真实 Windows Electron / Chromium 像素取样：rest 与普通图片逐像素一致、50% alpha 接缝 ≈128 而非 ≈192、真实边无暗边 —— 当前只有 fake-canvas 合成模型断言。
- 编辑 / Preview / Export 三端像素对照；真实 Skia 下 clip 抗锯齿与 `copy` 覆盖率语义、scratch canvas 复用快照语义。
- 真实 FLA 素材 / AN2023 A/B；scratch 合成通道的性能与内存；OWNER UAT。自然 CI 由 push 后触发。

## 边界

- scratch 无法创建或超 24MP 时回退直绘（旧的二次混色在大图/半透明下仍可能出现）。
- R3 签名为网格几何指纹（0.001 local px 量化），非内容哈希；同一姿态重建网格对象签名稳定。
- R2 只影响当帧变形 Part 的运行时边界，不改变持久化定义、rest 数据与角色固定中心。
