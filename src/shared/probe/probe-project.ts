import { ProjectSchema, type Project, type Shot } from '../domain';
import { SubtitleTrackSchema } from '../preview/subtitle-engine';

export const PROBE_BACKGROUND_ASSET_ID =
  '10000000-0000-4000-8000-000000000001';
export const PROBE_CHARACTER_ASSET_ID =
  '10000000-0000-4000-8000-000000000002';
export const PROBE_AUDIO_ASSET_ID =
  '10000000-0000-4000-8000-000000000003';
export const PROBE_CHARACTER_LAYER_ID =
  '20000000-0000-4000-8000-000000000002';
export const PROBE_CAPTION = '每一个故事，都从勇敢迈出第一步开始。';
export const PROBE_SUBTITLE_CUES = SubtitleTrackSchema.parse([
  {
    id: '50000000-0000-4000-8000-000000000001',
    startMs: 200,
    endMs: 1_400,
    text: '风吹过竹林，新的旅程准备出发。',
  },
  {
    id: '50000000-0000-4000-8000-000000000002',
    startMs: 1_400,
    endMs: 2_850,
    text: PROBE_CAPTION,
  },
]);

export const PROBE_PROJECT: Project = ProjectSchema.parse({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000004',
  name: 'Day 04 共享舞台探针',
  width: 1920,
  height: 1080,
  fps: 24,
  assets: [
    {
      id: PROBE_BACKGROUND_ASSET_ID,
      kind: 'image',
      name: '探针竹林背景',
      relativePath: 'probe/stage-background.svg',
      mimeType: 'image/svg+xml',
      width: 1920,
      height: 1080,
    },
    {
      id: PROBE_CHARACTER_ASSET_ID,
      kind: 'image',
      name: '透明熊猫角色',
      relativePath: 'probe/panda-character.png',
      mimeType: 'image/png',
      width: 640,
      height: 640,
    },
    {
      id: PROBE_AUDIO_ASSET_ID,
      kind: 'audio',
      name: '三秒预览提示音',
      relativePath: 'probe/preview-tone.wav',
      mimeType: 'audio/wav',
      durationMs: 3_000,
    },
  ],
  shots: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      name: '熊猫横向移动探针',
      durationMs: 3_000,
      layers: [
        {
          id: '20000000-0000-4000-8000-000000000001',
          assetId: PROBE_BACKGROUND_ASSET_ID,
          name: '背景',
          anchor: 'center',
          x: 960,
          y: 540,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
          opacity: 1,
          visible: true,
          zIndex: 0,
        },
        {
          id: PROBE_CHARACTER_LAYER_ID,
          assetId: PROBE_CHARACTER_ASSET_ID,
          name: '熊猫角色',
          anchor: 'center',
          x: 430,
          y: 690,
          scaleX: 0.72,
          scaleY: 0.72,
          rotationDeg: 0,
          opacity: 1,
          visible: true,
          zIndex: 1,
        },
      ],
      timelineEvents: [
        {
          id: '40000000-0000-4000-8000-000000000001',
          type: 'move',
          layerId: PROBE_CHARACTER_LAYER_ID,
          startMs: 0,
          durationMs: 3_000,
          from: { x: 430, y: 690 },
          to: { x: 1_490, y: 690 },
          easing: 'ease-in-out',
        },
      ],
    },
  ],
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
});

const probeShot = PROBE_PROJECT.shots[0];
if (!probeShot) {
  throw new Error('Probe project must contain one shot.');
}

export const PROBE_SHOT: Shot = probeShot;
