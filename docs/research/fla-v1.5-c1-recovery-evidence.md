# FLA V1.5-C1 recovery evidence

Execution date: 2026-08-23  
Issue: [#298](https://github.com/Cognitive-Architect/panda-stage/issues/298)  
Roadmap: [#297](https://github.com/Cognitive-Architect/panda-stage/issues/297)  
Live `main` at start: `3c47a4ee8af07e834338b223fcb3260a4c6dddbc`  
PR #285 observed: branch `agent/fla-v2-r`, exact HEAD `a111649df2615e8140e51eada17861fef0f6b403`

## Scope and safety boundary

This is research-only C1 work. The approved corpus root was `D:\表情合集`; only its top-level `.fla` files were inventoried. The original files remained read-only. EOCD compensation was applied only to an in-memory buffer or a disposable research copy. No Panda Project was opened or mutated, no production import routing changed, and PR #285 was not modified, merged, marked ready, or human-accepted.

C1 does not implement V1 recovery, V2-R import, C2/C3 production work, an R2 restart, or R3.

## Baseline

| Check | Result |
| --- | --- |
| Current `.fla` files | 12 |
| Unique SHA-256 samples | 12; duplicates 0 |
| Canonical six present | YES |
| Canonical strict PASS / REJECT | 2 / 4 |
| All-sample strict PASS / REJECT | 2 / 10 |
| `+54` EOCD mismatch | 10 / 10 rejects; canonical 4 / 4 rejects |
| Complete central-directory records after boundary inspection | 10 / 10 mismatch samples |
| Original hash invariance | PASS |
| Original files modified | NO |
| Production preflight changed | NO |
| Production recovery implemented | NO |

The complete machine-readable matrix, including SHA-256, byte length, central-directory measurements, raster counts, structural counts, target discovery, and per-sample safety flags is [fla-v1.5-c1-recovery-evidence.json](./fla-v1.5-c1-recovery-evidence.json).

## Product-value matrix

`structure` is `scene / timeline / layers / frames / tweens / symbols`. Raster counts are `bitmap / PNG / JPG / JPEG / unknown`. Target counts are from the exact PR #285 target builder at the observed HEAD; `沙雕` is bounded by that builder's catalog cap of 64.

| Sample | Set | Strict | CD declared→actual | Research parser | Electron | Raster counts | Structure | PR #285 targets / multi-frame counts | Candidate |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| 人物倒地.fla | additional | REJECT | 2055→2001 (+54) | PASS | PASS | 0/0/0/0/0 | 1/16/27/94/55/15 | 13 / 11,2 | V2-R non-raster |
| 剑.fla | canonical | PASS | 831→831 (0) | PASS | not exercised | 0/0/0/0/0 | 1/2/2/2/0/1 | 1 / — | V2-R non-raster |
| 向右走.fla | additional | REJECT | 4027→3973 (+54) | PASS | PASS* | 0/0/0/0/0 | 1/27/32/82/26/26 | 25 / 2,7,6,5,2,4,10 | V2-R non-raster |
| 向左冲.fla | additional | REJECT | 4027→3973 (+54) | PASS | PASS | 1/1/0/0/0 | 1/26/35/86/27/25 | 23 / 2,7,6,5,2,4,10 | V1 raster |
| 向左点头.fla | additional | REJECT | 4494→4440 (+54) | PASS | PASS | 1/1/0/0/0 | 1/28/47/101/29/27 | 27 / 2,7,6,5,2,4,10,2 | V1 raster |
| 性感修仙女.fla | canonical | REJECT | 2170→2116 (+54) | PASS | PASS | 0/0/0/0/0 | 1/13/20/64/16/12 | 10 / 7,5,8,2,11 | V2-R non-raster |
| 性感泳装女（补面需求）.fla | additional | REJECT | 2338→2284 (+54) | PASS | PASS | 0/0/0/0/0 | 1/16/23/63/16/15 | 13 / 6,7,7,8 | V2-R non-raster |
| 文件.fla | canonical | PASS | 11556→11556 (0) | PASS | not exercised | 158/156/2/0/0 | 1/1/1/1/0/0 | 1 / — | V1 raster |
| 沙雕表情大全（免费分享，短剧慎用）.fla | canonical | REJECT | 77538→77484 (+54) | PASS | PASS | 128/97/2/0/29 | 1/432/458/964/16/431 | 64† / 2,2,2,2,2,2,2 | V1 raster |
| 炼丹房.fla | canonical | REJECT | 742→688 (+54) | PASS | PASS | 0/0/0/0/0 | 1/2/2/2/0/1 | 1 / — | V2-R non-raster |
| 蓝衣修仙男（补面需求）.fla | canonical | REJECT | 2110→2056 (+54) | PASS | PASS | 0/0/0/0/0 | 1/12/15/39/10/11 | 9 / 12,6 | V2-R non-raster |
| 飞行中旋转.fla | additional | REJECT | 1983→1929 (+54) | PASS | PASS | 1/1/0/0/0 | 1/8/12/18/6/7 | 4 / — | V1 raster |

The historical `沙雕` baseline is independently reproduced: 128 bitmap media, including 97 PNG, 2 JPG, and 29 unknown-format entries. “V1 raster” means direct raster evidence was found; “V2-R non-raster” means the current production parser exposed animation structure and the exact PR #285 builder exposed renderable graphic targets, without claiming that C1 has productized that path.

\* `向右走.fla` returned a structured Electron parser success but also produced one hidden-window teardown/process-exit cleanup warning. This is recorded as harness evidence, not silently treated as a clean zero-warning run.

† The `沙雕` target count is capped at 64 by the PR #285 research builder; it is not a claim that the source contains only 64 possible targets.

## Evidence interpretation

The result has four distinct layers:

1. Strict baseline: the original bytes are rejected or accepted by the current strict archive boundary checks.
2. Differential recovery: all 10 rejected files share a measured 54-byte EOCD central-directory-size overstatement. Central-directory records are complete and end exactly at EOCD after the measured correction. No ZIP64, encryption, trailing bytes, or ambiguous EOCD was used as a fallback.
3. Parser evidence: the existing inspection path successfully parsed every compensated sample. The real Windows Electron probe also returned structured parser success for all 10 compensated samples and did not mutate a Project.
4. Product bridge: the exact PR #285 target builder succeeded on the compensated inputs. It provides a bounded indication of V1 raster value and V2-R non-raster value, not permission to change production routing.

Provenance remains `UNKNOWN`: the bounded metadata scan exposed `platform=Windows`, but filename/grouping evidence does not prove a producer and no independent producer groups were established. The current 12-file corpus also contains no SHA-256 duplicates, so deduplication cannot supply a second provenance axis.

## Reproduction commands

Run from this checkout with an output directory outside the repository:

```powershell
pnpm install --frozen-lockfile
pnpm research:fla-v1-5-c1 -- --root "D:\表情合集" --out "<external-c1-output>"
pnpm exec vitest run tests/unit/fla-c1-recovery-evidence.test.ts
pnpm research:fla-v1-5-c1-electron -- --root "<external-c1-output>\research-copies" --out "<external-c1-output>\electron-results.json"
node scripts/fla-c1-v2r-target-probe.cjs --root "<external-c1-output>\research-copies" --builder "<PR285-validation-worktree>\dist-electron\main\services\fla-static-snapshot-svg-builder.js" --out "<external-c1-output>\v2r-targets.json"
```

The tracked JSON is a normalized backfill of the completed run; it intentionally contains no FLA bytes, extracted images, or private research-copy paths.

## C1 conclusion and next gate

`C1_RECOVERY_VALUE_PROVEN_WITH_LIMITS`

The evidence proves that the narrow, measured +54 correction makes the current malformed samples recoverable for research parsing and target discovery, including the historical 128-media case. It also proves meaningful candidate value across direct raster and non-raster animated samples. It does not prove producer provenance breadth, remove the target-catalog cap, or authorize production integration.

Next gate: maintainer reviews this C1 result and separately authorizes C2. C2/C3, PR #285 changes, R2 human-acceptance restart, and R3 have not started.
