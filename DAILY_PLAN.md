# Panda Stage 每日开发计划（Daily Plan）

> 对应路线图：[`ROADMAP.md`](./ROADMAP.md)  
> 文档版本：v1.0  
> 更新日期：2026-07-19  
> 计划长度：45 个开发工作日  
> 当前起点：空实现仓库，从 Day 1 开始  
> 开发方式：Codex 负责编码与运行命令；人类负责范围确认、看效果、做最终验收。

---

## 0. 使用规则

### 0.1 “一天”是什么意思

- 一天 = 一个可独立验收的开发会话，不一定等于自然日。
- 当天 DoD 没过，不准把状态写成完成，也不准开始下一天的新功能。
- 卡住时先缩小任务，不靠继续堆代码“把问题盖住”。
- 每天至少产出一种可见证据：运行截图、测试输出、样例 JSON、MP4、安装包或日志。

### 0.2 每天固定流程

1. 拉取最新 `main`；
2. 创建分支：`codex/day-XX-short-name`；
3. 先读 `ROADMAP.md` 和本日计划；
4. 只实现本日任务；
5. 运行本日验证命令；
6. 人工执行本日手动验收；
7. 记录证据和未验证项；
8. 提交一个范围清晰的 commit；
9. DoD 全过后再进入下一天。

### 0.3 Codex 通用派单模板

```text
Goal:
完成 DAILY_PLAN.md 的 Day XX，不扩大范围。

Context:
- 仓库：Cognitive-Architect/panda-stage
- 产品与架构约束以 ROADMAP.md 为准
- 当前分支从最新 main 创建

Constraints:
- 仅修改本日必要文件
- 不引入本日未要求的产品功能
- Renderer 禁止直接使用 fs / child_process
- 预览与导出必须复用 shared domain
- 所有时间使用整数毫秒
- 所有新增输入使用 Zod 或等价运行时校验

Done when:
逐条满足 Day XX 的 DoD，并提供真实命令输出。

Verify:
运行本日列出的全部命令；不能运行的项目必须说明原因，禁止虚报。

Report:
- 修改文件
- 实现结果
- 验证结果
- 未验证项
- 风险
- 建议 commit message
```

### 0.4 每日收工记录模板

```text
Day:
分支 / Commit:
完成内容:
自动化验证:
手动验证:
产物路径:
未验证:
下一日:
是否触发止损条件: 否 / 是（说明）
```

---

## 1. 阶段一览

| 阶段 | 开发日 | 结果 |
|---|---:|---|
| M0 工程基线 | Day 1～2 | Electron 空壳可运行、检查、测试、构建 |
| M0.5 技术探针 | Day 3～8 | 3～5 秒动画可预览并导出带音频 MP4 |
| M1 项目系统 | Day 9～14 | 新建、保存、重开、自动保存与恢复 |
| M2 素材/角色/镜头 | Day 15～20 | 真实素材可管理，角色和镜头可组织 |
| M3 画布编辑器 | Day 21～27 | 可拖拽摆位、变换、撤销和套动作 |
| M4 时间轴/预览 | Day 28～35 | 对白、字幕、声音和动作统一预览 |
| M5 视频导出 | Day 36～41 | 30 秒真实项目稳定导出 |
| M6 打包/稳定性 | Day 42～45 | Windows 安装包和演示项目可交付 |

---

# Phase M0：工程基线

## Day 1 — 初始化 Electron + React + TypeScript 工程

**目标：** 从空仓库得到第一个能启动的桌面窗口。

**任务：**

- 初始化 pnpm 工程；
- 配置 Electron、React、TypeScript、Vite；
- 建立 `src/main`、`src/preload`、`src/renderer`、`src/shared`；
- 设置 `contextIsolation=true`、`nodeIntegration=false`；
- Renderer 显示“Panda Stage — Bootstrap Ready”；
- 增加脚本：`dev`、`typecheck`、`build`；
- 固定包管理器和 Node 引擎范围；
- 更新 README 的本地启动说明。

**验证：**

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm dev
```

**DoD：**

- [ ] 桌面窗口可启动；
- [ ] 页面无白屏和控制台致命错误；
- [ ] `typecheck` 与 `build` 通过；
- [ ] Renderer 中无法直接调用 Node API；
- [ ] 新成员按 README 可启动项目。

**建议提交：** `chore: bootstrap Electron React TypeScript workspace`

---

## Day 2 — 安全 IPC、测试与 CI 基线

**目标：** 建立以后所有功能都必须经过的安全桥和质量门禁。

**任务：**

- 新建 `src/shared/ipc/channels.ts`；
- 实现最小 `app.ping()` IPC；
- Preload 暴露 `window.pandaStage.app.ping()`；
- IPC 入参/返回值加入 Zod 校验；
- 配置 ESLint、Prettier、Vitest；
- 添加至少 1 个单元测试；
- 添加 GitHub Actions：install → typecheck → lint → test → build；
- 增加脚本：`lint`、`test:unit`。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

**DoD：**

- [ ] Renderer 点击按钮可收到主进程 `pong`；
- [ ] 所有 IPC 名称只在一个文件定义；
- [ ] 无 `window.require`、无直接 `fs`；
- [ ] 本地四项门禁通过；
- [ ] CI 配置文件可被 GitHub 识别。

**建议提交：** `chore: add secure IPC test and CI baseline`

**M0 Gate：** Day 1～2 全部通过后，才能进入技术探针。

---

# Phase M0.5：核心技术探针

## Day 3 — 最小项目模型与时间轴求值器

**目标：** 用纯数据描述 3 秒画面，不先把逻辑写死在 React 组件里。

**任务：**

- 定义最小 `ProbeProjectSchema`：背景、角色、字幕、音频、move 事件；
- 所有时间使用整数毫秒；
- 实现 `evaluateProbeAtTime(project, timeMs)` 纯函数；
- 实现线性插值与 `ease-in-out`；
- 建立 3 秒内置 probe 数据；
- 为起点、中点、终点状态写单元测试。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

**DoD：**

- [ ] `timeMs=0/1500/3000` 返回确定状态；
- [ ] 连续执行结果一致；
- [ ] 求值器不依赖 DOM、Konva、Electron；
- [ ] 非法数据被 schema 拒绝。

**建议提交：** `feat(domain): add deterministic probe schema and evaluator`

---

## Day 4 — 主窗口共享 StageRenderer 预览

**目标：** 在主窗口渲染背景、透明角色、字幕和移动动画。

**任务：**

- 接入 Konva + react-konva；
- 新建共享 `StageRenderer`；
- 使用固定 1920×1080 逻辑坐标并等比显示；
- 加载 1 张背景和 1 张透明角色；
- 字幕放在底部安全区；
- 用 `requestAnimationFrame` 驱动 3 秒预览；
- 增加播放、暂停、重播按钮。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 角色从左向右移动；
- [ ] 字幕可见且不超出画布；
- [ ] 改变窗口大小不改变逻辑坐标；
- [ ] 预览组件只消费求值结果，不自行计算动画。

**建议提交：** `feat(probe): render deterministic stage preview with Konva`

---

## Day 5 — 隐藏导出窗口与共享渲染握手

**目标：** 创建隐藏 BrowserWindow，并证明它能加载同一套 `StageRenderer`。

**任务：**

- 新建 `src/export-renderer` 入口；
- Main Process 创建 `show:false` 的隐藏窗口；
- 定义 `export:load-probe`、`export:render-frame`、`export:frame-ready` IPC；
- 隐藏窗口加载 probe 项目和素材；
- 主进程请求一个指定时间点；
- 隐藏窗口渲染完成后返回 PNG 数据或捕获结果；
- 加载失败和超时返回可读错误。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 隐藏窗口不会显示在用户桌面；
- [ ] 可捕获第 0ms 和第 1500ms 帧；
- [ ] 隐藏窗口与主窗口复用相同 Renderer/Evaluator；
- [ ] 没有使用固定延时假装“渲染完成”。

**建议提交：** `feat(export): add hidden renderer frame handshake`

---

## Day 6 — 逐帧调度、背压与临时目录

**目标：** 稳定生成 3 秒 × 24 FPS 的帧序列，不把内存吃成自助餐。

**任务：**

- 实现帧时间计算；
- 实现导出 job ID 与状态；
- 创建独立临时目录；
- 主进程按帧请求隐藏窗口；
- 实现最大待写队列和背压；
- 使用流式/异步写入 PNG；
- 每帧写完及时释放 buffer；
- 输出 `frame_000000.png` 形式序列；
- 失败时保留诊断日志并清理半成品。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 3 秒项目准确生成 72 帧；
- [ ] 首尾帧时间正确；
- [ ] 帧序号无缺失、无重复；
- [ ] 内存不随帧数持续线性上涨；
- [ ] 结束后隐藏窗口可关闭。

**建议提交：** `feat(export): stream deterministic frame sequence with backpressure`

---

## Day 7 — FFmpeg 视频编码与音频合成

**目标：** 把帧序列和 1 段音频合成真正的 MP4。

**任务：**

- 增加 `FFmpegAdapter`；
- 检测开发环境 FFmpeg 路径和版本；
- PNG 序列编码为 H.264 / yuv420p；
- 音频编码为 AAC；
- 合成 MP4；
- 捕获 exit code、stderr 和取消信号；
- 把技术错误映射为用户可读错误；
- 增加 `scripts/verify-video` 或等价检查脚本。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

手动：播放输出 MP4，并检查分辨率、帧率和声音。

**DoD：**

- [ ] 输出文件可播放；
- [ ] 为 1920×1080、24 FPS、H.264 + AAC；
- [ ] 时长约 3 秒；
- [ ] 声音存在且起始无明显错位；
- [ ] FFmpeg 不存在时有清晰提示。

**建议提交：** `feat(export): encode probe frames and audio to MP4`

---

## Day 8 — 探针硬化：一致性、中文路径、取消与打包

**目标：** 让技术探针从“开发机偶尔成功”升级为可继续投资的证据。

**任务：**

- 在含中文和空格的项目/输出路径运行；
- 增加导出取消按钮与 IPC；
- 取消时关闭隐藏窗口、终止 FFmpeg、清理临时目录；
- 抽取第 0、36、71 帧，与预览截图进行像素对比；
- 配置 electron-builder 的 FFmpeg sidecar 路径；
- 构建开发安装包并测试打包后的导出；
- 写 `docs/probe-results.md`，只记录真实结果。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dist
```

**DoD：**

- [ ] 关键帧视觉差异 <1%；
- [ ] 中文路径导出成功；
- [ ] 导出可取消且无大量残留文件；
- [ ] 打包应用可发现 FFmpeg；
- [ ] 音画同步通过手动检查；
- [ ] `probe-results.md` 包含失败和未验证项。

**建议提交：** `test(probe): verify packaged export sync paths and cancellation`

**M0.5 Gate：** 任一硬条件不通过，暂停 M1，先修探针。

---

# Phase M1：项目系统

## Day 9 — ProjectSchema v1 与迁移入口

**目标：** 定义整个应用以后共同使用的项目数据合同。

**任务：**

- 定义 `ProjectSchema`、Asset、Character、Shot、Layer、Dialogue、AudioClip、TimelineEvent；
- TimelineEvent 使用 Zod discriminated union；
- 固定 `schemaVersion=1`、1920×1080、24 FPS；
- 统一 UUID；
- 定义 `migrateProject(input)`；
- 为正常、缺字段、非法事件、未来版本写测试。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

**DoD：**

- [ ] 示例项目可 parse；
- [ ] 非法 payload 被拒绝；
- [ ] 未来版本给出明确“不支持”错误；
- [ ] schema 不依赖 UI。

**建议提交：** `feat(project): define versioned project schema v1`

---

## Day 10 — FileSystemService 与原子保存

**目标：** 确保保存中断不会把项目做成一锅 JSON 糊糊。

**任务：**

- Main Process 实现受控文件系统服务；
- 新建项目目录结构；
- 实现临时文件写入 + rename 原子替换；
- 所有持久化错误标准化；
- 统一项目内相对路径和 path separator；
- 添加原子保存单元/集成测试。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

**DoD：**

- [ ] 可生成 `.pandastage` 项目目录；
- [ ] `project.json` 保存成功；
- [ ] 模拟写入失败时旧文件仍可读；
- [ ] Renderer 没有文件系统权限。

**建议提交：** `feat(project): add atomic filesystem persistence service`

---

## Day 11 — 新建、打开、保存项目 IPC

**目标：** 把项目服务接到 UI，跑通最短生命周期。

**任务：**

- 定义 `project.create/open/save` IPC；
- 所有输入运行时校验；
- 建立 EditorStore 当前项目状态；
- 添加新建、打开、保存按钮；
- 保存后更新 `updatedAt`；
- 无效项目显示错误页而非白屏。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 新建项目后可看到标题；
- [ ] 修改标题并保存；
- [ ] 关闭重开后标题保留；
- [ ] 打开坏 JSON 时有中文错误。

**建议提交：** `feat(project): connect create open and save lifecycle`

---

## Day 12 — 自动保存与异常恢复

**目标：** 降低用户因为崩溃或忘记保存而损失劳动的概率。

**任务：**

- 每 30 秒生成 recovery 快照；
- recovery 使用独立文件，不覆盖正式项目；
- 启动时比较正式文件与恢复文件时间；
- 实现恢复、忽略、删除恢复副本；
- 保存成功后清理旧恢复文件；
- 自动保存中防止并发写入。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 修改后生成恢复文件；
- [ ] 强制结束应用后重启能提示恢复；
- [ ] 恢复内容与崩溃前一致；
- [ ] 不会同时启动多个自动保存。

**建议提交：** `feat(project): add autosave recovery workflow`

---

## Day 13 — 欢迎页、最近项目与未保存提醒

**目标：** 让普通用户知道从哪里开始，并避免误关窗口丢修改。

**任务：**

- 欢迎页：新建、打开、最近项目；
- 最近项目数据存到 app data；
- 移除失效路径；
- 未保存状态 `dirty`；
- 关闭窗口时提供保存、放弃、取消；
- 菜单快捷键：新建、打开、保存、撤销、重做占位。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 最近项目可重新打开；
- [ ] 文件被移动时不会崩溃；
- [ ] 未保存关闭弹窗行为正确；
- [ ] 取消关闭后继续停留。

**建议提交：** `feat(shell): add welcome recent projects and dirty guard`

---

## Day 14 — M1 集成回归：路径、移动与迁移

**目标：** 用完整场景验证项目系统，而不是只看单个按钮。

**任务：**

- 添加 `project-lifecycle` 集成测试；
- 使用中文、空格、Unicode 路径；
- 创建→保存→移动目录→重开；
- 模拟旧 schema 迁移；
- 模拟损坏 JSON；
- 修复发现的问题；
- 在 `docs/m1-results.md` 记录证据。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

**DoD：**

- [ ] 生命周期集成测试通过；
- [ ] 项目移动后可打开；
- [ ] 中文路径可保存；
- [ ] recovery 实测通过；
- [ ] M1 未完成项被明确记录。

**建议提交：** `test(project): close M1 lifecycle recovery and path gate`

---

# Phase M2：素材、角色与镜头

## Day 15 — 素材导入服务

**目标：** 将外部文件安全复制到项目内部。

**任务：**

- 实现 `asset.import` IPC；
- 支持 PNG/JPG/MP3/WAV；
- 校验扩展名与可读取性；
- 复制到项目 `assets/`；
- 生成 UUID 和相对路径；
- 处理重名；
- 拒绝项目目录外的危险路径写入。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

**DoD：**

- [ ] 四类文件可导入；
- [ ] 导入后原文件删除不影响项目；
- [ ] 重名不会覆盖；
- [ ] 不支持格式给出清晰提示。

**建议提交：** `feat(assets): import supported files into project storage`

---

## Day 16 — 元数据、缩略图与音频时长

**目标：** 让素材库能显示有用信息，而不是一排神秘文件名。

**任务：**

- 读取图片宽高；
- 生成缩略图缓存；
- 读取音频时长；
- 可选计算文件 hash 用于重复提示；
- 缓存失败可重建；
- 缩略图和缓存不进入核心项目数据。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

**DoD：**

- [ ] 图片显示缩略图和尺寸；
- [ ] 音频显示时长；
- [ ] 缓存删除后可重建；
- [ ] 大图处理不会冻结主窗口。

**建议提交：** `feat(assets): extract metadata and generate thumbnail cache`

---

## Day 17 — 素材库 UI 与拖放导入

**目标：** 用户能看见、分类和导入自己的素材。

**任务：**

- 左侧素材库页签；
- 分类：角色图片、背景、音频；
- 文件选择和拖放导入；
- 导入进度/错误反馈；
- 缩略图网格；
- 选中素材详情；
- 空状态引导。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 拖入多个文件可导入；
- [ ] 成功和失败分别显示；
- [ ] UI 不显示项目外绝对路径；
- [ ] 重开项目后素材仍在。

**建议提交：** `feat(assets): add categorized asset library and drag import`

---

## Day 18 — 角色定义与表情管理

**目标：** 把零散图片组织成可复用角色。

**任务：**

- 创建角色定义；
- 基础表情、默认表情；
- 添加/移除表情映射；
- 配置张嘴图；
- 默认缩放与朝向；
- VoiceProfile 只建数据结构；
- 图片尺寸差异 >30% 时警告。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 可创建 1 个角色；
- [ ] 至少配置正常/震惊 2 个表情；
- [ ] 可配置张嘴图；
- [ ] 保存重开后映射正确；
- [ ] 删除被角色引用图片时有保护。

**建议提交：** `feat(characters): add expression and mouth asset definitions`

---

## Day 19 — 镜头 CRUD、排序与时长

**目标：** 建立以镜头卡片为核心的项目结构。

**任务：**

- 镜头新增、复制、删除、重命名；
- 时长最小 500ms；
- 拖拽排序；
- 当前镜头选择；
- 项目总时长计算；
- 空项目自动创建第一个镜头或明确引导。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 5 个镜头可创建；
- [ ] 拖拽排序后保存重开一致；
- [ ] 复制镜头生成新 ID；
- [ ] 删除当前镜头后选择状态正常。

**建议提交：** `feat(shots): add shot cards ordering and duration`

---

## Day 20 — 引用检查与 M2 回归

**目标：** 防止删掉仍在使用的素材，并关闭 M2 阶段。

**任务：**

- 构建素材引用索引；
- 删除素材前列出引用位置；
- 提供取消或级联处理的明确策略；
- 导入 4 类素材、创建角色、创建 5 镜头；
- 保存重开后逐项检查；
- 添加 M2 集成测试与结果文档。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

**DoD：**

- [ ] 被引用素材不会静默删除；
- [ ] 角色与镜头重开后完整；
- [ ] 5 镜头顺序正确；
- [ ] M2 集成测试通过。

**建议提交：** `test(assets): close M2 reference and persistence gate`

---

# Phase M3：画布编辑器

## Day 21 — 1920×1080 舞台与坐标转换

**目标：** 建立不会随窗口大小变化而“坐标漂移”的舞台。

**任务：**

- 画布固定逻辑尺寸；
- 计算显示缩放和偏移；
- 适应窗口、实际大小、缩放 +/-；
- 背景铺满并不可选；
- 屏幕坐标和逻辑坐标转换工具；
- 为转换写单元测试。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 960,540 始终是画布中心；
- [ ] 调整窗口尺寸后角色逻辑坐标不变；
- [ ] 背景不被误选；
- [ ] 坐标转换测试通过。

**建议提交：** `feat(canvas): add fixed logical stage and coordinate mapping`

---

## Day 22 — 素材拖入舞台与图层选择

**目标：** 用户能从素材库把角色或图片放进当前镜头。

**任务：**

- 拖拽素材到舞台；
- 显示幽灵预览；
- 松开后创建 Layer；
- 角色和普通图片分别处理；
- 点击选择、点击空白取消；
- 选中框；
- 新图层默认 zIndex。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 落点与鼠标位置一致；
- [ ] 新图层写入当前镜头；
- [ ] 选中状态唯一且稳定；
- [ ] 保存重开后图层存在。

**建议提交：** `feat(canvas): create selectable layers from asset drag drop`

---

## Day 23 — 移动、缩放、旋转、翻转与属性面板

**目标：** 完成纸片人摆位的核心交互。

**任务：**

- Konva Transformer；
- 拖动移动；
- 等比缩放；
- 旋转；
- 水平翻转；
- 属性面板显示 x/y/scale/rotation/opacity；
- 属性输入双向同步；
- 中心锚点语义保持一致。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 鼠标和数值输入都可修改；
- [ ] 翻转不改变中心位置；
- [ ] 缩放不写入图片原始尺寸；
- [ ] 保存重开后状态一致。

**建议提交：** `feat(canvas): add layer transforms and property inspector`

---

## Day 24 — 层级、锁定、删除与参考线

**目标：** 让多图层场景可管理。

**任务：**

- 上移、下移、置顶、置底；
- zIndex 归一化；
- 锁定/解锁；
- 删除选中图层；
- 画布水平/垂直中心参考线；
- 接近中心时提示，不先做复杂吸附；
- 键盘 Delete 与 Escape。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 层级顺序立即可见；
- [ ] 锁定后不能移动或删除；
- [ ] 删除后选择状态清空；
- [ ] 参考线只在需要时显示。

**建议提交：** `feat(canvas): manage layer order locks deletion and guides`

---

## Day 25 — 撤销/重做与连续操作合并

**目标：** 让用户敢动，不怕一拖错就只能重做。

**任务：**

- HistoryStore 或命令模式；
- 支持图层新增、删除、变换、层级；
- 连续拖动合并为一次历史记录；
- 默认至少 20 步；
- 新操作后清空 redo；
- 快捷键 Ctrl+Z / Ctrl+Shift+Z 或 Ctrl+Y；
- 为历史栈写单元测试。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 连续拖动 10 次，撤销 1 次回到拖动前；
- [ ] 删除可撤销；
- [ ] 重做可恢复；
- [ ] 保存操作不污染历史。

**建议提交：** `feat(history): add coalesced undo and redo commands`

---

## Day 26 — 动作预设编译器

**目标：** 用户点一下就得到可编辑的底层时间轴事件。

**任务：**

- 定义动作预设参数；
- 实现从左进入、从右进入；
- 移动到；
- 放大强调；
- 抖动；
- 表情切换；
- 淡入、淡出；
- 预设只生成 TimelineEvent，不写特殊渲染分支；
- 为预设输出写单元测试。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 每个预设生成合法事件；
- [ ] 参数可修改；
- [ ] 事件超出镜头时长会提示；
- [ ] “从左进入”预览正确。

**建议提交：** `feat(actions): compile presets into timeline events`

---

## Day 27 — M3 画布回归与持久化门禁

**目标：** 用真实操作链关闭画布阶段。

**任务：**

- 导入背景和 2 个角色；
- 摆位、缩放、翻转、改层级；
- 应用动作预设；
- 撤销/重做；
- 保存、关闭、重开；
- 修复状态丢失；
- 添加 M3 集成测试和结果文档。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

**DoD：**

- [ ] 画布状态重开后一致；
- [ ] 20 步撤销基线可用；
- [ ] 动作预设已写入项目 JSON；
- [ ] M3 结果有真实证据。

**建议提交：** `test(canvas): close M3 editing and persistence gate`

---

# Phase M4：时间轴、对白与预览

## Day 28 — 连续事件求值器

**目标：** 正式实现 move、scale、opacity 的确定性时间轴计算。

**任务：**

- `evaluateShotAtTime`；
- 事件按 layer/property 分组；
- move 计算 x/y；
- scale 计算 scaleX/scaleY；
- opacity 计算透明度；
- linear / ease-in-out；
- 事件前、事件中、事件后行为；
- 单元测试覆盖边界。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

**DoD：**

- [ ] 边界时间无 NaN；
- [ ] 同输入重复求值完全一致；
- [ ] 事件结束后保持目标值；
- [ ] 求值器仍为纯函数。

**建议提交：** `feat(timeline): evaluate continuous animation properties`

---

## Day 29 — 离散事件、冲突规则与 shake

**目标：** 完成表情、翻转、可见性与非破坏抖动。

**任务：**

- expression / flip / visibility；
- 最近 startMs 优先；
- 同时刻按 event ID 稳定排序；
- 禁止同属性连续事件重叠；
- shake 作为基础位置附加偏移；
- shake 结束回到基础值；
- 冲突与抖动单元测试。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

**DoD：**

- [ ] 冲突事件被创建层阻止；
- [ ] 旧项目冲突数据仍有确定降级规则；
- [ ] shake 不永久修改 x/y；
- [ ] 表情切换时间准确。

**建议提交：** `feat(timeline): add discrete events conflicts and non-destructive shake`

---

## Day 30 — 时间轴外壳、刻度与播放头

**目标：** 用户能看见当前镜头的时间和播放位置。

**任务：**

- 底部时间轴区域；
- 毫秒与像素换算；
- 时间刻度；
- 播放头；
- 点击/拖动跳转；
- 当前时间显示；
- 镜头时长调整后的布局更新；
- 缩放时间轴的简单控制。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 0ms 和镜头结尾映射正确；
- [ ] 拖动播放头会刷新舞台；
- [ ] 播放头不越界；
- [ ] 时间轴缩放不改变事件实际时间。

**建议提交：** `feat(timeline): add ruler and draggable playhead shell`

---

## Day 31 — 事件条编辑

**目标：** 用户能在时间轴上看见并移动动作事件。

**任务：**

- 展示 move/scale/shake/opacity/expression 事件条；
- 选中、删除；
- 拖动调整 start/end；
- 片段不越界；
- 重叠冲突即时提示；
- 时间轴操作进入撤销栈；
- 颜色由类型映射，但不把颜色写入项目数据。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 事件移动后预览变化；
- [ ] 非法重叠被阻止；
- [ ] 删除可撤销；
- [ ] 保存重开后时间正确。

**建议提交：** `feat(timeline): edit and validate animation event bars`

---

## Day 32 — 对白、音频分配与字幕引擎

**目标：** 把一句台词、一个角色、一段声音和字幕绑定起来。

**任务：**

- 对白编辑器；
- 选择说话角色；
- 输入文本；
- 分配音频；
- startMs / durationMs；
- 字幕开关；
- 字幕样式基础项；
- 自动换行与底部安全区；
- 多对白重叠时的明确显示规则。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 可创建 3 句对白；
- [ ] 时间轴显示对白片段；
- [ ] 拖动播放头时字幕正确切换；
- [ ] 超长文本不溢出画布。

**建议提交：** `feat(dialogue): add audio-linked dialogue and subtitle engine`

---

## Day 33 — AudioContext 预览时钟与播放控制

**目标：** 用音频时钟驱动画面，降低长时间预览漂移。

**任务：**

- PreviewStore；
- AudioContext 初始化和解锁；
- 播放、暂停、停止、跳转；
- 当前时间从音频时钟读取；
- `requestAnimationFrame` 只负责刷新；
- 多对白音频按 startMs 调度；
- 停止和切镜头时释放节点。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 播放、暂停、继续时间连续；
- [ ] seek 后字幕、画面、音频位置一致；
- [ ] 重复播放不叠加多个音频；
- [ ] 停止后资源被清理。

**建议提交：** `feat(preview): drive timeline playback from AudioContext clock`

---

## Day 34 — 完整项目预览与固定频率嘴巴动画

**目标：** 连续播放多个镜头，并让说话角色具备最低成本的嘴巴开合。

**任务：**

- 计算项目累计镜头时间；
- 自动切换镜头；
- “预览当前”和“预览全部”；
- 对白活跃时 8Hz 张嘴/闭嘴；
- 没有张嘴图时安全降级；
- 切镜头时停止旧音频；
- 项目结尾恢复编辑状态。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 5 个镜头连续切换；
- [ ] 对白角色嘴巴开合；
- [ ] 没有嘴图不会报错；
- [ ] 结束后可再次播放，不会多开定时器。

**建议提交：** `feat(preview): play full project with deterministic mouth animation`

---

## Day 35 — 30 秒预览漂移测试与 M4 Gate

**目标：** 证明完整预览可以作为导出的可信参照。

**任务：**

- 建立 30 秒测试项目；
- 5 镜头、2 角色、6 对白、多个动作；
- 检查 0/5/15/30 秒状态；
- 记录音频起止偏差；
- 重复播放 3 次；
- 修复漂移、叠音、结束状态；
- 添加 M4 结果文档。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

**DoD：**

- [ ] 30 秒预览无肉眼可见漂移；
- [ ] 重复播放不叠音；
- [ ] 镜头切换时间稳定；
- [ ] 所有求值器测试通过；
- [ ] M4 证据完成。

**建议提交：** `test(preview): close M4 full-project drift gate`

---

# Phase M5：完整视频导出

## Day 36 — 导出任务状态机与进度 UI

**目标：** 在真正渲染前，把导出生命周期设计清楚。

**任务：**

- 状态：idle / validating / rendering / encoding / completed / failed / cancelled；
- `export.start/cancel/status` IPC；
- 导出前检查项目、素材、时长；
- 导出对话框；
- 进度、当前阶段、可读错误；
- 防止同时启动多个导出；
- 窗口关闭时处理进行中的任务。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 状态转换有单元测试；
- [ ] 素材缺失时不进入渲染；
- [ ] 同时只能有一个 job；
- [ ] UI 能取消和查看失败原因。

**建议提交：** `feat(export): add validated export job state machine`

---

## Day 37 — 隐藏窗口加载完整项目与资源预加载

**目标：** 将 M0.5 探针扩展为真实多镜头项目。

**任务：**

- 隐藏窗口接收完整项目快照；
- 解析相对素材路径；
- 预加载所有图片和字体；
- 资源未就绪前不开始捕获；
- 使用 `evaluateProjectAtTime`；
- 镜头切换和字幕状态；
- 资源缺失返回具体 asset ID。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 可捕获 5 镜头项目任意时间点；
- [ ] 字体和图片加载完成后才回 `ready`；
- [ ] 资源缺失错误可定位；
- [ ] 主/隐藏窗口继续共享 Renderer/Evaluator。

**建议提交：** `feat(export): preload and render complete project offscreen`

---

## Day 38 — 全项目帧流、背压与清理

**目标：** 在 30 秒规模下稳定输出 720 帧。

**任务：**

- 总帧数计算；
- 逐帧时间表；
- 复用并强化背压；
- 帧写入失败立即停止；
- 进度节流推送；
- 取消和异常统一 finally 清理；
- 监控峰值待写队列和内存日志。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 30 秒项目准确生成 720 帧；
- [ ] 序号连续；
- [ ] 进度不刷爆 IPC；
- [ ] 内存可回落；
- [ ] 失败后无孤儿隐藏窗口。

**建议提交：** `feat(export): stream full-project frames with bounded memory`

---

## Day 39 — 多音频延迟、混音与最终编码

**目标：** 根据 startMs 把对白、音效和背景音乐放到正确时间。

**任务：**

- 构建 FFmpeg filter graph；
- 使用 `adelay` 对齐开始时间；
- 使用 `amix` 混音；
- 应用 clip volume；
- 没有音频时也能导出视频；
- H.264 + AAC + yuv420p；
- 输出元数据检查；
- 错误信息隐藏无关命令细节但保留日志。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm dev
```

**DoD：**

- [ ] 6 句对白按时间进入；
- [ ] 3 条音效可混合；
- [ ] 音量设置生效；
- [ ] 无音频项目仍可导出；
- [ ] 末尾漂移 <100ms。

**建议提交：** `feat(export): mix delayed audio clips into final MP4`

---

## Day 40 — 取消、错误、中文路径与视觉差异测试

**目标：** 把所有“平时不点，一点就炸”的边缘路径集中收拾。

**任务：**

- 编码阶段取消；
- 渲染阶段取消；
- FFmpeg 找不到；
- 素材中途缺失；
- 磁盘空间/写入失败模拟；
- 中文和空格输出路径；
- 抽取预览/导出关键帧做像素差异；
- 临时目录生命周期测试。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

**DoD：**

- [ ] 所有失败均恢复 UI；
- [ ] 取消后无残留进程；
- [ ] 中文路径成功；
- [ ] 关键帧差异 <1%；
- [ ] 详细错误进入日志。

**建议提交：** `test(export): harden cancellation paths and visual parity`

---

## Day 41 — M5 全量导出 Gate

**目标：** 用验收规模项目连续导出三次，关闭核心价值链路。

**任务：**

- 创建 5 镜头/2 角色/6～8 对白/多个动作的 30 秒项目；
- 连续导出 3 次；
- 比较文件元数据、帧数、关键位置、字幕和音频时点；
- 记录导出耗时和峰值资源；
- 目标电脑测试；
- 修复差异；
- 写 M5 结果文档。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

**DoD：**

- [ ] 三次导出结果确定；
- [ ] 1080p / 24 FPS / H.264 + AAC；
- [ ] 关键帧差异 <1%；
- [ ] 音频漂移 <100ms；
- [ ] 导出时间不超过 5 倍实时，或明确记录优化路径；
- [ ] M5 Gate 通过。

**建议提交：** `test(export): close deterministic 30-second M5 gate`

---

# Phase M6：稳定性、演示项目与打包

## Day 42 — 无版权演示项目与第三方许可台账

**目标：** 提供任何人打开软件后都能直接试的安全样例。

**任务：**

- 使用自制 SVG/几何角色；
- 自制简单背景；
- 使用明确许可或自制的短音频；
- 5～10 秒，包含字幕、移动、抖动、表情和嘴巴动画；
- 建立 `THIRD_PARTY_NOTICES.md`；
- 记录 FFmpeg 构建来源和许可证；
- 演示素材不使用来源不明的熊猫头包。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

**DoD：**

- [ ] 演示项目可打开；
- [ ] 可预览；
- [ ] 可导出；
- [ ] 所有素材权利来源可说明；
- [ ] NOTICE 文件存在。

**建议提交：** `feat(demo): add license-safe project and notices`

---

## Day 43 — Playwright 关键流程 E2E

**目标：** 自动守住最重要的用户路径，防止以后改一个按钮炸五个页面。

**任务：**

- 配置 Playwright Electron；
- 冒烟：启动应用；
- 新建项目；
- 打开演示项目；
- 切换镜头；
- 预览；
- 启动导出并等待完成或测试 stub；
- 失败时保存截图和日志；
- CI 中执行适合自动化的部分。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

**DoD：**

- [ ] E2E 可重复运行；
- [ ] 失败有截图；
- [ ] 不依赖随机等待时间；
- [ ] 关键流程至少有 1 条完整测试。

**建议提交：** `test(e2e): cover project preview and export smoke flow`

---

## Day 44 — Windows 安装包、运行文档与全新环境烟测

**目标：** 让项目从“开发机工程”变成“能安装的软件”。

**任务：**

- 完成 electron-builder Windows 配置；
- 打包 FFmpeg sidecar；
- 校验生产环境路径；
- 应用图标和最小元数据；
- 更新 README；
- 编写 `docs/architecture.md`、`docs/ffmpeg.md`、`KNOWN_ISSUES.md`；
- 在干净 Windows 用户目录安装；
- 安装→启动→打开演示→预览→导出。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
pnpm dist
```

**DoD：**

- [ ] 安装包生成；
- [ ] 不依赖全局 Node/pnpm/FFmpeg；
- [ ] 全新环境可启动；
- [ ] 演示项目可导出；
- [ ] 文档与实际命令一致。

**建议提交：** `build: package Windows MVP with FFmpeg sidecar`

---

## Day 45 — Release Candidate 全回归与决策复盘

**目标：** 用证据决定 MVP 是否完成，而不是被“差不多”三个字哄过去。

**任务：**

- 跑全部自动化检查；
- 按 A1～A22 逐项验收；
- 真实 30 秒项目导出；
- 演示项目导出；
- 中文路径、恢复、取消、缺失素材再次检查；
- 整理已知问题和 Backlog；
- 记录与剪映/万彩基准的制作耗时对比；
- 标记 Release Candidate 或明确未通过项；
- 创建版本 tag 的候选说明，但只有 Gate 全过才发布。

**验证：**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm dist
```

**DoD：**

- [ ] A1～A22 均有“通过证据”或明确“不通过”；
- [ ] 不存在未记录的 blocker；
- [ ] 安装包烟测通过；
- [ ] 真实项目可重复导出；
- [ ] 维护成本与节省时间已记录；
- [ ] 是否继续 V1 有明确决策。

**建议提交：** `chore(release): complete Panda Stage MVP acceptance review`

---

## 2. 每周检查点

### Week 1 结束

- Electron 工程可运行；
- 主窗口能预览 probe；
- 隐藏窗口能捕获指定帧。

### Week 2 结束

- 3～5 秒带音频 MP4 可导出；
- 中文路径、取消、打包验证通过；
- M0.5 Gate 已形成真实证据。

### Week 3 结束

- 项目可新建、保存、恢复；
- 素材导入和缩略图基础可用。

### Week 4 结束

- 角色和镜头管理完成；
- 画布基础摆位开始可见。

### Week 5 结束

- 画布编辑、撤销、动作预设完成；
- 项目已经“像个工具”，不是纯技术演示。

### Week 6 结束

- 时间轴求值、对白、字幕、预览基本完成；
- 检查止损条件：修改画面是否仍需要写代码。

### Week 7 结束

- 30 秒多镜头预览无明显漂移；
- 完整导出链路开始接入。

### Week 8 结束

- 30 秒项目可稳定导出；
- 三次重复导出一致；
- M5 Gate 通过。

### Week 9 结束

- 演示项目、E2E、Windows 安装包、文档完成；
- 进入 MVP Release Candidate 决策。

---

## 3. 强制止损检查

每周五或每完成 5 个开发日，回答：

1. 本周是否产出了可运行的新能力？
2. 是否有功能只能通过改代码才能使用？
3. 预览与导出是否仍使用同一套求值/渲染逻辑？
4. 是否出现音画漂移 >100ms？
5. 项目移动、中文路径、恢复是否仍可用？
6. 本周维护工具耗时是否大于它节省的制作时间？
7. 是否开始偷偷做 TTS、AI、骨骼、云端等非 MVP 功能？

任一高风险答案为“是”，下一开发日自动变为 **修底座日**，不添加新功能。

---

## 4. Daily Plan 完成定义

- Day 1～45 全部按顺序完成；
- 每天都有真实验证记录；
- M0.5、M1、M2、M3、M4、M5、M6 Gate 均有证据；
- A1～A22 全部验收；
- Windows 安装包可以从零安装、打开演示项目、预览并导出；
- 未完成项被放入 Backlog，而不是藏在“后续优化”四个字后面。

**当前唯一下一步：执行 Day 1。**
