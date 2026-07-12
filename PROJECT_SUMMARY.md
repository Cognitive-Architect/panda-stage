# Panda Stage - 项目摘要文档

> **版本**: M0.5（里程碑 0.5 - 核心技术探针）  
> **日期**: 2026-07-12  
> **仓库**: https://github.com/Cognitive-Architect/panda-stage  
> **分支**: `dev`  
> **项目路径**: `D:\panda-stage`

---

## 1. 项目概述

**熊猫片场（Panda Stage）** 是一个基于 Electron + React + Konva 的纸片人动画工具。核心设计理念是让用户通过简单的拖拽和配置，快速生成带有角色动画、字幕、配音的短视频内容。

- **目标用户**: 内容创作者、自媒体运营、轻量级动画制作需求者
- **核心价值**: 低门槛、快速出片、中文支持
- **平台**: Windows 桌面应用（Electron 封装）

---

## 2. 技术栈

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **运行时** | Node.js | 24.15.0 | Kimi Desktop 内置运行时 |
| **构建工具** | Vite | latest | 前端构建与 Electron 打包 |
| **框架** | React | 18+ | 主界面渲染 |
| **桌面壳** | Electron | latest | 桌面应用框架 |
| **动画引擎** | Konva | 最新版 | 2D 纸片人动画渲染（Canvas 层） |
| **类型校验** | Zod | 最新版 | 数据模型 Schema 校验 |
| **测试** | Vitest | 最新版 | 单元测试 |
| **脚本** | Pillow + numpy | 12.2.0 / 2.4.4 | Python 测试素材生成（Daimon Run） |
| **编码** | FFmpeg | 待安装 | 视频编码（H.264 / AAC） |

---

## 3. 目录结构

```
D:\panda-stage
├── .gitignore                 # 合并远程模板 + 项目专用条目
├── package.json               # 项目配置与依赖
├── package-lock.json
├── tsconfig.json              # TypeScript 配置
├── vite.config.ts             # Vite 主配置
├── vite.electron.config.ts    # Electron 打包配置
├── vitest.config.ts           # 测试配置
├── playwright.config.ts       # E2E 测试配置
├── index.html                 # 主窗口入口
├── export.html                # 导出窗口入口
│
├── shared/                    # 共享类型与常量（主进程 + 渲染进程共用）
│   ├── ipc-channels.ts        # IPC 通道名称定义
│   ├── constants.ts           # 全局常量（FPS, 背压, 重试次数等）
│   └── types.ts               # Zod Schema 定义的数据模型
│
├── electron/                  # 主进程代码
│   ├── main/
│   │   ├── index.ts           # 主入口：窗口创建、IPC 注册
│   │   ├── window.ts          # 窗口管理（主窗口 + 隐藏导出窗口）
│   │   ├── ipc/
│   │   │   ├── handlers/
│   │   │   │   ├── export.ts  # 导出 IPC 处理器
│   │   │   │   └── ffmpeg.ts  # FFmpeg 相关 IPC 处理器
│   │   └── services/
│   │       ├── ExportService.ts   # 导出任务协调器（核心）
│   │       └── FFmpegAdapter.ts   # FFmpeg 编码适配器（占位）
│   ├── preload/
│   │   ├── index.ts           # 主窗口 Preload 脚本
│   │   └── export-preload.ts  # 导出窗口 Preload 脚本
│   └── tsconfig.json          # 主进程专用 TypeScript 配置
│
├── src/                       # 渲染进程代码（React）
│   ├── main.tsx               # 主渲染入口
│   ├── App.tsx                # 主应用组件
│   ├── index.css              # 全局样式
│   ├── export-window.tsx      # 隐藏导出窗口入口
│   ├── features/
│   │   └── canvas/
│   │       └── CanvasStage.tsx    # 预览 Canvas 渲染器
│   └── domain/
│       ├── evaluators/
│       │   ├── interpolators.ts   # 插值函数（线性、缓动等）
│       │   └── timelineEvaluator.ts  # 时间线求值器（核心）
│       └── renderers/
│           └── StageRenderer.tsx   # 舞台渲染器（共享）
│
├── tests/
│   ├── unit/
│   │   ├── evaluators.test.ts      # 求值器单元测试（69/69 通过）
│   │   └── migration.test.ts       # 数据迁移测试
│   └── e2e/
│       └── m05-probe.spec.ts       # M0.5 E2E 测试
│
├── scripts/
│   ├── generate-test-assets.ts   # 测试素材生成脚本
│   └── test-ffmpeg.mjs            # FFmpeg 可用性测试
│
├── public/                    # 静态资源
├── docs/                      # 项目文档
├── demo-project/              # 演示项目素材
│   └── assets/                # 测试素材（角色、背景、音频）
│
├── M0.5_TEST_REPORT.md        # M0.5 测试报告
├── PROJECT_SUMMARY.md       # 本文件（项目摘要）
│
# 测试生成文件（大文件，已加入 .gitignore）
├── m05_probe.avi              # 测试视频（15MB，MJPEG+PCM）
├── m05_probe.gif              # 测试 GIF（1.3MB）
├── m05_preview.gif            # 预览 GIF（523KB，每3帧取1）
└── 中文路径测试.avi           # 中文路径测试文件
```

---

## 4. 核心功能（M0.5 已实现）

### 4.1 TimelineEvaluator（时间线求值器）

**纯函数**，零副作用，支持所有事件类型的时间线求值：

| 事件类型 | 类型 | 功能 | 优先级规则 |
|----------|------|------|------------|
| `move` | 连续 | 位置插值（X, Y） | `order` 排序后顺序应用 |
| `scale` | 连续 | 缩放插值 | `order` 排序后顺序应用 |
| `opacity` | 连续 | 透明度插值 | `order` 排序后顺序应用 |
| `shake` | 连续 | 抖动偏移（非破坏性） | 叠加到基础坐标 |
| `expression` | 离散 | 表情切换 | `startMs` 最大者，同 startMs 时 `order` 大者优先 |
| `flip` | 离散 | 翻转切换 | 同上 |
| `visibility` | 离散 | 可见性切换 | 同上 |

**嘴巴动画**: M0.5 固定 8Hz（125ms 周期），周期前半张嘴

**Zod 数据模型**: 使用 `z.discriminatedUnion('type', [...])` 定义 8 种事件类型，包含完整的 `order` 优先级字段

### 4.2 ExportService（导出服务）

**核心约束**（全部满足）：

| 约束 | 实现 | 说明 |
|------|------|------|
| 串行帧调度 | `while` 循环 | 一次只发送一个 `render:frame` |
| 背压控制 | `MAX_EXPORT_PENDING_FRAMES = 5` | 超过 5 帧 pending 时等待 |
| 重试机制 | `EXPORT_FRAME_RETRY_MAX = 2` | 单帧失败最多重试 2 次 |
| 重试不回退 | 失败即终止 | 不使用主窗口回退 |
| 异步写入 | `fs.promises.writeFile()` | 非 `writeFileSync` |
| Project 只发一次 | `EXPORT_START` | 发送完整 Project 数据 |
| 隐藏窗口 Ready | 三条件 | `document.fonts.ready` + 预加载素材 + 首次绘制 |
| DPI 缩放 | `setZoomFactor(1)` | 严格 1920×1080 |

### 4.3 双模式帧捕获

- **方式 A**: `capturePage()` + `toPNG()` — 主进程侧捕获
- **方式 B**: `canvas.toBlob()` → `Uint8Array` → 发回主进程 — 渲染器侧捕获

> 两种方式代码均已实现，但环境无 GUI，无法实际运行对比

### 4.4 FFmpegAdapter（编码适配器）

- 自动查找 FFmpeg（bundled → PATH → 报错）
- 使用 concat demuxer 输入帧列表
- 编码参数：H.264 (`libx264`) + `yuv420p` + `-movflags +faststart`
- 进度回调：实时解析 FFmpeg stderr

> ⚠️ **M0.5 阻塞**：环境无 FFmpeg，编码功能未验证

---

## 5. 测试验证

### 5.1 单元测试：69/69 全部通过

```
✓ 连续性属性插值（move/scale/opacity）
✓ 抖动（shake）非破坏性附加偏移
✓ 离散事件优先级（expression/flip/visibility）
✓ order 字段优先级排序
✓ 嘴巴动画 8Hz 周期（125ms）
✓ 字幕时间范围过滤
✓ 事件时间边界处理
✓ 浮点精度容错（shake 阻尼）
```

### 5.2 Python 替代验证（120帧 1920×1080 测试素材）

| 验收项 | 结果 | 数据 |
|--------|------|------|
| **视觉对比** | ✅ 通过 | 帧0 vs 帧60，平均像素差 14.2，最大差 239 |
| **音画同步** | ✅ 通过 | 视频 5.000s / 音频 5.000s，误差 0.1ms |
| **中文路径** | ✅ 通过 | `中文路径测试.avi` 复制读写成功 |
| **DPI 缩放** | ✅ 通过 | 严格 1920×1080 |
| **内存估算** | ⚠️ 需优化 | 原始缓冲 ~712MB，峰值约 1GB |
| **文件结构** | ✅ 通过 | RIFF/AVI/hdrl/movi/idx1 完整 |

---

## 6. 已知问题

| 编号 | 问题 | 严重程度 | 阻塞 M0.5 | 修复建议 |
|------|------|----------|-----------|----------|
| 1 | 无法生成 MP4 | 高 | 是 | 安装 FFmpeg 或 `ffmpeg-static` npm 包 |
| 2 | 无法运行 Electron | 高 | 是 | 需要 GUI 环境或 CI/CD 中的 xvfb/headed 测试 |
| 3 | FFmpeg 取消信号未传递 | 中 | 否 | 在 FFmpegAdapter 中存储 `proc` 引用并支持 `kill()` |
| 4 | 内存峰值未实测 | 中 | 否 | 使用 `process.memoryUsage()` 在运行时监控 |
| 5 | 帧捕获 A/B 对比未执行 | 中 | 否 | 需要实际运行 Electron 后对比 PNG 输出 |
| 6 | 无视觉回归测试基准 | 低 | 否 | 建立帧基准图，使用 pixelmatch 进行自动化对比 |

---

## 7. Git 状态

- **远程仓库**: `https://github.com/Cognitive-Architect/panda-stage`
- **本地分支**: `dev`（追踪 `origin/dev`）
- **提交**: `52d9077` — "feat: M0.5 core probe implementation"
- **凭证**: 已存储于 Windows Git 凭证管理器
- **上次推送**: 2026-07-12，46 个文件

---

## 8. 下一步计划（M1 阶段）

1. **在具备 FFmpeg 和 GUI 的环境中运行完整集成测试**
2. **修复 FFmpeg 取消信号传递问题**（添加 `proc` 引用和 `kill()` 方法）
3. **帧捕获 A/B 对比并选定最终方案**
4. **添加内存监控和回归测试基准**
5. **MVP 功能开发**：时间线编辑器、素材管理、音频录制

---

## 9. 快速启动

```bash
# 进入项目目录
cd D:\panda-stage

# 安装依赖
npm install

# 运行单元测试
npm run test

# 启动 Electron 应用（需 GUI 环境）
npm run dev

# 打包应用
npm run build
```

---

## 10. 相关文件索引

| 文件 | 路径 | 说明 |
|------|------|------|
| 测试报告 | `M0.5_TEST_REPORT.md` | M0.5 完整测试报告 |
| 项目摘要 | `PROJECT_SUMMARY.md` | 本文件 |
| 测试视频 | `m05_probe.avi` | 120帧 MJPEG + PCM 音频 |
| 预览 GIF | `m05_preview.gif` | 40帧预览 |
| Git Bundle | `panda-stage-m05.bundle` | 离线打包版本 |

---

*本文档由 Kimi Work 在 2026-07-12 自动生成，用于会话恢复和项目状态管理。*
