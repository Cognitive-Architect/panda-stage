// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { projectProductPreviewDialogue } from '../../src/renderer/shell/productPreviewModel';
import { resolveTalkingAnimationFace } from '../../src/domain/selectors/characterFaceSource';
import { upsertCharacterActionEvent } from '../../src/domain/services/CharacterActionEventService';
import {
  planCharacterAppearanceSwitch, planCharacterMotionTemplate,
} from '../../src/domain/services/CharacterMotionTemplateService';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { ActionPresetPanel } from '../../src/renderer/features/actions/ActionPresetPanel';
import { isAdaptivePartsAssemblySnapshot } from '../../src/renderer/features/characters/characterAssemblyPreview';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { MouthPoseSetEditor } from '../../src/renderer/features/characters/MouthPoseSetEditor';
import { ExpressionAtTimeControl } from '../../src/renderer/features/properties/ExpressionAtTimeControl';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { MouthPoseLane } from '../../src/renderer/features/timeline/MouthPoseLane';
import { buildProductPreviewImagePlan } from '../../src/renderer/shell/productPreviewModel';
import { ProductPreviewImageSession } from '../../src/renderer/shell/productPreviewImages';
import { resolveEditorTemporalAssetResolution } from '../../src/renderer/features/canvas/temporalVisualContinuity';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import { characterStore } from '../../src/renderer/stores/characterStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import {
  CharacterService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  evaluateShotAtTime,
  migrateProject,
  projectShotDialogueVisual,
  resolveLayerVisualParts,
  setManualMouthPose,
  upsertExpressionEventAtTime,
  upsertMouthCueEventAtTime,
  validatePresetApplication,
  type AdaptivePartsCharacter,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { faceSource, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

const PART_BODY_ASSET = 'c1000000-0000-4000-8000-000000000001';
const PART_FACE_ASSET = 'c1000000-0000-4000-8000-000000000002';
const EXPR_SMILE_ASSET = 'c1000000-0000-4000-8000-000000000003';
const MOUTH_OPEN_ASSET = 'c1000000-0000-4000-8000-000000000004';
const AUDIO_ASSET = 'c1000000-0000-4000-8000-000000000005';
const PART_BODY_ID = 'c2000000-0000-4000-8000-000000000001';
const PART_FACE_ID = 'c2000000-0000-4000-8000-000000000002';

function makeWholePart(
  partId: string,
  displayName: string,
  assetId: string,
  width: number,
  height: number,
  drawOrder: number,
  tx: number,
  ty: number,
) {
  return {
    partId,
    displayName,
    source: { kind: 'manual' as const, sourceId: assetId },
    assetId,
    imageMapping: {
      sourceWidth: width,
      sourceHeight: height,
      crop: { x: 0, y: 0, width, height },
      exportScale: 1,
    },
    drawOrder,
    restTransform: { a: 1, b: 0, c: 0, d: 1, tx, ty },
    sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx, ty },
    visible: true,
  };
}

function imageAsset(id: string, name: string, width = 120, height = 100): ImageAsset {
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

function buildPhaseBProject(options?: {
  bindFace?: boolean;
  includeMouth?: boolean;
  useGraphicMouth?: boolean;
  withDefaultExpression?: boolean;
}): {
  project: Project;
  characterId: string;
  layerId: string;
  smileExprId: string;
  angryExprId: string;
  shotId: string;
} {
  const base = graphicFaceProject(true);
  const baseShot = base.shots[0]!;
  let project = ProjectSchema.parse({
    ...base,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    assets: [
      ...base.assets,
      imageAsset(PART_BODY_ASSET, 'Body', 200, 300),
      imageAsset(PART_FACE_ASSET, 'OrigFace', 100, 100),
      imageAsset(EXPR_SMILE_ASSET, 'SmilePng', 100, 100),
      imageAsset(MOUTH_OPEN_ASSET, 'MouthOpenPng', 100, 100),
      {
        id: AUDIO_ASSET,
        kind: 'audio',
        name: 'LineAudio',
        sha256: 'b'.repeat(64),
        relativePath: 'assets/line.wav',
        mimeType: 'audio/wav',
        durationMs: 1200,
      },
    ],
    shots: [
      {
        ...baseShot,
        durationMs: 2400,
      },
    ],
  });

  const charSvc = new CharacterService();
  project = charSvc.createAdaptiveParts(project, {
    name: 'AdaptiveHero',
    parts: [
      makeWholePart(PART_BODY_ID, '身体', PART_BODY_ASSET, 200, 300, 0, -100, -150),
      makeWholePart(PART_FACE_ID, '原脸', PART_FACE_ASSET, 100, 100, 1, -50, -90),
    ],
  });
  const char = project.characters.at(-1) as AdaptivePartsCharacter;
  let smileExprId = '';
  let angryExprId = '';
  if (options?.bindFace !== false) {
    project = charSvc.setAdaptivePartsFaceBinding(project, char.id, {
      targetPartId: PART_FACE_ID,
    });
    project = charSvc.addExpression(project, char.id, {
      name: '微笑',
      assetId: EXPR_SMILE_ASSET,
    });
    project = charSvc.addExpression(project, char.id, {
      name: '生气',
      visualSource: faceSource(1),
    });
    const updated = project.characters.find((c) => c.id === char.id) as AdaptivePartsCharacter;
    smileExprId = updated.expressions![0]!.id;
    angryExprId = updated.expressions![1]!.id;
    if (options?.withDefaultExpression !== false) {
      project = charSvc.setDefaultExpression(project, char.id, smileExprId);
    }
    if (options?.includeMouth !== false) {
      project = options?.useGraphicMouth
        ? charSvc.setMouthOpenVisualSource(project, char.id, faceSource(1))
        : charSvc.setMouthOpenAsset(project, char.id, MOUTH_OPEN_ASSET);
    }
  }
  const layerRes = new LayerService().createFromAdaptiveCharacter(
    project,
    IDS.shot,
    char.id,
    { x: 960, y: 540 },
  );
  project = layerRes.project;
  return {
    project,
    characterId: char.id,
    layerId: layerRes.layer.id,
    smileExprId,
    angryExprId,
    shotId: IDS.shot,
  };
}

it('keeps existing body, expression, mouth pose and other instances intact during a bound head action (#1386)', () => {
  const { project, shotId, layerId, characterId, angryExprId } = buildPhaseBProject();
  const headId = 'c2000000-0000-4000-8000-000000000011';
  const configured = ProjectSchema.parse({
    ...project,
    characters: project.characters.map((character) => character.id === characterId && character.mode === 'adaptive-parts'
      ? {
          ...character,
          parts: [...character.parts, makeWholePart(headId, '头部', EXPR_SMILE_ASSET, 100, 100, 2, -50, -110)],
          headMotionBinding: { partIds: [headId] },
        } : character),
  });
  const other = new LayerService().createFromAdaptiveCharacter(configured, shotId, characterId, { x: 480, y: 540 });
  const expression = upsertExpressionEventAtTime(other.project, shotId, layerId, angryExprId, 500);
  const reference = upsertMouthCueEventAtTime(expression, shotId, layerId, 'open', 750);
  const authored = planCharacterMotionTemplate(reference, {
    shotId, layerId, kind: 'nod', templateName: 'Nod', startMs: 500, endMs: 1000, cycles: 1, amplitude: 25, headPartId: headId,
  });
  const visualAt = (candidate: Project, id: string, time: number) => {
    const shot = candidate.shots[0]!;
    const evaluated = projectShotDialogueVisual(candidate, shot, evaluateShotAtTime(shot, time, candidate));
    return resolveLayerVisualParts(candidate, shot, evaluated.layers.find((layer) => layer.id === id)!, time);
  };

  for (const time of [625, 750]) {
    const before = visualAt(reference, layerId, time);
    const during = visualAt(authored, layerId, time);
    const part = (visual: typeof before, id: string) =>
      visual.parts.find(({ source }) => source.kind === 'adaptive-part' && source.characterPartId === id);
    expect(during.activeFace).toEqual(before.activeFace);
    expect(during.activeFace?.source).toBe(time === 750 ? 'mouth' : 'expression');
    expect(part(during, PART_BODY_ID)).toEqual(part(before, PART_BODY_ID));
    expect(part(during, headId)?.imageTransform).not.toEqual(part(before, headId)?.imageTransform);
    expect(visualAt(authored, other.layer.id, time)).toEqual(visualAt(reference, other.layer.id, time));
  }
});

it('keeps a body action and mouth cue through an instance appearance fade (#1386)', () => {
  const { project, shotId, layerId, characterId, smileExprId, angryExprId } = buildPhaseBProject();
  const actionId = crypto.randomUUID();
  const definition = ProjectSchema.parse({
    ...project,
    characters: project.characters.map((character) => character.id === characterId ? {
      ...character,
      actions: [{
        id: actionId, name: 'Existing body move', kind: 'layered', headAnchorPartId: PART_BODY_ID,
        tracks: [{
          partId: PART_BODY_ID, property: 'transform.offsetX',
          keys: [{ timeMs: 0, value: 0, interpolationToNext: 'linear' },
            { timeMs: 1500, value: 48, interpolationToNext: 'linear' }],
        }],
      }],
    } : character),
  });
  const second = new LayerService().createFromAdaptiveCharacter(definition, shotId, characterId, { x: 480, y: 540 });
  const body = upsertCharacterActionEvent(second.project, shotId, layerId, { actionId, startMs: 0, endMs: 1500 });
  const openedMouth = upsertMouthCueEventAtTime(body, shotId, layerId, 'open', 833);
  const reference = upsertMouthCueEventAtTime(openedMouth, shotId, layerId, 'rest', 1000);
  const switched = planCharacterAppearanceSwitch(reference, {
    shotId, layerId, expressionId: angryExprId, timeMs: 500, fadeFrames: 12,
  });

  expect(switched.characters).toEqual(reference.characters);
  expect(switched.shots[0]!.layers).toEqual(reference.shots[0]!.layers);
  const shot = switched.shots[0]!;
  const visualAt = (candidate: Project, id: string, time: number) => {
    const currentShot = candidate.shots[0]!;
    const state = projectShotDialogueVisual(candidate, currentShot, evaluateShotAtTime(currentShot, time, candidate));
    return resolveLayerVisualParts(candidate, currentShot, state.layers.find((layer) => layer.id === id)!, time);
  };
  for (const [time, expectedExpression, expectedOpacity, expectedFace] of [
    [500, smileExprId, 1, 'expression'], [750, angryExprId, 0, 'expression'],
    [875, angryExprId, 0.5, 'mouth'], [1000, angryExprId, 1, 'expression'],
  ] as const) {
    const current = evaluateShotAtTime(shot, time, switched).layers.find((layer) => layer.id === layerId)!;
    const visual = visualAt(switched, layerId, time);
    const bodyPart = (value: typeof visual) =>
      value.parts.find(({ source }) => source.kind === 'adaptive-part' && source.characterPartId === PART_BODY_ID);
    expect(current.currentExpressionId).toBe(expectedExpression);
    expect(current.opacity).toBeCloseTo(expectedOpacity);
    expect(current.layeredCharacterAction?.action.id).toBe(actionId);
    expect(visual.activeFace?.source).toBe(expectedFace);
    expect(bodyPart(visual)).toEqual(bodyPart(visualAt(reference, layerId, time)));
    expect(visualAt(switched, second.layer.id, time)).toEqual(visualAt(reference, second.layer.id, time));
  }
});

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('replaces one independent mouth or the bound face group, while preserving foreground order', () => {
  const fixture = buildPhaseBProject({ includeMouth: false });
  const mouthPartId = 'c2000000-0000-4000-8000-000000000003';
  const hairPartId = 'c2000000-0000-4000-8000-000000000004';
  const independent = 'c2000000-0000-4000-8000-000000000005';
  const face = 'c2000000-0000-4000-8000-000000000006';
  let project = ProjectSchema.parse({
    ...fixture.project,
    characters: fixture.project.characters.map((character) => {
      if (character.id !== fixture.characterId || character.mode !== 'adaptive-parts' || !character.faceBinding) return character;
      return {
        ...character,
        parts: [...character.parts,
          makeWholePart(mouthPartId, '嘴', MOUTH_OPEN_ASSET, 100, 100, 2, -10, -30),
          makeWholePart(hairPartId, '刘海', EXPR_SMILE_ASSET, 100, 100, 3, -20, -90),
        ],
        faceBinding: { ...character.faceBinding, replacePartIds: [mouthPartId] },
        mouthPoseSet: {
          poses: [
            { id: independent, name: '独立嘴', target: { kind: 'mouth', partId: mouthPartId },
              source: { kind: 'image', assetId: MOUTH_OPEN_ASSET } },
            { id: face, name: '整脸', target: { kind: 'face' }, source: faceSource(1) },
          ],
          restPoseId: independent, analyzerMapping: { rest: independent, open: face, closed: independent, round: face, wide: face },
          driveMode: 'mouth-poses',
        },
      };
    }),
  });
  project = setManualMouthPose(project, fixture.shotId, fixture.layerId, 'c2000000-0000-4000-8000-000000000007',
    { startMs: 300, endMs: 650, poseId: face });
  const shot = project.shots[0]!;
  const visualAt = (time: number) => {
    const evaluated = projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, time, project));
    return resolveLayerVisualParts(project, shot, evaluated.layers.find(layer => layer.id === fixture.layerId)!, time);
  };
  const before = visualAt(299);
  const during = visualAt(300);
  expect(before.activeFace).toMatchObject({ source: 'mouth', assetId: MOUTH_OPEN_ASSET });
  expect(during.activeFace).toMatchObject({ source: 'mouth', visualSource: faceSource(1) });
  expect(before.parts.some(part => part.source.kind === 'adaptive-part' && part.source.characterPartId === PART_FACE_ID)).toBe(true);
  expect(during.parts.some(part => part.visible && part.source.kind === 'adaptive-part' && part.source.characterPartId === mouthPartId)).toBe(false);
  expect(during.parts.at(-1)?.source).toMatchObject({ characterPartId: hairPartId });
  expect(visualAt(650)).toEqual(before);
});

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot!.unmount());
    mountedRoot = null;
  }
  mountedContainer?.remove();
  mountedContainer = null;
  characterAssemblySessionStore.getActiveAdaptivePartsAssemblySessionHandle()?.cancel();
  selectionStore.clear();
  editorProjectStore.clear();
  delete (window as { pandaStage?: unknown }).pandaStage;
  vi.restoreAllMocks();
});

it.each(['whole image', 'cropped image'])('preserves the first independent mouth from a %s', (sourceKind) => {
  const setup = buildPhaseBProject({ bindFace: false });
  const mouthId = 'c2000000-0000-4000-8000-000000000009';
  const mouth = makeWholePart(mouthId, '嘴', MOUTH_OPEN_ASSET, 100, 100, 2, -50, -25);
  if (sourceKind === 'cropped image') {
    mouth.imageMapping = { sourceWidth: 240, sourceHeight: 180,
      crop: { x: 40, y: 30, width: 50, height: 50 }, exportScale: 2 };
  }
  const project = ProjectSchema.parse({
    ...setup.project,
    characters: setup.project.characters.map(character => character.id === setup.characterId && character.mode === 'adaptive-parts'
      ? { ...character, parts: [...character.parts, mouth] }
      : character),
  });
  editorProjectStore.open('C:/temp/unbound-mouth.pandastage', project);
  const before = editorProjectStore.getSnapshot();
  mountedContainer = document.createElement('div');
  mountedRoot = createRoot(mountedContainer);
  act(() => mountedRoot!.render(createElement(MouthPoseSetEditor, { characterId: setup.characterId })));
  const details = mountedContainer.querySelector('details')!;
  const add = [...details.querySelectorAll('button')].find(button => button.textContent === '添加姿态')!;
  const target = details.querySelector('select')!;
  expect(target.value).toBe('');
  expect(target.options[1]?.value).toBe(PART_BODY_ID);
  expect(add.disabled).toBe(true);
  act(() => add.click());
  expect(editorProjectStore.getSnapshot()).toBe(before);
  act(() => {
    target.value = mouthId;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(editorProjectStore.getSnapshot()).toBe(before);
  expect(add.disabled).toBe(false);
  act(() => add.click());
  const saved = ProjectSchema.parse(JSON.parse(JSON.stringify(editorProjectStore.getSnapshot()!.project)));
  const character = saved.characters.find(item => item.id === setup.characterId) as AdaptivePartsCharacter;
  expect(character.faceBinding).toBeUndefined();
  expect(character.mouthPoseSet?.poses[0]).toMatchObject({
    target: { kind: 'mouth', partId: mouthId }, source: { kind: 'image', assetId: MOUTH_OPEN_ASSET },
  });
  expect(character.parts[0]?.partId).toBe(PART_BODY_ID);
  const shot = saved.shots[0]!;
  const evaluated = projectShotDialogueVisual(saved, shot, evaluateShotAtTime(shot, 0, saved));
  const visual = resolveLayerVisualParts(saved, shot, evaluated.layers.find(layer => layer.id === setup.layerId)!, 0);
  expect(visual.parts.find(part => part.assetId === PART_BODY_ASSET)?.visible).toBe(true);
  expect(visual.parts.filter(part => part.visible && part.assetId === MOUTH_OPEN_ASSET)).toHaveLength(1);
  const beforeShot = project.shots[0]!;
  const beforeFrame = evaluateShotAtTime(beforeShot, 0, project);
  const beforeVisual = resolveLayerVisualParts(project, beforeShot, beforeFrame.layers.find(layer => layer.id === setup.layerId)!, 0);
  expect(visual.parts.find(part => part.assetId === MOUTH_OPEN_ASSET)).toMatchObject({
    imageTransform: beforeVisual.parts.find(part => part.assetId === MOUTH_OPEN_ASSET)?.imageTransform,
    localRect: beforeVisual.parts.find(part => part.assetId === MOUTH_OPEN_ASSET)?.localRect,
  });
});

it('blocks a scoped Graphic from becoming a whole-Graphic pose and waits for an independent source', () => {
  const setup = buildPhaseBProject({ bindFace: false });
  const id = 'c2000000-0000-4000-8000-000000000009';
  const mouth = {
    partId: id, displayName: '子元件嘴', source: { kind: 'manual', sourceId: MOUTH_OPEN_ASSET },
    drawOrder: 2, visible: true, restTransform: { a: 1, b: 0, c: 0, d: 1, tx: -50, ty: -25 },
  };
  const project = ProjectSchema.parse({
    ...setup.project,
    characters: setup.project.characters.map(character => character.id === setup.characterId && character.mode === 'adaptive-parts'
      ? { ...character, parts: [...character.parts, { ...mouth, visualSource: {
        kind: 'fla-graphic', animationId: faceSource(0).animationId, nodePath: ['face-0'], poseFrameOrdinal: 0,
      } }] } : character),
  });
  editorProjectStore.open('C:/temp/scoped-mouth.pandastage', project);
  Object.defineProperty(window, 'pandaStage', { configurable: true, value: {
    assets: { readThumbnail: vi.fn().mockResolvedValue({ ok: false }) },
  } });
  const before = editorProjectStore.getSnapshot();
  mountedContainer = document.createElement('div');
  mountedRoot = createRoot(mountedContainer);
  act(() => mountedRoot!.render(createElement(MouthPoseSetEditor, { characterId: setup.characterId })));
  const details = mountedContainer.querySelector('details')!;
  const add = [...details.querySelectorAll('button')].find(button => button.textContent === '添加姿态')!;
  const target = details.querySelector('select')!;
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    target.value = id;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(details.textContent).toContain('独立的嘴部');
  expect(details.querySelector('[data-testid="mouth-pose-source-graphic-toggle"]')).toBeNull();
  expect(add.disabled).toBe(true);
  act(() => add.click());
  expect(editorProjectStore.getSnapshot()).toBe(before);
  act(() => details.querySelector<HTMLButtonElement>('button[aria-label^="姿态图片"]')!.click());
  act(() => details.querySelector<HTMLButtonElement>(`button[data-asset-id="${MOUTH_OPEN_ASSET}"]`)!.click());
  expect(editorProjectStore.getSnapshot()).toBe(before);
  expect(add.disabled).toBe(false);
  act(() => add.click());
  const saved = ProjectSchema.parse(JSON.parse(JSON.stringify(editorProjectStore.getSnapshot()!.project)));
  const character = saved.characters.find(item => item.id === setup.characterId) as AdaptivePartsCharacter;
  expect(character.mouthPoseSet?.poses[0]).toMatchObject({
    target: { kind: 'mouth', partId: id }, source: { kind: 'image', assetId: MOUTH_OPEN_ASSET },
  });
  expect(character.parts.at(-1)?.visualSource).toMatchObject({ nodePath: ['face-0'] });
});

it('uses an accessible Plus for timeline mouth poses and retains the disabled behavior', () => {
  const setup = buildPhaseBProject();
  const restId = 'c2000000-0000-4000-8000-000000000010';
  const project = ProjectSchema.parse({
    ...setup.project,
    characters: setup.project.characters.map(character => character.id === setup.characterId ? {
      ...character, mouthPoseSet: {
        poses: [{ id: restId, name: '静止', target: { kind: 'face' }, source: { kind: 'image', assetId: EXPR_SMILE_ASSET } }],
        restPoseId: restId, driveMode: 'mouth-poses',
        analyzerMapping: { rest: restId, open: restId, wide: restId, round: restId, closed: restId },
      },
    } : character),
  });
  editorProjectStore.open('C:/temp/mouth-timeline.pandastage', project);
  const snapshot = editorProjectStore.getSnapshot()!;
  const props = { project: snapshot.project, shot: snapshot.project.shots[0]!, layerId: setup.layerId,
    currentTimeMs: 200, pixelsPerMs: 1, trackWidth: 2400 };
  mountedContainer = document.createElement('div');
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  act(() => mountedRoot!.render(createElement(MouthPoseLane, { ...props, disabled: true })));
  const button = mountedContainer.querySelector<HTMLButtonElement>('button[aria-label="在播放位置添加口型段"]')!;
  expect(button.querySelector('svg.lucide-plus[aria-hidden="true"]')).not.toBeNull();
  expect(button.textContent?.trim()).toBe('');
  expect(button.disabled).toBe(true);
  act(() => button.click());
  expect(editorProjectStore.getSnapshot()).toBe(snapshot);
  act(() => mountedRoot!.render(createElement(MouthPoseLane, { ...props, disabled: false })));
  button.focus();
  expect(document.activeElement).toBe(button);
  act(() => button.click());
  expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents).toContainEqual(expect.objectContaining({
    type: 'mouth-pose', layerId: setup.layerId, origin: 'manual', startMs: 200, poseId: restId,
  }));
});

it('loops a shared talking animation on the clip clock and restores the current static face', () => {
  const setup = buildPhaseBProject();
  const base = setup.project;
  const clipId = 'c3000000-0000-4000-8000-000000000041';
  const voiceId = 'c3000000-0000-4000-8000-000000000042';
  const animationId = 'c3000000-0000-4000-8000-000000000043';
  const source = base.animations[0]!.source;
  const secondFrameAsset = 'c3000000-0000-4000-8000-000000000045';
  const frames = [PART_FACE_ASSET, secondFrameAsset].map((assetId, ordinal) => ({
    assetId, ordinal, sourceFrameIndex: ordinal + 3, sha256: 'a'.repeat(64),
    sourceViewport: { x: ordinal * 10, y: 0, width: 100, height: 100 },
    offset: { x: ordinal * 10, y: 0 }, startMs: ordinal * 100,
    durationMs: 100, createdBySequenceImport: true,
  }));
  let project = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, imageAsset(secondFrameAsset, 'TalkingFrame', 100, 100)].map(asset => frames.some(frame => frame.assetId === asset.id)
      ? { ...asset, sha256: 'a'.repeat(64) } : asset),
    animations: [...base.animations, {
      id: animationId, name: 'Talking sequence', durationMs: 200, frames,
      source: { ...source, targetKind: 'scene', sourceFps: 10, startFrameIndex: 3, endFrameIndex: 4,
        canvas: { width: 110, height: 100 }, anchor: { x: 0, y: 0 } },
    }],
    voiceProfiles: [...base.voiceProfiles, { ...base.voiceProfiles[0], id: voiceId, name: 'Talking Voice', characterId: setup.characterId }],
    shots: base.shots.map(shot => ({
      ...shot,
      audioClips: [{ id: clipId, name: 'Voice', assetId: AUDIO_ASSET, role: 'dialogue', startMs: 100, endMs: 700, offsetMs: 600 }],
      dialogues: [{ id: 'c3000000-0000-4000-8000-000000000044', characterId: setup.characterId,
        voiceProfileId: voiceId, subtitleStyleId: IDS.subtitle, audioClipId: clipId,
        text: '你好', startMs: 100, endMs: 700 }],
    })),
  });
  expect(migrateProject({ ...project, schemaVersion: 24 })).toEqual(project);
  editorProjectStore.open('C:/temp/talking-animation.pandastage', project);
  characterStore.setTalkingAnimation(setup.characterId, animationId);
  const configured = editorProjectStore.getSnapshot()!.project;
  editorProjectStore.undo();
  expect(editorProjectStore.getSnapshot()!.project).toEqual(project);
  editorProjectStore.redo();
  project = ProjectSchema.parse(JSON.parse(JSON.stringify(editorProjectStore.getSnapshot()!.project)));
  expect(project).toEqual(configured);
  expect(() => migrateProject({ ...project, schemaVersion: 24 })).toThrow();
  expect(() => new CharacterService().setTalkingAnimation(project, setup.characterId, 'missing')).toThrow();
  expect(ProjectSchema.safeParse({
    ...project, characters: project.characters.map(character =>
      character.id === setup.characterId ? { ...character, talkingAnimationId: clipId } : character),
  }).success).toBe(false);

  project = upsertExpressionEventAtTime(project, setup.shotId, setup.layerId, setup.angryExprId, 150);
  project = upsertMouthCueEventAtTime(project, setup.shotId, setup.layerId, 'rest', 340);
  project = upsertMouthCueEventAtTime(project, setup.shotId, setup.layerId, 'open', 440);
  const shot = project.shots[0]!;
  const visualAt = (time: number, unavailable?: string, shotWithoutCues = false) => {
    const activeShot = shotWithoutCues ? { ...shot, timelineEvents: shot.timelineEvents.filter(event => event.type !== 'mouth-cue') } : shot;
    const evaluated = projectShotDialogueVisual(project, activeShot, evaluateShotAtTime(activeShot, time, project));
    return resolveLayerVisualParts(project, activeShot, evaluated.layers.find(layer => layer.id === setup.layerId)!,
      time, id => id === unavailable);
  };
  expect(visualAt(99).activeFace?.source).toBe('expression');
  expect(visualAt(100).activeFace).toMatchObject({ source: 'mouth', assetId: PART_FACE_ASSET });
  expect(visualAt(200).activeFace).toMatchObject({ source: 'mouth', assetId: secondFrameAsset });
  expect(visualAt(300).activeFace).toMatchObject({ source: 'mouth', assetId: PART_FACE_ASSET });
  expect(visualAt(200).parts[1]?.imageTransform?.tx).toBeGreaterThan(visualAt(100).parts[1]!.imageTransform!.tx);
  expect(visualAt(200, secondFrameAsset).activeFace).toMatchObject({ source: 'expression', currentExpressionId: setup.angryExprId });
  expect(visualAt(360).activeFace?.source).toBe('expression');
  expect(visualAt(460).activeFace).toMatchObject({ source: 'mouth', assetId: MOUTH_OPEN_ASSET });
  expect(visualAt(540, undefined, true).activeFace?.source).toBe('mouth');
  expect(visualAt(700, undefined, true).activeFace).toMatchObject({ source: 'expression', currentExpressionId: setup.angryExprId });
  expect(collectExportPreparationMedia(project).find(({ asset }) => asset.id === secondFrameAsset))
    .toMatchObject({ optionalExpression: true });
  const previewAt200 = projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, 200, project));
  expect(buildProductPreviewImagePlan(project, shot, previewAt200).requiredAssetIds).toContain(secondFrameAsset);
  const urls = Object.fromEntries(project.assets.filter(asset => asset.kind === 'image')
    .map(asset => [asset.id, `blob:${asset.id}`]));
  const exported = evaluateExportShotAtTime(project, shot, 200);
  expect(buildStageRenderModel(project, exported, urls).layers)
    .toEqual(buildStageRenderModel(project, previewAt200, urls).layers);
  delete urls[secondFrameAsset];
  expect(buildStageRenderModel(project, exported, urls).layers.find(layer => layer.id === setup.layerId)?.visual?.activeFace)
    .toMatchObject({ source: 'expression', currentExpressionId: setup.angryExprId });

  const graphicId = base.animations[0]!.id;
  project = new CharacterService().setTalkingAnimation(project, setup.characterId, graphicId);
  expect(visualAt(100).parts[1]?.source).toMatchObject({ kind: 'adaptive-part-fla-graphic', animationId: graphicId });

  const service = new CharacterService();
  const continuous = service.setTalkingAnimation(project, setup.characterId, animationId);
  const configuredRest = service.setTalkingAnimation(continuous, setup.characterId, animationId, {
    mode: 'loop', firstFrame: 0, lastFrame: 1, restFrame: 0,
  });
  const silence: import('../../src/shared/dialogue-silence').DialogueSilence = {
    [AUDIO_ASSET]: { sha256: 'b'.repeat(64), intervals: [[850, 1_100]] },
  };
  const automatic = { ...shot, timelineEvents: shot.timelineEvents.filter(event => event.type !== 'mouth-cue') };
  const at = (time: number, activeShot: typeof shot = automatic, activeProject = configuredRest, analysis = silence) => {
    const result = evaluateExportShotAtTime(activeProject, activeShot, time, undefined, analysis);
    const preview = projectProductPreviewDialogue(activeProject, activeShot, evaluateShotAtTime(activeShot, time, activeProject), undefined, analysis);
    const editor = buildEditorTemporalCanvasModel({
      project: activeProject, shot: activeShot, currentTimeMs: time, dialogueSilence: analysis,
      readyAssetIds: new Set(activeProject.assets.map(asset => asset.id)), previousVisuals: new Map(),
    }).evaluatedShot;
    const fetchLayer = (frame: typeof result) => frame.layers.find(layer => layer.id === setup.layerId)!;
    const state = fetchLayer(result);
    expect(fetchLayer(preview).talkingAnimationElapsedMs).toBe(state.talkingAnimationElapsedMs);
    expect(fetchLayer(editor).talkingAnimationElapsedMs).toBe(state.talkingAnimationElapsedMs);
    return state;
  };
  expect(at(349).talkingAnimationElapsedMs).toBe(249);
  expect(at(350).talkingAnimationElapsedMs).toBe('rest');
  expect(at(599).talkingAnimationElapsedMs).toBe('rest');
  expect(at(600).talkingAnimationElapsedMs).toBe(500);
  expect(resolveLayerVisualParts(configuredRest, automatic, at(450), 450).activeFace?.assetId).toBe(PART_FACE_ASSET);
  expect(resolveLayerVisualParts(configuredRest, automatic, at(600), 600).activeFace?.assetId).toBe(secondFrameAsset);
  expect(at(450, automatic, continuous).talkingAnimationElapsedMs).toBeUndefined();
  expect(at(450, automatic, continuous, {}).talkingAnimationElapsedMs).toBe(350);
  expect(at(450, automatic, continuous, { [AUDIO_ASSET]: { ...silence[AUDIO_ASSET]!, sha256: 'e'.repeat(64) } }).talkingAnimationElapsedMs).toBe(350);
  expect(at(380, shot).talkingAnimationElapsedMs).toBe('rest');
  expect(at(480, shot).mouthOverrideAssetId).toBe(MOUTH_OPEN_ASSET);

  const shifted = { ...automatic, audioClips: automatic.audioClips.map(clip => ({
    ...clip, startMs: 400, endMs: 1_200, offsetMs: 400,
  })) };
  expect(at(849, shifted).talkingAnimationElapsedMs).toBe(449);
  expect(at(850, shifted).talkingAnimationElapsedMs).toBe('rest');
  expect(at(1_100, shifted).talkingAnimationElapsedMs).toBe(700);
});

it('samples a six-frame talking source in a custom inclusive range and restores the chosen frame', () => {
  const setup = buildPhaseBProject();
  const source = setup.project.animations[0]!;
  const animationId = crypto.randomUUID();
  const frames = Array.from({ length: 6 }, (_, ordinal) => ({
    ...source.frames[ordinal % source.frames.length]!,
    assetId: PART_FACE_ASSET, ordinal, sourceFrameIndex: ordinal + 7, sha256: 'a'.repeat(64),
    sourceViewport: { x: ordinal, y: 0, width: 100, height: 100 },
    offset: { x: ordinal, y: 0 }, startMs: ordinal * 100, durationMs: 100, createdBySequenceImport: true,
  }));
  const project = ProjectSchema.parse({
    ...setup.project,
    assets: setup.project.assets.map(asset => asset.id === PART_FACE_ASSET ? { ...asset, sha256: 'a'.repeat(64) } : asset),
    animations: [...setup.project.animations, {
      id: animationId, name: 'Six frames', durationMs: 600, frames,
      source: { ...source.source, sourceFps: 10, startFrameIndex: 7, endFrameIndex: 12,
        canvas: { width: 110, height: 100 }, anchor: { x: 0, y: 0 } },
    }],
  });
  const range = { firstFrame: 1, lastFrame: 4, restFrame: 5 };
  const times = [0, 100, 200, 399, 400, 500];
  for (const [mode, expected] of [
    ['loop', [1, 2, 3, 4, 1, 2]],
    ['play once', [1, 2, 3, 4, 4, 4]],
    ['loop reverse', [4, 3, 2, 1, 4, 3]],
    ['play once reverse', [4, 3, 2, 1, 1, 1]],
    ['single frame', [1, 1, 1, 1, 1, 1]],
  ] as const) {
    expect(times.map(time => resolveTalkingAnimationFace(project, animationId, time, { ...range, mode })?.asset.rasterFrame?.ordinal)).toEqual(expected);
  }

  const playback = { ...range, mode: 'loop reverse' as const };
  editorProjectStore.open('C:/temp/talking-range.pandastage', project);
  characterStore.setTalkingAnimation(setup.characterId, animationId, playback);
  const configured = editorProjectStore.getSnapshot()!.project;
  expect(configured.animations).toEqual(project.animations);
  expect(() => new CharacterService().setTalkingAnimation(project, setup.characterId, animationId, { ...playback, lastFrame: 6 })).toThrow();
  editorProjectStore.undo();
  expect(editorProjectStore.getSnapshot()!.project).toEqual(project);
  editorProjectStore.redo();
  expect(editorProjectStore.getSnapshot()!.project).toEqual(configured);
  expect(migrateProject({ ...project, schemaVersion: 25 })).toEqual(project);
  expect(() => migrateProject({ ...configured, schemaVersion: 25 })).toThrow();

  const shot = configured.shots[0]!;
  const resolve = (time: number) => {
    const layer = (shotResult: ReturnType<typeof evaluateShotAtTime>) =>
      shotResult.layers.find(candidate => candidate.id === setup.layerId)!;
    const readyAssetIds = new Set(project.assets.map(asset => asset.id));
    const editor = layer(buildEditorTemporalCanvasModel({
      project: configured, shot, currentTimeMs: time, readyAssetIds, previousVisuals: new Map(),
    }).evaluatedShot);
    const preview = layer(projectProductPreviewDialogue(configured, shot, evaluateShotAtTime(shot, time, configured)));
    const exported = layer(evaluateExportShotAtTime(configured, shot, time));
    expect(editor.talkingAnimationElapsedMs).toBe('rest');
    expect(preview.talkingAnimationElapsedMs).toBe('rest');
    expect(exported.talkingAnimationElapsedMs).toBe('rest');
    const visual = resolveLayerVisualParts(configured, shot, exported);
    expect(resolveLayerVisualParts(configured, shot, editor).parts).toEqual(visual.parts);
    expect(resolveLayerVisualParts(configured, shot, preview).parts).toEqual(visual.parts);
    return visual;
  };
  expect(resolve(0).activeFace?.assetId).toBe(PART_FACE_ASSET);
  expect(resolve(250).activeFace?.assetId).toBe(PART_FACE_ASSET);
  expect(collectExportPreparationMedia(configured).some(entry => entry.asset.id === PART_FACE_ASSET)).toBe(true);
  const graphic = resolveTalkingAnimationFace(project, source.id, 50, {
    firstFrame: 1, lastFrame: 3, mode: 'loop reverse',
  });
  expect(graphic?.asset.flaGraphic?.frameOrdinal).toBe(2);
});

describe('Phase B: AdaptiveParts Timeline Expressions, MouthCue & Simple Mouth (#1211)', () => {
  it('keeps authored face events in two shots through unbind, undo, redo and rebind', () => {
    const setup = buildPhaseBProject();
    const originalShot = setup.project.shots[0]!;
    const secondShot = { ...originalShot, id: 'c3000000-0000-4000-8000-000000000010' };
    let project = ProjectSchema.parse({ ...setup.project, shots: [originalShot, secondShot] });
    for (const shot of project.shots) {
      project = upsertExpressionEventAtTime(project, shot.id, setup.layerId, setup.angryExprId, 320);
      project = upsertMouthCueEventAtTime(project, shot.id, setup.layerId, 'open', 800);
    }
    project = upsertExpressionEventAtTime(
      project, secondShot.id, IDS.layerChar, project.characters[0]!.expressions![0]!.id, 500,
    );
    editorProjectStore.open('C:/temp/phase-b.pandastage', project);
    characterStore.setAdaptivePartsFaceBinding(setup.characterId, null);
    const unbound = editorProjectStore.getSnapshot()!.project;
    expect(unbound.shots).toEqual(project.shots);
    for (const shot of unbound.shots) {
      const layer = evaluateShotAtTime(shot, 800, unbound).layers.find(({ id }) => id === setup.layerId)!;
      expect(resolveLayerVisualParts(unbound, shot, layer, 800).activeFace).toBeNull();
    }
    editorProjectStore.undo();
    expect(editorProjectStore.getSnapshot()!.project).toEqual(project);
    editorProjectStore.redo();
    expect(editorProjectStore.getSnapshot()!.project).toEqual(unbound);
    characterStore.setAdaptivePartsFaceBinding(setup.characterId, { targetPartId: PART_BODY_ID });
    const rebound = editorProjectStore.getSnapshot()!.project;
    expect(rebound.shots).toEqual(project.shots);
    const shot = rebound.shots[1]!;
    const layer = evaluateShotAtTime(shot, 800, rebound).layers.find(({ id }) => id === setup.layerId)!;
    expect(resolveLayerVisualParts(rebound, shot, layer, 800).activeFace?.assetId).toBe(MOUTH_OPEN_ASSET);
  });

  it('renders the original parts when the active PNG has a Project record but fails read or decode', async () => {
    const setup = buildPhaseBProject();
    let project = new CharacterService().setAdaptivePartsFaceBinding(setup.project, setup.characterId, {
      targetPartId: PART_FACE_ID,
      replacePartIds: [PART_BODY_ID],
    });
    const second = new LayerService().createFromAdaptiveCharacter(project, IDS.shot, setup.characterId, { x: 400, y: 400 });
    project = upsertExpressionEventAtTime(second.project, IDS.shot, second.layer.id, setup.angryExprId, 0);
    project = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) => ({ ...asset, sha256: asset.sha256 ?? 'a'.repeat(64) })),
    });
    const shot = project.shots[0]!;
    const frame = evaluateShotAtTime(shot, 0, project);
    const urls = Object.fromEntries(project.assets.filter(({ kind }) => kind === 'image')
      .map(({ id }) => [id, `blob:${id}`]));
    expect(project.assets.some(({ id }) => id === EXPR_SMILE_ASSET)).toBe(true);
    const healthy = buildStageRenderModel(project, frame, urls).layers.find(({ id }) => id === setup.layerId)!;
    expect(healthy.parts.map(({ asset, render }) => [asset.id, render.visible])).toEqual([
      [PART_BODY_ASSET, false], [EXPR_SMILE_ASSET, true],
    ]);
    const plan = buildProductPreviewImagePlan(project, shot, frame);
    let missing = true;
    const session = new ProductPreviewImageSession({
      readCanvasImage: async ({ assetId }) => {
        if (missing && assetId === EXPR_SMILE_ASSET) return {
          ok: false,
          error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED', message: 'File missing', assetId },
        };
        const asset = project.assets.find((candidate) => candidate.id === assetId)! as ImageAsset;
        if (asset.mimeType !== 'image/png' && asset.mimeType !== 'image/svg+xml') {
          throw new Error(`Unexpected fixture image type: ${asset.mimeType}`);
        }
        return {
          ok: true, status: 'ready', assetId, mimeType: asset.mimeType,
          width: asset.width, height: asset.height, byteLength: 4, bytes: new Uint8Array(4),
        };
      },
      createObjectUrl: () => 'blob:preview-image',
      revokeObjectUrl: () => {},
    });
    const failedRead = await session.load('C:/temp/phase-b.pandastage', project, plan);
    expect(failedRead).toMatchObject({ status: 'degraded', degradedAssetIds: [EXPR_SMILE_ASSET], fatalAssetIds: [] });
    const fromReadFailure = buildStageRenderModel(project, frame, failedRead!.urls);
    const fromDecodeFailure = buildStageRenderModel(project, frame, urls, new Set([EXPR_SMILE_ASSET]));
    const assetVisibility = (model: ReturnType<typeof buildStageRenderModel>) =>
      model.layers.find(({ id }) => id === setup.layerId)!.parts.map(({ asset, render }) => [asset.id, render.visible]);
    expect(assetVisibility(fromReadFailure)).toEqual([
      [PART_BODY_ASSET, true], [PART_FACE_ASSET, true],
    ]);
    expect(assetVisibility(fromDecodeFailure)).toEqual(assetVisibility(fromReadFailure));
    expect(fromReadFailure.layers.find(({ id }) => id === second.layer.id)!.visual?.parts[1]!.flaGraphic?.frameOrdinal).toBe(1);
    const editor = resolveEditorTemporalAssetResolution(
      project, shot, frame, new Set(plan.requiredAssetIds.concat(plan.fallbackAssetIds).filter((id) => id !== EXPR_SMILE_ASSET)),
      new Map(), undefined, new Set([EXPR_SMILE_ASSET]),
    );
    expect(editor.visualStatusByLayer.get(setup.layerId)).toBe('expression-original-fallback');
    expect(editor.visualsByLayer.get(setup.layerId)?.parts).toEqual(fromReadFailure.layers.find(({ id }) => id === setup.layerId)!.visual?.parts);
    missing = false;
    expect(session.clearFailedExpressions('C:/temp/phase-b.pandastage', project, plan)).toBe(true);
    const ready = await session.load('C:/temp/phase-b.pandastage', project, plan);
    expect(ready?.status).toBe('ready');
    expect(assetVisibility(buildStageRenderModel(project, frame, ready!.urls))).toEqual(assetVisibility(buildStageRenderModel(project, frame, urls)));
    session.dispose();
  });

  it('evaluates ExpressionEvent across seek, enforces MouthCue > SimpleMouth > expression/original priority, and clears cleanly on rest without defaultExpression', () => {
    const setup = buildPhaseBProject({ withDefaultExpression: false });
    const AUDIO_CLIP_ID = 'c3000000-0000-4000-8000-000000000001';
    const DIALOGUE_ID = 'c3000000-0000-4000-8000-000000000002';
    const VOICE_ID = 'c3000000-0000-4000-8000-000000000003';
    const baseVoice = setup.project.voiceProfiles[0]!;
    let project = ProjectSchema.parse({
      ...setup.project,
      voiceProfiles: [
        ...setup.project.voiceProfiles,
        {
          ...baseVoice,
          id: VOICE_ID,
          characterId: setup.characterId,
          name: 'HeroVoice',
        },
      ],
      shots: setup.project.shots.map((shot) => ({
        ...shot,
        audioClips: [
          {
            id: AUDIO_CLIP_ID,
            name: '对白',
            assetId: AUDIO_ASSET,
            role: 'dialogue' as const,
            startMs: 0,
            endMs: 1200,
            offsetMs: 0,
            volume: 1,
          },
        ],
        dialogues: [
          {
            id: DIALOGUE_ID,
            characterId: setup.characterId,
            voiceProfileId: VOICE_ID,
            subtitleStyleId: IDS.subtitle,
            audioClipId: AUDIO_CLIP_ID,
            text: '你好呀',
            startMs: 0,
            endMs: 1200,
          },
        ],
      })),
    });

    // Author ExpressionEvent at 320ms -> Angry (FLA Graphic), then MouthCue rest at 600ms, open at 800ms
    project = upsertExpressionEventAtTime(project, setup.shotId, setup.layerId, setup.angryExprId, 320);
    project = upsertMouthCueEventAtTime(project, setup.shotId, setup.layerId, 'rest', 600);
    project = upsertMouthCueEventAtTime(project, setup.shotId, setup.layerId, 'open', 800);
    // Validate new candidate expression & mouth-cue events against shot
    expect(
      validatePresetApplication(project, setup.shotId, setup.layerId, [
        {
          id: 'c3000000-0000-4000-8000-000000000099',
          type: 'expression',
          layerId: setup.layerId,
          startMs: 900,
          endMs: 900,
          expressionId: setup.smileExprId,
        },
        {
          id: 'c3000000-0000-4000-8000-000000000098',
          type: 'mouth-cue',
          layerId: setup.layerId,
          startMs: 950,
          endMs: 950,
          state: 'open',
        },
      ]).ok,
    ).toBe(true);

    const shot = project.shots[0]!;
    const evalProjected = (timeMs: number) =>
      projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, timeMs, project));
    const facePartAt = (timeMs: number) =>
      resolveLayerVisualParts(
        project,
        shot,
        evalProjected(timeMs).layers.find((l) => l.id === setup.layerId)!,
        timeMs,
      ).parts.find((p) => p.partId === `${setup.layerId}:${PART_FACE_ID}`)!;

    // At 50ms: SimpleMouth is inside open phase (50 % 320 < 160ms), no MouthCue -> shows MouthOpenPng!
    expect(facePartAt(50).assetId).toBe(MOUTH_OPEN_ASSET);
    // At 200ms: SimpleMouth is closed phase (200 % 320 >= 160ms), no defaultExpression -> original part PNG!
    expect(facePartAt(200).assetId).toBe(PART_FACE_ASSET);
    // At 340ms: SimpleMouth open phase (340 % 320 = 20 < 160ms) STILL overrides ExpressionEvent when cue=none!
    expect(facePartAt(340).assetId).toBe(MOUTH_OPEN_ASSET);
    // At 660ms (660 % 320 = 20 < 160ms SimpleMouth open): MouthCue 'rest' (since 600ms) overrides SimpleMouth -> shows Angry Expression (FLA Graphic)!
    expect(facePartAt(660).flaGraphic?.frameOrdinal).toBe(1);
    // At 800ms (800 % 320 = 160 >= 160ms SimpleMouth closed): MouthCue 'open' overrides closed phase!
    expect(facePartAt(800).assetId).toBe(MOUTH_OPEN_ASSET);

    // Export preparation includes MOUTH_OPEN_ASSET and FLA graphic resources; ProductPreview links mouthFallback!
    const exportMedia = collectExportPreparationMedia(project);
    expect(exportMedia.some((entry) => entry.asset.id === MOUTH_OPEN_ASSET)).toBe(true);
    const previewPlan = buildProductPreviewImagePlan(project, shot, evalProjected(800));
    expect(
      previewPlan.mouthFallbacks.some((m) => m.partId === `${setup.layerId}:${PART_FACE_ID}`),
    ).toBe(true);

    // Stage render parity check at 660ms (rest -> Angry Graphic frameOrdinal 1)
    const stage660 = buildStageRenderModel(
      project,
      evalProjected(660),
      Object.fromEntries(project.assets.filter((a) => a.kind === 'image').map((a) => [a.id, `file:///assets/${a.id}.png`])),
    );
    expect(
      stage660.layers.find((l) => l.id === setup.layerId)!.parts.find((p) => p.id === `${setup.layerId}:${PART_FACE_ID}`)!.flaGraphic?.frameOrdinal,
    ).toBe(1);
  });

  it('restores original face cleanly on MouthCue rest before any ExpressionEvent when defaultExpressionId is unset, and falls back safely if mouth asset missing', () => {
    const setup = buildPhaseBProject({ withDefaultExpression: false, useGraphicMouth: false });
    let project = setup.project;
    project = upsertMouthCueEventAtTime(project, setup.shotId, setup.layerId, 'open', 0);
    project = upsertMouthCueEventAtTime(project, setup.shotId, setup.layerId, 'rest', 400);

    const shot = project.shots[0]!;
    const evalAt = (timeMs: number) =>
      projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, timeMs, project));
    const layerRest = resolveLayerVisualParts(
      project,
      shot,
      evalAt(450).layers.find((l) => l.id === setup.layerId)!,
      450,
    );
    expect(layerRest.parts.find((p) => p.partId === `${setup.layerId}:${PART_FACE_ID}`)!.assetId).toBe(PART_FACE_ASSET);

    // Missing mouth image asset falls back locally to expression or original face without throwing
    const brokenProject: Project = {
      ...project,
      assets: project.assets.filter((a) => a.id !== MOUTH_OPEN_ASSET),
    };
    const brokenEval = projectShotDialogueVisual(
      brokenProject,
      shot,
      evaluateShotAtTime(shot, 100, brokenProject),
    );
    const fallbackVisual = resolveLayerVisualParts(
      brokenProject,
      shot,
      brokenEval.layers.find((l) => l.id === setup.layerId)!,
      100,
    );
    expect(fallbackVisual.parts.find((p) => p.partId === `${setup.layerId}:${PART_FACE_ID}`)!.assetId).toBe(PART_FACE_ASSET);
  });

  it('keeps two independent AdaptivePartsCharacter instances isolated across Expression & MouthCue playback', () => {
    const setup = buildPhaseBProject({ useGraphicMouth: false });
    const charSvc = new CharacterService();
    let project = charSvc.createAdaptiveParts(setup.project, {
      name: 'AdaptiveClone',
      parts: (setup.project.characters.find((c) => c.id === setup.characterId) as AdaptivePartsCharacter).parts,
    });
    const clone = project.characters.at(-1) as AdaptivePartsCharacter;
    const layer2Res = new LayerService().createFromAdaptiveCharacter(
      project,
      setup.shotId,
      clone.id,
      { x: 640, y: 540 },
    );
    project = layer2Res.project;
    project = upsertMouthCueEventAtTime(project, setup.shotId, setup.layerId, 'open', 0);

    const shot = project.shots[0]!;
    const evaluated = projectShotDialogueVisual(
      project,
      shot,
      evaluateShotAtTime(shot, 100, project),
    );
    const v1 = resolveLayerVisualParts(project, shot, evaluated.layers.find((l) => l.id === setup.layerId)!, 100);
    const v2 = resolveLayerVisualParts(project, shot, evaluated.layers.find((l) => l.id === layer2Res.layer.id)!, 100);
    expect(v1.parts.find((p) => p.partId === `${setup.layerId}:${PART_FACE_ID}`)!.assetId).toBe(MOUTH_OPEN_ASSET);
    // Unbound clone keeps its own original face asset untouched
    expect(v2.parts.find((p) => p.partId === `${layer2Res.layer.id}:${clone.parts[1]!.partId}`)!.assetId).toBe(PART_FACE_ASSET);
  });

  it('supports MouthOpen PNG/Graphic configuration & preview in AdaptivePartsAssemblyWorkbench plus ExpressionAtTimeControl & ActionPresetPanel UI', () => {
    const setup = buildPhaseBProject({ includeMouth: false });
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
    const stubDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    (window as { pandaStage?: unknown }).pandaStage = {
      assets: {
        readThumbnail: async () => ({
          ok: true,
          value: { kind: 'thumbnail', status: 'ready', dataUrl: stubDataUrl },
        }),
        readAssetUrl: async () => ({ ok: true, value: stubDataUrl }),
      },
    };
    editorProjectStore.open('C:/temp/phase-b.pandastage', setup.project);
    shotStore.select(setup.shotId);
    selectionStore.selectExplicit(setup.layerId);
    const began = characterAssemblySessionStore.beginAdaptiveParts(setup.characterId);
    expect(began.ok).toBe(true);
    characterAssemblySessionStore.setAssemblyContinuityOwner(setup.characterId);
    timelineUiStore.seek(200, 2400);

    mountedContainer = document.createElement('div');
    document.body.appendChild(mountedContainer);
    mountedRoot = createRoot(mountedContainer);

    function Harness() {
      const snap = useSyncExternalStore(
        (l) => editorProjectStore.subscribe(l),
        () => editorProjectStore.getSnapshot(),
      );
      const rawSession = useSyncExternalStore(
        characterAssemblySessionStore.subscribe,
        characterAssemblySessionStore.getSnapshot,
        characterAssemblySessionStore.getSnapshot,
      );
      if (!snap || !rawSession || !isAdaptivePartsAssemblySnapshot(rawSession)) {
        return null;
      }
      const currentShot = snap.project.shots[0]!;
      const currentLayer = currentShot.layers.find((l) => l.id === setup.layerId)!;
      return createElement(
        'div',
        null,
        createElement(CharacterAssemblyWorkbench, {
          projectSnapshot: snap,
          session: rawSession,
        }),
        createElement(ExpressionAtTimeControl, {
          layer: currentLayer,
          project: snap.project,
          projectRoot: 'C:/temp/phase-b.pandastage',
          shot: currentShot,
        }),
        createElement(ActionPresetPanel),
      );
    }

    act(() => {
      mountedRoot!.render(createElement(Harness));
    });

    // Switch to 表情 tab and configure 张嘴图 using ResourceSwapDialog -> PNG MouthOpenPng
    const exprTabBtn = mountedContainer.querySelector(
      '[data-testid="adaptive-parts-tab-expressions"]',
    ) as HTMLButtonElement;
    act(() => exprTabBtn.click());
    expect(mountedContainer.querySelector('[data-testid="adaptive-mouth-visual-picker"]')).not.toBeNull();
    const swapBtn = mountedContainer.querySelector('[data-testid="adaptive-mouth-swap-button"]') as HTMLButtonElement;
    act(() => swapBtn.click());
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    const pngOption = [...dialog.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('MouthOpenPng'),
    ) as HTMLButtonElement;
    act(() => pngOption.click());
    const confirmBtn = dialog.querySelector('[data-testid="character-swap-confirm"]') as HTMLButtonElement;
    act(() => confirmBtn.click());

    let charAfter = editorProjectStore.getSnapshot()!.project.characters.find(
      (c) => c.id === setup.characterId,
    ) as AdaptivePartsCharacter;
    expect(charAfter.mouthOpenAssetId).toBe(MOUTH_OPEN_ASSET);

    // Preview button activates canvas replacement with MOUTH_OPEN_ASSET
    const previewBtn = mountedContainer.querySelector('[data-testid="adaptive-mouth-preview-button"]') as HTMLButtonElement;
    act(() => previewBtn.click());
    expect(previewBtn.getAttribute('aria-pressed')).toBe('true');

    // Clear mouth open -> clears config -> History Undo restores MOUTH_OPEN_ASSET!
    const clearBtn = mountedContainer.querySelector('[data-testid="adaptive-mouth-clear-button"]') as HTMLButtonElement;
    act(() => clearBtn.click());
    charAfter = editorProjectStore.getSnapshot()!.project.characters.find(
      (c) => c.id === setup.characterId,
    ) as AdaptivePartsCharacter;
    expect(charAfter.mouthOpenAssetId).toBeUndefined();
    expect(charAfter.mouthOpenVisualSource).toBeUndefined();

    act(() => {
      editorProjectStore.undo();
    });
    charAfter = editorProjectStore.getSnapshot()!.project.characters.find(
      (c) => c.id === setup.characterId,
    ) as AdaptivePartsCharacter;
    expect(charAfter.mouthOpenAssetId).toBe(MOUTH_OPEN_ASSET);

    // Also test switching Mouth Open via store to FLA Graphic SingleFrame
    act(() => {
      characterStore.setMouthOpenVisualSource(setup.characterId, faceSource(1));
    });
    charAfter = editorProjectStore.getSnapshot()!.project.characters.find(
      (c) => c.id === setup.characterId,
    ) as AdaptivePartsCharacter;
    expect(charAfter.mouthOpenVisualSource?.kind).toBe('fla-graphic');

    // Verify ActionPresetPanel enables expression-switch for bound adaptive-parts
    const exprPresetBtn = mountedContainer.querySelector(
      '[data-testid="preset-expression-switch"]',
    ) as HTMLButtonElement;
    expect(exprPresetBtn.disabled).toBe(false);
    // Verify ExpressionAtTimeControl renders Expression & Mouth Cue controls
    expect(
      mountedContainer.querySelector('[data-testid="mouth-cue-at-time"]'),
    ).not.toBeNull();
    expect(
      mountedContainer.querySelector('[data-testid="mouth-cue-open-button"]'),
    ).not.toBeNull();
  });
});
