import { z } from 'zod';
import {
  AssetDropPayloadSchema,
  type AssetDropPayload,
} from '../../../domain';

export const ASSET_DRAG_MIME =
  'application/x-panda-stage-asset' as const;
export const ANIMATION_DRAG_CONTEXT_MIME =
  'application/x-panda-stage-animation-context' as const;

const AnimationDropTargetSchema = z
  .object({
    projectId: z.uuid(),
    projectInstanceId: z.number().int().positive(),
    projectRevision: z.number().int().nonnegative(),
    shotId: z.uuid(),
  })
  .strict();

const AnimationDropContextSchema = AnimationDropTargetSchema.extend({
  version: z.literal(1),
  animationId: z.uuid(),
}).strict();

export type AnimationDropTarget = z.infer<typeof AnimationDropTargetSchema>;
export type AnimationDropContext = z.infer<typeof AnimationDropContextSchema>;

export { AssetDropPayloadSchema };
export type { AssetDropPayload };

export function serializeAssetDropPayload(
  payload: AssetDropPayload,
): string {
  return JSON.stringify(AssetDropPayloadSchema.parse(payload));
}

export function parseAssetDropPayload(
  serialized: string,
): AssetDropPayload {
  return AssetDropPayloadSchema.parse(JSON.parse(serialized));
}

export function writeAssetDropPayload(
  dataTransfer: Pick<DataTransfer, 'effectAllowed' | 'setData'>,
  payload: AssetDropPayload,
): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(
    ASSET_DRAG_MIME,
    serializeAssetDropPayload(payload),
  );
}

export function writeAnimationDropContext(
  dataTransfer: Pick<DataTransfer, 'setData'>,
  context: AnimationDropContext,
): void {
  dataTransfer.setData(
    ANIMATION_DRAG_CONTEXT_MIME,
    JSON.stringify(AnimationDropContextSchema.parse(context)),
  );
}

export function readAnimationDropContext(
  dataTransfer: Pick<DataTransfer, 'getData'>,
): AnimationDropContext | null {
  const serialized = dataTransfer.getData(ANIMATION_DRAG_CONTEXT_MIME);
  if (!serialized) return null;
  try {
    return AnimationDropContextSchema.parse(JSON.parse(serialized));
  } catch {
    return null;
  }
}

export function isCurrentAnimationDropContext(
  context: AnimationDropContext | null,
  target: AnimationDropTarget | null,
  animationId: string,
): boolean {
  return Boolean(
    context &&
      target &&
      context.animationId === animationId &&
      context.projectId === target.projectId &&
      context.projectInstanceId === target.projectInstanceId &&
      context.projectRevision === target.projectRevision &&
      context.shotId === target.shotId,
  );
}
