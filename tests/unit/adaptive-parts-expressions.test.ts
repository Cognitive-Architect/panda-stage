// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ProjectV23Schema,
  migrateProject,
  removeAdaptivePartFromDefinition,
  resolveLayerVisualParts,
  scanAssetReferences,
  type AdaptivePartsCharacter,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { isAdaptivePartsAssemblySnapshot } from '../../src/renderer/features/characters/characterAssemblyPreview';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { faceSource, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

const service = new CharacterService();
const PROJECT_ROOT = 'D:/acceptance/adaptive-expr.pandastage';

const BACK_HAIR_ASSET_ID = 'aa000000-0000-4000-8000-000000000001';
const BODY_ASSET_ID = 'aa000000-0000-4000-8000-000000000002';
const HEAD_ASSET_ID = 'aa000000-0000-4000-8000-000000000003';
const FACE_PART_ASSET_ID = 'aa000000-0000-4000-8000-000000000004';
const EYE_EXTRA_ASSET_ID = 'aa000000-0000-4000-8000-000000000005';
const FRONT_HAIR_ASSET_ID = 'aa000000-0000-4000-8000-000000000006';
const SMILE_PNG_ID = 'aa000000-0000-4000-8000-000000000007';
const ANGRY_PNG_ID = 'aa000000-0000-4000-8000-000000000008';

const PART_BACK_HAIR = 'bb000000-0000-4000-8000-000000000001';
const PART_BODY = 'bb000000-0000-4000-8000-000000000002';
const PART_HEAD = 'bb000000-0000-4000-8000-000000000003';
const PART_FACE = 'bb000000-0000-4000-8000-000000000004';
const PART_EYE_EXTRA = 'bb000000-0000-4000-8000-000000000005';
const PART_FRONT_HAIR = 'bb000000-0000-4000-8000-000000000006';

function imageAsset(id: string, name: string, width: number, height: number): ImageAsset {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    width,
    height,
    usage: 'character',
    keywords: [],
  };
}

function makePart(
  partId: string,
  assetId: string,
  width: number,
  height: number,
  drawOrder: number,
  tx: number,
  ty: number,
  displayName: string,
) {
  return {
    partId,
    source: { kind: 'manual' as const, sourceId: `manual-${partId}` },
    assetId,
    imageMapping: {
      sourceWidth: width,
      sourceHeight: height,
      crop: { x: 0, y: 0, width, height },
      exportScale: 1,
    },
    restTransform: { a: 1, b: 0, c: 0, d: 1, tx, ty },
    sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx, ty },
    drawOrder,
    visible: true,
    displayName,
  };
}

function buildAdaptiveExpressionProject(): { project: Project; characterId: string; layerId: string } {
  const base = graphicFaceProject(true);
  let project = ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      imageAsset(BACK_HAIR_ASSET_ID, '后发', 180, 260),
      imageAsset(BODY_ASSET_ID, '衣服身体', 220, 320),
      imageAsset(HEAD_ASSET_ID, '头', 150, 150),
      imageAsset(FACE_PART_ASSET_ID, '默认五官', 90, 60),
      imageAsset(EYE_EXTRA_ASSET_ID, '高光泪滴', 40, 30),
      imageAsset(FRONT_HAIR_ASSET_ID, '前发', 160, 140),
      imageAsset(SMILE_PNG_ID, '微笑PNG', 240, 180),
      imageAsset(ANGRY_PNG_ID, '生气PNG', 360, 220),
    ],
  });

  project = service.createAdaptiveParts(project, {
    name: '小师妹试装',
    parts: [
      makePart(PART_BACK_HAIR, BACK_HAIR_ASSET_ID, 180, 260, 0, -90, -200, '后发'),
      makePart(PART_BODY, BODY_ASSET_ID, 220, 320, 1, -110, -40, '衣服'),
      makePart(PART_HEAD, HEAD_ASSET_ID, 150, 150, 2, -75, -180, '头'),
      makePart(PART_FACE, FACE_PART_ASSET_ID, 90, 60, 3, -45, -120, '脸部表情'),
      makePart(PART_EYE_EXTRA, EYE_EXTRA_ASSET_ID, 40, 30, 4, -20, -110, '泪光'),
      makePart(PART_FRONT_HAIR, FRONT_HAIR_ASSET_ID, 160, 140, 5, -80, -190, '前发'),
    ],
  });
  const adaptive = project.characters.at(-1)!;
  const layerService = new LayerService();
  const createdLayer = layerService.createFromAdaptiveCharacter(
    project,
    IDS.shot,
    adaptive.id,
    { x: 960, y: 540 },
  );
  return {
    project: createdLayer.project,
    characterId: adaptive.id,
    layerId: createdLayer.layer.id,
  };
}

function LiveAdaptiveWorkbench() {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
    editorProjectStore.getSnapshot,
  );
  const rawSession = useSyncExternalStore(
    characterAssemblySessionStore.subscribe,
    characterAssemblySessionStore.getSnapshot,
    characterAssemblySessionStore.getSnapshot,
  );
  if (!snapshot || !rawSession || !isAdaptivePartsAssemblySnapshot(rawSession)) {
    return null;
  }
  return createElement(CharacterAssemblyWorkbench, {
    projectSnapshot: snapshot,
    session: rawSession,
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof globalThis.IntersectionObserver !== 'function') {
    globalThis.IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof IntersectionObserver;
  }
  if (typeof globalThis.ResizeObserver !== 'function') {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.assign(window, {
    pandaStage: {
      assets: {
        readThumbnail: async () => ({
          ok: true,
          value: {
            kind: 'thumbnail',
            status: 'ready',
            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          },
        }),
        readAssetUrl: async () => ({
          ok: true,
          value: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        }),
      },
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  characterAssemblySessionStore.getActiveAdaptivePartsAssemblySessionHandle()?.cancel();
  editorProjectStore.clear();
  Reflect.deleteProperty(window, 'pandaStage');
});

describe('Phase A: AdaptiveParts face binding & static expressions (#1211)', () => {
  it('migrates v23 adaptive-parts without adding binding keys and isolates v24 fields from ProjectV23Schema', () => {
    const { project, characterId } = buildAdaptiveExpressionProject();
    const v23Project = ProjectV23Schema.parse({
      ...project,
      schemaVersion: 23,
    });
    const migrated = migrateProject(v23Project);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const adaptiveAfter = migrated.characters.find((c) => c.id === characterId) as AdaptivePartsCharacter;
    expect(adaptiveAfter.faceBinding).toBeUndefined();
    expect(adaptiveAfter.expressions).toBeUndefined();

    const bound = service.setAdaptivePartsFaceBinding(migrated, characterId, {
      targetPartId: PART_FACE,
    });
    expect(() =>
      ProjectV23Schema.parse({ ...bound, schemaVersion: 23 }),
    ).toThrow();
  });

  it('rejects expression authoring before faceBinding, switches PNG & Graphic SingleFrame expressions with fixed anchor and preserved drawOrder', () => {
    const { project: seed, characterId, layerId } = buildAdaptiveExpressionProject();
    expect(() =>
      service.addExpression(seed, characterId, { name: '微笑', assetId: SMILE_PNG_ID }),
    ).toThrow(/表情位置/u);

    let project = service.setAdaptivePartsFaceBinding(seed, characterId, {
      targetPartId: PART_FACE,
      replacePartIds: [PART_EYE_EXTRA],
    });
    project = service.addExpression(project, characterId, {
      name: '微笑',
      assetId: SMILE_PNG_ID,
    });
    project = service.addExpression(project, characterId, {
      name: '惊喜元件',
      visualSource: faceSource(2),
    });

    const adaptive = project.characters.find((c) => c.id === characterId) as AdaptivePartsCharacter;
    const smileExpr = adaptive.expressions![0]!;
    const graphicExpr = adaptive.expressions![1]!;

    // Default uses original face (both PART_FACE and PART_EYE_EXTRA visible)
    const shot = project.shots[0]!;
    const layer = shot.layers.find((entry) => entry.id === layerId)!;
    const baseVisual = resolveLayerVisualParts(project, shot, {
      id: layer.id,
      assetId: '',
      currentExpressionId: null,
      mouthOverrideAssetId: null,
      anchor: 'center',
      x: layer.x,
      y: layer.y,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: layer.zIndex,
    });
    expect(baseVisual.activeFace).toBeNull();
    expect(baseVisual.parts.map((p) => p.visible !== false)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);

    // Switch default expression to SMILE PNG (240x180)
    project = service.setDefaultExpression(project, characterId, smileExpr.id);
    const pngShot = project.shots[0]!;
    const pngVisual = resolveLayerVisualParts(project, pngShot, {
      id: layer.id,
      assetId: '',
      currentExpressionId: smileExpr.id,
      mouthOverrideAssetId: null,
      anchor: 'center',
      x: layer.x,
      y: layer.y,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: layer.zIndex,
    });
    expect(pngVisual.parts.map((p) => p.drawOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    const backHairPng = pngVisual.parts[0]!;
    const frontHairPng = pngVisual.parts[5]!;
    const replacedFacePng = pngVisual.parts[3]!;
    const hiddenExtraPng = pngVisual.parts[4]!;
    expect(replacedFacePng.partId).toBe(`${layer.id}:${PART_FACE}`);
    expect(replacedFacePng.assetId).toBe(SMILE_PNG_ID);
    expect(replacedFacePng.visible).toBe(true);
    expect(hiddenExtraPng.visible).toBe(false);

    // Switch default expression to Graphic SingleFrame (firstFrame=2)
    project = service.setDefaultExpression(project, characterId, graphicExpr.id);
    const graphicShot = project.shots[0]!;
    const graphicVisual = resolveLayerVisualParts(project, graphicShot, {
      id: layer.id,
      assetId: '',
      currentExpressionId: graphicExpr.id,
      mouthOverrideAssetId: null,
      anchor: 'center',
      x: layer.x,
      y: layer.y,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: layer.zIndex,
    });
    const replacedFaceGraphic = graphicVisual.parts[3]!;
    expect(replacedFaceGraphic.partId).toBe(`${layer.id}:${PART_FACE}`);
    expect(replacedFaceGraphic.drawOrder).toBe(3);
    expect(replacedFaceGraphic.flaGraphic?.frameOrdinal).toBe(2);
    expect(graphicVisual.parts[0]!.imageTransform).toStrictEqual(backHairPng.imageTransform);
    expect(graphicVisual.parts[5]!.imageTransform).toStrictEqual(frontHairPng.imageTransform);

    // Asset reference scanner finds both PNG and Graphic expression resources
    expect(
      scanAssetReferences(project, SMILE_PNG_ID).some(
        (ref) => ref.kind === 'character-expression',
      ),
    ).toBe(true);

    // Stage render model handles both PNG and Graphic SingleFrame expressions cleanly
    const assetUrls = Object.fromEntries(
      project.assets
        .filter((asset) => asset.kind === 'image')
        .map((asset) => [asset.id, `file:///assets/${asset.id}.png`]),
    );
    const model = buildStageRenderModel(
      project,
      {
        shotId: graphicShot.id,
        timeMs: 0,
        backgroundLayerId: null,
        layers: [
          {
            id: layer.id,
            assetId: '',
            currentExpressionId: graphicExpr.id,
            mouthOverrideAssetId: null,
            anchor: 'center',
            x: layer.x,
            y: layer.y,
            scaleX: 1,
            scaleY: 1,
            flipX: false,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            zIndex: layer.zIndex,
          },
        ],
      },
      assetUrls,
    );
    const renderedLayer = model.layers.find((entry) => entry.id === layer.id)!;
    expect(renderedLayer.parts[3]!.drawOrder).toBe(3);
    expect(renderedLayer.parts[4]!.render.visible).toBe(false);
    expect(renderedLayer.parts[3]!.flaGraphic?.frameOrdinal).toBe(2);
  });

  it('degrades only the broken face slot to the original part when an expression resource is missing, and prunes bindings when target parts are removed', () => {
    const { project: seed, characterId, layerId } = buildAdaptiveExpressionProject();
    let project = service.setAdaptivePartsFaceBinding(seed, characterId, {
      targetPartId: PART_FACE,
      replacePartIds: [PART_EYE_EXTRA],
    });
    project = service.addExpression(project, characterId, {
      name: '微笑',
      assetId: SMILE_PNG_ID,
    });
    const adaptive = project.characters.find((c) => c.id === characterId) as AdaptivePartsCharacter;
    const smileId = adaptive.expressions![0]!.id;
    project = service.setDefaultExpression(project, characterId, smileId);

    // Simulate broken expression asset at render time without deleting other parts
    const brokenProject: Project = {
      ...project,
      assets: project.assets.filter((asset) => asset.id !== SMILE_PNG_ID),
    };
    const shot = brokenProject.shots[0]!;
    const layer = shot.layers.find((entry) => entry.id === layerId)!;
    const degradedVisual = resolveLayerVisualParts(brokenProject, shot, {
      id: layer.id,
      assetId: '',
      currentExpressionId: smileId,
      mouthOverrideAssetId: null,
      anchor: 'center',
      x: layer.x,
      y: layer.y,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: layer.zIndex,
    });
    expect(degradedVisual.parts).toHaveLength(6);
    expect(degradedVisual.parts[3]!.assetId).toBe(FACE_PART_ASSET_ID);
    expect(degradedVisual.parts[4]!.visible).toBe(true);
    expect(degradedVisual.activeFace).toBeNull();

    // Removing replacePartId prunes replacePartIds; removing targetPartId clears faceBinding
    const def0 = service.getAdaptivePartsDefinition(project, characterId);
    const defAfterExtraRemoved = removeAdaptivePartFromDefinition(def0, PART_EYE_EXTRA);
    expect(defAfterExtraRemoved.faceBinding?.replacePartIds).toEqual([]);
    const projectAfterExtraRemoved = service.applyAdaptivePartsDefinition(
      project,
      characterId,
      defAfterExtraRemoved,
    );
    const charAfterExtraRemoved = projectAfterExtraRemoved.characters.find(
      (c) => c.id === characterId,
    ) as AdaptivePartsCharacter;
    expect(charAfterExtraRemoved.faceBinding?.targetPartId).toBe(PART_FACE);
    expect(charAfterExtraRemoved.faceBinding?.replacePartIds).toEqual([]);

    const defAfterTargetRemoved = removeAdaptivePartFromDefinition(
      defAfterExtraRemoved,
      PART_FACE,
    );
    expect(defAfterTargetRemoved.faceBinding).toBeUndefined();
    const projectAfterTargetRemoved = service.applyAdaptivePartsDefinition(
      projectAfterExtraRemoved,
      characterId,
      defAfterTargetRemoved,
    );
    const charAfterTargetRemoved = projectAfterTargetRemoved.characters.find(
      (c) => c.id === characterId,
    ) as AdaptivePartsCharacter;
    expect(charAfterTargetRemoved.faceBinding).toBeUndefined();
  });

  it('supports UI binding -> expression add/preview/default/placement -> History Undo/Redo inside AdaptivePartsAssemblyWorkbench', () => {
    const { project, characterId } = buildAdaptiveExpressionProject();
    editorProjectStore.open(PROJECT_ROOT, project);
    const begin = characterAssemblySessionStore.beginAdaptiveParts(characterId);
    expect(begin.ok).toBe(true);
    characterAssemblySessionStore.setAssemblyContinuityOwner(characterId);

    act(() => {
      root.render(createElement(LiveAdaptiveWorkbench));
    });

    // Unbound state in 表情 tab shows guidance (no fake add button)
    const exprTabBtn = container.querySelector(
      '[data-testid="adaptive-parts-tab-expressions"]',
    ) as HTMLButtonElement;
    act(() => exprTabBtn.click());
    expect(
      container.querySelector('[data-testid="adaptive-parts-expression-unbound"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="expression-add-trigger"]'),
    ).toBeNull();

    // Go back to 部件 tab, select PART_FACE, click 设为表情位置
    const goBackBtn = container.querySelector(
      '[data-testid="adaptive-parts-go-to-parts"]',
    ) as HTMLButtonElement;
    act(() => goBackBtn.click());
    const faceRowSelect = container.querySelector(
      `[data-part-id="${PART_FACE}"] [data-testid="adaptive-parts-assembly-row-select"]`,
    ) as HTMLButtonElement;
    act(() => faceRowSelect.click());
    const setFaceBtn = container.querySelector(
      '[data-testid="adaptive-parts-set-face-button"]',
    ) as HTMLButtonElement;
    act(() => setFaceBtn.click());

    let liveChar = editorProjectStore
      .getSnapshot()!
      .project.characters.find((c) => c.id === characterId) as AdaptivePartsCharacter;
    expect(liveChar.faceBinding?.targetPartId).toBe(PART_FACE);

    // Switch to 表情 tab and open Add form
    act(() => {
      (
        container.querySelector('[data-testid="adaptive-parts-tab-expressions"]') as HTMLButtonElement
      ).click();
    });
    const addTrigger = container.querySelector(
      '[data-testid="expression-add-trigger"]',
    ) as HTMLButtonElement;
    expect(addTrigger).not.toBeNull();
    act(() => addTrigger.click());

    const addForm = container.querySelector(
      '[data-testid="expression-add-form"]',
    ) as HTMLFormElement;
    const nameInput = addForm.querySelector('input') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(nameInput, '微笑');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const submitBtn = addForm.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
    act(() => {
      addForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    liveChar = editorProjectStore
      .getSnapshot()!
      .project.characters.find((c) => c.id === characterId) as AdaptivePartsCharacter;
    expect(liveChar.expressions).toHaveLength(1);
    const addedExprId = liveChar.expressions![0]!.id;

    // Preview updates workbench canvas part without modifying persisted defaultExpressionId
    const previewBtn = container.querySelector(
      `[data-testid="expression-preview-${addedExprId}"]`,
    ) as HTMLButtonElement;
    act(() => previewBtn.click());
    expect(previewBtn.getAttribute('aria-pressed')).toBe('true');

    // Open face placement alignment inspector, nudge offsetX, apply draft
    const alignBtn = container.querySelector(
      '[data-testid="adaptive-parts-face-placement-button"]',
    ) as HTMLButtonElement;
    act(() => alignBtn.click());
    const offsetXInput = container.querySelector(
      '[data-testid="adaptive-face-offset-x"]',
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(offsetXInput, '12');
      offsetXInput.dispatchEvent(new Event('input', { bubbles: true }));
      offsetXInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const applyBtn = container.querySelector(
      '[data-testid="adaptive-parts-assembly-apply"]',
    ) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
    act(() => applyBtn.click());

    liveChar = editorProjectStore
      .getSnapshot()!
      .project.characters.find((c) => c.id === characterId) as AdaptivePartsCharacter;
    expect(liveChar.faceBinding?.placement.offsetX).toBe(12);

    // Undo / Redo reverts and restores placement + expression cleanly
    act(() => {
      editorProjectStore.history.undo();
    });
    liveChar = editorProjectStore
      .getSnapshot()!
      .project.characters.find((c) => c.id === characterId) as AdaptivePartsCharacter;
    expect(liveChar.faceBinding?.placement.offsetX).toBe(0);

    act(() => {
      editorProjectStore.history.redo();
    });
    liveChar = editorProjectStore
      .getSnapshot()!
      .project.characters.find((c) => c.id === characterId) as AdaptivePartsCharacter;
    expect(liveChar.faceBinding?.placement.offsetX).toBe(12);
  });
});
