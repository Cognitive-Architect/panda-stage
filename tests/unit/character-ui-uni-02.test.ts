// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  migrateProject,
  removeAdaptivePartFromDefinition,
  scanAdaptivePartReferences,
  type AdaptivePartsCharacter,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { CharacterMotionService } from '../../src/domain/services/CharacterMotionService';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { layerStore } from '../../src/renderer/stores/layerStore';

const characterService = new CharacterService();
const motionService = new CharacterMotionService();

const PART_IDS = [
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000005',
] as const;

function buildFivePartAdaptiveProject(): {
  project: Project;
  character: AdaptivePartsCharacter;
  imageAssets: ImageAsset[];
} {
  const base = migrateProject(exampleProject);
  const imageAssets = base.assets.filter(
    (asset): asset is ImageAsset => asset.kind === 'image',
  );
  const assetA = imageAssets[0]!;
  const assetB = imageAssets[1] ?? assetA;
  const project = characterService.createAdaptiveParts(base, {
    name: 'Five Part Panda',
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: PART_IDS.map((partId, index) => {
      const asset = index % 2 === 0 ? assetA : assetB;
      return {
        partId,
        assetId: asset.id,
        displayName: `零件 ${index + 1}`,
        drawOrder: index,
        visible: true,
        source: { kind: 'manual' as const, sourceId: `manual-${index + 1}` },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 10, ty: 0 },
        imageMapping: {
          sourceWidth: asset.width,
          sourceHeight: asset.height,
          crop: { x: 0, y: 0, width: asset.width, height: asset.height },
          exportScale: 1,
        },
      };
    }),
  });
  const character = project.characters.find(
    (candidate): candidate is AdaptivePartsCharacter =>
      candidate.mode === 'adaptive-parts',
  )!;
  return { project, character, imageAssets };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (window as unknown as Record<string, unknown>).pandaStage = {
    assets: {
      readThumbnail: vi.fn().mockResolvedValue({
        ok: true,
        status: 'missing',
        reason: 'missing',
      }),
      readImageDataUrl: vi.fn().mockResolvedValue({
        ok: false,
      }),
    },
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
  editorProjectStore.clear();
  vi.restoreAllMocks();
});

describe('Issue #1175 UI-02 – Adaptive Part row overflow menu and safe removal', () => {
  it('renders unified Part row (thumbnail + name + visibility + overflow menu) and removes an unreferenced Part without confirmation', () => {
    const { project, character, imageAssets } = buildFivePartAdaptiveProject();
    editorProjectStore.open('F:/tmp/project', project);
    const began = characterAssemblySessionStore.beginAdaptiveParts(character.id);
    expect(began.ok).toBe(true);
    if (!began.ok) return;

    const confirmSpy = vi.fn<(message?: string) => boolean>(() => true);
    window.confirm = confirmSpy;

    const renderWorkbench = () => {
      const snap = characterAssemblySessionStore.getSnapshot();
      if (!snap) return;
      act(() => {
        root.render(
          createElement(CharacterAssemblyWorkbench, {
            projectSnapshot: editorProjectStore.getSnapshot()!,
            session: snap,
          }),
        );
      });
    };
    renderWorkbench();

    const rows = container.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]');
    expect(rows).toHaveLength(5);

    // Every row has visibility toggle + overflow trigger (popover="auto") with 4 actions
    const firstRow = rows[0]!;
    expect(firstRow.querySelector('[data-testid="adaptive-parts-visibility-toggle"]')).not.toBeNull();
    expect(firstRow.querySelector('[data-testid="adaptive-parts-row-overflow-trigger"]')).not.toBeNull();
    const menu = firstRow.querySelector('[data-testid="adaptive-parts-row-overflow-menu"]');
    expect(menu?.getAttribute('popover')).toBe('auto');
    expect(menu?.querySelector('[data-testid="adaptive-parts-rename-button"]')).not.toBeNull();
    expect(menu?.querySelector('[data-testid="adaptive-parts-replace-button"]')).not.toBeNull();
    expect(menu?.querySelector('[data-testid="adaptive-parts-restore-button"]')).not.toBeNull();
    expect(menu?.querySelector('[data-testid="adaptive-parts-remove-button"]')).not.toBeNull();

    // Remove the top-most Part (PART_IDS[4], drawOrder 4) — unreferenced so NO confirm dialog
    const removeButton = firstRow.querySelector<HTMLButtonElement>(
      '[data-testid="adaptive-parts-remove-button"]',
    )!;
    expect(removeButton.disabled).toBe(false);
    act(() => {
      removeButton.click();
    });
    expect(confirmSpy).not.toHaveBeenCalled();

    renderWorkbench();
    const updatedRows = container.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]');
    expect(updatedRows).toHaveLength(4);

    // Apply draft
    const applyButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="adaptive-parts-assembly-apply"]',
    )!;
    expect(applyButton.disabled).toBe(false);
    act(() => {
      applyButton.click();
    });

    const committed = editorProjectStore
      .getSnapshot()!
      .project.characters.find((c): c is AdaptivePartsCharacter => c.id === character.id)!;
    expect(committed.parts.map((p) => p.partId)).toEqual(PART_IDS.slice(0, 4));
    expect(committed.parts.map((p) => p.drawOrder)).toEqual([0, 1, 2, 3]);
    // Source image assets must NOT be deleted
    expect(
      editorProjectStore.getSnapshot()!.project.assets.filter((a) => a.kind === 'image'),
    ).toHaveLength(imageAssets.length);
  });

  it('prevents removing the last remaining Part', () => {
    const { project, character } = buildFivePartAdaptiveProject();
    let definition = characterService.getAdaptivePartsDefinition(project, character.id);
    for (const partId of PART_IDS.slice(1)) {
      definition = removeAdaptivePartFromDefinition(definition, partId);
    }
    expect(definition.parts).toHaveLength(1);
    expect(() => removeAdaptivePartFromDefinition(definition, PART_IDS[0])).toThrow(
      '角色至少需要保留一个零件',
    );

    const onePartProject = characterService.applyAdaptivePartsDefinition(
      project,
      character.id,
      definition,
    );
    editorProjectStore.open('F:/tmp/project', onePartProject);
    const began = characterAssemblySessionStore.beginAdaptiveParts(character.id);
    expect(began.ok).toBe(true);
    if (!began.ok) return;

    act(() => {
      root.render(
        createElement(CharacterAssemblyWorkbench, {
          projectSnapshot: editorProjectStore.getSnapshot()!,
          session: began.snapshot,
        }),
      );
    });

    const removeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="adaptive-parts-remove-button"]',
    )!;
    expect(removeButton.disabled).toBe(true);
  });

  it('replaces a Part with another project ImageAsset via the overflow menu while keeping partId stable', () => {
    const { project, character, imageAssets } = buildFivePartAdaptiveProject();
    const alternateAsset = imageAssets[1] ?? imageAssets[0]!;
    editorProjectStore.open('F:/tmp/project', project);
    const began = characterAssemblySessionStore.beginAdaptiveParts(character.id);
    expect(began.ok).toBe(true);
    if (!began.ok) return;

    const renderWorkbench = () => {
      const snap = characterAssemblySessionStore.getSnapshot();
      if (!snap) return;
      act(() => {
        root.render(
          createElement(CharacterAssemblyWorkbench, {
            projectSnapshot: editorProjectStore.getSnapshot()!,
            session: snap,
          }),
        );
      });
    };
    renderWorkbench();

    // Click "替换素材" on the row for PART_IDS[0] (which starts with imageAssets[0])
    const targetRow = container.querySelector(
      `[data-testid="adaptive-parts-assembly-row"][data-part-id="${PART_IDS[0]}"]`,
    )!;
    act(() => {
      targetRow
        .querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-replace-button"]')
        ?.click();
    });
    renderWorkbench();

    const imageSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="adaptive-parts-image-replace-select"]',
    );
    expect(imageSelect).not.toBeNull();
    act(() => {
      imageSelect!.value = alternateAsset.id;
      imageSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    renderWorkbench();

    const snapAfter = characterAssemblySessionStore.getSnapshot();
    expect(snapAfter?.kind).toBe('adaptive-parts');
    if (snapAfter?.kind === 'adaptive-parts') {
      const replaced = snapAfter.draft.parts.find((p) => p.partId === PART_IDS[0]);
      expect(replaced?.assetId).toBe(alternateAsset.id);
    }
  });

  it('prompts with impact scope, prunes removed Part from Character Clip v1 without wiping other Parts, and restores cleanly on Undo/Redo', () => {
    const { project, character } = buildFivePartAdaptiveProject();
    editorProjectStore.open('F:/tmp/project', project);
    const shotId = project.shots[0]!.id;
    shotStore.select(shotId);

    // Place adaptive character into Shot and author keyframes on PART_IDS[1] (to remove) and PART_IDS[0] (to keep)
    const layer = layerStore.createAdaptiveCharacter(character.id, { x: 0, y: 0 });
    const withLayerProject = editorProjectStore.getSnapshot()!.project;
    const authoredKeep = motionService.apply(
      withLayerProject,
      { shotId, layerId: layer.id, partId: PART_IDS[0], timeMs: 500, autoKey: true },
      { 'transform.offsetX': 40, 'transform.offsetY': -10 },
    );
    const authoredBoth = motionService.apply(
      authoredKeep,
      { shotId, layerId: layer.id, partId: PART_IDS[1], timeMs: 1000, autoKey: true },
      { 'transform.offsetX': 80, 'transform.offsetY': 20 },
    );
    editorProjectStore.updateProject(authoredBoth, 'Author part motion');

    // Reference summary accurately detects shot + keyframes on PART_IDS[1]
    const refs = scanAdaptivePartReferences(
      editorProjectStore.getSnapshot()!.project,
      character.id,
      PART_IDS[1],
    );
    expect(refs.shotCount).toBe(1);
    expect(refs.layerCount).toBe(1);
    expect(refs.animatedLayerCount).toBe(1);
    expect(refs.keyframeCount).toBeGreaterThan(0);

    // Open assembly, remove PART_IDS[1], confirm impact prompt, and Apply
    const began = characterAssemblySessionStore.beginAdaptiveParts(character.id);
    expect(began.ok).toBe(true);
    if (!began.ok) return;

    const confirmSpy = vi.fn<(message?: string) => boolean>(() => true);
    window.confirm = confirmSpy;

    const renderWorkbench = () => {
      const snap = characterAssemblySessionStore.getSnapshot();
      if (!snap) return;
      act(() => {
        root.render(
          createElement(CharacterAssemblyWorkbench, {
            projectSnapshot: editorProjectStore.getSnapshot()!,
            session: snap,
          }),
        );
      });
    };
    renderWorkbench();

    const targetRow = container.querySelector(
      `[data-testid="adaptive-parts-assembly-row"][data-part-id="${PART_IDS[1]}"]`,
    )!;
    act(() => {
      targetRow
        .querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-remove-button"]')
        ?.click();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]?.[0]).toContain('1 个镜头');
    expect(confirmSpy.mock.calls[0]?.[0]).toContain('关键帧');

    renderWorkbench();
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-assembly-apply"]')
        ?.click();
    });

    // Verify bounded clip pruning: PART_IDS[1] removed, PART_IDS[0] keys untouched!
    const afterApply = editorProjectStore.getSnapshot()!.project;
    const updatedChar = afterApply.characters.find(
      (c): c is AdaptivePartsCharacter => c.id === character.id,
    )!;
    expect(updatedChar.parts.map((p) => p.partId)).toEqual([
      PART_IDS[0],
      PART_IDS[2],
      PART_IDS[3],
      PART_IDS[4],
    ]);
    expect(updatedChar.parts.map((p) => p.drawOrder)).toEqual([0, 1, 2, 3]);

    const updatedLayer = afterApply.shots[0]!.layers.find((l) => l.id === layer.id)!;
    expect(updatedLayer.animationClip?.version).toBe(1);
    if (updatedLayer.animationClip?.version === 1) {
      expect(
        updatedLayer.animationClip.targetBases.some((b) => b.target.partId === PART_IDS[1]),
      ).toBe(false);
      expect(
        updatedLayer.animationClip.tracks.some((t) => t.target.partId === PART_IDS[1]),
      ).toBe(false);
      // Kept part's targetBasis and keyframes remain intact!
      expect(
        updatedLayer.animationClip.targetBases.some((b) => b.target.partId === PART_IDS[0]),
      ).toBe(true);
      expect(
        updatedLayer.animationClip.tracks.some(
          (t) => t.target.partId === PART_IDS[0] && t.keys.length > 0,
        ),
      ).toBe(true);
    }

    // Undo restores BOTH the removed Part (exact partId + drawOrder) AND its clip basis/tracks
    editorProjectStore.undo();
    const afterUndo = editorProjectStore.getSnapshot()!.project;
    const restoredChar = afterUndo.characters.find(
      (c): c is AdaptivePartsCharacter => c.id === character.id,
    )!;
    expect(restoredChar.parts.map((p) => p.partId)).toEqual([...PART_IDS]);
    expect(restoredChar.parts.map((p) => p.drawOrder)).toEqual([0, 1, 2, 3, 4]);
    const restoredLayer = afterUndo.shots[0]!.layers.find((l) => l.id === layer.id)!;
    if (restoredLayer.animationClip?.version === 1) {
      expect(
        restoredLayer.animationClip.targetBases.some((b) => b.target.partId === PART_IDS[1]),
      ).toBe(true);
      expect(
        restoredLayer.animationClip.tracks.some(
          (t) => t.target.partId === PART_IDS[1] && t.keys.length > 0,
        ),
      ).toBe(true);
    }

    // Redo re-applies the removal cleanly
    editorProjectStore.redo();
    const afterRedo = editorProjectStore.getSnapshot()!.project;
    const redoneChar = afterRedo.characters.find(
      (c): c is AdaptivePartsCharacter => c.id === character.id,
    )!;
    expect(redoneChar.parts.map((p) => p.partId)).toEqual([
      PART_IDS[0],
      PART_IDS[2],
      PART_IDS[3],
      PART_IDS[4],
    ]);
  });

  it('preserves each existing Shot Clip v1 frozen relative drawOrder when removing an unrelated Part (#1177)', () => {
    const base = migrateProject(exampleProject);
    const imageAssets = base.assets.filter(
      (asset): asset is ImageAsset => asset.kind === 'image',
    );
    const assetA = imageAssets[0]!;
    const assetB = imageAssets[1] ?? assetA;
    const partA = PART_IDS[0];
    const partC = PART_IDS[1];
    const partB = PART_IDS[2];

    const makePart = (
      partId: string,
      displayName: string,
      drawOrder: number,
      asset: ImageAsset,
      tx: number,
    ) => ({
      partId,
      assetId: asset.id,
      displayName,
      drawOrder,
      visible: true,
      source: { kind: 'manual' as const, sourceId: `manual-${displayName}` },
      restTransform: { a: 1, b: 0, c: 0, d: 1, tx, ty: 0 },
      imageMapping: {
        sourceWidth: asset.width,
        sourceHeight: asset.height,
        crop: { x: 0, y: 0, width: asset.width, height: asset.height },
        exportScale: 1,
      },
    });

    // Initial Library order: A(0), C(1), B(2)
    const createdProject = characterService.createAdaptiveParts(base, {
      name: 'Frozen Order Panda',
      sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      parts: [
        makePart(partA, 'A', 0, assetA, 0),
        makePart(partC, 'C', 1, assetB, 10),
        makePart(partB, 'B', 2, assetA, 20),
      ],
    });
    const character = createdProject.characters.find(
      (candidate): candidate is AdaptivePartsCharacter =>
        candidate.mode === 'adaptive-parts',
    )!;

    editorProjectStore.open('F:/tmp/project', createdProject);
    const shotId = createdProject.shots[0]!.id;
    shotStore.select(shotId);

    // Place character in Shot and author keys on A, C, and B -> freezes Clip v1 order as A(0), C(1), B(2)
    const layer = layerStore.createAdaptiveCharacter(character.id, { x: 0, y: 0 });
    let nextProject = editorProjectStore.getSnapshot()!.project;
    nextProject = motionService.apply(
      nextProject,
      { shotId, layerId: layer.id, partId: partA, timeMs: 500, autoKey: true },
      { 'transform.offsetX': 15 },
    );
    nextProject = motionService.apply(
      nextProject,
      { shotId, layerId: layer.id, partId: partC, timeMs: 1000, autoKey: true },
      { 'transform.offsetX': 30 },
    );
    nextProject = motionService.apply(
      nextProject,
      { shotId, layerId: layer.id, partId: partB, timeMs: 1500, autoKey: true },
      { 'transform.offsetY': -25 },
    );
    editorProjectStore.updateProject(nextProject, 'Author A/B/C motion');

    // Update Library Definition order to differ from the frozen Shot Clip: B(0), A(1), C(2)
    const currentDef = characterService.getAdaptivePartsDefinition(
      editorProjectStore.getSnapshot()!.project,
      character.id,
    );
    const reorderedLib = characterService.applyAdaptivePartsDefinition(
      editorProjectStore.getSnapshot()!.project,
      character.id,
      {
        sourceRootTransform: currentDef.sourceRootTransform,
        parts: [
          { ...currentDef.parts.find((p) => p.partId === partB)!, drawOrder: 0 },
          { ...currentDef.parts.find((p) => p.partId === partA)!, drawOrder: 1 },
          { ...currentDef.parts.find((p) => p.partId === partC)!, drawOrder: 2 },
        ],
      },
    );
    editorProjectStore.updateProject(reorderedLib, 'Reorder library parts');

    const beforeRemovalLayer = editorProjectStore
      .getSnapshot()!
      .project.shots[0]!.layers.find((entry) => entry.id === layer.id)!;
    expect(beforeRemovalLayer.animationClip?.version).toBe(1);
    const beforeClip =
      beforeRemovalLayer.animationClip?.version === 1
        ? beforeRemovalLayer.animationClip
        : null;
    expect(beforeClip).not.toBeNull();
    const beforeBasisA = beforeClip!.targetBases.find((b) => b.target.partId === partA)!;
    const beforeBasisB = beforeClip!.targetBases.find((b) => b.target.partId === partB)!;
    expect(beforeClip!.targetBases.map((b) => [b.target.partId, b.drawOrder])).toEqual([
      [partA, 0],
      [partC, 1],
      [partB, 2],
    ]);

    // Remove C via assembly session and Apply
    const defBeforeRemove = characterService.getAdaptivePartsDefinition(
      editorProjectStore.getSnapshot()!.project,
      character.id,
    );
    const defWithoutC = removeAdaptivePartFromDefinition(defBeforeRemove, partC);
    const afterRemoveProject = characterService.applyAdaptivePartsDefinition(
      editorProjectStore.getSnapshot()!.project,
      character.id,
      defWithoutC,
    );
    editorProjectStore.updateProject(afterRemoveProject, 'Apply Adaptive Parts definition');

    // Library Definition keeps its own contiguous order: B(0), A(1)
    const updatedChar = editorProjectStore
      .getSnapshot()!
      .project.characters.find(
        (candidate): candidate is AdaptivePartsCharacter => candidate.id === character.id,
      )!;
    expect(updatedChar.parts.map((p) => [p.partId, p.drawOrder])).toEqual([
      [partB, 0],
      [partA, 1],
    ]);

    // Existing Shot Clip v1 removes C and compacts its OWN frozen relative order: A(0), B(1)
    const updatedLayer = editorProjectStore
      .getSnapshot()!
      .project.shots[0]!.layers.find((entry) => entry.id === layer.id)!;
    expect(updatedLayer.animationClip?.version).toBe(1);
    if (updatedLayer.animationClip?.version === 1) {
      expect(
        updatedLayer.animationClip.targetBases.map((b) => [b.target.partId, b.drawOrder]),
      ).toEqual([
        [partA, 0],
        [partB, 1],
      ]);
      expect(updatedLayer.animationClip.fixedCharacterCenter).toEqual(
        beforeClip!.fixedCharacterCenter,
      );
      expect(
        updatedLayer.animationClip.tracks.some((t) => t.target.partId === partC),
      ).toBe(false);
      expect(
        updatedLayer.animationClip.tracks.some(
          (t) => t.target.partId === partA && t.keys.length > 0,
        ),
      ).toBe(true);
      expect(
        updatedLayer.animationClip.tracks.some(
          (t) => t.target.partId === partB && t.keys.length > 0,
        ),
      ).toBe(true);
      const afterBasisA = updatedLayer.animationClip.targetBases.find(
        (b) => b.target.partId === partA,
      )!;
      const afterBasisB = updatedLayer.animationClip.targetBases.find(
        (b) => b.target.partId === partB,
      )!;
      expect(afterBasisA.visualSource).toEqual(beforeBasisA.visualSource);
      expect(afterBasisA.baseTransform).toEqual(beforeBasisA.baseTransform);
      expect(afterBasisA.pivot).toEqual(beforeBasisA.pivot);
      expect(afterBasisB.visualSource).toEqual(beforeBasisB.visualSource);
      expect(afterBasisB.baseTransform).toEqual(beforeBasisB.baseTransform);
      expect(afterBasisB.pivot).toEqual(beforeBasisB.pivot);
    }

    // Undo restores C and the original frozen drawOrder A(0), C(1), B(2) + C's track
    editorProjectStore.undo();
    const afterUndoLayer = editorProjectStore
      .getSnapshot()!
      .project.shots[0]!.layers.find((entry) => entry.id === layer.id)!;
    if (afterUndoLayer.animationClip?.version === 1) {
      expect(
        afterUndoLayer.animationClip.targetBases.map((b) => [b.target.partId, b.drawOrder]),
      ).toEqual([
        [partA, 0],
        [partC, 1],
        [partB, 2],
      ]);
      expect(
        afterUndoLayer.animationClip.tracks.some(
          (t) => t.target.partId === partC && t.keys.length > 0,
        ),
      ).toBe(true);
    }

    // Redo re-applies removal cleanly while preserving frozen A(0), B(1)
    editorProjectStore.redo();
    const afterRedoLayer = editorProjectStore
      .getSnapshot()!
      .project.shots[0]!.layers.find((entry) => entry.id === layer.id)!;
    if (afterRedoLayer.animationClip?.version === 1) {
      expect(
        afterRedoLayer.animationClip.targetBases.map((b) => [b.target.partId, b.drawOrder]),
      ).toEqual([
        [partA, 0],
        [partB, 1],
      ]);
      expect(
        afterRedoLayer.animationClip.tracks.some((t) => t.target.partId === partC),
      ).toBe(false);
    }
  });
});
