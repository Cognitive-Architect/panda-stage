/**
 * AUTO-07A: the shared, offline, deterministic audio-envelope contract.
 *
 * One decoded AudioAsset produces one small RMS envelope. The Mouth projection
 * only ever reads this envelope plus the formal `audioClipSourceTimeMs` mapping,
 * so seek, pause, frame stepping and Export agree without any playback clock.
 */
import type { AudioClip } from '../models';

/** Window size of one envelope cell. 40ms keeps 300ms pauses clearly closed. */
export const AUDIO_ENVELOPE_WINDOW_MS = 40;
/** Linear RMS below this is treated as silence (≈ -34 dBFS). */
export const AUDIO_ENVELOPE_SILENCE_RMS = 0.02;
/** Bridge gaps shorter than this so micro-pauses do not flicker the Mouth. */
export const AUDIO_ENVELOPE_CLOSE_HOLD_MS = 80;
export const AUDIO_ENVELOPE_MAX_WINDOWS = 60_000;

export interface AudioEnvelope {
  readonly windowMs: number;
  /** Source-audio duration the envelope covers. */
  readonly durationMs: number;
  /** One linear RMS value per window, ordered by source time. */
  readonly rms: readonly number[];
  /** Precomputed speaking gate; same length as `rms`. */
  readonly open: readonly boolean[];
}

export interface AudioEnvelopeBuildOptions {
  windowMs?: number;
  silenceRms?: number;
  closeHoldMs?: number;
}

function clampWindowCount(maxWindows: number): number {
  return Math.max(1, Math.min(AUDIO_ENVELOPE_MAX_WINDOWS, Math.trunc(maxWindows)));
}

/**
 * Precomputed hysteresis: a window is "speaking" when it is loud enough, or
 * when it is inside `closeHoldMs` of the last loud window. Pauses longer than
 * the hold close the Mouth; everything stays a pure function of the input.
 */
export function computeAudioEnvelopeOpenGate(
  rms: readonly number[],
  windowMs: number,
  closeHoldMs = AUDIO_ENVELOPE_CLOSE_HOLD_MS,
  silenceRms = AUDIO_ENVELOPE_SILENCE_RMS,
): boolean[] {
  const holdWindows = Math.max(
    0,
    Math.round(closeHoldMs / Math.max(1, windowMs)),
  );
  const open: boolean[] = new Array(rms.length);
  let lastLoudIndex = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < rms.length; index += 1) {
    const loud = Number.isFinite(rms[index]) && rms[index]! >= silenceRms;
    if (loud) lastLoudIndex = index;
    open[index] = loud || index - lastLoudIndex <= holdWindows;
  }
  return open;
}

/**
 * Builds the envelope once per decoded source. Channels are averaged so the
 * Voice layer of a stereo file cannot change the judgment.
 */
export function buildAudioEnvelopeFromChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: AudioEnvelopeBuildOptions = {},
): AudioEnvelope {
  const usable = channels.filter((channel) => channel.length > 0);
  if (
    usable.length === 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    throw new Error('Audio envelope needs at least one channel and a sample rate.');
  }
  const windowMs = options.windowMs ?? AUDIO_ENVELOPE_WINDOW_MS;
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('Audio envelope window must be a positive number of milliseconds.');
  }
  const longest = usable.reduce(
    (length, channel) => Math.max(length, channel.length),
    0,
  );
  const windowSamples = Math.max(1, Math.round((sampleRate * windowMs) / 1_000));
  const windowCount = clampWindowCount(Math.ceil(longest / windowSamples));
  const rms: number[] = [];
  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    const start = windowIndex * windowSamples;
    const end = Math.min(longest, start + windowSamples);
    let sum = 0;
    let count = 0;
    for (const channel of usable) {
      for (let sample = start; sample < end && sample < channel.length; sample += 1) {
        const value = channel[sample]!;
        sum += value * value;
        count += 1;
      }
    }
    rms.push(count === 0 ? 0 : Math.sqrt(sum / count));
  }
  return {
    windowMs,
    durationMs: Math.round((longest / sampleRate) * 1_000),
    rms,
    open: computeAudioEnvelopeOpenGate(
      rms,
      windowMs,
      options.closeHoldMs ?? AUDIO_ENVELOPE_CLOSE_HOLD_MS,
      options.silenceRms ?? AUDIO_ENVELOPE_SILENCE_RMS,
    ),
  };
}

/**
 * Source audio time for a Shot time. Reuses the formal clip mapping so a
 * trimmed or re-ordered clip never pretends Shot time is file time.
 */
export function envelopeSourceTimeMs(
  clip: Pick<AudioClip, 'startMs' | 'offsetMs'>,
  shotTimeMs: number,
): number {
  return clip.offsetMs + shotTimeMs - clip.startMs;
}

/** Deterministic lookup; out-of-range or non-finite input reads as silence. */
export function evaluateAudioEnvelopeSpeaking(
  envelope: AudioEnvelope,
  sourceTimeMs: number,
): boolean {
  if (!Number.isFinite(sourceTimeMs) || sourceTimeMs < 0) return false;
  const index = Math.floor(sourceTimeMs / Math.max(1, envelope.windowMs));
  if (index < 0 || index >= envelope.open.length) return false;
  return envelope.open[index] === true;
}

/** Rebuildable payload fingerprint for caches; never persisted in Project. */
export function audioEnvelopeSignature(envelope: AudioEnvelope): string {
  let loud = 0;
  for (const value of envelope.open) if (value) loud += 1;
  return `${envelope.windowMs}:${envelope.durationMs}:${envelope.open.length}:${loud}`;
}

export type MouthEnvelopeUnavailableReason =
  | 'asset-missing'
  | 'not-audio'
  | 'decode-failed'
  | 'decode-pending';

export type MouthEnvelopeResolution =
  | { readonly status: 'ready'; readonly envelope: AudioEnvelope }
  | {
      readonly status: 'unavailable';
      readonly reason: MouthEnvelopeUnavailableReason;
      readonly message?: string;
    };

/** Renderer-owned lookup; the domain never decodes or caches audio itself. */
export type MouthEnvelopeSource = (
  audioAssetId: string,
) => MouthEnvelopeResolution | undefined;
