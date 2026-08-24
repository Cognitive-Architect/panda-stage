import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import { formatFlaFrameSequenceCommitResult } from '../../src/renderer/fla-import/formatFlaFrameSequenceCommitResult';
import { FlaFrameSequenceCommitResponseSchema } from '../../src/shared/fla-frame-sequence-api';
import exampleProject from '../../demo-project/project-v1.example.json';

const project = migrateProject(exampleProject);

function successResponse(importedCount: number, duplicateCount: number) {
  return FlaFrameSequenceCommitResponseSchema.parse({
    ok: true,
    status: 'completed',
    project,
    baseRevision: 0,
    savedRevision: 1,
    projectChanged: importedCount > 0,
    result: {
      items: [],
      summary: {
        requestedFrameCount: Math.max(1, importedCount + duplicateCount),
        importedCount,
        duplicateCount,
        renamedCount: 0,
        netNewImageAssetCount: importedCount,
      },
    },
  });
}

describe('formatFlaFrameSequenceCommitResult', () => {
  it('keeps a new-only success concise', () => {
    expect(formatFlaFrameSequenceCommitResult(successResponse(5, 0))).toBe(
      '已新增 5 帧素材。',
    );
  });

  it('shows both newly-created and reused counts for a mixed success', () => {
    expect(formatFlaFrameSequenceCommitResult(successResponse(3, 2))).toBe(
      '已新增 3 帧素材，复用已有素材 2 帧。',
    );
  });

  it('makes a duplicate-only success unmistakably successful', () => {
    expect(formatFlaFrameSequenceCommitResult(successResponse(0, 5))).toBe(
      '新增 0 帧，复用已有素材 5 帧。',
    );
  });

  it('keeps failure output as the error message rather than success copy', () => {
    const response = FlaFrameSequenceCommitResponseSchema.parse({
      ok: false,
      error: {
        code: 'STALE_PROJECT_REVISION',
        message: '项目已发生变化，请刷新后重试。',
        projectRoot: 'D:\\sequence.pandastage',
      },
    });

    expect(formatFlaFrameSequenceCommitResult(response)).toBe(
      '项目已发生变化，请刷新后重试。',
    );
    expect(formatFlaFrameSequenceCommitResult(response)).not.toContain('复用已有素材');
  });
});
