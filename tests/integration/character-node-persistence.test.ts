import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  animationTargetIdentity,
  CharacterNodeIdSchema,
  CharacterNodeMotionService,
  CharacterService,
  evaluateShotAtTime,
  LayerV22Schema,
  migrateProject,
  ProjectSchema,
  ProjectV22Schema,
  resolveLayerVisualParts,
  sameAnimationTarget,
  ShotService,
  ShotV22Schema,
  targetTracks,
  type CharacterNodeAnimationClip,
  type CharacterNodeId,
} from '../../src/domain';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { ProjectService } from '../../src/main/services/ProjectService';
import { ProjectOperationResponseSchema } from '../../src/shared/project-api';
import { faceSource } from '../helpers/graphicFaceProject';
import { IDS } from '../unit/domain/testProject';

// Saved and reopened by the final V0 HEAD (1443e35474d8).
const v22File = new URL('../fixtures/project-v22-mixed-character-motion.json', import.meta.url);
const v22Input = JSON.parse(await readFile(v22File, 'utf8'));

function mixedProject() {
  const project = migrateProject(v22Input);
  const composite = project.characters.find((character) => character.mode === 'composite')!;
  const layer = project.shots[0]!.layers.find((entry) =>
    entry.source.kind === 'character' && entry.source.characterId === composite.id,
  )!;
  return { project, compositeId: composite.id, layerId: layer.id };
}

function nodeProject(nodeId: CharacterNodeId = 'face') {
  const { project, compositeId, layerId } = mixedProject();
  const shot = project.shots[0]!;
  const layer = shot.layers.find((entry) => entry.id === layerId)!;
  const target = { kind: 'character-node' as const, layerId, nodeId };
  const clip: CharacterNodeAnimationClip = {
    version: 3,
    targetBases: [{
      target,
      baseTransform: { x: 12, y: -8, scaleX: 1.2, scaleY: 1.2, rotationDeg: 15 },
      pivot: { space: 'target-local', x: 40, y: 35 },
    }],
    tracks: [{
      target, property: 'transform.offsetX',
      keys: [
        { timeMs: 0, value: 0, interpolationToNext: 'ease-in-out' },
        { timeMs: 500, value: 50, interpolationToNext: 'linear' },
      ],
    }],
  };
  layer.animationClip = clip;
  return { project, shot, layer, clip, target, compositeId };
}

describe('Character Node Project persistence (#1155)', () => {
  it('opens a mixed V0 v22 file and migrates only its envelope', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-v22-'));
    try {
      const root = path.join(parent, 'mixed-v0.pandastage');
      await mkdir(root);
      const frozen = ProjectV22Schema.parse(v22Input);
      expect(frozen).toStrictEqual(v22Input);
      expect(frozen.characters.map((character) => character.mode)).toEqual([
        'single-image', 'adaptive-parts', 'composite',
      ]);
      expect(frozen.shots[0]!.layers.flatMap((layer) => layer.animationClip ? [layer.animationClip.version] : []))
        .toEqual([1, 2]);
      await writeFile(path.join(root, 'project.json'), await readFile(v22File));
      const opened = await new ProjectService().open(root);
      expect(opened).toMatchObject({ sourceVersion: 22, migrated: true });
      expect(opened.project).toStrictEqual({ ...v22Input, schemaVersion: 23 });
      expect(ProjectOperationResponseSchema.parse({ ok: true, value: opened })).toEqual({ ok: true, value: opened });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('preserves populated v22 audio and timeline data through migration (#1157)', () => {
    const project = ProjectV22Schema.parse(v22Input);
    const audioAssetId = '91000000-0000-4000-8000-000000001157';
    const audioClipId = '92000000-0000-4000-8000-000000001157';
    project.assets.push({
      id: audioAssetId, kind: 'audio', name: 'Dialogue audio',
      relativePath: 'assets/dialogue.wav', mimeType: 'audio/wav', durationMs: 700,
    });
    const shot = project.shots[0]!;
    shot.audioClips.push({
      id: audioClipId, name: 'Voice', assetId: audioAssetId, role: 'dialogue',
      startMs: 250, endMs: 750, offsetMs: 100, volume: 0.75,
    });
    shot.dialogues[0]!.audioClipId = audioClipId;
    shot.timelineEvents.push({
      id: '93000000-0000-4000-8000-000000001157', layerId: IDS.layerChar,
      type: 'visibility', startMs: 750, endMs: 1000, visible: false,
    });
    expect(ProjectV22Schema.parse(project)).toStrictEqual(project);
    expect(migrateProject(project)).toStrictEqual({ ...project, schemaVersion: 23 });
  });

  it('round-trips a v3 face target through ProjectService and evaluates Composite Face motion', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-v23-'));
    try {
      const root = path.join(parent, 'node.pandastage');
      await mkdir(root);
      const { project, shot, layer, clip, target } = nodeProject();
      const before = structuredClone(project);
      delete before.shots[0]!.layers.find((entry) => entry.id === layer.id)!.animationClip;
      const file = path.join(root, 'project.json');
      await writeFile(file, JSON.stringify(before));
      const service = new ProjectService();
      await service.save(root, ProjectSchema.parse(project), 1);
      const persisted = JSON.parse(await readFile(file, 'utf8'));
      expect(persisted).toStrictEqual(JSON.parse(JSON.stringify(project)));
      const reopened = await service.open(root);
      expect(reopened).toMatchObject({ sourceVersion: 23, migrated: false });
      expect(reopened.project).toStrictEqual(project);
      expect(ProjectOperationResponseSchema.parse({ ok: true, value: reopened })).toEqual({ ok: true, value: reopened });
      const reopenedClip = reopened.project.shots[0]!.layers.find((entry) => entry.id === layer.id)!.animationClip!;
      expect(reopenedClip).toEqual(clip);
      expect(animationTargetIdentity(reopenedClip.tracks[0]!.target)).toBe(animationTargetIdentity(target));

      const beforeAt500 = evaluateShotAtTime(before.shots[0]!, 500, before);
      const beforeLayerAt500 = beforeAt500.layers.find((entry) => entry.id === layer.id)!;
      const reopenedAt0 = evaluateShotAtTime(shot, 0, reopened.project);
      const reopenedAt500 = evaluateShotAtTime(shot, 500, reopened.project);
      const layerAt0 = reopenedAt0.layers.find((entry) => entry.id === layer.id)!;
      const layerAt500 = reopenedAt500.layers.find((entry) => entry.id === layer.id)!;
      expect(layerAt0.faceTransform).toEqual({
        offsetX: 12,
        offsetY: -8,
        scaleX: 1.2,
        scaleY: 1.2,
        rotationDeg: 15,
        flipX: false,
      });
      expect(layerAt500.faceTransform).toEqual({
        offsetX: 62,
        offsetY: -8,
        scaleX: 1.2,
        scaleY: 1.2,
        rotationDeg: 15,
        flipX: false,
      });
      expect({
        x: layerAt500.x,
        y: layerAt500.y,
        scaleX: layerAt500.scaleX,
        scaleY: layerAt500.scaleY,
        rotationDeg: layerAt500.rotationDeg,
      }).toEqual({
        x: beforeLayerAt500.x,
        y: beforeLayerAt500.y,
        scaleX: beforeLayerAt500.scaleX,
        scaleY: beforeLayerAt500.scaleY,
        rotationDeg: beforeLayerAt500.rotationDeg,
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('rejects v3 in every frozen v22 reader and in the migration path', () => {
    const { project, shot, layer } = nodeProject();
    expect(LayerV22Schema.safeParse(layer).success).toBe(false);
    expect(ShotV22Schema.safeParse(shot).success).toBe(false);
    const mislabeled = { ...project, schemaVersion: 22 };
    expect(ProjectV22Schema.safeParse(mislabeled).success).toBe(false);
    expect(() => migrateProject(mislabeled)).toThrow();
  });

  it('accepts reserved IDs and valid part UUIDs even when the Character lacks the node', () => {
    const { project, clip, target } = nodeProject('head');
    const part = { ...target, nodeId: 'part:71000000-0000-4000-8000-000000000002' as const };
    clip.targetBases.push({ ...clip.targetBases[0]!, target: part });
    clip.tracks.push({ ...clip.tracks[0]!, target: part });
    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(targetTracks(clip.tracks, target)).toEqual([clip.tracks[0]]);
    expect(sameAnimationTarget(target, part)).toBe(false);
    const oldPart = { kind: 'character-part' as const, layerId: part.layerId, partId: part.nodeId.slice(5) };
    expect(sameAnimationTarget(part, oldPart)).toBe(false);
    expect(animationTargetIdentity(part)).not.toBe(animationTargetIdentity(oldPart));
    expect(animationTargetIdentity(part)).not.toBe(animationTargetIdentity({ kind: 'layer', layerId: part.layerId }));
    for (const id of ['root', 'body', 'face', 'head', part.nodeId]) {
      expect(CharacterNodeIdSchema.parse(id)).toBe(id);
    }
  });

  it.each(['Face', 'part:1', 'part:custom', 'part:', IDS.assetChar, IDS.layerChar + ':face',
    'part:71000000-0000-0000-0000-000000000002'])('rejects malformed node ID %s in a project', (nodeId) => {
    const { project, clip } = nodeProject();
    Object.assign(clip.targetBases[0]!.target, { nodeId });
    expect(() => ProjectSchema.parse(project)).toThrow();
  });

  it('enforces Layer type and requires every basis and track to belong to its owner', () => {
    const { project, shot, layer, clip, target } = nodeProject();
    const graphic = shot.layers.find((entry) => entry.source.kind === 'animation')!;
    const graphicTarget = { ...target, layerId: graphic.id };
    graphic.animationClip = {
      ...clip,
      targetBases: [{ ...clip.targetBases[0]!, target: graphicTarget }],
      tracks: [{ ...clip.tracks[0]!, target: graphicTarget }],
    };
    expect(() => ProjectSchema.parse(project)).toThrow('Only Character layers');
    delete graphic.animationClip;
    clip.targetBases[0]!.target = { ...target, layerId: IDS.layerChar };
    expect(() => ProjectSchema.parse(project)).toThrow('Animation target must belong to its owning Layer.');
    clip.targetBases[0]!.target = target;
    clip.tracks[0]!.target = { ...target, layerId: IDS.layerChar };
    expect(() => ProjectSchema.parse(project)).toThrow('Animation target must belong to its owning Layer.');
    expect(layer.animationClip).toBe(clip);
  });

  it('enforces matching and unique bases, unique properties, protected keys and Shot bounds', () => {
    const { project, shot, clip } = nodeProject();
    const basis = clip.targetBases[0]!;
    const track = clip.tracks[0]!;
    clip.targetBases = [];
    expect(() => ProjectSchema.parse(project)).toThrow('Animation track requires a matching target basis.');
    clip.targetBases = [basis, basis];
    expect(() => ProjectSchema.parse(project)).toThrow('Duplicate target basis.');
    clip.targetBases = [basis];
    clip.tracks.push(track);
    expect(() => ProjectSchema.parse(project)).toThrow('Duplicate target + property track.');
    clip.tracks.pop();
    const [base, next] = track.keys;
    track.keys = [next!];
    expect(() => ProjectSchema.parse(project)).toThrow('Every track requires a protected 0 ms key.');
    track.keys = [base!, base!];
    expect(() => ProjectSchema.parse(project)).toThrow('Animation keys must be strictly ascending and unique.');
    track.keys = [base!, { ...next!, timeMs: 501 }];
    expect(() => ProjectSchema.parse(project)).toThrow('Animation key time must be on the Project frame grid.');
    track.keys = [base!, { ...next!, timeMs: shot.durationMs + 500 }];
    expect(() => ProjectSchema.parse(project)).toThrow('Animation key must be within the owning Shot duration.');
    track.keys = [base!, { ...next!, value: 0 }];
    track.property = 'transform.scaleX';
    expect(() => ProjectSchema.parse(project)).toThrow('Animation scale must be between');
    track.keys = [{ ...base!, value: 1 }, { ...next!, value: 1.5 }];
    expect(ProjectSchema.parse(project)).toEqual(project);
  });

  it.each(['assetId', 'animationId', 'expressionId', 'visualSource', 'png', 'graphic'])(
    'rejects extra v3 basis field %s', (key) => {
      const { project, clip } = nodeProject();
      Object.assign(clip.targetBases[0]!, { [key]: 'visual' });
      expect(() => ProjectSchema.parse(project)).toThrow('Unrecognized key');
    },
  );

  it('keeps the face identity through Expression and Visual reference changes', () => {
    const { project, layer, clip, compositeId } = nodeProject();
    const character = project.characters.find((entry) => entry.id === compositeId)!;
    if (character.mode !== 'composite' || layer.source.kind !== 'character') throw new Error('Expected a Composite Layer.');
    const replacementExpression = character.expressions[1]!.id;
    layer.source.expressionId = replacementExpression;
    const next = new CharacterService().setExpressionVisualSource(project, compositeId, replacementExpression, faceSource(1));
    const nextLayer = next.shots[0]!.layers.find((entry) => entry.id === layer.id)!;
    expect(nextLayer.source).toMatchObject({ expressionId: replacementExpression });
    expect(nextLayer.animationClip).toStrictEqual(clip);
    expect(next.characters.find((entry) => entry.id === compositeId)).toMatchObject({
      expressions: expect.arrayContaining([expect.objectContaining({
        id: replacementExpression, visualSource: faceSource(1),
      })]),
    });
  });

  it('remaps the copied Layer owner and preserves the semantic node in both collections', () => {
    const { project, shot, clip } = nodeProject();
    const duplicated = new ShotService().duplicate(project, shot.id).shots[1]!;
    const layer = duplicated.layers.find((entry) => entry.animationClip?.version === 3)!;
    const copiedClip = layer.animationClip!;
    expect(layer.id).not.toBe(clip.tracks[0]!.target.layerId);
    expect(copiedClip.targetBases[0]!.target).toEqual({ ...clip.targetBases[0]!.target, layerId: layer.id });
    expect(copiedClip.tracks[0]!.target).toEqual({ ...clip.tracks[0]!.target, layerId: layer.id });
  });

  it('authors Composite Face motion with Auto-Key OFF/ON + Expression + Easing and keeps Editor/Export parity after reopen (#1158)', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-v1b-'));
    try {
      const root = path.join(parent, 'face-motion.pandastage');
      await mkdir(root);
      const { project: baseProject, compositeId, layerId } = mixedProject();
      const shotId = baseProject.shots[0]!.id;
      const service = new CharacterNodeMotionService();

      // 1. Auto-Key OFF updates static FacePlacement without Clip v3.
      let authored = service.apply(
        baseProject,
        { shotId, layerId, nodeId: 'face', timeMs: 0, autoKey: false },
        { 'transform.offsetX': 18, 'transform.offsetY': -12, 'transform.rotationDeg': 10, 'transform.scaleX': 1.25, 'transform.scaleY': 1.25 },
      );
      expect(authored.shots[0]!.layers.find((l) => l.id === layerId)!.animationClip).toBeUndefined();

      // 2. Auto-Key ON writes Clip v3 keys at 500ms + Expression switch at 400ms + easing at 0ms.
      const compositeChar = authored.characters.find((c) => c.id === compositeId)!;
      if (compositeChar.mode !== 'composite') throw new Error('expected composite');
      const altExpression = compositeChar.expressions[1]!.id;
      authored = ProjectSchema.parse({
        ...authored,
        shots: authored.shots.map((shot) => ({
          ...shot,
          durationMs: 2_000,
          timelineEvents: [
            ...shot.timelineEvents,
            {
              id: '94000000-0000-4000-8000-000000001158',
              layerId,
              type: 'expression' as const,
              startMs: 400,
              endMs: 2_000,
              expressionId: altExpression,
            },
          ],
        })),
      });
      authored = service.apply(
        authored,
        { shotId, layerId, nodeId: 'face', timeMs: 500, autoKey: true },
        { 'transform.offsetX': 58, 'transform.rotationDeg': 40, 'transform.scaleX': 1.875, 'transform.scaleY': 1.875 },
      );
      authored = service.setCompositeKeyEasing(authored, {
        shotId,
        layerId,
        nodeId: 'face',
        timeMs: 0,
        interpolationToNext: 'ease-in-out',
      });

      const file = path.join(root, 'project.json');
      await writeFile(file, JSON.stringify(baseProject));
      const projectService = new ProjectService();
      await projectService.save(root, authored, 1);
      const reopened = await projectService.open(root);
      expect(reopened.project).toStrictEqual(authored);

      for (const sampleMs of [0, 250, 500] as const) {
        const expectedShot = evaluateShotAtTime(authored.shots[0]!, sampleMs, authored);
        const actualShot = evaluateShotAtTime(reopened.project.shots[0]!, sampleMs, reopened.project);
        expect(actualShot).toEqual(expectedShot);

        const exportShot = evaluateExportShotAtTime(reopened.project, reopened.project.shots[0]!, sampleMs);
        const actualLayer = actualShot.layers.find((entry) => entry.id === layerId)!;
        const exportLayer = exportShot.layers.find((entry) => entry.id === layerId)!;
        const actualVisual = resolveLayerVisualParts(reopened.project, reopened.project.shots[0]!, actualLayer, sampleMs);
        const exportVisual = resolveLayerVisualParts(reopened.project, reopened.project.shots[0]!, exportLayer, sampleMs);
        expect(actualVisual).toEqual(exportVisual);
        if (sampleMs === 0) {
          expect(exportVisual.facePlacement).toEqual({
            offsetX: 18,
            offsetY: -12,
            scale: 1.25,
            rotationDeg: 10,
            flipX: false,
          });
        } else if (sampleMs === 500) {
          expect(exportVisual.activeFace?.currentExpressionId).toBe(altExpression);
          expect(exportVisual.facePlacement).toMatchObject({
            offsetX: 58,
            offsetY: -12,
            rotationDeg: 40,
            flipX: false,
          });
          expect(exportVisual.facePlacement?.scale).toBeCloseTo(1.875, 10);
        }
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
