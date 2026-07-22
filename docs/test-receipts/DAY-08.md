# Day 08 测试回执

## 工单坐标

- 工单：B-08/45 — AAC 音频编码 + 探针音画合成 + 同步验证
- 基线提交：`c77f3ef8b40d35af13f4771eebcce97b7f2505a9`（Day 07 合并提交）
- 实施分支：`spike/day-08-audio-mux`
- 日期：2026-07-22

本轮只实现单 WAV 合成，不包含多轨 `amix`、BGM/SFX、音量归一化、TTS、音频编辑 UI 或安装包 sidecar。

## 实现结果

- `MuxSingleAudioRequestSchema` 校验视频、WAV、MP4 输出和非负整数 `startMs`；
- `FFmpegAdapter.muxSingleAudio()` 复用 Day 07 的参数数组、`shell:false`、同目录 UUID 临时输出与安全提交逻辑；
- `adelay=<startMs>` 直接来自请求数据，视频使用 `-c:v copy` 保留 H.264，音频编码为 AAC 192 kbps；
- 不使用 `atempo`、`amix`、`-shortest` 或显式时长截断；
- 通过 ffprobe 严格断言 H.264/yuv420p/1920×1080/24 FPS 与 AAC/48 kHz/mono；
- 通过 FFmpeg `silencedetect` 客观测量声音起点；
- 缺失视频、缺失/损坏 WAV、不可写输出均返回简短中文错误，失败后可再次成功执行。

## 真实输入与来源

| 输入 | 结果 |
|---|---|
| Day 07 静音视频 | H.264、yuv420p、1920×1080、24 FPS、72 帧、3.000 秒、无音轨 |
| `preview-tone.wav` | 仓库脚本自行生成，PCM s16le、48,000 Hz、mono、3.000 秒 |

WAV 由 `scripts/generate-probe-audio.cjs` 使用正弦波生成，不含第三方录音素材。

## 真实三次合成与同步结果

配置为 `startMs=400`。三次均输出：

| 项目 | 真实结果 |
|---|---|
| 视频 | H.264 / yuv420p / 1920×1080 / 24 FPS / 72 帧 / 3.000 秒 |
| 音频 | AAC LC / 48,000 Hz / mono / 3.400 秒 |
| 容器时长 | 3.400 秒 |
| 客观声音起点 | 0.400646 秒 |
| 三次起点离散度 | 0 秒 |
| 输出大小 | 三次均为 187,040 bytes |
| SHA-256 | 三次均为 `41ae598f10b9b83f8f2f9fa60075a640bf196790cefa459c73407e9ec0cda400` |
| 单次 mux 耗时 | 187 / 181 / 184 ms |

`startMs=0` 也单独真实执行：声音起点为 0，AAC 与容器时长均为 3.000 秒。

结尾策略是保留完整 3 秒 WAV，所以 400 ms 延迟使 AAC 与容器结束于 3.4 秒；没有通过拉伸或截断掩盖时长。Chromium 以未静音状态播放，在 0.65 秒捕获画面，并正常触发 `ended` 于 3.4 秒。

## 真实执行参数

路径已脱敏，每项均作为独立参数传入：

```text
-y -hide_banner -loglevel info
-i <day-07-silent-video>
-i <probe-wav>
-filter_complex [1:a:0]adelay=400[delayed_audio]
-map 0:v:0 -map [delayed_audio]
-c:v copy -c:a aac -b:a 192k
-movflags +faststart
<verification-root>\mux output with spaces\.<uuid>.mp4
```

## 负面路径

- 缺失音频：`AUDIO_INPUT_INVALID`，消息指出 `缺失音频.wav`；
- 损坏 WAV：`AUDIO_INPUT_INVALID`，消息指出 `损坏 audio.wav`，进程正常退出且没有卡死；
- 缺失视频：`VIDEO_INPUT_INVALID`；
- 输出父路径是文件：`OUTPUT_NOT_WRITABLE`；
- 损坏 WAV 失败后，使用同一 Adapter 再次合成成功并得到 AAC 流。

## 自动化与播放证据

- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm test:unit`：12 个测试文件、71 项测试通过；
- `pnpm build`：通过；Vite 既有共享 chunk 大小警告为非阻断项；
- `pnpm verify:day03`：通过；安全 IPC 与隐藏窗口清理正常；
- `pnpm verify:day04`：通过；共享帧匹配且逻辑尺寸保持 1920×1080；
- `pnpm verify:day05`：通过；预览播放、暂停、继续、重播与结束正常；
- `$env:DAY06_FAILURE_ONLY='1'; pnpm verify:day06`：通过；模拟失败目录已清理；
- `pnpm verify:day07`：通过；重新从隐藏 Renderer 生成 72 帧并编码静音 MP4，SHA-256 仍为 `9af20958e0753708cd6e739756700515d393a64ce82a975e113447d2efc67bef`；
- `pnpm verify:day08`：通过；三次延迟合成、一次零延迟、负面路径、ffprobe、silencedetect 和 Chromium 完整播放均通过；
- 播放截图已人工检查：角色、背景和中文字幕显示正常，无黑帧或破损画面；
- Prettier：N/A，仓库未安装 Prettier，也没有对应脚本。

证据：

- [含声 MP4](../evidence/day-08/probe-with-audio.mp4)
- [Chromium 播放画面](../evidence/day-08/probe-with-audio-playback.png)
- [完整 ffprobe JSON](../evidence/day-08/ffprobe.json)
- [三次同步与负面路径结果](../evidence/day-08/results.json)

## 关键决策、债务与风险

- `DECISION-001`：延迟使用整数毫秒 `adelay`，不使用浮点偏移或魔法常量；
- `DECISION-002`：单音轨探针保留完整音频，允许容器比视频轨长 400 ms；完整项目的末帧/裁剪策略留给正式导出工单；
- `DECISION-003`：缺失输入在 spawn 前拒绝，解码错误结合 stderr 映射为具体音频错误；
- `DEBT-TEST-B08-001`：无；ffprobe、silencedetect、三次重复和 Chromium ended 形成客观证据；
- `DEBT-AUDIO-B08-001`：当前仅单 WAV，不实现多轨与完整项目时长策略；
- 环境债务：真实 FFmpeg 是开发期临时旧构建，仓库未提交二进制；后续 sidecar 必须选择当前可再分发构建并复验 AAC；
- 回滚方式：`git revert <Day 08 最终提交 SHA>`。
