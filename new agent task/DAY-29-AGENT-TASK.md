# Panda Stage Agent Task — Day 29

> **源工单编号**：R-29/45  
> **执行集群编号**：B29-CLUSTER/06  
> **标题**：Dialogue Audio + Simple Mouth + Single-Shot Preview  
> **模板**：ID-59 v3.0 通用增强版集群式开发派单模板  
> **路线状态**：Day 26～45 Rebaseline v1  
> **派单编写时审计基线**：`main@e5ba7fc8f67f7454da1ff57367e5ad7eb102ca66`（PR #231 / RH-07 merge）  
> **执行基线**：开工时必须重新记录当时最新稳定 `main`；禁止把上述审计基线当作未来固定 HEAD  
> **硬前置**：Day 26 / Day 27 / Day 28 均已 PASS + merged；Stage 3-B / ActionPreset / PR #177 不属于本日核心路线  
> **核心范围声明**：本日只把 Day28 已经“能写、能定时、能显示字幕”的 Dialogue 升级成“可绑定真实导入音频、可在既有 Product Preview 中单镜头播放、对白激活时做最简单张嘴/闭嘴视觉”的真实制作路径。禁止借机建设 TTS、精细口型、通用音频混音台、ActionPreset 或第二套 Preview/时钟/Project store。

---

# 【模块1】饱和攻击头部（通用增强版）

- **火力配置**：6 Agent（1 `Architect` + 5 `Engineer`，无 Audit 角色）
- **任务名称**：Day 29 — Dialogue Audio + Simple Mouth + Single-Shot Preview
- **轰炸目标**：在当前正式 `Dialogue.audioClipId -> Shot.audioClips[] -> AudioAsset` 数据链、既有 Asset Import/IPC 边界、既有 `ProductPreviewOverlay` 单镜头预览时钟和正式 Stage Renderer 上，完成可保存的对白音频绑定、可靠的单镜头音频播放、最简单的张嘴视觉以及完整清理/回放合同。
- **任务性质**：功能开发 + 既有数据合同扩展 + 安全 IPC + transient playback + 资源生命周期 + 真人 Windows Electron 验收
- **输入基线**：完整读取本工单【模块2】；B29-01 只允许验证 owner 是否漂移，不允许把“重新扫描代码”偷换成“重新发明一套架构”。
- **输出要求**：可执行产品功能 + 可复现自动化验证 + Draft FAST CI 实测 + Ready 唯一 Full Gate + 真实 Windows Electron 验收 + 显式债务声明 + `docs/test-receipts/DAY-29.md` 结构化收卷。
- **用户可见结果**：用户把项目素材库里的真实音频绑定到已定时 Dialogue 后，打开现有 Product Preview 可以 Play / Pause / Stop / Seek；播放时声音、字幕和当前对白保持一致；角色有 `mouthOpenAssetId` 时对白活跃且绑定音频期间显示张嘴图，无嘴图则安全保持正常角色画面；重复回放、切镜头、切项目不会叠音或残留旧状态。

## 1.1 通用铁律

1. **数据诚实**：HEAD、测试数、warning 数、耗时、Audio/Blob 实例计数、PASS/FAIL/PENDING、真人步骤只能来自真实命令或真实操作。
2. **零占位符**：禁止 fake AudioAsset、fake 播放、setTimeout 假装音频结束、临时 JSON 直改 `audioClipId` 作为产品验收、硬编码“嘴动了”。
3. **自动化优先**：绑定/重绑、clip 同步、资源清理、seek/pause/replay、IPC 路径安全、legacy overlap winner、Project/History 不污染必须优先自动化证明；真人 Electron 是最终 Gate。
4. **最小必要复杂度**：只做一条对白音频播放链和 0/1 张嘴视觉；不做 waveform、gain automation、RMS、Viseme、Rhubarb、phoneme、TTS、mix bus、multi-track mixer。
5. **债务透明化**：无法自动化的真实音频/声卡行为、浏览器媒体限制、测试 runner 对 `HTMLAudioElement` 的限制、legacy shared clip 等必须显式写 `DEBT-*`。
6. **唯一数据 owner**：持久化 Dialogue mutation 继续由 `DialogueService + dialogueStore` 负责；禁止第二套 Project mutation service。
7. **唯一预览 owner**：单镜头 Preview 继续由 `ProductPreviewOverlay + productPreviewModel + evaluateShotAtTime + StageRenderer` 负责；禁止新建第二个 Preview 页面或第二套时间轴播放器。
8. **唯一播放时钟**：`ProductPreviewOverlay` 的本地 `timeMs/currentTimeMs` 是 Preview 时间真相；音频只是从属 transport，不得反过来成为 Project/Timeline 的第二时钟。
9. **安全文件边界**：renderer 禁止拼本地文件路径、禁止 `file://` 直读导入音频；真实字节读取必须经 shared schema -> preload -> trusted IPC -> Main service。
10. **瞬态状态不落盘**：playing / paused / active audio element / Blob URL / async token / current source time / mouth preview 都不得进入 ProjectSchema、History、dirty、autosave。
11. **真人安全门优先**：自动化全绿但真实 Electron 听不到声音、叠音、seek 错位、嘴状态残留或切项目仍有旧音频，Day29 = FAIL。
12. **CI V2 生效**：Draft commit 只走 FAST/Targeted/Focused；Ready for Review 才跑当前最终候选唯一 Full；正常 proven merge 后只走 provenance fast-pass。若新目录被识别为 unknown，应登记 manifest 路由，不得用“每次 Full”掩盖 routing 缺口。
13. **状态诚实**：`automated/structural=PASS` 但 maintainer 真人 Windows Electron 未签字时，`overall=PENDING`；只有真人 Gate 完成后才可 `overall=PASS`。

> 人话版：这一轮不是再造电影院。我们已经有“屏幕、播放按钮、字幕、角色”了，现在只把真实音箱接上，再给角色加一个最朴素的“说话时张嘴”开关。线要从现有插座走，不能墙上再凿一套电路。🤣

---

# 【模块2】输入基线（完整技术背景，零占位符）

## 2.1 Git、前置 Day 与当前治理基线

| 输入项 | 当前已确认事实 | 开工验证命令 / 证据 | 状态 |
|---|---|---|---|
| 派单审计坐标 | `main@e5ba7fc8f67f7454da1ff57367e5ad7eb102ca66`，为 RH-07 / PR #231 merge commit | `git log --oneline -n 15` | 已确认 |
| Day29 执行坐标 | Agent 开工时重新读取最新 stable `main`，不得假定仍等于审计坐标 | `git branch --show-current`；`git rev-parse HEAD`；`git log --oneline -n 15` | 开工必须重录 |
| Day26 | Timeline / playhead / time geometry 已 PASS + merged | `cat docs/test-receipts/DAY-26.md` | 硬前置 |
| Day27 | Dialogue authoring / selection / History 已 PASS + merged | `cat docs/test-receipts/DAY-27.md` | 硬前置 |
| Day28 | Dialogue timing + subtitle track 已 PASS + merged；真人 Windows Electron 已 PASS | `cat docs/test-receipts/DAY-28.md` | **硬前置** |
| Day28 产品 merge | PR #222 已合入主线；当前 main 必须包含 Day28 产品代码 | `git merge-base --is-ancestor 8024a701a97b1ddacf18758eb55ac06a6e2b98c9 HEAD` | 开工验证 |
| CI V2 | RH-07 已合入；Draft FAST、Ready final Full、post-merge provenance 已真实跑通 | `git log --oneline --all --grep='Ready the final Full boundary'`；读取 `docs/ci-routing.md` | 执行约束 |
| main Gate | 正常 PR 需要 `Final CI result` + `Ready Full proof` 才允许 merge | GitHub branch protection / PR checks | 执行约束 |
| 禁止继承线 | Stage 3-B / ActionPreset / PR #177 不属于当前核心路线 | `git diff origin/main...HEAD --name-only`；`git log --oneline origin/main..HEAD` | 硬边界 |

### 2.1.1 开工阻塞规则

满足任一条，B29-01 必须把集群标记 `BLOCKED`，不得让实现 Agent 开始堆代码：

1. 最新 main 不包含 Day28 产品 merge。
2. `docs/test-receipts/DAY-28.md` 不再是 overall PASS，或出现未处理 P0。
3. `DialogueService/dialogueStore`、Asset Import/IPC、`ProductPreviewOverlay`、正式 Stage Renderer 任一 owner 在最新 main 已实质迁移，但新 owner 未记录。
4. 要实现音频播放只能绕过 preload/IPC 直接读本地绝对路径。
5. 要实现嘴动画必须复活 ActionPreset、PR #177、旧 `mouthMotionEvaluator` 或通用动作组合语义。
6. 需要建立第二个 Preview 时钟或把 transient 播放状态写进 Project 才能继续。
7. 当前 main CI routing 未识别本次新增正式 subsystem，且实现者打算以“Draft 自动 Full”代替 manifest 登记。

> 人话版：先确认桌子、对白本、播放器、素材仓库都还在原位。任何一个被人搬家了，先找地址，别六个人各自买一张新桌子。☝️🤣

## 2.2 当前正式持久化数据合同：**已有字段足够，Day29 默认不升 schema**

### 2.2.1 Dialogue

**Owner**：`src/domain/models/dialogue.ts`  
**关键结构**：`DialogueSchema` / `DialogueV5Schema`

当前正式 `Dialogue` 已包含：

```text
id
characterId
voiceProfileId
audioClipId?       <- 当前已是 optional persisted reference
subtitleStyleId
startMs
endMs
text
```

当前合同：

- `audioClipId` 已经是正式字段，Day29 **禁止再新增 `audioAssetId` 到 Dialogue**。
- `startMs/endMs` 已由 Day28 负责 timing；Untimed 仍允许 `startMs === endMs`。
- `audioClipId` 指向当前 shot 内 `audioClips[]`，不是直接指向 `Asset`。

### 2.2.2 AudioClip

**Owner**：`src/domain/models/audio.ts`  
**关键结构**：`AudioClipSchema`

```text
id
assetId
name
startMs
endMs
offsetMs  default 0
volume    default 1
```

Day29 必须沿用这条正式链：

```text
Dialogue.audioClipId
        ↓
Shot.audioClips[].id
        ↓
AudioClip.assetId
        ↓
Project.assets[] 中 kind='audio' 的 AudioAsset
```

### 2.2.3 AudioAsset

**Owner**：`src/domain/models/asset.ts`  
**关键结构**：`AudioAssetSchema`

当前 AudioAsset 已有：

```text
kind='audio'
mimeType
relativePath
sizeBytes
sha256
durationMs?
```

Day29 不新增第二套 `AudioAsset` 类型，不把绝对本地路径持久化进 Project。

### 2.2.4 Character mouth

**Owner**：`src/domain/models/character.ts`

当前 Character 已存在：

```text
mouthOpenAssetId?: Id
```

`src/domain/validators/projectReferences.ts` 已验证该引用存在时必须指向 image asset。

Day29 的“闭嘴”定义不是再新增一个 persisted `mouthClosedAssetId`；**闭嘴=当前正式 evaluator 正常算出来的角色 expression/base image**。有 `mouthOpenAssetId` 且当前有效对白正在发声时，Preview 临时使用 open-mouth image；离开对白区间立即回到正常 evaluated image。

### 2.2.5 Schema 结论

- 当前 `PROJECT_SCHEMA_VERSION = 6`。
- Day29 默认不新增 Project 字段，因此**不得因为“今天有音频/嘴”就顺手 bump schemaVersion**。
- 若 B29-02/B29-03 发现现有字段无法表达本轮最小目标，触发 `SCHEMA-001`，暂停并报告，不得边做边升级。

> 人话版：库房里其实早就有“对白对应哪段音频”“角色张嘴图是哪张”的空格了。今天是把这些空格真正用起来，不是重新印一本表格。🤓

## 2.3 当前引用完整性合同：必须复用

**Owner**：`src/domain/validators/projectReferences.ts`

当前 main 已经执行以下硬校验：

1. `AudioClip.assetId` 必须存在且是 `kind='audio'`。
2. AudioClip 使用前必须有 `asset.durationMs`。
3. `offsetMs + (endMs-startMs)` 不得超过源音频 `durationMs`。
4. AudioClip `endMs` 不得超过 shot duration。
5. `Dialogue.audioClipId` 若存在，必须引用同一 shot 中实际存在的 clip。
6. `Character.mouthOpenAssetId` 若存在，必须引用 image asset。

Day29 的 mutation 不得绕过这些 validator，也不得把失败的 binding 分两步落盘造成半有效 Project。

## 2.4 Day29 正式音频绑定语义（锁定）

### 2.4.1 绑定前提

- 只允许给 **Timed Dialogue**（`endMs > startMs`）绑定音频。
- Untimed Dialogue 点击绑定时必须可读失败：先安排对白时间，再绑定音频。
- 选择对象必须来自当前 Project 的 `AudioAsset`，不得接受 renderer 任意绝对路径。
- 选择的 AudioAsset 必须已有 `durationMs`。
- 新绑定默认：
  - `clip.startMs = dialogue.startMs`
  - `clip.endMs = dialogue.endMs`
  - `clip.offsetMs = 0`
  - `clip.volume = 1`
- 若源音频不足以覆盖整个 Dialogue duration，绑定必须**原子拒绝**；不得偷偷缩短 Dialogue、偷偷拉长音频或静默截断。

### 2.4.2 新绑定 / 重绑

`DialogueService` 是唯一持久化 mutation owner；建议扩展稳定、明确的方法，例如：

```text
bindAudio(project, { shotId, dialogueId, assetId })
```

最终 API 名可按当前 service 命名风格微调，但职责必须保持：**一次 pure Project -> Project mutation 同时维护 Dialogue + AudioClip**。

正式行为：

1. Dialogue 没有 `audioClipId`：创建一个新的 AudioClip，并把其 id 写入 Dialogue。
2. Dialogue 已引用 clip 且该 clip 只被本 Dialogue 引用：允许在同一 mutation 内重用/更新该 clip。
3. 若发现 legacy 数据中多个 Dialogue 共享同一 `audioClipId`：**禁止原地改坏别人**；采用 copy-on-write，为当前 Dialogue 新建 clip。
4. 新/重绑只允许生成一个有效结果；重复点同一绑定不得无意义增长多个 orphan clip。
5. AudioClip `name` 只做可读标签，不得作为 ownership identity；真正身份是 ID/reference。

**本日不强制做显式“解除绑定/删除 clip”产品功能。** 若实现自然需要提供“无音频”选项，必须先证明不会误删 shared/legacy clip；否则把 unbind 记录为后续债务，不得为凑 UI 扩大数据删除范围。

### 2.4.3 已绑定 Dialogue 的 timing 必须同步 AudioClip

Day28 的以下正式 mutation 已存在：

```text
setTiming
arrange
move
resize
```

Day29 一旦 Dialogue 有 `audioClipId`，上述 mutation 的成功结果必须保持：

```text
clip.startMs === dialogue.startMs
clip.endMs   === dialogue.endMs
```

并且：

- 保留已有 clip 的 `assetId / offsetMs / volume / name`。
- 新时间窗口导致 `offsetMs + duration > AudioAsset.durationMs` 时，**整个 timing mutation 原子拒绝**。
- 禁止先改 Dialogue 再让第二个异步步骤补 clip；Project/History 只能看到“全成功”或“完全不变”。
- no-op timing 仍必须保持 Day28 #224 合同：相同 timing 不新增 `updatedAt`/dirty/History。
- 一个有效 bind/rebind/timing 动作 = renderer 侧一个正式 History command。

> 人话版：对白和它的音频片段以后是一对绑在一起的饭盒。对白从 1 秒搬到 2 秒，音频饭盒要一起搬；不能对白先上车，音频说“我下班再过去”。🤣

## 2.5 Asset Import 与安全音频读取边界

### 2.5.1 导入继续走既有路径

当前 Asset Library 已经有 `audio` 分类和现有 `AssetImportPanel`。Day29 **不做 Dialogue 专用导入器**。

用户流程：

```text
通过现有 Asset Library 导入音频
→ 项目 assets[] 获得真实 AudioAsset
→ Dialogue Inspector 只负责选择/绑定这个已有项目音频
```

### 2.5.2 renderer 当前不能安全直读音频源

当前 preload `window.pandaStage.assets` 已有：

```text
choose / importDropped
refreshMetadata / cancelMetadata
delete
readThumbnail
readCanvasImage
```

但没有正式 audio preview read API。

Day29 因此需要一个**最小、只读、受控**的音频读取 seam，建议沿现有 Canvas Image 模式命名：

```text
src/shared/asset-preview-audio-api.ts
src/main/services/AssetPreviewAudioService.ts
src/main/ipc/register-asset-library-ipc-handlers.ts   (扩展)
src/shared/ipc/channels.ts                            (扩展)
src/preload/index.ts                                  (扩展)
```

如果开工时真实仓库已有同义 owner，则复用真实 owner，不允许为了匹配建议文件名再造一套。

### 2.5.3 Audio read request/response 最小合同

Request 至少绑定：

```text
projectRoot
assetId
sha256
```

成功 Response 至少包含：

```text
ok=true
assetId
mimeType
byteLength
bytes: Uint8Array
```

失败 Response 必须有稳定 error code + 可读 message，不暴露任意绝对路径或原始内部异常堆栈。

### 2.5.4 Main service 安全规则

参照当前 `AssetCanvasImageService` 的成熟边界，音频 service 必须验证：

1. `projectRoot` 当前由 Main Process 跟踪。
2. request `assetId` 存在于当前 Project。
3. asset `kind === 'audio'`。
4. request `sha256` 与 Project 中 asset sha 一致。
5. `relativePath` resolve 后仍在 `<projectRoot>/assets` 内；realpath 后再次检查，防 symlink/traversal。
6. 文件是非空 regular file。
7. 有明确有限的单次 payload size guard；不得允许一个恶意 Project 造成无界内存读取。具体上限应在代码常量 + contract test 中给出并说明理由。
8. Media inspection / MIME 与 Project metadata 不一致时失败。
9. 真实 bytes 的 SHA-256 必须再次匹配。
10. 同一 `projectRoot + assetId + sha256` 并发读取可像 Canvas image 一样 dedupe；完成后清理 in-flight map。
11. IPC handler 继续使用 trusted sender 校验。

禁止：

- renderer 传任意 `sourcePath`；
- renderer `fs.readFile`；
- `file://C:/...` 绕 preload；
- 复活 Day28 被丢弃的历史 `AssetAudioSourceService` / `asset-audio-api.ts` 代码并整块复制；只能读取当前 main 重新实现当前合同。

## 2.6 当前 Product Preview owner：只扩展，不另起炉灶

### 2.6.1 正式 owner

- `src/renderer/shell/ProductPreviewOverlay.tsx`
- `src/renderer/shell/productPreviewModel.ts`
- `src/domain/evaluate-shot-at-time.ts`
- `src/renderer/stage/CanvasStage.tsx`
- `src/renderer/stage/StageRenderer.tsx`
- shared subtitle projection/evaluator：
  - `src/shared/preview/dialogue-subtitle.ts`
  - `src/shared/preview/subtitle-engine.ts`

当前 Product Preview 已经：

- 有 local `timeMs` / playing 状态；
- 有 Play / Pause / Stop / Scrub/Seek；
- 用 requestAnimationFrame 推进预览时间；
- 用 `evaluateShotAtTime()` 得到正式 evaluated layer；
- 用 shared subtitle engine 显示 Dialogue 字幕；
- shot switch 会停止/复位当前 preview；
- Preview 是 read-only，不写 Project dirty。

Day29 禁止：

```text
再造 PreviewPage
再造 previewTimeStore
再造独立字幕 evaluator
让 HTMLAudio.currentTime 成为主时钟
```

### 2.6.2 音频 transport 从属合同

推荐使用**一个可复用的 `HTMLAudioElement` owner**（或仓库当前等价浏览器媒体 primitive）；本日不需要 AudioContext graph。

核心原则：

```text
Preview timeMs = 主时钟
HTMLAudioElement = 从属播放器
```

行为：

- Preview `playing=false` -> audio pause。
- Preview Play/Resume -> 根据当前 `timeMs` 算源音频位置后再 play。
- Seek -> 先停/重定位，下一次 Resume 从新位置发声。
- Stop -> pause + preview time reset 0；不得残留继续发声。
- 进入一个有绑定音频的 active Dialogue -> 只启动这一段音频。
- 离开 active Dialogue `[startMs,endMs)` -> 立即停该音频。
- 切到下一条 Dialogue -> 先停旧 source，再定位/播放新 source，禁止叠播。
- Preview 自然到 shot end -> 清理 active transport。
- 关闭 overlay / unmount / 切 shot / 切 project -> stop + invalidate async read + revoke Blob URL/resource。

源时间：

```text
sourceTimeMs = clip.offsetMs + (previewTimeMs - clip.startMs)
```

并且必须 clamp 到合法源区间。

### 2.6.3 资源生命周期合同

为了满足“Replay 5 次不持续增长资源”：

- 一个 Overlay 生命周期内禁止每次 Play 都 new 新 AudioContext。
- 若选择 `HTMLAudioElement`：元素 owner 应稳定复用，不得每次 RAF/new play 创建一个 element。
- 同一 `(projectRoot, assetId, sha256)` 已读取的 Blob URL 可以在该 preview/project session 内复用；不得每次 replay 再 fetch + 再 createObjectURL 且不释放。
- Project/shot/source identity 变化后旧异步响应必须失效。
- `URL.revokeObjectURL()` 必须有确定清理点。
- 测试应记录 factory/create/revoke 次数，而不是只断言 `play()` 被调用。

## 2.7 “当前谁在说话”必须与字幕对齐

Day28 已定义 shared subtitle winner：

- interval 为 half-open：`startMs <= t < endMs`；
- legacy overlap 允许读取；
- winner 使用现有 deterministic priority，而不是让每个子系统各猜一个人。

Day29 音频/嘴状态必须尽可能复用**当前字幕 cue 的 dialogue id**来决定 active Dialogue：

```text
buildDialogueSubtitleCues(dialogues)
→ evaluateSubtitleAtTime(cues, timeMs)
→ activeCue.id
→ resolve same Dialogue
```

因此：

- 新 authoring 正常无 overlap 时自然只有一个 active Dialogue。
- legacy overlap 时，字幕、声音、嘴至少在 Product Preview 中选择同一个 winner；本日不做多声道并播。
- orphan `Shot.audioClips[]`（没有被 Dialogue 引用）本日不自动播放，因为“多轨混音台”明确不在范围。

## 2.8 Simple Mouth 正式语义

**目标不是嘴型算法，只是一个二态视觉。**

在 Product Preview 当前 evaluated shot 上做**transient visual projection**，不得改 Project：

```text
active Dialogue exists
AND active Dialogue has a valid audioClipId
AND speaking Character has mouthOpenAssetId
→ 对该 character layer 临时使用 mouthOpenAssetId 作为 rendered asset

否则
→ 保留 evaluateShotAtTime() 已算出的正常 expression/base asset
```

硬规则：

1. active window 与字幕完全相同：`[startMs,endMs)`。
2. 有 Dialogue 但没绑定音频 -> 不张嘴。
3. 有绑定音频但角色没 `mouthOpenAssetId` -> 不报错，维持正常画面。
4. 切 project / shot / seek 出区间 / pause 后：
   - **pause**：时间不变，若当前点仍在 active Dialogue，画面可保持当前口型；声音必须停。
   - **seek 出区间 / stop / switch**：正常 evaluator 状态恢复，不得残留 mouth override。
5. 不读取音频振幅，不做开合频率，不做音素。
6. 不改 TimelineEvent，不创建 ActionPreset，不修改角色持久化字段。
7. `productPreviewModel` 现有 image preload 列表必须纳入 `mouthOpenAssetId`，否则第一次说话不能等到临时 fetch 才“闪一下”。

> 人话版：嘴不是“听声音实时分析”。规则就是：现在轮到这个人说、而且确实绑了音频？有张嘴图就换上。说完立刻换回原来那张。像两张表情包切换，别给它装语音识别博士帽。🤣

## 2.9 Dialogue Inspector 产品入口

当前已有 RightInspector / `DialogueInspector.tsx`，Day29 音频绑定 UI 必须长在这个正式 owner 上，不另造 DialogueEditor。

最低产品行为：

- 当前 Dialogue 清楚显示“音频：未绑定 / 已绑定素材名”。
- 只列当前 Project `kind='audio'` 的 assets。
- Untimed Dialogue 的音频选择明确 disabled 或提交时可读拒绝，并提示“先安排对白时间”。
- 绑定成功后通过 `dialogueStore` 走一次 History command。
- 绑定失败不改变 Project / dirty / revision / History。
- 重绑同一 asset 若最终 Project 无变化，不应制造假 History；若现有 clip metadata 需要修正则必须在收卷解释为何是有效变更。
- 不在此 Inspector 内另做文件选择器；导入按钮仍属于 Asset Library 现有路径。

## 2.10 当前已知测试 owner / 可复用验证面

当前 `tests/unit/` 已存在并应优先扩展：

```text
dialogue-service.test.ts
dialogue-store.test.ts
dialogue-inspector-timing.test.ts
dialogue-subtitle.test.ts
shot-evaluator.test.ts
product-preview-overlay.test.ts
preview-playback-engine.test.ts
asset-library-ipc-handlers.test.ts
asset-canvas-image-service.test.ts
ipc-contracts.test.ts
domain-schema.test.ts
```

允许按稳定 capability 新增：

```text
tests/unit/dialogue-audio-binding.test.ts
tests/unit/asset-preview-audio-service.test.ts
tests/unit/product-preview-audio.test.ts
tests/integration/dialogue-audio-preview.test.ts
```

禁止为了路线编号机械新增 `verify:day29`。如果需要新的 verification gate，必须使用稳定能力名（如 preview/dialogue/audio）并登记 verification manifest。

## 2.11 Day28 历史“被丢弃音频/嘴代码”的边界

Day28 最终 receipt 明确记录：旧 PR 范围里曾出现过但后来被**删除/恢复**的音频/嘴相关实现，包括历史路径：

```text
src/domain/evaluators/dialogueEvaluator.ts
src/domain/evaluators/mouthMotionEvaluator.ts
src/main/services/AssetAudioSourceService.ts
src/renderer/features/preview/AudioScheduler.ts
src/shared/asset-audio-api.ts
tests/unit/asset-audio-source-service.test.ts
tests/unit/audio-scheduler.test.ts
tests/unit/dialogue-evaluator.test.ts
tests/unit/product-preview-audio.test.ts
```

这些路径是**历史证据，不是 Day29 生产 owner**。

执行 Agent 禁止：

```text
git checkout 旧 commit 把整套代码搬回来
复制旧 PR 的 schema/action 设计
因为名字“看起来正好”就宣布复用
```

允许：只读比较旧实现以理解踩坑，但当前实现必须从最新 main owner/contracts 重新落地，并在决策记录中说明是否借鉴了任何思路。

## 2.12 风险边界 / 明确不做

本日明确不做：

- RMS / peak / envelope 驱动口型；
- Viseme / phoneme / Rhubarb / lip-sync engine；
- TTS Provider / 语音生成；
- waveform editor；
- 多轨混音台、BGM/SFX 自动并播、bus/effect；
- ActionPreset / PR #177 / 动作组合；
- 通用 TimelineEvent editor；
- 自动根据音频长度重排所有 Dialogue；
- whole-project preview（Day32 方向）；
- export/audio mux（后续 Day33～35 方向）；
- 新 ProjectSchema 字段，除非触发 SCHEMA-001 并经 maintainer 重新授权。

---

# 【模块3】工单矩阵（通用高压版）

## 3.0 集群拓扑与合并顺序

### Wave 0 — 只读锁 owner

```text
B29-01 Architect
```

B29-01 完成前，其余 Agent 只能建 worktree/拉依赖，不得改生产代码。

### Wave 1 — 三条互不抢 owner 的并行线

```text
B29-02 Persistent Dialogue↔Audio binding
B29-03 Secure Audio Read IPC
B29-04 Simple Mouth projection
```

三者必须在独立 branch/worktree；禁止互改对方 owner。

### Wave 2 — Playback transport

```text
B29-05 Single-Shot Preview Audio Transport
```

依赖 B29-02 + B29-03；读取 B29-04 的 mouth projection contract，但不拥有其文件。

### Wave 3 — 集成 / 验收 / 收卷

```text
B29-06 Integration + receipts + human gate package
```

依赖全部前置工单。

### Git 铁律

- 每个 Agent 独立 branch/worktree。
- 禁止 force-push 覆盖其他 Agent 历史。
- 禁止在共享 owner 上“顺手修”别人的任务；发现必须跨 owner 时先在 handoff 标记 `CROSS-OWNER-BLOCKER`。
- B29-06 按依赖顺序 merge/cherry-pick，保留真实 commit 历史与冲突记录。
- 集群交付 PR 初始保持 Draft；开发 commit 按 RH-07 走 FAST CI；所有生产功能+receipt ready 后才由 maintainer 转 Ready，触发最终候选唯一 Full。

---

## B29-01/06 — Architect：开工事实锁定与 blast-radius map

### 1）基础信息

- **角色**：`Architect`
- **目标**：只读确认最新 main 的数据 owner、Preview owner、Asset IPC owner、CI route 与 Day28 前置，产出一份可让五个 Engineer 不抢线的事实地图。
- **输入**：模块2全部事实；尤其 2.2～2.11。
- **依赖关系**：无；全集群唯一第一步。

### 2）输出交付物

- **生产文件变更**：无。
- **允许输出位置**：
  - PR/Issue comment；或
  - B29-06 最终写入 `docs/test-receipts/DAY-29.md` 的 `Preflight owner map` 段。
- **必须包含**：
  1. 真实 branch + HEAD。
  2. `DialogueService` / `dialogueStore` / `DialogueInspector` 当前符号与真实行号范围。
  3. `AudioClip` / `AudioAsset` / project reference validator 当前真实行号范围。
  4. `ProductPreviewOverlay` / `productPreviewModel` / `evaluateShotAtTime` / `StageRenderer` owner。
  5. Asset import/preload/main IPC handler/CanvasImageService 可复用安全模式。
  6. Day28 receipt overall PASS。
  7. RH-07 当前 `docs/ci-routing.md` + verification manifest 的相关 route。
  8. 明确列出 Wave1 三条线不得互改的 owner。
- **禁止包含**：设计第二架构、提交“顺手修复”、复制历史 Day28 discarded audio code。
- **交付证明**：命令输出 + path/symbol/line map。

### 3）规模与复杂度观察

纯只读。若 owner 无法唯一锁定，直接 `ARCH-001`，不得用猜测开工。

### 4）自动化质量闸门

| 闸门 | 要求 | 验证命令 | 不通过后果 |
|---|---|---|---|
| BUILD | N/A，只读预检 | `N/A：不改代码` | - |
| FMT | N/A | `N/A：不改代码` | - |
| LINT | N/A | `N/A：不改代码` | - |
| TEST | 前置 receipt/owner 可证 | `cat docs/test-receipts/DAY-28.md` + grep | BLOCKED |
| ARCH | owner 唯一可解释 | `git grep` / `nl -ba` | BLOCKED |
| REAL | 不用旧路径冒充现 owner | `git status --short` 应 clean | BLOCKED |
| DOC | preflight evidence 可被 B29-06 收录 | comment/receipt section | 返工 |

---

## B29-02/06 — Engineer：Persistent Dialogue ↔ Audio binding + timing sync

### 1）基础信息

- **角色**：`Engineer`
- **目标**：扩展现有 `DialogueService + dialogueStore + DialogueInspector`，用当前正式 AudioClip 数据链完成可 Undo/Redo/Save 的绑定与 timing 同步。
- **输入**：2.2、2.3、2.4、2.9；B29-01 owner map。
- **依赖关系**：依赖 B29-01；与 B29-03/B29-04 并行。

### 2）输出交付物

- **核心 owner 文件**：
  - `src/domain/services/DialogueService.ts`
  - `src/renderer/stores/dialogueStore.ts`
  - `src/renderer/features/dialogue/DialogueInspector.tsx`
- **测试 owner**：
  - `tests/unit/dialogue-service.test.ts`
  - `tests/unit/dialogue-store.test.ts`
  - 可新增 `tests/unit/dialogue-audio-binding.test.ts`
  - Inspector 相关现有测试按真实结构扩展
- **核心修改点**：
  - bind/rebind pure mutation；
  - legacy shared clip copy-on-write；
  - bound timing sync；
  - duration insufficiency atomic reject；
  - Inspector audio asset selector/status；
  - one successful action = one History command。
- **必须包含**：
  1. Untimed bind reject。
  2. non-audio/unknown asset reject。
  3. duration metadata missing/too short reject。
  4. new bind creates exact Dialogue-window clip。
  5. rebind does not leak duplicate clip。
  6. shared legacy clip COW。
  7. move/resize/setTiming/arrange sync clip timing。
  8. timing extension beyond source duration atomic reject。
  9. no-op timing remains no History。
  10. Save/reopen schema parse remains v6。
- **禁止包含**：
  - direct audio playback；
  - IPC；
  - new Project persisted field；
  - TTS/waveform；
  - ActionPreset。
- **交付证明**：focused vitest + before/after Project snapshots + History count + `git diff --check`。

### 3）规模与复杂度观察

- 绑定/同步必须集中在 domain owner，不要让 Inspector 手搓 `project.shots.map(...)`。
- 如 timing sync 让四个 mutation 分支复制同一逻辑，应抽一个最小私有 helper；不要为了模板拆十层 facade。
- 如果 shared legacy clip 语义无法安全判定，声明 `DEBT-SCOPE-B29-SHARED-CLIP` 并停，不得“先改了再说”。

### 4）自动化质量闸门

| 闸门 | 要求 | 验证命令 | 不通过后果 |
|---|---|---|---|
| BUILD | TS/build 通过 | `pnpm typecheck`；`pnpm build` | 返工 |
| FMT | 仓库无独立 fmt gate 时用 diff-check | `git diff --check` | 返工 |
| LINT | 本轮文件无 lint error | `pnpm exec eslint src/domain/services/DialogueService.ts src/renderer/stores/dialogueStore.ts src/renderer/features/dialogue/DialogueInspector.tsx tests/unit/dialogue-service.test.ts tests/unit/dialogue-store.test.ts` | 返工 |
| TEST | binding/timing/History 真行为 | `pnpm exec vitest run tests/unit/dialogue-service.test.ts tests/unit/dialogue-store.test.ts tests/unit/dialogue-audio-binding.test.ts --passWithNoTests=false`（若未新增该文件则去掉真实不存在路径并记录） | 返工 |
| ARCH | mutation 只经 DialogueService/store | `git grep -n "audioClipId" -- src/renderer/features/dialogue src/renderer/stores src/domain/services` | 返工 |
| REAL | 无 fake clip/fake asset | diff + ProjectSchema parse +真实 fixture | 返工 |
| DOC | handoff 写清 binding contract | B29-06 receipt 输入 | 返工 |

---

## B29-03/06 — Engineer：Secure Audio Preview Read IPC

### 1）基础信息

- **角色**：`Engineer`
- **目标**：在现有 Asset Library IPC 边界内增加一个只读 audio bytes API，让 renderer 能安全播放项目已导入的 AudioAsset，而不是获得任意磁盘路径。
- **输入**：2.5；B29-01 owner map；现有 `AssetCanvasImageService` 安全模式。
- **依赖关系**：依赖 B29-01；与 B29-02/B29-04 并行。

### 2）输出交付物

- **预计新文件**：
  - `src/shared/asset-preview-audio-api.ts`
  - `src/main/services/AssetPreviewAudioService.ts`
- **预计扩展文件**：
  - `src/shared/ipc/channels.ts`
  - `src/main/ipc/register-asset-library-ipc-handlers.ts`
  - `src/preload/index.ts`
  - preload/global typing 的当前真实 owner（B29-01 锁定后填写实际路径）
- **测试**：
  - 新增 `tests/unit/asset-preview-audio-service.test.ts`
  - 扩展 `tests/unit/asset-library-ipc-handlers.test.ts`
  - 扩展 `tests/unit/ipc-contracts.test.ts` 或当前 preload contract test
- **必须包含**：
  1. strict zod request/response；
  2. Uint8Array payload + byteLength agreement；
  3. supported audio MIME contract 与 MediaInspection 一致；
  4. project tracked check；
  5. asset exists/audio kind/hash check；
  6. assets-root resolve + realpath containment；
  7. symlink/traversal negative tests；
  8. file regular/nonempty/size guard；
  9. metadata/real SHA validation；
  10. trusted sender；
  11. concurrent identical read dedupe + cleanup。
- **禁止包含**：
  - 任意 renderer path read；
  - playback UI；
  - Project mutation；
  - 返回原始绝对 sourcePath；
  - 直接复活 discarded `AssetAudioSourceService`。
- **交付证明**：service tests + IPC handler tests + contract tests + typecheck/lint/build。

### 3）规模与复杂度观察

优先镜像 `AssetCanvasImageService` 的安全形状，不抽“万能二进制文件服务”。若 image/audio 共性足以抽 helper，也必须证明抽取不会扩大其他 IPC blast radius；否则保持两个小服务更安全。

### 4）自动化质量闸门

| 闸门 | 要求 | 验证命令 | 不通过后果 |
|---|---|---|---|
| BUILD | preload/main/renderer type contract 全通过 | `pnpm typecheck`；`pnpm build` | 返工 |
| FMT | diff 无空白错误 | `git diff --check` | 返工 |
| LINT | 新 API/service/handler lint 绿 | `pnpm exec eslint src/shared/asset-preview-audio-api.ts src/main/services/AssetPreviewAudioService.ts src/main/ipc/register-asset-library-ipc-handlers.ts src/preload/index.ts tests/unit/asset-preview-audio-service.test.ts tests/unit/asset-library-ipc-handlers.test.ts` | 返工 |
| TEST | 路径/哈希/MIME/size/IPC 全覆盖 | `pnpm exec vitest run tests/unit/asset-preview-audio-service.test.ts tests/unit/asset-library-ipc-handlers.test.ts tests/unit/ipc-contracts.test.ts` | 返工 |
| ARCH | renderer 不拿绝对路径 | `git grep -n "readFile\|file://\|sourcePath" -- src/renderer src/preload` + 人工解释命中 | 返工 |
| REAL | bytes 真实读取/真实 hash | 临时 project fixture + file bytes test | 返工 |
| DOC | error/size/security contract 写入 handoff | receipt | 返工 |

---

## B29-04/06 — Engineer：Simple Mouth Preview Projection

### 1）基础信息

- **角色**：`Engineer`
- **目标**：复用现有 Dialogue subtitle winner 与正式 evaluated shot，在 Product Preview 视觉层实现“有音频的 active Dialogue -> mouthOpenAssetId”的二态 mouth projection。
- **输入**：2.6、2.7、2.8；B29-01 owner map。
- **依赖关系**：依赖 B29-01；与 B29-02/B29-03 并行。仅依赖现有 `audioClipId` 字段，不依赖 B29-02 的实现细节。

### 2）输出交付物

- **核心 owner 文件**：
  - `src/renderer/shell/productPreviewModel.ts`
  - 如能保持 pure/shared 且当前 import 层允许，可新增一个稳定能力 helper；否则不要为形式拆文件
- **不得默认修改**：`src/domain/evaluate-shot-at-time.ts`；只有 B29-01 证明 mouth 必须进入 formal evaluator 且不会造成 domain/shared 逆向依赖时才允许提 `CROSS-OWNER-BLOCKER` 给 maintainer 决策。
- **测试**：
  - 新增/扩展 pure model test（推荐 `tests/unit/product-preview-mouth.test.ts`）
  - 必要时扩展 Stage render model test，但不得由本 Agent 修改 Audio transport test。
- **必须包含**：
  1. active cue -> same Dialogue identity；
  2. `[start,end)` exact boundary；
  3. no audioClipId -> normal evaluated asset；
  4. missing mouthOpenAssetId -> normal evaluated asset；
  5. active + audio + mouth -> speaking character layer uses mouth asset；
  6. 非 speaking character 不变；
  7. legacy overlapping Dialogues 使用同一个 subtitle winner identity；
  8. `listProductPreviewAssetIds()` 纳入 mouthOpenAssetId，且去重；
  9. 不改变 x/y/scale/rotation/opacity/zIndex/visibility；
  10. 输入 Project/EvaluatedShot 不被原地 mutation。
- **禁止包含**：
  - RMS/Viseme；
  - ActionPreset；
  - timeline event；
  - Project write；
  - 第二套 subtitle winner；
  - AudioElement/IPC。
- **交付证明**：pure unit tests with before/start/inside/end + legacy overlap + missing mouth。

### 3）规模与复杂度观察

这应该是一个很小的 pure projection；若代码开始出现音频 scheduler/state machine，说明越界到 B29-05。若为了嘴图必须改整个 StageRenderer 渲染树，先触发 `ARCH-MOUTH-001`，不要硬塞。

### 4）自动化质量闸门

| 闸门 | 要求 | 验证命令 | 不通过后果 |
|---|---|---|---|
| BUILD | type/build 绿 | `pnpm typecheck`；`pnpm build` | 返工 |
| FMT | diff-check | `git diff --check` | 返工 |
| LINT | model/helper/test 无 error | `pnpm exec eslint src/renderer/shell/productPreviewModel.ts tests/unit/product-preview-mouth.test.ts`（按实际文件） | 返工 |
| TEST | boundary/fallback/winner | `pnpm exec vitest run tests/unit/product-preview-mouth.test.ts tests/unit/dialogue-subtitle.test.ts` | 返工 |
| ARCH | 不改 Project/ActionPreset | `git diff --name-only` + `git grep -n "ActionPreset\|mouthMotionEvaluator" -- src/renderer/shell src/shared/preview` | 返工 |
| REAL | renderer model 真正 assetId 改变 | pure evaluated-shot fixture | 返工 |
| DOC | mouth fallback/legacy rule handoff | receipt | 返工 |

---

## B29-05/06 — Engineer：Single-Shot Preview Audio Transport

### 1）基础信息

- **角色**：`Engineer`
- **目标**：把 B29-03 的安全 audio bytes 接入现有 `ProductPreviewOverlay`，由现有 preview timeMs 驱动一个可复用、可清理、无叠播的单路 Dialogue audio transport。
- **输入**：2.6、2.7；B29-02 binding contract；B29-03 audio IPC contract；B29-04 active Dialogue/mouth projection handoff。
- **依赖关系**：B29-02 + B29-03 完成后启动；B29-04 可并行结束后合并。

### 2）输出交付物

- **核心 owner 文件**：
  - `src/renderer/shell/ProductPreviewOverlay.tsx`
- **允许新增**：
  - `src/renderer/shell/productPreviewAudio.ts` 或 `useProductPreviewAudio.ts`（只有在能把资源生命周期从 React UI 干净抽出时；禁止两套 owner）
- **测试**：
  - 新增 `tests/unit/product-preview-audio.test.ts`
  - 扩展 `tests/unit/product-preview-overlay.test.ts`
  - 复用/扩展 `tests/unit/preview-playback-engine.test.ts`（若当前 owner 仍相关）
- **核心修改点**：
  - 单 element/resource owner；
  - lazy asset load/cache；
  - active Dialogue/clip identity；
  - Play/Pause/Stop/Seek/Replay；
  - stale async invalidation；
  - URL revoke；
  - readable degraded status。
- **必须包含**：
  1. Play from 0；
  2. Play starting inside Dialogue；
  3. Pause audio immediately；
  4. Seek while paused -> no sound until resume；
  5. Seek during play -> old source stops, exact new source position；
  6. crossing clip boundary -> old audio stops before new starts；
  7. Stop -> no sound + time 0；
  8. natural shot end cleanup；
  9. 5x Replay element/objectURL count stable；
  10. switch shot/project/unmount invalidates old async reads；
  11. stale promise resolve cannot restart old audio；
  12. missing/corrupt asset -> clear warning, visual/subtitle Preview remains usable；
  13. orphan unbound `audioClips[]` are not automatically mixed；
  14. no Project dirty/revision/history mutation from playback。
- **禁止包含**：
  - audio as master clock；
  - AudioContext graph per play；
  - multi-track mixing；
  - direct filesystem path；
  - Project mutation；
  - mouth algorithm（只消费 B29-04 projection）。
- **交付证明**：fake media primitive only at unit boundary +真实 state-machine outcomes；必须断言 create/play/pause/currentTime/revoke/resource counts，不能只 spy `play()` 一次就算通过。

### 3）规模与复杂度观察

- React component 不应承载一大坨不可测试状态机；允许抽一个最小 transport helper/hook。
- 但禁止建“通用媒体引擎”。Day29 只有单路 Dialogue voice。
- 如果浏览器 autoplay policy 使无用户 gesture 的自动播放无法成立，保持“用户点击 Play”作为许可点，不得绕安全策略；记录 `DEBT-PLATFORM-AUDIO-B29`。

### 4）自动化质量闸门

| 闸门 | 要求 | 验证命令 | 不通过后果 |
|---|---|---|---|
| BUILD | renderer/preload contract 集成通过 | `pnpm typecheck`；`pnpm build` | 返工 |
| FMT | diff-check | `git diff --check` | 返工 |
| LINT | preview/audio files lint 绿 | `pnpm exec eslint src/renderer/shell/ProductPreviewOverlay.tsx src/renderer/shell/productPreviewAudio.ts tests/unit/product-preview-audio.test.ts tests/unit/product-preview-overlay.test.ts`（不存在的可选 helper 路径必须从实际命令删除并记录） | 返工 |
| TEST | transport/resource lifecycle | `pnpm exec vitest run tests/unit/product-preview-audio.test.ts tests/unit/product-preview-overlay.test.ts tests/unit/preview-playback-engine.test.ts` | 返工 |
| ARCH | timeMs 仍是唯一主时钟 | `git grep -n "currentTime\|timeMs\|AudioContext\|new Audio" -- src/renderer/shell` + 解释 | 返工 |
| REAL | 非 setTimeout 假播放；状态基于 media primitive | unit state + real Electron 由 B29-06 | 返工 |
| DOC | lifecycle/cleanup/平台限制 handoff | receipt | 返工 |

---

## B29-06/06 — Engineer：集成、CI、真实 Windows Electron Gate 与收卷

### 1）基础信息

- **角色**：`Engineer`
- **目标**：按 owner 顺序集成 B29-02～05，补跨模块自动化证据、准备并执行工程侧 Electron 验证，生成最终 maintainer 验收清单和 `DAY-29.md`；不重新拥有各子系统生产逻辑。
- **输入**：全部 handoff + B29-01 owner map。
- **依赖关系**：所有前置工单完成。

### 2）输出交付物

- **默认生产文件变更**：无；仅允许修 integration glue，且必须标注原 owner 同意/冲突原因。
- **测试/文档**：
  - `tests/integration/dialogue-audio-preview.test.ts`（若当前 integration harness 适配）
  - 必要 contract tests
  - `docs/test-receipts/DAY-29.md`
  - verification manifest route 仅在真实新增 subsystem 未被当前 route 覆盖时修改
- **必须包含**：
  1. 综合 focused tests；
  2. `pnpm typecheck`；
  3. lint（准确记录当前 repo 全局/局部结果，不得藏历史噪音）；
  4. unit；
  5. integration；
  6. build；
  7. `git diff --check`；
  8. Draft CI 实际走 FAST/Focused/Targeted，不应因普通 commit 跑 Full；
  9. Ready 前 `overall=PENDING`；
  10. maintainer Ready 后最终候选 Full GREEN + Ready Full proof + Final CI result；
  11. merge 后 provenance fast-pass，不重复 Full（正常 proven merge）。
- **禁止包含**：
  - 为让 CI 绿而改测试阈值/删测试；
  - B29-06 自己大规模重写 B29-02～05；
  - 自动把 maintainer Windows 真人验收写 PASS；
  - bypass rules merge 作为正常交付。

### 3）规模与复杂度观察

集成冲突超过“import/类型/小 glue”即视为 owner 合同不一致，退回对应 Agent，不在 B29-06 堆 if。连续两个跨子系统新 P0 触发 `INTEGRATION-STOP-001`。

### 4）自动化质量闸门

| 闸门 | 要求 | 验证命令 | 不通过后果 |
|---|---|---|---|
| BUILD | 全 repo build 绿 | `pnpm build` | FAIL |
| FMT | diff 无 whitespace error | `git diff --check` | FAIL |
| LINT | 当前正式 lint truth 如实记录 | `pnpm lint`；必要时补 `pnpm exec eslint src tests` 作为范围证据，但不得拿后者伪装前者 PASS | FAIL/显式历史债务 |
| TEST | focused + unit + integration | 下方命令库 | FAIL |
| ARCH | no ActionPreset/no second preview/no renderer fs | grep + changed-file audit | FAIL |
| REAL | 真实 Windows Electron 主路径 | 模块3-A / 模块4 真人步骤 | PENDING/FAIL |
| DOC | receipt 完整 | `git diff -- docs/test-receipts/DAY-29.md` | FAIL |

---

# 【模块3-A】刀刃表（16项，强制命令化）

> 所有 `[ ]` 由执行集群在真实产物上填写。未执行不得提前改成 PASS。

| 类别 | 检查点ID | 检查目标 | 验证命令 / 证据 | 状态 |
|---|---|---|---|---|
| FUNC | FUNC-001 | Timed Dialogue 绑定真实 AudioAsset 后生成/维护正确 AudioClip reference | `pnpm exec vitest run tests/unit/dialogue-service.test.ts tests/unit/dialogue-store.test.ts` + binding test | [ ] |
| FUNC | FUNC-002 | Product Preview Play/Pause/Stop/Seek 驱动真实单路 Dialogue audio | `pnpm exec vitest run tests/unit/product-preview-audio.test.ts tests/unit/product-preview-overlay.test.ts` + Electron | [ ] |
| FUNC | FUNC-003 | active audio Dialogue + mouth asset 时张嘴，区间外恢复 | pure mouth test + Windows Electron | [ ] |
| FUNC | FUNC-004 | bound Dialogue timing 修改与 AudioClip 原子同步 | dialogue service/store focused test | [ ] |
| CONST | CONST-001 | 无新 Project persisted field / schemaVersion bump | `git diff origin/main...HEAD -- src/domain/models src/domain/constants.ts` +解释 | [ ] |
| CONST | CONST-002 | renderer 不直接读文件，audio bytes 经 trusted IPC | `git grep -n "readFile\|file://\|sourcePath" -- src/renderer src/preload` + IPC tests | [ ] |
| CONST | CONST-003 | Preview timeMs 唯一主时钟；playback 不写 Project/History | grep + store snapshot assertions | [ ] |
| CONST | CONST-004 | CI 遵守 RH-07：Draft 非 Full，Ready final Full，merge provenance | GitHub Actions receipts | [ ] |
| NEG | NEG-001 | Untimed / 非 audio / missing duration / too-short source 原子拒绝 | binding negative tests | [ ] |
| NEG | NEG-002 | traversal/symlink/hash mismatch/untrusted sender 被拒绝 | audio service + IPC tests | [ ] |
| NEG | NEG-003 | stale async read / switch shot/project / unmount 不残留旧音频 | transport tests + Electron | [ ] |
| NEG | NEG-004 | missing mouthOpenAssetId / missing audio source 安全降级，不 crash | pure model + Electron | [ ] |
| UX | UX-001 | Inspector 能看懂未绑定/已绑定和为何不能绑定 | real Electron + component assertions | [ ] |
| UX | UX-002 | Pause→Seek→Resume / Stop / Replay 操作结果符合用户直觉，无叠音 | real Electron | [ ] |
| E2E | E2E-001 | 1 shot + 3 Dialogue + 3 real audio，从导入/绑定到 Preview 完整走通 | Windows Electron maintainer evidence | [ ] |
| High | HIGH-001 | Replay 5x + 切项目，element/blob/resource 不持续增长且旧声音彻底停止 | instrumented test + Windows Electron | [ ] |

### 刀刃表铁律

1. 同一命令覆盖多个检查点时，receipt 必须说明覆盖关系。
2. 真实音频“听见/没叠音”不可仅靠 jsdom mock 替代；自动化用于行为合同，Windows Electron 用于最终声卡/媒体事实。
3. `N/A` 必须写原因 + 替代证据。
4. 任何“我看代码应该没问题”不算状态证据。

---

# 【模块3-B】地狱红线（10项，Day29 定制）

1. **伪音频**：setTimeout / console log / fake promise 代替真实媒体播放，却宣称 Play 完成 → 返工。
2. **绕 IPC**：renderer 读取任意绝对路径、`file://` 播放项目源文件 → 返工。
3. **双 Project owner**：Inspector 直接深拷贝/手搓 AudioClip，绕过 DialogueService/store → 返工。
4. **双时钟**：Audio currentTime 与 Preview timeMs 各走各的，seek 后靠“差不多同步” → 返工。
5. **资源泄漏**：每次 Replay 创建新 element/context/blob URL 且无 deterministic cleanup → 返工。
6. **嘴型越界**：引入 RMS/viseme/ActionPreset/mouth timeline event 来完成简单二态嘴 → 返工。
7. **schema 偷渡**：新增 persisted audio/mouth/playback 字段或 bump schemaVersion 未触发 SCHEMA-001 → 返工。
8. **数据损坏**：rebind/timing 让 shared legacy AudioClip 被别的 Dialogue 一起改坏，或失败后只改了一半 → 返工。
9. **CI 回退**：普通 Draft commit 因新 subsystem 未登记就反复 Full，而不修 manifest routing → 返工。
10. **真人验收造假**：自动测试/CI 绿就写 Windows audio PASS，未真实听/操作 → Day29 FAIL。

---

# 【模块4】P4 自测轻量检查表 v3.0（Day29）

| 检查点 | 自检问题 | 覆盖 `[ ]` | 相关用例 / 命令 | 备注 |
|---|---|---|---|---|
| CF | bind、playback、mouth、timing sync 每个核心功能是否至少一条标准路径？ | [ ] | focused vitest + Electron | |
| RG | Day28 timing/subtitle/#224 no-op、Project validator、RH-07 CI 是否回归？ | [ ] | unit + CI receipts | |
| NG | Untimed、短音频、坏 hash、坏 path、stale async、missing mouth 是否覆盖？ | [ ] | negative tests | |
| UX | Inspector 状态、Pause/Seek/Resume、Stop、错误提示是否真实可理解？ | [ ] | Windows Electron | |
| E2E | 导入→绑定→保存→Preview→回放完整链是否真实走通？ | [ ] | E2E-001 | |
| High | 5x replay / switch project 资源和声音是否干净？ | [ ] | HIGH-001 | |
| 字段完整性 | 每条验证是否写前置、预期、实际、证据？ | [ ] | receipt | |
| 需求映射 | 验证是否映射回 Day29 源目标？ | [ ] | receipt matrix | |
| 自测执行 | 是否至少完整跑一轮自动化而非静态阅读？ | [ ] | command transcript | |
| 范围债务 | 未做 TTS/细口型/混音/whole-project preview 是否明确？ | [ ] | debt/non-goals | |

## 4.1 真实 Windows Electron 最终验收（maintainer Gate）

> 这一段由 maintainer 真人执行/签字。Agent 可以准备数据和步骤，**不能代签**。

### A. 准备

1. 使用真实 Windows Electron，不用浏览器 dev server 代替。
2. 打开一个正式 Project，建立一个至少能容纳 3 条不重叠 Timed Dialogue 的 shot。
3. 使用**现有 Asset Library Import** 导入 3 个真实可听音频；禁止 DevTools 手改 JSON。
4. 至少一个 speaking character 有有效 `mouthOpenAssetId`；另准备一个**没有 mouthOpenAssetId** 的角色用于降级测试。

### B. 持久化绑定

1. 在现有 Dialogue Inspector 给 3 条 Dialogue 分别选择真实 audio asset。
2. 每次绑定确认 UI 显示素材身份。
3. Save → close project → reopen；确认 `audioClipId`/AudioClip 关系仍在，项目正常打开。
4. 对一个已绑定 Dialogue 做 move/resize；确认音频仍跟着 Dialogue 新区间，不出现“字幕搬了、声音留原地”。
5. Undo/Redo 后 timing + audio relation 一起恢复。

### C. 单镜头完整播放

1. 打开既有 Product Preview。
2. 从 shot start Play 到 shot end。
3. 三段 Dialogue 应按时间顺序：
   - 听到对应声音；
   - 看见对应字幕；
   - 有嘴图的角色在当前对白期间显示 open-mouth；
   - 对白结束即恢复正常 evaluated image。
4. 不允许两段 dialogue voice 同时叠播（legacy overlap 只播 deterministic winner）。

### D. Pause / Seek / Resume / Stop

1. 在第 2 条 Dialogue 中间 Pause：声音立刻停止，playhead/time 停在当前点。
2. paused 状态 Seek 到第 3 条 Dialogue 内部：不得在尚未 Resume 时自己发声。
3. Resume：从第 3 条对应 source offset 开始，不从音频头部错误重播。
4. Seek 回第一条内部，再确认旧 source 已停且新 source 正确。
5. Stop：声音停止、Preview time 回到 0、旧 mouth/subtitle 状态不残留。

### E. Replay 5 次

连续完整/局部 Replay 5 次：

- 无明显叠音；
- 不出现一次比一次多的重复声音；
- DevTools/日志中无持续增长的 active AudioElement/BlobURL（若有 instrumentation，记录实际 count）；
- 不产生 Project dirty/History 命令。

### F. 降级与清理

1. 切到无 mouthOpenAssetId 的 speaking character：声音/字幕仍正常，角色保持普通图，不 crash。
2. 播放中切 shot：旧声音立即停止，旧 subtitle/mouth 不残留。
3. 播放中切 Project：旧声音立即停止；新项目不显示旧 caption/mouth；旧 async load 之后返回也不能复活声音。
4. 关闭 Preview overlay 后不继续发声。

### 真人结论规则

- 任一 B～F 主路径 FAIL -> `overall=FAIL`。
- 自动化/CI 全绿但真人未执行 -> `overall=PENDING`。
- 全部真人项 PASS + Ready final Full GREEN -> `overall=PASS`。

---

# 【模块5】收卷格式（强制结构）

```markdown
# Panda Stage Day 29 / B29-CLUSTER 收卷

## Identity
- Day29 canonical task: `new agent task/DAY-29-AGENT-TASK.md`
- Day29 开工 main: `<真实 SHA>`
- Day29 delivery HEAD: `<真实 SHA>`
- Delivery PR: `<真实 PR>`
- Day28 prerequisite: `PASS + merged`
- RH-07 CI policy: `active`

## Status
- B29-01 preflight: `PASS/FAIL`
- B29-02 binding: `PASS/FAIL`
- B29-03 audio IPC: `PASS/FAIL`
- B29-04 mouth projection: `PASS/FAIL`
- B29-05 audio transport: `PASS/FAIL`
- B29-06 integration: `PASS/FAIL`
- automated/structural: `PASS/FAIL`
- maintainer Windows Electron: `PENDING/PASS/FAIL`
- overall: `PENDING/PASS/FAIL`

## Preflight owner map
- Dialogue mutation owner: [真实 path/symbol/lines]
- Dialogue renderer store: [真实]
- Dialogue inspector: [真实]
- Audio model/reference validator: [真实]
- Asset import owner: [真实]
- Audio read IPC owner: [真实新/复用]
- Preview clock owner: [真实]
- Mouth projection owner: [真实]
- Stage renderer owner: [真实]
- CI route owner: [真实]

## Changed files
[git diff --name-status origin/main...HEAD 真实输出]

## Binding contract evidence
- Untimed reject: [PASS/FAIL]
- new bind: [PASS/FAIL]
- rebind no leak: [PASS/FAIL]
- shared legacy clip COW: [PASS/FAIL]
- source-too-short atomic reject: [PASS/FAIL]
- timing sync set/arrange/move/resize: [PASS/FAIL]
- no-op timing: [PASS/FAIL]
- History one-command: [PASS/FAIL]
- save/reopen: [PASS/FAIL]

## Audio IPC security evidence
- tracked project: [PASS/FAIL]
- audio kind: [PASS/FAIL]
- hash identity: [PASS/FAIL]
- traversal: [PASS/FAIL]
- symlink escape: [PASS/FAIL]
- size guard: [真实上限 + PASS/FAIL]
- MIME/inspection: [PASS/FAIL]
- actual SHA: [PASS/FAIL]
- trusted sender: [PASS/FAIL]
- concurrent dedupe/cleanup: [PASS/FAIL]

## Preview transport evidence
- single clock: [PASS/FAIL]
- play inside clip: [PASS/FAIL]
- pause: [PASS/FAIL]
- seek paused: [PASS/FAIL]
- seek playing: [PASS/FAIL]
- clip transition: [PASS/FAIL]
- stop: [PASS/FAIL]
- shot end: [PASS/FAIL]
- stale async: [PASS/FAIL]
- 5x replay resource counts: [真实值]
- object URL create/revoke: [真实值]
- Project dirty/revision/History: [真实值]

## Mouth evidence
- before/start/inside/end half-open: [PASS/FAIL]
- no audio: [PASS/FAIL]
- no mouth asset: [PASS/FAIL]
- speaking layer asset override: [PASS/FAIL]
- non-speaking layer unchanged: [PASS/FAIL]
- legacy overlap winner matches subtitle: [PASS/FAIL]
- mouth asset preloaded: [PASS/FAIL]

## Automated quality report
- typecheck: [真实]
- lint: [真实]
- focused tests: [真实文件/测试数]
- unit: [真实文件/测试数]
- integration: [真实文件/测试数]
- build: [真实]
- git diff --check: [真实]

## CI V2 receipts
- Draft FAST/Focused/Targeted run: [run id + route + duration + Full skipped?]
- Ready final candidate SHA: [SHA]
- Ready Full run: [run id + PASS/FAIL]
- Ready Full proof: [PASS/FAIL]
- Final CI result: [PASS/FAIL]
- Post-merge provenance: [run id + PASS/FAIL]
- Post-merge Full: [SKIPPED / fallback + 原因]

## Maintainer Windows Electron
- environment: [Windows/Electron/window/DPI]
- 3 dialogue + 3 audio full play: [PASS/FAIL]
- audio/subtitle/mouth alignment: [PASS/FAIL]
- Pause→Seek→Resume: [PASS/FAIL]
- Stop: [PASS/FAIL]
- Replay 5x: [PASS/FAIL]
- missing mouth fallback: [PASS/FAIL]
- move/resize bound dialogue: [PASS/FAIL]
- Undo/Redo: [PASS/FAIL]
- Save→close→reopen: [PASS/FAIL]
- switch shot: [PASS/FAIL]
- switch project: [PASS/FAIL]
- close preview cleanup: [PASS/FAIL]
- DevTools/JSON direct mutation used as acceptance evidence: `NO`

## Key decisions
- DECISION-B29-DATA-LINK: `Dialogue.audioClipId -> AudioClip -> AudioAsset`
- DECISION-B29-NO-SCHEMA-BUMP: [确认]
- DECISION-B29-BINDING-OWNER: [真实]
- DECISION-B29-SHARED-CLIP: [COW 行为]
- DECISION-B29-AUDIO-READ: [真实 IPC owner]
- DECISION-B29-MASTER-CLOCK: [真实]
- DECISION-B29-AUDIO-PRIMITIVE: [HTMLAudioElement/等价 + 理由]
- DECISION-B29-ACTIVE-DIALOGUE: [如何与 subtitle winner 对齐]
- DECISION-B29-MOUTH: [transient projection owner]
- DECISION-B29-CLEANUP: [identity + resource policy]

## Debt
- DEBT-COMPLEXITY-B29: [无/描述]
- DEBT-TEST-B29: [无/描述]
- DEBT-DOC-B29: [无/描述]
- DEBT-SCOPE-B29: [无/描述]
- DEBT-PERF-B29: [无/描述]
- DEBT-PLATFORM-AUDIO-B29: [无/描述]
- DEBT-LEGACY-AUDIO-B29: [无/描述]

## Day conclusion
- automated FAIL -> overall FAIL
- automated PASS + human pending -> overall PENDING
- human any main path FAIL -> overall FAIL
- all mandatory gates + human PASS -> overall PASS

## 下一步唯一动作
[只写一条；overall != PASS 时不得写 Day30 产品开发]
```

---

# 【模块6】技术熔断预案（非时间熔断）

| 熔断ID | 触发条件 | 动作 | 后果 |
|---|---|---|---|
| PREREQ-001 | Day28 不再 PASS/merged 或最新 main owner 漂移无法解释 | 全集群停止生产修改 | 重新校准 |
| ARCH-001 | 需要第二 Project store / 第二 Preview / 第二 clock 才能继续 | 暂停方案 | maintainer 决策 |
| SCHEMA-001 | 最小目标要求新增 persisted 字段或 bump v6 | 停止实现 | 拆 schema 工单/重新授权 |
| AUDIO-IPC-001 | 只能用绝对路径/file:// 绕 preload 才能播放 | 停止 playback | 先修安全 seam |
| AUDIO-DATA-001 | Dialogue↔AudioClip 无法原子同步或 legacy shared clip 会被破坏 | 停止 binding | 收敛数据语义 |
| AUDIO-RESOURCE-001 | Replay 导致 element/context/blob 资源持续增长 | 停止 UX 扩展 | 先修 cleanup |
| CLOCK-001 | Preview timeMs 与 audio clock 无法在 seek/pause 后确定同步 | 停止播放实现 | 重新收敛单主时钟 |
| MOUTH-001 | 最小 mouth 必须进入 ActionPreset/TimelineEvent/复杂 evaluator | 停止 | 降级到二态 projection |
| QUALITY-001 | typecheck/lint/unit/integration/build 连续失败且不是一次小错 | 停止继续加功能 | 先恢复质量 |
| TEST-001 | runner 无法模拟真实媒体行为 | 自动化降级为 transport contract + Windows Electron，声明 `DEBT-TEST` | 真人证据加重 |
| CI-001 | Draft 普通 commit 再次自动 Full，因为新路由 unknown | 停止继续 push | 补 manifest route，不改回旧策略 |
| INTEGRATION-STOP-001 | 集成连续出现 2 个跨 owner 新 P0 | 停止“再补一个 if” | 导出证据给 maintainer |
| HUMAN-001 | 自动化绿但真实 Electron 音频/seek/replay/mouth/switch 任一主路径 FAIL | overall=FAIL | 不进 Day30 |

---

# 【模块7】派单口令（Day29 定制版）

启动饱和攻击集群，执行 **Panda Stage Day 29：Dialogue Audio + Simple Mouth + Single-Shot Preview**！

## 技术背景

- 最新派单审计 main：`e5ba7fc8f67f7454da1ff57367e5ad7eb102ca66`；执行 Agent 开工必须重新记录实际 stable main。
- Day28 已 overall PASS + merged；Dialogue timing / subtitle / Preview 均已有正式 owner。
- 持久化数据链已经存在：`Dialogue.audioClipId -> Shot.audioClips -> AudioClip.assetId -> AudioAsset`。
- `Character.mouthOpenAssetId` 已存在；闭嘴使用正常 evaluated expression/base image，不新增 mouthClosed persisted 字段。
- Asset Import 已支持 audio；Dialogue 不新增文件导入器。
- Preview 已有 Play/Pause/Stop/Scrub/timeMs；今天只接真实 audio transport。
- renderer 当前没有 audio bytes read API；必须按现有 CanvasImage trusted IPC 安全边界补最小 seam。
- CI V2 已生效：Draft FAST，Ready 单次 final Full，merge 后 provenance。

## 关键约束

- B29-01 先只读锁 owner。
- B29-02/B29-03/B29-04 Wave1 并行，禁止抢文件。
- B29-05 等 binding + audio IPC 后接 Preview。
- B29-06 只做集成/证据/receipt，跨 owner 大改退回原 Agent。
- 不升 schema，不复活旧 Day28 discarded audio/mouth code。
- 不播放 orphan audioClips，不做 multi-track mixer。
- active Dialogue 与字幕 winner 对齐；legacy overlap 只播一个 deterministic winner。
- Preview timeMs 是唯一主时钟，音频从属。
- 所有 playback/mouth 状态 transient，不 dirty。
- 真人 Gate 必须真实听、真实 seek/replay/switch。

## 工单并行矩阵

- `B29-01 Architect`：owner/preflight map
- `B29-02 Engineer`：Dialogue↔AudioClip binding + timing sync
- `B29-03 Engineer`：secure AudioAsset bytes IPC
- `B29-04 Engineer`：simple mouth preview projection
- `B29-05 Engineer`：single-shot audio transport
- `B29-06 Engineer`：integration / CI receipts / Windows acceptance package / Day29 receipt

## 验收铁律

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

Focused 最低集合（按实际新增文件存在情况调整路径，但不得跳过对应能力）：

```bash
pnpm exec vitest run \
  tests/unit/dialogue-service.test.ts \
  tests/unit/dialogue-store.test.ts \
  tests/unit/dialogue-subtitle.test.ts \
  tests/unit/asset-preview-audio-service.test.ts \
  tests/unit/asset-library-ipc-handlers.test.ts \
  tests/unit/product-preview-audio.test.ts \
  tests/unit/product-preview-overlay.test.ts \
  tests/unit/product-preview-mouth.test.ts
```

真实 Windows Electron：

> 现有 Asset Library 导入 3 个真实音频 → Inspector 给 3 条 Timed Dialogue 绑定 → Save/重开 → Product Preview 从头播完 → 核对声音/字幕/嘴 → Pause→Seek→Resume → Stop → Replay 5 次 → 无嘴图降级 → move/resize + Undo/Redo → 播放中切 shot → 播放中切 project → 关闭 Preview；任何旧声音/字幕/嘴残留都算 FAIL。

## CI 交付

```text
Draft commits
→ FAST / Targeted / Focused（Full 不应自动跑）

全部完成 + receipt 结构就绪
→ maintainer Ready for Review
→ 当前最终候选唯一 Full
→ Ready Full proof + Final CI result GREEN
→ normal merge
→ Post-merge provenance fast-pass
```

若 Ready 后代码再变，旧 Full proof 自动失效；新候选重新 Ready Full，这不算重复劳动。

## 收卷要求

- 必须创建 `docs/test-receipts/DAY-29.md`。
- 自动化绿、真人未签字：overall=PENDING。
- 真人主路径任一 FAIL：overall=FAIL。
- 只有 overall=PASS 才允许 Day30 产品开发。

Ouroboros 闭环启动，**B29-CLUSTER/06**，执行！ ☝️🐍♾️🔥

---

# 【模块8】通用验证命令库（本工单实际技术栈）

## 8.1 Git / prerequisite

```bash
git branch --show-current
git rev-parse HEAD
git log --oneline -n 15
git status --short
git merge-base --is-ancestor 8024a701a97b1ddacf18758eb55ac06a6e2b98c9 HEAD
cat docs/test-receipts/DAY-26.md
cat docs/test-receipts/DAY-27.md
cat docs/test-receipts/DAY-28.md
cat docs/ci-routing.md
git diff --name-status origin/main...HEAD
git diff --stat origin/main...HEAD
git diff --check
```

## 8.2 Owner / 行号锁定

```bash
nl -ba src/domain/models/dialogue.ts
nl -ba src/domain/models/audio.ts
nl -ba src/domain/models/asset.ts
nl -ba src/domain/models/character.ts
nl -ba src/domain/services/DialogueService.ts | sed -n '1,460p'
nl -ba src/domain/validators/projectReferences.ts | sed -n '1,420p'
nl -ba src/renderer/stores/dialogueStore.ts | sed -n '1,420p'
nl -ba src/renderer/features/dialogue/DialogueInspector.tsx | sed -n '1,420p'
nl -ba src/renderer/shell/ProductPreviewOverlay.tsx | sed -n '1,520p'
nl -ba src/renderer/shell/productPreviewModel.ts | sed -n '1,420p'
nl -ba src/domain/evaluate-shot-at-time.ts | sed -n '1,380p'
nl -ba src/renderer/stage/StageRenderer.tsx | sed -n '1,420p'
nl -ba src/shared/preview/dialogue-subtitle.ts
nl -ba src/shared/preview/subtitle-engine.ts
nl -ba src/preload/index.ts | sed -n '1,420p'
nl -ba src/main/ipc/register-asset-library-ipc-handlers.ts | sed -n '1,420p'
nl -ba src/main/services/AssetCanvasImageService.ts | sed -n '1,420p'
```

## 8.3 Blast radius

```bash
git grep -n "audioClipId\|audioClips\|AudioClipSchema" -- src tests
git grep -n "mouthOpenAssetId" -- src tests
git grep -n "ProductPreviewOverlay\|buildProductPreviewCues\|buildDialogueSubtitleCues\|evaluateSubtitleAtTime" -- src tests
git grep -n "readCanvasImage\|ASSET_CANVAS_IMAGE\|registerAssetLibraryIpcHandlers" -- src tests
git grep -n "new Audio\|HTMLAudioElement\|AudioContext\|createObjectURL\|revokeObjectURL" -- src tests
git grep -n "ActionPreset\|mouthMotionEvaluator\|AudioScheduler\|AssetAudioSourceService" -- src tests new\ agent\ task docs
```

## 8.4 Focused tests

```bash
pnpm exec vitest run tests/unit/dialogue-service.test.ts tests/unit/dialogue-store.test.ts
pnpm exec vitest run tests/unit/dialogue-subtitle.test.ts
pnpm exec vitest run tests/unit/asset-library-ipc-handlers.test.ts tests/unit/ipc-contracts.test.ts
pnpm exec vitest run tests/unit/product-preview-overlay.test.ts tests/unit/preview-playback-engine.test.ts
```

新增 capability tests 存在后：

```bash
pnpm exec vitest run tests/unit/dialogue-audio-binding.test.ts
pnpm exec vitest run tests/unit/asset-preview-audio-service.test.ts
pnpm exec vitest run tests/unit/product-preview-audio.test.ts
pnpm exec vitest run tests/unit/product-preview-mouth.test.ts
pnpm exec vitest run tests/integration/dialogue-audio-preview.test.ts
```

> 不存在的文件不能为了“命令看起来完整”硬执行再写 PASS。实际实现若把能力并入现有稳定 test owner，receipt 必须给出真实对应命令与测试名。

## 8.5 Full automated gates

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

## 8.6 Schema / no-scope-creep

```bash
git diff origin/main...HEAD -- src/domain/models src/domain/constants.ts
git grep -n "PROJECT_SCHEMA_VERSION" -- src/domain tests
git diff origin/main...HEAD --name-only | grep -Ei "actionpreset|preset|rhubarb|viseme|tts|waveform" || true
git grep -n "ActionPreset\|Rhubarb\|Viseme\|TTS" -- src || true
```

## 8.7 History / dirty / Project mutation

```bash
git grep -n "executeReplaceProject\|historyStore\|dirty\|revision" -- src/renderer/stores tests/unit/dialogue-*.test.ts
git grep -n "audioClipId" -- src/domain/services src/renderer/stores src/renderer/features/dialogue tests
```

## 8.8 IPC security

```bash
git grep -n "ASSET_.*AUDIO\|preview.*audio" -- src/shared src/preload src/main tests
git grep -n "assertTrustedSender" -- src/main/ipc
git grep -n "realpath\|isInsideDirectory\|sha256\|createHash" -- src/main/services/Asset*Service.ts
git grep -n "readFile\|file://\|sourcePath" -- src/renderer src/preload
```

## 8.9 CI V2 receipt

```bash
# 本地只验证 source/contract；真实路线以 GitHub Actions run 为证据
cat docs/ci-routing.md
node scripts/ci-routing.cjs --help 2>/dev/null || true
pnpm exec vitest run tests/contract/ci-routing.test.ts tests/contract/verification-manifest.test.ts 2>/dev/null || true
```

实际 GitHub receipt 必须记录：

```text
Draft route + run id + Full skipped
Ready final HEAD + Full run id
Ready Full proof
Final CI result
post-merge provenance run id
post-merge Full skipped/fallback reason
```

---

# 【完成定义 DoD】

## Product

- [ ] Dialogue 可通过现有 Inspector 绑定当前项目真实 AudioAsset。
- [ ] binding 正式走 `Dialogue.audioClipId -> AudioClip -> AudioAsset`，无平行 schema。
- [ ] 已绑定 Dialogue timing 调整会原子同步 clip。
- [ ] Product Preview Play/Pause/Stop/Seek 能真实听到对应 Dialogue audio。
- [ ] audio / subtitle / active Dialogue identity 一致。
- [ ] active audio Dialogue 有 mouthOpenAssetId 时显示张嘴图；缺图安全降级。
- [ ] replay / seek / clip transition 无叠音。
- [ ] switch shot/project/unmount 无旧资源/声音/嘴/字幕残留。
- [ ] playback 不写 Project/History/dirty。

## Security / Architecture

- [ ] renderer 不读取任意本地文件路径。
- [ ] audio bytes 经 strict shared contract + preload + trusted Main IPC。
- [ ] path traversal/symlink/hash/MIME/size guard 有自动化负面证明。
- [ ] 不新增 Project persisted 字段，不 bump schemaVersion。
- [ ] 不复活 ActionPreset/PR #177/旧 discarded audio-mouth architecture。
- [ ] 不创建第二 Preview/第二 clock/第二 Project store。

## Quality

- [ ] B29-01～06 handoff 全部完整。
- [ ] 16 项刀刃表有真实证据。
- [ ] P4 checklist 完整。
- [ ] focused/unit/integration/build/typecheck/lint/diff truth 真实记录。
- [ ] Draft CI 走 FAST/Targeted/Focused，不反复 Full。
- [ ] Ready 最终候选 Full GREEN + `Ready Full proof` + `Final CI result`。
- [ ] 正常 merge 后 provenance fast-pass，不重复相同代码 Full。

## Human

- [ ] 真实 Windows Electron：1 shot / 3 Dialogue / 3 real audio 完整播放 PASS。
- [ ] Pause→Seek→Resume PASS。
- [ ] Stop PASS。
- [ ] Replay 5x 无叠音/资源持续增长 PASS。
- [ ] missing mouth fallback PASS。
- [ ] move/resize + Undo/Redo + save/reopen PASS。
- [ ] switch shot/project/close preview cleanup PASS。

## 收卷

- [ ] `docs/test-receipts/DAY-29.md` 完整。
- [ ] `automated/structural`、`maintainer Windows Electron`、`overall` 三层状态分开记录。
- [ ] 所有债务分类申报。
- [ ] `overall=PASS` 前不得启动 Day30 产品开发。

---

# 【一句人话版验收】

> **把三段真实声音绑到三句对白上，点现成的 Preview：声音按句子时间播、字幕跟着、该角色说话时有张嘴图就换张嘴图；暂停/拖时间/重播/切项目都不串台、不叠音、不留鬼影，保存重开还记得绑定——做到这一步，Day29 才算毕业。** ☝️🤓
