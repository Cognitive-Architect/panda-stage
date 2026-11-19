/** Translate generated defaults. A Part number enables the fallback for generic labels. */
export function localizeDefaultAdaptivePartName(name: string, partNumber?: number): string {
  const trimmed = name.trim();
  if (partNumber !== undefined && (!trimmed || /^(image|graphic)$/iu.test(trimmed))) {
    return `部件 ${partNumber}`;
  }
  const match = /^Part ([1-9]\d*)$/u.exec(name);
  return match ? `零件 ${match[1]}` : name;
}
