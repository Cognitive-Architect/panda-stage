import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import {
  assetCategoryCounts,
  selectAssetLibraryEntries,
} from '../../src/renderer/stores/assetLibrarySelectors';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('asset library selectors', () => {
  it('categorizes character images, backgrounds, and audio', () => {
    const project = ProjectSchema.parse(exampleProject);
    expect(assetCategoryCounts(project)).toEqual({
      character: 2,
      background: 1,
      audio: 1,
    });
    expect(
      selectAssetLibraryEntries(project, 'character').map(
        (entry) => entry.asset.name,
      ),
    ).toEqual(['Panda happy', 'Panda neutral']);
  });

  it('selects and sorts 100 background fixtures without loading file paths', () => {
    const base = ProjectSchema.parse({
      ...exampleProject,
      assets: [],
      characters: [],
      voiceProfiles: [],
      shots: [],
    });
    const project = ProjectSchema.parse({
      ...base,
      assets: Array.from({ length: 100 }, (_, index) => ({
        id: randomUUID(),
        name: `Background ${String(99 - index).padStart(3, '0')}`,
        relativePath: `assets/source-${index}.png`,
        mimeType: 'image/png',
        kind: 'image',
        width: 16,
        height: 12,
      })),
    });
    const entries = selectAssetLibraryEntries(project, 'background');
    expect(entries).toHaveLength(100);
    expect(entries[0]?.asset.name).toBe('Background 000');
    expect(entries[99]?.asset.name).toBe('Background 099');
  });
});
