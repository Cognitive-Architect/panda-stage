export interface SymbolAliasIndex {
  readonly exact: ReadonlyMap<string, ReadonlySet<string>>;
  readonly basename: ReadonlyMap<string, ReadonlySet<string>>;
}

function normalizeReference(value: string): string {
  return value.trim().replaceAll('\\', '/').normalize('NFKC').toLocaleLowerCase('en-US');
}

function referenceBasename(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function libraryItemKey(entryName: string): string {
  return entryName.replaceAll('\\', '/').replace(/^LIBRARY\//iu, '').replace(/\.xml$/iu, '').trim();
}

export function makeSymbolAliasIndex(
  symbols: Iterable<{ readonly sourceLibraryItemName: string; readonly userLabel: string }>,
): SymbolAliasIndex {
  const exact = new Map<string, Set<string>>();
  const basename = new Map<string, Set<string>>();
  const add = (index: Map<string, Set<string>>, alias: string, key: string) => {
    const normalized = normalizeReference(alias);
    if (!normalized) return;
    let values = index.get(normalized);
    if (!values) {
      values = new Set();
      index.set(normalized, values);
    }
    values.add(key);
  };
  for (const { sourceLibraryItemName: key, userLabel } of symbols) {
    for (const alias of [key, `LIBRARY/${key}.xml`, userLabel]) {
      add(exact, alias, key);
      add(basename, referenceBasename(alias), key);
    }
  }
  return { exact, basename };
}

export function resolveSymbolAlias(aliases: SymbolAliasIndex, reference: string): string | null {
  const exact = aliases.exact.get(normalizeReference(reference));
  if (exact?.size) return exact.size === 1 ? exact.values().next().value ?? null : null;
  const basename = aliases.basename.get(normalizeReference(referenceBasename(reference)));
  return basename?.size === 1 ? basename.values().next().value ?? null : null;
}
