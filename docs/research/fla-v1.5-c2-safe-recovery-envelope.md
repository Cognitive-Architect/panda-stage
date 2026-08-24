# FLA V1.5-C2 safe recovery envelope

Execution date: 2026-08-23  
Issue: [#300](https://github.com/Cognitive-Architect/panda-stage/issues/300)  
Roadmap: [#297](https://github.com/Cognitive-Architect/panda-stage/issues/297)  
C1 source: [#298](https://github.com/Cognitive-Architect/panda-stage/issues/298) / [Draft PR #299](https://github.com/Cognitive-Architect/panda-stage/pull/299)  
Live `main`: `3c47a4ee8af07e834338b223fcb3260a4c6dddbc`  
C1 PR #299 HEAD: `df9ce245d73cdd17bb10d90131c0128c3ff2e1a1`  
PR #285 observed: `a111649df2615e8140e51eada17861fef0f6b403`

## Scope

This is research-only C2 work. It does not implement production recovery, relax production preflight, alter V1/V2-R routing, open a Project, execute ActionScript, restart R2 acceptance, or modify PR #285. The approved root was `D:\表情合集`; only top-level `.fla` files were read, and originals remained read-only.

The complete normalized run, including every local-header offset list, is [fla-v1.5-c2-safe-recovery-envelope.json](./fla-v1.5-c2-safe-recovery-envelope.json). It contains no FLA bytes, extracted media, rendered derivatives, or filesystem paths to the private corpus.

## Classifier contract

The research API is `classifyForFlaRecovery(bytes, budgets)` and returns exactly one of:

```text
STRICT_VALID | RECOVERY_CANDIDATE | REJECT | AMBIGUOUS
```

It also returns explicit reason codes, measurements, and precondition flags. It is deterministic, bounded before decompression, source-pure, and has no production/UI wiring.

`RECOVERY_CANDIDATE` requires all of the following:

1. Classic ZIP/XFL bytes beginning with a local header; one unambiguous EOCD at the input end; no trailing bytes, embedded/forged second EOCD, ZIP64, or multi-disk metadata.
2. The independently measured central-directory span is contiguous, complete, count-consistent, and within the existing entry/size budgets.
3. Every central record has a bounded, non-overlapping local header and data range. Local and central names, flags, methods, and sizes agree; only supported methods 0/8 are accepted; encryption and data descriptors are rejected.
4. Names are safe for the existing extraction namespace. No path traversal, absolute path, duplicate central path, malformed name, hidden range, or conflicting local-only payload is accepted.
5. At most one local-only record may exist. It must be a complete, bounded, non-encrypted record whose name, metadata, and compressed bytes are exactly identical to a central-directory entry. This structural duplicate rule is why the 10 C1 positives remain candidates without using a filename or seller/site allowlist.
6. `EOCD.centralDirectorySize` is the only inconsistent declaration and is exactly 54 bytes larger than the complete measured span. `+54` is necessary, never sufficient.
7. The proposed correction is applied only to an in-memory/research-owned copy; the corrected copy must classify `STRICT_VALID` and pass the existing offline inspection probe.

Strict-valid controls are returned as `STRICT_VALID` and are never normalized.

## Real corpus result

| Sample | C1 strict | C2 state | Declared → actual CD bytes | Records | Local-only exact duplicates | Revalidation |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 人物倒地.fla | REJECT | RECOVERY_CANDIDATE | 2055 → 2001 (+54) | 26 | 1 | STRICT_VALID / PASS |
| 剑.fla | PASS | STRICT_VALID | 831 → 831 (0) | 12 | 0 | not applicable |
| 向右走.fla | REJECT | RECOVERY_CANDIDATE | 4027 → 3973 (+54) | 42 | 1 | STRICT_VALID / PASS |
| 向左冲.fla | REJECT | RECOVERY_CANDIDATE | 4027 → 3973 (+54) | 42 | 1 | STRICT_VALID / PASS |
| 向左点头.fla | REJECT | RECOVERY_CANDIDATE | 4494 → 4440 (+54) | 47 | 1 | STRICT_VALID / PASS |
| 性感修仙女.fla | REJECT | RECOVERY_CANDIDATE | 2170 → 2116 (+54) | 23 | 1 | STRICT_VALID / PASS |
| 性感泳装女（补面需求）.fla | REJECT | RECOVERY_CANDIDATE | 2338 → 2284 (+54) | 27 | 1 | STRICT_VALID / PASS |
| 文件.fla | PASS | STRICT_VALID | 11556 → 11556 (0) | 168 | 0 | not applicable |
| 沙雕表情大全（免费分享，短剧慎用）.fla | REJECT | RECOVERY_CANDIDATE | 77538 → 77484 (+54) | 824 | 1 | STRICT_VALID / PASS |
| 炼丹房.fla | REJECT | RECOVERY_CANDIDATE | 742 → 688 (+54) | 11 | 1 | STRICT_VALID / PASS |
| 蓝衣修仙男（补面需求）.fla | REJECT | RECOVERY_CANDIDATE | 2110 → 2056 (+54) | 25 | 1 | STRICT_VALID / PASS |
| 飞行中旋转.fla | REJECT | RECOVERY_CANDIDATE | 1983 → 1929 (+54) | 22 | 1 | STRICT_VALID / PASS |

All 12 SHA-256 values, byte lengths, EOCD offsets, declared/actual boundaries, central record counts, compression methods, local-header offsets, reason codes, and source-hash checks are in the JSON matrix. The 10 C1 malformed positives have candidate recall `10/10`; both strict controls are correctly separated `2/2`.

## Negative and ambiguity matrix

The harness generated 19 repo-safe fixtures in memory; no synthetic bytes were committed. Seventeen classified `REJECT`, two classified `AMBIGUOUS`, and zero classified `RECOVERY_CANDIDATE`.

| Fixture family | Count | Coverage | Result |
| --- | ---: | --- | --- |
| Truncation | 4 | central fixed/variable record, referenced local data, EOCD | REJECT; `+54` on first three |
| Local/central mismatch | 3 | size, compression method, security-relevant flags | REJECT; all `+54` |
| Overlap/conflicting ranges | 1 | two records share a local range | REJECT; `+54` |
| Hidden/conflicting payload | 3 | conflicting local-only duplicate, bytes in central span, trailing bytes | REJECT/AMBIGUOUS; `+54` injected |
| Forged/multiple EOCD | 1 | two plausible EOCD candidates | AMBIGUOUS; `+54` injected |
| ZIP64 | 1 | EOCD ZIP64 marker | REJECT; `+54` injected |
| Encryption | 1 | encrypted entry flag | REJECT; `+54` injected |
| Multi-disk | 1 | non-zero EOCD disk number | REJECT; `+54` injected |
| Unsupported compression | 1 | method 99 | REJECT; `+54` injected |
| Path traversal | 1 | `../` member | REJECT; `+54` injected |
| Resource budgets | 2 | entry-count and expanded-size limits | REJECT; `+54` injected |

Summary: negative fixture count `19`; ambiguous fixture count `2`; `+54` unsafe fixtures `18`; malicious/ambiguous recovery-candidate false accepts `0`; ambiguous recovery-candidate false accepts `0`. This explicitly proves that `delta == 54` alone is not a recovery rule.

## Safety and revalidation

- Source SHA invariance: `PASS`; all 12 originals were rehashed after inspection.
- Original files modified: `NO`.
- Production preflight changed: `NO`.
- Production recovery implemented: `NO`.
- Candidate normalization: research/in-memory only, `10/10` archive revalidation `STRICT_VALID`.
- Existing offline inspection differential: `10/10` `PASS` after in-memory correction.
- C1's real Windows Electron evidence remains the prior C1 evidence layer; C2 did not write or re-run private corpus copies through a new Electron process.
- The existing resource budgets are reused for source bytes, entries, central-directory size, per-entry sizes, and expanded archive size. No decompression is performed by the classifier.

## Reproduction

From the C2 checkout:

```powershell
pnpm install --frozen-lockfile
pnpm research:fla-v1-5-c2 -- --root "D:\表情合集" --out "<external-c2-output>"
pnpm exec vitest run tests/unit/fla-c2-safe-recovery-envelope.test.ts
```

The one-command harness writes only `c2-evidence.json` outside the approved corpus root.

Final exact run output: `D:\PandaStage-Acceptance\issue300-c2-20260823-1615\c2-evidence.json`.

Final checks: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm exec vitest run tests/unit/fla-c2-safe-recovery-envelope.test.ts` PASS (4/4); `pnpm test:unit` PASS (130 files / 954 tests); `pnpm build` PASS; C2 harness PASS with 19 fixtures and 0 candidate false accepts.

## C2 conclusion

`C2_SAFE_RECOVERY_ENVELOPE_DEFINED_WITH_LIMITS`

The evidence defines a generic, structural, fail-closed recovery envelope with full negative-matrix protection and 10/10 positive research coverage. The limits are intentional: the envelope excludes data-descriptor ZIPs, remains research-only, and does not resolve C1 provenance breadth. No production recovery is authorized by this result.

Next gate: maintainer reviews C2 and separately creates/authorizes a C3 Compatibility Recovery Implementation issue. C3, C4, R2 restart, R3, V2-S, and PR #285 changes remain not started.
