import { describe, expect, it } from 'vitest';
import {
  refreshImportedAudioMetadata,
  type AssetMetadataBatchSnapshot,
} from '../../src/renderer/features/assets/assetMetadataQueue';

describe('imported audio metadata queue', () => {
  it('deduplicates and refreshes every asset sequentially', async () => {
    const snapshot: AssetMetadataBatchSnapshot = {
      projectRoot: 'D:\\audio.pandastage',
      project: { id: 'project-a' },
    };
    const calls: string[] = [];
    let active = 0;
    let maximumActive = 0;

    const outcome = await refreshImportedAudioMetadata(
      ['audio-a', 'audio-a', 'audio-b', 'audio-c'],
      {
        getSnapshot: () => snapshot,
        refresh: async (assetId) => {
          calls.push(assetId);
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await Promise.resolve();
          active -= 1;
          return { status: 'ready', applied: true };
        },
      },
    );

    expect(calls).toEqual(['audio-a', 'audio-b', 'audio-c']);
    expect(maximumActive).toBe(1);
    expect(outcome).toEqual({
      readyCount: 3,
      errorCount: 0,
      stopped: false,
      failures: [],
    });
  });

  it('stops before the next asset when the active project changes', async () => {
    let snapshot: AssetMetadataBatchSnapshot = {
      projectRoot: 'D:\\audio.pandastage',
      project: { id: 'project-a' },
    };
    const calls: string[] = [];

    const outcome = await refreshImportedAudioMetadata(
      ['audio-a', 'audio-b'],
      {
        getSnapshot: () => snapshot,
        refresh: async (assetId) => {
          calls.push(assetId);
          snapshot = {
            projectRoot: 'D:\\other.pandastage',
            project: { id: 'project-b' },
          };
          return { status: 'ready', applied: true };
        },
      },
    );

    expect(calls).toEqual(['audio-a']);
    expect(outcome).toEqual({
      readyCount: 1,
      errorCount: 0,
      stopped: true,
      failures: [],
    });
  });

  it('retains a filename-addressable message when audio analysis fails', async () => {
    const snapshot: AssetMetadataBatchSnapshot = {
      projectRoot: 'D:\\audio.pandastage',
      project: { id: 'project-a' },
    };

    const outcome = await refreshImportedAudioMetadata(['audio-a'], {
      getSnapshot: () => snapshot,
      refresh: async () => ({
        status: 'error',
        applied: false,
        message: '源文件无法读取；可在素材详情中重试。',
      }),
    });

    expect(outcome).toEqual({
      readyCount: 0,
      errorCount: 1,
      stopped: false,
      failures: [
        {
          assetId: 'audio-a',
          message: '源文件无法读取；可在素材详情中重试。',
        },
      ],
    });
  });
});
