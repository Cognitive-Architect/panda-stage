import type { FlaFrameSequenceCommitResponse } from '../../shared/fla-frame-sequence-api';

/**
 * Formats the authoritative R2 sequence commit outcome for beginners.
 *
 * This is presentation-only: commit, deduplication, and Project mutation
 * remain owned by the existing Main response and renderer store adapter.
 */
export function formatFlaFrameSequenceCommitResult(
  response: FlaFrameSequenceCommitResponse,
): string {
  if (!response.ok) {
    return response.error.message;
  }

  const { importedCount, duplicateCount } = response.result.summary;
  if (importedCount === 0 && duplicateCount === 0) {
    return '提交成功，未新增或复用任何帧素材。';
  }
  if (importedCount === 0) {
    return `新增 0 帧，复用已有素材 ${duplicateCount} 帧。`;
  }
  if (duplicateCount === 0) {
    return `已新增 ${importedCount} 帧素材。`;
  }
  return `已新增 ${importedCount} 帧素材，复用已有素材 ${duplicateCount} 帧。`;
}
