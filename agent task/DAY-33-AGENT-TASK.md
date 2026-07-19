# Panda Stage Agent Task — Day 33

> **工单编号**：B-33/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 33  
> **分支建议**：`feat/day-33-audio-mix`  
> **任务类型**：功能开发 + FFmpeg 音频图 + 最终封装  
> **唯一目标**：收集全项目对白、BGM 与 SFX，计算全局起始时间并通过 FFmpeg `adelay` / `amix` 生成同步 AAC 音轨，最终与 H.264 视频封装为 MP4。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Multi-Track Audio Delay + Mix + Final H.264/AAC Mux
- **轰炸目标**：建立音频清单、镜头内时间到项目全局时间换算、音量控制、空轨/坏轨降级、FFmpeg filter graph 与 ffprobe 验收。
- **任务性质**：功能开发 + 媒体处理 + 同步验证
- **输入基线**：Gate B PASS；Day 31 snapshot 与 Day 32 视频帧调度可用；M0.5 已证明单音轨 AAC mux；Dialogue 与 AudioClip 包含合法引用和整数毫秒时间。
- **输出要求**：对白/BGM/SFX 时间正确 + 无 BGM 可导出 + 坏音频可定位 + H.264/AAC MP4 + 60 秒漂移实测 <100 ms 或诚实 FAIL。
- **通用铁律**：
  1. 只从 ExportSnapshot 收集音频，不读取实时项目 store。
  2. 所有全局 startMs 必须由镜头前缀时长 + 镜头内 startMs 纯函数计算。
  3. FFmpeg 必须使用参数数组调用，禁止拼接 shell 字符串。
  4. 音频不得为了填满对白或项目时长而隐式拉伸。
  5. 最终产物必须由 ffprobe 验证视频流、音频流、时长和采样率。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | Gate B PASS；Day 31/32 产出；Day 8 AAC mux 与 FFmpegAdapter 可用 | 回执 + 代码搜索 | 必须 |
| 当前模型 | Dialogue、AudioClip、音量字段、Asset relativePath、project time mapping | `git grep -n "Dialogue\|AudioClip\|volume\|relativePath\|mapProjectTimeToShot\|FFmpegAdapter" -- src shared electron tests` | 必须 |
| 目标范围 | audio collector、global timing、filter graph、FFmpegAdapter、mux、测试与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 不同镜头对白按全局时间出现；BGM 不压对白；无 BGM 可导出；坏音频报具体文件；60 秒末尾漂移 <100 ms | unit/integration/ffprobe evidence | 必须 |
| 技术约束 | `adelay` / `amix`；音量归一范围明确；采样率/声道策略明确；空轨安全；命令参数数组；日志脱敏 | 代码与测试 | 必须 |
| 风险边界 | 不做可视化混音台；不做响度标准化算法；不做降噪；不做实时预览混音；不做导出 UI | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + Day 8/31/32 回归 | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-33.md`，更新 `docs/ffmpeg.md` 的 audio filter graph | 文档 diff | 必须 |
| 历史债务 | 若音量字段缺失，必须最小补 schema/migration，不得在 FFmpeg 层硬编码所有音量 | schema tests | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 对白和音效可能分布在不同镜头；BGM 可跨项目；最终要求 AAC 音轨。 |
| 待确认问题 | BGM 数据模型与循环规则；采样率/声道统一策略；无音轨时是否生成静音 AAC；amix duration/dropout 参数。 |
| 预期输出 | 可复现、可日志化、无 shell 注入风险的 FFmpeg 音频图。 |
| 停止条件 | 多镜头对白、BGM、SFX、空轨、坏轨、中文路径和 60 秒漂移全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-33/45
- **角色**：Engineer
- **依赖关系**：依赖 Day 31 snapshot、Day 32 视频流水线和 Day 8 FFmpeg 探针。

### 输出交付物

- **预计变更文件**：
  - `src/domain/export/audioTimeline.ts`
  - `electron/main/services/AudioMixService.ts`
  - `electron/main/services/FFmpegFilterGraphBuilder.ts`
  - `electron/main/services/FFmpegAdapter.ts`
  - `electron/main/services/ExportService.ts`
  - `shared/export-types.ts`
  - 对应 unit/integration tests
  - `docs/ffmpeg.md`
  - `docs/test-receipts/DAY-33.md`
- **核心修改点**：
  - 从 snapshot 收集 Dialogue 与 AudioClip；
  - 计算每条音频全局 startMs；
  - 分类 dialogue/BGM/SFX；
  - 应用各自音量；
  - 输入音频统一采样率与声道；
  - 为每轨生成 `adelay`；
  - 通过 `amix` 混合；
  - 空音轨项目安全生成最终文件或明确使用静音策略；
  - 损坏音轨在启动 FFmpeg 前或 stderr 解析后定位；
  - 与静音 H.264 视频 mux；
  - ffprobe 验证 H.264 + AAC、分辨率、帧率、采样率和时长。
- **必须包含**：
  - 两个不同镜头对白全局 startMs 测试；
  - BGM、SFX、对白音量参数测试；
  - 无 BGM 项目导出；
  - 只有视频无音频项目策略测试；
  - 损坏音频返回具体 asset/file；
  - 路径含中文和空格时参数安全；
  - 不隐式拉伸音频；
  - 多音轨 filter graph 顺序稳定；
  - 输出含 H.264 视频流与 AAC 音频流；
  - 采样率和声道符合决策；
  - 60 秒项目末尾音画漂移测量；
  - 日志只记录必要路径信息，不泄露无关本地数据。
- **禁止包含**：
  - 字符串拼接 shell 命令；
  - 读取实时 store；
  - 用 `atempo` 或重采样偷偷拉伸音频时长；
  - 坏音频导致应用无响应；
  - BGM 默认覆盖对白；
  - 提前实现混音台、响度分析、降噪或导出 UI。
- **交付证明**：audioTimeline 单测、filter graph snapshot/结构断言、FFmpeg 参数数组、ffprobe JSON、中文路径导出、60 秒音画对照与错误日志。

### 规模与复杂度观察

- “收集时间线”“构建滤镜图”“执行 FFmpeg”“验证产物”分层，禁止一个函数包办。
- filter graph 生成可使用纯函数和明确输入类型，方便单测；不要依赖 shell 转义。
- 音量策略保持最小：用户值映射到 FFmpeg volume，不在本日做自动 ducking；若 BGM 压对白，使用已定义默认音量并记录决策。
- 60 秒漂移无法达标时必须 FAIL 或声明阻塞，不能用“听起来差不多”替代数据。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式检查通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | 时间换算、filter graph、空轨、坏轨和 mux 测试通过 | unit/integration tests | 返工 |
| ARCH | snapshot 输入、参数数组调用、无隐式拉伸 | 静态检查 + command evidence | 返工 |
| REAL | 真实 H.264/AAC 文件与 60 秒漂移结果 | ffprobe + 播放/对照 | 返工 |
| DOC | FFmpeg 音频图和回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 多镜头音频全局 startMs 正确 | timeline tests | [ ] |
| FUNC | FUNC-002 | `adelay` / `amix` 图正确 | builder tests | [ ] |
| FUNC | FUNC-003 | dialogue/BGM/SFX 音量生效 | filter assertions | [ ] |
| FUNC | FUNC-004 | H.264 视频与 AAC 音轨成功 mux | ffprobe evidence | [ ] |
| CONST | CONST-001 | 只从 ExportSnapshot 收集音频 | dependency evidence | [ ] |
| CONST | CONST-002 | FFmpeg 使用参数数组 | code/spy evidence | [ ] |
| CONST | CONST-003 | 不隐式拉伸音频 | command assertion | [ ] |
| CONST | CONST-004 | filter graph 顺序稳定 | repeated builder test | [ ] |
| NEG | NEG-001 | 无 BGM 项目可导出 | integration test | [ ] |
| NEG | NEG-002 | 无任何音轨策略安全 | integration test | [ ] |
| NEG | NEG-003 | 损坏音频指出具体文件 | error test | [ ] |
| NEG | NEG-004 | 中文空格路径不破坏参数 | path test | [ ] |
| UX | UX-001 | 错误包含音频类型、素材和建议 | error evidence | [ ] |
| UX | UX-002 | 音频配置摘要可读 | receipt/log evidence | [ ] |
| E2E | E2E-001 | snapshot→混音→mux→ffprobe | complete path | [ ] |
| High | HIGH-001 | 60 秒末尾音画漂移 <100 ms | measured report | [ ] |

---

## 【模块3-B】地狱红线

1. 读取实时 store 生成音轨 → 返工。
2. 拼接 shell 命令 → 返工。
3. 隐式拉伸音频 → 返工。
4. BGM 默认压住对白 → 返工。
5. 损坏音频只报 FFmpeg 通用错误 → 返工。
6. 中文/空格路径因转义失败 → 返工。
7. 未用 ffprobe 验证流信息 → 未验证。
8. 提前实现混音台、降噪、响度分析或 UI → 范围失控。
9. 未测 60 秒漂移却声称同步达标 → 严重违规。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 延迟、混音、音量和 mux 是否完整？ | [ ] | CF-B33-001 |
| RG | Day 8 与 Day 31/32 导出链路是否保持？ | [ ] | RG-B33-001 |
| NG | 无轨、无 BGM、坏轨、中文路径是否覆盖？ | [ ] | NG-B33-001 |
| UX | 音频错误是否能指导修复？ | [ ] | UX-B33-001 |
| E2E | 完整 MP4 是否经 ffprobe 验证？ | [ ] | E2E-B33-001 |
| High | 60 秒漂移是否真实测量？ | [ ] | HIGH-B33-001 |
| 字段完整性 | 回执是否记录 filter graph、命令和 ffprobe？ | [ ] | DAY-33.md |
| 需求映射 | 是否覆盖 Day 33 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否实际播放并核对多镜头对白？ | [ ] | 操作证据 |
| 范围边界与债务 | 采样率/BGM 策略限制是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-33/45 完成并提交
- Commit: `feat(export): mix delayed dialogue BGM and SFX into AAC`
- 分支: `feat/day-33-audio-mix`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 实际结果
- 音频清单:
- 全局 startMs:
- dialogue/BGM/SFX 音量:
- filter graph:
- 空轨/无 BGM:
- 损坏音轨:
- H.264 + AAC mux:
- ffprobe:
- 60 秒漂移:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration tests:
- `pnpm build`:
- `ffmpeg -version`:
- `ffprobe`:

### 决策与债务
- DECISION-001: [采样率/声道]
- DECISION-002: [无音轨策略]
- DECISION-003: [默认音量]
- DEBT-AUDIO-B33-001:
- DEBT-TEST-B33-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| SYNC-B33-001 | 60 秒漂移 ≥100 ms | 停止并修时间/采样策略 | 阻塞 |
| COMMAND-B33-001 | 必须依赖 shell 拼接才能工作 | 重构参数数组调用 | 阻塞 |
| AUDIO-B33-001 | 混音导致对白不可辨识 | 修音量策略 | 返工 |
| PATH-B33-001 | Unicode 路径失败 | 修参数/资源解析 | 返工 |
| TEST-B33-001 | 无真实多轨 fixture 或 ffprobe | 不得收卷 | 阻塞 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 33：Multi-Track Audio Delay + Mix + Final H.264/AAC Mux**！

验收铁律：全局时间准确；参数数组安全；不拉伸音频；无 BGM 也能导出；坏轨可定位；ffprobe 显示 H.264 + AAC；60 秒漂移用真实数据验收。

Ouroboros 闭环启动，**B-33/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "AudioMixService\|FFmpegFilterGraphBuilder\|adelay\|amix\|ffprobe" -- electron src shared tests docs
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
ffmpeg -version
ffprobe -v error -show_streams -show_format "<output.mp4>"
git diff --stat
```
