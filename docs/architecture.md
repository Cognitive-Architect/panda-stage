# Panda Stage 架构说明

## 进程边界

```text
Main Process
  ├─ ExportService：Job 状态、唯一 AbortController、24 FPS 调度、背压与统一清理
  ├─ FileSystemService：独立临时目录和异步 PNG 写盘
  ├─ HiddenWindowManager：隐藏窗口生命周期与请求/响应关联
  └─ FFmpegAdapter：版本/编码器检查、H.264 编码、AAC 合成与 ffprobe
          │ 经过白名单 Preload + Zod 校验的 IPC
          ▼
Hidden Export Renderer（sandbox）
  └─ CanvasStage → StageRenderer → Konva Canvas → PNG Uint8Array
```

主窗口和隐藏导出窗口都复用 `CanvasStage`、`StageRenderer`、领域 evaluator、探针项目及字幕 evaluator。Renderer 不访问 `fs`、`path` 或子进程；只有 Main Process 的 `FileSystemService` 写盘。

## ProjectSchema v1 正式领域模型

Day 11 起，`src/domain` 是 MVP 项目文件的正式数据契约；`src/shared/domain` 保留为 M0.5 渲染探针模型。两者不会通过宽泛联合类型混在一起，历史探针只能经 `migrateProject()` 显式进入正式模型。

正式 `ProjectSchema v1` 使用严格 Zod object 和 discriminated union，覆盖：

```text
Project
├─ Asset = ImageAsset | AudioAsset
├─ Character
│  ├─ CharacterExpression
│  └─ default VoiceProfile reference
├─ VoiceProfile
├─ SubtitleStyle
└─ Shot
   ├─ Layer = asset source | character/expression source
   ├─ Dialogue
   ├─ AudioClip
   └─ TimelineEvent
      ├─ move
      ├─ scale
      ├─ opacity
      ├─ shake
      ├─ expression
      ├─ flip
      └─ visibility
```

项目固定为 1920×1080、24 FPS。所有 `startMs`、`endMs`、`durationMs`、`offsetMs` 均为非负整数毫秒；镜头 duration 必须为正整数。Layer 的 `anchor` 固定为 `center`，`x/y` 始终表示图层在逻辑画布上的视觉中心，而不是左上角。

实体 schema 只校验自身字段；`ProjectSchema.superRefine()` 调用集中式 `validateProjectReferences()` 校验素材、角色、表情、VoiceProfile、字幕样式、音频、图层和事件引用，并把错误定位到具体数组索引与字段路径。AudioAsset 可在安全导入后暂缺 `durationMs`，但 AudioClip 只能引用已有时长元数据的素材，并且必须满足 `offsetMs + (endMs - startMs) <= AudioAsset.durationMs`，禁止读取超过源音频结尾。所有对象使用 strict 模式，未知字段和未知 TimelineEvent 类型直接拒绝，不会在 parse 时静默删除。

### 版本检测与迁移

- `detectSchemaVersion(input)` 只接受显式 `0` 或 `1`；缺失版本和未来版本抛出 `UnsupportedSchemaVersionError`。
- `migrateProject(input)` 是纯函数，只依赖 Zod 和领域常量，不读取 UI、Electron、文件系统、网络或环境变量。
- v0→v1 保留项目、素材、镜头、图层、移动事件、时间戳和 UUID；旧 `durationMs` 事件明确转换为 `endMs = startMs + durationMs`，并添加确定性的默认字幕样式。
- M0.5 探针曾提前使用 `schemaVersion: 1`。迁移入口先严格尝试正式 v1，再严格识别旧探针 v1 形状并执行同一兼容迁移；两种 schema 都失败时拒绝输入，未知字段和事件不会被丢弃。
- 已是正式 v1 的项目只做完整 `ProjectSchema.parse()`，不会重复迁移。

示例项目位于 `demo-project/project-v1.example.json`，由单元测试真实 parse，并执行 parse→serialize→parse 语义一致性验证。

## 确定性帧协议

- 固定 24 FPS，帧数为 `ceil(durationMs * 24 / 1000)`；
- 每帧时间为 `floor(frameIndex / 24 * 1000)`，使用整数毫秒；
- 文件名固定为 `frame_000000.png` 形式，宽度为 6 位；
- 每个 Job 使用 UUID，并写入独立的临时目录；
- Main 逐帧发出请求；Renderer 在共享舞台完成真实绘制后的下一次 animation frame 才编码 Canvas；
- Renderer 回传 PNG `Uint8Array`，不生成全量 DataURL，也不直接落盘。

IPC 响应同时校验发送窗口、Job ID、帧序号与时间，迟到或错配响应不会被另一个 Job 接收。帧请求使用 15 秒 watchdog；watchdog 是故障边界，不作为渲染完成依据。

## 背压与清理

`MAX_PENDING_FRAMES = 3` 限制尚未完成的异步写盘任务。渲染保持逐帧请求，写盘可与后续渲染重叠；队列达到上限时，调度器先等待任一写任务完成，不会把整个序列的 PNG Buffer 堆入内存。

帧探针成功后目录保留给调用方消费，并可通过 `cleanupJob()` 显式释放；完整探针在编码和合成结束后自动删除帧目录。渲染失败、写盘失败或取消时，服务停止接收新帧、等待已发出的写任务收敛，再删除整个 Job 目录并返回包含 Job ID 与下一步操作的错误。Windows 目录删除使用 3 次有限重试、间隔 75ms；重复清理不存在的目录是安全的。服务同时拒绝第二个并发导出 Job。

## Day 09 统一取消状态机

每个完整导出 Job 只创建一个 `AbortController`，状态从 `running` 进入 `cancelling`，最终只能落到 `cancelled`、`failed` 或 `completed`。同一 signal 传入视频编码、音频探测、音频合成和最终 ffprobe；`NodeProcessRunner` 只对绑定该 signal 的子进程句柄调用 `child.kill('SIGTERM')`，不使用 `taskkill`、进程名扫描或系统级终止。

正式输出采用第二层 Job staging：Schema 在创建 Job 前拒绝非 `.mp4` 路径，文件系统在准备隐藏窗口和帧目录前检查正式目标与 overwrite 规则。AAC mux 写入正式输出同目录、带 Job ID 和 UUID 的 `.mp4` staging，ffprobe 也只读取该 staging。probe 成功后先清理帧目录、再次检查取消，再同步进入 `committing` point-of-no-return；此后 `cancelJob()` 返回 `false`，由同目录 rename 提交正式输出。mux、probe、取消或提交失败只清理本轮 staging，不预删或提前替换已有正式文件。

隐藏 Renderer 收到 `export:cancel-render` 后清空当前帧和待加载状态；已开始的 `canvas.toBlob()` 即使迟到完成，也不会回传已取消 Job。Main 的写队列不再接收新帧，并在 `finally` 清理前等待最多 3 个在途写入完成。完整 Job 无论成功、失败或取消都会释放隐藏窗口；取消后 Main UI 从 Job update 收到 `cancelled/finished`，重新启用开始按钮。

完整探针依次执行 `preparing → rendering/writing → encoding → muxing/probe → cleaning → committing → finished`。项目目录先在 Main Process 以 Node 路径 API 验证可读，音频和输出路径始终作为独立参数传递。真实 Windows 验证覆盖中文、空格和 emoji 路径，并证明真实 mux 取消后旧正式文件哈希不变、staging 为 0，详见 Day 09 回执。

## 视频编码边界

`FFmpegAdapter` 只在 Main Process 使用 `spawn(executable, args)` 启动外部进程，固定 `shell:false`。它在编码前验证输入、输出目录、FFmpeg 版本及所需编码器，编码后通过 ffprobe 验证真实媒体流。Renderer 和 Preload 不暴露任何子进程能力。

Day 07 输出固定为静音 H.264/yuv420p MP4；Day 08 在同一 Adapter 内先用 ffprobe 验证单条 WAV 的声道数，再将整数 `startMs` 重复为逐声道 `adelay` 列表，视频流保持 H.264，音频编码为 AAC。当前不实现多轨 `amix`、sidecar 打包或正式导出 UI。外部工具路径来自显式配置或开发期环境变量，仓库不包含二进制。

## 当前性能观察

真实 72 帧探针中，1920×1080 Canvas PNG 捕获约 143 秒，FFmpeg H.264 编码约 2.0 秒。当前主要瓶颈仍是帧捕获而非视频编码，后续优化必须保持共享 Renderer 和确定性时间轴不变。
## Day 12 project directory lifecycle

Formal projects are directories whose names end in `.pandastage`. A new project
contains `project.json` plus the `assets/`, `cache/`, `exports/`, and `recovery/`
directories. Creation rejects an existing target directory; it never merges
with or overwrites an existing directory.

Only Electron Main may read or write project files:

```text
Renderer
  -> frozen Preload project.create/open/save allowlist
  -> strict Zod request/response contracts
  -> trusted-window IPC handlers
  -> ProjectService (create/open/migrate/validate/save workflow)
  -> ProjectFileSystemService (the single atomic-write implementation)
  -> .pandastage/project.json
```

Opening is read-only. `ProjectService` reads `project.json`, parses JSON,
detects the schema version, migrates legacy v0 data in memory, and validates
the resulting formal v1 model before returning it. Invalid JSON, invalid
models, and unsupported future versions do not modify the source file.

Saving first opens and validates the existing on-disk project through the same
version detection and migration path. It rejects missing, corrupt, invalid, or
future-version targets, then compares the on-disk project ID with the incoming
project ID. Only an identity match may continue. The service then validates the
complete incoming formal model before any write. The filesystem service
creates a unique temporary file in the project directory, writes the
complete serialized JSON, flushes it with `FileHandle.sync()`, closes the
handle, and then replaces `project.json` with a same-directory `rename`.
Every failure path closes the handle and removes the temporary file. Because
the old target is not touched before the final rename, failures before the
commit point preserve its bytes and SHA-256 hash. The Windows integration test
also verifies that Node's same-directory rename replaces an existing file on
the supported platform.

Persisted asset paths are project-relative and are enforced by
`ProjectSchema`; drive-rooted, slash-rooted, and `..` traversal paths are
rejected.
## Day 13 autosave and crash recovery

Autosave is a recovery mechanism, not a replacement for formal save.
`AutosaveService` runs in Electron Main and owns one 30-second interval per
tracked project root. Renderer sends a runtime-validated snapshot containing
the formal project, the central editor `dirty` state, and an integer revision.
Clean snapshots never write. A dirty revision is written once; later timer
ticks skip it until a newer revision arrives.

```text
EditorProjectStore (single dirty/revision source)
  -> frozen Preload autosave.track/update/stop
  -> trusted-window IPC + on-disk project-ID validation
  -> AutosaveService (one timer and one in-flight write per project root)
  -> RecoveryService (schema, detection, restore/ignore, retention)
  -> RecoveryFileSystemService
  -> recovery/<project-id>.<saved-at-ms>.recovery.json
```

Recovery files use a strict envelope containing `schemaVersion`, `projectId`,
integer `savedAtMs`, and a complete `ProjectSchema` project. Writes use a
same-directory temporary file followed by sync, close, and rename. A successful
write retains only the newest recovery for that project. A failed write keeps
the previous recovery and removes the failed temporary file.

Detection runs immediately after an explicit project open, including an
identity-checked recent-project open; automatic startup reopening remains out
of scope. Candidates must have a matching project ID, pass the recovery and
project schemas, and have a timestamp newer than `project.json` mtime. Corrupt,
mismatched, and old files are not offered.

Restore validates the selected path inside the project's `recovery/` directory
and returns the project to Renderer memory. `EditorProjectStore.restore()` marks
it dirty; neither restore nor ignore writes or deletes `project.json`. Ignore
retains the evidence file. Only an explicit formal `project.save` replaces
`project.json`; after that commit, same-project recovery files are cleaned.

Formal save and recovery writes share a per-project-root operation coordinator.
The coordinator waits for an in-flight recovery write before replacing
`project.json`, then keeps recovery cleanup and autosave session reconciliation
inside the same critical section. It does not serialize unrelated project
roots. A failed formal write never runs cleanup or marks the live session clean.
Renderer save acknowledgement is revision-aware as well. The save workflow
captures the request revision before awaiting Main. A matching response may
refresh the saved project and mark the store clean; a response older than the
current editor revision leaves the newer in-memory project dirty, while a
response from a future revision is rejected as an invalid state.

Project switching is a Renderer-owned transaction:

1. Open and validate the requested project without changing the editor store.
2. Start its temporary autosave session and detect recovery.
3. Stop the old session.
4. Commit the prepared project, tracked root, and candidate together.

Failures before commit remove the temporary session and preserve or re-track
the old session. Reopening the current dirty path is rejected explicitly, so it
cannot duplicate a timer or discard unsaved state. The controller performs this
same-project check both before open for simple string aliases and after open
using Main's resolved `projectRoot`. Therefore `.` and `..` aliases cannot
reach temporary tracking or rollback logic for the already-open project.

Switching projects, Renderer unmount, and application quit release timers.
Periodic write errors are sent through the read-only `autosave:error` event.
Renderer never receives filesystem or Node.js access.

## Day 14 recent projects, close guard, and relocation

Recent projects are application configuration, not project data.
`RecentProjectsService` writes a strict, versioned `recent-projects.json`
under Electron's `app.getPath('userData')`. The write is atomic and retains up
to 12 de-duplicated entries. Listing reads and parses each `project.json`,
runs migration and `ProjectSchema` validation, and compares the actual project
ID with the stored ID. Entries are reported as `available`, `missing`,
`mismatched`, or `invalid`; non-available entries remain persisted until the
user explicitly removes or relocates them.

`PathService` is the Main-process normalization boundary for Day 14 project
paths. On Windows it resolves slash direction, trailing separators, `.`/`..`,
drive-letter case, and UNC comparison keys. Relocation opens and validates the
user-selected directory before replacing a non-available record, and requires
the project ID to match. Opening an available recent entry uses a dedicated
Main IPC request containing `projectRoot` and `expectedProjectId`; Main repeats
the identity check after opening to close the list-to-click TOCTOU window. A
mismatch does not update the editor store, autosave session, or recent record.
Ordinary `record()` also refuses to replace a different project ID at the same
normalized path. None of these operations rewrites the project document, so
asset paths remain project-relative.

```text
app userData/recent-projects.json
  -> RecentProjectsService (strict config, atomic write, de-duplication)
  -> recent-projects IPC (list, identity-checked open, remove, relocation)
  -> RecentProjectsPanel
  -> ProjectSessionController (open/track/detect transaction)
```

Dirty close protection reads the latest cloned snapshot from
`AutosaveService`. `UnsavedCloseController` owns the save/discard/cancel
decision and joins repeated requests. `UnsavedCloseGuard` prevents both window
close and application quit until the controller returns `allow-close`.
Discard is a project operation rather than an immediate close: it stops new
autosave scheduling, waits for an in-flight write, then removes and verifies
same-project recovery inside the shared project-root coordinator. Cleanup
failure returns `discard-failed`, reports an actionable error, rearms autosave,
and keeps the window open. Successful discard leaves the formal
`project.json` unchanged and permits no late recovery write.
Successful save uses the existing project-root coordinator; cancel and save
failure keep the window open. Shutdown cleanup runs at `will-quit`, after the
guard has approved exit, so it cannot erase the dirty snapshot before the
decision.

## Day 16 secure asset import

Local media import is a Main-process transaction. Renderer can request the
native picker or pass dropped `File` objects to the frozen Preload bridge;
Preload converts those objects to controlled source candidates with Electron
`webUtils`. Renderer never receives Node.js or filesystem access.

```text
AssetImportPanel
  -> frozen Preload assets.choose/importDropped
  -> strict Zod request/response contracts
  -> trusted-window IPC
  -> AssetImportService
     ├─ MediaInspectionService (extension + declared MIME + binary structure)
     ├─ HashService (streaming SHA-256)
     ├─ AssetImportFileSystemService (sync + exclusive atomic placement)
     └─ ProjectService transaction (validated atomic project save)
  -> <project>.pandastage/assets/
```

PNG and JPEG validation checks their binary signatures and image dimensions.
WAV validation parses RIFF/WAVE chunks; MP3 validation accepts a valid ID3
prefix followed by an MPEG audio frame or a direct valid MPEG frame. Declared
MIME, extension, and detected media type must agree. This is deliberately
implemented without a new sniffing dependency or license obligation.

SHA-256 is fixed as the content identity algorithm and is computed with
streams. Existing project assets are hashed from their project-relative paths;
matching content returns `duplicate` and creates neither a file nor a model
entry. A same-name, different-content file keeps its original name when free,
otherwise receives `-<first 8 SHA-256 hex>` before its extension, with a
numeric suffix only for the remaining collision case. Unicode and spaces are
preserved while control characters and Windows-unsafe filename characters are
replaced.

Each copy is streamed to a unique temporary file in `assets/`, flushed, then
committed without overwrite through an exclusive same-volume hard link.
The formal target is registered as a rollback candidate immediately after the
copy call returns, before copied-media validation, hashing, Asset construction,
or Project construction. The complete model is saved once through the existing
project-root operation coordinator. Any pre-commit internal failure rolls back
every file already committed by that request; expected per-file validation or
copy failures may coexist with successfully imported files, but every success
must have both a file and Asset record. Rollback failure becomes
`ASSET_IMPORT_ROLLBACK_FAILED` and includes the exact residual paths instead of
claiming that the directory is clean. Persisted paths remain relative
`assets/...` paths.

Main owns the import revision check through the active `AutosaveService`
session. Before reading a candidate, `AssetImportService` requires the request
project ID, full project snapshot, and `baseRevision` to match Main's current
snapshot. It builds hashes, occupied names, and the next project from that
authoritative snapshot rather than Renderer request data. The check runs again
before project construction and immediately before save, so an editor change
during a long import rolls back copied files and returns
`ASSET_IMPORT_STALE_REVISION` with the current project and revision. A stale
response is informational and never mutates `EditorProjectStore`.

Asset display names and disk file names have separate stable limits. Display
names are NFC-normalized and safely truncated to the `NameSchema` limit of 200
UTF-16 code units. Disk stems preserve Unicode and spaces, replace unsafe
characters, avoid Windows device names, and are safely limited to 120 code
units before extension and conflict suffixes.

Imported audio assets intentionally omit `durationMs`: Day 16 validates media
type but does not introduce Day 17 metadata extraction. Such an asset may be
stored but cannot be referenced by an `AudioClip` until duration metadata is
available; the centralized reference validator enforces that boundary.
