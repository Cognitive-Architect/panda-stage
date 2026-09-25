import { ProjectSchema, type Project, type Shot } from '../../domain';
import {
  PROBE_AUDIO_ASSET_ID,
  PROBE_PROJECT,
  PROBE_SHOT,
} from './probe-project';

export const BFM_S08_PROBE_IDS = Object.freeze({
  bodyAsset: '62000000-0000-4000-8000-000000000001',
  faceNormalAsset: '62000000-0000-4000-8000-000000000002',
  faceAngryAsset: '62000000-0000-4000-8000-000000000003',
  mouthAsset: '62000000-0000-4000-8000-000000000004',
  character: '62000000-0000-4000-8000-000000000005',
  expressionNormal: '62000000-0000-4000-8000-000000000006',
  expressionAngry: '62000000-0000-4000-8000-000000000007',
  voiceProfile: '62000000-0000-4000-8000-000000000008',
  characterLayer: '62000000-0000-4000-8000-000000000009',
  dialogue: '62000000-0000-4000-8000-00000000000a',
  audioClip: '62000000-0000-4000-8000-00000000000b',
  scaleEvent: '62000000-0000-4000-8000-00000000000c',
  opacityEvent: '62000000-0000-4000-8000-00000000000d',
  flipEvent: '62000000-0000-4000-8000-00000000000e',
  expressionEvent: '62000000-0000-4000-8000-00000000000f',
});

function imageAsset(
  id: string,
  name: string,
  relativePath: string,
  width: number,
  height: number,
): Project['assets'][number] {
  return {
    id,
    kind: 'image',
    name,
    relativePath,
    mimeType: 'image/svg+xml',
    width,
    height,
  };
}

const { bodyAsset, faceNormalAsset, faceAngryAsset, mouthAsset } =
  BFM_S08_PROBE_IDS;
const characterLayerId = BFM_S08_PROBE_IDS.characterLayer;

const probeShot: Shot = {
  ...PROBE_SHOT,
  name: 'BFM-S08 exact composite capture',
  durationMs: 3_000,
  backgroundLayerId: null,
  dialogues: [
    {
      id: BFM_S08_PROBE_IDS.dialogue,
      characterId: BFM_S08_PROBE_IDS.character,
      voiceProfileId: BFM_S08_PROBE_IDS.voiceProfile,
      audioClipId: BFM_S08_PROBE_IDS.audioClip,
      subtitleStyleId: PROBE_SHOT.defaultSubtitleStyleId,
      startMs: 900,
      endMs: 1_300,
      text: 'BFM-S08 speaking sample',
    },
  ],
  audioClips: [
    {
      id: BFM_S08_PROBE_IDS.audioClip,
      name: 'BFM-S08 voice sample',
      assetId: PROBE_AUDIO_ASSET_ID,
      startMs: 900,
      endMs: 1_300,
      offsetMs: 0,
      volume: 1,
    },
  ],
  layers: [
    {
      id: characterLayerId,
      name: 'BFM-S08 composite character',
      source: {
        kind: 'character',
        characterId: BFM_S08_PROBE_IDS.character,
        expressionId: BFM_S08_PROBE_IDS.expressionNormal,
      },
      anchor: 'center',
      x: 960,
      y: 540,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: 0,
      locked: false,
      flipX: false,
    },
  ],
  timelineEvents: [
    {
      id: BFM_S08_PROBE_IDS.scaleEvent,
      type: 'scale',
      layerId: characterLayerId,
      startMs: 0,
      endMs: 1_000,
      from: { x: 1, y: 1 },
      to: { x: 0.6, y: 0.8 },
      easing: 'linear',
    },
    {
      id: BFM_S08_PROBE_IDS.opacityEvent,
      type: 'opacity',
      layerId: characterLayerId,
      startMs: 0,
      endMs: 1_000,
      from: 1,
      to: 0.5,
      easing: 'linear',
    },
    {
      id: BFM_S08_PROBE_IDS.flipEvent,
      type: 'flip',
      axis: 'horizontal',
      layerId: characterLayerId,
      startMs: 500,
      endMs: 500,
      flipped: true,
    },
    {
      id: BFM_S08_PROBE_IDS.expressionEvent,
      type: 'expression',
      layerId: characterLayerId,
      startMs: 500,
      endMs: 500,
      expressionId: BFM_S08_PROBE_IDS.expressionAngry,
    },
  ],
};

export const BFM_S08_PROBE_PROJECT: Project = ProjectSchema.parse({
  ...PROBE_PROJECT,
  name: 'BFM-S08 hidden exact composite-frame probe',
  assets: [
    imageAsset(bodyAsset, 'BFM-S08 body', 'probe/bfm-s08-body.svg', 640, 800),
    imageAsset(
      faceNormalAsset,
      'BFM-S08 normal face',
      'probe/bfm-s08-face-normal.svg',
      320,
      240,
    ),
    imageAsset(
      faceAngryAsset,
      'BFM-S08 angry face',
      'probe/bfm-s08-face-angry.svg',
      320,
      240,
    ),
    imageAsset(mouthAsset, 'BFM-S08 mouth face', 'probe/bfm-s08-mouth.svg', 320, 240),
    ...PROBE_PROJECT.assets.filter(
      (asset) => asset.id === PROBE_AUDIO_ASSET_ID,
    ),
  ],
  characters: [
    {
      id: BFM_S08_PROBE_IDS.character,
      mode: 'composite',
      name: 'BFM-S08 composite sample',
      baseAssetId: faceNormalAsset,
      defaultVoiceProfileId: BFM_S08_PROBE_IDS.voiceProfile,
      expressions: [
        {
          id: BFM_S08_PROBE_IDS.expressionNormal,
          name: 'normal',
          assetId: faceNormalAsset,
        },
        {
          id: BFM_S08_PROBE_IDS.expressionAngry,
          name: 'angry',
          assetId: faceAngryAsset,
        },
      ],
      defaultExpressionId: BFM_S08_PROBE_IDS.expressionNormal,
      mouthOpenAssetId: mouthAsset,
      defaultScale: 1,
      defaultFlipX: false,
      bodyAssetId: bodyAsset,
      facePlacement: { offsetX: 10, offsetY: -180, scale: 0.75 },
    },
  ],
  voiceProfiles: [
    {
      id: BFM_S08_PROBE_IDS.voiceProfile,
      name: 'BFM-S08 sample voice',
      characterId: BFM_S08_PROBE_IDS.character,
      locale: 'zh-CN',
      rate: 1,
      pitch: 0,
    },
  ],
  shots: [probeShot],
});

export const BFM_S08_PROBE_SHOT = BFM_S08_PROBE_PROJECT.shots[0]!;
