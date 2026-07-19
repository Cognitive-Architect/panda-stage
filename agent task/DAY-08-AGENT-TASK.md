# Panda Stage Agent Task — Day 08

> **工单编号**：B-08/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 8  
> **分支建议**：`spike/day-08-audio-mux`  
> **任务类型**：功能开发 + 音画同步验证  
> **唯一目标**：把探针 WAV 与 Day 7 静音视频合成为 H.264 + AAC MP4，并验证音频起点、结尾和重复导出时点一致。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：AAC 音频编码 + 探针音画合成 + 同步验证
- **轰炸目标**：扩展 FFmpegAdapter，使单条 WAV 按配置的 `startMs` 延迟后与静音视频合成，输出标准 H.264 + AAC MP4。
- **任务性质**：功能开发 + 媒体同步验证
- **输入基线**：Day 7 已生成符合 1080p / 24 FPS / H.264 / yuv420p 的静音 MP4；Day 5 探针包含自制或许可清晰的 WAV。
- **输出要求**：真实含声 MP4 + ffprobe 证据 + 起点/结尾验证 + 错误音频负面路径 + 结构化收卷。
- **通用铁律**：
  1. 不允许通过拉伸音频掩盖时长问题。
  2. 音频延迟必须来自数据中的整数毫秒，不得手写魔法偏移。
  3. 必须保留 Day 7 的安全进程调用方式，不使用 shell 拼接。
  4. 同一项目重复导出，音频起点必须一致。
  5. 本日只完成单音轨探针；多轨混音留到 Day 33。

---

## 【模块2】输入基线（完整技术背景）

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 执行前记录分支与 HEAD | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| 前置能力 | Day 7 静音 MP4 可播放且 ffprobe 参数达标 | Day 7 回执 + ffprobe 报告 | 必须 |
| 音频输入 | 探针 WAV 来源与许可明确，可读取，时长已知 | `ffprobe` 或当前元数据工具 | 必须 |
| 目标范围 | `FFmpegAdapter`、导出配置类型、必要测试、`docs/ffmpeg.md`、Day 8 回执 | `git diff --name-only` | 必须 |
| 目标结果 | 输出同时包含 H.264 视频流和 AAC 音频流；音频按 `startMs` 进入；结尾不异常截断 | ffprobe + 播放/波形证据 | 必须 |
| 技术约束 | 时间字段使用整数毫秒；为后续 `adelay` / `amix` 预留接口但不做多轨；不隐式 time-stretch | 代码与测试 | 必须 |
| 风险边界 | 不实现 BGM/SFX 混音；不做音量自动归一化；不做音频编辑器；不引入云 TTS | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁当前结果 | `pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm build` | 必须 |
| 文档同步 | 更新 `docs/ffmpeg.md`、新建 `docs/test-receipts/DAY-08.md` | 文档 diff | 必须 |
| 历史债务 | 若 Day 7 仍依赖外部临时命令脚本，先收敛进 Adapter，不得复制第二套调用逻辑 | diff 与决策记录 | 按需 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | 视频固定 24 FPS；输入音频为 WAV；输出要求 AAC。 |
| 待确认问题 | FFmpeg filter graph 的最小表达；结尾采用 shortest、pad 或显式 duration 的策略；同步证据如何稳定复现。 |
| 预期输出 | 单音轨延迟与 mux 能力，为后续多轨接口留清晰扩展点。 |
| 停止条件 | 单条 WAV 在指定时间进入、输出双流正确、坏音频可恢复，即可收卷。 |

---

## 【模块3】工单矩阵（通用高压版）

### 1）基础信息

- **工单编号**：B-08/45
- **角色**：Engineer
- **目标**：实现单音轨 AAC 合成并验证音画同步。
- **依赖关系**：依赖 Day 7 静音视频编码；无并行依赖。

### 2）输出交付物

- **预计变更文件**：
  - `electron/main/services/FFmpegAdapter.ts`
  - `shared/export-types.ts` 或当前导出配置文件
  - 必要单元/集成测试
  - `docs/ffmpeg.md`
  - `docs/test-receipts/DAY-08.md`
- **核心修改点**：
  - 接收音频路径、`startMs`、目标输出路径；
  - WAV 编码 AAC；
  - 使用参数数组构造延迟与 mux；
  - 明确输出时长策略；
  - 捕获损坏音频、缺失音频、不可解码音频错误；
  - 记录 ffprobe 与手动同步证据。
- **必须包含**：
  - 视频流 H.264；
  - 音频流 AAC；
  - `startMs=0` 标准路径；
  - 非零 `startMs` 延迟路径；
  - 错误音频不会让应用无响应；
  - 重复导出至少 3 次，起点一致。
- **禁止包含**：
  - 音频拉伸；
  - 多轨 `amix` 完整实现；
  - 云端音频服务；
  - shell 字符串拼接；
  - 静默吞掉解码错误。
- **交付证明**：含声 MP4、ffprobe 报告、起点证据、错误输入测试、默认质量门禁。

### 3）规模与复杂度观察

- 延迟、编码、mux 参数构造应独立可测，但不新增通用媒体框架。
- 若结尾策略需要补静音或截断，必须记录为何选择，并提供边界测试。
- 若同步只能靠主观听感，必须声明 `DEBT-TEST-B08-001`；至少补波形、时间戳或帧级可复现证据。

### 4）自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 不通过后果 |
|---|---|---|---|
| BUILD | 构建通过 | `pnpm build` | 返工 |
| TYPE | 类型通过 | `pnpm typecheck` | 返工 |
| FMT | 格式通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增 lint error | `pnpm lint` | 返工 |
| TEST | 延迟、双流、坏音频测试通过 | `pnpm test:unit` + 适用集成测试 | 返工 |
| ARCH | 复用现有 FFmpegAdapter，不复制 shell 调用 | `git grep -n "spawn\|exec(" -- electron/main` + diff 审查 | 返工 |
| REAL | ffprobe 显示 H.264 + AAC | `ffprobe -v error -show_streams -show_format "<输出>"` | 返工 |
| DOC | 文档和回执同步 | 文档 diff | 返工或声明债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | 检查点 ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | WAV 被编码并合成 | 真实运行 + 输出文件 | [ ] |
| FUNC | FUNC-002 | 输出包含 H.264 视频流 | ffprobe | [ ] |
| FUNC | FUNC-003 | 输出包含 AAC 音频流 | ffprobe | [ ] |
| FUNC | FUNC-004 | 非零 `startMs` 生效 | 可复现延迟样例或波形证据 | [ ] |
| CONST | CONST-001 | `startMs` 使用整数毫秒 | schema/类型测试 | [ ] |
| CONST | CONST-002 | 不隐式拉伸音频 | 参数 diff 与时长证据 | [ ] |
| CONST | CONST-003 | 复用安全参数数组调用 | 静态搜索与 diff | [ ] |
| CONST | CONST-004 | 为后续多轨保留清晰接口但不实现 | 类型/接口审查 | [ ] |
| NEG | NEG-001 | 音频文件缺失时报错 | 缺文件测试 | [ ] |
| NEG | NEG-002 | 损坏 WAV 不会卡死 | 损坏文件测试 | [ ] |
| NEG | NEG-003 | 视频不存在时终止 | 缺视频测试 | [ ] |
| NEG | NEG-004 | 输出不可写时可恢复 | 不可写路径测试 | [ ] |
| UX | UX-001 | 错误指出具体音频文件 | 错误证据 | [ ] |
| UX | UX-002 | 失败后可再次执行 | 连续失败→成功测试 | [ ] |
| E2E | E2E-001 | 帧→视频→音频→最终 MP4 全链路 | 播放 + ffprobe | [ ] |
| High | HIGH-001 | 三次导出音频起点一致 | 三份输出对比记录 | [ ] |

---

## 【模块3-B】地狱红线（10 项）

1. 通过拉伸音频“对齐”视频 → 返工。
2. 只验证有声音，不验证音频流和起点 → 返工。
3. 使用魔法延迟常量代替 `startMs` → 返工。
4. 损坏音频导致应用挂起 → 返工。
5. 复制第二套 FFmpeg 执行逻辑 → 返工。
6. 使用 shell 拼接 → 返工。
7. 顺手实现多轨混音、TTS 或音频编辑 UI → 范围失控。
8. 结尾异常截断却不申报 → 返工。
9. 三次导出不同步仍声称完成 → 返工。
10. 自动化门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测轻量检查表

| 检查点 | 自检问题 | 覆盖情况 | 相关用例 | 备注 |
|---|---|---|---|---|
| CF | 双流 MP4 是否真实生成？ | [ ] | CF-B08-001 | |
| RG | Day 7 视频编码是否未破坏？ | [ ] | RG-B08-001 | |
| NG | 缺失/损坏音频是否覆盖？ | [ ] | NG-B08-001 | |
| UX | 错误是否指出音频问题和下一步？ | [ ] | UX-B08-001 | |
| E2E | 探针完整音画链路是否跑通？ | [ ] | E2E-B08-001 | |
| High | 重复导出同步是否验证？ | [ ] | HIGH-B08-001 | |
| 字段完整性 | 回执是否记录 startMs、时长和实际结果？ | [ ] | `DAY-08.md` | |
| 需求映射 | 验证是否映射 Day 8？ | [ ] | 刀刃表 | |
| 自测执行 | 是否完整播放并检查结尾？ | [ ] | 手动证据 | |
| 范围边界与债务 | 同步证据不足是否申报？ | [ ] | 债务声明 | |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-08/45 完成并提交

### 提交信息
- Commit: `spike(export): mux synchronized AAC audio into probe video`
- 分支: `spike/day-08-audio-mux`
- 基线 SHA: `<真实输出>`
- 结果 SHA: `<真实输出>`

### 本轮目标与实际结果
- 目标: 单条 WAV 按 startMs 合成 H.264 + AAC MP4
- 实际完成: [真实结果]
- 未完成/不在范围: 多轨混音、TTS、音频编辑器

### 验证报告
- `pnpm typecheck`: [摘要]
- `pnpm lint`: [摘要]
- `pnpm test:unit`: [摘要]
- `pnpm build`: [摘要]
- ffprobe 视频流: [摘要]
- ffprobe 音频流: [摘要]
- 三次起点对比: [摘要]

### 关键决策
- DECISION-001: [延迟实现方式]
- DECISION-002: [结尾时长策略]
- DECISION-003: [错误映射策略]

### 债务声明
- DEBT-TEST-B08-001: [无 / 具体限制]
- DEBT-AUDIO-B08-001: [无 / 具体限制]

### 风险与回滚点
- 主要风险: 音频起点与结尾时长处理
- 回滚方式: `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| SYNC-B08-001 | 三次导出音频起点不一致 | 停止 Day 9，先修时间计算 | 阻塞 |
| AUDIO-B08-001 | 必须拉伸音频才能通过 | 回退设计，明确时长策略 | 返工 |
| QUALITY-B08-001 | 输出缺 AAC 或 H.264 流 | 不得收卷 | 返工 |
| TEST-B08-001 | 无法形成客观同步证据 | 可复现实测 + 债务声明 | 有条件交付 |
| ARCH-B08-001 | 需要第二套 FFmpeg 执行器 | 合并回 Adapter | 返工 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 08：AAC 音频编码 + 探针音画合成 + 同步验证**！

### 验收铁律
- 输出含 H.264 与 AAC；
- 非零 `startMs` 生效；
- 不拉伸音频；
- 坏音频可恢复；
- 三次导出起点一致；
- 默认质量门禁全通过。

Ouroboros 闭环启动，**B-08/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
ffprobe -v error -show_streams -show_format "path/to/probe-with-audio.mp4"
git diff --stat
git diff -- electron/main/services/FFmpegAdapter.ts shared/export-types.ts docs/ffmpeg.md
```
