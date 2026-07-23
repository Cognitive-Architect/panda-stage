# Gate A — M0.5 Packaged Deterministic Export

## 结论

- Result: **PASS**
- 判定时间: 2026-07-23（Asia/Shanghai）
- 执行分支: `chore/day-10-gate-a`
- 基线 SHA: `320888ca2ffeb9466986458ba05df53e5910be5f`
- Fix pre-PR 基线 SHA: `555a7806e72eac266a6510a1ad52abe4657259b8`
- 结果 SHA: 以本回执所在提交为准
- 打包产物: `release/Panda-Stage-0.1.0-Windows-x64.exe`（本地构建产物，不入库）
- 安装包 SHA-256: `53804efb874b5e983895ad97cb331a0cfc5b0543b38629903147c28da745b759`
- 机器可读证据: [`docs/evidence/gate-a/results.json`](../evidence/gate-a/results.json)

Gate A 的全部高优先项均获得真实打包环境证据；允许进入 Day 11。本次工作仅修复 pre-PR 证据，未进入 Day 11。

## 自动化质量检查

- `pnpm typecheck`: PASS，应用与 Electron 两套 TypeScript 配置均无错误。
- `pnpm lint`: PASS，无 lint error。
- `pnpm test:unit`: PASS，14 个测试文件、97 个测试全部通过。
- `pnpm build`: PASS，由最终 `pnpm dist` 再次完整执行。
- `pnpm dist`: PASS，electron-builder 26.15.3 生成 x64 NSIS 安装包与 `win-unpacked`。
- `pnpm verify:gate-a`: PASS，Fix 最终完整复测耗时 454.8 秒。
- 格式检查: N/A；仓库未配置 Prettier 或独立格式脚本，使用现有 ESLint 门禁。

## 打包环境验证

- 应用启动: PASS；验收器直接启动 `release/win-unpacked/Panda Stage.exe`。
- FFmpeg 定位: PASS；运行时只从 `process.resourcesPath/media` 解析 `ffmpeg.exe` 与 `ffprobe.exe`。
- 是否依赖全局 Node/pnpm/FFmpeg: 否；子进程 PATH 被收窄为 Windows `System32`，并移除全部开发态媒体路径变量。
- Unicode 路径: PASS；项目快照、输出目录及三个 MP4 均包含中文、空格和 emoji。
- 取消与清理: PASS；打包应用在渲染阶段取消一次，状态为 `cancelled`，随后活动 Job、FFmpeg 进程、帧目录和暂存输出均为 0，并立即完成三次导出。
- 资源缺失: PASS；受控缺失 FFmpeg 时退出码为 1，错误明确指出缺失路径并建议重新安装完整分发包。
- 实际播放: PASS；打包 Electron/Chromium 的 `HTMLVideoElement` 加载 Run 1，等待 `loadedmetadata` 后实际调用 `play()`。视频为 1920×1080、3.4 秒、非静音，`currentTime` 从 0 推进到 0.61126 秒。

## 三次导出对比

三次均使用配置/项目快照 SHA-256 `c47d81e308ca9f1c2a4b0fbd88efc7d0dc6a1e43ee407df73cd9b957e6e377db`。

| 项目 | Run 1 | Run 2 | Run 3 | 是否一致 |
|---|---|---|---|---|
| 帧数 | 72 | 72 | 72 | 是 |
| 视频时长 | 3.000 s | 3.000 s | 3.000 s | 是 |
| 容器时长 | 3.400 s | 3.400 s | 3.400 s | 是 |
| 视频编码 | H.264 / yuv420p / 1920×1080 / 24 fps | 同左 | 同左 | 是 |
| 音频编码 | AAC / 48 kHz / mono | 同左 | 同左 | 是 |
| 字幕时点 | 帧 0/24/48/71 使用同一确定性 cue 结果 | 同左 | 同左 | 是 |
| 音频起点 | 0.400646 s | 0.400646 s | 0.400646 s | 是 |
| MP4 SHA-256 | `41ae598f…da400` | `41ae598f…da400` | `41ae598f…da400` | 是 |

三个 MP4 保存在 `docs/evidence/gate-a/打包输出 中文 空格 🐼/三次 导出 🎬/`。

## 关键帧比较

### Export-to-export determinism

此项只证明三次导出确定性，不用于替代预览一致性。用打包内 FFmpeg 将 Run 1/2/3 的帧 0、24、48、71 解码为 1920×1080 RGB24；任一通道绝对差值大于 0 即计为差异像素。

| 帧 | Run1↔Run2 差异 | Run1↔Run3 差异 | 阈值 | 结果 |
|---|---:|---:|---:|---|
| 0 | 0 / 2,073,600（0.000000%） | 0 / 2,073,600（0.000000%） | <1% | PASS |
| 24 | 0 / 2,073,600（0.000000%） | 0 / 2,073,600（0.000000%） | <1% | PASS |
| 48 | 0 / 2,073,600（0.000000%） | 0 / 2,073,600（0.000000%） | <1% | PASS |
| Last（71） | 0 / 2,073,600（0.000000%） | 0 / 2,073,600（0.000000%） | <1% | PASS |

### Preview-to-export parity

预览来源是最终打包应用主窗口内的 `StagePreview → CanvasStage → StageRenderer` Canvas。Gate 专用时间请求只在 `?gateA=1` 的主预览页面生效，将同一项目快照固定在帧 0、24、48、71；随后直接从主预览 DOM 中的 1920×1080 Canvas 生成 PNG。没有使用隐藏导出 Renderer、原始导出 PNG 或 Run 1 MP4 冒充预览。

比较时，主预览 PNG 与三个 MP4 对应帧分别统一解码为 RGB24。考虑 H.264/yuv420p 有损编码，若像素任一通道绝对差值 **大于 16**，该像素才计为 changed；`ratio = changedPixels / 2,073,600`，门槛为严格 `<1%`。以下每个数值在 Run 1/2/3 均相同：

| 帧 | 时间 | changedPixels | totalPixels | ratio | 通道容差 | 结果 |
|---|---:|---:|---:|---:|---:|---|
| 0 | 0 ms | 2,199 | 2,073,600 | 0.106047% | 16 | PASS |
| 24 | 1,000 ms | 3,362 | 2,073,600 | 0.162133% | 16 | PASS |
| 48 | 2,000 ms | 2,999 | 2,073,600 | 0.144628% | 16 | PASS |
| Last（71） | 2,958 ms | 3,624 | 2,073,600 | 0.174769% | 16 | PASS |

机器可读结果在 `comparisons.exportToExportDeterminism` 与 `comparisons.previewToExportParity` 中分开记录；每条 parity 记录均包含 `changedPixels`、`totalPixels`、`ratio`、`channelTolerance`、预览来源和导出 Run。

## FFmpeg 来源与许可

- `ffmpeg.exe`: `@ffmpeg-installer/win32-x64@4.1.0`，包声明 GPLv3，版本 `N-92722-gf22fcd4483`，构建启用 `--enable-gpl --enable-version3 --enable-libx264`。
- `ffprobe.exe`: `@ffprobe-installer/win32-x64@5.1.0`，包声明 GPL-3.0，版本 `2023-02-13-git-2296078397`。
- 精确包版本与 integrity 位于 `pnpm-lock.yaml`；二进制 SHA-256 位于 Gate JSON。
- 分发包内包含 `resources/licenses/FFMPEG-NOTICE.txt`，记录包、版本、源提交、FFmpeg 官方源码/法律页与 GPLv3 文本入口。
- Gate 只验证来源与许可可追溯性，不替代正式发行前的法律审查或代码签名。

## Gate 条款

- [x] 主窗口预览与三次导出关键帧差异均 <1%（最大 0.174769%）
- [x] 三次导出关键帧两两一致（最大差异 0）
- [x] 三次导出帧数完全一致
- [x] 三次关键位置和字幕时点一致
- [x] 音频同步
- [x] Unicode 路径成功
- [x] 取消清理成功
- [x] 取消后可再次导出
- [x] 打包应用可独立导出
- [x] 打包 Electron/Chromium 实际播放成功且时间推进
- [x] FFmpeg 缺失错误清晰且可行动
- [x] Gate 结论只有 PASS

## 刀刃表结果

FUNC-001～004、CONST-001～004、NEG-001～004、UX-001～002、E2E-001 与 HIGH-001 均为 PASS。安装包未执行交互式安装，以等价的 `win-unpacked` 可分发产物完成非开发启动；NSIS 安装包已成功生成并记录哈希。

## 债务与未验证项

- DEBT-TEST-B10-001: 无。
- DEBT-PACKAGING-B10-001: 无 Gate 阻塞；图标、代码签名、更新与安装器美化明确不在 Day 10 范围。
- DEBT-LICENSE-B10-001: 无 Gate 阻塞；正式对外发行前仍应进行常规法律复核。

## 决策

**PASS：允许进入 Day 11。**
