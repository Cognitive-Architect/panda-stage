import type { FlaInspectionResponse } from '../../shared/fla-import-api';

/**
 * C4's only routing decision. Recovery is an ingest fact, not a content type:
 * every successfully parsed FLA with raster media uses the existing V1 review,
 * while every successfully parsed zero-raster FLA asks the existing V2-R
 * catalog for its real targets. Rejected inspections never enter either path.
 */
export type FlaContentRoute =
  | 'blocked'
  | 'v1-raster-review'
  | 'v2r-target-discovery';

export function routeFlaInspection(
  response: FlaInspectionResponse,
): FlaContentRoute {
  if (!response.ok) return 'blocked';
  return response.ir.media.length > 0
    ? 'v1-raster-review'
    : 'v2r-target-discovery';
}
