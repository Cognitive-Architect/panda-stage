import { describe, expect, it } from 'vitest';
import { buildProject } from '../../../../tests/unit/domain/testProject';
import { editorProjectStore } from '../../../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../../../src/renderer/stores/shotStore';
import {
  timelineUiStore,
} from '../../../../src/renderer/features/timeline/timelineUiStore';

describe('timelineUiStore seek boundaries', () => {
  it('clamps and snaps seek into [0, durationMs] without touching the project', () => {
    const before = editorProjectStore.getSnapshot();
    timelineUiStore.seek(5000, 3000);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(3000);
    timelineUiStore.seek(-100, 3000);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(0);
    timelineUiStore.seek(1000, 3000);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1000);
    timelineUiStore.seek(13, 3000);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(0);
    // No project snapshot mutation from any seek.
    expect(editorProjectStore.getSnapshot()).toBe(before);
    expect(editorProjectStore.getSnapshot()?.dirty).toBeFalsy();
  });

  it('zoom and scroll stay within safe bounds', () => {
    timelineUiStore.setZoom(100);
    expect(timelineUiStore.getSnapshot().zoom).toBe(8);
    timelineUiStore.setZoom(0.1);
    expect(timelineUiStore.getSnapshot().zoom).toBe(1);
    timelineUiStore.setScrollPx(-40);
    expect(timelineUiStore.getSnapshot().scrollPx).toBe(0);
    timelineUiStore.setScrollPx(120.6);
    expect(timelineUiStore.getSnapshot().scrollPx).toBe(121);
  });

  it('resetForShot returns playhead and scroll to zero', () => {
    timelineUiStore.seek(800, 3000);
    timelineUiStore.setScrollPx(50);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBeGreaterThan(0);
    timelineUiStore.resetForShot();
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(0);
    expect(timelineUiStore.getSnapshot().scrollPx).toBe(0);
  });
});

describe('timelineUiStore shot-switch reset (real project wiring)', () => {
  it('resets playhead to 0 ms when the current shot changes', () => {
    const project = buildProject();
    const shotA = project.shots[0]!;
    const shotB = structuredClone(shotA);
    shotB.id = 'b0000000-0000-4000-8000-0000000000b2';
    shotB.name = 'Second Shot';
    shotB.durationMs = 2000;
    const layerIds = [
      'b0000000-0000-4000-8000-0000000000b1',
      'b0000000-0000-4000-8000-0000000000b2',
      'b0000000-0000-4000-8000-0000000000b3',
    ];
    shotB.layers = shotB.layers.map((layer, index) => ({
      ...layer,
      id: layerIds[index]!,
    }));
    shotB.backgroundLayerId = layerIds[0]!;
    project.shots = [shotA, shotB];
    editorProjectStore.open('D:/unit-test-root', project);

    shotStore.select(shotA.id);
    timelineUiStore.seek(1000, shotA.durationMs);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1000);

    // Switching to shot B must reset the playhead, not carry over shot A time.
    shotStore.select(shotB.id);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(0);

    // And seeking in B writes only UI state, never the project.
    const snapshotBefore = editorProjectStore.getSnapshot();
    timelineUiStore.seek(400, shotB.durationMs);
    expect(editorProjectStore.getSnapshot()).toBe(snapshotBefore);
    expect(editorProjectStore.getSnapshot()?.dirty).toBe(false);
  });
});
