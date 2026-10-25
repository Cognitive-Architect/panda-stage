import { describe, expect, it } from 'vitest';
import {
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  LayerService,
  parseStructuredSceneInput,
  ProjectSchema,
  SceneCreationError,
  SceneCreationService,
  ShotService,
  type SceneCreationServiceOptions,
  type Project,
} from '../../src/domain';

const IDS = {
  project: '85200000-0000-4000-8000-000000000001',
  background: '85200000-0000-4000-8000-000000000002',
  face: '85200000-0000-4000-8000-000000000003',
  body: '85200000-0000-4000-8000-000000000004',
  character: '85200000-0000-4000-8000-000000000005',
  expression: '85200000-0000-4000-8000-000000000006',
  voice: '85200000-0000-4000-8000-000000000007',
  subtitle: '85200000-0000-4000-8000-000000000008',
  existingShot: '85200000-0000-4000-8000-000000000009',
};

function makeProject(): Project {
  return ProjectSchema.parse({
    schemaVersion: 13,
    id: IDS.project,
    name: 'AC-01 scene test',
    width: 1920,
    height: 1080,
    fps: 24,
    assets: [
      {
        id: IDS.background,
        kind: 'image',
        name: 'Garden',
        relativePath: 'assets/garden.png',
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
        usage: 'background',
        keywords: [],
      },
      {
        id: IDS.face,
        kind: 'image',
        name: 'Cutout head',
        relativePath: 'assets/head.png',
        mimeType: 'image/png',
        width: 240,
        height: 280,
        usage: 'character',
        keywords: [],
      },
      {
        id: IDS.body,
        kind: 'image',
        name: 'Cutout body',
        relativePath: 'assets/body.png',
        mimeType: 'image/png',
        width: 480,
        height: 600,
        usage: 'character',
        keywords: [],
      },
    ],
    characters: [
      {
        id: IDS.character,
        name: 'Zhang San',
        mode: 'composite',
        baseAssetId: IDS.face,
        defaultVoiceProfileId: IDS.voice,
        expressions: [
          { id: IDS.expression, name: 'Default', assetId: IDS.face },
        ],
        defaultExpressionId: IDS.expression,
        defaultScale: 0.72,
        defaultFlipX: false,
        bodyAssetId: IDS.body,
        bodyPlacement: { offsetX: 0, offsetY: 0, scale: 1 },
        facePlacement: {
          offsetX: 0,
          offsetY: -420,
          scale: 1,
          rotationDeg: 0,
          flipX: false,
        },
        talkingHeadMotionIntensityPercent: 100,
      },
    ],
    voiceProfiles: [
      {
        id: IDS.voice,
        name: 'Default voice',
        characterId: IDS.character,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    ],
    subtitleStyles: [
      {
        id: IDS.subtitle,
        name: 'Default subtitles',
        fontFamily: 'Microsoft YaHei',
        fontSize: 44,
        textColor: '#fffdf6',
        backgroundColor: '#0a141100',
        position: 'bottom',
        align: 'center',
        maxWidth: 1600,
      },
    ],
    shots: [
      {
        id: IDS.existingShot,
        name: 'Existing scene',
        durationMs: 2_000,
        defaultSubtitleStyleId: IDS.subtitle,
        layers: [],
        backgroundLayerId: null,
        dialogues: [],
        audioClips: [],
        timelineEvents: [],
      },
    ],
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
  });
}

function expectError(
  callback: () => unknown,
  code: SceneCreationError['code'],
): void {
  try {
    callback();
    throw new Error(`Expected SceneCreationError ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(SceneCreationError);
    expect(error).toMatchObject({ code });
  }
}

function serviceWithIds(
  layerService?: SceneCreationServiceOptions['layerService'],
): SceneCreationService {
  let counter = 20;
  const createId = () =>
    `85200000-0000-4000-8000-${String(counter++).padStart(12, '0')}`;
  const now = () => new Date('2026-10-25T00:01:00.000Z');
  return new SceneCreationService({
    shotService: new ShotService({ createId, now }),
    layerService:
      layerService ?? new LayerService({ createId, now }),
  });
}

const INPUT = '镜头：Garden meeting\n背景：Garden\n出场：Zhang San';

describe('SceneCreationService', () => {
  it('parses the fixed fields, accepts ASCII or full width colons, and trims whitespace', () => {
    expect(parseStructuredSceneInput(
      '  背景 : Garden  \r\n\r\n出场：Zhang San\n镜头: Garden meeting  ',
    )).toEqual({
      shotName: 'Garden meeting',
      backgroundName: 'Garden',
      characterName: 'Zhang San',
    });
    expect(
      parseStructuredSceneInput(
        '镜头：$(Get-ChildItem)\n背景：Garden\n出场：Zhang San',
      ).shotName,
    ).toBe('$(Get-ChildItem)');
  });

  it('creates exactly one editable Shot with a formal background and composite Character layer', () => {
    const original = makeProject();
    const result = serviceWithIds().create(original, INPUT);
    const shot = result.project.shots.find(
      (candidate) => candidate.id === result.shotId,
    )!;
    const background = shot.layers.find(
      (layer) => layer.id === result.backgroundLayerId,
    )!;
    const character = shot.layers.find(
      (layer) => layer.id === result.characterLayerId,
    )!;
    const render = buildEditorStageRenderModel(
      result.project,
      shot,
      evaluateShotAtTime(shot, 0, result.project),
    );

    expect(result.project.shots).toHaveLength(original.shots.length + 1);
    expect(result.project.shots[0]).toEqual(original.shots[0]);
    expect(result.project.assets).toEqual(original.assets);
    expect(result.project.characters).toEqual(original.characters);
    expect(shot).toMatchObject({
      name: 'Garden meeting',
      durationMs: 3_000,
      backgroundLayerId: background.id,
    });
    expect(shot.layers).toHaveLength(2);
    expect(background).toMatchObject({
      source: { kind: 'asset', assetId: IDS.background },
      x: 960,
      y: 540,
      locked: true,
      zIndex: 0,
    });
    expect(character).toMatchObject({
      source: {
        kind: 'character',
        characterId: IDS.character,
        expressionId: IDS.expression,
      },
      x: 960,
      locked: false,
      zIndex: 1,
    });
    expect(character.y).toBeGreaterThan(0);
    expect(character.y).toBeLessThan(1080);
    expect(render.layers.map(({ layer }) => layer.id)).toEqual([
      background.id,
      character.id,
    ]);
    expect(render.layers[1]?.visual).toMatchObject({
      kind: 'composite-character',
      parts: [
        { slot: 'body', assetId: IDS.body },
        { slot: 'face', assetId: IDS.face },
      ],
    });
  });

  it('rejects malformed, duplicate, unknown, empty, and missing fields', () => {
    expectError(
      () => parseStructuredSceneInput('镜头 花园相遇\n背景：Garden\n出场：Zhang San'),
      'INVALID_INPUT',
    );
    expectError(
      () => parseStructuredSceneInput('镜头：A\n镜头：B\n背景：Garden\n出场：Zhang San'),
      'DUPLICATE_FIELD',
    );
    expectError(
      () => parseStructuredSceneInput('镜头：A\n背景：Garden\n角色：Zhang San'),
      'UNKNOWN_FIELD',
    );
    expectError(
      () => parseStructuredSceneInput('镜头：\n背景：Garden\n出场：Zhang San'),
      'EMPTY_FIELD',
    );
    expectError(
      () => parseStructuredSceneInput('镜头：A\n背景：Garden'),
      'MISSING_FIELD',
    );
    let parseError: unknown;
    try {
      parseStructuredSceneInput('镜头：A\n背景：Garden\n角色：Zhang San');
    } catch (error) {
      parseError = error;
    }
    expect(parseError).toMatchObject({ code: 'UNKNOWN_FIELD', lineNumber: 3 });
  });

  it('returns exact-name candidates and creates only after an explicit ambiguous choice', () => {
    const project = makeProject();
    const secondBackgroundId = '85200000-0000-4000-8000-000000000010';
    const projectWithAmbiguity = ProjectSchema.parse({
      ...project,
      assets: [
        ...project.assets,
        { ...project.assets[0]!, id: secondBackgroundId },
      ],
    });
    const service = serviceWithIds();
    const resolution = service.resolve(projectWithAmbiguity, INPUT);

    expect(resolution.backgroundCandidates.map(({ value }) => value.id)).toEqual([
      IDS.background,
      secondBackgroundId,
    ]);
    expect(resolution.backgroundCandidates.every(({ selectable }) => selectable)).toBe(true);
    expect(resolution.characterCandidates.map(({ value }) => value.id)).toEqual([
      IDS.character,
    ]);
    expect(resolution.characterCandidates.every(({ selectable }) => selectable)).toBe(true);
    expectError(
      () => service.create(projectWithAmbiguity, INPUT),
      'BACKGROUND_AMBIGUOUS',
    );

    const result = service.create(projectWithAmbiguity, INPUT, {
      backgroundAssetId: secondBackgroundId,
    });
    expect(result.backgroundAssetId).toBe(secondBackgroundId);
    expect(result.characterId).toBe(IDS.character);
    expect(result.expressionId).toBe(IDS.expression);
  });

  it('reports unusable named candidates without silently choosing them', () => {
    const project = makeProject();
    const unavailableBackground = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === IDS.background
          ? { ...asset, usage: 'character' }
          : asset,
      ),
    });
    const resolution = serviceWithIds().resolve(unavailableBackground, INPUT);
    expect(resolution.backgroundCandidates).toHaveLength(1);
    expect(resolution.backgroundCandidates[0]).toMatchObject({
      selectable: false,
      errorCode: 'BACKGROUND_NOT_USABLE',
    });
    expectError(
      () => serviceWithIds().create(unavailableBackground, INPUT),
      'BACKGROUND_NOT_USABLE',
    );
  });

  it('rejects missing, ambiguous, misclassified, and invalid assets before returning a Project', () => {
    const project = makeProject();
    expectError(
      () =>
        serviceWithIds().create(
          project,
          INPUT.replace('背景：Garden', '背景：Missing'),
        ),
      'BACKGROUND_NOT_FOUND',
    );
    expectError(
      () =>
        serviceWithIds().create(
          ProjectSchema.parse({
            ...project,
            assets: [
              ...project.assets,
              { ...project.assets[0]!, id: '85200000-0000-4000-8000-000000000010' },
            ],
          }),
          INPUT,
        ),
      'BACKGROUND_AMBIGUOUS',
    );
    expectError(
      () =>
        serviceWithIds().create(
          ProjectSchema.parse({
            ...project,
            assets: project.assets.map((asset) =>
              asset.id === IDS.background
                ? { ...asset, usage: 'character' }
                : asset,
            ),
          }),
          INPUT,
        ),
      'BACKGROUND_NOT_USABLE',
    );
    expectError(
      () =>
        serviceWithIds().create(
          ProjectSchema.parse({
            ...project,
            assets: project.assets.map((asset) =>
              asset.id === IDS.background
                ? {
                    ...asset,
                    metadata: {
                      status: 'error',
                      code: 'ASSET_METADATA_INVALID_IMAGE',
                      message: 'Invalid image.',
                    },
                  }
                : asset,
            ),
          }),
          INPUT,
        ),
      'BACKGROUND_NOT_USABLE',
    );
  });

  it('rejects missing, unassembled, and invalid-resource Characters', () => {
    const project = makeProject();
    expectError(
      () =>
        serviceWithIds().create(
          project,
          INPUT.replace('出场：Zhang San', '出场：Missing'),
        ),
      'CHARACTER_NOT_FOUND',
    );

    const character = project.characters[0]!;
    const singleImage = ProjectSchema.parse({
      ...project,
      characters: [
        {
          id: character.id,
          name: character.name,
          mode: 'single-image',
          baseAssetId: character.baseAssetId,
          defaultVoiceProfileId: character.defaultVoiceProfileId,
          expressions: character.expressions,
          defaultExpressionId: character.defaultExpressionId,
          defaultScale: character.defaultScale,
          defaultFlipX: character.defaultFlipX,
        },
      ],
    });
    expectError(
      () => serviceWithIds().create(singleImage, INPUT),
      'CHARACTER_NOT_ASSEMBLED',
    );

    const brokenFace = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === IDS.face
          ? {
              ...asset,
              metadata: {
                status: 'error',
                code: 'ASSET_METADATA_INVALID_IMAGE',
                message: 'Invalid image.',
              },
            }
          : asset,
      ),
    });
    expectError(
      () => serviceWithIds().create(brokenFace, INPUT),
      'CHARACTER_ASSET_UNAVAILABLE',
    );
  });

  it('rejects a conflicting Shot name and leaves the input Project untouched when a service fails', () => {
    const original = makeProject();
    expectError(
      () =>
        serviceWithIds().create(
          original,
          INPUT.replace('Garden meeting', 'Existing scene'),
        ),
      'SHOT_NAME_CONFLICT',
    );

    const realLayerService = new LayerService();
    let layerCreationCalls = 0;
    const failingLayerService = {
      createFromAsset: (...args: Parameters<LayerService['createFromAsset']>) => {
        layerCreationCalls += 1;
        if (layerCreationCalls === 2) {
          throw new Error('Injected character layer failure.');
        }
        return realLayerService.createFromAsset(...args);
      },
      setBackground: realLayerService.setBackground.bind(realLayerService),
    };
    expect(() =>
      serviceWithIds(failingLayerService).create(original, INPUT),
    ).toThrow('Injected character layer failure.');
    expect(original).toEqual(makeProject());
  });
});
