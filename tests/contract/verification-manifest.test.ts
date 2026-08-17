import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const manifest = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'verification-manifest.json'), 'utf8'),
) as {
  manifestVersion: number;
  statusVocabulary: string[];
  platformVocabulary: string[];
  runInVocabulary: string[];
  count: number;
  gates: Array<Record<string, unknown>>;
  routing: Record<string, unknown>;
};

// Canonical vocabularies from Issue #209 (RH-04). The manifest must declare the
// same status vocabulary; these are the authoritative allowed values.
const STATUS_VOCAB = ['active', 'superseded', 'historical', 'manual', 'release-only', 'needs-review'];
const PLATFORM_VOCAB = ['windows', 'cross-platform'];
const RUNIN_VOCAB = ['ci', 'local', 'ci-and-local', 'manual', 'unknown'];
const REQUIRED = ['id', 'script', 'suite', 'subsystem', 'status', 'platform', 'runIn', 'owner'];

const pkgVerify = Object.keys(pkg.scripts).filter((k) => k.startsWith('verify:'));
const manifestByScript = new Map(manifest.gates.map((g) => [g.script as string, g]));

describe('RH-07 verification routing manifest', () => {
  it('evolves the RH-04/RH-05 ledger without creating a separate routing file', () => {
    expect(manifest.manifestVersion).toBe(2);
    expect(manifest.routing).toBeTruthy();
    expect((manifest.routing as { schemaVersion?: number }).schemaVersion).toBe(2);
  });
});

describe('RH-04 verification manifest — package.json <-> manifest drift contract', () => {
  it('every package.json verify:* script has exactly one manifest entry', () => {
    const missing = pkgVerify.filter((s) => !manifestByScript.has(s));
    expect(missing, `verify:* scripts missing from manifest: ${missing.join(', ')}`).toEqual([]);
    // Exactly one entry per script (no extras, no duplicates).
    expect(manifest.gates.length, 'manifest gate count must equal package.json verify:* count').toBe(
      pkgVerify.length,
    );
    // The manifest's declared count must match the actual gate list length.
    expect(manifest.count, 'manifest.count must equal gates.length').toBe(manifest.gates.length);
  });

  it('every manifest script actually exists in package.json', () => {
    const unknown = manifest.gates
      .map((g) => g.script as string)
      .filter((s) => !(s in pkg.scripts));
    expect(unknown, `manifest references scripts not in package.json: ${unknown.join(', ')}`).toEqual([]);
  });

  it('manifest gate ids are unique', () => {
    const ids = manifest.gates.map((g) => g.id as string);
    expect(new Set(ids).size, 'duplicate gate ids').toBe(ids.length);
  });

  it('manifest gate scripts are unique (no duplicate entries)', () => {
    const scripts = manifest.gates.map((g) => g.script as string);
    expect(new Set(scripts).size, 'duplicate manifest scripts').toBe(scripts.length);
  });

  it('declared vocabularies match the canonical vocabulary (status/platform/runIn)', () => {
    expect([...manifest.statusVocabulary].sort(), 'manifest.statusVocabulary drifted from canonical').toEqual(
      [...STATUS_VOCAB].sort(),
    );
    expect([...manifest.platformVocabulary].sort(), 'manifest.platformVocabulary drifted from canonical').toEqual(
      [...PLATFORM_VOCAB].sort(),
    );
    expect([...manifest.runInVocabulary].sort(), 'manifest.runInVocabulary drifted from canonical (must include unknown)').toEqual(
      [...RUNIN_VOCAB].sort(),
    );
  });

  it('status values come from the allowed vocabulary', () => {
    for (const g of manifest.gates) {
      expect(STATUS_VOCAB, `gate ${String(g.id)} status "${String(g.status)}" not allowed`).toContain(g.status);
    }
  });

  it('platform and runIn values come from the allowed vocabularies', () => {
    for (const g of manifest.gates) {
      expect(PLATFORM_VOCAB, `gate ${String(g.id)} platform "${String(g.platform)}" not allowed`).toContain(
        g.platform,
      );
      expect(RUNIN_VOCAB, `gate ${String(g.id)} runIn "${String(g.runIn)}" not allowed`).toContain(g.runIn);
    }
  });

  it('active gates have a non-empty owner and subsystem', () => {
    for (const g of manifest.gates) {
      if (g.status === 'active') {
        expect(
          g.owner && String(g.owner).trim().length > 0,
          `active gate ${String(g.id)} is missing an owner`,
        ).toBe(true);
        expect(
          g.subsystem && String(g.subsystem).trim().length > 0,
          `active gate ${String(g.id)} is missing a subsystem`,
        ).toBe(true);
      }
    }
  });

  it('superseded gates name a replacement that exists in the manifest; others must not claim one', () => {
    const ids = new Set(manifest.gates.map((g) => g.id as string));
    for (const g of manifest.gates) {
      if (g.status === 'superseded') {
        expect(g.supersedes, `superseded gate ${String(g.id)} must identify a replacement`).toBeTruthy();
        expect(
          ids.has(g.supersedes as string),
          `superseded gate ${String(g.id)} replacement "${String(g.supersedes)}" not in manifest`,
        ).toBe(true);
      } else {
        expect(
          g.supersedes,
          `non-superseded gate ${String(g.id)} should not set supersedes`,
        ).toBeFalsy();
      }
    }
  });

  it('every entry has the required fields and a valid verify:* script (malformed entries fail loudly)', () => {
    for (const g of manifest.gates) {
      for (const f of REQUIRED) {
        expect(g[f], `gate ${String(g.id ?? '(no id)')} missing required field "${f}"`).not.toBeUndefined();
      }
      expect(
        String(g.script).startsWith('verify:'),
        `gate ${String(g.id)} script "${String(g.script)}" must start with "verify:"`,
      ).toBe(true);
    }
  });

  it('every manifest entry references a verifier script file that still exists on disk', () => {
    for (const g of manifest.gates) {
      const body = pkg.scripts[g.script as string] ?? '';
      const referenced = [...body.matchAll(/scripts\/(verify-[a-zA-Z0-9_-]+\.cjs)/g)].map(
        (m) => m[1] as string,
      );
      for (const c of referenced) {
        expect(
          existsSync(resolve(root, 'scripts', c)),
          `verifier file missing for ${String(g.script)}: scripts/${c}`,
        ).toBe(true);
      }
    }
  });
});
