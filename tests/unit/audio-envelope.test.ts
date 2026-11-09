import { describe, expect, it } from 'vitest';
import {
  AUDIO_ENVELOPE_CLOSE_HOLD_MS,
  AUDIO_ENVELOPE_SILENCE_RMS,
  AUDIO_ENVELOPE_WINDOW_MS,
  audioEnvelopeSignature,
  buildAudioEnvelopeFromChannels,
  computeAudioEnvelopeOpenGate,
  envelopeSourceTimeMs,
  evaluateAudioEnvelopeSpeaking,
  type AudioEnvelope,
} from '../../src/domain';

const SAMPLE_RATE = 8_000;

/** 400ms tone, 400ms silence, 400ms tone at 8kHz. */
function toneSilenceTone(amplitude = 0.5): Float32Array {
  const samples = new Float32Array(9_600);
  const tone = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      samples[index] = amplitude * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE);
    }
  };
  tone(0, 3_200);
  tone(6_400, 9_600);
  return samples;
}

function envelopeOf(samples: Float32Array): AudioEnvelope {
  return buildAudioEnvelopeFromChannels([samples], SAMPLE_RATE);
}

describe('AUTO-07A audio envelope contract', () => {
  it('opens on sound, closes through a 400ms pause, and reopens', () => {
    const envelope = envelopeOf(toneSilenceTone());
    expect(envelope.windowMs).toBe(AUDIO_ENVELOPE_WINDOW_MS);
    expect(envelope.open).toHaveLength(
      Math.ceil(envelope.durationMs / AUDIO_ENVELOPE_WINDOW_MS),
    );

    expect(evaluateAudioEnvelopeSpeaking(envelope, 100)).toBe(true);
    expect(evaluateAudioEnvelopeSpeaking(envelope, 360)).toBe(true);
    // 400..480ms is bridged by the documented close hold, 480ms is silent.
    expect(evaluateAudioEnvelopeSpeaking(envelope, 480)).toBe(false);
    expect(evaluateAudioEnvelopeSpeaking(envelope, 700)).toBe(false);
    expect(evaluateAudioEnvelopeSpeaking(envelope, 1_000)).toBe(true);
  });

  it('keeps the hold window deterministic for shorter gaps', () => {
    const rms = [1, 1, 0, 1, 0, 0, 0, 1];
    const gate = computeAudioEnvelopeOpenGate(
      rms,
      AUDIO_ENVELOPE_WINDOW_MS,
      AUDIO_ENVELOPE_CLOSE_HOLD_MS,
      AUDIO_ENVELOPE_SILENCE_RMS,
    );
    expect(gate).toEqual([true, true, true, true, true, true, false, true]);
  });

  it('maps Shot time onto source time through the formal clip mapping', () => {
    // 300ms trimmed off the front of the file.
    expect(envelopeSourceTimeMs({ startMs: 2_000, offsetMs: 300 }, 2_000)).toBe(300);
    expect(envelopeSourceTimeMs({ startMs: 2_000, offsetMs: 300 }, 2_400)).toBe(700);

    const envelope = envelopeOf(toneSilenceTone());
    // Source 440ms is still inside the documented 80ms close hold.
    expect(evaluateAudioEnvelopeSpeaking(envelope, envelopeSourceTimeMs(
      { startMs: 2_000, offsetMs: 0 },
      2_440,
    ))).toBe(true);
    // Source 520ms is a real pause: closed.
    expect(evaluateAudioEnvelopeSpeaking(envelope, envelopeSourceTimeMs(
      { startMs: 2_000, offsetMs: 0 },
      2_520,
    ))).toBe(false);
    expect(evaluateAudioEnvelopeSpeaking(envelope, envelopeSourceTimeMs(
      { startMs: 2_000, offsetMs: 0 },
      2_000,
    ))).toBe(true);
  });

  it('is a pure function of its input and reports out-of-range as silence', () => {
    const samples = toneSilenceTone();
    const first = envelopeOf(samples);
    const second = envelopeOf(samples);
    expect(second).toEqual(first);
    expect(audioEnvelopeSignature(second)).toBe(audioEnvelopeSignature(first));
    expect(evaluateAudioEnvelopeSpeaking(first, -1)).toBe(false);
    expect(evaluateAudioEnvelopeSpeaking(first, 99_999)).toBe(false);
    expect(evaluateAudioEnvelopeSpeaking(first, Number.NaN)).toBe(false);
  });

  it('averages channels so one affected channel cannot force a flap', () => {
    const loud = toneSilenceTone(1);
    const silent = new Float32Array(loud.length);
    const stereo = buildAudioEnvelopeFromChannels([loud, silent], SAMPLE_RATE);
    const mono = buildAudioEnvelopeFromChannels([loud], SAMPLE_RATE);
    expect(stereo.rms[0]).toBeLessThan(mono.rms[0]!);
    expect(stereo.open[0]).toBe(true);
  });

  it('rejects unusable decoder output instead of inventing an envelope', () => {
    expect(() => buildAudioEnvelopeFromChannels([], SAMPLE_RATE)).toThrow(
      /at least one channel/u,
    );
    expect(() =>
      buildAudioEnvelopeFromChannels([new Float32Array(10)], 0),
    ).toThrow(/sample rate/u);
  });
});
