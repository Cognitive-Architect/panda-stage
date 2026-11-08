import { describe, expect, it } from 'vitest';
import {
  buildAudioEnvelopeFromChannels,
  evaluateShotAtTime,
  ProjectSchema,
  projectShotMouth,
  resolveShotMouthDecision,
  type AudioEnvelope,
  type MouthEnvelopeSource,
  type Project,
} from '../../src/domain';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { projectProductPreviewDialogue } from '../../src/renderer/shell/productPreviewModel';
import {
  buildExportAudioEnvelopes,
  createExportMouthSource,
  evaluateExportShotAtTime,
} from '../../src/export-renderer/evaluateExportShotAtTime';
import { ExportLoadFormalRequestSchema } from '../../src/shared/export-types';
import { buildProject, IDS } from './domain/testProject';

const BODY_ID = '10000000-0000-4000-8000-0000000000a4';
const FACE_ID = '10000000-0000-4000-8000-0000000000a5';
const MOUTH_ID = '10000000-0000-4000-8000-0000000000a7';
const AUDIO_ID = '10000000-0000-4000-8000-0000000000a8';
const DIALOGUE_ID = '80000000-0000-4000-8000-0000000000a4';
const CLIP_ID = '70000000-0000-4000-8000-0000000000a4';
const SAMPLE_RATE = 8_000;

/** 0-400ms tone, 400-800ms pause, 800-1200ms tone. */
function toneSilenceTone(): AudioEnvelope {
  const samples = new Float32Array(9_600);
  for (let index = 0; index < 3_200; index += 1) {
    samples[index] = 0.5 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE);
    samples[index + 6_400] =
      0.5 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE);
  }
  return buildAudioEnvelopeFromChannels([samples], SAMPLE_RATE);
}

const ENVELOPE = toneSilenceTone();

function readySource(envelope: AudioEnvelope): MouthEnvelopeSource {
  return () => ({ status: 'ready', envelope });
}

function speakingProject(options: { offsetMs?: number } = {}): Project {
  const base = buildProject();
  const character = base.characters[0]!;
  const shot = base.shots[0]!;
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      {
        id: BODY_ID,
        kind: 'image',
        name: 'body',
        relativePath: 'assets/body.png',
        mimeType: 'image/png',
        width: 800,
        height: 1_000,
        usage: 'uncategorized',
        keywords: [],
      },
      {
        id: FACE_ID,
        kind: 'image',
        name: 'face',
        relativePath: 'assets/face.png',
        mimeType: 'image/png',
        width: 200,
        height: 100,
        usage: 'uncategorized',
        keywords: [],
      },
      {
        id: MOUTH_ID,
        kind: 'image',
        name: 'mouth',
        relativePath: 'assets/mouth.png',
        mimeType: 'image/png',
        width: 400,
        height: 300,
        usage: 'uncategorized',
        keywords: [],
      },
      {
        id: AUDIO_ID,
        kind: 'audio',
        name: 'voice',
        relativePath: 'assets/voice.wav',
        mimeType: 'audio/wav',
        durationMs: 2_000,
      },
    ],
    characters: [
      {
        ...character,
        mode: 'composite' as const,
        baseAssetId: FACE_ID,
        expressions: [
          { id: IDS.expressionNormal, name: 'normal', assetId: FACE_ID },
        ],
        defaultExpressionId: IDS.expressionNormal,
        bodyAssetId: BODY_ID,
        facePlacement: { offsetX: 420, offsetY: -8, scale: 0.5 },
        mouthOpenAssetId: MOUTH_ID,
      },
    ],
    shots: [
      {
        ...shot,
        durationMs: 4_000,
        timelineEvents: [],
        dialogues: [
          {
            id: DIALOGUE_ID,
            characterId: character.id,
            voiceProfileId: character.defaultVoiceProfileId,
            subtitleStyleId: IDS.subtitle,
            audioClipId: CLIP_ID,
            startMs: 1_000,
            endMs: 2_200,
            text: 'speaking',
          },
        ],
        audioClips: [
          {
            id: CLIP_ID,
            role: 'dialogue',
            name: 'voice',
            assetId: AUDIO_ID,
            startMs: 1_000,
            endMs: 2_200,
            offsetMs: options.offsetMs ?? 0,
            volume: 1,
          },
        ],
      },
    ],
  });
}

function mouthAssetIdAt(
  project: Project,
  timeMs: number,
  source: MouthEnvelopeSource | undefined,
): string | null | undefined {
  const shot = project.shots[0]!;
  const evaluated = projectShotMouth(
    project,
    shot,
    evaluateShotAtTime(shot, timeMs, project),
    DIALOGUE_ID,
    source,
  );
  return evaluated.layers.find((layer) => layer.id === IDS.layerChar)
    ?.mouthOverrideAssetId;
}

describe('AUTO-07A volume-driven Mouth projection', () => {
  it('opens on real sound and closes through a real pause', () => {
    const project = speakingProject();
    // Shot 1.0s -> source 0ms (tone), 1.44s -> source 440ms (pause tail),
    // 1.52s -> source 520ms (pause), 2.0s -> source 1.0s (tone).
    expect(mouthAssetIdAt(project, 1_000, readySource(ENVELOPE))).toBe(MOUTH_ID);
    expect(mouthAssetIdAt(project, 1_520, readySource(ENVELOPE))).toBeNull();
    expect(mouthAssetIdAt(project, 2_000, readySource(ENVELOPE))).toBe(MOUTH_ID);
  });

  it('honours a trimmed source offset instead of treating Shot time as file time', () => {
    // offsetMs=400 skips the leading tone, so Shot 1.12s reads source 520ms,
    // the real pause, while the untrimmed clip is still speaking there.
    const trimmed = speakingProject({ offsetMs: 400 });
    const untrimmed = speakingProject();
    expect(mouthAssetIdAt(untrimmed, 1_120, readySource(ENVELOPE))).toBe(MOUTH_ID);
    expect(mouthAssetIdAt(trimmed, 1_120, readySource(ENVELOPE))).toBeNull();
    // Source 800ms onwards is the second tone for both clips.
    expect(mouthAssetIdAt(trimmed, 1_400, readySource(ENVELOPE))).toBe(MOUTH_ID);
  });

  it('degrades explicitly when the envelope is unavailable', () => {
    const project = speakingProject();
    const shot = project.shots[0]!;
    const failed: MouthEnvelopeSource = () => ({
      status: 'unavailable',
      reason: 'decode-failed',
    });
    const decision = resolveShotMouthDecision(
      project,
      shot,
      1_000,
      DIALOGUE_ID,
      failed,
    );
    expect(decision).toMatchObject({
      open: false,
      mode: 'envelope',
      reason: 'decode-failed',
    });
    expect(mouthAssetIdAt(project, 1_000, failed)).toBeNull();

    const pending = resolveShotMouthDecision(
      project,
      shot,
      1_000,
      DIALOGUE_ID,
      () => undefined,
    );
    expect(pending.reason).toBe('envelope-pending');
  });

  it('keeps the documented legacy rhythm only when no source is supplied', () => {
    const project = speakingProject();
    const shot = project.shots[0]!;
    const decision = resolveShotMouthDecision(project, shot, 1_000, DIALOGUE_ID);
    expect(decision.mode).toBe('legacy-rhythm');
    expect(mouthAssetIdAt(project, 1_000, undefined)).toBe(MOUTH_ID);
  });

  it('feeds Editor Canvas, Product Preview and Export from one judgment', () => {
    const project = speakingProject();
    const shot = project.shots[0]!;
    const source = readySource(ENVELOPE);
    const model = buildEditorTemporalCanvasModel({
      project,
      shot,
      currentTimeMs: 1_520,
      activeDialogueId: DIALOGUE_ID,
      readyAssetIds: new Set(),
      previousVisuals: new Map(),
      mouthSource: source,
    });
    const preview = projectProductPreviewDialogue(
      project,
      shot,
      evaluateShotAtTime(shot, 1_520, project),
      DIALOGUE_ID,
      source,
    );
    const exported = evaluateExportShotAtTime(
      project,
      shot,
      1_520,
      DIALOGUE_ID,
      source,
    );
    const mouthOf = (layers: readonly { id: string; mouthOverrideAssetId?: string | null }[]) =>
      layers.find((layer) => layer.id === IDS.layerChar)?.mouthOverrideAssetId ?? null;

    expect(mouthOf(model.evaluatedShot.layers)).toBeNull();
    expect(mouthOf(preview.layers)).toBeNull();
    expect(mouthOf(exported.layers)).toBeNull();

    const editorOpen = buildEditorTemporalCanvasModel({
      project,
      shot,
      currentTimeMs: 1_000,
      activeDialogueId: DIALOGUE_ID,
      readyAssetIds: new Set(),
      previousVisuals: new Map(),
      mouthSource: source,
    });
    expect(mouthOf(editorOpen.evaluatedShot.layers)).toBe(MOUTH_ID);
  });

  it('never borrows another character mouth and stops at the Dialogue edge', () => {
    const project = speakingProject();
    expect(mouthAssetIdAt(project, 999, readySource(ENVELOPE))).toBeNull();
    expect(mouthAssetIdAt(project, 2_200, readySource(ENVELOPE))).toBeNull();

    const withoutMouth = ProjectSchema.parse({
      ...project,
      characters: project.characters.map((character) => ({
        ...character,
        mouthOpenAssetId: undefined,
      })),
    });
    expect(mouthAssetIdAt(withoutMouth, 1_000, readySource(ENVELOPE))).toBeNull();
  });
});

/**
 * AUTO-07-FIX-01: the P1 regression was that formal `loadFormal` only ever
 * carried images. These bytes are a real 16-bit mono PCM WAV (tone / pause /
 * tone), decoded below by a real RIFF reader rather than a faked envelope.
 */
const FORMAL_JOB_ID = '30000000-0000-4000-8000-0000000000a7';
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71]);

function toneSilenceToneWav(): Uint8Array {
  const frames = 9_600;
  const pcm = new Int16Array(frames);
  for (let index = 0; index < 3_200; index += 1) {
    const sample = Math.round(
      16_000 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE),
    );
    pcm[index] = sample;
    pcm[index + 6_400] = sample;
  }
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer));
  return new Uint8Array(buffer);
}

const decodeWavPcm = async (
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ channels: Float32Array[]; sampleRate: number }> => {
  if (mimeType !== 'audio/wav') throw new Error(`Unsupported ${mimeType}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number): string =>
    Array.from({ length }, (_, index) =>
      String.fromCharCode(view.getUint8(offset + index)),
    ).join('');
  if (
    ascii(0, 4) !== 'RIFF' ||
    ascii(8, 4) !== 'WAVE' ||
    ascii(36, 4) !== 'data' ||
    view.getUint16(34, true) !== 16
  ) {
    throw new Error('Not a 16-bit PCM WAV.');
  }
  const sampleRate = view.getUint32(24, true);
  const frameCount = view.getUint32(40, true) / 2;
  const samples = new Float32Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    samples[index] = view.getInt16(44 + index * 2, true) / 32_768;
  }
  return { channels: [samples], sampleRate };
};

function formalLoadRequest(voiceBytes: Uint8Array) {
  return {
    jobId: FORMAL_JOB_ID,
    project: speakingProject(),
    cameraMode: 'static' as const,
    media: [
      {
        assetId: BODY_ID,
        kind: 'image' as const,
        mimeType: 'image/png' as const,
        bytes: IMAGE_BYTES,
      },
      {
        assetId: AUDIO_ID,
        kind: 'audio' as const,
        mimeType: 'audio/wav' as const,
        bytes: voiceBytes,
      },
    ],
  };
}

function formalMouthAt(
  project: Project,
  timeMs: number,
  source: MouthEnvelopeSource,
): string | null {
  const evaluated = evaluateExportShotAtTime(
    project,
    project.shots[0]!,
    timeMs,
    DIALOGUE_ID,
    source,
  );
  return (
    evaluated.layers.find((layer) => layer.id === IDS.layerChar)
      ?.mouthOverrideAssetId ?? null
  );
}

describe('AUTO-07-FIX-01 formal loadFormal Mouth wiring', () => {
  const voiceBytes = toneSilenceToneWav();

  it('keeps frozen voice bytes in the parsed formal-load IPC request', () => {
    const parsed = ExportLoadFormalRequestSchema.parse(
      formalLoadRequest(voiceBytes),
    );
    expect(parsed.media.find((entry) => entry.assetId === AUDIO_ID)).toMatchObject({
      kind: 'audio',
      mimeType: 'audio/wav',
    });
    expect(
      parsed.media.find((entry) => entry.assetId === AUDIO_ID)?.bytes.byteLength,
    ).toBe(voiceBytes.byteLength);

    // Pre-AUTO-07 image-only requests had no `kind` and must still be valid.
    const legacy = ExportLoadFormalRequestSchema.parse({
      ...formalLoadRequest(voiceBytes),
      media: [
        {
          assetId: BODY_ID,
          mimeType: 'image/png',
          bytes: IMAGE_BYTES,
        },
      ],
    });
    expect(legacy.media).toEqual([
      {
        assetId: BODY_ID,
        kind: 'image',
        mimeType: 'image/png',
        bytes: IMAGE_BYTES,
      },
    ]);
  });

  it('renders a loud formal frame open and a pause frame closed from real decoded bytes', async () => {
    const request = ExportLoadFormalRequestSchema.parse(
      formalLoadRequest(voiceBytes),
    );
    const envelopes = await buildExportAudioEnvelopes(
      request.media,
      decodeWavPcm,
    );
    expect(envelopes.has(AUDIO_ID)).toBe(true);
    const source = createExportMouthSource(envelopes);
    const project = request.project as Project;

    // Shot 1.0s -> source 0ms tone, 1.52s -> 520ms pause, 2.0s -> 1.0s tone.
    expect(formalMouthAt(project, 1_000, source)).toBe(MOUTH_ID);
    expect(formalMouthAt(project, 1_520, source)).toBeNull();
    expect(formalMouthAt(project, 2_000, source)).toBe(MOUTH_ID);

    // The Editor and Preview reach the same judgment at the same time.
    const shot = project.shots[0]!;
    const editor = buildEditorTemporalCanvasModel({
      project,
      shot,
      currentTimeMs: 1_520,
      activeDialogueId: DIALOGUE_ID,
      readyAssetIds: new Set(),
      previousVisuals: new Map(),
      mouthSource: source,
    });
    const preview = projectProductPreviewDialogue(
      project,
      shot,
      evaluateShotAtTime(shot, 1_520, project),
      DIALOGUE_ID,
      source,
    );
    const mouthOf = (
      layers: readonly { id: string; mouthOverrideAssetId?: string | null }[],
    ) =>
      layers.find((layer) => layer.id === IDS.layerChar)
        ?.mouthOverrideAssetId ?? null;
    expect(mouthOf(editor.evaluatedShot.layers)).toBeNull();
    expect(mouthOf(preview.layers)).toBeNull();
  });

  it('honours a trimmed clip on the formal path instead of file time', async () => {
    const request = ExportLoadFormalRequestSchema.parse(
      formalLoadRequest(voiceBytes),
    );
    const envelopes = await buildExportAudioEnvelopes(
      request.media,
      decodeWavPcm,
    );
    const source = createExportMouthSource(envelopes);
    const trimmed = speakingProject({ offsetMs: 400 });
    // Shot 1.12s reads source 520ms (the pause); 1.4s reads source 800ms.
    expect(formalMouthAt(trimmed, 1_120, source)).toBeNull();
    expect(formalMouthAt(trimmed, 1_400, source)).toBe(MOUTH_ID);
  });

  it('degrades explicitly when the formal request carries no voice bytes', async () => {
    const request = ExportLoadFormalRequestSchema.parse({
      ...formalLoadRequest(voiceBytes),
      media: [
        {
          assetId: BODY_ID,
          mimeType: 'image/png',
          bytes: IMAGE_BYTES,
        },
      ],
    });
    const envelopes = await buildExportAudioEnvelopes(
      request.media,
      decodeWavPcm,
    );
    expect(envelopes.size).toBe(0);
    const project = request.project as Project;
    const source = createExportMouthSource(envelopes);
    expect(formalMouthAt(project, 1_000, source)).toBeNull();
    expect(
      resolveShotMouthDecision(
        project,
        project.shots[0]!,
        1_000,
        DIALOGUE_ID,
        source,
      ),
    ).toMatchObject({ open: false, mode: 'envelope', reason: 'decode-pending' });
  });
});
