import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ShotService,
  ShotServiceError,
  migrateProject,
  scanAssetReferences,
  scanCharacterReferences,
  scanExpressionReferences,
  type Project,
} from '../../src/domain';

function makeService(): ShotService {
  let counter = 0;
  return new ShotService({
    createId: () =>
      `d3000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-11-07T05:00:00.000Z'),
  });
}

function fixture(): { project: Project; shotId: string } {
  const project = migrateProject(exampleProject);
  return { project, shotId: project.shots[0]!.id };
}

function expectShotError(
  action: () => unknown,
  code: ShotServiceError['code'],
): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(ShotServiceError);
    expect((error as ShotServiceError).code).toBe(code);
  }
}

function withTemplate(): { project: Project; templateId: string; shotId: string } {
  const { project, shotId } = fixture();
  const next = makeService().saveAsTemplate(project, {
    shotId,
    name: '客厅双人对话',
  });
  return { project: next, templateId: next.shotTemplates[0]!.id, shotId };
}

describe('project-local Shot templates (AUTO-03 V0)', () => {
  it('saves the scene structure and drops dialogues and audio clips', () => {
    const { project, shotId } = fixture();
    const source = project.shots.find((shot) => shot.id === shotId)!;
    expect(source.dialogues).toHaveLength(1);
    expect(source.audioClips).toHaveLength(1);

    const next = makeService().saveAsTemplate(project, {
      shotId,
      name: '  客厅双人对话  ',
    });
    const template = next.shotTemplates[0]!;

    expect(template.name).toBe('客厅双人对话');
    expect(template.durationMs).toBe(source.durationMs);
    expect(template.defaultSubtitleStyleId).toBe(
      source.defaultSubtitleStyleId,
    );
    expect(template.layers).toHaveLength(source.layers.length);
    expect(template.timelineEvents).toHaveLength(
      source.timelineEvents.length,
    );
    expect(Object.keys(template)).not.toContain('dialogues');
    expect(Object.keys(template)).not.toContain('audioClips');
    expect(Object.keys(template)).not.toContain('sourceShotId');
  });

  it('copies placement and source fields while giving the template its own IDs', () => {
    const { project, shotId } = fixture();
    const source = project.shots.find((shot) => shot.id === shotId)!;
    const next = makeService().saveAsTemplate(project, {
      shotId,
      name: '站位模板',
    });
    const template = next.shotTemplates[0]!;

    const sourceCharacter = source.layers.find(
      (layer) => layer.source.kind === 'character',
    )!;
    const templateCharacter = template.layers.find(
      (layer) => layer.source.kind === 'character',
    )!;
    expect(templateCharacter).toMatchObject({
      x: sourceCharacter.x,
      y: sourceCharacter.y,
      scaleX: sourceCharacter.scaleX,
      scaleY: sourceCharacter.scaleY,
      rotationDeg: sourceCharacter.rotationDeg,
      flipX: sourceCharacter.flipX,
      opacity: sourceCharacter.opacity,
      locked: sourceCharacter.locked,
      zIndex: sourceCharacter.zIndex,
      source: sourceCharacter.source,
    });

    const sourceLayerIds = new Set(source.layers.map((layer) => layer.id));
    for (const layer of template.layers) {
      expect(sourceLayerIds.has(layer.id)).toBe(false);
    }
    const templateLayerIds = new Set(
      template.layers.map((layer) => layer.id),
    );
    expect(template.backgroundLayerId).not.toBeNull();
    expect(templateLayerIds.has(template.backgroundLayerId!)).toBe(true);
    for (const event of template.timelineEvents) {
      expect(templateLayerIds.has(event.layerId)).toBe(true);
    }
  });

  it('stays independent from the source Shot when that Shot changes or is removed', () => {
    const { project, templateId } = withTemplate();
    const template = project.shotTemplates.find(
      (candidate) => candidate.id === templateId,
    )!;
    const before = JSON.stringify(template);
    const service = makeService();
    const sourceShotId = project.shots[0]!.id;

    const renamed = service.rename(project, sourceShotId, '改过的镜头');
    expect(
      JSON.stringify(
        renamed.shotTemplates.find((c) => c.id === templateId),
      ),
    ).toBe(before);

    const removed = service.remove(renamed, sourceShotId);
    expect(removed.shots).toHaveLength(0);
    expect(
      JSON.stringify(
        removed.shotTemplates.find((c) => c.id === templateId),
      ),
    ).toBe(before);
  });

  it('instantiates a template as a fully new, dialogue-free Shot at the end', () => {
    const { project, templateId } = withTemplate();
    const template = project.shotTemplates.find(
      (candidate) => candidate.id === templateId,
    )!;
    const next = makeService().createFromTemplate(project, {
      templateId,
      shotName: '镜头 6',
    });
    const created = next.shots.at(-1)!;

    expect(next.shots).toHaveLength(project.shots.length + 1);
    expect(created.name).toBe('镜头 6');
    expect(created.durationMs).toBe(template.durationMs);
    expect(created.defaultSubtitleStyleId).toBe(
      template.defaultSubtitleStyleId,
    );
    expect(created.dialogues).toEqual([]);
    expect(created.audioClips).toEqual([]);
    expect(created.layers).toHaveLength(template.layers.length);

    const templateLayerIds = template.layers.map((layer) => layer.id);
    const createdLayerIds = created.layers.map((layer) => layer.id);
    expect(createdLayerIds).not.toEqual(templateLayerIds);
    for (const layerId of createdLayerIds) {
      expect(templateLayerIds).not.toContain(layerId);
    }

    const templateBackground = template.layers.find(
      (layer) => layer.id === template.backgroundLayerId,
    )!;
    const createdBackground = created.layers.find(
      (layer) => layer.id === created.backgroundLayerId,
    )!;
    expect(createdBackground.source).toEqual(templateBackground.source);
    expect(createdBackground.x).toBe(templateBackground.x);
    expect(createdBackground.y).toBe(templateBackground.y);

    const createdLayerIdSet = new Set(createdLayerIds);
    for (const event of created.timelineEvents) {
      expect(createdLayerIdSet.has(event.layerId)).toBe(true);
    }
  });

  it('keeps two instances of one template completely decoupled', () => {
    const { project, templateId } = withTemplate();
    const service = makeService();
    const once = service.createFromTemplate(project, {
      templateId,
      shotName: '镜头 6',
    });
    const twice = service.createFromTemplate(once, {
      templateId,
      shotName: '镜头 7',
    });
    const first = twice.shots.at(-2)!;
    const second = twice.shots.at(-1)!;

    const firstIds = new Set(first.layers.map((layer) => layer.id));
    for (const layer of second.layers) {
      expect(firstIds.has(layer.id)).toBe(false);
    }

    const renamed = service.rename(twice, first.id, '只改第一个');
    expect(renamed.shots.find((shot) => shot.id === second.id)!.name).toBe(
      second.name,
    );
    expect(
      renamed.shotTemplates.find((candidate) => candidate.id === templateId)!
        .layers,
    ).toEqual(
      project.shotTemplates.find((candidate) => candidate.id === templateId)!
        .layers,
    );
  });

  it('deletes only the template and leaves instantiated Shots intact', () => {
    const { project, templateId } = withTemplate();
    const service = makeService();
    const created = service.createFromTemplate(project, {
      templateId,
      shotName: '镜头 6',
    });
    const shotsBefore = JSON.stringify(created.shots);
    const next = service.removeTemplate(created, templateId);

    expect(next.shotTemplates).toEqual([]);
    expect(JSON.stringify(next.shots)).toBe(shotsBefore);
  });

  it('refuses unknown templates, blank names and duplicate Shot names', () => {
    const { project, templateId } = withTemplate();

    expectShotError(
      () =>
        makeService().createFromTemplate(project, {
          templateId: '00000000-0000-4000-8000-000000000999',
          shotName: '镜头 6',
        }),
      'SHOT_TEMPLATE_NOT_FOUND',
    );
    expectShotError(
      () => makeService().saveAsTemplate(project, { shotId: project.shots[0]!.id, name: '   ' }),
      'INVALID_SHOT_TEMPLATE_NAME',
    );
    expectShotError(
      () =>
        makeService().createFromTemplate(project, {
          templateId,
          shotName: project.shots[0]!.name,
        }),
      'DUPLICATE_SHOT_NAME',
    );
    expectShotError(
      () => makeService().removeTemplate(project, '00000000-0000-4000-8000-000000000998'),
      'SHOT_TEMPLATE_NOT_FOUND',
    );
  });

  it('rejects persisted templates whose internal references are broken', () => {
    const { project, templateId } = withTemplate();
    const template = project.shotTemplates.find(
      (candidate) => candidate.id === templateId,
    )!;
    // Zero shots keeps the template as the only consumer of project data.
    const base: Project = { ...project, shots: [] };

    const parsed = ProjectSchema.parse(base);
    expect(parsed.shotTemplates).toHaveLength(1);

    const unknownAsset: Project = {
      ...base,
      shotTemplates: [
        {
          ...template,
          layers: template.layers.map((layer) =>
            layer.source.kind === 'asset'
              ? {
                  ...layer,
                  source: {
                    ...layer.source,
                    assetId: '00000000-0000-4000-8000-000000000999',
                  },
                }
              : layer,
          ),
        },
      ],
    };
    expect(() => ProjectSchema.parse(unknownAsset)).toThrow(/shotTemplates/u);

    const missingBackground: Project = {
      ...base,
      shotTemplates: [
        { ...template, backgroundLayerId: '00000000-0000-4000-8000-000000000997' },
      ],
    };
    expect(() => ProjectSchema.parse(missingBackground)).toThrow(
      /backgroundLayerId/u,
    );

    const danglingEvent: Project = {
      ...base,
      shotTemplates: [
        {
          ...template,
          timelineEvents: template.timelineEvents.map((event) => ({
            ...event,
            layerId: '00000000-0000-4000-8000-000000000996',
          })),
        },
      ],
    };
    expect(() => ProjectSchema.parse(danglingEvent)).toThrow(/timelineEvents/u);

    const duplicateLayerIds: Project = {
      ...base,
      shotTemplates: [
        {
          ...template,
          layers: template.layers.map((layer) => ({
            ...layer,
            id: template.layers[0]!.id,
          })),
        },
      ],
    };
    expect(() => ProjectSchema.parse(duplicateLayerIds)).toThrow(
      /Duplicate id/u,
    );

    const unknownSubtitleStyle: Project = {
      ...base,
      shotTemplates: [
        {
          ...template,
          defaultSubtitleStyleId: '00000000-0000-4000-8000-000000000995',
        },
      ],
    };
    expect(() => ProjectSchema.parse(unknownSubtitleStyle)).toThrow(
      /subtitle style/u,
    );
  });

  it('migrates v16 to v17 by adding only an empty template list', () => {
    const current = migrateProject(exampleProject);
    const { shotTemplates, ...rest } = current;
    expect(shotTemplates).toEqual([]);

    const migrated = migrateProject({ ...rest, schemaVersion: 16 });

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.shotTemplates).toEqual([]);
    const { shotTemplates: migratedTemplates, ...migratedRest } = migrated;
    expect(migratedTemplates).toEqual([]);
    expect(migratedRest).toEqual(rest);
  });

  it('round-trips a saved template through JSON and keeps instantiated Shots', () => {
    const { project, templateId } = withTemplate();
    const created = makeService().createFromTemplate(project, {
      templateId,
      shotName: '镜头 6',
    });
    const reopened = migrateProject(JSON.parse(JSON.stringify(created)));

    expect(reopened.shotTemplates).toHaveLength(1);
    expect(reopened.shotTemplates[0]!.id).toBe(templateId);
    expect(reopened.shots.at(-1)!.name).toBe('镜头 6');
    expect(reopened.shots.at(-1)!.layers).toEqual(
      created.shots.at(-1)!.layers,
    );
  });
  it('keeps template-layer resources inside the existing deletion guard', () => {
    const { project } = withTemplate();
    // Zero shots proves the template alone is enough to protect the asset,
    // the character and the expression it references.
    const templateOnly: Project = { ...project, shots: [] };
    const template = templateOnly.shotTemplates[0]!;
    const assetLayer = template.layers.find(
      (layer) => layer.source.kind === 'asset',
    )!;
    const characterLayer = template.layers.find(
      (layer) => layer.source.kind === 'character',
    )!;
    if (assetLayer.source.kind !== 'asset') throw new Error('fixture');
    if (characterLayer.source.kind !== 'character') throw new Error('fixture');

    const assetReferences = scanAssetReferences(
      templateOnly,
      assetLayer.source.assetId,
    );
    expect(assetReferences.length).toBeGreaterThan(0);
    expect(assetReferences.every((reference) =>
      reference.path.startsWith('shotTemplates['),
    )).toBe(true);

    const characterReferences = scanCharacterReferences(
      templateOnly,
      characterLayer.source.characterId,
    );
    expect(characterReferences.length).toBeGreaterThan(0);
    expect(characterReferences.every((reference) =>
      reference.path.startsWith('shotTemplates['),
    )).toBe(true);

    if (characterLayer.source.expressionId) {
      const expressionReferences = scanExpressionReferences(
        templateOnly,
        characterLayer.source.characterId,
        characterLayer.source.expressionId,
      );
      expect(expressionReferences.length).toBeGreaterThan(0);
      expect(expressionReferences.every((reference) =>
        reference.path.startsWith('shotTemplates['),
      )).toBe(true);
    }
  });
});
