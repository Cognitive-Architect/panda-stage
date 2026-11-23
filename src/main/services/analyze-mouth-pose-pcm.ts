import { MOUTH_POSE_SAMPLE_RATE, type MouthPoseAnalysisResponse } from '../../shared/mouth-pose-analysis-api';

type Segment = NonNullable<MouthPoseAnalysisResponse>[number];
const FRAME_MS = 40;
const FRAME_SAMPLES = MOUTH_POSE_SAMPLE_RATE * FRAME_MS / 1_000;
const F1 = [260, 340, 420, 500, 580, 660, 740, 820];
const F2 = [900, 1_100, 1_300, 1_500, 1_700, 1_900, 2_100, 2_300, 2_500];
const coefficients = new Map([...F1, ...F2].map((hz) => [hz, 2 * Math.cos(2 * Math.PI * hz / MOUTH_POSE_SAMPLE_RATE)]));
const window = Float32Array.from({ length: FRAME_SAMPLES }, (_, i) =>
  0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME_SAMPLES - 1)));

function formant(samples: Float32Array, frequencies: readonly number[]) {
  let power = 0;
  let frequency = frequencies[0]!;
  for (const hz of frequencies) {
    const coefficient = coefficients.get(hz)!;
    let previous = 0;
    let beforePrevious = 0;
    for (const sample of samples) {
      const next = sample + coefficient * previous - beforePrevious;
      beforePrevious = previous;
      previous = next;
    }
    const energy = previous ** 2 + beforePrevious ** 2 - coefficient * previous * beforePrevious;
    if (energy > power) {
      power = energy;
      frequency = hz;
    }
  }
  return { frequency, power };
}

/** Acoustic draft inspired by AniCraft's bounded energy + formant approach. */
export function analyzeMouthPosePcm(pcm: Buffer, durationMs: number): NonNullable<MouthPoseAnalysisResponse> {
  const frameCount = Math.ceil(durationMs / FRAME_MS);
  const count = Math.min(Math.floor(pcm.length / 2), frameCount * FRAME_SAMPLES);
  const levels = new Float32Array(frameCount);
  let peak = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let i = frame * FRAME_SAMPLES; i < Math.min(count, (frame + 1) * FRAME_SAMPLES); i += 1) {
      sum += (pcm.readInt16LE(i * 2) / 32768) ** 2;
    }
    levels[frame] = Math.sqrt(sum / FRAME_SAMPLES);
    peak = Math.max(peak, levels[frame]!);
  }
  const silence = Math.max(0.003, peak * 0.045);
  const scratch = new Float32Array(FRAME_SAMPLES);
  const states: Segment['category'][] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (levels[frame]! <= silence) {
      states.push('rest');
      continue;
    }
    for (let i = 0; i < FRAME_SAMPLES; i += 1) {
      const sample = frame * FRAME_SAMPLES + i;
      scratch[i] = sample < count ? pcm.readInt16LE(sample * 2) * window[i]! / 32768 : 0;
    }
    const low = formant(scratch, F1);
    const high = formant(scratch, F2);
    if (levels[frame]! < peak * 0.23 && low.frequency <= 340 && high.power < low.power * 0.42) {
      states.push('closed');
    } else if (high.frequency >= 1_700 && high.power > low.power * 0.04) {
      states.push('wide');
    } else if (low.frequency < 520 && high.frequency <= 1_300) {
      states.push('round');
    } else {
      states.push('open');
    }
  }
  // Bridge single-frame transitions within voiced speech. Keep detected rests.
  const smoothed = states.map((state, i) => {
    const before = states[i - 1];
    const after = states[i + 1];
    return state !== 'rest' && before && before === after && before !== 'rest' ? before : state;
  });
  const segments: Segment[] = [];
  for (const [i, category] of smoothed.entries()) {
    const endMs = Math.min(durationMs, (i + 1) * FRAME_MS);
    const last = segments.at(-1);
    if (last?.category === category) last.endMs = endMs;
    else segments.push({ startMs: i * FRAME_MS, endMs, category });
  }
  return segments;
}
