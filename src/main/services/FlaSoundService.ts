import { mkdtemp, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AudioClipService,
  ProjectSchema,
  applyFlaSceneAudioClips,
  extractFlaTimelineSoundEvents,
  type FlaResolvedSoundAsset,
  type FlaSoundTimelineDiagnostic,
} from '../../domain';
import { inspectEmbeddedMp3 } from './mp3-header';
import { decodeADPCM } from '../../renderer/fla-import/parser-core/adpcm-decoder';
import type { FlaInspectionIR, FlaSoundMetadata } from '../../shared/fla-import-api';
import { sanitizeAssetFileName } from '../../shared/asset-name';
import type { AssetImportResponse } from '../../shared/asset-import-api';
import type { AudioProbeResult } from '../../shared/ffmpeg-types';
import {
  FLA_SOUND_MAX_BYTES, FLA_SOUND_MAX_SECONDS,
  type FlaSoundImportRequest, type FlaSoundPreviewRequest, type FlaSoundPreviewResponse,
  type FlaSoundTimelineImportRequest, type FlaSoundTimelineImportResponse,
} from '../../shared/fla-sound-api';
import { AssetImportServiceError, type AssetImportService } from './AssetImportService';
import type { FlaImportService } from './FlaImportService';
import { FlaPreflightError, readSelectedFlaArchiveEntry } from './fla-import-preflight-service';
import type { ProjectService } from './ProjectService';

type SoundSource = NonNullable<ReturnType<FlaImportService['getSoundSource']>>;
type SoundTimelineSession = {
  ir: FlaInspectionIR;
  bytes: SoundSource['bytes'];
  entries: SoundSource['entries'];
};
type SoundPayload = { bytes: Uint8Array; mimeType: 'audio/mpeg' | 'audio/wav' };

function unsupported(message: string): never {
  throw new FlaPreflightError('MEDIA_DECODE_FAILED', message);
}

function normalizedSoundReference(raw: string): string {
  const value = raw.replaceAll('\\', '/').normalize('NFKC').replace(/^(?:\.\/)+/u, '');
  if (!value || value.startsWith('/') || value.includes(':') || value.includes('\0') ||
      value.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    unsupported('The embedded sound has an unsupported library path.');
  }
  return value.toLowerCase();
}

function wrapPcmWav(raw: Uint8Array, sampleRate: number, channels: number, bits: number): Buffer {
  const blockAlign = channels * (bits / 8);
  const padding = raw.byteLength % 2;
  const wav = Buffer.alloc(44 + raw.byteLength + padding);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * blockAlign, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bits, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(raw.byteLength, 40);
  wav.set(raw, 44);
  return wav;
}

export function extractFlaSound({ sound, bytes, entries }: SoundSource): SoundPayload {
  const find = (reference: string, prefix: string) => {
    const key = normalizedSoundReference(reference);
    const qualified = key.startsWith(prefix) ? key : prefix + key;
    const findKey = (target: string) => entries.find((entry) => entry.name.normalize('NFKC').toLowerCase() === target);
    return findKey(qualified) ?? findKey(key);
  };
  const embedded = sound.dataHref !== undefined ? find(sound.dataHref, 'bin/') : undefined;
  const original = embedded ? undefined : find(sound.href, 'library/');
  const entry = embedded ?? original;
  if (!entry) unsupported('The selected sound data is missing from the FLA library.');
  const stored = readSelectedFlaArchiveEntry(bytes, entry, FLA_SOUND_MAX_BYTES);
  const declared = embedded ? sound.dataLength : undefined;
  if (declared !== undefined && (declared <= 0 || declared > stored.length)) {
    unsupported('The embedded sound has an invalid data length.');
  }
  const data = stored.subarray(0, declared ?? stored.length);
  const header = Buffer.from(data.buffer, data.byteOffset, Math.min(12, data.length));
  const mp3 = inspectEmbeddedMp3(data);
  if (mp3 !== 'none') {
    if (embedded && declared === undefined) unsupported('The embedded MP3 stream is missing its cache boundary.');
    if (mp3 === 'truncated') unsupported('The embedded MP3 stream has an invalid frame boundary.');
    return { bytes: data, mimeType: 'audio/mpeg' };
  }
  if (header.length === 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE') {
    if (header.readUInt32LE(4) + 8 !== data.length) unsupported('The embedded WAV size is invalid.');
    return { bytes: data, mimeType: 'audio/wav' };
  }
  if (!embedded) unsupported('The selected audio is outside the supported MP3 and PCM formats.');

  const format = sound.format?.trim() ?? '';
  const pcm = /^(\d+(?:\.\d+)?)\s*kHz\s+(8|16)\s*bit\s+(Mono|Stereo)(?:\s+(ADPCM))?$/iu.exec(format);
  const adpcmPrefix = /^ADPCM\s+(\d+(?:\.\d+)?)\s*kHz\s+(8|16)\s*bit\s+(Mono|Stereo)$/iu.exec(format);
  const props = pcm ?? adpcmPrefix;
  if (!props) unsupported('The embedded raw audio format is unsupported.');
  const rate = Number(props[1]);
  const sampleRate = new Map([[11, 11025], [11.025, 11025], [22, 22050], [22.05, 22050],
    [44, 44100], [44.1, 44100], [48, 48000]]).get(rate);
  if (!sampleRate) unsupported('The embedded audio sample rate is unsupported.');
  const channels = props[3]?.toLowerCase() === 'stereo' ? 2 : 1;
  const bitDepth = Number(props[2]);
  const sampleCount = sound.sampleCount;
  if (pcm?.[4] || adpcmPrefix) {
    if (!sampleCount || sampleCount <= 0 || sampleCount % channels !== 0) {
      unsupported('The embedded ADPCM stream is missing its interleaved sample count.');
    }
    const frames = sampleCount / channels;
    const blocks = Math.ceil(frames / 4096);
    const bitsPerSample = (data[0]! >>> 6) + 2;
    const bitCount = 2 + channels * (22 * blocks + (frames - blocks) * bitsPerSample);
    if (frames > sampleRate * FLA_SOUND_MAX_SECONDS || 44 + sampleCount * 2 > FLA_SOUND_MAX_BYTES ||
        Math.ceil(bitCount / 8) !== data.length) {
      unsupported('The embedded ADPCM size is invalid or exceeds the audio budget.');
    }
    const decoded = decodeADPCM(Uint8Array.from(data).buffer, sampleCount, channels);
    if (decoded.length !== sampleCount) unsupported('The embedded ADPCM stream is truncated.');
    const raw = Buffer.alloc(decoded.length * 2);
    for (let index = 0; index < decoded.length; index += 1) raw.writeInt16LE(decoded[index]!, index * 2);
    return { bytes: wrapPcmWav(raw, sampleRate, channels, 16), mimeType: 'audio/wav' };
  }

  const totalSamples = data.length / (bitDepth / 8);
  const frames = totalSamples / channels;
  if (!Number.isInteger(frames) || frames <= 0 || frames > sampleRate * FLA_SOUND_MAX_SECONDS ||
      (sampleCount !== undefined && sampleCount !== totalSamples && sampleCount !== frames) ||
      data.length + 45 > FLA_SOUND_MAX_BYTES) {
    unsupported('The embedded PCM length does not match its audio format or sample count.');
  }
  return { bytes: wrapPcmWav(data, sampleRate, channels, bitDepth), mimeType: 'audio/wav' };
}

function audioFileName(sound: FlaSoundMetadata, mimeType: SoundPayload['mimeType']): string {
  const leaf = sound.name.replaceAll('\\', '/').split('/').at(-1) || 'FLA 音频';
  return sanitizeAssetFileName(leaf.slice(0, 120), mimeType === 'audio/mpeg' ? '.mp3' : '.wav');
}

export class FlaSoundService {
  private readonly previews = new Map<string, { requestId: string; controller: AbortController }>();

  constructor(
    private readonly getSource: (sessionId: string, soundId: string) => SoundSource | null,
    private readonly probe: (filePath: string, signal: AbortSignal) => Promise<AudioProbeResult>,
    private readonly assetImport: Pick<AssetImportService, 'importCandidates'>,
    private readonly validateMp3?: (filePath: string, signal: AbortSignal) => Promise<void>,
    private readonly timelineDeps?: {
      getTimelineSession: (sessionId: string) => SoundTimelineSession | null;
      projectService: ProjectService;
      audioClipService?: AudioClipService;
    },
  ) {}

  cancelPreview(sessionId: string, requestId?: string): boolean {
    const active = this.previews.get(sessionId);
    if (!active || (requestId && active.requestId !== requestId)) return false;
    active.controller.abort();
    this.previews.delete(sessionId);
    return true;
  }

  async preview({ sessionId, soundId, requestId }: FlaSoundPreviewRequest): Promise<FlaSoundPreviewResponse> {
    this.cancelPreview(sessionId);
    const controller = new AbortController();
    this.previews.set(sessionId, { requestId, controller });
    try {
      return await this.withAudio(sessionId, soundId, controller.signal, async (_path, payload, facts) =>
        ({ ok: true, ...payload, bytes: Uint8Array.from(payload.bytes), ...facts }));
    } catch (error) {
      return { ok: false, error: {
        code: controller.signal.aborted ? 'USER_CANCELLED' : error instanceof FlaPreflightError ? error.code : 'MEDIA_DECODE_FAILED',
        message: controller.signal.aborted ? 'The sound preview was cancelled.'
          : (error instanceof Error ? error.message : 'The embedded sound could not be read.').slice(0, 900),
      } };
    } finally {
      if (this.previews.get(sessionId)?.requestId === requestId) this.previews.delete(sessionId);
    }
  }

  async import({ sessionId, soundId, ...project }: FlaSoundImportRequest): Promise<AssetImportResponse> {
    return this.withAudio(sessionId, soundId, AbortSignal.timeout(15_000), async (sourcePath, payload) => ({
      ok: true,
      status: 'completed',
      ...await this.assetImport.importCandidates({
        ...project, candidates: [{ sourcePath, declaredMimeType: payload.mimeType }],
      }),
    }));
  }

  async importSceneTimeline(
    request: FlaSoundTimelineImportRequest,
  ): Promise<FlaSoundTimelineImportResponse> {
    if (!this.timelineDeps) {
      throw new AssetImportServiceError(
        'ASSET_IMPORT_OPERATION_FAILED',
        request.projectRoot,
        'FLA scene sound timeline recovery is not configured.',
      );
    }
    const session = this.timelineDeps.getTimelineSession(request.sessionId);
    if (!session) {
      throw new AssetImportServiceError(
        'ASSET_IMPORT_OPERATION_FAILED',
        request.projectRoot,
        'The FLA inspection session is unavailable. Reopen the FLA to continue.',
      );
    }
    const timeline = session.ir.timelines[request.timelineIndex];
    if (!timeline) {
      throw new AssetImportServiceError(
        'ASSET_IMPORT_PROJECT_INVALID',
        request.projectRoot,
        `Selected FLA Scene timeline #${request.timelineIndex} was not found.`,
      );
    }
    const targetShot = request.project.shots.find((shot) => shot.id === request.shotId);
    if (!targetShot) {
      throw new AssetImportServiceError(
        'ASSET_IMPORT_PROJECT_INVALID',
        request.projectRoot,
        `Target Shot ${request.shotId} was not found in the open project.`,
      );
    }

    const events = extractFlaTimelineSoundEvents(timeline);
    const soundById = new Map((session.ir.sounds ?? []).map((sound) => [sound.id, sound]));
    const uniqueSoundIds: string[] = [];
    const seenSoundIds = new Set<string>();
    for (const event of events) {
      const id = event.sound.soundId;
      if (id && soundById.has(id) && !seenSoundIds.has(id)) {
        seenSoundIds.add(id);
        uniqueSoundIds.push(id);
      }
    }

    const extractionDiagnostics: FlaSoundTimelineDiagnostic[] = [];
    const folder = await mkdtemp(path.join(tmpdir(), 'panda-stage-fla-scene-audio-'));
    const signal = AbortSignal.timeout(30_000);
    try {
      const prepared: Array<{
        sound: FlaSoundMetadata;
        filePath: string;
        mimeType: SoundPayload['mimeType'];
        probedDurationMs: number;
      }> = [];

      for (let index = 0; index < uniqueSoundIds.length; index += 1) {
        const soundId = uniqueSoundIds[index]!;
        const sound = soundById.get(soundId)!;
        try {
          signal.throwIfAborted();
          const payload = extractFlaSound({
            sound,
            bytes: session.bytes,
            entries: session.entries,
          });
          const baseName = audioFileName(sound, payload.mimeType);
          const filePath = path.join(folder, `${index}-${baseName}`);
          await writeFile(filePath, payload.bytes, { flag: 'wx', signal });
          const { codecName, durationSeconds, sampleRate, channels } = await this.probe(filePath, signal);
          if (
            (payload.mimeType === 'audio/mpeg' ? codecName !== 'mp3' : !/^pcm_(?:s16le|u8|s24le|s32le)$/u.test(codecName)) ||
            !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > FLA_SOUND_MAX_SECONDS ||
            !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 ||
            (channels !== 1 && channels !== 2)
          ) {
            unsupported('The embedded audio codec, duration, or sample parameters are unsupported.');
          }
          if (payload.mimeType === 'audio/mpeg') await this.validateMp3?.(filePath, signal);
          prepared.push({
            sound,
            filePath,
            mimeType: payload.mimeType,
            probedDurationMs: Math.max(1, Math.round(durationSeconds * 1000)),
          });
        } catch (error) {
          const firstEvent = events.find((event) => event.sound.soundId === soundId);
          extractionDiagnostics.push({
            code: 'missing-audio-asset',
            soundName: sound.name,
            frameIndex: firstEvent?.frameIndex ?? 0,
            ...(firstEvent ? { layerIndex: firstEvent.layerIndex, sync: firstEvent.sound.sync } : {}),
            message: error instanceof Error ? error.message : `Failed to extract audio "${sound.name}".`,
          });
        }
      }

      let currentProject = request.project;
      let assetsChanged = false;
      const importedAssetIds: string[] = [];
      const resolvedBySoundId = new Map<string, FlaResolvedSoundAsset>();

      if (prepared.length > 0) {
        const importOperation = await this.assetImport.importCandidates({
          projectRoot: request.projectRoot,
          project: request.project,
          baseRevision: request.baseRevision,
          candidates: prepared.map((entry) => ({
            sourcePath: entry.filePath,
            declaredMimeType: entry.mimeType,
          })),
        });
        currentProject = importOperation.project;
        assetsChanged = importOperation.projectChanged;

        for (let index = 0; index < prepared.length; index += 1) {
          const entry = prepared[index]!;
          const result = importOperation.results[index];
          if (!result || (result.status !== 'imported' && result.status !== 'duplicate')) {
            continue;
          }
          const assetId = result.asset?.id ?? result.duplicateOfAssetId;
          if (!assetId) continue;
          if (result.status === 'imported') importedAssetIds.push(assetId);
          const existingAsset = currentProject.assets.find((asset) => asset.id === assetId);
          const durationMs =
            existingAsset?.kind === 'audio' &&
            existingAsset.metadata?.status === 'ready' &&
            existingAsset.durationMs !== undefined
              ? existingAsset.durationMs
              : entry.probedDurationMs;
          resolvedBySoundId.set(entry.sound.id, {
            assetId,
            name: entry.sound.name,
            durationMs,
          });
        }
      }

      const audioClipService = this.timelineDeps.audioClipService ?? new AudioClipService();
      const transactionResult = await this.timelineDeps.projectService.transact(
        request.projectRoot,
        async (transaction) => {
          const diskProject = transaction.existingDocument.project;
          if (diskProject.id !== request.project.id) {
            throw new AssetImportServiceError(
              'ASSET_IMPORT_PROJECT_MISMATCH',
              transaction.projectRoot,
              `Cannot recover FLA scene audio: project identity at ${transaction.projectRoot} does not match the open project.`,
            );
          }

          let workingProject = currentProject;
          let metadataUpdated = false;
          const durationByAssetId = new Map<string, number>();
          for (const resolved of resolvedBySoundId.values()) {
            durationByAssetId.set(resolved.assetId, resolved.durationMs);
          }
          const nextAssets = workingProject.assets.map((asset) => {
            if (asset.kind !== 'audio') return asset;
            const probedDurationMs = durationByAssetId.get(asset.id);
            if (
              probedDurationMs !== undefined &&
              (asset.durationMs === undefined || asset.metadata?.status !== 'ready')
            ) {
              metadataUpdated = true;
              return {
                ...asset,
                durationMs: probedDurationMs,
                metadata: { status: 'ready' as const, warnings: [] },
              };
            }
            return asset;
          });
          if (metadataUpdated) {
            workingProject = ProjectSchema.parse({
              ...workingProject,
              assets: nextAssets,
            });
          }

          const shot = workingProject.shots.find((candidate) => candidate.id === request.shotId);
          if (!shot) {
            throw new AssetImportServiceError(
              'ASSET_IMPORT_PROJECT_INVALID',
              transaction.projectRoot,
              `Target Shot ${request.shotId} was not found in the project.`,
            );
          }

          const sourceFps = session.ir.document.frameRate > 0 ? session.ir.document.frameRate : workingProject.fps;
          const applied = applyFlaSceneAudioClips(
            workingProject,
            {
              sourceFps,
              shotId: shot.id,
              shotDurationMs: shot.durationMs,
              ...(request.role ? { role: request.role } : {}),
              events,
              resolveAsset: (sound) => (sound.soundId ? resolvedBySoundId.get(sound.soundId) : undefined),
            },
            audioClipService,
          );

          const clipsChanged = applied.createdClipIds.length > 0;
          const projectChanged = assetsChanged || metadataUpdated || clipsChanged;
          const savedRevision = projectChanged ? request.baseRevision + 1 : request.baseRevision;
          if (metadataUpdated || clipsChanged) {
            await transaction.save(applied.project, savedRevision);
          }

          return {
            project: applied.project,
            savedRevision,
            projectChanged,
            createdClipIds: applied.createdClipIds,
            diagnostics: [...extractionDiagnostics, ...applied.diagnostics],
          };
        },
      );

      return {
        ok: true,
        status: 'completed',
        project: transactionResult.project,
        baseRevision: request.baseRevision,
        savedRevision: transactionResult.savedRevision,
        projectChanged: transactionResult.projectChanged,
        importedAssetIds,
        createdClipIds: transactionResult.createdClipIds,
        diagnostics: transactionResult.diagnostics,
      };
    } finally {
      await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async withAudio<T>(
    sessionId: string,
    soundId: string,
    requestedSignal: AbortSignal,
    consume: (filePath: string, payload: SoundPayload, facts: { durationMs: number; sampleRate: number; channels: number }) => Promise<T>,
  ): Promise<T> {
    const source = this.getSource(sessionId, soundId);
    if (!source) unsupported('The embedded sound is unavailable. Reopen the FLA to continue.');
    const signal = AbortSignal.any([requestedSignal, AbortSignal.timeout(15_000)]);
    signal.throwIfAborted();
    const payload = extractFlaSound(source);
    const folder = await mkdtemp(path.join(tmpdir(), 'panda-stage-fla-audio-'));
    const filePath = path.join(folder, audioFileName(source.sound, payload.mimeType));
    try {
      await writeFile(filePath, payload.bytes, { flag: 'wx', signal });
      const { codecName, durationSeconds, sampleRate, channels } = await this.probe(filePath, signal);
      if (
        (payload.mimeType === 'audio/mpeg' ? codecName !== 'mp3' : !/^pcm_(?:s16le|u8|s24le|s32le)$/u.test(codecName)) ||
        !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > FLA_SOUND_MAX_SECONDS ||
        !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 ||
        (channels !== 1 && channels !== 2)
      ) unsupported('The embedded audio codec, duration, or sample parameters are unsupported.');
      if (payload.mimeType === 'audio/mpeg') await this.validateMp3?.(filePath, signal);
      signal.throwIfAborted();
      if (!this.getSource(sessionId, soundId)) unsupported('The FLA sound session has ended.');
      return await consume(filePath, payload, { durationMs: durationSeconds * 1000, sampleRate, channels });
    } finally {
      await unlink(filePath).catch(() => undefined);
      await rmdir(folder).catch(() => undefined);
    }
  }
}
