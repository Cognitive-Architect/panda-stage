export const EXPORT_PNG_MODE_QUERY_PARAM = 'pandaStagePngMode';

export type ExportPngMode = 'legacy-blob' | 'worker-png';

export const DEFAULT_FORMAL_EXPORT_PNG_MODE: ExportPngMode = 'legacy-blob';

export function parseExportPngMode(
  value: string | null | undefined,
): ExportPngMode | null {
  if (value === 'legacy-blob' || value === 'worker-png') return value;
  return null;
}

export function resolveFormalExportPngMode(
  value: string | undefined,
): ExportPngMode {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_FORMAL_EXPORT_PNG_MODE;
  }
  const parsed = parseExportPngMode(value.trim());
  if (!parsed) {
    throw new Error(`Unsupported formal export PNG mode: ${value}`);
  }
  return parsed;
}
