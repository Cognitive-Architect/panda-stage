# F1-02 Minimum Contract

Status: the Issue #906 Main-owned preview contract is implemented in the
current branch. Automated Windows Electron acceptance against isolated Sample
A completed on 2026-10-31 with source result `NATIVE_SOURCE_GO`; the overall
Issue #906 acceptance remains `PARTIAL` pending the residual checks below and
owner review.

## Main-owned PartPlan

F1-02 consumes a read-only FlaImport inspection session and an explicit
Scene/frame target. Main creates and retains the version 1 PartPlan. Renderer
requests contain the inspection session, deterministic Scene target, frame,
request ID, and generation; successful renderer responses contain only the
opaque plan ID, pose identity, bounded preview PNGs, and render metrics. Source
bytes, paths, addresses, matrices, and plan units stay in Main.

The plan records raw and normalized source SHA-256 hashes, stage dimensions,
selected Scene/frame, and one distinct occurrence record per independently
rendered source occurrence. Each unit records its source address and parent
frame path, source definition and selected child-frame basis, visibility, draw
order, mask/composite dependencies, local/world transforms, determinant,
traceability, and full-stage coordinate contract. Occurrence IDs derive from
source identity and occurrence path rather than symbol names, so repeated
instances of one library symbol remain separate units.

F1-02 currently accepts Scene targets and full-stage PNGs only. A source
transform is applied once when Main resolves the display list; emitted part
images use stage identity during reassembly. Cropping and Project/Character
import are outside this contract. A missing source path or unsupported
dependency produces a whole-image fallback or a typed error. Non-finite or
non-invertible transforms and stale occurrence identities fail closed.

## Limits and lifecycle

- At most 24 independently rendered parts and an occurrence depth of 64.
- At most 32 MiB of PNG inputs to reassembly and 64 MiB of combined PNG
  outputs, using the existing snapshot PNG bound.
- A 120-second batch wall-time limit and a five-minute Main-held plan lifetime.
- Existing snapshot bounds remain in force: 4,096 pixels per dimension,
  16,777,216 pixels, and 64 MiB per PNG. These limits are not increased for
  F1-02.
- Plans and active work are bound to inspection session, request ID, and
  generation. A newer generation, cancellation, plan expiry, inspection
  release, or project context change invalidates the applicable plan/work.
- Plan inspection and rendering are read-only. They do not construct or mutate
  a Project, increment its revision, add History entries, register project
  assets, or call a commit API.

## F1-02 evidence

The focused Windows Electron verifier uses the previously authorized isolated
Sample A and its Animate frame export by default. It compares the native whole
Scene PNG, independent part PNGs, stage-identity reassembly, and Animate
reference at matching dimensions. Its receipt records the source hashes,
Main-held sanitized plan, per-occurrence address/matrix/visibility/order and
mask facts, cancellation/generation-bound request identity, prepare/resolve/
raster counts and elapsed time, pixel-difference measurements, and evidence
file hashes. Private source art, screenshots, and receipts stay outside the
repository.

Sample A produced five independently traceable parts at 1920x1080. The Main
request prepared one source, resolved six display lists, ran seven sandbox
rasters, and returned 1,071,963 PNG bytes in 2,246 ms. Native versus
reassembled had 3,696 differing pixels out of 2,073,600 (mean channel delta
0.000682, maximum 4). Native versus the Animate reference had 43,759 differing
pixels (mean channel delta 0.2562, maximum 187); the three images have matching
dimensions and were visually compared in the Electron harness. For this proof,
`NATIVE_SOURCE_GO` requires native/reassembled changed pixels at or below 0.5%
and maximum channel delta at or below 8; Sample A passed both checks. The
receipt and private image files are in the external acceptance directory
printed by the verifier. This measured source result does not stand in for
owner visual acceptance.

The final run sampled Electron memory every 100 ms for 32 samples: Main-process
RSS peaked at 269,598,720 bytes; Electron-reported aggregate peak working set
was 1,051,168 KB and aggregate private bytes were 514,808 KB. The aggregate
working set sums per-process values and can count shared pages more than once;
the per-process high-water marks remain in the private receipt. The harness did
not open a Panda project: project revision/history/asset before-and-after
snapshots are `NOT_RUN`. The PartPreview service is not given a Project,
History, Character, or project-asset mutation service, and the source FLA hash
was unchanged.

### Issue #906 acceptance coverage

| AC | Result | Evidence / remaining scope |
|---|---|---|
| AC01 | **PASS** | Original Sample A went through Main inspection, prepared source, held PartPlan, and matching raw/normalized hashes. |
| AC02 | **PASS** | Five Sample A source occurrences; a repeated-symbol synthetic FLA verifies two occurrences retain separate identities. |
| AC03 | **PARTIAL** | Full-stage un-cropped mapping, painter order, and positive translation are covered. Negative translation, mirror, skew, singular transforms, and crop recomputation remain `NOT_RUN`. |
| AC04 | **PASS** | Windows Electron displayed native, five independent parts, actual-PNG reassembly, and the Animate reference; dimensions and pixel comparisons were recorded. |
| AC05 | **PASS** | Unit coverage exercises cancellation during rasterization, newer-generation rejection, timeout cancellation, and plan expiry. |
| AC06 | **PARTIAL** | Missing source identity safely falls back to `WHOLE_IMAGE_ONLY`; cancellation and timeout return typed errors. Unknown visual content, empty masks, raster failure, and PNG-budget failure fixtures remain `NOT_RUN`. |
| AC07 | **PARTIAL** | Source bytes were unchanged and no project mutation service is available to PartPreview. No Panda project was opened, so revision/history/asset snapshots remain `NOT_RUN`. |
| AC08 | **PASS** | One source preparation, six display-list resolutions, seven rasters, batch time, cancellation behavior, Main RSS, and Electron process memory were recorded. |
| AC09 | **PASS** | Main sender checks and strict IPC schema tests pass; source bytes and filesystem paths are absent from renderer responses. |
| AC10 | **PASS** | Typecheck, lint, unit, integration, build, and the targeted Windows Electron verifier pass. |
| AC11 | **PASS** | Main-held plan identity, session/request/generation binding, five-minute expiry, and lifecycle invalidation are implemented and tested. |

The residual `PARTIAL` items do not change Sample A's `NATIVE_SOURCE_GO` result
and do not authorize F1-03 commits, formal import UI, or broader real-material
testing.

This contract adds no Project schema, persistence, History, export, or product
UI surface; those require separate authorization and design.
