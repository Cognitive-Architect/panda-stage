import { z } from 'zod';
import { CANVAS_WIDTH, CANVAS_HEIGHT, FPS } from './constants';

// === Asset ===
export const AssetType = z.enum(['image', 'audio']);
export type AssetType = z.infer<typeof AssetType>;

export const AssetSchema = z.object({
  id: z.string().uuid(),
  type: AssetType,
  name: z.string().min(1),
  relativePath: z.string(),
  mimeType: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  durationMs: z.number().int().optional(),
  hash: z.string().optional(),
});
export type Asset = z.infer<typeof AssetSchema>;

// === Character ===
export const CharacterSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  defaultExpression: z.string(),
  expressions: z.record(z.string(), z.string()), // expression name -> assetId
  mouthOpenAssetId: z.string().optional(),
  voiceProfileId: z.string().optional(),
  defaultScale: z.number().default(1),
  defaultFlipX: z.boolean().default(false),
});
export type Character = z.infer<typeof CharacterSchema>;

// === VoiceProfile (data-only, no UI in MVP) ===
export const VoiceProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  provider: z.enum(['manual', 'local', 'remote']),
  providerVoiceId: z.string().optional(),
  rate: z.number().default(1),
  pitch: z.number().default(1),
  volume: z.number().min(0).max(1).default(1),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

// === Layer ===
// x/y represent center coordinates
export const LayerSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['character', 'image', 'text']),
  characterId: z.string().optional(),
  assetId: z.string().optional(),
  expression: z.string().optional(),
  x: z.number().default(CANVAS_WIDTH / 2),
  y: z.number().default(CANVAS_HEIGHT / 2),
  scaleX: z.number().default(1),
  scaleY: z.number().default(1),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  flipX: z.boolean().default(false),
  zIndex: z.number().int().default(0),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
});
export type Layer = z.infer<typeof LayerSchema>;

// === Dialogue ===
export const DialogueSchema = z.object({
  id: z.string().uuid(),
  characterId: z.string(),
  text: z.string().min(1).max(500),
  startMs: z.number().int().min(0),
  durationMs: z.number().int().min(100),
  audioAssetId: z.string().optional(),
  volume: z.number().min(0).max(2).default(1),
  subtitleEnabled: z.boolean().default(true),
  subtitleStyleId: z.string().optional(),
});
export type Dialogue = z.infer<typeof DialogueSchema>;

// === AudioClip ===
export const AudioClipSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string(),
  role: z.enum(['bgm', 'sfx', 'dialogue']).default('bgm'),
  startMs: z.number().int().min(0),
  sourceStartMs: z.number().int().min(0).default(0),
  durationMs: z.number().int().optional(), // undefined = full duration
  volume: z.number().min(0).max(2).default(0.7),
});
export type AudioClip = z.infer<typeof AudioClipSchema>;

// === TimelineEvent — Discriminated Union ===
export const MoveEventPayload = z.object({
  toX: z.number(),
  toY: z.number(),
});
export type MoveEventPayload = z.infer<typeof MoveEventPayload>;

export const ScaleEventPayload = z.object({
  toScaleX: z.number(),
  toScaleY: z.number(),
});
export type ScaleEventPayload = z.infer<typeof ScaleEventPayload>;

export const OpacityEventPayload = z.object({
  toOpacity: z.number().min(0).max(1),
});
export type OpacityEventPayload = z.infer<typeof OpacityEventPayload>;

export const ShakeEventPayload = z.object({
  amplitudeX: z.number().default(10),
  amplitudeY: z.number().default(0),
  frequency: z.number().default(8),
});
export type ShakeEventPayload = z.infer<typeof ShakeEventPayload>;

export const ExpressionEventPayload = z.object({
  expression: z.string(),
});
export type ExpressionEventPayload = z.infer<typeof ExpressionEventPayload>;

export const FlipEventPayload = z.object({
  flipX: z.boolean(),
});
export type FlipEventPayload = z.infer<typeof FlipEventPayload>;

export const VisibilityEventPayload = z.object({
  visible: z.boolean(),
});
export type VisibilityEventPayload = z.infer<typeof VisibilityEventPayload>;

export const TimelineEventSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().uuid(), targetLayerId: z.string(), type: z.literal('move'), startMs: z.number().int().min(0), endMs: z.number().int().min(0), easing: z.enum(['linear', 'ease-in-out']).default('linear'), payload: MoveEventPayload, order: z.number().int().default(0) }),
  z.object({ id: z.string().uuid(), targetLayerId: z.string(), type: z.literal('scale'), startMs: z.number().int().min(0), endMs: z.number().int().min(0), easing: z.enum(['linear', 'ease-in-out']).default('linear'), payload: ScaleEventPayload, order: z.number().int().default(0) }),
  z.object({ id: z.string().uuid(), targetLayerId: z.string(), type: z.literal('opacity'), startMs: z.number().int().min(0), endMs: z.number().int().min(0), easing: z.enum(['linear', 'ease-in-out']).default('linear'), payload: OpacityEventPayload, order: z.number().int().default(0) }),
  z.object({ id: z.string().uuid(), targetLayerId: z.string(), type: z.literal('shake'), startMs: z.number().int().min(0), endMs: z.number().int().min(0), easing: z.enum(['linear', 'ease-in-out']).default('linear'), payload: ShakeEventPayload, order: z.number().int().default(0) }),
  z.object({ id: z.string().uuid(), targetLayerId: z.string(), type: z.literal('expression'), startMs: z.number().int().min(0), endMs: z.number().int().min(0), easing: z.enum(['linear', 'ease-in-out']).default('linear'), payload: ExpressionEventPayload, order: z.number().int().default(0) }),
  z.object({ id: z.string().uuid(), targetLayerId: z.string(), type: z.literal('flip'), startMs: z.number().int().min(0), endMs: z.number().int().min(0), easing: z.enum(['linear', 'ease-in-out']).default('linear'), payload: FlipEventPayload, order: z.number().int().default(0) }),
  z.object({ id: z.string().uuid(), targetLayerId: z.string(), type: z.literal('visibility'), startMs: z.number().int().min(0), endMs: z.number().int().min(0), easing: z.enum(['linear', 'ease-in-out']).default('linear'), payload: VisibilityEventPayload, order: z.number().int().default(0) }),
]);
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type TimelineEventType = TimelineEvent['type'];

// === Shot ===
export const ShotSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  durationMs: z.number().int().min(500),
  backgroundAssetId: z.string().optional(),
  layers: z.array(LayerSchema).default([]),
  dialogues: z.array(DialogueSchema).default([]),
  audioClips: z.array(AudioClipSchema).default([]),
  events: z.array(TimelineEventSchema).default([]),
});
export type Shot = z.infer<typeof ShotSchema>;

// === SubtitleStyle ===
export const SubtitleStyleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  fontSize: z.number().int().default(48),
  fontFamily: z.string().default('Noto Sans SC'),
  color: z.string().default('#FFFFFF'),
  outlineColor: z.string().default('#000000'),
  outlineWidth: z.number().default(2),
  shadowBlur: z.number().default(4),
  maxLines: z.number().int().default(2),
});
export type SubtitleStyle = z.infer<typeof SubtitleStyleSchema>;

// === Project ===
export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  width: z.literal(CANVAS_WIDTH),
  height: z.literal(CANVAS_HEIGHT),
  fps: z.literal(FPS),
  assets: z.array(AssetSchema),
  characters: z.array(CharacterSchema),
  voiceProfiles: z.array(VoiceProfileSchema),
  subtitleStyles: z.array(SubtitleStyleSchema),
  shots: z.array(ShotSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

// === M0.5 Probe specific types ===
export interface ExportConfig {
  project: Project;
  outputPath: string;
  tempDir: string;
  fps: number;
  width: number;
  height: number;
}

export interface ExportProgress {
  stage: 'rendering' | 'audio' | 'encoding' | 'complete' | 'error' | 'cancelled';
  frameIndex?: number;
  totalFrames: number;
  message: string;
}

export interface RenderFrameRequest {
  frameIndex: number;
  timeMs: number;
}

export interface RenderFrameResult {
  frameIndex: number;
  buffer: Uint8Array; // binary PNG, not dataURL
  method: 'capturePage' | 'canvas';
}

export interface FrameCaptureComparison {
  method: 'capturePage' | 'canvas';
  frameIndex: number;
  sizeBytes: number;
  durationMs: number;
  checksum: string;
}
