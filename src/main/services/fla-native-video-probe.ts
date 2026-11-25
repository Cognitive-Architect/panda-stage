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
  codec_name: z.literal('h264'),
  width: NumberField.pipe(SafeInteger.positive()),
  height: NumberField.pipe(SafeInteger.positive()),
  time_base: z.string().regex(/^[1-9]\d*\/[1-9]\d*$/u),
  start_pts: IntegerField,
  duration_ts: NumberField.pipe(SafeInteger.positive()),
  nb_frames: NumberField.pipe(SafeInteger.positive().max(FLA_NATIVE_VIDEO_MAX_FRAMES)),
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
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) ||
      stream.width * stream.height > FLA_NATIVE_VIDEO_MAX_PIXELS ||
      stream.duration_ts * numerator! / denominator! > MAX_SECONDS ||
      !Number.isSafeInteger(stream.start_pts + stream.duration_ts)) {
    throw new Error('Embedded video exceeds the supported timing or frame size.');
  }
  return {
    streamIndex: stream.index,
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    timeBase: { numerator: numerator!, denominator: denominator! },
    startTick: stream.start_pts,
    durationTicks: stream.duration_ts,
    frameCount: stream.nb_frames,
    hasAudio: decoded.streams.some((candidate) => candidate.codec_type === 'audio'),
  };
}

export function readFlaNativeVideoFrames(value: unknown, stream: ReturnType<typeof readFlaNativeVideoStream>) {
  const { frames } = FramesSchema.parse(value);
  if (frames.length !== stream.frameCount) {
    throw new Error('Decoded frame count differs from the embedded video stream.');
  }
  const presentationTicks = frames.map((frame) => frame.best_effort_timestamp);
  const lastFrame = frames.at(-1)!;
  const streamEnd = stream.startTick + stream.durationTicks;
  const endTick = lastFrame.pkt_duration === undefined
    ? streamEnd : lastFrame.best_effort_timestamp + lastFrame.pkt_duration;
  const durationSeconds = (endTick - presentationTicks[0]!) * stream.timeBase.numerator / stream.timeBase.denominator;
  if (!Number.isSafeInteger(endTick) || endTick <= lastFrame.best_effort_timestamp ||
      durationSeconds > MAX_SECONDS ||
      presentationTicks.some((tick, index) => index > 0 && tick < presentationTicks[index - 1]!)) {
    throw new Error('Embedded video has an invalid presentation timeline.');
  }
  return { ...stream, presentationTicks, endTick };
}

export type FlaNativeVideoProbe = ReturnType<typeof readFlaNativeVideoFrames>;
