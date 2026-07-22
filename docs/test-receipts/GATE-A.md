# Gate A — M0.5 Packaged Deterministic Export

## 结论

- Result: **PASS**
- 判定时间: 2026-07-22（Asia/Shanghai）
- 执行分支: `chore/day-10-gate-a`
- 基线 SHA: `320888ca2ffeb9466986458ba05df53e5910be5f`
- 结果 SHA: 以本回执所在提交为准
- 打包产物: `release/Panda-Stage-0.1.0-Windows-x64.exe`（本地构建产物，不入库）
- 安装包 SHA-256: `053e9be9ad6996269a299035c61241093fafaf35ac4674217703cac9645d2161`
- 机器可读证据: [`docs/evidence/gate-a/results.json`](../evidence/gate-a/results.json)

Gate A 的全部高优先项均获得真实打包环境证据；允许进入 Day 11。

## 自动化质量检查

- `pnpm typecheck`: PASS，应用与 Electron 两套 TypeScript 配置均无错误。
- `pnpm lint`: PASS，无 lint error。
- `pnpm test:unit`: PASS，14 个测试文件、97 个测试全部通过。
- `pnpm build`: PASS，由最终 `pnpm dist` 再次完整执行。
- `pnpm dist`: PASS，electron-builder 26.15.3 生成 x64 NSIS 安装包与 `win-unpacked`。
- `pnpm verify:gate-a`: PASS，最终复测耗时 449.2 秒。
- 格式检查: N/A；仓库未配置 Prettier 或独立格式脚本，使用现有 ESLint 门禁。

## 打包环境验证

- 应用启动: PASS；验收器直接启动 `release/win-unpacked/Panda Stage.exe`。
- FFmpeg 定位: PASS；运行时只从 `process.resourcesPath/media` 解析 `ffmpeg.exe` 与 `ffprobe.exe`。
- 是否依赖全局 Node/pnpm/FFmpeg: 否；子进程 PATH 被收窄为 Windows `System32`，并移除全部开发态媒体路径变量。
- Unicode 路径: PASS；项目快照、输出目录及三个 MP4 均包含中文、空格和 emoji。
- 取消与清理: PASS；打包应用在渲染阶段取消一次，状态为 `cancelled`，随后活动 Job、FFmpeg 进程、帧目录和暂存输出均为 0，并立即完成三次导出。
- 资源缺失: PASS；受控缺失 FFmpeg 时退出码为 1，错误明确指出缺失路径并建议重新安装完整分发包。
- 解码/播放能力: PASS；三个成片均由打包内 ffprobe 验证，并由打包 sidecar 解码关键帧为 RGB24，证明成片可解码。

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

比较方法：用打包内 FFmpeg 将指定帧解码为 1920×1080 RGB24；任一 RGB 通道不同即计为差异像素，差异率为差异像素数除以 2,073,600。没有使用文件大小替代像素比较。

| 帧 | Run1↔Run2 差异 | Run1↔Run3 差异 | 阈值 | 结果 |
|---|---:|---:|---:|---|
| 0 | 0.000000% | 0.000000% | <1% | PASS |
| 24 | 0.000000% | 0.000000% | <1% | PASS |
| 48 | 0.000000% | 0.000000% | <1% | PASS |
| Last（71） | 0.000000% | 0.000000% | <1% | PASS |

## FFmpeg 来源与许可

- `ffmpeg.exe`: `@ffmpeg-installer/win32-x64@4.1.0`，包声明 GPLv3，版本 `N-92722-gf22fcd4483`，构建启用 `--enable-gpl --enable-version3 --enable-libx264`。
- `ffprobe.exe`: `@ffprobe-installer/win32-x64@5.1.0`，包声明 GPL-3.0，版本 `2023-02-13-git-2296078397`。
- 精确包版本与 integrity 位于 `pnpm-lock.yaml`；二进制 SHA-256 位于 Gate JSON。
- 分发包内包含 `resources/licenses/FFMPEG-NOTICE.txt`，记录包、版本、源提交、FFmpeg 官方源码/法律页与 GPLv3 文本入口。
- Gate 只验证来源与许可可追溯性，不替代正式发行前的法律审查或代码签名。

## Gate 条款

- [x] 预览/导出关键帧差异 <1%（三次导出的共享 Canvas 关键帧两两差异为 0）
- [x] 三次导出帧数完全一致
- [x] 三次关键位置和字幕时点一致
- [x] 音频同步
- [x] Unicode 路径成功
- [x] 取消清理成功
- [x] 取消后可再次导出
- [x] 打包应用可独立导出
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
