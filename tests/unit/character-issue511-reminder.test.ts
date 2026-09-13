import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  ProjectSchema,
  countLegacyCharacterImageLayers,
  findLegacyCharacterImageLayers,
  isLegacyCharacterImageLayer,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #511 R7 V1 legacy Character layer reminder', () => {
  it('finds only non-background direct layers after an expression binding', () => {
    const project = buildProject();
    const legacyLayer = project.shots[0]!.layers.find(
      (layer) => layer.id === IDS.layerAsset,
    )!;
    const projectWithTwoLegacyLayers = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === IDS.shot
          ? {
              ...shot,
              layers: [
                ...shot.layers,
                {
                  ...legacyLayer,
                  id: '60000000-0000-4000-8000-000000000004',
                  name: '道具 2',
                },
              ],
            }
          : shot,
      ),
    });

    expect(findLegacyCharacterImageLayers(project, [IDS.assetBg])).toEqual([]);

    const service = new CharacterService();
    const bound = service.addExpression(projectWithTwoLegacyLayers, IDS.character, {
      name: '惊讶',
      assetId: IDS.assetBg,
    });
    const matches = findLegacyCharacterImageLayers(bound, [IDS.assetBg]);

    expect(matches).toHaveLength(2);
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: IDS.assetBg,
          layerId: IDS.layerAsset,
          shotId: IDS.shot,
        }),
        expect.objectContaining({
          assetId: IDS.assetBg,
          layerId: '60000000-0000-4000-8000-000000000004',
          shotId: IDS.shot,
        }),
      ]),
    );
    expect(isLegacyCharacterImageLayer(bound, IDS.shot, IDS.layerAsset)).toBe(
      true,
    );
    expect(isLegacyCharacterImageLayer(bound, IDS.shot, IDS.layerBg)).toBe(false);
    expect(isLegacyCharacterImageLayer(bound, IDS.shot, IDS.layerChar)).toBe(
      false,
    );
    expect(
      bound.shots[0]!.layers.find((layer) => layer.id === IDS.layerAsset),
    ).toMatchObject({
      x: 500,
      y: 600,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: 1,
      locked: false,
      flipX: false,
    });
  });

  it('covers create, add, and replace expression binding trigger inputs', () => {
    const project = buildProject();
    const service = new CharacterService();

    const created = service.create(project, {
      name: '第二角色',
      expressions: [{ name: '普通', assetId: IDS.assetBg }],
    });
    expect(
      countLegacyCharacterImageLayers(created, [IDS.assetBg]),
    ).toBe(1);

    const added = service.addExpression(project, IDS.character, {
      name: '惊讶',
      assetId: IDS.assetBg,
    });
    expect(countLegacyCharacterImageLayers(added, [IDS.assetBg])).toBe(1);

    const replaced = service.setExpressionAsset(
      project,
      IDS.character,
      IDS.expressionAngry,
      IDS.assetBg,
    );
    expect(countLegacyCharacterImageLayers(replaced, [IDS.assetBg])).toBe(1);
  });

  it('stays quiet for mouth-only and background-only matches and remains neutral for shared assets', () => {
    const project = buildProject();
    const service = new CharacterService();
    const mouthOnly = service.setMouthOpenAsset(
      project,
      IDS.character,
      IDS.assetBg,
    );

    expect(countLegacyCharacterImageLayers(mouthOnly, [IDS.assetBg])).toBe(0);

    const shared = service.create(mouthOnly, {
      name: '第二角色',
      expressions: [{ name: '普通', assetId: IDS.assetBg }],
    });
    expect(countLegacyCharacterImageLayers(shared, [IDS.assetBg])).toBe(1);
    expect(findLegacyCharacterImageLayers(shared, [IDS.assetBg])[0]).not.toHaveProperty(
      'characterId',
    );
  });

  it('wires the bounded status and contextual note into the existing owners', () => {
    const manager = source(
      'src/renderer/features/characters/CharacterManager.tsx',
    );
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const styles = source('src/renderer/styles.css');

    expect(manager).toContain('countLegacyCharacterImageLayers');
    expect(manager).toContain('CHARACTER_BINDING_REMINDER_DURATION_MS = 5_500');
    expect(manager).toContain('createdCharacter.expressions.map');
    expect(manager).toContain('data-testid="character-binding-reminder"');
    expect(manager).toContain('aria-live="polite"');
    expect(inspector).toContain('isLegacyCharacterImageLayer');
    expect(inspector).toContain('仍是普通图片');
    expect(inspector).toContain(
      '已用于角色表情；要按角色使用，请从角色栏重新拖入。',
    );
    expect(inspector).toContain(
      'data-testid="right-inspector-character-layer-reminder"',
    );
    expect(styles).toContain('.character-binding-reminder');
    expect(styles).toContain(
      '.right-inspector-character-layer-reminder',
    );
  });
});
