import { describe, expect, it } from 'vitest';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import {
  runFlaUnifiedImport,
  type FlaUnifiedImportItem,
  type FlaUnifiedImportRunner,
} from '../../src/renderer/fla-import/fla-unified-import';

const snapshot: EditorProjectSnapshot = {
  projectRoot: 'D:\\PandaStage-Acceptance\\project',
  project: {} as EditorProjectSnapshot['project'],
  dirty: false,
  revision: 0,
};

function item(kind: FlaUnifiedImportItem['kind'], key: string): FlaUnifiedImportItem {
  return { key, kind, identityKey: `identity:${key}`, label: key };
}

function nextSnapshot(current: EditorProjectSnapshot): EditorProjectSnapshot {
  return { ...current, revision: current.revision + 1 };
}

describe('runFlaUnifiedImport', () => {
  it('runs existing route operations in selection order and threads each saved revision', async () => {
    const selected = [
      item('raster', 'bitmap-new'),
      item('snapshot', 'scene-duplicate'),
      item('raster', 'bitmap-duplicate'),
      item('sequence', 'walk-cycle'),
    ];
    const observedRevisions: number[] = [];
    const observedRouteOrder: string[] = [];
    const makeRunner: FlaUnifiedImportRunner = async (routeItems, current) => {
      observedRevisions.push(current.revision);
      observedRouteOrder.push(routeItems[0]!.kind);
      const updated = nextSnapshot(current);
      const items = routeItems.map((selectedItem, index) => {
        const status = selectedItem.kind === 'sequence'
          ? 'imported' as const
          : selectedItem.kind === 'snapshot' || index > 0
            ? 'duplicate' as const
            : 'imported' as const;
        return {
          ...selectedItem,
          status,
          baseRevision: current.revision,
          savedRevision: updated.revision,
          importedAssetCount: selectedItem.kind === 'sequence' ? 2 : status === 'imported' ? 1 : 0,
          duplicateAssetCount: selectedItem.kind === 'sequence' ? 1 : status === 'duplicate' ? 1 : 0,
        };
      });
      return {
        items,
        snapshot: updated,
      };
    };

    const receipt = await runFlaUnifiedImport({
      items: selected,
      snapshot,
      runners: { raster: makeRunner, snapshot: makeRunner, sequence: makeRunner },
      shouldCancel: () => false,
    });

    expect(observedRouteOrder).toEqual(['raster', 'snapshot', 'sequence']);
    expect(observedRevisions).toEqual([0, 1, 2]);
    expect(receipt.items.map(({ baseRevision, savedRevision }) => [baseRevision, savedRevision])).toEqual([
      [0, 1],
      [1, 2],
      [0, 1],
      [2, 3],
    ]);
    expect(receipt.snapshot.revision).toBe(3);
    expect(receipt.counts).toEqual({
      imported: 2,
      duplicate: 2,
      failed: 0,
      notAttempted: 0,
      importedAssets: 3,
      duplicateAssets: 3,
    });
    expect(receipt.partial).toBe(false);
  });

  it('keeps a failed item result and reports later route groups as not attempted', async () => {
    const selected = [item('raster', 'bitmap-new'), item('raster', 'bitmap-failed'), item('snapshot', 'scene')];
    const raster: FlaUnifiedImportRunner = async (routeItems, current) => ({
      items: [
        { ...routeItems[0]!, status: 'imported', importedAssetCount: 1 },
        { ...routeItems[1]!, status: 'failed', message: 'commit failed' },
      ],
      snapshot: nextSnapshot(current),
      stopFollowingRoutes: true,
    });
    const snapshotRunner: FlaUnifiedImportRunner = async (routeItems, current) => ({
      items: routeItems.map((selectedItem) => ({ ...selectedItem, status: 'imported' })),
      snapshot: nextSnapshot(current),
    });

    const receipt = await runFlaUnifiedImport({
      items: selected,
      snapshot,
      runners: { raster, snapshot: snapshotRunner },
      shouldCancel: () => false,
    });

    expect(receipt.items.map(({ status }) => status)).toEqual(['imported', 'failed', 'not-attempted']);
    expect(receipt.items[2]?.message).toContain('前一项未能完成');
    expect(receipt.snapshot.revision).toBe(1);
    expect(receipt.counts).toMatchObject({ imported: 1, failed: 1, notAttempted: 1 });
    expect(receipt.partial).toBe(true);
  });

  it('stops before the next route after cancellation and counts its items as not attempted', async () => {
    const selected = [item('raster', 'bitmap'), item('snapshot', 'scene'), item('sequence', 'walk')];
    let cancelled = false;
    const raster: FlaUnifiedImportRunner = async (routeItems, current) => {
      cancelled = true;
      return {
        items: routeItems.map((selectedItem) => ({ ...selectedItem, status: 'imported', importedAssetCount: 1 })),
        snapshot: nextSnapshot(current),
      };
    };
    const unused: FlaUnifiedImportRunner = async (routeItems, current) => ({
      items: routeItems.map((selectedItem) => ({ ...selectedItem, status: 'imported' })),
      snapshot: nextSnapshot(current),
    });

    const receipt = await runFlaUnifiedImport({
      items: selected,
      snapshot,
      runners: { raster, snapshot: unused, sequence: unused },
      shouldCancel: () => cancelled,
    });

    expect(receipt.items.map(({ status }) => status)).toEqual(['imported', 'not-attempted', 'not-attempted']);
    expect(receipt.counts).toMatchObject({ imported: 1, notAttempted: 2 });
    expect(receipt.cancelled).toBe(true);
    expect(receipt.snapshot.revision).toBe(1);
  });

  it('offers stop-after-current only while a safe follow-on operation exists', async () => {
    const rasterBatch = [item('raster', 'bitmap-a'), item('raster', 'bitmap-b')];
    const rasterAvailability: boolean[] = [];
    const rasterRunner: FlaUnifiedImportRunner = async (routeItems, current) => ({
      items: routeItems.map((selectedItem) => ({ ...selectedItem, status: 'imported' })),
      snapshot: nextSnapshot(current),
    });

    await runFlaUnifiedImport({
      items: rasterBatch,
      snapshot,
      runners: { raster: rasterRunner },
      shouldCancel: () => false,
      onStopActionAvailabilityChange: (available) => rasterAvailability.push(available),
    });

    expect(rasterAvailability).toEqual([false]);

    const snapshotBatch = [item('snapshot', 'scene-a'), item('snapshot', 'scene-b')];
    const snapshotAvailability: boolean[] = [];
    const snapshotRunner: FlaUnifiedImportRunner = async (
      routeItems,
      current,
      _shouldCancel,
      onItemCompleted,
    ) => {
      onItemCompleted?.(1);
      return {
        items: routeItems.map((selectedItem) => ({ ...selectedItem, status: 'imported' })),
        snapshot: nextSnapshot(current),
      };
    };

    await runFlaUnifiedImport({
      items: snapshotBatch,
      snapshot,
      runners: { snapshot: snapshotRunner },
      shouldCancel: () => false,
      onStopActionAvailabilityChange: (available) => snapshotAvailability.push(available),
    });

    expect(snapshotAvailability).toEqual([true, false]);
  });
});
