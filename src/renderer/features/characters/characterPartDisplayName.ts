/** Translate only the generated English default; retain authored names exactly. */
export function localizeDefaultAdaptivePartName(name: string): string {
  const match = /^Part ([1-9]\d*)$/u.exec(name);
  return match ? `零件 ${match[1]}` : name;
}
