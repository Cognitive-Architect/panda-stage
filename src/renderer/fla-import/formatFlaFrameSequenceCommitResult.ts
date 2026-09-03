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

  const {
    requestedFrameCount,
    importedCount,
    duplicateCount,
    renamedCount,
  } = response.result.summary;
  const facts: string[] = [];
  if (importedCount > 0) facts.push(`新增 ${importedCount} 帧`);
  if (duplicateCount > 0) facts.push(`复用已有素材 ${duplicateCount} 帧`);
  if (renamedCount > 0) facts.push(`重命名 ${renamedCount} 帧`);
  const headline = importedCount > 0
    ? '帧序列导入完成'
    : duplicateCount > 0
      ? '帧序列已处理'
      : '帧序列已完成';
  const details = facts.length > 0 ? `${facts.join('，')}；` : '';
  return `${headline}：${details}共处理 ${requestedFrameCount} 帧。`;
}
