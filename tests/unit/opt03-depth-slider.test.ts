import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  applyScopedLayerDepthEdit,
  depthToParallaxSlider,
  evaluateShotAtTime,
  LAYER_DEPTH_MAX,
  LAYER_DEPTH_MIN,
  LayerService,
  migrateProject,
  NATIVE_CAMERA_FOCAL_LENGTH,
  PARALLAX_SLIDER_ZERO_POSITION,
  parallaxSliderToDepth,
  ProjectSchema,
  resolveLayerDepthSource,
  setLayerDepth,
  setLayerDepthKey,
  setLayerParentKeyDepth,
  ShotService,
  type Layer,
} from '../../src/domain';
import { DepthPreviewStore } from '../../src/renderer/stores/depthPreviewStore';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';

function createDepthFixture() {
  const base = migrateProject(demo);
  const asset = base.assets.find(({ kind }) => kind === 'image')!;
  const makeLayer = (name: string, zIndex: number, overrides: Partial<Layer> = {}): Layer => ({
    id: randomUUID(),
    source: { kind: 'asset', assetId: asset.id },
    anchor: 'center',
    x: 640,
    y: 420,
    zIndex,
    name,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    locked: false,
    visible: true,
    flipX: false,
    ...overrides,
  });
  const bg = makeLayer('背景', 0, { depth: 400, locked: true });
  const parent = makeLayer('远景父层', 1, { depth: 200 });
  const child = makeLayer('继承子层', 2);
  const other = makeLayer('另一父层', 3, { depth: -150 });
  const shot = {
    ...base.shots[0]!,
    layers: [bg, parent, child, other],
    backgroundLayerId: bg.id,
    dialogues: [],
    audioClips: [],
    timelineEvents: [],
  };
  const project = ProjectSchema.parse({ ...base, shots: [shot] });
  const bound = new LayerService().setParent(project, shot.id, child.id, parent.id, 0);
  return { project: bound, shotId: shot.id, bg, parent, child, other };
}

describe('OPT-03 parallax-mapped depth slider', () => {
  it('maps depth <-> slider by reference rest parallax using Panda focal length & depth bounds', () => {
    const F = NATIVE_CAMERA_FOCAL_LENGTH;
    const pN = F / (F + LAYER_DEPTH_MIN);
    const pF = F / (F + LAYER_DEPTH_MAX);
    expect(pN).toBeCloseTo(2, 10);
    expect(pF).toBeCloseTo(1000 / 11000, 10);

    // Endpoints and zero tick
    expect(depthToParallaxSlider(LAYER_DEPTH_MIN)).toBe(0);
    expect(depthToParallaxSlider(LAYER_DEPTH_MAX)).toBe(1);
    expect(PARALLAX_SLIDER_ZERO_POSITION).toBeCloseTo(11 / 21, 6);
    expect(PARALLAX_SLIDER_ZERO_POSITION * 100).toBeCloseTo(52.38, 2);

    // Reference checkpoints from spec: -250 -> ~34.92%, +1000 -> ~78.57%
    expect(depthToParallaxSlider(-250) * 100).toBeCloseTo(34.92, 2);
    expect(depthToParallaxSlider(1000) * 100).toBeCloseTo(78.57, 2);

    // Roundtrip across full range
    for (const d of [-500, -400, -250, -50, 0, 120, 500, 1000, 3500, 10000]) {
      const u = depthToParallaxSlider(d);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(parallaxSliderToDepth(u)).toBeCloseTo(d, 6);
    }

    // Clamping and non-finite guards
    expect(depthToParallaxSlider(-9999)).toBe(0);
    expect(depthToParallaxSlider(99999)).toBe(1);
    expect(depthToParallaxSlider(Number.NaN)).toBeCloseTo(PARALLAX_SLIDER_ZERO_POSITION, 8);
    expect(parallaxSliderToDepth(-0.5)).toBe(LAYER_DEPTH_MIN);
    expect(parallaxSliderToDepth(1.5)).toBe(LAYER_DEPTH_MAX);
    expect(parallaxSliderToDepth(Number.NaN)).toBeCloseTo(0, 8);
  });

  it('resolves depth source and scopes edits across static, inherited, depthKeys, and dynamic handoffs', () => {
    const { project, shotId, parent, child, other } = createDepthFixture();
    const service = new LayerService();

    // Inherited static depth from parent
    const shot0 = project.shots[0]!;
    const child0 = shot0.layers.find((l) => l.id === child.id)!;
    expect(resolveLayerDepthSource(shot0, child0, 0)).toMatchObject({
      kind: 'inherited-static',
      parentLayerId: parent.id,
      parentLayerName: parent.name,
    });
    expect(evaluateShotAtTime(shot0, 0, project).layers.find((l) => l.id === child.id)?.effectiveDepth).toBe(200);

    // Explicit detach to independent static depth, then restore to inherit via undefined
    const independent = applyScopedLayerDepthEdit(project, shotId, child.id, 0, 320);
    expect(independent.shots[0]!.layers.find((l) => l.id === child.id)?.depth).toBe(320);
    expect(resolveLayerDepthSource(independent.shots[0]!, independent.shots[0]!.layers.find((l) => l.id === child.id)!, 0).kind).toBe('own-static');
    const restoredInherit = setLayerDepth(independent, shotId, child.id, undefined);
    expect(restoredInherit.shots[0]!.layers.find((l) => l.id === child.id)?.depth).toBeUndefined();

    // Depth keys: edits current frame without altering other keyframes
    const keyed = setLayerDepthKey(setLayerDepthKey(project, shotId, other.id, 0, -100), shotId, other.id, 1000, 600);
    expect(resolveLayerDepthSource(keyed.shots[0]!, keyed.shots[0]!.layers.find((l) => l.id === other.id)!, 500).kind).toBe('depth-keys');
    const editedMidKey = applyScopedLayerDepthEdit(keyed, shotId, other.id, 500, 250);
    const otherKeys = editedMidKey.shots[0]!.layers.find((l) => l.id === other.id)!.depthKeys!;
    expect(otherKeys.map((k) => [k.timeMs, k.value])).toEqual([[0, -100], [500, 250], [1000, 600]]);

    // Dynamic handoff: editing at t=600 modifies ONLY that handoff key, never silently altering base depth
    const dynamic = service.setParentKey(project, shotId, child.id, 500, other.id, { depthMode: 'inherit' });
    const dynShot = dynamic.shots[0]!;
    const dynChild = dynShot.layers.find((l) => l.id === child.id)!;
    expect(resolveLayerDepthSource(dynShot, dynChild, 600)).toMatchObject({
      kind: 'dynamic-inherit',
      parentLayerId: other.id,
      keyTimeMs: 500,
    });
    const scopedDynEdit = applyScopedLayerDepthEdit(dynamic, shotId, child.id, 600, 450);
    const updatedDynChild = scopedDynEdit.shots[0]!.layers.find((l) => l.id === child.id)!;
    expect(updatedDynChild.depth).toBeUndefined(); // static base untouched
    expect(updatedDynChild.parentKeys?.[0]).toMatchObject({ timeMs: 500, depthMode: 'preserve', depth: 450 });
    expect(resolveLayerDepthSource(scopedDynEdit.shots[0]!, updatedDynChild, 600).kind).toBe('dynamic-preserve');
    expect(evaluateShotAtTime(scopedDynEdit.shots[0]!, 0, scopedDynEdit).layers.find((l) => l.id === child.id)?.effectiveDepth).toBe(200);
    expect(evaluateShotAtTime(scopedDynEdit.shots[0]!, 600, scopedDynEdit).layers.find((l) => l.id === child.id)?.effectiveDepth).toBe(450);

    // Reverting dynamic segment back to inherit
    const revertedDyn = setLayerParentKeyDepth(scopedDynEdit, shotId, child.id, 500, undefined);
    expect(revertedDyn.shots[0]!.layers.find((l) => l.id === child.id)!.parentKeys?.[0]).toMatchObject({
      timeMs: 500,
      depthMode: 'inherit',
      depth: undefined,
    });
  });

  it('previews live without mutating History, commits once on release, and guards cancel/stale/lock', () => {
    const { project, shotId, parent, child, other } = createDepthFixture();
    const editorStore = new EditorProjectStore();
    editorStore.open('D:/opt03-depth.pandastage', project);
    const localShotStore = new ShotStore(editorStore, new ShotService());
    localShotStore.select(shotId);
    const localSelection = new LayerSelectionStore(editorStore, localShotStore);
    localSelection.select(parent.id);

    let currentTimeMs = 0;
    const timelineListeners = new Set<() => void>();
    const fakeTimeline = {
      getSnapshot: () => ({ currentTimeMs }),
      subscribe: (listener: () => void) => {
        timelineListeners.add(listener);
        return () => timelineListeners.delete(listener);
      },
      seek: (nextMs: number) => {
        currentTimeMs = nextMs;
        for (const l of timelineListeners) l();
      },
    };

    const previewStore = new DepthPreviewStore({
      editorStore,
      shotSelection: localShotStore,
      layerSelection: localSelection,
      timeline: fakeTimeline,
    });

    const initialRevision = editorStore.getSnapshot()!.revision;
    const handle = previewStore.begin(parent.id, 200);
    expect(handle).not.toBeNull();

    // Multiple live drags produce previewProject (propagating depth to inheriting child) with ZERO project mutations
    expect(handle!.setDepth(500)).toBe(true);
    expect(handle!.setDepth(750)).toBe(true);
    expect(editorStore.getSnapshot()!.revision).toBe(initialRevision);
    expect(editorStore.undo()).toBe(false);
    const livePreview = previewStore.getSnapshot()!;
    expect(livePreview.depth).toBe(750);
    expect(
      evaluateShotAtTime(livePreview.previewProject.shots[0]!, 0, livePreview.previewProject)
        .layers.find((l) => l.id === child.id)?.effectiveDepth,
    ).toBe(750);

    // Single commit on release -> ONE Undo/Redo
    const committed = handle!.finish((final) => {
      editorStore.updateProject(final.previewProject, '设置图层深度');
    });
    expect(committed).toBe(true);
    expect(previewStore.getSnapshot()).toBeNull();
    expect(editorStore.getSnapshot()!.revision).toBe(initialRevision + 1);
    expect(editorStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === parent.id)?.depth).toBe(750);
    expect(editorStore.undo()).toBe(true);
    expect(editorStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === parent.id)?.depth).toBe(200);
    expect(editorStore.redo()).toBe(true);
    expect(editorStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === parent.id)?.depth).toBe(750);

    // Cancel does not write to EditorProjectStore
    const revBeforeCancel = editorStore.getSnapshot()!.revision;
    const cancelHandle = previewStore.begin(parent.id, 750)!;
    expect(cancelHandle.setDepth(-200)).toBe(true);
    cancelHandle.cancel();
    expect(previewStore.getSnapshot()).toBeNull();
    expect(editorStore.getSnapshot()!.revision).toBe(revBeforeCancel);

    // Stale draft: playhead seek invalidates active session
    const staleHandle = previewStore.begin(parent.id, 750)!;
    expect(staleHandle.setDepth(100)).toBe(true);
    fakeTimeline.seek(500);
    expect(previewStore.getSnapshot()).toBeNull();
    expect(staleHandle.finish(() => editorStore.updateProject(project, 'should not run'))).toBe(false);

    // Locked non-background layer cannot start a depth preview
    const lockedProject = new LayerService().setLocked(editorStore.getSnapshot()!.project, shotId, other.id, true);
    editorStore.updateProject(lockedProject, 'Lock other');
    localSelection.select(other.id);
    expect(previewStore.begin(other.id, -150)).toBeNull();

    previewStore.dispose();
    localSelection.dispose();
    localShotStore.dispose();
  });
});
