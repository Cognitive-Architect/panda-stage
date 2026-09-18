import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const importOnlyLine = /^\s*@import\s+['"][^'"]+['"]\s*;\s*$/u;

describe('P4-SER root stylesheet guardrail', () => {
  it('keeps src/renderer/styles.css as an import-only entry manifest', () => {
    const lines = readFileSync(resolve(root, 'src', 'renderer', 'styles.css'), 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(lines.length, 'root stylesheet entry must not be empty').toBeGreaterThan(0);
    expect(
      lines.filter((line) => !importOnlyLine.test(line)),
      'ordinary CSS declarations must not be appended to the root entry',
    ).toEqual([]);
  });
});
