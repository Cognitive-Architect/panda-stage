// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterMotionService,
  CharacterService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  evaluateShotAtTime,
  migrateProject,
  planCharacterBodyPose,
  planMappedCharacterMotion,
  projectShotDialogueVisual,
  removeAdaptivePartFromDefinition,
  resolveLayerVisualParts,
  resolveTalkingHeadMotionTransform,
  saveLayeredCharacterAction,
  saveCharacterBodyPose,
  setManualMouthPose,
  suggestCharacterMotionMapping,
  upsertCharacterActionEvent,
  upsertExpressionEventAtTime,
  upsertMouthCueEventAtTime,
  type AdaptivePartsCharacter,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { projectProductPreviewDialogue } from '../../src/renderer/shell/productPreviewModel';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { isAdaptivePartsAssemblySnapshot } from '../../src/renderer/features/characters/characterAssemblyPreview';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import { characterStore } from '../../src/renderer/stores/characterStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { faceSource, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const ASSET_BACK_HAIR = 'd1000000-0000-4000-8000-000000000001';
const ASSET_BODY = 'd1000000-0000-4000-8000-000000000002';
const ASSET_HEAD = 'd1000000-0000-4000-8000-000000000003';
const ASSET_FACE = 'd1000000-0000-4000-8000-000000000004';
const ASSET_FRONT_HAIR = 'd1000000-0000-4000-8000-000000000005';
const ASSET_SMILE = 'd1000000-0000-4000-8000-000000000006';
const ASSET_MOUTH = 'd1000000-0000-4000-8000-000000000007';
const ASSET_AUDIO = 'd1000000-0000-4000-8000-000000000008';

const PART_BACK_HAIR = 'd2000000-0000-4000-8000-000000000001';
const PART_BODY = 'd2000000-0000-4000-8000-000000000002';
const PART_HEAD = 'd2000000-0000-4000-8000-000000000003';
const PART_FACE = 'd2000000-0000-4000-8000-000000000004';
const PART_FRONT_HAIR = 'd2000000-0000-4000-8000-000000000005';
const AUDIO_CLIP_ID = 'd3000000-0000-4000-8000-000000000001';
const DIALOGUE_ID = 'd3000000-0000-4000-8000-000000000002';
const VOICE_ID = 'd3000000-0000-4000-8000-000000000003';

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

function makePart(
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

function buildPhaseCProject(options?: { withDialogue?: boolean; withClipV1?: boolean }): {
  project: Project;
  characterId: string;
  layerId: string;
  smileExprId: string;
  graphicExprId: string;
} {
  const base = graphicFaceProject(true);
  const charSvc = new CharacterService();
  let project = ProjectSchema.parse({
    ...base,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    assets: [
      ...base.assets,
      imageAsset(ASSET_BACK_HAIR, '后发', 180, 260),
      imageAsset(ASSET_BODY, '衣服身体', 220, 320),
      imageAsset(ASSET_HEAD, '头', 150, 150),
      imageAsset(ASSET_FACE, '原脸', 90, 60),
      imageAsset(ASSET_FRONT_HAIR, '前发', 160, 140),
      imageAsset(ASSET_SMILE, '笑脸PNG', 120, 90),
      imageAsset(ASSET_MOUTH, '张嘴PNG', 120, 90),
      {
        id: ASSET_AUDIO,
        kind: 'audio',
        name: '对白',
        relativePath: 'assets/talk.wav',
        mimeType: 'audio/wav',
        durationMs: 1200,
      },
    ],
  });

  project = charSvc.createAdaptiveParts(project, {
    name: '小师妹完整版',
    parts: [
      makePart(PART_BACK_HAIR, '后发', ASSET_BACK_HAIR, 180, 260, 0, -90, -200),
      makePart(PART_BODY, '衣服', ASSET_BODY, 220, 320, 1, -110, -40),
      makePart(PART_HEAD, '头', ASSET_HEAD, 150, 150, 2, -75, -180),
      makePart(PART_FACE, '原脸', ASSET_FACE, 90, 60, 3, -45, -120),
      makePart(PART_FRONT_HAIR, '前发', ASSET_FRONT_HAIR, 160, 140, 4, -80, -190),
    ],
  });
  const charId = project.characters.at(-1)!.id;
  project = charSvc.setAdaptivePartsFaceBinding(project, charId, { targetPartId: PART_FACE });
  project = charSvc.addExpression(project, charId, { name: '笑脸PNG', assetId: ASSET_SMILE });
  project = charSvc.addExpression(project, charId, { name: '生气元件', visualSource: faceSource(1) });
  const boundChar = project.characters.find((c) => c.id === charId) as AdaptivePartsCharacter;
  const smileExprId = boundChar.expressions![0]!.id;
  const graphicExprId = boundChar.expressions![1]!.id;
  project = charSvc.setDefaultExpression(project, charId, smileExprId);
  project = charSvc.setMouthOpenAsset(project, charId, ASSET_MOUTH);
  project = charSvc.setAdaptivePartsHeadMotionBinding(project, charId, [
    PART_BACK_HAIR,
    PART_HEAD,
    PART_FACE,
    PART_FRONT_HAIR,
  ]);

  const layerRes = new LayerService().createFromAdaptiveCharacter(project, IDS.shot, charId, { x: 960, y: 540 });
  project = layerRes.project;

  const baseVoice = project.voiceProfiles[0]!;
  if (options?.withDialogue !== false) {
    project = ProjectSchema.parse({
      ...project,
      voiceProfiles: [
        ...project.voiceProfiles,
        { ...baseVoice, id: VOICE_ID, characterId: charId, name: '小师妹音色' },
      ],
      shots: project.shots.map((shot) => ({
        ...shot,
        durationMs: 2400,
        audioClips: [
          {
            id: AUDIO_CLIP_ID,
            name: '对白',
            assetId: ASSET_AUDIO,
            role: 'dialogue' as const,
            startMs: 100,
            endMs: 1300,
            offsetMs: 0,
            volume: 1,
          },
        ],
        dialogues: [
          {
            id: DIALOGUE_ID,
            characterId: charId,
            voiceProfileId: VOICE_ID,
            subtitleStyleId: IDS.subtitle,
            audioClipId: AUDIO_CLIP_ID,
            text: '小师妹来了',
            startMs: 100,
            endMs: 1300,
          },
        ],
      })),
    });
  }

  if (options?.withClipV1) {
    const motionSvc = new CharacterMotionService();
    project = motionSvc.apply(
      project,
      {
        shotId: IDS.shot,
        layerId: layerRes.layer.id,
        partId: PART_FACE,
        timeMs: 0,
        autoKey: true,
      },
      {
        'transform.offsetX': 12,
        'transform.offsetY': -6,
      },
    );
    project = motionSvc.apply(
      project,
      { shotId: IDS.shot, layerId: layerRes.layer.id, partId: PART_BODY, timeMs: 0, autoKey: true },
      { 'transform.offsetX': 8 },
    );
  }

  return { project, characterId: charId, layerId: layerRes.layer.id, smileExprId, graphicExprId };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  characterAssemblySessionStore.getActiveAdaptivePartsAssemblySessionHandle()?.cancel();
  editorProjectStore.clear();
  vi.restoreAllMocks();
});

describe('Phase C: AdaptiveParts Talking Head Motion + Combined A/B/C Parity (#1211)', () => {
  it('layers a bounded wave with the current expression and independent mouth on shuffled seeks', () => {
    const setup = buildPhaseCProject();
    const armId = 'd2000000-0000-4000-8000-000000000006';
    const mouthId = 'd2000000-0000-4000-8000-000000000007';
    const armAssetId = 'd1000000-0000-4000-8000-000000000009';
    const restMouthAssetId = 'd1000000-0000-4000-8000-000000000010';
    const poseId = 'd3000000-0000-4000-8000-000000000004';
    const poseEventId = 'd3000000-0000-4000-8000-000000000005';
    const actionId = 'd3000000-0000-4000-8000-000000000006';
    const restPose = 'd3000000-0000-4000-8000-000000000007';
    let project = ProjectSchema.parse({ ...setup.project,
      assets: [...setup.project.assets, imageAsset(armAssetId, 'Wave arm', 60, 130), imageAsset(restMouthAssetId, 'Rest mouth', 120, 90)],
      characters: setup.project.characters.map(character =>
      character.id === setup.characterId && character.mode === 'adaptive-parts' ? {
        ...character,
        parts: [...character.parts.slice(0, 4),
          makePart(mouthId, 'Independent mouth', restMouthAssetId, 120, 90, 4, -35, -95),
          { ...character.parts[4]!, drawOrder: 5 },
          makePart(armId, 'Wave arm', armAssetId, 60, 130, 6, 55, -25),
        ],
        mouthPoseSet: {
          poses: [
            { id: poseId, name: 'Open', target: { kind: 'mouth', partId: mouthId }, source: { kind: 'image', assetId: ASSET_MOUTH } },
            { id: restPose, name: 'Rest', target: { kind: 'mouth', partId: mouthId }, source: { kind: 'image', assetId: restMouthAssetId } },
          ],
          restPoseId: restPose,
          analyzerMapping: { rest: restPose, open: poseId, closed: restPose, round: poseId, wide: poseId },
          driveMode: 'mouth-poses',
        },
      } : character),
    });
    const motion = new CharacterMotionService();
    for (const [timeMs, rotation, offsetX] of [[500, 35, 18], [250, 0, 0], [750, -20, -12], [1000, 0, 0]] as const) {
      project = motion.apply(project, { shotId: IDS.shot, layerId: setup.layerId, partId: armId, timeMs, autoKey: true },
        { 'transform.rotationDeg': rotation });
      project = motion.apply(project, { shotId: IDS.shot, layerId: setup.layerId, partId: PART_BODY, timeMs, autoKey: true },
        { 'transform.offsetX': offsetX });
    }
    expect(migrateProject({ ...project, schemaVersion: 34 })).toEqual(project);
    project = saveLayeredCharacterAction(project, IDS.shot, setup.layerId, {
      name: 'Wave', startMs: 250, endMs: 1000, partIds: [armId, PART_BODY, PART_FACE, mouthId], headAnchorPartId: PART_BODY,
    }, () => actionId);
    expect(() => migrateProject({ ...project, schemaVersion: 34 })).toThrow();
    const second = new LayerService().createFromAdaptiveCharacter(project, IDS.shot, setup.characterId, { x: 600, y: 540 });
    const instanceId = second.layer.id;
    project = new CharacterService().setTalkingHeadMotionIntensityPercent(second.project, setup.characterId, 0);
    project = setManualMouthPose(project, IDS.shot, instanceId, poseEventId, { poseId, startMs: 250, endMs: 1000 });
    project = upsertExpressionEventAtTime(project, IDS.shot, instanceId, setup.graphicExprId, 500);
    project = upsertCharacterActionEvent(project, IDS.shot, instanceId, { actionId, startMs: 250, endMs: 1000 });
    project = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    const shot = project.shots[0]!;
    const urls = Object.fromEntries(project.assets.filter(({ kind }) => kind === 'image').map(({ id }) => [id, `blob:${id}`]));
    const beforeHead = resolveLayerVisualParts(project, shot,
      evaluateShotAtTime(shot, 100, project).layers.find(({ id }) => id === instanceId)!, 100)
      .parts.find(({ partId }) => partId === `${instanceId}:${PART_HEAD}`)!.imageTransform!.tx;
    for (const [time, isWaving, expressionId, headShift, mouthAsset] of [
      [1350, false, setup.graphicExprId, 0, restMouthAssetId], [750, true, setup.graphicExprId, -12, ASSET_MOUTH],
      [50, false, setup.smileExprId, 0, restMouthAssetId], [500, true, setup.graphicExprId, 18, ASSET_MOUTH],
      [100, false, setup.smileExprId, 0, ASSET_MOUTH],
    ] as const) {
      const evaluated = projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, time, project));
      const layer = evaluated.layers.find(({ id }) => id === instanceId)!;
      const visual = resolveLayerVisualParts(project, shot, layer, time);
      expect(layer.currentExpressionId).toBe(expressionId);
      expect(evaluated.layers.find(({ id }) => id === setup.layerId)?.layeredCharacterAction).toBeUndefined();
      expect(visual.parts.map(({ partId }) => partId)).toEqual([PART_BACK_HAIR, PART_BODY, PART_HEAD, PART_FACE,
        mouthId, PART_FRONT_HAIR, armId].map(id => `${instanceId}:${id}`));
      const face = visual.parts.find(({ partId }) => partId === `${instanceId}:${PART_FACE}`)!;
      expect(face.assetId).not.toBe(ASSET_FACE);
      if (expressionId === setup.graphicExprId) expect(face.flaGraphic?.frameOrdinal).toBe(1);
      else expect(face.assetId).toBe(ASSET_SMILE);
      const mouth = visual.parts.find(({ partId }) => partId === `${instanceId}:${mouthId}`)!;
      expect(mouth.assetId).toBe(mouthAsset);
      const head = visual.parts.find(({ partId }) => partId === `${instanceId}:${PART_HEAD}`)!;
      expect(head.imageTransform!.tx - beforeHead).toBeCloseTo(headShift);
      const arm = visual.parts.find(({ partId }) => partId === `${instanceId}:${armId}`)!;
      expect(Math.abs(arm.imageTransform!.b) > 0.001).toBe(isWaving);
      const mesh = buildStageRenderModel(project, evaluated, urls).layers;
      expect(buildStageRenderModel(project, evaluateExportShotAtTime(project, shot, time), urls).layers).toEqual(mesh);
      expect(buildStageRenderModel(project, projectProductPreviewDialogue(project, shot, evaluateShotAtTime(shot, time, project)), urls).layers)
        .toEqual(mesh);
    }
    const characters = new CharacterService();
    const definition = characters.getAdaptivePartsDefinition(project, setup.characterId);
    const missingArm = characters.applyAdaptivePartsDefinition(project, setup.characterId, removeAdaptivePartFromDefinition(definition, armId));
    const missingArmShot = missingArm.shots[0]!;
    const evaluated = projectShotDialogueVisual(missingArm, missingArmShot, evaluateShotAtTime(missingArmShot, 500, missingArm));
    const remaining = resolveLayerVisualParts(missingArm, missingArmShot, evaluated.layers.find(({ id }) => id === instanceId)!, 500);
    const missingHeadBefore = resolveLayerVisualParts(missingArm, missingArmShot,
      evaluateShotAtTime(missingArmShot, 50, missingArm).layers.find(({ id }) => id === instanceId)!, 50)
      .parts.find(({ partId }) => partId === `${instanceId}:${PART_HEAD}`)!.imageTransform!.tx;
    expect(remaining.parts.some(({ partId }) => partId === `${instanceId}:${armId}`)).toBe(false);
    expect(remaining.parts.find(({ partId }) => partId === `${instanceId}:${mouthId}`)?.assetId).toBe(ASSET_MOUTH);
    expect(remaining.parts.find(({ partId }) => partId === `${instanceId}:${PART_HEAD}`)?.imageTransform?.tx)
      .toBeCloseTo(missingHeadBefore + 18);

    const savedPoseId = 'd3000000-0000-4000-8000-000000000008';
    const captureAddress = { shotId: shot.id, layerId: instanceId, timeMs: 500 };
    const applyAddress = { ...captureAddress, timeMs: 1500 };
    expect(migrateProject({ ...project, schemaVersion: 35 })).toEqual(project);
    project = saveCharacterBodyPose(project, captureAddress, 'Wave pose', [PART_BODY, armId, PART_FACE, mouthId], () => savedPoseId);
    expect(() => migrateProject({ ...project, schemaVersion: 35 })).toThrow();
    project = setManualMouthPose(project, shot.id, instanceId, 'd3000000-0000-4000-8000-000000000009',
      { poseId, startMs: 1400, endMs: 1650 });
    project = migrateProject(JSON.parse(JSON.stringify(project)));
    const beforePose = project;
    const currentPose = beforePose.characters.find(({ id }) => id === setup.characterId);
    expect(currentPose?.mode === 'adaptive-parts' && currentPose.bodyPoses?.[0]?.parts.map(({ partId }) => partId))
      .toEqual([PART_BODY, armId]);
    const partial = characters.applyAdaptivePartsDefinition(beforePose, setup.characterId,
      removeAdaptivePartFromDefinition(characters.getAdaptivePartsDefinition(beforePose, setup.characterId), armId));
    const partialPlan = planCharacterBodyPose(partial, applyAddress, savedPoseId);
    expect(partialPlan.missingPartIds).toEqual([armId]);
    expect(partialPlan.project).not.toBe(partial);
    expect(planCharacterBodyPose(beforePose, captureAddress, savedPoseId).actionPartIds).toEqual([PART_BODY, armId]);

    editorProjectStore.open('C:/temp/body-pose.pandastage', beforePose);
    const beforeSnapshot = editorProjectStore.getSnapshot()!;
    const preview = planCharacterBodyPose(beforePose, applyAddress, savedPoseId);
    expect(editorProjectStore.getSnapshot()).toBe(beforeSnapshot);
    editorProjectStore.updateProject(preview.project, '应用身体姿势');
    expect(editorProjectStore.getSnapshot()!.revision).toBe(beforeSnapshot.revision + 1);
    const afterPose = migrateProject(JSON.parse(JSON.stringify(editorProjectStore.getSnapshot()!.project)));
    const beforeShot = beforePose.shots[0]!;
    const afterShot = afterPose.shots[0]!;
    expect(afterShot.timelineEvents).toEqual(beforeShot.timelineEvents);
    expect(afterShot.layers.find(({ id }) => id === setup.layerId)).toEqual(beforeShot.layers.find(({ id }) => id === setup.layerId));
    expect(afterPose.characters).toEqual(beforePose.characters);
    const appliedEvaluation = projectShotDialogueVisual(afterPose, afterShot, evaluateShotAtTime(afterShot, 1500, afterPose));
    const applied = resolveLayerVisualParts(afterPose, afterShot, appliedEvaluation.layers.find(({ id }) => id === instanceId)!, 1500);
    expect(applied.parts.find(({ partId }) => partId === `${instanceId}:${armId}`)?.imageTransform?.b).toBeCloseTo(Math.sin(35 * Math.PI / 180));
    expect(applied.parts.find(({ partId }) => partId === `${instanceId}:${PART_FACE}`)?.flaGraphic?.frameOrdinal).toBe(1);
    expect(applied.parts.find(({ partId }) => partId === `${instanceId}:${mouthId}`)?.assetId).toBe(ASSET_MOUTH);
    editorProjectStore.undo();
    expect(editorProjectStore.getSnapshot()!.project).toEqual(beforePose);
    editorProjectStore.redo();
    expect(editorProjectStore.getSnapshot()!.project).toEqual(afterPose);
  });

  it('maps a layered action between two characters with an adjusted pivot and a missing part', () => {
    const setup = buildPhaseCProject();
    const characters = new CharacterService();
    const motion = new CharacterMotionService();
    const id = 'd3000000-0000-4000-8000-000000000015';
    const key = { shotId: IDS.shot, layerId: setup.layerId, timeMs: 250, autoKey: true };
    let project = motion.apply(setup.project, { ...key, partId: PART_BODY },
      { 'transform.rotationDeg': 55, 'transform.offsetX': 20, 'transform.offsetY': 13 });
    project = motion.apply(project, { ...key, partId: PART_FRONT_HAIR }, { 'transform.rotationDeg': 14 });
    project = saveLayeredCharacterAction(project, IDS.shot, setup.layerId, {
      name: 'Wave', startMs: 0, endMs: 500, partIds: [PART_BODY, PART_FRONT_HAIR], headAnchorPartId: PART_BODY,
    }, () => id);
    const source = project.characters.find(({ id: characterId }) => characterId === setup.characterId)!;
    if (source.mode !== 'adaptive-parts') throw new Error('Expected a source Adaptive Parts Character.');
    const sourceAction = source.actions![0]!;
    if (!('kind' in sourceAction)) throw new Error('Expected a layered action.');
    const targetParts = source.parts.filter(({ partId }) => partId !== PART_FRONT_HAIR).map((part, index) => ({
      ...part, partId: `d2300000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }));
    const bodyId = targetParts[1]!.partId;
    const faceId = targetParts[3]!.partId;
    project = characters.createAdaptiveParts(project, { name: 'Second Character', parts: targetParts });
    const targetId = project.characters.at(-1)!.id;
    project = characters.setAdaptivePartsFaceBinding(project, targetId, { targetPartId: faceId });
    project = characters.addExpression(project, targetId, { name: 'Target face', visualSource: faceSource(1) });
    project = characters.setMouthOpenAsset(project, targetId, ASSET_MOUTH);
    const target = project.characters.at(-1)!;
    if (target.mode !== 'adaptive-parts') throw new Error('Expected a target Adaptive Parts Character.');
    const targetExpression = target.expressions![0]!.id;
    const layerService = new LayerService();
    const one = layerService.createFromAdaptiveCharacter(project, IDS.shot, targetId, { x: 1350, y: 570 });
    const two = layerService.createFromAdaptiveCharacter(one.project, IDS.shot, targetId, { x: 1560, y: 410 });
    const oneId = one.layer.id;
    project = upsertExpressionEventAtTime(two.project, IDS.shot, oneId, targetExpression, 625);
    project = upsertMouthCueEventAtTime(project, IDS.shot, oneId, 'open', 700);
    const suggested = suggestCharacterMotionMapping(source, sourceAction, target);
    expect(suggested.find(rule => rule.sourcePartId === PART_BODY)?.targetPartId).toBe(bodyId);
    expect(suggested.find(rule => rule.sourcePartId === PART_FRONT_HAIR)?.targetPartId).toBeUndefined();
    const rules = suggested.map(rule => rule.sourcePartId !== PART_BODY ? rule : {
      ...rule, mirror: true, translationScale: 2, pivotOffset: { x: 12, y: 0 },
      properties: rule.properties.filter(property => property !== 'transform.offsetY'),
    });
    const mapping = { sourceCharacterId: source.id, sourceActionId: id, rules };
    const noPivot = planMappedCharacterMotion(project, IDS.shot, oneId, 500, { ...mapping,
      rules: rules.map(rule => ({ ...rule, pivotOffset: { x: 0, y: 0 } })),
    });
    const planned = planMappedCharacterMotion(project, IDS.shot, oneId, 500, mapping);
    expect(planned.missingSourcePartIds).toEqual([PART_FRONT_HAIR]);
    expect(migrateProject({ ...project, schemaVersion: 37 })).toEqual(project);
    expect(() => migrateProject({ ...planned.project, schemaVersion: 37 })).toThrow();
    const opened = migrateProject(JSON.parse(JSON.stringify(planned.project)));
    const sameSource = opened.characters.find(({ id: characterId }) => characterId === source.id);
    expect(sameSource).toEqual(source);
    const mappedTarget = opened.characters.find(({ id: characterId }) => characterId === target.id)!;
    if (mappedTarget.mode !== 'adaptive-parts') throw new Error('Expected a mapped Adaptive Parts Character.');
    expect(mappedTarget.motionMappings?.[0]?.rules).toEqual(rules);
    const action = mappedTarget.actions?.[0];
    expect(action && 'kind' in action && action.tracks.map(track => [track.partId, track.property, track.keys[1]?.value]))
      .toEqual([[bodyId, 'transform.rotationDeg', -55], [bodyId, 'transform.offsetX', -40]]);

    function at(snapshot: Project, timeMs: number) {
      const shot = snapshot.shots[0]!;
      const evaluated = projectShotDialogueVisual(snapshot, shot, evaluateShotAtTime(shot, timeMs, snapshot));
      const layer = evaluated.layers.find(({ id: layerId }) => layerId === oneId)!;
      const visual = resolveLayerVisualParts(snapshot, shot, layer, timeMs);
      const body = visual.parts.find(({ partId }) => partId === `${oneId}:${bodyId}`)!;
      return { shot, layer, body, evaluated, visual };
    }
    const mid = at(opened, 750);
    expect(mid.layer.x).toBe(one.layer.x);
    expect(mid.layer.y).toBe(one.layer.y);
    expect(mid.visual.activeFace).toMatchObject({ currentExpressionId: targetExpression, assetId: ASSET_MOUTH });
    expect(mid.body.imageTransform!.tx - at(noPivot.project, 750).body.imageTransform!.tx)
      .toBeCloseTo(12 * (1 - Math.cos(55 * Math.PI / 180)));
    expect(at(opened, 1050).layer.layeredCharacterAction).toBeUndefined();
    expect(at(opened, 400).layer.layeredCharacterAction).toBeUndefined();
    const urls = Object.fromEntries(opened.assets.filter(({ kind }) => kind === 'image').map(({ id: assetId }) => [assetId, `blob:${assetId}`]));
    expect(buildStageRenderModel(opened, evaluateExportShotAtTime(opened, mid.shot, 750), urls).layers)
      .toEqual(buildStageRenderModel(opened, mid.evaluated, urls).layers);
    expect(mid.evaluated.layers.find(({ id: layerId }) => layerId === two.layer.id)?.layeredCharacterAction).toBeUndefined();
    const repeat = planMappedCharacterMotion(opened, IDS.shot, oneId, 1250, mapping).project;
    expect(repeat.characters).toEqual(opened.characters);
    expect(repeat.shots[0]!.timelineEvents.filter(event => event.type === 'character-action')).toHaveLength(2);
    editorProjectStore.open('C:/temp/body-mapping.pandastage', project);
    editorProjectStore.updateProject(planned.project, '应用跨角色动作');
    editorProjectStore.undo();
    expect(editorProjectStore.getSnapshot()!.project).toEqual(project);
    editorProjectStore.redo();
    expect(editorProjectStore.getSnapshot()!.project).toEqual(planned.project);
  });

  it('moves only head-bound parts (including replaced face expressions/mouth) while preserving drawOrder (backHair behind body), neutral outside dialogue, and Stage/Export parity', () => {
    const setup = buildPhaseCProject({ withDialogue: true });
    let project = setup.project;
    project = upsertExpressionEventAtTime(project, IDS.shot, setup.layerId, setup.graphicExprId, 200);
    project = upsertMouthCueEventAtTime(project, IDS.shot, setup.layerId, 'rest', 200);

    const assetUrls = Object.fromEntries(
      project.assets.filter((a) => a.kind === 'image').map((a) => [a.id, `file:///assets/${a.id}.png`]),
    );
    const partMatrixMap = (evaluatedTimeMs: number, proj = project) => {
      const s = proj.shots[0]!;
      const evalShot = projectShotDialogueVisual(proj, s, evaluateShotAtTime(s, evaluatedTimeMs, proj));
      const exportEvalShot = evaluateExportShotAtTime(proj, s, evaluatedTimeMs);
      const layer = evalShot.layers.find((l) => l.id === setup.layerId)!;
      const visual = resolveLayerVisualParts(proj, s, layer, evaluatedTimeMs);
      expect(visual.headGroup).toBeNull();
      const stageModel = buildStageRenderModel(proj, evalShot, assetUrls);
      const exportStageModel = buildStageRenderModel(proj, exportEvalShot, assetUrls);
      const stageParts = stageModel.layers.find((l) => l.id === setup.layerId)!.parts;
      const exportParts = exportStageModel.layers.find((l) => l.id === setup.layerId)!.parts;
      expect(stageParts).toEqual(exportParts);
      return { visual, stageParts };
    };

    // Baseline before dialogue (t = 50ms) -> zero head motion
    const neutral = partMatrixMap(50);
    // Mid-dialogue non-zero phase (t = 225ms, elapsed = 125ms) -> expected negative bob
    const talking = partMatrixMap(225);
    const expectedBob = resolveTalkingHeadMotionTransform(125, 1200, 100);
    expect(expectedBob.translateX).not.toBe(0);

    const partById = (parts: typeof neutral.visual.parts, pid: string) =>
      parts.find((p) => p.partId === `${setup.layerId}:${pid}`)!;

    const project0 = new CharacterService().setTalkingHeadMotionIntensityPercent(project, setup.characterId, 0);
    const talking0 = partMatrixMap(225, project0);

    // Unbound body MUST remain stationary; backHair/head/replaced-face/frontHair move by expectedBob!
    expect(partById(talking.visual.parts, PART_BODY).imageTransform).toEqual(
      partById(neutral.visual.parts, PART_BODY).imageTransform,
    );
    for (const boundId of [PART_BACK_HAIR, PART_HEAD, PART_FACE, PART_FRONT_HAIR]) {
      const nTx = partById(talking0.visual.parts, boundId).imageTransform!.tx;
      const tTx = partById(talking.visual.parts, boundId).imageTransform!.tx;
      const nTy = partById(talking0.visual.parts, boundId).imageTransform!.ty;
      const tTy = partById(talking.visual.parts, boundId).imageTransform!.ty;
      expect(tTx - nTx).toBeCloseTo(expectedBob.translateX, 6);
      expect(tTy - nTy).toBeCloseTo(expectedBob.translateY, 6);
    }

    // Painter drawOrder invariant: backHair (0) stays behind body (1) which stays behind head (2) & face (3) & frontHair (4)
    expect(talking.stageParts.map((p) => p.id)).toEqual([
      `${setup.layerId}:${PART_BACK_HAIR}`,
      `${setup.layerId}:${PART_BODY}`,
      `${setup.layerId}:${PART_HEAD}`,
      `${setup.layerId}:${PART_FACE}`,
      `${setup.layerId}:${PART_FRONT_HAIR}`,
    ]);
    // At 225ms, replaced face renders Graphic expression frameOrdinal 1 AND translates with the head!
    expect(partById(talking.visual.parts, PART_FACE).flaGraphic?.frameOrdinal).toBe(1);

    // Intensity 200% doubles bob delta; intensity 0% matches stationary neutral pose
    const charSvc = new CharacterService();
    const project200 = charSvc.setTalkingHeadMotionIntensityPercent(project, setup.characterId, 200);
    const talking200 = partMatrixMap(225, project200);
    expect(
      partById(talking200.visual.parts, PART_HEAD).imageTransform!.tx -
        partById(neutral.visual.parts, PART_HEAD).imageTransform!.tx,
    ).toBeCloseTo(expectedBob.translateX * 2, 6);

    expect(partById(talking0.visual.parts, PART_HEAD).imageTransform).toEqual(
      partById(neutral.visual.parts, PART_HEAD).imageTransform,
    );

    // After dialogue ends (t = 1350ms), parts return cleanly to neutral
    const afterDialogue = partMatrixMap(1350);
    expect(partById(afterDialogue.visual.parts, PART_HEAD).imageTransform).toEqual(
      partById(neutral.visual.parts, PART_HEAD).imageTransform,
    );
    expect(partById(afterDialogue.visual.parts, PART_FACE).flaGraphic?.frameOrdinal).toBe(1);
  });

  it('preserves Clip v1 part animation keyframes while overlaying head motion delta cleanly, and keeps duplicate occurrences neutral', () => {
    const setup = buildPhaseCProject({ withDialogue: true, withClipV1: true });
    const shot = setup.project.shots[0]!;
    const evalNeutral = projectShotDialogueVisual(
      setup.project,
      shot,
      evaluateShotAtTime(shot, 50, setup.project),
    );
    const evalTalk = projectShotDialogueVisual(
      setup.project,
      shot,
      evaluateShotAtTime(shot, 225, setup.project),
    );
    const visNeutral = resolveLayerVisualParts(
      setup.project,
      shot,
      evalNeutral.layers.find((l) => l.id === setup.layerId)!,
      50,
    );
    const visTalk = resolveLayerVisualParts(
      setup.project,
      shot,
      evalTalk.layers.find((l) => l.id === setup.layerId)!,
      225,
    );
    const faceNeutral = visNeutral.parts.find((p) => p.partId === `${setup.layerId}:${PART_FACE}`)!;
    const faceTalk = visTalk.parts.find((p) => p.partId === `${setup.layerId}:${PART_FACE}`)!;
    const expectedBob = resolveTalkingHeadMotionTransform(125, 1200, 100);
    expect(faceTalk.imageTransform!.tx - faceNeutral.imageTransform!.tx).toBeCloseTo(expectedBob.translateX, 6);
    expect(faceTalk.imageTransform!.ty - faceNeutral.imageTransform!.ty).toBeCloseTo(expectedBob.translateY, 6);

    const withRest = upsertMouthCueEventAtTime(setup.project, shot.id, setup.layerId, 'rest', 200);
    const restShot = withRest.shots[0]!;
    const layerAtRest = projectShotDialogueVisual(withRest, restShot, evaluateShotAtTime(restShot, 225, withRest))
      .layers.find((layer) => layer.id === setup.layerId)!;
    const fallback = resolveLayerVisualParts(withRest, restShot, layerAtRest, 225, (id) => id === ASSET_SMILE);
    const unbound = new CharacterService().setAdaptivePartsFaceBinding(withRest, setup.characterId, null);
    const unboundShot = unbound.shots[0]!;
    const unboundLayer = projectShotDialogueVisual(unbound, unboundShot, evaluateShotAtTime(unboundShot, 225, unbound))
      .layers.find((layer) => layer.id === setup.layerId)!;
    expect(fallback.activeFace).toBeNull();
    expect(fallback.parts).toEqual(resolveLayerVisualParts(unbound, unboundShot, unboundLayer, 225).parts);
    expect(unboundShot.layers).toEqual(restShot.layers);

    const characterService = new CharacterService();
    const definition = characterService.getAdaptivePartsDefinition(withRest, setup.characterId);
    const withoutFace = characterService.applyAdaptivePartsDefinition(
      withRest, setup.characterId, removeAdaptivePartFromDefinition(definition, PART_FACE),
    );
    const removedShot = withoutFace.shots[0]!;
    const beforeClip = restShot.layers.find(({ id }) => id === setup.layerId)!.animationClip;
    const afterClip = removedShot.layers.find(({ id }) => id === setup.layerId)!.animationClip;
    expect(beforeClip?.version).toBe(1);
    expect(afterClip?.version).toBe(1);
    if (beforeClip?.version !== 1 || afterClip?.version !== 1) throw new Error('Expected Clip v1');
    expect(afterClip.tracks).toEqual(beforeClip.tracks.filter((track) => track.target.partId !== PART_FACE));
    expect(removedShot.timelineEvents).toEqual(restShot.timelineEvents);

    // Duplicate visible occurrences of same speaker character -> stays neutral
    const dup = new LayerService().createFromAdaptiveCharacter(
      setup.project,
      IDS.shot,
      setup.characterId,
      { x: 400, y: 540 },
    ).project;
    const dupShot = dup.shots[0]!;
    const dupEval = projectShotDialogueVisual(dup, dupShot, evaluateShotAtTime(dupShot, 225, dup));
    expect(dupEval.layers.every((l) => l.headGroupTransform === undefined)).toBe(true);
  });

  it('isolates automatic talking animation to each unique visible character instance', () => {
    const setup = buildPhaseCProject();
    const service = new CharacterService();
    const configured = service.setTalkingAnimation(setup.project, setup.characterId, faceSource(0).animationId);
    const original = configured.characters.find(character => character.id === setup.characterId)!;
    const otherId = crypto.randomUUID();
    const otherVoiceId = crypto.randomUUID();
    const otherClipId = crypto.randomUUID();
    const withOther = ProjectSchema.parse({
      ...configured,
      characters: [...configured.characters, { ...original, id: otherId, defaultVoiceProfileId: otherVoiceId, name: '另一位说话角色' }],
      voiceProfiles: [
        ...configured.voiceProfiles,
        { ...configured.voiceProfiles.find(voice => voice.id === VOICE_ID)!, id: otherVoiceId, characterId: otherId, name: '另一位音色' },
      ],
      shots: configured.shots.map(shot => ({
        ...shot,
        audioClips: [...shot.audioClips, { ...shot.audioClips[0], id: otherClipId, startMs: 200, endMs: 1400 }],
        dialogues: [...shot.dialogues, {
          ...shot.dialogues[0], id: crypto.randomUUID(), voiceProfileId: otherVoiceId,
          characterId: otherId, audioClipId: otherClipId, startMs: 200, endMs: 1400,
        }],
      })),
    });
    const layers = new LayerService();
    const duplicate = layers.createFromAdaptiveCharacter(withOther, IDS.shot, setup.characterId, { x: 400, y: 540 });
    const other = layers.createFromAdaptiveCharacter(duplicate.project, IDS.shot, otherId, { x: 1500, y: 540 });
    const project = other.project;
    const shot = project.shots[0]!;
    const readyAssetIds = new Set(project.assets.map(asset => asset.id));
    const frameAt = (time: number, currentShot = shot, currentProject = project) => {
      const requested = evaluateShotAtTime(currentShot, time, currentProject);
      const editor = buildEditorTemporalCanvasModel({
        project: currentProject, shot: currentShot, currentTimeMs: time,
        activeDialogueId: DIALOGUE_ID, readyAssetIds, previousVisuals: new Map(),
      }).evaluatedShot;
      const preview = projectProductPreviewDialogue(currentProject, currentShot, requested, DIALOGUE_ID);
      const exported = evaluateExportShotAtTime(currentProject, currentShot, time, DIALOGUE_ID);
      expect(editor).toEqual(preview);
      expect(exported).toEqual(preview);
      return new Map(exported.layers.map(layer => [layer.id, layer]));
    };

    const ambiguous = frameAt(225);
    for (const id of [setup.layerId, duplicate.layer.id]) {
      const instance = ambiguous.get(id)!;
      expect(instance.talkingAnimationElapsedMs).toBeUndefined();
      expect(instance.headGroupTransform).toBeUndefined();
      expect(resolveLayerVisualParts(project, shot, instance, 225).activeFace?.source).toBe('expression');
    }
    expect(ambiguous.get(other.layer.id)?.talkingAnimationElapsedMs).toBe(25);

    let authored = upsertMouthCueEventAtTime(project, shot.id, setup.layerId, 'open', 150);
    authored = upsertMouthCueEventAtTime(authored, shot.id, duplicate.layer.id, 'rest', 150);
    const manual = frameAt(225, authored.shots[0]!, authored);
    expect(manual.get(setup.layerId)?.mouthOverrideAssetId).toBe(ASSET_MOUTH);
    expect(manual.get(duplicate.layer.id)?.mouthOverrideAssetId).toBeNull();
    expect(manual.get(duplicate.layer.id)?.talkingAnimationElapsedMs).toBeUndefined();
    expect(manual.get(other.layer.id)?.talkingAnimationElapsedMs).toBe(25);

    const hidingShot = {
      ...shot,
      timelineEvents: [...shot.timelineEvents, {
        id: crypto.randomUUID(), type: 'visibility' as const, layerId: duplicate.layer.id,
        startMs: 300, endMs: 300, visible: false,
      }],
    };
    expect(frameAt(225, hidingShot).get(setup.layerId)?.talkingAnimationElapsedMs).toBeUndefined();
    const advanced = frameAt(375, hidingShot);
    expect(advanced.get(setup.layerId)?.talkingAnimationElapsedMs).toBe(275);
    expect(advanced.get(setup.layerId)?.headGroupTransform).toBeDefined();
    expect(advanced.get(duplicate.layer.id)?.visible).toBe(false);
    expect(advanced.get(duplicate.layer.id)?.talkingAnimationElapsedMs).toBeUndefined();
    expect(advanced.get(other.layer.id)?.talkingAnimationElapsedMs).toBe(175);
    expect(resolveLayerVisualParts(project, hidingShot, advanced.get(setup.layerId)!, 375)
      .parts.find(part => part.flaGraphic)?.flaGraphic?.frameOrdinal).toBe(2);
    expect(resolveLayerVisualParts(project, hidingShot, advanced.get(other.layer.id)!, 375)
      .parts.find(part => part.flaGraphic)?.flaGraphic?.frameOrdinal).toBe(0);
    expect(frameAt(375, hidingShot)).toEqual(advanced);
    expect(frameAt(1300, hidingShot).get(setup.layerId)?.talkingAnimationElapsedMs).toBeUndefined();
  });

  it('supports UI head part binding (设为头部/移出头部 + 头 tag), intensity slider (0-200%), preview button without dirtying, and Undo/Redo', () => {
    const setup = buildPhaseCProject({ withDialogue: true, withClipV1: true });
    // Clear existing head binding to test binding cleanly through UI
    const charSvc = new CharacterService();
    let unboundProject = charSvc.setAdaptivePartsHeadMotionBinding(setup.project, setup.characterId, null);
    unboundProject = upsertExpressionEventAtTime(unboundProject, IDS.shot, setup.layerId, setup.graphicExprId, 200);
    unboundProject = upsertMouthCueEventAtTime(unboundProject, IDS.shot, setup.layerId, 'rest', 200);
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
    Object.assign(window, {
      pandaStage: {
        assets: {
          readThumbnail: async () => ({ ok: true, value: { kind: 'thumbnail', status: 'ready', dataUrl: stubDataUrl } }),
          readAssetUrl: async () => ({ ok: true, value: stubDataUrl }),
        },
      },
    });
    editorProjectStore.open('C:/temp/phase-c.pandastage', unboundProject);
    const began = characterAssemblySessionStore.beginAdaptiveParts(setup.characterId);
    expect(began.ok).toBe(true);
    characterAssemblySessionStore.setAssemblyContinuityOwner(setup.characterId);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const snap = useSyncExternalStore(
        editorProjectStore.subscribe,
        editorProjectStore.getSnapshot,
        editorProjectStore.getSnapshot,
      );
      const raw = useSyncExternalStore(
        characterAssemblySessionStore.subscribe,
        characterAssemblySessionStore.getSnapshot,
        characterAssemblySessionStore.getSnapshot,
      );
      if (!snap || !raw || !isAdaptivePartsAssemblySnapshot(raw)) return null;
      return createElement(CharacterAssemblyWorkbench, {
        projectSnapshot: snap,
        session: raw,
      });
    }

    act(() => root!.render(createElement(Harness)));

    // Bind PART_BACK_HAIR and PART_FACE via Parts overflow menu -> check role tags ("头" and "表情 · 头")
    const selectRowAndToggleHead = (partId: string) => {
      const selectBtn = container!.querySelector(
        `[data-part-id="${partId}"] [data-testid="adaptive-parts-assembly-row-select"]`,
      ) as HTMLButtonElement;
      act(() => selectBtn.click());
      const toggleBtn = container!.querySelector(
        '[data-testid="adaptive-parts-toggle-head-button"]',
      ) as HTMLButtonElement;
      act(() => toggleBtn.click());
    };
    selectRowAndToggleHead(PART_BACK_HAIR);
    selectRowAndToggleHead(PART_FACE);

    const liveChar = editorProjectStore.getSnapshot()!.project.characters.find(
      (c) => c.id === setup.characterId,
    ) as AdaptivePartsCharacter;
    expect(liveChar.headMotionBinding?.partIds).toEqual([PART_BACK_HAIR, PART_FACE]);
    expect(
      container.querySelector(`[data-part-id="${PART_FACE}"] .adaptive-parts-role-tag`)?.textContent,
    ).toBe('表情 · 头');

    // Open Character properties inspector -> adjust intensity to 160% -> click live preview without modifying project revision
    const charManageBtn = container.querySelector('[data-testid="adaptive-character-management"]') as HTMLButtonElement;
    act(() => charManageBtn.click());
    const slider = container.querySelector('[data-testid="adaptive-talking-head-intensity"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(slider, '160');
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(
      (
        editorProjectStore.getSnapshot()!.project.characters.find(
          (c) => c.id === setup.characterId,
        ) as AdaptivePartsCharacter
      ).talkingHeadMotionIntensityPercent,
    ).toBe(160);

    const revBeforePreview = editorProjectStore.getSnapshot()!.revision;
    const previewBtn = container.querySelector('[data-testid="adaptive-talking-head-preview-button"]') as HTMLButtonElement;
    act(() => previewBtn.click());
    expect(previewBtn.getAttribute('aria-pressed')).toBe('true');
    expect(editorProjectStore.getSnapshot()!.revision).toBe(revBeforePreview);
    act(() => previewBtn.click());

    // Undo restores intensity to undefined / default
    act(() => editorProjectStore.undo());
    expect(
      (
        editorProjectStore.getSnapshot()!.project.characters.find(
          (c) => c.id === setup.characterId,
        ) as AdaptivePartsCharacter
      ).talkingHeadMotionIntensityPercent,
    ).toBeUndefined();

    const row = (partId: string) => container!.querySelector<HTMLButtonElement>(
      `[data-part-id="${partId}"] [data-testid="adaptive-parts-assembly-row-select"]`,
    )!;
    const addHead = () => container!.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-batch-set-head"]')!;
    const removeHead = () => container!.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-batch-remove-head"]')!;
    const charFrom = (project: Project) => project.characters.find(({ id }) => id === setup.characterId) as AdaptivePartsCharacter;
    const beforeBatch = editorProjectStore.getSnapshot()!;
    const undoBeforeBatch = editorProjectStore.history.getSnapshot().undoCount;
    act(() => row(PART_FACE).click());
    for (const id of [PART_HEAD, PART_FRONT_HAIR]) {
      act(() => row(id).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
    }
    expect(editorProjectStore.getSnapshot()).toBe(beforeBatch);
    const binding = vi.spyOn(characterStore, 'setAdaptivePartsHeadMotionBinding');
    act(() => addHead().click());
    const bound = editorProjectStore.getSnapshot()!;
    const winner = [PART_BACK_HAIR, PART_FACE, PART_HEAD, PART_FRONT_HAIR];
    expect(binding).toHaveBeenCalledTimes(1);
    expect(binding).toHaveBeenCalledWith(setup.characterId, winner);
    expect(charFrom(bound.project).headMotionBinding?.partIds).toEqual(winner);
    expect(charFrom(bound.project).parts).toEqual(charFrom(beforeBatch.project).parts);
    expect(charFrom(bound.project).faceBinding).toEqual(charFrom(beforeBatch.project).faceBinding);
    expect(bound.project.shots).toEqual(beforeBatch.project.shots);
    expect(bound.revision).toBe(beforeBatch.revision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoBeforeBatch + 1);
    const selected = characterAssemblySessionStore.getActiveAdaptivePartsAssemblySessionHandle()?.getSnapshot()?.selectedPartIds;
    expect(selected).toEqual([PART_FACE, PART_HEAD, PART_FRONT_HAIR]);
    expect(addHead().disabled).toBe(true);

    const shot = bound.project.shots[0]!;
    const frame = evaluateShotAtTime(shot, 225, bound.project);
    const displayed = projectShotDialogueVisual(bound.project, shot, frame);
    const exported = evaluateExportShotAtTime(bound.project, shot, 225, DIALOGUE_ID);
    const visual = (evaluated: typeof frame) => resolveLayerVisualParts(
      bound.project, shot, evaluated.layers.find(({ id }) => id === setup.layerId)!, 225,
    );
    const neutralParts = visual(frame).parts;
    const speakingParts = visual(displayed).parts;
    expect(speakingParts).toEqual(visual(exported).parts);
    expect(speakingParts.map(({ drawOrder }) => drawOrder)).toEqual([0, 1, 2, 3, 4]);
    const bob = resolveTalkingHeadMotionTransform(125, 1200, 100);
    for (const [index, partId] of [PART_BACK_HAIR, PART_BODY, PART_HEAD, PART_FACE, PART_FRONT_HAIR].entries()) {
      expect(speakingParts[index]!.imageTransform!.tx - neutralParts[index]!.imageTransform!.tx)
        .toBeCloseTo(partId === PART_BODY ? 0 : bob.translateX, 6);
    }
    act(() => editorProjectStore.undo());
    expect(charFrom(editorProjectStore.getSnapshot()!.project).headMotionBinding?.partIds).toEqual([PART_BACK_HAIR, PART_FACE]);
    act(() => editorProjectStore.redo());
    expect(charFrom(editorProjectStore.getSnapshot()!.project).headMotionBinding?.partIds).toEqual(winner);
    act(() => removeHead().click());
    expect(binding).toHaveBeenCalledTimes(2);
    expect(binding).toHaveBeenLastCalledWith(setup.characterId, [PART_BACK_HAIR]);
    expect(charFrom(editorProjectStore.getSnapshot()!.project).headMotionBinding?.partIds).toEqual([PART_BACK_HAIR]);
    expect(removeHead().disabled).toBe(true);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoBeforeBatch + 2);
  });
});
