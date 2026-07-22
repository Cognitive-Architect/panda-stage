# FFmpeg 开发期集成

## 当前范围

Day 07 把 Day 06 的连续 PNG 帧编码为 1920×1080、24 FPS、H.264 (`libx264`) 和 `yuv420p` 静音 MP4。Day 08 在同一 `FFmpegAdapter` 中增加单 WAV 延迟与 AAC 合成；不包含多轨 `amix`、音量归一化、正式导出 UI 或安装包 sidecar。

## 可执行文件发现

`FFmpegAdapter` 只存在于 Main Process，按以下顺序解析工具路径：

1. 构造函数显式传入的 `ffmpegPath` / `ffprobePath`；
2. `PANDA_STAGE_FFMPEG_PATH` / `PANDA_STAGE_FFPROBE_PATH` 环境变量；
3. PATH 中的 `ffmpeg.exe` / `ffprobe.exe`（非 Windows 为无扩展名命令）。

开发机示例：

```powershell
$env:PANDA_STAGE_FFMPEG_PATH = 'C:\tools with spaces\ffmpeg.exe'
$env:PANDA_STAGE_FFPROBE_PATH = 'C:\tools with spaces\ffprobe.exe'
pnpm verify:day07
pnpm verify:day08
```

路径作为 `spawn(executable, args)` 的独立值传递，不添加手工引号，不构造 shell 命令，也不使用 `shell:true`。

## 编码参数

真实探针使用以下等价参数数组：

```text
-y
-hide_banner
-loglevel info
-framerate 24
-start_number 0
-i <frame-directory>\frame_%06d.png
-frames:v 72
-an
-c:v libx264
-pix_fmt yuv420p
-r 24
-movflags +faststart
<output-directory>\.<output-name>.panda-stage-<uuid>.mp4
```

编码前会检查 `frame_000000.png` 起始的序列连续性、输出父目录存在且可写、FFmpeg 能读取版本，以及编码器列表包含 `libx264`。编码成功后仍需使用 `probeVideo()` / ffprobe 验证 codec、pixel format、尺寸、帧率、帧数、时长和无音轨状态。

## 单音轨 AAC 合成参数

Day 08 使用以下等价参数数组。`startMs` 由严格 Schema 保证为非负整数，并直接进入 `adelay`；不使用 `atempo` 或其他拉伸滤镜：

```text
-y
-hide_banner
-loglevel info
-i <day-07-silent-video.mp4>
-i <probe.wav>
-filter_complex [1:a:0]adelay=<per-channel-delay-list>[delayed_audio]
-map 0:v:0
-map [delayed_audio]
-c:v copy
-c:a aac
-b:a 192k
-movflags +faststart
<same-directory-uuid-temp.mp4>
```

Adapter 在构造 mux 参数前通过 `probeAudioFile()` 读取并验证正整数声道数，然后为每个声道重复同一个 `startMs`。例如 mono/400ms 为 `adelay=400`，stereo/400ms 为 `adelay=400|400`，stereo/0ms 为 `adelay=0|0`。这里不使用 `all=1`，因为当前开发期旧 FFmpeg 构建没有证明支持该选项。

结尾策略是不使用 `-shortest` 或显式 `-t`：保留完整 WAV，不截断或拉伸。若 `startMs + WAV 时长` 超过视频轨时长，MP4 容器持续到音频结束；本次 3 秒视频、3 秒 WAV、`startMs=400` 的输出包含 3.0 秒视频轨和 3.4 秒 AAC/容器时长，Chromium 播放到 3.4 秒正常结束。后续完整项目导出需根据项目时长合同另行决定末帧保持或音频裁剪策略。

`analyzeAudioTiming()` 复用同一安全进程执行器运行 `silencedetect`，形成可重复的客观起点证据；`probeAudioFile()` 和 `probeVideo()` 分别验证源 WAV 与最终双流 MP4。当前只接收单个音频输入，未实现多轨图或 `amix`。

## 输出提交与覆盖语义

FFmpeg 不直接写正式 `outputPath`，而是写入同目录、由 `randomUUID()` 区分且仍以 `.mp4` 结尾的临时文件。只有进程成功退出且临时文件是非空普通文件后，Adapter 才用同目录 `rename()` 将其提交为正式输出：

- `overwrite=false` 且正式文件已存在时，在 FFmpeg 版本检查和编码进程启动前返回 `OUTPUT_ALREADY_EXISTS`，旧文件不会被删除；提交前会再次检查，降低编码期间目标路径被占用的风险；
- `overwrite=true` 时，成功提交可替换既有正式文件；编码失败或取消只清理本轮 UUID 临时文件；
- 临时文件清理失败不会覆盖原始编码错误，附加错误保存在 `diagnostics.cleanupError`。

临时文件与正式文件位于同一目录，因此不会发生跨卷复制；典型本地文件系统上的 rename 提交可以避免先删旧文件再写新文件。平台限制是：Windows 上若目标文件被播放器、杀毒软件或其他进程以不允许删除/替换的共享模式打开，rename 会失败；网络文件系统也不保证与本地 NTFS 相同的原子性或崩溃持久性。Adapter 会保留原正式文件、清理本轮临时文件并返回 `OUTPUT_NOT_WRITABLE`，但当前没有额外的目录 `fsync` 或断电恢复日志。

## 错误与诊断

用户错误保持简短中文信息，完整执行参数、退出码、终止信号和截断后的 stderr 保存在 `FFmpegAdapterError.diagnostics`：

- `EXECUTABLE_NOT_FOUND`：工具不存在或路径错误；
- `ENCODER_UNAVAILABLE`：缺少 `libx264` 或 AAC 编码器；
- `FRAME_SEQUENCE_INVALID`：帧目录为空或序号不连续；
- `VIDEO_INPUT_INVALID`：视频输入缺失或不可读；
- `AUDIO_INPUT_INVALID`：音频输入缺失、不可读或无法解码；
- `OUTPUT_ALREADY_EXISTS`：禁止覆盖且正式输出已经存在；
- `OUTPUT_NOT_WRITABLE`：输出父目录不存在、不是目录或不可写；
- `PROCESS_FAILED`：进程启动/退出异常；
- `PROCESS_CANCELLED`：AbortSignal 触发并终止子进程；
- `PROBE_FAILED` / `PROBE_MISMATCH`：媒体信息无法解析或参数不达标。

stdout/stderr 分别限于最后 256,000 个字符，避免无限诊断输出占用内存。

## 本次开发环境来源与许可证

仓库没有提交 FFmpeg 二进制。真实验证使用 npm registry 平台包临时解包到仓库外目录：

- [`@ffmpeg-installer/win32-x64@4.1.0`](https://www.npmjs.com/package/@ffmpeg-installer/win32-x64)，registry 标注 GPLv3，来源仓库 [`kribblo/node-ffmpeg-installer`](https://github.com/kribblo/node-ffmpeg-installer)；运行版本为 `N-92722-gf22fcd4483`，配置包含 `--enable-libx264`；
- [`@ffprobe-installer/win32-x64@5.1.0`](https://www.npmjs.com/package/@ffprobe-installer/win32-x64)，registry 标注 GPL-3.0，来源仓库 [`SavageCore/node-ffprobe-installer`](https://github.com/SavageCore/node-ffprobe-installer)；运行版本为 `2023-02-13-git-2296078397`。

[FFmpeg 官方下载页](https://ffmpeg.org/download.html)将 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)列为 Windows 构建来源；本机也核验了 gyan.dev release essentials 的版本、SHA-256 与 GPLv3 声明，但因本轮网络对大文件直连/Release asset 吞吐异常，实际开发工具使用上述带 registry SRI 的平台包。后续 sidecar 打包工单必须重新选择当前、可再分发的构建并完成许可证台账，不能把本次临时工具目录直接打进安装包。Day 08 没有新增二进制；AAC 使用该 FFmpeg 构建自带的原生编码器。探针 WAV 由仓库中的 `scripts/generate-probe-audio.cjs` 以正弦波自行生成，不依赖第三方录音素材。
