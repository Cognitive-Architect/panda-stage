# Panda Stage Phase 4 Legacy / Compat Closure Map v1.0

Status: audit complete, deletion work not started
Issue: #559
Audit date: 2026-09-18
Audited stack: `agent/issue-559-p4-00` at `afc9b135d89f85d9f9fa12e70968ff51a5bf20fa`, based on the current `#556` head
Receipt: [`docs/evidence/P4-00/receipt.json`](../evidence/P4-00/receipt.json)

## Decision boundary

This document is the canonical inventory requested by P4-00. Every CSS file
under the two in-scope directories appears exactly once in the matrix below.
The classification is an evidence-based closure recommendation, not permission
to delete a file. P4-00 made no production-code, CSS, DOM, store, service, IPC,
or persistence change; it deleted and relocated no file.

The three categories mean:

- **DEAD**: current evidence satisfies the Issue #559 dead-file gate. These are
  SER-01 candidates for a later, separately authorized change; they remain in
  the repository now.
- **LIVE**: the file is still required by a current production import or is a
  deliberately retained compatibility/remainder surface with a current owner.
- **UNKNOWN**: current tests, verifiers, manifests, historical receipts, or
  ownership evidence still reference the path, or the semantic owner cannot be
  closed without a broader refactor. UNKNOWN files are no-touch.

## Baseline and scope

- `#556` (`P3-01`) is still the stack predecessor at
  `afc9b135d89f85d9f9fa12e70968ff51a5bf20fa`; this P4 branch must not merge
  ahead of it.
- The current `origin/main` observation was
  `1e8ff3d467cda153f80c79a447d66e833ed444a7`. Its root `DESIGN.md` was read
  from that snapshot (blob `a74fb5443fb4cf13d8fb2ee5a81c3127be846c90`). The
  file is outside the stacked #556 tree and is not copied or changed by this
  audit.
- The scope contains 38 files in
  `src/renderer/styles/legacy-slices/` and 15 files in
  `src/renderer/styles/compat/`.
- `src/renderer/styles.css` contains 152 `@import` statements. The in-scope
  import list is recorded below; all other imports are outside P4-00.
- `scripts/css-split-manifest.json` still records the Phase 2 baseline at
  `35fe7963a50e7bd9be68f1e39d12833c99bb4436`, source blob
  `94c141fcff1df3fd0c309456c9b72f4df8773df0`, and three explicit remainder
  parts. That pinned historical baseline is evidence, not a request to rewrite
  the manifest or old receipts.
- Repository-wide path and basename scans excluded `.git/` and
  `node_modules/`. A missing direct reference is not by itself enough for
  DEAD; the matrix also checks executable inputs, current owners, and immutable
  historical evidence.

### Current production import list

The following three legacy files are imported by `src/renderer/styles.css`:

1. `src/renderer/styles/legacy-slices/05-asset-library-stage-sequence--between-shots-create.css`
2. `src/renderer/styles/legacy-slices/05-asset-library-stage-sequence--after-shot-create.css`
3. `src/renderer/styles/legacy-slices/07-portrait-assets-inspector-start-after-assets.css`

All 15 compat files are imported by the same production entry:

1. `src/renderer/styles/compat/debug-preview/s01-14--gate-probe-and-transport.css`
2. `src/renderer/styles/compat/debug-preview/s05-11--preview-panel.css`
3. `src/renderer/styles/compat/debug-preview/s05-13--stage-preview-base.css`
4. `src/renderer/styles/compat/debug-preview/s06-05--transport-hidden-stage.css`
5. `src/renderer/styles/compat/mixed-conditions/s06-06--responsive-1100.css`
6. `src/renderer/styles/compat/mixed-conditions/s12-08--shallow-container-220.css`
7. `src/renderer/styles/compat/mixed-conditions/s13-05--render-dialogue-audio-media900.css`
8. `src/renderer/styles/compat/retained-task-surfaces/s07-08--portrait-dialogue-original.css`
9. `src/renderer/styles/compat/retained-task-surfaces/s08-05--portrait-dialogue-flat.css`
10. `src/renderer/styles/compat/retained-task-surfaces/s08-09--portrait-authoring.css`
11. `src/renderer/styles/compat/retained-task-surfaces/s08-15--portrait-pending-base-and-final.css`
12. `src/renderer/styles/compat/retained-task-surfaces/s09-04--portrait-pending-polish.css`
13. `src/renderer/styles/compat/retained-task-surfaces/s11-10--landscape-tray-host-original.css`
14. `src/renderer/styles/compat/retained-task-surfaces/s12-05--landscape-task-body.css`
15. `src/renderer/styles/compat/retained-task-surfaces/s13-01--landscape-timed-384-385.css`

The three imported legacy files are two-byte CRLF remainder markers with no CSS
declarations. They remain LIVE because the current entry, manifest, and
`issue553-ser06` contract deliberately retain them as `S05-R02`, `S05-R03`, and
`S07-R04` order/remainder markers.

## Evidence key

| Key | Evidence inspected |
| --- | --- |
| `E-P` | Exact production `@import` in `src/renderer/styles.css`. |
| `E-M` | `scripts/css-split-manifest.json` and its current CSS-split reader/verifier input. |
| `E-K549` | `tests/contract/issue549-ser02.test.ts`, `docs/evidence/issue-549-p2-25/{preflight,receipt}.json`, and the Phase 2 canonical map. |
| `E-K541` | `tests/contract/issue541-p2-01.test.ts` and its receipt/preflight evidence. |
| `E-K551` | `tests/contract/issue551-p2-17.test.ts`. |
| `E-K55218` | `tests/contract/issue552-p2-18.test.ts` and `docs/evidence/issue-552-p2-18/preflight.json`. |
| `E-K55219` | `tests/contract/issue552-p2-19-p2-21.test.ts` and `docs/evidence/issue-552-p2-19/preflight.json`. |
| `E-K55221` | `tests/contract/issue552-p2-19-p2-21.test.ts` and `docs/evidence/issue-552-p2-21/preflight.json`. |
| `E-K553` | `tests/contract/issue553-ser06.test.ts`, `docs/evidence/issue-553-p2-27/{preflight,receipt}.json`, and `docs/evidence/issue-553-p2-28/closure.json`. |
| `E-H` | Current Phase 1/Phase 2 ownership maps and immutable historical receipts named by the path scan. These references are not runtime proof by themselves. |
| `E-R` | `git log --follow` relocation history for the unreferenced fragments, including the P2-04, P2-10, SER-03, P2-B01, and P2-11 relocation commits. |
| `E-N` | Repository-wide exact path/basename scan found no current direct reference outside the file itself. |

## Canonical matrix

`prod` means imported by the current `src/renderer/styles.css` entry. The
runtime/owner column records the current semantic owner or why owner closure is
not safe. `SER-01 candidate` and `SER-02 decision` are future P4-SER inputs;
they are not actions taken by this audit.

For readability, paths in the legacy table are relative to
`src/renderer/styles/legacy-slices/`, and paths in the compat table are relative
to `src/renderer/styles/`; the directory prefixes are fixed by the section
headings and the scope above.

### Legacy slices (38)

| ID | Current path | prod | Current refs / evidence | Runtime or semantic owner | Class | Proposed P4-SER action | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L01 | `01-shell-import-review-after-canvas-host.css` | no | `E-K55221` | Historical shell review contract input; no current runtime import | UNKNOWN | leave untouched | Contract/evidence reference must be explicitly retired before any deletion. |
| L02 | `01-shell-import-review-after-project-center.css` | no | `E-K55218/E-K55219/E-K549` | Historical shell review contract input; no current runtime import | UNKNOWN | leave untouched | Multiple prior preflights reference the path. |
| L03 | `01-shell-import-review-after-resources.css` | no | `E-K55218/E-K55221` | Historical shell review contract input; no current runtime import | UNKNOWN | leave untouched | Historical verifier input remains unresolved. |
| L04 | `01-shell-import-review-after-timeline.css` | no | `E-K55219` | Historical shell review contract input; no current runtime import | UNKNOWN | leave untouched | Do not infer deadness from absent production import. |
| L05 | `01-shell-import-review-base.css` | no | `E-M/E-H` | Phase 1/Phase 2 split-map and verifier evidence; no closed current owner | UNKNOWN | leave untouched | Manifest and historical receipt references are current repository inputs. |
| L06 | `02-review-workbench-dialogue-after-queue.css` | no | `E-K551` | P2-17 contract input; no current runtime import | UNKNOWN | leave untouched | Requires an explicit contract/evidence closure decision. |
| L07 | `02-review-workbench-dialogue-after-raster.css` | no | `E-K551` | P2-17 contract input; no current runtime import | UNKNOWN | leave untouched | Requires an explicit contract/evidence closure decision. |
| L08 | `02-review-workbench-dialogue.css` | no | `E-M/E-H` | Historical dialogue workbench split input; no closed current owner | UNKNOWN | leave untouched | Manifest and maps retain the path. |
| L09 | `03-terminal-launcher-sequence.css` | no | `E-M/E-H` | Historical launcher sequence split input; no closed current owner | UNKNOWN | leave untouched | Manifest and maps retain the path. |
| L10 | `04-launcher-render-workbench.css` | no | `E-M/E-H` | Historical launcher/render workbench split input; no closed current owner | UNKNOWN | leave untouched | Manifest, receipt, and maps retain the path. |
| L11 | `05-asset-library-stage-sequence--after-shot-create.css` | yes | `E-P/E-M/E-K553/E-H` | Explicit `S05-R03` empty remainder/import-order marker retained by the current closure contract | LIVE | SER-02 decision; retain until explicitly closed | File is two-byte CRLF with no declarations, but deliberate retention is executable contract behavior. |
| L12 | `05-asset-library-stage-sequence--between-shots-create.css` | yes | `E-P/E-M/E-K553/E-H` | Explicit `S05-R02` empty remainder/import-order marker retained by the current closure contract | LIVE | SER-02 decision; retain until explicitly closed | File is two-byte CRLF with no declarations, but deliberate retention is executable contract behavior. |
| L13 | `05-asset-library-stage-sequence.css` | no | `E-M/E-H` | Historical asset-library split input; no closed current owner | UNKNOWN | leave untouched | Manifest and Phase 1/2 maps retain the path. |
| L14 | `06-canvas-portrait-foundation--between-properties.css` | no | `E-K55218` | P2-18 contract/preflight input; no current runtime import | UNKNOWN | leave untouched | Do not delete while the historical contract still names it. |
| L15 | `06-canvas-portrait-foundation-after-dialogue.css` | no | `E-K55218` | P2-18 contract/preflight input; no current runtime import | UNKNOWN | leave untouched | Do not delete while the historical contract still names it. |
| L16 | `06-canvas-portrait-foundation-after-inspector-handle.css` | no | `E-K55218` | P2-18 contract/preflight input; no current runtime import | UNKNOWN | leave untouched | Do not delete while the historical contract still names it. |
| L17 | `07-portrait-assets-inspector-start--after-assets.css` | no | `E-K551` | P2-17 contract input; no current runtime import | UNKNOWN | leave untouched | Double-hyphen variant is distinct from the retained one-file remainder. |
| L18 | `07-portrait-assets-inspector-start--before-layer-forms.css` | no | `E-K551` | P2-17 contract input; no current runtime import | UNKNOWN | leave untouched | Contract input remains unresolved. |
| L19 | `07-portrait-assets-inspector-start-after-assets.css` | yes | `E-P/E-M/E-K553/E-H` | Explicit `S07-R04` empty remainder/import-order marker retained by the current closure contract | LIVE | SER-02 decision; retain until explicitly closed | File is two-byte CRLF with no declarations, but deliberate retention is executable contract behavior. |
| L20 | `07-portrait-assets-inspector-start-after-characters.css` | no | `E-N/E-R` | No current owner, import, test, verifier, manifest, or direct repository reference; superseded relocation fragment | DEAD | SER-01 candidate; no deletion in P4-00 | Candidate only. Preserve until a separately authorized SER-01 change. |
| L21 | `07-portrait-assets-inspector-start.css` | no | `E-M/E-H` | Historical asset-inspector split input; no closed current owner | UNKNOWN | leave untouched | Manifest and maps retain the path. |
| L22 | `08-inspector-portrait-dialogue--before-appearance.css` | no | `E-K551` | P2-17 contract input; no current runtime import | UNKNOWN | leave untouched | Contract input remains unresolved. |
| L23 | `08-inspector-portrait-dialogue-after-dialogue-properties.css` | no | `E-N/E-R` | No current owner, import, test, verifier, manifest, or direct repository reference; superseded relocation fragment | DEAD | SER-01 candidate; no deletion in P4-00 | Candidate only. Preserve until a separately authorized SER-01 change. |
| L24 | `10-landscape-characters-tools-after-character-workbench.css` | no | `E-N/E-R` | No current owner, import, test, verifier, manifest, or direct repository reference; superseded relocation fragment | DEAD | SER-01 candidate; no deletion in P4-00 | Candidate only. Preserve until a separately authorized SER-01 change. |
| L25 | `10-landscape-characters-tools-after-expression-workbench.css` | no | `E-K55219/E-K55221` | P2-19/P2-21 contract/preflight input; no current runtime import | UNKNOWN | leave untouched | Contract/evidence reference remains unresolved. |
| L26 | `10-landscape-characters-tools-after-maintenance.css` | no | `E-K55219/E-K55221` | P2-19/P2-21 contract/preflight input; no current runtime import | UNKNOWN | leave untouched | Contract/evidence reference remains unresolved. |
| L27 | `10-landscape-characters-tools-after-resource-rail.css` | no | `E-K55219/E-K55221` | P2-19/P2-21 contract/preflight input; no current runtime import | UNKNOWN | leave untouched | Contract/evidence reference remains unresolved. |
| L28 | `10-landscape-characters-tools-start.css` | no | `E-M/E-H` | Historical character-tools split input; no closed current owner | UNKNOWN | leave untouched | Manifest, receipt, and maps retain the path. |
| L29 | `11-tools-inspector-timeline-start--before-landscape-layer-controls.css` | no | `E-K541/E-K55221` | P2-01/P2-21 contract/preflight input; no current runtime import | UNKNOWN | leave untouched | Current and historical contract references remain. |
| L30 | `13-timed-render-media-tail.css` | no | `E-M/E-H` | Historical timed-render media split input; no closed current owner | UNKNOWN | leave untouched | Manifest, receipt, and maps retain the path. |
| L31 | `14-dialogue-polish-image-picker-after-batch-footer.css` | no | `E-K55218/E-K55219` | P2-18/P2-19 contract/preflight input; no current runtime import | UNKNOWN | leave untouched | Contract/evidence reference remains unresolved. |
| L32 | `14-dialogue-polish-image-picker-tail.css` | no | `E-N/E-R` | No current owner, import, test, verifier, manifest, or direct repository reference; superseded relocation fragment | DEAD | SER-01 candidate; no deletion in P4-00 | Candidate only. Preserve until a separately authorized SER-01 change. |
| L33 | `15-character-identity-workspace-after-subtitle-style.css` | no | `E-N/E-R` | No current owner, import, test, verifier, manifest, or direct repository reference; superseded relocation fragment | DEAD | SER-01 candidate; no deletion in P4-00 | Candidate only. Preserve until a separately authorized SER-01 change. |
| L34 | `15-character-identity-workspace-s15-05.css` | no | `E-N/E-R` | No current owner, import, test, verifier, manifest, or direct repository reference; superseded relocation fragment | DEAD | SER-01 candidate; no deletion in P4-00 | Candidate only. Preserve until a separately authorized SER-01 change. |
| L35 | `15-character-identity-workspace-s15-16-to-22.css` | no | `E-N/E-R` | No current owner, import, test, verifier, manifest, or direct repository reference; superseded relocation fragment | DEAD | SER-01 candidate; no deletion in P4-00 | Candidate only. Preserve until a separately authorized SER-01 change. |
| L36 | `15-character-identity-workspace-start.css` | no | `E-M/E-H` | Historical character identity split input; no closed current owner | UNKNOWN | leave untouched | Manifest, maps, and P2-03 evidence retain the path. |
| L37 | `16-character-settings-after-rename.css` | no | `E-N/E-R` | No current owner, import, test, verifier, manifest, or direct repository reference; superseded relocation fragment | DEAD | SER-01 candidate; no deletion in P4-00 | Candidate only. Preserve until a separately authorized SER-01 change. |
| L38 | `16-character-settings-final-polish.css` | no | `E-M/E-H` | Historical character settings split input; no closed current owner | UNKNOWN | leave untouched | Manifest, maps, and receipts retain the path. |

### Compat files (15)

| ID | Current path | prod | Current refs / evidence | Runtime or semantic owner | Class | Proposed P4-SER action | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C01 | `compat/debug-preview/s01-14--gate-probe-and-transport.css` | yes | `E-P/E-M/E-K549/E-H` | Debug-preview gate/transport compatibility owner | LIVE | retain compat | Current production import and #549 condition contract. |
| C02 | `compat/debug-preview/s05-11--preview-panel.css` | yes | `E-P/E-M/E-K549/E-H` | Debug-preview preview-panel compatibility owner | LIVE | retain compat | Current production import and #549 condition contract. |
| C03 | `compat/debug-preview/s05-13--stage-preview-base.css` | yes | `E-P/E-M/E-K549/E-H` | Debug-preview stage-preview compatibility owner | LIVE | retain compat | Current production import and #549 condition contract. |
| C04 | `compat/debug-preview/s06-05--transport-hidden-stage.css` | yes | `E-P/E-M/E-K549/E-H` | Debug-preview hidden-stage transport compatibility owner | LIVE | retain compat | Current production import and #549 condition contract. |
| C05 | `compat/mixed-conditions/s06-06--responsive-1100.css` | yes | `E-P/E-M/E-K553/E-H` | Mixed-condition responsive compatibility owner | LIVE | retain compat | Current production import and #553 condition contract. |
| C06 | `compat/mixed-conditions/s12-08--shallow-container-220.css` | yes | `E-P/E-M/E-K553/E-H` | Mixed-condition shallow-container compatibility owner | LIVE | retain compat | Current production import and #553 condition contract. |
| C07 | `compat/mixed-conditions/s13-05--render-dialogue-audio-media900.css` | yes | `E-P/E-M/E-K553/E-H` | Mixed-condition dialogue/audio/media compatibility owner | LIVE | retain compat | Current production import and #553 condition contract. |
| C08 | `compat/retained-task-surfaces/s07-08--portrait-dialogue-original.css` | yes | `E-P/E-M/E-K553/E-H` | Retained portrait-dialogue task-surface owner | LIVE | retain compat | Current production import and #553 retained-surface contract. |
| C09 | `compat/retained-task-surfaces/s08-05--portrait-dialogue-flat.css` | yes | `E-P/E-M/E-K553/E-H` | Retained portrait-dialogue task-surface owner | LIVE | retain compat | Current production import and #553 retained-surface contract. |
| C10 | `compat/retained-task-surfaces/s08-09--portrait-authoring.css` | yes | `E-P/E-M/E-K553/E-H` | Retained portrait authoring task-surface owner | LIVE | retain compat | Current production import and #553 retained-surface contract. |
| C11 | `compat/retained-task-surfaces/s08-15--portrait-pending-base-and-final.css` | yes | `E-P/E-M/E-K553/E-H` | Retained portrait pending task-surface owner | LIVE | retain compat | Current production import and #553 retained-surface contract. |
| C12 | `compat/retained-task-surfaces/s09-04--portrait-pending-polish.css` | yes | `E-P/E-M/E-K553/E-H` | Retained portrait pending polish owner | LIVE | retain compat | Current production import and #553 retained-surface contract. |
| C13 | `compat/retained-task-surfaces/s11-10--landscape-tray-host-original.css` | yes | `E-P/E-M/E-K541/E-K553/E-H` | Retained landscape tray-host task-surface owner | LIVE | retain compat | Current production import; #541 and #553 evidence both name the owner. |
| C14 | `compat/retained-task-surfaces/s12-05--landscape-task-body.css` | yes | `E-P/E-M/E-K553/E-H` | Retained landscape task-body owner | LIVE | retain compat | Current production import and #553 retained-surface contract. |
| C15 | `compat/retained-task-surfaces/s13-01--landscape-timed-384-385.css` | yes | `E-P/E-M/E-K553/E-H` | Retained landscape timed-surface owner | LIVE | retain compat | Current production import and #553 retained-surface contract. |

## Reconciled totals

| Scope | Files | DEAD | LIVE | UNKNOWN |
| --- | ---: | ---: | ---: | ---: |
| Legacy slices | 38 | 8 | 3 | 27 |
| Compat | 15 | 0 | 15 | 0 |
| **Overall** | **53** | **8** | **18** | **27** |

The row count is `38 + 15 = 53`; each ID from L01-L38 and C01-C15 occurs
exactly once. The totals are classification totals, not deletion totals.

## Explicit P4-SER input map

### SER-01 proven-dead candidates (8; no deletion in P4-00)

These files satisfy the current audit gate as candidates only:

- `L20` `src/renderer/styles/legacy-slices/07-portrait-assets-inspector-start-after-characters.css`
- `L23` `src/renderer/styles/legacy-slices/08-inspector-portrait-dialogue-after-dialogue-properties.css`
- `L24` `src/renderer/styles/legacy-slices/10-landscape-characters-tools-after-character-workbench.css`
- `L32` `src/renderer/styles/legacy-slices/14-dialogue-polish-image-picker-tail.css`
- `L33` `src/renderer/styles/legacy-slices/15-character-identity-workspace-after-subtitle-style.css`
- `L34` `src/renderer/styles/legacy-slices/15-character-identity-workspace-s15-05.css`
- `L35` `src/renderer/styles/legacy-slices/15-character-identity-workspace-s15-16-to-22.css`
- `L37` `src/renderer/styles/legacy-slices/16-character-settings-after-rename.css`

Evidence is `E-N/E-R`: no current production import or repository direct
reference, no current runtime owner was found, and follow-history identifies
the files as superseded relocation fragments. A future SER-01 must still run
its own deletion diff, verifier-route check, and maintainer acceptance.

### SER-02 ownership-closure candidates

- `L11`, `L12`, and `L19`: explicit empty remainder/import-order markers. The
  decision is whether to retain them as named markers or retire them in a
  separately authorized contract-and-evidence change; P4-00 retains them.
- `C01`-`C15`: legitimate imported compatibility owners. They remain compat
  until a concrete owner-preserving migration is approved; P4-00 does not
  start that migration.

### Files that must remain compat

`C01`-`C15` are all currently imported, condition-scoped compat surfaces. No
compat file is classified DEAD.

### UNKNOWN no-touch set (27)

`L01`-`L10`, `L13`-`L18`, `L21`-`L22`, `L25`-`L31`, `L36`, and `L38` remain
UNKNOWN. They are referenced by current contract/preflight inputs, manifests,
or historical ownership evidence, and no broad cleanup is authorized by
P4-00. The 27 UNKNOWN files must not be deleted, moved, or rewritten in SER-01
or SER-02 without a new explicit closure decision.

## Stop and debt notes

- P4-00 does not delete or relocate CSS and does not modify
  `src/renderer/styles.css`, the manifest, tests, verifiers, or historical
  receipts.
- The three empty remainder files are not treated as dead merely because they
  contain no declarations. Their production imports and #553 contract make
  them current executable input.
- The CSS split `--preflight` passed against the pinned baseline. Full final
  equivalence was not used as P4-00 evidence because the current #556 stack
  intentionally changes pinned P2 targets (`S14-14`/`G145`); rewriting those
  historical targets is outside this audit.
- Automatic CI run `35341655196` classified the change successfully, but its
  Unknown route guard failed because `docs/evidence/P4-00/receipt.json` is not
  registered in `scripts/verification-manifest.json`. Registering that route
  would expand the Issue's allowed file scope, so the manifest remains
  unchanged and this is reported as a repository integration blocker.
- Root `DESIGN.md` is guidance read from the current main snapshot; it is not
  copied into this stacked branch and does not authorize a UI redesign or CSS
  migration.
- Any mass primitive migration, deduplication, behavior change, DOM/class
  change, or historical-receipt rewrite is deferred. No P4-SER operation was
  started.

## Validation evidence

- Inventory: 38 legacy + 15 compat files found; 152 root imports counted; the
  exact in-scope import list above was checked.
- Reference audit: exact path/basename scans were run across the repository,
  excluding `.git/` and `node_modules/`; the eight `E-N` candidates also had
  follow-history relocation evidence.
- Existing verifier: `node scripts/verify-css-split.cjs --preflight` passed
  with `issue: 530`, `mode: preflight`, `status: pass`, 16 candidate/actual
  boundaries, and no scan errors.
- Automatic CI: change classifier passed; Unknown route guard failed only on
  the unregistered P4-00 receipt path. The required manifest registration is
  outside this Issue's authorized file scope and was not made.
- Reconciliation: all 53 matrix IDs are unique and accounted for once; the
  category totals reconcile to the inventory.
- Documentation hygiene: `git diff --check` passed after the map and receipt
  were added.
