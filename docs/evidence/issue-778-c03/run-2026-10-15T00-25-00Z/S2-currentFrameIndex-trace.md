# S2 diagnostic: absolute frame index versus batch length

**Status: unresolved, read-only trace.** Issue #778 authorized diagnosis and a proposed fix only. No Main, Preload, shared IPC schema, or protocol code was changed. The uncaught progress-schema error remains a Gate C risk; this note does not award Gate C acceptance.

## Data flow

1. The shared request/result model distinguishes an absolute `frameIndex` from a zero-based per-batch `sequenceOrdinal` ([shared sequence model](../../../../src/shared/fla-frame-sequence-api.ts#L152)).
2. Main emits the requested timeline index as `frameIndex: i` ([IPC producer](../../../../src/main/ipc/register-fla-frame-sequence-ipc-handlers.ts#L124)). The service forwards that absolute index as progress `currentFrameIndex: frame.frameIndex`, while `completedFrameCount` and `totalFrameCount` describe the batch size ([progress producer](../../../../src/main/services/fla-frame-sequence-service.ts#L397)).
3. The shared progress schema correctly caps `completedFrameCount` and `totalFrameCount` at 24, but also incorrectly caps `currentFrameIndex` at 24 and documents it as an ordinal ([progress schema](../../../../src/shared/fla-frame-sequence-api.ts#L398)).
4. The Preload listener calls `FlaFrameSequenceProgressSchema.parse(rawProgress)` directly in the IPC callback without a local error boundary ([Preload consumer](../../../../src/preload/index.ts#L558)). A valid absolute frame index above 24 therefore throws an uncaught ZodError even when the generated batch contains no more than 24 frames.
5. The earlier Windows receipt contains eight uncaught ZodErrors with maximum 24 and path `currentFrameIndex`; rendering/commit of the bounded output still succeeded ([Issue 775 receipt](../../../../docs/evidence/issue-775-c03/run-2026-10-14T12-01-51-066Z/receipt.json#L5527)). This is a progress-telemetry/schema mismatch, not evidence of a failed render transaction.

## Narrow proposal for separate authorization

Remove the batch-length maximum from the absolute `currentFrameIndex` field (or introduce a separately named, explicitly bounded ordinal field if a consumer needs one). Keep the 24-frame maximum on `completedFrameCount` and `totalFrameCount`. Add tests that generate at frame 25 and near the end of a longer timeline: progress indices remain absolute, batch counters stay within 24, Preload emits no uncaught validation error, and the bounded output still commits.

This is intentionally not implemented under #778. Preserve strict validation and request a separate owner-authorized contract change before modifying Main/Preload/shared IPC.
