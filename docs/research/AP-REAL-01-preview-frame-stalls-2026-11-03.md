# AP-REAL-01｜真实动画预览旧帧长时间保持：从已合并 main 开始的有界调查

> 状态：RESEARCH / DRAFT / ROOT_CAUSE_UNPROVEN。仅为研究线初始合同，不声称已找到真实卡顿根因。
>
> 唯一代码基线：main 合并 #870 的 `c5da50a7c32f77c01676b4ac0e295ccf3ccda659`。历史母 PR #870 已 MERGED，不在旧分支追加修复。研究母线为 `research/ap-real-01-preview-frame-stalls`。

## 背景 / 源头证据

- #870 已纳入 main：AM-03/04 正式动画实例、双实例播放，AP-01～03 图片准备/预热等。正式 Ready Full CI #41619323025 在候选 SHA `c61b76f7563831d3ead43103ffc2175058c7cc40` 成功；合并 SHA `c5da50a7c32f77c01676b4ac0e295ccf3ccda659`。
- OWNER 在私有真实 com8 21 帧走路素材预览中持续观察到「时间线前进，但画面像 PNG/PPT 播片，姿势长时间保持后跳变」；`OWNER_SMOOTHNESS_FAIL / WAIVED_FOR_MERGE`。不要改写为真人 PASS。
- #955 的历史调查标记 `ROOT_CAUSE_UNPROVEN / AP03_REGRESSION_UNPROVEN`。
- #957 C-only 合成模型中保留 Stage C 预热优于关闭 C；随后 B-only 模型识别 next-shot optional 与当前 required 争用，修复将 priority-3 next-shot 在途读取上限改为 1（`c14748e`），测试有所改善，但真人 com8 仍卡。**这证实特定合成争用，不足以证明真实瓶颈**。
- 已合并版本的 #890 Electron smoke 曾在真实相关 stall 检查失败；不能把 full CI 全绿等同于流畅度通过。

## 本研究回答的唯一问题

对于**一个**已入库的 com8 风格动画实例，播放时间已经推进时，卡在哪一个环节使得正确帧迟迟无法呈现在窗口？是当前资源读取、图片解码、exact-ready 整帧提交、React/Stage 绘制，还是窗口上屏/运行环境的其他具体步骤？

不做泛性能报告、不做整仓渲染重构、不先叠 AP-04/AP-05、不再仅以对象创建/缓存命中数代替用户可见帧延迟。

## 串行研究步骤

1. **冻结可复现路径**：核实最新 `main`、PR Head、已有 #890 / #925 / #955 / #957 代码和测量，列出每段管线可复用的现有计时点。使用原创合成 21 帧 / 源 25 FPS 素材先复现，可补少量 Windows Electron 运行观测；OWNER 的真实商用 FLA/PNG/MP4 不上传 GitHub。
2. **单实例端到端追踪**：在不改变动画语义的前提下，为每次目标帧标识 `shotTimeMs / targetFrameId / targetAssetId / requestedAt / byteReadStart/Ready / decodeStart/Ready / exactReadyCommit / stagePaint / displayedFrameId`（取不到的上屏时间明确写 `NOT_OBSERVABLE`，不能拿 React commit 冒充 GPU 上屏）。不同异步回调携带相同 ID，足以追查错帧、排队和旧帧停留。
3. **受控 A/B**：在**相同输入、相同提交、相同硬件/运行模式**条件下，只隔离一种可疑瓶颈，记录旧帧最长保持、可见新帧数量、从目标到提交的分位时延。必须区分合成模拟、Windows Electron 自动化、OWNER 真人观察三类证据，不得互相冒充。
4. **最小修复（有证据才动）**：找到可重复延迟源后，只修一个边界点。保留 exact-ready、不提交过期/错误帧，不更改镜头主时钟/源 FPS、动画身份/Schema、循环播放语义、正式导出 fail-closed。
5. **定向复验与回填**：记录 fix vs baseline、可独立 revert SHA、单位/集成/必要 Electron smoke。真实连续流畅度仍需 OWNER 亲自验收；未验收不得标记 PASS。

## 成功 / 停止判定

- 调查成功：能够对同一播放周期给出目标帧→required-read→decode→stage-commit 可靠事件链，明确哪个环节造成旧帧保持，且有可重复对照。若无真实上屏可观测性，明确测量边界。
- 修复成功（技术）：在可重复问题场景下降低目标到正确帧提交的等待和旧帧保持，保留缓存预算、双实例、Seek/Once/Loop/Hold/Hide、History、保存重开和导出保护。
- 产品成功：OWNER 用同一私有 com8 素材回看后签流畅度 PASS。
- 止损：没有可复现证据、不具备正确观测点、出现错帧/旧回调覆盖/数据损坏，回滚实验性修复并回填 `ROOT_CAUSE_UNPROVEN`；不无限追加候选优化。

## 非目标 / 隔离红线

- **独立 Draft PR**：研究线直接从 #870 已合并的 main 开始，不重新打开 #870，也不修改已合并历史。
- 不自动标 Ready、不自动 Full CI、不自动 Merge；不改已交付人物 Adaptive Parts v15/v16 迁移、静态/人物正式 MP4、AM-05。
- 没有证据前本研究不宣称解决了「PPT 播片」，也不将合成 FPS 换算成真实 Electron FPS。
- 每轮实验提交指标、命令与结果到本 PR；如追加实施 Issue，引用本 PR 并限定单一瓶颈。

## 第一轮待交付回执

```text
AP-REAL-01 / REAL PREVIEW FRAME STALLS
main / research HEAD：
复现环境和 fixture：
时间目标是否推进：
目标资源字节读取 ready：
对应图片解码 ready：
exact-ready Stage commit：
Stage paint / 实际上屏可观测边界：
最长旧帧保持区间及证据：
单实例 / 两实例差异：
最可能根因 / 反例：
下一刀（唯一）：
结果：CONFIRMED / UNPROVEN
OWNER 真人状态：FAIL（直到真实复验）
```

## Issue #964｜Phase 0 → Phase 1 实施回执（2026-11-04）

```text
main 基线：c5da50a7c32f77c01676b4ac0e295ccf3ccda659（Project Schema v16）
PR #959 初始远端/本地 HEAD：6855b4c9f661cacff473d97f0e99b8d2eb532128
PR #959 分支 / 工作树：research/ap-real-01-preview-frame-stalls / D:\panda-issue959-apreal01
诊断代码独立提交：def035b（feat(research): trace preview animation frame pipeline）；trace reactivation 单测补充：d3496f1。未提交性能修复；回退实现需同时 revert d3496f1 与 def035b。
环境：Windows Server 2022 Datacenter 10.0.20348；Intel Xeon Platinum，4 核 / 8 逻辑处理器；Node v24.19.0；pnpm 10.13.1；Electron 43.1.1
实验开关：window.__pandaPreviewDiagnostics.frameTraceEnabled === true；默认关闭；未注入该开关时不发逐帧事件、不计读/解码时间、不额外读取图像。
OWNER 真 com8 流畅度：OWNER_SMOOTHNESS_FAIL / WAIVED_FOR_MERGE；本提交没有性能修复。
根因：ROOT_CAUSE_UNPROVEN；真人窗口上屏未测。
```

### 现有测点和本次新增事件

| 阶段 | 实际代码位置 | 观测事件 / 边界 |
| --- | --- | --- |
| 目标帧 | `ProductPreviewOverlay.tsx`、新增 `previewFrameTrace.ts` | `target-changed`；绑定 shot、实例、播放/seek generation、目标激活序号、cycle/frame/asset ID 和 `performance.now()` 请求时刻。 |
| 必需队列 / 字节 | `productPreviewImages.ts` | `required-queued`、`byte-read-start/ready/failed/discarded`；含优先级、optional 起读标记、队列等待、字节数和异步结果状态。 |
| 解码 | `stageImageResourceSession.ts` | `required-queued`、`decode-start/ready/failed/callback-discarded`；区分缓存复用、optional 在途和已过期回调。 |
| 精确帧门禁 | `StageRenderer.tsx`、`stageImageResourceSession.ts` | `stage-image-exact-ready` 是资源集合 ready；`exact-ready-commit` 是 React layout commit 后，当前 displayed frame ID 与目标一致。两者分开记录。 |
| Stage 绘制 | `StageRenderer.tsx` | `stage-paint` 记录在 `Konva.Layer.drawScene` 调用返回后，带当时 displayedFrameId；它表示 Konva 绘制边界，不等于 GPU 完成或操作系统物理上屏。 |
| 真实上屏 | 无可用 API | `physicalDisplay: NOT_OBSERVABLE`。Node 合成用例没有运行 React/Konva，故该用例的 React commit、Stage paint 和 displayedFrameId 为 `NOT_OBSERVABLE`；Electron trace 本轮 `NOT_RUN`。 |

实现只在显式诊断 sink 下启用，存储限制为最多 256 个状态、16 个活动实例、1024 个去重键、4096 个事件；每个字节/解码资源最多保留 8 个 trace 关联。默认关闭、同 trace 子/父 layout effect 顺序、同帧目标新激活序号、旧异步结果状态和 seek/双实例隔离均有定向覆盖。

### 原创合成输入和复现命令

- 输入：21 个独立 frame ID / asset ID，源速率 25 FPS，间隔 40ms，播放至 840ms 回环；单实例；字节读和解码均通过可控异步 test double 注入 20 / 60 / 100ms 延迟。帧资源是测试字节和受控解码对象，不能当成真实位图或可见帧/物理显示证据。
- 开关：集成测试显式注入 `frameTraceEnabled: true`；生产默认没有注入，不开启 trace。
- 命令：`pnpm exec vitest run --config vitest.integration.config.ts tests/integration/ap03-animation-image-prewarm.test.ts`。
- 双实例最小隔离命令：`pnpm exec vitest run --config vitest.integration.config.ts tests/integration/ap03-animation-image-prewarm.test.ts -t "minimal two-instance"`（本轮双实例用例也在上述整文件命令中执行）。

### 帧级延迟摘要

目标到字节 ready 的负数表示 optional 预读已在该帧成为目标前完成；这不是负耗时。exact-ready commit 此处是测试内 `StageImageResourceSession` 资源 ready 边界，未冒充 React/Konva commit。

| 注入延迟 | 目标→字节 ready (n; p50/p95/max ms) | 字节 ready→解码 ready (n; p50/p95/max ms) | 解码 ready→资源 exact-ready (n; p50/p95/max ms) | 目标→资源 exact-ready (n; p50/p95/max ms) | 最长模拟旧帧保持 | SUPERSEDED / PENDING |
| ---: | --- | --- | --- | --- | ---: | --- |
| 20ms | 21; -100/-100/-60 | 21; 120/120/140 | 21; 0/0/0 | 21; 20/20/20 | 20ms | 0 / 0 |
| 60ms | 21; -60/-60/-60 | 1; 120/120/120 | 1; 0/0/0 | 1; 60/60/60 | 800ms | 20 / 0 |
| 100ms | 12; 0/100/100 | 2; 100/100/100 | 1; 0/0/0 | 1; 200/200/200 | 800ms | 20 / 0 |

每档共 22 个 target 事件（初始目标 + 21 次 40ms 边界），覆盖 21 个不同 frame ID 和 cycle 回绕。资源 exact-ready commit 总数（含初始帧）为 22 / 2 / 2；播放目标的 commit 样本数为 21 / 1 / 1。60/100ms 档的 p50/p95/max 只有一个成功 commit 样本，不能代表全部目标帧。受控延迟下 20ms 档提交每个播放目标；60/100ms 档有 20 个目标被替代，模拟旧帧持续到 840ms 循环结束，最长 800ms。

同一条 20ms 帧样本的关联键为 `instanceId=70000000-0000-4000-8000-000000000021`、`playbackGeneration=9660`、`seekGeneration=0`、`cycleIndex=0`、`frameIndex=1`、`targetFrameId=70000000-0000-4000-8000-000000000001:frame-1`、`targetAssetId=81000000-0000-4000-8000-000000000002`；该 trace 的字节预读先于目标 80ms 开始、目标前 60ms ready、目标后 0ms 开始解码、20ms 解码 ready 并到达测试资源 exact-ready。慢档晚到的 byte/decode 结果保留 `SUPERSEDED`，不归到新目标。

双实例最小检查：PASS；两实例 instance/asset/trace 身份隔离；A 的 seek generation 改变生成新 trace 并只 supersede A 的旧 trace。未扩展成多实例性能测试。

### 定向验证和限制

- `pnpm typecheck`：PASS。
- `pnpm lint`：PASS。
- 四个相关单测文件（frame trace、preview images、stage image resource session、preview overlay）：95 tests PASS。
- AP03 集成文件：6 tests PASS。
- `pnpm build`：PASS；输出既有空 CSS import 和 bundle 体积提示。
- 事件排序断言首轮用 fake timer 的毫秒时间比较时失败（同毫秒事件无法确定先后）；改为按 recorder 事件序号断言后，整文件重跑通过。没有 CI 任务由本轮手动触发。
- 自动 CI `41746647752` 因新增测试路径未登记而在 `Unknown route guard` 失败，质量 job 均跳过；文件 rename 后的自动 CI `41747478778` 仍列出 rename 对的旧路径，因此同一 guard 再次失败。按 guard 指示，在 `scripts/verification-manifest.json` 的现有 `editor-shell` route 精确登记旧测试路径，没有增加宽泛 glob、改风险等级或弱化 gate。两个路由合同文件 113 tests PASS；本地对 `R100` 的分类检查结果为 `focused` 且无 unknown path。修正后的自动 CI `41748174392`：CI policy self-test 和最终结果 PASS（workflow YAML、路由/manifest 合同、typecheck、lint、diff whitespace）；unknown guard、业务质量和 Full suite 按策略跳过。本轮没有手动 rerun 整套 CI。
- Electron 实际运行 / React Stage paint：NOT_RUN；代码里的 `Konva.Layer.drawScene` trace hook 已实现并编译，但本轮没有捕获实际 Stage paint 事件。真实 GPU/物理显示时间仍 `NOT_OBSERVABLE`。
- 无全仓 CI、`verify:project` 或外圈 verifier 扫描。诊断不会替代 OWNER 用私有 com8 素材做真实验收。

结论：`ROOT_CAUSE_UNPROVEN`。唯一下一步候选是由 OWNER 在真实 com8 预览卡顿时启用此 trace，按同一实例/帧查看等待落在字节、解码、exact-ready、Stage paint 还是观测边界，再另行授权 Phase 2。OWNER 真实流畅度仍为 FAIL。
