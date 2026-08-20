# FLA V1 post-merge handoff

> Canonical transfer document for the next WorkBuddy agent researching FLA V1.5
> and V2. This document records the merged V1 boundary; it does not authorize
> new production behavior.

Verified on 2026-08-20 against live `main`:

- `main` is at merge commit
  `c7038c2763834772d1b49aebd0df34b9c8b3ee48`.
- The merge commit is PR #252's merge commit. PR #252 is live GitHub state
  `closed` and `merged`; its final PR parent is
  `f33f34703acb1203af4867908267da0b7c16d621`.
- The post-merge CI run is
  [32336942245](https://github.com/Cognitive-Architect/panda-stage/actions/runs/32336942245).
  `Classify change risk`, `Post-merge provenance`, and `Final CI result` all
  succeeded. The other route-specific jobs were skipped by the merge route.
- This repository uses the established singular directory `docs/handoff/`.
  The issue's suggested `docs/handoffs/` directory does not exist in the
  checkout, so this file is the canonical handoff at the existing convention.

This is a documentation-only handoff. It does not change the parser, import
UX, project schema, IPC, security policy, CI architecture, or V1 behavior. It
also does not claim that the historical receipts below are a new human
acceptance record. Live GitHub state and the current merged checkout remain the
source of truth.

## 1. Executive snapshot

### What is merged

The FLA V1 delivery from PR #252 is present on `main`. Its product boundary is
a deliberately narrow, raster-oriented import path for modern ZIP/XFL-style
Adobe Animate FLA packages:

1. The user explicitly chooses an `.fla` source from the FLA-specific entry in
   the Asset Library.
2. Main performs bounded, read-only archive and XML preflight, including source
   identity and safety checks.
3. A hidden, sandboxed parser window runs the pinned parser closure through the
   Panda-owned adapter boundary.
4. The adapter returns a Panda-owned `AnimationImportIR`, including bounded
   raster payloads and compatibility information.
5. The renderer shows a read-only compatibility review. The user explicitly
   confirms the selected raster items.
6. A second explicit action commits only selected raster identifiers. Main
   writes ordinary PNG-backed `ImageAsset` records through the existing project
   persistence path.
7. Save, close, and reopen use the ordinary Panda project flow.

V1 can therefore prove a useful raster extraction/import path without making an
FLA file a new kind of Panda project asset. It can expose placement/timeline
information for compatibility review, but it does not turn those structures
into editable Panda timeline semantics.

### What V1 supports

- Modern ZIP/XFL containers that pass the strict Main-owned preflight boundary.
- Bounded bitmap extraction to Panda-owned PNG bytes.
- Read-only compatibility states and thumbnails before mutation.
- Explicit selection and explicit import of selected raster media.
- Ordinary `ImageAsset` persistence, duplicate-byte reuse, deterministic name
  collision handling, revision guards, journaled staging, rollback, and normal
  Save/Close/Reopen behavior.
- A proven real sample at 1920x1080 and 30fps with 158 bitmap library items,
  156 placed instances, and 2 library-only items.

### What V1 does not support

- General support for every `.fla`, every Animate feature, or every historical
  FLA container.
- Legacy binary/OLE2 FLA import, native vector/shape import, or semantic
  Symbol/MovieClip/tween/timeline import.
- ActionScript execution, text import, or claims of mask/filter/blend fidelity.
- Automatic conversion of FLA structure into Panda Shots, Layers, or Timeline
  events.
- Tolerance of malformed archive metadata merely because a particular sample
  can be made parseable by changing a copy.

### What is future work

V1.5 is a research-only track for better evidence, diagnostics, corpus
coverage, and security-reviewed archive rules. V2 is a separate architectural
choice between safe render-oriented rasterization and a substantially larger
semantic-import product. Neither track is implemented or authorized by this
handoff.

## 2. Delivery lineage and why the boundary is narrow

The line began with the Day29 asset/material interoperability gap. It is a
future-asset investigation, not a declaration that Day29 or all FLA support is
complete. The live lineage is:

| Item | Role in the lineage | Live state / handoff meaning |
| --- | --- | --- |
| [#243](https://github.com/Cognitive-Architect/panda-stage/issues/243) | Future support for Adobe Animate `.fla` character materials. | Open future-asset issue; it defines the problem, not broad V1 support. |
| [#244](https://github.com/Cognitive-Architect/panda-stage/issues/244) | Read-only audit of a real FLA and ground-truth bitmap extraction. | Open audit issue; its sample facts are the V1 known-good baseline. |
| [#245](https://github.com/Cognitive-Architect/panda-stage/issues/245) | Direction to reuse an OSS parser behind a Panda-owned boundary. | Open architecture backlog; it does not transfer parser ownership to the UI. |
| [#246](https://github.com/Cognitive-Architect/panda-stage/issues/246) | Benchmark of `lifeart/fla-viewer` against the real sample. | Open audit issue; it established the pinned parser candidate and its limits. |
| [#247](https://github.com/Cognitive-Architect/panda-stage/issues/247) | Prototype of the Panda-owned `AnimationImportIR` adapter. | Open prototype issue; parser objects must not escape the boundary. |
| [#248](https://github.com/Cognitive-Architect/panda-stage/issues/248) | Secure raster-only V1 design. | Open design issue; it established ordinary `ImageAsset` persistence and the security matrix. |
| [#249](https://github.com/Cognitive-Architect/panda-stage/issues/249) | Initial dependency/license clearance audit. | Open audit issue; it found that upstream licensing evidence is incomplete. |
| [#250](https://github.com/Cognitive-Architect/panda-stage/issues/250) | Final bounded clearance for the isolated parser-only closure. | Open audit issue; the maintainer allowed the bounded path with notices and `LICENSE_INTENT_ONLY`. |
| [#251](https://github.com/Cognitive-Architect/panda-stage/issues/251) / [PR #252](https://github.com/Cognitive-Architect/panda-stage/pull/252) | Implemented and hardened FLA V1 slices. | The issue lineage is represented by merged PR #252; the PR is closed/merged at the baseline above. |
| [#253](https://github.com/Cognitive-Architect/panda-stage/issues/253) | Read-only review, thumbnails, selection, and cancel cleanup. | Closed as completed; its receipt is historical evidence for the merged path. |
| [#264](https://github.com/Cognitive-Architect/panda-stage/issues/264) | Repeated chooser/review lifecycle audit. | Closed as completed; the recorded real Windows lifecycle evidence remains bounded to that receipt. |
| [#265](https://github.com/Cognitive-Architect/panda-stage/issues/265) | Normal-user UX cleanup for the review. | Open in live GitHub state; its merged changes are part of PR #252, while its issue state is not a new acceptance claim. |
| [#266](https://github.com/Cognitive-Architect/panda-stage/issues/266) | Removed a stale Day16 verifier assertion that no longer matched the UI. | Open in live GitHub state; its final parent is in PR #252 and only changed the verifier. |
| [#267](https://github.com/Cognitive-Architect/panda-stage/issues/267) | Read-only audit of six real FLA samples. | Open audit issue; its malformed-EOCD and zero-raster findings constrain V1.5 research. |
| #269 | This post-merge transfer document. | Open docs-only handoff; it authorizes no production change. |

The lineage intentionally separates discovery from implementation:

- #244 supplied one real ground-truth sample.
- #245 and #246 established that an OSS parser could be used only as a pinned,
  isolated implementation dependency, not as an application-wide viewer.
- #247 made the translation boundary explicit.
- #248 made raster-only extraction, ordinary assets, and Main-owned security
  controls explicit.
- #249/#250 recorded the dependency and notice limitation. The current notice
  still says `LICENSE_INTENT_ONLY`; do not rewrite that as definitive upstream
  legal clearance.
- #251 through PR #252 delivered the bounded slices, including review UX,
  explicit commit, recovery, and final stress evidence.
- #264, #265, and #266 addressed lifecycle/UX/verifier evidence around the
  same boundary; they did not expand the product model.
- #267 tested whether the boundary generalized across a small real corpus. It
  found useful evidence, not a license to accept malformed copies or claim
  universal FLA compatibility.

## 3. Exact V1 product path and ownership

The following is the current path, in order. “Owner” means the component that
is allowed to make the decision or perform the mutation; it is not merely the
component that renders a status.

1. **Explicit entry.** `AssetImportPanel.tsx` exposes the dedicated `导入 FLA`
   action. `AssetLibrary.tsx` owns the renderer-side review lifecycle. Ordinary
   PNG/JPG/MP3/WAV selection and drag/drop remain separate. The renderer does
   not read the FLA path or bytes.
2. **Native source selection.** Main's `selectFlaSource` opens the native file
   dialog (or the explicitly documented acceptance source override in an
   unpackaged run) and passes the chosen source to `FlaImportService`. Main owns
   the source path and bytes.
3. **Bounded preflight.** `fla-import-preflight-service.ts` reads the source,
   checks size and container shape, rejects unsafe or unsupported archive
   forms, validates entries/XML budgets, detects scripts, and computes the
   source identity. This stage is read-only and must finish before the parser
   worker starts.
4. **Parser isolation.** `FlaImportService` starts the one-active-operation
   `FlaParserWindowManager`. The manager uses a hidden BrowserWindow with
   `contextIsolation`, `sandbox`, `nodeIntegration: false`, a restricted
   origin, denied navigation, denied window opening, a fresh partition, and
   wall-time/no-progress/cancel-grace watchdogs. The parser receives the
   bounded bytes and Panda-owned metadata, not arbitrary file-system access.
5. **Panda-owned IR.** The sole adapter boundary converts parser output into
   `AnimationImportIR`. Parser implementation objects, DOM objects, JSZip
   values, blobs, HTML image objects, canvas objects, and object URLs do not
   escape into the production contract.
6. **Compatibility review.** `FlaCompatibilityReviewSession` owns the
   read-only preview state, stable media selection, compatibility counts,
   warnings, thumbnails, and cancel/close cleanup. A review confirmation emits
   a `FlaRasterSelectionIntent`; it does not mutate the Project or Asset
   Library.
7. **Explicit real import.** A separate user action calls
   `commitSelected`. The request contains session/source identity and selected
   media identifiers only. It contains no FLA bytes, source path, destination
   path, or renderer-created asset record.
8. **Main-owned commit.** `FlaAssetCommitService` rechecks the session, source
   hash, selected IDs, bounded PNG payloads, current project identity, and
   revision. It deduplicates equal bytes, chooses deterministic safe names,
   stages files, writes the commit journal, finalizes without overwrite, and
   performs one revision-guarded project save. Rollback and recovery are part
   of this boundary.
9. **Ordinary project result.** The renderer applies the successful response
   through `EditorProjectStore.applyAssetImport`. The result contains ordinary
   Panda `ImageAsset` records under `assets/`; there is no FLA-specific Asset
   kind and no FLA source entry in `project.json`.
10. **Persistence and reopen.** `ProjectService`, the project file-system
    service, recovery services, `ProjectSessionController`, and `EditorShell`
    own the existing Save/Close/Reopen lifecycle. FLA commit recovery is
    reconciled when Main opens a project. The source `.fla` remains an external
    source/session input and is not persisted as an ordinary Project Asset.

## 4. Security and scope invariants

These are V1 invariants, not suggestions for a future implementation.

### Archive, XML, and parser budgets

The limits are centralized in `src/shared/fla-import-api.ts` and enforced at
the Main/worker boundary. The current values are:

| Budget | Current limit |
| --- | ---: |
| Source bytes | 256 MiB |
| ZIP entries | 20,000 |
| Expanded archive bytes | 1 GiB |
| Single entry bytes | 64 MiB |
| XML bytes | 32 MiB |
| Media count | 2,048 |
| Single image width/height | 4,096 pixels |
| Single image pixels | 16,777,216 |
| Total decoded pixels | 128,000,000 |
| Total decoded RGBA bytes | 512 MiB |
| Parser wall time | 30,000 ms |
| No-progress watchdog | 5,000 ms |
| Cancel grace | 2,000 ms |
| Maximum recursion depth | 64 |

The strict preflight rejects legacy OLE2/binary containers, non-ZIP input,
multi-disk and ZIP64 forms, encrypted entries, unsupported compression,
ambiguous/unsafe paths, invalid local/central-header relationships, external
XML references, and malformed archive boundaries. In particular, the central
directory must be inside the source boundary and before the EOCD; relaxing this
check is a separate security-reviewed research decision.

### Process and dependency invariants

- The parser runs in a dedicated hidden window with `contextIsolation: true`,
  `sandbox: true`, `nodeIntegration: false`, no `webviewTag`, a restricted
  origin, denied navigation, denied `window.open`, and a unique partition.
- The worker/parser path has no arbitrary file-system or network capability.
  Main performs the intentional source read and supplies bounded bytes; the
  parser cannot turn an FLA field into an arbitrary host read or request.
- Parser wall time, progress, cancellation, crash, and payload schemas are
  checked. A parser crash or timeout is an import error, not partial Project
  mutation.
- ActionScript is detected and reported as unsupported/diagnostic information;
  it is never executed.
- Compatibility status is derived from bounded structure and payload facts,
  not from filename, site, sample name, or a hidden allowlist.
- The parser is pinned to
  `lifeart/fla-viewer` commit
  `048000ccab67469980b8dedd1fc2b65a02d2b164`, with a reviewed 12-file local
  closure and direct `jszip@3.10.1`/`pako@1.0.11` dependencies. The notice
  remains explicit that upstream license evidence is `LICENSE_INTENT_ONLY`.
- The application imports no viewer/player/exporter/muxer UI. The local
  closure exists to parse the bounded input behind the adapter only.
- Selection/review is read-only. Only the explicit commit action may create
  ordinary assets. A relaxed compatibility label or future parser tolerance
  must never weaken archive boundary, byte budget, source identity, revision,
  staging, or rollback checks.

## 5. Current code map

The paths below were checked against the merged checkout. Each row states both
the ownership boundary and the corresponding non-ownership rule.

| Path | Owns | Must not own |
| --- | --- | --- |
| `src/renderer/features/assets/AssetImportPanel.tsx` | The explicit FLA entry alongside ordinary asset entry points. | FLA file reads, Project writes, or parser objects. |
| `src/renderer/features/assets/AssetLibrary.tsx` | Renderer lifecycle wiring, review open/close, project/view cancellation, and response application. | A second Project/session store or direct Node/file-system access. |
| `src/renderer/fla-import/fla-inspection-lifecycle.ts` | One-flight explicit inspection and cancellation/subscription lifecycle. | Creating a second native picker on React subscription/StrictMode effects. |
| `src/renderer/fla-import/FlaCompatibilityReviewSession.tsx` | Read-only review, thumbnails, selection, compatibility status, and explicit intent/commit actions. | Direct Project/Asset mutation or source-byte/path transport. |
| `src/renderer/fla-import/FlaParserWorker.ts` | The renderer-side parser-worker message boundary and schema-shaped progress/result handling. | Node, arbitrary file-system/network access, or leaked upstream objects. |
| `src/renderer/fla-import/fla-viewer-adapter.ts` | The only parser-to-Panda translation into `AnimationImportIR`. | Letting parser DOM/JSZip/image/canvas objects enter shared production contracts. |
| `src/renderer/fla-import/parser-core/` | The pinned local parser closure used behind the adapter. | Becoming a general viewer, exporter, or unbounded legacy-import service. |
| `src/shared/fla-import-api.ts` | Shared V1 limits, error codes, IR, compatibility, and selection-intent schemas. | Electron/Node/parser implementation imports. |
| `src/shared/fla-asset-commit-api.ts` | Identifier-only commit request/response contracts and schema validation. | Carrying bytes or source/destination paths across Renderer IPC. |
| `src/main/services/fla-import-preflight-service.ts` | Trusted source read, ZIP/XML/archive checks, budgets, script detection, and source identity. | Project mutation or compatibility-policy shortcuts based on filenames. |
| `src/main/services/FlaImportService.ts` | One active inspection, preflight-to-worker orchestration, bounded sessions, cancellation, and release. | Persisting FLA source data as a Project Asset. |
| `src/main/windows/fla-parser-window-manager.ts` | Hidden parser-window isolation, origin policy, watchdogs, crash/cancel lifecycle, and worker transport. | Exposing a general renderer or allowing navigation/window opening. |
| `src/main/ipc/register-fla-import-ipc-handlers.ts` | Trusted-sender checks and schema-validated choose/cancel/commit IPC registration. | Trusting renderer-supplied paths, bytes, or arbitrary IPC senders. |
| `src/main/index.ts` | Main wiring, source chooser, service construction, project-open recovery hook, and FLA IPC registration. | Moving project authority into the renderer. |
| `src/main/services/FlaAssetCommitService.ts` | Session/source/revision checks, duplicate/collision/hash decisions, staging, finalization, single save, and rollback. | Partial writes without a journal or a bypass of ProjectService guards. |
| `src/main/services/FlaAssetCommitJournalService.ts` | Crash-window journal recovery and durable artifact verification. | Silently accepting mismatched project/asset/path/hash state. |
| `src/main/services/AssetImportFileSystemService.ts`, `HashService.ts`, `PngThumbnailValidator.ts` | Main-owned file staging, byte hashing, and bounded PNG validation used by asset commit. | Renderer file access or FLA-specific persistence semantics. |
| `src/renderer/features/assets/applyFlaAssetCommitResponse.ts` | Applying a successful ordinary asset response to the single editor store; non-success responses remain non-mutating. | Creating a second store or changing Project state during read-only review. |
| `src/renderer/stores/EditorProjectStore.ts` | The single renderer owner of the formal Project snapshot, dirty state, revision, and history integration. | Serializing review/session selections or parser state as Project data. |
| `src/main/services/ProjectService.ts` and `ProjectFileSystemService.ts` | Formal project open/migrate/validate/save, atomic writes, and identity/revision guards. | FLA-specific schema or an alternate persistence path. |
| `src/main/services/RecoveryService.ts`, `src/renderer/features/recovery/ProjectSessionController.ts`, `src/renderer/shell/EditorShell.tsx` | Project recovery, open/switch/close lifecycle, and Save/Close/Reopen coordination. | A second project/session owner or silent recovery of mismatched artifacts. |
| `src/preload/fla-parser.ts` and `src/preload/index.ts` | Narrow, typed, schema-validated bridge methods. | Node exposure, broad `ipcRenderer`, or unvalidated payload forwarding. |
| `scripts/verify-issue251-slice1.cjs`, `verify-issue253-slice2.cjs`, `verify-issue257-slice3.cjs`, `verify-issue260-slice4.cjs` | Focused Windows Electron verifiers for the four V1 slices. | Treating headless/static results as human acceptance or widening V1 scope. |
| `tests/unit/` FLA contracts/review/commit tests and `tests/integration/` asset/recovery tests | Contract, boundary, persistence, and failure-injection regression evidence. | Replacing real Windows acceptance where a receipt requires interaction. |
| `resources/licenses/FLA-PARSER-NOTICE.txt` | Pinned closure, dependency, notice, and update-policy record. | Claiming a stronger upstream legal clearance than the recorded evidence. |
| `docs/handoff/issue-251-slice1-receipt.md` through `issue-260-slice4-candidate-receipt.md` | Historical slice evidence that is linked to its original candidate and scope. | Acting as current authorization or silently overriding live GitHub state. |

## 6. Proven V1 evidence and its limits

The following evidence is sufficient to describe the delivered V1 path, with
the qualifications shown. It is not permission to generalize beyond the
tested boundary.

| Evidence | What it proves | Limit |
| --- | --- | --- |
| #244 real sample: `D:\表情合集\文件.fla` | ZIP/XFL sample, 1920x1080, 30fps, 158 bitmap library items, 156 placed instances, 2 library-only; all 158 were recoverable in the read-only spike. | One known-good sample is not all-FLA coverage. |
| #246 benchmark | Pinned parser commit and modern ZIP/XFL path matched the sample identity and 158 media items; upstream legacy OLE2 path was identified but is not V1 production support. | Benchmark facts do not remove Panda's preflight, sandbox, or adapter responsibilities. |
| #247 adapter/IR prototype | Parser output can be translated into Panda-owned IR; 158 identities matched, with bounded PNG payloads and transparent/JPEG evidence. | No parser implementation object is a supported Panda contract. |
| #251/#253/#254/#255/#256 receipts | Slice 1 inspection, read-only review, thumbnails, stable selection, portal/inert background, one review scroll, and Chinese-first normal UX. | These receipts belong to historical candidates; use the merged source for current code. |
| #257 Slice 3 receipt | Three representative selected rasters were explicitly committed to ordinary assets; source remained unchanged; Save/Close/Reopen recovered ordinary assets. | Representative import is not all-158 human proof. |
| #258 recovery receipt | Finalized/project-saved journal crash window preserves only matching durable output and fails safely on mismatches. | Failure-injection automation is not a claim that every Windows crash mode was human-tested. |
| Existing asset/canvas regression | The Slice 3 focused evidence covers ordinary PNG/JPG Asset import and the existing canvas/use path after FLA import; the final human checklist also names transparent-alpha use, Canvas use, and ordinary PNG/JPG regression. | The candidate receipt kept that compact final human smoke pending. This handoff records the regression evidence and checklist scope, not a new human PASS. |
| #260 candidate receipt | Built-Electron all-158 stress recorded `STRESS_PASS`: 158 selected/imported, 0 duplicate, 0 collision renames, 158 Project assets, and 158/158 ready after Save/Close/Reopen; parser-only dependency audit recorded zero findings in all four severity buckets. | Candidate evidence is automated and is cited with its original receipt; it is not re-labeled as a new human acceptance. |
| #264 lifecycle receipt | Real Windows chooser/review cancel, reopen, project switch, and repeated lifecycle cases were recorded PASS in that acceptance run. | It covers chooser/review lifecycle, not every V1.5/V2 behavior. |
| #266 receipt | The stale Day16 verifier's old SHA assertion was replaced by current visible UI tokens; the final PR parent is included in the merged commit. | This was verifier maintenance, not a product feature or FLA compatibility expansion. |
| Merge and CI | `main` contains PR #252 at `c7038c2`; post-merge CI run `32336942245` succeeded, including provenance and final-result jobs. | A green merge CI result does not invent a missing manual test observation. |

The original sample SHA from #244 was recorded as
`84682EDCD49B8FCC072AE740188677BAE9D7D0FD603B8BED51A7AC4DDEB3119F` and was
reported unchanged in the read-only audit. Real-source paths and corpus audit
artifacts were kept outside the repository under
`D:\PandaStage-Acceptance\`; the source files were not rewritten by the V1
implementation or by #267.

The current repository also carries focused verifiers in
`scripts/verification-manifest.json`. Run them only when a task explicitly
requires reproducing their evidence; do not interpret a verifier result as a
replacement for required visible Windows Electron acceptance.

## 7. Issue #267 six-corpus conclusions

Issue #267 was a read-only corpus audit. It separated **container/boundary
facts** from **content/extraction facts**; future agents must preserve that
separation.

### Exact six-sample result

| Sample | Original strict V1 path | Copy-only diagnostic path | Content result |
| --- | --- | --- | --- |
| `文件.fla` | PASS | Not needed | 158 bitmap media; 156 placed; 2 library-only. |
| `剑.fla` | PASS | Not needed | Parser path completed with 0 bitmap media; source frame rate defaulted to 24 when absent. |
| `沙雕表情大全（免费分享，短剧慎用）.fla` | FAIL before parser: `MALFORMED_ARCHIVE: ZIP central directory exceeds the source boundary`. | A copy passed after EOCD metadata normalization. | 128 media in the diagnostic copy: 97 PNG, 2 JPG, 29 unknown; all 128 library-only. |
| `蓝衣修仙男（补面需求）.fla` | Same strict preflight failure. | Copy-only EOCD-normalized diagnostic pass. | 0 bitmap media in the diagnostic copy. |
| `性感修仙女.fla` | Same strict preflight failure. | Copy-only EOCD-normalized diagnostic pass. | 0 bitmap media in the diagnostic copy. |
| `炼丹房.fla` | Same strict preflight failure. | Copy-only EOCD-normalized diagnostic pass. | 0 bitmap media in the diagnostic copy. |

### Container/boundary conclusion

- All six samples were ZIP/XFL-style packages with a root `DOMDocument.xml`
  associated with Adobe Animate. The audit found methods 0/8 and no legacy OLE2,
  ZIP64, encrypted, or unsupported-compression case in those six files.
- The four original failures shared the same EOCD issue: the declared ZIP
  central-directory size was exactly 54 bytes larger than the actual central
  directory records.
- The four sources were not modified. The audit changed only EOCD metadata in
  copies under the external `fla-real-corpus-audit-issue267\repaired-copies`
  location to perform a differential experiment.
- The original strict counts were: 4 malformed-archive boundary failures and
  2 parser successes as-is. The parser did not start for the four original
  failures.
- This is a malformed-but-parseable diagnostic family, not production V1
  support. Any future tolerance must be a generic, deterministic,
  security-reviewed archive rule with regression coverage; it must not be a
  filename/site/sample exception.

### Content/extraction conclusion

- A successful parse does not imply useful raster extraction. `剑.fla` passed
  the original strict path but produced 0 bitmap media.
- The normalized diagnostic copies of `蓝衣修仙男`, `性感修仙女`, and `炼丹房`
  also produced 0 bitmap media. Those results are diagnostic only because the
  source files were rejected by the production boundary.
- The large normalized expression sample produced 128 raster media despite
  its broader Animate structure. That supports the adapter's bounded raster
  direction but does not support automatic Symbol, MovieClip, or timeline
  semantics.
- The audit found no evidence that the parser was overfit to the first sample.
  The correct conclusion is narrower: the general raster boundary behaved as
  designed for the tested valid/diagnostic inputs, while useful raster content
  varies and malformed archives remain outside V1.

### What #267 does not conclude

It does not conclude that all FLA files are supported, that malformed EOCD
metadata should be accepted, that zero-raster files are importable materials,
or that vector/timeline content is ready for Panda semantics. It also does not
authorize production changes to make any of those claims true.

## 8. V1 non-goals and current limits

The following are explicitly outside merged V1:

- Legacy binary/OLE2 FLA containers, even though the upstream/local parser
  closure contains historical binary parsing code.
- Native vector/shape import or a vector renderer.
- Semantic import of Symbol, MovieClip, Graphic, or other Animate library
  structures.
- Tween import, playback, frame selection, or automatic timeline conversion.
- Text import, font substitution, or text-editable Panda content.
- Claims of mask, filter, blend-mode, effect, camera, or fidelity preservation.
- ActionScript execution or any script-driven behavior.
- Automatic creation of Panda Shots, Layers, keyframes, Timeline events, or
  animation controls from FLA structure.
- A new FLA-specific Project/Asset schema, persistent FLA source attachment,
  or source-path dependence in a saved project.
- Automatic repair of malformed ZIP metadata, filename-specific exceptions,
  or acceptance based on a web site/source label.
- General-purpose Animate viewer/player/exporter behavior.
- Calling static tests, headless verifiers, thumbnails, or a merge result a
  substitute for a required real Windows Electron human acceptance.

These limits are product constraints, not a list of bugs to fix inside this
handoff.

## 9. V1.5 research-only track

The next agent may prepare evidence and proposals in these bounded areas. Each
area requires a separate scoped issue before production implementation.

| Research area | Bounded question | Evidence required before implementation |
| --- | --- | --- |
| Generic malformed-EOCD handling | Can a deterministic, archive-generic rule safely recognize the 54-byte central-directory declaration discrepancy or related families without accepting truncation, ambiguity, path traversal, ZIP64/encryption surprises, or hidden payloads? | Corpus of original bytes and hashes; formal ZIP boundary cases; differential parser results; resource/time tests; security review; explicit no filename/site/sample branching. |
| Larger corpus | How often do valid modern ZIP/XFL files contain raster, vector-only, symbols, timelines, text, masks, unsupported compression, encryption, or legacy containers? | Licensed/permissioned corpus inventory, stable hashes, category labels, reproducible source provenance, and separate container/content outcomes. |
| No-raster diagnostics | How should the UI distinguish parse success, zero bitmap media, unresolved references, unsupported content, decode failure, and an empty-but-valid document? | Real corpus examples, user-facing copy proposal, compatibility contract, and proof that diagnostics remain read-only and do not widen import support implicitly. |
| Structural probing | Can the adapter report bounded counts for Layer, Symbol, MovieClip, Graphic, Timeline, Frame, keyframe, and animated candidates without importing their semantics? | Field-level mapping, limits, malformed-input behavior, no parser-object leakage, and tests for absent/unknown/unsupported distinctions. |
| Regression corpus and one-command verification | What minimal corpus and command can reproduce the boundary across Windows Electron and CI without mutating sources? | Repository-owned fixtures or approved external fixture protocol, expected hashes/results, budget tests, CI cost/routing decision, and a maintainer-approved verifier scope. |

For every proposal, first state whether the evidence is about the **container**
or the **content**. A parse-success count is not a bitmap-success count, and a
bitmap-success count is not semantic-import support. V1.5 research may produce a
document, corpus manifest, or focused audit; it does not silently implement a
new parser rule or import feature.

## 10. V2 alternatives

V2 should remain an explicit architecture choice. The two plausible directions
have materially different risk and product meaning.

### Render-oriented alternative

Safely interpret enough vector, Symbol, MovieClip, and timeline structure to
render selected frames in an isolated renderer. Rasterize those frames into
PNG or a frame sequence, then reuse the existing ordinary `ImageAsset` and
explicit-commit architecture. This preserves the current Project model but
needs a new threat model, deterministic renderer, frame/resource budgets,
font/effect policy, and fidelity evidence.

### Semantic-import alternative

Map FLA symbols, timelines, tweens, layers, keyframes, and related structure
into Panda-editable semantics. This is a substantially larger product and
domain project: mapping rules, unsupported-state UX, persistence schema,
history/revision behavior, editing semantics, and Save/Close/Reopen guarantees
would all need design and proof. It is not a small extension of raster V1.

Do not choose between these alternatives from the six-file corpus alone. The
next decision requires the V1.5 evidence above, a product decision, and a
separate authorized implementation issue.

## 11. First-read checklist for the next WorkBuddy agent

Follow this order before making any proposal or edit:

1. Sync or inspect the exact current `main` and verify the merge baseline
   `c7038c2763834772d1b49aebd0df34b9c8b3ee48`. Preserve unrelated dirty work;
   do not repair a checkout with reset, clean, or stash.
2. Read this handoff completely, including the YAML digest below.
3. Inspect the current FLA shared contracts, Main preflight/worker/commit
   services, renderer review lifecycle, license notice, and
   `scripts/verification-manifest.json`.
4. Read the live and historical evidence for [#267](https://github.com/Cognitive-Architect/panda-stage/issues/267),
   keeping original-source outcomes separate from copy-only differential
   outcomes.
5. Reproduce a focused verifier only if the question depends on current
   executable evidence. Record whether it is automated, Electron-observable,
   or human acceptance evidence.
6. Produce a V1.5/V2 research proposal with corpus provenance, exact hashes,
   threat model, budgets, expected diagnostics, and a stop condition.
7. Stop at the research/handoff boundary. Do not edit production parser,
   adapter, preflight, import UI, Project schema, IPC, or CI until a maintainer
   creates or explicitly scopes the next implementation issue.

## 12. Machine-readable digest

```yaml
handoff:
  document: docs/handoff/FLA-V1-POST-MERGE-HANDOFF.md
  verified_at: "2026-08-20"
  repository: Cognitive-Architect/panda-stage
  main:
    branch: main
    merge_commit: c7038c2763834772d1b49aebd0df34b9c8b3ee48
    merged_pr: 252
    final_pr_parent: f33f34703acb1203af4867908267da0b7c16d621
    post_merge_ci_run: 32336942245
    post_merge_ci_conclusion: success
  fla_v1:
    status: merged_and_bounded
    supported_container: "modern ZIP/XFL package passing strict Main preflight"
    extraction_model: "bounded bitmap media translated to Panda-owned PNG bytes"
    review_model: "read-only compatibility review followed by explicit selection"
    commit_model: "identifier-only IPC request to ordinary ImageAsset persistence"
    source_persistence: "FLA source remains external; no FLA-specific Project Asset"
  security_invariants:
    parser: "pinned lifeart/fla-viewer closure behind Panda-owned adapter"
    worker: "hidden sandboxed isolated window; no Node; no arbitrary FS/network"
    action_script: never_execute
    archive_policy: "strict boundary, path, compression, encryption, ZIP64, XML, and budget checks"
    mutation_policy: "review is read-only; Main owns staged journaled commit and rollback"
    compatibility_policy: "labels cannot weaken archive checks or persistence guards"
    known_license_state: LICENSE_INTENT_ONLY
  known_good_sample:
    path: "D:\\表情合集\\文件.fla"
    sha256: 84682EDCD49B8FCC072AE740188677BAE9D7D0FD603B8BED51A7AC4DDEB3119F
    stage: "1920x1080 @ 30fps"
    bitmap_media: 158
    placed_instances: 156
    library_only_media: 2
  issue_267:
    corpus_size: 6
    original_malformed_eocd_samples: 4
    malformed_eocd_declared_minus_actual_central_directory_bytes: 54
    original_parser_successes_as_is: 2
    original_zero_bitmap_sample: "剑.fla"
    diagnostic_zero_bitmap_normalized_copies: 3
    copy_only_normalization_is_production_support: false
    conclusion: "parse success is not useful raster extraction; no evidence of first-sample overfit"
  v1_non_goals:
    - legacy OLE2/binary FLA
    - vector/shape import
    - Symbol/MovieClip/tween/timeline semantic import
    - text, mask, filter, blend, or fidelity guarantees
    - ActionScript execution
    - automatic Shot/Layer/Timeline conversion
    - malformed-archive repair or filename/site exceptions
  next_authorized_state:
    type: research_and_handoff_only
    production_change_authorized: false
    required_before_implementation: "separate maintainer-scoped issue with corpus, security, and product evidence"
```
