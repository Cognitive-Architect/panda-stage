# Panda Stage Agent Task — Day 07

> **工单编号**：B-07/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 7  
> **分支建议**：`spike/day-07-ffmpeg-video`  
> **任务类型**：功能开发 + 外部进程安全集成  
> **唯一目标**：把 Day 6 生成的 PNG 帧序列编码成可播放的 1920×1080、24 FPS、H.264、yuv420p 静音 MP4。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：FFmpegAdapter + 静音 H.264 MP4 编码
- **轰炸目标**：在 Main Process 中以参数数组方式启动 FFmpeg，完成路径检测、版本验证、帧序列编码、stderr 捕获和用户可读错误映射。
- **任务性质**：功能开发 + 安全边界验证
- **输入基线**：Day 6 已能稳定生成 72/120 张连续 PNG 帧；本日只处理静音视频编码。
- **输出要求**：真实 MP4 + ffprobe 证据 + 失败路径 + 自动化闸门 + 债务声明。
- **通用铁律**：
  1. 禁止拼接 shell 命令字符串；必须使用可执行路径 + 参数数组。
  2. FFmpeg 只允许由 Main Process 启动，Renderer 不得直接调用子进程。
  3. 不把“进程退出码 0”当作唯一证据，必须用 ffprobe 验证视频流。
  4. FFmpeg 不存在、路径含空格、输入帧缺失都要有明确错误。
  5. 本日不合成音频，不处理正式安装包 sidecar。

---

## 【模块2】输入基线（完整技术背景，零占位符）

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 执行前记录当前分支和 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | Day 6 真实帧目录存在，3 秒 72 帧或 5 秒 120 帧，编号连续 | 目录清单 + Day 6 回执 | 必须 |
| 目标范围 | `electron/main/services/FFmpegAdapter.ts`、必要 IPC handler、`docs/ffmpeg.md`、测试文件 | `git diff --name-only` | 必须 |
| 当前缺口 | 尚无 FFmpeg 路径检测、版本检查、受控 spawn、错误映射和静音 MP4 编码 | `git grep -n "FFmpegAdapter\|ffprobe\|spawn"` | 必须 |
| 目标结果 | 从帧序列输出 H.264 / yuv420p / 24 FPS / 1920×1080 静音 MP4，时长与帧数一致 | ffprobe JSON / 文本报告 | 必须 |
| 技术约束 | 使用 `spawn` 或等价非 shell 方式；参数数组；捕获 stdout/stderr；不得 `shell:true`；路径必须支持空格 | 代码审查 + 负面测试 | 必须 |
| 风险边界 | 不合成 AAC；不做多音轨；不做完整导出 UI；不下载来源不明的 FFmpeg 二进制 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁当前结果 | `pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm build` | 必须 |
| 文档同步 | 更新 `docs/ffmpeg.md` 与 `docs/test-receipts/DAY-07.md` | 文档 diff | 必须 |
| 许可与来源 | 若仓库新增 FFmpeg 二进制，必须记录来源、版本、许可证；本日优先支持开发期路径配置 | 文件与文档证据 | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 输入为排序后的 PNG 帧；输出固定 24 FPS；目标编码 H.264 + yuv420p。 |
| 待确认问题 | 当前开发环境 FFmpeg 路径；编码器是否提供 `libx264`；ffprobe 是否同目录可用。 |
| 预期输出 | 一个不依赖 shell 字符串、可诊断、可测试的 FFmpegAdapter。 |
| 停止条件 | 静音 MP4 可播放且 ffprobe 参数准确；音频留给 Day 8。 |

---

## 【模块3】工单矩阵（通用高压版）

### 1）基础信息

- **工单编号**：B-07/45
- **角色**：Engineer
- **目标**：实现安全 FFmpeg 调用并生成标准静音 MP4。
- **依赖关系**：依赖 Day 6 帧序列；无并行依赖。

### 2）输出交付物

- **预计变更文件**：
  - `electron/main/services/FFmpegAdapter.ts`
  - `electron/main/ipc/handlers/ffmpeg.ts` 或当前 IPC 目录等价文件
  - `shared/` 下必要类型定义
  - `tests/unit/` 或 `tests/integration/` 下 FFmpeg 相关测试
  - `docs/ffmpeg.md`
  - `docs/test-receipts/DAY-07.md`
- **核心修改点**：
  - `getVersion()` / `validateExecutable()`；
  - 以参数数组编码 PNG 序列；
  - 固定输入 24 FPS、输出 H.264、`pix_fmt=yuv420p`；
  - 捕获 exit code、signal、stdout、stderr；
  - 将“未安装、无 libx264、帧缺失、输出不可写”等映射为可读错误；
  - 保存真实执行参数到回执，但避免泄露不必要的个人路径。
- **必须包含**：
  - FFmpeg 不存在测试；
  - 路径含空格测试；
  - 输入帧缺失测试；
  - ffprobe 验证分辨率、帧率、codec、pix_fmt、时长；
  - 进程异常退出后 Promise 正确 reject。
- **禁止包含**：
  - `exec("ffmpeg ...")`；
  - `shell:true`；
  - Renderer 直接 spawn；
  - 硬编码成功结果；
  - AAC、adelay、amix；
  - 自动下载未知来源二进制。
- **交付证明**：真实 MP4、ffprobe 输出、失败用例输出、默认质量门禁。

### 3）规模与复杂度观察

- Adapter 应将参数构造、进程执行、错误解析分开，但不要为了形式制造多层包装。
- 若 Windows 路径兼容导致参数处理复杂，必须记录具体原因；禁止通过引号拼接“解决”。
- 若开发环境无 `libx264`，不得静默切换编码器并声称达标；应声明 `DEBT-ENV-B07-001` 并停止 Gate。

### 4）自动化质量闸门（强制）

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增 lint error | `pnpm lint` | 返工 |
| TEST | Adapter 正常与失败路径测试通过 | `pnpm test:unit`；必要时执行 integration 脚本 | 返工 |
| ARCH | 无 shell 字符串执行 | `git grep -n "shell: true\|exec(.*ffmpeg\|execSync" -- electron src` | 返工 |
| REAL | ffprobe 验证真实输出 | `ffprobe -v error -show_streams -show_format "<真实输出>"` | 返工 |
| DOC | FFmpeg 来源/路径/错误文档更新 | 文档 diff | 返工或声明债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | 检查点 ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | FFmpeg 版本可读取 | `ffmpeg -version` 与 Adapter 输出 | [ ] |
| FUNC | FUNC-002 | 72 帧可编码为 MP4 | 真实运行 + 输出文件 | [ ] |
| FUNC | FUNC-003 | 输出为 H.264 / yuv420p | ffprobe stream 证据 | [ ] |
| FUNC | FUNC-004 | 输出固定 24 FPS / 1920×1080 | ffprobe 证据 | [ ] |
| CONST | CONST-001 | 使用参数数组而非 shell 拼接 | diff 审查 + 静态搜索 | [ ] |
| CONST | CONST-002 | 仅 Main 启动子进程 | 搜索 `spawn` 位置 | [ ] |
| CONST | CONST-003 | stderr 与 exit code 被保留 | 测试与日志 | [ ] |
| CONST | CONST-004 | 实际执行参数写入回执 | `docs/test-receipts/DAY-07.md` | [ ] |
| NEG | NEG-001 | FFmpeg 不存在时可读报错 | 配置无效路径运行 | [ ] |
| NEG | NEG-002 | 输入帧缺失时失败而非假成功 | 删除中间帧测试 | [ ] |
| NEG | NEG-003 | 输出路径不可写时明确失败 | 受控不可写目录测试 | [ ] |
| NEG | NEG-004 | 路径含空格仍可编码 | 空格路径实测 | [ ] |
| UX | UX-001 | 用户错误不直接倾倒整段 stderr | 映射结果证据 | [ ] |
| UX | UX-002 | 技术日志保留诊断信息 | 日志文件或输出摘要 | [ ] |
| E2E | E2E-001 | 帧目录→FFmpeg→可播放 MP4 | 播放截图 + ffprobe | [ ] |
| High | HIGH-001 | 未使用 `shell:true` 或命令拼接 | 静态搜索结果为空 | [ ] |

---

## 【模块3-B】地狱红线（10 项）

1. 使用 shell 字符串拼接执行 FFmpeg → 返工。
2. Renderer 直接启动 FFmpeg → 返工。
3. 输出不是 H.264/yuv420p 却声称完成 → 返工。
4. 只凭“播放器能打开”不做 ffprobe → 返工。
5. FFmpeg 不存在时应用卡死或静默失败 → 返工。
6. 路径含空格失败却未申报 → 返工。
7. 硬编码假成功或 mock 进程退出码 0 → 返工。
8. 顺手实现音频 mux、多轨或正式安装包 → 范围失控。
9. 未记录 FFmpeg 来源/版本/许可信息 → 返工或债务声明。
10. 自动化门禁失败仍提交完成 → 返工。

---

## 【模块4】P4 自测轻量检查表

| 检查点 | 自检问题 | 覆盖情况 | 相关用例 / 命令 | 备注 |
|---|---|---|---|---|
| CF | 静音 MP4 是否由真实帧编码？ | [ ] | CF-B07-001 | |
| RG | Day 6 帧序列逻辑是否未被破坏？ | [ ] | RG-B07-001 | |
| NG | 不存在、缺帧、不可写是否覆盖？ | [ ] | NG-B07-001 | |
| UX | 用户错误是否可理解？ | [ ] | UX-B07-001 | |
| E2E | PNG→MP4 是否完整跑通？ | [ ] | E2E-B07-001 | |
| High | shell 注入与路径安全是否验证？ | [ ] | HIGH-B07-001 | |
| 字段完整性 | 回执是否记录参数与真实结果？ | [ ] | `DAY-07.md` | |
| 需求映射 | 检查点是否映射 Day 7？ | [ ] | 刀刃表 | |
| 自测执行 | 是否在含空格路径至少跑一次？ | [ ] | 实测日志 | |
| 范围边界与债务 | 环境/编码器限制是否诚实申报？ | [ ] | 债务声明 | |

---

## 【模块5】收卷格式（强制结构）

```markdown
## ✅ 工单 B-07/45 完成并提交

### 提交信息
- Commit: `spike(ffmpeg): encode captured frames to H264 MP4`
- 分支: `spike/day-07-ffmpeg-video`
- 基线 SHA: `<真实输出>`
- 结果 SHA: `<真实输出>`
- 变更文件: [逐项列出]

### 本轮目标与实际结果
- 目标: PNG 帧编码为 1080p/24 FPS/H.264/yuv420p 静音 MP4
- 实际完成: [真实结果]
- 未完成/不在范围: 音频 mux、sidecar 打包、正式导出 UI

### 自动化与媒体验证
- `pnpm typecheck`: [真实摘要]
- `pnpm lint`: [真实摘要]
- `pnpm test:unit`: [真实摘要]
- `pnpm build`: [真实摘要]
- `ffmpeg -version`: [版本摘要]
- `ffprobe`: [codec / pix_fmt / size / fps / duration]

### 关键决策
- DECISION-001: [FFmpeg 路径解析方式]
- DECISION-002: [参数构造方式]
- DECISION-003: [错误映射方式]

### 债务声明
- DEBT-ENV-B07-001: [无 / 环境限制]
- DEBT-TEST-B07-001: [无 / 测试限制]

### 风险与回滚点
- 主要风险: Windows 路径与 FFmpeg 分发方式
- 回滚方式: `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| SECURITY-B07-001 | 必须使用 `shell:true` 才能运行 | 停止，改用参数数组和正确路径解析 | 返工 |
| ENV-B07-001 | 当前 FFmpeg 无 `libx264` | 记录环境证据，替换合规构建后再继续 | 阻塞 |
| QUALITY-B07-001 | ffprobe 参数不达标 | 不进入 Day 8 | 阻塞 |
| TEST-B07-001 | 无法验证失败路径 | 提供可复现实测并声明债务 | 有条件交付 |
| LICENSE-B07-001 | 二进制来源/许可不清楚 | 不提交二进制，只保留路径适配 | 阻塞分发 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 07：FFmpegAdapter + 静音 H.264 MP4 编码**！

### 验收铁律
- 参数数组启动，不使用 shell；
- ffprobe 显示 H.264、yuv420p、1920×1080、24 FPS；
- 含空格路径可用；
- FFmpeg 不存在和缺帧路径有明确错误；
- 默认质量门禁全部通过。

Ouroboros 闭环启动，**B-07/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
ffmpeg -version
ffprobe -v error -show_streams -show_format "path/to/probe-video.mp4"
git grep -n "shell: true\|execSync\|exec(.*ffmpeg" -- electron src
git diff --stat
```
