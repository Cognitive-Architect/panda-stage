import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  LayerService,
  migrateProject,
  ProjectSchema,
  ShotService,
  type Layer,
} from '../../src/domain';
import {
  buildParentChainViewModel,
  DEFAULT_PARENT_CHAIN_MAX_COLUMNS,
} from '../../src/renderer/features/properties/parentChainModel';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerListUiStore } from '../../src/renderer/stores/layerListUiStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';

function createChainFixture() {
  const base = migrateProject(demo);
  const asset = base.assets.find(({ kind }) => kind === 'image')!;
  const makeLayer = (name: string, zIndex: number, overrides: Partial<Layer> = {}): Layer => ({
    id: randomUUID(),
    source: { kind: 'asset', assetId: asset.id },
    anchor: 'center',
    x: 500,
    y: 400,
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

  const bg = makeLayer('背景', 0, { locked: true });
  const actorA = makeLayer('角色A', 1);
  const actorB = makeLayer('角色B', 2, { visible: false });
  const control = makeLayer('控制层', 3, { source: { kind: 'control' } });
  const prop = makeLayer('道具', 4);
  const lockedProp = makeLayer('锁定道具', 5, { locked: true });

  const shot = {
    ...base.shots[0]!,
    layers: [bg, actorA, actorB, control, prop, lockedProp],
    backgroundLayerId: bg.id,
    dialogues: [],
    audioClips: [],
    timelineEvents: [],
  };
  let project = ProjectSchema.parse({ ...base, shots: [shot] });
  const service = new LayerService();
  // A -> Control -> Prop at base, then Prop hands off dynamically to B at t=500ms
  project = service.setParent(project, shot.id, control.id, actorA.id, 0);
  project = service.setParent(project, shot.id, prop.id, control.id, 0);
  project = service.setParentKey(project, shot.id, prop.id, 500, actorB.id);
  return { project, shotId: shot.id, bg, actorA, actorB, control, prop, lockedProp };
}

describe('EXT-02 toggleable current-time parent-chain view', () => {
  it('shows active edges at current playhead (A->Control->Prop and dynamic handoff to B) and highlights selected chain', () => {
    const { project, actorA, actorB, control, prop } = createChainFixture();
    const shot = project.shots[0]!;

    // At t = 200ms: Prop -> Control -> ActorA
    const vmBefore = buildParentChainViewModel(shot, 200, prop.id);
    expect(vmBefore.edges.map((e) => [e.childId, e.parentId, e.isDynamic])).toEqual([
      [prop.id, control.id, false],
      [control.id, actorA.id, false],
    ]);
    const propRowBefore = vmBefore.rows.find((r) => r.layer.id === prop.id)!;
    const controlRowBefore = vmBefore.rows.find((r) => r.layer.id === control.id)!;
    const actorARowBefore = vmBefore.rows.find((r) => r.layer.id === actorA.id)!;
    const actorBRowBefore = vmBefore.rows.find((r) => r.layer.id === actorB.id)!;
    expect(propRowBefore.inSelectedChain).toBe(true);
    expect(controlRowBefore.inSelectedChain).toBe(true);
    expect(actorARowBefore.inSelectedChain).toBe(true);
    expect(actorBRowBefore.inSelectedChain).toBe(false);
    expect(propRowBefore.ancestorDepth).toBe(2);
    expect(controlRowBefore.isControl).toBe(true);
    expect(actorBRowBefore.isHidden).toBe(true);

    // At t = 600ms: Prop dynamically handed off to ActorB
    const vmAfter = buildParentChainViewModel(shot, 600, prop.id);
    expect(vmAfter.edges.map((e) => [e.childId, e.parentId, e.isDynamic])).toEqual([
      [prop.id, actorB.id, true],
      [control.id, actorA.id, false],
    ]);
    expect(vmAfter.rows.find((r) => r.layer.id === actorB.id)!.inSelectedChain).toBe(true);
    expect(vmAfter.rows.find((r) => r.layer.id === actorA.id)!.inSelectedChain).toBe(false);
    expect(vmAfter.rows.find((r) => r.layer.id === prop.id)!.tooltip).toContain('动态交接');
    expect(vmAfter.rows.find((r) => r.layer.id === prop.id)!.tooltip).toContain(actorB.name);
  });

  it('compresses long chains, flags missing targets, and preserves row alignment without mutating zIndex', () => {
    const base = migrateProject(demo);
    const asset = base.assets.find(({ kind }) => kind === 'image')!;
    const layers: Layer[] = [];
    for (let i = 0; i < 6; i++) {
      layers.push({
        id: `layer-${i}`,
        source: { kind: 'asset', assetId: asset.id },
        anchor: 'center',
        x: 500,
        y: 400,
        zIndex: i,
        name: `L${i}`,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        opacity: 1,
        locked: false,
        visible: true,
        flipX: false,
        ...(i > 0 ? { parentLayerId: `layer-${i - 1}` } : {}),
      });
    }
    // Add one layer pointing to a missing parent ID
    layers.push({
      id: 'orphan',
      source: { kind: 'asset', assetId: asset.id },
      anchor: 'center',
      x: 500,
      y: 400,
      zIndex: 6,
      name: '丢失父级',
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      locked: false,
      visible: true,
      flipX: false,
      parentLayerId: 'non-existent-id',
    });

    const shot = { ...base.shots[0]!, layers, backgroundLayerId: null };
    const originalZ = layers.map((l) => [l.id, l.zIndex]);

    const vm = buildParentChainViewModel(shot, 0, 'layer-5', { maxColumns: DEFAULT_PARENT_CHAIN_MAX_COLUMNS });
    // Deepest layer (depth 5) is compressed to maxColumns - 1
    const deepRow = vm.rows.find((r) => r.layer.id === 'layer-5')!;
    expect(deepRow.ancestorDepth).toBe(5);
    expect(deepRow.columnIndex).toBe(DEFAULT_PARENT_CHAIN_MAX_COLUMNS - 1);
    expect(deepRow.compressed).toBe(true);
    expect(vm.columnCount).toBe(DEFAULT_PARENT_CHAIN_MAX_COLUMNS);

    // Missing parent is flagged without throwing or creating broken edges
    const orphanRow = vm.rows.find((r) => r.layer.id === 'orphan')!;
    expect(orphanRow.parentMissing).toBe(true);
    expect(orphanRow.tooltip).toContain('父级目标缺失');
    expect(vm.edges.some((e) => e.childId === 'orphan')).toBe(false);

    // Rows ordered by zIndex descending; source layers' zIndex never mutated
    expect(vm.rows[0]!.layer.id).toBe('orphan');
    expect(vm.rows.at(-1)!.layer.id).toBe('layer-0');
    expect(layers.map((l) => [l.id, l.zIndex])).toEqual(originalZ);
  });

  it('stores toggle and batch selection strictly as UI session/preference state without polluting Project or History', () => {
    const { project, shotId, bg, prop, lockedProp, control } = createChainFixture();
    const editorStore = new EditorProjectStore();
    editorStore.open('D:/ext02-ui.pandastage', project);
    const localShotStore = new ShotStore(editorStore, new ShotService());
    localShotStore.select(shotId);

    const backing = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => { backing.set(key, value); },
    };

    const uiStore = new LayerListUiStore({
      editorStore,
      shotSelection: localShotStore,
      storage: memoryStorage,
    });

    const initialRevision = editorStore.getSnapshot()!.revision;
    expect(uiStore.getSnapshot().parentChainVisible).toBe(false);

    uiStore.toggleParentChain();
    expect(uiStore.getSnapshot().parentChainVisible).toBe(true);
    expect(editorStore.getSnapshot()!.revision).toBe(initialRevision);
    expect(editorStore.undo()).toBe(false);

    // Preference persists across store instances
    const restoredUiStore = new LayerListUiStore({
      editorStore,
      shotSelection: localShotStore,
      storage: memoryStorage,
    });
    expect(restoredUiStore.getSnapshot().parentChainVisible).toBe(true);

    // Batch selection ignores background and locked layers, never writes Project/History
    uiStore.toggleBatchLayer(bg.id);
    uiStore.toggleBatchLayer(lockedProp.id);
    uiStore.toggleBatchLayer(prop.id);
    uiStore.toggleBatchLayer(control.id);
    expect(uiStore.getSnapshot().batchSelectedLayerIds).toEqual([prop.id, control.id]);
    expect(editorStore.getSnapshot()!.revision).toBe(initialRevision);

    // Read-only guarantee: parentChainModel & ShotLayerListPanel do NOT import/call shot or Graphic evaluators
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const modelCode = stripComments(
      readFileSync(resolve('src/renderer/features/properties/parentChainModel.ts'), 'utf8'),
    );
    const panelCode = stripComments(
      readFileSync(resolve('src/renderer/features/properties/ShotLayerListPanel.tsx'), 'utf8'),
    );
    expect(modelCode).not.toContain('evaluateShotAtTime');
    expect(modelCode).not.toContain('evaluateFlaGraphic');
    expect(modelCode).toContain('resolveLayerParentBindingAtTime');
    expect(panelCode).not.toContain('evaluateShotAtTime');
    expect(panelCode).not.toContain('evaluateFlaGraphic');

    restoredUiStore.dispose();
    uiStore.dispose();
    localShotStore.dispose();
  });
});
