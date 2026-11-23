<h1 align="center">Panda Stage · 熊猫片场</h1>

<p align="center"><strong>一款面向个人创作者的开源 2D 纸片人动画编辑器。</strong></p>

<p align="center">
  <a href="#功能概览">功能概览</a> ·
  <a href="#开始使用">开始使用</a> ·
  <a href="#开发状态">开发状态</a> ·
  <a href="#参与项目">参与项目</a>
</p>

Panda Stage 希望让制作动画短片这件事更直接：准备好角色和背景，在画布上安排镜头，加入对白、声音与动作，再把它们组合成一段视频。

它主要面向想讲故事的个人创作者。你不必先搭建复杂的制作流程，就能在同一个编辑器里管理素材、编排场景并预览作品。

> **项目仍在开发中。** 目前以 Windows 桌面版为主，已实现不少编辑功能，但界面、操作体验和部分格式兼容性仍在持续完善。尚无公开的 GitHub Release 安装包，可按下文从源码运行。

## 功能概览

### 从素材到镜头

- **管理动画项目**：新建、打开和切换项目，整理镜头与素材。
- **搭建场景**：导入背景和角色图片，在画布上摆放、移动、缩放、调整图层顺序。
- **创建角色**：使用单张图片、角色表情或组合部件，制作适合不同场景的角色。

### 让画面动起来

- **时间轴编辑**：安排镜头中的对白、音频和动作，在时间轴上定位并调整内容。
- **角色与图层动画**：为图层设置位置变化，编辑角色部件的动作和关键帧。
- **对白与声音**：编辑台词、设置说话者、添加字幕，并安排对白音频和背景音乐。

### 使用已有动画素材

Panda Stage 正在完善对 **Adobe Animate FLA 文件**的支持。目前可以检查和预览部分 FLA 内容，导入受支持的 Graphic 元件与角色部件，并在相应编辑界面调整结构、形状和布局。

FLA 是一个仍在扩展的工作流：不同源文件、元件类型和动画效果的兼容程度会有差异，暂不适合作为所有 FLA 项目的无损替代编辑器。

### 预览并导出作品

编辑过程中可以预览镜头；完成后，可通过编辑器中的视频导出入口生成 **MP4（1920 × 1080，24 FPS）**。导出流程包含素材检查、进度显示、取消及失败后的重试操作。

目前支持的图片、音频和动画内容有明确范围，详见[媒体与导出支持矩阵](./docs/export-support-matrix.md)。

## 开始使用

### 运行环境

- **系统**：Windows 10 / 11
- **Node.js**：`>=22.12.0 <25`
- **包管理器**：pnpm 10（项目锁定版本为 `pnpm@10.13.1`）
- **Git**：用于克隆仓库

### 从源码运行

在 PowerShell 中依次执行：

```powershell
git clone https://github.com/Cognitive-Architect/panda-stage.git
cd panda-stage
corepack enable
corepack install
pnpm install
pnpm dev
```

启动后可以在项目中心创建或打开工程，再从镜头、素材、角色等工作区开始编辑。

如需构建项目，可运行 `pnpm build`。涉及 FFmpeg/ffprobe 的环境配置与说明请参阅[媒体工具文档](./docs/ffmpeg.md)。

## 开发状态

Panda Stage 已有项目管理、画布编辑、时间轴、角色工作区、预览和视频导出等主要入口，但距离成熟的动画制作软件还有工作要做。

当前仍在持续改进的重点包括：

- **编辑体验**：让界面、工具组织和不同窗口尺寸下的操作更清晰、顺手。
- **角色与动画**：继续完善角色编辑、动作表现和时间轴的协作体验。
- **FLA 兼容性**：逐步扩大可解析、可编辑的元件与动画内容范围。
- **导出可靠性**：完善复杂工程、媒体格式以及不同 Windows 环境下的实际验证。

本项目更适合希望尝试、反馈或参与开发的用户。导入重要的外部工程前，建议保留一份原始文件。具体工作方向见[路线图](./ROADMAP.md)，问题与进展见 [GitHub Issues](https://github.com/Cognitive-Architect/panda-stage/issues)。

## 技术与文档

Panda Stage 使用 **Electron、React、TypeScript、Vite 和 Konva** 构建桌面编辑器；通过 **Zod** 校验项目数据，使用 **FFmpeg/ffprobe** 处理视频输出。

如果你想了解实现细节，可以从这里开始：

- [架构说明](./docs/architecture.md)：编辑器进程、领域模型与项目数据（部分章节记录历史版本，当前模型以源码为准）。
- [开发说明](./docs/development.md)：项目生命周期、素材处理、保存与恢复。
- [媒体与导出支持矩阵](./docs/export-support-matrix.md)：各种输入内容在预览和导出中的支持范围。
- [设计原则](./DESIGN.md)：产品界面与交互约定。
- [开发 Agent 指南](./AGENTS.md)：代码边界、协作规则及验证要求。

当前项目文件格式版本由 [`src/domain/constants.ts`](./src/domain/constants.ts) 中的 `PROJECT_SCHEMA_VERSION` 定义。开发命令、依赖与测试脚本以 [`package.json`](./package.json) 为准。

## 参与项目

欢迎通过 [Issues](https://github.com/Cognitive-Architect/panda-stage/issues) 反馈错误、提出功能想法或讨论改进方向。反馈时附上复现步骤、操作环境以及预期与实际结果，会更容易定位问题。

如果想提交代码，请先阅读 [AGENTS.md](./AGENTS.md)；涉及界面或交互修改时，也请参考 [DESIGN.md](./DESIGN.md)。

## 许可证

Panda Stage 基于 **Apache License 2.0** 开源，详见 [LICENSE](./LICENSE)。第三方组件及媒体工具可能适用各自的许可证，参见[第三方声明](./docs/THIRD_PARTY_NOTICES.md)。
