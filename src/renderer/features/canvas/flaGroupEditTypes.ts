import type { FlaGraphicGroupEditPreview } from '../../../shared/fla-graphic-instance-api';

export interface FlaGroupEditTarget {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly shotId: string;
  readonly layerId: string;
  readonly preview: FlaGraphicGroupEditPreview;
}
