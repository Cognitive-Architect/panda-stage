import type { Point } from '../../../domain';
import { TEMPORAL_TRANSFORM_STATUS } from './layerTransformTemporalGuard';

export const POSITION_AUTHORING_GUIDANCE = '把人物拖到想要的位置';

export interface PositionAuthoringPresentationInput {
  temporalInspection: boolean;
  active: boolean;
  available: boolean;
  holdAvailable: boolean;
  status: string;
}

export interface PositionAuthoringPresentation {
  guidanceVisible: boolean;
  primaryVisible: boolean;
  holdVisible: boolean;
  status: string;
}

/**
 * Keep Position authoring's entry/guidance and the generic temporal status in
 * one presentation decision. The action or guidance owns the creator-facing
 * explanation whenever Position has a legal action at the current time.
 */
export function getPositionAuthoringPresentation({
  temporalInspection,
  active,
  available,
  holdAvailable,
  status,
}: PositionAuthoringPresentationInput): PositionAuthoringPresentation {
  const guidanceVisible = temporalInspection && active;
  const primaryVisible = temporalInspection && !active && available;
  const holdVisible = temporalInspection && !active && holdAvailable;
  const positionOwnsTemporalExplanation =
    temporalInspection && (active || available || holdAvailable);
  const statusIsDuplicateGuidance =
    guidanceVisible && status === POSITION_AUTHORING_GUIDANCE;
  const statusIsLegacyTemporalExplanation =
    positionOwnsTemporalExplanation && status === TEMPORAL_TRANSFORM_STATUS;

  return {
    guidanceVisible,
    primaryVisible,
    holdVisible,
    status:
      statusIsDuplicateGuidance || statusIsLegacyTemporalExplanation
        ? ''
        : status,
  };
}

/** Format a Position only for creator-facing text; never mutate the formal value. */
export function formatPositionDisplay(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = Number(value.toFixed(1));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export interface PositionDraftText {
  x: string;
  y: string;
}

function resolvePositionCoordinate(
  value: string,
  formalValue: number | undefined,
): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  // A formatted field can be shorter than the formal value. Preserve the
  // formal coordinate when the creator has not entered a different value.
  if (
    formalValue !== undefined &&
    Number.isFinite(formalValue) &&
    (value.trim() === formatPositionDisplay(formalValue) ||
      parsed === formalValue)
  ) {
    return formalValue;
  }
  return parsed;
}

/**
 * Resolve visible X/Y text without turning a no-op display round-trip into a
 * formal Position write. A genuinely different numeric value remains editable.
 */
export function resolvePositionDraftForCommit(
  draft: PositionDraftText,
  formalPosition?: Point | null,
): Point | null {
  const x = resolvePositionCoordinate(draft.x, formalPosition?.x);
  const y = resolvePositionCoordinate(draft.y, formalPosition?.y);
  return x === null || y === null ? null : { x, y };
}
