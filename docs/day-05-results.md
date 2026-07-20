# Day 05 实施与验证记录

## 任务坐标

- 工单：B-05/45 — Preview Probe
- 基线提交：`46a5244252af1996e4eecda29811d627302b506f`
- 实施分支：`codex/day-05-audio-preview`
- 日期：2026-07-20

`DAILY_PLAN.md` 的旧 Day 5 条目仍描述隐藏导出窗口，但专门的 `DAY-05-AGENT-TASK.md` 将本工单定义为 AudioContext 预览探针，并明确禁止提前开发导出。本次以更具体的 Agent 工单为准，未加入任何导出 IPC、FFmpeg 或编码逻辑。

## 已交付

- 3 秒、48 kHz、单声道 PCM16 WAV 探针音频；
- AudioContext 主时钟和 Web Audio 运行时；
- 可测试的 `PreviewPlaybackEngine`；
- React `usePreviewController` 状态控制器；
- 播放、暂停、停止和重播；
- 两段互不重叠的确定性字幕及 Zod 校验；
- 动画 evaluator、字幕 evaluator 和音频共用同一整数毫秒时间；
- 重复播放前释放旧音源，活动音源数量始终不超过 1；
- 三秒 WebM 视觉证据和关键帧。

探针音频由 `scripts/generate-probe-audio.cjs` 使用正弦波合成，不包含 TTS、外部音乐或版权素材，可执行 `pnpm assets:probe-audio` 重新生成。

## 时钟链路

```text
AudioContext.currentTime
        │
        ▼
PreviewPlaybackEngine.timeMs
        ├──► evaluateShotAtTime()       ──► 角色坐标
        ├──► evaluateSubtitleAtTime()   ──► 当前字幕
        └──► AudioBufferSourceNode      ──► 扬声器输出
```

`requestAnimationFrame` 只负责读取时钟并刷新 React，不参与累计时间，因此浏览器视觉帧率变化不会成为音频和动画的时间基准。

## 自动化质量闸门

```text
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm verify:day03
pnpm verify:day04
pnpm verify:day05
```

单元测试覆盖音频资产、字幕边界、字幕重叠拒绝、音频时钟暂停/恢复、停止归零以及连续重播不叠音。当前结果为 7 个测试文件、34 项测试全部通过。

真实 Electron 验证的关键结果：

```json
{
  "initial": {
    "status": "stopped",
    "timeMs": 0,
    "activeSources": 0,
    "characterX": 430,
    "captionVisible": false
  },
  "firstPlayback": {
    "status": "playing",
    "timeMs": 480,
    "activeSources": 1,
    "clockKind": "audio-context",
    "clockState": "running",
    "captionText": "风吹过竹林，新的旅程准备出发。"
  },
  "paused": {
    "timeMs": 570,
    "timeAfter250Ms": 570,
    "activeSources": 0
  },
  "replayed": {
    "timeMs": 0,
    "activeSources": 1,
    "sourceStarts": 3,
    "sourceStops": 2
  },
  "midpoint": {
    "timeMs": 1530,
    "captionText": "每一个故事，都从勇敢迈出第一步开始。"
  },
  "completed": {
    "status": "ended",
    "timeMs": 3000,
    "activeSources": 0,
    "characterX": 1490,
    "captionVisible": false
  },
  "stopped": {
    "timeMs": 0,
    "characterX": 430
  }
}
```

暂停后等待 250 ms，预览时间仍为 570 ms；播放中重播时旧音源先停止，新音源再从 0 ms 启动。自动化全过程和 Fake AudioContext 压力测试中观察到的最大并发音源数均为 1。

## 视觉与视频证据

| 0 ms 起始帧 | 约 1500 ms 第二字幕 | 3000 ms 完成帧 |
|---|---|---|
| ![0 ms](./day-05-start.png) | ![1500 ms](./day-05-midpoint.png) | ![3000 ms](./day-05-complete.png) |

- [3 秒预览视频（WebM/VP9）](./day-05-preview.webm)
- [真实 `pnpm dev` 音画同步窗口](./day-05-dev-audio-preview.png)

WebM 在验证期间由临时 evidence harness 对已经渲染的 Canvas 录制；生成证据后该 harness 未纳入提交源码。文件为 2880×1620、148,415 字节，EBML/WebM 文件头为 `1A45DFA3`。视频不连接产品导出 API，也不包含音频编码；音频同步由真实 AudioContext 状态、活动音源计数和时钟采样结果验证。

## 真实开发窗口手测

执行 `pnpm dev`，使用真实键盘事件完成：

1. 播放至约 0.8 秒；
2. 暂停并确认画面冻结；
3. 停止并恢复 0 秒；
4. 重播至 1.61 秒；
5. 再次暂停，确认第二条字幕和角色中段位置；
6. 关闭后确认 Electron、Vite、TypeScript 相关进程剩余数量为 0。

## 未验证项与风险

- 自动化验证确认 WAV 解码、AudioContext 为 `running`、音源节点存活及时间同步；扬声器实际响度和具体硬件听感未仪器化测量；
- 视觉证据视频不复用产品逻辑进行音频封装，符合“不提前做导出”的范围限制；
- Konva 共享 chunk 仍会触发 Vite 500 kB 警告，不影响构建；
- GitHub 远端 CI 状态需在推送后确认。
