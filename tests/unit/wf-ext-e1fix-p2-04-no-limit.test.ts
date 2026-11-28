import { describe, expect, it } from 'vitest';
import {
  ProjectResourceImportPreviewRequestSchema,
  ProjectResourceImportPreviewResponseSchema,
  ProjectResourceImportApplyRequestSchema,
} from '../../src/shared/project-resource-import-api';

describe('P2-04: no hard 200-item limit on reuse candidates or diagnostics', () => {
  it('accepts preview requests with more than 200 reuse definitions', () => {
    const reuseDefinitions = Array.from({ length: 250 }, (_, i) => ({
      kind: 'character' as const,
      sourceId: `00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
      targetId: `10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
    }));
    const request = {
      projectRoot: 'D:/fake',
      project: { schemaVersion: 47, id: '00000000-0000-4000-8000-000000000001', name: 'P', width: 1920, height: 1080, fps: 24, assets: [], animations: [], characters: [], voiceProfiles: [], subtitleStyles: [{ id: '00000000-0000-4000-8000-0000000000ff', name: 'D', fontFamily: 'F', fontSize: 44, textColor: '#fffdf6', backgroundColor: '#0a141100', position: 'bottom', align: 'center', maxWidth: 1600 }], shots: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as never,
      baseRevision: 0,
      sourceToken: '00000000-0000-4000-8000-000000000002',
      resources: [{ kind: 'character' as const, id: '00000000-0000-4000-8000-000000000003' }],
      reuseDefinitions,
    };
    // Should not throw despite >200 entries.
    expect(() =>
      ProjectResourceImportPreviewRequestSchema.parse(request),
    ).not.toThrow();
  });

  it('accepts preview responses with more than 200 reusable definitions and diagnostics', () => {
    const reusableDefinitions = Array.from({ length: 250 }, (_, i) => ({
      kind: 'character' as const,
      sourceId: `00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
      sourceName: `角色${i}`,
      targetId: `10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
      targetName: `目标${i}`,
    }));
    const reuseDiagnostics = Array.from({ length: 250 }, (_, i) => ({
      kind: 'character' as const,
      sourceId: `00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
      sourceName: `角色${i}`,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED' as const,
      reason: `诊断 ${i}`,
    }));
    const issues = Array.from({ length: 250 }, (_, i) => `问题 ${i}`);
    const response = {
      ok: true as const,
      selectedCount: 250,
      characterCount: 250,
      animationCount: 0,
      assetCount: 0,
      reusableAssetCount: 0,
      newFileCount: 0,
      reusableDefinitions,
      reuseDiagnostics,
      nameConflicts: [],
      issues,
    };
    expect(() =>
      ProjectResourceImportPreviewResponseSchema.parse(response),
    ).not.toThrow();
  });

  it('accepts apply requests with more than 200 reuse definitions', () => {
    const reuseDefinitions = Array.from({ length: 250 }, (_, i) => ({
      kind: 'animation' as const,
      sourceId: `20000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
      targetId: `30000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
    }));
    const request = {
      projectRoot: 'D:/fake',
      project: { schemaVersion: 47, id: '00000000-0000-4000-8000-000000000001', name: 'P', width: 1920, height: 1080, fps: 24, assets: [], animations: [], characters: [], voiceProfiles: [], subtitleStyles: [{ id: '00000000-0000-4000-8000-0000000000ff', name: 'D', fontFamily: 'F', fontSize: 44, textColor: '#fffdf6', backgroundColor: '#0a141100', position: 'bottom', align: 'center', maxWidth: 1600 }], shots: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as never,
      baseRevision: 0,
      sourceToken: '00000000-0000-4000-8000-000000000002',
      resources: [{ kind: 'character' as const, id: '00000000-0000-4000-8000-000000000003' }],
      reuseDefinitions,
    };
    expect(() =>
      ProjectResourceImportApplyRequestSchema.parse(request),
    ).not.toThrow();
  });

  it('still enforces the existing 100-item input selection limit', () => {
    const resources = Array.from({ length: 101 }, (_, i) => ({
      kind: 'character' as const,
      id: `40000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
    }));
    const request = {
      projectRoot: 'D:/fake',
      project: { schemaVersion: 47, id: '00000000-0000-4000-8000-000000000001', name: 'P', width: 1920, height: 1080, fps: 24, assets: [], animations: [], characters: [], voiceProfiles: [], subtitleStyles: [{ id: '00000000-0000-4000-8000-0000000000ff', name: 'D', fontFamily: 'F', fontSize: 44, textColor: '#fffdf6', backgroundColor: '#0a141100', position: 'bottom', align: 'center', maxWidth: 1600 }], shots: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as never,
      baseRevision: 0,
      sourceToken: '00000000-0000-4000-8000-000000000002',
      resources,
    };
    expect(() =>
      ProjectResourceImportPreviewRequestSchema.parse(request),
    ).toThrow();
  });
});
