import { z } from 'zod';

export const FLA_NATIVE_VIDEO_MAX_FRAMES = 1_200;
export const FLA_NATIVE_VIDEO_MAX_PIXELS = 1_920 * 1_080;
const MAX_SECONDS = 60;

const NumberField = z.union([
  z.number(),
  z.string().regex(/^-?\d+$/u).transform(Number),
]);
const SafeInteger = z.number().int().safe();
const IntegerField = NumberField.pipe(SafeInteger);
const StreamSchema = z.object({
  index: NumberField.pipe(SafeInteger.nonnegative()),
  codec_name: z.enum(['h264', 'vp9', 'vp8', 'mpeg4']),
  width: NumberField.pipe(SafeInteger.positive()),
  height: NumberField.pipe(SafeInteger.positive()),
  time_base: z.string().regex(/^[1-9]\d*\/[1-9]\d*$/u),
  start_pts: IntegerField.optional(),
  duration_ts: NumberField.pipe(SafeInteger.positive()).optional(),
  nb_frames: NumberField.pipe(SafeInteger.positive().max(FLA_NATIVE_VIDEO_MAX_FRAMES)).optional(),
});
const StreamsSchema = z.object({
  streams: z.array(z.object({
    codec_type: z.string(),
    disposition: z.object({ attached_pic: z.number() }).optional(),
  }).passthrough()),
});
const FrameSchema = z.object({
  best_effort_timestamp: IntegerField,
  pkt_duration: NumberField.pipe(SafeInteger.positive()).optional(),
});
const FramesSchema = z.object({
  frames: z.array(FrameSchema).min(1).max(FLA_NATIVE_VIDEO_MAX_FRAMES),
});

export function readFlaNativeVideoStream(value: unknown) {
  const decoded = StreamsSchema.parse(value);
  const videos = decoded.streams.filter(
    (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1,
  );
  if (videos.length !== 1) throw new Error('Embedded video must have one playable video stream.');
  const stream = StreamSchema.parse(videos[0]);
  const [numerator, denominator] = stream.time_base.split('/').map(Number);
  const startTick = stream.start_pts ?? 0;
  const durationTicks = stream.duration_ts;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) ||
      stream.width * stream.height > FLA_NATIVE_VIDEO_MAX_PIXELS ||
      (durationTicks !== undefined && (
        durationTicks * numerator! / denominator! > MAX_SECONDS ||
        !Number.isSafeInteger(startTick + durationTicks)
      ))) {
    throw new Error('Embedded video exceeds the supported timing or frame size.');
  }
  return {
    streamIndex: stream.index,
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    timeBase: { numerator: numerator!, denominator: denominator! },
    startTick,
    durationTicks,
    frameCount: stream.nb_frames,
    hasAudio: decoded.streams.some((candidate) => candidate.codec_type === 'audio'),
  };
}

export function readFlaNativeVideoFrames(value: unknown, stream: ReturnType<typeof readFlaNativeVideoStream>) {
  const { frames } = FramesSchema.parse(value);
  if (stream.frameCount !== undefined && frames.length !== stream.frameCount) {
    throw new Error('Decoded frame count differs from the embedded video stream.');
  }
  const presentationTicks = frames.map((frame) => frame.best_effort_timestamp);
  const lastFrame = frames.at(-1)!;
  const firstTick = presentationTicks[0]!;
  const streamEnd = stream.durationTicks !== undefined ? stream.startTick + stream.durationTicks : undefined;
  let endTick: number;
  if (lastFrame.pkt_duration !== undefined) {
    endTick = lastFrame.best_effort_timestamp + lastFrame.pkt_duration;
  } else if (streamEnd !== undefined && streamEnd > lastFrame.best_effort_timestamp) {
    endTick = streamEnd;
  } else if (presentationTicks.length >= 2) {
    const lastDelta = presentationTicks.at(-1)! - presentationTicks.at(-2)!;
    endTick = lastFrame.best_effort_timestamp + Math.max(1, lastDelta);
  } else {
    endTick = lastFrame.best_effort_timestamp + Math.max(1, Math.round(stream.timeBase.denominator / (24 * stream.timeBase.numerator)));
  }
  const effectiveStartTick = Math.min(stream.startTick, firstTick);
  const effectiveDurationTicks = endTick - firstTick;
  const durationSeconds = effectiveDurationTicks * stream.timeBase.numerator / stream.timeBase.denominator;
  if (!Number.isSafeInteger(endTick) || endTick <= lastFrame.best_effort_timestamp ||
      durationSeconds > MAX_SECONDS ||
      presentationTicks.some((tick, index) => index > 0 && tick < presentationTicks[index - 1]!)) {
    throw new Error('Embedded video has an invalid presentation timeline.');
  }
  return {
    ...stream,
    startTick: effectiveStartTick,
    durationTicks: effectiveDurationTicks,
    frameCount: frames.length,
    presentationTicks,
    endTick,
  };
}

export type FlaNativeVideoProbe = ReturnType<typeof readFlaNativeVideoFrames>;
