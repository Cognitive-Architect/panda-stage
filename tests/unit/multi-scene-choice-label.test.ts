import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  inspectMultiScene,
  parseMultiSceneInput,
  resolveBackgroundSlot,
  resolveCharacterSlot,
  type Project,
  type SceneSlotResolution,
} from '../../src/domain';
import { choiceLabel } from '../../src/renderer/features/shots/multiScenePanelModel';
import { buildProject, IDS } from './domain/testProject';

const IDS_DUPLICATE = {
  background: '10000000-0000-4000-8000-000000000031',
  character: '20000000-0000-4000-8000-000000000041',
  expression: '20000000-0000-4000-8000-000000000042',
  voice: '30000000-0000-4000-8000-000000000041',
  body: '10000000-0000-4000-8000-000000000041',
  face: '10000000-0000-4000-8000-000000000042',
} as const;

const CAST_IDS = {
  characterLeft: '20000000-0000-4000-8000-000000000011',
  expressionLeftNormal: '20000000-0000-4000-8000-000000000012',
  characterRight: '20000000-0000-4000-8000-000000000021',
  expressionRightNormal: '20000000-0000-4000-8000-000000000022',
  voiceLeft: '30000000-0000-4000-8000-000000000011',
  voiceRight: '30000000-0000-4000-8000-000000000021',
  assetLeftBody: '10000000-0000-4000-8000-000000000011',
  assetLeftFace: '10000000-0000-4000-8000-000000000012',
  assetRightBody: '10000000-0000-4000-8000-000000000021',
  assetRightFace: '10000000-0000-4000-8000-000000000022',
} as const;

function imageAsset(
  id: string,
  name: string,
  usage: 'background' | 'uncategorized' = 'uncategorized',
) {
  return {
    id,
    kind: 'image' as const,
    name,
    relativePath: `${id}.png`,
    mimeType: 'image/png',
    width: 640,
    height: 640,
    usage,
    keywords: [],
  };
}

function compositeCharacter(
  id: string,
  name: string,
  bodyAssetId: string,
  expressionId: string,
  expressionAssetId: string,
  voiceProfileId: string,
) {
  return {
    id,
    mode: 'composite' as const,
    name,
    baseAssetId: expressionAssetId,
    defaultVoiceProfileId: voiceProfileId,
    expressions: [
      { id: expressionId, name: '正常', assetId: expressionAssetId },
    ],
    defaultExpressionId: expressionId,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId,
    facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
  };
}

/**
 * A Project holding two usable assets named 花园 — the only ambiguity a valid
 * Project can actually reach, because background names may repeat.
 */
function duplicateBackgroundProject(
  options: { secondBackgroundUsable?: boolean } = {},
): Project {
  const base = buildProject();
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets.map((asset) =>
        asset.id === IDS.assetBg
          ? { ...asset, name: '花园', usage: 'background' as const }
          : asset,
      ),
      imageAsset(
        IDS_DUPLICATE.background,
        '花园',
        options.secondBackgroundUsable === false ? 'uncategorized' : 'background',
      ),
      imageAsset(CAST_IDS.assetLeftBody, '张三身体'),
      imageAsset(CAST_IDS.assetLeftFace, '张三表情'),
      imageAsset(CAST_IDS.assetRightBody, '李四身体'),
      imageAsset(CAST_IDS.assetRightFace, '李四表情'),
      imageAsset(IDS_DUPLICATE.body, '另一个张三身体'),
      imageAsset(IDS_DUPLICATE.face, '另一个张三表情'),
    ],
    characters: [
      {
        ...base.characters[0]!,
        mode: 'composite' as const,
        bodyAssetId: IDS.assetChar,
        facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
      },
      compositeCharacter(
        CAST_IDS.characterLeft,
        '张三',
        CAST_IDS.assetLeftBody,
        CAST_IDS.expressionLeftNormal,
        CAST_IDS.assetLeftFace,
        CAST_IDS.voiceLeft,
      ),
      compositeCharacter(
        CAST_IDS.characterRight,
        '李四',
        CAST_IDS.assetRightBody,
        CAST_IDS.expressionRightNormal,
        CAST_IDS.assetRightFace,
        CAST_IDS.voiceRight,
      ),
    ],
    voiceProfiles: [
      ...base.voiceProfiles,
      {
        id: CAST_IDS.voiceLeft,
        name: '张三配音',
        characterId: CAST_IDS.characterLeft,
        locale: 'zh-CN',
        rate: 1,
        pitch: 1,
      },
      {
        id: CAST_IDS.voiceRight,
        name: '李四配音',
        characterId: CAST_IDS.characterRight,
        locale: 'zh-CN',
        rate: 1,
        pitch: 1,
      },
    ],
  });
}

/**
 * The Project schema rejects a duplicate Character name, so a valid Project can
 * never hold two 张三. The picker is shared with backgrounds, and the ticket
 * requires a readable label if that state is ever reached, so this fixture models
 * the unvalidated shape on purpose.
 */
function duplicateCharacterProject(): Project {
  const project = duplicateBackgroundProject();
  return {
    ...project,
    characters: [
      ...project.characters,
      compositeCharacter(
        IDS_DUPLICATE.character,
        '张三',
        IDS_DUPLICATE.body,
        IDS_DUPLICATE.expression,
        IDS_DUPLICATE.face,
        IDS_DUPLICATE.voice,
      ),
    ],
  } as unknown as Project;
}

function labelsOf(resolution: SceneSlotResolution): string[] {
  return resolution.choices.map((choice, index) =>
    choiceLabel(choice, index, resolution.choices.length),
  );
}

const STORYBOARD = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '---',
  '镜头：花园告别',
  '背景：花园',
  '出场：李四、张三',
  '站位：双人对话',
].join('\n');

describe('AUTO-04-FIX-01 ambiguous candidate labels', () => {
  it('distinguishes two same-name backgrounds', () => {
    const project = duplicateBackgroundProject();
    const { resolution } = resolveBackgroundSlot(project, '花园', null);

    expect(resolution.status).toBe('ambiguous');
    expect(resolution.choices).toHaveLength(2);
    expect(labelsOf(resolution)).toEqual(['花园（候选 1）', '花园（候选 2）']);
  });

  it('distinguishes two same-name Characters', () => {
    const project = duplicateCharacterProject();
    const { resolution } = resolveCharacterSlot(
      project,
      'left-character',
      '张三',
      null,
    );

    expect(resolution.status).toBe('ambiguous');
    expect(labelsOf(resolution)).toEqual(['张三（候选 1）', '张三（候选 2）']);
  });

  it('keeps the candidate order stable across resolutions', () => {
    const project = duplicateBackgroundProject();
    const projectOrder = project.assets
      .filter((asset) => asset.name === '花园')
      .map((asset) => asset.id);
    const first = resolveBackgroundSlot(project, '花园', null).resolution;
    const second = resolveBackgroundSlot(project, '花园', null).resolution;

    // Candidate 1 is always the Project's own first match, never a reshuffle.
    expect(first.choices.map((choice) => choice.id)).toEqual(projectOrder);
    expect(labelsOf(first)).toEqual(labelsOf(second));
  });

  it('never leaks an ID into the label', () => {
    const project = duplicateCharacterProject();
    const background = resolveBackgroundSlot(project, '花园', null).resolution;
    const character = resolveCharacterSlot(project, 'left-character', '张三', null)
      .resolution;

    const text = [...labelsOf(background), ...labelsOf(character)].join('|');
    for (const id of [
      ...background.choices.map((choice) => choice.id),
      ...character.choices.map((choice) => choice.id),
    ]) {
      expect(text).not.toContain(id);
    }
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/u);
  });

  it('submits the real ID behind the chosen label', () => {
    const project = duplicateBackgroundProject();
    const ambiguous = resolveBackgroundSlot(project, '花园', null).resolution;
    const second = ambiguous.choices[1]!;
    const labels = labelsOf(ambiguous);
    expect(labels[1]).toBe('花园（候选 2）');

    const chosen = resolveBackgroundSlot(project, '花园', second.id);
    expect(chosen.resolution.status).toBe('ready');
    expect(chosen.resolution.selectedId).toBe(second.id);
    expect(chosen.asset?.id).toBe(second.id);

    const blocks = parseMultiSceneInput(STORYBOARD);
    const report = inspectMultiScene(project, blocks, [
      {
        backgroundAssetId: second.id,
        leftCharacterId: CAST_IDS.characterLeft,
        rightCharacterId: CAST_IDS.characterRight,
      },
    ]);
    expect(report.blocks[0]!.background.selectedId).toBe(second.id);
    expect(report.blocks[0]!.ready).toBe(true);
  });

  it('keeps an unusable candidate listed, labelled and unpickable', () => {
    const project = duplicateBackgroundProject({ secondBackgroundUsable: false });
    const { resolution } = resolveBackgroundSlot(project, '花园', null);

    expect(resolution.status).toBe('ambiguous');
    expect(resolution.choices.map((choice) => choice.selectable)).toEqual([
      true,
      false,
    ]);
    // Still a distinct label, so the author sees which one is refused.
    expect(labelsOf(resolution)).toEqual(['花园（候选 1）', '花园（候选 2）']);

    const refused = resolveBackgroundSlot(
      project,
      '花园',
      resolution.choices[1]!.id,
    );
    expect(refused.resolution.status).toBe('unusable');
    expect(refused.asset).toBeNull();
  });

  it('leaves an unambiguous name alone', () => {
    const project = duplicateBackgroundProject();
    const only = resolveCharacterSlot(project, 'right-character', '李四', null)
      .resolution;
    expect(only.status).toBe('ready');
    expect(labelsOf(only)).toEqual(['李四']);
  });

  it('renders the picker through the shared label helper', () => {
    const source = readFileSync(
      'src/renderer/features/shots/MultiScenePanel.tsx',
      'utf8',
    );
    expect(source).toContain('choiceLabel(');
    expect(source).not.toContain('{choice.name}');
    expect(source).toContain('disabled={!choice.selectable}');
  });
});
