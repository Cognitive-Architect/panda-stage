import { NameSchema } from '../models/common';

export interface BatchRenameOptions {
  prefix: string;
  suffix: string;
  find: string;
  replacement: string;
  numbered: boolean;
}

/** Callers supply entries in their displayed order. Names are labels in both models. */
export function previewBatchNames(
  entries: readonly { name: string }[],
  options: BatchRenameOptions,
): string[] {
  const width = String(entries.length).length;
  return entries.map(({ name }, index) => {
    const body = options.find ? name.replaceAll(options.find, () => options.replacement) : name;
    const number = options.numbered ? ` ${String(index + 1).padStart(width, '0')}` : '';
    return NameSchema.parse(`${options.prefix}${body}${options.suffix}${number}`);
  });
}
