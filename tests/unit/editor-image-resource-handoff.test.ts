import { describe, expect, it } from 'vitest';
import {
  buildEditorImageResourceHandoff,
  type EditorImageResource,
} from '../../src/renderer/features/canvas/editorImageResourceHandoff';

function resource(sourceKey: string): EditorImageResource {
  return {
    image: {} as HTMLImageElement,
    objectUrl: `blob:${sourceKey}`,
    sourceKey,
    disposed: false,
  };
}

describe('editor image resource handoff', () => {
  it('atomically accepts a complete replacement map', () => {
    const first = resource('sha-first');
    const second = resource('sha-second');
    const result = buildEditorImageResourceHandoff(
      [
        { assetId: 'background', sha256: 'sha-first' },
        { assetId: 'character', sha256: 'sha-second' },
      ],
      new Map([
        ['background', first],
        ['character', second],
      ]),
    );

    expect(result.ready).toBe(true);
    expect(result.resources).toEqual(
      new Map([
        ['background', first],
        ['character', second],
      ]),
    );
    expect(result.images.get('background')).toBe(first.image);
    expect(result.sourceKeys.get('character')).toBe('sha-second');
    expect(result.missing.size).toBe(0);
  });

  it('rejects a partial replacement so the caller can retain the old map', () => {
    const first = resource('sha-first');
    const result = buildEditorImageResourceHandoff(
      [
        { assetId: 'background', sha256: 'sha-first' },
        { assetId: 'character', sha256: 'sha-second' },
      ],
      new Map([['background', first]]),
    );

    expect(result.ready).toBe(false);
    expect(result.resources.size).toBe(0);
    expect(result.images.size).toBe(0);
    expect(result.missing).toEqual(new Set(['character']));
  });

  it('rejects a stale resource even when an image exists', () => {
    const stale = resource('sha-old');
    const result = buildEditorImageResourceHandoff(
      [{ assetId: 'character', sha256: 'sha-new' }],
      new Map([['character', stale]]),
    );

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(new Set(['character']));
  });

  it('requires metadata-backed resources for every requested asset', () => {
    const result = buildEditorImageResourceHandoff(
      [{ assetId: 'character' }],
      new Map([['character', resource('sha-any')]]),
    );

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(new Set(['character']));
  });
});
