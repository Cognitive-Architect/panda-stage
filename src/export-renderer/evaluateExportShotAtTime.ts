import {
  buildAudioEnvelopeFromChannels,
  evaluateShotAtTime,
  projectShotDialogueVisual,
  type AudioEnvelope,
  type EvaluatedShot,
  type MouthEnvelopeSource,
  type Project,
  type Shot,
} from '../domain';
import { decodeAudioBytesWithWebAudio } from '../renderer/preview/audioEnvelopeStore';
import type { ExportLoadFormalMedia } from '../shared/export-types';

/** The hidden Export renderer's requested-time Dialogue projection. */
export function evaluateExportShotAtTime(
  project: Project,
  shot: Shot,
  requestedTimeMs: number,
  activeDialogueId?: string | null,
  mouthSource?: MouthEnvelopeSource,
): EvaluatedShot {
  return projectShotDialogueVisual(
    project,
    shot,
    evaluateShotAtTime(shot, requestedTimeMs, project),
    activeDialogueId,
    mouthSource,
  );
}

/** The one media contract is shared with the formal `loadFormal` IPC. */
export type ExportEnvelopeMedia = ExportLoadFormalMedia;

/**
 * The hidden renderer's lookup for a decoded volume envelope. Exported so a
 * formal-load wiring test can build the exact same source from parsed media.
 */
export function createExportMouthSource(
  envelopes: ReadonlyMap<string, AudioEnvelope>,
): MouthEnvelopeSource {
  return (assetId: string) => {
    const envelope = envelopes.get(assetId);
    return envelope
      ? ({ status: 'ready', envelope } as const)
      : ({ status: 'unavailable', reason: 'decode-pending' } as const);
  };
}

/**
 * Builds the same volume envelopes the Editor and Preview use, from the frozen
 * Export media bytes. One decode per AudioAsset for the whole Job; a failure
 * only closes that Mouth and is reported, never silently replaced by a rhythm.
 */
export async function buildExportAudioEnvelopes(
  media: readonly ExportEnvelopeMedia[],
  decode: (
    bytes: Uint8Array,
    mimeType: string,
  ) => Promise<{ channels: Float32Array[]; sampleRate: number }> =
    decodeAudioBytesWithWebAudio,
): Promise<ReadonlyMap<string, AudioEnvelope>> {
  const envelopes = new Map<string, AudioEnvelope>();
  for (const entry of media) {
    if (entry.kind !== 'audio') continue;
    try {
      const decoded = await decode(entry.bytes, entry.mimeType);
      envelopes.set(
        entry.assetId,
        buildAudioEnvelopeFromChannels(decoded.channels, decoded.sampleRate),
      );
    } catch (error) {
      console.warn(
        'PANDA_STAGE_AUTO07A_ENVELOPE_UNAVAILABLE ' +
          JSON.stringify({
            assetId: entry.assetId,
            mimeType: entry.mimeType,
            reason: error instanceof Error ? error.message : 'decode-failed',
          }),
      );
    }
  }
  return envelopes;
}
