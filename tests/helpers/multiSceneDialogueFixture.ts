import {
  ProjectSchema,
  type AudioAsset,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from '../unit/domain/testProject';

/** Stable UUIDs for AUTO-05 fixtures, disjoint from the base project's IDs. */
export const AUTO05_IDS = {
  charZhang: '20000000-0000-4000-8000-000000000011',
  exprZhang: '20000000-0000-4000-8000-000000000012',
  voiceZhang: '30000000-0000-4000-8000-000000000011',
  bodyZhang: '10000000-0000-4000-8000-000000000011',
  faceZhang: '10000000-0000-4000-8000-000000000012',
  charLi: '20000000-0000-4000-8000-000000000021',
  exprLi: '20000000-0000-4000-8000-000000000022',
  voiceLi: '30000000-0000-4000-8000-000000000021',
  bodyLi: '10000000-0000-4000-8000-000000000021',
  faceLi: '10000000-0000-4000-8000-000000000022',
  charElder: '20000000-0000-4000-8000-000000000031',
  exprElder: '20000000-0000-4000-8000-000000000032',
  voiceElder: '30000000-0000-4000-8000-000000000031',
  bodyElder: '10000000-0000-4000-8000-000000000031',
  faceElder: '10000000-0000-4000-8000-000000000032',
  bgHall: '10000000-0000-4000-8000-000000000041',
  audio1: '80000000-0000-4000-8000-000000000001',
  audio2: '80000000-0000-4000-8000-000000000002',
  audio3: '80000000-0000-4000-8000-000000000003',
  audio4: '80000000-0000-4000-8000-000000000004',
  audio5: '80000000-0000-4000-8000-000000000005',
  audio6: '80000000-0000-4000-8000-000000000006',
} as const;

export function audioAsset(
  id: string,
  fileName: string,
  durationMs: number | undefined,
  extra: Record<string, unknown> = {},
): AudioAsset {
  // Imported assets keep the stem as their trusted `name`; the on-disk path
  // carries the extension (and possibly a collision hash).
  return {
    id,
    kind: 'audio',
    name: fileName.replace(/\.[^.]+$/u, ''),
    relativePath: `audio/${fileName}`,
    mimeType: fileName.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
    ...(durationMs === undefined ? {} : { durationMs }),
    ...extra,
  } as AudioAsset;
}

export const AUDIO_NAMES = [
  '001_张三.wav',
  '002_李四.wav',
  '003_大长老.wav',
  '004_张三.wav',
  '005_李四.wav',
  '006_大长老.wav',
] as const;

export const AUDIO_DURATIONS = [1420, 1870, 2000, 1600, 1100, 1300] as const;

export const AUDIO_IDS = [
  AUTO05_IDS.audio1,
  AUTO05_IDS.audio2,
  AUTO05_IDS.audio3,
  AUTO05_IDS.audio4,
  AUTO05_IDS.audio5,
  AUTO05_IDS.audio6,
] as const;

export function defaultAudioAssets(): AudioAsset[] {
  return AUDIO_NAMES.map((name, index) =>
    audioAsset(AUDIO_IDS[index]!, name, AUDIO_DURATIONS[index]),
  );
}

function imageAsset(id: string, name: string, usage: 'background' | 'uncategorized' = 'uncategorized') {
  return {
    id,
    kind: 'image' as const,
    name,
    relativePath: `${name}.png`,
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
    expressions: [{ id: expressionId, name: '正常', assetId: expressionAssetId }],
    defaultExpressionId: expressionId,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId,
    facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
  };
}

function voiceProfile(id: string, name: string, characterId: string) {
  return {
    id,
    name,
    characterId,
    locale: 'zh-CN',
    rate: 1,
    pitch: 1,
  };
}

/** A valid Project with 3 castable Characters, 2 backgrounds and 6 audios. */
export function buildDialogueProject(
  audio: readonly AudioAsset[] = defaultAudioAssets(),
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
      imageAsset(AUTO05_IDS.bgHall, '宗门大厅', 'background'),
      imageAsset(AUTO05_IDS.bodyZhang, '张三身体'),
      imageAsset(AUTO05_IDS.faceZhang, '张三表情'),
      imageAsset(AUTO05_IDS.bodyLi, '李四身体'),
      imageAsset(AUTO05_IDS.faceLi, '李四表情'),
      imageAsset(AUTO05_IDS.bodyElder, '大长老身体'),
      imageAsset(AUTO05_IDS.faceElder, '大长老表情'),
      ...audio,
    ],
    characters: [
      {
        ...base.characters[0]!,
        mode: 'composite' as const,
        bodyAssetId: IDS.assetChar,
        facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
      },
      compositeCharacter(
        AUTO05_IDS.charZhang,
        '张三',
        AUTO05_IDS.bodyZhang,
        AUTO05_IDS.exprZhang,
        AUTO05_IDS.faceZhang,
        AUTO05_IDS.voiceZhang,
      ),
      compositeCharacter(
        AUTO05_IDS.charLi,
        '李四',
        AUTO05_IDS.bodyLi,
        AUTO05_IDS.exprLi,
        AUTO05_IDS.faceLi,
        AUTO05_IDS.voiceLi,
      ),
      compositeCharacter(
        AUTO05_IDS.charElder,
        '大长老',
        AUTO05_IDS.bodyElder,
        AUTO05_IDS.exprElder,
        AUTO05_IDS.faceElder,
        AUTO05_IDS.voiceElder,
      ),
    ],
    voiceProfiles: [
      ...base.voiceProfiles,
      voiceProfile(AUTO05_IDS.voiceZhang, '张三声线', AUTO05_IDS.charZhang),
      voiceProfile(AUTO05_IDS.voiceLi, '李四声线', AUTO05_IDS.charLi),
      voiceProfile(AUTO05_IDS.voiceElder, '大长老声线', AUTO05_IDS.charElder),
    ],
  });
}

export const TWO_BLOCKS = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '对白：',
  '张三：你怎么来了？',
  '李四：我来找你。',
  '---',
  '镜头：宗门大厅',
  '背景：宗门大厅',
  '出场：张三、大长老',
  '站位：双人对话',
  '对白：',
  '大长老：你可知错？',
  '张三：弟子知错。',
].join('\n');

export const THREE_BLOCKS = [
  TWO_BLOCKS,
  '---',
  '镜头：山门',
  '背景：花园',
  '出场：李四、大长老',
  '站位：双人对话',
  '对白：',
  '李四：这就走？',
  '大长老：走吧。',
].join('\n');
