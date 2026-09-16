import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function normalize(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function sourceLines(value: string): string[] {
  const lines = normalize(value).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function importPath(line: string): string | null {
  return /^\s*@import\s+['"]([^'"]+)['"]\s*;\s*$/u.exec(line)?.[1] ?? null;
}

/**
 * Reads the ordered production stylesheet source without inlining tokens or
 * primitives. The returned text is the source-level sequence represented by
 * the real entry: the two base imports, each direct stylesheet import in
 * order, then any root remainder.
 */
export function readOrderedStylesheetSource(
  entryPath = 'src/renderer/styles.css',
): string {
  const entryAbsolute = resolve(process.cwd(), entryPath);
  const entry = sourceLines(readFileSync(entryAbsolute, 'utf8'));
  const imports: string[] = [];
  let bodyStart = 0;
  while (bodyStart < entry.length) {
    const path = importPath(entry[bodyStart]!);
    if (!path) break;
    imports.push(path);
    bodyStart += 1;
  }

  const baseImportLines = entry.slice(0, 2);
  const extractedSlices = imports.slice(2).map((path) =>
    normalize(readFileSync(resolve(dirname(entryAbsolute), path), 'utf8')),
  );
  const remainder = entry.length > bodyStart
    ? `${entry.slice(bodyStart).join('\n')}\n`
    : '';
  return `${baseImportLines.join('\n')}\n${extractedSlices.join('')}${remainder}`;
}
