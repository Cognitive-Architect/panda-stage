import { describe, expect, it, vi } from 'vitest';
import {
  ANIMATION_DRAG_CONTEXT_MIME,
  ASSET_DRAG_MIME,
  isCurrentAnimationDropContext,
  parseAssetDropPayload,
  readAnimationDropContext,
  serializeAssetDropPayload,
  writeAnimationDropContext,
  writeAssetDropPayload,
} from '../../src/renderer/features/assets/AssetDropPayload';

const payload = {
  version: 2 as const,
  assetId: '10000000-0000-4000-8000-000000000002',
  type: 'asset-image' as const,
};

describe('asset drag payload', () => {
  it('contains only a version, asset ID, and controlled type', () => {
    const serialized = serializeAssetDropPayload(payload);
    expect(parseAssetDropPayload(serialized)).toEqual(payload);
    expect(Object.keys(JSON.parse(serialized))).toEqual([
      'version',
      'type',
      'assetId',
    ]);
    expect(serialized).not.toContain('assets/');
    expect(serialized).not.toContain(':\\');
  });

  it('preserves explicit character and expression identity', () => {
    const characterPayload = {
      version: 2 as const,
      type: 'character-expression' as const,
      assetId: '10000000-0000-4000-8000-000000000002',
      characterId: '20000000-0000-4000-8000-000000000001',
      expressionId: '20000000-0000-4000-8000-000000000002',
    };
    expect(
      parseAssetDropPayload(
        serializeAssetDropPayload(characterPayload),
      ),
    ).toEqual(characterPayload);
  });

  it('carries only the formal animation definition ID for an animation drop', () => {
    const animationPayload = {
      version: 3 as const,
      type: 'animation' as const,
      animationId: '70000000-0000-4000-8000-000000000001',
    };
    const serialized = serializeAssetDropPayload(animationPayload);
    expect(parseAssetDropPayload(serialized)).toEqual(animationPayload);
    expect(Object.keys(JSON.parse(serialized))).toEqual([
      'version',
      'type',
      'animationId',
    ]);
  });

  it('writes only the allowlisted custom MIME payload', () => {
    const setData = vi.fn();
    const transfer: Pick<DataTransfer, 'effectAllowed' | 'setData'> = {
      effectAllowed: 'none',
      setData,
    };
    writeAssetDropPayload(transfer, payload);
    expect(transfer.effectAllowed).toBe('copy');
    expect(setData).toHaveBeenCalledOnce();
    expect(setData).toHaveBeenCalledWith(
      ASSET_DRAG_MIME,
      serializeAssetDropPayload(payload),
    );
  });

  it('rejects animation drops whose captured project, revision, Shot, or definition is stale', () => {
    const context = {
      version: 1 as const,
      animationId: '70000000-0000-4000-8000-000000000001',
      projectId: '70000000-0000-4000-8000-000000000002',
      projectInstanceId: 4,
      projectRevision: 12,
      shotId: '70000000-0000-4000-8000-000000000003',
    };
    const setData = vi.fn();
    writeAnimationDropContext({ setData }, context);
    expect(setData).toHaveBeenCalledOnce();
    expect(setData).toHaveBeenCalledWith(
      ANIMATION_DRAG_CONTEXT_MIME,
      expect.any(String),
    );

    const serialized = setData.mock.calls[0]?.[1] as string;
    const parsed = readAnimationDropContext({
      getData: vi.fn().mockReturnValue(serialized),
    });
    const target = {
      projectId: context.projectId,
      projectInstanceId: context.projectInstanceId,
      projectRevision: context.projectRevision,
      shotId: context.shotId,
    };
    expect(isCurrentAnimationDropContext(parsed, target, context.animationId)).toBe(true);
    expect(isCurrentAnimationDropContext(parsed, { ...target, projectId: '70000000-0000-4000-8000-000000000004' }, context.animationId)).toBe(false);
    expect(isCurrentAnimationDropContext(parsed, { ...target, projectInstanceId: 5 }, context.animationId)).toBe(false);
    expect(isCurrentAnimationDropContext(parsed, { ...target, projectRevision: 13 }, context.animationId)).toBe(false);
    expect(isCurrentAnimationDropContext(parsed, { ...target, shotId: '70000000-0000-4000-8000-000000000005' }, context.animationId)).toBe(false);
    expect(isCurrentAnimationDropContext(parsed, target, '70000000-0000-4000-8000-000000000006')).toBe(false);
    expect(readAnimationDropContext({ getData: vi.fn().mockReturnValue('invalid') })).toBeNull();
    expect(readAnimationDropContext({ getData: vi.fn().mockReturnValue('') })).toBeNull();
  });

  it('rejects paths, full assets, and unknown drag types', () => {
    expect(() =>
      parseAssetDropPayload(
        JSON.stringify({
          ...payload,
          relativePath: 'assets/private.png',
        }),
      ),
    ).toThrow();
    expect(() =>
      parseAssetDropPayload(
        JSON.stringify({ ...payload, type: 'file' }),
      ),
    ).toThrow();
    expect(() =>
      parseAssetDropPayload(
        JSON.stringify({
          version: 1,
          assetId: payload.assetId,
          type: 'character-image',
        }),
      ),
    ).toThrow();
  });
});
