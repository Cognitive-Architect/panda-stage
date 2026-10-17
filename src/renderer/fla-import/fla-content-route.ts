import type { FlaInspectionResponse } from '../../shared/fla-import-api';

/**
 * Internal adapter default for the unified FLA workbench. Recovery is an
 * ingest fact, not a content type: bitmap-bearing sources start on the
 * existing raster adapter, while zero-raster sources start on composition
 * discovery. The shared workbench keeps both sections reachable when raster
 * content exists; rejected inspections never enter either adapter.
 */
export type FlaContentRoute =
  | 'blocked'
  | 'v1-raster-review'
  | 'v2r-target-discovery';

export type FlaWorkbenchSection = 'compositions' | 'source-assets';

/**
 * Choose the first visible section without excluding the other section from
 * the shared workbench. Bitmap-bearing FLAs open on their familiar source
 * assets; zero-bitmap FLAs open on composition discovery.
 */
export function defaultFlaWorkbenchSection(mediaCount: number): FlaWorkbenchSection {
  return mediaCount > 0 ? 'source-assets' : 'compositions';
}

export function routeFlaInspection(
  response: FlaInspectionResponse,
): FlaContentRoute {
  if (!response.ok) return 'blocked';
  return response.ir.media.length > 0
    ? 'v1-raster-review'
    : 'v2r-target-discovery';
}
