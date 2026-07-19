# Panda Stage Agent Task — Day 35

> **工单编号**：B-35/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 35  
> **分支建议**：`chore/day-35-gate-c`  
> **任务类型**：核心技术验收 + 重复导出 + 一致性 Gate  
> **唯一目标**：使用 Day 30 的约 30 秒内部 Alpha 项目完成生产级 MP4 导出，验证 1920×1080、24 FPS、H.264 + AAC、预览/导出关键帧一致、三次导出时序一致、音频漂移、中文路径、取消清理、导出时间与峰值内存，并给出唯一 PASS/FAIL 结论。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Gate C — Deterministic 30-Second Production MP4 Export
- **轰炸目标**：对 Day 30 项目执行三次完整导出、关键帧对比、音频同步验证、中文路径、取消恢复、性能与资源测量，关闭 MVP 核心导出 Gate。
- **任务性质**：端到端验收 + 性能测量 + 止损决策
- **输入基线**：Gate B 必须 PASS；Day 31～34 的 snapshot、调度、混音、取消、日志与恢复全部完成；Day 30 项目和素材权利明确。
- **输出要求**：真实 MP4 + ffprobe 报告 + 关键帧差异报告 + 三次导出对照 + 漂移/时间/内存数据 + `docs/test-receipts/GATE-C.md` + 唯一 PASS/FAIL。
- **通用铁律**：
  1. Gate B 非 PASS 或 Day 31～34 任一高风险项未闭环时停止。
  2. Gate C 只能输出 `PASS` 或 `FAIL`，禁止“基本通过”“肉眼差不多”。
  3. 所有分辨率、帧率、编码、时长、漂移、耗时、内存和差异数据必须来自真实工具或可复现测量。
  4. 三次导出必须使用同一冻结项目与同一输出配置，不能中途修改项目美化结果。
  5. 任一高优先验收失败时冻结 M6，不得跳到 Day 36 继续做演示和打包。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | Gate B 为 PASS；Day 31～34 回执存在且高风险项通过 | Gate/回执文件 | 必须 |
| 测试项目 | 使用 Day 30 原始约 30 秒项目，不修改代码或手改 JSON | 项目路径、hash、素材清单 | 必须 |
| 目标范围 | 只做 Gate C 验收、必要 P0 最小修复、回归测试与文档 | `git diff --name-only` | 必须 |
| 目标结果 | MP4 正常播放；1920×1080/24 FPS/H.264+AAC；关键帧差异 <1%；三次一致；漂移达标；取消清理；性能有证据 | ffprobe/image diff/timing/memory evidence | 必须 |
| 技术约束 | 三次相同 snapshot/config；抽查帧索引 0、30、300、最后一帧；中文输出路径；取消后重新成功；日志与产物可追溯 | 操作与工具输出 | 必须 |
| 风险边界 | 不新增编辑功能；不更换项目内容；不降低分辨率/FPS；不跳过音频；不引入 AI/TTS/云功能 | diff 审查 | 必须 |
| 测试基线 | 全量默认门禁 + 导出 integration + 桌面实测 | 命令输出 | 必须 |
| 文档同步 | 创建 `docs/test-receipts/GATE-C.md`；FAIL 时创建 `docs/decisions/M5-FAILURE-REPORT.md` | 文档 diff | 必须 |
| 历史债务 | 汇总 Gate A/B 与 Day 31～34 全部相关 debt，不能在 Gate 文档中消失 | 回执对照表 | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | Gate C 是 MVP 核心技术验收；预览与导出共享 evaluator/renderer；输出目标固定。 |
| 待确认问题 | 当前截图差异工具；音频漂移测量方法；峰值内存采样方式；5 倍实时的计时口径。 |
| 预期输出 | 一组可以让第三方复现并独立判断 PASS/FAIL 的证据包。 |
| 停止条件 | 三次导出、关键帧、ffprobe、漂移、取消、中文路径、耗时和内存全部有数据。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-35/45
- **角色**：Engineer
- **依赖关系**：依赖 Gate B PASS 与 Day 31～34；Gate C FAIL 时冻结 Day 36～45 实际开发。

### 输出交付物

- **必须产出**：
  - 三个使用同一项目/config 生成的 MP4；
  - 每个产物的 SHA-256、文件大小与 ffprobe JSON；
  - 预览关键帧截图与导出帧截图；
  - 帧索引 0、30、300、最后一帧的差异报告；
  - 三次导出的帧数、时长、关键状态与音频时点对照；
  - 中文 + 空格输出路径结果；
  - 一次中途取消及清理证据；
  - 取消后重新成功导出证据；
  - 导出耗时与峰值内存记录；
  - `docs/test-receipts/GATE-C.md`；
  - FAIL 时 `docs/decisions/M5-FAILURE-REPORT.md`。
- **验收流程**：
  1. 固定 Day 30 项目 hash 与 export config；
  2. 运行自动化质量门禁；
  3. 导出 Run A；
  4. 导出 Run B；
  5. 执行一次开始→取消→残留检查；
  6. 导出 Run C；
  7. 对三个 MP4 执行 ffprobe；
  8. 提取并比较指定关键帧；
  9. 测量音频起点与末尾漂移；
  10. 记录每次耗时和峰值内存；
  11. 汇总结论与 debt。
- **必须包含**：
  - 分辨率 1920×1080；
  - 固定 24 FPS；
  - H.264 视频流与 AAC 音频流；
  - 约 30 秒时长与预期帧数一致；
  - 关键帧差异 <1%，差异算法和阈值写清；
  - 三次导出帧数完全一致；
  - 三次导出角色位置、字幕、表情和音频时点一致；
  - 中文空格输出路径成功；
  - 取消后无 FFmpeg、隐藏窗口、临时目录和半成品残留；
  - 取消后可重新成功导出；
  - 音频漂移达到 Day 33/Gate C 标准；
  - 导出时间不超过 5 倍实时，或给出明确瓶颈证据并按 Gate 标准判定；
  - 峰值内存来自真实采样；
  - Gate 结论唯一。
- **禁止包含**：
  - 为让差异变小修改项目或截图尺寸；
  - 只肉眼观察、不做工具对比；
  - 只导出一次就声称确定性；
  - 取消后不检查进程和目录；
  - 用估算替代耗时、内存或漂移数据；
  - 门禁失败仍判 PASS；
  - Gate FAIL 后继续 M6；
  - 顺手新增功能或大重构。
- **交付证明**：原始命令输出、产物 hash、ffprobe、关键帧文件、差异报告、进程/临时目录检查、计时与内存日志、完整 Gate C 回执。

### 规模与复杂度观察

- 本日以验收为主，只允许修复阻塞 Gate 的最小 P0；每个修复必须有复现、测试、独立提交与前后证据。
- 图像差异使用固定同尺寸像素算法；禁止后处理缩放、模糊或裁剪掩盖差异。
- 三次输出文件字节 hash 不要求完全相同，因为容器元数据可能不同；确定性验收看帧数、关键帧、事件时点与音频时序。若要求字节级一致，必须先明确容器元数据策略。
- 性能测量必须声明机器配置、采样方式和计时边界。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | Gate FAIL |
| TYPE | 类型检查通过 | `pnpm typecheck` | Gate FAIL |
| FMT | 格式检查通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | Gate FAIL |
| TEST | unit、integration 与导出回归通过 | `pnpm test:unit` + 仓库实际 integration 命令 | Gate FAIL |
| ARCH | 固定 snapshot/config，预览/导出共享 evaluator/renderer | 代码与回执证据 | Gate FAIL |
| REAL | 三次真实导出、取消、中文路径、性能测量 | 产物与系统证据 | Gate FAIL |
| DOC | Gate C 回执完整且结论唯一 | `docs/test-receipts/GATE-C.md` | Gate FAIL |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | 约 30 秒 MP4 可正常播放 | player/ffprobe evidence | [ ] |
| FUNC | FUNC-002 | 1920×1080、24 FPS、H.264 + AAC | ffprobe JSON | [ ] |
| FUNC | FUNC-003 | 三次导出完成且帧数一致 | run comparison | [ ] |
| FUNC | FUNC-004 | 中文空格路径成功 | output evidence | [ ] |
| CONST | CONST-001 | 三次使用同一项目 hash/config | hash/config record | [ ] |
| CONST | CONST-002 | 预览与导出共享 evaluator/renderer | call-site evidence | [ ] |
| CONST | CONST-003 | 指定关键帧差异 <1% | image diff report | [ ] |
| CONST | CONST-004 | 结果数字均有来源命令 | receipt audit | [ ] |
| NEG | NEG-001 | 中途取消无残留 | process/file report | [ ] |
| NEG | NEG-002 | 取消后再次成功导出 | Run C evidence | [ ] |
| NEG | NEG-003 | 三次音频时点无异常偏移 | timing comparison | [ ] |
| NEG | NEG-004 | 失败/瓶颈未被隐藏 | debt/failure table | [ ] |
| UX | UX-001 | 导出进度与成功产物路径清楚 | UI/recording | [ ] |
| UX | UX-002 | 错误/取消后下一步明确 | UI evidence | [ ] |
| E2E | E2E-001 | Day 30 项目→三次导出→验收报告 | complete evidence pack | [ ] |
| High | HIGH-001 | 漂移、耗时、峰值内存达到标准或诚实 FAIL | measured report | [ ] |

---

## 【模块3-B】地狱红线

1. Gate B 非 PASS 仍执行 Gate C → 停止。
2. 只导出一次就判确定性 → Gate FAIL。
3. 关键帧只靠肉眼比较 → Gate FAIL。
4. 为通过差异阈值修改项目、缩放或模糊截图 → 严重违规。
5. ffprobe 未验证编码参数仍判 PASS → Gate FAIL。
6. 取消后未检查进程/窗口/temp → Gate FAIL。
7. 漂移、耗时或内存使用估算值 → 严重违规。
8. 自动化门禁失败仍判 PASS → Gate FAIL。
9. Gate FAIL 后继续 Day 36 → 严重违规。
10. 隐藏失败结果或 debt → 严重违规。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 三次 MP4 的编码、帧数和播放是否合格？ | [ ] | CF-B35-001 |
| RG | Gate A/B 与 Day 31～34 是否完整回归？ | [ ] | RG-B35-001 |
| NG | 中文路径、取消、残留和再次导出是否覆盖？ | [ ] | NG-B35-001 |
| UX | 进度、错误和产物位置是否可理解？ | [ ] | UX-B35-001 |
| E2E | 项目到三次产物和报告是否完整？ | [ ] | E2E-B35-001 |
| High | 差异、漂移、耗时和内存是否真实测量？ | [ ] | HIGH-B35-001 |
| 字段完整性 | Gate 回执是否链接所有产物和原始报告？ | [ ] | GATE-C.md |
| 需求映射 | 是否逐条覆盖 Gate C 条款？ | [ ] | 刀刃表 |
| 自测执行 | 是否实际播放三个文件并抽查帧？ | [ ] | 操作证据 |
| 范围边界与债务 | 瓶颈与未验证项是否完整申报？ | [ ] | 债务章节 |

---

## 【模块5】收卷格式

```markdown
# Gate C — Deterministic 30-Second Production MP4 Export

## 结论
- Result: PASS / FAIL
- 执行分支: `chore/day-35-gate-c`
- 基线 SHA:
- 结果 SHA:
- Gate B: PASS（证据路径）
- 测试机器与系统:

## 固定输入
- Day 30 项目路径:
- project.json SHA-256:
- ExportSnapshot 摘要/hash:
- 输出配置:
- 预期 durationMs:
- 预期 totalFrames:

## 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration tests:
- `pnpm build`:
- CI:

## 三次导出
| Run | 输出路径 | 文件 SHA-256 | 大小 | 帧数 | 时长 | 耗时 | 峰值内存 | 结果 |
|---|---|---|---|---|---|---|---|---|
| A | | | | | | | | |
| B | | | | | | | | |
| C | | | | | | | | |

## ffprobe 验收
| Run | 分辨率 | FPS | Video codec | Audio codec | Sample rate | 时长 | 结果 |
|---|---|---|---|---|---|---|---|
| A | | | | | | | |
| B | | | | | | | |
| C | | | | | | | |

## 关键帧差异
| 帧索引 | 时间 | 预览截图 | 导出帧 | 差异百分比 | 阈值 | 结果 |
|---|---|---|---|---|---|---|
| 0 | | | | | <1% | |
| 30 | | | | | <1% | |
| 300 | | | | | <1% | |
| 最后一帧 | | | | | <1% | |

## 音频与确定性
- Run A/B/C 音频起点:
- 末尾漂移:
- 角色位置/字幕/表情时点对照:
- 三次是否一致:

## 中文路径与取消
- 中文输出路径:
- 完整导出结果:
- 取消发生阶段/帧:
- FFmpeg 残留:
- 隐藏窗口残留:
- temp/半成品残留:
- 取消后再次导出:

## 性能
- 实时长度:
- Run A/B/C 倍实时:
- 峰值内存采样方法:
- 是否满足 ≤5 倍实时:
- 瓶颈证据:

## 债务与未验证项
- Gate A/B 继承 debt:
- Day 31～34 继承 debt:
- DEBT-PERF-B35-001:
- DEBT-TEST-B35-001:

## 决策
- PASS：允许进入 Day 36。
- FAIL：冻结 Day 36～45 的实际开发，只允许修复 M5，并创建 `docs/decisions/M5-FAILURE-REPORT.md`。
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| GATE-B35-001 | Gate B 或 Day 31～34 高风险项未通过 | 不执行 Gate C | 阻塞 |
| DIFF-B35-001 | 任一关键帧差异 ≥1% | 定位共享 evaluator/renderer/字体问题 | Gate FAIL |
| SYNC-B35-001 | 音频漂移不达标 | 修音频时间与 mux | Gate FAIL |
| CLEANUP-B35-001 | 取消有任何残留 | 修取消清理 | Gate FAIL |
| PERF-B35-001 | 导出 >5 倍实时且无明确瓶颈证据 | 补测量/优化后复验 | Gate FAIL |
| EVIDENCE-B35-001 | 缺任一原始产物/报告 | 不得 PASS | Gate FAIL |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 35：Gate C — Deterministic 30-Second Production MP4 Export**！

验收铁律：同一输入三次导出；1920×1080、24 FPS、H.264 + AAC；关键帧差异 <1%；音频同步；中文路径成功；取消零残留并可重试；耗时与内存真实测量；结论只能 PASS 或 FAIL。

Ouroboros 闭环启动，**B-35/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm dev
ffmpeg -version
ffprobe -v error -print_format json -show_streams -show_format "<output.mp4>"
certutil -hashfile "<output.mp4>" SHA256
git diff --stat
git log --oneline -n 35
```
