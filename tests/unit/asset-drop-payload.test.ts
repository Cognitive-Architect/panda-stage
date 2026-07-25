import { describe, expect, it, vi } from 'vitest';
import {
  ASSET_DRAG_MIME,
  parseAssetDropPayload,
  serializeAssetDropPayload,
  writeAssetDropPayload,
} from '../../src/renderer/features/assets/AssetDropPayload';

const payload = {
  version: 1 as const,
  assetId: '10000000-0000-4000-8000-000000000002',
  type: 'background-image' as const,
};

describe('asset drag payload', () => {
  it('contains only a version, asset ID, and controlled type', () => {
    const serialized = serializeAssetDropPayload(payload);
    expect(parseAssetDropPayload(serialized)).toEqual(payload);
    expect(Object.keys(JSON.parse(serialized))).toEqual([
      'version',
      'assetId',
      'type',
    ]);
    expect(serialized).not.toContain('assets/');
    expect(serialized).not.toContain(':\\');
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
  });
});
