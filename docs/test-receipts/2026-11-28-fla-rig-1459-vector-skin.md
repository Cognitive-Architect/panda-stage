# FLA-RIG 1459 回执（矢量路径蒙皮两骨小样）

> 依据 #1459（R05 矢量路径蒙皮：单片袖子/辫子两骨 LBS 最小纵切）。
> 同一集成线 `integration/fla-rig-1448-1458`，续 PR #1463，不新建 PR。
> 配对的位图路线见 `2026-11-28-fla-rig-1460-pin-warp.md`。

## 结论

- **已交付最小纵切**：可选增量 `character.vectorSkins`；两骨矢量 LBS 纯域模块；正式求值路径内逐帧从 rest 重算变形；Stage/Preview/Export/命中同读一份结果；无效绑定与样式边界局部降级；中文 Inspector 创建/删除；一次确认一次撤销。
- **明确未做**：权重刷/逐锚点手调 UI（仅数据层 override + 纯函数）、全身自动权重、渐变/图案/裁剪路径坐标变形、AN Asset Warp 导入、蒙皮与 IK/约束联动。
- Schema 仍 v47（可选增量字段），无迁移、无新依赖、无第二运行时/渲染链。

## 实现要点

- **权重**：锚点到骨段的距离取逆四次方，保留最强两骨并归一化（<1% 丢弃）；纯函数 `resolveVectorSkinWeights` 可确定性复算，`anchorWeights` 仅作数据层 override（UI 未暴露）。
- **混合**：逐锚点混合矩阵 `M = w0·Δ0 + w1·Δ1`，锚点与其 in/out 控制柄使用**同一混合矩阵**，句柄不脱节。
- **坐标系**：骨 delta 是 Character 空间 `world·inverse(restWorld)`，经 `characterBonePoseClipDeltas` 共轭到 Clip 空间 `T(-c)·Δ·T(c)`；区域几何在 Definition node-local(viewBox) 空间，渲染约定 `T = part.imageTransform · T(-anchor) · node.worldTransform · T(-baseViewBox)`，变形在 Clip 空间做 `r' = T⁻¹·Δ_clip·T·r`。rest 时 Δ=I ⇒ 恒等。
- **rest 证据**：rest 帧直接返回原 visual 对象（引用相等、无新分配）；测试用 JSON 比对「有蒙皮 rest」与「无蒙皮 authored」完全相等；持久化只存 binding，不存 rest 几何副本。
- **求值**：`visualParts` 中把绑定 Part 的 `flaGraphic` 矢量区域替换为变形结果；有蒙皮的 Part 不再叠加自身单骨刚性 delta（避免双重变换）。
- **降级（typed reason，Part 本地保持 authored，其他部件正常）**：`not-vector-content`、`clip-path`、`non-solid-style`（渐变/图案）、`mixed-content`（同子树含位图/文字）、`too-many-anchors`（>20000 锚点 / >40000 点）、`degenerate-transform`、`missing-bone`、`missing-part`。
- **级联**：删骨/装配删部件时 prune 对应 skin；跨工程导入重映射 `vectorSkins[].partId`（boneId 保持 Character 本地）。

## 测试（35 条新增）

- `tests/unit/character-vector-skin-weights.test.ts`（11）：段距离（垂直/端点/零长）、最近骨全权重与中线 0.5、逆四次方排序（16 倍）、top-2 归一、faint 丢弃与确定性、骨上锚点有限、override 命中、非法权重过滤、prune 规则。
- `tests/unit/character-vector-skin-evaluation.test.ts`（12）：rest 逐字节等于 authored、两姿态连续且两骨都影响锚点、控制柄跟随、两实例独立、随机 seek 与保存重开一致、缺骨/无矢量内容/渐变/位图混合局部降级、大角度塌陷但数值有限、无蒙皮部件在摆骨后逐字节不变、Clip 空间映射与渲染器约定一致。
- `tests/unit/character-vector-skin-authoring.test.ts`（12）：Schema v47 + JSON 往返 + `migrateProject` 保留、未知 Part/Bone/非矢量 Part 拒绝、重复 id/同骨/超 16 拒绝、override 不归一拒绝、create/delete 各一次工程更新、中文错误、脸嘴部件拒绝、describe、删骨与删部件级联、导入重映射、UI 草稿不脏工程且每次确认恰好 1 次 undo。

## 成本与产品化判断（可测部分）

Windows Node/Vitest、非 Electron、无 GPU 合成：
- 同镜头求值：蒙皮零件摆姿态 ≈0.20–0.21 ms/帧 vs 无蒙皮 ≈0.042–0.050 ms/帧（≈0.15–0.17 ms/帧/9 锚点）。
- 纯变形：9 锚点 0.048 ms、90 锚点 0.286 ms、900 锚点 2.30 ms/次（≈2.5 µs/锚点，近线性）。
- 栅格：rest 帧复用 authored visual（WeakMap 命中，0 次新建 canvas）；摆姿态帧每帧重栅格化该 Part 1 次（与既有「结构化部件变形即重绘」同级）。
- 内存：每帧 O(锚点) 分配；2000 次随机 seek 后 `usedJSHeapSize` 差值≈0（无累积）。
- 代表性姿态：30°/−10° 连续过渡；160°/160° 链中部跨度 100px→<50px（经典 LBS 塌陷），数值有限、句柄不脱节。
- 判断：少量低锚点矢量小件（单片/几片袖子、辫子、裙角）当前成本可交互，值得保留；不建议直接扩全身自动蒙皮/权重刷（数千锚点按线性外推 5–30ms/帧 + 每帧重栅格化），也不建议在渐变/图案/裁剪路径与真实 AN 素材未验证前承诺产品能力。下一次门禁建议：真实 Electron + 真实导入 FLA 素材的锚点规模、像素对照与拖动帧率。

## 验证

| Gate | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS（0 error） |
| `pnpm lint` | PASS（0 error） |
| `pnpm test:unit` | 集成线 **4688 passed / 559 files，0 fail** |
| `pnpm test:integration` | **304 passed / 7 skipped / 68 files，0 fail** |
| `pnpm build` | PASS |

## 未验证（NOT RUN）

真实 Windows Electron 拖动帧率与像素对照、Stage/Preview/Export 像素级一致性、AN2023 A/B、真实导入 FLA 素材的锚点规模与视觉验收、OWNER UAT、性能基准（仅单机单次）。

## 边界

渐变/图案/裁剪路径、混排位图/文字、>20000 锚点、不可逆矩阵按局部降级；逐锚点 override 仅数据层 + 纯函数，无编辑 UI；蒙皮 Part 不叠加单骨刚性 delta（即使降级也不回退，行为确定）。
