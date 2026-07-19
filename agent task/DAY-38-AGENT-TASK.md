# Panda Stage Agent Task — Day 38

> **工单编号**：B-38/45  
> **角色**：Engineer  
> **来源**：`DAILY_PLAN.md` Day 38  
> **分支建议**：`build/day-38-windows-package`  
> **任务类型**：Windows 打包 + 干净环境验证 + 卸载保护  
> **唯一目标**：产出可在干净 Windows 环境独立安装、启动、预览和导出的 Panda Stage 安装包，并证明其不依赖开发机上的全局 Node、pnpm 或 FFmpeg。

---

## 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：1 Agent（Engineer）
- **任务名称**：Self-Contained Windows Installer + Clean-Machine Validation
- **轰炸目标**：完善 electron-builder、应用图标与元数据、FFmpeg 资源定位、安装/用户数据目录策略，并在干净 Windows 上完成安装、演示预览、导出和卸载保护测试。
- **任务性质**：构建发布 + 系统集成 + 环境隔离
- **输入基线**：Gate C PASS；Day 36 演示项目和 Day 37 自动化回归通过；FFmpeg sidecar/资源策略已有探针证据。
- **输出要求**：安装包 + 干净环境录屏/日志 + 无全局依赖证明 + 中文用户名路径 + 演示导出 + 卸载不删用户项目 + 16 项刀刃表。
- **通用铁律**：
  1. Gate C 非 PASS 时停止，不得用安装包包装未通过的导出链路。
  2. 干净环境不得预装全局 Node、pnpm 或 FFmpeg；缺失时应用仍须正常运行。
  3. 用户项目、导出文件和恢复文件必须位于安装目录之外，卸载不得删除。
  4. FFmpeg 路径必须从打包资源安全解析，禁止依赖开发机绝对路径。
  5. 安装包大小、签名状态、杀软提示和未验证项必须如实记录。

---

## 【模块2】输入基线

| 输入项 | 强制要求 | 验证命令 / 证据方式 | 状态 |
|---|---|---|---|
| Git 坐标 | 记录当前分支与 HEAD SHA | `git branch --show-current`；`git rev-parse HEAD` | 必须 |
| Gate 前置 | Gate C PASS；Day 36/37 回执通过 | Gate/回执文件 | 必须 |
| 当前构建 | electron-builder 配置、package scripts、FFmpegAdapter、资源路径、应用 metadata | `git grep -n "electron-builder\|extraResources\|FFmpegAdapter\|app.getPath\|productName" -- package.json electron-builder.* electron src tests` | 必须 |
| 目标范围 | builder config、图标、资源、安装/用户目录、干净机测试、卸载与回执 | `git diff --name-only` | 必须 |
| 目标结果 | 安装/卸载正常；无全局依赖可运行；中文用户名可用；演示可导出；用户项目不被卸载删除 | dist artifacts/manual evidence | 必须 |
| 技术约束 | FFmpeg 随包；路径用 `process.resourcesPath` 或等价受控 API；用户数据与项目分离；不提权写系统目录 | 配置与测试 | 必须 |
| 风险边界 | 不做自动更新；不做代码签名采购；不做 macOS/Linux 包；不做安装器品牌美化扩张 | diff 审查 | 必须 |
| 测试基线 | 默认质量门禁 + E2E + `pnpm dist` | 命令输出 | 必须 |
| 文档同步 | 新建 `docs/test-receipts/DAY-38.md`，记录安装包、环境和杀软提示 | 文档 diff | 必须 |
| 历史债务 | 未签名、杀软误报、云电脑限制必须独立申报，不得伪装为已解决 | 回执/debt | 必须 |

### 探索补充栏

| 项目 | 内容 |
|---|---|
| 已知事实 | Windows 安装包必须包含 Electron、应用资源与 FFmpeg；用户项目不能与程序文件绑定。 |
| 待确认问题 | NSIS/portable 目标；FFmpeg 许可与文件名；图标格式；干净环境来源；未签名安装器警告。 |
| 预期输出 | 一套可复现的 Windows 构建和干净机验收流程。 |
| 停止条件 | 构建、安装、启动、演示预览、导出、卸载和项目保留全部验证。 |

---

## 【模块3】工单矩阵

### 基础信息

- **工单编号**：B-38/45
- **角色**：Engineer
- **依赖关系**：依赖 Gate C、Day 36 演示项目与 Day 37 回归套件。

### 输出交付物

- **预计变更文件**：
  - `package.json`
  - `electron-builder.yml` / `electron-builder.json` 或仓库实际配置
  - `build/icon.ico` 与来源说明
  - FFmpeg 打包资源配置
  - `electron/main/services/ResourcePathService.ts`
  - `electron/main/index.ts` 必要适配
  - 安装包 smoke scripts/tests
  - `docs/development.md`
  - `docs/ffmpeg.md`
  - `docs/test-receipts/DAY-38.md`
- **核心修改点**：
  - productName、appId、version、图标和描述；
  - Windows installer target；
  - FFmpeg/ffprobe 作为受控资源打包；
  - 开发态/打包态资源路径统一解析；
  - 安装目录、userData、logs、temp、recent projects 边界；
  - 演示模板资源打包；
  - 干净 Windows 安装、启动、预览、导出、关闭；
  - 卸载后验证用户项目保留；
  - 记录安装包大小、hash、系统版本、用户名路径与杀软提示。
- **必须包含**：
  - `pnpm dist` 真实产物；
  - 安装包 SHA-256 与大小；
  - 干净环境确认无全局 Node/pnpm/FFmpeg；
  - 安装后应用启动且主窗口正常；
  - 打开 Day 36 演示项目；
  - 完整预览并导出 MP4；
  - ffprobe 验证导出；
  - 中文 Windows 用户名或含 Unicode 的用户目录；
  - userData/log/temp 路径可写；
  - 安装目录资源只读仍可运行；
  - 卸载后用户项目与导出文件仍存在；
  - 卸载后程序文件清理；
  - 未签名/杀软提示如实记录；
  - 安装包不包含开发期绝对路径和无关大文件。
- **禁止包含**：
  - 依赖系统 PATH 中 FFmpeg；
  - 把用户项目默认存进安装目录；
  - 卸载时递归删除用户项目目录；
  - 为通过测试预先安装 Node/pnpm/FFmpeg；
  - 硬编码开发机盘符；
  - 顺手实现自动更新、登录、遥测或其他平台安装包。
- **交付证明**：dist 日志、安装包 hash、干净环境软件清单、安装/卸载录屏、路径截图、演示导出与 ffprobe、卸载前后项目文件 hash。

### 规模与复杂度观察

- ResourcePathService 统一开发态和打包态路径，不在各服务散落 `resourcesPath` 拼接。
- 安装包目标保持最小，优先一个可安装版本；portable 可留债务，不同时扩张多种发行格式。
- 干净环境优先真实 Windows 虚拟机/实体机；云电脑若系统组件特殊，必须注明环境偏差。
- 代码签名未配置不等于忽略警告，需声明 `DEBT-SIGNING-B38-001` 与现实影响。

### 自动化质量闸门

| 闸门 | 要求 | 验证命令 / 证据 | 后果 |
|---|---|---|---|
| BUILD | 应用与安装包构建通过 | `pnpm build`；`pnpm dist` | 返工 |
| TYPE | 类型检查通过 | `pnpm typecheck` | 返工 |
| FMT | 格式检查通过 | `pnpm exec prettier --check .` 或 N/A + 原因 | 返工或声明 |
| LINT | 无新增错误 | `pnpm lint` | 返工 |
| TEST | unit/integration/E2E 通过 | 仓库实际测试命令 | 返工 |
| ARCH | FFmpeg 内置；用户数据与安装目录分离；无绝对开发路径 | 静态检查 + package inspection | 返工 |
| REAL | 干净 Windows 安装、导出、卸载真实通过 | 录屏/日志/artifacts | 返工 |
| DOC | 构建、环境、签名/杀软与回执同步 | 文档 diff | 返工或债务 |

---

## 【模块3-A】刀刃表（16 项）

| 类别 | ID | 检查目标 | 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | Windows 安装包可安装/启动/卸载 | clean-machine evidence | [ ] |
| FUNC | FUNC-002 | 演示项目可预览和导出 | MP4/ffprobe | [ ] |
| FUNC | FUNC-003 | 内置 FFmpeg/ffprobe 正常解析 | runtime logs | [ ] |
| FUNC | FUNC-004 | userData/log/temp 路径正常 | path evidence | [ ] |
| CONST | CONST-001 | 无全局 Node/pnpm/FFmpeg 依赖 | environment evidence | [ ] |
| CONST | CONST-002 | 用户项目位于安装目录外 | path assertions | [ ] |
| CONST | CONST-003 | 打包内容无开发机绝对路径 | package scan | [ ] |
| CONST | CONST-004 | 安装包 hash/大小/版本可追溯 | artifact report | [ ] |
| NEG | NEG-001 | 中文用户名路径可用 | clean-machine test | [ ] |
| NEG | NEG-002 | 安装资源只读时仍运行 | permission test | [ ] |
| NEG | NEG-003 | 卸载不删除用户项目/导出 | before/after hashes | [ ] |
| NEG | NEG-004 | 缺失系统 PATH FFmpeg 不影响运行 | environment test | [ ] |
| UX | UX-001 | 安装、首次启动和卸载行为清楚 | recording/evidence | [ ] |
| UX | UX-002 | 未签名/杀软提示被明确记录 | receipt evidence | [ ] |
| E2E | E2E-001 | 干净机安装→演示→预览→导出→卸载 | complete flow | [ ] |
| High | HIGH-001 | 卸载后用户项目与输出完整保留 | hash comparison | [ ] |

---

## 【模块3-B】地狱红线

1. Gate C 非 PASS 仍打包 RC 路线 → 停止。
2. 安装包依赖系统 PATH 的 FFmpeg → 返工。
3. 干净环境预装 Node/pnpm/FFmpeg → 验证失效。
4. 用户项目存入安装目录 → 返工。
5. 卸载删除用户项目或导出 → 严重违规。
6. 打包资源带开发机绝对路径 → 返工。
7. 中文用户名路径未验证 → 未验证。
8. 未签名/杀软提示被隐瞒 → 数据不诚实。
9. 只在开发机测试安装包 → 未验证。
10. 质量门禁失败仍交付 → 返工。

---

## 【模块4】P4 自测检查表

| 检查点 | 自检问题 | 状态 | 用例 |
|---|---|---|---|
| CF | 安装、启动、演示、导出和卸载是否完整？ | [ ] | CF-B38-001 |
| RG | Gate C 与 Day 36/37 是否保持？ | [ ] | RG-B38-001 |
| NG | 无全局依赖、中文用户、只读资源、卸载保护是否覆盖？ | [ ] | NG-B38-001 |
| UX | 安装和警告信息是否如实可理解？ | [ ] | UX-B38-001 |
| E2E | 干净机全流程是否走通？ | [ ] | E2E-B38-001 |
| High | 卸载数据保护是否单独验证？ | [ ] | HIGH-B38-001 |
| 字段完整性 | 回执是否记录机器、hash、大小、路径和产物？ | [ ] | DAY-38.md |
| 需求映射 | 是否覆盖 Day 38 全任务？ | [ ] | 刀刃表 |
| 自测执行 | 是否真实卸载并复查文件？ | [ ] | 操作证据 |
| 范围边界与债务 | 签名/杀软/云环境差异是否申报？ | [ ] | 债务声明 |

---

## 【模块5】收卷格式

```markdown
## ✅ 工单 B-38/45 完成并提交
- Commit: `build(windows): package self-contained Panda Stage installer`
- 分支: `build/day-38-windows-package`
- 基线 SHA:
- 结果 SHA:
- 变更文件:

### 安装包
- 文件路径:
- SHA-256:
- 文件大小:
- 应用版本:
- Builder target:
- 签名状态:

### 干净环境
- Windows 版本:
- 用户名/用户目录:
- 全局 Node:
- 全局 pnpm:
- 全局 FFmpeg:
- 安装/启动:
- 演示预览:
- 演示导出/ffprobe:
- 卸载:
- 用户项目保留:
- 杀软/SmartScreen:

### 自动化检查
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test:unit`:
- integration/E2E:
- `pnpm build`:
- `pnpm dist`:

### 决策与债务
- DECISION-001: [安装包 target]
- DECISION-002: [FFmpeg 资源路径]
- DECISION-003: [用户数据边界]
- DEBT-SIGNING-B38-001:
- DEBT-PACKAGE-B38-001:

### 回滚
- `git revert <结果 SHA>`
```

---

## 【模块6】技术熔断预案

| 熔断 ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| RESOURCE-B38-001 | 打包态找不到 FFmpeg/演示资源 | 停止 RC，修统一路径 | 阻塞 |
| CLEAN-B38-001 | 干净机依赖全局开发工具 | 修资源与构建配置 | 阻塞 |
| DATA-B38-001 | 卸载影响用户项目 | 立即修安装/卸载边界 | 严重阻塞 |
| PATH-B38-001 | 中文用户名失败 | 修路径处理后重测 | 阻塞 |
| ENV-B38-001 | 无真实干净 Windows 可用 | 不得判完整通过，申报环境债务 | 有条件交付 |

---

## 【模块7】派单口令

启动饱和攻击集群，执行 **Panda Stage Day 38：Self-Contained Windows Installer + Clean-Machine Validation**！

验收铁律：安装包自包含；无全局 Node/pnpm/FFmpeg；中文用户名可用；演示可导出；安装资源路径稳定；卸载绝不删除用户项目；签名和杀软风险如实记录。

Ouroboros 闭环启动，**B-38/45**，执行！ ☝️🐍♾️🔥

---

## 【模块8】验证命令库

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git grep -n "electron-builder\|extraResources\|resourcesPath\|userData\|FFmpeg" -- package.json electron-builder.* electron src tests docs
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm dist
certutil -hashfile "<installer.exe>" SHA256
git diff --stat
```
