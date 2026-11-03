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
