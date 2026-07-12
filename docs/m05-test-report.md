# Panda Stage M0.5 核心技术探针 — 测试报告

> **测试日期**：YYYY-MM-DD  
> **测试版本**：v0.0.1  
> **测试环境**：Windows 10/11, Electron 35.x, Node.js 24.x  
> **测试执行者**：[填写姓名]  
> **测试状态**：□ 未开始 / □ 进行中 / □ 已完成

---

## 1. 测试概述

### 1.1 测试范围

本次 M0.5 测试覆盖以下核心模块：

| 模块 | 说明 | 优先级 |
|------|------|--------|
| 时间轴求值器 | 插值、抖动、事件优先级、嘴巴动画 | P0 |
| 项目迁移 | Schema 验证、V0→V1 迁移、中文兼容 | P0 |
| 导出流程 | 隐藏窗口渲染、帧捕获、FFmpeg 编码 | P0 |
| 主窗口 UI | 导入、预览、导出按钮、进度条 | P1 |
| IPC 通信 | 主进程 ↔ 渲染进程 ↔ 隐藏窗口 | P0 |
| 中文路径 | 文件名、项目标题、字幕文本 | P0 |

### 1.2 测试策略

- **单元测试**：使用 Vitest，覆盖纯逻辑函数（求值器、插值器、迁移工具）
- **集成测试**：验证 IPC 通道和模块间协作
- **端到端测试**：使用 Playwright + Electron，模拟真实用户操作流程

---

## 2. 测试环境

### 2.1 硬件环境

| 项目 | 配置 |
|------|------|
| 操作系统 | Windows 10/11 (64-bit) |
| CPU | [填写] |
| 内存 | [填写] |
| GPU | [填写] |
| 显示器分辨率 | 1920×1080 或更高 |
| DPI 缩放 | 100% / 125% / 150%（分别测试） |

### 2.2 软件环境

| 项目 | 版本 |
|------|------|
| Node.js | 24.x |
| Electron | 35.x |
| React | 18.3.x |
| Konva | 9.3.x |
| Vitest | 3.x |
| Playwright | 1.49.x |
| FFmpeg | [填写，或 N/A] |

### 2.3 测试素材

| 素材 | 路径 | 说明 |
|------|------|------|
| 背景图 | `demo-project/assets/background.png` | 1920×1080 蓝色背景 |
| 角色正常 | `demo-project/assets/character_normal.png` | 透明 PNG |
| 角色愤怒 | `demo-project/assets/character_angry.png` | 透明 PNG |
| 角色张嘴 | `demo-project/assets/character_mouth.png` | 透明 PNG |
| 对白音频 | `demo-project/assets/dialogue.mp3` | 3-5 秒音频 |

---

## 3. 单元测试结果

### 3.1 插值器测试 (`tests/unit/evaluators.test.ts`)

| 测试用例 | 描述 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| interpolate linear | 线性插值 t=0.5 | 返回中点值 | | □ |
| interpolate ease-in-out | 三次缓动 t=0.5 | 返回 0.5 | | □ |
| clamp bounds | t 超出 [0,1] | 钳制到边界 | | □ |
| easeInOutCubic 0 | t=0 | 返回 0 | | □ |
| easeInOutCubic 1 | t=1 | 返回 1 | | □ |
| easeInOutCubic symmetry | t=0.25 vs t=0.75 | 对称 | | □ |
| easeInOutCubic acceleration | t=0.25 | 小于线性值 | | □ |
| easeInOutQuad | 二次缓动 | 边界值正确 | | □ |
| lerp | a→b 线性 | 正确插值 | | □ |
| clamp range | 范围内值 | 不变 | | □ |
| clamp below | 低于最小值 | 返回最小值 | | □ |
| clamp above | 高于最大值 | 返回最大值 | | □ |

### 3.2 抖动偏移测试

| 测试用例 | 描述 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| shake offset at start | progress=0 | offsetY = amplitudeY | | □ |
| shake offset at end | progress=1 | offset = 0 (damping=0) | | □ |
| damping decreases | progress=0.25 vs 0.75 | 后期振幅更小 | | □ |
| frequency effect | 不同频率 | 偏移值不同 | | □ |
| sine/cosine components | phase=π/2 | X=sin, Y=cos | | □ |

### 3.3 时间轴求值器测试

| 测试用例 | 描述 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| initial layer state | 无事件 | 返回初始值 | | □ |
| move event linear | 0→1000ms | 500ms 时 x=50 | | □ |
| ease-in-out move | 缓动移动 | 曲线正确 | | □ |
| event before start | time < startMs | 不应用 | | □ |
| event after end | time > endMs | 不应用（保持原值） | | □ |
| scale event | 缩放 | 比例正确 | | □ |
| opacity event | 透明度 | 值正确 | | □ |
| flip event | 翻转 | 布尔值正确 | | □ |
| visibility event | 显隐 | 布尔值正确 | | □ |
| layer zIndex sorting | 多层 | 按 zIndex 排序 | | □ |
| subtitle from dialogue | 对白启用字幕 | 显示字幕 | | □ |
| subtitle disabled | 对白禁用字幕 | 不显示 | | □ |
| audio clip active | 时间范围内 | 包含在帧中 | | □ |
| audio clip not started | 时间未到 | 不包含 | | □ |
| project shot selection | 多镜头 | 选择正确镜头 | | □ |
| project beyond duration | 超时长 | 返回最后一帧 | | □ |
| single shot project | 单镜头 | 正确求值 | | □ |

### 3.4 事件优先级测试（order 字段）

| 测试用例 | 描述 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| ascending order | 重叠事件，order 1→2 | 后事件覆盖 | | □ |
| lower order first | order 10 vs 5 | 低 order 先应用 | | □ |
| discrete tie-breaker | 相同 startMs，不同 order | order 高者胜出 | | □ |
| startMs precedence | 不同 startMs | 最近事件胜出 | | □ |

### 3.5 嘴巴动画测试

| 测试用例 | 描述 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| cycle at start | 0ms | 张嘴 | | □ |
| cycle at half | 62ms | 闭嘴 | | □ |
| cycle period | 125ms | 周期正确 | | □ |
| no mouth asset | 无 mouthOpenAssetId | 不动画 | | □ |
| outside dialogue | 对白范围外 | 不动画 | | □ |
| multiple cycles | 多个周期 | 周期性正确 | | □ |

### 3.6 迁移测试 (`tests/unit/migration.test.ts`)

| 测试用例 | 描述 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| migrate empty legacy | 空 V0 项目 | 生成有效 V1 | | □ |
| fill missing defaults | 缺失字段 | 填充默认值 | | □ |
| preserve arrays | 现有数组 | 保留数据 | | □ |
| validate correct project | 有效项目 | 通过验证 | | □ |
| reject wrong schemaVersion | schemaVersion=2 | 拒绝 | | □ |
| reject missing fields | 缺少必填 | 拒绝 | | □ |
| reject invalid width | 宽度错误 | 拒绝 | | □ |
| reject invalid fps | 帧率错误 | 拒绝 | | □ |
| round-trip migration | 迁移→验证 | 成功 | | □ |
| null input | null | 不崩溃 | | □ |
| Chinese title | 中文标题 | 保留 | | □ |
| Chinese asset name | 中文文件名 | 保留 | | □ |
| Chinese dialogue | 中文字幕 | 保留 | | □ |
| zero duration shot | 0ms 镜头 | 验证失败 | | □ |
| circular reference | 循环引用 | 不崩溃 | | □ |
| mixed type array | 混合类型 | 不崩溃 | | □ |

---

## 4. 集成测试结果

### 4.1 IPC 通道测试

| 通道 | 方向 | 测试内容 | 状态 |
|------|------|----------|------|
| `project:create` | R→M | 创建项目 | □ |
| `project:save` | R→M | 保存项目 | □ |
| `asset:import` | R→M | 导入素材 | □ |
| `export:start` | R→M | 启动导出 | □ |
| `export:cancel` | R→M | 取消导出 | □ |
| `export:progress` | M→R | 进度推送 | □ |
| `export:complete` | M→R | 导出完成 | □ |
| `export:error` | M→R | 导出错误 | □ |
| `ffmpeg:getVersion` | R→M | 查询版本 | □ |
| `render:frame` | M→H | 发送帧请求 | □ |
| `render:frame-done` | H→M | 帧结果（方式 B） | □ |
| `render:ready` | H→M | 帧就绪（方式 A） | □ |
| `render:cancel` | M→H | 取消渲染 | □ |
| `render:error` | H→M | 渲染错误 | □ |

> R=Renderer (主窗口), M=Main Process, H=Hidden Export Window

### 4.2 导出流程测试

| 测试项 | 描述 | 预期结果 | 状态 |
|--------|------|----------|------|
| 串行调度 | 同时只有一个 `render:frame` | 无并发请求 | □ |
| 背压控制 | MAX_PENDING=5 | pending ≤ 5 | □ |
| 完整数据发送 | `export:start` 只发一次 | 验证计数=1 | □ |
| 帧请求精简 | 只发 frameIndex + timeMs | 无 project 数据 | □ |
| 流式写入 | `fs.promises.writeFile` | 无 sync 调用 | □ |
| 异步循环 | 无主进程同步循环 | 验证通过 | □ |
| 失败重试 | 最多 2 次 | 重试计数 ≤ 2 | □ |
| 失败终止 | 超过重试次数 | 导出终止，报错 | □ |
| 取消清理 | 取消后删除临时文件 | 目录不存在 | □ |
| 窗口尺寸 | 1920×1080 | 验证截图尺寸 | □ |
| DPI 无关 | setZoomFactor(1) | 不受缩放影响 | □ |

---

## 5. 端到端测试结果

### 5.1 应用启动

| 测试用例 | 步骤 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| 正常启动 | 双击应用 | 主窗口显示，1920×1080 逻辑尺寸 | | □ |
| 快速重启 | 关闭后立即启动 | 正常启动 | | □ |

### 5.2 项目操作

| 测试用例 | 步骤 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| 创建项目 | 启动应用 | 默认项目加载 | | □ |
| 导入素材 | 点击导入按钮 | 素材加入项目 | | □ |
| 保存项目 | 使用中文路径 | 文件保存成功，内容正确 | | □ |
| 打开项目 | 选择已保存项目 | 项目加载正确 | | □ |

### 5.3 预览功能

| 测试用例 | 步骤 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| 开始预览 | 点击预览按钮 | 时间轴开始走动 | | □ |
| 暂停预览 | 点击暂停按钮 | 时间轴停止 | | □ |
| 连续切换 | 快速点击预览/暂停 | 不崩溃 | | □ |
| 播放结束 | 播放到最后一帧 | 自动停止 | | □ |
| 中文字幕 | 包含中文对白的项目 | 字幕正确显示 | | □ |

### 5.4 导出功能

| 测试用例 | 步骤 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| 正常导出 | 点击导出 | 生成 MP4 文件 | | □ |
| 进度显示 | 导出过程中 | 进度条更新，显示帧号 | | □ |
| 取消导出 | 导出中点击取消 | 导出终止，临时文件清理 | | □ |
| 空项目导出 | 无镜头时导出 | 提示错误，不崩溃 | | □ |
| 中文路径导出 | 输出路径含中文 | 文件生成成功 | | □ |
| 方式 A 捕获 | 使用 capturePage | 帧尺寸正确 | | □ |
| 方式 B 捕获 | 使用 canvas.toBlob | 帧尺寸正确 | | □ |
| 帧尺寸检查 | 导出帧截图 | 严格 1920×1080 | | □ |
| 隐藏窗口失败 | 模拟窗口创建失败 | 终止导出，不回落主窗口 | | □ |
| 单帧失败 | 模拟帧捕获失败 | 重试 2 次，后终止 | | □ |
| 字体等待 | 导出前 | 等待 document.fonts.ready | | □ |
| 图片等待 | 导出前 | 等待全部图片 decode | | □ |
| 首次绘制 | 导出前 | 完成首次 Stage 绘制 | | □ |

### 5.5 FFmpeg 集成（如可用）

| 测试用例 | 步骤 | 预期结果 | 实际结果 | 状态 |
|----------|------|----------|----------|------|
| 版本检测 | 查询 FFmpeg 版本 | 返回版本号字符串 | | □ |
| 路径验证 | 验证有效路径 | 返回 true | | □ |
| 路径验证无效 | 验证无效路径 | 返回 false | | □ |
| 自动发现 | 不配置路径 | 发现 bundled/PATH/配置路径 | | □ |
| 视频编码 | 帧序列 + 音频 | 生成 H.264 + AAC MP4 | | □ |
| faststart | 检查输出文件 | moov 在文件头部 | | □ |
| 混音 | 多音轨项目 | amix + adelay 正确 | | □ |
| 进度回调 | 编码过程中 | stderr 解析实时进度 | | □ |

---

## 6. 性能测试（可选）

| 测试项 | 指标 | 预期 | 实际 | 状态 |
|--------|------|------|------|------|
| 导出 5 秒视频 | 总时间 | < 30 秒 | | □ |
| 帧渲染速度 | FPS | 稳定 24fps | | □ |
| 内存占用 | 导出中峰值 | < 1GB | | □ |
| 临时文件 | 单帧大小 | < 5MB | | □ |

---

## 7. 缺陷记录

| ID | 模块 | 描述 | 严重程度 | 优先级 | 状态 | 备注 |
|----|------|------|----------|--------|------|------|
| | | | | | | |
| | | | | | | |
| | | | | | | |

> 严重程度： blocker / critical / major / minor / trivial  
> 优先级： P0 / P1 / P2  
> 状态： open / fixed / verified / closed

---

## 8. 测试结论

### 8.1 通过标准

- [ ] 所有 P0 单元测试通过
- [ ] 所有 P0 集成测试通过
- [ ] 所有 P0 E2E 测试通过
- [ ] 无 blocker 级别缺陷
- [ ] 中文路径测试全部通过
- [ ] 导出流程稳定，无崩溃

### 8.2 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| FFmpeg 未安装 | 导出视频失败 | 提供 bundled FFmpeg 或安装指南 |
| DPI 缩放 > 100% | 帧尺寸偏差 | 使用 setZoomFactor(1) + offscreen |
| 中文字体缺失 | 字幕显示异常 | 打包 Noto Sans SC 字体 |
| 大项目内存溢出 | 导出失败 | 流式写入 + 限制并发帧数 |

### 8.3 签字确认

| 角色 | 姓名 | 日期 | 签字 |
|------|------|------|------|
| 测试负责人 | | | |
| 开发负责人 | | | |
| 产品负责人 | | | |

---

## 附录 A：测试命令

```bash
# 单元测试
npm run test:unit

# 单元测试（watch 模式）
npm run test:unit:watch

# E2E 测试
npm run test:e2e

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

## 附录 B：已知限制

1. **M0.5 为技术探针**：UI 为测试用途，非最终设计
2. **音频生成**：测试环境使用手动构造的 MP3 帧，非真实音频编码
3. **FFmpeg 依赖**：部分测试需要系统中安装 FFmpeg
4. **字体加载**：字幕渲染依赖系统字体，建议在测试环境中预装 Noto Sans SC

## 附录 C：参考文档

- `shared/types.ts` — 数据模型定义
- `shared/constants.ts` — 常量定义
- `shared/ipc-channels.ts` — IPC 通道常量
- `src/domain/evaluators/timelineEvaluator.ts` — 时间轴求值器
- `src/domain/evaluators/interpolators.ts` — 插值函数
- `electron/main/services/ExportService.ts` — 导出服务
- `electron/main/services/FFmpegAdapter.ts` — FFmpeg 封装
