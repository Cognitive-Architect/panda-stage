import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  ProjectSchema,
  PROJECT_SCHEMA_VERSION,
  evaluateShotAtTime,
  resolveLayerVisualParts,
} from '../../src/domain';
import { evaluateExportPreparationSupport } from '../../src/domain/export-preparation';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  adaptivePartsFixture,
  adaptivePartsSourceRootTransform,
} from '../helpers/adaptivePartsFixtures';
import { buildProjectWithAnimation, IDS } from '../unit/domain/testProject';

const temporaryParents: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryParents.splice(0).map((parent) =>
    rm(parent, { recursive: true, force: true }),
  ));
});

describe('Adaptive Parts and animation compatibility', () => {
  it('saves, reopens, and renders both models together while blocking animation export', async () => {
    const parent = await mkdtemp(
      path.join(os.tmpdir(), 'panda-character-animation-compatibility-'),
    );
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'combined-v16.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, {
      name: 'Combined character and animation',
    });
    const baseProject = ProjectSchema.parse({
      ...buildProjectWithAnimation(),
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
    });

    let generatedId = 0;
    const withAdaptiveCharacter = new CharacterService({
      createId: () => {
        generatedId += 1;
        return generatedId === 1
          ? '21000000-0000-4000-8000-000000000001'
          : '30000000-0000-4000-8000-000000000002';
      },
    }).createAdaptiveParts(baseProject, {
      name: 'Synthetic Adaptive Parts',
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: adaptivePartsFixture(IDS.assetChar),
    });
    const adaptiveCharacter = withAdaptiveCharacter.characters.find(
      (character) => character.name === 'Synthetic Adaptive Parts',
    );
    if (!adaptiveCharacter || adaptiveCharacter.mode !== 'adaptive-parts') {
      throw new Error('Expected the synthetic Adaptive Parts Character.');
    }

    const shot = withAdaptiveCharacter.shots[0]!;
    const adaptiveLayerId = '60000000-0000-4000-8000-000000000004';
    const adaptiveLayer = {
      ...shot.layers.find((layer) => layer.source.kind === 'character')!,
      id: adaptiveLayerId,
      name: 'Synthetic Adaptive Parts',
      source: { kind: 'character' as const, characterId: adaptiveCharacter.id },
      zIndex: 4,
    };
    const withAdaptiveLayer = ProjectSchema.parse({
      ...withAdaptiveCharacter,
      shots: withAdaptiveCharacter.shots.map((candidate) =>
        candidate.id === shot.id
          ? { ...candidate, layers: [...candidate.layers, adaptiveLayer] }
          : candidate,
      ),
    });
    const animation = new LayerService({
      createId: () => '70000000-0000-4000-8000-000000000003',
    }).createFromAsset(withAdaptiveLayer, shot.id, {
      version: 3,
      type: 'animation',
      animationId: IDS.animation,
      position: { x: 900, y: 600 },
      startTimeMs: 500,
    });

    await projectService.save(projectRoot, animation.project);
    const reopened = await projectService.open(projectRoot);
    expect(reopened.migrated).toBe(false);
    expect(reopened.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

    const reopenedCharacter = reopened.project.characters.find(
      (character) => character.id === adaptiveCharacter.id,
    );
    expect(reopenedCharacter).toEqual(adaptiveCharacter);
    const reopenedShot = reopened.project.shots.find(
      (candidate) => candidate.id === shot.id,
    )!;
    const evaluated = evaluateShotAtTime(reopenedShot, 500, reopened.project);
    const evaluatedAdaptiveLayer = evaluated.layers.find(
      (layer) => layer.id === adaptiveLayerId,
    )!;
    const adaptiveVisual = resolveLayerVisualParts(
      reopened.project,
      reopenedShot,
      evaluatedAdaptiveLayer,
    );
    expect(adaptiveVisual.kind).toBe('adaptive-parts-character');
    expect(adaptiveVisual.parts).toHaveLength(6);

    const evaluatedAnimation = evaluated.layers.find(
      (layer) => layer.id === animation.layer.id,
    )!;
    expect(evaluatedAnimation).toMatchObject({
      visible: true,
      animationFrame: { animationId: IDS.animation },
    });
    expect(evaluateExportPreparationSupport(reopened.project, 'static')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE',
          problem: expect.stringContaining('镜头动画导出'),
        }),
      ]),
    );
  });
});
