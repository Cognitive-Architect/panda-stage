export const EXPORT_DRAW_MODE_QUERY_PARAM = 'pandaStageDrawMode';
export const EXPORT_FRAME_TIMING_QUERY_PARAM = 'pandaStageFrameTiming';

export type ExportDrawMode = 'legacy-raf' | 'explicit-sync';

export const DEFAULT_FORMAL_EXPORT_DRAW_MODE: ExportDrawMode = 'explicit-sync';

export function parseExportDrawMode(
  value: string | null | undefined,
): ExportDrawMode | null {
  if (value === 'legacy-raf' || value === 'explicit-sync') return value;
  return null;
}

export function resolveFormalExportDrawMode(
  value: string | undefined,
): ExportDrawMode {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_FORMAL_EXPORT_DRAW_MODE;
  }
  const parsed = parseExportDrawMode(value.trim());
  if (!parsed) {
    throw new Error(`Unsupported formal export draw mode: ${value}`);
  }
  return parsed;
}
