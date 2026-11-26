# Panda Stage 近期能力普查（2026-11-26）

## 结论与取样范围

Panda Stage 已由个人创作者的 2D 纸片人编辑器，进一步具备 FLA 素材还原、局部二次编辑、动作及声音复用、正式多媒体输出与外部自动化的组合生产链。这里的“具备”指固定主线已纳入明确范围的实现，不代表任意 Animate 文件无损恢复或 OWNER UAT 已通过。

- 基线：`167cdb9eca268c47aa45b1bc5b1ec454eeb75890`（PROD #1247 的 base）；目标：`bd38ac3a50b86bb535adf390cfa3d3c50a0941ff`（2026-11-26 08:37:53 UTC+8 的 E 集成 merge）。
- [GitHub Compare](https://github.com/Cognitive-Architect/panda-stage/compare/167cdb9eca268c47aa45b1bc5b1ec454eeb75890...bd38ac3a50b86bb535adf390cfa3d3c50a0941ff) 返回 ahead 167 commits、294 个变更文件；四轮主要交付口径为 9+12+13+13=47 切片（不是互斥的 47 个用户功能，也不将修复重复算入）。
- GitHub PR 元数据确认 [#1247](https://github.com/Cognitive-Architect/panda-stage/pull/1247)、[#1258](https://github.com/Cognitive-Architect/panda-stage/pull/1258)、[#1293](https://github.com/Cognitive-Architect/panda-stage/pull/1293)、[#1321](https://github.com/Cognitive-Architect/panda-stage/pull/1321)、[#1351](https://github.com/Cognitive-Architect/panda-stage/pull/1351) 已合并。正文内历史 Draft/未合并表述不是当前状态。#1293 已被 #1321 吸收，单独合并记录不重复计入。
- [目标主线 CI](https://github.com/Cognitive-Architect/panda-stage/actions/runs/45730110377) success。通过 [be52c362 → bd38ac3](https://github.com/Cognitive-Architect/panda-stage/compare/be52c3621317b6a53b589b8c1d1aaa912dd5b8b9...bd38ac3a50b86bb535adf390cfa3d3c50a0941ff) 核对，只有 merge commit，0 个文件差异。
- 方法：读取 GitHub 原始 PR 元数据、交付合同和固定主线关键生产源码；用户提供的扩展01/02 是先前对照 review 的历史输入，非新的源码执行结果。本次未启动 Electron、Animate 或重跑测试；CI、执行者回执、历史探针与 OWNER UAT 分列。本次是能力普查，不是全量代码审计。

## 1. PROD：生产效率与创作（9 个主切片）

主源：[集成 PR #1247](https://github.com/Cognitive-Architect/panda-stage/pull/1247)，其中还记录 #1251 定向修复、#1252 Graphic 点图落键和 #1253 身体姿势库。

| 切片 | 合并范围 | 创作价值 |
| --- | --- | --- |
| 01 | 普通 Graphic 实例当前时刻选帧、表情专属说话来源 | 对白嘴型、道具状态可按时刻安排 |
| 02 | 整工程模板、独立新工程、当前镜头/全片台词查找替换 | 连载短片复用场景和人物，批量改台词 |
| 03 | 用户运动预设、动画源片段、运行时目标重绑定配方 | 自己做的动作可反复使用 |
| 04 | 选中音频波形、暂停擦听、音量动作草稿 | 对白定位、声音渐变 |
| 05 | 自定义属性曲线、明确部件落键、选段时间处理、源循环 | 更精细控制已有动作 |
| 06 | 分层身体动作、独立脸嘴、头部跟随、局部姿势预览/应用 | 身体演出与表情并行 |
| 07 | 2–3 节刚性手臂 IK、分件角色显式动作映射 | 拖手摆姿势、跨角色复用 |
| 08 | 本机 CLI 读取当前工程、编辑台词、预设/配方、原子批次、撤销 | 外部工具可沿正式项目事务协作 |
| 09 | 当前镜头/指定时段透明 PNG 序列、设置持久化、取消保留与重试 | 独立输出后期合成素材 |

补充：[真实桌面 CLI 使用文档](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/docs/desktop-automation.md) 给出 state、dialogue.update、preset.apply、undo 以及会话/批次规则。CLI 不代表任意 UI 或任何项目属性都可自动化。#1247 回执记录了若干 Windows 构造样本验收；真实 OWNER 素材仍按原记录待验。

## 2. A/B/C：FLA 基础还原（12 个主切片）

主源：[A/B/C 集成 PR #1258](https://github.com/Cognitive-Architect/panda-stage/pull/1258)、[路线图 #1256](https://github.com/Cognitive-Architect/panda-stage/issues/1256)。

| 切片 | 已纳入主线的语义 |
| --- | --- |
| A01 | 确定性 MovieClip stop()，实例独立时钟，父停子继续及单帧 Scene 合理跨度 |
| A02 | 变量宽度笔触 marker 弧长、左右宽度、封闭轮廓内孔、透明度及渐变 |
| A03 | Bounce / BounceIn / Spring 及 eased(1) 末值保持 |
| A04 | 多 run 静态文字、CJK/Latin 换行、离线本地字体测量及透明文字回填 |
| B01 | 实例 Blur / Glow / DropShadow，阴影距离动画 |
| B02 | 原生相机、图层深度视差、附着层、深度排序及舞台裁剪 |
| B03 | XFL 文件夹和 stub 入口，源快照与正式素材脱离原目录 |
| B04 | 正式透明帧 PNG 图集及 JSON |
| B05 | 内嵌声音提取、试听、普通音频资产入库（MP3/受支持 PCM、ADPCM） |
| C01 | Folder 祖先可见性、真实 Mask 归属及隐藏 Mask 几何保留 |
| C02 | 静态 Alpha / Tint / Brightness |
| C03 | 明确配对的多个闭合轮廓及内孔 Shape Tween、颜色与透明度插值 |

[运动求值](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/fla-object-motion.ts)、[嵌套选帧](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/fla-nested-graphic-frame-selector.ts)、[显示列表](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/fla-static-snapshot-display-list-adapter.ts)、[SVG 构建](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/fla-static-snapshot-svg-builder.ts) 为主线关键消费源码。

原扩展01 review 的三项 P2 后续全部有对应合并修复：[R01–R03 #1293](https://github.com/Cognitive-Architect/panda-stage/pull/1293)。分别是 Graphic 外层颜色入库持久化且共享定义、纯文字快照正常入库、测宽/对齐/换行/绘制统一字距。PR 记录合成 FLA Windows 闭环验证及定向/全套测试，但真实混合 FLA 仍待验。R-A01 超时及 #1280 的实机待验记录未在本次重新定位或宣布关闭。

## 3. R+S：从保真到可复用生产资产（13 个扩展切片）

主源：[统一集成 #1321](https://github.com/Cognitive-Architect/panda-stage/pull/1321)、[路线图 #1290](https://github.com/Cognitive-Architect/panda-stage/issues/1290)。以下逐项引用历史实现 PR，统一主线以 #1321 合并为准。

| 切片 | 实际交付 | 源 |
| --- | --- | --- |
| S01-A | Classic Motion 恒定滤镜；Object Motion 多参数滤镜曲线（模糊、强度、距离、角度、RGBA 等） | [#1311](https://github.com/Cognitive-Architect/panda-stage/pull/1311) |
| S01-B | 静态文字自身 Shadow/Glow、边界扩张和组合顺序 | [#1309](https://github.com/Cognitive-Architect/panda-stage/pull/1309) |
| S01-C | Multiply / Screen / Add 进入正式节点合成，真实背景参与计算 | [#1313](https://github.com/Cognitive-Architect/panda-stage/pull/1313) |
| S01-D | 异深度 Mask 与内容分别投影后对齐 | [#1307](https://github.com/Cognitive-Architect/panda-stage/pull/1307) |
| S02-A | 静态复杂文字/效果子树独立 SVG，外部遮罩、位置、顺序保持，其他节点继续保留结构 | [#1314](https://github.com/Cognitive-Architect/panda-stage/pull/1314) |
| S02-B | 动态复杂子树逐帧求值、重复状态资产复用，播放/seek/多实例 | [#1318](https://github.com/Cognitive-Architect/panda-stage/pull/1318) |
| S03-A | 多页图集容量规划、逐页编码、原子发布/失败回滚 | [#1310](https://github.com/Cognitive-Architect/panda-stage/pull/1310) |
| S03-B | 透明裁边、预乘 alpha 缩放、padding/extrusion、PixiJS multipack | [#1315](https://github.com/Cognitive-Architect/panda-stage/pull/1315) |
| S03-C | 选中可见 Graphic/动作对象独立图集，不带无关背景和声音 | [#1317](https://github.com/Cognitive-Architect/panda-stage/pull/1317) |
| S04 | Hermite 宽度变化与不对称圆头精度（上游同样是拟合，不是官方公式） | [#1308](https://github.com/Cognitive-Architect/panda-stage/pull/1308) |
| S05-A | 主 Scene 的 stream/event 声音恢复为可编辑 AudioClip | [#1312](https://github.com/Cognitive-Architect/panda-stage/pull/1312) |
| S05-B | start 去重、stop 截断、有限 repeat、in/out point | [#1316](https://github.com/Cognitive-Architect/panda-stage/pull/1316) |
| S05-C | 嵌套 Graphic/MovieClip 声音独立时钟，静止/播放一次/循环语义 | [#1319](https://github.com/Cognitive-Architect/panda-stage/pull/1319) |

主线结构模型 [flaGraphicStructure](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/domain/models/flaGraphicStructure.ts) 明确存在 opaque 子节点、editableText、blendMode、rgbaTransform 和 coveragePathData；[声音时间线](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/domain/fla-sound-timeline.ts) 声明 event/start/stop/stream 与有限重复，复用 Graphic 选帧。局部隔离失败仍可整帧降级；不承诺内部复杂节点全部可编辑。无限音频 loop、任意脚本驱动 MovieClip、Button 声音等仍有诊断。

S 集成额外修复：声音 IPC 注册、PixiJS 跨页 animations 语义、嵌套 Graphic 停帧的音钟；I01 保留复杂子树 blendMode 到真实背景合成。实际 PixiJS 8.0.5 验证（PR 原回执）：48 帧/2 秒/3 页、46 个裁边非空帧和 2 个空帧、零 undefined textures。多页动画由 Panda master manifest 和 [消费 helper](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/shared/pixi-spritesheet-consumer.ts) 组装，不声称任意引擎直接原生读取。真实 Windows/Animate A/B/OWNER UAT 按原记录待验。

## 4. E：更高阶效果、视频与出口（13 个实现 PR）

主源：[E 集成 #1351](https://github.com/Cognitive-Architect/panda-stage/pull/1351)、[#1350](https://github.com/Cognitive-Architect/panda-stage/issues/1350)、[#1352](https://github.com/Cognitive-Architect/panda-stage/issues/1352)。实际 13 个切片如下（使用集成 PR 中真实编号；E06-A 对应历史票名 E03-T）。

| 切片 | 新增范围 | 源 |
| --- | --- | --- |
| E01-A | SineWave、SawtoothWave、SquareWave、DampedWave | [#1337](https://github.com/Cognitive-Architect/panda-stage/pull/1337) |
| E02-A | 双端纯色多样式 Shape Tween、颜色/线宽插值 | [#1341](https://github.com/Cognitive-Architect/panda-stage/pull/1341) |
| E02-B | 明确配对的线性/径向渐变及 stop、矩阵、focal | [#1346](https://github.com/Cognitive-Architect/panda-stage/pull/1346) |
| E03-C | 静态显式 RGBA 四通道倍率/偏移及正式实例结构 | [#1339](https://github.com/Cognitive-Architect/panda-stage/pull/1339) |
| E03-F | Inner/Knockout Glow；明确 20 数颜色矩阵子集 | [#1343](https://github.com/Cognitive-Architect/panda-stage/pull/1343) |
| E04-A | 静态 2.5D 仿射投影；集成补动态 Object Motion Rotation_X/Y、Motion_Z | [#1344](https://github.com/Cognitive-Architect/panda-stage/pull/1344) |
| E05-A | 基础静态九宫格，真实内容边界 | [#1338](https://github.com/Cognitive-Architect/panda-stage/pull/1338) |
| E05-B | 单轴镜像等明确组合，连续渐变与切片几何分离 | [#1347](https://github.com/Cognitive-Architect/panda-stage/pull/1347) |
| E06-A | 上下标、字符旋转，受支持的单 run 实例文字替换 | [#1342](https://github.com/Cognitive-Architect/panda-stage/pull/1342) |
| E07-A | FLA 内嵌 ISO MP4/MOV 提取、PTS 索引；集成后正式视频层、音轨及导出 | [#1345](https://github.com/Cognitive-Architect/panda-stage/pull/1345) |
| E08-A | 720p/1080p × 24/30/60fps 冻结输出配置 | [#1340](https://github.com/Cognitive-Architect/panda-stage/pull/1340) |
| E08-B | 正式 WebM VP9/Opus | [#1348](https://github.com/Cognitive-Architect/panda-stage/pull/1348) |
| E08-C | 正式 GIF 24/30fps、无音轨、可选循环 | [#1349](https://github.com/Cognitive-Architect/panda-stage/pull/1349) |

### 视频正式链和编辑边界

[内嵌视频服务](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/FlaEmbeddedVideoService.ts)、[正式视频层 schema](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/domain/models/layer.ts#L259-L272)、[共享时间戳时钟](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/shared/fla-video-clock.ts) 和 [ISO 容器入口](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/fla-native-video.ts) 说明：可从 FLA 内提取受支持视频、加入当前 Shot、保存、按 PTS 求帧并在 Stage/Preview/Export 消费，可选抽出 WAV 参与正式混音。默认居中、从 0 开始；源实例原摆位/嵌套时钟未完整恢复，纯函数 nestedHost 不是正式模型能力。主要验证短 MP4/H.264；底层 WebM 解码不等于原生 FLA WebM 入口。首次仍可能等待整段顺序解码；有界缓存与按需 IPC 供帧不是随机按需解码。

[单 run 文字实例覆盖模型](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/domain/models/flaGraphicInstanceText.ts) 表明更复杂富文本仍不能当作完整原生排版编辑器。静态 RGBA 支持不等于高级 RGBA 动画通道：[motion 支持表](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/fla-object-motion.ts#L64-L67)。

## 5. 正式交付出口

[输出配置源码](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/shared/export-output-profile.ts)、[ExportService](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/ExportService.ts) 与 S/E 合并 PR 为依据。

| 格式 | 输出能力 |
| --- | --- |
| MP4 | H.264/AAC；720p/1080p；24/30/60fps |
| WebM | VP9/Opus；720p/1080p；24/30/60fps；普通不透明输出 |
| GIF | 720p/1080p；24/30fps；循环/非循环，无音轨 |
| PNG 序列 | 镜头/指定时段正式透明帧 |
| Sprite Sheet | 多页 PNG+JSON，通用清单或 PixiJS，裁边/缩放/边距/挤出；整镜头或选中对象 |

E 集成记录真实 Windows FFmpeg/ffprobe 对实际容器和音轨的组合测试；部分 renderer 测试采用 mock，不能代表真实 Electron 画面。GIF 60fps 配置会降到 30fps；透明 WebM 尚未开放。

## 6. 能力层级、当前缺口与已知风险

本次区分：已合并代码 / 有定向测试或回执 / 真实 OWNER 素材验收。不作百分比兼容率估算。主线保留 #1351 最终被审查的文件内容（上述 0 文件差异），所以扩展02 的 7 个 P2 不能因 merge 宣布已修：
1. 原生 centerPoint3DZ 漏读（[读取](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/fla-static-snapshot-display-list-adapter.ts#L888-L903)）。
2. IK/Rig/偏心运动与 3D 枢轴同步。
3. 九宫格父级缩放和自身缩放混用（[planner](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/fla-static-snapshot-svg-builder.ts#L3830-L3873)）。
4. 非 knockout 内发光增加源 alpha。
5. 零 alpha 矢量恢复时原 RGB 丢失。
6. 旋转 MP4 显示尺寸与编码尺寸不同。
7. 关闭/切换工程时进行中的视频解码生命周期（[dispose](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/FlaEmbeddedVideoService.ts#L945-L953)）。
前次报告提供过执行探针，本次只做固定主线继承性核对和部分源码抽查，不是重新复现七项。未核查任何未合并修复分支。上次 #1352 的 R1–R3 有独立修复提交，勿与上述后续七项混淆。

其他边界：高级 RGBA 动画、常见 AdjustColor 四参数入口、视频原实例摆位和时间安排、更广滤镜/混合模式、完整 3D 透视、复杂 Scale9、富文本替换、透明 WebM。明确三种 blend mode 见 [源码](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/shared/fla-blend-mode.ts)，颜色矩阵入口见 [源码](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/main/services/fla-static-snapshot-display-list-adapter.ts#L816-L854)。按真实素材需求补齐，而非以此阻止健康能力使用。旧二进制 FLA 按此前范围排除。

## 7. 产品收益与建议

最重要的不是 47 这个数字，而是三个复用层次连起来：原素材及动作 → Panda 内可编辑实例和音轨 → 确定性预览/正式输出。局部保真让一个复杂部件不必封死整个角色；图集使素材可进入 PixiJS；声音恢复减少重新对嘴；CLI + 工程模板有系列化生产潜力。下一步建议用一份真实混合 Animate 素材完成导入、局部换姿势/文字、声音、保存重开与输出一条实际短片，再按复现优先补齐七项已知缺陷。此为建议，不新增门禁或工单。

文档同步提醒：固定主线 [README](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/README.md) 仍写仅 MP4 1920×1080/24fps；[导出支持矩阵](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/docs/export-support-matrix.md) 仍有历史合同。当前源码 [PROJECT_SCHEMA_VERSION](https://github.com/Cognitive-Architect/panda-stage/blob/bd38ac3a50b86bb535adf390cfa3d3c50a0941ff/src/domain/constants.ts) = 42。后续宜定点更新 README 与支持矩阵，不需要无关重构。此次仅增加这份研究记录，不改 README、路线图、业务代码或工单状态。

```text
=== AUTO SAVE ===
时间：2026-11-26
做了什么（结果）：固定 PROD 前基线与 E 合并主线，核实 167 提交/294 文件、9+12+13+13 交付切片；对照合并记录、关键源码、历史 review 和 CI，形成能力与边界地图。
当前状态（一句话）：四轮主集成均已进入主线，关键生产链已形成，七项历史 review 缺陷未因合并消失，真实素材验收仍分列。
下一步（唯一可执行）：使用一份代表性真实 FLA 素材走完整创作与导出流程，记录具体阻塞。
风险 / 未验证（翻车点）：本轮未独立运行 Windows/Electron/Animate、FFmpeg 或测试；未检查未合并修复；不把功能合并和 CI 绿灯当作 OWNER 验收。README/支持矩阵有滞后。
=================
```
